-- Narrow human reads without changing tenant RLS or dashboard RPC responses.
-- Full host/email attribution stays available only to the checked operator export.
revoke select on public.token_usage_logs from public,anon,authenticated;
revoke select(host_name,user_email) on public.token_usage_logs from public,anon,authenticated;
grant select(id,tenant_id,project_id,project_name,source,session_id,model,model_provenance,
 input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_cost_usd,recorded_at)
 on public.token_usage_logs to authenticated;
