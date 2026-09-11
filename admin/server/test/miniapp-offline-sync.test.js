const assert = require('node:assert/strict')
const test = require('node:test')

const TEST_DATA_SCOPE_ID = 'shared:pool-1'
const TEST_SESSION_EXPIRES_AT = '2099-01-01T00:00:00.000Z'

// 启动配置服务持有跨请求状态（latest/generation）：断言配置请求行为的用例必须先重置模块
function purgeStartupConfigModules() {
  ;[
    '../../../miniprogram/utils/startup-config',
    '../../../miniprogram/utils/request',
    '../../../miniprogram/utils/offline-sync',
    '../../../miniprogram/services/miniapp',
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)]
  })
}

function seedDataScope(storage, appId) {
  storage.set(`miniappDataScope:prod:${appId}`, TEST_DATA_SCOPE_ID)
}

function replyWithCurrentScope(options, dataScopeId = TEST_DATA_SCOPE_ID) {
  if (!options.url.includes('/miniapp/config')) return false
  options.success({ statusCode: 200, data: { dataScopeId } })
  return true
}

function enableSessionRefresh(wxMock, accountId) {
  wxMock.login = ({ success }) => success({ code: 'offline-sync-test-code' })
  return (options) => {
    if (!options.url.endsWith('/miniapp/session')) return false
    options.success({
      statusCode: 200,
      data: {
        sessionToken: `${accountId}-refreshed-token`,
        sessionExpiresAt: TEST_SESSION_EXPIRES_AT,
        accountId,
      },
    })
    return true
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('network failures persist an operation and later reuse its idempotency key', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { flushPendingOperations, getPendingOperations, runOfflineOperation } = require('../../../miniprogram/utils/offline-sync')
    saveMiniAppSession({ sessionToken: 'offline-test-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-test-account' })
    const replyWithCurrentSession = enableSessionRefresh(global.wx, 'offline-test-account')

    let failedHeader
    global.wx.request = (options) => {
      failedHeader = options.header['x-idempotency-key']
      options.fail({ errMsg: 'request:fail network unavailable' })
    }
    const queued = await runOfflineOperation('message', {
      source: 'letters', sourceId: 'letter-001', content: '稍后应自动送达。',
    })
    assert.equal(queued.queued, true)
    assert.equal(getPendingOperations().length, 1)
    assert.equal(getPendingOperations()[0].dataScopeId, TEST_DATA_SCOPE_ID)

    let replayHeader
    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options)) return
      replayHeader = options.header['x-idempotency-key']
      options.success({ statusCode: 201, data: { messageId: 'msg-synced' } })
    }
    const flushed = await flushPendingOperations()
    assert.deepEqual(flushed, { synced: 1, discarded: 0, pending: 0 })
    assert.equal(replayHeader, failedHeader)
    assert.equal(getPendingOperations().length, 0)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('session creation fetches the server scope first and echoes it in the write request', async () => {
  purgeStartupConfigModules()
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-session-scope-test', envVersion: 'develop' } } },
  }

  try {
    const calls = []
    global.wx.request = (options) => {
      calls.push(options)
      if (options.url.includes('/miniapp/config')) {
        options.success({ statusCode: 200, data: { dataScopeId: TEST_DATA_SCOPE_ID } })
        return
      }
      options.success({
        statusCode: 200,
        data: {
          sessionToken: 'session-scope-token',
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
          accountId: 'session-scope-account',
        },
      })
    }
    const { createMiniAppSession, getStoredDataScopeId } = require('../../../miniprogram/utils/request')
    await createMiniAppSession('session-scope-code')

    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /\/miniapp\/config$/)
    assert.match(calls[1].url, /\/miniapp\/session$/)
    assert.equal(calls[1].header['x-miniapp-data-scope'], TEST_DATA_SCOPE_ID)
    assert.equal(getStoredDataScopeId(), TEST_DATA_SCOPE_ID)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('retryable server failures stay queued and preserve FIFO order', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-retryable-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-retryable-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { flushPendingOperations, getPendingOperations, runOfflineOperation } = require('../../../miniprogram/utils/offline-sync')
    saveMiniAppSession({ sessionToken: 'offline-retryable-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-retryable-account' })
    const replyWithCurrentSession = enableSessionRefresh(global.wx, 'offline-retryable-account')

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    await runOfflineOperation('message', { source: 'letters', sourceId: 'letter-001', content: '稍后重试。' })
    await runOfflineOperation('message_delete', { source: 'letters', sourceId: 'letter-001' })

    const attempted = []
    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options)) return
      attempted.push(options.method)
      options.success({ statusCode: 429, data: { message: '请求过于频繁' } })
    }
    assert.deepEqual(await flushPendingOperations(), { synced: 0, discarded: 0, pending: 2 })
    assert.deepEqual(attempted, ['POST'])
    assert.deepEqual(getPendingOperations().map((entry) => entry.operation), ['message', 'message_delete'])
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('terminal server failures are discarded and reported to the caller', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-terminal-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-terminal-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { flushPendingOperations, getPendingOperations, runOfflineOperation } = require('../../../miniprogram/utils/offline-sync')
    saveMiniAppSession({ sessionToken: 'offline-terminal-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-terminal-account' })
    const replyWithCurrentSession = enableSessionRefresh(global.wx, 'offline-terminal-account')

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    await runOfflineOperation('message', { source: 'letters', sourceId: 'letter-001', content: '已无效的留言。' })

    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options)) return
      options.success({ statusCode: 400, data: { message: '内容不存在' } })
    }
    assert.deepEqual(await flushPendingOperations(), { synced: 0, discarded: 1, pending: 0 })
    assert.equal(getPendingOperations().length, 0)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('queued message creation, deletion, and replacement replay in FIFO order', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-fifo-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-fifo-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { flushPendingOperations, getPendingOperations, runOfflineOperation } = require('../../../miniprogram/utils/offline-sync')
    saveMiniAppSession({ sessionToken: 'offline-fifo-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-fifo-account' })
    const replyWithCurrentSession = enableSessionRefresh(global.wx, 'offline-fifo-account')

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    await runOfflineOperation('message', { source: 'letters', sourceId: 'letter-001', content: '留言 A' })
    await runOfflineOperation('message_delete', { source: 'letters', sourceId: 'letter-001' })
    await runOfflineOperation('message', { source: 'letters', sourceId: 'letter-001', content: '留言 B' })
    assert.deepEqual(getPendingOperations().map((entry) => entry.operation), ['message', 'message_delete', 'message'])

    const replayed = []
    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options)) return
      replayed.push({ method: options.method, data: options.data })
      options.success({ statusCode: options.method === 'DELETE' ? 200 : 201, data: {} })
    }
    const flushed = await flushPendingOperations()
    assert.deepEqual(flushed, { synced: 3, discarded: 0, pending: 0 })
    assert.deepEqual(replayed, [
      { method: 'POST', data: { source: 'letters', sourceId: 'letter-001', content: '留言 A' } },
      { method: 'DELETE', data: { source: 'letters', sourceId: 'letter-001' } },
      { method: 'POST', data: { source: 'letters', sourceId: 'letter-001', content: '留言 B' } },
    ])
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('operations added during a flush remain queued for the next FIFO replay', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-concurrency-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-concurrency-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { flushPendingOperations, getPendingOperations, runOfflineOperation } = require('../../../miniprogram/utils/offline-sync')
    saveMiniAppSession({ sessionToken: 'offline-concurrency-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-concurrency-account' })
    const replyWithCurrentSession = enableSessionRefresh(global.wx, 'offline-concurrency-account')

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    await runOfflineOperation('message', { source: 'letters', sourceId: 'letter-001', content: '旧留言' })

    let finishFirstRequest
    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options)) return
      if (options.data.content === '旧留言') {
        finishFirstRequest = () => options.success({ statusCode: 201, data: {} })
        return
      }
      options.fail({ errMsg: 'request:fail network unavailable' })
    }
    const flushing = flushPendingOperations()
    await waitFor(() => typeof finishFirstRequest === 'function')
    assert.equal(typeof finishFirstRequest, 'function')

    await runOfflineOperation('message_delete', { source: 'letters', sourceId: 'letter-001' })
    await runOfflineOperation('message', { source: 'letters', sourceId: 'letter-001', content: '新留言' })
    finishFirstRequest()

    assert.deepEqual(await flushing, { synced: 1, discarded: 0, pending: 2 })
    assert.deepEqual(getPendingOperations().map((entry) => entry.operation), ['message_delete', 'message'])

    const replayed = []
    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options)) return
      replayed.push({ method: options.method, data: options.data })
      options.success({ statusCode: options.method === 'DELETE' ? 200 : 201, data: {} })
    }
    assert.deepEqual(await flushPendingOperations(), { synced: 2, discarded: 0, pending: 0 })
    assert.deepEqual(replayed, [
      { method: 'DELETE', data: { source: 'letters', sourceId: 'letter-001' } },
      { method: 'POST', data: { source: 'letters', sourceId: 'letter-001', content: '新留言' } },
    ])
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('offline deletion clears the cached current message immediately', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-delete-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-delete-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { deletePrivateMessage, getCachedLetters, getLetters } = require('../../../miniprogram/services/miniapp')
    saveMiniAppSession({ sessionToken: 'offline-delete-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-delete-account' })

    global.wx.request = (options) => {
      if (options.url.includes('/miniapp/letters')) {
        options.success({ statusCode: 200, data: { items: [{ id: 'letter-001', myMessage: '待删除留言' }] } })
      }
    }
    await getLetters()

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    const deleted = await deletePrivateMessage({ source: 'letters', sourceId: 'letter-001' })
    assert.equal(deleted.queued, true)
    assert.equal(getCachedLetters().items[0].myMessage, '')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('a pending offline deletion masks stale content returned by a later read', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-delete-mask-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-delete-mask-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { deletePrivateMessage, getCachedLetters, getLetters } = require('../../../miniprogram/services/miniapp')
    saveMiniAppSession({ sessionToken: 'offline-delete-mask-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-delete-mask-account' })

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    await deletePrivateMessage({ source: 'letters', sourceId: 'letter-001' })

    global.wx.request = (options) => {
      if (options.url.includes('/miniapp/letters')) {
        options.success({ statusCode: 200, data: { items: [{ id: 'letter-001', myMessage: '不应恢复的旧留言' }] } })
      }
    }
    const letters = await getLetters({ force: true })
    assert.equal(letters.items[0].myMessage, '')
    assert.equal(getCachedLetters().items[0].myMessage, '')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('a pending daily-content deletion masks stale home data returned by a forced read', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-home-delete-test', envVersion: 'develop' } } },
  }
  seedDataScope(storage, 'wx-offline-home-delete-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { deletePrivateMessage, getCachedHomeData, getHomeData } = require('../../../miniprogram/services/miniapp')
    saveMiniAppSession({ sessionToken: 'offline-home-delete-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-home-delete-account' })

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    await deletePrivateMessage({ source: 'daily_content', sourceId: 'daily-content-001' })

    global.wx.request = (options) => {
      if (options.url.includes('/miniapp/home')) {
        options.success({ statusCode: 200, data: { dailyContent: { id: 'daily-content-001', myMessage: '不应恢复的旧留言' } } })
      }
    }
    const home = await getHomeData({ force: true })
    assert.equal(home.dailyContent.myMessage, '')
    assert.equal(getCachedHomeData().dailyContent.myMessage, '')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('content reads wait for startup offline sync before requesting fresh data', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-offline-race-test', envVersion: 'develop' } } },
    onNetworkStatusChange() {},
  }
  seedDataScope(storage, 'wx-offline-race-test')

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { runOfflineOperation } = require('../../../miniprogram/utils/offline-sync')
    saveMiniAppSession({ sessionToken: 'offline-race-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'offline-race-account' })
    const replyWithCurrentSession = enableSessionRefresh(global.wx, 'offline-race-account')

    global.wx.request = (options) => options.fail({ errMsg: 'request:fail network unavailable' })
    await runOfflineOperation('message', {
      source: 'letters', sourceId: 'letter-001', content: '启动同步完成后再读取。',
    })

    const requests = []
    let finishMessageSync
    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options)) return
      if (options.url.includes('/miniapp/messages')) {
        requests.push('sync-message')
        finishMessageSync = () => options.success({ statusCode: 201, data: { messageId: 'msg-race' } })
        return
      }
      if (options.url.includes('/miniapp/letters')) {
        requests.push('read-letters')
        options.success({ statusCode: 200, data: { items: [], pagination: { page: 1, totalPages: 1 } } })
      }
    }

    const { getLetters, startOfflineSync } = require('../../../miniprogram/services/miniapp')
    startOfflineSync()
    const letters = getLetters()
    await waitFor(() => typeof finishMessageSync === 'function')
    assert.deepEqual(requests, ['sync-message'])

    finishMessageSync()
    await letters
    assert.deepEqual(requests, ['sync-message', 'read-letters'])
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('scope changes discard current-contract operations without reading the previous namespace', async () => {
  const storage = new Map()
  const originalWx = global.wx
  const appId = 'wx-offline-scope-change'
  const visitorId = 'offline-scope-user'
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId, envVersion: 'develop' } } },
  }
  storage.set('visitorId', visitorId)
  seedDataScope(storage, appId)
  storage.set(`miniappOfflineOperations:prod:${appId}:${visitorId}`, [
    { operation: 'message', payload: { source: 'letters', sourceId: 'unread-previous-namespace', content: '旧留言' }, dataScopeId: TEST_DATA_SCOPE_ID, idempotencyKey: 'legacy_namespace_message', createdAt: new Date().toISOString() },
  ])
  storage.set(`miniappOfflineOperations:daily-content-v1:prod:${appId}:${visitorId}`, [
    { operation: 'message', accountId: 'offline-scope-account', payload: { source: 'letters', sourceId: 'letter-001', content: '旧留言' }, dataScopeId: TEST_DATA_SCOPE_ID, idempotencyKey: 'scope_old_message_001', createdAt: new Date().toISOString() },
    { operation: 'message_delete', accountId: 'offline-scope-account', payload: { source: 'letters', sourceId: 'letter-001' }, dataScopeId: TEST_DATA_SCOPE_ID, idempotencyKey: 'scope_old_delete_0001', createdAt: new Date().toISOString() },
    { operation: 'interaction', accountId: 'offline-scope-account', payload: { source: 'letters', sourceId: 'letter-001', type: 'favorite', desiredState: true }, dataScopeId: TEST_DATA_SCOPE_ID, idempotencyKey: 'scope_old_reaction_01', createdAt: new Date().toISOString() },
    { operation: 'message', accountId: 'offline-scope-account', payload: { source: 'letters', sourceId: 'letter-001', content: '旧格式留言' }, idempotencyKey: 'scope_legacy_message_1', createdAt: new Date().toISOString() },
  ])

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { flushPendingOperations, getPendingOperations } = require('../../../miniprogram/utils/offline-sync')
    saveMiniAppSession({ sessionToken: 'offline-scope-token', sessionExpiresAt: TEST_SESSION_EXPIRES_AT, accountId: 'offline-scope-account' })
    const replyWithCurrentSession = enableSessionRefresh(global.wx, 'offline-scope-account')
    const businessRequests = []
    global.wx.request = (options) => {
      if (replyWithCurrentSession(options)) return
      if (replyWithCurrentScope(options, 'independent:mp1:pool-2')) return
      businessRequests.push(options)
      options.success({ statusCode: 200, data: {} })
    }

    assert.deepEqual(await flushPendingOperations(), { synced: 0, discarded: 4, pending: 0 })
    assert.deepEqual(businessRequests, [])
    assert.deepEqual(getPendingOperations(), [])
    assert.equal(storage.get(`miniappOfflineOperations:prod:${appId}:${visitorId}`).length, 1)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('pending deletes from another scope never mask current-scope content while offline', async () => {
  const storage = new Map()
  const originalWx = global.wx
  const appId = 'wx-offline-cache-scope'
  const visitorId = 'offline-cache-scope-user'
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId, envVersion: 'develop' } } },
  }
  storage.set('visitorId', visitorId)
  storage.set(`miniappDataScope:prod:${appId}`, 'shared:pool-b')
  storage.set(`miniappOfflineOperations:daily-content-v1:prod:${appId}:${visitorId}`, [{
    operation: 'message_delete',
    accountId: 'offline-cache-scope-account',
    payload: { source: 'letters', sourceId: 'letter-001' },
    dataScopeId: 'shared:pool-a',
    idempotencyKey: 'other_scope_delete_01',
    createdAt: new Date().toISOString(),
  }])

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    saveMiniAppSession({ sessionToken: 'offline-cache-scope-token', sessionExpiresAt: TEST_SESSION_EXPIRES_AT, accountId: 'offline-cache-scope-account' })
    global.wx.request = (options) => options.success({
      statusCode: 200,
      data: { items: [{ id: 'letter-001', myMessage: '当前范围留言' }] },
    })
    const { getLetters } = require('../../../miniprogram/services/miniapp')
    const letters = await getLetters({ force: true })
    assert.equal(letters.items[0].myMessage, '当前范围留言')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('session scope rejection refreshes config without replaying the login exchange', async () => {
  purgeStartupConfigModules()
  const storage = new Map()
  const originalWx = global.wx
  const appId = 'wx-session-scope-recovery'
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId, envVersion: 'develop' } } },
  }
  storage.set(`miniappDataScope:prod:${appId}`, 'shared:pool-a')

  try {
    let sessionAttempts = 0
    global.wx.request = (options) => {
      if (options.url.endsWith('/miniapp/session')) {
        sessionAttempts += 1
        options.success({ statusCode: 409, data: { code: 'DATA_SCOPE_CHANGED' } })
        return
      }
      if (options.url.endsWith('/miniapp/config')) {
        options.success({ statusCode: 200, data: { dataScopeId: 'shared:pool-b' } })
      }
    }
    const { createMiniAppSession, getStoredDataScopeId } = require('../../../miniprogram/utils/request')
    await assert.rejects(createMiniAppSession('stale-login-code'), (error) => (
      error.code === 'DATA_SCOPE_CHANGED' && error.message === '数据已更新，请重试'
    ))
    assert.equal(sessionAttempts, 1)
    assert.equal(getStoredDataScopeId(), 'shared:pool-b')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('captured offline scope headers survive current-scope injection regardless of header casing', async () => {
  const storage = new Map()
  const originalWx = global.wx
  const appId = 'wx-captured-scope-header'
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId, envVersion: 'develop' } } },
  }
  storage.set(`miniappDataScope:prod:${appId}`, 'shared:pool-current')

  try {
    const { request, saveMiniAppSession } = require('../../../miniprogram/utils/request')
    saveMiniAppSession({ sessionToken: 'captured-scope-token', sessionExpiresAt: '2099-01-01T00:00:00.000Z', accountId: 'captured-scope-account' })
    const headers = []
    global.wx.request = (options) => {
      headers.push(options.header)
      options.success({ statusCode: 200, data: {} })
    }

    await request({
      url: '/miniapp/messages',
      method: 'POST',
      auth: true,
      header: { 'X-MiniApp-Data-Scope': 'shared:pool-captured' },
    })
    await request({ url: '/miniapp/profile', method: 'POST', auth: true })

    assert.equal(headers[0]['X-MiniApp-Data-Scope'], 'shared:pool-captured')
    assert.equal(headers[0]['x-miniapp-data-scope'], undefined)
    assert.equal(headers[1]['x-miniapp-data-scope'], 'shared:pool-current')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})
