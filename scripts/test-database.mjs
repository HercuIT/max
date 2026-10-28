import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
 create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
const root=new URL('../supabase/migrations/',import.meta.url);
for(const name of fs.readdirSync(root).sort()){
 if(name.includes('multi_tenancy')) await db.exec("insert into public.token_usage_logs(project_name,session_id,input_tokens,source) values ('legacy-repo','old-session',9,'claude')");
 await db.exec(fs.readFileSync(new URL(name,root),'utf8').replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";','').replaceAll('uuid_generate_v4()','gen_random_uuid()'));
}
let assertions=fs.readFileSync(new URL('../tests/tenancy.sql',import.meta.url),'utf8');
assertions=assertions.replace('-- SOURCE_FILTER_ASSERTIONS',fs.readFileSync(new URL('../tests/source-filter.sql',import.meta.url),'utf8'));
await db.exec(assertions);
console.log('PASS: migration history, historical ownership, RLS, tenant RPCs, role/key/invitation lifecycle, and deletion isolation');
await db.close();
