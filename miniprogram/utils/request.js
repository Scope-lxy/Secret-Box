const { getEnvConfig } = require('../config/env')

const sessionStoragePrefix = 'miniappSession'
const dataScopeStoragePrefix = 'miniappDataScope'
const clientContractVersion = 'daily-content-v1'
const pendingSessionWaitMs = 2000
let pendingSession = null
let sessionGeneration = 0

function getVisitorId() {
  let visitorId = wx.getStorageSync('visitorId')
  if (!visitorId) {
    visitorId = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    wx.setStorageSync('visitorId', visitorId)
  }
  return visitorId
}

function getSessionStorageKey() {
  const env = getEnvConfig()
  return `${sessionStoragePrefix}:${env.name}:${env.appId}`
}

function getDataScopeStorageKey() {
  const env = getEnvConfig()
  return `${dataScopeStoragePrefix}:${env.name}:${env.appId}`
}

function getStoredDataScopeId() {
  return String(wx.getStorageSync(getDataScopeStorageKey()) || '').trim()
}

function saveDataScopeId(value) {
  const dataScopeId = String(value || '').trim()
  if (!dataScopeId) return ''
  wx.setStorageSync(getDataScopeStorageKey(), dataScopeId)
  return dataScopeId
}

function clearDataScopeId() {
  wx.removeStorageSync(getDataScopeStorageKey())
}

function encodeDataScopeHeader(value) {
  const dataScopeId = String(value || '').trim()
  if (!dataScopeId || /^[\x00-\x7F]*$/.test(dataScopeId)) return dataScopeId
  return encodeURIComponent(dataScopeId)
}

function notifyDataScopeChanged(previousDataScopeId, dataScopeId) {
  if (!previousDataScopeId || previousDataScopeId === dataScopeId || typeof getApp !== 'function') return
  const app = getApp()
  if (typeof app?.handleDataScopeChange === 'function') {
    app.handleDataScopeChange({ previousDataScopeId, dataScopeId })
  }
}

async function refreshDataScopeId(options = {}) {
  const previousDataScopeId = String(
    options.previousDataScopeId === undefined ? getStoredDataScopeId() : options.previousDataScopeId,
  ).trim()
  // 配置请求统一走启动配置服务（延迟 require，避免与 startup-config 的模块加载环）
  const { getStartupConfig } = require('./startup-config')
  let result = await getStartupConfig(options.force ? { force: true } : { maxAgeMs: options.maxAgeMs })
  let dataScopeId = String(result.dataScopeId || '').trim()
  // A cold deep link can reach an expired startup attempt while no L2 scope
  // exists yet. Immediately start one new generation so the business request
  // can recover without requiring the user to revisit the page.
  if (!dataScopeId && !options.force && result.source !== 'fresh') {
    result = await getStartupConfig({ force: true })
    dataScopeId = String(result.dataScopeId || '').trim()
  }
  if (!dataScopeId) throw new Error('数据空间配置无效，请稍后重试')
  saveDataScopeId(dataScopeId)
  notifyDataScopeChanged(previousDataScopeId, dataScopeId)
  return dataScopeId
}

async function ensureDataScopeId({ force = false } = {}) {
  return (!force && getStoredDataScopeId()) || refreshDataScopeId({ force })
}

async function recoverDataScopeChange(error = {}) {
  const previousDataScopeId = getStoredDataScopeId()
  clearDataScopeId()
  try {
    // 必须强制重取：latest 里可能仍是触发 409 的旧数据空间，复用会再次保存旧值、持续 409
    await refreshDataScopeId({ previousDataScopeId, force: true })
  } catch (refreshError) {
    // The failed write is never replayed. A later foreground/read can retry config refresh.
  }
  const changedError = new Error('数据已更新，请重试')
  changedError.kind = 'data_scope'
  changedError.code = 'DATA_SCOPE_CHANGED'
  changedError.statusCode = 409
  changedError.originalError = error
  return changedError
}

