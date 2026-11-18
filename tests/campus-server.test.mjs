import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from '../scripts/build.mjs';
import {startCampusServer} from '../server/main.mjs';
import {openDatabase} from '../server/database.mjs';
import {passwordHash} from '../cloudflare/auth.mjs';
import {RosterClient} from '../src/api-client.mjs';
import {createAdminApi} from '../src/admin-api.mjs';
import {normalizeRosterSnapshot} from '../src/rosters.mjs';

const seed={version:1,revision:7,tournaments:[{id:'t',name:'校内杯',lineups:false,position:0,teams:[
  {id:'home',name:'红队',position:0,players:[{id:'a',name:'甲',position:0,legacy_key:'original-key'},{id:'b',name:'乙',position:1,legacy_key:''}]},
  {id:'away',name:'蓝队',position:1,players:[]}
]}]};
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

test('independent campus server serves same-origin editor, enforces auth and persists roster imports across restart',async()=>{
  const temporary=await mkdtemp(path.join(tmpdir(),'match-editor-campus-'));
  let server;
  try{
    const seedFile=path.join(temporary,'seed.json');await writeFile(seedFile,JSON.stringify(seed));
    const {destination}=await build(path.join(temporary,'dist'),{environment:{MATCH_EDITOR_SAME_ORIGIN:'true'},requireConfig:true});
    const env={HOST:'127.0.0.1',PORT:'0',PUBLIC_ORIGIN:'http://campus.example:8083',DATA_DIR:path.join(temporary,'db'),STATIC_DIR:destination,SEED_FILE:seedFile,ADMIN_PASSWORD_HASH:await passwordHash('test-only-campus-password')};
    server=await startCampusServer(env);
    const base=`http://127.0.0.1:${server.address().port}`,client=new RosterClient(base,{storage:null}),api=createAdminApi(client);
    assert.ok((await (await fetch(base+'/')).text()).includes('赛果图编辑器'));
    assert.ok((await (await fetch(base+'/admin.html')).text()).includes('上传报名表'));
    const runtime=await (await fetch(base+'/runtime-config.mjs')).text();
    assert.ok(runtime.includes('globalThis.location.origin'));assert.ok(!runtime.includes('workers.dev'));assert.ok(!runtime.includes('pbkdf2'));
    for(const url of ['/server/main.mjs','/.env','/cloudflare/auth.mjs','/missing.mjs'])assert.equal((await fetch(base+url)).status,404);
    assert.equal((await fetch(base+'/index.html',{method:'POST'})).status,405);
    assert.deepEqual(normalizeRosterSnapshot(await client.getRosters()),normalizeRosterSnapshot(seed));
    await assert.rejects(api.renamePlayer('a','未授权'),error=>error.status===401);
    await client.login('test-only-campus-password');
    await api.renamePlayer('a','甲改名');
    const before=(await client.getRosters()).revision;
    await api.importRegistration('t',[{teamId:'home',players:['甲改名','丙']}],'replace');
    const local=await client.getRosters();assert.equal(local.revision,before+1);
    assert.deepEqual(local.tournaments[0].teams[0].players.map(p=>p.name),['甲改名','丙']);
    assert.equal(local.tournaments[0].teams[0].players[0].id,'a');
    assert.equal(local.tournaments[0].teams[0].players[0].legacy_key,'original-key');
    assert.deepEqual(await (await fetch(base+'/data/default-rosters.json')).json(),normalizeRosterSnapshot(local));
    assert.equal((await fetch(base+'/api/rosters',{headers:{Origin:'http://untrusted.example'}})).status,403);
    assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(2*1024*1024+1)})).status,413);
    const health=await (await fetch(base+'/health')).json();assert.deepEqual(health,{ok:true,databaseBound:true,adminConfigured:true});
    await client.logout();await assert.rejects(api.createPlayer('home','未授权'),error=>error.status===401);
    await close(server);server=null;
    // A newer seed on disk must never overwrite an existing local database.
    await writeFile(seedFile,JSON.stringify({...seed,revision:1000}));
    server=await startCampusServer(env);
    const restarted=new RosterClient(`http://127.0.0.1:${server.address().port}`,{storage:null});
    assert.deepEqual(await restarted.getRosters(),local);
  }finally{if(server)await close(server);await rm(temporary,{recursive:true,force:true});}
});

test('campus database refuses unseeded initialization and rolls back invalid snapshots',async()=>{
  const temporary=await mkdtemp(path.join(tmpdir(),'match-editor-campus-db-'));
  try{
    await mkdir(path.join(temporary,'db'));
    const file=path.join(temporary,'db/rosters.sqlite'),seedFile=path.join(temporary,'seed.json');
    await assert.rejects(openDatabase(file),/SEED_FILE/);
    const invalid=structuredClone(seed);invalid.tournaments[0].teams[0].players[1].legacy_key='original-key';
    await writeFile(seedFile,JSON.stringify(invalid));await assert.rejects(openDatabase(file,{seedFile}),/UNIQUE/);
    await writeFile(seedFile,JSON.stringify(seed));const db=await openDatabase(file,{seedFile});
    assert.equal((await db.prepare('SELECT revision FROM roster_state').first()).revision,7);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM players').first()).n,2);db.close();
  }finally{await rm(temporary,{recursive:true,force:true});}
});
