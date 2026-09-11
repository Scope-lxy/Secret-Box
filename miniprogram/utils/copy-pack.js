// 独立文案包（L3）客户端服务：启动门开启后后台静默加载，永不阻塞启动。
// - 版本号省流量：本地缓存 version 随请求带上，服务端未变更只回 changed:false；
// - 加载失败完全静默：默认文案包（default-copy）兜底，用户无感；
// - 取值顺序：运行时文案包（后台配置）→ 代码内置默认包，整体覆盖、绝不合并。
const { getCopyPack } = require('../services/miniapp')
const { setRuntimeCopySource } = require('./default-copy')
const { getEnvConfig } = require('../config/env')

const STORAGE_KEY_PREFIX = 'copy-pack-cache-v2'

// resolveCopy 的键名 → 文案包字段名
const COPY_KEY_MAP = {
  dailyContentPrompt: 'dailyContentPromptTexts',
  checkinBefore: 'checkinBeforeTexts',
  checkinAfter: 'checkinAfterTexts',
}

const state = { contextKey: '', version: '', pack: null }
let inflight = null
let lastFetchAt = 0
let generation = 0
// onShow 版本校验节流：短时间内反复回前台不重复发请求
const REVALIDATE_MIN_INTERVAL_MS = 30 * 1000

function normalizeStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function normalizeCopyPack(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const pack = {
    checkinBeforeTexts: normalizeStringList(source.checkinBeforeTexts),
    checkinAfterTexts: normalizeStringList(source.checkinAfterTexts),
    dailyContentPromptTexts: normalizeStringList(source.dailyContentPromptTexts),
    share: null,
  }
  const share = source.share && typeof source.share === 'object' ? source.share : null
  if (share && share.private && typeof share.private === 'object') {
    pack.share = {
      version: Number(share.version) || 1,
      private: share.private,
    }
  }
  return pack
}

function getContext() {
  try {
    const env = getEnvConfig()
    const name = String(env?.name || '').trim() || 'unknown'
    const appId = String(env?.appId || '').trim() || 'unknown'
    return { name, appId, key: `${name}:${appId}` }
  } catch (error) {
    return { name: 'unknown', appId: 'unknown', key: 'unknown:unknown' }
  }
}

function getStorageKey(context = getContext()) {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(context.name)}:${encodeURIComponent(context.appId)}`
}

function ensureContext() {
  const context = getContext()
  if (state.contextKey === context.key) return context
  // 上下文变化会作废旧请求的复用资格；旧 Promise 仍可自然结束，但不能影响新上下文。
  inflight = null
  state.contextKey = context.key
  state.version = ''
  state.pack = null
  lastFetchAt = 0
  generation += 1
  readCache(context)
  return context
}

function readCache(context = getContext()) {
  try {
    const cached = wx.getStorageSync(getStorageKey(context))
    if (!cached || typeof cached !== 'object' || !String(cached.version || '').trim()) return null
    state.version = String(cached.version)
    state.pack = normalizeCopyPack(cached.pack)
    return { version: state.version, pack: state.pack }
  } catch (error) {
    return null
  }
}

function writeCache(version, pack, context = getContext()) {
  try {
    wx.setStorageSync(getStorageKey(context), { version, pack })
  } catch (error) {
    // 缓存写失败不影响本次会话：下次启动重新拉全量包
  }
}

// 注册到 default-copy：resolveCopy 在调用方未提供列表时优先取运行时文案包
setRuntimeCopySource((key) => {
  ensureContext()
  const field = COPY_KEY_MAP[key]
  if (!field || !state.pack) return null
  const list = state.pack[field]
  return Array.isArray(list) && list.length ? list.slice() : null
})

function initFromCache() {
  ensureContext()
}
initFromCache()

// 后台配置的分享设置（含 COS 底图地址）：无运行时包时回落空配置，
// share-card 会继续回落到代码内置默认池，与旧「未配置」语义一致。
function getShareSettings() {
  ensureContext()
  if (state.pack?.share) {
    return { version: state.pack.share.version, private: state.pack.share.private }
  }
  return { version: 1, private: { pools: {}, backgrounds: [] } }
}

// 页面取文案列表的统一入口：返回副本；无运行时包时返回 null（由默认包兜底）
function getCopyList(key) {
  ensureContext()
  const field = COPY_KEY_MAP[key]
  if (!field || !state.pack) return null
  const list = state.pack[field]
  return Array.isArray(list) && list.length ? list.slice() : null
}

function getCopyPackVersion() {
  ensureContext()
  return state.version
}

function resetCopyPackState() {
  // 让显式重置后的下一次拉取一定创建新请求；旧请求的 finally 不会再命中引用。
  inflight = null
  state.contextKey = ''
  state.version = ''
  state.pack = null
  lastFetchAt = 0
  generation += 1
}

// 静默拉取：任何失败都不抛出、不提示，默认包兜底。
// 生效时机为「下次进入页面」：不提供运行时广播，页面重进/重渲染时自然取到新文案。
// 返回 {changed:boolean}，仅供调用方参考，不需要 await。
async function fetchCopyPack(options = {}) {
  const context = ensureContext()
  const minIntervalMs = Number.isFinite(options.minIntervalMs)
    ? Math.max(0, options.minIntervalMs)
    : REVALIDATE_MIN_INTERVAL_MS
  if (minIntervalMs > 0 && Date.now() - lastFetchAt < minIntervalMs) return { changed: false, skipped: true }
  if (inflight && inflight.contextKey === context.key) return inflight.promise
  const request = { contextKey: context.key, generation: ++generation, promise: null }
  request.promise = (async () => {
    try {
      const data = await getCopyPack(state.version)
      if (request.contextKey !== getContext().key || request.generation !== generation) return { changed: false }
      if (!data || data.changed === false || !data.copyPack) {
        if (data && String(data.version || '').trim()) state.version = String(data.version)
        return { changed: false }
      }
      const pack = normalizeCopyPack(data.copyPack)
      state.version = String(data.version || '').trim()
      state.pack = pack
      writeCache(state.version, pack, context)
      return { changed: true }
    } catch (error) {
      return { changed: false }
    } finally {
      if (inflight === request && request.contextKey === getContext().key && request.generation === generation) {
        lastFetchAt = Date.now()
        inflight = null
      }
    }
  })()
  inflight = request
  return request.promise
}

module.exports = {
  fetchCopyPack,
  getCopyList,
  getCopyPackVersion,
  getShareSettings,
  resetCopyPackState,
}
