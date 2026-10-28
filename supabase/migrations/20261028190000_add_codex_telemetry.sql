-- Existing telemetry is Claude. Explicit source avoids guessing from model/project names.
alter table public.token_usage_logs
    add column source text not null default 'claude'
    check (source in ('claude', 'codex'));
create index idx_token_usage_logs_source_recorded_at
    on public.token_usage_logs(source, recorded_at desc);

-- Remove old signatures to avoid ambiguous PostgREST overloads with default arguments.
drop function public.get_token_usage_projects();
drop function public.get_token_usage_series(text[], timestamptz, timestamptz, text);
drop function public.get_token_usage_table(text[], timestamptz, timestamptz);
drop function public.get_cost_table(text[], timestamptz, timestamptz);
drop function public.get_cost_series(text[], timestamptz, timestamptz, text);

-- Backing functions for specs/token-usage-dashboard.md.
-- Called only by the Worker via the service_role key, so EXECUTE is revoked
-- from anon/authenticated to keep this internal-only cost/usage data private.

create or replace function public.get_token_usage_projects(p_source text default null)
returns table (project_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct t.project_name
  from public.token_usage_logs t
  where (p_source is null or t.source = p_source)
  order by 1;
$$;

create or replace function public.get_token_usage_series(
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
        from public.token_usage_logs t
        where t.recorded_at >= p_start
          and t.recorded_at <= p_end
          and (p_projects is null or t.project_name = any(p_projects))
          and (p_source is null or t.source = p_source)
        group by 1
        order by 1;
end;
$$;

create or replace function public.get_token_usage_table(
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
  from public.token_usage_logs t
  where t.recorded_at >= p_start
    and t.recorded_at <= p_end
    and (p_projects is null or t.project_name = any(p_projects))
          and (p_source is null or t.source = p_source)
  group by t.project_name
  order by total_tokens desc;
$$;

revoke execute on function public.get_token_usage_projects(text) from public, anon, authenticated;
grant execute on function public.get_token_usage_projects(text) to service_role;

revoke execute on function public.get_token_usage_series(text[], timestamptz, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.get_token_usage_series(text[], timestamptz, timestamptz, text, text) to service_role;

revoke execute on function public.get_token_usage_table(text[], timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_token_usage_table(text[], timestamptz, timestamptz, text) to service_role;

-- Backing functions for specs/usd-per-project-dashboard.md.
-- Unlike get_token_usage_series/get_token_usage_table, p_start/p_end default to
-- NULL (meaning "no filter" / all-time) rather than now()-7d, matching this
-- spec's "default all-time" requirement. This is intentional, not an oversight
-- to make consistent with the other two functions.

create or replace function public.get_cost_table(
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
  from public.token_usage_logs t
  where (p_start is null or t.recorded_at >= p_start)
    and (p_end is null or t.recorded_at <= p_end)
    and (p_projects is null or t.project_name = any(p_projects))
          and (p_source is null or t.source = p_source)
  group by t.project_name
  order by total_cost_usd desc;
$$;

create or replace function public.get_cost_series(
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
            from public.token_usage_logs t
            where (p_start is null or t.recorded_at >= p_start)
              and (p_end is null or t.recorded_at <= p_end)
              and (p_projects is null or t.project_name = any(p_projects))
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

revoke execute on function public.get_cost_table(text[], timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_cost_table(text[], timestamptz, timestamptz, text) to service_role;

revoke execute on function public.get_cost_series(text[], timestamptz, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.get_cost_series(text[], timestamptz, timestamptz, text, text) to service_role;

-- Pre-existing gap: project_spend_summary had no access-control statements of
-- its own. Nothing reads it (old or new code), but lock it down anyway to
-- match this repo's revoke/grant convention for dashboard-adjacent data.
revoke select on public.project_spend_summary from public, anon, authenticated;
grant select on public.project_spend_summary to service_role;
