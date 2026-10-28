-- Coordinated cutover: pause old writers, apply, bootstrap legacy ownership,
-- deploy the tenant-aware Worker and provision exporter keys. See docs/tenancy-operations.md.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create table public.tenants (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 status text not null default 'active' check(status in ('active','deleting')),
 created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null
);
create table public.tenant_memberships (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','admin','viewer')), created_at timestamptz not null default now(),
 primary key(tenant_id,user_id)
);
create index tenant_memberships_user on public.tenant_memberships(user_id,tenant_id);
-- An unclaimed legacy tenant is inaccessible until a verified owner is assigned.
insert into public.tenants(id,name) values ('00000000-0000-4000-8000-000000000001','Legacy organization');
alter table public.projects add column tenant_id uuid references public.tenants(id) on delete cascade;
update public.projects set tenant_id='00000000-0000-4000-8000-000000000001';
alter table public.projects alter column tenant_id set not null;
alter table public.projects drop constraint projects_name_key;
alter table public.projects add constraint projects_tenant_name_key unique(tenant_id,name);
alter table public.projects add constraint projects_tenant_id_key unique(tenant_id,id);
alter table public.token_usage_logs add column tenant_id uuid references public.tenants(id) on delete cascade,
 add column project_id uuid;
update public.token_usage_logs set tenant_id='00000000-0000-4000-8000-000000000001';
insert into public.projects(tenant_id,name)
 select distinct tenant_id,project_name from public.token_usage_logs on conflict(tenant_id,name) do nothing;
update public.token_usage_logs t set project_id=p.id from public.projects p where p.tenant_id=t.tenant_id and p.name=t.project_name;
alter table public.token_usage_logs alter column tenant_id set not null, alter column project_id set not null;
alter table public.token_usage_logs add constraint usage_tenant_project_fk foreign key(tenant_id,project_id)
 references public.projects(tenant_id,id) on delete cascade;
create index usage_tenant_time on public.token_usage_logs(tenant_id,recorded_at desc);
create index usage_tenant_source_time on public.token_usage_logs(tenant_id,source,recorded_at desc);
create index usage_tenant_project_time on public.token_usage_logs(tenant_id,project_id,recorded_at desc);
drop view public.project_spend_summary;
create table private.ingestion_keys (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 label text not null check(length(btrim(label)) between 1 and 120), token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 prefix text not null, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz
);
create index keys_tenant on private.ingestion_keys(tenant_id);
create table private.tenant_invitations (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 email text not null, role text not null check(role in ('admin','viewer')), token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days', accepted_at timestamptz, revoked_at timestamptz
);
create index invitations_tenant on private.tenant_invitations(tenant_id);
create table private.tenant_audit_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, actor_id uuid,
 action text not null, target_id uuid, created_at timestamptz not null default now(), request_id text
);
create table private.tenant_deletion_jobs (tenant_id uuid primary key, requested_at timestamptz not null default now(), purged_at timestamptz);
create table private.rate_limits (key_hash text primary key, hits integer not null, resets_at timestamptz not null);
create index rate_limits_expiry on private.rate_limits(resets_at);
create index audit_tenant_time on private.tenant_audit_events(tenant_id,created_at desc);
revoke all on all tables in schema private from public, anon, authenticated;

