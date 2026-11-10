import {validateRecords} from './core.mjs';
const byPosition=(a,b)=>(a.position??0)-(b.position??0)||String(a.id).localeCompare(String(b.id));
function validName(value,label) {
  if(typeof value!=='string' || !value.trim() || value.trim().length>80)throw new Error(`共享名单包含无效的${label}。`);
  return value.trim();
}
export function mapSharedRosters(input) {
  if(!Array.isArray(input))throw new Error('共享名单返回格式不正确。');
  const records=[],tournaments=[],naturalKeys=new Set();
  for(const row of [...input].sort(byPosition)){
    const tournament={id:validName(row.id,'赛事标识'),name:validName(row.name,'赛事名称'),lineups:row.lineups!==false,teams:[]};
    if(row.teams!=null && !Array.isArray(row.teams))throw new Error(`${tournament.name} 的球队格式不正确。`);
    for(const teamRow of [...(row.teams||[])].sort(byPosition)){
      const team={id:validName(teamRow.id,'球队标识'),name:validName(teamRow.name,'球队名称')};
      tournament.teams.push(team);
      if(teamRow.players!=null && !Array.isArray(teamRow.players))throw new Error(`${team.name} 的球员格式不正确。`);
      for(const player of [...(teamRow.players||[])].sort(byPosition)){
        const record={id:validName(player.id,'球员标识'),tournamentId:tournament.id,teamId:team.id,tournament:tournament.name,team:team.name,name:validName(player.name,'球员姓名'),number:'',legacyKey:player.legacy_key||''};
        const naturalKey=JSON.stringify([record.tournamentId,record.teamId,record.name]);
        if(naturalKeys.has(naturalKey))throw new Error(`${record.team} 存在重复姓名“${record.name}”。`);
        naturalKeys.add(naturalKey);records.push(record);
      }
    }
    tournaments.push(tournament);
  }
  validateRecords(records);
  return {records,tournaments};
}
export async function loadSharedRosters(client,{storage}={}) {
  const data=normalizeRosterSnapshot(await client.getRosters());
  cacheSharedRosters(data,storage);
  return mappedSnapshot(data);
}

export const ROSTER_CACHE_KEY='match-editor-rosters-cache-v1';
const snapshotURL=new URL('./data/default-rosters.json',import.meta.url);
snapshotURL.search=new URL(import.meta.url).search;
function localStorageOrNull(storage){
  if(storage!==undefined)return storage;
  try{return globalThis.localStorage;}catch{return null;}
}
export function normalizeRosterSnapshot(input){
  if(!input || (input.version!==undefined && input.version!==1) || !Number.isSafeInteger(input.revision) || input.revision<0)throw new Error('默认名单版本无效。');
  mapSharedRosters(input.tournaments);
  return {version:1,revision:input.revision,tournaments:[...input.tournaments].sort(byPosition).map((t,i)=>({
    id:t.id,name:t.name.trim(),lineups:t.lineups!==false,position:i,
    teams:[...(t.teams||[])].sort(byPosition).map((team,j)=>({id:team.id,name:team.name.trim(),position:j,
      players:[...(team.players||[])].sort(byPosition).map((p,k)=>({id:p.id,name:p.name.trim(),position:k,legacy_key:typeof p.legacy_key==='string' && p.legacy_key.length<=1000?p.legacy_key:''}))
    }))
  }))};
}
export function readCachedRosters(storage){
  try{const value=localStorageOrNull(storage)?.getItem(ROSTER_CACHE_KEY);return value?normalizeRosterSnapshot(JSON.parse(value)):null;}catch{return null;}
}
export function cacheSharedRosters(data,storage){
  const snapshot=normalizeRosterSnapshot(data),target=localStorageOrNull(storage),cached=readCachedRosters(target);
  if(cached && cached.revision>snapshot.revision)return cached;
  try{target?.setItem(ROSTER_CACHE_KEY,JSON.stringify(snapshot));}catch{}
  return snapshot;
}
export function mappedSnapshot(snapshot){return {...mapSharedRosters(snapshot.tournaments),revision:snapshot.revision};}
export async function loadDefaultRosters({fetcher=globalThis.fetch,storage,url=snapshotURL}={}){
  let published;
  try{
    const response=await fetcher(url);
    if(!response.ok)throw new Error('默认名单读取失败。');
    published=normalizeRosterSnapshot(await response.json());
  }catch(error){
    const cached=readCachedRosters(storage);if(cached)return mappedSnapshot(cached);
    throw new Error('默认名单读取失败，请刷新页面或重试。');
  }
  return mappedSnapshot(cacheSharedRosters(published,storage));
}
