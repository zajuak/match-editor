import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDelimited,compareTimes,parseBatch,calculateScore,renderPoster,blankMatch,playerLabel,playerId,matchNumber,setMatchNumber,previousNumber,rememberNumber,restoreState,missingNumbers,createPlayerEvents,reconcileOfficialDraft,parseCustomStarters,CUSTOM_TOURNAMENT,isGoalkeeper,setGoalkeeper,missingGoalkeepers,normalizeRosterRecord} from '../src/core.mjs';
import {registrationTableToRecords,loadOfficialRosters,loadOfficialData} from '../src/importers.mjs';
import {readFile} from 'node:fs/promises';
const records=[
  {tournament:'杯赛',team:'红队',number:'',name:'张三'},
  {tournament:'杯赛',team:'红队',number:'',name:'李四'},
  {tournament:'杯赛',team:'蓝队',number:'',name:'王五'}
];
const [zhang,li,wang]=records.map(playerId);
function readyMatch(){const match={...blankMatch(),tournament:'杯赛',home:'红队',away:'蓝队'};setMatchNumber(match,records,'home',zhang,'1');setMatchNumber(match,records,'home',li,'7');setMatchNumber(match,records,'away',wang,'10');return match;}

test('each side selects exactly one goalkeeper from its own starters',()=>{
  const match=readyMatch();match.starters={home:[zhang,li],away:[wang]};
  assert.deepEqual(missingGoalkeepers(match,records),['红队','蓝队']);
  setGoalkeeper(match,records,'home',zhang);setGoalkeeper(match,records,'away',wang);
  assert.deepEqual(missingGoalkeepers(match,records),[]);
  setGoalkeeper(match,records,'home',li);assert.equal(isGoalkeeper(match,'home',zhang),false);assert.equal(isGoalkeeper(match,'home',li),true);
  assert.throws(()=>setGoalkeeper(match,records,'home',wang),/本队首发/);
  match.starters.home=[zhang];assert.throws(()=>setGoalkeeper(match,records,'home',li),/本队首发/);
  assert.deepEqual(missingGoalkeepers(match,records),['红队']);
});

test('unnumbered goalkeepers can appear in lineups and events while outfield numbers remain required',()=>{
  const match=readyMatch();match.starters={home:[zhang,li],away:[wang]};
  setGoalkeeper(match,records,'home',zhang);setGoalkeeper(match,records,'away',wang);
  setMatchNumber(match,records,'home',zhang,'');setMatchNumber(match,records,'away',wang,'');
  match.events=parseBatch('12,红队,张三','黄牌',match,records);
  assert.deepEqual(missingNumbers(match,records),[]);assert.equal(playerLabel(records,match,match.events[0]),'GK 张三(GK)');
  setMatchNumber(match,records,'home',li,'');assert.deepEqual(missingNumbers(match,records),['红队 · 李四']);
  setGoalkeeper(match,records,'home',li);assert.deepEqual(missingNumbers(match,records),['红队 · 张三']);
});

test('goalkeeper numbers remain optional, unique when supplied, and zero is displayed correctly',()=>{
  const match=readyMatch();match.starters={home:[zhang,li],away:[wang]};setGoalkeeper(match,records,'home',zhang);
  assert.throws(()=>setMatchNumber(match,records,'home',zhang,'7'),/已有球员/);
  setMatchNumber(match,records,'home',zhang,'0');
  assert.equal(playerLabel(records,match,{side:'home',playerId:zhang}),'0 张三(GK)');
});

test('poster marks both numbered and unnumbered goalkeepers',()=>{
  const match=readyMatch();match.starters={home:[zhang,li],away:[wang]};setGoalkeeper(match,records,'home',zhang);setGoalkeeper(match,records,'away',wang);
  setMatchNumber(match,records,'home',zhang,'');
  const svg=renderPoster(match,records);assert.ok(svg.includes('>GK</text>'));assert.ok(svg.includes('>张三(GK)</text>'));assert.ok(svg.includes('>王五(GK)</text>'));assert.ok(!svg.includes('（门将）'));assert.ok(svg.includes('>10</text>'));
});

