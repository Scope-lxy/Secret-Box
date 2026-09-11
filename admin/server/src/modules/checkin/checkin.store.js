const { toBusinessDateKey } = require('../../lib/business-date')
const { getDatabase } = require('../../lib/state-database')
const { normalizeDataContext } = require('../data-scope/data-scope')
const { Solar } = require('lunar-javascript')

const MAJOR_FESTIVALS = [
  ['元旦节', '元旦'],
  ['春节', '春节'],
  ['元宵节', '元宵'],
  ['清明', '清明'],
  ['劳动节', '劳动'],
  ['端午节', '端午'],
  ['七夕节', '七夕'],
  ['中秋节', '中秋'],
  ['重阳节', '重阳'],
  ['国庆节', '国庆'],
  ['除夕', '除夕'],
]

const LUNAR_MONTH_LABELS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function toDateKey(date = new Date()) {
  return toBusinessDateKey(date)
}

function parseDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function addDays(date, amount) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + amount)
  return next
}

function getLunarLabel(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const solar = Solar.fromYmd(year, month, day)
  const lunar = solar.getLunar()
  const festivalNames = new Set([...solar.getFestivals(), ...lunar.getFestivals()])
  const majorFestival = MAJOR_FESTIVALS.find(([name]) => festivalNames.has(name))
  if (majorFestival) return majorFestival[1]

  const jieQi = lunar.getJieQi()
  if (jieQi) return jieQi

  if (lunar.getDay() === 1) {
    const lunarMonth = lunar.getMonth()
    if (lunarMonth < 0) return `闰${Math.abs(lunarMonth) === 1 ? '正' : lunar.getMonthInChinese().replace(/^闰/, '')}`
    return LUNAR_MONTH_LABELS[lunarMonth - 1]
  }
  return lunar.getDayInChinese()
}

function normalizeContext(context = {}) {
  return normalizeDataContext(context)
}

function getUserState(context = {}, { create = true } = {}) {
  const normalized = normalizeContext(context)
  const db = getDatabase()
  let user = db.prepare(`
    SELECT total_days FROM checkin_users WHERE data_scope_id = ? AND visitor_id = ?
  `).get(normalized.dataScopeId, normalized.visitorId)
  if (!user && create) {
    db.prepare(`
      INSERT INTO checkin_users (data_scope_id, visitor_id, total_days) VALUES (?, ?, 0)
    `).run(normalized.dataScopeId, normalized.visitorId)
    user = { total_days: 0 }
  }
  const records = user
    ? db.prepare(`
      SELECT date_key, checked_at FROM checkin_records
      WHERE data_scope_id = ? AND visitor_id = ? ORDER BY date_key
    `).all(normalized.dataScopeId, normalized.visitorId)
    : []
  return {
    checkedAtByDate: Object.fromEntries(records.map((item) => [item.date_key, item.checked_at])),
    checkedDates: records.map((item) => item.date_key),
    totalDays: Number(user?.total_days || 0),
  }
}

function getRecentCalendar(userState, baseDate = new Date()) {
  const weekLabels = ['一', '二', '三', '四', '五', '六', '日']
  const today = parseDateKey(toDateKey(baseDate))
  const dayIndex = today.getUTCDay() === 0 ? 6 : today.getUTCDay() - 1
  const monday = addDays(today, -dayIndex)
  const startDate = addDays(monday, -7)
  const checked = new Set(userState.checkedDates)
  return Array.from({ length: 14 }, (_, index) => {
    const date = addDays(startDate, index)
    const dateKey = toDateKey(date)
    return {
      date: dateKey,
      label: weekLabels[index % 7],
      lunarLabel: getLunarLabel(dateKey),
      checked: checked.has(dateKey),
      today: dateKey === toDateKey(today),
    }
  })
}

