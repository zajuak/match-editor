import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import worker from '../../cloudflare/worker.mjs';
import {passwordHash} from '../../cloudflare/auth.mjs';
import {RosterClient} from '../../src/api-client.mjs';
import {createAdminApi} from '../../src/admin-api.mjs';
import {d1Database} from '../../server/database.mjs';
export const password='Test-only-administrator-password-2026';
export async function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(await readFile(new URL('../../cloudflare/migrations/0001_rosters.sql',import.meta.url),'utf8'));
  const env={DB:d1Database(sqlite),ADMIN_PASSWORD_HASH:await passwordHash(password),ALLOWED_ORIGIN:'https://zajuak.github.io'};
  const fetcher=(url,options)=>worker.fetch(new Request(url,options),env);
  const client=new RosterClient('https://api.example',{storage:null,fetcher});
  await client.login(password);await client.getRosters();
  return {sqlite,env,fetcher,client,api:createAdminApi(client)};
}