test('goalkeepers lead both lineups while other starters keep their selection order',()=>{
  const extra={tournament:'杯赛',team:'蓝队',number:'',name:'赵六'},all=[...records,extra],zhao=playerId(extra);
  const match=readyMatch();match.starters={home:[li,zhang],away:[zhao,wang]};setGoalkeeper(match,all,'home',zhang);setGoalkeeper(match,all,'away',wang);
  const before=JSON.stringify(match.starters),svg=renderPoster(match,all);
  assert.ok(svg.indexOf('>张三(GK)</text>')<svg.indexOf('>李四</text>'));assert.ok(svg.indexOf('>王五(GK)</text>')<svg.indexOf('>赵六</text>'));
  assert.equal(JSON.stringify(match.starters),before);
  setGoalkeeper(match,all,'home',li);const changed=renderPoster(match,all);assert.ok(changed.indexOf('>李四(GK)</text>')<changed.indexOf('>张三</text>'));
});

test('poster title lines are centered',()=>{
  const match=readyMatch();match.title='2026年新生杯';
  assert.match(renderPoster(match,records),/<text x="400" y="44"[^>]*text-anchor="middle"[^>]*>2026年新生杯<\/text>/);
  match.title='甲'.repeat(40);
  const svg=renderPoster(match,records);assert.match(svg,/<text x="400" y="72"[^>]*text-anchor="middle"/);
});

test('goalkeepers persist across reloads and are cleared if no longer valid starters',()=>{
  const match=readyMatch();match.starters={home:[zhang],away:[wang]};setGoalkeeper(match,records,'home',zhang);setGoalkeeper(match,records,'away',wang);
  const saved=restoreState(JSON.parse(JSON.stringify({version:2,records,match,numberHistory:{}})));
  assert.deepEqual(saved.match.goalkeepers,{home:zhang,away:wang});
  saved.match.starters.home=[];const reconciled=reconcileOfficialDraft(saved.match,{},records);assert.equal(reconciled.match.goalkeepers.home,'');assert.equal(reconciled.match.goalkeepers.away,wang);
  const old={...match};delete old.goalkeepers;assert.deepEqual(restoreState({version:2,records,match:old}).match.goalkeepers,{home:'',away:''});
});

test('custom matches support a goalkeeper with only a name on each side',()=>{
  const home=parseCustomStarters('张三\n7 李四',CUSTOM_TOURNAMENT,'红队'),away=parseCustomStarters('王五',CUSTOM_TOURNAMENT,'蓝队'),custom=[...home,...away];
  const match={...blankMatch(),tournament:CUSTOM_TOURNAMENT,home:'红队',away:'蓝队'};
  for(const [side,roster] of [['home',home],['away',away]]){match.starters[side]=roster.map(playerId);for(const p of roster)setMatchNumber(match,custom,side,playerId(p),p.number);setGoalkeeper(match,custom,side,playerId(roster[0]));}
  assert.deepEqual(missingGoalkeepers(match,custom),[]);assert.deepEqual(missingNumbers(match,custom),[]);
});

test('delimited input supports quoted fields, BOM and Excel clipboard',()=>{
  assert.deepEqual(parseDelimited('\uFEFF赛事,球队,姓名\r\n杯赛,"院,队","张""三"'),[['赛事','球队','姓名'],['杯赛','院,队','张"三']]);
  assert.deepEqual(parseDelimited('姓名\n张三'),[['姓名'],['张三']]);
  assert.throws(()=>parseDelimited('姓名\n"张三'),/双引号/);
});

test('registration tables split both name columns and preserve a final left-only player',()=>{
  const header=['姓名','球员 身份','备注','是否 首发','号码','姓名','球员 身份','备注','是否 首发','号码'];
  const result=registrationTableToRecords([header,['张三','','','','','李四','','','',''],['王五','','','','','','','','','']],{tournament:'2026年新生杯男子足球赛',team:'红队'});
  assert.deepEqual(result.map(r=>r.name),['张三','李四','王五']);
  assert.ok(result.every(r=>r.tournament==='2026年新生杯男子足球赛' && r.team==='红队' && r.number===''));
  assert.throws(()=>registrationTableToRecords([['姓名'],['张三']],{tournament:'杯赛',team:'红队'}),/名单表格/);
  assert.throws(()=>registrationTableToRecords([header],{tournament:'杯赛',team:'红队'}),/没有球员/);
});

