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
export async function loadSharedRosters(client) {
  const data=await client.getRosters();
  return {...mapSharedRosters(data.tournaments),revision:data.revision};
}
