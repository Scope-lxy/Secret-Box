const { checkIn, deletePrivateMessage, getDailyContentAvailability, getCachedHomeData, getHomeData, getRewardedAdAccess, openDailyContent, recordShareInteraction, submitPrivateMessage, toggleInteraction } = require('../../services/miniapp')
const { resolvePhoneSyncPrompt, shouldPromptForMessage, syncPhoneForMessage } = require('../../utils/message-phone-sync')
const { MESSAGE_CONTENT_LIMIT_TEXT, isMessageContentWithinLimit, normalizeMessageContent, truncateMessageContent } = require('../../utils/message-content')
const { compactNumber, splitStatValue, withInteractionDisplayCounts } = require('../../utils/format')
const { openImagePreview } = require('../../utils/image-preview')
const { splitContentParagraphs } = require('../../utils/paragraphs')
const { pickDailyCopy } = require('../../utils/daily-copy')
const {
  DEFAULT_COPY_PACK,
  pickDailyContentPrompt,
  resolveCopyText,
  splitDailyContentPrompt,
} = require('../../utils/default-copy')
const { getLatestStartupConfig, getStartupConfig, refreshStartupConfig } = require('../../utils/startup-config')
const { finishInitialLoad, startInitialLoad } = require('../../utils/page-loading')
const { createPrivateShareCard, createShareCardComposer } = require('../../utils/share-card')
const copyPack = require('../../utils/copy-pack')
const { ensureVisibleTab, syncCustomTabBar } = require('../../utils/tabs')
const { getFontSizeMode } = require('../../utils/font-mode')
const {
  resolveRewardedAdResult,
  runRewardedAd,
  scheduleInterstitialAd,
  shouldConfirmRewardedAd,
} = require('../../utils/ads')
const { shouldKeepNativeAdHidden } = require('../../utils/native-ad')
const { prepareDisplayImage, resolveDisplayImage } = require('../../utils/image-display')

const SUBSCRIPTION_ENTRY_VISIBLE = false
const SHARED_DAILY_CONTENT_TYPES = ['album', 'audio', 'text']
const HOME_ACCESS_DEADLINE_MS = 5000
const ARTICLES_FALLBACK_URL = '/pages/articles/articles'
const ARTICLES_FALLBACK_RELAUNCH_URL = `${ARTICLES_FALLBACK_URL}?startupFallback=1`
const ARTICLES_FALLBACK_MARKER_TTL_MS = 10000

function formatAudioTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function getAudioTitle(item = {}) {
  return String(item.title || '').trim()
    || String(item.originalFilename || '').trim().replace(/\.[^.]+$/, '')
    || '轻读音频'
}

function getPrivateShareFallbackImage(settings = copyPack.getShareSettings()) {
  const backgrounds = Array.isArray(settings.private?.backgrounds)
    ? settings.private.backgrounds.filter((item) => item?.enabled !== false && String(item?.imageUrl || '').trim())
    : []
  return backgrounds[0]?.imageUrl || DEFAULT_COPY_PACK.shareBackgrounds[0].imageUrl
}

function createAudioState(item = {}) {
  const durationSeconds = Math.max(0, Number(item.durationSeconds) || 0)
  return {
    currentSeconds: 0,
    currentTime: '00:00',
    duration: formatAudioTime(durationSeconds),
    durationSeconds,
    isBuffering: false,
    isPlaying: false,
    playAnimating: false,
    restartAnimating: false,
    remaining: `剩余 ${formatAudioTime(durationSeconds)}`,
    status: '点击播放',
    title: getAudioTitle(item),
    titleScrolling: false,
    titleStyle: '',
  }
}

function getAdFailureText(reward, system, configKey, packKey) {
  return reward.reason === 'incomplete'
    ? resolveCopyText(system[configKey], packKey)
    : resolveCopyText(null, 'adUnavailable')
}

function getRequestFailureText(error) {
  if (error?.kind === 'network') return resolveCopyText(null, 'networkFailure')
  if (Number(error?.statusCode) >= 500) return resolveCopyText(null, 'serviceFailure')
  return error?.message || resolveCopyText(null, 'serviceFailure')
}

function hasRewardedDailyContentAd(config = {}) {
  return Boolean(config.enabled && String(config.adUnitId || '').trim())
}

async function runConfiguredRewardedAd(placement, config = {}, options = {}) {
  if (!hasRewardedDailyContentAd(config)) return { completed: true, skipped: true }
  try {
    const access = await getRewardedAdAccess(placement)
    if (access.free) return { completed: true, skipped: true }
  } catch (error) {
    // A failed quota check falls back to the configured rewarded ad.
  }
  if (shouldConfirmRewardedAd(config, options.confirmed)) {
    return { completed: false, reason: 'confirmation-required' }
  }
  return resolveRewardedAdResult(config, await runRewardedAd(config))
}

function prepareCalendar(days = []) {
  return days.map((day) => {
    const sourceLabel = String(day.lunarLabel || '').trim()
    const lunarLabel = Array.from(sourceLabel).slice(0, 2).join('') || '—'
    return {
      ...day,
      day: String(day.date || '').split('-').pop() || '',
      lunarLabel,
    }
  })
}

function normalizeDailyContent(item = {}) {
  const type = ['album', 'audio'].includes(item.type) ? item.type : 'text'
  return withInteractionDisplayCounts({
    ...item,
    type,
    audioUrl: String(item.audioUrl || '').trim(),
    durationSeconds: Math.max(0, Number(item.durationSeconds) || 0),
    isAudio: type === 'audio',
    isText: type === 'text',
    isAlbum: type === 'album',
    images: Array.isArray(item.images) ? item.images.map((image) => ({
      ...prepareDisplayImage(image),
      displayUrl: '',
      displayLoading: true,
    })) : [],
    textParagraphs: splitContentParagraphs(item.text),
  })
}

function getPrivateShareType(type) {
  return type === 'album' ? 'image' : type === 'audio' ? 'audio' : 'text'
}

function getPrivateShareCardKey(type, item = null) {
  const contentId = type === 'image' ? String(item?.id || '').trim() : ''
  return contentId ? `${type}:${contentId}` : type
}

const HOME_SHARE_TYPE_ORDER = ['text', 'audio', 'album']

function getHomeShareDailyContentTypes(dailyContentTypes) {
  if (dailyContentTypes && typeof dailyContentTypes === 'object' && Object.keys(dailyContentTypes).length) return dailyContentTypes
  const startupTypes = getLatestStartupConfig()?.config?.dailyContentTypes
  return startupTypes && typeof startupTypes === 'object' && Object.keys(startupTypes).length ? startupTypes : null
}

function getNextHomeShareType(dailyContentTypes, startIndex = 0) {
  const availableTypes = ['text']
  if (dailyContentTypes && dailyContentTypes.imageEnabled !== false) availableTypes.push('album')
  if (dailyContentTypes?.audioEnabled === true) availableTypes.push('audio')
  for (let offset = 0; offset < HOME_SHARE_TYPE_ORDER.length; offset += 1) {
    const index = (startIndex + offset) % HOME_SHARE_TYPE_ORDER.length
    const type = HOME_SHARE_TYPE_ORDER[index]
    if (availableTypes.includes(type)) {
      return { type, nextIndex: (index + 1) % HOME_SHARE_TYPE_ORDER.length }
    }
  }
}

