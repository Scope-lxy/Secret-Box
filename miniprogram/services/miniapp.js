const { getEnvConfig } = require('../config/env')
const {
  commitMiniAppSession,
  createMiniAppSession,
  encodeDataScopeHeader,
  ensureDataScopeId,
  ensureMiniAppSession,
  getSessionGeneration,
  getStoredSession,
  getStoredDataScopeId,
  getVisitorId,
  isAccountCacheReadable,
  isSessionGenerationCurrent,
  recoverDataScopeChange,
  request,
} = require('../utils/request')
const { discardPendingOperationsForScope, flushPendingOperations, getPendingOperations, runOfflineOperation } = require('../utils/offline-sync')
const { MESSAGE_CONTENT_LIMIT_TEXT, isMessageContentWithinLimit, normalizeMessageContent } = require('../utils/message-content')
const { createAvatarJpeg, removeTemporaryAvatar } = require('../utils/avatar-image')

const RESOURCE_CACHE_TTL = 10 * 60 * 1000
const CLIENT_CONTRACT_VERSION = 'daily-content-v1'
const ACTION_STORAGE_PREFIX = 'miniappActionIdempotency'

const RESOURCE_CONFIG = {
  home: { key: 'miniappHomeCache', ttl: RESOURCE_CACHE_TTL, url: '/miniapp/home' },
  letters: { key: 'miniappLettersCache', ttl: RESOURCE_CACHE_TTL, url: '/miniapp/letters' },
  articles: { key: 'miniappArticlesCache', ttl: RESOURCE_CACHE_TTL, url: '/miniapp/articles' },
  profile: { key: 'miniappProfileCache', ttl: RESOURCE_CACHE_TTL, url: '/miniapp/profile', auth: true },
  activity: { key: 'miniappActivityCache', ttl: RESOURCE_CACHE_TTL, url: '/miniapp/activity', auth: true },
  preferences: { key: 'miniappPreferencesCache', ttl: RESOURCE_CACHE_TTL, url: '/miniapp/preferences', auth: true },
}

const activeRequests = {}
const offlineSyncedResources = new Set(['activity', 'home', 'letters'])
let offlineSyncVersion = 0
let pendingOfflineFlush = null

function getStorageKey(resource, dataScopeId = getStoredDataScopeId()) {
  const scopeId = String(dataScopeId || '').trim()
  if (!scopeId) return ''
  const env = getEnvConfig()
  const accountId = getStoredSession()?.accountId || 'anonymous'
  return `${RESOURCE_CONFIG[resource].key}:${CLIENT_CONTRACT_VERSION}:${env.name}:${env.appId}:${getVisitorId()}:${accountId}:${scopeId}`
}

function readCache(resource, dataScopeId) {
  if (!isAccountCacheReadable()) return null
  const storageKey = getStorageKey(resource, dataScopeId)
  if (!storageKey) return null
  const cached = wx.getStorageSync(storageKey)
  return cached && cached.data && cached.updatedAt ? cached : null
}

function writeCache(resource, data, dataScopeId, generation) {
  if (!isSessionGenerationCurrent(generation)) return
  const storageKey = getStorageKey(resource, dataScopeId)
  if (!storageKey) return
  wx.setStorageSync(storageKey, {
    data,
    updatedAt: Date.now(),
    day: resource === 'home' ? new Date().toDateString() : '',
  })
}

function isCacheFresh(resource, cached) {
  if (!cached || Date.now() - cached.updatedAt >= RESOURCE_CONFIG[resource].ttl) return false
  return resource !== 'home' || cached.day === new Date().toDateString()
}

function getCachedResource(resource) {
  const cached = readCache(resource)
  return cached ? cached.data : null
}

function invalidateResource(resource) {
  const storageKey = getStorageKey(resource)
  if (storageKey) wx.removeStorageSync(storageKey)
}

