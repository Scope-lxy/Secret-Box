const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-scope-deletion-'))
process.env.MINIAPP_DATA_DIR = dataDir

const database = require('../src/lib/state-database')
const settingsFile = path.join(dataDir, 'admin-settings.json')
const storage = {
  bucket: 'scope-deletion-1250000000',
  region: 'ap-chengdu',
  secretId: 'scope-deletion-secret-id',
  secretKey: 'scope-deletion-secret-key',
  url: 'https://media.example.com/assets',
  folderPrefix: 'assets-v1',
}

database.writeState(settingsFile, {
  currentMiniProgramId: 'delete-a',
  contentPools: [
    { id: 'old-pool', name: '删除旧池', remark: '' },
    { id: 'new-pool', name: '删除新池', remark: '' },
    { id: 'account-old-pool', name: '注销旧池', remark: '' },
    { id: 'account-new-pool', name: '注销新池', remark: '' },
  ],
  miniPrograms: [
    { id: 'delete-a', name: '待删除 A', appId: '', status: 'active', config: { contentPoolId: 'new-pool', dataMode: 'shared' } },
    { id: 'delete-b', name: '保留 B', appId: '', status: 'active', config: { contentPoolId: 'new-pool', dataMode: 'shared' } },
    { id: 'account-a', name: '待注销 A', appId: '', status: 'active', config: { contentPoolId: 'account-new-pool', dataMode: 'shared' } },
    { id: 'account-b', name: '保留 B 账号', appId: '', status: 'active', config: { contentPoolId: 'account-new-pool', dataMode: 'shared' } },
  ],
  operationLogs: [],
  storage,
})

