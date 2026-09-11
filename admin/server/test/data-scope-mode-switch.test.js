const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-data-scope-'))
process.env.MINIAPP_DATA_DIR = dataDir

const database = require('../src/lib/state-database')
const settingsFile = path.join(dataDir, 'admin-settings.json')
database.writeState(settingsFile, {
  currentMiniProgramId: 'app-a',
  contentPools: [
    { id: 'pool-1', name: '共享池' },
    { id: 'pool-2', name: '隔离池' },
    { id: 'pool-solo', name: '单应用池' },
  ],
  miniPrograms: [
    { id: 'app-a', name: '应用 A', appId: 'wx1111111111111111', status: 'active', config: { contentPoolId: 'pool-1', dataMode: 'independent' } },
    { id: 'app-b', name: '应用 B', appId: 'wx2222222222222222', status: 'active', config: { contentPoolId: 'pool-1', dataMode: 'shared' } },
    { id: 'app-c', name: '应用 C', appId: 'wx3333333333333333', status: 'active', config: { contentPoolId: 'pool-2', dataMode: 'shared' } },
    { id: 'app-d', name: '应用 D', appId: 'wx4444444444444444', status: 'active', config: { contentPoolId: 'pool-1', dataMode: 'independent' } },
    { id: 'app-solo', name: '单应用', appId: 'wx5555555555555555', status: 'active', config: { contentPoolId: 'pool-solo', dataMode: 'independent' } },
    { id: 'app-fail', name: '失败回滚', appId: 'wx6666666666666666', status: 'active', config: { contentPoolId: 'pool-1', dataMode: 'independent' } },
  ],
  operationLogs: [],
})

const {
  getInternalAdminSettings,
  updateAdminSettings,
  updateMiniProgramConfig,
} = require('../src/modules/admin/admin-settings.store')
const {
  buildDataScopeId,
  getDataScope,
} = require('../src/modules/data-scope/data-scope')
const { migrateDataMode } = require('../src/modules/data-scope/data-scope-migration.service')

const db = database.getDatabase()

function insertAccount(accountId, miniProgramIds) {
  const now = '2026-08-30T00:00:00.000Z'
  const item = {
    accountId,
    miniProgramId: miniProgramIds[0],
    miniProgramIds,
    visitorId: accountId,
    wechatIdentities: [],
    updatedAt: now,
  }
  db.prepare(`
    INSERT INTO accounts (
      account_id, unionid, phone, phone_verified, login_synced, visitor_id,
      primary_mini_program_id, created_at, updated_at, item_json
    ) VALUES (?, '', '', 0, 1, ?, ?, ?, ?, ?)
  `).run(accountId, accountId, miniProgramIds[0], now, now, JSON.stringify(item))
  miniProgramIds.forEach((miniProgramId) => {
    db.prepare('INSERT INTO account_mini_programs (account_id, mini_program_id) VALUES (?, ?)')
      .run(accountId, miniProgramId)
  })
}

function insertProfile(scopeId, accountId, nickname, updatedAt, originMiniProgramId) {
  db.prepare(`
    INSERT INTO user_scope_profiles (
      data_scope_id, account_id, nickname, avatar_text, avatar_url, preferences_json,
      updated_at, nickname_updated_at, avatar_updated_at, preferences_updated_at,
      origin_mini_program_id
    ) VALUES (?, ?, ?, '你', '', '{}', ?, ?, ?, ?, ?)
  `).run(scopeId, accountId, nickname, updatedAt, updatedAt, updatedAt, updatedAt, originMiniProgramId)
}

function insertReaction({ scopeId, miniProgramId, visitorId, sourceId, liked, favorited = 0, updatedAt }) {
  db.prepare(`
    INSERT INTO reactions (
      reaction_key, data_scope_id, mini_program_id, visitor_id, source, source_id,
      liked, favorited, liked_at, shared_at, updated_at
    ) VALUES (?, ?, ?, ?, 'letters', ?, ?, ?, ?, '', ?)
  `).run(`${scopeId}:${visitorId}:${sourceId}`, scopeId, miniProgramId, visitorId, sourceId,
    liked, favorited, liked ? updatedAt : '', updatedAt)
}

