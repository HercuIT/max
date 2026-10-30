-- Operator-only online stage; never discovered by supabase db push.
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

   alter table public.projects add column tenant_id uuid;

   alter table public.token_usage_logs add column tenant_id uuid, add column project_id uuid;

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


alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
revoke all on public.tenants,public.tenant_memberships from public,anon,authenticated;
revoke all on public.projects from public,anon,authenticated;
create table private.organization_baseline_usage(id uuid primary key,original jsonb not null);
create table private.organization_baseline_projects(id uuid primary key,original jsonb not null);
create table private.organization_assignment_undo(kind text not null,id uuid not null,tenant_id uuid,project_id uuid,primary key(kind,id));
create table private.legacy_ingest_bridge(singleton boolean primary key default true check(singleton),key_id uuid not null unique references private.ingestion_keys(id),expires_at timestamptz not null,retired_at timestamptz);
revoke all on private.organization_baseline_usage,private.organization_baseline_projects,private.organization_assignment_undo,private.legacy_ingest_bridge from public,anon,authenticated,service_role;
create function private.guard_organization_admission() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.id<>'00000000-0000-4000-8000-000000000001'::uuid and
  coalesce((select phase<7 from private.organization_rollout_state where singleton),true) then
  raise exception using errcode='PT409',message='Organization rollout has not passed its admission gate.';
 end if;
 return new;
end; $$;
revoke all on function private.guard_organization_admission() from public,anon,authenticated,service_role;
create trigger organization_admission before insert on public.tenants for each row execute function private.guard_organization_admission();
create function private.legacy_project_ownership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.tenant_id is null then new.tenant_id:='00000000-0000-4000-8000-000000000001'; end if;
 return new;
end; $$;
revoke all on function private.legacy_project_ownership() from public,anon,authenticated,service_role;
create trigger legacy_project_ownership before insert on public.projects for each row execute function private.legacy_project_ownership();
create function private.legacy_usage_ownership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.tenant_id is null then new.tenant_id:='00000000-0000-4000-8000-000000000001'; end if;
 if new.project_id is null then
  if (select phase<7 from private.organization_rollout_state where singleton) then
   insert into public.projects(tenant_id,name) values(new.tenant_id,new.project_name)
    on conflict(name) do update set tenant_id=coalesce(public.projects.tenant_id,excluded.tenant_id);
  else
   insert into public.projects(tenant_id,name) values(new.tenant_id,new.project_name)
    on conflict(tenant_id,name) do nothing;
  end if;
  select id into new.project_id from public.projects where tenant_id=new.tenant_id and name=new.project_name;
 else
  if not exists(select 1 from public.projects where id=new.project_id and tenant_id=new.tenant_id and name=new.project_name) then
   raise exception using errcode='23503',message='Project does not belong to this organization.';
  end if;
 end if;
 if new.project_id is null then raise exception using errcode='23503',message='Project could not be resolved.'; end if;
 return new;
end; $$;
revoke all on function private.legacy_usage_ownership() from public,anon,authenticated,service_role;
create trigger legacy_usage_ownership before insert on public.token_usage_logs for each row execute function private.legacy_usage_ownership();
-- Expansion only: old usage/model values are never rewritten. Bounded backfill
-- and NOT NULL finalization are separate operator stages; see organizations-online.md.
alter table public.token_usage_logs add column if not exists model_provenance text;

create or replace function private.model_provenance(p_source text,p_model text)
returns text language sql immutable set search_path='' as $$
 select case when p_source='claude' then 'legacy_hardcoded'
  when p_source='codex' and nullif(btrim(p_model),'') is not null
   and lower(btrim(p_model)) not in ('unknown','unknown_model') then 'reported'
  else 'unknown' end;
$$;
revoke all on function private.model_provenance(text,text) from public,anon,authenticated,service_role;
grant execute on function private.model_provenance(text,text) to authenticated;

create or replace function private.set_model_provenance() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Provenance follows the actual parser contract, never caller-provided metadata.
 new.model_provenance:=private.model_provenance(new.source,new.model);
 return new;
end; $$;
revoke all on function private.set_model_provenance() from public,anon,authenticated,service_role;
create or replace trigger usage_model_provenance before insert or update of source,model,model_provenance
 on public.token_usage_logs for each row execute function private.set_model_provenance();

