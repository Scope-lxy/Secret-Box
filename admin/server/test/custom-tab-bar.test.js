const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const customTabBarPath = path.resolve(__dirname, '../../../miniprogram/custom-tab-bar/index.js')
const tabsPath = path.resolve(__dirname, '../../../miniprogram/utils/tabs.js')

function loadCustomTabBar() {
  let definition
  const previousComponent = global.Component
  global.Component = (value) => { definition = value }
  delete require.cache[customTabBarPath]
  try {
    require(customTabBarPath)
    return definition
  } finally {
    if (previousComponent === undefined) delete global.Component
    else global.Component = previousComponent
  }
}

function createTabBarInstance(definition) {
  const instance = {
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch) },
  }
  Object.assign(instance, definition.methods)
  return instance
}

test('custom tab bar ignores the current tab without locking later switches', () => {
  const originalWx = global.wx
  const originalGetCurrentPages = global.getCurrentPages
  const switchCalls = []
  const currentPage = { route: 'pages/home/home' }
  global.getCurrentPages = () => [currentPage]
  global.wx = {
    switchTab(options) { switchCalls.push(options) },
  }

  try {
    const instance = createTabBarInstance(loadCustomTabBar())
    instance.switchTab({ currentTarget: { dataset: { path: 'pages/home/home' } } })
    assert.equal(switchCalls.length, 0)

    instance.switchTab({ currentTarget: { dataset: { path: 'pages/letters/letters' } } })
    instance.switchTab({ currentTarget: { dataset: { path: 'pages/articles/articles' } } })
    assert.equal(switchCalls.length, 2)
    assert.equal(instance.data.selectedKey, 'articles')
    assert.equal(instance.isSwitching, undefined)

    currentPage.route = 'pages/letters/letters'
    switchCalls[0].complete()
    assert.equal(instance.data.selectedKey, 'letters')

    instance.switchTab({ currentTarget: { dataset: { path: 'pages/articles/articles' } } })
    assert.equal(switchCalls.length, 3)
    currentPage.route = 'pages/articles/articles'
    switchCalls[2].complete()
    assert.equal(instance.data.selectedKey, 'articles')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
    if (originalGetCurrentPages === undefined) delete global.getCurrentPages
    else global.getCurrentPages = originalGetCurrentPages
  }
})

test('syncCustomTabBar keeps cached tabs but skips a hidden page instance', () => {
  const originalWx = global.wx
  const originalGetCurrentPages = global.getCurrentPages
  const storage = new Map()
  const visiblePage = { route: 'pages/home/home' }
  let applyCalls = 0
  const hiddenPage = {
    route: 'pages/letters/letters',
    getTabBar() {
      return { applyTabs() { applyCalls += 1 } }
    },
  }
  global.getCurrentPages = () => [visiblePage]
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
  }
  delete require.cache[tabsPath]

  try {
    const { syncCustomTabBar } = require(tabsPath)
    const tabs = syncCustomTabBar(hiddenPage, 'letters', {
      tabs: { letters: { label: '心笺', visible: true } },
    })
    assert.equal(applyCalls, 0)
    assert.equal(tabs.find((item) => item.key === 'letters').text, '心笺')
    assert.equal(typeof storage.get('miniappSystemTabs'), 'string')
  } finally {
    delete require.cache[tabsPath]
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
    if (originalGetCurrentPages === undefined) delete global.getCurrentPages
    else global.getCurrentPages = originalGetCurrentPages
  }
})