function insertOpened({ scopeId, miniProgramId, visitorId, eventId, sourceId, createdAt }) {
  db.prepare(`
    INSERT INTO opened_records (
      opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
      source, source_id, created_at, item_json
    ) VALUES (?, ?, ?, ?, ?, 'daily_content', ?, ?, '{}')
  `).run(`${scopeId}:${eventId}`, eventId, scopeId, miniProgramId, visitorId, sourceId, createdAt)
}

function currentMode(miniProgramId) {
  return getInternalAdminSettings().miniPrograms.find((item) => item.id === miniProgramId).config.dataMode
}

test.after(() => {
  database.closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('范围规则默认同池共享，不同池与独立模式互相隔离', () => {
  assert.equal(buildDataScopeId({ miniProgramId: 'app-a', contentPoolId: 'pool-1' }), 'shared:pool-1')
  assert.equal(buildDataScopeId({ miniProgramId: 'app-b', contentPoolId: 'pool-1', dataMode: 'shared' }), 'shared:pool-1')
  assert.equal(buildDataScopeId({ miniProgramId: 'app-c', contentPoolId: 'pool-2', dataMode: 'shared' }), 'shared:pool-2')
  assert.equal(buildDataScopeId({ miniProgramId: 'app-a', contentPoolId: 'pool-1', dataMode: 'independent' }), 'independent:app-a:pool-1')
  assert.equal(buildDataScopeId({ miniProgramId: 'app-d', contentPoolId: 'pool-1', dataMode: 'independent' }), 'independent:app-d:pool-1')
  assert.equal(getDataScope({ miniProgramId: 'app-b' }).dataScopeId, 'shared:pool-1')
})

test('没有其他共享应用时，独立数据会播种共享数据而不是从零开始', () => {
  const accountId = 'solo-account'
  const independentScope = 'independent:app-solo:pool-solo'
  const sharedScope = 'shared:pool-solo'
  insertAccount(accountId, ['app-solo'])
  insertProfile(independentScope, accountId, '独立昵称', '2026-08-30T01:00:00.000Z', 'app-solo')
  insertOpened({
    scopeId: independentScope,
    miniProgramId: 'app-solo',
    visitorId: accountId,
    eventId: 'solo-open-event',
    sourceId: 'solo-content',
    createdAt: '2026-08-30T01:01:00.000Z',
  })

  updateMiniProgramConfig('app-solo', { dataMode: 'shared' })

  assert.equal(currentMode('app-solo'), 'shared')
  assert.equal(db.prepare('SELECT nickname FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?')
    .get(sharedScope, accountId).nickname, '独立昵称')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM opened_records WHERE data_scope_id = ? AND visitor_id = ?')
    .get(sharedScope, accountId).count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM opened_records WHERE data_scope_id = ? AND visitor_id = ?')
    .get(independentScope, accountId).count, 1)
})

test('反复切换会合并冲突与共享期增量，且旧独立分支始终保留', () => {
  const accountId = 'repeat-account'
  const independentScope = 'independent:app-a:pool-1'
  const sharedScope = 'shared:pool-1'
  insertAccount(accountId, ['app-a', 'app-b'])
  insertProfile(independentScope, accountId, '较旧独立资料', '2026-08-30T02:00:00.000Z', 'app-a')
  insertProfile(sharedScope, accountId, '较新共享资料', '2026-08-30T03:00:00.000Z', 'app-b')
  insertReaction({
    scopeId: independentScope,
    miniProgramId: 'app-a',
    visitorId: accountId,
    sourceId: 'conflict-content',
    liked: 1,
    updatedAt: '2026-08-30T02:00:00.000Z',
  })
  insertReaction({
    scopeId: sharedScope,
    miniProgramId: 'app-b',
    visitorId: accountId,
    sourceId: 'conflict-content',
    liked: 0,
    favorited: 1,
    updatedAt: '2026-08-30T03:00:00.000Z',
  })
  insertOpened({
    scopeId: independentScope,
    miniProgramId: 'app-a',
    visitorId: accountId,
    eventId: 'before-sharing',
    sourceId: 'content-before-sharing',
    createdAt: '2026-08-30T02:05:00.000Z',
  })

  updateMiniProgramConfig('app-a', { dataMode: 'shared' })
  assert.equal(currentMode('app-a'), 'shared')
  assert.deepEqual(
    db.prepare('SELECT liked, favorited FROM reactions WHERE data_scope_id = ? AND visitor_id = ? AND source_id = ?')
      .get(sharedScope, accountId, 'conflict-content'),
    { liked: 0, favorited: 1 },
  )
  assert.equal(db.prepare('SELECT nickname FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?')
    .get(sharedScope, accountId).nickname, '较新共享资料')

  insertOpened({
    scopeId: sharedScope,
    miniProgramId: 'app-b',
    visitorId: accountId,
    eventId: 'during-sharing',
    sourceId: 'content-during-sharing',
    createdAt: '2026-08-30T04:00:00.000Z',
  })
  updateMiniProgramConfig('app-a', { dataMode: 'independent' })
  assert.equal(currentMode('app-a'), 'independent')
  assert.deepEqual(
    db.prepare('SELECT event_id FROM opened_records WHERE data_scope_id = ? AND visitor_id = ? ORDER BY event_id')
      .all(independentScope, accountId).map((item) => item.event_id),
    ['before-sharing', 'during-sharing'],
  )

  updateMiniProgramConfig('app-a', { dataMode: 'shared' })
  insertOpened({
    scopeId: sharedScope,
    miniProgramId: 'app-b',
    visitorId: accountId,
    eventId: 'second-shared-period',
    sourceId: 'content-second-shared-period',
    createdAt: '2026-08-30T05:00:00.000Z',
  })
  updateMiniProgramConfig('app-a', { dataMode: 'independent' })
  assert.deepEqual(
    db.prepare('SELECT event_id FROM opened_records WHERE data_scope_id = ? AND visitor_id = ? ORDER BY event_id')
      .all(independentScope, accountId).map((item) => item.event_id),
    ['before-sharing', 'during-sharing', 'second-shared-period'],
  )
})

test('模式迁移失败时目标范围回滚，配置保持原模式', () => {
  const accountId = 'failure-account'
  const independentScope = 'independent:app-fail:pool-1'
  const sharedScope = 'shared:pool-1'
  insertAccount(accountId, ['app-fail'])
  insertProfile(independentScope, accountId, '不应部分迁移', '2026-08-30T06:00:00.000Z', 'app-fail')
  insertReaction({
    scopeId: independentScope,
    miniProgramId: 'app-fail',
    visitorId: accountId,
    sourceId: 'force-failure',
    liked: 1,
    updatedAt: '2026-08-30T06:00:00.000Z',
  })
  db.exec(`
    CREATE TRIGGER fail_data_scope_migration
    BEFORE INSERT ON reactions
    WHEN NEW.data_scope_id = 'shared:pool-1' AND NEW.visitor_id = 'failure-account'
    BEGIN
      SELECT RAISE(ABORT, 'forced migration failure');
    END;
  `)
  try {
    assert.throws(
      () => updateMiniProgramConfig('app-fail', { dataMode: 'shared' }),
      /forced migration failure/,
    )
    assert.equal(currentMode('app-fail'), 'independent')
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?')
      .get(sharedScope, accountId).count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM reactions WHERE data_scope_id = ? AND visitor_id = ?')
      .get(sharedScope, accountId).count, 0)
  } finally {
    db.exec('DROP TRIGGER fail_data_scope_migration')
  }
})

