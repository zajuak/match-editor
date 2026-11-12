import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {fixture,password} from './helpers/worker-fixture.mjs';
import {createAdminApi,escapeXML,readableError,validateName} from '../src/admin-api.mjs';
import {loadSharedRosters,loadDefaultRosters,readCachedRosters,mappedSnapshot,ROSTER_CACHE_KEY} from '../src/rosters.mjs';
import * as core from '../src/core.mjs';
import {readRegistrationFiles} from '../src/registration-import.mjs';
import {planRegistrationImport} from '../src/registration-plan.mjs';
import {registrationFile,zip} from './helpers/registration-fixture.mjs';

async function domFor(file){
  const dom=new JSDOM(await readFile(new URL(`../src/${file}`,import.meta.url),'utf8'),{url:`https://zajuak.github.io/match-editor/${file}`});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  return dom;
}
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.ok(predicate(),'UI operation did not reach the expected state');}
const submit=(window,form)=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
const change=(window,input,value)=>{input.value=value;input.dispatchEvent(new window.Event('change',{bubbles:true}));};
async function startAdmin(dom,f){
  const {window}=dom;
  const source=(await readFile(new URL('../src/admin.mjs',import.meta.url),'utf8')).replace(/^import .+;\n/gm,'');
  new Function('rosterClient','loadSharedRosters','createAdminApi','escapeXML','readableError','validateName','readRegistrationFiles','planRegistrationImport','document','window','requestAnimationFrame','setTimeout','clearTimeout',source)(()=>f.client,client=>loadSharedRosters(client,{storage:window.localStorage}),createAdminApi,escapeXML,readableError,validateName,(files,tournament)=>readRegistrationFiles(files,tournament,{unzip:zip.unzipSync,Parser:window.DOMParser}),planRegistrationImport,window.document,window,cb=>cb(),window.setTimeout.bind(window),window.clearTimeout.bind(window));
}

test('admin DOM login, add, rename, reorder, delete and logout work against the Worker API',async()=>{
  const f=await fixture();await f.api.createTournament('测试杯',false);await f.client.logout();
  const dom=await domFor('admin.html'),{window}=dom,document=window.document,$=id=>document.getElementById(id);
  try{
    await startAdmin(dom,f);
    await until(()=>$('auth-view').hidden===false && !$('login-submit').disabled);
    $('password').value=password;submit(window,$('login-form'));
    await until(()=>$('admin-view').hidden===false && document.body.getAttribute('aria-busy')==='false' && $('tournament-list').textContent.includes('测试杯'));
    $('add-team').click();$('record-name').value='红队';submit(window,$('record-form'));
    await until(()=>!$('record-dialog').open && $('team-list').textContent.includes('红队') && document.body.getAttribute('aria-busy')==='false');
    $('add-player').click();$('record-name').value='甲';submit(window,$('record-form'));
    await until(()=>!$('record-dialog').open && $('player-list').textContent.includes('甲') && document.body.getAttribute('aria-busy')==='false');
    $('add-player').click();$('record-name').value='乙';submit(window,$('record-form'));
    await until(()=>!$('record-dialog').open && $('player-list').textContent.includes('乙') && document.body.getAttribute('aria-busy')==='false');
    const rows=()=>Array.from(document.querySelectorAll('#player-list .admin-record'));
    rows()[1].querySelector('[data-action="rename"]').click();$('record-name').value='<svg onload="bad()">';submit(window,$('record-form'));
    await until(()=>!$('record-dialog').open && $('player-list').textContent.includes('<svg onload="bad()">') && document.body.getAttribute('aria-busy')==='false');
    assert.equal($('player-list').querySelector('svg'),null);
    rows()[1].querySelector('[data-action="up"]').click();
    await until(()=>rows()[0].textContent.includes('<svg onload="bad()">') && document.body.getAttribute('aria-busy')==='false');
    window.confirm=()=>true;rows()[0].querySelector('[data-action="delete"]').click();
    await until(()=>rows().length===1 && document.body.getAttribute('aria-busy')==='false');
    $('logout').click();await until(()=>$('auth-view').hidden===false && $('logout').hidden);
    assert.equal(f.client.token,'');assert.equal($('password').value,'');
    const cache=readCachedRosters(window.localStorage);assert.ok(cache);assert.equal(cache.tournaments[0].teams[0].players.length,1);assert.ok(!JSON.stringify(cache).includes('token'));
  }finally{dom.window.close();f.sqlite.close();}
});

