const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-offline-sync-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [
    { id: 'pool-1', name: '离线同步内容池' },
    { id: 'pool-2', name: '备用离线同步内容池' },
  ],
  miniPrograms: [{
    id: 'mp1',
    name: '离线同步小程序',
    appId: 'wx03d0fa4e3c10441d',
    status: 'active',
    config: { contentPoolId: 'pool-1' },
  }],
  operationLogs: [],
})
const { appendContentItems } = require('../src/modules/content/content.store')
appendContentItems('pool-1', 'letters', [{
  id: 'offline-sync-letter',
  content: '用于验证离线同步幂等性的测试心笺。',
  label: '测试',
}])
appendContentItems('pool-2', 'letters', [{
  id: 'offline-sync-letter',
  content: '备用池中的同编号心笺。',
  label: '测试',
}])
const { createAppRouter } = require('../src/routes')
const { withCors } = require('../src/lib/cors')
const { getMessages } = require('../src/modules/messages/message.store')
const { updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')

const DATA_SCOPE_ID = 'shared:pool-1'

let server
let baseUrl
let sessionToken

function headers(idempotencyKey = '', dataScopeId = DATA_SCOPE_ID) {
  return {
    'content-type': 'application/json',
    'x-miniapp-appid': 'wx03d0fa4e3c10441d',
    'x-miniapp-session': sessionToken,
    'x-visitor-id': 'offline-sync-user',
    ...(dataScopeId ? { 'x-miniapp-data-scope': dataScopeId } : {}),
    ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
  }
}

async function call(pathname, { body, idempotencyKey = '', dataScopeId = DATA_SCOPE_ID, method = 'POST' } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: headers(idempotencyKey, dataScopeId),
    body: JSON.stringify(body || {}),
  })
  return { status: response.status, data: await response.json() }
}

test.before(async () => {
  server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(`${baseUrl}/api/miniapp/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-miniapp-appid': 'wx03d0fa4e3c10441d',
      'x-miniapp-data-scope': DATA_SCOPE_ID,
      'x-visitor-id': 'offline-sync-user',
    },
    body: JSON.stringify({ code: 'development-test-code' }),
  })
  sessionToken = (await login.json()).sessionToken
  assert.ok(sessionToken)
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('same message idempotency key returns the original result without a duplicate message', async () => {
  const letters = await fetch(`${baseUrl}/api/miniapp/letters`, { headers: headers() })
  const letter = (await letters.json()).items[0]
  const key = 'message_replay_00000001'
  const payload = { source: 'letters', sourceId: letter.id, content: '离线恢复后只应保存一次。' }
  const before = getMessages({ source: 'letters' }).length

  const first = await call('/api/miniapp/messages', { body: payload, idempotencyKey: key })
  const replay = await call('/api/miniapp/messages', { body: payload, idempotencyKey: key })

  assert.equal(first.status, 201)
  assert.equal(replay.status, 201)
  assert.equal(replay.data.messageId, first.data.messageId)
  assert.equal(getMessages({ source: 'letters' }).length, before + 1)
})

test('every scoped user-data write rejects missing or stale scope before side effects', async () => {
  const entries = [
    ['/api/miniapp/profile', 'POST', { nickname: '不得写入' }],
    ['/api/miniapp/profile/avatar', 'POST', {}],
    ['/api/miniapp/profile/sync-login', 'POST', { nickname: '不得同步' }],
    ['/api/miniapp/daily-content/open', 'POST', { type: 'text' }],
    ['/api/miniapp/interactions/share', 'POST', { source: 'letters', sourceId: 'offline-sync-letter' }],
    ['/api/miniapp/check-in', 'POST', {}],
    ['/api/miniapp/interactions/toggle', 'POST', { source: 'letters', sourceId: 'offline-sync-letter', type: 'favorite', desiredState: true }],
    ['/api/miniapp/messages', 'POST', { source: 'letters', sourceId: 'offline-sync-letter', content: '不得留言' }],
    ['/api/miniapp/messages', 'DELETE', { source: 'letters', sourceId: 'offline-sync-letter' }],
  ]

  const missingSessionScope = await fetch(`${baseUrl}/api/miniapp/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-miniapp-appid': 'wx03d0fa4e3c10441d',
      'x-visitor-id': 'missing-scope-session-user',
    },
    body: JSON.stringify({ code: 'missing-scope-code' }),
  })
  assert.equal(missingSessionScope.status, 409)

  for (const [pathname, method, body] of entries) {
    for (const dataScopeId of [null, 'shared:stale-pool']) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: headers('', dataScopeId),
        body: JSON.stringify(body),
      })
      const data = await response.json()
      assert.equal(response.status, 409, `${method} ${pathname}`)
      assert.equal(data.code, 'DATA_SCOPE_CHANGED')
    }
  }

  const validProfile = await call('/api/miniapp/profile', {
    body: { nickname: '范围校验后可写入' },
    dataScopeId: DATA_SCOPE_ID,
  })
  assert.equal(validProfile.status, 200)
  assert.equal(validProfile.data.profile.nickname, '范围校验后可写入')
})

