-- Run against a disposable migrated PostgreSQL database as its owner.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/source-filter.sql
begin;
insert into public.token_usage_logs (source, project_name, session_id, input_tokens, total_cost_usd)
values ('claude', '__source_filter_shared__', 'same-session', 10, 1),
       ('codex', '__source_filter_shared__', 'same-session', 20, 2),
       ('codex', '__source_filter_codex__', 'other-session', 30, 3);

do $$
declare
    selected_source text;
    tokens bigint;
    cost numeric;
    expected_tokens bigint;
    expected_cost numeric;
    session_count bigint;
    projects text[] := array['__source_filter_shared__', '__source_filter_codex__'];
begin
    foreach selected_source in array array['claude', 'codex', null] loop
        expected_tokens := case selected_source when 'claude' then 10 when 'codex' then 50 else 60 end;
        expected_cost := case selected_source when 'claude' then 1 when 'codex' then 5 else 6 end;
        select sum(total_tokens) into tokens from public.get_token_usage_table(p_projects => projects, p_source => selected_source);
        if tokens is distinct from expected_tokens then raise exception 'token table mismatch for %', selected_source; end if;
        select sum(input_tokens) into tokens from public.get_token_usage_series(p_projects => projects, p_source => selected_source);
        if tokens is distinct from expected_tokens then raise exception 'token series mismatch for %', selected_source; end if;
        select sum(total_cost_usd) into cost from public.get_cost_table(p_projects => projects, p_source => selected_source);
        if cost is distinct from expected_cost then raise exception 'cost table mismatch for %', selected_source; end if;
        select sum(cost_usd) into cost from public.get_cost_series(p_projects => projects, p_source => selected_source);
        if cost is distinct from expected_cost then raise exception 'cost series mismatch for %', selected_source; end if;
    end loop;
    if exists (select 1 from public.get_token_usage_projects('claude') where project_name = '__source_filter_codex__') then
        raise exception 'Codex project leaked into Claude project filter';
    end if;
    if not exists (select 1 from public.get_token_usage_projects('codex') where project_name = '__source_filter_codex__') then
        raise exception 'Codex project missing';
    end if;
    select sessions into session_count from public.get_token_usage_table(p_projects => array['__source_filter_shared__']);
    if session_count is distinct from 2::bigint then raise exception 'cross-source sessions collided'; end if;
    select sum(total_cost_usd) into cost from public.get_cost_table(p_projects => array['__source_filter_shared__'], p_source => 'codex');
    if cost is distinct from 2::numeric then raise exception 'project/source intersection failed'; end if;
    if exists (select 1 from public.get_cost_table(p_projects => projects, p_source => 'codex', p_start => now() + interval '1 day')) then
        raise exception 'date/source intersection failed';
    end if;
    if exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('get_token_usage_projects', 'get_token_usage_series', 'get_token_usage_table', 'get_cost_table', 'get_cost_series')
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
             or not has_function_privilege('service_role', p.oid, 'EXECUTE'))
    ) then raise exception 'dashboard RPC permissions regressed'; end if;
end;
$$;
rollback;