test('admin Word upload previews names, supports cancellation, merges and replaces only after confirmation',async()=>{
  const f=await fixture(),t=await f.api.createTournament('测试杯'),team=await f.api.createTeam(t.id,'红队');
  const kept=await f.api.createPlayer(team.id,'甲');await f.api.createPlayer(team.id,'乙');
  const dom=await domFor('admin.html'),{window}=dom,document=window.document,$=id=>document.getElementById(id);
  const attach=files=>{Object.defineProperty($('import-files'),'files',{configurable:true,value:files});$('import-files').dispatchEvent(new window.Event('change',{bubbles:true}));};
  const ready=()=>$('admin-view').hidden===false && document.body.getAttribute('aria-busy')==='false' && !$('import-registration').disabled;
  try{
    await startAdmin(dom,f);await until(ready);
    const before=await f.client.getRosters();
    $('import-registration').click();attach([registrationFile({names:['甲','丙']})]);
    await until(()=>!$('import-submit').disabled);
    assert.ok($('import-status').textContent.includes('新增 1 人'));assert.ok($('import-status').textContent.includes('移除 0 人'));
    assert.ok(!$('import-preview').textContent.includes('13800138000'));
    assert.deepEqual(await f.client.getRosters(),before);
    $('import-dialog').querySelector('[data-close-import]').click();assert.equal($('import-dialog').open,false);
    assert.deepEqual(await f.client.getRosters(),before);
    $('import-registration').click();attach([registrationFile({names:['甲','丙']}),registrationFile({team:'蓝队',names:['丁'],fileName:'蓝队.docx'})]);
    await until(()=>!$('import-submit').disabled);submit(window,$('import-form'));
    await until(()=>!$('import-dialog').open && ready() && $('player-list').textContent.includes('丙'));
    let snapshot=await f.client.getRosters();assert.deepEqual(snapshot.tournaments[0].teams[0].players.map(p=>p.name),['甲','乙','丙']);
    assert.equal(snapshot.tournaments[0].teams[1].name,'蓝队');
    $('import-registration').click();attach([registrationFile({names:['甲','戊']})]);
    await until(()=>!$('import-submit').disabled);change(window,$('import-mode'),'replace');
    assert.ok($('import-status').textContent.includes('移除 2 人'));assert.ok($('import-preview').textContent.includes('将移除：乙、丙'));
    submit(window,$('import-form'));await until(()=>!$('import-dialog').open && ready() && $('player-list').textContent.includes('戊'));
    snapshot=await f.client.getRosters();assert.deepEqual(snapshot.tournaments[0].teams[0].players.map(p=>p.name),['甲','戊']);
    assert.equal(snapshot.tournaments[0].teams[0].players[0].id,kept.id);
    assert.equal(readCachedRosters(window.localStorage).revision,snapshot.revision);
    $('import-registration').click();attach([registrationFile({names:['甲','甲']})]);
    await until(()=>$('import-error').textContent.includes('重复姓名'));assert.equal($('import-submit').disabled,true);
    assert.deepEqual(await f.client.getRosters(),snapshot);
  }finally{window.close();f.sqlite.close();}
});

