const {
  getArticle,
  getArticleRecommendations,
  openArticle,
  recordShareInteraction,
  getRewardedAdAccess,
  deletePrivateMessage,
  submitPrivateMessage,
  toggleInteraction,
  unlockArticle,
} = require('../../services/miniapp')
const { getStartupConfig, refreshStartupConfig } = require('../../utils/startup-config')
const { PREVIEW_HEIGHTS, prepareDetailPayload, resolvePreviewHeight } = require('../../utils/article-detail')
const { getArticleCoverUrl, normalizeArticleLayout, resolveFallbackCoverUrl } = require('../../utils/article-feed')
const copyPack = require('../../utils/copy-pack')
const { getNextImageUrl } = require('../../utils/image-display')
const { createPublicShareCard, createShareCardComposer } = require('../../utils/share-card')
const { markListAdSlots } = require('../../utils/list-ads')
const { getFontSizeMode } = require('../../utils/font-mode')
const { resolvePhoneSyncPrompt, shouldPromptForMessage, syncPhoneForMessage } = require('../../utils/message-phone-sync')
const { MESSAGE_CONTENT_LIMIT_TEXT, isMessageContentWithinLimit, normalizeMessageContent, truncateMessageContent } = require('../../utils/message-content')
const { compactNumber } = require('../../utils/format')
const { DEFAULT_COPY_PACK, resolveCopyText } = require('../../utils/default-copy')
const { setSharedArticleReturnTarget } = require('../../utils/shared-article-return')
const {
  resolveRewardedAdResult,
  runRewardedAd,
  scheduleInterstitialAd,
  shouldConfirmRewardedAd,
} = require('../../utils/ads')

function getSystem(config = {}) {
  return config.system || config
}

function getAds(config = {}) {
  return config.ads || config
}

