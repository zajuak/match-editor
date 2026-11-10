import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { key, normalizeRosterRecord, validateRecords } from '../src/core.mjs';
import {RosterClient} from '../src/api-client.mjs';

const DATA_ROOT = new URL('../src/data/', import.meta.url);
const WOMENS_TOURNAMENT = '2026-27北大杯女子足球赛';
export const EXPECTED_SEED_COUNTS = Object.freeze({ tournaments: 2, teams: 26, players: 626 });

const trimmed = value => String(value ?? '').trim();

export function buildSeedPayload(manifest, rosterDocuments) {
  if (!manifest || !Array.isArray(manifest.tournaments) || !manifest.tournaments.length) {
    throw new Error('名单清单必须包含 tournaments 数组。');
  }
  if (!Array.isArray(rosterDocuments) || rosterDocuments.length !== manifest.tournaments.length) {
    throw new Error('名单文件数量必须与清单中的赛事数量一致。');
  }

  const tournamentNames = new Set();
  const normalizedGroups = manifest.tournaments.map((entry, tournamentIndex) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new Error(`清单第 ${tournamentIndex + 1} 项缺少有效赛事名称。`);
    }
    const tournament = trimmed(normalizeRosterRecord({ tournament: entry.name, team: '', name: '' }).tournament);
    if (tournamentNames.has(tournament)) throw new Error(`清单中存在重复赛事“${tournament}”。`);
    tournamentNames.add(tournament);

    const roster = rosterDocuments[tournamentIndex];
    if (!Array.isArray(roster)) throw new Error(`赛事“${tournament}”的名单文件必须是 JSON 数组。`);
    const records = roster.map((raw, rowIndex) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`赛事“${tournament}”第 ${rowIndex + 1} 行不是有效球员对象。`);
      }
      const normalized = normalizeRosterRecord({ ...raw, tournament });
      return {
        tournament: trimmed(normalized.tournament),
        team: trimmed(normalized.team),
        name: trimmed(normalized.name),
        number: normalized.number ?? '',
        sourceRow: raw.sourceRow ?? rowIndex + 1,
      };
    });
    return { tournament, lineups: entry.lineups !== false, records };
  });

  validateRecords(normalizedGroups.flatMap(group => group.records));

  const payload = { tournaments: [], teams: [], players: [] };
  normalizedGroups.forEach((group, tournamentPosition) => {
    payload.tournaments.push({
      name: group.tournament,
      lineups: group.lineups,
      position: tournamentPosition,
    });

    const teamPositions = new Map();
    const playerPositions = new Map();
    for (const record of group.records) {
      if (!teamPositions.has(record.team)) {
        teamPositions.set(record.team, teamPositions.size);
        playerPositions.set(record.team, 0);
        payload.teams.push({
          tournament_name: group.tournament,
          name: record.team,
          position: teamPositions.get(record.team),
        });
      }
      const position = playerPositions.get(record.team);
      payload.players.push({
        tournament_name: group.tournament,
        team_name: record.team,
        name: record.name,
        position,
        legacy_key: key(record.tournament, record.team, record.name),
      });
      playerPositions.set(record.team, position + 1);
    }
  });
  return payload;
}

export function assertExpectedSeed(payload) {
  const actual = Object.fromEntries(
    Object.keys(EXPECTED_SEED_COUNTS).map(table => [table, payload?.[table]?.length]),
  );
  for (const [table, expected] of Object.entries(EXPECTED_SEED_COUNTS)) {
    if (actual[table] !== expected) {
      throw new Error(
        `名单数量校验失败：应为 ${EXPECTED_SEED_COUNTS.tournaments} 赛事、`
        + `${EXPECTED_SEED_COUNTS.teams} 球队、${EXPECTED_SEED_COUNTS.players} 球员；`
        + `实际为 ${actual.tournaments ?? 0} 赛事、${actual.teams ?? 0} 球队、${actual.players ?? 0} 球员。`,
      );
    }
  }
  const womens = payload.tournaments.find(tournament => tournament.name === WOMENS_TOURNAMENT);
  if (!womens || womens.lineups !== false) {
    throw new Error(`赛事“${WOMENS_TOURNAMENT}”必须存在且 lineups=false。`);
  }
  return payload;
}

async function readJson(url, description) {
  let text;
  try {
    text = await readFile(url, 'utf8');
  } catch (error) {
    throw new Error(`无法读取${description}：${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${description}不是有效 JSON：${error.message}`);
  }
}

async function loadSeedPayload() {
  const manifest = await readJson(new URL('manifest.json', DATA_ROOT), '名单清单 manifest.json');
  if (!manifest || !Array.isArray(manifest.tournaments)) {
    throw new Error('名单清单必须包含 tournaments 数组。');
  }
  const rosterDocuments = await Promise.all(manifest.tournaments.map((entry, index) => {
    if (!entry || typeof entry.roster !== 'string' || !entry.roster.trim()) {
      throw new Error(`清单第 ${index + 1} 项缺少名单文件路径。`);
    }
    return readJson(new URL(entry.roster, DATA_ROOT), `名单文件 ${entry.roster}`);
  }));
  return assertExpectedSeed(buildSeedPayload(manifest, rosterDocuments));
}

export async function importRosters(){
  const url=process.env.MATCH_EDITOR_API_URL,passwordFile=process.env.MATCH_EDITOR_ADMIN_PASSWORD_FILE;
  if(!url || !passwordFile)throw new Error('请设置 MATCH_EDITOR_API_URL 和本机 MATCH_EDITOR_ADMIN_PASSWORD_FILE。');
  const password=(await readFile(passwordFile,'utf8')).trim();
  const payload=process.env.MATCH_EDITOR_ROSTER_FILE?JSON.parse(await readFile(process.env.MATCH_EDITOR_ROSTER_FILE,'utf8')):await loadSeedPayload();
  assertExpectedSeed(payload);
  const client=new RosterClient(url,{storage:null});
  await client.login(password);
  try{
    await client.getRosters();
    const result=await client.request('/api/admin/seed',{method:'POST',body:payload,write:true});
    const stored=await client.getRosters();
    const counts={tournaments:stored.tournaments.length,teams:stored.tournaments.reduce((n,t)=>n+t.teams.length,0),players:stored.tournaments.reduce((n,t)=>n+t.teams.reduce((n,t)=>n+t.players.length,0),0)};
    for(const [table,expected] of Object.entries(EXPECTED_SEED_COUNTS))if(counts[table]!==expected || result.counts[table]!==expected)throw new Error('导入数量不符，请检查数据库。');
    console.log(`名单导入完成：${counts.tournaments} 赛事、${counts.teams} 球队、${counts.players} 球员。`);
  }finally{await client.logout();}
}
const invokedUrl=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:'';
if(import.meta.url===invokedUrl)importRosters().catch(error=>{console.error(`名单导入失败：${error.message}`);process.exitCode=1;});
