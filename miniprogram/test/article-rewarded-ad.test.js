const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveRewardedAdResult, runRewardedAd } = require('../utils/ads')

test('closing a rewarded ad early never counts as completion', async () => {
  const previousWx = global.wx
  global.wx = {
    createRewardedVideoAd() {
      let closeHandler
      return {
        destroy() {},
        offClose() {},
        offError() {},
        onClose(handler) { closeHandler = handler },
        onError() {},
        show() {
          queueMicrotask(() => closeHandler({ isEnded: false }))
          return Promise.resolve()
        },
      }
    },
  }

  try {
    const result = await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })
    assert.deepEqual(result, { completed: false, reason: 'incomplete' })
    assert.deepEqual(resolveRewardedAdResult({ allowOnUnavailable: true }, result), result)
  } finally {
    global.wx = previousWx
  }
})

test('only an explicit isEnded true close event completes the ad', async () => {
  const previousWx = global.wx
  global.wx = {
    createRewardedVideoAd() {
      let closeHandler
      return {
        destroy() {},
        offClose() {},
        offError() {},
        onClose(handler) { closeHandler = handler },
        onError() {},
        show() {
          queueMicrotask(() => closeHandler({ isEnded: true }))
          return Promise.resolve()
        },
      }
    },
  }

  try {
    assert.deepEqual(
      await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' }),
      { completed: true },
    )
  } finally {
    global.wx = previousWx
  }
})

test('article unlock retries one uncertain result but never retries a known business error', async () => {
  const previousWx = global.wx
  const { unlockArticle } = require('../services/miniapp')
  const requests = []
  global.wx = {
    getAccountInfoSync() {
      return { miniProgram: { appId: 'wx-test', envVersion: 'release' } }
    },
    getStorageSync(key) {
      if (String(key).startsWith('miniappSession:')) {
        return { token: 'session', expiresAt: '2999-01-01T00:00:00.000Z', accountId: 'account-1' }
      }
      if (String(key).startsWith('miniappDataScope:')) return 'shared:pool-1'
      if (key === 'visitorId') return 'visitor-1'
      return null
    },
    setStorageSync() {},
    removeStorageSync() {},
    request(options) {
      requests.push(options)
      const response = requests.length === 1
        ? { statusCode: 503, data: { message: '暂时不可用' } }
        : { statusCode: 200, data: { unlockedToday: true } }
      queueMicrotask(() => options.success(response))
    },
  }
  try {
    const result = await unlockArticle('article-1')
    assert.deepEqual(result, { unlockedToday: true })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].data.rewarded, false)

    requests.length = 0
    global.wx.request = (options) => {
      requests.push(options)
      queueMicrotask(() => options.success({ statusCode: 400, data: { message: '文章不存在' } }))
    }
    await assert.rejects(() => unlockArticle('article-1'), /文章不存在/)
    assert.equal(requests.length, 1)
  } finally {
    global.wx = previousWx
  }
})
