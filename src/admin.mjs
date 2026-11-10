import {rosterClient} from './api-client.mjs';
import {loadSharedRosters} from './rosters.mjs';
import {createAdminApi, escapeXML, readableError, validateName} from './admin-api.mjs';

const $ = id => document.getElementById(id);
const labels = {tournament: '赛事', team: '球队', player: '球员'};
const nameLabels = {tournament: '赛事名称', team: '球队名称', player: '球员姓名'};
const views = ['loading-view', 'auth-view', 'denied-view', 'admin-view'];

let client;
let api;
let session = null;
let tournaments = [];
let records = [];
let selectedTournamentId = '';
let selectedTeamId = '';
let playerSearch = '';
let pending = false;
let authPending = false;
let dialogPending = false;
let dialogContext = null;
let operationMessage = '';
let toastTimer;
let sessionRevision = 0;

function showView(id) {
  for (const view of views) $(view).hidden = view !== id;
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  const toast = $('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#9f414b' : '';
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 6500 : 3200);
}

function updateAccount() {
  $('session-label').textContent = session?.user?.name || (session ? '已登录' : '');
  $('logout').hidden = !session;
  $('logout').disabled = authPending;
}

function setAuthPending(value) {
  authPending = value;
  $('login-submit').disabled = value;
  $('login-submit').textContent = value ? '请稍候…' : '登录';
  $('password').disabled = value;
  $('retry-access').disabled = value;
  updateAccount();
}

function selectedTournament() {
  return tournaments.find(tournament => tournament.id === selectedTournamentId) || null;
}

function selectedTeam() {
  return selectedTournament()?.teams.find(team => team.id === selectedTeamId) || null;
}

function itemsFor(kind) {
  if (kind === 'tournament') return tournaments;
  if (kind === 'team') return selectedTournament()?.teams || [];
  const teamId = selectedTeamId;
  return teamId ? records.filter(record => record.teamId === teamId) : [];
}

function itemFor(kind, id) {
  return itemsFor(kind).find(item => item.id === id) || null;
}

function rosterSummary() {
  const teamCount = tournaments.reduce((sum, tournament) => sum + tournament.teams.length, 0);
  return `共 ${tournaments.length} 个赛事、${teamCount} 支球队、${records.length} 名球员。`;
}

function actionButtons(kind, item, index, length, reorderDisabled) {
  const id = escapeXML(item.id);
  const name = escapeXML(item.name);
  const escapedKind = escapeXML(kind);
  const disabled = pending ? ' disabled' : '';
  const moveDisabled = pending || reorderDisabled ? ' disabled' : '';
  return `<div class="record-actions">
    <button class="icon-button" type="button" data-action="up" data-kind="${escapedKind}" data-id="${id}" aria-label="上移${escapeXML(labels[kind])} ${name}" title="上移"${moveDisabled || index === 0 ? ' disabled' : ''}>↑</button>
    <button class="icon-button" type="button" data-action="down" data-kind="${escapedKind}" data-id="${id}" aria-label="下移${escapeXML(labels[kind])} ${name}" title="下移"${moveDisabled || index === length - 1 ? ' disabled' : ''}>↓</button>
    <button class="icon-button rename" type="button" data-action="rename" data-kind="${escapedKind}" data-id="${id}" aria-label="编辑${escapeXML(labels[kind])} ${name}" title="编辑"${disabled}>改</button>
    <button class="icon-button delete" type="button" data-action="delete" data-kind="${escapedKind}" data-id="${id}" aria-label="删除${escapeXML(labels[kind])} ${name}" title="删除"${disabled}>删</button>
  </div>`;
}

function renderPanel(kind) {
  const allItems = itemsFor(kind);
  const query = kind === 'player' ? playerSearch.trim().toLocaleLowerCase() : '';
  const visibleItems = query ? allItems.filter(item => item.name.toLocaleLowerCase().includes(query)) : allItems;
  const selectedId = kind === 'tournament' ? selectedTournamentId : kind === 'team' ? selectedTeamId : '';
  const html = visibleItems.map(item => {
    const actualIndex = allItems.findIndex(candidate => candidate.id === item.id);
    const selected = item.id === selectedId;
    let meta = '共享球员名单';
    if (kind === 'tournament') {
      const playerCount = records.filter(record => record.tournamentId === item.id).length;
      meta = `${item.teams.length} 支球队 · ${playerCount} 名球员 · ${item.lineups ? '启用首发' : '不显示首发'}`;
    } else if (kind === 'team') {
      meta = `${records.filter(record => record.teamId === item.id).length} 名球员`;
    }
    const detail = `<span class="record-name">${escapeXML(item.name)}</span><small class="record-meta">${escapeXML(meta)}</small>`;
    const control = kind === 'player'
      ? `<div class="record-select record-static">${detail}</div>`
      : `<button class="record-select" type="button" data-action="select" data-kind="${escapeXML(kind)}" data-id="${escapeXML(item.id)}" aria-pressed="${selected}"${pending ? ' disabled' : ''}>${detail}</button>`;
    return `<div class="admin-record${selected ? ' selected' : ''}">
      ${control}
      ${actionButtons(kind, item, actualIndex, allItems.length, Boolean(query))}
    </div>`;
  }).join('');
  let empty = `暂无${labels[kind]}，可点击上方按钮新增。`;
  if (kind === 'team' && !selectedTournament()) empty = '请先在左侧选择赛事。';
  if (kind === 'player' && !selectedTeam()) empty = '请先选择球队。';
  if (query && allItems.length) empty = '未找到匹配的球员，请更换搜索词。';
  $(`${kind}-list`).innerHTML = html || `<p class="admin-empty">${escapeXML(empty)}</p>`;
}