test('women futsal registration reads only player names from the single-column form',()=>{
  const header=['序号','球员姓名','球员身份','是否登场','球员号码','备注'];
  const result=registrationTableToRecords([header,['1','张三','自由球员','是','7','备注内容'],['2','','','','',''],['3','李四','普通球员','','8','']],{tournament:'女足北大杯',team:'元培'});
  assert.deepEqual(result.map(r=>[r.name,r.number]),[['张三',''],['李四','']]);
  assert.ok(result.every(r=>Object.keys(r).sort().join(',')==='name,number,sourceRow,team,tournament'));
});

test('custom starters accept names with optional numbers and reject duplicates or invalid input',()=>{
  const result=parseCustomStarters('01 张三\n李四\n\r\n0 王 五',CUSTOM_TOURNAMENT,'自定义红队');
  assert.deepEqual(result.map(r=>[r.number,r.name]),[['1','张三'],['','李四'],['0','王 五']]);
  assert.ok(result.every(r=>r.tournament===CUSTOM_TOURNAMENT && r.team==='自定义红队'));
  assert.throws(()=>parseCustomStarters('1 张三\n01 李四',CUSTOM_TOURNAMENT,'红队'),/已有球员使用 1 号/);
  assert.throws(()=>parseCustomStarters('张三\n张三',CUSTOM_TOURNAMENT,'红队'),/重复姓名/);
  assert.throws(()=>parseCustomStarters('1000 张三',CUSTOM_TOURNAMENT,'红队'),/0–999/);
  assert.throws(()=>parseCustomStarters('7',CUSTOM_TOURNAMENT,'红队'),/姓名/);
  assert.throws(()=>parseCustomStarters('',CUSTOM_TOURNAMENT,'红队'),/首发名单/);
  assert.throws(()=>parseCustomStarters('张三',CUSTOM_TOURNAMENT,''),/球队名称/);
});

test('numbers are per-match, permit zero, and reject duplicate or invalid numbers within a team',()=>{
  const match=readyMatch();
  assert.throws(()=>setMatchNumber(match,records,'home',li,'1'),/已有球员/);
  assert.equal(matchNumber(match,'home',li),'7');
  assert.equal(setMatchNumber(match,records,'home',li,'000'),'0');
  assert.equal(setMatchNumber(match,records,'away',wang,'1'),'1');
  assert.throws(()=>setMatchNumber(match,records,'home',zhang,'-1'),/整数/);
  assert.throws(()=>setMatchNumber(match,records,'home',zhang,'1.2'),/整数/);
});

test('last-used hint excludes the current match and new matches always start with blank numbers',()=>{
  const second=readyMatch();let history=rememberNumber({},zhang,'old','7');
  assert.equal(previousNumber(history,zhang,second.id),'7');
  history=rememberNumber(history,zhang,second.id,'9');
  assert.equal(previousNumber(history,zhang,second.id),'7');
  history=rememberNumber(history,zhang,second.id,'11');
  assert.equal(previousNumber(history,zhang,second.id),'7');
  const next=blankMatch();assert.equal(matchNumber(next,'home',zhang),'');assert.equal(previousNumber(history,zhang,next.id),'11');
  history=rememberNumber(history,zhang,second.id,'');assert.equal(previousNumber(history,zhang,next.id),'7');
});

test('numbers and history stay isolated between tournaments and teams',()=>{
  const other=[{tournament:'另一杯赛',team:'红队',name:'张三'},{tournament:'杯赛',team:'蓝队',name:'张三'}];
  const history=rememberNumber({},zhang,'old','7');
  for(const player of other)assert.equal(previousNumber(history,playerId(player),'new'),'');
});

test('changing a number keeps events and starters attached to the same player',()=>{
  const match=readyMatch();match.starters.home=[zhang];match.events=parseBatch('12,红队,1','进球',match,records);
  setMatchNumber(match,records,'home',zhang,'9');setMatchNumber(match,records,'home',li,'1');
  assert.equal(playerLabel(records,match,match.events[0]),'9 张三');assert.deepEqual(match.starters.home,[zhang]);
  const svg=renderPoster(match,records);assert.ok(svg.includes('9 张三'));assert.ok(svg.includes('>9</text>'));
});

