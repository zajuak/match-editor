// Pure data operations shared by the editor and its regression checks.
export const TYPES = ['进球', '点球', '乌龙', '助攻', '黄牌', '红牌', '两黄', '射失点球', '换下', '换上'];
export const ICONS = {进球:'G',点球:'PG',乌龙:'icon_w',助攻:'AS',黄牌:'YC',红牌:'RC',两黄:'YYR',射失点球:'PM',换下:'SO',换上:'SI'};
export const CUSTOM_TOURNAMENT = '__custom__';
const tournamentNames={'2026新生杯':'2026年新生杯男子足球赛','2026-27五人制女足北大杯':'2026-27北大杯女子足球赛','2026-27女足北大杯':'2026-27北大杯女子足球赛'};
const teamNames={'外国语学院':'外院','信息管理学院—历史学系联队':'信历','经济学院':'经济','生命科学学院':'生科'};
const mapped=(map,value)=>Object.hasOwn(map,value)?map[value]:value;
export function normalizeRosterRecord(player){
  const tournament=mapped(tournamentNames,player.tournament),men=tournament==='2026年新生杯男子足球赛';
  const team=men?mapped(teamNames,player.team):player.team;
  return {...player,tournament,team,name:men && team==='数学' && player.name==='申宇颢'?'申宇灏':player.name};
}

export const escapeXML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const key = (...parts) => JSON.stringify(parts);
export const blankMatch = () => ({id:crypto.randomUUID(),tournament:'',home:'',away:'',title:'',starters:{home:[],away:[]},goalkeepers:{home:'',away:''},numbers:{home:{},away:{}},events:[],showLineups:true});
export const playerId = player => player.id || key(player.tournament,player.team,player.name);
export const matchNumber = (match,side,player) => match.numbers?.[side]?.[typeof player==='string'?player:playerId(player)] || '';
export const isGoalkeeper = (match,side,player) => {
  const id=typeof player==='string'?player:playerId(player);
  return match.goalkeepers?.[side]===id && match.starters[side].includes(id);
};
export function setGoalkeeper(match,records,side,id) {
  if(!['home','away'].includes(side))throw new Error('请选择球队。');
  if(id && (!match.starters[side].includes(id) || !rosterFor(records,match,side).some(p=>playerId(p)===id)))throw new Error('守门员必须是本队首发球员。');
  match.goalkeepers||={home:'',away:''};match.goalkeepers[side]=id;
}
export function missingGoalkeepers(match,records) {
  if(match.lineupsEnabled===false)return [];
  return ['home','away'].filter(side=>!match.goalkeepers?.[side] || !rosterFor(records,match,side).some(p=>isGoalkeeper(match,side,p))).map(side=>match[side]||(side==='home'?'主队':'客队'));
}
export function previousNumber(history,id,matchId) {
  return (history[id]||[]).find(entry=>entry.matchId!==matchId)?.number || '';
}
export function rememberNumber(history,id,matchId,number) {
  const entries=(history[id]||[]).filter(entry=>entry.matchId!==matchId);
  return {...history,[id]:number?[{matchId,number,usedAt:new Date().toISOString()},...entries].slice(0,2):entries};
}
export function mergeNumberHistories(existing,incoming,records) {
  const result={...existing};
  for(const p of records){
    const id=playerId(p),entries=[...(Array.isArray(existing?.[id])?existing[id]:[]),...(Array.isArray(incoming?.[id])?incoming[id]:[])];
    const valid=entries.filter(h=>h && typeof h.matchId==='string' && typeof h.number==='string' && /^\d{1,3}$/.test(h.number) && typeof h.usedAt==='string' && Number.isFinite(Date.parse(h.usedAt)));
    valid.sort((a,b)=>b.usedAt.localeCompare(a.usedAt));
    const unique=new Map();for(const entry of valid)if(!unique.has(entry.matchId))unique.set(entry.matchId,{matchId:entry.matchId,number:String(Number(entry.number)),usedAt:entry.usedAt});
    result[id]=[...unique.values()].slice(0,2);
  }
  return result;
}
export function setMatchNumber(match,records,side,id,value) {
  const number=String(value).trim(),roster=rosterFor(records,match,side);
  if(!roster.some(p=>playerId(p)===id))throw new Error('球员不在当前球队名单中。');
  if(number && !/^\d{1,3}$/.test(number))throw new Error('号码应为 0–999 的整数。');
  const normalized=number?String(Number(number)):'';
  if(normalized && roster.some(p=>playerId(p)!==id && matchNumber(match,side,p)===normalized))throw new Error(`本队已有球员使用 ${normalized} 号，请先修改或清空该球员号码。`);
  match.numbers[side][id]=normalized;
  return normalized;
}
export function missingNumbers(match,records) {
  return ['home','away'].flatMap(side=>{
    const used=new Set([...(match.lineupsEnabled!==false && match.showLineups?match.starters[side]:[]),...match.events.filter(ev=>ev.side===side).map(ev=>ev.playerId)]);
    return rosterFor(records,match,side).filter(p=>used.has(playerId(p)) && !isGoalkeeper(match,side,p) && !matchNumber(match,side,p)).map(p=>`${match[side]} · ${p.name}`);
  });
}
export const validTime = time => /^(?:\d{1,3}(?:\+\d{1,3})?|点)$/.test(time);
export function compareTimes(a,b) {
  const parse = t => t === '点' ? [Infinity,0] : t.split('+').map(Number);
  const [am,ae=0] = parse(a), [bm,be=0] = parse(b);
  return am === bm ? ae-be : am-bm;
}
export const sortedEvents = events => [...events].sort((a,b)=>compareTimes(a.time,b.time));

