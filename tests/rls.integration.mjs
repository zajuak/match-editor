import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createAdminApi} from '../src/admin-api.mjs';

const url=process.env.SUPABASE_URL,anonKey=process.env.SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(url && !['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('RLS 集成测试只允许本地数据库。');
if(!url || !anonKey || !serviceKey)throw new Error('RLS 测试需要 SUPABASE_URL、SUPABASE_ANON_KEY 和 SUPABASE_SERVICE_ROLE_KEY。');
const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const suffix=crypto.randomUUID(),password=`Test-${crypto.randomUUID()}-Password!`;
const users=[];
const makeClient=()=>createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
async function createUser(role){
  const email=`rls-${role}-${suffix}@example.test`;
  const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;
  users.push(data.user.id);
  const client=makeClient(),login=await client.auth.signInWithPassword({email,password});if(login.error)throw login.error;
  return {id:data.user.id,client};
}
async function main(){
  const ordinary=await createUser('ordinary'),admin=await createUser('admin');
  const {error:whitelistError}=await service.from('admin_users').insert({user_id:admin.id,role:'admin'});if(whitelistError)throw whitelistError;
  const anon=makeClient(),api=createAdminApi(admin.client);
  try{
    const publicRead=await anon.from('tournaments').select('id');assert.ifError(publicRead.error);
    const anonymousWrite=await anon.from('tournaments').insert({name:`匿名-${suffix}`});assert.ok(anonymousWrite.error,'anonymous insert must fail');
    assert.equal((await ordinary.client.rpc('is_admin')).data,false);assert.equal((await admin.client.rpc('is_admin')).data,true);
    const whitelistRead=await ordinary.client.from('admin_users').select('user_id');assert.ok(whitelistRead.error,'admin whitelist must not be readable');
    const selfGrant=await ordinary.client.from('admin_users').insert({user_id:ordinary.id,role:'admin'});assert.ok(selfGrant.error,'ordinary user must not grant themselves admin');
    const ordinaryWrite=await ordinary.client.from('tournaments').insert({name:`普通-${suffix}`});assert.ok(ordinaryWrite.error,'ordinary authenticated insert must fail');
    const seed=await ordinary.client.rpc('seed_rosters',{payload:{tournaments:[],teams:[],players:[]}});assert.ok(seed.error,'authenticated user must not execute seed RPC');

    const tournamentName=`权限测试-${suffix}`,created=await admin.client.from('tournaments').insert({name:tournamentName,lineups:true,position:9000}).select('id').single();assert.ifError(created.error);
    const tournamentId=created.data.id;
    try{
      await api.createTeam(tournamentId,'API 球队');
      const apiTeam=await admin.client.from('teams').select('id').eq('tournament_id',tournamentId).eq('name','API 球队').single();assert.ifError(apiTeam.error);
      await api.createPlayer(apiTeam.data.id,'API 球员');
      const apiPlayer=await admin.client.from('players').select('id').eq('team_id',apiTeam.data.id).single();assert.ifError(apiPlayer.error);
      await api.renameTeam(apiTeam.data.id,'API 新球队');await api.renamePlayer(apiPlayer.data.id,'API 新姓名');
      await api.updateTournament(tournamentId,{name:tournamentName,lineups:false});
      await api.deletePlayer(apiPlayer.data.id);await api.deleteTeam(apiTeam.data.id);
      const team=await admin.client.from('teams').insert({tournament_id:tournamentId,name:'测试球队',position:0}).select('id').single();assert.ifError(team.error);
      const duplicate=await admin.client.from('teams').insert({tournament_id:tournamentId,name:'测试球队',position:1});assert.ok(duplicate.error,'duplicate team name must fail');
      const player=await admin.client.from('players').insert({team_id:team.data.id,name:'测试球员',position:0}).select('id').single();assert.ifError(player.error);
      const otherTeam=await admin.client.from('teams').insert({tournament_id:tournamentId,name:'另一球队',position:0}).select('id').single();assert.ifError(otherTeam.error);
      const player2=await admin.client.from('players').insert({team_id:team.data.id,name:'第二球员',position:0}).select('id').single();assert.ifError(player2.error);
      await api.reorderTeams(team.data.id,otherTeam.data.id);
      await Promise.all([api.reorderPlayers(player.data.id,player2.data.id),api.reorderPlayers(player.data.id,player2.data.id)]);
      const order=await admin.client.from('players').select('position').eq('team_id',team.data.id).order('position');assert.ifError(order.error);assert.deepEqual(order.data.map(p=>p.position),[0,1]);
      const outsider=await admin.client.from('players').insert({team_id:otherTeam.data.id,name:'其他队球员',position:0}).select('id').single();assert.ifError(outsider.error);
      await assert.rejects(api.reorderPlayers(player.data.id,outsider.data.id),/同一上级/);
      assert.ok((await ordinary.client.rpc('reorder_roster_records',{kind:'team',first_id:team.data.id,second_id:otherTeam.data.id})).error);
      assert.ok((await anon.rpc('reorder_roster_records',{kind:'team',first_id:team.data.id,second_id:otherTeam.data.id})).error);
      for(const table of ['tournaments','teams','players']){
        const id=table==='tournaments'?tournamentId:table==='teams'?team.data.id:player.data.id;
        const write=await ordinary.client.from(table).update({name:'未授权改名'}).eq('id',id).select('id');assert.ifError(write.error);assert.equal(write.data.length,0);
        const deletion=await ordinary.client.from(table).delete().eq('id',id).select('id');assert.ifError(deletion.error);assert.equal(deletion.data.length,0);
        const row=await admin.client.from(table).select('name').eq('id',id).single();assert.ifError(row.error);assert.notEqual(row.data.name,'未授权改名');
      }
      const renamed=await admin.client.from('players').update({name:'新姓名'}).eq('id',player.data.id).select('id,name').single();assert.ifError(renamed.error);assert.equal(renamed.data.id,player.data.id);assert.equal(renamed.data.name,'新姓名');
      assert.ifError((await admin.client.from('tournaments').delete().eq('id',tournamentId)).error);
      assert.ifError((await service.from('admin_users').delete().eq('user_id',admin.id)).error);
      await assert.rejects(api.createTournament(`已撤销-${suffix}`),/无管理员权限/);
      const revoked=await admin.client.from('tournaments').insert({name:`撤销权限-${suffix}`});assert.ok(revoked.error,'revoked administrator must lose write access immediately');
    }finally{
      await service.from('tournaments').delete().eq('id',tournamentId);
    }
    const cascade=await service.from('teams').select('id',{head:true,count:'exact'}).eq('tournament_id',tournamentId);assert.ifError(cascade.error);assert.equal(cascade.count,0);
    console.log('RLS 集成验证通过：匿名/普通用户只读，管理员 CRUD、唯一约束、级联删除和权限撤销均有效。');
  }finally{
    await service.from('admin_users').delete().eq('user_id',admin.id);
    await service.from('tournaments').delete().ilike('name',`%-${suffix}`);
    for(const id of users)await service.auth.admin.deleteUser(id);
  }
}
main().catch(error=>{console.error(`RLS 集成验证失败：${error.message}`);process.exitCode=1;});
