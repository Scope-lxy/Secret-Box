const { getActivityData, getCachedActivityData, getCachedHomeData, getHomeData } = require('../../services/miniapp')
const { normalizeActivityListItem, withPreviewParagraphs } = require('../../utils/format')
const { createHistoryAudioPlayer } = require('../../utils/history-audio')
const { scheduleInterstitialAd } = require('../../utils/ads')
const { markListAdSlots } = require('../../utils/list-ads')
const { shouldKeepNativeAdHidden } = require('../../utils/native-ad')
const { finishInitialLoad, startInitialLoad } = require('../../utils/page-loading')
const { getFontSizeMode } = require('../../utils/font-mode')
const { refreshStartupConfig } = require('../../utils/startup-config')

Page({
  data: { fontSizeMode: 'larger', loading: true, ready: false, showSkeleton: false, error: '', items: [], ads: {}, messagesEnabled: false, nativeAdHidden: false },
  onLoad() { this.historyAudio = createHistoryAudioPlayer(this, 'items') },
  onShow() {
    this.setData({ fontSizeMode: getFontSizeMode() })
    const home = getCachedHomeData()
    const cached = getCachedActivityData()
    if (home) this.applyHomeData(home)
    if (cached) this.applyData(cached, home?.ads)
    startInitialLoad(this, Boolean(cached || this.data.ready))
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
    if (this.interstitialDispose) return
    this.interstitialDispose = scheduleInterstitialAd(this.data.ads.mineInterstitial, 'messages', {
      isIdle: () => !this.data.loading && !this.refreshing && !this.loadingMore,
    })
  },
  applyHomeData(data) {
    const ads = data?.ads || {}
    this.setData({
      ads,
      messagesEnabled: data?.messagesEnabled === true,
      nativeAdHidden: shouldKeepNativeAdHidden({
        previousAds: this.data.ads,
        nextAds: ads,
        placement: 'mineNative',
        hidden: this.data.nativeAdHidden,
      }),
    })
  },
  applyData(data, ads = this.data.ads, append = false) {
    const nativeAd = ads?.mineNative || {}
    this.activityPagination = data.pagination || this.activityPagination || { page: 1, totalPages: 1 }
    const incoming = (data.messages || []).map((item) => withPreviewParagraphs(normalizeActivityListItem(item)))
    const items = append ? [...this.data.items, ...incoming] : incoming
    this.setData({
      error: '',
      ready: true,
      items: markListAdSlots(items, nativeAd.firstAfter || 3, nativeAd.interval || 10),
    })
    this.historyAudio?.reset()
  },
  async loadData(options = {}) {
    try {
      const [home, activity] = await Promise.all([getHomeData(options), getActivityData({ ...options, section: 'messages' })])
      this.applyHomeData(home)
      this.applyData(activity, home.ads)
      this.startInterstitialAd()
    } catch (error) {
      const message = error.message || '留言加载失败，请稍后再试'
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

  async onReachBottom() {
    const pagination = this.activityPagination || {}
    if (this.loadingMore || Number(pagination.page || 1) >= Number(pagination.totalPages || 1)) return
    this.loadingMore = true
    try {
      const activity = await getActivityData({ section: 'messages', page: Number(pagination.page || 1) + 1 })
      this.applyData(activity, this.data.ads, true)
    } catch (error) {
      wx.showToast({ title: error.message || '加载更多失败', icon: 'none' })
    } finally {
      this.loadingMore = false
    }
  },

  previewMessageImage(event) {
    const index = Number(event.detail?.imageIndex || 0)
    const itemIndex = Number(event.currentTarget.dataset.itemIndex || 0)
    const item = this.data.items[itemIndex] || {}
    const urls = (item.images || []).map((image) => image.displayUrl).filter(Boolean)
    if (urls.length) wx.previewImage({ current: urls[index] || urls[0], urls })
  },

  handleNativeAdError() {
    this.setData({ nativeAdHidden: true, nativeAdReady: false })
  },

  handleNativeAdLoad() {
    this.setData({ nativeAdHidden: false, nativeAdReady: true })
  },
  toggleHistoryAudio(event) {
    this.historyAudio?.toggle(event.detail?.id)
  },
})