// RFC 4180-style quoted fields, including tabs from Excel's clipboard.
export function parseDelimited(text) {
  text = text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const delimiter = text.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = []; let row=[], field='', quoted=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='"') { if (quoted && text[i+1]==='"') {field+='"';i++;} else if (quoted || !field) quoted=!quoted; else field+=c; }
    else if (!quoted && (c===delimiter || c==='\n')) {row.push(field.trim());field='';if(c==='\n'){rows.push(row);row=[];}}
    else field+=c;
  }
  if (quoted) throw new Error('存在未闭合的双引号，请检查表格。');
  row.push(field.trim());rows.push(row);
  return rows.filter(r=>r.some(Boolean));
}
export function validateRecords(records) {
  const seen=new Set();
  for(const [i,r] of records.entries()) {
    const prefix=`第 ${r.sourceRow||i+1} 行：`;
    for(const field of ['tournament','team','name']) if(!String(r[field]??'').trim())throw new Error(prefix+`缺少${{tournament:'赛事',team:'球队',name:'姓名'}[field]}。`);
    if(r.number && !/^\d{1,3}$/.test(r.number))throw new Error(prefix+'号码应为 0–999 的整数。');
    for(const field of ['tournament','team','name']) if(r[field].length>80)throw new Error(prefix+'赛事、球队、姓名最多 80 个字符。');
    const id=playerId(r);
    if(seen.has(id))throw new Error(prefix+`${r.team}存在重复姓名“${r.name}”，同名球员请在姓名中添加区分。`);
    seen.add(id);
  }
}
export function parseCustomStarters(text,tournament,team) {
  team=team.trim();if(!team)throw new Error('请填写双方球队名称。');
  const records=[],numbers=new Set();
  String(text).split(/\r\n?|\n/).forEach((line,index)=>{
    line=line.trim();if(!line)return;
    let number='',name=line;const numbered=line.match(/^(\d+)\s+(.+)$/);
    if(numbered){
      if(!/^\d{1,3}$/.test(numbered[1]))throw new Error(`第 ${index+1} 行：号码应为 0–999 的整数。`);
      number=String(Number(numbered[1]));name=numbered[2].trim();
      if(numbers.has(number))throw new Error(`第 ${index+1} 行：本队已有球员使用 ${number} 号。`);
      numbers.add(number);
    }else if(/^\d+$/.test(line))throw new Error(`第 ${index+1} 行：号码后需填写球员姓名。`);
    records.push({tournament,team,name,number,sourceRow:index+1});
  });
  if(!records.length)throw new Error(`请输入${team}的首发名单。`);
  validateRecords(records);
  return records;
}
// Upgrade old number-based relationships before loading the official rosters.
export function restoreState(saved) {
  if(!saved || ![1,2].includes(saved.version))return {records:[],match:blankMatch(),numberHistory:{}};
  const correctedPlayer=p=>{const next=normalizeRosterRecord(p);return p.tournament!==next.tournament || p.team!==next.team || p.name!==next.name;};
  const matchNeedsCorrection=saved.match && ['home','away'].some(side=>correctedPlayer({tournament:saved.match.tournament,team:saved.match[side],name:''}));
  if(saved.records?.some(correctedPlayer) || matchNeedsCorrection){
    saved=structuredClone(saved);
    const ids=new Map();
    for(const player of saved.records||[])if(correctedPlayer(player)){
      const oldId=playerId(player);Object.assign(player,normalizeRosterRecord(player));player.id=key(player.tournament,player.team,player.name);ids.set(oldId,player.id);
    }
    const rename=id=>ids.get(id)||id;
    saved.numberHistory=Object.fromEntries(Object.entries(saved.numberHistory||{}).map(([id,entries])=>[rename(id),entries]));
    if(saved.match){
      const match=saved.match,oldName=match.tournament;
      for(const side of ['home','away']){
        const corrected=normalizeRosterRecord({tournament:oldName,team:match[side],name:''});match[side]=corrected.team;
        if(match.starters?.[side])match.starters[side]=match.starters[side].map(rename);
        if(match.goalkeepers?.[side])match.goalkeepers[side]=rename(match.goalkeepers[side]);
        if(match.numbers?.[side])match.numbers[side]=Object.fromEntries(Object.entries(match.numbers[side]).map(([id,number])=>[rename(id),number]));
      }
      match.tournament=mapped(tournamentNames,oldName);if(match.title===oldName)match.title=match.tournament;
      match.events=(match.events||[]).map(event=>({...event,playerId:rename(event.playerId)}));
    }
  }
  const legacy=saved.version===1,source=saved.records||[];
  const counts=new Map();for(const p of source){const id=key(p.tournament,p.team,p.name);counts.set(id,(counts.get(id)||0)+1);}
  const records=source.map(r=>({...r,id:r.id || (counts.get(key(r.tournament,r.team,r.name))>1?key(r.tournament,r.team,r.name,r.number):playerId(r))}));
  validateRecords(records);
  const match={...blankMatch(),...saved.match,goalkeepers:{home:'',away:'',...saved.match?.goalkeepers},numbers:saved.match?.numbers||{home:{},away:{}}};
  let numberHistory=mergeNumberHistories({},saved.numberHistory,records);
  if(legacy){
    for(const side of ['home','away']) {
      const roster=rosterFor(records,match,side),find=number=>roster.find(p=>String(Number(p.number))===String(Number(number)));
      match.starters[side]=match.starters[side].map(number=>find(number)?.id).filter(Boolean);
      for(const p of roster)if(p.number){const number=String(Number(p.number));match.numbers[side][p.id]=number;numberHistory=rememberNumber(numberHistory,p.id,match.id,number);}
      match.events=match.events.map(ev=>ev.side===side?{...ev,playerId:find(ev.number)?.id}:ev);
    }
  }
  return {records,match,numberHistory};
}
export const rosterFor = (records,match,side) => records.filter(r=>r.tournament===match.tournament && r.team===match[side]);
export function reconcileOfficialDraft(match,numberHistory,records) {
  if(!records.some(r=>r.tournament===match.tournament)){
    const tournament=records[0]?.tournament||'';
    return {match:{...blankMatch(),tournament,title:tournament},numberHistory:mergeNumberHistories({},numberHistory,records)};
  }
  const next={...match,starters:{home:[],away:[]},goalkeepers:{home:'',away:''},numbers:{home:{},away:{}},events:[...match.events]},validPlayers={};
  for(const side of ['home','away']){
    const roster=rosterFor(records,match,side),ids=new Set(roster.map(playerId));validPlayers[side]=ids;
    if(!match[side] || !ids.size){next[side]='';continue;}
    next.starters[side]=match.starters[side].filter(id=>ids.has(id));
    if(next.starters[side].includes(match.goalkeepers?.[side]))next.goalkeepers[side]=match.goalkeepers[side];
    next.numbers[side]=Object.fromEntries(Object.entries(match.numbers[side]||{}).filter(([id])=>ids.has(id)));
  }
  next.events=match.events.filter(event=>validPlayers[event.side]?.has(event.playerId));
  return {match:next,numberHistory:mergeNumberHistories({},numberHistory,records)};
}
export function parseBatch(text,type,match,records) {
  if(!TYPES.includes(type) && type!=='换人')throw new Error('请选择事件类型。');
  const rows=parseDelimited(text.includes(',')?text:text.replaceAll('，',',')), events=[];
  if(!rows.length)throw new Error('请输入事件。');
  rows.forEach((row,i)=>{
    const [time,team,...names]=row;
    if(!validTime(time))throw new Error(`第 ${i+1} 行：时间应为 12、40+2 或“点”。`);
    const side=team===match.home?'home':team===match.away?'away':null;
    if(!side || !match.home || !match.away)throw new Error(`第 ${i+1} 行：队伍必须是当前主队或客队。`);
    if(names.length!==(type==='换人'?2:1))throw new Error(`第 ${i+1} 行：${type==='换人'?'换人需要时间、球队、换下球员、换上球员':'需要时间、球队、球员'}。`);
    const roster=rosterFor(records,match,side);
    const players=names.map(name=>{
      const hits=roster.filter(p=>p.name===name || (matchNumber(match,side,p) && (matchNumber(match,side,p)===name || `${matchNumber(match,side,p)} ${p.name}`===name)));
      if(hits.length!==1)throw new Error(`第 ${i+1} 行：“${name}”${hits.length?'重名，请使用号码':'不在该队名单中'}。`);
      return playerId(hits[0]);
    });
    if(type==='换人' && players[0]===players[1])throw new Error(`第 ${i+1} 行：换上与换下球员不能相同。`);
    events.push(...createPlayerEvents(type,time,side,players,match,records));
  });
  return events;
}
export function createPlayerEvents(type,time,side,ids,match,records) {
  if(!validTime(time))throw new Error('时间应为 12、40+2 或“点”。');
  if(!TYPES.includes(type) && type!=='换人')throw new Error('请选择事件类型。');
  if(!['home','away'].includes(side) || !match[side])throw new Error('请选择球队。');
  if(ids.length!==(type==='换人'?2:1) || ids.some(id=>!rosterFor(records,match,side).some(p=>playerId(p)===id)))throw new Error('请选择有效球员。');
  if(type==='换人' && ids[0]===ids[1])throw new Error('换上与换下球员不能相同。');
  return ids.map((id,j)=>({id:crypto.randomUUID(),time,side,playerId:id,type:type==='换人'?(j?'换上':'换下'):type}));
}
export function calculateScore(events) {
  const score={home:0,away:0,shootout:{home:0,away:0}};
  for(const e of events) {
    if(!['进球','点球','乌龙'].includes(e.type))continue;
    const side=e.type==='乌龙'?(e.side==='home'?'away':'home'):e.side;
    if(e.time==='点')score.shootout[side]++;else score[side]++;
  }
  return score;
}
export const playerLabel = (records,match,event) => {
  const p=rosterFor(records,match,event.side).find(p=>playerId(p)===event.playerId);
  if(!p)return '球员（名单缺失）';
  const keeper=isGoalkeeper(match,event.side,p),number=matchNumber(match,event.side,p);
  return `${number||(keeper?'GK':'待填号码')} ${p.name}${keeper?'(GK)':''}`;
};

