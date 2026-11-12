// Shared preview/server validation. Identity is matched by exact name within a team.
function importName(value,label){
  if(typeof value!=='string' || !value.trim() || value.trim().length>80 || /\d{7,}|[\u0000-\u001f\u007f]/.test(value))throw new Error(`${label}无效（需为 1–80 个字符，不能包含长数字或控制字符）。`);
  return value.trim();
}
export function planRegistrationImport(tournament,entries,mode='merge'){
  if(!tournament)throw new Error('赛事不存在，请刷新名单后重试。');
  if(!['merge','replace'].includes(mode))throw new Error('名单更新方式无效。');
  if(!Array.isArray(entries) || !entries.length || entries.length>50)throw new Error('每次只能导入 1–50 支球队。');
  const seen=new Set();let total=0;
  const teams=entries.map(entry=>{
    if(!entry || typeof entry!=='object')throw new Error('球队名单格式无效。');
    const existing=entry.teamId?tournament.teams.find(t=>t.id===entry.teamId):null;
    if(entry.teamId && !existing)throw new Error('目标球队不属于当前赛事，请重新选择。');
    const name=existing?.name||importName(entry.name,'球队名称');
    if(!existing && tournament.teams.some(t=>t.name===name))throw new Error(`球队“${name}”已存在，请选择更新该球队。`);
    const key=existing?`id:${existing.id}`:`name:${name}`;
    if(seen.has(key))throw new Error(`球队“${name}”对应多份报名表，请合并为一份后重试。`);
    seen.add(key);
    if(!Array.isArray(entry.players) || !entry.players.length || entry.players.length>300)throw new Error(`${name}的报名表需包含 1–300 名球员。`);
    const names=entry.players.map(value=>importName(value,'球员姓名'));
    if(new Set(names).size!==names.length)throw new Error(`${name}存在重复姓名，同名球员请添加区分。`);
    total+=names.length;
    const previous=existing?.players||[],byName=new Map(previous.map(p=>[p.name,p]));
    const added=names.filter(n=>!byName.has(n)),kept=names.filter(n=>byName.has(n));
    const removed=mode==='replace'?previous.filter(p=>!names.includes(p.name)):[];
    const finalNames=mode==='replace'?names:[...previous.map(p=>p.name),...added];
    return {teamId:existing?.id||null,name,added,kept,removed,players:finalNames.map(n=>byName.get(n)||{name:n})};
  });
  if(total>5000)throw new Error('每次最多导入 5000 名球员。');
  return {teams,counts:{teams:teams.length,newTeams:teams.filter(t=>!t.teamId).length,added:teams.reduce((s,t)=>s+t.added.length,0),kept:teams.reduce((s,t)=>s+t.kept.length,0),removed:teams.reduce((s,t)=>s+t.removed.length,0)}};
}
