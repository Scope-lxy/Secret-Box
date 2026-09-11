const { sendRequest, saveDataScopeId } = require('./request')
const { getEnvConfig } = require('../config/env')
const { getCachedTabs, normalizeTabs, saveTabsFromSystem } = require('./tabs')

// 启动配置单次请求最多等待 2 秒；首页会在降级答案后额外重试一次。
const STARTUP_CONFIG_TIMEOUT_MS = 2000
const STARTUP_CONFIG_CACHE_PREFIX = 'miniappStartupConfig'

let latest = null
let inflight = null
let currentGeneration = 0
const listeners = new Set()
const staleResolvers = []

function getContextKey() {
  try {
    const env = getEnvConfig()
    return `${env.name}:${env.appId || ''}`
  } catch (error) {
    return 'unknown:'
  }
}

function getCacheKey(contextKey = getContextKey()) {
  return `${STARTUP_CONFIG_CACHE_PREFIX}:${contextKey}`
}

function readCachedConfig(contextKey = getContextKey()) {
  try {
    const value = wx.getStorageSync(getCacheKey(contextKey))
    if (!value) return null
    const cached = typeof value === 'string' ? JSON.parse(value) : value
    const body = cached?.body && typeof cached.body === 'object' ? cached.body : cached
    if (!body || typeof body !== 'object') return null
    return { body, fetchedAt: Number(cached?.fetchedAt) || 0 }
  } catch (error) {
    try { wx.removeStorageSync(getCacheKey(contextKey)) } catch (cleanupError) {}
    return null
  }
}

function writeCachedConfig(body, contextKey = getContextKey()) {
  try {
    wx.setStorageSync(getCacheKey(contextKey), JSON.stringify({ body, fetchedAt: Date.now() }))
  } catch (error) {
    // Storage is an optimisation; a usable network answer must still win.
  }
}

function broadcast(result) {
  listeners.forEach((listener) => {
    try { listener(result) } catch (error) {}
  })
}

function resolveFallbackTabs(cachedBody) {
  if (cachedBody?.system && typeof cachedBody.system === 'object') {
    try { return normalizeTabs(cachedBody.system.tabs || {}) } catch (error) {}
  }
  try { return getCachedTabs() } catch (error) { return normalizeTabs() }
}

function degradedResult(source, contextKey) {
  const cached = readCachedConfig(contextKey)
  const body = cached?.body || null
  const system = body?.system && typeof body.system === 'object' ? body.system : {}
  // A degraded answer may reuse the complete L2 payload, but navigation must
  // stay in the review-safe state until a fresh server answer opts into home.
  const tabs = resolveFallbackTabs(body).map((item) => (
    item.key === 'home' ? { ...item, visible: false } : item
  ))
  return {
    tabs,
    system,
    config: body,
    dataScopeId: String(body?.dataScopeId || '').trim(),
    source,
    fetchedAt: Date.now(),
    contextKey,
  }
}

function getStartupConfig(options = {}) {
  const force = options.force === true
  const contextKey = getContextKey()
  if (inflight && inflight.contextKey === contextKey && !force) return inflight.promise
  // Degraded answers are temporary. A later ordinary call starts a fresh
  // validation instead of permanently reusing a timed-out result.
  if (!force && latest && latest.contextKey === contextKey && latest.source === 'fresh') {
    const maxAgeMs = Number(options.maxAgeMs)
    if (!Number.isFinite(maxAgeMs) || Date.now() - latest.fetchedAt < maxAgeMs) return Promise.resolve(latest)
  }

  if (inflight) {
    clearTimeout(inflight.timer)
    inflight.timer = null
    if (!inflight.settled && typeof inflight.resolve === 'function') staleResolvers.push(inflight.resolve)
  }

  const record = {
    generation: ++currentGeneration,
    contextKey,
    promise: null,
    timer: null,
    settled: false,
    resolve: null,
  }
  record.promise = new Promise((resolve) => { record.resolve = resolve })
  // Set inflight before calling the fetcher so synchronous exceptions cannot
  // leave an already-completed request registered forever.
  inflight = record

  function finish(result, token) {
    if (token && (token.generation !== currentGeneration || token.contextKey !== getContextKey())) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = null
    result.fetchedAt = Date.now()
    result.contextKey = record.contextKey
    if (record.settled) {
      latest = result
      if (result.source === 'fresh' && result.config) writeCachedConfig(result.config, record.contextKey)
      broadcast(result)
      return
    }
    record.settled = true
    if (inflight === record) inflight = null
    latest = result
    if (result.source === 'fresh' && result.config) writeCachedConfig(result.config, record.contextKey)
    broadcast(result)
    record.resolve(result)
    while (staleResolvers.length) staleResolvers.pop()(result)
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : STARTUP_CONFIG_TIMEOUT_MS
  record.timer = setTimeout(() => finish(degradedResult('timeout', record.contextKey)), timeoutMs)
  const token = { generation: record.generation, contextKey: record.contextKey }
  try {
    sendRequest({ url: `${getEnvConfig().apiBaseUrl}/miniapp/config`, persistDataScope: false })
      .then((response) => {
        if (token.generation !== currentGeneration || token.contextKey !== getContextKey()) return
        try {
          const body = response && typeof response === 'object' ? response : {}
          const system = body.system && typeof body.system === 'object' ? body.system : {}
          const dataScopeId = String(body.dataScopeId || '').trim()
          if (dataScopeId) saveDataScopeId(dataScopeId)
          finish({ tabs: saveTabsFromSystem(system), system, config: body, dataScopeId, source: 'fresh' }, token)
        } catch (error) {
          finish(degradedResult('error', record.contextKey), token)
        }
      })
      .catch(() => finish(degradedResult('error', record.contextKey), token))
  } catch (error) {
    finish(degradedResult('error', record.contextKey), token)
  }
  return record.promise
}

function getLatestStartupConfig() { return latest }

function resetStartupConfigState() {
  currentGeneration += 1
  if (inflight) {
    if (inflight.timer) clearTimeout(inflight.timer)
    inflight.timer = null
    if (!inflight.settled && typeof inflight.resolve === 'function') {
      inflight.settled = true
      inflight.resolve(degradedResult('reset', inflight.contextKey))
    }
  }
  inflight = null
  latest = null
  while (staleResolvers.length) staleResolvers.pop()(degradedResult('reset', getContextKey()))
}

function refreshStartupConfig() {
  return getStartupConfig({ force: true })
}

function onStartupConfig(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

module.exports = {
  STARTUP_CONFIG_TIMEOUT_MS,
  getLatestStartupConfig,
  getStartupConfig,
  onStartupConfig,
  refreshStartupConfig,
  resetStartupConfigState,
}
