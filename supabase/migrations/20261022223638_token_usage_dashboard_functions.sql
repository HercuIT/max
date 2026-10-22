-- Backing functions for specs/token-usage-dashboard.md.
-- Called only by the Worker via the service_role key, so EXECUTE is revoked
-- from anon/authenticated to keep this internal-only cost/usage data private.

create or replace function public.get_token_usage_projects()
returns table (project_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct t.project_name
  from public.token_usage_logs t
  order by 1;
$$;

create or replace function public.get_token_usage_series(
    p_projects text[] default null,
    p_start timestamptz default (now() - interval '7 days'),
    p_end timestamptz default now(),
    p_bucket text default 'day'
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
        from public.token_usage_logs t
        where t.recorded_at >= p_start
          and t.recorded_at <= p_end
          and (p_projects is null or t.project_name = any(p_projects))
        group by 1
        order by 1;
end;
$$;

create or replace function public.get_token_usage_table(
    p_projects text[] default null,
    p_start timestamptz default (now() - interval '7 days'),
    p_end timestamptz default now()
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
      count(distinct t.session_id)::bigint as sessions,
      max(t.recorded_at) as last_active
  from public.token_usage_logs t
  where t.recorded_at >= p_start
    and t.recorded_at <= p_end
    and (p_projects is null or t.project_name = any(p_projects))
  group by t.project_name
  order by total_tokens desc;
$$;

revoke execute on function public.get_token_usage_projects() from public, anon, authenticated;
grant execute on function public.get_token_usage_projects() to service_role;

revoke execute on function public.get_token_usage_series(text[], timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_token_usage_series(text[], timestamptz, timestamptz, text) to service_role;

revoke execute on function public.get_token_usage_table(text[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_token_usage_table(text[], timestamptz, timestamptz) to service_role;
