const crypto = require('crypto')
const { getDatabase } = require('../../lib/state-database')
const { normalizeDataContext } = require('../data-scope/data-scope')

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function normalizeContext(context = {}) {
  const miniProgramId = String(context.miniProgramId || '').trim()
  const accountId = String(context.accountId || '').trim()
  if (!miniProgramId || !accountId) throw new Error('请求用户信息不完整')
  return { ...normalizeDataContext(context), miniProgramId, accountId }
}

function normalizeKey(value) {
  const key = String(value || '').trim()
  if (!key) return ''
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new Error('请求幂等键无效')
  return key
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function removeExpiredRecords() {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString()
  getDatabase().prepare('DELETE FROM idempotency_records WHERE created_at < ?').run(cutoff)
}

function getStoredResult({ context, operation, requestKey, payload }) {
  const key = normalizeKey(requestKey)
  if (!key) return null
  removeExpiredRecords()
  const normalized = normalizeContext(context)
  const row = getDatabase().prepare(`
    SELECT request_hash, response_status, response_json
    FROM idempotency_records
    WHERE operation = ? AND data_scope_id = ? AND account_id = ? AND request_key = ?
  `).get(String(operation || '').trim(), normalized.dataScopeId, normalized.accountId, key)
  if (!row) return null
  if (row.request_hash !== hashPayload(payload)) throw new Error('请求幂等键与操作内容不一致')
  return { status: Number(row.response_status), body: JSON.parse(row.response_json) }
}

function executeIdempotently({ context, operation, requestKey, payload, execute }) {
  const key = normalizeKey(requestKey)
  if (!key) return { replayed: false, ...execute() }
  const normalized = normalizeContext(context)
  const normalizedOperation = String(operation || '').trim()
  const requestHash = hashPayload(payload)
  return getDatabase().transaction(() => {
    const existing = getStoredResult({
      context: normalized,
      operation: normalizedOperation,
      requestKey: key,
      payload,
    })
    if (existing) return { replayed: true, ...existing }
    const result = execute()
    getDatabase().prepare(`
      INSERT INTO idempotency_records (
        operation, data_scope_id, origin_mini_program_id, account_id, request_key, request_hash,
        response_status, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedOperation, normalized.dataScopeId, normalized.miniProgramId, normalized.accountId, key, requestHash,
      result.status, JSON.stringify(result.body), new Date().toISOString(),
    )
    return { replayed: false, ...result }
  })()
}

function deleteAccountIdempotencyRecords({ accountId = '', miniProgramId = '' } = {}) {
  const normalizedAccountId = String(accountId || '').trim()
  const normalizedMiniProgramId = String(miniProgramId || '').trim()
  if (!normalizedAccountId || !normalizedMiniProgramId) return 0
  return getDatabase().prepare(`
    DELETE FROM idempotency_records
    WHERE account_id = ? AND origin_mini_program_id = ?
  `).run(normalizedAccountId, normalizedMiniProgramId).changes
}

module.exports = {
  deleteAccountIdempotencyRecords,
  executeIdempotently,
  getStoredResult,
}
