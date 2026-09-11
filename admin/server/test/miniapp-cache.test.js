const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const miniAppServiceFile = path.resolve(__dirname, '../../../miniprogram/services/miniapp.js')

test('mini-program serves fresh cached resources and revalidates stale entries', () => {
  const source = fs.readFileSync(miniAppServiceFile, 'utf8')
  const resourceConfig = source.match(/const RESOURCE_CONFIG = \{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(source, /const RESOURCE_CACHE_TTL = 10 \* 60 \* 1000/)
  // 配置不再属于资源缓存（由统一启动配置服务持有），其余 6 类资源仍走 TTL 缓存
  assert.equal((resourceConfig.match(/ttl: RESOURCE_CACHE_TTL/g) || []).length, 6)
  assert.doesNotMatch(resourceConfig, /ttl: \d/)
  assert.match(source, /if \(options\.cacheOnly && isCacheFresh\(resource, cached\)\)/)
  assert.match(source, /if \(!options\.force && isCacheFresh\(resource, cached\)\)/)
})

test('daily-content contract does not read resource caches from the previous namespace', () => {
  const source = fs.readFileSync(miniAppServiceFile, 'utf8')
  assert.match(source, /const CLIENT_CONTRACT_VERSION = 'daily-content-v1'/)
  assert.match(source, /RESOURCE_CONFIG\[resource\]\.key\}:\$\{CLIENT_CONTRACT_VERSION\}/)
  assert.match(source, /ACTION_STORAGE_PREFIX\}:\$\{CLIENT_CONTRACT_VERSION\}/)
})

test('retained tab pages revalidate when users return to them', () => {
  const pages = [
    ['home/home.js', 'this.loadHomeData()'],
    ['letters/letters.js', 'this.loadData()'],
    ['articles/articles.js', 'this.loadData()'],
  ]

  pages.forEach(([relativePath, loadCall]) => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages', relativePath), 'utf8')
    const onShow = source.match(/onShow\(\) \{([\s\S]*?)\n  \},/)?.[1] || ''
    assert.match(onShow, new RegExp(loadCall.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
})

test('user-facing resource caches are isolated by the current data scope', async () => {
  const storage = new Map([
    ['visitorId', 'cache-scope-user'],
    ['miniappDataScope:prod:wx-cache-scope-test', 'shared:pool-a'],
    ['miniappHomeCache:prod:cache-scope-user:shared:pool-a', { data: { marker: 'legacy' }, updatedAt: Date.now() }],
  ])
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-cache-scope-test', envVersion: 'develop' } } },
  }

  try {
    const request = require('../../../miniprogram/utils/request')
    const service = require('../../../miniprogram/services/miniapp')
    request.saveMiniAppSession({
      sessionToken: 'cache-scope-token',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
      accountId: 'cache-scope-account',
    })
    assert.equal(service.getCachedHomeData(), null)
    let marker = 'pool-a'
    global.wx.request = (options) => {
      const payload = options.url.includes('/miniapp/home')
        ? { marker, dailyContent: null }
        : options.url.includes('/miniapp/letters') || options.url.includes('/miniapp/articles')
          ? { marker, items: [] }
          : { marker, profile: { nickname: marker }, summary: {} }
      options.success({ statusCode: 200, data: payload })
    }
    const resources = [
      [service.getHomeData, service.getCachedHomeData],
      [service.getProfileData, service.getCachedProfileData],
      [service.getActivityData, service.getCachedActivityData],
      [service.getLetters, service.getCachedLetters],
      [service.getArticles, service.getCachedArticles],
    ]

    for (const [load] of resources) await load({ force: true })
    resources.forEach(([, cached]) => assert.equal(cached().marker, 'pool-a'))
    assert.equal(storage.get('miniappHomeCache:daily-content-v1:prod:wx-cache-scope-test:cache-scope-user:cache-scope-account:shared:pool-a').data.marker, 'pool-a')

    request.saveDataScopeId('independent:mp1:pool-b')
    resources.forEach(([, cached]) => assert.equal(cached(), null))

    marker = 'pool-b'
    for (const [load] of resources) await load({ force: true })
    resources.forEach(([, cached]) => assert.equal(cached().marker, 'pool-b'))

    request.clearDataScopeId()
    resources.forEach(([, cached]) => assert.equal(cached(), null))
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})
