-- Loaded only by online stage 006, never by the normal migration history.
create function public.register_legacy_ingest(p_token_hash text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare kid uuid;
begin
 perform 1 from public.tenants where id='00000000-0000-4000-8000-000000000001' for update;
 if not exists(select 1 from private.organization_rollout_state where singleton and phase=6)
  or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
  or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '7 days'
  or exists(select 1 from private.legacy_ingest_bridge) then
  raise exception using errcode='PT409',message='Legacy bridge registration is unavailable.';
 end if;
 insert into private.ingestion_keys(tenant_id,label,token_hash,prefix,expires_at)
 values('00000000-0000-4000-8000-000000000001','Temporary legacy exporter',p_token_hash,'legacy',p_expires_at)
 returning id into kid;
 insert into private.legacy_ingest_bridge(key_id,expires_at) values(kid,p_expires_at);
 insert into private.tenant_audit_events(tenant_id,action,target_id)
 values('00000000-0000-4000-8000-000000000001','legacy-bridge.register',kid);
end; $$;
revoke all on function public.register_legacy_ingest(text,timestamptz) from public,anon,authenticated;
grant execute on function public.register_legacy_ingest(text,timestamptz) to service_role;

create function public.ingest_legacy_telemetry(p_token_hash text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.tenants where id='00000000-0000-4000-8000-000000000001' and status='active' for update;
 if not found or not exists(select 1 from private.organization_rollout_state where singleton and phase between 6 and 7)
  or not exists(select 1 from private.legacy_ingest_bridge b join private.ingestion_keys k on k.id=b.key_id
   where b.retired_at is null and b.expires_at>clock_timestamp() and k.token_hash=p_token_hash
    and k.tenant_id='00000000-0000-4000-8000-000000000001') then
  raise exception using errcode='PT401',message='Unauthorized';
 end if;
 return public.ingest_telemetry(p_token_hash,p_rows);
end; $$;
revoke all on function public.ingest_legacy_telemetry(text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_legacy_telemetry(text,jsonb) to service_role;
