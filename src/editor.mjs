import {TYPES,ICONS,CUSTOM_TOURNAMENT,escapeXML as esc,blankMatch,rosterFor,parseBatch,sortedEvents,calculateScore,playerLabel,renderPoster,playerId,matchNumber,previousNumber,rememberNumber,setMatchNumber,missingNumbers,restoreState,createPlayerEvents,createCustomEvents,parseCustomBatch,reconcileOfficialDraft,parseCustomStarters,isGoalkeeper,setGoalkeeper,missingGoalkeepers} from './core.mjs';
import {loadOfficialData} from './importers.mjs';
const $=id=>document.getElementById(id), storageKey='junkai-match-editor-v1';
let tournaments=[],records=[],match=blankMatch(),numberHistory={},lineupSide='home',editingId=null,pendingEvents=null,pendingCustom=null,svg='',icons={},draggedId=null,toastTimer,rostersReady=false,customDirty=false;
try {
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  ({records,match,numberHistory}=restoreState(saved));
} catch { $('save-status').textContent='暂时无法读取本地草稿，可继续编辑。'; }
function save() {
  if(!rostersReady && !isCustom())return;
  try{localStorage.setItem(storageKey,JSON.stringify({version:2,records,match,numberHistory}));$('save-status').textContent='比赛草稿与历史号码已保存到当前浏览器';}
  catch{$('save-status').textContent='浏览器存储不可用，请及时导出图片。';}
}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
const isCustom=()=>match.tournament===CUSTOM_TOURNAMENT;
const names=()=>[...new Set(records.filter(r=>r.tournament!==CUSTOM_TOURNAMENT).map(r=>r.tournament))];
const teams=()=>[...new Set(records.filter(r=>r.tournament===match.tournament).map(r=>r.team))];
const option=(value,label,disabled=false)=>`<option value="${esc(value)}"${disabled?' disabled':''}>${esc(label)}</option>`;
function fill(select,items,value,placeholder){select.innerHTML=(placeholder?option('',placeholder):'')+items.map(([v,l,d])=>option(v,l,d)).join('');select.value=value;}
function hasMatchWork(){return match.events.length || match.starters.home.length || match.starters.away.length || Object.values(match.numbers).some(numbers=>Object.values(numbers).some(Boolean));}
function hasWork(){return customDirty || hasMatchWork();}
function discardMatch(question){return !hasWork() || confirm(question+' 当前比赛的事件、首发与本场号码将清空，历史号码会保留。');}
function syncControls(){
  const custom=isCustom();
  match.lineupsEnabled=tournaments.find(t=>t.name===match.tournament)?.lineups!==false;
  if(!match.lineupsEnabled){match.showLineups=false;match.starters={home:[],away:[]};match.goalkeepers={home:'',away:''};}
  const lineups=match.lineupsEnabled;
  $('lineup-heading').textContent=lineups?'首发与本场号码':'本场号码';
  $('show-lineups-control').hidden=!lineups;$('goalkeeper-fields').hidden=!lineups;$('goalkeeper-hint').hidden=!lineups;
  $('lineup-hint').textContent=lineups?'每场填写球员号码，再勾选首发。下方显示上一次比赛的号码，点击“沿用”即可填入；新比赛不会自动沿用。守门员排在首位，其余首发按勾选顺序展示。':'从报名名单选择事件球员，并填写其本场号码。无需录入首发，赛果图不显示首发阵容；可参考并沿用上一次号码。';
  $('clear-lineup').hidden=!lineups;
  $('lineup-tabs').setAttribute('aria-label',lineups?'首发球队':'球队名单');
  $('preview-sync-hint').textContent=lineups?'首发、事件与比分同步更新':'事件与比分同步更新';
  fill($('tournament'),[...names().map(n=>[n,n]),[CUSTOM_TOURNAMENT,'自定义比赛']],match.tournament,'选择赛事');
  for(const side of ['home','away'])fill($(`${side}-team`),teams().map(n=>[n,n,n===match[side==='home'?'away':'home']]),match[side],side==='home'?'选择主队':'选择客队');
  $('official-team-selects').hidden=custom;$('custom-match-fields').hidden=!custom;$('lineup-editor').hidden=custom;
  $('match-title').value=match.title;$('show-lineups').checked=match.showLineups;
  if(custom){
    if(!customDirty){
      $('custom-home-name').value=match.home;$('custom-away-name').value=match.away;
      for(const side of ['home','away'])$(`custom-${side}-starters`).value=rosterFor(records,match,side).filter(p=>match.starters[side].includes(playerId(p))).map(p=>{const number=matchNumber(match,side,p);return `${number?number+' ':''}${p.name}`;}).join('\n');
    }
  }
  $('roster-summary').textContent='';$('roster-summary').hidden=true;
  $('download-svg').disabled=!rostersReady && !custom;$('download-png').disabled=!rostersReady && !custom;
  renderLineup();renderEvents();render();
}
function renderLineup(){
  for(const side of ['home','away']){
    const starters=rosterFor(records,match,side).filter(p=>match.starters[side].includes(playerId(p)));
    fill($(`${side}-goalkeeper`),starters.map(p=>[playerId(p),`${matchNumber(match,side,p)?matchNumber(match,side,p)+' ':''}${p.name}`]),match.goalkeepers[side],starters.length?'选择一名首发守门员':'先选择首发球员');
    $(`${side}-goalkeeper`).disabled=!starters.length;
  }
  for(const side of ['home','away']){
    $(`${side}-count`).textContent=`${match.lineupsEnabled===false?rosterFor(records,match,side).length:match.starters[side].length} 人`;
    $(`${side}-lineup-tab`).firstChild.textContent=(match[side]|| (side==='home'?'主队':'客队'))+' ';
    $(`${side}-lineup-tab`).classList.toggle('active',lineupSide===side);$(`${side}-lineup-tab`).setAttribute('aria-selected',String(lineupSide===side));
  }
  $('lineup-panel').setAttribute('aria-labelledby',`${lineupSide}-lineup-tab`);
  const roster=rosterFor(records,match,lineupSide),query=$('lineup-search').value.trim().toLowerCase();
  const visible=roster.filter(p=>`${matchNumber(match,lineupSide,p)} ${p.name}`.toLowerCase().includes(query));
  $('lineup-count').textContent=`名单 ${roster.length} 人${match.lineupsEnabled===false?'':` / 首发 ${match.starters[lineupSide].length} 人`}`;
  $('lineup-list').innerHTML=visible.length?visible.map(p=>{
    const id=playerId(p),last=previousNumber(numberHistory,id,match.id),number=matchNumber(match,lineupSide,p),keeper=isGoalkeeper(match,lineupSide,p);
    return `<div class="player-row"><label class="player-check">${match.lineupsEnabled===false?'':`<input type="checkbox" value="${esc(id)}" aria-label="${esc(p.name)} 首发"${match.starters[lineupSide].includes(id)?' checked':''}>`}<span>${esc(p.name)}${keeper?'（门将）':''}</span></label><div class="number-editor"><input class="match-number" data-player-id="${esc(id)}" aria-label="${esc(p.name)} 本场号码" inputmode="numeric" maxlength="3" placeholder="${keeper?'号码可留空':'本场号码'}" value="${esc(number)}"><div class="last-number"><span>${last?`上次：${esc(last)} 号`:'暂无历史号码'}</span>${last?`<button class="link-button" data-use-last="${esc(id)}" data-number="${esc(last)}" aria-label="${esc(p.name)} 沿用上次 ${esc(last)} 号">沿用</button>`:''}</div></div></div>`;
  }).join(''):`<p class="empty">${roster.length?'未找到匹配的球员':'选择球队后，这里将显示报名名单。'}</p>`;
}
function renderEvents(){
  $('event-count').textContent=`${match.events.length} 个事件`;
  $('events-list').innerHTML=match.events.length?sortedEvents(match.events).map(event=>`<article class="event-item" draggable="true" data-id="${esc(event.id)}"><div class="event-top"><span class="event-time">${esc(event.time)}${event.time==='点'?'':"′"}</span><div class="event-actions"><button data-action="up" aria-label="上移事件">↑</button><button data-action="down" aria-label="下移事件">↓</button><button data-action="edit">编辑</button><button data-action="delete">删除</button></div></div><div class="event-details"><img src="./SMC_files/${ICONS[event.type]}.png" alt=""><span>${esc(event.type)} · ${esc(playerLabel(records,match,event))}</span><small>${esc(match[event.side])}</small></div></article>`).join(''):'<div class="empty">暂无比赛事件<br>从名单选择球员，记录进球、换人和判罚。</div>';
}
function render(){
  const score=calculateScore(match.events);$('score').textContent=`${score.home} : ${score.away}`;
  svg=renderPoster(match,records,icons);$('poster').innerHTML=svg;
}
function changed(){save();render();}
function requireTeams(){if(isCustom() && customDirty){toast('球队与首发尚未应用，请先点击“应用球队与首发”。');return false;}if(!match.home || !match.away){toast(isCustom()?'请先填写并应用双方球队与首发。':'请先选择赛事、主队和客队。');return false;}return true;}
function resetForTeams(tournament,home='',away=''){
  const old=match;match={...blankMatch(),id:old.id,tournament,home,away,title:old.title,numbers:{home:old.home===home?old.numbers.home:{},away:old.away===away?old.numbers.away:{}}};syncControls();save();
}
$('tournament').addEventListener('change',event=>{
  if(!discardMatch('切换赛事？')){event.target.value=match.tournament;return;}
  const selected=event.target.value;records=records.filter(r=>r.tournament!==CUSTOM_TOURNAMENT);match=blankMatch();match.tournament=selected;match.title=selected===CUSTOM_TOURNAMENT?'自定义比赛':selected;customDirty=false;syncControls();save();
});
for(const side of ['home','away'])$(`${side}-team`).addEventListener('change',event=>{
  if(!discardMatch('更换球队？')){event.target.value=match[side];return;}
  const home=side==='home'?event.target.value:match.home,away=side==='away'?event.target.value:match.away;
  if(home && home===away){toast('主队与客队不能相同。');syncControls();return;}resetForTeams(match.tournament,home,away);
});
for(const id of ['custom-home-name','custom-away-name','custom-home-starters','custom-away-starters'])$(id).addEventListener('input',()=>{customDirty=true;});
$('apply-custom').addEventListener('click',()=>{
  if(hasMatchWork() && !confirm('重新应用球队与首发？当前比赛的事件、首发和本场号码将清空。'))return;
  try{
    const home=$('custom-home-name').value.trim(),away=$('custom-away-name').value.trim();
    if(!home || !away)throw new Error('请填写双方球队名称。');
    if(home===away)throw new Error('主队与客队不能相同。');
    const homeRecords=parseCustomStarters($('custom-home-starters').value,CUSTOM_TOURNAMENT,home),awayRecords=parseCustomStarters($('custom-away-starters').value,CUSTOM_TOURNAMENT,away),customRecords=[...homeRecords,...awayRecords];
    const next={...blankMatch(),id:match.id,tournament:CUSTOM_TOURNAMENT,home,away,title:match.title,showLineups:match.showLineups};
    for(const [side,sideRecords] of [['home',homeRecords],['away',awayRecords]]){
      next.starters[side]=sideRecords.map(playerId);
      if(next.starters[side].includes(match.goalkeepers[side]))next.goalkeepers[side]=match.goalkeepers[side];
      for(const player of sideRecords)setMatchNumber(next,customRecords,side,playerId(player),player.number);
    }
    for(const player of records.filter(r=>r.tournament===CUSTOM_TOURNAMENT))numberHistory=rememberNumber(numberHistory,playerId(player),match.id,'');
    records=[...records.filter(r=>r.tournament!==CUSTOM_TOURNAMENT),...customRecords];match=next;customDirty=false;
    for(const player of customRecords)numberHistory=rememberNumber(numberHistory,playerId(player),match.id,player.number);
    syncControls();save();toast('自定义球队与首发已应用。');
  }catch(error){toast(error.message);}
});
$('match-title').addEventListener('input',event=>{match.title=event.target.value;changed();});
$('show-lineups').addEventListener('change',event=>{match.showLineups=event.target.checked;changed();});
for(const side of ['home','away'])$(`${side}-lineup-tab`).addEventListener('click',()=>{lineupSide=side;$('lineup-search').value='';renderLineup();});
$('lineup-search').addEventListener('input',renderLineup);
for(const side of ['home','away'])$(`${side}-goalkeeper`).addEventListener('change',event=>{
  try{setGoalkeeper(match,records,side,event.target.value);renderLineup();renderEvents();changed();}catch(error){toast(error.message);renderLineup();}
});
$('lineup-list').addEventListener('change',event=>{
  if(event.target.matches('.match-number')){updateNumber(event.target.dataset.playerId,event.target.value);return;}
  if(!event.target.matches('input[type=checkbox]'))return;
  const id=event.target.value;match.starters[lineupSide]=event.target.checked?[...match.starters[lineupSide],id]:match.starters[lineupSide].filter(n=>n!==id);if(!event.target.checked && match.goalkeepers[lineupSide]===id)match.goalkeepers[lineupSide]='';renderLineup();renderEvents();changed();
});
function updateNumber(id,value,{renderFields=true,report=true}={}){
  try{const number=setMatchNumber(match,records,lineupSide,id,value);numberHistory=rememberNumber(numberHistory,id,match.id,number);pendingEvents=null;pendingCustom=null;$('confirm-batch').disabled=true;if(renderFields)renderLineup();renderEvents();changed();}
  catch(error){if(report){toast(error.message);renderLineup();}}
}
$('lineup-list').addEventListener('input',event=>{if(event.target.matches('.match-number'))updateNumber(event.target.dataset.playerId,event.target.value,{renderFields:false,report:false});});
$('lineup-list').addEventListener('click',event=>{const button=event.target.closest('[data-use-last]');if(button)updateNumber(button.dataset.useLast,button.dataset.number);});
$('clear-lineup').addEventListener('click',()=>{match.starters[lineupSide]=[];match.goalkeepers[lineupSide]='';renderLineup();renderEvents();changed();});
$('new-match').addEventListener('click',()=>{if(!confirm('开始新比赛？当前比赛标题、事件、首发与本场号码将清空，官方名单与历史号码会保留。'))return;const tournament=match.tournament;if(tournament===CUSTOM_TOURNAMENT)records=records.filter(r=>r.tournament!==CUSTOM_TOURNAMENT);match={...blankMatch(),tournament};match.title=tournament===CUSTOM_TOURNAMENT?'自定义比赛':tournament;customDirty=false;syncControls();save();});

