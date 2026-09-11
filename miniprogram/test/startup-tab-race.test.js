const assert = require('node:assert/strict')
const test = require('node:test')

const TABS_PATH = require.resolve('../utils/tabs')
const STARTUP_CONFIG_PATH = require.resolve('../utils/startup-config')
const REQUEST_PATH = require.resolve('../utils/request')
const HOME_PATH = require.resolve('../pages/home/home')

function stubWx(storage = {}, switchCalls = []) {
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    removeStorageSync: (key) => { delete storage[key] },
    setStorageSync: (key, value) => { storage[key] = value },
    switchTab: (options) => switchCalls.push(options),
  }
}

function loadTabs(storage = {}, switchCalls = []) {
  delete require.cache[TABS_PATH]
  stubWx(storage, switchCalls)
  return require(TABS_PATH)
}

// 启动服务直接持有底层 sendRequest：stub 掉 request 模块即可拦截配置请求。
// saveDataScopeId 一并 stub 并记录写入，用于断言数据空间持久化时机。
const dataScopeWrites = []
function stubConfigFetcher(sendRequest) {
  dataScopeWrites.length = 0
  require.cache[REQUEST_PATH] = {
    id: REQUEST_PATH,
    filename: REQUEST_PATH,
    loaded: true,
    exports: {
      sendRequest,
      saveDataScopeId: (value) => { dataScopeWrites.push(String(value || '')) },
    },
  }
}

function loadStartupConfig() {
  delete require.cache[STARTUP_CONFIG_PATH]
  return require(STARTUP_CONFIG_PATH)
}

function cleanupServiceStubs(t) {
  t.after(() => {
    delete require.cache[REQUEST_PATH]
    delete require.cache[STARTUP_CONFIG_PATH]
    delete global.wx
  })
}

function tabsConfig(homeVisible) {
  return {
    home: { visible: homeVisible },
    articles: { visible: true },
    letters: { visible: true },
    mine: { visible: true },
  }
}

function tabsArray(tabsModule, homeVisible) {
  return tabsModule.normalizeTabs(tabsConfig(homeVisible))
}

async function tick(ms = 10) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

test('normalizeTabs keeps home hidden unless the config explicitly opts in', () => {
  const tabs = loadTabs()
  const hidden = tabs.normalizeTabs()
  assert.equal(hidden.find((item) => item.key === 'home').visible, false)
  assert.equal(hidden.find((item) => item.key === 'articles').visible, true)
  assert.equal(hidden.find((item) => item.key === 'mine').visible, true)

  const visible = tabs.normalizeTabs({ home: { visible: true } })
  assert.equal(visible.find((item) => item.key === 'home').visible, true)
  delete global.wx
})

test('startup config shares one request and broadcasts the fresh answer', async (t) => {
  loadTabs({})
  let resolveRemote
  const calls = []
  stubConfigFetcher((options) => {
    calls.push(options)
    return new Promise((resolve) => { resolveRemote = resolve })
  })
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const notifications = []
  startupConfig.onStartupConfig((result) => notifications.push(result))
  const first = startupConfig.getStartupConfig()
  assert.equal(startupConfig.getStartupConfig(), first)

  resolveRemote({ system: { tabs: tabsConfig(true) } })
  const result = await first
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/miniapp/config'))
  assert.equal(result.source, 'fresh')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, true)
  assert.equal(notifications.length, 1)

  // 已有新鲜答案后，后续调用直接返回缓存结果，不再发请求
  assert.equal(await startupConfig.getStartupConfig(), result)
  assert.equal(calls.length, 1)
})

test('startup config keeps home hidden when the remote answer stalls, even with cached tabs', async (t) => {
  loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(true)) })
  stubConfigFetcher(() => new Promise(() => {}))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const result = await startupConfig.getStartupConfig({ timeoutMs: 5 })
  assert.equal(result.source, 'timeout')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, false)
})

