import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import worker from '../../cloudflare/worker.mjs';
import {passwordHash} from '../../cloudflare/auth.mjs';
import {RosterClient} from '../../src/api-client.mjs';
import {createAdminApi} from '../../src/admin-api.mjs';
export const password='Test-only-administrator-password-2026';
function d1(sqlite){
  function prepared(sql,values=[]){
    const execute=()=>({results:sqlite.prepare(sql).all(...values),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)},success:true});
    return {bind:(...args)=>prepared(sql,args),all:async()=>execute(),first:async()=>execute().results[0]||null,run:async()=>execute(),execute};
  }
  return {prepare:prepared,batch:async statements=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
export async function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(await readFile(new URL('../../cloudflare/migrations/0001_rosters.sql',import.meta.url),'utf8'));
  const env={DB:d1(sqlite),ADMIN_PASSWORD_HASH:await passwordHash(password),ALLOWED_ORIGIN:'https://zajuak.github.io'};
  const fetcher=(url,options)=>worker.fetch(new Request(url,options),env);
  const client=new RosterClient('https://api.example',{storage:null,fetcher});
  await client.login(password);await client.getRosters();
  return {sqlite,env,fetcher,client,api:createAdminApi(client)};
}
