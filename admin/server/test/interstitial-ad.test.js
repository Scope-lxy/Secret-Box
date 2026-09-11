const assert = require('node:assert/strict')
const test = require('node:test')

const { scheduleInterstitialAd } = require('../../../miniprogram/utils/ads')

function waitForAdTask() {
  return new Promise((resolve) => setTimeout(resolve, 10))
}

test.afterEach(() => {
  delete global.wx
})

test('interstitial ads are limited independently for each page', async () => {
  let showCount = 0
  global.wx = {
    createInterstitialAd() {
      return {
        destroy() {},
        load() { return Promise.resolve() },
        onClose() {},
        onError() {},
        show() {
          showCount += 1
          return Promise.resolve()
        },
      }
    },
  }
  const config = { enabled: true, adUnitId: 'adunit-interstitial-test', delaySeconds: 0 }

  const disposeLetters = scheduleInterstitialAd(config, 'letters')
  await waitForAdTask()
  disposeLetters()
  assert.equal(showCount, 1)
  assert.equal(scheduleInterstitialAd(config, 'letters'), null)

  const disposeArticle = scheduleInterstitialAd(config, 'article-detail')
  await waitForAdTask()
  disposeArticle()
  assert.equal(showCount, 2)
})

test('a failed interstitial remains eligible on the next page visit', async () => {
  global.wx = {
    createInterstitialAd() {
      return {
        destroy() {},
        load() { return Promise.reject(new Error('no fill')) },
        onClose() {},
        onError() {},
        show() { return Promise.reject(new Error('not ready')) },
      }
    },
  }
  const config = { enabled: true, adUnitId: 'adunit-interstitial-test', delaySeconds: 0 }

  const firstDispose = scheduleInterstitialAd(config, 'mine')
  await waitForAdTask()
  firstDispose()
  const retryDispose = scheduleInterstitialAd(config, 'mine')
  assert.equal(typeof retryDispose, 'function')
  retryDispose()
})

test('interstitial delay is capped at 300 seconds', () => {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  let scheduledDelay = -1
  global.setTimeout = (_callback, delay) => {
    scheduledDelay = delay
    return 1
  }
  global.clearTimeout = () => {}
  global.wx = { createInterstitialAd() {} }

  try {
    const dispose = scheduleInterstitialAd({
      enabled: true,
      adUnitId: 'adunit-interstitial-delay-limit',
      delaySeconds: 999,
    }, 'delay-limit')
    assert.equal(scheduledDelay, 300000)
    dispose()
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})

test('interstitial ads repeat after close and cap the loop at 300 seconds', async () => {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const timers = []
  let closeAd = () => {}
  let showCount = 0
  global.setTimeout = (callback, delay) => {
    timers.push({ callback, delay })
    return timers.length
  }
  global.clearTimeout = () => {}
  global.wx = {
    createInterstitialAd() {
      return {
        destroy() {},
        load() { return Promise.resolve() },
        onClose(handler) { closeAd = handler },
        onError() {},
        show() {
          showCount += 1
          return Promise.resolve()
        },
      }
    },
  }

  try {
    const dispose = scheduleInterstitialAd({
      enabled: true,
      adUnitId: 'adunit-interstitial-repeat',
      delaySeconds: 2,
      repeatSeconds: 999,
    }, 'repeat')
    assert.equal(timers[0].delay, 2000)
    timers.shift().callback()
    await Promise.resolve()
    assert.equal(showCount, 1)

    closeAd()
    assert.equal(timers[0].delay, 300000)
    timers.shift().callback()
    await Promise.resolve()
    assert.equal(showCount, 2)
    dispose()
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})

test('interstitial ads wait until the page stays idle for 1 second', async () => {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const timers = []
  let idle = false
  let showCount = 0
  global.setTimeout = (callback, delay) => {
    timers.push({ callback, delay })
    return timers.length
  }
  global.clearTimeout = () => {}
  global.wx = {
    createInterstitialAd() {
      return {
        destroy() {},
        load() { return Promise.resolve() },
        onClose() {},
        onError() {},
        show() {
          showCount += 1
          return Promise.resolve()
        },
      }
    },
  }

  try {
    const dispose = scheduleInterstitialAd({
      enabled: true,
      adUnitId: 'adunit-interstitial-idle',
      delaySeconds: 0,
    }, 'idle', { isIdle: () => idle })
    timers.shift().callback()
    assert.equal(timers[0].delay, 1000)

    idle = true
    timers.shift().callback()
    assert.equal(timers[0].delay, 1000)
    timers.shift().callback()
    await Promise.resolve()
    assert.equal(showCount, 1)
    dispose()
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})
