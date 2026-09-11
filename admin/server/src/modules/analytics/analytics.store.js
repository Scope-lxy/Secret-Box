const { toBusinessDateKey } = require('../../lib/business-date')
const { getDatabase } = require('../../lib/state-database')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeDateKey(date = new Date()) {
  return toBusinessDateKey(date)
}

function normalizeContext(context = {}) {
  const miniProgramId = String(context.miniProgramId || '').trim()
  if (!miniProgramId) throw new Error('小程序 ID 不能为空')
  return {
    miniProgramId,
    visitorId: String(context.visitorId || 'anonymous').trim() || 'anonymous',
  }
}

function rowToEvent(row) {
  if (!row) return null
  return {
    id: row.event_id,
    type: row.event_type,
    miniProgramId: row.mini_program_id,
    visitorId: row.visitor_id,
    meta: JSON.parse(row.meta_json),
    createdAt: row.created_at,
  }
}

// Retention is housekeeping. Running a full delete every 100 writes makes
// busy periods repeatedly scan the event table, so cap it to once per hour.
const retentionIntervalMs = 60 * 60 * 1000
let lastRetentionCleanupAt = 0

function recordAnalyticsEvent(type, context = {}, meta = {}, value = new Date()) {
  const normalized = normalizeContext(context)
  const createdAt = new Date(value).toISOString()
  const event = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: String(type || '').trim(),
    miniProgramId: normalized.miniProgramId,
    visitorId: normalized.visitorId,
    meta,
    createdAt,
  }
  if (!event.type) return null
  const db = getDatabase()
  db.prepare(`
    INSERT INTO analytics_events (
      event_id, event_type, mini_program_id, visitor_id, created_at, date_key, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.type, event.miniProgramId, event.visitorId, event.createdAt,
    normalizeDateKey(event.createdAt), JSON.stringify(event.meta),
  )
  if (Date.now() - lastRetentionCleanupAt >= retentionIntervalMs) {
    lastRetentionCleanupAt = Date.now()
    db.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-180 days')").run()
  }
  return clone(event)
}

function recordPageView(context = {}, page = '', dedupeMs = 60 * 1000) {
  const normalized = normalizeContext(context)
  const targetPage = String(page || '').trim()
  const now = new Date()
  const db = getDatabase()
  const record = () => {
    // The existing visitor index returns the latest visit directly; check the
    // business date after reading that one row so midnight starts a new visit.
    // Keep the read and write in one transaction so concurrent requests cannot
    // both pass the same de-duplication check.
    const duplicate = db.prepare(`
      SELECT created_at FROM analytics_events
      WHERE event_type = 'page_view' AND mini_program_id = ? AND visitor_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(normalized.miniProgramId, normalized.visitorId)
    const elapsed = duplicate ? now.getTime() - new Date(duplicate.created_at).getTime() : Infinity
    if (duplicate && elapsed >= 0 && normalizeDateKey(duplicate.created_at) === normalizeDateKey(now)
      && elapsed < dedupeMs) return null
    return recordAnalyticsEvent('page_view', normalized, { page: targetPage }, now)
  }
  return db.inTransaction ? record() : db.transaction(record).immediate()
}

function recordArticleFullOpen(context = {}, articleId = '', value = new Date()) {
  const normalized = normalizeContext(context)
  const id = String(articleId || '').trim()
  if (!id) throw new Error('文章 ID 不能为空')
  const dateKey = normalizeDateKey(value)
  const dayStart = new Date(`${dateKey}T00:00:00+08:00`)
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const db = getDatabase()
  const record = () => {
    // Bound the existing visitor index to this user's article events today.
    const existing = db.prepare(`
      SELECT 1 FROM analytics_events
      WHERE event_type = 'article_unlock' AND mini_program_id = ? AND visitor_id = ?
        AND created_at >= ? AND created_at < ? AND json_extract(meta_json, '$.articleId') = ?
      LIMIT 1
    `).get(normalized.miniProgramId, normalized.visitorId, dayStart.toISOString(), dayEnd.toISOString(), id)
    if (existing) return null
    return recordAnalyticsEvent('article_unlock', normalized, { articleId: id }, value)
  }
  return db.inTransaction ? record() : db.transaction(record)()
}