function renderAll() {
  document.body.setAttribute('aria-busy', String(pending));
  renderPanel('tournament');
  renderPanel('team');
  renderPanel('player');

  const tournament = selectedTournament();
  const team = selectedTeam();
  $('team-context').textContent = tournament
    ? `所属赛事：${tournament.name}（${tournament.teams.length} 支球队）`
    : '请先选择赛事。';
  $('player-context').textContent = team ? `所属球队：${team.name}` : '请先选择球队。';
  $('add-tournament').disabled = pending;
  $('add-team').disabled = pending || !tournament;
  $('add-player').disabled = pending || !team;
  $('refresh-rosters').disabled = pending;
  $('refresh-rosters').textContent = pending ? '正在处理…' : '刷新共享名单';
  $('player-search').disabled = pending || !team;
  if ($('player-search').value !== playerSearch) $('player-search').value = playerSearch;
  const count = itemsFor('player').length;
  $('player-search-hint').textContent = playerSearch.trim()
    ? '搜索时暂停排序；清除搜索后可上移或下移球员。'
    : (team ? `当前球队共 ${count} 名球员。` : '');
  $('roster-status').textContent = operationMessage || rosterSummary();
}

function reconcileSelection() {
  if (!tournaments.some(tournament => tournament.id === selectedTournamentId)) {
    selectedTournamentId = tournaments[0]?.id || '';
    selectedTeamId = '';
  }
  const tournament = selectedTournament();
  if (!tournament?.teams.some(team => team.id === selectedTeamId)) {
    selectedTeamId = tournament?.teams[0]?.id || '';
  }
}

function showWorkspaceError(message) {
  $('workspace-error').textContent = message;
  $('workspace-error').hidden = !message;
}

async function reloadRosters() {
  operationMessage = '正在读取共享名单…';
  renderAll();
  try {
    const loaded = await loadSharedRosters(client);
    tournaments = loaded.tournaments;
    records = loaded.records;
    reconcileSelection();
    operationMessage = rosterSummary();
  } catch (error) {
    operationMessage = '共享名单读取失败，可点击刷新重试。';
    throw error;
  }
}

async function perform(task, loadingMessage, successMessage = '') {
  if (pending) return false;
  pending = true;
  operationMessage = loadingMessage;
  showWorkspaceError('');
  renderAll();
  try {
    await task();
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    showWorkspaceError(error?.message || '操作失败，请稍后重试。');
    return false;
  } finally {
    pending = false;
    if (operationMessage === loadingMessage) operationMessage = rosterSummary();
    renderAll();
  }
}

function refreshRosters(showConfirmation = false) {
  return perform(reloadRosters, '正在刷新共享名单…', showConfirmation ? '共享名单已刷新。' : '');
}

async function activateSession(nextSession) {
  const revision = ++sessionRevision;
  session = nextSession;
  updateAccount();
  if (!session) {
    showView('auth-view');
    return;
  }
  showView('loading-view');
  $('loading-view').querySelector('h2').textContent = '正在验证管理员权限';
  $('access-error').textContent = '';
  try {
    const admin = await api.checkAdmin();
    if (revision !== sessionRevision) return;
    if (!admin) {
      $('denied-title').textContent = '当前账号无管理员权限';
      $('denied-message').textContent = '该账号可以登录，但不能维护共享名单。请退出后改用管理员账号。';
      showView('denied-view');
      return;
    }
    showView('admin-view');
    showWorkspaceError('');
    renderAll();
    await refreshRosters(false);
  } catch (error) {
    if (revision !== sessionRevision) return;
    $('denied-title').textContent = '暂时无法验证管理员权限';
    $('denied-message').textContent = '请检查网络后重试，或退出当前账号。';
    $('access-error').textContent = error?.message || '权限检查失败。';
    showView('denied-view');
  }
}