test('batch resolves only current numbers, supports names before assigning numbers, and validates all rows',()=>{
  const match=readyMatch();assert.equal(parseBatch('12,红队,7','进球',match,records)[0].playerId,li);
  setMatchNumber(match,records,'home',li,'');assert.throws(()=>parseBatch('12,红队,7','进球',match,records),/不在/);
  assert.equal(parseBatch('12,红队,李四','进球',match,records)[0].playerId,li);
  assert.throws(()=>parseBatch('12,红队,张三\nabc,蓝队,王五','进球',match,records),/第 2 行/);
  assert.throws(()=>parseBatch('12,红队,张三,张三','换人',match,records),/不能相同/);
  assert.deepEqual(createPlayerEvents('换人','40+2','home',[zhang,li],match,records).map(e=>e.type),['换下','换上']);
});

test('exports identify missing numbers only for visible starters and event participants',()=>{
  const match=readyMatch();match.starters.home=[zhang];setMatchNumber(match,records,'home',zhang,'');
  assert.deepEqual(missingNumbers(match,records),['红队 · 张三']);
  match.showLineups=false;assert.deepEqual(missingNumbers(match,records),[]);
  match.events=createPlayerEvents('黄牌','12','home',[zhang],match,records);assert.deepEqual(missingNumbers(match,records),['红队 · 张三']);
});

test('v1 migration preserves old numbers, starters, events and same-name players',()=>{
  const saved={version:1,records:[{tournament:'杯赛',team:'红队',number:'01',name:'张三'},{tournament:'杯赛',team:'红队',number:'7',name:'张三'}],match:{tournament:'杯赛',home:'红队',away:'蓝队',starters:{home:['7'],away:[]},events:[{id:'old-event',time:'12',side:'home',number:'1',type:'进球'}]}};
  const migrated=restoreState(saved),first=migrated.records[0],second=migrated.records[1];
  assert.notEqual(first.id,second.id);assert.deepEqual(migrated.match.starters.home,[second.id]);
  assert.equal(playerLabel(migrated.records,migrated.match,migrated.match.events[0]),'1 张三');
  assert.equal(previousNumber(migrated.numberHistory,second.id,'next-match'),'7');
});

test('v2 state survives serialization, including the prior hint during a current number change',()=>{
  const match=readyMatch();let history=rememberNumber({},zhang,'previous','7');history=rememberNumber(history,zhang,match.id,'1');
  const restored=restoreState(JSON.parse(JSON.stringify({version:2,records,match,numberHistory:history})));
  assert.equal(matchNumber(restored.match,'home',zhang),'1');assert.equal(previousNumber(restored.numberHistory,zhang,restored.match.id),'7');
});

test('official rosters retain valid drafts and discard stale players, teams and history',()=>{
  const match=readyMatch(),stale='stale-player';match.starters.home=[zhang,stale];match.numbers.home[stale]='99';
  match.events=[...createPlayerEvents('进球','12','home',[zhang],match,records),{id:'stale',time:'13',side:'home',playerId:stale,type:'黄牌'}];
  let history=rememberNumber({},zhang,'old','8');history=rememberNumber(history,stale,'old','99');
  const result=reconcileOfficialDraft(match,history,records);
  assert.equal(result.match.id,match.id);assert.deepEqual(result.match.starters.home,[zhang]);
  assert.deepEqual(result.match.events.map(e=>e.playerId),[zhang]);assert.equal(result.match.numbers.home[stale],undefined);
  assert.equal(previousNumber(result.numberHistory,zhang,'next'),'8');assert.equal(result.numberHistory[stale],undefined);
  result.match.away='已删除球队';result.match.events.push({id:'away',time:'14',side:'away',playerId:wang,type:'进球'});
  const removedTeam=reconcileOfficialDraft(result.match,result.numberHistory,records);
  assert.equal(removedTeam.match.away,'');assert.deepEqual(removedTeam.match.starters.away,[]);assert.equal(removedTeam.match.events.some(e=>e.id==='away'),false);
});

