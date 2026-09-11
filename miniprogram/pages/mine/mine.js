const { getActivityData, getCachedActivityData, getCachedHomeData, getCachedProfileData, getHomeData, getProfileData } = require('../../services/miniapp')
const copyPack = require('../../utils/copy-pack')
const { createHistoryAudioPlayer } = require('../../utils/history-audio')
const { compactNumber, normalizeActivityItem, withPreviewParagraphs } = require('../../utils/format')
const { openImagePreview } = require('../../utils/image-preview')
const { finishInitialLoad, startInitialLoad } = require('../../utils/page-loading')
const { markListAdSlots } = require('../../utils/list-ads')
const { ensureVisibleTab, syncCustomTabBar } = require('../../utils/tabs')
const { getFontSizeMode } = require('../../utils/font-mode')
const { scheduleInterstitialAd } = require('../../utils/ads')
const { shouldKeepNativeAdHidden } = require('../../utils/native-ad')
const { getNextImageUrl } = require('../../utils/image-display')
const { getLatestStartupConfig, refreshStartupConfig } = require('../../utils/startup-config')

function decorateHistoryItem(item) {
  const images = Array.isArray(item.images) ? item.images : []
  return {
    ...item,
  }
}

function getNavigationTabs(fallback) {
  const startup = getLatestStartupConfig()
  return Array.isArray(startup?.tabs) ? startup.tabs : fallback
}

Page({
  data: {
    fontSizeMode: 'larger',
    loading: true,
    ready: false,
    showSkeleton: false,
    error: '',
    profile: {},
    summary: { totalOpened: '0', interactions: '0', messages: '0', favorites: '0' },
    histories: [],
    ads: {},
    messagesEnabled: false,
    nativeAdHidden: false,
  },

  onLoad() {
    this.historyAudio = createHistoryAudioPlayer(this, 'histories')
  },

  onShow() {
    this.setData({ fontSizeMode: getFontSizeMode() })
    if (!ensureVisibleTab('mine', getNavigationTabs())) return
    this.interstitialBlockedByExternalUi = false
    syncCustomTabBar(this, 'mine', getNavigationTabs())
    const home = getCachedHomeData()
    const profile = getCachedProfileData()
    const activity = getCachedActivityData()
    this.applyData(home, profile, activity)
    startInitialLoad(this, Boolean(activity || this.data.ready))
    this.loadData()
    if (this.data.nativeAdHidden) this.setData({ nativeAdHidden: false })
    this.startInterstitialAd()
  },

  onHide() {
    this.historyAudio?.pause()
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  onUnload() {
    this.historyAudio?.destroy()
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  startInterstitialAd() {
    if (this.interstitialBlockedByExternalUi || this.interstitialDispose) return
    this.interstitialDispose = scheduleInterstitialAd(this.data.ads.mineInterstitial, 'mine', {
      isIdle: () => !this.data.loading && !this.refreshing,
    })
  },

  pauseInterstitialUntilNextShow() {
    this.interstitialBlockedByExternalUi = true
    this.interstitialDispose?.()
    this.interstitialDispose = null
  },

  applyData(home, profileData, activity) {
    const next = { error: '' }
    if (home) {
      this.articleShareSettings = copyPack.getShareSettings()
      const tabs = getNavigationTabs(home.system || {})
      if (ensureVisibleTab('mine', tabs)) syncCustomTabBar(this, 'mine', tabs)
      const ads = home.ads || {}
      next.ads = ads
      next.messagesEnabled = home.messagesEnabled === true
      next.nativeAdHidden = shouldKeepNativeAdHidden({
        previousAds: this.data.ads,
        nextAds: ads,
        placement: 'mineNative',
        hidden: this.data.nativeAdHidden,
      })
    }
    if (profileData) next.profile = profileData.profile || {}
    if (activity) {
      const nativeAd = home?.ads?.mineNative || this.data.ads.mineNative || {}
      this.historyAudio?.reset()
      next.ready = true
      next.summary = {
        totalOpened: compactNumber((activity.summary && activity.summary.totalOpened) || 0),
        interactions: compactNumber((activity.summary && activity.summary.interactions) || 0),
        messages: compactNumber((activity.summary && activity.summary.messages) || 0),
        favorites: compactNumber((activity.summary && activity.summary.favorites) || 0),
      }
      const histories = activity.totalOpened || (profileData && profileData.histories) || []
      next.histories = markListAdSlots(
        histories.slice(0, 20).map((item, index) => decorateHistoryItem(withPreviewParagraphs(normalizeActivityItem(item, {
          shareSettings: this.articleShareSettings,
          displayIndex: index,
        })))),
        nativeAd.firstAfter || 3,
        nativeAd.interval || 10,
      )
    }
    if (Object.keys(next).length) this.setData(next)
  },

  async loadData(options = {}) {
    try {
      const [home, profileData, activity] = await Promise.all([
        getHomeData(options),
        getProfileData(options),
        getActivityData({ ...options, section: 'opened' }),
      ])
      if (!ensureVisibleTab('mine', getNavigationTabs(home.system || {}))) return
      this.applyData(home, profileData, activity)
      this.startInterstitialAd()
    } catch (error) {
      const message = error.message || '阅读记录加载失败，请稍后再试'
      if (!this.data.ready) this.setData({ error: message })
      if (options.notify) wx.showToast({ title: message, icon: 'none' })
    } finally {
      finishInitialLoad(this)
    }
  },

  async onPullDownRefresh() {
    this.refreshing = true
    try {
      await refreshStartupConfig().catch(() => {})
      await this.loadData({ force: true, notify: true })
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

  goProfile() { wx.navigateTo({ url: '/pages/profile/profile' }) },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }) },
  goHistory() { wx.navigateTo({ url: '/pages/opened-history/opened-history' }) },
  goInteractions() { wx.navigateTo({ url: '/pages/interactions/interactions' }) },
  goMessages() {
    if (this.data.messagesEnabled === false) return
    wx.navigateTo({ url: '/pages/messages/messages' })
  },
  goFavorites() { wx.navigateTo({ url: '/pages/favorites/favorites' }) },

  openActivityItem(event) {
    const item = this.data.histories[event.currentTarget.dataset.index] || {}
    if (item.isArticle && item.sourceId) {
      wx.navigateTo({ url: `/pages/article/article?contentId=${encodeURIComponent(item.sourceId)}` })
    }
  },

  previewHistoryImage(event) {
    const item = this.data.histories[event.currentTarget.dataset.index] || {}
    return openImagePreview(this, item.images, event.currentTarget.dataset.imageIndex)
  },

  handleHistoryCoverError(event) {
    const index = Number(event.currentTarget.dataset.index)
    const item = this.data.histories[index]
    if (!item?.coverUrl || event.currentTarget.dataset.src !== item.coverUrl) return
    this.setData({ [`histories[${index}].coverUrl`]: getNextImageUrl(item.coverCandidates, item.coverUrl) })
  },

  handleHistoryImageError(event) {
    const { index, imageIndex, src } = event.currentTarget.dataset
    const image = this.data.histories[index]?.images?.[imageIndex]
    if (!image?.displayUrl || src !== image.displayUrl) return
    this.setData({ [`histories[${index}].images[${imageIndex}].displayUrl`]: getNextImageUrl(image.displayCandidates, image.displayUrl) })
  },

  toggleHistoryAudio(event) {
    this.historyAudio?.toggle(event.currentTarget.dataset.id)
  },
})
