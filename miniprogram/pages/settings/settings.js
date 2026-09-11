const { getDevelopmentDataSources, getEnvConfig, switchEnv } = require('../../config/env')
const { getFontSizeMode, setFontSizeMode } = require('../../utils/font-mode')
const { getStartupConfig, resetStartupConfigState } = require('../../utils/startup-config')
const { resetCopyPackState } = require('../../utils/copy-pack')

const ACCOUNT_DELETION_EMAIL = '609307776@qq.com'
const FONT_SIZE_OPTIONS = ['普通', '较大', '最大']

function getFontSizeModeIndex(mode) {
  return mode === 'max' ? 2 : mode === 'larger' ? 1 : 0
}

Page({
  data: {
    developerEmail: ACCOUNT_DELETION_EMAIL,
    showDataSourceSelector: false,
    dataSources: [],
    dataSourceIndex: 0,
    fontSizeOptions: FONT_SIZE_OPTIONS,
    fontSizeModeIndex: 1,
    fontSizeMode: 'larger',
  },

  onLoad() {
    const dataSources = getDevelopmentDataSources()
    const currentName = getEnvConfig().name
    const dataSourceIndex = Math.max(0, dataSources.findIndex((item) => item.name === currentName))
    const fontSizeMode = getFontSizeMode()
    this.setData({
      showDataSourceSelector: Boolean(dataSources.length),
      dataSources,
      dataSourceIndex,
      fontSizeMode,
      fontSizeModeIndex: getFontSizeModeIndex(fontSizeMode),
    })
    this.loadDeveloperContact()
  },

  onShow() {
    this.loadDeveloperContact()
    const fontSizeMode = getFontSizeMode()
    this.setData({ fontSizeMode, fontSizeModeIndex: getFontSizeModeIndex(fontSizeMode) })
  },

  handleFontSizeChange(event) {
    const index = Number(event.detail.value)
    const mode = setFontSizeMode(index === 2 ? 'max' : index === 1 ? 'larger' : 'normal')
    this.setData({ fontSizeMode: mode, fontSizeModeIndex: getFontSizeModeIndex(mode) })
    const pages = getCurrentPages()
    pages.forEach((page) => {
      if (page.data && page.data.fontSizeMode !== undefined) page.setData({ fontSizeMode: mode })
    })
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ fontSizeMode: mode })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  navigate(event) {
    wx.navigateTo({ url: event.currentTarget.dataset.url })
  },

  openOfficialPrivacy() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '请升级微信后查看', icon: 'none' })
      return
    }
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '正式隐私保护指引暂时无法打开', icon: 'none' }),
    })
  },

  handleDataSourceChange(event) {
    const next = this.data.dataSources[Number(event.detail.value)]
    if (!next || !switchEnv(next.name)) return
    resetStartupConfigState()
    resetCopyPackState()
    wx.removeStorageSync('miniappSystemTabs')
    wx.reLaunch({ url: '/pages/home/home' })
  },

  async loadDeveloperContact() {
    try {
      // 开发者邮箱读统一启动配置服务（普通调用复用 latest，不另起配置请求）
      const startup = await getStartupConfig()
      const email = String(startup.config?.miniProgram?.developerEmail || '').trim()
      if (email) this.setData({ developerEmail: email })
    } catch (error) {
      // Keep the configured fallback when the contact endpoint is temporarily unavailable.
    }
  },

  requestDelete() {
    wx.showModal({
      title: '申请注销账号',
      content: `请发送注销申请至${this.data.developerEmail || ACCOUNT_DELETION_EMAIL}，并注明需要注销的小程序名称和对应的账号信息。`,
      cancelText: '关闭',
      confirmText: '知道了',
    })
  },
})