Page({
  data: {
    article: {},
    endAdHidden: false,
    endAdReady: false,
    middleAdHidden: false,
    middleAdReady: false,
    error: '',
    expandButtonText: resolveCopyText(null, 'articleExpandButton'),
    fontSizeMode: 'larger',
    loading: true,
    previewMaxHeightVh: PREVIEW_HEIGHTS.early,
    ready: false,
    recommendations: [],
    recommendationLoading: false,
    articleLayout: 'mixed',
    recommendationAdHidden: false,
    recommendationAdReady: false,
    refreshing: false,
    startAdHidden: false,
    startAdReady: false,
    unlocking: false,
    unlockedToday: false,
    ads: {},
    articleAdIncompleteText: resolveCopyText(null, 'articleAdIncomplete'),
    messagesEnabled: false,
    messageText: '',
    articleMessageVisible: false,
    messageSubmitting: false,
    messageDeleting: false,
    phoneSyncPromptVisible: false,
    phoneSyncAuthorizing: false,
    interactionLoading: false,
    returnToArticles: true,
  },

  onLoad(options = {}) {
    this.contentId = String(options.contentId || '').trim()
    if (!this.contentId) {
      this.setData({ error: '文章不存在', loading: false })
      return
    }
    this.captureSharedArticleTarget()
    this.loadData()
  },

  captureSharedArticleTarget() {
    const target = getApp().getPendingSharedContentTarget?.()
    if (target?.target !== 'article' || target.contentId !== this.contentId) return
    this.sharedArticleTarget = target
  },

  onReady() {
    this.shareCardComposer = createShareCardComposer(this)
    if (this.data.article?.id) {
      Promise.resolve(this.preparePublicShareCard({ preview: true })).then((card) => { this.publicShareCard = card }).catch(() => {})
    }
  },

  onShow() {
    this.pageVisible = true
    this.setData({ fontSizeMode: getFontSizeMode() })
    if (this.data.ready) this.startInterstitialAd()
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true })
    try {
      await refreshStartupConfig().catch(() => {})
      await this.loadData({ force: true, notify: true })
    } finally {
      this.setData({ refreshing: false })
      wx.stopPullDownRefresh()
    }
  },

  onHide() {
    this.pageVisible = false
    this.stopInterstitialAd()
  },

  onUnload() {
    this.pageVisible = false
    this.stopInterstitialAd()
  },

  applyConfig(config = {}) {
    const system = getSystem(config)
    const ads = getAds(config)
    const display = config.articleDisplay || system.articleDisplay || {}
    const messagesEnabled = config.messagesEnabled === true
    this.setData({
      ads: {
        articleExpandRewarded: ads.articleExpandRewarded || {},
        articleInterstitial: ads.articleInterstitial || {},
        articlesNative: ads.articlesNative || {},
        articlesEndNative: ads.articlesEndNative || {},
        articlesStartNative: ads.articlesStartNative || {},
      },
      articleLayout: normalizeArticleLayout(display.layout),
      messagesEnabled,
      // 留言能力随配置降级关闭时，同步收起留言与手机号提示
      articleMessageVisible: messagesEnabled && this.data.articleMessageVisible,
      phoneSyncPromptVisible: messagesEnabled && this.data.phoneSyncPromptVisible,
      expandButtonText: resolveCopyText(display.expandButtonText, 'articleExpandButton'),
      articleAdIncompleteText: resolveCopyText(system.articleAdIncompleteText, 'articleAdIncomplete'),
      previewMaxHeightVh: resolvePreviewHeight(display),
    })
  },

  applyDetail(data = {}) {
    const prepared = prepareDetailPayload(data, this.data.articleLayout, copyPack.getShareSettings())
    const nativeAd = this.data.ads.articlesNative || {}
    const firstAfter = Number(nativeAd.firstAfter) || 3
    const interval = Number(nativeAd.interval) || 10
    prepared.recommendations = markListAdSlots(prepared.recommendations, firstAfter + 5, interval)
    this.recommendationPagination = data.recommendationPagination || {
      page: 1,
      pageSize: prepared.recommendations.length || 20,
      total: prepared.recommendations.length,
      totalPages: 1,
      seed: '',
    }
    this.setData({
      ...prepared,
      recommendationLoading: false,
      error: '',
      ready: true,
    })
    this.publicShareCard = null
    Promise.resolve(this.preparePublicShareCard({ preview: true })).then((card) => { this.publicShareCard = card }).catch(() => {})
    if (prepared.article.title) wx.setNavigationBarTitle({ title: prepared.article.title })
  },

  loadData(options = {}) {
    if (this.loadingRequest) return this.loadingRequest
    // 页面配置一律读统一启动配置服务（普通调用并入在途请求/复用 latest），不另起配置请求；
    // 下拉刷新只重取文章业务数据
    const request = Promise.all([
      getStartupConfig(),
      getArticle(this.contentId),
    ])
      .then(([startup, detail]) => {
        this.applyConfig(startup.config || {})
        this.applyDetail(detail)
        if (this.sharedArticleTarget) getApp().consumePendingSharedContentTarget?.(this.sharedArticleTarget.token)
        this.ensureOpenRecorded()
        this.startInterstitialAd()
      })
      .catch((error) => {
        const sharedEntry = Boolean(this.sharedArticleTarget)
        if (sharedEntry) getApp().consumePendingSharedContentTarget?.(this.sharedArticleTarget.token)
        const message = sharedEntry ? '分享的内容暂时不可用' : (error.message || '文章加载失败，请稍后再试')
        this.setData({
          articleMessageVisible: false,
          error: message,
          messagesEnabled: false,
          phoneSyncPromptVisible: false,
        })
        if (options.notify) wx.showToast({ title: message, icon: 'none' })
      })
      .finally(() => {
        this.setData({ loading: false })
        this.loadingRequest = null
      })
    this.loadingRequest = request
    return request
  },

  async onReachBottom() {
    const pagination = this.recommendationPagination || {}
    if (this.loadingMoreRecommendations || Number(pagination.page || 1) >= Number(pagination.totalPages || 1)) return
    this.loadingMoreRecommendations = true
    this.setData({ recommendationLoading: true })
    const requestedContentId = this.contentId
    const requestedSeed = pagination.seed || ''
    try {
      const data = await getArticleRecommendations(this.contentId, {
        page: Number(pagination.page || 1) + 1,
        pageSize: 20,
        seed: requestedSeed,
      })
      if (requestedContentId !== this.contentId || requestedSeed !== (this.recommendationPagination?.seed || '')) return
      const prepared = prepareDetailPayload({
        article: this.data.article,
        recommendations: data.recommendations || [],
        unlockedToday: this.data.unlockedToday,
      }, this.data.articleLayout, copyPack.getShareSettings())
      const knownIds = new Set(this.data.recommendations.map((item) => item.id))
      const incoming = prepared.recommendations.filter((item) => !knownIds.has(item.id))
      const nativeAd = this.data.ads.articlesNative || {}
      const firstAfter = Number(nativeAd.firstAfter) || 3
      const interval = Number(nativeAd.interval) || 10
      this.recommendationPagination = data.recommendationPagination || pagination
      this.setData({
        recommendations: markListAdSlots([
          ...this.data.recommendations,
          ...incoming,
        ], firstAfter + 5, interval),
      })
    } catch (error) {
      if (requestedContentId === this.contentId) wx.showToast({ title: error.message || '加载更多失败', icon: 'none' })
    } finally {
      this.loadingMoreRecommendations = false
      if (requestedContentId === this.contentId) this.setData({ recommendationLoading: false })
    }
  },

  handleArticleBack() {
    setSharedArticleReturnTarget(this.data.article)
    wx.switchTab({ url: '/pages/articles/articles' })
  },

  ensureOpenRecorded() {
    if (this.openRecorded || this.openRecordRequest || !this.contentId) return this.openRecordRequest
    this.openRecordRequest = openArticle(this.contentId)
      .then(() => {
        this.openRecorded = true
      })
      .catch(() => {})
      .finally(() => {
        this.openRecordRequest = null
      })
    return this.openRecordRequest
  },

  startInterstitialAd() {
    if (
      this.interstitialDispose
      || this.interstitialSuppressed
      || this.rewardFlowActive
      || !this.pageVisible
      || !this.data.ready
    ) return
    this.interstitialDispose = scheduleInterstitialAd(
      this.data.ads.articleInterstitial,
      'article-detail',
      { isIdle: () => !this.data.loading && !this.data.unlocking && !this.rewardFlowActive },
    )
  },

  stopInterstitialAd() {
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  suppressInterstitialForReward() {
    this.interstitialSuppressed = true
    this.stopInterstitialAd()
  },

  async expandArticle() {
    if (this.data.unlockedToday || this.data.unlocking || this.rewardFlowActive || this.rewardAccessChecking) return
    const config = this.data.ads.articleExpandRewarded || {}
    this.suppressInterstitialForReward()
    const hasAd = config.enabled && String(config.adUnitId || '').trim()
    let free = false

    if (hasAd) {
      this.rewardAccessChecking = true
      this.setData({ unlocking: true })
      try {
        const access = await getRewardedAdAccess('article_expand')
        free = access.free === true
      } catch (error) {
        // Quota lookup failure falls back to the configured rewarded ad.
      } finally {
        this.rewardAccessChecking = false
        this.setData({ unlocking: false })
      }
    }

    if (hasAd && !free && shouldConfirmRewardedAd(config, false)) {
      wx.showModal({
        title: '继续阅读',
        content: String(config.promptText || this.data.articleAdIncompleteText),
        confirmText: '继续',
        success: (result) => {
          if (result.confirm) this.runArticleRewardedAd(config)
        },
      })
      return
    }
    await this.runArticleRewardedAd(free ? {} : config)
  },

  async toggleLike() {
    await this.toggleArticleInteraction('like')
  },

  async toggleFavorite() {
    await this.toggleArticleInteraction('favorite')
  },

  async toggleArticleInteraction(type) {
    if (this.data.interactionLoading || !this.contentId || !this.data.article?.id) return
    this.setData({ interactionLoading: true })
    try {
      const data = await toggleInteraction({
        source: 'article',
        sourceId: this.contentId,
        type,
        desiredState: type === 'like' ? !this.data.article.liked : !this.data.article.favorited,
      })
      const interaction = data.interaction || {}
      const nextLiked = interaction.liked === undefined ? this.data.article.liked : Boolean(interaction.liked)
      const nextFavorited = interaction.favorited === undefined ? this.data.article.favorited : Boolean(interaction.favorited)
      const nextLikeCount = Number.isFinite(Number(interaction.likeCount)) ? Number(interaction.likeCount) : this.data.article.likeCount
      const nextFavoriteCount = Number.isFinite(Number(interaction.favoriteCount)) ? Number(interaction.favoriteCount) : this.data.article.favoriteCount
      this.setData({
        'article.liked': nextLiked,
        'article.favorited': nextFavorited,
        'article.likeCount': nextLikeCount,
        'article.favoriteCount': nextFavoriteCount,
        'article.displayLikeCount': Number(nextLikeCount) > 0 ? compactNumber(nextLikeCount) : '',
        'article.displayFavoriteCount': Number(nextFavoriteCount) > 0 ? compactNumber(nextFavoriteCount) : '',
      })
      if (type === 'favorite') {
        wx.showToast({ title: data.queued ? '已保存，联网后同步' : nextFavorited ? '已收藏' : '已取消收藏', icon: 'none' })
      }
    } catch (error) {
      wx.showToast({ title: error.message || '互动失败', icon: 'none' })
    } finally {
      this.setData({ interactionLoading: false })
    }
  },

  toggleArticleMessage() {
    if (!this.data.messagesEnabled) return
    this.setData({ articleMessageVisible: !this.data.articleMessageVisible })
  },

  handleMessageInput(event) {
    const value = truncateMessageContent(event.detail.value)
    this.setData({ messageText: value })
    if (value !== event.detail.value) wx.showToast({ title: MESSAGE_CONTENT_LIMIT_TEXT, icon: 'none' })
    return value
  },

  async handleSubmitMessage() {
    if (!this.data.messagesEnabled || this.data.messageSubmitting || this.data.messageDeleting) return
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
    await this.submitArticleMessage(content)
  },

  async submitArticleMessage(content) {
    this.setData({ messageSubmitting: true })
    try {
      const data = await submitPrivateMessage({
        source: 'article',
        sourceId: this.contentId,
        content,
      })
      this.setData({ 'article.myMessage': content, messageText: '', articleMessageVisible: false })
      wx.showToast({ title: data.queued ? '已保存，联网后送达' : '已经悄悄送达', icon: 'none' })
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
      await this.submitArticleMessage(content)
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
    await this.submitArticleMessage(content)
  },

  preventPhoneSyncPromptScroll() {},

  async handleDeleteMessage() {
    if (this.data.messageSubmitting || this.data.messageDeleting || !this.data.article?.myMessage || !this.contentId) return
    this.setData({ messageDeleting: true })
    try {
      const data = await deletePrivateMessage({ source: 'article', sourceId: this.contentId })
      this.setData({ 'article.myMessage': '', articleMessageVisible: false, messageText: '' })
      wx.showToast({ title: data.queued ? '已删除，联网后同步' : '已删除', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '删除留言失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ messageDeleting: false })
    }
  },

  async runArticleRewardedAd(config = {}) {
    if (this.rewardFlowActive || this.data.unlocking) return
    this.rewardFlowActive = true
    this.setData({ unlocking: true })
    try {
      let reward = { completed: true, skipped: true }
      const hasAd = config.enabled && String(config.adUnitId || '').trim()
      if (hasAd) reward = resolveRewardedAdResult(config, await runRewardedAd(config))

      if (!reward.completed) {
        wx.showToast({
          title: reward.reason === 'incomplete'
            ? resolveCopyText(this.data.articleAdIncompleteText, 'articleAdIncomplete')
            : resolveCopyText(null, 'adUnavailable'),
          icon: 'none',
        })
        return
      }

      const detail = await unlockArticle(this.contentId, { rewarded: Boolean(hasAd && reward.completed) })
      this.applyDetail(detail)
    } catch (error) {
      wx.showToast({ title: error.message || '暂时无法展开全文，请稍后重试', icon: 'none' })
    } finally {
      this.rewardFlowActive = false
      this.setData({ unlocking: false })
    }
  },

  handleNativeAdLoad(event) {
    const key = {
      end: 'endAdHidden',
      middle: 'middleAdHidden',
      recommendation: 'recommendationAdHidden',
      start: 'startAdHidden',
    }[event.currentTarget.dataset.position] || 'startAdHidden'
    const readyKey = key.replace('Hidden', 'Ready')
    this.setData({ [key]: false, [readyKey]: true })
  },

  handleNativeAdError(event) {
    const key = {
      end: 'endAdHidden',
      middle: 'middleAdHidden',
      recommendation: 'recommendationAdHidden',
      start: 'startAdHidden',
    }[event.currentTarget.dataset.position] || 'startAdHidden'
    const readyKey = key.replace('Hidden', 'Ready')
    this.setData({ [key]: true, [readyKey]: false })
  },

  openRecommendation(event) {
    const contentId = String(event.currentTarget.dataset.id || '').trim()
    if (!contentId || contentId === this.contentId) return
    wx.redirectTo({ url: `/pages/article/article?contentId=${encodeURIComponent(contentId)}` })
  },

  handleRecommendationCoverError(event) {
    const index = Number(event.currentTarget.dataset.index)
    const item = this.data.recommendations[index]
    if (!item?.coverUrl || event.currentTarget.dataset.src !== item.coverUrl) return
    this.setData({ [`recommendations[${index}].coverUrl`]: getNextImageUrl(item.coverCandidates, item.coverUrl) })
  },

  async preparePublicShareCard({ preview = false } = {}) {
    if (!this.shareCardComposer || !this.data.article?.id) return null
    return createPublicShareCard(this.shareCardComposer, {
      source: 'article',
      item: this.data.article,
      settings: copyPack.getShareSettings(),
      preview,
    })
  },

  onShareAppMessage() {
    getApp().markShareReturn?.()
    recordShareInteraction({ source: 'article', sourceId: this.contentId }).catch(() => {})
    const settings = copyPack.getShareSettings()
    const fallbackTitle = this.data.article.title || resolveCopyText(null, 'articleShareTitle')
    const fallbackImage = getArticleCoverUrl(this.data.article.coverImage)
      || resolveFallbackCoverUrl(settings, 0, this.contentId)
    const sharePath = `/pages/article/article?contentId=${encodeURIComponent(this.contentId)}`
    const cardPromise = Promise.resolve(this.preparePublicShareCard()).then((card) => {
      this.publicShareCard = card
      return {
        title: card?.title || fallbackTitle,
        imageUrl: card?.imageUrl || fallbackImage,
        path: sharePath,
      }
    })
    // Return cached/fallback fields synchronously; promise lets WeChat wait for
    // the composed card while also warming the next invocation.
    cardPromise?.catch(() => {})
    return {
      title: this.publicShareCard?.title || fallbackTitle,
      imageUrl: this.publicShareCard?.imageUrl || fallbackImage,
      promise: cardPromise,
      path: sharePath,
    }
  },
})
