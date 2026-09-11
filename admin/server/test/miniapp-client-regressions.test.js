const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const miniappRoot = path.resolve(__dirname, '../../../miniprogram')
const { getPreviewImageUrls } = require('../../../miniprogram/utils/format')
const { normalizeTabs } = require('../../../miniprogram/utils/tabs')
const { getImageCandidates, getNextImageUrl, prepareDisplayImage } = require('../../../miniprogram/utils/image-display')
const { openImagePreview, resolvePreviewImageUrls } = require('../../../miniprogram/utils/image-preview')
const { normalizeActivityItem } = require('../../../miniprogram/utils/format')

function readMiniappFile(relativePath) {
  return fs.readFileSync(path.join(miniappRoot, relativePath), 'utf8')
}

test('image preview keeps the tapped image after unavailable medium images are filtered out', () => {
  const preview = getPreviewImageUrls([
    { mediumUrl: '' },
    { mediumUrl: 'https://cdn.example.com/second.jpg' },
    { mediumUrl: 'https://cdn.example.com/third.jpg' },
  ], 2)

  assert.deepEqual(preview, {
    urls: ['https://cdn.example.com/second.jpg', 'https://cdn.example.com/third.jpg'],
    current: 'https://cdn.example.com/third.jpg',
  })
})

test('large image preview prefers medium and can still open a historical original-only image', () => {
  assert.deepEqual(getPreviewImageUrls([
    { mediumUrl: '/medium.jpg', thumbUrl: '/thumb.jpg', originalUrl: '/original.jpg' },
    { originalUrl: '/historical.jpg' },
  ], 1), { urls: ['/medium.jpg', '/historical.jpg'], current: '/historical.jpg' })
})

test('native image preview retries the selected medium on each tap', async () => {
  const requested = []
  const wxApi = {
    getImageInfo({ src, success, fail }) {
      requested.push(src)
      if (src === '/medium-current.jpg' || src === '/thumb-other.jpg') success({ path: src })
      else fail()
    },
  }
  const images = [
    { mediumUrl: '/medium-other.jpg', thumbUrl: '/thumb-other.jpg', originalUrl: '/original-other.jpg' },
    { mediumUrl: '/medium-current.jpg', thumbUrl: '/thumb-current.jpg', originalUrl: '/original-current.jpg', displayUrl: '/thumb-current.jpg' },
  ]
  const first = await resolvePreviewImageUrls(images, 1, { wx: wxApi, timeoutMs: 1000 })
  const second = await resolvePreviewImageUrls(images, 1, { wx: wxApi, timeoutMs: 1000 })
  assert.deepEqual(first, { urls: ['/medium-current.jpg'], current: '/medium-current.jpg' })
  assert.deepEqual(second, first)
  assert.equal(requested.filter((src) => src === '/medium-current.jpg').length, 2)
})

test('native image preview ignores duplicate taps and clears its loading state', async () => {
  const originalWx = global.wx
  const originalPages = global.getCurrentPages
  let completeProbe
  const calls = []
  global.wx = {
    showLoading() { calls.push('show') },
    hideLoading() { calls.push('hide') },
    getImageInfo({ success }) { completeProbe = () => success({ path: '/medium.jpg' }) },
    previewImage(options) {
      calls.push(options)
      options.complete()
    },
  }
  const page = { pauseInterstitialUntilNextShow() { calls.push('pause') } }
  global.getCurrentPages = () => [page]
  try {
    const first = openImagePreview(page, [{ mediumUrl: '/medium.jpg' }], 0)
    assert.equal(await openImagePreview(page, [{ mediumUrl: '/other.jpg' }], 0), undefined)
    completeProbe()
    await first
    assert.deepEqual(calls.slice(0, 3), ['show', 'pause', 'hide'])
    assert.deepEqual({ urls: calls[3].urls, current: calls[3].current }, { urls: ['/medium.jpg'], current: '/medium.jpg' })
    assert.equal(typeof calls[3].fail, 'function')
    assert.equal(calls[4], 'hide')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
    if (originalPages === undefined) delete global.getCurrentPages
    else global.getCurrentPages = originalPages
  }
})