test('editor DOM uses static rosters without backend calls, preserves drafts and supports explicit updates',async()=>{
  const f=await fixture(),t=await f.api.createTournament('测试杯',false),home=await f.api.createTeam(t.id,'红队'),away=await f.api.createTeam(t.id,'蓝队'),p=await f.api.createPlayer(home.id,'张三');
  const saved={version:3,records:[{id:p.id,tournamentId:t.id,teamId:home.id,tournament:'测试杯',team:'红队',name:'张三',number:''}],numberHistory:{},match:{...core.blankMatch(),tournament:'测试杯',tournamentId:t.id,home:'红队',away:'蓝队',teamIds:{home:home.id,away:away.id},title:'测试杯',events:[{id:'goal',time:'12',type:'进球',side:'home',playerId:p.id}]}};
  await f.api.renameTournament(t.id,'新赛事');await f.api.renameTeam(home.id,'新红队');await f.api.renamePlayer(p.id,'新张三');
  const snapshot=await f.client.getRosters();let backendCalls=0;
  const dom=await domFor('index.html'),{window}=dom,document=window.document,$=id=>document.getElementById(id),downloads=[];
  try{
    window.localStorage.setItem('junkai-match-editor-v1',JSON.stringify(saved));
    window.HTMLAnchorElement.prototype.click=function(){};
    const source=await readFile(new URL('../src/editor.mjs',import.meta.url),'utf8');
    const imported=source.match(/^import \{(.+)\} from '.\/core.mjs';/)[1].split(',').map(part=>part.trim().split(' as '));
    const names=imported.map(p=>p[1]||p[0]),values=imported.map(p=>core[p[0]]);
    class TestURL extends URL{static createObjectURL(blob){downloads.push(blob);return 'blob:test';}static revokeObjectURL(){}}
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...names,'loadSharedRosters','loadDefaultRosters','readCachedRosters','mappedSnapshot','ROSTER_CACHE_KEY','rosterClient','document','window','localStorage','confirm','fetch','URL','setTimeout','clearTimeout',source.replace(/^import .+;\n/gm,''))(...values,client=>loadSharedRosters(client,{storage:window.localStorage}),()=>loadDefaultRosters({storage:window.localStorage,fetcher:async()=>Response.json(snapshot)}),()=>readCachedRosters(window.localStorage),mappedSnapshot,ROSTER_CACHE_KEY,()=>{backendCalls++;return f.client;},document,window,window.localStorage,()=>true,async()=>({ok:false}),TestURL,window.setTimeout.bind(window),window.clearTimeout.bind(window));
    assert.equal(backendCalls,0);
    assert.equal($('home-team').value,home.id);assert.equal($('tournament').value,t.id);assert.equal($('match-title').value,'新赛事');
    assert.ok($('poster').textContent.includes('新张三'));assert.equal($('score').textContent,'1 : 0');
    $('add-event').click();change(window,$('event-type'),'两黄');
    assert.equal($('event-player').options[1].textContent,'领队');change(window,$('event-player'),core.TEAM_LEADER);$('event-time').value='20';submit(window,$('event-form'));
    assert.equal($('event-dialog').open,false);assert.ok($('poster').textContent.includes('领队'));
    $('download-svg').click();assert.equal(downloads.length,1);const svg=await downloads[0].text();assert.ok(svg.includes('新张三'));assert.ok(svg.includes('领队'));assert.ok(!svg.includes('首发阵容'));
    const restored=JSON.parse(window.localStorage.getItem('junkai-match-editor-v1'));assert.equal(restored.match.events.length,2);assert.equal(restored.match.events[1].recipient,'leader');
    await f.api.renameTeam(home.id,'再次改名');$('sync-rosters').click();
    await until(()=>!$('sync-rosters').disabled);assert.equal(backendCalls,1);assert.ok($('poster').textContent.includes('再次改名'));
    f.client.getRosters=async()=>{throw new Error('Backend unavailable');};$('sync-rosters').click();
    await until(()=>!$('sync-rosters').disabled);assert.equal($('score').textContent,'1 : 0');assert.equal($('download-svg').disabled,false);assert.equal(JSON.parse(window.localStorage.getItem('junkai-match-editor-v1')).match.events.length,2);
    const newer=structuredClone(readCachedRosters(window.localStorage));newer.revision++;newer.tournaments[0].teams.find(team=>team.id===home.id).name='后台标签页改名';
    window.localStorage.setItem(ROSTER_CACHE_KEY,JSON.stringify(newer));window.dispatchEvent(new window.Event('pageshow'));
    assert.ok($('poster').textContent.includes('后台标签页改名'));assert.equal(backendCalls,2);
  }finally{dom.window.close();f.sqlite.close();}
});
