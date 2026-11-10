import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';
import {passwordHash} from '../cloudflare/auth.mjs';
import {RosterClient} from '../src/api-client.mjs';
import {createAdminApi} from '../src/admin-api.mjs';
import {loadSharedRosters} from '../src/rosters.mjs';

import {fixture,password} from './helpers/worker-fixture.mjs';
const sample={tournaments:[{id:'t',name:'测试杯',lineups:false}],teams:[{id:'home',name:'红队',tournament_id:'t'},{id:'away',name:'蓝队',tournament_id:'t'}],players:[{id:'p',name:'张三',team_id:'home',legacy_key:'["测试杯","红队","张三"]'}]};
async function seed(client,payload=sample){return client.request('/api/admin/seed',{method:'POST',body:payload,write:true});}

test('Cloudflare auth protects all writes; sessions expire, logout and password rotation revoke access',async()=>{
  const f=await fixture();
  const anon=new RosterClient('https://api.example',{storage:null,fetcher:f.fetcher});
  assert.equal(await anon.getSession(),null);assert.equal((await anon.getRosters()).tournaments.length,0);
  await assert.rejects(anon.request('/api/admin/tournament',{method:'POST',body:{name:'unauthorized'},write:true}),e=>e.status===401);
  await assert.rejects(anon.login('wrong'),e=>e.status===401);
  assert.ok(await f.client.getSession());await f.client.logout();assert.equal(await f.client.getSession(),null);
  await f.client.login(password);f.sqlite.prepare('UPDATE admin_sessions SET expires_at=0').run();assert.equal(await f.client.getSession(),null);
  await f.client.login(password);f.env.ADMIN_PASSWORD_HASH=await passwordHash('a-new-password');assert.equal(await f.client.getSession(),null);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM tournaments').get().n,0);
});

test('Cloudflare returns only public roster data and rejects unexpected origins and table routes',async()=>{
  const f=await fixture();await seed(f.client);
  const response=await worker.fetch(new Request('https://api.example/api/rosters',{headers:{Origin:'https://zajuak.github.io'}}),f.env);
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://zajuak.github.io');assert.equal(response.headers.get('Cache-Control'),'no-store');
  const body=await response.json();assert.equal(body.tournaments[0].teams.length,2);assert.equal(body.revision,1);assert.ok(!JSON.stringify(body).includes('token_hash'));
  assert.equal((await worker.fetch(new Request('https://api.example/api/rosters',{headers:{Origin:'https://evil.example'}}),f.env)).status,403);
  assert.equal((await worker.fetch(new Request('https://api.example/api/admin_sessions'),f.env)).status,404);
  const preflight=await worker.fetch(new Request('https://api.example/api/rosters',{method:'OPTIONS',headers:{Origin:'https://zajuak.github.io'}}),f.env);assert.equal(preflight.status,204);assert.ok(preflight.headers.get('Access-Control-Allow-Headers').includes('If-Match'));
});

test('initial D1 import is atomic and refuses to overwrite nonempty data',async()=>{
  const f=await fixture();
  const invalid=structuredClone(sample);invalid.players.push({...invalid.players[0],id:'duplicate'});
  await assert.rejects(seed(f.client,invalid),e=>e.status===409);
  assert.equal(f.sqlite.prepare('SELECT revision FROM roster_state').get().revision,0);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM tournaments').get().n,0);
  const result=await seed(f.client);assert.deepEqual(result.counts,{tournaments:1,teams:2,players:1});
  await assert.rejects(seed(f.client),e=>e.status===409);
  assert.equal(f.sqlite.prepare('SELECT revision FROM roster_state').get().revision,1);
});

test('admin APIs create, rename and delete all entity types while preserving UUIDs and cascade rules',async()=>{
  const f=await fixture();
  const t=await f.api.createTournament('新杯赛',false),team=await f.api.createTeam(t.id,'新球队'),player=await f.api.createPlayer(team.id,'球员甲');
  await f.api.renameTournament(t.id,'更新赛事');await f.api.renameTeam(team.id,'更新球队');await f.api.renamePlayer(player.id,'更新球员');
  await f.api.setTournamentLineups(t.id,true);
  const {tournaments,records}=await loadSharedRosters(f.client);assert.equal(tournaments[0].id,t.id);assert.equal(tournaments[0].lineups,true);assert.equal(records[0].id,player.id);assert.equal(records[0].name,'更新球员');
  await assert.rejects(f.api.createTeam(t.id,'更新球队'),e=>e.status===409);
  await assert.rejects(f.api.createPlayer('missing-team','失效关联'),e=>e.status===400);
  await f.client.getRosters();await f.api.deleteTournament(t.id);
  for(const table of ['tournaments','teams','players'])assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
});

test('atomic reorder normalizes duplicate positions and rejects cross-parent changes',async()=>{
  const f=await fixture();await seed(f.client);
  const second=await f.api.createPlayer('home','第二球员'),outsider=await f.api.createPlayer('away','另一队球员');
  f.sqlite.prepare('UPDATE players SET position=0').run();
  await f.api.reorderPlayers('p',second.id);
  assert.deepEqual(f.sqlite.prepare('SELECT position FROM players WHERE team_id=? ORDER BY position').all('home').map(r=>r.position),[0,1]);
  const before=f.sqlite.prepare('SELECT revision FROM roster_state').get().revision;
  await assert.rejects(f.api.reorderPlayers('p',outsider.id),/同一上级/);assert.equal(f.sqlite.prepare('SELECT revision FROM roster_state').get().revision,before);
  await f.api.reorderTeams('home','away');assert.equal((await f.client.getRosters()).tournaments[0].teams[0].id,'away');
});

test('stale and concurrent administrators cannot overwrite one another',async()=>{
  const f=await fixture();await seed(f.client);
  const other=new RosterClient('https://api.example',{storage:null,fetcher:f.fetcher});await other.login(password);await other.getRosters();
  await f.api.renameTeam('home','新红队');
  await assert.rejects(createAdminApi(other).renameTeam('home','旧客户端覆盖'),e=>e.status===409);
  assert.equal(f.sqlite.prepare('SELECT name FROM teams WHERE id=?').get('home').name,'新红队');
  await other.getRosters();await f.client.getRosters();
  const result=await Promise.allSettled([f.api.createPlayer('home','并发甲'),createAdminApi(other).createPlayer('home','并发乙')]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected' && r.reason.status===409).length,1);
});

test('login throttling and input validation reject brute force, missing revisions and invalid payloads',async()=>{
  const f=await fixture();
  for(let n=0;n<7;n++)await assert.rejects(f.client.login('wrong'),e=>e.status===401);
  await assert.rejects(f.client.login(password),e=>e.status===429);
  // Use a fresh authorized fixture, since failed logins clear client-side session state.
  const good=await fixture();
  const bad=await worker.fetch(new Request('https://api.example/api/admin/tournament',{method:'POST',headers:{Authorization:`Bearer ${good.client.token}`,'Content-Type':'application/json'},body:'{"name":"x"}'}),good.env);assert.equal(bad.status,428);
  const huge=await worker.fetch(new Request('https://api.example/api/admin/tournament',{method:'POST',headers:{Authorization:`Bearer ${good.client.token}`,'Content-Type':'application/json','If-Match':'0'},body:JSON.stringify({name:'x',extra:'z'.repeat(9000)})}),good.env);assert.equal(huge.status,413);
  assert.throws(()=>good.api.createTournament('   '),/名称/);
});
