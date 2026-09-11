function getAdUnitId(ads = {}, placement = '') {
  return String(ads?.[placement]?.adUnitId || '').trim()
}

function shouldKeepNativeAdHidden({ previousAds = {}, nextAds = {}, placement = '', hidden = false } = {}) {
  if (!hidden) return false
  const next = nextAds?.[placement] || {}
  const previousAdUnitId = getAdUnitId(previousAds, placement)
  const nextAdUnitId = getAdUnitId(nextAds, placement)
  return Boolean(next.enabled && nextAdUnitId && nextAdUnitId === previousAdUnitId)
}

module.exports = { shouldKeepNativeAdHidden }