test('迁移服务不改变按小程序保存的运营来源统计', () => {
  db.prepare(`
    INSERT INTO analytics_events (
      event_id, event_type, mini_program_id, visitor_id, created_at, date_key, meta_json
    ) VALUES ('app-analytics-event', 'page_view', 'app-d', 'analytics-account', ?, '2026-08-30', '{}')
  `).run('2026-08-30T07:00:00.000Z')

  assert.deepEqual(migrateDataMode({
    miniProgramId: 'app-d',
    contentPoolId: 'pool-1',
    fromMode: 'independent',
    toMode: 'shared',
  }).changed, true)
  assert.deepEqual(
    db.prepare("SELECT mini_program_id, event_type FROM analytics_events WHERE event_id = 'app-analytics-event'").get(),
    { mini_program_id: 'app-d', event_type: 'page_view' },
  )
})

test('真实行为读写按同池共享，并在独立模式和换池时隔离', () => {
  const { checkInToday, getCheckinState } = require('../src/modules/checkin/checkin.store')
  const { getReactionState, setReaction } = require('../src/modules/interactions/interaction.store')
  const accountId = 'scope-behavior-account'
  const sharedA = { miniProgramId: 'app-a', visitorId: accountId }
  const sharedB = { miniProgramId: 'app-b', visitorId: accountId }
  const otherPool = { miniProgramId: 'app-c', visitorId: accountId }
  const independent = { miniProgramId: 'app-d', visitorId: accountId }
  const checkinDate = new Date('2026-08-30T08:00:00+08:00')

  updateMiniProgramConfig('app-a', { contentPoolId: 'pool-1', dataMode: 'shared' })
  setReaction(sharedB, {
    source: 'letters',
    sourceId: 'scope-visible-content',
    type: 'favorite',
    desiredState: true,
  })
  checkInToday(sharedB, checkinDate)

  assert.deepEqual(getReactionState(sharedA, 'letters', 'scope-visible-content'), { liked: false, favorited: true })
  assert.equal(getCheckinState(sharedA, checkinDate).checkIn.checkedToday, true)
  assert.deepEqual(getReactionState(otherPool, 'letters', 'scope-visible-content'), { liked: false, favorited: false })
  assert.equal(getCheckinState(otherPool, checkinDate).checkIn.checkedToday, false)
  assert.deepEqual(getReactionState(independent, 'letters', 'scope-visible-content'), { liked: false, favorited: false })
  assert.equal(getCheckinState(independent, checkinDate).checkIn.checkedToday, false)

  updateMiniProgramConfig('app-a', { contentPoolId: 'pool-2', dataMode: 'shared' })
  assert.deepEqual(getReactionState(sharedA, 'letters', 'scope-visible-content'), { liked: false, favorited: false })
  assert.equal(getCheckinState(sharedA, checkinDate).checkIn.checkedToday, false)

  updateMiniProgramConfig('app-a', { contentPoolId: 'pool-1', dataMode: 'shared' })
  assert.deepEqual(getReactionState(sharedA, 'letters', 'scope-visible-content'), { liked: false, favorited: true })
  assert.equal(getCheckinState(sharedA, checkinDate).checkIn.checkedToday, true)
})