// Native dialogs provide Escape dismissal, focus trapping and focus restoration.
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)dialog.close();}));
function download(blob,name){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function loadRosters(){
  $('roster-summary').hidden=false;$('roster-summary').classList.remove('error');$('roster-summary').textContent='正在读取官方报名名单…';
  $('download-svg').disabled=true;$('download-png').disabled=true;
  try{
    const official=await loadOfficialData(new URL('./data/manifest.json',document.baseURI).href);
    const officialRecords=official.records;tournaments=official.tournaments;
    if(isCustom())records=[...officialRecords,...records.filter(r=>r.tournament===CUSTOM_TOURNAMENT)];
    else{records=officialRecords;({match,numberHistory}=reconcileOfficialDraft(match,numberHistory,records));}
    rostersReady=true;syncControls();save();$('download-svg').disabled=false;$('download-png').disabled=false;
  }catch(error){
    if(isCustom()){
      records=records.filter(r=>r.tournament===CUSTOM_TOURNAMENT);rostersReady=true;syncControls();save();
      $('roster-summary').hidden=false;$('roster-summary').classList.add('error');$('roster-summary').textContent='官方名单不可用，当前自定义比赛仍可继续编辑。';
    }else{
      records=[];match=blankMatch();rostersReady=false;syncControls();
      $('roster-summary').hidden=false;$('roster-summary').classList.add('error');$('roster-summary').textContent=`官方名单加载失败：${error.message} 请检查 data 文件后刷新页面。`;
    }
  }
}

const typeOptions=[...TYPES,'换人'].map(type=>[type,type==='乌龙'?'乌龙球':type==='两黄'?'两黄转红':type==='换人'?'换人（成对）':type]);
fill($('event-type'),typeOptions,'进球');fill($('batch-type'),typeOptions,'进球');
function fillPlayers(selected='',incoming=''){
  const side=$('event-side').value,roster=rosterFor(records,match,side),items=roster.map(p=>[playerId(p),`${matchNumber(match,side,p)||(isGoalkeeper(match,side,p)?'无号码':'待填号码')}  ${p.name}${isGoalkeeper(match,side,p)?' · 门将':match.starters[side].includes(playerId(p))?' · 首发':''}`]);
  fill($('event-player'),items,selected,'选择球员');fill($('event-player-in'),items,incoming,'选择换上球员');
  $('custom-event-options').innerHTML=roster.map(p=>option(p.name,matchNumber(match,side,p)?`${matchNumber(match,side,p)} 号`:p.name)).join('');
  for(const [id,nameId,numberId] of [[selected,'custom-event-name','custom-event-number'],[incoming,'custom-event-in-name','custom-event-in-number']]){
    const player=roster.find(p=>playerId(p)===id);$(nameId).value=player?.name||'';$(numberId).value=player?matchNumber(match,side,player):'';
  }
  updateEventFields();
}
function updateEventFields(){
  const substitution=$('event-type').value==='换人',custom=isCustom();
  $('roster-event-player').hidden=custom;$('custom-event-player').hidden=!custom;
  $('event-player').required=!custom;$('event-player').disabled=custom;$('custom-event-name').required=custom;
  $('substitution-field').hidden=!substitution;$('roster-incoming-player').hidden=custom;$('custom-incoming-player').hidden=!custom;
  $('event-player-in').required=substitution && !custom;$('event-player-in').disabled=custom || !substitution;
  $('custom-event-in-name').required=substitution && custom;
  $('custom-event-name').disabled=!custom;$('custom-event-number').disabled=!custom;
  $('custom-event-in-name').disabled=!custom || !substitution;$('custom-event-in-number').disabled=!custom || !substitution;
  $('event-player-label').textContent=substitution?'换下球员':'球员';$('custom-event-label').textContent=substitution?'换下球员姓名':'球员姓名';
  const nameHint=custom?'可填写未列入首发的球员姓名，也可选择已有球员；非首发球员号码可留空。':'可以选择报名名单中的所有球员，包括替补。';
  $('event-hint').textContent=nameHint+($('event-type').value==='乌龙'?'选择造成乌龙的球员及其所属队伍，分数会自动计入对方球队。':'');
}
for(const [nameId,numberId] of [['custom-event-name','custom-event-number'],['custom-event-in-name','custom-event-in-number']])$(nameId).addEventListener('input',()=>{
  const player=rosterFor(records,match,$('event-side').value).find(p=>p.name===$(nameId).value.trim());$(numberId).value=player?matchNumber(match,$('event-side').value,player):'';
});
function rememberEventNumbers(events){
  for(const event of events){const number=matchNumber(match,event.side,event.playerId);if(number)numberHistory=rememberNumber(numberHistory,event.playerId,match.id,number);}
}
function openEvent(event=null){
  if(!requireTeams())return;editingId=event?.id||null;$('event-dialog-title').textContent=event?'编辑事件':'添加事件';$('event-type').value=event?.type||'进球';$('event-time').value=event?.time||'';
  fill($('event-side'),[['home',match.home],['away',match.away]],event?.side||'home');fillPlayers(event?.playerId||'');$('event-error').textContent='';$('event-dialog').showModal();
}
$('add-event').addEventListener('click',()=>openEvent());$('event-side').addEventListener('change',()=>fillPlayers());$('event-type').addEventListener('change',updateEventFields);
$('event-form').addEventListener('submit',event=>{
  event.preventDefault();$('event-error').textContent='';
  const side=$('event-side').value,type=$('event-type').value,time=$('event-time').value.trim();
  try{
    const index=editingId?match.events.findIndex(e=>e.id===editingId):-1;if(editingId && index<0)throw new Error('原事件已不存在。');
    let events;
    if(isCustom()){
      const entries=[{name:$('custom-event-name').value,number:$('custom-event-number').value},...(type==='换人'?[{name:$('custom-event-in-name').value,number:$('custom-event-in-number').value}]:[])];
      const result=createCustomEvents(type,time,side,entries,match,records);events=result.events;records=result.records;match=result.match;
    }else events=createPlayerEvents(type,time,side,[$('event-player').value,...(type==='换人'?[$('event-player-in').value]:[])],match,records);
    if(editingId){events[0].id=editingId;match.events.splice(index,1,...events);}else match.events.push(...events);
    rememberEventNumbers(events);pendingEvents=null;pendingCustom=null;syncControls();save();$('event-dialog').close();toast('事件已保存。');
  }catch(error){$('event-error').textContent=error.message;}
});
function reorder(id,targetId){
  const from=match.events.findIndex(e=>e.id===id),to=match.events.findIndex(e=>e.id===targetId);if(from<0 || to<0 || from===to)return;
  if(match.events[from].time!==match.events[to].time){toast('只能调整同一时间的事件顺序。');return;}
  const [event]=match.events.splice(from,1);match.events.splice(to,0,event);renderEvents();changed();
}
$('events-list').addEventListener('click',event=>{
  const action=event.target.dataset.action,row=event.target.closest('[data-id]');if(!action || !row)return;
  const current=match.events.find(e=>e.id===row.dataset.id);if(!current)return;
  if(action==='edit'){openEvent(current);return;}
  if(action==='delete'){match.events=match.events.filter(e=>e.id!==current.id);renderEvents();changed();return;}
  const same=match.events.filter(e=>e.time===current.time),index=same.findIndex(e=>e.id===current.id),target=same[index+(action==='up'?-1:1)];if(target)reorder(current.id,target.id);
});
$('events-list').addEventListener('dragstart',event=>{const row=event.target.closest('[data-id]');if(!row)return;draggedId=row.dataset.id;event.dataTransfer.setData('text/plain',draggedId);row.classList.add('dragging');});
$('events-list').addEventListener('dragover',event=>{if(event.target.closest('[data-id]'))event.preventDefault();});
$('events-list').addEventListener('drop',event=>{event.preventDefault();const target=event.target.closest('[data-id]');if(target && draggedId)reorder(draggedId,target.dataset.id);draggedId=null;});
$('events-list').addEventListener('dragend',()=>{draggedId=null;document.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));});
$('batch-events').addEventListener('click',()=>{
  if(!requireTeams())return;pendingEvents=null;pendingCustom=null;$('batch-input').value='';$('batch-preview').textContent='预览通过后可一次性添加。';$('batch-preview').classList.remove('error');$('confirm-batch').disabled=true;
  $('batch-help').textContent=isCustom()?'时间,球队,姓名或“号码 姓名”；可填写未列入首发的球员。换人使用：时间,球队,换下球员,换上球员。':'时间,球队,球员号码或姓名；换人使用：时间,球队,换下球员,换上球员。重名时使用号码。';
  $('batch-dialog').showModal();
});
for(const id of ['batch-type','batch-input'])$(id).addEventListener(id==='batch-type'?'change':'input',()=>{pendingEvents=null;pendingCustom=null;$('confirm-batch').disabled=true;$('batch-preview').textContent='内容已更新，请重新预览。';});
$('preview-batch').addEventListener('click',()=>{
  $('batch-preview').classList.remove('error');
  try{
    pendingCustom=isCustom()?parseCustomBatch($('batch-input').value,$('batch-type').value,match,records):null;
    pendingEvents=pendingCustom?.events||parseBatch($('batch-input').value,$('batch-type').value,match,records);
    $('batch-preview').innerHTML=`<strong>${pendingEvents.length} 个有效事件</strong><br>`+pendingEvents.map(e=>`${esc(e.time)} · ${esc(match[e.side])} · ${esc(playerLabel(pendingCustom?.records||records,pendingCustom?.match||match,e))} · ${esc(e.type)}`).join('<br>');$('confirm-batch').disabled=false;
  }catch(error){pendingEvents=null;pendingCustom=null;$('confirm-batch').disabled=true;$('batch-preview').textContent=error.message;$('batch-preview').classList.add('error');}
});
$('confirm-batch').addEventListener('click',()=>{
  if(!pendingEvents)return;if(pendingCustom){records=pendingCustom.records;match=pendingCustom.match;}
  match.events.push(...pendingEvents);rememberEventNumbers(pendingEvents);syncControls();save();$('batch-dialog').close();pendingEvents=null;pendingCustom=null;toast('批量事件已添加。');
});

