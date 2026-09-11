const assert = require('node:assert/strict')
const test = require('node:test')

const COPY_PACK_PATH = require.resolve('../utils/copy-pack')
const DEFAULT_COPY_PATH = require.resolve('../utils/default-copy')
const MINIAPP_SERVICE_PATH = require.resolve('../services/miniapp')

const DEFAULT_COPY = require('../utils/default-copy')
const CACHE_KEY = 'copy-pack-cache-v2:prod:unknown'

function stubWx(storage = {}) {
  global.wx = {
    getStorageSync: (key) => (key in storage ? storage[key] : ''),
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
  }
  return storage
}

function stubMiniappService(getCopyPack) {
  require.cache[MINIAPP_SERVICE_PATH] = {
    id: MINIAPP_SERVICE_PATH,
    filename: MINIAPP_SERVICE_PATH,
    loaded: true,
    exports: { getCopyPack },
  }
}

function loadCopyPack(storage) {
  stubWx(storage)
  delete require.cache[COPY_PACK_PATH]
  return require(COPY_PACK_PATH)
}

function fullPack(overrides = {}) {
  return {
    checkinBeforeTexts: ['后台配置的打卡前文案'],
    checkinAfterTexts: ['后台配置的打卡后文案'],
    dailyContentPromptTexts: ['后台配置，手记提示语'],
    share: {
      version: 3,
      private: {
        coverCopyEnabled: true,
        pools: {
          text: { titles: [{ id: 't1', title: '后台手记标题' }], coverCopies: [{ id: 'c1', text: '后台封面文案' }] },
          image: { titles: [{ id: 't2', title: '后台图册标题' }], coverCopies: [{ id: 'c2', text: '后台图册封面' }] },
          audio: { titles: [{ id: 't3', title: '后台音频标题' }], coverCopies: [{ id: 'c3', text: '后台音频封面' }] },
        },
        backgrounds: [{ id: 'bg1', imageUrl: 'https://example.com/bg.jpg' }],
        coverStyle: {},
      },
    },
    ...overrides,
  }
}

test('first fetch applies the pack, caches it, and feeds runtime copy resolution', async (t) => {
  const storage = stubWx()
  const requestedVersions = []
  stubMiniappService((clientVersion) => {
    requestedVersions.push(clientVersion)
    return Promise.resolve({ version: '2.5', changed: true, copyPack: fullPack() })
  })
  const copyPack = loadCopyPack(storage)
  t.after(() => { delete require.cache[MINIAPP_SERVICE_PATH]; delete global.wx })

  // 首次无缓存：不带版本号请求
  assert.equal(copyPack.getCopyPackVersion(), '')
  assert.equal(copyPack.getCopyList('checkinBefore'), null)
  assert.deepEqual(copyPack.getShareSettings(), { version: 1, private: { pools: {}, backgrounds: [] } })

  const result = await copyPack.fetchCopyPack({ minIntervalMs: 0 })
  assert.deepEqual(result, { changed: true })
  assert.deepEqual(requestedVersions, [''])
  assert.equal(copyPack.getCopyPackVersion(), '2.5')
  assert.deepEqual(copyPack.getCopyList('checkinBefore'), ['后台配置的打卡前文案'])

  // 缓存落盘
  assert.equal(storage[CACHE_KEY].version, '2.5')

  // resolveCopy 取值顺序：传入非空列表 → 运行时包 → 默认包
  assert.deepEqual(DEFAULT_COPY.resolveCopy(null, 'checkinBefore'), ['后台配置的打卡前文案'])
  assert.deepEqual(DEFAULT_COPY.resolveCopy(['调用方自带文案'], 'checkinBefore'), ['调用方自带文案'])

  // 分享设置来自运行时包
  assert.equal(copyPack.getShareSettings().version, 3)
  assert.equal(copyPack.getShareSettings().private.pools.text.titles[0].title, '后台手记标题')
})

test('unchanged answers keep the cached pack and skip re-download', async (t) => {
  const storage = stubWx({
    [CACHE_KEY]: { version: '2.5', pack: fullPack() },
  })
  const requestedVersions = []
  stubMiniappService((clientVersion) => {
    requestedVersions.push(clientVersion)
    return Promise.resolve({ version: '2.5', changed: false })
  })
  const copyPack = loadCopyPack(storage)
  t.after(() => { delete require.cache[MINIAPP_SERVICE_PATH]; delete global.wx })

  // 缓存先行：initFromCache 恢复运行时包
  assert.deepEqual(copyPack.getCopyList('dailyContentPromptTexts') || copyPack.getCopyList('dailyContentPrompt'), ['后台配置，手记提示语'])

  const result = await copyPack.fetchCopyPack({ minIntervalMs: 0 })
  assert.deepEqual(result, { changed: false })
  assert.deepEqual(requestedVersions, ['2.5'])
})

