-- After the bounded backfill, validate separately before this brief catalog step.
alter table public.token_usage_logs alter column model_provenance set not null;