test('degraded startup keeps home hidden by default so review mode is never disturbed', async (t) => {
  loadTabs({})
  stubConfigFetcher(() => new Promise(() => {}))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const result = await startupConfig.getStartupConfig({ timeoutMs: 5 })
  assert.equal(result.source, 'timeout')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, false)
  assert.equal(result.tabs.find((item) => item.key === 'articles').visible, true)
})

test('a failed config degrades to cached tabs and redirects away from hidden home', async (t) => {
  const switchCalls = []
  const tabs = loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(false)) }, switchCalls)
  stubConfigFetcher(() => Promise.reject(new Error('offline')))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const result = await startupConfig.getStartupConfig({ timeoutMs: 500 })
  assert.equal(result.source, 'error')
  assert.equal(tabs.ensureVisibleTab('home', result.tabs), false)
  assert.deepEqual(switchCalls, [{ url: '/pages/articles/articles' }])
})

test('a late fresh answer still broadcasts after the timeout degrade', async (t) => {
  loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(true)) })
  let resolveRemote
  stubConfigFetcher(() => new Promise((resolve) => { resolveRemote = resolve }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const notifications = []
  startupConfig.onStartupConfig((result) => notifications.push(result))
  const degraded = await startupConfig.getStartupConfig({ timeoutMs: 5 })
  assert.equal(degraded.source, 'timeout')

  resolveRemote({ system: { tabs: tabsConfig(false) } })
  await tick()
  const latest = startupConfig.getLatestStartupConfig()
  assert.equal(latest.source, 'fresh')
  assert.equal(latest.tabs.find((item) => item.key === 'home').visible, false)
  assert.equal(notifications.length, 2)
})

test('forced resolution abandons the stalled request and ignores its late answer', async (t) => {
  loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(false)) })
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const notifications = []
  startupConfig.onStartupConfig((result) => notifications.push(result))
  const first = startupConfig.getStartupConfig({ timeoutMs: 10 })
  const forced = startupConfig.getStartupConfig({ force: true, timeoutMs: 1000 })
  assert.notEqual(forced, first)

  resolvers[0]({ system: { tabs: tabsConfig(true) } })
  await tick()
  assert.equal(notifications.length, 0)

  resolvers[1]({ system: { tabs: tabsConfig(true) } })
  const result = await forced
  assert.equal(result.source, 'fresh')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, true)
  assert.equal(notifications.length, 1)
})

test('an abandoned promise settles with the forced answer instead of hanging forever', async (t) => {
  loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(false)) })
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const first = startupConfig.getStartupConfig({ timeoutMs: 1000 })
  const forced = startupConfig.getStartupConfig({ force: true, timeoutMs: 1000 })
  assert.notEqual(forced, first)

  resolvers[1]({ system: { tabs: tabsConfig(true) } })
  // 旧 promise 不能永久悬空：必须在新答案落定时一并放行
  const settled = await Promise.race([
    first,
    new Promise((resolve) => setTimeout(() => resolve('HUNG'), 50)),
  ])
  assert.notEqual(settled, 'HUNG')
  assert.equal(settled.source, 'fresh')
  assert.equal(settled.tabs.find((item) => item.key === 'home').visible, true)

  // 迟到的旧答案仍不得覆盖已放行的新答案
  resolvers[0]({ system: { tabs: tabsConfig(false) } })
  await tick()
  const latest = startupConfig.getLatestStartupConfig()
  assert.equal(latest.tabs.find((item) => item.key === 'home').visible, true)
})

function buildHomePage(t, { storage = {}, implement } = {}) {
  const tabs = loadTabs(storage)
  const configCalls = []
  let currentPromise = null
  let latest = null
  require.cache[STARTUP_CONFIG_PATH] = {
    id: STARTUP_CONFIG_PATH,
    filename: STARTUP_CONFIG_PATH,
    loaded: true,
    exports: {
      getStartupConfig(options = {}) {
        configCalls.push(options)
        if (options.force || !currentPromise) {
          const pending = implement ? implement(options) : new Promise(() => {})
          currentPromise = pending.then((result) => {
            latest = result
            return result
          })
        }
        return currentPromise
      },
      getLatestStartupConfig: () => latest,
      onStartupConfig: () => () => {},
    },
  }

  let pageDefinition
  global.Page = (definition) => { pageDefinition = definition }
  delete require.cache[HOME_PATH]
  require(HOME_PATH)
  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data },
    loadCount: 0,
    getTabBar() { return null },
    loadHomeData() { page.loadCount = (page.loadCount || 0) + 1 },
    setData(update, callback) {
      Object.assign(this.data, update)
      if (callback) callback()
    },
    startInterstitialAd() {},
  }
  global.getCurrentPages = () => [page]
  t.after(() => {
    delete require.cache[HOME_PATH]
    delete require.cache[STARTUP_CONFIG_PATH]
    delete global.Page
    delete global.getCurrentPages
    delete global.wx
  })
  return { page, configCalls, tabs }
}

