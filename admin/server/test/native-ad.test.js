const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const { shouldKeepNativeAdHidden } = require('../../../miniprogram/utils/native-ad')

test('home native ad reads the server-validated placement directly', () => {
  const helper = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/utils/native-ad.js'), 'utf8')
  const home = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/home/home.js'), 'utf8')

  assert.doesNotMatch(helper, /getHomeNativePlacement|HOME_NATIVE_PLACEMENTS/)
  assert.match(home, /const homeNativePlacement = ads\.homeNative\.placement/)
  assert.doesNotMatch(home, /homeNativePlacement:\s*'checkIn'/)
})

test('native ad stays hidden after an error during the current page visit', () => {
  const ads = { lettersNative: { enabled: true, adUnitId: 'adunit-letters-test' } }

  assert.equal(shouldKeepNativeAdHidden({
    previousAds: ads,
    nextAds: ads,
    placement: 'lettersNative',
    hidden: true,
  }), true)
})

test('native ad also retries after its configuration changes', () => {
  const previousAds = { lettersNative: { enabled: true, adUnitId: 'adunit-letters-test' } }

  assert.equal(shouldKeepNativeAdHidden({
    previousAds,
    nextAds: { lettersNative: { enabled: true, adUnitId: 'adunit-letters-live' } },
    placement: 'lettersNative',
    hidden: true,
  }), false)
  assert.equal(shouldKeepNativeAdHidden({
    previousAds,
    nextAds: { lettersNative: { enabled: false, adUnitId: 'adunit-letters-test' } },
    placement: 'lettersNative',
    hidden: true,
  }), false)
  assert.equal(shouldKeepNativeAdHidden({
    previousAds,
    nextAds: { lettersNative: { enabled: true, adUnitId: '' } },
    placement: 'lettersNative',
    hidden: true,
  }), false)
})

test('every native ad placement stays mounted while its parent is hidden after a load error', () => {
  const pages = [
    ['home', 'homeNative'],
    ['articles', 'articlesNative'],
    ['letters', 'lettersNative'],
    ['mine', 'mineNative'],
  ]

  pages.forEach(([page, placement]) => {
    const template = fs.readFileSync(path.resolve(__dirname, `../../../miniprogram/pages/${page}/${page}.wxml`), 'utf8')
    const script = fs.readFileSync(path.resolve(__dirname, `../../../miniprogram/pages/${page}/${page}.js`), 'utf8')
    assert.equal(template.includes(`ads.${placement}.adUnitId && !nativeAdHidden`), false)
    assert.ok(template.includes('hidden="{{nativeAdHidden}}"'))
    assert.ok(template.includes(`unit-id="{{ads.${placement}.adUnitId}}" bindload="handleNativeAdLoad" binderror="handleNativeAdError"`))
    assert.match(script, /handleNativeAdError\(\)/)
    assert.match(script, /handleNativeAdLoad\(\)/)
    assert.match(script, /if \(this\.data\.nativeAdHidden\) this\.setData\(\{ nativeAdHidden: false \}\)/)
  })
})

test('home native ad has one configurable mount point for each home module', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/home/home.wxml'), 'utf8')
  const dailyContentAd = template.indexOf("homeNativePlacement === 'dailyContent'")
  const checkinCard = template.indexOf('class="card checkin-card"')
  const checkinAd = template.indexOf("homeNativePlacement === 'checkIn'")
  const stats = template.indexOf('class="stats-row home-stats-row')
  const statsAd = template.indexOf("homeNativePlacement === 'stats'")
  assert.ok(dailyContentAd > -1 && dailyContentAd < checkinCard)
  assert.ok(checkinAd > checkinCard && checkinAd < stats)
  assert.ok(statsAd > stats)
  assert.equal((template.match(/<ad-custom unit-id="\{\{ads\.homeNative\.adUnitId\}\}"/g) || []).length, 3)
})

