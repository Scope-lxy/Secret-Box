const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-mini-program-lifecycle-'))
process.env.MINIAPP_DATA_DIR = dataDir

const database = require('../src/lib/state-database')
const settingsFile = path.join(dataDir, 'admin-settings.json')
const releaseStateFile = path.join(dataDir, 'miniapp-release-state.json')
const targetAppId = 'wx1111111111111111'

database.writeState(settingsFile, {
  currentMiniProgramId: 'target',
  contentPools: [
    { id: 'shared-pool', name: '共享内容池', remark: '' },
    { id: 'archive-pool', name: '停用应用内容池', remark: '' },
  ],
  miniPrograms: [
    {
      id: 'target',
      name: '待删除小程序',
      appId: targetAppId,
      status: 'active',
      config: { contentPoolId: 'shared-pool', dataMode: 'independent' },
    },
    {
      id: 'survivor',
      name: '保留小程序',
      appId: 'wx2222222222222222',
      status: 'active',
      config: { contentPoolId: 'shared-pool' },
    },
    {
      id: 'archived',
      name: '历史停用小程序',
      appId: 'wx4444444444444444',
      status: 'archived',
      config: { contentPoolId: 'archive-pool' },
    },
    {
      id: 'other',
      name: '另一个小程序',
      appId: 'wx3333333333333333',
      status: 'active',
      config: { contentPoolId: 'shared-pool' },
    },
  ],
  operationLogs: [],
})
database.writeState(releaseStateFile, {
  versions: { fingerprint: { version: 'V1', createdAt: '2026-01-01T00:00:00.000Z' } },
  uploads: { [targetAppId]: { fingerprint: 'fingerprint', version: 'V1' } },
})

const keyDirectory = path.join(dataDir, 'miniapp-upload-keys')
fs.mkdirSync(keyDirectory)
fs.writeFileSync(path.join(keyDirectory, `${targetAppId}.key`), 'upload-key')

const { deleteMiniProgram } = require('../src/modules/admin/mini-program-deletion.service')
const { deleteAccountForMiniProgram } = require('../src/modules/auth/account-deletion.service')
const { getOpened } = require('../src/modules/interactions/interaction.store')
const {
  getInternalAdminSettings,
  reorderMiniProgram,
} = require('../src/modules/admin/admin-settings.store')

function insertAccount({ accountId, miniProgramIds, primaryMiniProgramId }) {
  const db = database.getDatabase()
  const now = new Date().toISOString()
  const item = {
    accountId,
    miniProgramId: primaryMiniProgramId,
    miniProgramIds,
    wechatIdentities: miniProgramIds.map((miniProgramId) => ({ miniProgramId, openid: `${accountId}-${miniProgramId}` })),
    loginSynced: true,
    updatedAt: now,
  }
  db.prepare(`
    INSERT INTO accounts (
      account_id, unionid, phone, phone_verified, login_synced, visitor_id,
      primary_mini_program_id, created_at, updated_at, item_json
    ) VALUES (?, '', '', 0, 1, ?, ?, ?, ?, ?)
  `).run(accountId, accountId, primaryMiniProgramId, now, now, JSON.stringify(item))
  miniProgramIds.forEach((miniProgramId) => {
    db.prepare('INSERT INTO account_mini_programs (account_id, mini_program_id) VALUES (?, ?)')
      .run(accountId, miniProgramId)
    db.prepare('INSERT INTO wechat_identities (mini_program_id, openid, account_id) VALUES (?, ?, ?)')
      .run(miniProgramId, `${accountId}-${miniProgramId}`, accountId)
  })
}