test('home keeps business content gated until the startup config resolves', async (t) => {
  let resolveConfig
  const { page, tabs } = buildHomePage(t, {
    // 生产环境中新鲜答案由统一服务写入缓存，这里预置同等缓存
    storage: { miniappSystemTabs: JSON.stringify(tabsConfig(true)) },
    implement: () => new Promise((resolve) => { resolveConfig = resolve }),
  })

  page.onShow()
  assert.equal(page.data.homeAccessResolved, false)
  assert.equal(page.loadCount, 0)

  resolveConfig({ tabs: tabsArray(tabs, true), source: 'fresh' })
  await page.homeAccessPromise
  assert.equal(page.data.homeAccessResolved, true)
  assert.equal(page.loadCount, 1)
})

test('fresh config that hides home redirects without offering the refresh button', async (t) => {
  const switchCalls = []
  let resolveConfig
  const { page, tabs } = buildHomePage(t, {
    implement: () => new Promise((resolve) => { resolveConfig = resolve }),
  })
  global.wx.switchTab = (options) => switchCalls.push(options)

  page.onShow()
  resolveConfig({ tabs: tabsArray(tabs, false), source: 'fresh' })
  await page.homeAccessPromise

  assert.equal(page.data.homeAccessResolved, false)
  assert.equal(page.loadCount, 0)
  assert.deepEqual(switchCalls, [{ url: '/pages/articles/articles' }])
})

test('fresh config that hides home and articles redirects to the first visible tab', async (t) => {
  const switchCalls = []
  const { page, tabs } = buildHomePage(t, {
    implement: () => Promise.resolve({
      tabs: tabs.normalizeTabs({
        home: { visible: false },
        articles: { visible: false },
        letters: { visible: true },
        mine: { visible: true },
      }),
      source: 'fresh',
    }),
  })
  global.wx.switchTab = (options) => switchCalls.push(options)

  page.onShow()
  await page.homeAccessPromise
  assert.equal(page.data.homeAccessResolved, false)
  assert.deepEqual(switchCalls, [{ url: '/pages/letters/letters' }])
})

test('a degraded cached answer never opens home and redirects to articles', async (t) => {
  const switchCalls = []
  const { page, tabs } = buildHomePage(t, {
    storage: { miniappSystemTabs: JSON.stringify(tabsConfig(true)) },
    implement: () => Promise.resolve({ tabs: tabsArray(tabs, true), source: 'timeout' }),
  })
  global.wx.switchTab = (options) => switchCalls.push(options)

  page.startHomeAccessDeadline(30)
  page.onShow()
  await tick(5)
  assert.deepEqual(switchCalls, [])
  await page.homeAccessPromise
  assert.equal(page.data.homeAccessResolved, false)
  assert.equal(page.loadCount, 0)
  assert.deepEqual(switchCalls, [{ url: '/pages/articles/articles' }])
})

test('home retries one degraded startup answer before opening on a fresh answer', async (t) => {
  let attempts = 0
  const { page, tabs, configCalls } = buildHomePage(t, {
    implement: (options) => {
      attempts += 1
      return Promise.resolve({
        tabs: tabsArray(tabs, true),
        source: options.force ? 'fresh' : 'timeout',
      })
    },
  })

  page.onShow()
  await page.homeAccessPromise

  assert.equal(attempts, 2)
  assert.deepEqual(configCalls, [{ force: false }, { force: true }])
  assert.equal(page.data.homeAccessResolved, true)
  assert.equal(page.loadCount, 1)
})