function openRecordDialog(kind, mode, id = '') {
  if (pending || dialogPending) return;
  const item = mode === 'edit' ? itemFor(kind, id) : null;
  if (mode === 'edit' && !item) return;
  const tournament = selectedTournament();
  const team = selectedTeam();
  if (kind === 'team' && !tournament) return;
  if (kind === 'player' && !team) return;

  dialogContext = {
    kind, mode, id,
    parentId: kind === 'team' ? tournament.id : kind === 'player' ? team.id : '',
  };
  $('record-dialog-title').textContent = `${mode === 'create' ? '新增' : '编辑'}${labels[kind]}`;
  $('record-name-label').textContent = nameLabels[kind];
  $('record-name').value = item?.name || '';
  $('record-name').placeholder = `输入${nameLabels[kind]}（1–80 个字符）`;
  $('lineups-field').hidden = kind !== 'tournament';
  $('record-lineups').checked = item?.lineups !== false;
  $('record-dialog-description').textContent = mode === 'create'
    ? `新${labels[kind]}会添加到当前列表末尾。`
    : `正在编辑“${item.name}”。`;
  $('record-error').textContent = '';
  setDialogBusy(false);
  $('record-dialog').showModal();
  requestAnimationFrame(() => {
    $('record-name').focus();
    $('record-name').select();
  });
}

function setDialogBusy(value) {
  dialogPending = value;
  $('record-submit').disabled = value;
  $('record-submit').textContent = value ? '正在保存…' : '保存';
  $('record-name').disabled = value;
  $('record-lineups').disabled = value;
  $('record-dialog').querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = value; });
}

function closeRecordDialog() {
  if (!dialogPending) $('record-dialog').close();
}

function selectCreatedRecord({kind, parentId}, name) {
  if (kind === 'tournament') {
    selectedTournamentId = tournaments.find(item => item.name === name)?.id || selectedTournamentId;
    selectedTeamId = selectedTournament()?.teams[0]?.id || '';
  } else if (kind === 'team') {
    selectedTournamentId = parentId;
    selectedTeamId = selectedTournament()?.teams.find(item => item.name === name)?.id || selectedTeamId;
  } else {
    selectedTeamId = parentId;
  }
}

async function submitRecord(event) {
  event.preventDefault();
  if (!dialogContext || dialogPending || pending) return;
  const context = {...dialogContext};
  let name;
  try {
    name = validateName($('record-name').value, nameLabels[context.kind]);
  } catch (error) {
    $('record-error').textContent = error.message;
    return;
  }
  const lineups = $('record-lineups').checked;
  let mutationCompleted = false;
  pending = true;
  operationMessage = '正在保存名单修改…';
  showWorkspaceError('');
  setDialogBusy(true);
  renderAll();
  try {
    if (context.mode === 'create') {
      if (context.kind === 'tournament') await api.createTournament(name, lineups);
      if (context.kind === 'team') await api.createTeam(context.parentId, name);
      if (context.kind === 'player') await api.createPlayer(context.parentId, name);
    } else {
      if (context.kind === 'tournament') await api.updateTournament(context.id, {name, lineups});
      if (context.kind === 'team') await api.renameTeam(context.id, name);
      if (context.kind === 'player') await api.renamePlayer(context.id, name);
    }
    mutationCompleted = true;
    $('record-dialog').close();
    await reloadRosters();
    if (context.mode === 'create') selectCreatedRecord(context, name);
    renderAll();
    showToast(`${labels[context.kind]}已保存。`);
  } catch (error) {
    if (mutationCompleted) {
      operationMessage = '修改已提交，但名单刷新失败，请点击刷新。';
      showWorkspaceError(`修改已提交，但刷新失败：${error?.message || '请稍后重试。'}`);
    } else {
      $('record-error').textContent = error?.message || '保存失败，请稍后重试。';
    }
  } finally {
    pending = false;
    setDialogBusy(false);
    if (operationMessage === '正在保存名单修改…') operationMessage = rosterSummary();
    renderAll();
  }
}

async function deleteItem(kind, id) {
  if (pending) return;
  const item = itemFor(kind, id);
  if (!item) return;
  let warning = `确定删除${labels[kind]}“${item.name}”吗？\n`;
  if (kind === 'tournament') {
    const playerCount = records.filter(record => record.tournamentId === id).length;
    warning += `将级联删除 ${item.teams.length} 支球队、${playerCount} 名球员。\n`;
  } else if (kind === 'team') {
    const playerCount = records.filter(record => record.teamId === id).length;
    warning += `将级联删除 ${playerCount} 名球员。\n`;
  }
  warning += '此操作无法撤销。';
  if (!window.confirm(warning)) return;
  await perform(async () => {
    if (kind === 'tournament') await api.deleteTournament(id);
    if (kind === 'team') await api.deleteTeam(id);
    if (kind === 'player') await api.deletePlayer(id);
    await reloadRosters();
  }, `正在删除${labels[kind]}…`, `${labels[kind]}已删除。`);
}

