const ENTITY = {
  tournament: {table: 'tournaments', label: '赛事'},
  team: {table: 'teams', label: '球队', parentKey: 'tournament_id'},
  player: {table: 'players', label: '球员', parentKey: 'team_id'},
};

export function escapeXML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function validateName(value, label = '名称') {
  const name = String(value ?? '').trim();
  if (!name || name.length > 80) throw new Error(`${label}需为 1–80 个字符，且不能只包含空白。`);
  return name;
}

export function readableError(error, action = '操作失败') {
  if (!error) return new Error(`${action}，请稍后重试。`);
  const original = String(error.message || error).trim();
  const code = String(error.code || '');
  const rls = code === '42501' || /row[- ]level security|permission denied|not authorized|\brls\b/i.test(original);
  let message;
  if (code === '23505') {
    message = `${action}：名称或唯一字段已存在（唯一约束 23505）。${original}`;
  } else if (rls) {
    message = `${action}：没有管理员权限，或操作被行级安全策略（RLS${code ? ` ${code}` : ''}）拒绝。${original}`;
  } else if (code === 'PGRST116') {
    message = `${action}：记录不存在、已被删除或当前账号无权操作（PGRST116）。${original}`;
  } else if (code === 'invalid_credentials') {
    message = `${action}：邮箱或密码错误。${original}`;
  } else {
    message = `${action}${original ? `：${original}` : '，请稍后重试。'}`;
  }
  const result = new Error(message);
  result.cause = error;
  for (const key of ['code', 'details', 'hint', 'status', 'constraint']) {
    if (error[key] != null) result[key] = error[key];
  }
  return result;
}

function entityDefinition(kind) {
  const definition = ENTITY[kind];
  if (!definition) throw new Error('未知的名单记录类型。');
  return definition;
}

function requiredId(value, label = '记录标识') {
  const id = String(value ?? '').trim();
  if (!id) throw new Error(`缺少${label}。`);
  return id;
}

export async function isAdmin(client) {
  if (!client?.rpc) throw new Error('共享名单服务尚未就绪。');
  const {data, error} = await client.rpc('is_admin');
  if (error) throw readableError(error, '管理员权限检查失败');
  return data === true;
}

export async function requireAdmin(client) {
  if (!(await isAdmin(client))) {
    const error = new Error('当前账号无管理员权限，无法修改共享名单。');
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }
}

async function nextPosition(client, definition, parentId) {
  let query = client.from(definition.table).select('position');
  if (definition.parentKey) query = query.eq(definition.parentKey, requiredId(parentId, '上级记录标识'));
  const {data, error} = await query.order('position', {ascending: false}).limit(1);
  if (error) throw readableError(error, `读取${definition.label}排序位置失败`);
  const last = Array.isArray(data) && data.length ? Number(data[0].position) : -1;
  if (!Number.isSafeInteger(last) || last < -1) throw new Error(`${definition.label}排序位置格式不正确。`);
  return last + 1;
}

async function insertRecord(client, kind, payload) {
  const definition = entityDefinition(kind);
  await requireAdmin(client);
  const position = await nextPosition(client, definition, payload[definition.parentKey]);
  const {error} = await client.from(definition.table).insert({...payload, position});
  if (error) throw readableError(error, `新增${definition.label}失败`);
}

async function updateRecord(client, kind, id, changes, action) {
  const definition = entityDefinition(kind);
  const recordId = requiredId(id);
  await requireAdmin(client);
  const {data, error} = await client.from(definition.table).update(changes).eq('id', recordId).select('id');
  if (error) throw readableError(error, action || `修改${definition.label}失败`);
  if (Array.isArray(data) && data.length === 0) throw new Error(`${definition.label}不存在、已被删除或当前账号无权修改。`);
}

async function deleteRecord(client, kind, id) {
  const definition = entityDefinition(kind);
  const recordId = requiredId(id);
  await requireAdmin(client);
  const {data, error} = await client.from(definition.table).delete().eq('id', recordId).select('id');
  if (error) throw readableError(error, `删除${definition.label}失败`);
  if (Array.isArray(data) && data.length === 0) throw new Error(`${definition.label}不存在、已被删除或当前账号无权删除。`);
}

async function swapPositions(client, kind, firstId, secondId) {
  const definition = entityDefinition(kind);
  const first = requiredId(firstId);
  const second = requiredId(secondId);
  if (first === second) throw new Error('请选择两条不同的记录进行排序。');
  await requireAdmin(client);
  const {error} = await client.rpc('reorder_roster_records', {kind, first_id:first, second_id:second});
  if (error) throw readableError(error, `调整${definition.label}顺序失败`);
}

export function createAdminApi(client) {
  return {
    checkAdmin: () => isAdmin(client),

    createTournament: (name, lineups = true) => insertRecord(client, 'tournament', {
      name: validateName(name, '赛事名称'), lineups: Boolean(lineups),
    }),
    createTeam: (tournamentId, name) => insertRecord(client, 'team', {
      tournament_id: requiredId(tournamentId, '赛事标识'), name: validateName(name, '球队名称'),
    }),
    createPlayer: (teamId, name) => insertRecord(client, 'player', {
      team_id: requiredId(teamId, '球队标识'), name: validateName(name, '球员姓名'),
    }),

    updateTournament: async (id, {name, lineups} = {}) => {
      const changes = {};
      if (name !== undefined) changes.name = validateName(name, '赛事名称');
      if (lineups !== undefined) changes.lineups = Boolean(lineups);
      if (!Object.keys(changes).length) throw new Error('没有需要保存的赛事修改。');
      await updateRecord(client, 'tournament', id, changes, '保存赛事失败');
    },
    renameTournament: (id, name) => updateRecord(client, 'tournament', id, {
      name: validateName(name, '赛事名称'),
    }, '赛事改名失败'),
    setTournamentLineups: (id, lineups) => updateRecord(client, 'tournament', id, {
      lineups: Boolean(lineups),
    }, '设置首发阵容失败'),
    renameTeam: (id, name) => updateRecord(client, 'team', id, {
      name: validateName(name, '球队名称'),
    }, '球队改名失败'),
    renamePlayer: (id, name) => updateRecord(client, 'player', id, {
      name: validateName(name, '球员姓名'),
    }, '球员改名失败'),

    deleteTournament: id => deleteRecord(client, 'tournament', id),
    deleteTeam: id => deleteRecord(client, 'team', id),
    deletePlayer: id => deleteRecord(client, 'player', id),

    reorderTournaments: (firstId, secondId) => swapPositions(client, 'tournament', firstId, secondId),
    reorderTeams: (firstId, secondId) => swapPositions(client, 'team', firstId, secondId),
    reorderPlayers: (firstId, secondId) => swapPositions(client, 'player', firstId, secondId),
  };
}