test('mine native ad is rendered after marked history records', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/mine/mine.wxml'), 'utf8')
  const script = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/mine/mine.js'), 'utf8')
  assert.ok(template.includes('<block wx:for="{{histories}}" wx:key="id">'))
  assert.ok(template.indexOf('item.showNativeAdAfter && ads.mineNative.enabled') > template.indexOf('<block wx:for="{{histories}}" wx:key="id">'))
  assert.match(script, /nativeAd\.firstAfter \|\| 3/)
  assert.match(script, /nativeAd\.interval \|\| 10/)
})

test('letters use their own list-native ad position settings', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/letters/letters.js'), 'utf8')
  assert.match(script, /home\?\.ads\?\.lettersNative/)
  assert.match(script, /nativeAd\.firstAfter \|\| 3/)
  assert.match(script, /nativeAd\.interval \|\| 10/)
})

test('articles use dedicated list-native and interstitial placements', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/articles/articles.wxml'), 'utf8')
  const script = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/articles/articles.js'), 'utf8')
  assert.match(template, /<block wx:for="\{\{items\}\}" wx:key="id">[\s\S]*item\.showNativeAdAfter && ads\.articlesNative\.enabled/)
  assert.match(template, /unit-id="\{\{ads\.articlesNative\.adUnitId\}\}" bindload="handleNativeAdLoad" binderror="handleNativeAdError"/)
  assert.match(script, /nativeAd\.firstAfter \|\| 3/)
  assert.match(script, /nativeAd\.interval \|\| 10/)
  assert.match(script, /scheduleInterstitialAd\(this\.data\.ads\.articlesInterstitial, 'articles'/)
})

test('article detail mounts independent start, end and recommendation native placements', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/article/article.wxml'), 'utf8')
  const script = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/article/article.js'), 'utf8')

  assert.match(template, /hidden="\{\{startAdHidden\}\}"[\s\S]*unit-id="\{\{ads\.articlesStartNative\.adUnitId\}\}"[\s\S]*data-position="start"/)
  assert.match(template, /class="article-ad(?:\s|\")/)
  assert.match(template, /class="card article-ad recommendation-ad"/)
  assert.match(template, /class="article-media-flow"[\s\S]*data-position="start"/)
  assert.match(template, /class="article-media-flow"[\s\S]*data-position="end"/)
  assert.match(template, /article\.bodySegments[\s\S]*data-position="middle"[\s\S]*ads\.articlesEndNative\.adUnitId/)
  assert.match(template, /unlockedToday && ads\.articlesEndNative\.enabled && ads\.articlesEndNative\.adUnitId/)
  assert.match(template, /hidden="\{\{endAdHidden\}\}"[\s\S]*unit-id="\{\{ads\.articlesEndNative\.adUnitId\}\}"[\s\S]*data-position="end"/)
  assert.match(template, /hidden="\{\{middleAdHidden\}\}"[\s\S]*unit-id="\{\{ads\.articlesEndNative\.adUnitId\}\}"[\s\S]*data-position="middle"/)
  assert.match(template, /item\.showNativeAdAfter && ads\.articlesEndNative\.enabled && ads\.articlesEndNative\.adUnitId/)
  assert.match(template, /hidden="\{\{recommendationAdHidden\}\}"[\s\S]*unit-id="\{\{ads\.articlesEndNative\.adUnitId\}\}"[\s\S]*data-position="recommendation"/)
  assert.match(script, /articlesStartNative: ads\.articlesStartNative \|\| \{\}/)
  assert.match(script, /articlesNative: ads\.articlesNative \|\| \{\}/)
  assert.match(script, /articlesEndNative: ads\.articlesEndNative \|\| \{\}/)
  assert.match(script, /end: 'endAdHidden',[\s\S]*middle: 'middleAdHidden',[\s\S]*recommendation: 'recommendationAdHidden',[\s\S]*start: 'startAdHidden'/)
  assert.equal((script.match(/recommendationAdHidden/g) || []).length >= 3, true)
})