test('an old demo tournament is replaced by the official tournament without losing official history',()=>{
  const old={...blankMatch(),tournament:'示例杯',home:'示例红队',away:'示例蓝队',title:'示例'};
  const history=rememberNumber({},zhang,'old','8');
  const result=reconcileOfficialDraft(old,history,records);
  assert.equal(result.match.tournament,'杯赛');assert.equal(result.match.title,'杯赛');assert.equal(result.match.home,'');
  assert.equal(previousNumber(result.numberHistory,zhang,result.match.id),'8');
});

test('stoppage sorting, scoring and poster escaping remain correct',()=>{
  assert.deepEqual(['点','41','40+100','40+2','40'].sort(compareTimes),['40','40+2','40+100','41','点']);
  assert.deepEqual(calculateScore([{type:'进球',side:'home',time:'1'},{type:'乌龙',side:'home',time:'2'},{type:'点球',side:'away',time:'点'}]),{home:1,away:1,shootout:{home:0,away:1}});
  const match=readyMatch();match.title='<script>&';match.starters={home:[li,zhang],away:[wang]};
  const svg=renderPoster(match,records);assert.ok(svg.includes('&lt;script&gt;&amp;'));assert.ok(!svg.includes('<script>'));
  assert.ok(svg.indexOf('>7</text>',svg.indexOf('首发阵容'))<svg.indexOf('>1</text>',svg.indexOf('首发阵容')));
});

test('published rosters load both tournaments without exposing DOCX fields',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    const path=new URL(String(url)).pathname.replace('/data/','');
    const body=await readFile(new URL(`../src/data/${path}`,import.meta.url));
    return new Response(body,{headers:{'content-type':'application/json'}});
  });
  const loaded=await loadOfficialRosters('https://roster.test/data/manifest.json');
  assert.equal(loaded.length,626);
  for(const [name,teams,players] of [['2026年新生杯男子足球赛',18,491],['2026-27北大杯女子足球赛',8,135]]){
    const roster=loaded.filter(r=>r.tournament===name);assert.equal(roster.length,players);assert.equal(new Set(roster.map(r=>r.team)).size,teams);
  }
  assert.ok(loaded.every(r=>r.number===''));
  const official=await loadOfficialData('https://roster.test/data/manifest.json');
  assert.deepEqual(official.tournaments,[{name:'2026年新生杯男子足球赛',lineups:true},{name:'2026-27北大杯女子足球赛',lineups:false}]);
  const published=JSON.parse(await readFile(new URL('../src/data/rosters/tournament-1.json',import.meta.url),'utf8'));
  const women=JSON.parse(await readFile(new URL('../src/data/rosters/tournament-2.json',import.meta.url),'utf8'));
  assert.ok([...published,...women].every(r=>Object.keys(r).sort().join(',')==='name,team'));
});

test('official loader rejects failed or invalid roster responses',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  await assert.rejects(loadOfficialRosters('https://roster.test/manifest.json'),/503/);
  globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('manifest.json')?{version:1,tournaments:[{name:'杯赛',roster:'names.json'}]}:[{team:'红队',name:''}]));
  await assert.rejects(loadOfficialRosters('https://roster.test/manifest.json'),/缺少姓名/);
});


test('competition without lineups exports events without starting goalkeepers or a lineup section',()=>{
  const match=readyMatch();match.lineupsEnabled=false;match.showLineups=true;match.starters.home=[zhang];
  setMatchNumber(match,records,'home',zhang,'');
  assert.deepEqual(missingGoalkeepers(match,records),[]);assert.deepEqual(missingNumbers(match,records),[]);
  match.events=createPlayerEvents('进球','12','home',[li],match,records);
  const svg=renderPoster(match,records);assert.ok(!svg.includes('首发阵容'));assert.ok(svg.includes('7 李四'));assert.equal(calculateScore(match.events).home,1);
  setMatchNumber(match,records,'home',li,'');assert.deepEqual(missingNumbers(match,records),['红队 · 李四']);
});

