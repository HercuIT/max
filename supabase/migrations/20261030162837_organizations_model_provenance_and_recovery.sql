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

-- The view is honest immediately, including while old nullable rows are backfilled.
create or replace view public.token_usage_model_attribution with (security_invoker=true) as
 select id,tenant_id,model as raw_model,
  coalesce(model_provenance,private.model_provenance(source,model)) as model_provenance,
  case when coalesce(model_provenance,private.model_provenance(source,model))='reported'
   then model else 'unknown' end as effective_model
 from public.token_usage_logs;
revoke all on public.token_usage_model_attribution from public,anon,authenticated,service_role;
grant select on public.token_usage_model_attribution to authenticated;

create or replace function public.backfill_model_provenance(p_limit integer default 5000)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_limit not between 1 and 10000 or p_limit is null then
  raise exception using errcode='22023',message='Batch size must be between 1 and 10000.';
 end if;
 with batch as (select id from public.token_usage_logs where model_provenance is null
  order by id limit p_limit for update skip locked)
 update public.token_usage_logs t set model_provenance=private.model_provenance(t.source,t.model)
 from batch where t.id=batch.id;
 get diagnostics n=row_count;
 return n;
end; $$;
revoke all on function public.backfill_model_provenance(integer) from public,anon,authenticated;
grant execute on function public.backfill_model_provenance(integer) to service_role;

-- Existing pending deletion requests get at least seven days from this release.
alter table private.tenant_deletion_jobs add column if not exists purge_after timestamptz
 not null default (now()+interval '7 days');

create or replace function public.purge_tenant(p_tenant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant_id and status='deleting' for update;
 if not found then
  if exists(select 1 from private.tenant_deletion_jobs where tenant_id=p_tenant_id and purged_at is not null) then return; end if;
  raise exception using errcode='PT409',message='Organization has no pending deletion.';
 end if;
 if not exists(select 1 from private.tenant_deletion_jobs where tenant_id=p_tenant_id
  and purged_at is null and purge_after<=clock_timestamp()) then
  raise exception using errcode='PT409',message='Organization is still in its deletion recovery window.';
 end if;
 delete from public.tenants where id=p_tenant_id;
 update private.tenant_deletion_jobs set purged_at=now() where tenant_id=p_tenant_id;
 insert into private.tenant_audit_events(tenant_id,action) values(p_tenant_id,'purge');
end; $$;
revoke all on function public.purge_tenant(uuid) from public,anon,authenticated;
grant execute on function public.purge_tenant(uuid) to service_role;

-- Operator-assisted cancellation; it never revives revoked keys/invitations.
create or replace function public.cancel_tenant_deletion(p_tenant_id uuid,p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id=p_tenant_id and status='deleting' for update;
 if not found or not exists(select 1 from public.tenant_memberships
  where tenant_id=p_tenant_id and user_id=p_owner and role='owner') then
  raise exception using errcode='PT404',message='Organization or owner not found.';
 end if;
 if not exists(select 1 from private.tenant_deletion_jobs where tenant_id=p_tenant_id
  and purged_at is null and purge_after>clock_timestamp()) then
  raise exception using errcode='PT409',message='Deletion can no longer be cancelled.';
 end if;
 update public.tenants set status='active' where id=p_tenant_id;
 delete from private.tenant_deletion_jobs where tenant_id=p_tenant_id;
 insert into private.tenant_audit_events(tenant_id,actor_id,action)
 values(p_tenant_id,p_owner,'deletion.cancel');
end; $$;
revoke all on function public.cancel_tenant_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_tenant_deletion(uuid,uuid) to service_role;