test('昵称和头像按用户数据范围共享或隔离，身份账号仍保持统一', () => {
  const { getAccountSummary, updateProfile } = require('../src/modules/auth/account.store')
  const accountId = 'profile-scope-account'
  insertAccount(accountId, ['app-a', 'app-b', 'app-c', 'app-d'])
  const sharedA = { accountId, miniProgramId: 'app-a', visitorId: accountId }
  const sharedB = { accountId, miniProgramId: 'app-b', visitorId: accountId }
  const otherPool = { accountId, miniProgramId: 'app-c', visitorId: accountId }
  const independent = { accountId, miniProgramId: 'app-d', visitorId: accountId }

  updateProfile(sharedB, { nickname: '同池共享昵称', avatarText: '共' })
  assert.equal(getAccountSummary(sharedA).nickname, '同池共享昵称')
  assert.equal(getAccountSummary(sharedA).avatarText, '共')
  assert.notEqual(getAccountSummary(otherPool).nickname, '同池共享昵称')
  assert.notEqual(getAccountSummary(independent).nickname, '同池共享昵称')

  updateProfile(independent, { nickname: '独立昵称', avatarText: '独' })
  assert.equal(getAccountSummary(independent).nickname, '独立昵称')
  assert.equal(getAccountSummary(sharedB).nickname, '同池共享昵称')
  assert.equal(getAccountSummary(sharedB).accountId, getAccountSummary(independent).accountId)
})

