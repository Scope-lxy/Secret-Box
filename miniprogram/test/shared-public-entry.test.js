const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const articlesPath = require.resolve('../pages/articles/articles')
const articlePath = require.resolve('../pages/article/article')
const lettersPath = require.resolve('../pages/letters/letters')
const sharedArticleReturn = require('../utils/shared-article-return')

function installModule(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports }
}

function createPage(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    getTabBar() { return null },
    setData(update, callback) {
      Object.assign(this.data, update)
      if (callback) callback()
    },
  }
}

function installSharedStubs(t, service = {}) {
  const dependencies = [
    '../services/miniapp',
    '../utils/tabs',
    '../utils/font-mode',
    '../utils/page-loading',
    '../utils/list-ads',
    '../utils/ads',
    '../utils/native-ad',
    '../utils/startup-config',
    '../utils/default-copy',
    '../utils/copy-pack',
    '../utils/image-display',
    '../utils/share-card',
    '../utils/paragraphs',
    '../utils/format',
  ].map((request) => require.resolve(request))
  installModule(dependencies[0], {
    getArticles: () => Promise.resolve({ items: [] }),
    getArticlesPage: () => Promise.resolve({ items: [] }),
    getCachedArticles: () => null,
    getArticle: () => Promise.resolve({ article: {} }),
    getCachedHomeData: () => null,
    getCachedLetters: () => null,
    getHomeData: () => Promise.resolve({}),
    getLetters: () => Promise.resolve({ items: [] }),
    getLettersPage: () => Promise.resolve({ items: [] }),
    ...service,
  })
  installModule(dependencies[1], { ensureVisibleTab: () => true, syncCustomTabBar() {} })
  installModule(dependencies[2], { getFontSizeMode: () => 'larger' })
  installModule(dependencies[3], { finishInitialLoad() {}, startInitialLoad() {} })
  installModule(dependencies[4], { markListAdSlots: (items) => items })
  installModule(dependencies[5], { scheduleInterstitialAd: () => () => {} })
  installModule(dependencies[6], { shouldKeepNativeAdHidden: () => false })
  installModule(dependencies[7], {
    getLatestStartupConfig: () => ({ tabs: [] }),
    getStartupConfig: () => Promise.resolve({ config: {}, tabs: [] }),
    refreshStartupConfig: () => Promise.resolve(),
  })
  installModule(dependencies[8], { resolveCopyText: (value, fallback) => value || fallback, DEFAULT_COPY_PACK: { shareBackgrounds: [] } })
  installModule(dependencies[9], { getShareSettings: () => ({}) })
  installModule(dependencies[10], { getImageCandidates: () => [], getNextImageUrl: () => '' })
  installModule(dependencies[11], {
    createPublicShareCard: () => Promise.resolve({}),
    createShareCardComposer: () => ({}),
    getPublicShareTitle: () => '',
  })
  installModule(dependencies[12], { splitContentParagraphs: () => [] })
  installModule(dependencies[13], { compactNumber: (value) => String(value), withInteractionDisplayCounts: (item) => item })
  t.after(() => dependencies.forEach((modulePath) => delete require.cache[modulePath]))
}

function loadPage(t, pagePath) {
  let definition
  const previousPage = global.Page
  global.Page = (value) => { definition = value }
  delete require.cache[pagePath]
  require(pagePath)
  t.after(() => {
    delete require.cache[pagePath]
    global.Page = previousPage
  })
  return definition
}