function getAnalyticsEvents({ limit = 500, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000))
  const safeOffset = Math.max(0, Number(offset) || 0)
  return getDatabase().prepare(`
    SELECT * FROM analytics_events ORDER BY created_at DESC, event_id DESC LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset).map(rowToEvent)
}

function countEvents(type, context = {}, { today = normalizeDateKey() } = {}) {
  const normalized = normalizeContext(context)
  const { normalizeDataContext } = require('../data-scope/data-scope')
  const scoped = normalizeDataContext(context)
  if (type === 'check_in') {
    return getDatabase().prepare(`
      SELECT COUNT(*) AS count FROM checkin_records
      WHERE data_scope_id = ? AND visitor_id = ? AND date_key = ?
    `).get(scoped.dataScopeId, normalized.visitorId, today).count
  }
  if (type === 'daily_content_open') {
    const dayStart = new Date(`${today}T00:00:00+08:00`)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    return getDatabase().prepare(`
      SELECT COUNT(DISTINCT source_id) AS count FROM opened_records
      WHERE data_scope_id = ? AND visitor_id = ? AND source = 'daily_content'
        AND created_at >= ? AND created_at < ?
    `).get(scoped.dataScopeId, normalized.visitorId, dayStart.toISOString(), dayEnd.toISOString()).count
  }
  if (type === 'article_unlock') {
    return getDatabase().prepare(`
      SELECT COUNT(*) AS count FROM article_unlocks
      WHERE data_scope_id = ? AND visitor_id = ? AND date_key = ?
    `).get(scoped.dataScopeId, normalized.visitorId, today).count
  }
  return getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM analytics_events
    WHERE event_type = ? AND mini_program_id = ? AND visitor_id = ? AND date_key = ?
  `).get(String(type || ''), normalized.miniProgramId, normalized.visitorId, today).count
}

function analyticsScope({ miniProgramId = '', miniProgramIds = [], filterMiniProgramIds = false } = {}) {
  const ids = [...new Set((miniProgramIds.length ? miniProgramIds : [miniProgramId])
    .map((id) => String(id || '').trim()).filter(Boolean))]
  return {
    sql: ids.length ? `mini_program_id IN (${ids.map(() => '?').join(', ')})` : (filterMiniProgramIds ? '0 = 1' : '1 = 1'),
    values: ids,
  }
}