test('a degraded answer that hides home redirects without a refresh control', async (t) => {
  const switchCalls = []
  const { page, tabs } = buildHomePage(t, {
    storage: { miniappSystemTabs: JSON.stringify(tabsConfig(false)) },
    implement: () => Promise.resolve({ tabs: tabsArray(tabs, false), source: 'timeout' }),
  })
  global.wx.switchTab = (options) => switchCalls.push(options)

  page.startHomeAccessDeadline(5)
  page.onShow()
  await page.homeAccessPromise
  assert.equal(page.data.homeAccessResolved, false)
  assert.deepEqual(switchCalls.map(({ url }) => ({ url })), [{ url: '/pages/articles/articles' }])
})

test('home startup deadline prefers reLaunch to articles and ignores a late fresh answer', async (t) => {
  let resolveConfig
  const relaunchCalls = []
  const { page, tabs } = buildHomePage(t, {
    implement: () => new Promise((resolve) => { resolveConfig = resolve }),
  })
  global.wx.reLaunch = (options) => {
    relaunchCalls.push(options)
    options.success?.()
    options.complete?.()
  }
  global.wx.switchTab = () => { throw new Error('switchTab should not run after reLaunch success') }

  page.resolveHomeAccess({ deadlineMs: 5 })
  await tick(20)

  assert.equal(page.homeAccessNavigationStarted, true)
  assert.deepEqual(relaunchCalls.map(({ url }) => ({ url })), [{ url: '/pages/articles/articles?startupFallback=1' }])
  assert.equal(page.data.homeAccessResolved, false)

  resolveConfig({ tabs: tabsArray(tabs, true), source: 'fresh' })
  await page.homeAccessPromise
  assert.equal(page.data.homeAccessResolved, false)
  assert.equal(relaunchCalls.length, 1)
})

test('home startup deadline falls back to switchTab when reLaunch fails', async (t) => {
  const relaunchCalls = []
  const switchCalls = []
  const { page } = buildHomePage(t, { implement: () => new Promise(() => {}) })
  global.wx.reLaunch = (options) => {
    relaunchCalls.push(options)
    options.fail?.({ errMsg: 'reLaunch:fail cold start' })
    options.complete?.()
  }
  global.wx.switchTab = (options) => switchCalls.push(options)

  page.resolveHomeAccess({ deadlineMs: 5 })
  await tick(20)

  assert.deepEqual(relaunchCalls.map(({ url }) => ({ url })), [{ url: '/pages/articles/articles?startupFallback=1' }])
  assert.deepEqual(switchCalls.map(({ url }) => ({ url })), [{ url: '/pages/articles/articles' }])
})

test('an abandoned late answer never pollutes the tabs cache or broadcasts', async (t) => {
  const storage = {}
  loadTabs(storage)
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const notifications = []
  startupConfig.onStartupConfig((result) => notifications.push(result))
  const first = startupConfig.getStartupConfig({ timeoutMs: 1000 })
  const forced = startupConfig.getStartupConfig({ force: true, timeoutMs: 1000 })
  assert.notEqual(forced, first)

  // 新代先返回：首页隐藏（审核模式答案）
  resolvers[1]({ system: { tabs: tabsConfig(false) } })
  const fresh = await forced
  assert.equal(fresh.source, 'fresh')

  // 旧代迟到：首页可见 —— 不得写缓存、不得广播、不得覆盖 latest
  resolvers[0]({ system: { tabs: tabsConfig(true) } })
  await tick()

  assert.equal(notifications.length, 1)
  const latest = startupConfig.getLatestStartupConfig()
  assert.equal(latest.tabs.find((item) => item.key === 'home').visible, false)
  const cached = JSON.parse(storage.miniappSystemTabs)
  assert.equal(cached.home.visible, false)
})