function getPersistedSession() {
  const session = wx.getStorageSync(getSessionStorageKey())
  return session && typeof session === 'object' ? session : null
}

function getStoredSession() {
  const session = getPersistedSession()
  const token = String(session?.token || '').trim()
  const expiresAt = String(session?.expiresAt || '').trim()
  const accountId = String(session?.accountId || '').trim()
  const expiresAtMs = new Date(expiresAt).getTime()
  if (!token || !expiresAt || !accountId || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null
  return { token, expiresAt, accountId }
}

function hasPersistedSession() {
  return Boolean(getPersistedSession())
}

function isAccountCacheReadable() {
  const persisted = getPersistedSession()
  return !pendingSession && (!persisted || Boolean(getStoredSession()))
}

function getSessionGeneration() {
  return sessionGeneration
}

function isSessionGenerationCurrent(generation) {
  return generation === sessionGeneration
}

function getSessionAccountId(session = getPersistedSession()) {
  return String(session?.accountId || '').trim()
}

function getAccountScopedStorageKey(name) {
  const env = getEnvConfig()
  return `${name}:${clientContractVersion}:${env.name}:${env.appId}:${getVisitorId()}`
}

function clearAccountScopedStorage() {
  const env = getEnvConfig()
  const visitorId = getVisitorId()
  const cacheMarker = `:${clientContractVersion}:${env.name}:${env.appId}:${visitorId}:`
  const actionMarker = `:${env.name}:${env.appId}:${visitorId}:`
  const offlineStorageKey = `miniappOfflineOperations:${clientContractVersion}:${env.name}:${env.appId}:${visitorId}`
  const keys = typeof wx.getStorageInfoSync === 'function'
    ? (wx.getStorageInfoSync()?.keys || [])
    : []
  keys
    .filter((key) => {
      const value = String(key)
      const isCurrentCache = /^miniapp(?:Config|Home|Letters|Articles|Profile|Activity|Preferences)Cache:/.test(value)
        && value.includes(cacheMarker)
      const isCurrentAction = value.startsWith(`miniappActionIdempotency:${clientContractVersion}:`)
        && value.includes(actionMarker)
      return isCurrentCache || isCurrentAction || value === offlineStorageKey
    })
    .forEach((key) => wx.removeStorageSync(key))
  wx.removeStorageSync(getAccountScopedStorageKey('profileAutoFetched'))
  wx.removeStorageSync(getAccountScopedStorageKey('message-phone-sync-prompt-resolved'))
}

function clearMiniAppSession() {
  const previous = getPersistedSession()
  wx.removeStorageSync(getSessionStorageKey())
  if (previous) {
    sessionGeneration += 1
    clearAccountScopedStorage()
  }
}

function createSession(data = {}) {
  const token = String(data.sessionToken || '').trim()
  const expiresAt = String(data.sessionExpiresAt || '').trim()
  const accountId = String(data.accountId || data.profile?.accountId || '').trim()
  const expiresAtMs = new Date(expiresAt).getTime()
  if (!token || !expiresAt || !accountId || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error('登录状态创建失败，请稍后重试')
  }
  return { token, expiresAt, accountId }
}

function notifyAccountChanged(previousAccountId, accountId) {
  if (typeof getApp !== 'function') return
  const app = getApp()
  if (typeof app?.handleAccountChange === 'function') {
    app.handleAccountChange({ previousAccountId, accountId })
  }
}

function commitMiniAppSession(data = {}, options = {}) {
  if (
    options.expectedGeneration !== undefined
    && !isSessionGenerationCurrent(options.expectedGeneration)
  ) throw createStaleSessionError()
  const session = createSession(data)
  const previous = getPersistedSession()
  const previousAccountId = getSessionAccountId(previous)
  const accountChanged = Boolean(previous && previousAccountId !== session.accountId)
  if (accountChanged) {
    sessionGeneration += 1
    clearAccountScopedStorage()
  }
  wx.setStorageSync(getSessionStorageKey(), session)
  if (accountChanged) notifyAccountChanged(previousAccountId, session.accountId)
  return session
}

const saveMiniAppSession = commitMiniAppSession

function createStaleSessionError() {
  const error = new Error('账号已切换，请重试')
  error.kind = 'session'
  error.code = 'ACCOUNT_CHANGED'
  return error
}

function captureAuthenticatedSession(sessionToken, expectedAccountId) {
  const token = String(sessionToken || '').trim()
  const session = getStoredSession()
  if (
    !session
    || session.token !== token
    || (expectedAccountId && session.accountId !== expectedAccountId)
  ) throw createStaleSessionError()
  return {
    accountId: session.accountId,
    generation: getSessionGeneration(),
    token,
  }
}

function assertAuthenticatedSessionCurrent(snapshot) {
  const session = getStoredSession()
  if (
    !isSessionGenerationCurrent(snapshot.generation)
    || session?.accountId !== snapshot.accountId
    || session.token !== snapshot.token
  ) throw createStaleSessionError()
}

function sendRequest({ url, method = 'GET', data = {}, header = {}, sessionToken = '', persistDataScope = true }) {
  const appId = getEnvConfig().appId
  const requestHeader = { ...header }
  const dataScopeHeaderKey = Object.keys(requestHeader)
    .find((key) => key.toLowerCase() === 'x-miniapp-data-scope')
  if (dataScopeHeaderKey) requestHeader[dataScopeHeaderKey] = encodeDataScopeHeader(requestHeader[dataScopeHeaderKey])
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header: {
        'content-type': 'application/json',
        'x-miniapp-appid': appId,
        'x-visitor-id': getVisitorId(),
        ...requestHeader,
        ...(sessionToken ? { 'x-miniapp-session': sessionToken } : {}),
      },
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 配置请求由 startup-config 在代数校验通过后自行持久化（persistDataScope:false），
          // 避免旧代迟到的配置答案先把旧数据空间写进持久化存储
          if (body.dataScopeId && persistDataScope) saveDataScopeId(body.dataScopeId)
          resolve(body)
          return
        }
        const error = new Error(body.message || '请求失败')
        error.kind = 'server'
        error.statusCode = res.statusCode
        reject(error)
      },
      fail(error) {
        const requestError = new Error(error.errMsg || '网络连接失败')
        requestError.kind = 'network'
        reject(requestError)
      },
    })
  })
}

function getLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) {
          resolve(result.code)
          return
        }
        reject(new Error('微信登录凭据获取失败'))
      },
      fail(error) {
        reject(new Error(error.errMsg || '微信登录凭据获取失败'))
      },
    })
  })
}

async function createMiniAppSession(code, { save = true } = {}) {
  const generation = getSessionGeneration()
  const env = getEnvConfig()
  const dataScopeId = await ensureDataScopeId()
  let data
  try {
    data = await sendRequest({
      url: `${env.apiBaseUrl}/miniapp/session`,
      method: 'POST',
      data: { code },
      header: { 'x-miniapp-data-scope': dataScopeId },
    })
  } catch (error) {
    if (error.statusCode === 409) throw await recoverDataScopeChange(error)
    throw error
  }
  if (save) commitMiniAppSession(data, { expectedGeneration: generation })
  return data
}

async function ensureMiniAppSession({ force = false } = {}) {
  if (pendingSession) {
    try {
      return await pendingSession
    } catch (error) {
      const session = !force && getStoredSession()
      if (session) return session.token
      throw error
    }
  }
  if (!force) {
    const session = getStoredSession()
    if (session) return session.token
  }
  pendingSession = (async () => {
    const generation = getSessionGeneration()
    const data = await createMiniAppSession(await getLoginCode(), { save: false })
    commitMiniAppSession(data, { expectedGeneration: generation })
    return data.sessionToken
  })()
  try {
    return await pendingSession
  } finally {
    pendingSession = null
  }
}