test('secondary history pages reuse mine native and interstitial placements', () => {
  for (const page of ['interactions', 'opened-history', 'favorites', 'messages']) {
    const template = fs.readFileSync(path.resolve(__dirname, `../../../miniprogram/pages/${page}/${page}.wxml`), 'utf8')
    const script = fs.readFileSync(path.resolve(__dirname, `../../../miniprogram/pages/${page}/${page}.js`), 'utf8')
    assert.match(template, /item\.showNativeAdAfter && ads\.mineNative\.enabled && ads\.mineNative\.adUnitId/)
    assert.match(template, /unit-id="\{\{ads\.mineNative\.adUnitId\}\}"/)
    assert.match(script, /scheduleInterstitialAd\(.*\.mineInterstitial/)
    assert.match(script, new RegExp(`scheduleInterstitialAd\\(.*'${page}'`))
    assert.match(script, /markListAdSlots\(/)
    assert.match(script, /nativeAd\.firstAfter \|\| 3/)
    assert.match(script, /nativeAd\.interval \|\| 10/)
  }
})

test('content cards and native ads share the card padding token', () => {
  const tokens = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/styles/tokens.wxss'), 'utf8')
  const components = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/styles/components.wxss'), 'utf8')
  const homeStyles = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/home/home.wxss'), 'utf8')
  const articlesStyles = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/articles/articles.wxss'), 'utf8')
  const articleStyles = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/article/article.wxss'), 'utf8')

  assert.match(tokens, /--card-padding-x:\s*20rpx;/)
  assert.match(tokens, /--card-padding-y:\s*20rpx;/)
  assert.match(tokens, /--type-article-meta:\s*26rpx;/)
  assert.match(tokens, /\.theme\.font-larger\s*\{[\s\S]*--type-article-meta:\s*28rpx;/)
  assert.match(tokens, /--card-content-gap:\s*16rpx;/)
  assert.match(tokens, /--card-meta-gap:\s*12rpx;/)
  assert.match(tokens, /--home-stat-card-min-height:\s*136rpx;/)
  assert.match(tokens, /--home-stat-padding-top:\s*16rpx;/)
  assert.match(tokens, /--home-stat-padding-bottom:\s*20rpx;/)
  assert.match(tokens, /--home-stat-content-gap:\s*12rpx;/)
  assert.match(tokens, /--home-stat-value-line-height:\s*1\.25;/)
  assert.match(tokens, /--home-stat-label-line-height:\s*1\.4;/)
  assert.match(components, /\.card\s*\{[^}]*padding:\s*var\(--card-padding-y\)\s+var\(--card-padding-x\);/s)
  assert.match(components, /\.stat-cell\s*\{[^}]*min-height:\s*128rpx;[^}]*padding:\s*var\(--space-3\)\s+var\(--space-1\);[^}]*gap:\s*var\(--space-2\);/s)
  assert.match(components, /\.stat-value\s*\{[^}]*line-height:\s*1\.1;/s)
  assert.match(components, /\.stat-label\s*\{[^}]*line-height:\s*1\.2;/s)
  assert.match(components, /\.home-stats-row\s+\.stat-cell\s*\{[^}]*min-height:\s*var\(--home-stat-card-min-height\);[^}]*padding:\s*var\(--home-stat-padding-top\)\s+var\(--space-1\)\s+var\(--home-stat-padding-bottom\);[^}]*gap:\s*var\(--home-stat-content-gap\);/s)
  assert.match(components, /\.home-stats-row\s+\.stat-value\s*\{[^}]*line-height:\s*var\(--home-stat-value-line-height\);/s)
  assert.match(components, /\.home-stats-row\s+\.stat-label\s*\{[^}]*line-height:\s*var\(--home-stat-label-line-height\);/s)
  assert.match(components, /\.history-card\s*\{[^}]*gap:\s*var\(--card-meta-gap\);/s)
  assert.match(components, /\.history-audio-card\s*\{[^}]*gap:\s*var\(--card-meta-gap\);/s)
  assert.match(components, /\.native-template-ad\s*\{[^}]*padding:\s*0;/s)
  assert.match(homeStyles, /\.daily-content-card\s*\{[^}]*padding:\s*var\(--card-padding-y\)\s+var\(--card-padding-x\);/s)
  assert.match(homeStyles, /\.daily-content-ready\s*\{[^}]*gap:\s*20rpx;/s)
  assert.match(homeStyles, /\.daily-content-ready\s*\{[^}]*padding-bottom:\s*12rpx;/s)
  assert.match(homeStyles, /\.daily-content-ready-intro\s*\{[^}]*gap:\s*20rpx;/s)
  assert.match(homeStyles, /\.checkin-success\s*\{[^}]*gap:\s*20rpx;/s)
  assert.match(homeStyles, /\.audio-player\s*\{[^}]*padding:\s*var\(--card-padding-y\)\s+var\(--card-padding-x\);/s)
  assert.match(articlesStyles, /\.article-card\s*\{[^}]*gap:\s*var\(--card-content-gap\);/s)
  assert.match(articlesStyles, /\.article-card-meta\s*\{[^}]*color:\s*var\(--color-text-secondary\);[^}]*font-size:\s*var\(--type-article-meta\);[^}]*font-weight:\s*400;[^}]*line-height:\s*var\(--line-height-card-meta\);/s)
  assert.match(articlesStyles, /\.article-card-author\s*\{[^}]*color:\s*var\(--color-text-secondary\);[^}]*font-weight:\s*400;/s)
  assert.match(articlesStyles, /\.article-card-stat\s*\{[^}]*font-weight:\s*400;/s)
  assert.match(articlesStyles, /\.article-card-meta--overlay\s*\{[^}]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.86\);/s)
  assert.match(articlesStyles, /\.article-card-meta--overlay \.article-card-author,[\s\S]*?\.article-card-meta--overlay \.article-card-stat\s*\{[^}]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.86\);/s)
  assert.match(articlesStyles, /\.article-card-meta--overlay \.article-card-author\s*\{[^}]*font-weight:\s*400;/s)
  assert.doesNotMatch(articlesStyles, /article-card-stat-icon|article-stat-icon-size/)
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/articles/articles.wxml'), 'utf8'), /article-card-stat-icon|action-heart\.svg|action-bookmark\.svg/)
  assert.doesNotMatch(articlesStyles, /\.article-card--stacked\s*\{[^}]*gap:/s)
  assert.match(articleStyles, /\.article-ad\s*\{[^}]*padding:\s*0;/s)
  assert.doesNotMatch(articleStyles, /\.article-body-card\s*\{/)
  assert.match(tokens, /--type-article-detail-title:\s*34rpx;/)
  assert.match(tokens, /\.theme\.font-larger\s*\{[\s\S]*--type-article-detail-title:\s*38rpx;/)
  assert.match(articleStyles, /\.article-title\s*\{[^}]*font-size:\s*var\(--type-article-detail-title\);[^}]*font-weight:\s*700;/s)
  assert.match(articleStyles, /\.article-rich-text\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*padding:\s*0;/s)
  assert.match(articleStyles, /\.article-media-flow\s*\{[^}]*gap:\s*var\(--article-content-gap\);[^}]*padding:\s*var\(--article-media-start-gap\)\s+0\s+var\(--article-media-end-gap\);/s)
  assert.match(articleStyles, /\.article-preview-fade\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*transparent,\s*var\(--color-bg\)\s+68%,\s*var\(--color-bg\)\s+100%\);/s)
  assert.match(articleStyles, /\.article-main\s*\{[^}]*gap:\s*var\(--card-content-gap\);/s)
  assert.match(articleStyles, /\.article-intro\s*\{[^}]*gap:\s*20rpx;/s)
  assert.match(tokens, /--type-article-detail-meta:\s*28rpx;/)
  assert.match(tokens, /\.theme\.font-larger\s*\{[\s\S]*--type-article-detail-meta:\s*30rpx;/)
  assert.match(articleStyles, /\.article-header-meta\s*\{[^}]*font-size:\s*var\(--type-article-detail-meta\);[^}]*font-weight:\s*400;/s)
  assert.match(articleStyles, /@import '\.\.\/articles\/articles\.wxss';/)
  assert.match(articleStyles, /\.recommend-list\s*\{[^}]*gap:\s*var\(--card-gap\);/s)
  assert.doesNotMatch(articleStyles, /\.recommend-item|\.recommend-cover|\.recommend-copy/)
})