async function moveItem(kind, id, direction) {
  if (pending || (kind === 'player' && playerSearch.trim())) return;
  const items = itemsFor(kind);
  const index = items.findIndex(item => item.id === id);
  const other = items[index + direction];
  if (index < 0 || !other) return;
  await perform(async () => {
    if (kind === 'tournament') await api.reorderTournaments(id, other.id);
    if (kind === 'team') await api.reorderTeams(id, other.id);
    if (kind === 'player') await api.reorderPlayers(id, other.id);
    await reloadRosters();
  }, `正在调整${labels[kind]}顺序…`, `${labels[kind]}顺序已更新。`);
}

function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const {action, kind, id} = button.dataset;
  if (!labels[kind]) return;
  if (action === 'select' && kind !== 'player' && !pending) {
    if (kind === 'tournament') {
      selectedTournamentId = id;
      selectedTeamId = selectedTournament()?.teams[0]?.id || '';
    } else {
      selectedTeamId = id;
    }
    playerSearch = '';
    renderAll();
  }
  if (action === 'rename') openRecordDialog(kind, 'edit', id);
  if (action === 'delete') void deleteItem(kind, id);
  if (action === 'up') void moveItem(kind, id, -1);
  if (action === 'down') void moveItem(kind, id, 1);
}

async function login(event) {
  event.preventDefault();
  if (authPending) return;
  $('auth-error').textContent = '';
  if (!client) {
    $('auth-error').textContent = '共享名单服务尚未就绪，请刷新页面重试。';
    return;
  }
  setAuthPending(true);
  try {
    const nextSession = await client.login($('password').value);
    $('password').value = '';
    await activateSession(nextSession);
  } catch (error) {
    session = null;
    updateAccount();
    showView('auth-view');
    $('auth-error').textContent = error?.message || '登录失败，请稍后重试。';
  } finally {
    setAuthPending(false);
  }
}

async function logout() {
  if (!client || authPending) return;
  setAuthPending(true);
  try {
    await client.logout();
    session = null;
    tournaments = [];
    records = [];
    selectedTournamentId = '';
    selectedTeamId = '';
    playerSearch = '';
    dialogContext = null;
    if ($('record-dialog').open) $('record-dialog').close();
    showWorkspaceError('');
    $('auth-error').textContent = '';
    $('password').value = '';
    showView('auth-view');
  } catch (error) {
    showToast(error?.message || '退出登录失败。', true);
  } finally {
    setAuthPending(false);
  }
}

async function retryAccess() {
  if (!session || authPending) return;
  setAuthPending(true);
  try {
    await activateSession(session);
  } finally {
    setAuthPending(false);
  }
}

async function initialize() {
  for (const kind of Object.keys(labels)) $(`${kind}-list`).addEventListener('click', handleListClick);
  $('login-form').addEventListener('submit', login);
  $('logout').addEventListener('click', logout);
  $('retry-access').addEventListener('click', retryAccess);
  $('refresh-rosters').addEventListener('click', () => { void refreshRosters(true); });
  $('add-tournament').addEventListener('click', () => openRecordDialog('tournament', 'create'));
  $('add-team').addEventListener('click', () => openRecordDialog('team', 'create'));
  $('add-player').addEventListener('click', () => openRecordDialog('player', 'create'));
  $('player-search').addEventListener('input', event => {
    playerSearch = event.target.value;
    renderPanel('player');
    $('player-search-hint').textContent = playerSearch.trim()
      ? '搜索时暂停排序；清除搜索后可上移或下移球员。'
      : `当前球队共 ${itemsFor('player').length} 名球员。`;
  });
  $('record-form').addEventListener('submit', submitRecord);
  $('record-dialog').querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', closeRecordDialog));
  $('record-dialog').addEventListener('cancel', event => { if (dialogPending) event.preventDefault(); });
  $('record-dialog').addEventListener('close', () => {
    if (!dialogPending) dialogContext = null;
  });

  setAuthPending(true);
  try {
    client = rosterClient();
    api = createAdminApi(client);
    client.onSessionChange(nextSession => {
      if (!nextSession) {
        ++sessionRevision; session = null; tournaments = []; records = [];
        if ($('record-dialog').open) $('record-dialog').close();
        updateAccount(); showView('auth-view');
      }
    });
    await activateSession(await client.getSession());
  } catch (error) {
    session = null;
    showView('auth-view');
    $('auth-error').textContent = error?.message || '页面初始化失败，请刷新重试。';
  } finally {
    setAuthPending(false);
  }
}

void initialize();