function revalidateMiniAppSession() {
  return ensureMiniAppSession({ force: true })
}

function resolveAvailableSessionToken() {
  const storedToken = () => getStoredSession()?.token || ''
  if (!pendingSession) return Promise.resolve(storedToken())
  // wx.login can occasionally stall without a timeout; public requests must
  // not be blocked behind it forever, so race it with a short grace period.
  let graceTimer = null
  const grace = new Promise((resolve) => {
    graceTimer = setTimeout(() => resolve(storedToken()), pendingSessionWaitMs)
  })
  return Promise.race([
    pendingSession
      .then((token) => { clearTimeout(graceTimer); return token })
      .catch(() => { clearTimeout(graceTimer); return storedToken() }),
    grace,
  ])
}

async function request(options = {}) {
  const env = getEnvConfig()
  const requiresAuth = Boolean(options.auth)
  const expectedAccountId = String(options.expectedAccountId || '').trim()
  let sessionToken = ''
  let sessionSnapshot = null
  if (requiresAuth) {
    sessionToken = await ensureMiniAppSession()
    sessionSnapshot = captureAuthenticatedSession(sessionToken, expectedAccountId)
  } else if (pendingSession) {
    sessionToken = await resolveAvailableSessionToken()
  } else {
    sessionToken = getStoredSession()?.token || ''
  }
  const dataScopeId = requiresAuth ? await ensureDataScopeId() : ''
  if (sessionSnapshot) assertAuthenticatedSessionCurrent(sessionSnapshot)
  const hasExplicitDataScope = Object.keys(options.header || {})
    .some((key) => key.toLowerCase() === 'x-miniapp-data-scope')
  const scopedOptions = dataScopeId && !hasExplicitDataScope
    ? { ...options, header: { ...(options.header || {}), 'x-miniapp-data-scope': dataScopeId } }
    : options
  const requestGeneration = sessionSnapshot?.generation ?? getSessionGeneration()
  try {
    const data = await sendRequest({
      ...scopedOptions,
      sessionToken,
      url: `${env.apiBaseUrl}${options.url}`,
    })
    if (sessionSnapshot) assertAuthenticatedSessionCurrent(sessionSnapshot)
    else if (!isSessionGenerationCurrent(requestGeneration)) throw createStaleSessionError()
    return data
  } catch (error) {
    if (sessionSnapshot) assertAuthenticatedSessionCurrent(sessionSnapshot)
    if (error.statusCode === 409) throw await recoverDataScopeChange(error)
    if (!requiresAuth || error.statusCode !== 401) throw error
    sessionToken = await ensureMiniAppSession({ force: true })
    const retrySnapshot = captureAuthenticatedSession(sessionToken, expectedAccountId)
    try {
      const data = await sendRequest({
        ...scopedOptions,
        sessionToken,
        url: `${env.apiBaseUrl}${options.url}`,
      })
      assertAuthenticatedSessionCurrent(retrySnapshot)
      return data
    } catch (retryError) {
      assertAuthenticatedSessionCurrent(retrySnapshot)
      if (retryError.statusCode === 409) throw await recoverDataScopeChange(retryError)
      throw retryError
    }
  }
}

module.exports = {
  commitMiniAppSession,
  clearDataScopeId,
  clearMiniAppSession,
  createMiniAppSession,
  encodeDataScopeHeader,
  ensureDataScopeId,
  ensureMiniAppSession,
  getAccountScopedStorageKey,
  getSessionGeneration,
  getStoredSession,
  getStoredDataScopeId,
  getVisitorId,
  hasPersistedSession,
  isAccountCacheReadable,
  isSessionGenerationCurrent,
  notifyDataScopeChanged,
  request,
  recoverDataScopeChange,
  revalidateMiniAppSession,
  refreshDataScopeId,
  saveDataScopeId,
  saveMiniAppSession,
  sendRequest,
}
