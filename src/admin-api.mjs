export function escapeXML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function validateName(value,label='名称'){
  const name=String(value??'').trim();if(!name || name.length>80)throw new Error(`${label}需为 1–80 个字符，且不能只包含空白。`);return name;
}
export function readableError(error,action='操作失败'){return new Error(error?.message||`${action}，请稍后重试。`);}
const id=value=>{if(typeof value!=='string'||!value)throw new Error('缺少记录标识。');return encodeURIComponent(value);};
export function createAdminApi(client){
  const create=(kind,body)=>client.request(`/api/admin/${kind}`,{method:'POST',body,write:true});
  const patch=(kind,recordId,body)=>client.request(`/api/admin/${kind}/${id(recordId)}`,{method:'PATCH',body,write:true});
  const remove=(kind,recordId)=>client.request(`/api/admin/${kind}/${id(recordId)}`,{method:'DELETE',write:true});
  const reorder=(kind,firstId,secondId)=>client.request(`/api/admin/${kind}/reorder`,{method:'POST',body:{firstId,secondId},write:true});
  return {
    checkAdmin:async()=>Boolean(await client.getSession()),
    createTournament:(name,lineups=true)=>create('tournament',{name:validateName(name,'赛事名称'),lineups}),
    createTeam:(tournament_id,name)=>create('team',{tournament_id,name:validateName(name,'球队名称')}),
    createPlayer:(team_id,name)=>create('player',{team_id,name:validateName(name,'球员姓名')}),
    updateTournament:(recordId,{name,lineups}={})=>patch('tournament',recordId,{...(name===undefined?{}:{name:validateName(name,'赛事名称')}),...(lineups===undefined?{}:{lineups})}),
    renameTournament:(recordId,name)=>patch('tournament',recordId,{name:validateName(name,'赛事名称')}),
    setTournamentLineups:(recordId,lineups)=>patch('tournament',recordId,{lineups}),
    renameTeam:(recordId,name)=>patch('team',recordId,{name:validateName(name,'球队名称')}),
    renamePlayer:(recordId,name)=>patch('player',recordId,{name:validateName(name,'球员姓名')}),
    deleteTournament:recordId=>remove('tournament',recordId),deleteTeam:recordId=>remove('team',recordId),deletePlayer:recordId=>remove('player',recordId),
    reorderTournaments:(first,second)=>reorder('tournament',first,second),reorderTeams:(first,second)=>reorder('team',first,second),reorderPlayers:(first,second)=>reorder('player',first,second)
  };
}
