import fs from 'node:fs';

const root = new URL('../supabase/migrations/', import.meta.url);

// Fail before creating roles, schemas, or tables. "Fresh" means the default
// PostgreSQL schemas with no application relations, functions, types or extensions.
export async function assertFreshDatabase(query) {
    const { rows } = await query(`select
      exists (select 1 from pg_namespace
        where nspname not in ('public', 'information_schema') and nspname !~ '^pg_')
      or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_')
      or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_')
      or exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
        where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_')
      or exists (select 1 from pg_extension where extname <> 'plpgsql') as initialized`);
    if (rows[0]?.initialized !== false) {
        throw new Error('Refusing an initialized or unrecognized database. Use a new disposable database.');
    }
}

export function includeSourceFilter(assertions, sourceFilter) {
    const marker = '-- SOURCE_FILTER_ASSERTIONS';
    if (assertions.split(marker).length !== 2) throw new Error('Expected exactly one source-filter fixture marker.');
    // A function replacement inserts dollar-quoted SQL verbatim ($$, $&, $1, etc.).
    return assertions.replace(marker, () => sourceFilter);
}

export async function setupFixture(execute, { pglite = false, applyMigration = (_name, sql) => execute(sql) } = {}) {
    await execute(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
 create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    for (const name of fs.readdirSync(root).filter(name => name.endsWith('.sql')).sort()) {
        if (name === '20261028210000_multi_tenancy.sql') {
            await execute("insert into public.token_usage_logs(project_name,session_id,input_tokens,source) values ('legacy-repo','old-session',9,'claude')");
        }
        let sql = fs.readFileSync(new URL(name, root), 'utf8');
        // The substitute is only for PGlite, which lacks uuid-ossp.
        if (pglite) sql = sql.replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";', '').replaceAll('uuid_generate_v4()', 'gen_random_uuid()');
        await applyMigration(name, sql);
    }
}

export function fixtureAssertions() {
    return includeSourceFilter(
        fs.readFileSync(new URL('../tests/tenancy.sql', import.meta.url), 'utf8'),
        fs.readFileSync(new URL('../tests/source-filter.sql', import.meta.url), 'utf8')
    );
}