function seedScopedRows() {
  const db = database.getDatabase()
  const now = new Date().toISOString()
  insertAccount({ accountId: 'exclusive-account', miniProgramIds: ['target'], primaryMiniProgramId: 'target' })
  insertAccount({ accountId: 'shared-account', miniProgramIds: ['target', 'survivor'], primaryMiniProgramId: 'target' })
  insertAccount({ accountId: 'archived-account', miniProgramIds: ['target', 'archived'], primaryMiniProgramId: 'target' })
  const scopeId = 'independent:target:shared-pool'
  db.prepare(`INSERT INTO messages (
    message_id, data_scope_id, account_id, mini_program_id, visitor_id, status,
    source, source_id, created_at, updated_at, item_json
  ) VALUES (?, ?, ?, 'target', ?, 'saved', 'letter', '1', ?, ?, ?)`)
    .run('message-1', scopeId, 'exclusive-account', 'exclusive-account', now, now, '{}')
  db.prepare(`INSERT INTO reactions (
    reaction_key, data_scope_id, mini_program_id, visitor_id, source, source_id,
    liked, favorited, liked_at, shared_at, updated_at
  ) VALUES (?, ?, 'target', ?, 'letter', '1', 1, 1, ?, '', ?)`)
    .run('reaction-1', scopeId, 'exclusive-account', now, now)
  db.prepare(`INSERT INTO opened_records (
    opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
    source, source_id, created_at, item_json
  ) VALUES (?, ?, ?, 'target', ?, 'letter', '1', ?, ?)`)
    .run('opened-1', 'opened-1', scopeId, 'exclusive-account', now, '{}')
  db.prepare(`INSERT INTO analytics_events VALUES (?, 'open', 'target', ?, ?, '2026-01-01', ?)`)
    .run('event-1', 'exclusive-account', now, '{}')
  db.prepare(`INSERT INTO miniapp_sessions VALUES (?, 'exclusive-account', 'target', ?, ?)`)
    .run('token-1', now, '2099-01-01T00:00:00.000Z')
  db.prepare(`INSERT INTO checkin_users VALUES (?, ?, 1)`).run(scopeId, 'exclusive-account')
  db.prepare(`INSERT INTO checkin_records VALUES (?, ?, '2026-01-01', ?, 'target')`)
    .run(scopeId, 'exclusive-account', now)
  db.prepare(`INSERT INTO idempotency_records VALUES ('open', ?, 'target', ?, 'key', 'hash', 200, '{}', ?)`)
    .run(scopeId, 'exclusive-account', now)
  db.prepare(`INSERT INTO opened_records (
    opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
    source, source_id, created_at, item_json
  ) VALUES (?, ?, 'shared:shared-pool', 'target', ?, 'daily_content', 'shared-content', ?, ?)`)
    .run('shared-opened', 'shared-opened', 'shared-account', now, JSON.stringify({ preview: '共享打开记录' }))
  db.prepare(`INSERT INTO opened_records (
    opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
    source, source_id, created_at, item_json
  ) VALUES (?, ?, 'shared:shared-pool', 'target', ?, 'daily_content', 'exclusive-content', ?, '{}')`)
    .run('exclusive-shared-opened', 'exclusive-shared-opened', 'exclusive-account', now)
  db.prepare(`INSERT INTO opened_records (
    opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
    source, source_id, created_at, item_json
  ) VALUES (?, ?, 'shared:archive-pool', 'target', ?, 'daily_content', 'archived-content', ?, ?)`)
    .run('archived-shared-opened', 'archived-shared-opened', 'archived-account', now, JSON.stringify({ preview: '停用应用仍需记录' }))
  db.prepare(`INSERT INTO user_scope_profiles VALUES (
    'shared:archive-pool', 'archived-account', '停用应用用户', '停', '', '{}', ?, ?, ?, ?, 'target'
  )`).run(now, now, now, now)
  db.prepare(`INSERT INTO opened_records (
    opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
    source, source_id, created_at, item_json
  ) VALUES (?, ?, 'independent:target:old-pool', 'target', ?, 'daily_content', 'old-content', ?, '{}')`)
    .run('archived-old-opened', 'archived-old-opened', 'archived-account', now)
  db.prepare(`INSERT INTO user_scope_profiles VALUES (
    'independent:target:old-pool', 'archived-account', '旧分支用户', '旧', '', '{}', ?, ?, ?, ?, 'target'
  )`).run(now, now, now, now)
  db.prepare(`INSERT INTO idempotency_records VALUES (
    'open', 'independent:target:old-pool', 'target', 'archived-account',
    'archived-account-key', 'hash', 200, '{}', ?
  )`).run(now)
  db.prepare(`INSERT INTO content_items VALUES ('shared-pool', 'letter', 'content-1', 0, '{}')`).run()
  db.prepare(`INSERT INTO image_assets VALUES ('image-1', 'ready', ?, '{}')`).run(now)
}

test.before(seedScopedRows)