function getStreakDays(userState, baseDate = new Date()) {
  const checked = new Set(userState.checkedDates)
  let streak = 0
  let cursor = parseDateKey(toDateKey(baseDate))
  while (checked.has(toDateKey(cursor))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

function getCheckinSummary(userState, baseDate = new Date()) {
  const todayKey = toDateKey(baseDate)
  return {
    checkedToday: userState.checkedDates.includes(todayKey),
    streakDays: getStreakDays(userState, baseDate),
    totalDays: userState.totalDays,
  }
}

function getTodayRank(context = {}, baseDate = new Date()) {
  const normalized = normalizeContext(context)
  const todayKey = toDateKey(baseDate)
  const current = getDatabase().prepare(`
    SELECT checked_at FROM checkin_records
    WHERE data_scope_id = ? AND visitor_id = ? AND date_key = ?
  `).get(normalized.dataScopeId, normalized.visitorId, todayKey)
  if (!current) {
    return getDatabase().prepare(`
      SELECT COUNT(*) + 1 AS rank FROM checkin_records WHERE data_scope_id = ? AND date_key = ?
    `).get(normalized.dataScopeId, todayKey).rank
  }
  return getDatabase().prepare(`
    SELECT COUNT(*) + 1 AS rank FROM checkin_records
    WHERE data_scope_id = ? AND date_key = ?
      AND (checked_at < ? OR (checked_at = ? AND visitor_id < ?))
  `).get(normalized.dataScopeId, todayKey, current.checked_at, current.checked_at, normalized.visitorId).rank
}

function checkInToday(context = {}, baseDate = new Date()) {
  const normalized = normalizeContext(context)
  const todayKey = toDateKey(baseDate)
  const db = getDatabase()
  const created = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO checkin_users (data_scope_id, visitor_id, total_days) VALUES (?, ?, 0)
    `).run(normalized.dataScopeId, normalized.visitorId)
    const result = db.prepare(`
      INSERT OR IGNORE INTO checkin_records (
        data_scope_id, visitor_id, date_key, checked_at, origin_mini_program_id
      ) VALUES (?, ?, ?, ?, ?)
    `).run(normalized.dataScopeId, normalized.visitorId, todayKey, baseDate.toISOString(), normalized.miniProgramId)
    if (result.changes) {
      db.prepare(`
        UPDATE checkin_users SET total_days = MAX(
          total_days + 1,
          (SELECT COUNT(*) FROM checkin_records WHERE data_scope_id = ? AND visitor_id = ?)
        ) WHERE data_scope_id = ? AND visitor_id = ?
      `).run(normalized.dataScopeId, normalized.visitorId, normalized.dataScopeId, normalized.visitorId)
    }
    return Boolean(result.changes)
  })()
  const userState = getUserState(normalized)
  return {
    created,
    checkIn: { ...getCheckinSummary(userState, baseDate), rankToday: getTodayRank(normalized, baseDate) },
    calendarDays: getRecentCalendar(userState, baseDate),
  }
}

function getCheckinState(context = {}, baseDate = new Date(), options = {}) {
  const userState = getUserState(context, options)
  return {
    checkIn: { ...getCheckinSummary(userState, baseDate), rankToday: getTodayRank(context, baseDate) },
    calendarDays: getRecentCalendar(userState, baseDate),
    checkedDates: clone(userState.checkedDates),
  }
}

function deleteCheckinState(context = {}) {
  const normalized = normalizeContext(context)
  const db = getDatabase()
  return db.transaction(() => {
    db.prepare('DELETE FROM checkin_records WHERE data_scope_id = ? AND visitor_id = ?')
      .run(normalized.dataScopeId, normalized.visitorId)
    return db.prepare('DELETE FROM checkin_users WHERE data_scope_id = ? AND visitor_id = ?')
      .run(normalized.dataScopeId, normalized.visitorId).changes
  })()
}

function moveCheckinState({ miniProgramId = '', fromVisitorIds = [], toVisitorId = '' } = {}) {
  const target = normalizeContext({ miniProgramId, visitorId: toVisitorId })
  const sources = [...new Set(fromVisitorIds.map((item) => String(item || '').trim()).filter(Boolean))]
    .filter((item) => item !== target.visitorId)
  if (!sources.length) return 0
  const placeholders = sources.map(() => '?').join(', ')
  const db = getDatabase()
  return db.transaction(() => {
    const sourceUsers = db.prepare(`
      SELECT visitor_id, total_days FROM checkin_users
      WHERE data_scope_id = ? AND visitor_id IN (${placeholders})
    `).all(target.dataScopeId, ...sources)
    if (!sourceUsers.length) return 0
    db.prepare(`
      INSERT OR IGNORE INTO checkin_users (data_scope_id, visitor_id, total_days) VALUES (?, ?, 0)
    `).run(target.dataScopeId, target.visitorId)
    const insert = db.prepare(`
      INSERT OR IGNORE INTO checkin_records (
        data_scope_id, visitor_id, date_key, checked_at, origin_mini_program_id
      ) SELECT data_scope_id, ?, date_key, checked_at, origin_mini_program_id FROM checkin_records
      WHERE data_scope_id = ? AND visitor_id = ?
    `)
    sourceUsers.forEach((source) => insert.run(target.visitorId, target.dataScopeId, source.visitor_id))
    const maximum = Math.max(...sourceUsers.map((item) => Number(item.total_days || 0)))
    db.prepare(`
      UPDATE checkin_users SET total_days = MAX(
        total_days,
        ?,
        (SELECT COUNT(*) FROM checkin_records WHERE data_scope_id = ? AND visitor_id = ?)
      ) WHERE data_scope_id = ? AND visitor_id = ?
    `).run(maximum, target.dataScopeId, target.visitorId, target.dataScopeId, target.visitorId)
    db.prepare(`DELETE FROM checkin_records WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
      .run(target.dataScopeId, ...sources)
    db.prepare(`DELETE FROM checkin_users WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
      .run(target.dataScopeId, ...sources)
    return sourceUsers.length
  })()
}

module.exports = {
  checkInToday,
  deleteCheckinState,
  getCheckinState,
  getLunarLabel,
  getRecentCalendar,
  moveCheckinState,
  parseDateKey,
  toDateKey,
}
