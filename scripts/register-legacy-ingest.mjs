import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

class LegacyRegistrationError extends Error {
 constructor(message){super(message);this.code='INVALID_LEGACY_REGISTRATION';}
}
export function registrationFailureMessage(error) {
 if(error instanceof LegacyRegistrationError)return `Legacy bridge registration rejected (${error.code}): ${error.message}`;
 if(typeof error?.syscall!=='string'&&/^[A-Z0-9]{5}$/.test(error?.code??''))return `Legacy bridge registration rejected; database SQLSTATE: ${error.code}. Inspect privately before retrying.`;
 if(['ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT'].includes(error?.code))return `Legacy bridge registration failed; connection error: ${error.code}. Check the operator connection and retry.`;
 return 'Legacy bridge registration failed; inspect privately. No provider details or credentials printed.';
}
export async function registerLegacyIngest(db,{token,expiresAt}={}) {
 if(typeof token!=='string'||!/^\S{1,512}$/.test(token))throw new LegacyRegistrationError('Supply the existing legacy token securely (1–512 non-whitespace characters).');
 // Requiring an explicit zone makes interpretation independent of the operator
 // process and database session time zones. Preserve the original calendar date:
 // JavaScript Date normalization would roll e.g. February 31 into March before
 // PostgreSQL can reject it. The typed database parameter owns calendar/policy validation.
 if(typeof expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(expiresAt)||!Number.isFinite(Date.parse(expiresAt)))throw new LegacyRegistrationError('Supply a valid ISO expiry with Z or an explicit UTC offset.');
 await db.query('select public.register_legacy_ingest($1,$2::timestamptz)',[createHash('sha256').update(token).digest('hex'),expiresAt]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const expiresAt=process.argv.find(x=>x.startsWith('--expires-at='))?.slice('--expires-at='.length);
 if(!process.env.TENANCY_DATABASE_URL||!process.env.LEGACY_INGEST_TOKEN)throw new Error('Set TENANCY_DATABASE_URL and LEGACY_INGEST_TOKEN securely in the operator environment.');
 const db=new pg.Client({connectionString:process.env.TENANCY_DATABASE_URL});
 try{await db.connect();await registerLegacyIngest(db,{token:process.env.LEGACY_INGEST_TOKEN,expiresAt});console.log('Legacy bridge registered for the historical organization only.');}
 catch(error){console.error(registrationFailureMessage(error));process.exitCode=1;}
 finally{await db.end();}
}
