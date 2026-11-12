import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/worker-fixture.mjs';
import {RosterClient} from '../src/api-client.mjs';

async function setup(){
  const f=await fixture(),t=await f.api.createTournament('导入测试杯'),other=await f.api.createTournament('另一赛事');
  const team=await f.api.createTeam(t.id,'红队'),away=await f.api.createTeam(other.id,'另一队');
  const a=await f.api.createPlayer(team.id,'甲'),b=await f.api.createPlayer(team.id,'乙');
  f.sqlite.prepare('UPDATE players SET legacy_key=? WHERE id=?').run('original-key',a.id);
  return {...f,t,other,team,away,a,b};
}

test('bulk registration merge and replacement are atomic and retain matching player IDs and legacy keys',async()=>{
  const f=await setup();
  try{
    const before=(await f.client.getRosters()).revision;
    const result=await f.api.importRegistration(f.t.id,[{teamId:f.team.id,players:['甲','丙']},{name:'蓝队',players:['丁']}],'merge');
    assert.equal(result.revision,before+1);assert.deepEqual(result.counts,{teams:2,newTeams:1,added:2,kept:1,removed:0});
    let snapshot=await f.client.getRosters(),teams=snapshot.tournaments.find(t=>t.id===f.t.id).teams;
    const home=teams.find(t=>t.id===f.team.id);assert.deepEqual(home.players.map(p=>p.name),['甲','乙','丙']);
    assert.equal(home.players[0].id,f.a.id);assert.equal(home.players[0].legacy_key,'original-key');
    const addedId=home.players[2].id,blueId=teams.find(t=>t.name==='蓝队').id;
    await f.api.importRegistration(f.t.id,[{teamId:f.team.id,players:['丙','甲']}],'replace');
    snapshot=await f.client.getRosters();teams=snapshot.tournaments.find(t=>t.id===f.t.id).teams;
    assert.deepEqual(teams[0].players.map(p=>[p.id,p.name]),[[addedId,'丙'],[f.a.id,'甲']]);
    assert.equal(teams[0].players[1].legacy_key,'original-key');
    assert.equal(f.sqlite.prepare('SELECT id FROM players WHERE id=?').get(f.b.id),undefined);
    assert.equal(teams.find(t=>t.id===blueId).players[0].name,'丁');
    assert.equal(snapshot.tournaments.find(t=>t.id===f.other.id).teams[0].id,f.away.id);
    const repeated=await f.api.importRegistration(f.t.id,[{teamId:f.team.id,players:['丙','甲']}],'merge');
    assert.equal(repeated.counts.added,0);
  }finally{f.sqlite.close();}
});

test('bulk registration rejects unauthorized, stale, duplicate and cross-tournament writes without partial changes',async()=>{
  const f=await setup();
  try{
    const before=await f.client.getRosters();
    const anon=new RosterClient('https://api.example',{storage:null,fetcher:f.fetcher});
    await assert.rejects(anon.request('/api/admin/import',{method:'POST',body:{tournamentId:f.t.id,teams:[{name:'不允许',players:['甲']}]},write:true}),e=>e.status===401);
    for(const teams of [
      [{name:'未提交的新队',players:['丁']},{teamId:f.away.id,players:['戊']}],
      [{name:'未提交的新队',players:['丁']},{teamId:f.team.id,players:['戊','戊']}],
      [{teamId:f.team.id,players:['丁']},{teamId:f.team.id,players:['戊']}],
      [{name:'红队',players:['丁']}],
      [{teamId:f.team.id,players:['13800138000']}]
    ]){
      await assert.rejects(f.api.importRegistration(f.t.id,teams,'replace'),e=>e.status===400);
      assert.deepEqual(await f.client.getRosters(),before);
    }
    const stale=f.client.revision;await f.api.createPlayer(f.team.id,'并发新增');
    const after=await f.client.getRosters();f.client.revision=stale;
    await assert.rejects(f.api.importRegistration(f.t.id,[{teamId:f.team.id,players:['丁']},{name:'不应创建',players:['戊']}],'replace'),e=>e.status===409);
    assert.deepEqual(await f.client.getRosters(),after);
  }finally{f.sqlite.close();}
});

test('a database failure rolls the entire registration batch and revision back',async()=>{
  const f=await setup();
  try{
    const before=await f.client.getRosters();
    f.sqlite.exec("CREATE TRIGGER reject_test BEFORE INSERT ON players WHEN NEW.name='故障球员' BEGIN SELECT RAISE(ABORT,'forced test failure'); END");
    await assert.rejects(f.api.importRegistration(f.t.id,[{teamId:f.team.id,players:['甲','故障球员']},{name:'不应创建',players:['丁']}],'replace'),e=>e.status===503);
    assert.deepEqual(await f.client.getRosters(),before);
  }finally{f.sqlite.close();}
});
