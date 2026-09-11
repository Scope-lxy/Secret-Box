const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const APP_PATH = path.join(__dirname, '..', 'app.js')
const HOME_PATH = require.resolve('../pages/home/home')
const MINIAPP_SERVICE_PATH = require.resolve('../services/miniapp')
const STARTUP_CONFIG_PATH = require.resolve('../utils/startup-config')
const TABS_PATH = require.resolve('../utils/tabs')
const FONT_MODE_PATH = require.resolve('../utils/font-mode')
const SHARE_CARD_PATH = require.resolve('../utils/share-card')

function loadAppDefinition() {
  let definition
  vm.runInNewContext(fs.readFileSync(APP_PATH, 'utf8'), {
    App(value) { definition = value },
    wx: {},
    getCurrentPages() { return [] },
    require(request) {
      if (request.endsWith('/config/env')) return { getMiniProgramAppId: () => 'test' }
      if (request.endsWith('/services/miniapp')) return { handleDataScopeChange() {}, startOfflineSync() {} }
      if (request.endsWith('/utils/request')) return { getStoredDataScopeId: () => '', hasPersistedSession: () => false, refreshDataScopeId() {}, revalidateMiniAppSession() {} }
      if (request.endsWith('/utils/copy-pack')) return { fetchCopyPack() {} }
      if (request.endsWith('/utils/startup-config')) return { getStartupConfig: () => ({ finally() {} }) }
      throw new Error(`unexpected require: ${request}`)
    },
  }, { filename: 'app.js' })
  return definition
}