test('an abandoned request timer cannot fire after a forced revalidation', async (t) => {
  loadTabs({})
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const notifications = []
  startupConfig.onStartupConfig((result) => notifications.push(result))
  startupConfig.getStartupConfig({ timeoutMs: 10 })
  const forced = startupConfig.getStartupConfig({ force: true, timeoutMs: 1000 })

  // 越过旧代超时时刻：旧计时器必须已被清除，不产生任何降级广播
  await tick(40)
  assert.equal(notifications.length, 0)
  assert.equal(startupConfig.getLatestStartupConfig(), null)

  // 旧代答案迟到同样被忽略
  resolvers[0]({ system: { tabs: tabsConfig(true) } })
  await tick()
  assert.equal(notifications.length, 0)

  resolvers[1]({ system: { tabs: tabsConfig(true) } })
  const result = await forced
  assert.equal(result.source, 'fresh')
  assert.equal(notifications.length, 1)
})

test('plain callers wait for the forced revalidation instead of the stale degraded answer', async (t) => {
  loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(false)) })
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const degraded = await startupConfig.getStartupConfig({ timeoutMs: 5 })
  assert.equal(degraded.source, 'timeout')

  const forced = startupConfig.getStartupConfig({ force: true, timeoutMs: 1000 })
  // 重取期间的普通调用必须等待新答案，而不是拿到旧的降级结果
  const plain = startupConfig.getStartupConfig()
  assert.equal(plain, forced)

  resolvers[1]({ system: { tabs: tabsConfig(true) } })
  const result = await plain
  assert.equal(result.source, 'fresh')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, true)

  // 被作废旧代的迟到结果不能覆盖新答案
  resolvers[0]({ system: { tabs: tabsConfig(false) } })
  await tick()
  assert.equal(startupConfig.getLatestStartupConfig().source, 'fresh')
})

test('startup still settles with default tabs when cache cleanup throws', async (t) => {
  loadTabs({ miniappSystemTabs: '{broken json' })
  stubConfigFetcher(() => new Promise(() => {}))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)
  // 缓存损坏且清理也失败：降级路径必须仍然落到内置默认值，promise 必须结束
  global.wx.removeStorageSync = () => { throw new Error('storage locked') }

  const result = await startupConfig.getStartupConfig({ timeoutMs: 5 })
  assert.equal(result.source, 'timeout')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, false)
  assert.equal(result.tabs.find((item) => item.key === 'articles').visible, true)
})

test('a synchronous throw from the config fetch degrades instead of rejecting', async (t) => {
  loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(true)) })
  stubConfigFetcher(() => { throw new Error('storage blew up') })
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const notifications = []
  startupConfig.onStartupConfig((result) => notifications.push(result))
  // 启动 promise 不得 rejected：同步异常必须统一走降级，门永不锁死
  const result = await startupConfig.getStartupConfig({ timeoutMs: 500 })
  assert.equal(result.source, 'error')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, false)
  assert.equal(notifications.length, 1)
  assert.equal(startupConfig.getLatestStartupConfig(), result)
})

test('a stale request that timed out before the force cannot be adopted when late', async (t) => {
  loadTabs({ miniappSystemTabs: JSON.stringify(tabsConfig(false)) })
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const notifications = []
  startupConfig.onStartupConfig((result) => notifications.push(result))
  // 第一代先超时降级（请求仍在途），随后 force 建立第二代
  const degraded = await startupConfig.getStartupConfig({ timeoutMs: 5 })
  assert.equal(degraded.source, 'timeout')
  const forced = startupConfig.getStartupConfig({ force: true, timeoutMs: 1000 })

  // 旧代迟到：不得被采纳、不得广播、不得写 tabs 缓存
  resolvers[0]({ system: { tabs: tabsConfig(true) } })
  await tick()
  assert.equal(notifications.length, 1)
  assert.equal(startupConfig.getLatestStartupConfig().source, 'timeout')

  resolvers[1]({ system: { tabs: tabsConfig(true) } })
  const result = await forced
  assert.equal(result.source, 'fresh')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, true)
  assert.equal(notifications.length, 2)
})

