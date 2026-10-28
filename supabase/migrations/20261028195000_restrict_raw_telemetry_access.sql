-- Supabase may grant public-schema tables to its API roles by default.
-- Restricting dashboard RPCs/views alone does not protect their base table.
-- Keep this in a new migration so already-deployed databases receive the fix.
revoke all privileges on table public.token_usage_logs from public, anon, authenticated;
grant select, insert on table public.token_usage_logs to service_role;