function installRuntime(t, target = null) {
  const toasts = []
  const navigations = []
  const scrolls = []
  const consumed = []
  const app = {
    globalData: { foregroundVersion: 0 },
    getPendingSharedContentTarget: () => target,
    consumePendingSharedContentTarget(token) {
      consumed.push(token)
      if (target?.token === token) target = null
      return true
    },
  }
  const previousApp = global.getApp
  const previousWx = global.wx
  global.getApp = () => app
  global.wx = {
    hideShareMenu() {},
    navigateTo(options) { navigations.push(options.url) },
    redirectTo(options) { navigations.push(options.url) },
    switchTab(options) { navigations.push(options.url) },
    pageScrollTo(options) { scrolls.push(options) },
    showToast(options) { toasts.push(options.title) },
    stopPullDownRefresh() {},
  }
  t.after(() => {
    global.getApp = previousApp
    global.wx = previousWx
  })
  return { app, consumed, navigations, scrolls, toasts }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

test('article share opens directly, then every article detail returns to a list with its target first', (t) => {
  installSharedStubs(t)
  const shared = { source: 'share', target: 'article', contentId: 'article-share', token: 'article-token' }
  const { navigations, scrolls, toasts } = installRuntime(t, shared)
  const articleDefinition = loadPage(t, articlePath)
  assert.equal(articleDefinition.data.returnToArticles, true)
  const detail = createPage(articleDefinition)
  detail.contentId = 'article-share'
  detail.captureSharedArticleTarget()
  detail.setData({ returnToArticles: true })
  assert.equal(detail.data.returnToArticles, true)
  assert.deepEqual(navigations, [])
  detail.data.article = { id: 'article-share', title: '分享文章' }
  detail.handleArticleBack()
  assert.equal(navigations[0], '/pages/articles/articles')

  const articlesDefinition = loadPage(t, articlesPath)
  const sharedList = createPage(articlesDefinition)
  sharedList.data.layout = 'title-left'
  sharedList.data.sortMode = 'sequence'
  assert.equal(sharedList.setSharedArticleTarget(), true)
  sharedList.applyArticles({ items: [{ id: 'article-other' }, { id: 'article-share', title: '分享文章' }] })
  assert.deepEqual(sharedList.data.items.map((item) => item.id), ['article-share', 'article-other'])
  assert.deepEqual(toasts, [])
  assert.ok(scrolls.length >= 2)

  const normalList = createPage(articlesDefinition)
  normalList.data.layout = 'title-left'
  normalList.data.sortMode = 'sequence'
  normalList.applyArticles({ items: [{ id: 'article-first' }, { id: 'article-second' }] })
  assert.deepEqual(normalList.data.items.map((item) => item.id), ['article-first', 'article-second'])

  const normalDetail = createPage(articleDefinition)
  normalDetail.data.article = { id: 'article-normal', title: '普通文章' }
  normalDetail.handleArticleBack()
  assert.equal(navigations[1], '/pages/articles/articles')
  const missingDetail = createPage(articleDefinition)
  missingDetail.handleArticleBack()
  assert.equal(navigations[2], '/pages/articles/articles')
  assert.equal(sharedArticleReturn.getSharedArticleReturnTarget().contentId, 'article-normal')
  sharedArticleReturn.consumeSharedArticleReturnTarget('article-normal')
})

test('each return to the same article creates a distinct target event', async (t) => {
  installSharedStubs(t)
  const { scrolls } = installRuntime(t)
  const articlesDefinition = loadPage(t, articlesPath)
  const articles = createPage(articlesDefinition)
  articles.data.layout = 'title-left'
  articles.data.sortMode = 'sequence'

  sharedArticleReturn.consumeSharedArticleReturnTarget()
  sharedArticleReturn.setSharedArticleReturnTarget({ id: 'same-article', title: '同一篇文章' })
  const firstTarget = sharedArticleReturn.getSharedArticleReturnTarget()
  assert.equal(articles.setSharedArticleTarget(), true)
  articles.applyArticles({ items: [{ id: 'same-article', title: '同一篇文章' }] })

  sharedArticleReturn.setSharedArticleReturnTarget({ id: 'same-article', title: '同一篇文章' })
  const secondTarget = sharedArticleReturn.getSharedArticleReturnTarget()
  assert.notEqual(secondTarget.token, firstTarget.token)
  assert.equal(articles.setSharedArticleTarget(), true)
  articles.applyArticles({ items: [{ id: 'same-article', title: '同一篇文章' }] })

  assert.equal(sharedArticleReturn.getSharedArticleReturnTarget(), null)
  assert.equal(scrolls.length, 4)
  articles.pagination = { page: 1, totalPages: 2 }
  await articles.onReachBottom()
  assert.equal(scrolls.length, 4)
})

test('article return and letter share targets show an unavailable prompt instead of substituting another item', (t) => {
  installSharedStubs(t)
  const { consumed, toasts } = installRuntime(t, { source: 'share', target: 'article', contentId: 'missing-article', token: 'missing-article-token' })
  const articlesDefinition = loadPage(t, articlesPath)
  const articles = createPage(articlesDefinition)
  articles.data.layout = 'title-left'
  articles.data.sortMode = 'sequence'
  articles.sharedContentId = 'missing-article'
  articles.sharedTargetToken = 'missing-article-token'
  articles.applyArticles({ items: [{ id: 'article-other' }] })
  assert.equal(articles.sharedContentId, '')
  assert.deepEqual(toasts, ['分享的内容暂时不可用'])
  assert.deepEqual(consumed, [])

  const lettersTarget = { source: 'share', target: 'letter', contentId: 'missing-letter', token: 'missing-letter-token' }
  const runtime = installRuntime(t, lettersTarget)
  const lettersDefinition = loadPage(t, lettersPath)
  const letters = createPage(lettersDefinition)
  letters.sharedContentId = 'missing-letter'
  letters.sharedTargetToken = 'missing-letter-token'
  letters.applyData({}, { items: [{ id: 'letter-other', content: '其他心笺' }] })
  assert.equal(letters.sharedContentId, '')
  assert.deepEqual(runtime.toasts, ['分享的内容暂时不可用'])
  assert.deepEqual(runtime.consumed, ['missing-letter-token'])
})

test('a retained letters tab consumes a hot share target, promotes it, and keeps normal order otherwise', async (t) => {
  const requests = []
  installSharedStubs(t, {
    getHomeData: () => Promise.resolve({ ads: {}, system: {} }),
    getLetters(options) {
      requests.push(options)
      return Promise.resolve({ items: [{ id: 'letter-other', content: '其他心笺' }, { id: 'letter-share', content: '分享心笺' }] })
    },
  })
  const target = { source: 'share', target: 'letter', contentId: 'letter-share', token: 'letter-token' }
  const { consumed, scrolls } = installRuntime(t, target)
  const lettersDefinition = loadPage(t, lettersPath)
  const letters = createPage(lettersDefinition)
  letters.data.ready = true
  letters.foregroundVersion = 0
  letters.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests[0].includeId, 'letter-share')
  assert.deepEqual(letters.data.items.map((item) => item.id), ['letter-share', 'letter-other'])
  assert.deepEqual(consumed, ['letter-token'])
  assert.equal(scrolls.length, 2)
  letters.lettersPagination = { page: 1, totalPages: 2 }
  await letters.onReachBottom()
  assert.equal(scrolls.length, 2)

  const normal = createPage(lettersDefinition)
  normal.applyData({}, { items: [{ id: 'letter-first', content: '第一条' }, { id: 'letter-second', content: '第二条' }] })
  assert.deepEqual(normal.data.items.map((item) => item.id), ['letter-first', 'letter-second'])
})