test('on-show revalidation is throttled but the bootstrap fetch can bypass it', async (t) => {
  const storage = stubWx()
  const requestedVersions = []
  stubMiniappService((clientVersion) => {
    requestedVersions.push(clientVersion)
    return Promise.resolve({ version: '2.5', changed: false })
  })
  const copyPack = loadCopyPack(storage)
  t.after(() => { delete require.cache[MINIAPP_SERVICE_PATH]; delete global.wx })

  // 启动门后的首次加载：显式绕过节流
  await copyPack.fetchCopyPack({ minIntervalMs: 0 })
  assert.equal(requestedVersions.length, 1)

  // 回前台的常规校验：默认 30 秒节流，短时间内直接跳过
  const skipped = await copyPack.fetchCopyPack()
  assert.deepEqual(skipped, { changed: false, skipped: true })
  assert.equal(requestedVersions.length, 1)

  // 节流期间有在途请求时也应直接复用，而不是重复发起
  const again = await copyPack.fetchCopyPack({ minIntervalMs: 0 })
  assert.deepEqual(again, { changed: false })
  assert.equal(requestedVersions.length, 2)
})

test('failures stay silent and keep the previous pack', async (t) => {
  const storage = stubWx({
    [CACHE_KEY]: { version: '2.5', pack: fullPack() },
  })
  stubMiniappService(() => Promise.reject(new Error('network down')))
  const copyPack = loadCopyPack(storage)
  t.after(() => { delete require.cache[MINIAPP_SERVICE_PATH]; delete global.wx })

  const result = await copyPack.fetchCopyPack({ minIntervalMs: 0 })
  assert.deepEqual(result, { changed: false })
  assert.equal(copyPack.getCopyPackVersion(), '2.5')
  assert.deepEqual(copyPack.getCopyList('checkinBefore'), ['后台配置的打卡前文案'])
})

test('an empty runtime list falls back to the built-in default pack', async (t) => {
  stubWx()
  stubMiniappService(() => Promise.resolve({
    version: '9.1',
    changed: true,
    copyPack: fullPack({ checkinBeforeTexts: [] }),
  }))
  const copyPack = loadCopyPack()
  t.after(() => { delete require.cache[MINIAPP_SERVICE_PATH]; delete global.wx })

  await copyPack.fetchCopyPack({ minIntervalMs: 0 })
  // 后台显式清空 → 回落默认包，绝不合并
  assert.deepEqual(DEFAULT_COPY.resolveCopy(null, 'checkinBefore'), DEFAULT_COPY.DEFAULT_COPY_PACK.checkinBefore)
})

test('cache and runtime state are isolated by environment and app id', async (t) => {
  const storage = {}
  let envName = 'prod'
  let appId = 'wx-prod'
  global.wx = {
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    getAccountInfoSync: () => ({ miniProgram: { appId, envVersion: 'develop' } }),
  }
  const envPath = require.resolve('../config/env')
  const envModule = require(envPath)
  const originalGetEnvConfig = envModule.getEnvConfig
  envModule.getEnvConfig = () => ({ name: envName, appId, apiBaseUrl: 'https://example.test/api' })
  const calls = []
  stubMiniappService(() => new Promise((resolve) => calls.push(resolve)))
  const copyPack = loadCopyPack(storage)
  t.after(() => {
    envModule.getEnvConfig = originalGetEnvConfig
    delete require.cache[MINIAPP_SERVICE_PATH]
    delete global.wx
  })

  const first = copyPack.fetchCopyPack({ minIntervalMs: 0 })
  calls.shift()({ version: 'prod-v1', changed: true, copyPack: fullPack({ checkinBeforeTexts: ['prod'] }) })
  await first
  assert.deepEqual(copyPack.getCopyList('checkinBefore'), ['prod'])

  const oldRequest = copyPack.fetchCopyPack({ minIntervalMs: 0 })
  const oldResponse = calls.shift()
  envName = 'local'
  appId = 'wx-local'
  assert.equal(copyPack.getCopyPackVersion(), '')
  assert.equal(copyPack.getCopyList('checkinBefore'), null)
  const second = copyPack.fetchCopyPack({ minIntervalMs: 0 })
  const newResponse = calls.shift()
  oldResponse({ version: 'late-prod', changed: true, copyPack: fullPack({ checkinBeforeTexts: ['late-prod'] }) })
  newResponse({ version: 'local-v1', changed: true, copyPack: fullPack({ checkinBeforeTexts: ['local'] }) })
  await Promise.all([oldRequest, second])
  assert.deepEqual(copyPack.getCopyList('checkinBefore'), ['local'])
  assert.equal(Object.keys(storage).some((key) => key.includes('prod') && key.includes('wx-prod')), true)
})
