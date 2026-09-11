const { getEnvConfig } = require('../config/env')
const {
  ensureDataScopeId,
  ensureMiniAppSession,
  getSessionGeneration,
  getStoredSession,
  getStoredDataScopeId,
  getVisitorId,
  isSessionGenerationCurrent,
  refreshDataScopeId,
  request,
} = require('./request')

const STORAGE_PREFIX = 'miniappOfflineOperations:daily-content-v1'

function getStorageKey() {
  const env = getEnvConfig()
  return `${STORAGE_PREFIX}:${env.name}:${env.appId}:${getVisitorId()}`
}

function getRawStoredOperations() {
  const value = wx.getStorageSync(getStorageKey())
  return Array.isArray(value) ? value : []
}

function isStoredOperation(item) {
  return Boolean(
    item
    && ['message', 'message_delete', 'interaction'].includes(item.operation)
    && String(item.accountId || '').trim()
    && item.idempotencyKey
    && item.payload
    && typeof item.payload === 'object',
  )
}

function getStoredOperations() {
  return getRawStoredOperations().filter(isStoredOperation)
}

function getPendingOperations() {
  const currentDataScopeId = getStoredDataScopeId()
  const accountId = getStoredSession()?.accountId || ''
  if (!currentDataScopeId || !accountId) return []
  return getStoredOperations().filter((item) => (
    item.dataScopeId === currentDataScopeId && item.accountId === accountId
  ))
}

function savePendingOperations(items) {
  wx.setStorageSync(getStorageKey(), items)
}

function discardPendingOperationsForScope(dataScopeId) {
  const scopeId = String(dataScopeId || '').trim()
  if (!scopeId) return 0
  const stored = getRawStoredOperations()
  const remaining = stored.filter((entry) => isStoredOperation(entry) && entry.dataScopeId !== scopeId)
  if (remaining.length !== stored.length) savePendingOperations(remaining)
  return stored.length - remaining.length
}

function createIdempotencyKey(operation) {
  return `${operation}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
}

function createAccountChangedError() {
  const error = new Error('账号已切换，请重试')
  error.kind = 'session'
  error.code = 'ACCOUNT_CHANGED'
  return error
}

function requestOperation(entry) {
  const isMessage = entry.operation === 'message' || entry.operation === 'message_delete'
  return request({
    url: isMessage ? '/miniapp/messages' : '/miniapp/interactions/toggle',
    method: entry.operation === 'message_delete' ? 'DELETE' : 'POST',
    data: entry.payload,
    auth: true,
    expectedAccountId: entry.accountId,
    header: {
      'x-idempotency-key': entry.idempotencyKey,
      'x-miniapp-data-scope': entry.dataScopeId,
    },
  })
}

function isRetryableError(error) {
  if (error?.kind === 'network') return true
  const statusCode = Number(error?.statusCode)
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500
}

async function runOfflineOperation(operation, payload) {
  const generation = getSessionGeneration()
  await ensureMiniAppSession()
  const accountId = getStoredSession()?.accountId || ''
  if (!accountId || !isSessionGenerationCurrent(generation)) throw createAccountChangedError()
  const entry = {
    operation,
    accountId,
    payload,
    dataScopeId: await ensureDataScopeId(),
    idempotencyKey: createIdempotencyKey(operation),
    createdAt: new Date().toISOString(),
  }
  if (!isSessionGenerationCurrent(generation)) throw createAccountChangedError()
  try {
    return { queued: false, data: await requestOperation(entry) }
  } catch (error) {
    if (error?.kind !== 'network') throw error
    if (!isSessionGenerationCurrent(generation)) throw error
    const pending = getStoredOperations().filter((item) => (
      item.dataScopeId === entry.dataScopeId && item.accountId === accountId
    ))
    savePendingOperations([...pending, entry])
    return { queued: true, data: null }
  }
}

async function flushPendingOperations() {
  const stored = getRawStoredOperations()
  const pending = stored.filter((entry) => isStoredOperation(entry) && String(entry.dataScopeId || '').trim())
  const completedKeys = new Set()
  let synced = 0
  let discarded = stored.length - pending.length
  stored.filter((entry) => !String(entry.dataScopeId || '').trim())
    .forEach((entry) => completedKeys.add(entry.idempotencyKey))
  let currentDataScopeId
  let currentAccountId
  if (pending.length) {
    if (typeof wx.login === 'function') {
      try {
        await ensureMiniAppSession({ force: true })
      } catch (error) {
        return { synced, discarded, pending: stored.length }
      }
      const remainingKeys = new Set(getStoredOperations().map((entry) => entry.idempotencyKey))
      if (pending.some((entry) => !remainingKeys.has(entry.idempotencyKey))) {
        return { synced, discarded: stored.length, pending: 0 }
      }
      currentAccountId = getStoredSession()?.accountId || ''
    }
    try {
      // 离线队列回放前必须拿到当下最新的数据空间：maxAgeMs 0 = 强制经统一服务重取
      currentDataScopeId = await refreshDataScopeId({ maxAgeMs: 0 })
    } catch (error) {
      const remaining = getStoredOperations().filter((entry) => !completedKeys.has(entry.idempotencyKey))
      savePendingOperations(remaining)
      return { synced, discarded, pending: remaining.length }
    }
  }
  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index]
    if (entry.dataScopeId !== currentDataScopeId || entry.accountId !== currentAccountId) {
      completedKeys.add(entry.idempotencyKey)
      discarded += 1
      continue
    }
    try {
      await requestOperation(entry)
      completedKeys.add(entry.idempotencyKey)
      synced += 1
    } catch (error) {
      if (isRetryableError(error)) {
        break
      }
      completedKeys.add(entry.idempotencyKey)
      discarded += 1
    }
  }
  const remaining = getStoredOperations().filter((entry) => !completedKeys.has(entry.idempotencyKey))
  savePendingOperations(remaining)
  return { synced, discarded, pending: remaining.length }
}

module.exports = {
  discardPendingOperationsForScope,
  flushPendingOperations,
  getPendingOperations,
  runOfflineOperation,
}
