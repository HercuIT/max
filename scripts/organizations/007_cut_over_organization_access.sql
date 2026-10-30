-- Operator-only online stage; never discovered by supabase db push.

-- Retain legacy definitions, inaccessible and outside PostgREST; avoid overload ambiguity.
revoke all on function public.get_token_usage_projects(text) from public,anon,authenticated,service_role;
revoke all on function public.get_token_usage_series(text[],timestamptz,timestamptz,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_token_usage_table(text[],timestamptz,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.get_cost_series(text[],timestamptz,timestamptz,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_cost_table(text[],timestamptz,timestamptz,text) from public,anon,authenticated,service_role;
alter function public.get_token_usage_projects(text) set schema private;
alter function public.get_token_usage_series(text[],timestamptz,timestamptz,text,text) set schema private;
alter function public.get_token_usage_table(text[],timestamptz,timestamptz,text) set schema private;
alter function public.get_cost_series(text[],timestamptz,timestamptz,text,text) set schema private;
alter function public.get_cost_table(text[],timestamptz,timestamptz,text) set schema private;
revoke all on public.project_spend_summary from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.projects,public.token_usage_logs from service_role;
alter table public.projects drop constraint projects_name_key;
create or replace function public.get_token_usage_projects(p_tenant_id uuid, p_source text default null)
returns table (project_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct t.project_name
  from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
  where t.tenant_id=p_tenant_id and (p_source is null or t.source = p_source)
  order by 1;
$$;
revoke all on function public.get_token_usage_projects(uuid, text) from public,anon,service_role;
grant execute on function public.get_token_usage_projects(uuid, text) to authenticated;

create or replace function public.get_token_usage_series(p_tenant_id uuid, 
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
        from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
        where t.tenant_id=p_tenant_id and t.recorded_at >= p_start
          and t.recorded_at <= p_end
          and (p_projects is null or p.name = any(p_projects))
          and (p_source is null or t.source = p_source)
        group by 1
        order by 1;
end;
$$;
revoke all on function public.get_token_usage_series(uuid, text[], timestamptz, timestamptz, text, text) from public,anon,service_role;
grant execute on function public.get_token_usage_series(uuid, text[], timestamptz, timestamptz, text, text) to authenticated;

create or replace function public.get_token_usage_table(p_tenant_id uuid, 
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
  from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
  where t.tenant_id=p_tenant_id and t.recorded_at >= p_start
    and t.recorded_at <= p_end
    and (p_projects is null or p.name = any(p_projects))
          and (p_source is null or t.source = p_source)
  group by t.project_name
  order by total_tokens desc;
$$;
revoke all on function public.get_token_usage_table(uuid, text[], timestamptz, timestamptz, text) from public,anon,service_role;
grant execute on function public.get_token_usage_table(uuid, text[], timestamptz, timestamptz, text) to authenticated;

create or replace function public.get_cost_table(p_tenant_id uuid, 
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
  from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
  where t.tenant_id=p_tenant_id and (p_start is null or t.recorded_at >= p_start)
    and (p_end is null or t.recorded_at <= p_end)
    and (p_projects is null or p.name = any(p_projects))
          and (p_source is null or t.source = p_source)
  group by t.project_name
  order by total_cost_usd desc;
$$;
revoke all on function public.get_cost_table(uuid, text[], timestamptz, timestamptz, text) from public,anon,service_role;
grant execute on function public.get_cost_table(uuid, text[], timestamptz, timestamptz, text) to authenticated;

create or replace function public.get_cost_series(p_tenant_id uuid, 
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
            from public.token_usage_logs t join public.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id
            where t.tenant_id=p_tenant_id and (p_start is null or t.recorded_at >= p_start)
              and (p_end is null or t.recorded_at <= p_end)
              and (p_projects is null or p.name = any(p_projects))
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
revoke all on function public.get_cost_series(uuid, text[], timestamptz, timestamptz, text, text) from public,anon,service_role;
grant execute on function public.get_cost_series(uuid, text[], timestamptz, timestamptz, text, text) to authenticated;