test('模式反复切换后重试同一请求不会再次执行，且不会复制其他小程序来源', () => {
  const { executeIdempotently, getStoredResult } = require('../src/modules/idempotency/idempotency.store')
  const accountId = 'idempotency-switch-account'
  const appA = { accountId, miniProgramId: 'app-a', visitorId: accountId }
  const appB = { accountId, miniProgramId: 'app-b', visitorId: accountId }
  const independentScope = 'independent:app-a:pool-1'
  insertAccount(accountId, ['app-a', 'app-b'])
  updateMiniProgramConfig('app-a', { contentPoolId: 'pool-1', dataMode: 'independent' })

  let executions = 0
  const firstRequest = {
    context: appA,
    operation: 'daily_content_open',
    requestKey: 'scope_retry_key_001',
    payload: { contentId: 'first-content' },
  }
  const runFirst = () => executeIdempotently({
    ...firstRequest,
    execute() {
      executions += 1
      return { status: 201, body: { execution: executions } }
    },
  })
  assert.equal(runFirst().body.execution, 1)
  updateMiniProgramConfig('app-a', { dataMode: 'shared' })
  assert.equal(runFirst().body.execution, 1)
  assert.equal(executions, 1)

  const sharedRequest = {
    context: appA,
    operation: 'check_in',
    requestKey: 'scope_retry_key_002',
    payload: {},
  }
  const runShared = () => executeIdempotently({
    ...sharedRequest,
    execute() {
      executions += 1
      return { status: 201, body: { execution: executions } }
    },
  })
  assert.equal(runShared().body.execution, 2)

  executeIdempotently({
    context: appB,
    operation: 'daily_content_open',
    requestKey: 'other_origin_key_01',
    payload: { contentId: 'from-app-b' },
    execute: () => ({ status: 201, body: { origin: 'app-b' } }),
  })
  updateMiniProgramConfig('app-a', { dataMode: 'independent' })
  assert.equal(runShared().body.execution, 2)
  assert.equal(executions, 2)
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM idempotency_records
    WHERE data_scope_id = ? AND origin_mini_program_id = 'app-b'
  `).get(independentScope).count, 0)

  updateMiniProgramConfig('app-a', { dataMode: 'shared' })
  updateMiniProgramConfig('app-a', { dataMode: 'independent' })
  assert.equal(runFirst().body.execution, 1)
  assert.equal(runShared().body.execution, 2)
  assert.equal(executions, 2)
  assert.equal(getStoredResult(firstRequest).body.execution, 1)
})

test('签到模式迁移保留历史累计上限，不会被明细数量降低', () => {
  const accountId = 'checkin-total-account'
  const independentScope = 'independent:app-d:pool-1'
  const sharedScope = 'shared:pool-1'
  insertAccount(accountId, ['app-d'])
  updateMiniProgramConfig('app-d', { dataMode: 'independent' })
  db.prepare('INSERT INTO checkin_users (data_scope_id, visitor_id, total_days) VALUES (?, ?, ?)')
    .run(independentScope, accountId, 12)
  db.prepare(`
    INSERT INTO checkin_records (
      data_scope_id, visitor_id, date_key, checked_at, origin_mini_program_id
    ) VALUES (?, ?, '2026-08-30', '2026-08-30T01:00:00.000Z', 'app-d')
  `).run(independentScope, accountId)
  db.prepare(`
    INSERT INTO checkin_users (data_scope_id, visitor_id, total_days) VALUES (?, ?, ?)
    ON CONFLICT(data_scope_id, visitor_id) DO UPDATE SET total_days = excluded.total_days
  `).run(sharedScope, accountId, 20)

  updateMiniProgramConfig('app-d', { dataMode: 'shared' })
  assert.equal(db.prepare('SELECT total_days FROM checkin_users WHERE data_scope_id = ? AND visitor_id = ?')
    .get(sharedScope, accountId).total_days, 20)
  db.prepare('UPDATE checkin_users SET total_days = 25 WHERE data_scope_id = ? AND visitor_id = ?')
    .run(sharedScope, accountId)
  updateMiniProgramConfig('app-d', { dataMode: 'independent' })
  assert.equal(db.prepare('SELECT total_days FROM checkin_users WHERE data_scope_id = ? AND visitor_id = ?')
    .get(independentScope, accountId).total_days, 25)
})

test('配置持久化失败会同时回滚模式迁移和内存配置', () => {
  const accountId = 'settings-save-failure-account'
  const independentScope = 'independent:app-fail:pool-1'
  const sharedScope = 'shared:pool-1'
  insertAccount(accountId, ['app-fail'])
  updateMiniProgramConfig('app-fail', { dataMode: 'independent' })
  insertOpened({
    scopeId: independentScope,
    miniProgramId: 'app-fail',
    visitorId: accountId,
    eventId: 'settings-save-failure-event',
    sourceId: 'settings-save-failure-content',
    createdAt: '2026-08-30T08:00:00.000Z',
  })
  db.exec(`
    CREATE TRIGGER fail_admin_settings_save
    BEFORE UPDATE ON application_state
    WHEN NEW.state_key = 'admin-settings'
    BEGIN
      SELECT RAISE(ABORT, 'forced settings save failure');
    END;
  `)
  try {
    assert.throws(() => updateMiniProgramConfig('app-fail', { dataMode: 'shared' }), /forced settings save failure/)
    assert.equal(currentMode('app-fail'), 'independent')
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM opened_records WHERE data_scope_id = ? AND event_id = ?
    `).get(sharedScope, 'settings-save-failure-event').count, 0)
  } finally {
    db.exec('DROP TRIGGER fail_admin_settings_save')
  }
})

