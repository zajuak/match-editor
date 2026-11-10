import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDefaultRosters,cacheSharedRosters,readCachedRosters,normalizeRosterSnapshot,ROSTER_CACHE_KEY} from '../src/rosters.mjs';
const snapshot=(revision,name='张三')=>({revision,tournaments:[{id:'t',name:'杯赛',lineups:false,teams:[{id:'team',name:'红队',players:[{id:'p',name,legacy_key:'old-id'}]}]}]});
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};}

test('default roster loading fetches only the packaged snapshot without a backend client',async()=>{
  const calls=[],data=await loadDefaultRosters({storage:storage(),fetcher:async url=>{calls.push(String(url));return Response.json(snapshot(1));}});
  assert.equal(calls.length,1);assert.ok(calls[0].includes('/data/default-rosters.json'));assert.ok(!calls[0].includes('workers.dev'));
  assert.equal(data.records[0].id,'p');assert.equal(data.tournaments[0].lineups,false);assert.equal(data.revision,1);
});

test('newer local admin data wins over a published older default and does not resurrect deleted players',async()=>{
  const store=storage(),latest=snapshot(3);latest.tournaments[0].teams[0].players=[];cacheSharedRosters(latest,store);
  const data=await loadDefaultRosters({storage:store,fetcher:async()=>Response.json(snapshot(1))});
  assert.equal(data.revision,3);assert.equal(data.records.length,0);assert.equal(readCachedRosters(store).revision,3);
  const next=await loadDefaultRosters({storage:store,fetcher:async()=>Response.json(snapshot(4,'新张三'))});assert.equal(next.revision,4);assert.equal(next.records[0].name,'新张三');
});

test('cached rosters keep the editor usable when static fetching fails; no cache gives a useful error',async()=>{
  const store=storage();cacheSharedRosters(snapshot(2),store);
  const data=await loadDefaultRosters({storage:store,fetcher:async()=>{throw new Error('offline');}});assert.equal(data.records[0].name,'张三');
  await assert.rejects(loadDefaultRosters({storage:null,fetcher:async()=>({ok:false})}),/默认名单读取失败/);
});

test('invalid cache or disabled storage cannot block valid static rosters',async()=>{
  const store=storage();store.setItem(ROSTER_CACHE_KEY,'broken');assert.equal(readCachedRosters(store),null);
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const data=await loadDefaultRosters({storage:blocked,fetcher:async()=>Response.json(snapshot(1))});assert.equal(data.records.length,1);
});

test('published and cached snapshots whitelist public roster fields and reject invalid revisions',()=>{
  const input=snapshot(1);input.token='secret';input.tournaments[0].teams[0].players[0].phone='private';
  const clean=normalizeRosterSnapshot(input);assert.ok(!JSON.stringify(clean).includes('secret'));assert.ok(!JSON.stringify(clean).includes('phone'));
  assert.equal(clean.tournaments[0].teams[0].players[0].legacy_key,'old-id');
  assert.throws(()=>normalizeRosterSnapshot({...input,revision:-1}),/版本/);
});
