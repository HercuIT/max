import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { assertFreshDatabase, includeSourceFilter } from './database-fixture.mjs';

export async function checkFixtureHelpers() {
    const included = "do $$ begin raise notice '$& $1 $$'; end $$;";
    assert.equal(includeSourceFilter('before -- SOURCE_FILTER_ASSERTIONS after', included), 'before ' + included + ' after');
    assert.throws(() => includeSourceFilter('no marker', included), /exactly one/);
    assert.throws(() => includeSourceFilter('-- SOURCE_FILTER_ASSERTIONS -- SOURCE_FILTER_ASSERTIONS', included), /exactly one/);
    await assert.rejects(assertFreshDatabase(async () => ({ rows: [] })), /Refusing/);
    const db = new PGlite();
    try {
        await assertFreshDatabase(sql => db.query(sql));
        for (const fixture of [
            'create schema unrelated_customer',
            'create table public.unrelated(id integer)',
            'create function public.unrelated() returns integer language sql as $$select 1$$',
            "create type public.customer_state as enum ('active')",
        ]) {
            await db.exec('begin; ' + fixture);
            await assert.rejects(assertFreshDatabase(sql => db.query(sql)), /Refusing/);
            await db.exec('rollback');
            await assertFreshDatabase(sql => db.query(sql));
        }
    } finally {
        await db.close();
    }
    console.log('PASS: verbatim dollar-quoted SQL inclusion and initialized-database refusal');
}
