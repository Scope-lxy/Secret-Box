const { deletePrivateMessage, getCachedHomeData, getCachedLetters, getHomeData, getLetters, getLettersPage, recordShareInteraction, submitPrivateMessage, toggleInteraction } = require('../../services/miniapp')
const copyPack = require('../../utils/copy-pack')
const { resolveCopyText } = require('../../utils/default-copy')
const { resolvePhoneSyncPrompt, shouldPromptForMessage, syncPhoneForMessage } = require('../../utils/message-phone-sync')
const { MESSAGE_CONTENT_LIMIT_TEXT, isMessageContentWithinLimit, normalizeMessageContent, truncateMessageContent } = require('../../utils/message-content')
const { ensureVisibleTab, syncCustomTabBar } = require('../../utils/tabs')
const { getFontSizeMode } = require('../../utils/font-mode')
const { finishInitialLoad, startInitialLoad } = require('../../utils/page-loading')
const { markListAdSlots } = require('../../utils/list-ads')
const { scheduleInterstitialAd } = require('../../utils/ads')
const { createPublicShareCard, createShareCardComposer, getPublicShareTitle } = require('../../utils/share-card')
const { shouldKeepNativeAdHidden } = require('../../utils/native-ad')
const { splitContentParagraphs } = require('../../utils/paragraphs')
const { compactNumber, withInteractionDisplayCounts } = require('../../utils/format')
const { getLatestStartupConfig, refreshStartupConfig } = require('../../utils/startup-config')

function getNavigationTabs(fallback) {
  const startup = getLatestStartupConfig()
  return Array.isArray(startup?.tabs) ? startup.tabs : fallback
}

function getFallbackShareImage(item = {}, settings = copyPack.getShareSettings()) {
  const backgrounds = Array.isArray(settings.private?.backgrounds)
    ? settings.private.backgrounds.filter((entry) => entry?.enabled !== false && String(entry?.imageUrl || '').trim())
    : []
  if (backgrounds.length) {
    let hash = 0
    for (const character of String(item.id || '')) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
    return backgrounds[hash % backgrounds.length].imageUrl
  }
  return '/assets/images/share-1.jpg'
}

