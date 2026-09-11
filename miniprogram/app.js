const { getMiniProgramAppId } = require('./config/env')
const { handleDataScopeChange, startOfflineSync } = require('./services/miniapp')
const { getStoredDataScopeId, hasPersistedSession, refreshDataScopeId, revalidateMiniAppSession } = require('./utils/request')
const { fetchCopyPack } = require('./utils/copy-pack')
const { getStartupConfig } = require('./utils/startup-config')

function getCurrentPageUrl(page) {
  if (!page?.route) return ''
  const query = Object.entries(page.options || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `/${page.route}${query ? `?${query}` : ''}`
}

function relaunchCurrentPage() {
  const pages = getCurrentPages()
  const url = getCurrentPageUrl(pages[pages.length - 1])
  if (url) wx.reLaunch({ url })
}

function getSharedHomeEntry(options = {}) {
  const path = String(options.path || '').replace(/^\/+/, '')
  const type = String(options.query?.type || '').trim()
  if (path !== 'pages/home/home' || !['text', 'audio', 'album'].includes(type)) return null
  return {
    type,
    contentId: String(options.query?.contentId || '').trim(),
    key: `${type}:${String(options.query?.contentId || '').trim()}`,
  }
}

function getSharedContentTarget(options = {}) {
  const path = String(options.path || '').replace(/^\/+/, '')
  const contentId = String(options.query?.contentId || '').trim()
  const target = path === 'pages/article/article'
    ? 'article'
    : path === 'pages/letters/letters'
      ? 'letter'
      : ''
  if (!target || !contentId) return null
  return { source: 'share', target, contentId, key: `${target}:${contentId}` }
}

function isSharedHomeEntryScene(options = {}) {
  // 微信聊天单聊、群聊和带 shareTicket 群聊的小程序分享卡入口。
  return [1007, 1008, 1044].includes(Number(options.scene))
}

App({
  globalData: {
    appId: getMiniProgramAppId(),
    systemInfo: null,
    menuButton: null,
    foregroundVersion: 0,
    shareReturnExpiresAt: 0,
    shareReturnPending: false,
    pendingSharedHomeEntry: null,
    sharedHomeEntryVersion: 0,
    pendingSharedContentTarget: null,
    sharedContentTargetVersion: 0,
  },

  onLaunch(options = {}) {
    this.captureSharedHomeEntry(options)
    this.capturePendingSharedContentTarget(options)
    this.globalData.systemInfo = wx.getWindowInfo()
    this.globalData.menuButton = wx.getMenuButtonBoundingClientRect()

    const visitorId = wx.getStorageSync('visitorId')
    if (!visitorId) {
      wx.setStorageSync('visitorId', `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)
    }
    // 启动配置统一入口：首页门与导航条都订阅这一份答案
    getStartupConfig()
      .finally(() => {
        // 启动门落定后（无论新鲜/降级）后台静默加载独立文案包，永不阻塞启动
        this.copyPackBootstrapDone = true
        fetchCopyPack({ minIntervalMs: 0 })
      })
    startOfflineSync()
  },

  onShow(options = {}) {
    const appWasHidden = this.appWasHidden === true
    // A retained Tab page does not run onLoad again. Keep each share-card
    // entry as a new event only when WeChat reports a chat share-card scene.
    // Other foreground returns may retain the old page query after sharing.
    if (appWasHidden && isSharedHomeEntryScene(options)) {
      this.captureSharedHomeEntry(options, { allowDuplicate: true })
      this.capturePendingSharedContentTarget(options, { allowDuplicate: true })
    }
    if (this.appWasHidden) {
      const shareReturn = this.globalData.shareReturnPending === true
      this.globalData.shareReturnPending = false
      if (!shareReturn) this.globalData.foregroundVersion += 1
      this.appWasHidden = false
    }
    // 数据空间复核走统一启动配置服务：30 秒内回前台不重复请求；
    // 冷启动时直接并入 onLaunch 已在途的那一次请求
    // A cold start already has startup-config validating the scope. Without a
    // persisted scope, wait for that answer instead of opening a second config
    // request immediately after the 3s fallback.
    if (getStoredDataScopeId()) refreshDataScopeId({ maxAgeMs: 30000 }).catch(() => {})
    // 文案包低成本版本校验：启动完成后每次回前台校验一次（30 秒节流），未变更时服务端只回 changed:false
    if (this.copyPackBootstrapDone) fetchCopyPack()
    if (hasPersistedSession() && typeof wx.login === 'function') revalidateMiniAppSession().catch(() => {})
  },

  onHide() {
    this.appWasHidden = true
    if (Number(this.globalData.shareReturnExpiresAt || 0) > Date.now()) {
      this.globalData.shareReturnPending = true
      this.globalData.shareReturnExpiresAt = 0
    }
  },

  markShareReturn() {
    this.globalData.shareReturnExpiresAt = Date.now() + 10000
  },

  captureSharedHomeEntry(options = {}, { allowDuplicate = false } = {}) {
    const entry = getSharedHomeEntry(options)
    if (!entry) return false
    const previous = this.globalData.pendingSharedHomeEntry
    if (!allowDuplicate && previous?.key === entry.key) return false
    this.globalData.sharedHomeEntryVersion += 1
    this.globalData.pendingSharedHomeEntry = {
      ...entry,
      version: this.globalData.sharedHomeEntryVersion,
    }
    this.globalData.pendingSharedContentTarget = null
    return true
  },

  consumeSharedHomeEntry(version) {
    const entry = this.globalData.pendingSharedHomeEntry
    if (!entry || Number(entry.version || 0) !== Number(version || 0)) return false
    this.globalData.pendingSharedHomeEntry = null
    return true
  },

  capturePendingSharedContentTarget(options = {}, { allowDuplicate = false } = {}) {
    const target = getSharedContentTarget(options)
    if (!target) return false
    const previous = this.globalData.pendingSharedContentTarget
    if (!allowDuplicate && previous?.key === target.key) return false
    this.globalData.sharedContentTargetVersion += 1
    this.globalData.pendingSharedContentTarget = {
      ...target,
      token: String(this.globalData.sharedContentTargetVersion),
    }
    this.globalData.pendingSharedHomeEntry = null
    return true
  },

  getPendingSharedContentTarget() {
    return this.globalData.pendingSharedContentTarget
  },

  consumePendingSharedContentTarget(token) {
    const target = this.globalData.pendingSharedContentTarget
    if (!target || String(target.token) !== String(token || '')) return false
    this.globalData.pendingSharedContentTarget = null
    return true
  },

  handleAccountChange({ previousAccountId, accountId }) {
    const changeKey = `${previousAccountId}->${accountId}`
    if (this.lastAccountChangeKey === changeKey) return
    this.lastAccountChangeKey = changeKey
    clearTimeout(this.accountReloadTimer)
    this.accountReloadTimer = setTimeout(relaunchCurrentPage, 0)
  },

  handleDataScopeChange({ previousDataScopeId, dataScopeId }) {
    const changeKey = `${previousDataScopeId}->${dataScopeId}`
    if (this.lastDataScopeChangeKey === changeKey) return
    this.lastDataScopeChangeKey = changeKey
    handleDataScopeChange(previousDataScopeId)
    clearTimeout(this.dataScopeReloadTimer)
    this.dataScopeReloadTimer = setTimeout(relaunchCurrentPage, 50)
  },
})