test('custom tab labels stay compact even when an operator configures a long name', () => {
  const tabs = normalizeTabs({ letters: { label: '这是一个很长的心笺名称', visible: true } })
  assert.equal(tabs.find((item) => item.key === 'letters').text, '这是一个…')
})

test('mine stats grid fills the row when the message card is hidden', () => {
  const template = readMiniappFile('pages/mine/mine.wxml')
  const styles = readMiniappFile('styles/components.wxss')
  assert.match(template, /class="stats-row-4 mine-stats-row" style="\{\{messagesEnabled \? 'grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);' : 'grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);'\}\}"/)
  assert.doesNotMatch(template, /mine-stats-row--3/)
  assert.doesNotMatch(styles, /mine-stats-row--3/)
})

test('mine page shows up to 20 recent opened records', () => {
  const mine = readMiniappFile('pages/mine/mine.js')
  const service = fs.readFileSync(path.resolve(__dirname, '../src/modules/content/content.service.js'), 'utf8')
  assert.match(mine, /histories\.slice\(0, 20\)/)
  assert.match(service, /if \(name === 'opened'\) return defaultOptions/)
})

test('message controls stay closed until the server explicitly enables them', () => {
  for (const relativePath of [
    'pages/home/home.js',
    'pages/letters/letters.js',
    'pages/mine/mine.js',
    'pages/messages/messages.js',
  ]) {
    const source = readMiniappFile(relativePath)
    assert.match(source, /messagesEnabled:\s*false/)
    assert.doesNotMatch(source, /messagesEnabled:\s*(?:data|home)\??\.messagesEnabled !== false/)
    assert.match(source, /messagesEnabled\s*[:=][^\n]*(?:data|home)\??\.messagesEnabled === true/)
  }
  const messagesTemplate = readMiniappFile('pages/messages/messages.wxml')
  assert.match(messagesTemplate, /title="\{\{messagesEnabled \? '我的留言' : ''\}\}"/)
  assert.match(messagesTemplate, /show-title="\{\{messagesEnabled\}\}"/)
})

test('successful data loads clear stale errors across primary content pages', () => {
  [
    'pages/home/home.js',
    'pages/articles/articles.js',
    'pages/article/article.js',
    'pages/letters/letters.js',
    'pages/mine/mine.js',
    'pages/opened-history/opened-history.js',
    'pages/favorites/favorites.js',
    'pages/interactions/interactions.js',
    'pages/messages/messages.js',
  ].forEach((relativePath) => {
    assert.ok((readMiniappFile(relativePath).match(/error:\s*''/g) || []).length >= 2)
  })
})

test('check-in applies its confirmed result before refreshing summary data', () => {
  const source = readMiniappFile('pages/home/home.js')
  const checkinResult = source.lastIndexOf('checkInState: data.checkIn || {}')
  const refresh = source.indexOf('this.refreshHomeStats()', checkinResult)
  assert.ok(checkinResult >= 0)
  assert.ok(refresh > checkinResult)
})

test('check-in fallback copy matches the configured default values', () => {
  const pack = readMiniappFile('utils/default-copy.js')
  assert.match(pack, /checkinBefore: \[\s*'今天也等到你了',\s*'每天都来打卡吧',\s*\]/)
  assert.match(pack, /checkinAfter: \[\s*'今日已点亮，明天再来打卡吧！',\s*'感谢你的支持，明天我等你哦！',\s*\]/)
})

