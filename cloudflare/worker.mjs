import {login,sessionFor} from './auth.mjs';
import {planRegistrationImport} from '../src/registration-plan.mjs';
const entities={tournament:{table:'tournaments',parent:null},team:{table:'teams',parent:'tournament_id'},player:{table:'players',parent:'team_id'}};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const name=value=>{if(typeof value!=='string' || !value.trim() || value.trim().length>80)fail('名称需为 1–80 个字符。');return value.trim();};
const identifier=value=>{if(typeof value!=='string' || !value || value.length>100)fail('记录标识无效。');return value;};
async function readBody(request,limit=8192){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail('请求需使用 JSON。',415);
  const reader=request.body?.getReader();if(!reader)fail('缺少请求内容。');
  let length=0,parts=[];
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();fail('请求内容过大。',413);}parts.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('JSON 格式不正确。');}
  if(!body || typeof body!=='object' || Array.isArray(body))fail('请求内容格式不正确。');return body;
}
function expectedRevision(request){
  const value=request.headers.get('If-Match')?.replace(/^"|"$/g,'');
  if(!/^\d+$/.test(value||'') || !Number.isSafeInteger(Number(value)))fail('请先刷新名单后再修改。',428);
  return Number(value);
}
async function mutate(request,db,statements,{seed=false}={}){
  const base=expectedRevision(request),token=crypto.randomUUID();
  const guard=db.prepare(`UPDATE roster_state SET revision=revision+1,mutation_token=? WHERE id=1 AND revision=?${seed?' AND revision=0 AND NOT EXISTS(SELECT 1 FROM tournaments) AND NOT EXISTS(SELECT 1 FROM teams) AND NOT EXISTS(SELECT 1 FROM players)':''}`).bind(token,base);
  const result=await db.batch([guard,...statements(token)]);
  if(!result[0].meta.changes)fail(seed?'名单已初始化，不能覆盖已有数据。':'名单已被其他管理员修改，请刷新后重试。',409);
  return base+1;
}
async function sharedRosters(db){
  const [state,tournaments,teams,players]=await db.batch([
    db.prepare('SELECT revision FROM roster_state WHERE id=1'),
    db.prepare('SELECT id,name,lineups,position FROM tournaments ORDER BY position,id'),
    db.prepare('SELECT id,tournament_id,name,position FROM teams ORDER BY position,id'),
    db.prepare('SELECT id,team_id,name,position,legacy_key FROM players ORDER BY position,id')
  ]);
  const byTeam=new Map(),byTournament=new Map();
  for(const player of players.results){if(!byTeam.has(player.team_id))byTeam.set(player.team_id,[]);byTeam.get(player.team_id).push(player);}
  for(const team of teams.results){if(!byTournament.has(team.tournament_id))byTournament.set(team.tournament_id,[]);byTournament.get(team.tournament_id).push({...team,players:byTeam.get(team.id)||[]});}
  return {revision:state.results[0].revision,tournaments:tournaments.results.map(t=>({...t,lineups:Boolean(t.lineups),teams:byTournament.get(t.id)||[]}))};
}
function normalizeSeed(payload){
  if(!payload || !['tournaments','teams','players'].every(k=>Array.isArray(payload[k])))fail('初始名单格式不正确。');
  if(payload.players.length>10000 || payload.teams.length>1000 || payload.tournaments.length>100)fail('初始名单过大。');
  const tournaments=payload.tournaments.map((t,i)=>({id:t.id?identifier(t.id):crypto.randomUUID(),name:name(t.name),lineups:t.lineups===false||t.lineups===0?0:1,position:i}));
  const teams=payload.teams.map((t,i)=>({id:t.id?identifier(t.id):crypto.randomUUID(),tournament_id:t.tournament_id||tournaments.find(p=>p.name===t.tournament_name)?.id,name:name(t.name),position:Number.isSafeInteger(t.position)&&t.position>=0?t.position:i}));
  const players=payload.players.map((p,i)=>({id:p.id?identifier(p.id):crypto.randomUUID(),team_id:p.team_id||teams.find(t=>t.name===p.team_name && t.tournament_id===tournaments.find(t=>t.name===p.tournament_name)?.id)?.id,name:name(p.name),position:Number.isSafeInteger(p.position)&&p.position>=0?p.position:i,legacy_key:typeof p.legacy_key==='string' && p.legacy_key.length<=1000?p.legacy_key:null}));
  for(const t of teams)if(!tournaments.some(p=>p.id===t.tournament_id))fail('球队与赛事关联不完整。');
  for(const p of players)if(!teams.some(t=>t.id===p.team_id))fail('球员与球队关联不完整。');
  return {tournaments,teams,players};
}
export async function handleApi(request,env){
  const url=new URL(request.url),path=url.pathname,db=env.DB;
  if(path==='/health' && request.method==='GET')return Response.json({ok:true,databaseBound:Boolean(db),adminConfigured:Boolean(env.ADMIN_PASSWORD_HASH)});
  if(!db)fail('共享名单服务尚未配置。',503);
  if(path==='/api/rosters' && request.method==='GET')return Response.json(await sharedRosters(db));
  if(path==='/api/login' && request.method==='POST')return Response.json(await login(request,env,(await readBody(request)).password));
  const session=await sessionFor(request,env);
  if(path==='/api/session' && request.method==='GET')return Response.json({authenticated:Boolean(session),user:session?.user||null});
  if(path==='/api/logout' && request.method==='POST'){
    if(session)await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(session.tokenHash).run();
    return Response.json({authenticated:false});
  }
  if(!path.startsWith('/api/admin/'))fail('接口不存在。',404);
  if(!session)fail('请先登录管理员账号。',401);
  if(path==='/api/admin/import' && request.method==='POST'){
    const body=await readBody(request,2*1024*1024),tournamentId=identifier(body.tournamentId);
    const snapshot=await sharedRosters(db),tournament=snapshot.tournaments.find(t=>t.id===tournamentId);
    if(!tournament)fail('赛事不存在，请刷新名单后重试。',404);
    let plan;
    try{plan=planRegistrationImport(tournament,body.teams,body.mode);}catch(error){fail(error.message);}
    const newTeams=[],newPlayers=[],positions=[],removed=[];
    let nextPosition=Math.max(-1,...tournament.teams.map(t=>t.position))+1;
    for(const team of plan.teams){
      const teamId=team.teamId||crypto.randomUUID();
      if(!team.teamId)newTeams.push({id:teamId,tournament_id:tournamentId,name:team.name,position:nextPosition++});
      team.players.forEach((p,position)=>{
        if(p.id)positions.push({id:p.id,position});
        else newPlayers.push({id:crypto.randomUUID(),team_id:teamId,name:p.name,position});
      });
      removed.push(...team.removed.map(p=>p.id));
    }
    const revision=await mutate(request,db,token=>[
      db.prepare("INSERT INTO teams(id,tournament_id,name,position) SELECT json_extract(value,'$.id'),json_extract(value,'$.tournament_id'),json_extract(value,'$.name'),json_extract(value,'$.position') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)").bind(JSON.stringify(newTeams),token),
      db.prepare('DELETE FROM players WHERE id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)').bind(JSON.stringify(removed),token),
      db.prepare("UPDATE players SET position=(SELECT json_extract(value,'$.position') FROM json_each(?) WHERE json_extract(value,'$.id')=players.id) WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)").bind(JSON.stringify(positions),JSON.stringify(positions),token),
      db.prepare("INSERT INTO players(id,team_id,name,position) SELECT json_extract(value,'$.id'),json_extract(value,'$.team_id'),json_extract(value,'$.name'),json_extract(value,'$.position') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)").bind(JSON.stringify(newPlayers),token)
    ]);
    return Response.json({revision,counts:plan.counts});
  }
  if(path==='/api/admin/seed' && request.method==='POST'){
    const payload=normalizeSeed(await readBody(request,1024*1024));
    const revision=await mutate(request,db,token=>[
      db.prepare("INSERT INTO tournaments(id,name,lineups,position) SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.lineups'),json_extract(value,'$.position') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)").bind(JSON.stringify(payload.tournaments),token),
      db.prepare("INSERT INTO teams(id,tournament_id,name,position) SELECT json_extract(value,'$.id'),json_extract(value,'$.tournament_id'),json_extract(value,'$.name'),json_extract(value,'$.position') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)").bind(JSON.stringify(payload.teams),token),
      db.prepare("INSERT INTO players(id,team_id,name,position,legacy_key) SELECT json_extract(value,'$.id'),json_extract(value,'$.team_id'),json_extract(value,'$.name'),json_extract(value,'$.position'),json_extract(value,'$.legacy_key') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)").bind(JSON.stringify(payload.players),token)
    ],{seed:true});
    return Response.json({revision,counts:Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,v.length]))});
  }
  const route=path.match(/^\/api\/admin\/(tournament|team|player)(?:\/([^/]+))?$/);
  if(!route)fail('接口不存在。',404);
  const kind=route[1],{table,parent}=entities[kind],id=route[2]&&identifier(decodeURIComponent(route[2]));
  if(request.method==='POST' && id==='reorder'){
    const body=await readBody(request),first=identifier(body.firstId),second=identifier(body.secondId);if(first===second)fail('请选择不同的记录。');
    const rows=(await db.prepare(`SELECT * FROM ${table} WHERE id IN (?,?)`).bind(first,second).all()).results;
    if(rows.length!==2)fail('记录已删除，请刷新名单。',404);
    if(parent && rows[0][parent]!==rows[1][parent])fail('只能调整同一上级下的顺序。');
    const revision=await mutate(request,db,token=>[db.prepare(`WITH ranked AS (SELECT id,row_number() OVER(ORDER BY position,id)-1 AS pos FROM ${table}${parent?` WHERE ${parent}=?`:''}),swapped AS (SELECT id,CASE id WHEN ? THEN (SELECT pos FROM ranked WHERE id=?) WHEN ? THEN (SELECT pos FROM ranked WHERE id=?) ELSE pos END AS pos FROM ranked) UPDATE ${table} SET position=(SELECT pos FROM swapped WHERE swapped.id=${table}.id) WHERE id IN (SELECT id FROM swapped) AND EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)`).bind(...(parent?[rows[0][parent]]:[]),first,second,second,first,token)]);
    return Response.json({revision});
  }
  if(request.method==='POST' && !id){
    const body=await readBody(request),value=name(body.name),newId=crypto.randomUUID(),parentId=parent?identifier(body[parent]):null;
    const columns=parent?'id,name,position,'+parent:'id,name,position,lineups';
    const revision=await mutate(request,db,token=>[db.prepare(`INSERT INTO ${table}(${columns}) SELECT ?,?,COALESCE(MAX(position),-1)+1,? FROM ${table}${parent?` WHERE ${parent}=?`:''} HAVING EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)`).bind(newId,value,parent?parentId:body.lineups===false?0:1,...(parent?[parentId]:[]),token)]);
    return Response.json({id:newId,revision}, {status:201});
  }
  if(!id)fail('请求方法不支持。',405);
  const record=await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first();if(!record)fail('记录不存在或已删除。',404);
  if(request.method==='PATCH'){
    const body=await readBody(request),changes=[],values=[];
    if(body.name!==undefined){changes.push('name=?');values.push(name(body.name));}
    if(kind==='tournament' && body.lineups!==undefined){if(typeof body.lineups!=='boolean')fail('首发设置无效。');changes.push('lineups=?');values.push(Number(body.lineups));}
    if(!changes.length)fail('没有需要保存的修改。');
    const revision=await mutate(request,db,token=>[db.prepare(`UPDATE ${table} SET ${changes.join(',')} WHERE id=? AND EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)`).bind(...values,id,token)]);
    return Response.json({id,revision});
  }
  if(request.method==='DELETE'){
    const revision=await mutate(request,db,token=>[db.prepare(`DELETE FROM ${table} WHERE id=? AND EXISTS(SELECT 1 FROM roster_state WHERE mutation_token=?)`).bind(id,token)]);
    return Response.json({id,revision});
  }
  fail('请求方法不支持。',405);
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin'),allowed=env.ALLOWED_ORIGIN||'https://zajuak.github.io',url=new URL(request.url);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin','Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, If-Match','Access-Control-Max-Age':'600'};
    let response;
    try{
      if(origin && origin!==allowed && origin!==url.origin)fail('请求来源不被允许。',403);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      response=await handleApi(request,env);
    }catch(error){
      const constraint=/UNIQUE constraint failed/i.test(error.message||''),invalid=/CHECK constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/i.test(error.message||'');
      const status=error.status||(constraint?409:invalid?400:503);
      response=Response.json({error:error.status?error.message:constraint?'同一层级内名称已存在。':invalid?'名单字段或所属关系无效。':'共享名单服务暂时不可用，请稍后重试。'},{status});
    }
    return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...headers}});
  }
};
