const assert = require('node:assert/strict')
const test = require('node:test')

const TEST_DATA_SCOPE_ID = 'shared:action-idempotency-pool'

function createWx() {
  const storage = new Map()
  return {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-action-idempotency-test', envVersion: 'develop' } } },
  }
}

function replyToConfig(options) {
  if (!options.url.endsWith('/miniapp/config')) return false
  options.success({ statusCode: 200, data: { dataScopeId: TEST_DATA_SCOPE_ID } })
  return true
}

test('uncertain daily-content and check-in requests reuse their persisted idempotency keys', async () => {
  const originalWx = global.wx
  global.wx = createWx()

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { checkIn, openDailyContent } = require('../../../miniprogram/services/miniapp')
    saveMiniAppSession({
      sessionToken: 'action-idempotency-token',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'action-idempotency-account',
    })

    const attempts = []
    global.wx.request = (options) => {
      if (replyToConfig(options)) return
      attempts.push({
        url: options.url,
        data: options.data,
        key: options.header['x-idempotency-key'],
        scope: options.header['x-miniapp-data-scope'],
      })
      options.fail({ errMsg: 'request:fail timeout' })
    }
    await assert.rejects(openDailyContent({ type: 'audio', excludeId: 'daily-content-001' }))
    await assert.rejects(checkIn())

    global.wx.request = (options) => {
      if (replyToConfig(options)) return
      attempts.push({
        url: options.url,
        data: options.data,
        key: options.header['x-idempotency-key'],
        scope: options.header['x-miniapp-data-scope'],
      })
      options.success({ statusCode: 200, data: {} })
    }
    await openDailyContent({ type: 'audio', excludeId: 'daily-content-001' })
    await checkIn()

    assert.equal(attempts[0].key, attempts[2].key)
    assert.equal(attempts[1].key, attempts[3].key)
    assert.notEqual(attempts[0].key, attempts[1].key)
    assert.deepEqual(attempts[0].data, attempts[2].data)
    attempts.forEach((attempt) => assert.equal(attempt.scope, TEST_DATA_SCOPE_ID))
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('terminal daily-content failures clear the key and never reuse it for a different request payload', async () => {
  const originalWx = global.wx
  global.wx = createWx()

  try {
    const { saveMiniAppSession } = require('../../../miniprogram/utils/request')
    const { openDailyContent } = require('../../../miniprogram/services/miniapp')
    saveMiniAppSession({
      sessionToken: 'action-terminal-token',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'action-terminal-account',
    })

    const attempts = []
    global.wx.request = (options) => {
      if (replyToConfig(options)) return
      attempts.push({
        data: options.data,
        key: options.header['x-idempotency-key'],
        scope: options.header['x-miniapp-data-scope'],
      })
      options.success({ statusCode: 400, data: { message: '请求无效' } })
    }
    await assert.rejects(openDailyContent({ type: 'random', excludeId: '' }))

    global.wx.request = (options) => {
      if (replyToConfig(options)) return
      attempts.push({
        data: options.data,
        key: options.header['x-idempotency-key'],
        scope: options.header['x-miniapp-data-scope'],
      })
      options.fail({ errMsg: 'request:fail timeout' })
    }
    await assert.rejects(openDailyContent({ type: 'text', excludeId: 'daily-content-002' }))

    assert.notEqual(attempts[0].key, attempts[1].key)
    assert.deepEqual(attempts[1].data, { type: 'text', excludeId: 'daily-content-002' })
    attempts.forEach((attempt) => assert.equal(attempt.scope, TEST_DATA_SCOPE_ID))
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})
