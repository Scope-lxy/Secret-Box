const {
  getArticles,
  getArticlesPage,
  getCachedArticles,
} = require('../../services/miniapp')
const { normalizeArticleLayout, normalizeArticleSortMode, prepareArticleSummary, sortArticleItems } = require('../../utils/article-feed')
const { ensureVisibleTab, syncCustomTabBar } = require('../../utils/tabs')
const { getFontSizeMode } = require('../../utils/font-mode')
const { finishInitialLoad, startInitialLoad } = require('../../utils/page-loading')
const { markListAdSlots } = require('../../utils/list-ads')
const { scheduleInterstitialAd } = require('../../utils/ads')
const { shouldKeepNativeAdHidden } = require('../../utils/native-ad')
const { getLatestStartupConfig, getStartupConfig, refreshStartupConfig } = require('../../utils/startup-config')
const { resolveCopyText } = require('../../utils/default-copy')
const copyPack = require('../../utils/copy-pack')
const { getNextImageUrl } = require('../../utils/image-display')
const { consumeSharedArticleReturnTarget, getSharedArticleReturnTarget } = require('../../utils/shared-article-return')

function mergeUniqueItems(items = [], targetId = '') {
  const seen = new Set()
  const unique = items.filter((item) => {
    const id = String(item?.id || '').trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
  const index = unique.findIndex((item) => item.id === targetId)
  if (index <= 0) return unique
  return [unique[index], ...unique.slice(0, index), ...unique.slice(index + 1)]
}

function getSystem(config = {}, tabsOverride) {
  const system = config.system || config
  if (!Array.isArray(tabsOverride)) return system
  return {
    ...system,
    tabs: Object.fromEntries(tabsOverride.map((item) => [
      item.key,
      { label: item.text, visible: item.visible, locked: item.locked },
    ])),
  }
}

function consumeStartupFallbackMarker(options = {}) {
  const fromQuery = String(options.startupFallback || '').trim() === '1'
  const app = typeof getApp === 'function' ? getApp() : null
  const marker = app?.globalData?.startupFallbackPending
  const fromApp = marker === true || (
    marker && Number(marker.expiresAt || 0) > Date.now()
  )
  if (marker && app?.globalData) app.globalData.startupFallbackPending = null
  return fromQuery || fromApp
}

Page({
  data: {
    error: '',
    fontSizeMode: 'larger',
    hero: resolveCopyText(null, 'articlesHero'),
    items: [],
    layout: 'mixed',
    sortMode: 'random',
    loading: true,
    ready: false,
    showSkeleton: false,
    ads: {},
    nativeAdHidden: false,
  },

  onLoad(options = {}) {
    this.foregroundVersion = getApp().globalData?.foregroundVersion || 0
    this.startupFallback = consumeStartupFallbackMarker(options)
    this.startupFallbackConfigRequested = false
    this.setSharedArticleTarget(options)
    const cached = getCachedArticles()
    if (cached && !this.sharedContentId) this.applyArticles(cached)
    startInitialLoad(this, Boolean(cached && !this.sharedContentId))
  },

  onShow() {
    this.setData({ fontSizeMode: getFontSizeMode() })
    const sharedTargetChanged = this.setSharedArticleTarget()
    if (consumeStartupFallbackMarker()) this.startupFallback = true
    const latest = getLatestStartupConfig()
    const tabs = latest?.tabs
    const freshStartup = latest?.source === 'fresh'
    if (freshStartup) this.startupFallback = false
    if (!this.startupFallback && !ensureVisibleTab('articles', tabs)) {
      this.handleUnavailableSharedArticle()
      return
    }
    syncCustomTabBar(this, 'articles', tabs)
    // 首次进入、真正从后台回前台和用户主动下拉刷新会重新取数并排序；
    // 从详情页、Tab、分享等普通回流时保留当前顺序。
    const app = getApp()
    const foregroundVersion = app.globalData?.foregroundVersion || 0
    const shouldRefreshAfterBackground = this.data.ready && this.foregroundVersion !== foregroundVersion
    this.foregroundVersion = foregroundVersion
    if (sharedTargetChanged) this.loadData({ force: true })
    else if (!this.data.ready || shouldRefreshAfterBackground || (this.startupFallback && !this.startupFallbackConfigRequested)) {
      if (this.startupFallback) this.startupFallbackConfigRequested = true
      this.loadData()
    }
    if (this.data.nativeAdHidden) this.setData({ nativeAdHidden: false })
    this.startInterstitialAd()
  },

  onHide() {
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  onUnload() {
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  startInterstitialAd() {
    if (this.interstitialDispose || !this.data.ready) return
    this.interstitialDispose = scheduleInterstitialAd(this.data.ads.articlesInterstitial, 'articles', {
      isIdle: () => !this.data.loading && !this.loadingMore,
    })
  },

  applyConfig(config = {}, tabsOverride, options = {}) {
    const system = getSystem(config, tabsOverride)
    const display = config.articleDisplay || system.articleDisplay || {}
    const layout = normalizeArticleLayout(display.layout)
    const sortMode = normalizeArticleSortMode(system.articlesSortMode)
    const ads = config.ads || {}
    const shareSettings = copyPack.getShareSettings()
    this.setData({
      hero: resolveCopyText(system.articlesHero, 'articlesHero'),
      layout,
      sortMode,
      ads,
      nativeAdHidden: shouldKeepNativeAdHidden({
        previousAds: this.data.ads,
        nextAds: ads,
        placement: 'articlesNative',
        hidden: this.data.nativeAdHidden,
      }),
      items: this.data.items.map((item, index) => ({ ...item, ...prepareArticleSummary(item, layout, index, shareSettings) })),
    })
    const shouldValidateTab = !this.startupFallback || options.startupSource === 'fresh'
    if (shouldValidateTab) {
      if (!ensureVisibleTab('articles', system)) {
        this.handleUnavailableSharedArticle()
        return
      }
      syncCustomTabBar(this, 'articles', system)
    }
  },

  applyArticles(data = {}, append = false) {
    const nativeAd = this.data.ads.articlesNative || {}
    const incoming = sortArticleItems(data.items || [], this.data.sortMode)
    const sourceItems = append ? [...this.data.items, ...incoming] : incoming
    const merged = mergeUniqueItems(sourceItems, this.sharedContentId)
    const items = merged.map((item, index) => prepareArticleSummary(
      item,
      this.data.layout,
      index,
      copyPack.getShareSettings(),
    ))
    this.pagination = data.pagination || this.pagination || { page: 1, totalPages: 1 }
    this.setData({
      error: '',
      items: markListAdSlots(items, nativeAd.firstAfter || 3, nativeAd.interval || 10),
      ready: true,
    })
    this.resolveSharedArticleTarget(items)
  },

  setSharedArticleTarget(options = {}) {
    const target = getSharedArticleReturnTarget()
    if (
      !target?.contentId
      || (this.sharedContentId === target.contentId && this.sharedTargetToken === target.token)
    ) return false
    this.sharedContentId = target.contentId
    this.sharedTargetToken = target.token
    this.sharedTargetGeneration = (this.sharedTargetGeneration || 0) + 1
    this.pagination = null
    if (this.data.ready) this.setData({ items: [], ready: false })
    this.scrollToSharedArticle()
    return true
  },

  scrollToSharedArticle() {
    wx.pageScrollTo?.({ scrollTop: 0, duration: 0 })
  },

  handleUnavailableSharedArticle() {
    if (!this.sharedContentId) return
    consumeSharedArticleReturnTarget(this.sharedContentId, this.sharedTargetToken)
    this.sharedContentId = ''
    this.sharedTargetToken = ''
    this.sharedTargetGeneration = (this.sharedTargetGeneration || 0) + 1
    wx.showToast({ title: '分享的内容暂时不可用', icon: 'none' })
  },

  resolveSharedArticleTarget(items = this.data.items) {
    if (!this.sharedContentId) return
    if (
      this.sharedTargetLocatedGeneration != null
      && this.sharedTargetLocatedGeneration === this.sharedTargetGeneration
    ) return
    const item = items.find((entry) => entry.id === this.sharedContentId)
    if (!item) {
      this.handleUnavailableSharedArticle()
      return
    }
    this.scrollToSharedArticle()
    consumeSharedArticleReturnTarget(this.sharedContentId, this.sharedTargetToken)
    this.sharedTargetToken = ''
    this.sharedTargetLocatedGeneration = this.sharedTargetGeneration
  },

  // 下拉刷新先复核启动配置，再刷新业务数据。
  async loadData(options = {}) {
    if (this.refreshingRequest) {
      if (!options.force) return this.refreshingRequest
      await this.refreshingRequest
      return this.loadData(options)
    }
    // Subscribe to the shared startup request without making article content
    // wait behind the startup timeout. This also covers the fast-article,
    // slow-config race on the first screen.
    const startupPromise = getStartupConfig()
      .then((result) => {
        if (result?.source === 'fresh') {
          this.startupFallback = false
          this.startupFallbackConfigRequested = false
        }
        this.applyConfig(result.config || {}, result.tabs, { startupSource: result?.source })
        return result
      })
      .catch(() => null)
    const requestedSharedContentId = this.sharedContentId
    const requestedSharedTargetToken = this.sharedTargetToken
    const requestedSharedTargetGeneration = this.sharedTargetGeneration || 0
    this.refreshingRequest = getArticles({ ...options, includeId: requestedSharedContentId })
      .then((articles) => {
        if (
          requestedSharedContentId !== this.sharedContentId
          || requestedSharedTargetToken !== this.sharedTargetToken
          || requestedSharedTargetGeneration !== (this.sharedTargetGeneration || 0)
        ) return
        const latest = getLatestStartupConfig()
        if (latest) {
          if (latest.source === 'fresh') {
            this.startupFallback = false
            this.startupFallbackConfigRequested = false
          }
          this.applyConfig(latest.config || {}, latest.tabs, { startupSource: latest.source })
        }
        this.applyArticles(articles)
      })
      .catch((error) => {
        if (
          requestedSharedContentId !== this.sharedContentId
          || requestedSharedTargetToken !== this.sharedTargetToken
          || requestedSharedTargetGeneration !== (this.sharedTargetGeneration || 0)
        ) return
        const message = requestedSharedContentId
          ? '分享的内容暂时不可用'
          : (error.message || '文章加载失败，请稍后再试')
        if (!this.data.ready) this.setData({ error: message })
        if (options.notify) wx.showToast({ title: message, icon: 'none' })
      })
      .finally(() => {
        this.refreshingRequest = null
        finishInitialLoad(this)
        this.startInterstitialAd()
      })
    return this.refreshingRequest
  },

  async onPullDownRefresh() {
    try {
      consumeSharedArticleReturnTarget(this.sharedContentId, this.sharedTargetToken)
      this.sharedContentId = ''
      this.sharedTargetToken = ''
      this.sharedTargetGeneration = (this.sharedTargetGeneration || 0) + 1
      await refreshStartupConfig().catch(() => {})
      await this.loadData({ force: true, notify: true })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  async onReachBottom() {
    const pagination = this.pagination || {}
    if (this.loadingMore || Number(pagination.page || 1) >= Number(pagination.totalPages || 1)) return
    this.loadingMore = true
    const requestedSharedContentId = this.sharedContentId
    const requestedSharedTargetToken = this.sharedTargetToken
    const requestedSharedTargetGeneration = this.sharedTargetGeneration || 0
    try {
      const data = await getArticlesPage(Number(pagination.page || 1) + 1)
      if (
        requestedSharedContentId !== this.sharedContentId
        || requestedSharedTargetToken !== this.sharedTargetToken
        || requestedSharedTargetGeneration !== (this.sharedTargetGeneration || 0)
      ) return
      this.applyArticles(data, true)
    } catch (error) {
      if (
        requestedSharedContentId !== this.sharedContentId
        || requestedSharedTargetToken !== this.sharedTargetToken
        || requestedSharedTargetGeneration !== (this.sharedTargetGeneration || 0)
      ) return
      wx.showToast({ title: error.message || '加载更多失败', icon: 'none' })
    } finally {
      this.loadingMore = false
    }
  },

  openArticle(event) {
    const contentId = String(event.currentTarget.dataset.id || '').trim()
    if (!contentId) return
    wx.navigateTo({ url: `/pages/article/article?contentId=${encodeURIComponent(contentId)}` })
  },

  handleCoverError(event) {
    const index = Number(event.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item?.coverUrl || event.currentTarget.dataset.src !== item.coverUrl) return
    this.setData({ [`items[${index}].coverUrl`]: getNextImageUrl(item.coverCandidates, item.coverUrl) })
  },

  handleNativeAdError() {
    this.setData({ nativeAdHidden: true, nativeAdReady: false })
  },

  handleNativeAdLoad() {
    this.setData({ nativeAdHidden: false, nativeAdReady: true })
  },
})
