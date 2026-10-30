-- Operator-only online stage; never discovered by supabase db push.

-- Lock order agrees with ingest and revocation. Do not revive revoked material on rollback.
select 1 from public.tenants where id='00000000-0000-4000-8000-000000000001' for update;
update private.ingestion_keys set revoked_at=coalesce(revoked_at,now()) where id in(select key_id from private.legacy_ingest_bridge);
update private.legacy_ingest_bridge set retired_at=coalesce(retired_at,now());
alter table public.projects disable trigger legacy_project_ownership;
alter table public.token_usage_logs disable trigger legacy_usage_ownership;