for(const [oldName,newName] of [['2026新生杯','2026年新生杯男子足球赛'],['2026-27五人制女足北大杯','2026-27北大杯女子足球赛'],['2026-27女足北大杯','2026-27北大杯女子足球赛']])test(`rename ${oldName} preserves draft relationships and custom titles`,()=>{
  const roster=[{tournament:oldName,team:'元培',name:'张三',number:''},{tournament:oldName,team:'医学',name:'李四',number:''}];
  const id=playerId(roster[0]),nextId=playerId({...roster[0],tournament:newName});
  const match={...blankMatch(),tournament:oldName,title:oldName,home:'元培',away:'医学',lineupsEnabled:false,showLineups:false};
  match.starters.home=[id];match.goalkeepers.home=id;
  setMatchNumber(match,roster,'home',id,'7');match.events=createPlayerEvents('进球','12','home',[id],match,roster);
  const saved={version:2,records:roster,match,numberHistory:rememberNumber({},id,'previous','9')};
  const restored=restoreState(saved),official=roster.map(p=>({...p,tournament:newName}));
  const reconciled=reconcileOfficialDraft(restored.match,restored.numberHistory,official);
  assert.equal(reconciled.match.tournament,newName);assert.equal(reconciled.match.title,newName);
  assert.deepEqual(reconciled.match.starters.home,[nextId]);assert.equal(reconciled.match.goalkeepers.home,nextId);
  assert.equal(reconciled.match.events[0].playerId,nextId);assert.equal(matchNumber(reconciled.match,'home',nextId),'7');
  assert.equal(previousNumber(reconciled.numberHistory,nextId,match.id),'9');assert.equal(calculateScore(reconciled.match.events).home,1);
  assert.equal(saved.match.tournament,oldName);
  saved.match.title='女足小组赛第一轮';assert.equal(restoreState(saved).match.title,'女足小组赛第一轮');
});


test('official team and player corrections retain draft relationships and stay within the men tournament',()=>{
  const tournament='2026年新生杯男子足球赛';
  for(const [team,name,nextTeam,nextName] of [['法学院','张三','法学','张三'],['外国语学院','张三','外院','张三'],['信息管理学院—历史学系联队','张三','信历','张三'],['经济学院','张三','经济','张三'],['生命科学学院','张三','生科','张三'],['数学','申宇颢','数学','申宇灏']]){
    const roster=[{tournament,team,name,number:''}],id=playerId(roster[0]),official=roster.map(normalizeRosterRecord),nextId=playerId(official[0]);
    const match={...blankMatch(),tournament,home:team,away:'城环',title:'小组赛'};
    match.starters.home=[id];setGoalkeeper(match,roster,'home',id);setMatchNumber(match,roster,'home',id,'7');
    match.events=createPlayerEvents('进球','12','home',[id],match,roster);
    const saved={version:2,records:roster,match,numberHistory:rememberNumber({},id,'last-match','9')};
    const restored=restoreState(saved),next=reconcileOfficialDraft(restored.match,restored.numberHistory,official);
    assert.equal(next.match.home,nextTeam);assert.equal(restored.records[0].name,nextName);
    assert.deepEqual(next.match.starters.home,[nextId]);assert.equal(next.match.goalkeepers.home,nextId);
    assert.equal(next.match.events[0].playerId,nextId);assert.equal(matchNumber(next.match,'home',nextId),'7');assert.equal(previousNumber(next.numberHistory,nextId,match.id),'9');
    assert.equal(saved.records[0].name,name);assert.equal(next.match.title,'小组赛');
    assert.equal(normalizeRosterRecord({...roster[0],tournament:CUSTOM_TOURNAMENT}).team,team);
  }
});

test('updated published men roster includes Chenghuan additions and requested spelling',async()=>{
  const roster=JSON.parse(await readFile(new URL('../src/data/rosters/tournament-1.json',import.meta.url),'utf8'));
  const names=roster.filter(p=>p.team==='城环').map(p=>p.name);assert.equal(names.length,28);
  for(const name of ['西绕彭措','阎帅彤','高晟越','高杰杨','黄恩来'])assert.ok(names.includes(name));
  assert.ok(roster.some(p=>p.team==='数学' && p.name==='申宇灏'));assert.ok(!roster.some(p=>p.name==='申宇颢'));
  for(const name of ['法学','外院','信历','经济','生科'])assert.ok(roster.some(p=>p.team===name));
  assert.ok(!roster.some(p=>['法学院','外国语学院','信息管理学院—历史学系联队','经济学院','生命科学学院'].includes(p.team)));
});
