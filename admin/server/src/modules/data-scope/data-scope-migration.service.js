const { getDatabase } = require('../../lib/state-database')
const { buildDataScopeId, normalizeDataMode, scopedRecordId } = require('./data-scope')

function latestKey(item = {}) {
  return `${String(item.updated_at || item.created_at || '')}\u0000${String(item.message_id || item.reaction_key || '')}`
}

function getScopeVisitors(db, miniProgramId) {
  const rows = db.prepare(`
    SELECT accounts.account_id, accounts.visitor_id
    FROM accounts JOIN account_mini_programs USING (account_id)
    WHERE account_mini_programs.mini_program_id = ?
  `).all(miniProgramId)
  return [...new Set(rows.flatMap((row) => [row.account_id, row.visitor_id]).filter(Boolean))]
}

function copyProfiles(db, sourceScopeId, targetScopeId, miniProgramId, accountIds) {
  const findTarget = db.prepare(`
    SELECT * FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?
  `)
  const upsert = db.prepare(`
    INSERT INTO user_scope_profiles (
      data_scope_id, account_id, nickname, avatar_text, avatar_url, preferences_json,
      updated_at, nickname_updated_at, avatar_updated_at, preferences_updated_at,
      origin_mini_program_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_scope_id, account_id) DO UPDATE SET
      nickname = CASE WHEN excluded.nickname_updated_at > nickname_updated_at THEN excluded.nickname ELSE nickname END,
      avatar_text = CASE WHEN excluded.avatar_updated_at > avatar_updated_at THEN excluded.avatar_text ELSE avatar_text END,
      avatar_url = CASE WHEN excluded.avatar_updated_at > avatar_updated_at THEN excluded.avatar_url ELSE avatar_url END,
      preferences_json = CASE WHEN excluded.preferences_updated_at > preferences_updated_at THEN excluded.preferences_json ELSE preferences_json END,
      updated_at = MAX(updated_at, excluded.updated_at),
      nickname_updated_at = MAX(nickname_updated_at, excluded.nickname_updated_at),
      avatar_updated_at = MAX(avatar_updated_at, excluded.avatar_updated_at),
      preferences_updated_at = MAX(preferences_updated_at, excluded.preferences_updated_at),
      origin_mini_program_id = CASE WHEN excluded.updated_at > updated_at THEN excluded.origin_mini_program_id ELSE origin_mini_program_id END
  `)
  const placeholders = accountIds.map(() => '?').join(', ')
  if (!placeholders) return 0
  let changes = 0
  db.prepare(`
    SELECT * FROM user_scope_profiles
    WHERE data_scope_id = ? AND account_id IN (${placeholders})
  `).all(sourceScopeId, ...accountIds).forEach((source) => {
    const target = findTarget.get(targetScopeId, source.account_id)
    if (target
      && target.nickname_updated_at >= source.nickname_updated_at
      && target.avatar_updated_at >= source.avatar_updated_at
      && target.preferences_updated_at >= source.preferences_updated_at) return
    changes += upsert.run(
      targetScopeId, source.account_id, source.nickname, source.avatar_text, source.avatar_url,
      source.preferences_json, source.updated_at, source.nickname_updated_at, source.avatar_updated_at,
      source.preferences_updated_at, source.origin_mini_program_id || miniProgramId,
    ).changes
  })
  return changes
}

function copyCheckins(db, sourceScopeId, targetScopeId, visitors) {
  const placeholders = visitors.map(() => '?').join(', ')
  if (!placeholders) return 0
  const insert = db.prepare(`
    INSERT INTO checkin_records (
      data_scope_id, visitor_id, date_key, checked_at, origin_mini_program_id
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(data_scope_id, visitor_id, date_key) DO UPDATE SET
      checked_at = MIN(checked_at, excluded.checked_at),
      origin_mini_program_id = CASE
        WHEN excluded.checked_at < checked_at THEN excluded.origin_mini_program_id
        ELSE origin_mini_program_id END
  `)
  let changes = 0
  db.prepare(`
    SELECT * FROM checkin_records
    WHERE data_scope_id = ? AND visitor_id IN (${placeholders})
  `).all(sourceScopeId, ...visitors).forEach((row) => {
    changes += insert.run(
      targetScopeId, row.visitor_id, row.date_key, row.checked_at, row.origin_mini_program_id,
    ).changes
  })
  const getTotal = db.prepare(`
    SELECT total_days FROM checkin_users WHERE data_scope_id = ? AND visitor_id = ?
  `)
  const countRecords = db.prepare(`
    SELECT COUNT(*) AS count FROM checkin_records WHERE data_scope_id = ? AND visitor_id = ?
  `)
  const saveTotal = db.prepare(`
    INSERT INTO checkin_users (data_scope_id, visitor_id, total_days) VALUES (?, ?, ?)
    ON CONFLICT(data_scope_id, visitor_id) DO UPDATE SET total_days = MAX(total_days, excluded.total_days)
  `)
  visitors.forEach((visitorId) => {
    saveTotal.run(
      targetScopeId,
      visitorId,
      Math.max(
        Number(getTotal.get(sourceScopeId, visitorId)?.total_days || 0),
        Number(getTotal.get(targetScopeId, visitorId)?.total_days || 0),
        Number(countRecords.get(targetScopeId, visitorId).count || 0),
      ),
    )
  })
  return changes
}

