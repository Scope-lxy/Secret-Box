const assert = require('node:assert/strict')
const test = require('node:test')

const {
  resolveRewardedAdResult,
  runRewardedAd,
  shouldConfirmRewardedAd,
} = require('../../../miniprogram/utils/ads')

function installRewardedAd({ closeResult, error, onCreate }) {
  global.wx = {
    createRewardedVideoAd(options) {
      onCreate?.(options)
      let onClose
      let onError
      return {
        onClose(callback) { onClose = callback },
        onError(callback) { onError = callback },
        offClose() {},
        offError() {},
        show() {
          queueMicrotask(() => {
            if (error) onError(error)
            else onClose(closeResult)
          })
          return Promise.resolve()
        },
        load() { return Promise.resolve() },
      }
    },
  }
}

test.afterEach(() => {
  delete global.wx
})

test('rewarded ad marks an early close as incomplete', async () => {
  installRewardedAd({ closeResult: { isEnded: false } })

  const result = await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })

  assert.deepEqual(result, { completed: false, reason: 'incomplete' })
})

test('rewarded ad marks a playback error as unavailable', async () => {
  installRewardedAd({ error: new Error('ad unavailable') })

  const result = await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })

  assert.equal(result.completed, false)
  assert.equal(result.reason, 'unavailable')
})

test('rewarded ad only completes with an explicit full-view result', async () => {
  installRewardedAd({ closeResult: undefined })

  const missingResult = await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })
  assert.deepEqual(missingResult, { completed: false, reason: 'incomplete' })

  installRewardedAd({ closeResult: { isEnded: true } })
  const completed = await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })
  assert.deepEqual(completed, { completed: true })
})

test('rewarded ads enable multiple instances so two placements can use different ids', async () => {
  let createOptions
  installRewardedAd({
    closeResult: { isEnded: true },
    onCreate(options) { createOptions = options },
  })

  await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })

  assert.deepEqual(createOptions, { adUnitId: 'adunit-test', multiton: true })
})

test('unsupported rewarded ads report unavailable instead of silently completing', async () => {
  global.wx = {}

  const result = await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })

  assert.deepEqual(result, { completed: false, reason: 'unavailable' })
})

test('rewarded confirmation is enabled by default and can be disabled per placement', () => {
  assert.equal(shouldConfirmRewardedAd({}, false), true)
  assert.equal(shouldConfirmRewardedAd({ confirmPopupEnabled: false }, false), false)
  assert.equal(shouldConfirmRewardedAd({}, true), false)
})

test('unavailable ads fail closed by default but can be explicitly allowed', () => {
  const unavailable = { completed: false, reason: 'unavailable' }
  const incomplete = { completed: false, reason: 'incomplete' }

  assert.deepEqual(resolveRewardedAdResult({}, unavailable), unavailable)
  assert.deepEqual(resolveRewardedAdResult({ allowOnUnavailable: true }, unavailable), {
    completed: true,
    skipped: true,
    reason: 'unavailable',
  })
  assert.deepEqual(resolveRewardedAdResult({ allowOnUnavailable: false }, unavailable), unavailable)
  assert.deepEqual(resolveRewardedAdResult({}, incomplete), incomplete)
})

test('a synchronous ad show failure is treated as unavailable', async () => {
  global.wx = {
    createRewardedVideoAd() {
      return {
        onClose() {},
        onError() {},
        offClose() {},
        offError() {},
        show() { throw new Error('show failed') },
        load() { throw new Error('load failed') },
        destroy() {},
      }
    },
  }

  const result = await runRewardedAd({ enabled: true, adUnitId: 'adunit-test' })

  assert.equal(result.completed, false)
  assert.equal(result.reason, 'unavailable')
})