function installModuleStub(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function buildRetainedHome(t, { getDailyContentAvailability, openDailyContent: openDailyContentOverride } = {}) {
  const opened = []
  installModuleStub(MINIAPP_SERVICE_PATH, {
    getCachedHomeData: () => null,
    getDailyContentAvailability,
    getHomeData: () => Promise.resolve({}),
    getRewardedAdAccess: () => Promise.resolve({ free: true }),
    recordShareInteraction: () => Promise.resolve(),
    openDailyContent(payload) {
      opened.push(payload)
      if (openDailyContentOverride) return openDailyContentOverride(payload)
      return Promise.resolve({ dailyContent: { id: payload.contentId || `${payload.type}-random`, type: payload.type, images: [] } })
    },
  })
  installModuleStub(STARTUP_CONFIG_PATH, {
    getLatestStartupConfig: () => ({ source: 'fresh', tabs: [{ key: 'home', visible: true }] }),
    getStartupConfig: () => Promise.resolve({ source: 'fresh', tabs: [{ key: 'home', visible: true }] }),
    refreshStartupConfig: () => Promise.resolve(),
  })
  installModuleStub(TABS_PATH, { ensureVisibleTab: () => true, syncCustomTabBar() {} })
  installModuleStub(FONT_MODE_PATH, { getFontSizeMode: () => 'larger' })
  installModuleStub(SHARE_CARD_PATH, {
    createPrivateShareCard: () => Promise.resolve({ title: '分享标题', imageUrl: 'https://example.com/share.jpg' }),
    createShareCardComposer: () => ({}),
  })

  let definition
  global.Page = (value) => { definition = value }
  delete require.cache[HOME_PATH]
  require(HOME_PATH)
  const page = {
    ...definition,
    data: {
      ...definition.data,
      homeAccessResolved: true,
      ads: { homeDailyContentRewarded: { enabled: false } },
    },
    getTabBar() { return null },
    loadHomeData() {},
    resetAudioPlayer() {},
    resetAudioPlayback() {},
    startInterstitialAd() {},
    setData(update, callback) {
      Object.assign(this.data, update)
      if (callback) callback()
    },
  }
  global.getCurrentPages = () => [page]
  t.after(() => {
    delete require.cache[HOME_PATH]
    delete require.cache[MINIAPP_SERVICE_PATH]
    delete require.cache[STARTUP_CONFIG_PATH]
    delete require.cache[TABS_PATH]
    delete require.cache[FONT_MODE_PATH]
    delete require.cache[SHARE_CARD_PATH]
    delete global.Page
    delete global.getApp
    delete global.getCurrentPages
    delete global.wx
  })
  return { opened, page }
}

test('a retained home tab consumes each shared App.onShow entry without replaying it on a normal foreground return', async (t) => {
  global.wx = { showToast() {}, showModal() {} }
  const definition = loadAppDefinition()
  const app = { globalData: { ...definition.globalData }, appWasHidden: true }
  app.captureSharedHomeEntry = definition.captureSharedHomeEntry
  app.consumeSharedHomeEntry = definition.consumeSharedHomeEntry
  app.capturePendingSharedContentTarget = definition.capturePendingSharedContentTarget
  app.onShow = definition.onShow
  const { opened, page } = buildRetainedHome(t, { getDailyContentAvailability: () => Promise.resolve({ available: true }) })
  global.getApp = () => app

  let audioPauseCount = 0
  let audioResetCount = 0
  page.pauseAudioPlayback = () => { audioPauseCount += 1 }
  page.resetAudioPlayback = () => { audioResetCount += 1 }
  page.data.dailyContent = { id: 'old-audio', isAudio: true }
  page.data.dailyContentMessage = '旧留言'
  page.data.messageText = '旧输入'
  page.data.messageSubmitting = true

  app.onShow({ path: 'pages/home/home', query: { type: 'album' }, scene: 1007 })
  page.onShow()
  assert.equal(page.pendingSharedDailyContentType, 'album')
  assert.equal(page.data.dailyContent, null)
  assert.equal(page.data.dailyContentMessage, '')
  assert.equal(page.data.messageText, '')
  assert.equal(page.data.messageSubmitting, false)
  assert.equal(audioPauseCount, 1)
  assert.equal(audioResetCount, 1)
  assert.equal(app.globalData.pendingSharedHomeEntry, null)
  await page.handleDailyContentPrimaryAction()
  await flush()
  assert.deepEqual(opened[0], { type: 'album', excludeId: '', contentId: '' })
  assert.equal(page.data.dailyContent.type, 'album')
  assert.equal(page.data.dailyContentLoading, false)

  page.handleChangeDailyContent()
  await flush()
  assert.deepEqual(opened[1], { type: 'random', excludeId: 'album-random', contentId: '' })
  assert.equal(page.data.dailyContentLoading, false)

  // Sending a card sets this marker. Re-entering through a chat-card scene
  // must still win over that return marker when the sender opens the card.
  app.globalData.shareReturnPending = true
  app.appWasHidden = true
  app.onShow({ path: 'pages/home/home', query: { type: 'audio', contentId: 'audio-42' }, scene: 1007 })
  page.onShow()
  await page.handleDailyContentPrimaryAction()
  await flush()
  assert.deepEqual(opened[2], { type: 'audio', excludeId: '', contentId: 'audio-42' })
  assert.equal(page.data.dailyContent.id, 'audio-42')

  app.globalData.shareReturnPending = true
  app.appWasHidden = true
  app.onShow({ path: 'pages/home/home', query: { type: 'audio', contentId: 'audio-42' }, scene: 1001 })
  page.onShow()
  assert.equal(page.pendingSharedDailyContentType, '')
  assert.equal(page.data.dailyContent.id, 'audio-42')
})

test('a stale shared availability result cannot open after a newer App.onShow entry replaces it', async (t) => {
  global.wx = { showToast() {}, showModal() {} }
  let resolveFirstAvailability
  const firstAvailability = new Promise((resolve) => { resolveFirstAvailability = resolve })
  const definition = loadAppDefinition()
  const app = { globalData: { ...definition.globalData }, appWasHidden: true }
  app.captureSharedHomeEntry = definition.captureSharedHomeEntry
  app.consumeSharedHomeEntry = definition.consumeSharedHomeEntry
  app.capturePendingSharedContentTarget = definition.capturePendingSharedContentTarget
  app.onShow = definition.onShow
  const { opened, page } = buildRetainedHome(t, {
    getDailyContentAvailability: ({ type }) => type === 'text' ? firstAvailability : Promise.resolve({ available: true }),
  })
  global.getApp = () => app
  const updates = []
  const setData = page.setData
  page.setData = function trackedSetData(update, callback) {
    updates.push(update)
    return setData.call(this, update, callback)
  }

  app.onShow({ path: 'pages/home/home', query: { type: 'text' }, scene: 1007 })
  page.onShow()
  const firstOpen = page.openSharedDailyContent()

  app.appWasHidden = true
  app.onShow({ path: 'pages/home/home', query: { type: 'album' }, scene: 1007 })
  page.onShow()
  resolveFirstAvailability({ available: true })
  await firstOpen
  await flush()
  assert.equal(opened.length, 0)

  await page.handleDailyContentPrimaryAction()
  await flush()
  assert.deepEqual(opened[0], { type: 'album', excludeId: '', contentId: '' })
})

test('a newer shared target invalidates old opening errors and prevents a stale request before it starts', async (t) => {
  const toasts = []
  global.wx = { showToast(options) { toasts.push(options) }, showModal() {} }
  let resolveAvailability
  const availability = new Promise((resolve) => { resolveAvailability = resolve })
  const definition = loadAppDefinition()
  const app = { globalData: { ...definition.globalData }, appWasHidden: true }
  app.captureSharedHomeEntry = definition.captureSharedHomeEntry
  app.consumeSharedHomeEntry = definition.consumeSharedHomeEntry
  app.capturePendingSharedContentTarget = definition.capturePendingSharedContentTarget
  app.onShow = definition.onShow
  const { opened, page } = buildRetainedHome(t, { getDailyContentAvailability: () => availability })
  global.getApp = () => app

  const oldOpen = page.handleOpenDailyContent('random')
  app.onShow({ path: 'pages/home/home', query: { type: 'audio', contentId: 'audio-new' }, scene: 1007 })
  page.onShow()
  resolveAvailability({ available: true })
  await oldOpen
  assert.equal(opened.length, 0)
  assert.equal(toasts.length, 0)
  assert.equal(page.data.dailyContentLoading, false)
  assert.equal(page.pendingSharedDailyContentType, 'audio')
})

test('daily-content opening guards stale errors and loading cleanup with its operation token', () => {
  const source = fs.readFileSync(HOME_PATH, 'utf8')
  assert.match(source, /catch \(error\) \{\s*if \(isCurrentOperation\(\)\) wx\.showToast/)
  assert.match(source, /finally \{\s*if \(isCurrentOperation\(\)\) this\.setData\(\{ dailyContentLoading: false \}\)/)
  assert.match(source, /if \(!canContinueOpening\(\)\) return\s*const data = await openDailyContent/)
})

test('App exposes a tokenized public share target only for chat-card entry scenes', () => {
  const definition = loadAppDefinition()
  const app = { globalData: { ...definition.globalData }, appWasHidden: true }
  app.captureSharedHomeEntry = definition.captureSharedHomeEntry
  app.capturePendingSharedContentTarget = definition.capturePendingSharedContentTarget
  app.getPendingSharedContentTarget = definition.getPendingSharedContentTarget
  app.consumePendingSharedContentTarget = definition.consumePendingSharedContentTarget
  app.onShow = definition.onShow

  app.globalData.shareReturnPending = true
  app.onShow({ path: 'pages/article/article', query: { contentId: 'article-42' }, scene: 1007 })
  const target = app.getPendingSharedContentTarget()
  assert.deepEqual(JSON.parse(JSON.stringify(target)), { source: 'share', target: 'article', contentId: 'article-42', key: 'article:article-42', token: '1' })
  assert.equal(app.consumePendingSharedContentTarget('wrong-token'), false)
  assert.equal(app.getPendingSharedContentTarget().contentId, 'article-42')
  assert.equal(app.consumePendingSharedContentTarget(target.token), true)
  assert.equal(app.getPendingSharedContentTarget(), null)

  app.appWasHidden = true
  app.onShow({ path: 'pages/letters/letters', query: { contentId: 'letter-7' }, scene: 1001 })
  assert.equal(app.getPendingSharedContentTarget(), null)
})

test('the latest valid share entry clears a pending target for the other content family', () => {
  const definition = loadAppDefinition()
  const app = { globalData: { ...definition.globalData } }
  app.captureSharedHomeEntry = definition.captureSharedHomeEntry
  app.capturePendingSharedContentTarget = definition.capturePendingSharedContentTarget

  app.capturePendingSharedContentTarget({ path: 'pages/article/article', query: { contentId: 'article-old' } })
  app.captureSharedHomeEntry({ path: 'pages/home/home', query: { type: 'album' } })
  assert.equal(app.globalData.pendingSharedContentTarget, null)
  assert.equal(app.globalData.pendingSharedHomeEntry.type, 'album')

  app.capturePendingSharedContentTarget({ path: 'pages/letters/letters', query: { contentId: 'letter-new' } })
  assert.equal(app.globalData.pendingSharedHomeEntry, null)
  assert.equal(app.globalData.pendingSharedContentTarget.contentId, 'letter-new')
})

test('an unavailable share target remains constrained until the user chooses random open', async (t) => {
  let modal
  global.wx = {
    showToast() {},
    showModal(options) { modal = options },
  }
  const { opened, page } = buildRetainedHome(t, { getDailyContentAvailability: () => Promise.resolve({ available: true }) })
  page.setSharedDailyContentTarget({ type: 'album', contentId: 'album-missing' })
  const target = page.getCurrentSharedDailyContentTarget()

  page.handleSharedDailyContentPreflight(target, { available: false, fallbackAvailable: true })
  assert.equal(modal.confirmText, '随机打开')
  modal.success({ confirm: false })
  assert.equal(page.pendingSharedDailyContentType, 'album')
  assert.equal(page.pendingSharedDailyContentId, 'album-missing')

  modal.success({ confirm: true })
  await flush()
  assert.equal(page.pendingSharedDailyContentType, '')
  assert.deepEqual(opened[0], { type: 'random', excludeId: '', contentId: '' })
})

test('home share keeps the same typed route in its async share result', async (t) => {
  global.wx = { showToast() {}, showModal() {} }
  const { page } = buildRetainedHome(t, { getDailyContentAvailability: () => Promise.resolve({ available: true }) })
  global.getApp = () => ({ markShareReturn() {} })
  page.privateShareCards = {}
  page.privateShareCardsReady = true
  page.privateShareCardsVersion = 0
  page.homeShareTypeIndex = 0
  page.shareCardComposer = {}

  const rotating = page.onShareAppMessage({ target: { dataset: { share: 'album' } } })
  assert.equal(rotating.path, '/pages/home/home?type=album')
  assert.equal((await rotating.promise).path, rotating.path)

  page.data.dailyContent = { id: 'album-99', isAlbum: true }
  const opened = page.onShareAppMessage({ target: { dataset: {} } })
  assert.equal(opened.path, '/pages/home/home?type=album&contentId=album-99')
  assert.equal((await opened.promise).path, opened.path)
})