create function private.tenant_role(p_tenant_id uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
 where m.tenant_id=p_tenant_id and m.user_id=auth.uid() and t.status='active';
$$;
revoke all on function private.tenant_role(uuid) from public,anon;
grant execute on function private.tenant_role(uuid) to authenticated;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.projects enable row level security;
alter table public.token_usage_logs enable row level security;
revoke all on public.tenants,public.tenant_memberships,public.projects,public.token_usage_logs from public,anon,authenticated;
grant select on public.tenants,public.tenant_memberships,public.projects,public.token_usage_logs to authenticated;
-- Privileged writes are confined to audited definer functions; no direct API writes.
revoke insert,update,delete,truncate on public.projects,public.token_usage_logs from service_role;
create policy tenant_read on public.tenants for select to authenticated using(private.tenant_role(id) is not null);
create policy member_read on public.tenant_memberships for select to authenticated using(private.tenant_role(tenant_id) is not null);
create policy project_read on public.projects for select to authenticated using(private.tenant_role(tenant_id) is not null);
create policy usage_read on public.token_usage_logs for select to authenticated using(private.tenant_role(tenant_id) is not null);

create function public.list_tenants() returns table(id uuid,name text,role text) language sql stable security invoker set search_path='' as $$
 select t.id,t.name,m.role from public.tenants t join public.tenant_memberships m on t.id=m.tenant_id
 where m.user_id=auth.uid() order by t.name,t.id;
$$;
create function public.bootstrap_tenant(p_name text,p_owner uuid,p_claim_legacy boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
 if not exists(select 1 from auth.users where id=p_owner and email_confirmed_at is not null) then
  raise exception using errcode='22023',message='Owner must be a verified Auth user.'; end if;
 if p_claim_legacy then
  tid:='00000000-0000-4000-8000-000000000001';
  perform 1 from public.tenants where id=tid for update;
  if exists(select 1 from public.tenant_memberships where tenant_id=tid) then raise exception using errcode='23505',message='Legacy tenant already claimed.'; end if;
  update public.tenants set name=p_name,created_by=p_owner where id=tid;
 else insert into public.tenants(name,created_by) values(p_name,p_owner) returning id into tid; end if;
 insert into public.tenant_memberships values(tid,p_owner,'owner',now());
 insert into private.tenant_audit_events(tenant_id,actor_id,action) values(tid,p_owner,'bootstrap');
 return tid;
end; $$;

create function public.get_tenant_members(p_tenant_id uuid) returns table(user_id uuid,display_name text,role text)
language plpgsql stable security definer set search_path='' as $$
begin
 if private.tenant_role(p_tenant_id) is null then raise exception using errcode='PT404',message='Organization not found.'; end if;
 return query select m.user_id,coalesce(nullif(u.raw_user_meta_data->>'name',''),'Member '||left(m.user_id::text,8)),m.role
 from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=p_tenant_id order by m.created_at;
end; $$;

create function public.manage_tenant(p_tenant_id uuid,p_action text,p_target_id uuid default null,p_values jsonb default '{}',p_request_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text; target_role text; result jsonb:='{}'; obj uuid; inv private.tenant_invitations; tenant_name text;
begin
 select name into tenant_name from public.tenants where id=p_tenant_id and status='active' for update;
 actor:=private.tenant_role(p_tenant_id);
 if actor is null then raise exception using errcode='PT404',message='Organization not found.'; end if;
 if p_action in ('members.update','members.remove') then
  select role into target_role from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_target_id;
  if target_role is null then raise exception using errcode='PT404',message='Member not found.'; end if;
  if not(actor in ('owner','admin') or (p_action='members.remove' and p_target_id=auth.uid())) then
   raise exception using errcode='PT403',message='An administrator must manage members.'; end if;
  if actor<>'owner' and (target_role='owner' or p_values->>'role'='owner') then
   raise exception using errcode='PT403',message='Only an owner can manage owners.'; end if;
  if p_action='members.update' and coalesce(p_values->>'role','') not in ('owner','admin','viewer') then
   raise exception using errcode='22023',message='Choose owner, admin, or viewer.'; end if;
  if target_role='owner' and (p_action='members.remove' or p_values->>'role'<>'owner')
    and (select count(*) from public.tenant_memberships where tenant_id=p_tenant_id and role='owner')=1 then
   raise exception using errcode='PT409',message='Transfer ownership before removing the last owner.'; end if;
  if p_action='members.remove' then delete from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_target_id;
  else update public.tenant_memberships set role=p_values->>'role' where tenant_id=p_tenant_id and user_id=p_target_id; end if;
 else
  if actor not in ('owner','admin') then raise exception using errcode='PT403',message='An administrator must manage organization settings.'; end if;
  case p_action
   when 'keys.list' then
    select coalesce(jsonb_agg(to_jsonb(k)-'token_hash'-'tenant_id'),'[]') into result from private.ingestion_keys k where tenant_id=p_tenant_id;
    return result;
   when 'keys.create' then
    if (p_values->>'expires_at')::timestamptz<=now() then raise exception using errcode='22023',message='Key expiry must be in the future.'; end if;
    insert into private.ingestion_keys(tenant_id,label,token_hash,prefix,created_by,expires_at)
    values(p_tenant_id,p_values->>'label',p_values->>'token_hash',p_values->>'prefix',auth.uid(),(p_values->>'expires_at')::timestamptz) returning id into obj;
    result:=jsonb_build_object('id',obj);
   when 'keys.revoke' then
    update private.ingestion_keys set revoked_at=coalesce(revoked_at,now()) where tenant_id=p_tenant_id and id=p_target_id returning id into obj;
    if obj is null then raise exception using errcode='PT404',message='Key not found.'; end if;
   when 'invitations.list' then
    select coalesce(jsonb_agg(to_jsonb(i)-'token_hash'-'tenant_id'),'[]') into result from private.tenant_invitations i where tenant_id=p_tenant_id and accepted_at is null and revoked_at is null;
    return result;
   when 'invitations.create' then
    if coalesce(p_values->>'role','') not in ('admin','viewer') or coalesce(btrim(p_values->>'email'),'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
     raise exception using errcode='22023',message='Supply a valid email and admin or viewer role.'; end if;
    if exists(select 1 from private.tenant_invitations where tenant_id=p_tenant_id and email=lower(btrim(p_values->>'email')) and accepted_at is null and revoked_at is null and expires_at>now()) then
     raise exception using errcode='PT409',message='A pending invitation already exists; resend or revoke it.'; end if;
    insert into private.tenant_invitations(tenant_id,email,role,token_hash,created_by)
    values(p_tenant_id,lower(btrim(p_values->>'email')),p_values->>'role',p_values->>'token_hash',auth.uid()) returning id into obj;
    result:=jsonb_build_object('id',obj,'email',lower(btrim(p_values->>'email')));
   when 'invitations.resend' then
    update private.tenant_invitations set token_hash=p_values->>'token_hash',expires_at=now()+interval '7 days'
    where tenant_id=p_tenant_id and id=p_target_id and accepted_at is null and revoked_at is null and expires_at>now() returning * into inv;
    if inv.id is null then raise exception using errcode='PT409',message='Invitation is expired or unavailable; create a new invitation.'; end if;
    result:=jsonb_build_object('id',inv.id,'email',inv.email); obj:=inv.id;
   when 'invitations.revoke' then
    update private.tenant_invitations set revoked_at=coalesce(revoked_at,now()) where tenant_id=p_tenant_id and id=p_target_id and accepted_at is null returning id into obj;
    if obj is null then raise exception using errcode='PT404',message='Invitation not found.'; end if;
   when 'rename' then
    update public.tenants set name=p_values->>'name' where id=p_tenant_id;
   when 'deletion-request' then
    if actor<>'owner' then raise exception using errcode='PT403',message='Only an owner can delete the organization.'; end if;
    if p_values->>'confirmation' is distinct from tenant_name then raise exception using errcode='22023',message='Type the organization name to confirm deletion.'; end if;
    update public.tenants set status='deleting' where id=p_tenant_id;
    update private.ingestion_keys set revoked_at=coalesce(revoked_at,now()) where tenant_id=p_tenant_id;
    update private.tenant_invitations set revoked_at=coalesce(revoked_at,now()) where tenant_id=p_tenant_id;
    insert into private.tenant_deletion_jobs(tenant_id) values(p_tenant_id) on conflict do nothing;
   else raise exception using errcode='22023',message='Unsupported organization action.';
  end case;
 end if;
 insert into private.tenant_audit_events(tenant_id,actor_id,action,target_id,request_id)
 values(p_tenant_id,auth.uid(),p_action,coalesce(obj,p_target_id),p_request_id);
 return result;
end; $$;

create function public.accept_tenant_invitation(p_token_hash text,p_request_id text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare inv private.tenant_invitations; tid uuid; email text;
begin
 select tenant_id into tid from private.tenant_invitations where token_hash=p_token_hash;
 perform 1 from public.tenants where id=tid and status='active' for update;
 if not found then raise exception using errcode='PT409',message='Invitation is unavailable.'; end if;
 select * into inv from private.tenant_invitations where token_hash=p_token_hash for update;
 select lower(btrim(u.email)) into email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 if inv.id is null or email is null or email<>inv.email or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at<=now() then
  raise exception using errcode='PT409',message='Invitation is unavailable or does not match your verified email.'; end if;
 insert into public.tenant_memberships(tenant_id,user_id,role) values(tid,auth.uid(),inv.role) on conflict do nothing;
 update private.tenant_invitations set accepted_at=now() where id=inv.id;
 insert into private.tenant_audit_events(tenant_id,actor_id,action,target_id,request_id) values(tid,auth.uid(),'invitation.accept',inv.id,p_request_id);
 return tid;
end; $$;

create function public.ingest_telemetry(p_token_hash text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid; key_id uuid; row jsonb; pid uuid; n integer:=0; project text;
begin
 select tenant_id into tid from private.ingestion_keys where token_hash=p_token_hash;
 perform 1 from public.tenants where id=tid and status='active' for update;
 if not found then raise exception using errcode='PT401',message='Unauthorized'; end if;
 select id into key_id from private.ingestion_keys where tenant_id=tid and token_hash=p_token_hash and revoked_at is null and (expires_at is null or expires_at>now()) for update;
 if key_id is null then raise exception using errcode='PT401',message='Unauthorized'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception using errcode='22023',message='Usage rows must be an array.'; end if;
 if jsonb_array_length(p_rows)>5000 then raise exception using errcode='PT413',message='Maximum 5000 usage rows per request.'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  project:=row->>'project_name';
  if jsonb_typeof(row)<>'object' or row ?| array['tenant_id','project_id'] or coalesce(length(project),0) not between 1 and 512
     or coalesce(row->>'source','') not in ('claude','codex') then raise exception using errcode='22023',message='Invalid usage row or project name.'; end if;
  if exists(select 1 from jsonb_each(row) v where v.key in ('input_tokens','output_tokens','cache_read_tokens','cache_write_tokens') and
    (jsonb_typeof(v.value)<>'number' or v.value::text !~ '^[0-9]+$' or (v.value::text)::numeric>9007199254740991))
    or jsonb_typeof(row->'total_cost_usd') is distinct from 'number' or coalesce((row->>'total_cost_usd')::numeric,-1)<0 then raise exception using errcode='22023',message='Usage counts and cost must be non-negative numbers.'; end if;
  insert into public.projects(tenant_id,name) values(tid,project) on conflict(tenant_id,name) do update set name=excluded.name returning id into pid;
  insert into public.token_usage_logs(tenant_id,project_id,project_name,source,session_id,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_cost_usd,host_name,user_email)
  values(tid,pid,project,row->>'source',coalesce(row->>'session_id','unknown_session'),coalesce(row->>'model','unknown_model'),
   coalesce((row->>'input_tokens')::bigint,0),coalesce((row->>'output_tokens')::bigint,0),coalesce((row->>'cache_read_tokens')::bigint,0),coalesce((row->>'cache_write_tokens')::bigint,0),
   (row->>'total_cost_usd')::numeric,row->>'host_name',row->>'user_email');
  n:=n+1;
 end loop;
 update private.ingestion_keys set last_used_at=now() where id=key_id;
 return jsonb_build_object('count',n,'tenant_id',tid,'key_id',key_id);
end; $$;

create function public.check_rate_limit(p_key_hash text,p_limit integer,p_window_seconds integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_limit<1 or p_window_seconds not between 1 and 86400 or p_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid rate limit'; end if;
 insert into private.rate_limits values(p_key_hash,1,clock_timestamp()+make_interval(secs=>p_window_seconds))
 on conflict(key_hash) do update set hits=case when private.rate_limits.resets_at<=clock_timestamp() then 1 else private.rate_limits.hits+1 end,
 resets_at=case when private.rate_limits.resets_at<=clock_timestamp() then clock_timestamp()+make_interval(secs=>p_window_seconds) else private.rate_limits.resets_at end returning hits into n;
 -- Opportunistically bound expired state; callers cannot inspect raw identifiers.
 delete from private.rate_limits where resets_at<clock_timestamp()-interval '1 day';
 return n<=p_limit;
end; $$;

create function private.guard_owner_deletion() returns trigger language plpgsql security definer set search_path='' as $$
declare tid uuid;
begin
 for tid in select tenant_id from public.tenant_memberships where user_id=old.id order by tenant_id loop
  perform 1 from public.tenants where id=tid for update;
  if exists(select 1 from public.tenant_memberships where tenant_id=tid and user_id=old.id and role='owner') and
   (select count(*) from public.tenant_memberships where tenant_id=tid and role='owner')=1 then
   raise exception using errcode='PT409',message='Transfer organization ownership before deleting this user.'; end if;
 end loop;
 return old;
end; $$;
create trigger protect_last_owner before delete on auth.users for each row execute function private.guard_owner_deletion();
create function public.purge_tenant(p_tenant_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant_id and status='deleting' for update;
 if not found then
  if exists(select 1 from private.tenant_deletion_jobs where tenant_id=p_tenant_id and purged_at is not null) then return; end if;
  raise exception using errcode='PT409',message='Organization has no pending deletion.';
 end if;
 delete from public.tenants where id=p_tenant_id;
 update private.tenant_deletion_jobs set purged_at=now() where tenant_id=p_tenant_id;
 insert into private.tenant_audit_events(tenant_id,action) values(p_tenant_id,'purge');
end; $$;

drop function public.get_token_usage_projects(text);
create or replace function public.get_token_usage_projects(p_tenant_id uuid, p_source text default null)
returns table (project_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct t.project_name
  from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
  where t.tenant_id=p_tenant_id and (p_source is null or t.source = p_source)
  order by 1;
$$;
revoke all on function public.get_token_usage_projects(uuid, text) from public,anon,service_role;
grant execute on function public.get_token_usage_projects(uuid, text) to authenticated;

drop function public.get_token_usage_series(text[], timestamptz, timestamptz, text, text);
create or replace function public.get_token_usage_series(p_tenant_id uuid, 
    p_projects text[] default null,
    p_start timestamptz default (now() - interval '7 days'),
    p_end timestamptz default now(),
    p_bucket text default 'day',
    p_source text default null
)
returns table (
    bucket timestamptz,
    input_tokens bigint,
    output_tokens bigint,
    cache_read_tokens bigint,
    cache_write_tokens bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if p_bucket not in ('hour', 'day', 'week') then
        raise exception 'invalid bucket: %, expected hour, day, or week', p_bucket;
    end if;

    return query
        select
            date_trunc(p_bucket, t.recorded_at) as bucket,
            coalesce(sum(t.input_tokens), 0)::bigint,
            coalesce(sum(t.output_tokens), 0)::bigint,
            coalesce(sum(t.cache_read_tokens), 0)::bigint,
            coalesce(sum(t.cache_write_tokens), 0)::bigint
        from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
        where t.tenant_id=p_tenant_id and t.recorded_at >= p_start
          and t.recorded_at <= p_end
          and (p_projects is null or p.name = any(p_projects))
          and (p_source is null or t.source = p_source)
        group by 1
        order by 1;
end;
$$;
revoke all on function public.get_token_usage_series(uuid, text[], timestamptz, timestamptz, text, text) from public,anon,service_role;
grant execute on function public.get_token_usage_series(uuid, text[], timestamptz, timestamptz, text, text) to authenticated;

drop function public.get_token_usage_table(text[], timestamptz, timestamptz, text);
create or replace function public.get_token_usage_table(p_tenant_id uuid, 
    p_projects text[] default null,
    p_start timestamptz default (now() - interval '7 days'),
    p_end timestamptz default now(),
    p_source text default null
)
returns table (
    project_name text,
    input_tokens bigint,
    output_tokens bigint,
    cache_read_tokens bigint,
    cache_write_tokens bigint,
    total_tokens bigint,
    sessions bigint,
    last_active timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
      t.project_name,
      coalesce(sum(t.input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(t.output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(t.cache_read_tokens), 0)::bigint as cache_read_tokens,
      coalesce(sum(t.cache_write_tokens), 0)::bigint as cache_write_tokens,
      coalesce(sum(t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens), 0)::bigint as total_tokens,
      count(distinct (t.source, t.session_id))::bigint as sessions,
      max(t.recorded_at) as last_active
  from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
  where t.tenant_id=p_tenant_id and t.recorded_at >= p_start
    and t.recorded_at <= p_end
    and (p_projects is null or p.name = any(p_projects))
          and (p_source is null or t.source = p_source)
  group by t.project_name
  order by total_tokens desc;
$$;
revoke all on function public.get_token_usage_table(uuid, text[], timestamptz, timestamptz, text) from public,anon,service_role;
grant execute on function public.get_token_usage_table(uuid, text[], timestamptz, timestamptz, text) to authenticated;

drop function public.get_cost_table(text[], timestamptz, timestamptz, text);
create or replace function public.get_cost_table(p_tenant_id uuid, 
    p_projects text[] default null,
    p_start timestamptz default null,
    p_end timestamptz default null,
    p_source text default null
)
returns table (
    project_name text,
    total_input_tokens bigint,
    total_output_tokens bigint,
    total_cache_read_tokens bigint,
    total_cache_write_tokens bigint,
    total_tokens bigint,
    total_cost_usd numeric(10, 6),
    cost_per_1k_tokens numeric,
    sessions bigint,
    last_active timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
      t.project_name,
      coalesce(sum(t.input_tokens), 0)::bigint as total_input_tokens,
      coalesce(sum(t.output_tokens), 0)::bigint as total_output_tokens,
      coalesce(sum(t.cache_read_tokens), 0)::bigint as total_cache_read_tokens,
      coalesce(sum(t.cache_write_tokens), 0)::bigint as total_cache_write_tokens,
      coalesce(sum(t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens), 0)::bigint as total_tokens,
      coalesce(sum(t.total_cost_usd), 0.000000)::numeric(10, 6) as total_cost_usd,
      case
        when coalesce(sum(t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens), 0) > 0
          then round(coalesce(sum(t.total_cost_usd), 0) / (sum(t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens)::numeric / 1000.0), 6)
        else 0
      end as cost_per_1k_tokens,
      count(distinct (t.source, t.session_id))::bigint as sessions,
      max(t.recorded_at) as last_active
  from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
  where t.tenant_id=p_tenant_id and (p_start is null or t.recorded_at >= p_start)
    and (p_end is null or t.recorded_at <= p_end)
    and (p_projects is null or p.name = any(p_projects))
          and (p_source is null or t.source = p_source)
  group by t.project_name
  order by total_cost_usd desc;
$$;
revoke all on function public.get_cost_table(uuid, text[], timestamptz, timestamptz, text) from public,anon,service_role;
grant execute on function public.get_cost_table(uuid, text[], timestamptz, timestamptz, text) to authenticated;

drop function public.get_cost_series(text[], timestamptz, timestamptz, text, text);
create or replace function public.get_cost_series(p_tenant_id uuid, 
    p_projects text[] default null,
    p_start timestamptz default null,
    p_end timestamptz default null,
    p_bucket text default 'day',
    p_source text default null
)
returns table (
    project_name text,
    bucket timestamptz,
    cost_usd numeric,
    cumulative_cost_usd numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if p_bucket not in ('hour', 'day', 'week') then
        raise exception 'invalid bucket: %, expected hour, day, or week', p_bucket;
    end if;

    return query
        with per_bucket as (
            select
                t.project_name,
                date_trunc(p_bucket, t.recorded_at) as bucket,
                coalesce(sum(t.total_cost_usd), 0)::numeric as cost_usd
            from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
            where t.tenant_id=p_tenant_id and (p_start is null or t.recorded_at >= p_start)
              and (p_end is null or t.recorded_at <= p_end)
              and (p_projects is null or p.name = any(p_projects))
          and (p_source is null or t.source = p_source)
            group by t.project_name, date_trunc(p_bucket, t.recorded_at)
        )
        select
            pb.project_name,
            pb.bucket,
            pb.cost_usd,
            sum(pb.cost_usd) over (partition by pb.project_name order by pb.bucket)::numeric as cumulative_cost_usd
        from per_bucket pb
        order by pb.project_name, pb.bucket;
end;
$$;
revoke all on function public.get_cost_series(uuid, text[], timestamptz, timestamptz, text, text) from public,anon,service_role;
grant execute on function public.get_cost_series(uuid, text[], timestamptz, timestamptz, text, text) to authenticated;
revoke all on function public.list_tenants() from public,anon,service_role;
grant execute on function public.list_tenants() to authenticated;
revoke all on function public.get_tenant_members(uuid) from public,anon,service_role;
grant execute on function public.get_tenant_members(uuid) to authenticated;
revoke all on function public.manage_tenant(uuid,text,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.manage_tenant(uuid,text,uuid,jsonb,text) to authenticated;
revoke all on function public.accept_tenant_invitation(text,text) from public,anon,service_role;
grant execute on function public.accept_tenant_invitation(text,text) to authenticated;
revoke all on function public.bootstrap_tenant(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.bootstrap_tenant(text,uuid,boolean) to service_role;
revoke all on function public.ingest_telemetry(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_telemetry(text,jsonb) to service_role;
revoke all on function public.check_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.check_rate_limit(text,integer,integer) to service_role;
revoke all on function public.purge_tenant(uuid) from public,anon,authenticated;
grant execute on function public.purge_tenant(uuid) to service_role;
revoke all on function private.guard_owner_deletion() from public,anon,authenticated;