test('a stale config answer cannot overwrite the persisted data scope', async (t) => {
  loadTabs({})
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const first = startupConfig.getStartupConfig({ timeoutMs: 1000 })
  const forced = startupConfig.getStartupConfig({ force: true, timeoutMs: 1000 })
  assert.notEqual(forced, first)

  // 新代先返回 scope-new：代数校验通过后才持久化数据空间
  resolvers[1]({ system: { tabs: tabsConfig(true) }, dataScopeId: 'scope-new' })
  const fresh = await forced
  assert.equal(fresh.dataScopeId, 'scope-new')
  assert.deepEqual(dataScopeWrites, ['scope-new'])

  // 旧代迟到携带 scope-old：不得覆盖已持久化的新数据空间
  resolvers[0]({ system: { tabs: tabsConfig(false) }, dataScopeId: 'scope-old' })
  await tick()
  assert.deepEqual(dataScopeWrites, ['scope-new'])
  assert.equal(startupConfig.getLatestStartupConfig().dataScopeId, 'scope-new')
})

test('maxAgeMs controls whether the cached latest answer is reused', async (t) => {
  loadTabs({})
  let fetchCount = 0
  let resolveFetch
  stubConfigFetcher(() => {
    fetchCount += 1
    return new Promise((resolve) => {
      resolveFetch = (system) => resolve({ system, dataScopeId: 'scope-1' })
    })
  })
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const first = startupConfig.getStartupConfig({ timeoutMs: 1000 })
  resolveFetch(tabsConfig(true))
  const fresh = await first
  assert.equal(fresh.source, 'fresh')
  assert.equal(fresh.dataScopeId, 'scope-1')
  assert.equal(fetchCount, 1)

  // maxAge 未过：复用 latest，不发新请求
  assert.equal(await startupConfig.getStartupConfig({ maxAgeMs: 30000 }), fresh)
  assert.equal(fetchCount, 1)

  // maxAgeMs 0：强制经统一服务重取（回前台复核/离线回放语义）
  const second = startupConfig.getStartupConfig({ maxAgeMs: 0, timeoutMs: 1000 })
  assert.notEqual(second, fresh)
  resolveFetch(tabsConfig(true))
  await second
  assert.equal(fetchCount, 2)
})

test('a degraded answer is temporary and the next plain call retries', async (t) => {
  loadTabs({})
  const resolvers = []
  stubConfigFetcher(() => new Promise((resolve) => { resolvers.push(resolve) }))
  const startupConfig = loadStartupConfig()
  cleanupServiceStubs(t)

  const degraded = await startupConfig.getStartupConfig({ timeoutMs: 5 })
  assert.equal(degraded.source, 'timeout')
  const retry = startupConfig.getStartupConfig({ timeoutMs: 1000 })
  assert.equal(resolvers.length, 2)
  resolvers[1]({ system: { tabs: tabsConfig(true) }, dataScopeId: 'scope-retry' })
  const fresh = await retry
  assert.equal(fresh.source, 'fresh')
  assert.equal(fresh.dataScopeId, 'scope-retry')
})

test('the L2 cache keeps the complete config for a later offline start', async (t) => {
  const storage = {}
  loadTabs(storage)
  stubConfigFetcher(() => Promise.resolve({
    system: { tabs: tabsConfig(true), articleDisplay: { layout: 'compact' } },
    ads: { articleInterstitial: { enabled: true } },
    messagesEnabled: true,
    dataScopeId: 'scope-cache',
  }))
  const firstModule = loadStartupConfig()
  await firstModule.getStartupConfig()

  delete require.cache[STARTUP_CONFIG_PATH]
  stubConfigFetcher(() => new Promise(() => {}))
  const offlineModule = loadStartupConfig()
  const result = await offlineModule.getStartupConfig({ timeoutMs: 5 })
  assert.equal(result.source, 'timeout')
  assert.equal(result.config.ads.articleInterstitial.enabled, true)
  assert.equal(result.config.messagesEnabled, true)
  assert.equal(result.dataScopeId, 'scope-cache')
  assert.equal(result.tabs.find((item) => item.key === 'home').visible, false)
  cleanupServiceStubs(t)
})
