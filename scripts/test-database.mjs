import { PGlite } from '@electric-sql/pglite';
import { fixtureAssertions, setupFixture } from './database-fixture.mjs';
import { checkFixtureHelpers } from './test-database-fixture.mjs';
import fs from 'node:fs';

await checkFixtureHelpers();

const db = new PGlite();
try {
    await setupFixture(sql => db.exec(sql), { pglite: true });
    await db.exec(fixtureAssertions());
    await db.exec(fs.readFileSync(new URL('../tests/organizations.sql',import.meta.url),'utf8'));
    console.log('PASS: migration history, historical ownership, RLS, tenant RPCs, role/key/invitation lifecycle, and deletion isolation');
} finally {
    await db.close();
}