const { deleteMiniProgram } = require('../src/modules/admin/mini-program-deletion.service')
const { updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { deleteAccountForMiniProgram } = require('../src/modules/auth/account-deletion.service')
const { getAccountById } = require('../src/modules/auth/account.store')
const { getOpened } = require('../src/modules/interactions/interaction.store')

const originalFetch = global.fetch

function managedAvatarUrl(accountId, marker) {
  return `${storage.url}/assets-v1/avatars/${accountId}/${marker}-0123456789abcdef.jpg`
}

function insertAccount(accountId, miniProgramIds) {
  const db = database.getDatabase()
  const now = new Date().toISOString()
  const primaryMiniProgramId = miniProgramIds[0]
  const item = {
    accountId,
    miniProgramId: primaryMiniProgramId,
    miniProgramIds,
    wechatIdentities: miniProgramIds.map((miniProgramId) => ({
      miniProgramId,
      openid: `${accountId}-${miniProgramId}`,
    })),
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

function insertOpened({ id, scopeId, miniProgramId, accountId, preview }) {
  const now = new Date().toISOString()
  database.getDatabase().prepare(`
    INSERT INTO opened_records (
      opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
      source, source_id, created_at, item_json
    ) VALUES (?, ?, ?, ?, ?, 'daily_content', ?, ?, ?)
  `).run(id, id, scopeId, miniProgramId, accountId, id, now, JSON.stringify({ preview }))
}

function insertProfile({ scopeId, accountId, miniProgramId, nickname, avatarUrl }) {
  const now = new Date().toISOString()
  database.getDatabase().prepare(`
    INSERT INTO user_scope_profiles (
      data_scope_id, account_id, nickname, avatar_text, avatar_url, preferences_json,
      updated_at, nickname_updated_at, avatar_updated_at, preferences_updated_at,
      origin_mini_program_id
    ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)
  `).run(scopeId, accountId, nickname, nickname.slice(0, 1), avatarUrl, now, now, now, now, miniProgramId)
}

function captureCosDeletes() {
  const deletedKeys = []
  global.fetch = async (input, init = {}) => {
    if (init.method === 'DELETE') {
      const url = new URL(typeof input === 'string' ? input : input.url)
      deletedKeys.push(decodeURIComponent(url.pathname.slice(1)))
    }
    return { ok: true, status: 204 }
  }
  return deletedKeys
}

function seedRows() {
  insertAccount('account-shared', ['account-a', 'account-b'])
  insertAccount('account-reference', ['account-b'])
  insertAccount('mini-shared', ['delete-a', 'delete-b'])
  insertAccount('mini-reference', ['delete-b'])
  insertAccount('mini-exclusive', ['delete-a'])

  const accountRetainedAvatar = managedAvatarUrl('account-shared', 'mretain')
  const accountUniqueAvatar = managedAvatarUrl('account-shared', 'munique')
  insertOpened({
    id: 'account-old-opened',
    scopeId: 'shared:account-old-pool',
    miniProgramId: 'account-a',
    accountId: 'account-shared',
    preview: '账号切回旧池可见',
  })
  insertProfile({
    scopeId: 'shared:account-old-pool',
    accountId: 'account-shared',
    miniProgramId: 'account-a',
    nickname: '账号旧池资料',
    avatarUrl: '',
  })
  insertProfile({
    scopeId: 'shared:account-old-pool',
    accountId: 'account-reference',
    miniProgramId: 'account-b',
    nickname: '账号头像引用资料',
    avatarUrl: accountRetainedAvatar,
  })
  insertProfile({
    scopeId: 'independent:account-a:legacy-pool',
    accountId: 'account-shared',
    miniProgramId: 'account-a',
    nickname: '账号待删旧分支',
    avatarUrl: accountRetainedAvatar,
  })
  insertProfile({
    scopeId: 'independent:account-a:unique-pool',
    accountId: 'account-shared',
    miniProgramId: 'account-a',
    nickname: '账号独占头像',
    avatarUrl: accountUniqueAvatar,
  })

  const miniRetainedAvatar = managedAvatarUrl('mini-shared', 'mretain')
  const miniUniqueAvatar = managedAvatarUrl('mini-exclusive', 'munique')
  insertOpened({
    id: 'mini-old-opened',
    scopeId: 'shared:old-pool',
    miniProgramId: 'delete-a',
    accountId: 'mini-shared',
    preview: '小程序切回旧池可见',
  })
  insertOpened({
    id: 'mini-exclusive-old-opened',
    scopeId: 'shared:old-pool',
    miniProgramId: 'delete-a',
    accountId: 'mini-exclusive',
    preview: 'A 独占旧池记录',
  })
  insertProfile({
    scopeId: 'shared:old-pool',
    accountId: 'mini-shared',
    miniProgramId: 'delete-a',
    nickname: '小程序旧池资料',
    avatarUrl: '',
  })
  insertProfile({
    scopeId: 'shared:old-pool',
    accountId: 'mini-reference',
    miniProgramId: 'delete-b',
    nickname: '小程序头像引用资料',
    avatarUrl: miniRetainedAvatar,
  })
  insertProfile({
    scopeId: 'shared:old-pool',
    accountId: 'mini-exclusive',
    miniProgramId: 'delete-a',
    nickname: 'A 独占旧池资料',
    avatarUrl: miniUniqueAvatar,
  })
  insertProfile({
    scopeId: 'independent:delete-a:legacy-pool',
    accountId: 'mini-shared',
    miniProgramId: 'delete-a',
    nickname: 'A 待删独立资料',
    avatarUrl: miniRetainedAvatar,
  })
}

test.before(seedRows)

test.after(() => {
  global.fetch = originalFetch
  database.closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('注销 A 账号后保留 B 的历史共享池，切回旧池仍能读取数据', async () => {
  const deletedKeys = captureCosDeletes()
  const result = await deleteAccountForMiniProgram({ accountId: 'account-shared', miniProgramId: 'account-a' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.accountRemoved, false)
  assert.deepEqual(database.getDatabase().prepare(`
    SELECT mini_program_id FROM account_mini_programs WHERE account_id = 'account-shared'
  `).all(), [{ mini_program_id: 'account-b' }])
  assert.equal(database.getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM user_scope_profiles
    WHERE account_id = 'account-shared' AND data_scope_id LIKE 'independent:account-a:%'
  `).get().count, 0)
  assert.deepEqual(deletedKeys, ['assets-v1/avatars/account-shared/munique-0123456789abcdef.jpg'])

  updateMiniProgramConfig('account-b', { contentPoolId: 'account-old-pool', dataMode: 'shared' })
  assert.equal(getOpened({ miniProgramId: 'account-b', visitorId: 'account-shared' })[0].preview, '账号切回旧池可见')
  assert.equal(getAccountById('account-shared', 'account-b').nickname, '账号旧池资料')
})

test('删除 A 小程序后保留 B 的历史共享池，且只清理无人引用的头像', async () => {
  const deletedKeys = captureCosDeletes()
  const result = deleteMiniProgram('delete-a')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.deleted, true)
  assert.equal(database.getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM opened_records WHERE opened_id = 'mini-old-opened'
  `).get().count, 1)
  assert.equal(database.getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM opened_records WHERE opened_id = 'mini-exclusive-old-opened'
  `).get().count, 0)
  assert.equal(database.getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM user_scope_profiles
    WHERE data_scope_id = 'independent:delete-a:legacy-pool'
  `).get().count, 0)
  assert.deepEqual(deletedKeys, ['assets-v1/avatars/mini-exclusive/munique-0123456789abcdef.jpg'])

  updateMiniProgramConfig('delete-b', { contentPoolId: 'old-pool', dataMode: 'shared' })
  assert.equal(getOpened({ miniProgramId: 'delete-b', visitorId: 'mini-shared' })[0].preview, '小程序切回旧池可见')
  assert.equal(getAccountById('mini-shared', 'delete-b').nickname, '小程序旧池资料')
})
