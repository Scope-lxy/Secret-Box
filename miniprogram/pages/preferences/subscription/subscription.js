// 当前版本没有入口访问此页面；保留原始交互代码供未来恢复订阅能力时使用。
const { getCachedPreferences, getPreferences, updatePreferences } = require('../../../services/miniapp')
const { getFontSizeMode } = require('../../../utils/font-mode')

Page({
  data: {
    fontSizeMode: 'larger',
    error: '',
    subscriptions: {
      newContent: true,
      dailyRemind: true,
    },
  },

  onLoad() {
    this.setData({ fontSizeMode: getFontSizeMode() })
    const cached = getCachedPreferences()
    if (cached) this.applyPreferences(cached)
    this.loadData()
  },

  onShow() {
    this.setData({ fontSizeMode: getFontSizeMode() })
  },

  applyPreferences(data) {
    const subscriptions = data.preferences && data.preferences.subscriptions ? data.preferences.subscriptions : {}
    this.setData({ subscriptions: { ...this.data.subscriptions, ...subscriptions } })
  },

  async loadData() {
    try {
      this.applyPreferences(await getPreferences())
    } catch (error) {
      const message = error.message || '订阅偏好加载失败，请稍后再试'
      this.setData({ error: message })
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  async handleToggle(event) {
    const key = event.currentTarget.dataset.key
    const previousSubscriptions = this.data.subscriptions
    const subscriptions = { ...previousSubscriptions, [key]: event.detail.value }
    this.setData({ subscriptions })
    try {
      await updatePreferences({ subscriptions })
      wx.showToast({ title: '已保存', icon: 'none' })
    } catch (error) {
      this.setData({ subscriptions: previousSubscriptions })
      wx.showToast({ title: error.message || '保存失败，请稍后再试', icon: 'none' })
    }
  },
})
