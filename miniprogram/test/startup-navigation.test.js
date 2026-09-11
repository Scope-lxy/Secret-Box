const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')

const TABS_PATH = require.resolve('../utils/tabs')
const TABBAR_PATH = require.resolve('../custom-tab-bar/index')
const STARTUP_CONFIG_PATH = require.resolve('../utils/startup-config')
const MINIAPP_SERVICE_PATH = require.resolve('../services/miniapp')
const ARTICLES_PATH = require.resolve('../pages/articles/articles')

function tabsConfig(homeVisible) {
  return {
    home: { visible: homeVisible },
    articles: { visible: true },
    letters: { visible: true },
    mine: { visible: true },
  }
}

async function tick(ms = 10) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function stubWx(storage = {}, switchCalls = []) {
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    switchTab: (options) => switchCalls.push(options),
  }
}

function installStartupConfigStub(exports) {
  require.cache[STARTUP_CONFIG_PATH] = {
    id: STARTUP_CONFIG_PATH,
    filename: STARTUP_CONFIG_PATH,
    loaded: true,
    exports,
  }
}

function installMiniappServiceStub(exports) {
  require.cache[MINIAPP_SERVICE_PATH] = {
    id: MINIAPP_SERVICE_PATH,
    filename: MINIAPP_SERVICE_PATH,
    loaded: true,
    exports,
  }
}

test('custom tab bar draws the safe default without navigating before startup resolves', async (t) => {
  const storage = {}
  const switchCalls = []
  stubWx(storage, switchCalls)
  delete require.cache[TABS_PATH]
  require(TABS_PATH)

  let startupListener = null
  installStartupConfigStub({
    getStartupConfig: () => new Promise(() => {}),
    getLatestStartupConfig: () => null,
    onStartupConfig: (listener) => {
      startupListener = listener
      return () => {}
    },
  })

  let definition
  global.Component = (def) => { definition = def }
  delete require.cache[TABBAR_PATH]
  require(TABBAR_PATH)

  const tabBar = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.assign(this.data, update) },
    ...definition.methods,
    ...definition.lifetimes,
  }
  global.getCurrentPages = () => [{ route: 'pages/home/home' }]
  t.after(() => {
    delete require.cache[TABBAR_PATH]
    delete require.cache[STARTUP_CONFIG_PATH]
    delete global.Component
    delete global.getCurrentPages
    delete global.wx
  })

  // 启动未决：只绘制安全导航（默认隐藏首页），绝不跳转
  tabBar.attached()
  assert.equal(switchCalls.length, 0)
  assert.equal(tabBar.data.visibleItems.some((item) => item.key === 'home'), false)

  // 广播新配置：首页可见 → 补上首页项，当前页仍是首页，无需跳转
  startupListener({ tabs: require(TABS_PATH).normalizeTabs(tabsConfig(true)), source: 'fresh' })
  assert.equal(tabBar.data.visibleItems.some((item) => item.key === 'home'), true)
  assert.equal(switchCalls.length, 0)

  // 广播审核模式：当前页不可见 → 落第一个可见页
  startupListener({ tabs: require(TABS_PATH).normalizeTabs(tabsConfig(false)), source: 'fresh' })
  // home.js owns this redirect; the tab bar only updates its items.
  assert.deepEqual(switchCalls, [])
})

test('custom tab bar hides cached home until a fresh startup answer arrives', () => {
  const storage = {
    miniappSystemTabs: JSON.stringify({ home: { visible: true }, articles: { visible: true }, letters: { visible: true }, mine: { visible: true } }),
  }
  stubWx(storage, [])
  delete require.cache[TABS_PATH]
  require(TABS_PATH)
  installStartupConfigStub({
    getStartupConfig: () => new Promise(() => {}),
    getLatestStartupConfig: () => null,
    onStartupConfig: () => () => {},
  })
  let definition
  global.Component = (def) => { definition = def }
  delete require.cache[TABBAR_PATH]
  require(TABBAR_PATH)
  const tabBar = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.assign(this.data, update) },
    ...definition.methods,
    ...definition.lifetimes,
  }
  global.getCurrentPages = () => [{ route: 'pages/home/home' }]
  tabBar.attached()
  assert.equal(tabBar.data.visibleItems.some((item) => item.key === 'home'), false)
  delete require.cache[TABBAR_PATH]
  delete require.cache[STARTUP_CONFIG_PATH]
  delete global.Component
  delete global.getCurrentPages
  delete global.wx
})

test('articles page applies the shared startup answer after a faster article response', () => {
  const source = fs.readFileSync(ARTICLES_PATH, 'utf8')
  assert.match(source, /const startupPromise = getStartupConfig\(\)[\s\S]*this\.refreshingRequest = getArticles\(\{ \...options, includeId: requestedSharedContentId \}\)/)
  assert.match(source, /this\.applyConfig\(result\.config \|\| \{\}, result\.tabs, \{ startupSource: result\?\.source \}\)/)
  assert.match(source, /this\.applyConfig\(latest\.config \|\| \{\}, latest\.tabs, \{ startupSource: latest\.source \}\)/)
  assert.match(source, /startupFallback/)
})

test('home page keeps startup tabs authoritative over the home payload', () => {
  const source = fs.readFileSync(require.resolve('../pages/home/home'), 'utf8')
  assert.match(source, /const startup = getLatestStartupConfig\(\)[\s\S]*const navigationTabs = Array\.isArray\(startup\?\.tabs\)/)
  assert.match(source, /ensureVisibleTab\('home', navigationTabs\)/)
  assert.match(source, /syncCustomTabBar\(this, 'home', navigationTabs\)/)
})

test('startup skeleton is a registered reusable component', () => {
  const app = JSON.parse(fs.readFileSync(require.resolve('../app.json'), 'utf8'))
  assert.equal(app.usingComponents.skeleton, '/components/skeleton/skeleton')
  for (const file of ['skeleton.js', 'skeleton.wxml', 'skeleton.wxss', 'skeleton.json']) {
    assert.ok(fs.existsSync(require('node:path').join(__dirname, '../components/skeleton', file)))
  }
})