const fileName=()=>(match.title||'比赛赛果').replace(/[\\/:*?"<>|]/g,'-').slice(0,80);
function canExport(){if(!requireTeams())return false;const missingKeepers=missingGoalkeepers(match,records);if(missingKeepers.length){toast(`请为${missingKeepers.join('、')}${missingKeepers.length>1?'各':''}选择一名首发守门员。`);return false;}const missing=missingNumbers(match,records);if(!missing.length)return true;toast(`请先填写${match.lineupsEnabled===false?'事件球员':'首发与事件球员'}的本场号码：${missing.slice(0,3).join('、')}${missing.length>3?'等':''}。`);return false;}
$('download-svg').addEventListener('click',()=>{if(canExport())download(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),`${fileName()}.svg`);});
$('download-png').addEventListener('click',async()=>{
  if(!canExport())return;
  const button=$('download-png');button.disabled=true;const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    await document.fonts.ready;const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(2,16384/image.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const context=canvas.getContext('2d');if(!context)throw new Error('浏览器不支持图片导出。');context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片过大，请减少事件或使用 SVG 导出。');download(blob,`${fileName()}.png`);toast('PNG 图片已导出。');
  }catch(error){toast(error.message||'图片导出失败，请使用 SVG 导出。');}
  finally{URL.revokeObjectURL(url);button.disabled=false;}
});
await loadRosters();
// Embed local icons in exported SVGs to keep downloads independent of the site.
await Promise.all(Object.entries(ICONS).map(async([type,file])=>{
  try{const response=await fetch(`./SMC_files/${file}.png`);if(!response.ok)throw new Error('icon');const blob=await response.blob();icons[type]=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}catch{}
}));
render();