function clearResourceCachesForScope(dataScopeId) {
  Object.keys(RESOURCE_CONFIG).forEach((resource) => {
    const storageKey = getStorageKey(resource, dataScopeId)
    if (storageKey) wx.removeStorageSync(storageKey)
  })
}

function handleDataScopeChange(previousDataScopeId) {
  const scopeId = String(previousDataScopeId || '').trim()
  if (!scopeId) return
  clearResourceCachesForScope(scopeId)
  discardPendingOperationsForScope(scopeId)
  offlineSyncVersion += 1
}

function patchCachedResource(resource, updater, generation) {
  const data = getCachedResource(resource)
  if (!data) return
  writeCache(resource, updater(data), undefined, generation)
}

function getActionStorageKey(action, accountId) {
  const env = getEnvConfig()
  return `${ACTION_STORAGE_PREFIX}:${CLIENT_CONTRACT_VERSION}:${action}:${env.name}:${env.appId}:${getVisitorId()}:${accountId}:${getStoredDataScopeId()}`
}

function createActionIdempotencyKey(action) {
  return `${action}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
}

function getActionIdempotencyKey(action, payload, accountId) {
  const storageKey = getActionStorageKey(action, accountId)
  const saved = wx.getStorageSync(storageKey)
  if (saved?.key && JSON.stringify(saved.payload) === JSON.stringify(payload)) {
    return { accountId, key: saved.key, storageKey }
  }
  const key = createActionIdempotencyKey(action)
  wx.setStorageSync(storageKey, { key, payload })
  return { accountId, key, storageKey }
}

function clearActionIdempotencyKey(storageKey) {
  wx.removeStorageSync(storageKey)
}

async function prepareActionIdempotency(action, payload) {
  const sessionToken = await ensureMiniAppSession()
  const session = getStoredSession()
  const generation = getSessionGeneration()
  if (!session || session.token !== String(sessionToken || '').trim()) throw createAccountChangedError()
  await ensureDataScopeId()
  if (!isSessionGenerationCurrent(generation) || getStoredSession()?.accountId !== session.accountId) {
    throw createAccountChangedError()
  }
  return getActionIdempotencyKey(action, payload, session.accountId)
}

function isUncertainActionFailure(error) {
  if (error?.kind === 'network') return true
  const statusCode = Number(error?.statusCode)
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500
}

function applyPendingMessageDeletes(resource, data) {
  if (!data || !['home', 'letters'].includes(resource)) return data
  const source = resource === 'home' ? 'daily_content' : resource
  const deletedIds = new Set(getPendingOperations()
    .filter((entry) => entry.operation === 'message_delete' && entry.payload.source === source)
    .map((entry) => entry.payload.sourceId))
  if (!deletedIds.size) return data
  if (resource === 'home') {
    return deletedIds.has(data.dailyContent?.id)
      ? { ...data, dailyContent: { ...data.dailyContent, myMessage: '' } }
      : data
  }
  return {
    ...data,
    items: (data.items || []).map((item) => (
      deletedIds.has(item.id) ? { ...item, myMessage: '' } : item
    )),
  }
}

function getResource(resource, options = {}) {
  const dataScopeId = getStoredDataScopeId()
  const generation = getSessionGeneration()
  // 请求发出时的账号身份：响应回来时身份变了就不写缓存（防匿名响应写进新账号缓存）
  const requestAccountId = getStoredSession()?.accountId || 'anonymous'
  const requestKey = `${resource}:${dataScopeId || 'unscoped'}:${generation}`
  const cached = readCache(resource, dataScopeId)
  if (options.cacheOnly && isCacheFresh(resource, cached)) return Promise.resolve(cached.data)
  if (!options.force && isCacheFresh(resource, cached)) return Promise.resolve(applyPendingMessageDeletes(resource, cached.data))
  if (activeRequests[requestKey]) return activeRequests[requestKey]
  const promise = requestAfterOfflineFlush({
    auth: Boolean(RESOURCE_CONFIG[resource].auth),
    url: RESOURCE_CONFIG[resource].url,
  }, offlineSyncedResources.has(resource))
    .then((data) => {
      const current = applyPendingMessageDeletes(resource, data)
      const currentDataScopeId = getStoredDataScopeId()
      const responseDataScopeId = dataScopeId || currentDataScopeId
      const currentAccountId = getStoredSession()?.accountId || 'anonymous'
      if (currentAccountId === requestAccountId && responseDataScopeId === currentDataScopeId) {
        writeCache(resource, current, responseDataScopeId, generation)
      }
      return current
    })
    .finally(() => {
      if (activeRequests[requestKey] === promise) activeRequests[requestKey] = null
    })
  activeRequests[requestKey] = promise
  return promise
}

function requestFromApi(options) {
  return request(options)
}

function waitForOfflineFlush() {
  return pendingOfflineFlush ? pendingOfflineFlush.catch(() => {}) : Promise.resolve()
}

async function requestAfterOfflineFlush(options, waitForSync = false) {
  if (!waitForSync) return requestFromApi(options)
  const deadline = Date.now() + 10000
  let attempts = 0
  while (attempts < 3 && Date.now() < deadline) {
    attempts += 1
    await waitForOfflineFlush()
    const version = offlineSyncVersion
    const data = await requestFromApi(options)
    if (!pendingOfflineFlush && version === offlineSyncVersion) return data
  }
  return requestFromApi(options)
}

function getHomeData(options) {
  return getResource('home', options)
}

// 独立文案包（L3）：带本地缓存版本号轮询，未变更服务端只回 changed:false。
// 公开接口（与 config 同级，不带 auth），失败由默认文案包兜底，调用方静默处理。
function getCopyPack(clientVersion = '') {
  const trimmed = String(clientVersion || '').trim()
  const query = trimmed ? `?version=${encodeURIComponent(trimmed)}` : ''
  return requestAfterOfflineFlush({ auth: false, url: `/miniapp/copy-pack${query}` }, false)
}

// 前台回前台时的数据空间复核已收编进统一启动配置服务（utils/startup-config），
// 由 utils/request.js 的 refreshDataScopeId 调用，这里不再保留第二个配置请求通道。

function getLetters(options) {
  if (options?.includeId) {
    return requestAfterOfflineFlush({ url: `/miniapp/letters?contentId=${encodeURIComponent(options.includeId)}` }, true)
      .then((data) => applyPendingMessageDeletes('letters', data))
  }
  return getResource('letters', options)
}

function getLettersPage(page, pageSize = 20) {
  return requestAfterOfflineFlush({ url: `/miniapp/letters?page=${page}&pageSize=${pageSize}` }, true)
    .then((data) => applyPendingMessageDeletes('letters', data))
}

function getArticles(options) {
  if (options?.includeId) {
    return requestAfterOfflineFlush({ url: `/miniapp/articles?contentId=${encodeURIComponent(options.includeId)}` }, false)
  }
  return getResource('articles', options)
}

function getArticlesPage(page, pageSize = 20) {
  return requestFromApi({ url: `/miniapp/articles?page=${page}&pageSize=${pageSize}` })
}

function getArticle(contentId) {
  return requestFromApi({
    url: `/miniapp/articles/${encodeURIComponent(contentId)}`,
    auth: true,
  })
}

function getArticleRecommendations(contentId, { page = 1, pageSize = 20, seed = '' } = {}) {
  const query = [
    `page=${Math.max(1, Number(page) || 1)}`,
    `pageSize=${Math.min(20, Math.max(1, Number(pageSize) || 20))}`,
    `seed=${encodeURIComponent(String(seed || ''))}`,
  ].join('&')
  return requestFromApi({
    url: `/miniapp/articles/${encodeURIComponent(contentId)}/recommendations?${query}`,
    auth: true,
  })
}

async function openArticle(contentId) {
  const payload = { contentId: String(contentId || '').trim() }
  const action = await prepareActionIdempotency('article_open', payload)
  try {
    const data = await requestFromApi({
      url: `/miniapp/articles/${encodeURIComponent(payload.contentId)}/open`,
      method: 'POST',
      data: payload,
      auth: true,
      expectedAccountId: action.accountId,
      header: { 'x-idempotency-key': action.key },
    })
    clearActionIdempotencyKey(action.storageKey)
    invalidateResource('activity')
    return data
  } catch (error) {
    if (!isUncertainActionFailure(error)) clearActionIdempotencyKey(action.storageKey)
    throw error
  }
}

async function unlockArticle(contentId, options = {}) {
  const requestOptions = {
    url: `/miniapp/articles/${encodeURIComponent(contentId)}/unlock`,
    method: 'POST',
    data: { rewarded: options.rewarded === true },
    auth: true,
  }
  try {
    return await requestFromApi(requestOptions)
  } catch (error) {
    if (!isUncertainActionFailure(error)) throw error
    return requestFromApi(requestOptions)
  }
}

function getProfileData(options) {
  return getResource('profile', options)
}

function getActivityData(options) {
  if (options?.section) {
    const page = Math.max(1, Number(options.page) || 1)
    return requestAfterOfflineFlush({ url: `/miniapp/activity?section=${encodeURIComponent(options.section)}&page=${page}&pageSize=20`, auth: true }, true)
  }
  return getResource('activity', options)
}

function getActivityPage(section, page) {
  return getActivityData({ section, page })
}

function getPreferences(options) {
  return getResource('preferences', options)
}

function getCachedProfileData() {
  return getCachedResource('profile')
}

function getCachedPreferences() {
  return getCachedResource('preferences')
}

function getCachedHomeData() {
  return getCachedResource('home')
}

function getCachedLetters() {
  return getCachedResource('letters')
}

function getCachedArticles() {
  return getCachedResource('articles')
}

function getCachedActivityData() {
  return getCachedResource('activity')
}

async function updateProfile(payload) {
  const generation = getSessionGeneration()
  const data = await requestFromApi({ url: '/miniapp/profile', method: 'POST', data: payload, auth: true })
  writeCache('profile', data, undefined, generation)
  return data
}

function createAccountChangedError() {
  const error = new Error('账号已切换，请重试')
  error.kind = 'session'
  error.code = 'ACCOUNT_CHANGED'
  return error
}

async function uploadAvatarFile(url, filePath, generation) {
  const env = getEnvConfig()
  const dataScopeId = await ensureDataScopeId()
  const sessionToken = await ensureMiniAppSession()
  if (!isSessionGenerationCurrent(generation)) throw createAccountChangedError()
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url,
      filePath,
      name: 'avatar',
      header: {
        'x-miniapp-appid': env.appId,
        'x-miniapp-data-scope': encodeDataScopeHeader(dataScopeId),
        'x-miniapp-session': sessionToken,
        'x-visitor-id': getVisitorId(),
      },
      success(result) {
        let body = {}
        try {
          body = JSON.parse(result.data || '{}')
        } catch (error) {
          reject(new Error('头像上传失败，请稍后重试'))
          return
        }
        if (result.statusCode >= 200 && result.statusCode < 300) {
          if (!isSessionGenerationCurrent(generation)) {
            reject(createAccountChangedError())
            return
          }
          resolve(body)
          return
        }
        const uploadError = new Error(body.message || '头像上传失败，请稍后重试')
        uploadError.kind = 'server'
        uploadError.statusCode = result.statusCode
        if (result.statusCode === 409) {
          recoverDataScopeChange(uploadError).then(reject, reject)
          return
        }
        reject(uploadError)
      },
      fail(error) {
        reject(new Error(error.errMsg || '头像上传失败，请稍后重试'))
      },
    })
  })
}

async function uploadAvatar(filePath, canvas) {
  const generation = getSessionGeneration()
  const sourcePath = String(filePath || '').trim()
  if (!sourcePath) throw new Error('请选择头像图片')
  const compressedPath = await createAvatarJpeg(canvas, sourcePath)
  const env = getEnvConfig()
  try {
    const data = await uploadAvatarFile(`${env.apiBaseUrl}/miniapp/profile/avatar`, compressedPath, generation)
    writeCache('profile', data, undefined, generation)
    return data
  } finally {
    removeTemporaryAvatar(compressedPath)
  }
}

async function syncLogin(payload) {
  const generation = getSessionGeneration()
  const data = payload.code
    ? await createMiniAppSession(payload.code, { save: false })
    : await requestFromApi({ url: '/miniapp/profile/sync-login', method: 'POST', data: payload, auth: true })
  const hasReplacementSession = Boolean(
    String(data.sessionToken || '').trim() || String(data.sessionExpiresAt || '').trim(),
  )
  if (hasReplacementSession) {
    commitMiniAppSession(data, { expectedGeneration: generation })
  } else {
    const currentSession = getStoredSession()
    if (
      !isSessionGenerationCurrent(generation)
      || !currentSession
      || String(data.profile?.accountId || '').trim() !== currentSession.accountId
    ) throw new Error('登录状态创建失败，请稍后重试')
  }
  writeCache('profile', data, undefined, getSessionGeneration())
  return data
}

async function openDailyContent(payload) {
  const action = await prepareActionIdempotency('daily_content_open', payload)
  try {
    const data = await requestAfterOfflineFlush({
      url: '/miniapp/daily-content/open',
      method: 'POST',
      data: payload,
      auth: true,
      expectedAccountId: action.accountId,
      header: { 'x-idempotency-key': action.key },
    }, true)
    clearActionIdempotencyKey(action.storageKey)
    invalidateResource('activity')
    return data
  } catch (error) {
    if (!isUncertainActionFailure(error)) clearActionIdempotencyKey(action.storageKey)
    throw error
  }
}

function getDailyContentAvailability(payload) {
  return requestFromApi({
    url: '/miniapp/daily-content/availability',
    method: 'POST',
    data: payload,
    auth: true,
  })
}

async function checkIn() {
  const payload = {}
  const action = await prepareActionIdempotency('check_in', payload)
  try {
    const data = await requestFromApi({
      url: '/miniapp/check-in',
      method: 'POST',
      data: payload,
      auth: true,
      expectedAccountId: action.accountId,
      header: { 'x-idempotency-key': action.key },
    })
    clearActionIdempotencyKey(action.storageKey)
    invalidateResource('home')
    return data
  } catch (error) {
    if (!isUncertainActionFailure(error)) clearActionIdempotencyKey(action.storageKey)
    throw error
  }
}

function getRewardedAdAccess(placement) {
  return requestFromApi({ url: '/miniapp/rewarded-ad-access', method: 'POST', data: { placement }, auth: true })
}

function authorizeSubscription(payload) {
  // 保留订阅页面和授权调用，当前版本入口隐藏且服务端未启用订阅能力。
  return requestFromApi({ url: '/miniapp/subscription/authorize', method: 'POST', data: payload, auth: true })
}

async function submitPrivateMessage(payload) {
  const generation = getSessionGeneration()
  const content = normalizeMessageContent(payload.content)
  if (!isMessageContentWithinLimit(content)) throw new Error(MESSAGE_CONTENT_LIMIT_TEXT)
  const normalizedPayload = { ...payload, content }
  const result = await runOfflineOperation('message', normalizedPayload)
  const data = result.data || { queued: true, status: 'pending' }
  const resource = normalizedPayload.source === 'letters' ? 'letters' : ''
  if (resource) {
    patchCachedResource(resource, (current) => ({
      ...current,
      items: (current.items || []).map((item) => (
        item.id === normalizedPayload.sourceId ? { ...item, myMessage: content } : item
      )),
    }), generation)
  }
  invalidateResource('activity')
  return data
}

async function deletePrivateMessage(payload) {
  const generation = getSessionGeneration()
  const result = await runOfflineOperation('message_delete', payload)
  const data = result.data || { deleted: false, queued: true, status: 'pending' }
  const resource = payload.source === 'letters' ? 'letters' : ''
  if (resource) {
    patchCachedResource(resource, (current) => ({
      ...current,
      items: (current.items || []).map((item) => (
        item.id === payload.sourceId ? { ...item, myMessage: '' } : item
      )),
    }), generation)
  }
  invalidateResource('activity')
  invalidateResource('home')
  return data
}

async function toggleInteraction(payload) {
  const generation = getSessionGeneration()
  const result = await runOfflineOperation('interaction', payload)
  const fallbackInteraction = payload.type === 'like'
    ? { liked: Boolean(payload.desiredState) }
    : { favorited: Boolean(payload.desiredState) }
  const data = result.data || { queued: true, interaction: fallbackInteraction }
  const resource = payload.source === 'letters' ? 'letters' : ''
  const interaction = data.interaction || {}
  if (resource) {
    patchCachedResource(resource, (current) => ({
      ...current,
      items: (current.items || []).map((item) => (
        item.id === payload.sourceId
          ? {
            ...item,
            liked: interaction.liked === undefined ? item.liked : Boolean(interaction.liked),
            favorited: interaction.favorited === undefined ? item.favorited : Boolean(interaction.favorited),
            likeCount: interaction.likeCount ?? item.likeCount,
            favoriteCount: interaction.favoriteCount ?? item.favoriteCount,
          }
          : item
      )),
    }), generation)
  }
  if (payload.source === 'daily_content') {
    patchCachedResource('home', (current) => {
      const item = current.dailyContent
      if (!item || item.id !== payload.sourceId) return current
      return { ...current, dailyContent: { ...item,
        liked: interaction.liked === undefined ? item.liked : Boolean(interaction.liked),
        favorited: interaction.favorited === undefined ? item.favorited : Boolean(interaction.favorited),
        likeCount: interaction.likeCount ?? item.likeCount,
        favoriteCount: interaction.favoriteCount ?? item.favoriteCount,
      } }
    }, generation)
    invalidateResource('home')
  }
  invalidateResource('activity')
  return data
}

let offlineSyncStarted = false

function flushOfflineOperations() {
  if (pendingOfflineFlush) return pendingOfflineFlush
  pendingOfflineFlush = flushPendingOperations().then((result) => {
    if (result.synced || result.discarded) {
      offlineSyncVersion += 1
      invalidateResource('activity')
      invalidateResource('letters')
      invalidateResource('home')
    }
    return result
  }).finally(() => { pendingOfflineFlush = null })
  return pendingOfflineFlush
}

function startOfflineSync() {
  if (offlineSyncStarted) return
  offlineSyncStarted = true
  flushOfflineOperations().catch(() => {})
  wx.onNetworkStatusChange((status) => {
    if (status.isConnected) flushOfflineOperations().catch(() => {})
  })
}

async function recordShareInteraction(payload) {
  const data = await requestFromApi({ url: '/miniapp/interactions/share', method: 'POST', data: payload, auth: true })
  invalidateResource('activity')
  return data
}

module.exports = {
  authorizeSubscription,
  checkIn,
  deletePrivateMessage,
  flushOfflineOperations,
  getActivityData,
  getActivityPage,
  getArticle,
  getArticleRecommendations,
  getArticles,
  getArticlesPage,
  getDailyContentAvailability,
  getCachedActivityData,
  getCachedArticles,
  getCachedHomeData,
  getCachedLetters,
  getCachedPreferences,
  getCachedProfileData,
  getCopyPack,
  getHomeData,
  getLetters,
  getLettersPage,
  getPreferences,
  getProfileData,
  getRewardedAdAccess,
  handleDataScopeChange,
  openArticle,
  openDailyContent,
  recordShareInteraction,
  startOfflineSync,
  submitPrivateMessage,
  toggleInteraction,
  syncLogin,
  unlockArticle,
  uploadAvatar,
  updateProfile,
}
