const { getDatabase } = require('../../lib/state-database')
const { assertMessageContentWithinLimit, normalizeMessageContent } = require('./message-content')
const { normalizeDataContext } = require('../data-scope/data-scope')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeMessage(item = {}) {
  const status = item.status === 'deleted'
    ? 'deleted'
    : item.status === 'blocked' || item.security?.passed === false ? 'blocked' : 'saved'
  const security = item.security && typeof item.security === 'object'
    ? { ...item.security }
    : { passed: true, status: 'passed', reason: '' }
  if (!['blocked', 'failed', 'passed', 'safe', 'unchecked'].includes(security.status)) {
    security.status = security.passed === false ? 'blocked' : 'passed'
    security.reason = security.reason || ''
  }
  return { ...item, status, security }
}

function rowToMessage(row) {
  if (!row) return null
  return normalizeMessage({
    ...JSON.parse(row.item_json),
    id: row.message_id,
    dataScopeId: row.data_scope_id,
    accountId: row.account_id,
    miniProgramId: row.mini_program_id,
    visitorId: row.visitor_id,
    status: row.status,
    source: row.source,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function insertMessage(message, db = getDatabase()) {
  db.prepare(`
    INSERT INTO messages (
      message_id, data_scope_id, account_id, mini_program_id, visitor_id, status, source, source_id,
      created_at, updated_at, item_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id, message.dataScopeId, message.accountId, message.miniProgramId, message.visitorId, message.status,
    message.source, message.sourceId, message.createdAt, message.updatedAt, JSON.stringify(message),
  )
}

function createMessage({ accountId, content, miniProgramId, source, sourceId, security, visitorId }) {
  const context = normalizeDataContext({ accountId, miniProgramId, visitorId })
  const now = new Date().toISOString()
  const normalizedContent = normalizeMessageContent(content)
  assertMessageContentWithinLimit(normalizedContent)
  const message = normalizeMessage({
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    accountId: String(accountId || visitorId || '').trim(),
    dataScopeId: context.dataScopeId,
    content: normalizedContent,
    miniProgramId: context.miniProgramId,
    source: String(source || 'unknown').trim(),
    sourceId: String(sourceId || '').trim(),
    status: security?.status === 'blocked' ? 'blocked' : 'saved',
    security: security || { passed: true, status: 'passed', reason: '' },
    visitorId: String(visitorId || 'anonymous').trim() || 'anonymous',
    createdAt: now,
    updatedAt: now,
  })
  const db = getDatabase()
  if (message.status !== 'saved' || !message.accountId || !message.source || !message.sourceId) {
    insertMessage(message, db)
    return clone(message)
  }

  const current = db.prepare(`
    SELECT * FROM messages
    WHERE data_scope_id = ? AND account_id = ? AND source = ? AND source_id = ?
      AND status IN ('saved', 'deleted')
    ORDER BY updated_at DESC, message_id DESC LIMIT 1
  `).get(message.dataScopeId, message.accountId, message.source, message.sourceId)
  if (!current) {
    insertMessage(message, db)
    return clone(message)
  }

  const existing = rowToMessage(current)
  const replacement = {
    ...message,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date(Math.max(Date.now(), (Date.parse(existing.updatedAt) || 0) + 1)).toISOString(),
  }
  db.prepare(`
    UPDATE messages SET mini_program_id = ?, visitor_id = ?, status = ?, updated_at = ?, item_json = ? WHERE message_id = ?
  `).run(replacement.miniProgramId, replacement.visitorId, replacement.status, replacement.updatedAt, JSON.stringify(replacement), replacement.id)
  return clone(replacement)
}

function getMessageWhere({ miniProgramId = '', source = '', status = '', keyword = '' } = {}) {
  const conditions = status ? [] : ["status <> 'deleted'"]
  const values = []
  if (miniProgramId) {
    conditions.push('data_scope_id = ?')
    values.push(normalizeDataContext({ miniProgramId }).dataScopeId)
  }
  if (source) { conditions.push('source = ?'); values.push(source) }
  if (status) { conditions.push('status = ?'); values.push(status) }
  if (keyword) { conditions.push('LOWER(item_json) LIKE ?'); values.push(`%${keyword.toLowerCase()}%`) }
  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values }
}

function getMessages({ limit = 100, offset = 0, ...filters } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
  const safeOffset = Math.max(0, Number(offset) || 0)
  const where = getMessageWhere(filters)
  return getDatabase().prepare(`
    SELECT * FROM messages ${where.sql}
    ORDER BY created_at DESC, message_id DESC LIMIT ? OFFSET ?
  `).all(...where.values, safeLimit, safeOffset).map(rowToMessage)
}

function countMessages(filters = {}) {
  const where = getMessageWhere(filters)
  return getDatabase().prepare(`SELECT COUNT(*) AS count FROM messages ${where.sql}`).get(...where.values).count
}

function countMessagesByStatus(status) {
  return getDatabase().prepare('SELECT COUNT(*) AS count FROM messages WHERE status = ?')
    .get(String(status || '')).count
}

function getVisibleMessages(context = {}, limit = 20, offset = 0) {
  const normalized = normalizeDataContext(context)
  const accountId = normalized.accountId
  const conditions = ["status = 'saved'"]
  const values = []
  conditions.push('data_scope_id = ?')
  values.push(normalized.dataScopeId)
  if (accountId) {
    conditions.push('account_id = ?')
    values.push(accountId)
  }
  values.push(Math.max(1, Math.min(Number(limit) || 20, 100)))
  values.push(Math.max(0, Number(offset) || 0))
  return getDatabase().prepare(`
    SELECT * FROM messages
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC, message_id DESC
    LIMIT ? OFFSET ?
  `).all(...values).map(rowToMessage)
}

function countVisibleMessages(context = {}) {
  const normalized = normalizeDataContext(context)
  const accountId = normalized.accountId
  if (!accountId) return 0
  return getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM messages
    WHERE status = 'saved' AND data_scope_id = ? AND account_id = ?
  `).get(normalized.dataScopeId, accountId).count
}

function getCurrentMessages(context = {}, source = '', sourceIds = []) {
  const normalized = normalizeDataContext(context)
  const accountId = normalized.accountId
  const normalizedSource = String(source || '').trim()
  const ids = [...new Set(sourceIds.map((item) => String(item || '').trim()).filter(Boolean))]
  if (!accountId || !normalizedSource || !ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(', ')
  return new Map(getDatabase().prepare(`
    SELECT * FROM messages
    WHERE status = 'saved' AND data_scope_id = ? AND account_id = ? AND source = ?
      AND source_id IN (${placeholders})
  `).all(normalized.dataScopeId, accountId, normalizedSource, ...ids)
    .map(rowToMessage)
    .map((message) => [message.sourceId, message]))
}

function updateMessageStatus(id, status) {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM messages WHERE message_id = ?').get(String(id || ''))
  if (!row) return null
  const message = rowToMessage(row)
  message.status = status === 'blocked' ? 'blocked' : 'saved'
  message.updatedAt = new Date(Math.max(Date.now(), (Date.parse(message.updatedAt) || 0) + 1)).toISOString()
  if (message.status === 'saved' && message.accountId && message.source && message.sourceId) {
    const current = db.prepare(`
      SELECT message_id FROM messages
      WHERE data_scope_id = ? AND account_id = ? AND source = ? AND source_id = ?
        AND status = 'saved' AND message_id <> ?
    `).get(message.dataScopeId, message.accountId, message.source, message.sourceId, message.id)
    if (current) throw new Error('该内容已有更新后的留言，无法恢复旧记录')
  }
  db.prepare('UPDATE messages SET status = ?, updated_at = ?, item_json = ? WHERE message_id = ?')
    .run(message.status, message.updatedAt, JSON.stringify(message), message.id)
  return clone(message)
}

function deleteCurrentMessage({ accountId = '', miniProgramId = '', source = '', sourceId = '' } = {}) {
  const normalizedAccountId = String(accountId || '').trim()
  const normalizedMiniProgramId = String(miniProgramId || '').trim()
  const normalizedSource = String(source || '').trim()
  const normalizedSourceId = String(sourceId || '').trim()
  if (!normalizedAccountId || !normalizedMiniProgramId || !normalizedSource || !normalizedSourceId) return null
  const context = normalizeDataContext({
    accountId: normalizedAccountId,
    miniProgramId: normalizedMiniProgramId,
    visitorId: normalizedAccountId,
  })
  const db = getDatabase()
  const row = db.prepare(`
    SELECT * FROM messages
    WHERE data_scope_id = ? AND account_id = ? AND source = ? AND source_id = ? AND status = 'saved'
  `).get(context.dataScopeId, normalizedAccountId, normalizedSource, normalizedSourceId)
  if (!row) return null
  const message = rowToMessage(row)
  message.status = 'deleted'
  message.updatedAt = new Date(Math.max(Date.now(), (Date.parse(message.updatedAt) || 0) + 1)).toISOString()
  db.prepare('UPDATE messages SET status = ?, updated_at = ?, item_json = ? WHERE message_id = ?')
    .run(message.status, message.updatedAt, JSON.stringify(message), message.id)
  return clone(message)
}

function deleteMessage(id) {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM messages WHERE message_id = ?').get(String(id || ''))
  if (!row) return null
  const message = rowToMessage(row)
  message.status = 'deleted'
  message.updatedAt = new Date(Math.max(Date.now(), (Date.parse(message.updatedAt) || 0) + 1)).toISOString()
  db.prepare('UPDATE messages SET status = ?, updated_at = ?, item_json = ? WHERE message_id = ?')
    .run(message.status, message.updatedAt, JSON.stringify(message), message.id)
  return clone(message)
}

function deleteUserMessages({ accountId = '', miniProgramId = '', visitorId = '' } = {}) {
  const normalizedAccountId = String(accountId || '').trim()
  const normalizedMiniProgramId = String(miniProgramId || '').trim()
  const normalizedVisitorId = String(visitorId || '').trim()
  if (normalizedAccountId) {
    const conditions = ['account_id = ?']
    const values = [normalizedAccountId]
    if (normalizedMiniProgramId) {
      conditions.push('data_scope_id = ?')
      values.push(normalizeDataContext({ miniProgramId: normalizedMiniProgramId, visitorId }).dataScopeId)
    }
    return getDatabase().prepare(`DELETE FROM messages WHERE ${conditions.join(' AND ')}`).run(...values).changes
  }
  if (!normalizedMiniProgramId || !normalizedVisitorId) return 0
  const scopeId = normalizeDataContext({ miniProgramId: normalizedMiniProgramId, visitorId: normalizedVisitorId }).dataScopeId
  return getDatabase().prepare('DELETE FROM messages WHERE data_scope_id = ? AND visitor_id = ?')
    .run(scopeId, normalizedVisitorId).changes
}

function moveUserMessages({ miniProgramId = '', fromAccountId = '', fromVisitorIds = [], toAccountId = '' } = {}) {
  const targetMiniProgramId = String(miniProgramId || '').trim()
  const sourceAccountId = String(fromAccountId || '').trim()
  const targetAccountId = String(toAccountId || '').trim()
  const visitorIds = [...new Set(fromVisitorIds.map((item) => String(item || '').trim()).filter(Boolean))]
  if (!targetMiniProgramId || !sourceAccountId || !targetAccountId) return 0
  const dataScopeId = normalizeDataContext({ miniProgramId: targetMiniProgramId, visitorId: targetAccountId }).dataScopeId
  const placeholders = visitorIds.map(() => '?').join(', ')
  const visitorCondition = visitorIds.length ? ` OR visitor_id IN (${placeholders})` : ''
  const db = getDatabase()
  return db.transaction(() => {
    const sourceRows = db.prepare(`
      SELECT * FROM messages
      WHERE data_scope_id = ? AND (account_id = ?${visitorCondition})
    `).all(dataScopeId, sourceAccountId, ...visitorIds).map(rowToMessage)
    const savedByKey = new Map()
    sourceRows.filter((item) => item.status === 'saved').forEach((item) => {
      const key = `${item.source}\u0000${item.sourceId}`
      const current = savedByKey.get(key)
      if (!current || `${item.updatedAt}\u0000${item.id}` > `${current.updatedAt}\u0000${current.id}`) savedByKey.set(key, item)
    })
    const deleteById = db.prepare('DELETE FROM messages WHERE message_id = ?')
    const updateIdentity = db.prepare(`
      UPDATE messages SET account_id = ?, visitor_id = ?, updated_at = ?, item_json = ? WHERE message_id = ?
    `)
    let changes = 0
    sourceRows.filter((item) => item.status !== 'saved').forEach((item) => {
      item.accountId = targetAccountId
      item.visitorId = targetAccountId
      item.updatedAt = new Date().toISOString()
      changes += updateIdentity.run(item.accountId, item.visitorId, item.updatedAt, JSON.stringify(item), item.id).changes
    })
    savedByKey.forEach((winner, key) => {
      const [source, sourceId] = key.split('\u0000')
      const target = db.prepare(`
        SELECT * FROM messages
        WHERE data_scope_id = ? AND account_id = ? AND source = ? AND source_id = ? AND status = 'saved'
      `).get(dataScopeId, targetAccountId, source, sourceId)
      const targetMessage = rowToMessage(target)
      const keepTarget = targetMessage && `${targetMessage.updatedAt}\u0000${targetMessage.id}` >= `${winner.updatedAt}\u0000${winner.id}`
      sourceRows.filter((item) => item.status === 'saved' && `${item.source}\u0000${item.sourceId}` === key).forEach((item) => {
        if (keepTarget || item.id !== winner.id) changes += deleteById.run(item.id).changes
      })
      if (!keepTarget) {
        if (targetMessage) changes += deleteById.run(targetMessage.id).changes
        winner.accountId = targetAccountId
        winner.visitorId = targetAccountId
        winner.updatedAt = new Date().toISOString()
        changes += updateIdentity.run(winner.accountId, winner.visitorId, winner.updatedAt, JSON.stringify(winner), winner.id).changes
      }
    })
    return changes
  })()
}

module.exports = {
  countMessages,
  countMessagesByStatus,
  countVisibleMessages,
  createMessage,
  deleteCurrentMessage,
  deleteMessage,
  deleteUserMessages,
  getMessages,
  getCurrentMessages,
  getVisibleMessages,
  moveUserMessages,
  updateMessageStatus,
}
