import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

export async function registerLegacyIngest(db,{token,expiresAt}={}) {
 if(typeof token!=='string'||!/^\S{1,512}$/.test(token)||!Number.isFinite(Date.parse(expiresAt??'')))throw new Error('Supply the existing legacy token securely and a valid expiry.');
 await db.query('select public.register_legacy_ingest($1,$2::timestamptz)',[createHash('sha256').update(token).digest('hex'),expiresAt]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const expiresAt=process.argv.find(x=>x.startsWith('--expires-at='))?.slice('--expires-at='.length);
 if(!process.env.TENANCY_DATABASE_URL||!process.env.LEGACY_INGEST_TOKEN)throw new Error('Set TENANCY_DATABASE_URL and LEGACY_INGEST_TOKEN securely in the operator environment.');
 const db=new pg.Client({connectionString:process.env.TENANCY_DATABASE_URL});
 try{await db.connect();await registerLegacyIngest(db,{token:process.env.LEGACY_INGEST_TOKEN,expiresAt});console.log('Legacy bridge registered for the historical organization only.');}
 catch{console.error('Legacy bridge registration rejected; inspect privately.');process.exitCode=1;}
 finally{await db.end();}
}