// The same self-contained SVG drives the live poster and PNG/SVG downloads.
export function renderPoster(match,records,icons={}) {
  const e=escapeXML, W=800, score=calculateScore(match.events), ordered=sortedEvents(match.events), groups=[];
  ordered.forEach(event=>{let group=groups.at(-1);if(!group || group.time!==event.time){group={time:event.time,home:[],away:[]};groups.push(group);}group[event.side].push(event);});
  const text=(x,y,value,size=20,fill='#323745',anchor='start',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${e(value)}</text>`;
  const wrap=(value,max)=>{const chars=Array.from(value);const lines=[];while(chars.length)lines.push(chars.splice(0,max).join(''));return lines.length?lines:[''];};
  const titleLines=wrap(match.title||match.tournament||'足球比赛赛果',30);
  const titleHeight=42+titleLines.length*28;
  let y=titleHeight;
  const body=[`<rect width="800" height="${titleHeight}" fill="#f7f7f8"/>`,...titleLines.map((line,i)=>text(400,44+i*28,line,23,'#323745','middle'))];
  const teamLines=[wrap(match.home||'主队',11),wrap(match.away||'客队',11)];
  const scoreHeight=100+(Math.max(...teamLines.map(lines=>lines.length))-1)*25;
  body.push(`<rect y="${y}" width="800" height="${scoreHeight}" fill="#ebeced"/>`);
  teamLines.forEach((lines,i)=>lines.forEach((line,j)=>body.push(text(i?610:190,y+53+j*25,line,23,'#323745','middle',600))));
  body.push(text(400,y+56,`${score.home} : ${score.away}`,38,'#323745','middle',700));
  if(match.events.some(ev=>ev.time==='点'))body.push(text(400,y+83,`点球 ${score.shootout.home} : ${score.shootout.away}`,15,'#626777','middle'));
  y+=scoreHeight+40;const start=y;
  body.push(`<circle cx="400" cy="${y}" r="13" fill="white" stroke="#27a551" stroke-width="2"/>`,text(400,y+5,'▶',14,'#27a551','middle'));
  y+=38;
  for(const group of groups) {
    const heights={home:0,away:0};
    for(const side of ['home','away'])for(const ev of group[side])heights[side]+=wrap(playerLabel(records,match,ev),14).length*23+12;
    const height=Math.max(heights.home,heights.away,38)+20;
    body.push(`<circle cx="400" cy="${y+13}" r="21" fill="#8c0000"/>`,text(400,y+18,group.time,group.time.length>4?10:13,'white','middle',600));
    for(const side of ['home','away']) {
      if(!group[side].length)continue;
      const x=side==='home'?28:444, boxW=328;
      body.push(`<rect x="${x}" y="${y-8}" width="${boxW}" height="${heights[side]+12}" rx="6" fill="white" stroke="#e1e3e8"/>`);
      let ey=y+15;
      for(const ev of group[side]) {
        const ix=side==='home'?x+boxW-34:x+12;
        if(icons[ev.type])body.push(`<image href="${e(icons[ev.type])}" x="${ix}" y="${ey-17}" width="22" height="22"/>`);
        else body.push(text(ix+11,ey,ev.type,11,'#8c0000','middle'));
        wrap(playerLabel(records,match,ev),14).forEach((line,i)=>body.push(text(side==='home'?ix-12:ix+34,ey+i*23,line,18,'#414655',side==='home'?'end':'start')));
        ey+=wrap(playerLabel(records,match,ev),14).length*23+12;
      }
    }
    y+=height;
  }
  body.splice(titleLines.length+4,0,`<line x1="400" y1="${start}" x2="400" y2="${y}" stroke="#8c0000" stroke-width="2"/>`);
  body.push(`<circle cx="400" cy="${y}" r="5" fill="#8c0000"/>`,text(400,y+31,'全场结束',14,'#27a551','middle'));
  y+=61;
  if(match.lineupsEnabled!==false && match.showLineups) {
    body.push(`<line x1="24" y1="${y}" x2="776" y2="${y}" stroke="#e1e3e8"/>`,text(400,y+35,'首发阵容',20,'#323745','middle',600));y+=68;
    const selected={};
    for(const side of ['home','away']){
      const players=match.starters[side].map(id=>rosterFor(records,match,side).find(p=>playerId(p)===id)).filter(Boolean);
      selected[side]=[...players.filter(p=>isGoalkeeper(match,side,p)),...players.filter(p=>!isGoalkeeper(match,side,p))];
    }
    let used=0;
    for(const [i,side] of ['home','away'].entries()) {
      const x=i?430:40;let ly=y;
      wrap(match[side]|| (i?'客队':'主队'),16).forEach(line=>{body.push(text(x,ly,line,19,'#616a86','start',600));ly+=26;});ly+=12;
      if(!selected[side].length){body.push(text(x,ly,'尚未选择首发',17,'#9095a0'));ly+=34;}
      for(const p of selected[side]) {
        const keeper=isGoalkeeper(match,side,p);
        body.push(`<rect x="${x}" y="${ly-20}" width="36" height="28" rx="5" fill="${keeper?'#e5f2e9':'#eeecf8'}"/>`,text(x+18,ly,matchNumber(match,side,p)||(keeper?'GK':'—'),16,keeper?'#277744':'#6257a8','middle',600));
        const lines=wrap(p.name+(keeper?'(GK)':''),14);lines.forEach((line,j)=>body.push(text(x+50,ly+j*24,line,19)));ly+=Math.max(36,lines.length*24+8);
      }
      used=Math.max(used,ly-y);
    }
    y+=used+24;
  }
  body.push(`<rect y="${y}" width="800" height="48" fill="#f0f0f3"/>`);
  ['进球','点球','乌龙'].forEach((type,i)=>{const x=200+i*165;if(icons[type])body.push(`<image href="${e(icons[type])}" x="${x}" y="${y+13}" width="22" height="22"/>`);body.push(text(x+30,y+30,type==='乌龙'?'乌龙球':type,17));});
  const height=y+48;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="${match.lineupsEnabled!==false && match.showLineups?'比赛赛果与首发阵容':'比赛赛果'}"><rect width="800" height="${height}" fill="#f7f7f8"/><g font-family="PingFang SC,Microsoft YaHei,Arial,sans-serif">${body.join('')}</g></svg>`;
}