test('expired idempotency records are removed while recent records still replay', async () => {
  const letters = await fetch(`${baseUrl}/api/miniapp/letters`, { headers: headers() })
  const letter = (await letters.json()).items[0]
  const expiredKey = 'message_expired_000001'
  const freshKey = 'message_current_000001'
  const payload = { source: 'letters', sourceId: letter.id, content: '保留期内的请求仍可安全重放。' }
  const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()

  getDatabase().prepare(`
    INSERT INTO idempotency_records (
      operation, data_scope_id, origin_mini_program_id, account_id, request_key, request_hash,
      response_status, response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('message', 'shared:pool-1', 'mp1', 'expired-account', expiredKey, 'expired-hash', 201, '{}', expiredAt)

  const first = await call('/api/miniapp/messages', { body: payload, idempotencyKey: freshKey })
  const replay = await call('/api/miniapp/messages', { body: payload, idempotencyKey: freshKey })
  const expired = getDatabase().prepare('SELECT 1 FROM idempotency_records WHERE request_key = ?').get(expiredKey)

  assert.equal(first.status, 201)
  assert.equal(replay.status, 201)
  assert.equal(replay.data.messageId, first.data.messageId)
  assert.equal(expired, undefined)
})

test('same interaction idempotency key does not toggle twice and cannot be reused for another intent', async () => {
  const letters = await fetch(`${baseUrl}/api/miniapp/letters`, { headers: headers() })
  const letter = (await letters.json()).items[0]
  const key = 'interaction_replay_0001'
  const payload = { source: 'letters', sourceId: letter.id, type: 'favorite', desiredState: true }

  const first = await call('/api/miniapp/interactions/toggle', { body: payload, idempotencyKey: key })
  const replay = await call('/api/miniapp/interactions/toggle', { body: payload, idempotencyKey: key })
  const conflict = await call('/api/miniapp/interactions/toggle', {
    body: { ...payload, desiredState: false },
    idempotencyKey: key,
  })

  assert.equal(first.status, 200)
  assert.equal(first.data.interaction.favorited, true)
  assert.deepEqual(replay, first)
  assert.equal(conflict.status, 400)
  assert.equal(conflict.data.message, '请求幂等键与操作内容不一致')
})

test('stale or forged data scopes cannot write after a mode switch or content-pool change', async () => {
  const sourceId = 'offline-sync-letter'
  const originalMessage = await call('/api/miniapp/messages', {
    body: { source: 'letters', sourceId, content: '切换前留言' },
    idempotencyKey: 'scope_message_before_01',
  })
  assert.equal(originalMessage.status, 201)

  try {
    updateMiniProgramConfig('mp1', { contentPoolId: 'pool-1', dataMode: 'independent' })
    const staleAfterModeSwitch = await call('/api/miniapp/interactions/toggle', {
      body: { source: 'letters', sourceId, type: 'favorite', desiredState: true },
      dataScopeId: DATA_SCOPE_ID,
      idempotencyKey: 'scope_interaction_stale_01',
    })
    assert.equal(staleAfterModeSwitch.status, 409)
    assert.equal(staleAfterModeSwitch.data.code, 'DATA_SCOPE_CHANGED')

    updateMiniProgramConfig('mp1', { contentPoolId: 'pool-2', dataMode: 'shared' })
    const poolScope = 'shared:pool-2'
    const staleMessage = await call('/api/miniapp/messages', {
      body: { source: 'letters', sourceId, content: '不得写入备用池' },
      dataScopeId: DATA_SCOPE_ID,
      idempotencyKey: 'scope_message_stale_001',
    })
    const staleDelete = await call('/api/miniapp/messages', {
      body: { source: 'letters', sourceId },
      dataScopeId: DATA_SCOPE_ID,
      idempotencyKey: 'scope_delete_stale_0001',
      method: 'DELETE',
    })
    const forgedInteraction = await call('/api/miniapp/interactions/toggle', {
      body: { source: 'letters', sourceId, type: 'favorite', desiredState: true },
      dataScopeId: 'shared:forged-pool',
      idempotencyKey: 'scope_interaction_forged_1',
    })
    const missingScope = await call('/api/miniapp/messages', {
      body: { source: 'letters', sourceId, content: '缺少范围也不得写入' },
      dataScopeId: null,
      idempotencyKey: 'scope_message_missing_01',
    })

    assert.equal(staleMessage.status, 409)
    assert.equal(staleDelete.status, 409)
    assert.equal(forgedInteraction.status, 409)
    assert.equal(missingScope.status, 409)
    assert.equal(getDatabase().prepare(`
      SELECT COUNT(*) AS count FROM messages
      WHERE data_scope_id = ? AND item_json LIKE '%不得写入备用池%'
    `).get(poolScope).count, 0)
    assert.equal(getDatabase().prepare(`
      SELECT COUNT(*) AS count FROM reactions WHERE data_scope_id = ? AND source_id = ?
    `).get(poolScope, sourceId).count, 0)
  } finally {
    updateMiniProgramConfig('mp1', { contentPoolId: 'pool-1', dataMode: 'shared' })
  }
})