function copyReactions(db, sourceScopeId, targetScopeId, visitors) {
  const placeholders = visitors.map(() => '?').join(', ')
  if (!placeholders) return 0
  const findTarget = db.prepare(`
    SELECT * FROM reactions
    WHERE data_scope_id = ? AND visitor_id = ? AND source = ? AND source_id = ?
  `)
  const insert = db.prepare(`
    INSERT INTO reactions (
      reaction_key, data_scope_id, mini_program_id, visitor_id, source, source_id,
      liked, favorited, liked_at, shared_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_scope_id, visitor_id, source, source_id) DO UPDATE SET
      liked = excluded.liked,
      favorited = excluded.favorited,
      liked_at = excluded.liked_at,
      shared_at = excluded.shared_at,
      updated_at = excluded.updated_at,
      mini_program_id = excluded.mini_program_id
  `)
  let changes = 0
  db.prepare(`
    SELECT * FROM reactions
    WHERE data_scope_id = ? AND visitor_id IN (${placeholders})
  `).all(sourceScopeId, ...visitors).forEach((source) => {
    const target = findTarget.get(targetScopeId, source.visitor_id, source.source, source.source_id)
    if (target && latestKey(target) >= latestKey(source)) return
    changes += insert.run(
      scopedRecordId(targetScopeId, source.reaction_key), targetScopeId, source.mini_program_id,
      source.visitor_id, source.source, source.source_id, source.liked, source.favorited,
      source.liked_at, source.shared_at, source.updated_at,
    ).changes
  })
  return changes
}

