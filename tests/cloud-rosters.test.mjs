import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {blankMatch,createPlayerEvents,key,matchNumber,playerId,previousNumber,rememberNumber,restoreState,reconcileOfficialDraft,setGoalkeeper,setMatchNumber} from '../src/core.mjs';
import {mapSharedRosters} from '../src/rosters.mjs';
import {buildSeedPayload,assertExpectedSeed} from '../scripts/import-rosters.mjs';
import {publicRuntimeConfig,renderRuntimeConfig} from '../scripts/runtime-config.mjs';

const cloudFixture=()=>[
  {id:'tournament-b',name:'第二赛事',lineups:false,position:1,teams:[]},
  {id:'tournament-a',name:'杯赛',lineups:true,position:0,teams:[
    {id:'team-away',name:'蓝队',position:1,players:[{id:'player-away',name:'王五',position:0,legacy_key:key('杯赛','蓝队','王五')}]},
    {id:'team-empty',name:'空队',position:2,players:[]},
    {id:'team-home',name:'红队',position:0,players:[{id:'player-home',name:'张三',position:0,legacy_key:key('杯赛','红队','张三')}]}
  ]}
];

test('shared roster mapping keeps stable IDs, metadata, empty teams and display order',()=>{
  const {records,tournaments}=mapSharedRosters(cloudFixture());
  assert.deepEqual(tournaments.map(t=>t.name),['杯赛','第二赛事']);
  assert.deepEqual(tournaments[0].teams.map(t=>t.name),['红队','蓝队','空队']);
  assert.equal(tournaments[1].lineups,false);assert.equal(tournaments[1].teams.length,0);
  assert.deepEqual(records.map(r=>r.id),['player-home','player-away']);
  assert.equal(records[0].tournamentId,'tournament-a');assert.equal(records[0].teamId,'team-home');assert.equal(records[0].number,'');
  assert.throws(()=>mapSharedRosters([{id:'t',name:'',teams:[]}]),/赛事名称/);
});

test('v2 natural-key drafts migrate to UUIDs and survive later tournament, team and player renames',()=>{
  const oldRecords=[{tournament:'杯赛',team:'红队',name:'张三',number:''},{tournament:'杯赛',team:'蓝队',name:'王五',number:''}],oldId=playerId(oldRecords[0]);
  const match={...blankMatch(),tournament:'杯赛',title:'杯赛',home:'红队',away:'蓝队'};match.starters.home=[oldId];
  setGoalkeeper(match,oldRecords,'home',oldId);setMatchNumber(match,oldRecords,'home',oldId,'7');match.events=createPlayerEvents('进球','12','home',[oldId],match,oldRecords);
  const history=rememberNumber({},oldId,'previous','9'),saved=restoreState(JSON.parse(JSON.stringify({version:2,records:oldRecords,match,numberHistory:history})));
  const cloud=mapSharedRosters(cloudFixture()),migrated=reconcileOfficialDraft(saved.match,saved.numberHistory,cloud.records,cloud.tournaments);
  assert.equal(migrated.match.tournamentId,'tournament-a');assert.deepEqual(migrated.match.teamIds,{home:'team-home',away:'team-away'});
  assert.deepEqual(migrated.match.starters.home,['player-home']);assert.equal(migrated.match.goalkeepers.home,'player-home');assert.equal(migrated.match.events[0].playerId,'player-home');
  assert.equal(matchNumber(migrated.match,'home','player-home'),'7');assert.equal(previousNumber(migrated.numberHistory,'player-home','next'),'9');
  const renamedRows=structuredClone(cloudFixture());renamedRows[1].name='新赛事';renamedRows[1].teams[2].name='新红队';renamedRows[1].teams[2].players[0].name='新张三';
  const renamed=mapSharedRosters(renamedRows),next=reconcileOfficialDraft(migrated.match,migrated.numberHistory,renamed.records,renamed.tournaments).match;
  assert.equal(next.tournament,'新赛事');assert.equal(next.title,'新赛事');assert.equal(next.home,'新红队');assert.deepEqual(next.starters.home,['player-home']);assert.equal(next.events[0].playerId,'player-home');
});

test('deleted cloud teams remove dependent draft events while empty existing teams remain selectable',()=>{
  const cloud=mapSharedRosters(cloudFixture()),match={...blankMatch(),tournament:'杯赛',tournamentId:'tournament-a',home:'空队',away:'蓝队',teamIds:{home:'team-empty',away:'team-away'}};
  match.events=[{id:'own',time:'12',side:'away',type:'乌龙',teamRole:'scoring'}];
  const retained=reconcileOfficialDraft(match,{},cloud.records,cloud.tournaments).match;assert.equal(retained.home,'空队');assert.equal(retained.events.length,1);
  const rows=structuredClone(cloudFixture());rows[1].teams=rows[1].teams.filter(t=>t.id!=='team-away');
  const nextCloud=mapSharedRosters(rows),removed=reconcileOfficialDraft(retained,{},nextCloud.records,nextCloud.tournaments).match;
  assert.equal(removed.away,'');assert.equal(removed.teamIds.away,'');assert.equal(removed.events.length,0);
});