test('批量配置中任一迁移失败会回滚全部迁移，且通用入口拒绝生命周期变化', () => {
  const appAAccount = 'batch-atomic-app-a'
  const appDAccount = 'batch-atomic-app-d'
  insertAccount(appAAccount, ['app-a'])
  insertAccount(appDAccount, ['app-d'])
  updateMiniProgramConfig('app-a', { contentPoolId: 'pool-1', dataMode: 'independent' })
  updateMiniProgramConfig('app-d', { contentPoolId: 'pool-1', dataMode: 'independent' })
  insertOpened({
    scopeId: 'independent:app-a:pool-1',
    miniProgramId: 'app-a',
    visitorId: appAAccount,
    eventId: 'batch-atomic-open',
    sourceId: 'batch-atomic-content',
    createdAt: '2026-08-30T09:00:00.000Z',
  })
  insertReaction({
    scopeId: 'independent:app-d:pool-1',
    miniProgramId: 'app-d',
    visitorId: appDAccount,
    sourceId: 'batch-atomic-reaction',
    liked: 1,
    updatedAt: '2026-08-30T09:00:00.000Z',
  })
  db.exec(`
    CREATE TRIGGER fail_second_batch_migration
    BEFORE INSERT ON reactions
    WHEN NEW.data_scope_id = 'shared:pool-1' AND NEW.visitor_id = 'batch-atomic-app-d'
    BEGIN
      SELECT RAISE(ABORT, 'forced second migration failure');
    END;
  `)
  try {
    const miniPrograms = getInternalAdminSettings().miniPrograms.map((item) => ({
      ...item,
      config: {
        ...item.config,
        dataMode: ['app-a', 'app-d'].includes(item.id) ? 'shared' : item.config.dataMode,
      },
    }))
    assert.throws(() => updateAdminSettings({ miniPrograms }), /forced second migration failure/)
    assert.equal(currentMode('app-a'), 'independent')
    assert.equal(currentMode('app-d'), 'independent')
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM opened_records WHERE data_scope_id = 'shared:pool-1' AND event_id = 'batch-atomic-open'
    `).get().count, 0)
  } finally {
    db.exec('DROP TRIGGER fail_second_batch_migration')
  }

  const current = getInternalAdminSettings().miniPrograms
  assert.throws(() => updateAdminSettings({ miniPrograms: current.slice(1) }), /专用管理接口/)
  assert.throws(() => updateAdminSettings({
    miniPrograms: current.map((item) => item.id === 'app-a' ? { ...item, status: 'archived' } : item),
  }), /专用管理接口/)
})
