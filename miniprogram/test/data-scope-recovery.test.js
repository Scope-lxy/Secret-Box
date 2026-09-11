const assert = require('node:assert/strict')
const test = require('node:test')

// 覆盖 409 数据空间恢复链路的行为级测试：
// - recoverDataScopeChange 必须强制重取配置（force: true），不得复用旧 latest；
// - ensureDataScopeId 的 force 必须透传到统一启动配置服务。
const REQUEST_PATH = require.resolve('../utils/request')
const STARTUP_CONFIG_PATH = require.resolve('../utils/startup-config')

function stubStartupConfig(configCalls, dataScopeId) {
  require.cache[STARTUP_CONFIG_PATH] = {
    id: STARTUP_CONFIG_PATH,
    filename: STARTUP_CONFIG_PATH,
    loaded: true,
    exports: {
      getStartupConfig(options = {}) {
        configCalls.push({ ...options })
        return Promise.resolve({
          tabs: [],
          system: {},
          config: null,
          dataScopeId,
          source: 'fresh',
          fetchedAt: Date.now(),
        })
      },
      getLatestStartupConfig: () => null,
      onStartupConfig: () => () => {},
    },
  }
}

function installWx() {
  const storage = new Map()
  global.wx = {
    getStorageSync: (key) => storage.get(key) || '',
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: (key) => { storage.delete(key) },
  }
  return storage
}

function cleanup(t) {
  t.after(() => {
    delete require.cache[REQUEST_PATH]
    delete require.cache[STARTUP_CONFIG_PATH]
    delete global.wx
  })
}

test('409 recovery forces a real config refetch instead of reusing the stale latest', async (t) => {
  installWx()
  const configCalls = []
  stubStartupConfig(configCalls, 'scope-2')
  cleanup(t)

  const request = require(REQUEST_PATH)
  // 模拟触发 409 时的现场：latest 中仍是旧数据空间（统一服务复用旧答案）
  request.saveDataScopeId('scope-1')

  const error = await request.recoverDataScopeChange({ statusCode: 409 })
  assert.equal(error.code, 'DATA_SCOPE_CHANGED')
  // 必须强制重取：复用旧 latest 会把旧空间再次保存，后续请求持续 409
  assert.deepEqual(configCalls, [{ force: true }])
  assert.equal(request.getStoredDataScopeId(), 'scope-2')
})

test('ensureDataScopeId forwards force to the startup config service', async (t) => {
  installWx()
  const configCalls = []
  stubStartupConfig(configCalls, 'scope-2')
  cleanup(t)

  const request = require(REQUEST_PATH)

  // 无已存数据空间：发起普通刷新（不强制），force 不应误传
  await request.ensureDataScopeId()
  assert.equal(configCalls.length, 1)
  assert.notEqual(configCalls[0].force, true)

  // force: true 必须透传，即使本地已有数据空间
  await request.ensureDataScopeId({ force: true })
  assert.deepEqual(configCalls[1], { force: true })
})