function copyOpened(db, sourceScopeId, targetScopeId, visitors) {
  const placeholders = visitors.map(() => '?').join(', ')
  if (!placeholders) return 0
  const insert = db.prepare(`
    INSERT OR IGNORE INTO opened_records (
      opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
      source, source_id, created_at, item_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let changes = 0
  db.prepare(`
    SELECT * FROM opened_records
    WHERE data_scope_id = ? AND visitor_id IN (${placeholders})
  `).all(sourceScopeId, ...visitors).forEach((row) => {
    changes += insert.run(
      scopedRecordId(targetScopeId, row.event_id), row.event_id, targetScopeId, row.mini_program_id,
      row.visitor_id, row.source, row.source_id, row.created_at, row.item_json,
    ).changes
  })
  return changes
}

function copyArticleUnlocks(db, sourceScopeId, targetScopeId, miniProgramId, visitors) {
  const placeholders = visitors.map(() => '?').join(', ')
  if (!placeholders) return 0
  const insert = db.prepare(`
    INSERT OR IGNORE INTO article_unlocks (
      unlock_id, data_scope_id, account_id, mini_program_id, visitor_id,
      article_id, date_key, unlocked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let changes = 0
  db.prepare(`
    SELECT * FROM article_unlocks
    WHERE data_scope_id = ? AND mini_program_id = ? AND visitor_id IN (${placeholders})
  `).all(sourceScopeId, miniProgramId, ...visitors).forEach((row) => {
    changes += insert.run(
      scopedRecordId(targetScopeId, row.unlock_id), targetScopeId, row.account_id,
      row.mini_program_id, row.visitor_id, row.article_id, row.date_key, row.unlocked_at,
    ).changes
  })
  return changes
}

function copyMessages(db, sourceScopeId, targetScopeId, accountIds) {
  const placeholders = accountIds.map(() => '?').join(', ')
  if (!placeholders) return 0
  const findCurrent = db.prepare(`
    SELECT * FROM messages
    WHERE data_scope_id = ? AND account_id = ? AND source = ? AND source_id = ?
      AND status IN ('saved', 'deleted')
    ORDER BY updated_at DESC, message_id DESC LIMIT 1
  `)
  const insert = db.prepare(`
    INSERT INTO messages (
      message_id, data_scope_id, account_id, mini_program_id, visitor_id, status,
      source, source_id, created_at, updated_at, item_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let changes = 0
  db.prepare(`
    SELECT * FROM messages
    WHERE data_scope_id = ? AND account_id IN (${placeholders})
      AND status IN ('saved', 'deleted')
    ORDER BY updated_at DESC, message_id DESC
  `).all(sourceScopeId, ...accountIds).forEach((source) => {
    const target = findCurrent.get(targetScopeId, source.account_id, source.source, source.source_id)
    if (target && latestKey(target) >= latestKey(source)) return
    if (target) db.prepare('DELETE FROM messages WHERE message_id = ?').run(target.message_id)
    changes += insert.run(
      scopedRecordId(targetScopeId, source.message_id), targetScopeId, source.account_id,
      source.mini_program_id, source.visitor_id, source.status, source.source, source.source_id,
      source.created_at, source.updated_at, source.item_json,
    ).changes
  })
  return changes
}

function copyIdempotencyRecords(db, sourceScopeId, targetScopeId, miniProgramId, accountIds, { originOnly = false } = {}) {
  const placeholders = accountIds.map(() => '?').join(', ')
  if (!placeholders) return 0
  const originCondition = originOnly ? ' AND origin_mini_program_id = ?' : ''
  const sourceValues = [sourceScopeId, ...accountIds, ...(originOnly ? [miniProgramId] : [])]
  const findTarget = db.prepare(`
    SELECT * FROM idempotency_records
    WHERE operation = ? AND data_scope_id = ? AND account_id = ? AND request_key = ?
  `)
  const insert = db.prepare(`
    INSERT INTO idempotency_records (
      operation, data_scope_id, origin_mini_program_id, account_id, request_key,
      request_hash, response_status, response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const update = db.prepare(`
    UPDATE idempotency_records SET
      origin_mini_program_id = ?, response_status = ?, response_json = ?, created_at = ?
    WHERE operation = ? AND data_scope_id = ? AND account_id = ? AND request_key = ?
  `)
  let changes = 0
  db.prepare(`
    SELECT * FROM idempotency_records
    WHERE data_scope_id = ? AND account_id IN (${placeholders})${originCondition}
  `).all(...sourceValues).forEach((source) => {
    const target = findTarget.get(source.operation, targetScopeId, source.account_id, source.request_key)
    if (!target) {
      changes += insert.run(
        source.operation, targetScopeId, source.origin_mini_program_id, source.account_id,
        source.request_key, source.request_hash, source.response_status, source.response_json,
        source.created_at,
      ).changes
      return
    }
    if (target.request_hash !== source.request_hash || target.created_at >= source.created_at) return
    changes += update.run(
      source.origin_mini_program_id, source.response_status, source.response_json, source.created_at,
      source.operation, targetScopeId, source.account_id, source.request_key,
    ).changes
  })
  return changes
}

function migrateDataMode({ miniProgramId = '', contentPoolId = '', fromMode, toMode } = {}) {
  const programId = String(miniProgramId || '').trim()
  const poolId = String(contentPoolId || '').trim()
  const sourceMode = normalizeDataMode(fromMode)
  const targetMode = normalizeDataMode(toMode)
  if (!programId || !poolId) throw new Error('数据模式迁移参数不完整')
  if (sourceMode === targetMode) return { changed: false }
  const sourceScopeId = buildDataScopeId({ miniProgramId: programId, contentPoolId: poolId, dataMode: sourceMode })
  const targetScopeId = buildDataScopeId({ miniProgramId: programId, contentPoolId: poolId, dataMode: targetMode })
  const db = getDatabase()
  const migrate = () => {
    const accountIds = db.prepare(`
      SELECT account_id FROM account_mini_programs WHERE mini_program_id = ? ORDER BY account_id
    `).all(programId).map((row) => row.account_id)
    const visitors = getScopeVisitors(db, programId)
    return {
      changed: true,
      sourceScopeId,
      targetScopeId,
      profiles: copyProfiles(db, sourceScopeId, targetScopeId, programId, accountIds),
      checkins: copyCheckins(db, sourceScopeId, targetScopeId, visitors),
      reactions: copyReactions(db, sourceScopeId, targetScopeId, visitors),
      opened: copyOpened(db, sourceScopeId, targetScopeId, visitors),
      unlocks: copyArticleUnlocks(db, sourceScopeId, targetScopeId, programId, visitors),
      messages: copyMessages(db, sourceScopeId, targetScopeId, accountIds),
      idempotency: copyIdempotencyRecords(
        db,
        sourceScopeId,
        targetScopeId,
        programId,
        accountIds,
        { originOnly: sourceMode === 'shared' },
      ),
    }
  }
  return db.inTransaction ? migrate() : db.transaction(migrate)()
}

module.exports = {
  migrateDataMode,
}
