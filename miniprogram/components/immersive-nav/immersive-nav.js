const app = getApp()
const { ensureVisibleTab } = require('../../utils/tabs')

Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    variant: {
      type: String,
      value: 'plain',
    },
    showTitle: {
      type: Boolean,
      value: false,
    },
    hero: {
      type: Boolean,
      value: false,
    },
    back: {
      type: Boolean,
      value: false,
    },
    backToHome: {
      type: Boolean,
      value: false,
    },
    interceptBack: {
      type: Boolean,
      value: false,
    },
    refreshing: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    statusBarHeight: 44,
    navHeight: 44,
    navTotalHeight: 88,
    rightPadding: 112,
  },

  lifetimes: {
    attached() {
      const systemInfo = app.globalData.systemInfo || wx.getWindowInfo()
      const menuButton = app.globalData.menuButton || wx.getMenuButtonBoundingClientRect()
      const statusBarHeight = systemInfo.statusBarHeight || 44
      const navHeight = Math.max(44, menuButton.bottom + menuButton.top - statusBarHeight * 2)
      const capsuleRight = Math.max(10, systemInfo.windowWidth - menuButton.right)

      this.setData({
        statusBarHeight,
        navHeight,
        navTotalHeight: statusBarHeight + navHeight,
        rightPadding: menuButton.width + capsuleRight + 8,
      })
    },
  },

  methods: {
    handleBack() {
      if (this.data.interceptBack) {
        this.triggerEvent('back')
        return
      }
      if (this.data.backToHome) {
        if (ensureVisibleTab('home')) wx.switchTab({ url: '/pages/home/home' })
        return
      }
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 })
        return
      }
      if (ensureVisibleTab('home')) wx.switchTab({ url: '/pages/home/home' })
    },
  },
})
