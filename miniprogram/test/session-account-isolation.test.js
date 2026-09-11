const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const APP_ID = 'wx-account-test'
const VISITOR_ID = 'shared-device-visitor'
const DATA_SCOPE_ID = 'shared:pool-1'

function purgeClientModules() {
  [
    '../services/miniapp',
    '../utils/offline-sync',
    '../utils/request',
    '../utils/startup-config',
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)]
  })
}

function createStorage(entries = []) {
  return new Map([
    ['visitorId', VISITOR_ID],
    [`miniappDataScope:prod:${APP_ID}`, DATA_SCOPE_ID],
    ...entries,
  ])
}

function installWx(storage, overrides = {}) {
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getStorageInfoSync() { return { keys: [...storage.keys()] } },
    getAccountInfoSync() { return { miniProgram: { appId: APP_ID, envVersion: 'release' } } },
    ...overrides,
  }
}

function restoreGlobal(name, previous) {
  if (previous === undefined) delete global[name]
  else global[name] = previous
}

test('phone sync commits the replacement account and clears only its app, environment, and visitor state', async () => {
  const currentCache = `miniappArticlesCache:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}:account-a:${DATA_SCOPE_ID}`
  const currentProfileCache = `miniappProfileCache:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}:account-b:${DATA_SCOPE_ID}`
  const currentAction = `miniappActionIdempotency:daily-content-v1:article_open:prod:${APP_ID}:${VISITOR_ID}:${DATA_SCOPE_ID}`
  const currentQueue = `miniappOfflineOperations:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}`
  const currentPrompt = `message-phone-sync-prompt-resolved:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}`
  const unrelatedKeys = [
    `miniappArticlesCache:daily-content-v1:local:${APP_ID}:${VISITOR_ID}:account-a:${DATA_SCOPE_ID}`,
    `miniappArticlesCache:daily-content-v1:prod:wx-other-app:${VISITOR_ID}:account-a:${DATA_SCOPE_ID}`,
    `miniappArticlesCache:daily-content-v1:prod:${APP_ID}:other-visitor:account-a:${DATA_SCOPE_ID}`,
    `miniappOfflineOperations:daily-content-v1:local:${APP_ID}:${VISITOR_ID}`,
  ]
  const storage = createStorage([
    [currentCache, { data: { items: ['account-a'] }, updatedAt: Date.now() }],
    [currentAction, { key: 'account-a-action' }],
    [currentQueue, [{ operation: 'message', idempotencyKey: 'account-a-message' }]],
    [currentPrompt, '1'],
    ...unrelatedKeys.map((key) => [key, { preserved: true }]),
  ])
  const previousWx = global.wx
  const previousGetApp = global.getApp
  const accountChanges = []
  installWx(storage, {
    request(options) {
      assert.match(options.url, /\/miniapp\/profile\/sync-login$/)
      options.success({
        statusCode: 200,
        data: {
          profile: { accountId: 'account-b', phone: '13800000000' },
          sessionToken: 'account-b-session',
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
    },
  })
  global.getApp = () => ({ handleAccountChange(change) { accountChanges.push(change) } })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { syncLogin } = require('../services/miniapp')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    await syncLogin({ phoneCode: 'phone-code' })

    assert.equal(request.getStoredSession().accountId, 'account-b')
    assert.deepEqual(accountChanges, [{ previousAccountId: 'account-a', accountId: 'account-b' }])
    assert.equal(storage.has(currentAction), false)
    assert.equal(storage.has(currentQueue), false)
    assert.equal(storage.has(currentPrompt), false)
    assert.equal(storage.has(currentCache), false)
    assert.equal(storage.get(currentProfileCache).data.profile.accountId, 'account-b')
    unrelatedKeys.forEach((key) => assert.deepEqual(storage.get(key), { preserved: true }))
  } finally {
    restoreGlobal('wx', previousWx)
    restoreGlobal('getApp', previousGetApp)
    purgeClientModules()
  }
})

test('same-account phone sync keeps the existing session when the server does not replace it', async () => {
  const storage = createStorage()
  const previousWx = global.wx
  installWx(storage, {
    request(options) {
      assert.match(options.url, /\/miniapp\/profile\/sync-login$/)
      options.success({
        statusCode: 200,
        data: {
          profile: { accountId: 'account-a', phone: '13800000000' },
          wechatConfigured: true,
        },
      })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { syncLogin } = require('../services/miniapp')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    const data = await syncLogin({ phoneCode: 'phone-code' })

    assert.equal(data.profile.phone, '13800000000')
    assert.deepEqual(request.getStoredSession(), {
      token: 'account-a-session',
      expiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('first-use phone sync keeps the session created by its authenticated request', async () => {
  const storage = createStorage()
  const previousWx = global.wx
  installWx(storage, {
    login(options) { options.success({ code: 'account-a-code' }) },
    request(options) {
      if (options.url.endsWith('/miniapp/session')) {
        options.success({
          statusCode: 200,
          data: {
            profile: { accountId: 'account-a' },
            sessionToken: 'account-a-session',
            sessionExpiresAt: '2099-01-01T00:00:00.000Z',
          },
        })
        return
      }
      options.success({
        statusCode: 200,
        data: {
          profile: { accountId: 'account-a', phone: '13800000000' },
          wechatConfigured: true,
        },
      })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { syncLogin } = require('../services/miniapp')
    const data = await syncLogin({ phoneCode: 'phone-code' })

    assert.equal(data.profile.phone, '13800000000')
    assert.equal(request.getStoredSession().accountId, 'account-a')
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('account-changing phone sync rejects a response without a complete replacement session', async () => {
  const storage = createStorage()
  const previousWx = global.wx
  installWx(storage, {
    request(options) {
      options.success({
        statusCode: 200,
        data: {
          profile: { accountId: 'account-b', phone: '13800000000' },
          wechatConfigured: true,
        },
      })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { syncLogin } = require('../services/miniapp')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    await assert.rejects(syncLogin({ phoneCode: 'phone-code' }), /登录状态创建失败/)
    assert.equal(request.getStoredSession().accountId, 'account-a')
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('failed revalidation preserves the previous valid session', async () => {
  const storage = createStorage()
  const previousWx = global.wx
  installWx(storage, {
    login(options) { options.success({ code: 'revalidation-code' }) },
    request(options) { options.fail({ errMsg: 'network unavailable' }) },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    await assert.rejects(request.revalidateMiniAppSession(), /network unavailable/)
    assert.deepEqual(request.getStoredSession(), {
      token: 'account-a-session',
      expiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })
    assert.equal(request.isAccountCacheReadable(), true)
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('expired sessions hide old cache and are still revalidated for account cleanup', async () => {
  const currentCache = `miniappArticlesCache:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}:account-a:${DATA_SCOPE_ID}`
  const storage = createStorage([
    [`miniappSession:prod:${APP_ID}`, {
      token: 'expired-account-a-session',
      expiresAt: '2020-01-01T00:00:00.000Z',
      accountId: 'account-a',
    }],
    [currentCache, { data: { items: ['account-a'] }, updatedAt: Date.now() }],
  ])
  const previousWx = global.wx
  installWx(storage, {
    login(options) { options.success({ code: 'account-b-code' }) },
    request(options) {
      options.success({
        statusCode: 200,
        data: {
          profile: { accountId: 'account-b' },
          sessionToken: 'account-b-session',
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { getCachedArticles } = require('../services/miniapp')
    assert.equal(request.getStoredSession(), null)
    assert.equal(request.hasPersistedSession(), true)
    assert.equal(getCachedArticles(), null)

    await request.revalidateMiniAppSession()

    assert.equal(request.getStoredSession().accountId, 'account-b')
    assert.equal(storage.has(currentCache), false)
    const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8')
    assert.match(appSource, /hasPersistedSession\(\)[\s\S]*revalidateMiniAppSession\(\)/)
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('a response started before an account change cannot populate the new account cache', async () => {
  const previousCache = `miniappArticlesCache:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}:account-a:${DATA_SCOPE_ID}`
  const currentCache = `miniappArticlesCache:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}:account-b:${DATA_SCOPE_ID}`
  const storage = createStorage()
  const previousWx = global.wx
  let pendingRequest
  installWx(storage, {
    request(options) { pendingRequest = options },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { getArticles } = require('../services/miniapp')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })
    const articlesRequest = getArticles()
    request.commitMiniAppSession({
      sessionToken: 'account-b-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-b',
    })
    pendingRequest.success({ statusCode: 200, data: { items: ['account-a'] } })

    await assert.rejects(articlesRequest, (error) => error.code === 'ACCOUNT_CHANGED')
    assert.equal(storage.has(previousCache), false)
    assert.equal(storage.has(currentCache), false)
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('session replacement rejects a response without the required account identity', async () => {
  const storage = createStorage()
  const previousWx = global.wx
  installWx(storage, {
    login(options) { options.success({ code: 'invalid-session-code' }) },
    request(options) {
      options.success({
        statusCode: 200,
        data: {
          sessionToken: 'identity-missing-session',
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    await assert.rejects(request.revalidateMiniAppSession(), /登录状态创建失败/)
    assert.equal(request.getStoredSession().accountId, 'account-a')
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('offline flush discards a queued operation when account identity changes', async () => {
  const queueKey = `miniappOfflineOperations:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}`
  const storage = createStorage([[queueKey, [{
    operation: 'message',
    accountId: 'account-a',
    idempotencyKey: 'old-message-key',
    dataScopeId: DATA_SCOPE_ID,
    payload: { source: 'letters', sourceId: 'letter-1', content: '旧账号留言' },
  }]]])
  const previousWx = global.wx
  const requests = []
  installWx(storage, {
    login(options) { options.success({ code: 'account-b-code' }) },
    request(options) {
      requests.push(options.url)
      if (options.url.endsWith('/miniapp/config')) {
        options.success({ statusCode: 200, data: { dataScopeId: DATA_SCOPE_ID } })
        return
      }
      options.success({
        statusCode: 200,
        data: {
          profile: { accountId: 'account-b' },
          sessionToken: 'account-b-session',
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { flushPendingOperations } = require('../utils/offline-sync')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })
    const result = await flushPendingOperations()
    assert.deepEqual(result, { synced: 0, discarded: 1, pending: 0 })
    assert.equal(storage.has(queueKey), false)
    assert.equal(requests.some((url) => url.endsWith('/miniapp/messages')), false)
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('new offline operations persist the account identity that created them', async () => {
  const queueKey = `miniappOfflineOperations:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}`
  const storage = createStorage()
  const previousWx = global.wx
  installWx(storage, {
    request(options) { options.fail({ errMsg: 'network unavailable' }) },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { runOfflineOperation } = require('../utils/offline-sync')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    const result = await runOfflineOperation('message', {
      source: 'letters',
      sourceId: 'letter-1',
      content: '账号 A 的离线留言',
    })

    assert.equal(result.queued, true)
    assert.equal(storage.get(queueKey)[0].accountId, 'account-a')
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('offline flush discards legacy operations without an account identity', async () => {
  const queueKey = `miniappOfflineOperations:daily-content-v1:prod:${APP_ID}:${VISITOR_ID}`
  const storage = createStorage([[queueKey, [{
    operation: 'message',
    idempotencyKey: 'legacy-message-key',
    dataScopeId: DATA_SCOPE_ID,
    payload: { source: 'letters', sourceId: 'letter-1', content: '无法归属的旧留言' },
  }]]])
  const previousWx = global.wx
  const requests = []
  installWx(storage, {
    login(options) { options.success({ code: 'account-b-code' }) },
    request(options) {
      requests.push(options.url)
      if (options.url.endsWith('/miniapp/session')) {
        options.success({
          statusCode: 200,
          data: {
            profile: { accountId: 'account-b' },
            sessionToken: 'account-b-session',
            sessionExpiresAt: '2099-01-01T00:00:00.000Z',
          },
        })
        return
      }
      if (options.url.endsWith('/miniapp/config')) {
        options.success({ statusCode: 200, data: { dataScopeId: DATA_SCOPE_ID } })
        return
      }
      options.success({ statusCode: 200, data: { ok: true } })
    },
  })
  purgeClientModules()

  try {
    const { flushPendingOperations } = require('../utils/offline-sync')
    const result = await flushPendingOperations()

    assert.deepEqual(result, { synced: 0, discarded: 1, pending: 0 })
    assert.deepEqual(storage.get(queueKey), [])
    assert.equal(requests.some((url) => url.endsWith('/miniapp/messages')), false)
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('an old-account action completion cannot clear the new account idempotency key', async () => {
  const storage = createStorage()
  const previousWx = global.wx
  const articleRequests = []
  let notifyRequestStarted
  let requestStarted = new Promise((resolve) => { notifyRequestStarted = resolve })
  installWx(storage, {
    request(options) {
      articleRequests.push(options)
      notifyRequestStarted()
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { openArticle } = require('../services/miniapp')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    const accountAOpen = openArticle('article-1')
    await requestStarted
    request.commitMiniAppSession({
      sessionToken: 'account-b-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-b',
    })

    requestStarted = new Promise((resolve) => { notifyRequestStarted = resolve })
    const accountBOpen = openArticle('article-1')
    await requestStarted
    const actionKeys = [...storage.keys()]
      .filter((key) => key.startsWith('miniappActionIdempotency:daily-content-v1:article_open:'))
    assert.equal(actionKeys.length, 1)
    const accountBStorageKey = actionKeys[0]
    const accountBStoredAction = storage.get(accountBStorageKey)

    articleRequests[0].success({ statusCode: 200, data: { accountId: 'account-a' } })
    await assert.rejects(accountAOpen, (error) => error.code === 'ACCOUNT_CHANGED')
    const accountBStoredActionAfterAccountASettled = storage.get(accountBStorageKey)

    articleRequests[1].success({ statusCode: 200, data: { accountId: 'account-b' } })
    await accountBOpen
    assert.equal(storage.has(accountBStorageKey), false)
    assert.deepEqual(
      accountBStoredActionAfterAccountASettled,
      accountBStoredAction,
      '账号 A 的请求收尾不得删除账号 B 同 action 的幂等键',
    )
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('a same-account action completion clears its own idempotency key', async () => {
  const storage = createStorage()
  const previousWx = global.wx
  let pendingRequest
  let notifyRequestStarted
  const requestStarted = new Promise((resolve) => { notifyRequestStarted = resolve })
  installWx(storage, {
    request(options) {
      pendingRequest = options
      notifyRequestStarted()
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    const { openArticle } = require('../services/miniapp')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    const openRequest = openArticle('article-1')
    await requestStarted
    const actionKey = [...storage.keys()]
      .find((key) => key.startsWith('miniappActionIdempotency:daily-content-v1:article_open:'))
    assert.ok(actionKey)
    pendingRequest.success({ statusCode: 200, data: { accountId: 'account-a' } })

    await openRequest
    assert.equal(storage.has(actionKey), false)
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('an authenticated request cannot mix an old token with a new account generation', async () => {
  const storage = createStorage()
  storage.delete(`miniappDataScope:prod:${APP_ID}`)
  const previousWx = global.wx
  const protectedRequests = []
  let pendingConfigRequest
  let notifyConfigStarted
  const configStarted = new Promise((resolve) => { notifyConfigStarted = resolve })
  installWx(storage, {
    request(options) {
      if (options.url.endsWith('/miniapp/config')) {
        pendingConfigRequest = options
        notifyConfigStarted()
        return
      }
      protectedRequests.push(options)
      options.success({ statusCode: 200, data: { accountId: 'account-a' } })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    const protectedRequest = request.request({ url: '/miniapp/profile', auth: true })
    await configStarted
    request.commitMiniAppSession({
      sessionToken: 'account-b-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-b',
    })
    pendingConfigRequest.success({ statusCode: 200, data: { dataScopeId: DATA_SCOPE_ID } })
    const outcome = await protectedRequest.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', code: error.code }),
    )

    assert.deepEqual({
      sentSessions: protectedRequests.map((options) => options.header['x-miniapp-session']),
      outcome: outcome.status,
      code: outcome.code,
    }, {
      sentSessions: [],
      outcome: 'rejected',
      code: 'ACCOUNT_CHANGED',
    })
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('an authenticated request cannot send a token superseded by the same account', async () => {
  const storage = createStorage()
  storage.delete(`miniappDataScope:prod:${APP_ID}`)
  const previousWx = global.wx
  const protectedRequests = []
  let pendingConfigRequest
  let notifyConfigStarted
  const configStarted = new Promise((resolve) => { notifyConfigStarted = resolve })
  installWx(storage, {
    request(options) {
      if (options.url.endsWith('/miniapp/config')) {
        pendingConfigRequest = options
        notifyConfigStarted()
        return
      }
      protectedRequests.push(options)
      options.success({ statusCode: 200, data: { accountId: 'account-a' } })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session-1',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    const protectedRequest = request.request({ url: '/miniapp/profile', auth: true })
    await configStarted
    request.commitMiniAppSession({
      sessionToken: 'account-a-session-2',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })
    pendingConfigRequest.success({ statusCode: 200, data: { dataScopeId: DATA_SCOPE_ID } })
    const outcome = await protectedRequest.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', code: error.code }),
    )

    assert.deepEqual({
      sentSessions: protectedRequests.map((options) => options.header['x-miniapp-session']),
      outcome: outcome.status,
      code: outcome.code,
    }, {
      sentSessions: [],
      outcome: 'rejected',
      code: 'ACCOUNT_CHANGED',
    })
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})

test('an authenticated request accepts its original account after data-scope refresh', async () => {
  const storage = createStorage()
  storage.delete(`miniappDataScope:prod:${APP_ID}`)
  const previousWx = global.wx
  const protectedRequests = []
  let pendingConfigRequest
  let notifyConfigStarted
  const configStarted = new Promise((resolve) => { notifyConfigStarted = resolve })
  installWx(storage, {
    request(options) {
      if (options.url.endsWith('/miniapp/config')) {
        pendingConfigRequest = options
        notifyConfigStarted()
        return
      }
      protectedRequests.push(options)
      options.success({ statusCode: 200, data: { accountId: 'account-a' } })
    },
  })
  purgeClientModules()

  try {
    const request = require('../utils/request')
    request.saveMiniAppSession({
      sessionToken: 'account-a-session',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'account-a',
    })

    const protectedRequest = request.request({ url: '/miniapp/profile', auth: true })
    await configStarted
    pendingConfigRequest.success({ statusCode: 200, data: { dataScopeId: DATA_SCOPE_ID } })

    assert.deepEqual(await protectedRequest, { accountId: 'account-a' })
    assert.equal(protectedRequests.length, 1)
    assert.equal(protectedRequests[0].header['x-miniapp-session'], 'account-a-session')
  } finally {
    restoreGlobal('wx', previousWx)
    purgeClientModules()
  }
})