test.after(() => {
  database.closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('当前应用账号注销会清理历史分支和幂等记录，并保留停用应用仍持有的共享数据', async () => {
  const result = await deleteAccountForMiniProgram({ accountId: 'archived-account', miniProgramId: 'target' })
  assert.equal(result.accountRemoved, false)
  assert.ok(result.summary.idempotency > 0)
  const db = database.getDatabase()
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM opened_records WHERE data_scope_id = 'independent:target:old-pool' AND visitor_id = 'archived-account'`).get().count, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM user_scope_profiles WHERE data_scope_id = 'independent:target:old-pool' AND account_id = 'archived-account'`).get().count, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM idempotency_records WHERE origin_mini_program_id = 'target' AND account_id = 'archived-account'`).get().count, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM opened_records WHERE data_scope_id = 'shared:archive-pool' AND visitor_id = 'archived-account'`).get().count, 1)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM user_scope_profiles WHERE data_scope_id = 'shared:archive-pool' AND account_id = 'archived-account'`).get().count, 1)
  assert.deepEqual(db.prepare(`SELECT mini_program_id FROM account_mini_programs WHERE account_id = 'archived-account'`).all(), [{ mini_program_id: 'archived' }])
})

test('删除小程序会清理历史和共享范围内的独占数据，同时保留其他应用需要的共享记录', () => {
  const result = deleteMiniProgram('target')
  assert.equal(result.deleted, true)
  assert.equal(result.summary.sharedAccounts, 1)

  const db = database.getDatabase()
  for (const table of ['analytics_events', 'miniapp_sessions', 'wechat_identities', 'account_mini_programs']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE mini_program_id = 'target'`).get().count, 0, table)
  }
  for (const table of ['checkin_records', 'idempotency_records']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE origin_mini_program_id = 'target'`).get().count, 0, table)
  }
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM checkin_users WHERE data_scope_id = 'independent:target:shared-pool'`).get().count, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM opened_records WHERE opened_id = 'exclusive-shared-opened'`).get().count, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM opened_records WHERE data_scope_id = 'independent:target:old-pool'`).get().count, 0)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM opened_records WHERE opened_id = 'shared-opened'`).get().count, 1)
  assert.equal(getOpened({ miniProgramId: 'survivor', visitorId: 'shared-account' })[0].preview, '共享打开记录')
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM opened_records WHERE opened_id = 'archived-shared-opened'`).get().count, 1)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM user_scope_profiles WHERE data_scope_id = 'shared:archive-pool' AND account_id = 'archived-account'`).get().count, 1)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM accounts WHERE account_id = 'exclusive-account'`).get().count, 0)
  const shared = db.prepare(`SELECT * FROM accounts WHERE account_id = 'shared-account'`).get()
  assert.equal(shared.primary_mini_program_id, 'survivor')
  assert.deepEqual(JSON.parse(shared.item_json).miniProgramIds, ['survivor'])
  assert.equal(JSON.parse(shared.item_json).miniProgramId, 'survivor')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM content_items').get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_assets').get().count, 1)

  const settings = getInternalAdminSettings()
  assert.equal(settings.miniPrograms.some((item) => item.id === 'target'), false)
  assert.equal(settings.currentMiniProgramId, 'survivor')
  assert.deepEqual(settings.contentPools.map((item) => item.id), ['shared-pool', 'archive-pool'])
  assert.equal(settings.operationLogs[0].type, '小程序删除')
  assert.match(settings.operationLogs[0].description, /内容池和图片均保留/)

  const release = database.readState(releaseStateFile)
  assert.equal(Object.hasOwn(release.uploads, targetAppId), false)
  assert.equal(release.versions.fingerprint.version, 'V1')
  assert.equal(fs.existsSync(path.join(keyDirectory, `${targetAppId}.key`)), false)
})

test('上下移动会持久化，边界操作幂等', () => {
  assert.deepEqual(getInternalAdminSettings().miniPrograms.map((item) => item.id), ['survivor', 'archived', 'other'])
  reorderMiniProgram('other', 'up')
  assert.deepEqual(getInternalAdminSettings().miniPrograms.map((item) => item.id), ['other', 'archived', 'survivor'])
  assert.deepEqual(database.readState(settingsFile).miniPrograms.map((item) => item.id), ['other', 'archived', 'survivor'])
  reorderMiniProgram('other', 'up')
  assert.deepEqual(database.readState(settingsFile).miniPrograms.map((item) => item.id), ['other', 'archived', 'survivor'])
})

test('即使还有历史停用项，最后一个 active 小程序也不能删除', () => {
  deleteMiniProgram('other')
  assert.throws(() => deleteMiniProgram('survivor'), /至少保留一个已接入的小程序/)
})

test('全新数据目录只初始化一个尽量留空的默认小程序和默认内容池', () => {
  const freshDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-fresh-defaults-'))
  try {
    const output = execFileSync(process.execPath, ['-e', `
      const { getInternalAdminSettings } = require('./src/modules/admin/admin-settings.store')
      process.stdout.write(JSON.stringify(getInternalAdminSettings()))
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: freshDataDir },
    })
    const settings = JSON.parse(output)
    assert.equal(settings.miniPrograms.length, 1)
    assert.equal(settings.miniPrograms[0].name, '默认小程序')
    assert.equal(settings.miniPrograms[0].appId, '')
    assert.equal(settings.miniPrograms[0].appSecret, '')
    assert.equal(settings.miniPrograms[0].developerEmail, '')
    assert.equal(settings.miniPrograms[0].remark, '')
    // 全新数据目录预填后台默认文案（下发给小程序后以自定义配置形式生效）
    assert.deepEqual(settings.miniPrograms[0].config.system.checkinBeforeTexts, ['今天也等到你了', '每天都来打卡吧'])
    assert.deepEqual(settings.miniPrograms[0].config.system.checkinAfterTexts, ['今日已点亮，明天再来打卡吧！', '感谢你的支持，明天我等你哦！'])
    assert.deepEqual(settings.miniPrograms[0].config.system.dailyContentPromptTexts, ['想说的，都悄悄放这里了', '打开前，猜猜里面是什么'])
    assert.deepEqual(settings.contentPools.map((item) => item.name), ['默认内容池'])
    assert.equal(settings.contentPools[0].remark, '')
    assert.equal(settings.storage.appId, '')
    assert.equal(settings.storage.secretId, '')
    assert.equal(settings.storage.secretKey, '')
    assert.equal(settings.storage.bucket, '')
    assert.equal(settings.storage.region, '')
    assert.equal(settings.storage.url, '')
    assert.deepEqual(settings.operationLogs, [])
  } finally {
    fs.rmSync(freshDataDir, { recursive: true, force: true })
  }
})
