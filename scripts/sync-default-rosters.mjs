import {writeFile} from 'node:fs/promises';
import {normalizeRosterSnapshot} from '../src/rosters.mjs';
const base=process.env.MATCH_EDITOR_API_URL||'https://match-editor-api.junkaizhao404.workers.dev';
const response=await fetch(base.replace(/\/$/,'')+'/api/rosters',{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error('无法获取后台名单，未更新默认快照。');
const snapshot=normalizeRosterSnapshot(await response.json());
await writeFile(new URL('../src/data/default-rosters.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
console.log(`默认名单快照已更新：版本 ${snapshot.revision}，${snapshot.tournaments.length} 个赛事，${snapshot.tournaments.reduce((n,t)=>n+t.teams.reduce((n,t)=>n+t.players.length,0),0)} 名球员。`);
