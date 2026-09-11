const TAB_STORAGE_KEY = 'miniappSystemTabs'

const defaultTabs = [
  {
    key: 'home',
    pagePath: 'pages/home/home',
    text: '首页',
    icon: '/assets/icons/tab-home.svg',
    activeIcon: '/assets/icons/tab-home-active.svg',
    // 审核兜底：代码默认隐藏首页，服务器配置明确 visible: true 才可见
    visible: false,
    locked: true,
  },
  {
    key: 'articles',
    pagePath: 'pages/articles/articles',
    text: '文章',
    icon: '/assets/icons/tab-articles.svg',
    activeIcon: '/assets/icons/tab-articles-active.svg',
    visible: true,
  },
  {
    key: 'letters',
    pagePath: 'pages/letters/letters',
    text: '心笺',
    icon: '/assets/icons/tab-letters.svg',
    activeIcon: '/assets/icons/tab-letters-active.svg',
    visible: true,
  },
  {
    key: 'mine',
    pagePath: 'pages/mine/mine',
    text: '我的',
    icon: '/assets/icons/tab-profile.svg',
    activeIcon: '/assets/icons/tab-profile-active.svg',
    visible: true,
    locked: true,
  },
]

function cloneTabs(items = defaultTabs) {
  return items.map((item) => ({ ...item }))
}

function compactLabel(value, fallback) {
  const label = String(value || '').trim()
  const text = label || fallback
  return text.length > 4 ? `${text.slice(0, 4)}…` : text
}

function normalizeTabs(systemTabs = {}) {
  const tabs = cloneTabs(defaultTabs).map((item) => {
    const incoming = systemTabs[item.key] || {}
    return {
      ...item,
      text: item.key === 'home' || item.key === 'mine' ? item.text : compactLabel(incoming.label, item.text),
      // mine 永远可见；home 采用 opt-in（默认隐藏，配置明确 true 才可见，审核 fail-safe）；
      // 其余 tab 未明确隐藏即可见。
      visible: item.key === 'mine'
        ? true
        : item.key === 'home'
          ? incoming.visible === true
          : incoming.visible !== false,
    }
  })

  return tabs
}

function getCachedTabs() {
  try {
    const cached = wx.getStorageSync(TAB_STORAGE_KEY)
    if (cached) return normalizeTabs(JSON.parse(cached))
  } catch (error) {
    wx.removeStorageSync(TAB_STORAGE_KEY)
  }
  return normalizeTabs()
}

function saveTabsFromSystem(system = {}) {
  const tabs = normalizeTabs(system.tabs || {})
  wx.setStorageSync(TAB_STORAGE_KEY, JSON.stringify(Object.fromEntries(tabs.map((item) => [
    item.key,
    { label: item.text, visible: item.visible, locked: item.locked },
  ]))))
  return tabs
}

function getVisibleTabs(system) {
  const tabs = resolveTabs(system)
  return tabs.filter((item) => item.visible)
}

function resolveTabs(systemOrTabs) {
  if (Array.isArray(systemOrTabs)) return cloneTabs(systemOrTabs)
  return systemOrTabs ? normalizeTabs(systemOrTabs.tabs || {}) : getCachedTabs()
}

function getFirstVisibleTab(systemOrTabs) {
  return resolveTabs(systemOrTabs).find((item) => item.visible) || defaultTabs[defaultTabs.length - 1]
}

function routeToKey(route = '') {
  const normalizedRoute = String(route || '').replace(/^\//, '')
  const tab = defaultTabs.find((item) => item.pagePath === normalizedRoute || item.key === normalizedRoute)
  return tab ? tab.key : normalizedRoute
}

function isTabVisible(keyOrRoute, system) {
  const key = routeToKey(keyOrRoute)
  const tabs = resolveTabs(system)
  const tab = tabs.find((item) => item.key === key || item.pagePath === key)
  return !tab || tab.visible
}

function ensureVisibleTab(keyOrRoute, system) {
  if (isTabVisible(keyOrRoute, system)) return true
  const target = getFirstVisibleTab(system)
  wx.switchTab({ url: `/${target.pagePath}` })
  return false
}

function syncCustomTabBar(page, keyOrRoute, system) {
  const tabs = Array.isArray(system) ? cloneTabs(system) : system ? saveTabsFromSystem(system) : getCachedTabs()
  if (!page || typeof page.getTabBar !== 'function') return tabs
  const pages = getCurrentPages()
  if (!pages.length || pages[pages.length - 1] !== page) return tabs
  const tabBar = page.getTabBar()
  if (tabBar && typeof tabBar.applyTabs === 'function') {
    tabBar.applyTabs(tabs, routeToKey(keyOrRoute))
  }
  return tabs
}

module.exports = {
  defaultTabs,
  ensureVisibleTab,
  getCachedTabs,
  getFirstVisibleTab,
  getVisibleTabs,
  isTabVisible,
  normalizeTabs,
  routeToKey,
  saveTabsFromSystem,
  syncCustomTabBar,
}
