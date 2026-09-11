const { getCachedTabs, getFirstVisibleTab, normalizeTabs, routeToKey } = require('../utils/tabs')
const { getLatestStartupConfig, getStartupConfig, onStartupConfig } = require('../utils/startup-config')
const { getFontSizeMode } = require('../utils/font-mode')

Component({
  data: {
    fontSizeMode: 'larger',
    items: normalizeTabs(),
    visibleItems: normalizeTabs().filter((item) => item.visible),
    selectedKey: 'home',
  },

  lifetimes: {
    attached() {
      this.setData({ fontSizeMode: getFontSizeMode() })
      // 启动未决：只绘制安全导航，不跳转；跳转决策统一交给启动配置结果
      // Cached tabs may come from an earlier session that had opted into home.
      // Until this launch receives a fresh server answer, keep home hidden so
      // a cold start/offline compile never exposes it briefly.
      const cachedTabs = getCachedTabs().map((item) => (
        item.key === 'home' ? { ...item, visible: false } : item
      ))
      this.applyTabs(cachedTabs, null, { navigate: false })
      // 订阅统一启动配置：新答案到达时随广播更新，不再自己发请求
      this.detachStartupConfig = onStartupConfig((result) => this.applyTabs(result.tabs))
      getStartupConfig()
    },
    detached() {
      if (this.detachStartupConfig) this.detachStartupConfig()
    },
  },

  pageLifetimes: {
    show() {
      this.syncSelectedByRoute()
      const latest = getLatestStartupConfig()
      if (latest) this.applyTabs(latest.tabs)
    },
  },

  methods: {
    applyTabs(tabs, selectedKey, options = {}) {
      const items = (tabs || []).map((item) => ({ ...item }))
      const visibleItems = items.filter((item) => item.visible)
      const nextSelectedKey = selectedKey || this.getCurrentKey()

      this.setData({
        items,
        visibleItems,
        selectedKey: nextSelectedKey,
      })

      // 绘制阶段（options.navigate === false）不做跳转；
      // 启动结果到达（广播 / show）后才执行“当前页不可见 → 落第一个可见页”。
      if (options.navigate === false) return
      const selectedTab = items.find((item) => item.key === nextSelectedKey)
      // home.js owns the startup gate and redirects when home is hidden. Keep
      // the tab bar from issuing a second switchTab for that same result.
      if (selectedTab && !selectedTab.visible && this.getCurrentKey() !== 'home') {
        wx.switchTab({ url: `/${getFirstVisibleTab(items).pagePath}` })
      }
    },

    getCurrentKey() {
      const pages = getCurrentPages()
      const route = pages.length ? pages[pages.length - 1].route : 'pages/home/home'
      return routeToKey(route)
    },

    syncSelectedByRoute() {
      this.setData({ selectedKey: this.getCurrentKey() })
    },

    switchTab(event) {
      const path = String(event.currentTarget.dataset.path || '').replace(/^\//, '')
      if (!path || path === this.getCurrentRoute()) return

      this.setData({ selectedKey: routeToKey(path) })
      try {
        wx.switchTab({
          url: `/${path}`,
          complete: () => {
            this.syncSelectedByRoute()
          },
        })
      } catch (error) {
        this.syncSelectedByRoute()
      }
    },

    getCurrentRoute() {
      const pages = getCurrentPages()
      return pages.length ? pages[pages.length - 1].route : 'pages/home/home'
    },
  },
})
