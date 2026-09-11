const crypto = require('crypto')
const { toBusinessDateKey } = require('../../lib/business-date')
const { getDatabase } = require('../../lib/state-database')
const { normalizeDataContext, scopedRecordId } = require('../data-scope/data-scope')
const { recordArticleFullOpen } = require('../analytics/analytics.store')

function normalizeUnlockContext(context = {}) {
  const normalized = normalizeDataContext(context)
  const visitorId = String(context.visitorId || context.accountId || '').trim()
  if (!visitorId) throw new Error('访客 ID 不能为空')
  return {
    accountId: String(context.accountId || '').trim(),
    dataScopeId: normalized.dataScopeId,
    miniProgramId: String(context.miniProgramId || '').trim(),
    visitorId,
  }
}

function getUnlockedArticleIds(context = {}, value = new Date()) {
  const normalized = normalizeUnlockContext(context)
  const dateKey = toBusinessDateKey(value)
  return getDatabase().prepare(`
    SELECT article_id FROM article_unlocks
    WHERE data_scope_id = ? AND visitor_id = ? AND date_key = ?
    ORDER BY unlocked_at, article_id
  `).all(normalized.dataScopeId, normalized.visitorId, dateKey).map((row) => row.article_id)
}

function isArticleUnlocked(context = {}, articleId = '', value = new Date()) {
  const normalized = normalizeUnlockContext(context)
  const id = String(articleId || '').trim()
  const dateKey = toBusinessDateKey(value)
  if (!id) return false
  return Boolean(getDatabase().prepare(`
    SELECT 1 FROM article_unlocks
    WHERE data_scope_id = ? AND visitor_id = ? AND article_id = ? AND date_key = ?
  `).get(normalized.dataScopeId, normalized.visitorId, id, dateKey))
}

function unlockArticle(context = {}, articleId = '', value = new Date()) {
  const normalized = normalizeUnlockContext(context)
  const id = String(articleId || '').trim()
  if (!id) throw new Error('文章 ID 不能为空')
  const dateKey = toBusinessDateKey(value)
  const unlockedAt = value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  const unlockId = crypto.createHash('sha256')
    .update([normalized.dataScopeId, normalized.visitorId, id, dateKey].join('\u0000'))
    .digest('hex')
  getDatabase().transaction(() => {
    getDatabase().prepare(`
      INSERT INTO article_unlocks (
        unlock_id, data_scope_id, account_id, mini_program_id, visitor_id,
        article_id, date_key, unlocked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(data_scope_id, visitor_id, article_id, date_key) DO NOTHING
    `).run(
      unlockId,
      normalized.dataScopeId,
      normalized.accountId,
      normalized.miniProgramId,
      normalized.visitorId,
      id,
      dateKey,
      unlockedAt,
    )
    recordArticleFullOpen(normalized, id, value)
  })()
  return { articleId: id, dateKey, unlockedAt }
}

function moveArticleUnlocks({ miniProgramId = '', fromVisitorIds = [], toVisitorId = '', toAccountId = '' } = {}) {
  const targetMiniProgramId = String(miniProgramId || '').trim()
  const targetVisitorId = String(toVisitorId || '').trim()
  const visitors = [...new Set(fromVisitorIds.map((value) => String(value || '').trim()).filter(Boolean))]
    .filter((value) => value !== targetVisitorId)
  if (!targetMiniProgramId || !targetVisitorId || !visitors.length) return 0
  const db = getDatabase()
  const placeholders = visitors.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT * FROM article_unlocks
    WHERE mini_program_id = ? AND visitor_id IN (${placeholders})
  `).all(targetMiniProgramId, ...visitors)
  const insert = db.prepare(`
    INSERT OR IGNORE INTO article_unlocks (
      unlock_id, data_scope_id, account_id, mini_program_id, visitor_id,
      article_id, date_key, unlocked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  rows.forEach((row) => insert.run(
    scopedRecordId(row.data_scope_id, row.unlock_id),
    row.data_scope_id, String(toAccountId || row.account_id).trim(), row.mini_program_id, targetVisitorId,
    row.article_id, row.date_key, row.unlocked_at,
  ))
  return db.prepare(`
    DELETE FROM article_unlocks
    WHERE mini_program_id = ? AND visitor_id IN (${placeholders})
  `).run(targetMiniProgramId, ...visitors).changes
}

module.exports = {
  getUnlockedArticleIds,
  isArticleUnlocked,
  moveArticleUnlocks,
  unlockArticle,
}
