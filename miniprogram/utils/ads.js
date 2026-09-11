function runRewardedAd(config = {}) {
  const adUnitId = String(config.adUnitId || '').trim()
  if (!config.enabled || !adUnitId) {
    return Promise.resolve({ completed: true, skipped: true })
  }
  if (typeof wx.createRewardedVideoAd !== 'function') {
    return Promise.resolve({ completed: false, reason: 'unavailable' })
  }

  return new Promise((resolve) => {
    let ad
    try {
      ad = wx.createRewardedVideoAd({ adUnitId, multiton: true })
    } catch (error) {
      resolve({ completed: false, reason: 'unavailable', error })
      return
    }
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      if (typeof ad.offClose === 'function') ad.offClose(handleClose)
      if (typeof ad.offError === 'function') ad.offError(handleError)
      if (typeof ad.destroy === 'function') ad.destroy()
      resolve(result)
    }
    const handleClose = (result) => finish(
      result?.isEnded === true
        ? { completed: true }
        : { completed: false, reason: 'incomplete' },
    )
    const handleError = (error) => finish({ completed: false, reason: 'unavailable', error })
    ad.onClose(handleClose)
    ad.onError(handleError)
    const show = () => Promise.resolve().then(() => ad.show())
    show().catch(() => Promise.resolve().then(() => ad.load()).then(show)).catch(handleError)
  })
}

function shouldConfirmRewardedAd(config = {}, confirmed = false) {
  return config.confirmPopupEnabled !== false && confirmed !== true
}

function resolveRewardedAdResult(config = {}, result = {}) {
  if (!result.completed && result.reason === 'unavailable' && config.allowOnUnavailable === true) {
    return { completed: true, skipped: true, reason: 'unavailable' }
  }
  return result
}

const shownInterstitialPlacements = new Set()
const INTERSTITIAL_IDLE_DELAY_MS = 1000

function scheduleInterstitialAd(config = {}, placement = '', options = {}) {
  const adUnitId = String(config.adUnitId || '').trim()
  if (!config.enabled || !adUnitId || typeof wx.createInterstitialAd !== 'function') return null
  const placementKey = String(placement || adUnitId).trim()
  const delaySeconds = Math.min(300, Math.max(0, Number(config.delaySeconds || 0)))
  const repeatSeconds = Math.min(300, Math.max(0, Number(config.repeatSeconds || 0)))
  const waitForIdle = typeof options.isIdle === 'function'
  const isIdle = waitForIdle ? options.isIdle : () => true
  if (!repeatSeconds && shownInterstitialPlacements.has(placementKey)) return null

  let ad = null
  let stopped = false
  let timer = null
  let idleSince = 0
  const destroyAd = () => {
    if (ad && typeof ad.destroy === 'function') ad.destroy()
    ad = null
  }

  const scheduleNext = (seconds) => {
    if (stopped) return
    timer = setTimeout(showOnce, seconds * 1000)
  }

  const showOnce = () => {
    timer = null
    if (stopped || (!repeatSeconds && shownInterstitialPlacements.has(placementKey))) return
    if (waitForIdle && !isIdle()) {
      idleSince = 0
      scheduleNext(INTERSTITIAL_IDLE_DELAY_MS / 1000)
      return
    }
    if (waitForIdle && !idleSince) {
      idleSince = Date.now()
      scheduleNext(INTERSTITIAL_IDLE_DELAY_MS / 1000)
      return
    }
    let cycleSettled = false
    const finishCycle = () => {
      if (cycleSettled) return
      cycleSettled = true
      destroyAd()
      if (repeatSeconds) scheduleNext(repeatSeconds)
    }
    try {
      ad = wx.createInterstitialAd({ adUnitId })
      ad.onError(finishCycle)
      ad.onClose(finishCycle)
      ad.show()
        .then(() => { shownInterstitialPlacements.add(placementKey) })
        .catch(() => ad.load().then(() => ad.show()).then(() => { shownInterstitialPlacements.add(placementKey) }).catch(finishCycle))
    } catch (error) {
      finishCycle()
    }
  }

  const firstDelay = repeatSeconds && shownInterstitialPlacements.has(placementKey) ? repeatSeconds : delaySeconds
  scheduleNext(firstDelay)
  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    destroyAd()
  }
}

module.exports = {
  resolveRewardedAdResult,
  runRewardedAd,
  scheduleInterstitialAd,
  shouldConfirmRewardedAd,
}