function shiftDateKey(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

function dailyActivityRows(scope, firstDate, lastDate) {
  return getDatabase().prepare(`
    SELECT date_key,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) AS visitors,
      SUM(event_type = 'page_view') AS visits,
      SUM(event_type = 'check_in') AS checkins,
      SUM(event_type = 'daily_content_open') AS dailyContentOpens,
      SUM(event_type = 'message_create'
        AND COALESCE(json_extract(meta_json, '$.status'), 'saved') NOT IN ('blocked', 'failed')) AS messages
    FROM analytics_events
    WHERE ${scope.sql} AND date_key >= ? AND date_key <= ?
    GROUP BY date_key
  `).all(...scope.values, firstDate, lastDate)
}

function articleActivityRows(scope, firstDate, lastDate) {
  // Unlock state can be copied when data modes change. Its copies and the new
  // per-app success events describe the same daily operation and must be unioned.
  return getDatabase().prepare(`
    SELECT date_key, COUNT(*) AS articleOpens FROM (
      SELECT mini_program_id, visitor_id, article_id, date_key FROM article_unlocks
      WHERE ${scope.sql} AND date_key >= ? AND date_key <= ?
      UNION
      SELECT mini_program_id, visitor_id, json_extract(meta_json, '$.articleId') AS article_id, date_key
      FROM analytics_events
      WHERE ${scope.sql} AND date_key >= ? AND date_key <= ? AND event_type = 'article_unlock'
        AND COALESCE(json_extract(meta_json, '$.articleId'), '') <> ''
    ) GROUP BY date_key
  `).all(...scope.values, firstDate, lastDate, ...scope.values, firstDate, lastDate)
}

function buildAnalyticsMetrics({ today = normalizeDateKey(), ...options } = {}) {
  const db = getDatabase()
  const scope = analyticsScope(options)
  const totalUsers = db.prepare(`
    SELECT COUNT(DISTINCT account_id) AS count FROM account_mini_programs WHERE ${scope.sql}
  `).get(...scope.values).count
  const row = dailyActivityRows(scope, today, today)[0] || {}
  const weeklyActive = db.prepare(`
    SELECT COUNT(DISTINCT visitor_id) AS count FROM analytics_events
    WHERE ${scope.sql} AND event_type = 'page_view' AND date_key >= ? AND date_key <= ?
  `).get(...scope.values, shiftDateKey(today, -6), today).count
  const articleOpens = articleActivityRows(scope, today, today)[0]?.articleOpens || 0
  return {
    totalUsers: Number(totalUsers || 0),
    weeklyActiveUsers: Number(weeklyActive || 0),
    todayVisitors: Number(row.visitors || 0),
    todayVisits: Number(row.visits || 0),
    todayCheckins: Number(row.checkins || 0),
    todayDailyContentOpens: Number(row.dailyContentOpens || 0),
    todayArticleOpens: Number(articleOpens),
    todayMessages: Number(row.messages || 0),
  }
}

function buildDailyVisitTrend({ days = 7, baseDate = new Date(), ...options } = {}) {
  const weekLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const today = normalizeDateKey(baseDate)
  const dates = Array.from({ length: days }, (_, index) => shiftDateKey(today, -(days - index - 1)))
  if (!dates.length) return []
  const scope = analyticsScope(options)
  const rows = dailyActivityRows(scope, dates[0], dates.at(-1))
  const articleRows = articleActivityRows(scope, dates[0], dates.at(-1))
  const articleByDate = new Map(articleRows.map((row) => [row.date_key, row.articleOpens]))
  const byDate = new Map(rows.map((row) => [row.date_key, row]))
  return dates.map((dateKey) => {
    const row = byDate.get(dateKey) || {}
    return {
      date: dateKey,
      label: weekLabels[new Date(`${dateKey}T00:00:00Z`).getUTCDay()],
      visits: Number(row.visits || 0),
      visitors: Number(row.visitors || 0),
      checkins: Number(row.checkins || 0),
      dailyContentOpens: Number(row.dailyContentOpens || 0),
      articleOpens: Number(articleByDate.get(dateKey) || 0),
    }
  })
}

function deleteUserAnalyticsEvents(context = {}) {
  const normalized = normalizeContext(context)
  return getDatabase().prepare(`
    DELETE FROM analytics_events WHERE mini_program_id = ? AND visitor_id = ?
  `).run(normalized.miniProgramId, normalized.visitorId).changes
}

function moveUserAnalyticsEvents({ miniProgramId = '', fromVisitorIds = [], toVisitorId = '' } = {}) {
  const targetMiniProgramId = String(miniProgramId || '').trim()
  const targetVisitorId = String(toVisitorId || '').trim()
  const sources = [...new Set(fromVisitorIds.map((item) => String(item || '').trim()).filter(Boolean))]
  if (!targetMiniProgramId || !targetVisitorId || !sources.length) return 0
  const placeholders = sources.map(() => '?').join(', ')
  return getDatabase().prepare(`
    UPDATE analytics_events SET visitor_id = ?
    WHERE mini_program_id = ? AND visitor_id IN (${placeholders})
  `).run(targetVisitorId, targetMiniProgramId, ...sources).changes
}

module.exports = {
  buildAnalyticsMetrics,
  buildDailyVisitTrend,
  countEvents,
  deleteUserAnalyticsEvents,
  getAnalyticsEvents,
  moveUserAnalyticsEvents,
  recordArticleFullOpen,
  recordAnalyticsEvent,
  recordPageView,
}