test('private sharing preserves an opened daily content item while home sharing cycles enabled types', () => {
  const home = readMiniappFile('pages/home/home.js')
  assert.match(home, /const HOME_SHARE_TYPE_ORDER = \['text', 'audio', 'album'\]/)
  assert.match(home, /function getHomeShareDailyContentTypes\(dailyContentTypes\)/)
  assert.match(home, /getLatestStartupConfig\(\)\?\.config\?\.dailyContentTypes/)
  assert.match(home, /function getNextHomeShareType\(dailyContentTypes, startIndex = 0\)/)
  assert.match(home, /dailyContentTypes && dailyContentTypes\.imageEnabled !== false/)
  assert.match(home, /dailyContentTypes\?\.audioEnabled === true/)
  assert.match(home, /const index = \(startIndex \+ offset\) % HOME_SHARE_TYPE_ORDER\.length/)
  assert.match(home, /return \{ type, nextIndex: \(index \+ 1\) % HOME_SHARE_TYPE_ORDER\.length \}/)
  assert.match(home, /this\.homeShareTypeIndex = 0/)
  assert.match(home, /getNextHomeShareType\(getHomeShareDailyContentTypes\(this\.data\.dailyContentTypes\), this\.homeShareTypeIndex\)/)
  assert.match(home, /if \(nextHomeShare\) this\.homeShareTypeIndex = nextHomeShare\.nextIndex/)
  assert.match(home, /const nextHomeShare = isOpenedDailyContent\s*\? null\s*:\s*getNextHomeShareType/s)
  assert.doesNotMatch(home, /const nextHomeShare = isOpenedDailyContent \|\| !this\.privateShareCardsReady/)
  assert.match(home, /nextHomeShare\?\.type \|\| 'text'/)
  assert.match(home, /function getSharedDailyContentTarget\(options = \{\}\)/)
  assert.match(home, /contentId: String\(options\.contentId \|\| ''\)\.trim\(\)/)
  assert.match(home, /if \(!this\.consumeSharedDailyContentEntry\(\)\) this\.setSharedDailyContentTarget\(getSharedDailyContentTarget\(options\)\)/)
  assert.match(home, /handleDailyContentPrimaryAction\(\) \{\s*if \(this\.pendingSharedDailyContentType\) \{/s)
  assert.match(home, /this\.openSharedDailyContent\(\)/)
  assert.match(home, /this\.preflightSharedDailyContent\(\)/)
  assert.match(home, /getDailyContentAvailability\(\{ type: target\.type, contentId: target\.contentId \}\)/)
  assert.match(readMiniappFile('pages/home/home.wxml'), /bindtap="handleDailyContentPrimaryAction"/)
  assert.match(home, /contentId: options\.contentId \|\| ''/)
  assert.match(home, /contentId=\$\{encodeURIComponent\(this\.data\.dailyContent\.id\)\}/)
})

test('home private share fallback prefers the configured common background before packaged fallback', () => {
  const home = readMiniappFile('pages/home/home.js')
  assert.match(home, /function getPrivateShareFallbackImage\(settings = copyPack\.getShareSettings\(\)\)/)
  assert.match(home, /backgrounds\[0\]\?\.imageUrl \|\| DEFAULT_COPY_PACK\.shareBackgrounds\[0\]\.imageUrl/)
  assert.match(home, /imageUrl: getPrivateShareFallbackImage\(\)/)
})

test('shared daily content items are checked before advertising and offer a native random fallback modal', () => {
  const home = readMiniappFile('pages/home/home.js')
  const template = readMiniappFile('pages/home/home.wxml')
  const service = readMiniappFile('services/miniapp.js')
  assert.match(service, /url: '\/miniapp\/daily-content\/availability'/)
  assert.match(home, /const cached = this\.sharedDailyContentPreflightResult/)
  assert.match(home, /if \(cached\?\.availability && this\.isCurrentSharedDailyContentTarget\(cached\.target\)\)/)
  assert.match(home, /const result = await this\.preflightSharedDailyContent\(target\)/)
  assert.match(home, /this\.setData\(\{ sharedDailyContentChecking: true \}\)/)
  assert.match(home, /this\.setData\(\{ sharedDailyContentChecking: false \}, \(\) => \{\s*if \(result\?\.availability\) this\.handleSharedDailyContentPreflight\(target, result\.availability\)/s)
  assert.match(home, /handleSharedDailyContentPreflight\(target, availability\) \{/)
  assert.match(home, /if \(this\.data\.dailyContentLoading \|\| this\.data\.sharedDailyContentChecking\) return/)
  assert.match(home, /if \(!availability\.available\)/)
  assert.match(home, /wx\.showModal\(\{\s*title: '内容暂时无法打开',\s*content: '可随机打开另一份',\s*cancelText: '暂不',\s*confirmText: '随机打开',\s*success: \(res\) => \{\s*if \(!res\.confirm \|\| !this\.isCurrentSharedDailyContentTarget\(target\)\) return/s)
  assert.match(home, /this\.handleOpenDailyContent\(target\.type, '', \{\s*contentId: target\.contentId,\s*randomAvailabilityConfirmed: !target\.contentId,\s*sharedTarget: true,\s*sharedDailyContentTarget: target,?\s*\}\)/s)
  assert.match(home, /this\.handleOpenDailyContent\('random', '', \{ rewardedConfirmed: true \}\)/)
  assert.match(home, /this\.clearSharedDailyContentTarget\(target\)\s*this\.handleOpenDailyContent\('random'/s)
  assert.doesNotMatch(template, /sharedDailyContentFallback|内容暂时无法打开|可随机打开另一份/)
  assert.match(template, /disabled="\{\{dailyContentLoading \|\| sharedDailyContentChecking\}\}"/)
})

test('rewarded ad confirmations use native modals with action-specific copy and confirmation callbacks', () => {
  const home = readMiniappFile('pages/home/home.js')
  const pack = readMiniappFile('utils/default-copy.js')
  assert.match(home, /wx\.showModal\(\{\s*title: '观看广告',\s*content: excludeId\s*\? resolveCopyText\(null, 'changeDailyContentConfirm'\)\s*: resolveCopyText\(null, 'openDailyContentConfirm'\),\s*cancelText: '暂不',\s*confirmText: '去观看',\s*success: \(res\) => \{\s*if \(res\.confirm && canContinueOpening\(\)\)/s)
  assert.match(home, /this\.handleOpenDailyContent\(requestType, excludeId, \{\s*rewardedConfirmed: true,/s)
  assert.match(home, /wx\.showModal\(\{\s*title: '观看广告',\s*content: resolveCopyText\(null, 'checkinAdConfirm'\),\s*cancelText: '暂不',\s*confirmText: '去观看',\s*success: \(res\) => \{\s*if \(res\.confirm\) this\.handleCheckIn\(\{ rewardedConfirmed: true \}\)/s)
  assert.match(pack, /openDailyContentConfirm: \['完整观看广告 即可打开手记'\]/)
  assert.match(pack, /changeDailyContentConfirm: \['完整观看广告 即可更换手记'\]/)
  assert.match(pack, /checkinAdConfirm: \['完整观看广告 即可完成打卡'\]/)
  assert.doesNotMatch(home, /showRewardedAdConfirm|rewardedAdConfirm/)
})

test('article rewarded ad incomplete copy comes from the per-mini-program system config', () => {
  const article = readMiniappFile('pages/article/article.js')
  const pack = readMiniappFile('utils/default-copy.js')
  assert.match(article, /articleAdIncompleteText: resolveCopyText\(system\.articleAdIncompleteText, 'articleAdIncomplete'\)/)
  assert.match(article, /resolveCopyText\(this\.data\.articleAdIncompleteText, 'articleAdIncomplete'\)/)
  assert.match(pack, /articleAdIncomplete: \['完整观看广告后，即可展开全文'\]/)
})

test('random daily content items check availability before advertising and preserve the current item exclusion', () => {
  const home = readMiniappFile('pages/home/home.js')
  const availabilityIndex = home.indexOf("const availability = await getDailyContentAvailability({ type: requestType, excludeId })")
  const rewardedAdIndex = home.indexOf("const reward = await runConfiguredRewardedAd('daily_content'")
  assert.ok(availabilityIndex >= 0)
  assert.ok(rewardedAdIndex > availabilityIndex)
  assert.match(home, /if \(!options\.contentId && options\.randomAvailabilityConfirmed !== true\)/)
  assert.match(home, /if \(!availability\.available\) \{\s*wx\.showToast\(\{ title: '暂无可打开内容', icon: 'none' \}\)\s*return/s)
  assert.match(home, /this\.handleOpenDailyContent\('random', this\.data\.dailyContent && this\.data\.dailyContent\.id\)/)
})

test('profile actions prevent repeat requests', () => {
  const profile = readMiniappFile('pages/profile/profile.js')
  assert.match(profile, /if \(this\.data\.saving\) return/)
  assert.match(profile, /if \(this\.data\.phoneAuthorizing\) return/)
})

test('profile avatar uploads do not persist an unsaved nickname', () => {
  const profile = readMiniappFile('pages/profile/profile.js')
  const service = readMiniappFile('services/miniapp.js')
  const avatarImage = readMiniappFile('utils/avatar-image.js')
  const mineTemplate = readMiniappFile('pages/mine/mine.wxml')
  const mineStyles = readMiniappFile('pages/mine/mine.wxss')
  const profileStyles = readMiniappFile('pages/profile/profile.wxss')
  assert.match(profile, /uploadAvatar\(avatarUrl, await this\.getAvatarCanvas\(\)\)/)
  assert.match(profile, /select\('#avatarProcessingCanvas'\)/)
  assert.match(profile, /头像处理失败（错误编号：\$\{errorCode\}）/)
  assert.match(profile, /wx\.showToast\(\{ title: '头像处理失败', icon: 'none' \}\)/)
  const profileTemplate = readMiniappFile('pages/profile/profile.wxml')
  assert.match(profileTemplate, /wx:if="\{\{error\}\}"/)
  assert.match(profileTemplate, /id="avatarProcessingCanvas"[^>]*type="2d"/)
  assert.match(service, /createAvatarJpeg\(canvas, sourcePath\)/)
  assert.match(service, /removeTemporaryAvatar\(compressedPath\)/)
  assert.doesNotMatch(service, /compressImage/)
  assert.match(avatarImage, /const AVATAR_SIZE = 256/)
  assert.match(avatarImage, /const MAX_AVATAR_BYTES = 100 \* 1024/)
  assert.match(avatarImage, /fileType: 'jpg'/)
  assert.match(avatarImage, /getCenteredSquareCrop\(image\.width, image\.height\)/)
  assert.match(avatarImage, /drawImage\(image, crop\.sx, crop\.sy, crop\.size, crop\.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE\)/)
  assert.match(avatarImage, /if \(await getFileSize\(tempFilePath\) <= MAX_AVATAR_BYTES\)/)
  assert.match(avatarImage, /JPEG_QUALITIES = \[0\.82, 0\.68, 0\.54, 0\.4, 0\.28, 0\.16, 0\.06, 0\.01\]/)
  assert.match(mineTemplate, /class="avatar-image" mode="aspectFill"/)
  assert.match(mineStyles, /\.avatar\s*\{[^}]*padding:\s*0;/s)
  for (const styles of [mineStyles, profileStyles]) {
    assert.match(styles, /\.avatar\s*\{[^}]*border-radius:[^}]*overflow:\s*hidden;/s)
    assert.match(styles, /\.avatar-image\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
  }
  assert.doesNotMatch(service, /formData:\s*\{[\s\S]*nickname/)
})

test('data-scope changes refresh the visible page without replaying the rejected write', () => {
  const app = readMiniappFile('app.js')
  const request = readMiniappFile('utils/request.js')
  const service = readMiniappFile('services/miniapp.js')
  const offlineSync = readMiniappFile('utils/offline-sync.js')

  // 数据空间复核已收编进统一启动配置服务：app.onShow 只经 refreshDataScopeId 走一条通道
  assert.match(app, /refreshDataScopeId\(\{ maxAgeMs: 30000 \}\)\.catch\(\(\) => \{\}\)/)
  assert.match(app, /require\('\.\/utils\/request'\)/)
  assert.doesNotMatch(app, /refreshDataScopeFromConfig/)
  assert.match(request, /require\('\.\/startup-config'\)/)
  assert.doesNotMatch(service, /refreshDataScopeFromConfig/)
  assert.match(app, /handleDataScopeChange\(\{ previousDataScopeId, dataScopeId \}\)/)
  assert.match(app, /wx\.reLaunch\(\{ url \}\)/)
  assert.match(request, /if \(error\.statusCode === 409\) throw await recoverDataScopeChange\(error\)/)
  assert.match(request, /new Error\('数据已更新，请重试'\)/)
  assert.match(service, /clearResourceCachesForScope\(scopeId\)/)
  assert.match(service, /discardPendingOperationsForScope\(scopeId\)/)
  assert.doesNotMatch(request, /statusCode === 409[^\n]*sendRequest\(\{ url: `\$\{env\.apiBaseUrl\}\/miniapp\/config`/)
  assert.doesNotMatch(offlineSync, /statusCode === 409\) clearDataScopeId/)
})

test('avatar uploads use and recover the server-issued data scope', () => {
  const service = readMiniappFile('services/miniapp.js')
  assert.match(service, /const dataScopeId = await ensureDataScopeId\(\)/)
  assert.match(service, /'x-miniapp-data-scope': encodeDataScopeHeader\(dataScopeId\)/)
  assert.match(service, /if \(result\.statusCode === 409\) \{\s*recoverDataScopeChange\(uploadError\)\.then\(reject, reject\)/s)
})

test('daily content and article cards use display-sized images before original media', () => {
  const image = { thumbUrl: '/thumb.jpg', mediumUrl: '/medium.jpg', originalUrl: '/original.jpg' }
  assert.equal(prepareDisplayImage(image).displayUrl, '/medium.jpg')
  assert.equal(prepareDisplayImage(image, 'thumb').displayUrl, '/thumb.jpg')
  assert.match(readMiniappFile('pages/home/home.wxml'), /src="\{\{item\.displayUrl\}\}"/)
  assert.match(readMiniappFile('utils/article-feed.js'), /coverImage\.mediumUrl\s*\|\| coverImage\.thumbUrl\s*\|\| coverImage\.originalUrl/s)
})

test('image candidates deduplicate sources and stop after all variants are exhausted', () => {
  const candidates = getImageCandidates({ mediumUrl: '/same.jpg', thumbUrl: '/same.jpg', originalUrl: '/original.jpg' }, 'medium', ['/same.jpg', '/fallback.jpg'])
  assert.deepEqual(candidates, ['/same.jpg', '/original.jpg', '/fallback.jpg'])
  assert.equal(getNextImageUrl(candidates, '/same.jpg'), '/original.jpg')
  assert.equal(getNextImageUrl(candidates, '/fallback.jpg'), '')
  assert.equal(getNextImageUrl(candidates, ''), '')
})

function loadPageForImageTest(relativePath) {
  const pagePath = require.resolve(path.join(miniappRoot, relativePath))
  const originalPage = global.Page
  let definition
  global.Page = (value) => { definition = value }
  delete require.cache[pagePath]
  try { require(pagePath) } finally {
    if (originalPage === undefined) delete global.Page
    else global.Page = originalPage
    delete require.cache[pagePath]
  }
  return definition
}

function setImageTestData(patch) {
  this.writes += 1
  Object.entries(patch).forEach(([field, value]) => {
    const keys = field.replace(/\[(\d+)\]/g, '.$1').split('.')
    const finalKey = keys.pop()
    const target = keys.reduce((current, key) => current[key], this.data)
    target[finalKey] = value
  })
}

test('home image errors clear the failed display image without rewriting source versions', () => {
  const page = loadPageForImageTest('pages/home/home.js')
  const image = {
    ...prepareDisplayImage({ mediumUrl: '/medium.jpg', thumbUrl: '/thumb.jpg', originalUrl: '/original.jpg' }),
    displayUrl: '/medium.jpg',
    displayLoading: true,
  }
  const instance = { data: { dailyContent: { images: [image] } }, writes: 0, setData: setImageTestData }
  page.handleAlbumImageError.call(instance, { currentTarget: { dataset: { index: 0, src: '/medium.jpg' } } })
  assert.equal(image.displayUrl, '')
  assert.equal(image.displayLoading, false)
  const writes = instance.writes
  page.handleAlbumImageError.call(instance, { currentTarget: { dataset: { index: 0, src: '/thumb.jpg' } } })
  page.handleAlbumImageError.call(instance, { currentTarget: { dataset: { index: 0, src: '/original.jpg' } } })
  page.handleAlbumImageError.call(instance, { currentTarget: { dataset: { index: 0, src: '' } } })
  assert.equal(instance.writes, writes)
  assert.equal(image.mediumUrl, '/medium.jpg')
  assert.equal(image.thumbUrl, '/thumb.jpg')
  assert.equal(image.originalUrl, '/original.jpg')
})

test('history image and article cover errors stop after their candidates and ignore stale events', () => {
  for (const [pageName, listKey] of [['mine', 'histories'], ['opened-history', 'items']]) {
    const page = loadPageForImageTest(`pages/${pageName}/${pageName}.js`)
    const item = normalizeActivityItem({ source: 'article', type: 'article', sourceId: 'a-1', coverImage: { thumbUrl: '/thumb.jpg', mediumUrl: '/medium.jpg' }, images: [{ thumbUrl: '/thumb.jpg', mediumUrl: '/medium.jpg' }] })
    const instance = { data: { [listKey]: [item] }, writes: 0, setData: setImageTestData }
    const image = item.images[0]
    for (const src of image.displayCandidates) page.handleHistoryImageError.call(instance, { currentTarget: { dataset: { index: 0, imageIndex: 0, src } } })
    assert.equal(image.displayUrl, '')
    for (const src of item.coverCandidates) page.handleHistoryCoverError.call(instance, { currentTarget: { dataset: { index: 0, src } } })
    assert.equal(item.coverUrl, '')
    const writes = instance.writes
    page.handleHistoryCoverError.call(instance, { currentTarget: { dataset: { index: 0, src: '/thumb.jpg' } } })
    page.handleHistoryImageError.call(instance, { currentTarget: { dataset: { index: 0, imageIndex: 0, src: '' } } })
    assert.equal(instance.writes, writes)
    assert.equal(image.mediumUrl, '/medium.jpg')
  }
})

test('public, private, and article links use contentId consistently', () => {
  const home = readMiniappFile('pages/home/home.js')
  const letters = readMiniappFile('pages/letters/letters.js')
  const articles = readMiniappFile('pages/articles/articles.js')
  const article = readMiniappFile('pages/article/article.js')
  assert.match(home, /options\.contentId/)
  assert.match(home, /contentId=\$\{encodeURIComponent\(this\.data\.dailyContent\.id\)\}/)
  assert.match(letters, /options\.contentId/)
  assert.match(letters, /letters\?contentId=\$\{encodeURIComponent\(item\.id \|\| ''\)\}/)
  assert.match(letters, /warmVisibleShareCard\(\)/)
  assert.match(letters, /this\.preparePublicShareCard\(item, copyPack\.getShareSettings\(\), \{ preview: true \}\)/)
  assert.match(articles, /\/pages\/article\/article\?contentId=\$\{encodeURIComponent\(contentId\)\}/)
  assert.match(article, /this\.contentId = String\(options\.contentId \|\| ''\)\.trim\(\)/)
  assert.match(article, /\/pages\/article\/article\?contentId=\$\{encodeURIComponent\(this\.contentId\)\}/)
  assert.match(article, /promise: cardPromise/)
  assert.match(home, /const target = event\?\.target \|\| \{\}/)
  assert.match(letters, /const target = event\?\.target \|\| \{\}/)
})

test('article sharing has a 2d canvas for composed public share cards', () => {
  const article = readMiniappFile('pages/article/article.js')
  const template = readMiniappFile('pages/article/article.wxml')
  assert.match(article, /createShareCardComposer\(this\)/)
  assert.match(template, /<canvas id="shareCanvas" canvas-id="shareCanvas" type="2d" class="share-card-canvas"><\/canvas>/)
})