function getSharedDailyContentTarget(options = {}) {
  const type = String(options.type || '').trim()
  if (!SHARED_DAILY_CONTENT_TYPES.includes(type)) return null
  return { type, contentId: String(options.contentId || '').trim() }
}

Page({
  data: {
    currentAlbumIndex: 0,
    fontSizeMode: 'larger',
    homeAccessResolved: false,
    homeHeroText: DEFAULT_COPY_PACK.homeHero[0],
    loading: true,
    showSkeleton: false,
    error: '',
    system: {},
    stats: [],
    ads: {},
    dailyContentTypes: {},
    messagesEnabled: false,
    nativeAdHidden: false,
    nativeAdReady: false,
    dailyContent: null,
    dailyContentLoading: false,
    sharedDailyContentChecking: false,
    checkinLoading: false,
    checkinBeforeText: DEFAULT_COPY_PACK.checkinBefore[0],
    checkinAfterText: DEFAULT_COPY_PACK.checkinAfter[0],
    checkinRewardValue: 0,
    checkInState: {},
    calendarDays: [],
    messageText: '',
    dailyContentMessage: '',
    dailyContentMessageVisible: false,
    messageSubmitting: false,
    messageDeleting: false,
    phoneSyncPromptVisible: false,
    phoneSyncAuthorizing: false,
    liked: false,
    favorited: false,
    showDailyContentSubscribe: false,
    showCheckinSubscribe: false,
    dailyContentSubscribePrompt: null,
    checkinSubscribePrompt: null,
    dailyContentPrompt: splitDailyContentPrompt(),
    audio: createAudioState(),
    audioTicks: Array.from({ length: 11 }, (_, index) => ({ id: index, long: index % 2 === 0 })),
  },

  onLoad(options = {}) {
    this.privateShareCards = {}
    this.privateShareCardsReady = false
    this.privateShareCardsVersion = 0
    this.privateShareWarmQueued = false
    this.albumImageLoads = new Map()
    this.albumImageQueue = []
    this.homeShareTypeIndex = 0
    this.pendingSharedDailyContentType = ''
    this.pendingSharedDailyContentId = ''
    this.sharedDailyContentTargetVersion = 0
    this.lastSharedHomeEntryVersion = 0
    this.sharedDailyContentOpeningTargetVersion = 0
    this.sharedDailyContentPreflightPromise = null
    this.sharedDailyContentPreflightResult = null
    this.homeAccessDeadlineTimer = null
    this.homeAccessDeadlineExpired = false
    this.homeAccessDeadlinePromise = null
    this.homeAccessDeadlineResolve = null
    this.homeAccessNavigationStarted = false
    this.startHomeAccessDeadline()
    if (!this.consumeSharedDailyContentEntry()) this.setSharedDailyContentTarget(getSharedDailyContentTarget(options))
    const cached = getCachedHomeData()
    if (cached) this.applyHomeData(cached, { deferTabAccess: true })
    startInitialLoad(this, Boolean(cached))
    this.setupAudioContext()
  },

  onReady() {
    this.shareCardComposer = createShareCardComposer(this)
  },

  onShow() {
    this.consumeSharedDailyContentEntry()
    this.setData({ fontSizeMode: getFontSizeMode() })
    if (this.homeAccessNavigationStarted) return
    if (!this.data.homeAccessResolved) {
      this.resolveHomeAccess()
      return
    }
    const latest = getLatestStartupConfig()
    const homeVisible = latest?.source === 'fresh'
      && latest.tabs?.some((item) => item.key === 'home' && item.visible)
    if (!homeVisible) {
      this.setData({ homeAccessResolved: false })
      this.clearHomeAccessDeadline()
      ensureVisibleTab('home', latest?.tabs)
      return
    }
    if (!ensureVisibleTab('home', latest.tabs)) return
    this.interstitialBlockedByExternalUi = false
    syncCustomTabBar(this, 'home', latest.tabs)
    this.loadHomeData()
    if (this.data.nativeAdHidden) this.setData({ nativeAdHidden: false })
    this.startInterstitialAd()
  },

  isCurrentPage() {
    const pages = getCurrentPages()
    return Boolean(pages.length && pages[pages.length - 1] === this)
  },

  startHomeAccessDeadline(delayMs) {
    if (this.homeAccessDeadlineTimer || this.homeAccessDeadlineExpired || this.homeAccessNavigationStarted) return
    const parsedDelay = Number(delayMs)
    const deadline = Number.isFinite(parsedDelay) ? Math.max(0, parsedDelay) : HOME_ACCESS_DEADLINE_MS
    this.homeAccessDeadlineTimer = setTimeout(() => {
      this.homeAccessDeadlineTimer = null
      this.homeAccessDeadlineExpired = true
      if (!this.data.homeAccessResolved && this.isCurrentPage()) this.navigateToArticlesFallback()
      this.resolveHomeAccessDeadlineWait(false)
    }, deadline)
  },

  resolveHomeAccessDeadlineWait(value = false) {
    const resolve = this.homeAccessDeadlineResolve
    this.homeAccessDeadlineResolve = null
    this.homeAccessDeadlinePromise = null
    if (resolve) resolve(value)
  },

  waitForHomeAccessDeadline() {
    if (this.homeAccessNavigationStarted || this.data.homeAccessResolved) return Promise.resolve(false)
    if (this.homeAccessDeadlineExpired) {
      this.navigateToArticlesFallback()
      return Promise.resolve(false)
    }
    if (!this.homeAccessDeadlinePromise) {
      this.homeAccessDeadlinePromise = new Promise((resolve) => {
        this.homeAccessDeadlineResolve = resolve
      })
    }
    return this.homeAccessDeadlinePromise
  },

  clearHomeAccessDeadline() {
    clearTimeout(this.homeAccessDeadlineTimer)
    this.homeAccessDeadlineTimer = null
    this.homeAccessDeadlineExpired = false
    this.resolveHomeAccessDeadlineWait(false)
  },

  navigateToArticlesFallback() {
    if (this.homeAccessNavigationStarted || this.data.homeAccessResolved) return false
    this.homeAccessNavigationStarted = true
    this.clearHomeAccessDeadline()
    const app = typeof getApp === 'function' ? getApp() : null
    if (app?.globalData) {
      app.globalData.startupFallbackPending = { expiresAt: Date.now() + ARTICLES_FALLBACK_MARKER_TTL_MS }
    }

    let relaunched = false
    let fallbackStarted = false
    const switchTabFallback = () => {
      if (relaunched || fallbackStarted) return
      fallbackStarted = true
      try {
        if (typeof wx.switchTab === 'function') wx.switchTab({ url: ARTICLES_FALLBACK_URL })
      } catch (error) {}
    }
    if (typeof wx.reLaunch !== 'function') {
      switchTabFallback()
      return false
    }
    try {
      wx.reLaunch({
        url: ARTICLES_FALLBACK_RELAUNCH_URL,
        success: () => { relaunched = true },
        fail: switchTabFallback,
        // Treat a complete-only reLaunch as failed so the gate cannot remain
        // visible when a base library drops the success/fail callback.
        complete: () => { if (!relaunched) switchTabFallback() },
      })
    } catch (error) {
      switchTabFallback()
    }
    return false
  },

  resolveHomeAccess(options = {}) {
    const force = options.force === true
    const retryDegraded = options.retryDegraded !== false
    this.startHomeAccessDeadline(options.deadlineMs)
    if (this.homeAccessNavigationStarted) return Promise.resolve(false)
    if (this.homeAccessDeadlineExpired) {
      const latest = getLatestStartupConfig()
      const homeVisible = latest?.source === 'fresh'
        && latest.tabs?.some((item) => item.key === 'home' && item.visible)
      if (!homeVisible) {
        this.navigateToArticlesFallback()
        return Promise.resolve(false)
      }
      this.clearHomeAccessDeadline()
    }
    if (this.homeAccessPromise && !force) return this.homeAccessPromise
    // force 时消费新请求的 promise；统一服务在重取期间会让普通调用等待新答案
    const handleResult = (result) => {
      if (this.homeAccessNavigationStarted) return false
      // 启动配置可能在页面生命周期之间返回：等页面回到栈顶再重试，避免门锁死。
      if (!this.isCurrentPage()) {
        clearTimeout(this.homeAccessRetryTimer)
        this.homeAccessRetryTimer = setTimeout(() => {
          this.homeAccessRetryTimer = null
          if (this.isCurrentPage() && !this.data.homeAccessResolved) this.onShow()
        }, 0)
        return false
      }
      // Home is opt-in. Only a fresh server answer may open it; cache and
      // safe defaults always land on the first visible tab while offline.
      if (result.source !== 'fresh') {
        return this.waitForHomeAccessDeadline()
      }
      this.clearHomeAccessDeadline()
      if (!ensureVisibleTab('home', result.tabs)) return false
      this.openStartupGate(result.tabs)
      return true
    }
    const accessPromise = getStartupConfig({ force })
      .then((result) => {
        // 网络抖动时只额外重取一次；每次请求自身有 2 秒超时，避免启动门无限等待。
        if (result.source !== 'fresh' && retryDegraded) {
          return getStartupConfig({ force: true }).then(handleResult)
        }
        return handleResult(result)
      })
      .finally(() => {
        if (this.homeAccessPromise !== accessPromise) return
        this.homeAccessPromise = null
      })
    this.homeAccessPromise = accessPromise
    return accessPromise
  },

  openStartupGate(tabs) {
    if (this.homeAccessNavigationStarted) return
    this.clearHomeAccessDeadline()
    syncCustomTabBar(this, 'home', tabs)
    this.setData({ homeAccessResolved: true }, () => {
      if (this.isCurrentPage()) this.onShow()
    })
  },

  onHide() {
    this.pauseAudioPlayback()
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  onUnload() {
    clearTimeout(this.homeAccessRetryTimer)
    this.homeAccessRetryTimer = null
    this.clearHomeAccessDeadline()
    clearTimeout(this.audioPlayAnimationTimer)
    clearTimeout(this.audioRestartAnimationTimer)
    this.destroyAudioContext()
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  startInterstitialAd(config = this.data.ads.homeInterstitial) {
    if (this.interstitialBlockedByExternalUi || this.interstitialDispose) return
    this.interstitialDispose = scheduleInterstitialAd(config, 'home', {
      isIdle: () => !this.data.loading
        && !this.refreshing
        && !this.data.dailyContentLoading
        && !this.data.sharedDailyContentChecking
        && !this.data.checkinLoading
        && !this.data.dailyContentMessageVisible
        && !this.data.messageSubmitting
        && !this.data.messageDeleting
        && !this.data.phoneSyncPromptVisible
        && !this.data.phoneSyncAuthorizing
        && !this.interstitialModalVisible
        && !this.interactionLoading
        && !this.subscriptionRequesting,
    })
  },

  pauseInterstitialUntilNextShow() {
    this.interstitialBlockedByExternalUi = true
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  onResize() {
    if (this.data.dailyContent?.isAudio) this.syncAudioTitleScroll()
  },

  applyHomeData(data, options = {}) {
    const startup = getLatestStartupConfig()
    const navigationTabs = Array.isArray(startup?.tabs) ? startup.tabs : (data.system || {})
    if (!options.deferTabAccess && !ensureVisibleTab('home', navigationTabs)) {
      this.setData({ homeAccessResolved: false })
      return
    }
    const dailyContentPrompt = pickDailyContentPrompt(copyPack.getCopyList('dailyContentPrompt'), this.lastDailyContentPromptText)
    const ads = data.ads || {}
    const homeNativePlacement = ads.homeNative.placement
    const checkinBeforeText = pickDailyCopy({
      values: copyPack.getCopyList('checkinBefore'),
      defaults: DEFAULT_COPY_PACK.checkinBefore,
      storageKey: 'daily-copy-checkin-before',
    })
    const checkinAfterText = pickDailyCopy({
      values: copyPack.getCopyList('checkinAfter'),
      defaults: DEFAULT_COPY_PACK.checkinAfter,
      storageKey: 'daily-copy-checkin-after',
    })
    this.lastDailyContentPromptText = dailyContentPrompt.text
    const system = data.system || {}
    if (!options.deferTabAccess) syncCustomTabBar(this, 'home', navigationTabs)
    this.setData({
      error: '',
      system,
      // 结构性文案的默认值统一收在 default-copy：页面/wxml 不再各自写死
      homeHeroText: resolveCopyText(system.homeHero, 'homeHero'),
      dailyContentButtonText: resolveCopyText(system.dailyContentButtonText, 'dailyContentButtonText'),
      checkinButtonText: resolveCopyText(system.checkinButtonText, 'checkinButtonText'),
      dailyContentPrompt,
      checkinBeforeText,
      checkinAfterText,
      checkinRewardValue: Math.max(0, Number(data.companionValueRewards?.checkin) || 0),
      stats: (data.stats || []).map(splitStatValue),
      ads,
      homeNativePlacement,
      dailyContentTypes: data.dailyContentTypes || {},
      messagesEnabled: data.messagesEnabled === true,
      nativeAdHidden: shouldKeepNativeAdHidden({
        previousAds: this.data.ads,
        nextAds: ads,
        placement: 'homeNative',
        hidden: this.data.nativeAdHidden,
      }) && homeNativePlacement === this.data.homeNativePlacement,
      checkInState: data.checkIn || {},
      calendarDays: prepareCalendar(data.calendarDays || []),
    })
    this.privateShareCards = {}
    this.privateShareCardsReady = false
    this.privateShareCardsVersion += 1
  },

  async prepareNextPrivateShareCard(type, item = null) {
    if (!this.shareCardComposer || !this.privateShareCardsReady) return
    const version = this.privateShareCardsVersion
    try {
      const card = await createPrivateShareCard(this.shareCardComposer, {
        type,
        item,
        settings: copyPack.getShareSettings(),
      })
      if (version !== this.privateShareCardsVersion) return
      this.privateShareCards[getPrivateShareCardKey(type, item)] = card
    } catch (error) {
      // The current prepared card remains available when a refresh fails.
    }
  },

  // Keep share settings ready without generating image cards during page load.
  async warmPrivateShareCards(settings) {
    this.shareCardComposerSettings = settings
    this.privateShareCardTypes = ['text', 'image', 'audio']
    this.privateShareWarmQueued = true
    this.privateShareCardsReady = false
    const version = this.privateShareCardsVersion
    // The first general share must have a real composed template available.
    // Generate only the initial text card here; other types are generated on
    // demand so entering the home page does not allocate three large images.
    const warmRequest = createPrivateShareCard(this.shareCardComposer, {
      type: 'text',
      settings,
    }).then((card) => {
      if (version !== this.privateShareCardsVersion) return card
      this.privateShareCards.text = card
      this.privateShareCardsReady = true
      return card
    }).catch(() => {
      // A canvas or image failure keeps the documented text-only fallback.
      return null
    }).finally(() => {
      if (this.privateShareWarmRequest === warmRequest) this.privateShareWarmRequest = null
    })
    this.privateShareWarmRequest = warmRequest
    return warmRequest
  },

  async loadHomeData(options = {}) {
    try {
      const data = await getHomeData(options)
      this.applyHomeData(data)
      await this.warmPrivateShareCards(copyPack.getShareSettings())
      this.preflightSharedDailyContent()
      this.startInterstitialAd(data.ads?.homeInterstitial)
    } catch (error) {
      const message = error.message || '首页数据加载失败'
      if (!Object.keys(this.data.system).length) this.setData({ error: message })
      if (options.notify) wx.showToast({ title: message, icon: 'none' })
    } finally {
      finishInitialLoad(this)
    }
  },

  async onPullDownRefresh() {
    this.refreshing = true
    try {
      await refreshStartupConfig().catch(() => {})
      const latest = getLatestStartupConfig()
      const homeVisible = latest?.source === 'fresh'
        && latest.tabs?.some((item) => item.key === 'home' && item.visible)
      if (!homeVisible) {
        this.setData({ homeAccessResolved: false })
        ensureVisibleTab('home', latest?.tabs)
        return
      }
      await this.loadHomeData({ force: true, notify: true })
    } finally {
      this.refreshing = false
      wx.stopPullDownRefresh()
    }
  },

  handleNativeAdError() {
    this.setData({ nativeAdHidden: true, nativeAdReady: false })
  },

  handleNativeAdLoad() {
    this.setData({ nativeAdHidden: false, nativeAdReady: true })
  },

  handleDailyContentPrimaryAction() {
    if (this.pendingSharedDailyContentType) {
      this.openSharedDailyContent()
      return
    }
    this.handleOpenDailyContent()
  },

  getCurrentSharedDailyContentTarget() {
    if (!this.pendingSharedDailyContentType) return null
    return {
      type: this.pendingSharedDailyContentType,
      contentId: this.pendingSharedDailyContentId,
      version: this.sharedDailyContentTargetVersion,
    }
  },

  isCurrentSharedDailyContentTarget(target) {
    return Boolean(target
      && this.pendingSharedDailyContentType === target.type
      && this.pendingSharedDailyContentId === target.contentId
      && this.sharedDailyContentTargetVersion === target.version)
  },

  setSharedDailyContentTarget(target) {
    if (target) this.dailyContentOpenOperationVersion = (this.dailyContentOpenOperationVersion || 0) + 1
    this.sharedDailyContentTargetVersion = (this.sharedDailyContentTargetVersion || 0) + 1
    this.pendingSharedDailyContentType = target?.type || ''
    this.pendingSharedDailyContentId = target?.contentId || ''
    this.sharedDailyContentPreflightPromise = null
    this.sharedDailyContentPreflightResult = null
  },

  resetOpenedDailyContentForSharedTarget() {
    this.pauseAudioPlayback()
    this.resetAudioPlayback()
    this.setData({
      dailyContent: null,
      dailyContentLoading: false,
      sharedDailyContentChecking: false,
      dailyContentMessage: '',
      dailyContentMessageVisible: false,
      messageText: '',
      messageSubmitting: false,
      messageDeleting: false,
      phoneSyncPromptVisible: false,
      phoneSyncAuthorizing: false,
      liked: false,
      favorited: false,
      showDailyContentSubscribe: false,
      dailyContentSubscribePrompt: null,
    })
  },

  clearSharedDailyContentTarget(target) {
    if (target && !this.isCurrentSharedDailyContentTarget(target)) return false
    this.setSharedDailyContentTarget(null)
    return true
  },

  consumeSharedDailyContentEntry() {
    const app = typeof getApp === 'function' ? getApp() : null
    const entry = app?.globalData?.pendingSharedHomeEntry
    if (!entry || Number(entry.version || 0) <= Number(this.lastSharedHomeEntryVersion || 0)) return false
    const target = getSharedDailyContentTarget(entry)
    this.lastSharedHomeEntryVersion = Number(entry.version || 0)
    if (!target) return false
    this.setSharedDailyContentTarget(target)
    this.resetOpenedDailyContentForSharedTarget()
    app.consumeSharedHomeEntry?.(entry.version)
    return true
  },

  preflightSharedDailyContent(target = this.getCurrentSharedDailyContentTarget()) {
    if (!target) return null
    if (this.isCurrentSharedDailyContentTarget(this.sharedDailyContentPreflightResult?.target)) {
      return Promise.resolve(this.sharedDailyContentPreflightResult)
    }
    if (this.isCurrentSharedDailyContentTarget(this.sharedDailyContentPreflightTarget)) {
      return this.sharedDailyContentPreflightPromise
    }
    let preflightPromise
    this.sharedDailyContentPreflightTarget = target
    preflightPromise = getDailyContentAvailability({ type: target.type, contentId: target.contentId })
      .then((availability) => {
        const result = { availability, target }
        if (this.isCurrentSharedDailyContentTarget(target)) this.sharedDailyContentPreflightResult = result
        return result
      })
      .catch((error) => {
        const result = { error, target }
        if (this.isCurrentSharedDailyContentTarget(target)) this.sharedDailyContentPreflightResult = result
        return result
      })
      .finally(() => {
        if (this.sharedDailyContentPreflightPromise === preflightPromise) {
          this.sharedDailyContentPreflightPromise = null
          this.sharedDailyContentPreflightTarget = null
        }
      })
    this.sharedDailyContentPreflightPromise = preflightPromise
    return preflightPromise
  },

  handleSharedDailyContentPreflight(target, availability) {
    if (!this.isCurrentSharedDailyContentTarget(target)) return
    if (!availability.available) {
      this.interstitialModalVisible = true
      wx.showModal({
        title: '内容暂时无法打开',
        content: '可随机打开另一份',
        cancelText: '暂不',
        confirmText: '随机打开',
        success: (res) => {
          if (!res.confirm || !this.isCurrentSharedDailyContentTarget(target)) return
          const fallbackAvailable = Boolean(availability.fallbackAvailable)
          if (!fallbackAvailable) {
            wx.showToast({ title: '暂时没有可打开的手记', icon: 'none' })
            return
          }
          this.clearSharedDailyContentTarget(target)
          this.handleOpenDailyContent('random', '', { rewardedConfirmed: true })
        },
        complete: () => { this.interstitialModalVisible = false },
      })
      return
    }
    this.handleOpenDailyContent(target.type, '', {
      contentId: target.contentId,
      randomAvailabilityConfirmed: !target.contentId,
      sharedTarget: true,
      sharedDailyContentTarget: target,
    })
  },

  async openSharedDailyContent() {
    const target = this.getCurrentSharedDailyContentTarget()
    if (!target || this.data.dailyContentLoading) return
    if (this.data.sharedDailyContentChecking && this.sharedDailyContentOpeningTargetVersion === target.version) return
    const cached = this.sharedDailyContentPreflightResult
    if (cached?.availability && this.isCurrentSharedDailyContentTarget(cached.target)) {
      this.handleSharedDailyContentPreflight(target, cached.availability)
      return
    }
    if (cached?.error && this.isCurrentSharedDailyContentTarget(cached.target)) this.sharedDailyContentPreflightResult = null
    this.sharedDailyContentOpeningTargetVersion = target.version
    this.setData({ sharedDailyContentChecking: true })
    try {
      const result = await this.preflightSharedDailyContent(target)
      if (!this.isCurrentSharedDailyContentTarget(target)) return
      this.setData({ sharedDailyContentChecking: false }, () => {
        if (result?.availability) this.handleSharedDailyContentPreflight(target, result.availability)
        else wx.showToast({ title: getRequestFailureText(result?.error), icon: 'none' })
      })
    } catch (error) {
      if (!this.isCurrentSharedDailyContentTarget(target)) return
      this.setData({ sharedDailyContentChecking: false }, () => {
        wx.showToast({ title: getRequestFailureText(error), icon: 'none' })
      })
    } finally {
      if (this.sharedDailyContentOpeningTargetVersion === target.version) this.sharedDailyContentOpeningTargetVersion = 0
    }
  },

  preventPhoneSyncPromptScroll() {},

  async handleOpenDailyContent(type = 'random', excludeId = '', options = {}) {
    if (this.data.dailyContentLoading || this.data.sharedDailyContentChecking) return
    const sharedTarget = options.sharedDailyContentTarget || null
    if (sharedTarget && !this.isCurrentSharedDailyContentTarget(sharedTarget)) return
    const sharedTargetVersion = this.sharedDailyContentTargetVersion || 0
    const operationVersion = (this.dailyContentOpenOperationVersion || 0) + 1
    this.dailyContentOpenOperationVersion = operationVersion
    const isCurrentOperation = () => this.dailyContentOpenOperationVersion === operationVersion
    const canContinueOpening = () => isCurrentOperation()
      && (sharedTarget
        ? this.isCurrentSharedDailyContentTarget(sharedTarget)
        : this.sharedDailyContentTargetVersion === sharedTargetVersion)
    this.setData({ dailyContentLoading: true })
    try {
      const requestType = typeof type === 'string' ? type : 'random'
      if (!options.contentId && options.randomAvailabilityConfirmed !== true) {
        const availability = await getDailyContentAvailability({ type: requestType, excludeId })
        if (!canContinueOpening()) return
        if (!availability.available) {
          wx.showToast({ title: '暂无可打开内容', icon: 'none' })
          return
        }
      }
      const reward = await runConfiguredRewardedAd('daily_content', this.data.ads.homeDailyContentRewarded, {
        confirmed: options.rewardedConfirmed === true,
      })
      if (!canContinueOpening()) return
      if (reward.reason === 'confirmation-required') {
        this.interstitialModalVisible = true
        wx.showModal({
          title: '观看广告',
          content: excludeId
            ? resolveCopyText(null, 'changeDailyContentConfirm')
            : resolveCopyText(null, 'openDailyContentConfirm'),
          cancelText: '暂不',
          confirmText: '去观看',
          success: (res) => {
            if (res.confirm && canContinueOpening()) {
              this.handleOpenDailyContent(requestType, excludeId, {
                rewardedConfirmed: true,
                contentId: options.contentId || '',
                randomAvailabilityConfirmed: true,
                sharedTarget: options.sharedTarget === true,
                sharedDailyContentTarget: sharedTarget,
              })
            }
          },
          complete: () => { this.interstitialModalVisible = false },
        })
        return
      }
      if (!reward.completed) {
        wx.showToast({
          title: getAdFailureText(reward, this.data.system, 'dailyContentAdIncompleteText', 'dailyContentAdIncomplete'),
          icon: 'none',
          duration: 3000,
        })
        return
      }
      if (!canContinueOpening()) return
      const data = await openDailyContent({
        type: requestType,
        excludeId,
        contentId: options.contentId || '',
      })
      if (!canContinueOpening()) return
      const dailyContent = normalizeDailyContent(data.dailyContent)
      this.setData({
        dailyContent,
        currentAlbumIndex: 0,
        dailyContentMessage: dailyContent.myMessage || '',
        dailyContentMessageVisible: false,
        messageText: '',
        liked: Boolean(dailyContent.liked),
        favorited: Boolean(dailyContent.favorited),
        showDailyContentSubscribe: SUBSCRIPTION_ENTRY_VISIBLE && Boolean(data.subscribePrompt && data.subscribePrompt.enabled),
        dailyContentSubscribePrompt: SUBSCRIPTION_ENTRY_VISIBLE ? data.subscribePrompt || null : null,
      }, () => {
        if (dailyContent.isAudio) this.resetAudioPlayer(dailyContent)
        else this.resetAudioPlayback()
        if (dailyContent.isAlbum) this.loadAlbumImage(dailyContent.id, 0)
      })
      if (options.sharedTarget) {
        this.clearSharedDailyContentTarget(sharedTarget)
      }
    } catch (error) {
      if (isCurrentOperation()) wx.showToast({ title: getRequestFailureText(error), icon: 'none' })
    } finally {
      if (isCurrentOperation()) this.setData({ dailyContentLoading: false })
    }
  },

  handleChangeDailyContent() {
    this.pauseAudioPlayback()
    this.handleOpenDailyContent('random', this.data.dailyContent && this.data.dailyContent.id)
  },

  async handleCheckIn(options = {}) {
    if (this.data.checkinLoading) return
    this.setData({ checkinLoading: true })
    try {
      const reward = await runConfiguredRewardedAd('checkin', this.data.ads.homeCheckInRewarded, {
        confirmed: options.rewardedConfirmed === true,
      })
      if (reward.reason === 'confirmation-required') {
        this.interstitialModalVisible = true
        wx.showModal({
          title: '观看广告',
          content: resolveCopyText(null, 'checkinAdConfirm'),
          cancelText: '暂不',
          confirmText: '去观看',
          success: (res) => {
            if (res.confirm) this.handleCheckIn({ rewardedConfirmed: true })
          },
          complete: () => { this.interstitialModalVisible = false },
        })
        return
      }
      if (!reward.completed) {
        wx.showToast({
          title: getAdFailureText(reward, this.data.system, 'checkinAdIncompleteText', 'checkinAdIncomplete'),
          icon: 'none',
          duration: 3000,
        })
        return
      }
      const data = await checkIn()
      this.setData({
        checkInState: data.checkIn || {},
        calendarDays: prepareCalendar(data.calendarDays || this.data.calendarDays),
        showCheckinSubscribe: SUBSCRIPTION_ENTRY_VISIBLE && Boolean(data.subscribePrompt && data.subscribePrompt.enabled),
        checkinSubscribePrompt: SUBSCRIPTION_ENTRY_VISIBLE ? data.subscribePrompt || null : null,
      })
      wx.showToast({ title: '打卡成功', icon: 'none' })
      this.refreshHomeStats()
    } catch (error) {
      wx.showToast({ title: getRequestFailureText(error), icon: 'none' })
    } finally {
      this.setData({ checkinLoading: false })
    }
  },

  async refreshHomeStats() {
    const cached = getCachedHomeData()
    if (cached?.stats) this.setData({ stats: cached.stats.map(splitStatValue) })
  },

  async toggleLike() {
    await this.toggleDailyContentInteraction('like')
  },

  async toggleFavorite() {
    await this.toggleDailyContentInteraction('favorite')
  },

  async toggleDailyContentInteraction(type) {
    const dailyContent = this.data.dailyContent
    if (!dailyContent?.id) return
    this.interactionLoading = true
    try {
      const data = await toggleInteraction({
        source: 'daily_content',
        sourceId: dailyContent.id,
        type,
        desiredState: type === 'like' ? !this.data.liked : !this.data.favorited,
      })
      const interaction = data.interaction || {}
      const nextLikeCount = Number.isFinite(Number(interaction.likeCount)) ? interaction.likeCount : dailyContent.likeCount
      const nextFavoriteCount = Number.isFinite(Number(interaction.favoriteCount)) ? interaction.favoriteCount : dailyContent.favoriteCount
      this.setData({
        liked: interaction.liked === undefined ? this.data.liked : Boolean(interaction.liked),
        favorited: interaction.favorited === undefined ? this.data.favorited : Boolean(interaction.favorited),
        'dailyContent.likeCount': nextLikeCount,
        'dailyContent.favoriteCount': nextFavoriteCount,
        'dailyContent.displayLikeCount': Number(nextLikeCount) > 0 ? compactNumber(nextLikeCount) : '',
        'dailyContent.displayFavoriteCount': Number(nextFavoriteCount) > 0 ? compactNumber(nextFavoriteCount) : '',
      })
      if (type === 'favorite') {
        wx.showToast({ title: data.queued ? '已保存，联网后同步' : interaction.favorited ? '已收藏' : '已取消收藏', icon: 'none' })
      }
      this.refreshHomeStats()
    } catch (error) {
      wx.showToast({ title: error.message || '互动失败', icon: 'none' })
    } finally {
      this.interactionLoading = false
    }
  },

  toggleDailyContentMessage() {
    this.setData({ dailyContentMessageVisible: !this.data.dailyContentMessageVisible })
  },

  handleMessageInput(event) {
    const value = truncateMessageContent(event.detail.value)
    this.setData({ messageText: value })
    if (value !== event.detail.value) wx.showToast({ title: MESSAGE_CONTENT_LIMIT_TEXT, icon: 'none' })
    return value
  },

  async handleSubmitMessage() {
    if (this.data.messageSubmitting || this.data.messageDeleting) return
    const content = normalizeMessageContent(this.data.messageText)
    if (!content) {
      wx.showToast({ title: '先写一句悄悄话', icon: 'none' })
      return
    }
    if (!isMessageContentWithinLimit(content)) {
      wx.showToast({ title: MESSAGE_CONTENT_LIMIT_TEXT, icon: 'none' })
      return
    }
    if (shouldPromptForMessage()) {
      this.pendingMessage = { content }
      this.setData({ phoneSyncPromptVisible: true })
      return
    }
    await this.submitMessage(content)
  },

  async submitMessage(content) {
    this.setData({ messageSubmitting: true })
    try {
      const data = await submitPrivateMessage({
        source: 'daily_content',
        sourceId: this.data.dailyContent && this.data.dailyContent.id,
        content,
      })
      this.setData({ dailyContentMessage: content, messageText: '', dailyContentMessageVisible: false })
      wx.showToast({ title: data.queued ? '已保存，联网后送达' : '已经悄悄送达', icon: 'none' })
      this.refreshHomeStats()
    } catch (error) {
      wx.showToast({ title: error.message || '留言失败', icon: 'none' })
    } finally {
      this.setData({ messageSubmitting: false })
    }
  },

  async handlePhoneSyncAuthorize(event) {
    if (this.data.phoneSyncAuthorizing || !this.pendingMessage) return
    if (!String(event.detail?.code || '').trim()) {
      wx.showToast({ title: '手机号快捷登录未完成', icon: 'none' })
      return
    }
    this.setData({ phoneSyncAuthorizing: true })
    try {
      const authorized = await syncPhoneForMessage(event)
      if (!authorized || !this.pendingMessage) return
      const { content } = this.pendingMessage
      this.pendingMessage = null
      this.setData({ phoneSyncPromptVisible: false })
      await this.submitMessage(content)
    } catch (error) {
      wx.showToast({ title: error.message || '手机号获取失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ phoneSyncAuthorizing: false })
    }
  },

  async handlePhoneSyncDecline() {
    if (this.data.phoneSyncAuthorizing || !this.pendingMessage) return
    const { content } = this.pendingMessage
    this.pendingMessage = null
    resolvePhoneSyncPrompt()
    this.setData({ phoneSyncPromptVisible: false })
    await this.submitMessage(content)
  },

  async handleDeleteMessage() {
    const dailyContent = this.data.dailyContent
    if (this.data.messageSubmitting || this.data.messageDeleting || !this.data.dailyContentMessage || !dailyContent?.id) return
    const sourceId = dailyContent.id
    this.setData({ messageDeleting: true })
    try {
      const data = await deletePrivateMessage({ source: 'daily_content', sourceId })
      if (this.data.dailyContent?.id === sourceId) {
        this.setData({ dailyContentMessage: '', dailyContentMessageVisible: false, messageText: '' })
        this.refreshHomeStats()
      }
      wx.showToast({ title: data.queued ? '已删除，联网后同步' : '已删除', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '删除留言失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ messageDeleting: false })
    }
  },

  loadAlbumImage(contentId, index, options = {}) {
    const image = this.data.dailyContent?.images?.[index]
    if (!contentId || !image || image.displayUrl || !image.displayLoading) return
    const key = `${contentId}:${index}`
    if (this.albumImageLoads?.has(key)) return
    if (!options.prefetch) this.albumImageQueue = this.albumImageQueue.filter((entry) => !entry.prefetch)
    if (this.albumImageQueue.some((entry) => entry.key === key)) return
    const entry = { contentId, index, key, prefetch: Boolean(options.prefetch) }
    if (entry.prefetch) this.albumImageQueue.push(entry)
    else this.albumImageQueue.unshift(entry)
    this.drainAlbumImageQueue()
  },

  drainAlbumImageQueue() {
    while (this.albumImageLoads?.size < 3 && this.albumImageQueue?.length) {
      const entry = this.albumImageQueue.shift()
      const image = this.data.dailyContent?.images?.[entry.index]
      if (this.data.dailyContent?.id !== entry.contentId || !image || image.displayUrl || !image.displayLoading) continue
      const load = resolveDisplayImage(image).then((url) => {
        if (this.data.dailyContent?.id !== entry.contentId || this.data.dailyContent?.images?.[entry.index]?.displayUrl) return
        this.setData({
          [`dailyContent.images[${entry.index}].displayUrl`]: url,
          // Keep the neutral cover in place until the image element reports bindload.
          [`dailyContent.images[${entry.index}].displayLoading`]: Boolean(url),
        })
      }).catch(() => {
        if (this.data.dailyContent?.id === entry.contentId) this.setData({ [`dailyContent.images[${entry.index}].displayLoading`]: false })
      }).finally(() => {
        this.albumImageLoads?.delete(entry.key)
        this.drainAlbumImageQueue()
      })
      this.albumImageLoads.set(entry.key, load)
    }
  },

  preloadAlbumNeighbors(contentId, index) {
    ;[index - 1, index + 1].forEach((nearbyIndex) => this.loadAlbumImage(contentId, nearbyIndex, { prefetch: true }))
  },

  handleAlbumImageLoad(event) {
    const index = Number(event.currentTarget.dataset.index)
    const item = this.data.dailyContent?.images?.[index]
    if (!item?.displayUrl || event.currentTarget.dataset.src !== item.displayUrl) return
    this.setData({ [`dailyContent.images[${index}].displayLoading`]: false })
    this.preloadAlbumNeighbors(this.data.dailyContent?.id, index)
  },

  async saveAlbumOriginals() {
    const images = (this.data.dailyContent?.images || []).map((image) => image.originalUrl || image.mediumUrl || image.thumbUrl).filter(Boolean)
    if (!images.length) return wx.showToast({ title: '暂无可保存图片', icon: 'none' })
    const modal = await new Promise((resolve) => wx.showModal({ title: '保存原图', content: `将保存本图册 ${images.length} 张图片到相册`, confirmText: '保存', success: resolve }))
    if (!modal.confirm) return
    wx.showLoading({ title: '保存中…', mask: true })
    let saved = 0
    for (const url of images) {
      try {
        const file = await new Promise((resolve, reject) => wx.downloadFile({ url, success: (res) => res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error('download')), fail: reject }))
        await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: file, success: resolve, fail: reject }))
        saved += 1
      } catch (_error) { /* continue saving remaining images */ }
    }
    wx.hideLoading()
    wx.showToast({ title: saved === images.length ? '已保存全部原图' : `已保存 ${saved} 张`, icon: saved ? 'success' : 'none' })
  },

  setAlbumIndex(index) {
    const images = this.data.dailyContent?.images || []
    if (!images.length) return
    const currentAlbumIndex = Math.max(0, Math.min(Number(index) || 0, images.length - 1))
    this.setData({ currentAlbumIndex })
    this.loadAlbumImage(this.data.dailyContent.id, currentAlbumIndex)
    this.preloadAlbumNeighbors(this.data.dailyContent.id, currentAlbumIndex)
  },

  handleAlbumChange(event) {
    this.setAlbumIndex(event.detail.current)
  },

  showPrevAlbumImage() { this.setAlbumIndex(this.data.currentAlbumIndex - 1) },
  showNextAlbumImage() { this.setAlbumIndex(this.data.currentAlbumIndex + 1) },

  openAlbumPreview(event) {
    const images = this.data.dailyContent?.images || []
    const index = Number(event?.currentTarget?.dataset?.imageIndex ?? this.data.currentAlbumIndex) || 0
    return openImagePreview(this, images, index)
  },

  handleAlbumImageError(event) {
    const index = Number(event.currentTarget.dataset.index)
    const item = this.data.dailyContent?.images?.[index]
    if (!item?.displayUrl || event.currentTarget.dataset.src !== item.displayUrl) return
    this.setData({
      [`dailyContent.images[${index}].displayUrl`]: '',
      [`dailyContent.images[${index}].displayLoading`]: false,
    })
  },

  setupAudioContext() {
    if (this.audioContext || !wx.createInnerAudioContext) return
    const context = wx.createInnerAudioContext()
    context.autoplay = false
    context.onCanplay(() => {
      if (!this.data.dailyContent?.isAudio) return
      const durationSeconds = Number(context.duration) || this.data.audio.durationSeconds
      this.setData({
        'audio.durationSeconds': durationSeconds,
        'audio.duration': formatAudioTime(durationSeconds),
        'audio.isBuffering': false,
      })
    })
    context.onPlay(() => this.setData({
      'audio.isBuffering': false,
      'audio.isPlaying': true,
      'audio.status': '正在播放',
    }))
    context.onPause(() => {
      if (!this.data.dailyContent?.isAudio || this.data.audio.currentSeconds >= this.data.audio.durationSeconds) return
      this.setData({ 'audio.isPlaying': false, 'audio.status': '已暂停' })
    })
    context.onStop(() => this.setData({ 'audio.isPlaying': false }))
    context.onWaiting(() => {
      if (this.data.dailyContent?.isAudio) this.setData({ 'audio.isBuffering': true, 'audio.status': '正在缓冲' })
    })
    context.onTimeUpdate(() => this.syncAudioProgress(context.currentTime, context.duration))
    context.onEnded(() => {
      const durationSeconds = Number(context.duration) || this.data.audio.durationSeconds
      this.setData({
        'audio.currentSeconds': durationSeconds,
        'audio.currentTime': formatAudioTime(durationSeconds),
        'audio.durationSeconds': durationSeconds,
        'audio.duration': formatAudioTime(durationSeconds),
        'audio.isBuffering': false,
        'audio.isPlaying': false,
        'audio.remaining': '剩余 00:00',
        'audio.status': '播放结束',
      })
    })
    context.onError(() => {
      if (this.data.dailyContent?.isAudio) {
        this.setData({
          'audio.isBuffering': false,
          'audio.isPlaying': false,
          'audio.status': '暂时无法播放',
        })
      }
    })
    this.audioContext = context
  },

  destroyAudioContext() {
    if (!this.audioContext) return
    this.audioContext.stop()
    this.audioContext.destroy()
    this.audioContext = null
    this.audioSource = ''
  },

  resetAudioPlayer(item) {
    if (this.audioContext) this.audioContext.stop()
    this.audioSource = ''
    this.setData({ audio: createAudioState(item) }, () => {
      this.syncAudioTitleScroll()
      this.measureAudioProgress()
    })
  },

  resetAudioPlayback() {
    if (this.audioContext) this.audioContext.stop()
    this.audioSource = ''
  },

  pauseAudioPlayback() {
    if (this.audioContext && this.data.audio.isPlaying) this.audioContext.pause()
  },

  triggerAudioControlAnimation(field, duration) {
    const timerKey = field === 'playAnimating' ? 'audioPlayAnimationTimer' : 'audioRestartAnimationTimer'
    clearTimeout(this[timerKey])
    this.setData({ [`audio.${field}`]: false }, () => {
      this.setData({ [`audio.${field}`]: true })
      this[timerKey] = setTimeout(() => {
        this[timerKey] = null
        this.setData({ [`audio.${field}`]: false })
      }, duration)
    })
  },

  syncAudioProgress(currentTime, duration) {
    if (!this.data.dailyContent?.isAudio) return
    const durationSeconds = Math.max(0, Number(duration) || this.data.audio.durationSeconds)
    const currentSeconds = Math.min(Math.max(0, Number(currentTime) || 0), durationSeconds || Number.MAX_SAFE_INTEGER)
    this.setData({
      'audio.currentSeconds': currentSeconds,
      'audio.currentTime': formatAudioTime(currentSeconds),
      'audio.durationSeconds': durationSeconds,
      'audio.duration': formatAudioTime(durationSeconds),
      'audio.remaining': `剩余 ${formatAudioTime(Math.max(0, durationSeconds - currentSeconds))}`,
    })
  },

  measureAudioProgress() {
    const query = wx.createSelectorQuery().in(this)
    query.select('#audioProgress').boundingClientRect()
    query.exec(([rect]) => { this.audioProgressRect = rect || null })
  },

  syncAudioTitleScroll() {
    this.setData({ 'audio.titleScrolling': false, 'audio.titleStyle': '' }, () => {
      const query = wx.createSelectorQuery().in(this)
      query.select('#audioTitle').boundingClientRect()
      query.select('#audioTitleText').boundingClientRect()
      query.exec(([titleRect, textRect]) => {
        if (!this.data.dailyContent?.isAudio || !titleRect || !textRect) return
        const overflowPx = Math.ceil(textRect.width - titleRect.width)
        if (overflowPx <= 0) return
        const screenWidth = wx.getSystemInfoSync().screenWidth || 375
        const overflowRpx = Math.ceil((overflowPx + 8) * 750 / screenWidth)
        const duration = Math.min(16, Math.max(7, overflowPx / 18 + 5)).toFixed(1)
        this.setData({
          'audio.titleScrolling': true,
          'audio.titleStyle': `--audio-title-overflow:${overflowRpx}rpx;--audio-title-scroll-duration:${duration}s;`,
        })
      })
    })
  },

  ensureAudioSource() {
    const url = this.data.dailyContent?.audioUrl || ''
    if (!url) {
      wx.showToast({ title: '音频地址暂不可用', icon: 'none' })
      return false
    }
    this.setupAudioContext()
    if (!this.audioContext) return false
    if (this.audioSource !== url) {
      this.audioContext.stop()
      this.audioContext.src = url
      this.audioSource = url
    }
    return true
  },

  handleAudioToggle() {
    if (!this.data.dailyContent?.isAudio || this.data.audio.isBuffering) return
    if (this.data.audio.isPlaying) {
      this.triggerAudioControlAnimation('playAnimating', 240)
      this.pauseAudioPlayback()
      return
    }
    if (!this.ensureAudioSource()) return
    this.triggerAudioControlAnimation('playAnimating', 240)
    if (this.data.audio.durationSeconds && this.data.audio.currentSeconds >= this.data.audio.durationSeconds) {
      this.audioContext.seek(0)
      this.syncAudioProgress(0, this.data.audio.durationSeconds)
    }
    this.audioContext.play()
  },

  handleAudioRestart() {
    if (!this.data.dailyContent?.isAudio || this.data.audio.isBuffering || !this.ensureAudioSource()) return
    this.triggerAudioControlAnimation('restartAnimating', 340)
    this.audioContext.seek(0)
    this.syncAudioProgress(0, this.data.audio.durationSeconds)
    this.audioContext.play()
  },

  handleAudioSeek(event) {
    if (!this.data.dailyContent?.isAudio || !this.data.audio.durationSeconds) return
    const rect = this.audioProgressRect
    const x = Number(event.detail?.x || event.changedTouches?.[0]?.pageX || 0)
    if (!rect || !x) {
      this.measureAudioProgress()
      return
    }
    const ratio = Math.min(1, Math.max(0, (x - rect.left) / rect.width))
    const seconds = this.data.audio.durationSeconds * ratio
    this.syncAudioProgress(seconds, this.data.audio.durationSeconds)
    if (this.ensureAudioSource()) this.audioContext.seek(seconds)
  },

  handleDailyContentSubscribe() {
    this.requestSubscribe(this.data.dailyContentSubscribePrompt)
  },

  handleCheckinSubscribe() {
    this.requestSubscribe(this.data.checkinSubscribePrompt)
  },

  async requestSubscribe(prompt) {
    const templateKey = prompt && prompt.templateKey
    const templateId = prompt && prompt.templateId
    const scene = prompt && prompt.scene
    if (!prompt?.enabled || !templateKey || !templateId) return
    this.subscriptionRequesting = true
    try {
      const result = await wx.requestSubscribeMessage({ tmplIds: [templateId] })
      const accepted = String(result[templateId] || '').startsWith('accept')
      await authorizeSubscription({ templateKey, scene, accepted, result: result[templateId] || '' })
      wx.showToast({ title: accepted ? '已开启提醒' : '未开启提醒', icon: 'none' })
    } catch (error) {
      await authorizeSubscription({ templateKey, scene, accepted: false, reason: error.errMsg || error.message || 'request_failed' })
      wx.showToast({ title: '未开启提醒', icon: 'none' })
    } finally {
      this.subscriptionRequesting = false
    }
  },

  onShareAppMessage(event) {
    getApp().markShareReturn?.()
    this.pauseInterstitialUntilNextShow()
    const target = event?.target || {}
    const dataset = target.dataset || {}
    const isOpenedDailyContent = Boolean(this.data.dailyContent?.id)
    if (isOpenedDailyContent) {
      recordShareInteraction({ source: 'daily_content', sourceId: this.data.dailyContent.id }).catch(() => {})
    }
    const nextHomeShare = isOpenedDailyContent
      ? null
      : getNextHomeShareType(getHomeShareDailyContentTypes(this.data.dailyContentTypes), this.homeShareTypeIndex)
    if (nextHomeShare) this.homeShareTypeIndex = nextHomeShare.nextIndex
    const type = dataset.share === 'album'
      ? 'album'
      : dataset.share === 'audio'
        ? 'audio'
        : this.data.dailyContent?.isAlbum
          ? 'album'
          : this.data.dailyContent?.isAudio
            ? 'audio'
              : isOpenedDailyContent
                ? 'text'
                : nextHomeShare?.type || 'text'
    const privateType = getPrivateShareType(type)
    const shareItem = isOpenedDailyContent && privateType === 'image' ? this.data.dailyContent : null
    const cardKey = getPrivateShareCardKey(privateType, shareItem)
    const fallbackCard = {
      title: DEFAULT_COPY_PACK.sharePools[privateType].titles[0],
      imageUrl: getPrivateShareFallbackImage(),
    }
    const cachedCard = this.privateShareCards?.[cardKey]
    const warmingTextCard = privateType === 'text' && this.privateShareWarmRequest
    const cardPromise = cachedCard
      ? Promise.resolve(cachedCard)
      : (warmingTextCard || createPrivateShareCard(this.shareCardComposer, {
          type: privateType,
          item: shareItem,
          settings: copyPack.getShareSettings(),
        })).then((card) => {
          this.privateShareCards = this.privateShareCards || {}
          this.privateShareCards[cardKey] = card
          return card
        }).catch(() => fallbackCard)
    if (isOpenedDailyContent || !this.privateShareCardsReady) this.privateShareWarmQueued = true
    this.prepareNextPrivateShareCard(privateType, shareItem)
    const sharePath = `/pages/home/home?type=${encodeURIComponent(type)}${isOpenedDailyContent ? `&contentId=${encodeURIComponent(this.data.dailyContent.id)}` : ''}`
    return {
      title: cachedCard?.title || fallbackCard.title,
      path: sharePath,
      imageUrl: cachedCard?.imageUrl || fallbackCard.imageUrl,
      promise: cardPromise.then((card) => ({
        title: card?.title || fallbackCard.title,
        imageUrl: card?.imageUrl || fallbackCard.imageUrl,
        path: sharePath,
      })),
    }
  },
})
