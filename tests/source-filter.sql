-- Run after the tenancy migration in a disposable database.
-- Tests run inside the broader tenancy fixture in tests/tenancy.sql.
-- Use an authenticated member JWT context and a caller-owned tenant UUID.
-- This file is included by scripts/test-database.mjs within tests/tenancy.sql's transaction.
select pg_temp.check_true((select sum(input_tokens)=20 from public.get_token_usage_series(current_setting('test.a')::uuid,p_source=>'codex')),'Codex series remains tenant-scoped');
select pg_temp.check_true((select sum(input_tokens)=19 from public.get_token_usage_series(current_setting('test.a')::uuid,p_source=>'claude')),'Claude series includes historical ownership');
select pg_temp.check_true((select sum(total_cost_usd)=2 from public.get_cost_table(current_setting('test.a')::uuid,p_source=>'codex',p_projects=>array['shared'])),'source/project intersection');
select pg_temp.check_true((select count(*)=0 from public.get_cost_table(current_setting('test.a')::uuid,p_source=>'codex',p_projects=>array['missing'])),'empty intersection stays empty');
select pg_temp.check_true((select count(*)=0 from public.get_token_usage_projects(current_setting('test.b')::uuid)),'project RPC enforces RLS');
select pg_temp.check_true((select count(*)=0 from public.get_cost_table(current_setting('test.a')::uuid,p_start=>now()+interval '1 day')),'date/source intersection');