test('seed payload matches all published players and retains every legacy key',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../src/data/manifest.json',import.meta.url),'utf8'));
  const documents=await Promise.all(manifest.tournaments.map(async t=>JSON.parse(await readFile(new URL(`../src/data/${t.roster}`,import.meta.url),'utf8'))));
  const payload=assertExpectedSeed(buildSeedPayload(manifest,documents));
  assert.equal(new Set(payload.players.map(p=>p.legacy_key)).size,626);assert.equal(payload.tournaments[1].lineups,false);
});

test('public runtime config rejects secrets and emits only publishable values',()=>{
  const environment={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'publishable'};
  assert.deepEqual(publicRuntimeConfig(environment),{url:environment.SUPABASE_URL,key:'publishable'});
  assert.ok(!renderRuntimeConfig(environment).includes('service_role'));
  assert.throws(()=>publicRuntimeConfig({...environment,SUPABASE_PUBLISHABLE_KEY:'sb_secret_bad'}),/不能包含/);
  assert.throws(()=>publicRuntimeConfig({}, {required:true}),/构建需要/);
});


test('deleted UUIDs never attach drafts to a newly created team or tournament with the same name',()=>{
  const cloud=mapSharedRosters(cloudFixture());
  const match={...blankMatch(),tournament:'杯赛',tournamentId:'deleted-tournament',home:'红队',away:'蓝队',teamIds:{home:'team-home',away:'team-away'}};
  match.events=[{id:'e',type:'乌龙',teamRole:'scoring',time:'12',side:'home'}];
  const reset=reconcileOfficialDraft(match,{},cloud.records,cloud.tournaments).match;
  assert.equal(reset.events.length,0);assert.equal(reset.home,'');
  match.tournamentId='tournament-a';match.teamIds.home='deleted-team';
  const next=reconcileOfficialDraft(match,{},cloud.records,cloud.tournaments).match;
  assert.equal(next.home,'');assert.equal(next.events.length,0);
});

test('v3 cloud UUIDs and admin-defined names are not overwritten by old static aliases',()=>{
  const records=[{id:'cloud-player',tournamentId:'cloud-t',teamId:'cloud-team',tournament:'2026年新生杯男子足球赛',team:'法学院',name:'申宇颢',number:''}];
  const match={...blankMatch(),tournament:records[0].tournament,tournamentId:'cloud-t',home:'法学院',teamIds:{home:'cloud-team',away:''}};
  match.starters.home=['cloud-player'];setMatchNumber(match,records,'home','cloud-player','7');
  const saved=restoreState({version:3,records,match,numberHistory:{}});
  assert.equal(saved.records[0].id,'cloud-player');assert.equal(saved.records[0].team,'法学院');assert.equal(saved.records[0].name,'申宇颢');
  assert.deepEqual(saved.match.starters.home,['cloud-player']);assert.equal(matchNumber(saved.match,'home','cloud-player'),'7');
});

test('JWT service-role and user tokens cannot enter public runtime config',()=>{
  const jwt=role=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.sig';
  for(const role of ['service_role','authenticated'])assert.throws(()=>publicRuntimeConfig({SUPABASE_PUBLISHABLE_KEY:jwt(role)}),/只允许/);
  assert.equal(publicRuntimeConfig({SUPABASE_PUBLISHABLE_KEY:jwt('anon')}).key,jwt('anon'));
});


test('first cloud migration preserves old drafts even if admins already renamed all roster names',()=>{
  const oldId=key('杯赛','红队','张三'),match={...blankMatch(),tournament:'杯赛',title:'杯赛',home:'红队',away:'蓝队'};
  match.starters.home=[oldId];match.numbers.home[oldId]='7';match.events=[{id:'goal',time:'12',type:'进球',side:'home',playerId:oldId}];
  const rows=cloudFixture();rows[1].name='新赛事';rows[1].teams[2].name='新红队';rows[1].teams[2].players[0].name='新张三';
  const cloud=mapSharedRosters(rows),next=reconcileOfficialDraft(match,{},cloud.records,cloud.tournaments).match;
  assert.equal(next.tournament,'新赛事');assert.equal(next.home,'新红队');assert.deepEqual(next.starters.home,['player-home']);
  assert.equal(next.events[0].playerId,'player-home');assert.equal(next.numbers.home['player-home'],'7');
});
