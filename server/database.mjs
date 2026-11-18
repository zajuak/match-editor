import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {normalizeRosterSnapshot} from '../src/rosters.mjs';

export function d1Database(sqlite){
  function prepare(sql,values=[]){
    const execute=()=>({results:sqlite.prepare(sql).all(...values),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)},success:true});
    return {bind:(...args)=>prepare(sql,args),all:async()=>execute(),first:async()=>execute().results[0]||null,run:async()=>execute(),execute};
  }
  return {prepare,batch:async statements=>{
    sqlite.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(statement=>statement.execute());sqlite.exec('COMMIT');return results;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
}

export async function openDatabase(filename,{seedFile}={}){
  const sqlite=new DatabaseSync(filename);
  try{
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version=sqlite.prepare('PRAGMA user_version').get().user_version;
    if(version>1)throw new Error('数据库版本高于当前程序，拒绝启动。');
    if(version===0){
      const migration=await readFile(new URL('../cloudflare/migrations/0001_rosters.sql',import.meta.url),'utf8');
      sqlite.exec(`BEGIN IMMEDIATE;${migration}\nPRAGMA user_version=1;COMMIT;`);
    }
    const state=sqlite.prepare('SELECT revision FROM roster_state WHERE id=1').get();
    const count=sqlite.prepare('SELECT (SELECT count(*) FROM tournaments)+(SELECT count(*) FROM teams)+(SELECT count(*) FROM players) AS n').get().n;
    if(state.revision===0 && count===0){
      if(!seedFile)throw new Error('空数据库需要 SEED_FILE 指定初始名单快照。');
      const seed=normalizeRosterSnapshot(JSON.parse(await readFile(seedFile,'utf8')));
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const tournament=sqlite.prepare('INSERT INTO tournaments(id,name,lineups,position) VALUES(?,?,?,?)');
        const team=sqlite.prepare('INSERT INTO teams(id,tournament_id,name,position) VALUES(?,?,?,?)');
        const player=sqlite.prepare('INSERT INTO players(id,team_id,name,position,legacy_key) VALUES(?,?,?,?,?)');
        for(const t of seed.tournaments){
          tournament.run(t.id,t.name,Number(t.lineups),t.position);
          for(const item of t.teams){
            team.run(item.id,t.id,item.name,item.position);
            for(const p of item.players)player.run(p.id,item.id,p.name,p.position,p.legacy_key||null);
          }
        }
        sqlite.prepare('UPDATE roster_state SET revision=? WHERE id=1').run(seed.revision);
        sqlite.exec('COMMIT');
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }
    return {...d1Database(sqlite),close:()=>sqlite.close()};
  }catch(error){sqlite.close();throw error;}
}
