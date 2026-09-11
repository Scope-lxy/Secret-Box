const assert = require('node:assert/strict')
const test = require('node:test')

const { decodeDataScopeHeader } = require('../src/modules/data-scope/data-scope')
const { createMiniAppSession, encodeDataScopeHeader } = require('../../../miniprogram/utils/request')

test('中文 data scope headers round-trip without changing the stored scope id', () => {
  const dataScopeId = 'shared:pool-测试内容池'
  const encoded = encodeDataScopeHeader(dataScopeId)

  assert.equal(encoded, 'shared%3Apool-%E6%B5%8B%E8%AF%95%E5%86%85%E5%AE%B9%E6%B1%A0')
  assert.equal(decodeDataScopeHeader(encoded), dataScopeId)
})

test('ASCII data scope headers remain wire-compatible with existing clients', () => {
  const dataScopeId = 'shared:pool-1'
  assert.equal(encodeDataScopeHeader(dataScopeId), dataScopeId)
  assert.equal(decodeDataScopeHeader(dataScopeId), dataScopeId)
})

test('malformed encoded data scope headers are rejected', () => {
  assert.equal(decodeDataScopeHeader('shared%3Apool-%E6%B5'), '')
})

test('session requests encode a Chinese scope before handing it to wx.request', async () => {
  const originalWx = global.wx
  const storage = new Map()
  const calls = []
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-scope-header-test', envVersion: 'release' } } },
    login(options) { options.success({ code: 'scope-header-code' }) },
    request(options) {
      calls.push(options)
      if (options.url.endsWith('/miniapp/config')) {
        options.success({ statusCode: 200, data: { dataScopeId: 'shared:pool-测试内容池' } })
        return
      }
      options.success({
        statusCode: 200,
        data: {
          sessionToken: 'scope-header-token',
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
          accountId: 'scope-header-account',
        },
      })
    },
  }

  try {
    await createMiniAppSession('scope-header-code')
    const sessionRequest = calls.find((item) => item.url.endsWith('/miniapp/session'))
    assert.equal(sessionRequest.header['x-miniapp-data-scope'], 'shared%3Apool-%E6%B5%8B%E8%AF%95%E5%86%85%E5%AE%B9%E6%B1%A0')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})