test('a newer shared target forces a replacement request after an in-flight article request', async (t) => {
  const requests = []
  const first = createDeferred()
  const second = createDeferred()
  installSharedStubs(t, {
    getArticles(options) {
      const request = requests.length === 0 ? first : second
      requests.push({ options, request })
      return request.promise
    },
  })
  const { scrolls } = installRuntime(t)
  const articlesDefinition = loadPage(t, articlesPath)
  const articles = createPage(articlesDefinition)
  articles.data.layout = 'title-left'
  articles.data.sortMode = 'sequence'
  articles.data.ready = true

  sharedArticleReturn.consumeSharedArticleReturnTarget()
  sharedArticleReturn.setSharedArticleReturnTarget({ id: 'article-old', title: '旧文章' })
  articles.onShow()
  sharedArticleReturn.setSharedArticleReturnTarget({ id: 'article-new', title: '新文章' })
  articles.onShow()
  first.resolve({ items: [{ id: 'article-old', title: '旧文章' }] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(requests[1].options.includeId, 'article-new')
  second.resolve({ items: [{ id: 'article-new', title: '新文章' }] })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(articles.data.items.map((item) => item.id), ['article-new'])
  assert.ok(scrolls.length >= 3)
})

test('a newer shared target forces a replacement request after an in-flight letter request', async (t) => {
  const requests = []
  const first = createDeferred()
  const second = createDeferred()
  installSharedStubs(t, {
    getHomeData: () => Promise.resolve({ ads: {}, system: {} }),
    getLetters(options) {
      const request = requests.length === 0 ? first : second
      requests.push({ options, request })
      return request.promise
    },
  })
  let target = { source: 'share', target: 'letter', contentId: 'letter-old', token: 'letter-old-token' }
  const runtime = installRuntime(t)
  runtime.app.getPendingSharedContentTarget = () => target
  const lettersDefinition = loadPage(t, lettersPath)
  const letters = createPage(lettersDefinition)
  letters.data.ready = true

  letters.onShow()
  target = { source: 'share', target: 'letter', contentId: 'letter-new', token: 'letter-new-token' }
  letters.onShow()
  first.resolve({ items: [{ id: 'letter-old', content: '旧心笺' }] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(requests[1].options.includeId, 'letter-new')
  second.resolve({ items: [{ id: 'letter-new', content: '新心笺' }] })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(letters.data.items.map((item) => item.id), ['letter-new'])
  assert.ok(runtime.scrolls.length >= 3)
})

test('an old article pagination response cannot repopulate a newer shared target', async (t) => {
  const nextPage = createDeferred()
  installSharedStubs(t, { getArticlesPage: () => nextPage.promise })
  installRuntime(t)
  const articlesDefinition = loadPage(t, articlesPath)
  const articles = createPage(articlesDefinition)
  articles.data.layout = 'title-left'
  articles.data.sortMode = 'sequence'
  articles.data.ready = true
  articles.data.items = [{ id: 'article-old' }]
  articles.pagination = { page: 1, totalPages: 2 }

  const paging = articles.onReachBottom()
  sharedArticleReturn.consumeSharedArticleReturnTarget()
  sharedArticleReturn.setSharedArticleReturnTarget({ id: 'article-new', title: '新文章' })
  assert.equal(articles.setSharedArticleTarget(), true)
  nextPage.resolve({ items: [{ id: 'article-old-page-2' }], pagination: { page: 2, totalPages: 2 } })
  await paging

  assert.deepEqual(articles.data.items, [])
  assert.equal(articles.pagination, null)
})

test('an old letter pagination error cannot affect a newer shared target', async (t) => {
  const nextPage = createDeferred()
  installSharedStubs(t, { getLettersPage: () => nextPage.promise })
  const runtime = installRuntime(t)
  let target = null
  runtime.app.getPendingSharedContentTarget = () => target
  const lettersDefinition = loadPage(t, lettersPath)
  const letters = createPage(lettersDefinition)
  letters.data.ready = true
  letters.data.items = [{ id: 'letter-old', content: '旧心笺' }]
  letters.lettersPagination = { page: 1, totalPages: 2 }

  const paging = letters.onReachBottom()
  target = { source: 'share', target: 'letter', contentId: 'letter-new', token: 'letter-new-token' }
  assert.equal(letters.setSharedLetterTarget(), true)
  nextPage.reject(new Error('旧分页失败'))
  await paging

  assert.deepEqual(letters.data.items, [])
  assert.equal(letters.lettersPagination, null)
  assert.deepEqual(runtime.toasts, [])
})
