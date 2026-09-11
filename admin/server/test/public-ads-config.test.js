const assert = require('node:assert/strict')
const test = require('node:test')

const { getPublicAds } = require('../src/modules/admin/admin-settings.store')

test('production public config preserves rewarded-ad unavailable fallback', () => {
  const ads = getPublicAds({
    articleExpandRewarded: { adType: 'rewarded', allowOnUnavailable: true },
    homeInterstitial: { adType: 'interstitial', allowOnUnavailable: true },
  }, 'production')
  assert.equal(ads.articleExpandRewarded.allowOnUnavailable, true)
  assert.equal(ads.homeInterstitial.allowOnUnavailable, true)
})

test('development public config preserves explicit rewarded-ad fallback', () => {
  const ads = getPublicAds({ articleExpandRewarded: { adType: 'rewarded', allowOnUnavailable: true } }, 'development')
  assert.equal(ads.articleExpandRewarded.allowOnUnavailable, true)
})

test('staging-like public config preserves rewarded-ad unavailable fallback', () => {
  const ads = getPublicAds({ articleExpandRewarded: { adType: 'rewarded', allowOnUnavailable: true } }, 'staging')
  assert.equal(ads.articleExpandRewarded.allowOnUnavailable, true)
})