function mergeUniqueItems(items = [], targetId = '') {
  const seen = new Set()
  const unique = items.filter((item) => {
    const id = String(item?.id || '').trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
  const normalizedTargetId = String(targetId || '').trim()
  const index = unique.findIndex((item) => String(item.id || '').trim() === normalizedTargetId)
  if (index <= 0) return unique
  return [unique[index], ...unique.slice(0, index), ...unique.slice(index + 1)]
}

Page({
  data: {
    fontSizeMode: 'larger',
    loading: true,
    ready: false,
    showSkeleton: false,
    error: '',
    hero: resolveCopyText(null, 'lettersHero'),
    ads: {},
    messagesEnabled: false,
    nativeAdHidden: false,
    items: [],
    phoneSyncPromptVisible: false,
    phoneSyncAuthorizing: false,
  },

  onLoad(options = {}) {
    this.foregroundVersion = getApp().globalData?.foregroundVersion || 0
    this.setSharedLetterTarget(options)
    this.publicShareCards = {}
    const home = getCachedHomeData()
    const letters = getCachedLetters()
    if (!this.sharedContentId) this.applyData(home, letters)
    startInitialLoad(this, Boolean(letters && !this.sharedContentId))
  },

  onReady() {
    this.shareCardComposer = createShareCardComposer(this)
    this.warmVisibleShareCard()
  },

  warmVisibleShareCard() {
    const item = this.data.items?.[0]
    if (!this.shareCardComposer || !item?.id || this.publicShareCards?.[item.id] || this.shareWarmRequest) return
    this.shareWarmRequest = this.preparePublicShareCard(item, copyPack.getShareSettings(), { preview: true })
      .catch(() => {})
      .finally(() => { this.shareWarmRequest = null })
  },

  onShow() {
    wx.hideShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
    })
    this.setData({ fontSizeMode: getFontSizeMode() })
    const sharedTargetChanged = this.setSharedLetterTarget()
    if (!ensureVisibleTab('letters', getNavigationTabs())) {
      this.handleUnavailableSharedLetter()
      return
    }
    this.interstitialBlockedByExternalUi = false
    syncCustomTabBar(this, 'letters', getNavigationTabs())
    // 首次进入、真正从后台回前台和用户主动下拉刷新会重新取数并排序；
    // 从详情页、Tab、分享等普通回流时保留当前顺序。
    const app = getApp()
    const foregroundVersion = app.globalData?.foregroundVersion || 0
    const shouldRefreshAfterBackground = this.data.ready && this.foregroundVersion !== foregroundVersion
    this.foregroundVersion = foregroundVersion
    if (sharedTargetChanged) this.loadData({ force: true })
    else if (!this.data.ready || shouldRefreshAfterBackground) this.loadData()
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
    if (this.interstitialBlockedByExternalUi || this.interstitialDispose) return
    this.interstitialDispose = scheduleInterstitialAd(this.data.ads.lettersInterstitial, 'letters', {
      isIdle: () => !this.data.loading
        && !this.refreshing
        && !this.loadingMore
        && !this.data.phoneSyncPromptVisible
        && !this.data.phoneSyncAuthorizing
        && !this.interactionLoading
        && !this.data.items.some((item) => item.messageVisible || item.messageSubmitting || item.messageDeleting),
    })
  },

  pauseInterstitialUntilNextShow() {
    this.interstitialBlockedByExternalUi = true
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  applyData(home, data) {
    if (home) {
      const tabs = getNavigationTabs(home.system || {})
      if (!ensureVisibleTab('letters', tabs)) {
        this.handleUnavailableSharedLetter()
        return
      }
      syncCustomTabBar(this, 'letters', tabs)
      const ads = home.ads || {}
      this.setData({
        hero: resolveCopyText(home.system?.lettersHero, 'lettersHero'),
        ads,
        messagesEnabled: home.messagesEnabled === true,
        nativeAdHidden: shouldKeepNativeAdHidden({
          previousAds: this.data.ads,
          nextAds: ads,
          placement: 'lettersNative',
          hidden: this.data.nativeAdHidden,
        }),
      })
    }
    if (data) {
      this.lettersPagination = data.pagination || this.lettersPagination || { page: 1, totalPages: 1 }
      const nativeAd = home?.ads?.lettersNative || this.data.ads.lettersNative || {}
      const rawItems = (data.items || []).map((item) => withInteractionDisplayCounts({
            ...item,
            contentParagraphs: splitContentParagraphs(item.content),
            messageVisible: false,
            messageText: '',
          }))
      const sharedItems = mergeUniqueItems(rawItems, this.sharedContentId)
      const items = markListAdSlots(
        sharedItems,
        nativeAd.firstAfter || 3,
        nativeAd.interval || 10,
      )
      this.setData({
        error: '',
        ready: true,
        items,
      })
      this.resolveSharedLetterTarget(sharedItems)
      this.publicShareCards = {}
      this.warmVisibleShareCard()
    }
  },

  setSharedLetterTarget(options = {}) {
    const pending = getApp().getPendingSharedContentTarget?.()
    const optionId = String(options.contentId || '').trim()
    const target = pending?.target === 'letter'
      ? pending
      : (optionId ? { contentId: optionId, token: '' } : null)
    if (!target?.contentId || (this.sharedContentId === target.contentId && this.sharedTargetToken === target.token)) return false
    this.sharedContentId = target.contentId
    this.sharedTargetToken = target.token
    this.sharedTargetGeneration = (this.sharedTargetGeneration || 0) + 1
    this.lettersPagination = null
    if (this.data.ready) this.setData({ items: [], ready: false })
    this.scrollToSharedLetter()
    return true
  },

  scrollToSharedLetter() {
    wx.pageScrollTo?.({ scrollTop: 0, duration: 0 })
  },

  consumeSharedLetterTarget() {
    if (this.sharedTargetToken) getApp().consumePendingSharedContentTarget?.(this.sharedTargetToken)
    this.sharedTargetToken = ''
  },

  clearSharedLetterTarget() {
    this.sharedContentId = ''
    this.sharedTargetToken = ''
    this.sharedTargetGeneration = (this.sharedTargetGeneration || 0) + 1
  },

  handleUnavailableSharedLetter() {
    if (!this.sharedContentId) return
    this.consumeSharedLetterTarget()
    this.clearSharedLetterTarget()
    wx.showToast({ title: '分享的内容暂时不可用', icon: 'none' })
  },

  resolveSharedLetterTarget(items = this.data.items) {
    if (!this.sharedContentId) return
    if (
      this.sharedTargetLocatedGeneration != null
      && this.sharedTargetLocatedGeneration === this.sharedTargetGeneration
    ) return
    if (!items.some((item) => String(item.id || '').trim() === String(this.sharedContentId || '').trim())) {
      this.handleUnavailableSharedLetter()
      return
    }
    this.scrollToSharedLetter()
    this.consumeSharedLetterTarget()
    this.sharedTargetLocatedGeneration = this.sharedTargetGeneration
  },

  async preparePublicShareCard(item, settings = copyPack.getShareSettings(), { preview = false } = {}) {
    if (!this.shareCardComposer || !item?.id) return
    this.publicShareCards[item.id] = await createPublicShareCard(this.shareCardComposer, {
      source: 'letters',
      item,
      settings,
      preview,
    })
  },

  async loadData(options = {}) {
    if (this.loadingRequest) {
      if (!options.force) return this.loadingRequest
      await this.loadingRequest
      return this.loadData(options)
    }
    this.loadingRequest = (async () => {
      try {
        const requestedSharedContentId = this.sharedContentId
        const requestedSharedTargetToken = this.sharedTargetToken
        const requestedSharedTargetGeneration = this.sharedTargetGeneration || 0
        const [home, data] = await Promise.all([
          getHomeData(options),
          getLetters({ ...options, includeId: requestedSharedContentId }),
        ])
        if (
          requestedSharedContentId !== this.sharedContentId
          || requestedSharedTargetToken !== this.sharedTargetToken
          || requestedSharedTargetGeneration !== (this.sharedTargetGeneration || 0)
        ) return
        const tabs = getNavigationTabs(home.system || {})
        if (!ensureVisibleTab('letters', tabs)) {
          this.handleUnavailableSharedLetter()
          return
        }
        this.applyData(home, data)
        this.startInterstitialAd()
      } catch (error) {
        if (
          requestedSharedContentId !== this.sharedContentId
          || requestedSharedTargetToken !== this.sharedTargetToken
          || requestedSharedTargetGeneration !== (this.sharedTargetGeneration || 0)
        ) return
        const message = error.message || '心笺加载失败，请稍后再试'
        if (!this.data.ready) this.setData({ error: message })
        if (options.notify) wx.showToast({ title: message, icon: 'none' })
      } finally {
        finishInitialLoad(this)
      }
    })().finally(() => { this.loadingRequest = null })
    return this.loadingRequest
  },

  async onPullDownRefresh() {
    this.refreshing = true
    try {
      this.clearSharedLetterTarget()
      await refreshStartupConfig().catch(() => {})
      await this.loadData({ force: true, notify: true })
    } finally {
      this.refreshing = false
      wx.stopPullDownRefresh()
    }
  },

  async onReachBottom() {
    const pagination = this.lettersPagination || {}
    if (this.loadingMore || Number(pagination.page || 1) >= Number(pagination.totalPages || 1)) return
    this.loadingMore = true
    const requestedSharedContentId = this.sharedContentId
    const requestedSharedTargetToken = this.sharedTargetToken
    const requestedSharedTargetGeneration = this.sharedTargetGeneration || 0
    try {
      const data = await getLettersPage(Number(pagination.page || 1) + 1)
      if (
        requestedSharedContentId !== this.sharedContentId
        || requestedSharedTargetToken !== this.sharedTargetToken
        || requestedSharedTargetGeneration !== (this.sharedTargetGeneration || 0)
      ) return
      const known = new Set(this.data.items.map((item) => item.id))
      this.applyData(null, {
        ...data,
        items: [...this.data.items, ...(data.items || []).filter((item) => !known.has(item.id))],
      })
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

  handleNativeAdError() {
    this.setData({ nativeAdHidden: true, nativeAdReady: false })
  },

  handleNativeAdLoad() {
    this.setData({ nativeAdHidden: false, nativeAdReady: true })
  },

  preventPhoneSyncPromptScroll() {},

  updateItem(index, patch) {
    const key = `items[${index}]`
    this.setData({ [key]: { ...this.data.items[index], ...patch } })
  },

  async toggleLike(event) {
    const index = event.currentTarget.dataset.index
    const item = this.data.items[index]
    this.interactionLoading = true
    try {
      const data = await toggleInteraction({ source: 'letters', sourceId: item.id, type: 'like', desiredState: !item.liked })
      const interaction = data.interaction || {}
      const nextLikeCount = Number.isFinite(Number(interaction.likeCount)) ? interaction.likeCount : item.likeCount
      this.updateItem(index, {
        liked: Boolean(interaction.liked),
        likeCount: nextLikeCount,
        displayLikeCount: Number(nextLikeCount) > 0 ? compactNumber(nextLikeCount) : '',
      })
    } catch (error) {
      wx.showToast({ title: error.message || '互动失败', icon: 'none' })
    } finally {
      this.interactionLoading = false
    }
  },

  async toggleFavorite(event) {
    const index = event.currentTarget.dataset.index
    const item = this.data.items[index]
    this.interactionLoading = true
    try {
      const data = await toggleInteraction({ source: 'letters', sourceId: item.id, type: 'favorite', desiredState: !item.favorited })
      const interaction = data.interaction || {}
      const nextFavoriteCount = Number.isFinite(Number(interaction.favoriteCount)) ? interaction.favoriteCount : item.favoriteCount
      this.updateItem(index, {
        favorited: Boolean(interaction.favorited),
        favoriteCount: nextFavoriteCount,
        displayFavoriteCount: Number(nextFavoriteCount) > 0 ? compactNumber(nextFavoriteCount) : '',
      })
      wx.showToast({ title: data.queued ? '已保存，联网后同步' : interaction.favorited ? '已收藏' : '已取消收藏', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '互动失败', icon: 'none' })
    } finally {
      this.interactionLoading = false
    }
  },

  toggleMessage(event) {
    const index = event.currentTarget.dataset.index
    const item = this.data.items[index]
    this.updateItem(index, { messageVisible: !item.messageVisible })
  },

  handleMessageInput(event) {
    const value = truncateMessageContent(event.detail.value)
    this.updateItem(event.currentTarget.dataset.index, { messageText: value })
    if (value !== event.detail.value) wx.showToast({ title: MESSAGE_CONTENT_LIMIT_TEXT, icon: 'none' })
    return value
  },

  async handleSubmitMessage(event) {
    const index = event.currentTarget.dataset.index
    const item = this.data.items[index]
    if (!item || item.messageSubmitting || item.messageDeleting) return
    const content = normalizeMessageContent(item.messageText)
    if (!content) {
      wx.showToast({ title: '先写一句悄悄话', icon: 'none' })
      return
    }
    if (!isMessageContentWithinLimit(content)) {
      wx.showToast({ title: MESSAGE_CONTENT_LIMIT_TEXT, icon: 'none' })
      return
    }
    if (shouldPromptForMessage()) {
      this.pendingMessage = { index, sourceId: item.id, content }
      this.setData({ phoneSyncPromptVisible: true })
      return
    }
    await this.submitMessage(index, item.id, content)
  },

  async submitMessage(index, sourceId, content) {
    const item = this.data.items[index]
    if (!item || item.messageSubmitting || item.messageDeleting || item.id !== sourceId) return
    this.updateItem(index, { messageSubmitting: true })
    try {
      const data = await submitPrivateMessage({ source: 'letters', sourceId, content })
      this.updateItem(index, { myMessage: content, messageText: '', messageVisible: false })
      wx.showToast({ title: data.queued ? '已保存，联网后送达' : '已经悄悄送达', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '留言失败，请稍后重试', icon: 'none' })
    } finally {
      this.updateItem(index, { messageSubmitting: false })
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
      const pending = this.pendingMessage
      this.pendingMessage = null
      this.setData({ phoneSyncPromptVisible: false })
      await this.submitMessage(pending.index, pending.sourceId, pending.content)
    } catch (error) {
      wx.showToast({ title: error.message || '手机号获取失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ phoneSyncAuthorizing: false })
    }
  },

  async handlePhoneSyncDecline() {
    if (this.data.phoneSyncAuthorizing || !this.pendingMessage) return
    const pending = this.pendingMessage
    this.pendingMessage = null
    resolvePhoneSyncPrompt()
    this.setData({ phoneSyncPromptVisible: false })
    await this.submitMessage(pending.index, pending.sourceId, pending.content)
  },

  async handleDeleteMessage(event) {
    const index = event.currentTarget.dataset.index
    const item = this.data.items[index]
    if (!item || item.messageSubmitting || item.messageDeleting || !item.myMessage) return
    this.updateItem(index, { messageDeleting: true })
    try {
      const data = await deletePrivateMessage({ source: 'letters', sourceId: item.id })
      this.updateItem(index, { myMessage: '', messageText: '', messageVisible: false })
      wx.showToast({ title: data.queued ? '已删除，联网后同步' : '已删除', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '删除留言失败，请稍后重试', icon: 'none' })
    } finally {
      this.updateItem(index, { messageDeleting: false })
    }
  },

  onShareAppMessage(event) {
    getApp().markShareReturn?.()
    this.pauseInterstitialUntilNextShow()
    const target = event?.target || {}
    const dataset = target.dataset || {}
    const item = this.data.items[dataset.index] || {}
    if (item.id) recordShareInteraction({ source: 'letters', sourceId: item.id }).catch(() => {})
    const settings = copyPack.getShareSettings()
    const sharePath = `/pages/letters/letters?contentId=${encodeURIComponent(item.id || '')}`
    const fallback = {
      title: getPublicShareTitle(item, '看到一句话，想也一起看看'),
      imageUrl: getFallbackShareImage(item, settings),
    }
    const card = this.publicShareCards?.[item.id] || fallback
    const cardPromise = Promise.resolve(this.preparePublicShareCard(item, settings))
      .then(() => ({
        ...(this.publicShareCards?.[item.id] || fallback),
        path: sharePath,
      }))
      .catch(() => ({ ...fallback, path: sharePath }))
    return {
      title: card.title,
      imageUrl: card.imageUrl,
      // Newer WeChat clients wait for this promise, so the first share can use
      // the rendered cover. The synchronous values above remain a safe fallback
      // on clients that do not support asynchronous share results.
      promise: cardPromise,
      path: sharePath,
    }
  },
})
