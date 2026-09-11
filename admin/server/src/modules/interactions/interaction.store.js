const { getDatabase } = require('../../lib/state-database')
const { normalizeDataContext, scopedRecordId } = require('../data-scope/data-scope')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeContext(context = {}) {
  return normalizeDataContext(context)
}

const summaryCache = new Map()
const SUMMARY_TTL_MS = 60 * 1000
function interactionCacheKey(context) {
  const normalized = normalizeContext(context)
  return `${normalized.dataScopeId}:${normalized.visitorId}`
}
function invalidateInteractionSummary(context) {
  summaryCache.delete(interactionCacheKey(context))
}

function recordKey(context, source, sourceId) {
  const normalized = normalizeContext(context)
  return scopedRecordId(normalized.dataScopeId, [normalized.visitorId, source, sourceId].join('\u0000'))
}

function rowToReaction(row) {
  if (!row) return null
  return {
    key: row.reaction_key,
    dataScopeId: row.data_scope_id,
    miniProgramId: row.mini_program_id,
    visitorId: row.visitor_id,
    source: row.source,
    sourceId: row.source_id,
    liked: Boolean(row.liked),
    favorited: Boolean(row.favorited),
    likedAt: row.liked_at,
    sharedAt: row.shared_at,
    updatedAt: row.updated_at,
  }
}

function normalizeOpenedImages(images) {
  if (!Array.isArray(images)) return []
  return images.slice(0, 9).map((image) => ({
    id: String(image?.id || '').trim(),
    thumbUrl: String(image?.thumbUrl || '').trim(),
    mediumUrl: String(image?.mediumUrl || '').trim(),
    originalUrl: String(image?.originalUrl || '').trim(),
  })).filter((image) => image.id && (image.thumbUrl || image.mediumUrl))
}

function normalizeOpened(item = {}) {
  return {
    id: String(item.id || `open_${Date.now().toString(36)}`),
    dataScopeId: String(item.dataScopeId || '').trim(),
    miniProgramId: String(item.miniProgramId || '').trim(),
    visitorId: String(item.visitorId || 'anonymous').trim() || 'anonymous',
    source: String(item.source || 'daily_content').trim(),
    sourceId: String(item.sourceId || '').trim(),
    type: String(item.type || '').trim(),
    preview: String(item.preview || '').trim(),
    title: String(item.title || '').trim(),
    originalFilename: String(item.originalFilename || '').trim(),
    audioUrl: String(item.audioUrl || '').trim(),
    durationSeconds: Math.max(0, Number(item.durationSeconds) || 0),
    imageCount: Math.max(0, Number(item.imageCount || 0)),
    images: normalizeOpenedImages(item.images),
    createdAt: String(item.createdAt || new Date().toISOString()),
  }
}

function rowToOpened(row) {
  if (!row) return null
  return normalizeOpened({
    ...JSON.parse(row.item_json),
    id: row.event_id,
    dataScopeId: row.data_scope_id,
    miniProgramId: row.mini_program_id,
    visitorId: row.visitor_id,
    source: row.source,
    sourceId: row.source_id,
    createdAt: row.created_at,
  })
}

function getReaction(context, source, sourceId) {
  const normalized = normalizeContext(context)
  return rowToReaction(getDatabase().prepare(`
    SELECT * FROM reactions
    WHERE data_scope_id = ? AND visitor_id = ? AND source = ? AND source_id = ?
  `).get(normalized.dataScopeId, normalized.visitorId, source, sourceId))
}

function getReactionState(context, source, sourceId) {
  const reaction = getReaction(context, source, sourceId)
  return { liked: Boolean(reaction?.liked), favorited: Boolean(reaction?.favorited) }
}

function getPublicReactionCount(context, source, sourceId, field) {
  const normalized = normalizeContext(context)
  return getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM reactions
    WHERE data_scope_id = ? AND source = ? AND source_id = ? AND ${field} = 1
  `).get(normalized.dataScopeId, source, sourceId).count
}

function getPublicLikeCount(context, source, sourceId) {
  return getPublicReactionCount(context, source, sourceId, 'liked')
}

function getPublicFavoriteCount(context, source, sourceId) {
  return getPublicReactionCount(context, source, sourceId, 'favorited')
}

function saveReaction(reaction) {
  getDatabase().prepare(`
    INSERT INTO reactions (
      reaction_key, data_scope_id, mini_program_id, visitor_id, source, source_id, liked, favorited,
      liked_at, shared_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_scope_id, visitor_id, source, source_id) DO UPDATE SET
      liked = excluded.liked,
      favorited = excluded.favorited,
      liked_at = excluded.liked_at,
      shared_at = excluded.shared_at,
      updated_at = excluded.updated_at
  `).run(
    reaction.key, reaction.dataScopeId, reaction.miniProgramId, reaction.visitorId, reaction.source, reaction.sourceId,
    reaction.liked ? 1 : 0, reaction.favorited ? 1 : 0, reaction.likedAt,
    reaction.sharedAt, reaction.updatedAt,
  )
}

function setReaction(context, { source, sourceId, type, desiredState }) {
  const normalizedSource = String(source || '').trim()
  const normalizedSourceId = String(sourceId || '').trim()
  const normalizedType = String(type || '').trim()
  if (!normalizedSource || !normalizedSourceId || !['like', 'favorite'].includes(normalizedType)
    || typeof desiredState !== 'boolean') {
    throw new Error('互动参数不完整')
  }
  const normalized = normalizeContext(context)
  const reaction = getReaction(normalized, normalizedSource, normalizedSourceId) || {
    key: recordKey(normalized, normalizedSource, normalizedSourceId),
    ...normalized,
    source: normalizedSource,
    sourceId: normalizedSourceId,
    liked: false,
    favorited: false,
    likedAt: '',
    sharedAt: '',
    updatedAt: '',
  }
  const now = new Date(Math.max(Date.now(), (Date.parse(reaction.updatedAt) || 0) + 1)).toISOString()
  if (normalizedType === 'like') {
    reaction.liked = desiredState
    if (reaction.liked) reaction.likedAt = now
  } else {
    reaction.favorited = desiredState
  }
  reaction.updatedAt = now
  saveReaction(reaction)
  invalidateInteractionSummary(normalized)
  return {
    liked: reaction.liked,
    favorited: reaction.favorited,
    publicLikeDelta: getPublicLikeCount(normalized, normalizedSource, normalizedSourceId),
    publicFavoriteDelta: getPublicFavoriteCount(normalized, normalizedSource, normalizedSourceId),
  }
}

function toggleReaction(context, { source, sourceId, type }) {
  const current = getReactionState(context, source, sourceId)
  const normalizedType = String(type || '').trim()
  return setReaction(context, {
    source,
    sourceId,
    type: normalizedType,
    desiredState: normalizedType === 'like' ? !current.liked : !current.favorited,
  })
}

function recordShare(context, { source, sourceId }) {
  const normalizedSource = String(source || '').trim()
  const normalizedSourceId = String(sourceId || '').trim()
  if (!['daily_content', 'letters', 'article'].includes(normalizedSource) || !normalizedSourceId) {
    throw new Error('分享参数不完整')
  }
  const normalized = normalizeContext(context)
  const reaction = getReaction(normalized, normalizedSource, normalizedSourceId) || {
    key: recordKey(normalized, normalizedSource, normalizedSourceId),
    ...normalized,
    source: normalizedSource,
    sourceId: normalizedSourceId,
    liked: false,
    favorited: false,
    likedAt: '',
  }
  reaction.sharedAt = new Date(Math.max(Date.now(), (Date.parse(reaction.updatedAt) || 0) + 1)).toISOString()
  reaction.updatedAt = reaction.sharedAt
  saveReaction(reaction)
  invalidateInteractionSummary(normalized)
  return clone(reaction)
}

function recordOpened(context, source, content = {}) {
  const normalizedSource = String(source || '').trim()
  if (!['daily_content', 'article'].includes(normalizedSource)) return null
  const normalizedSourceId = String(content.id || '').trim()
  if (!normalizedSourceId) return null
  const normalized = normalizeContext(context)
  const images = normalizedSource === 'daily_content' && Array.isArray(content.images) ? content.images : []
  const audioTitle = String(content.title || '').trim()
    || String(content.originalFilename || '').replace(/\.[^.]+$/, '').trim()
    || '轻读音频'
  const articleTitle = String(content.title || '').trim()
  const item = normalizeOpened({
    id: `open_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ...normalized,
    source: normalizedSource,
    sourceId: normalizedSourceId,
    type: normalizedSource === 'article'
      ? 'article'
      : ['text', 'audio', 'album'].includes(content.type) ? content.type : 'text',
    preview: normalizedSource === 'article'
      ? articleTitle
      : content.type === 'album' ? `已打开 ${images.length} 张图片` : content.type === 'audio' ? audioTitle : content.text,
    title: normalizedSource === 'article' ? articleTitle : content.type === 'audio' ? audioTitle : '',
    originalFilename: normalizedSource === 'daily_content' && content.type === 'audio' ? content.originalFilename : '',
    audioUrl: normalizedSource === 'daily_content' && content.type === 'audio' ? content.audioUrl : '',
    durationSeconds: normalizedSource === 'daily_content' && content.type === 'audio' ? content.durationSeconds : 0,
    imageCount: images.length,
    images,
  })
  const db = getDatabase()
  const result = db.transaction(() => {
    db.prepare(`
      INSERT INTO opened_records (
        opened_id, event_id, data_scope_id, mini_program_id, visitor_id, source, source_id, created_at, item_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(data_scope_id, visitor_id, source, source_id) DO UPDATE SET
        mini_program_id = excluded.mini_program_id,
        created_at = excluded.created_at,
        item_json = excluded.item_json
    `).run(item.id, item.id, normalized.dataScopeId, item.miniProgramId, item.visitorId, item.source, item.sourceId, item.createdAt, JSON.stringify(item))
    const row = db.prepare(`
      SELECT * FROM opened_records
      WHERE data_scope_id = ? AND visitor_id = ? AND source = ? AND source_id = ?
    `).get(normalized.dataScopeId, item.visitorId, item.source, item.sourceId)
    return rowToOpened(row)
  })()
  invalidateInteractionSummary(normalized)
  return result
}

function getReactions(context, condition, { limit = 100, offset = 0 } = {}) {
  const normalized = normalizeContext(context)
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
  const safeOffset = Math.max(0, Number(offset) || 0)
  return getDatabase().prepare(`
    SELECT * FROM reactions
    WHERE data_scope_id = ? AND visitor_id = ? AND ${condition}
    ORDER BY updated_at DESC, reaction_key
    LIMIT ? OFFSET ?
  `).all(normalized.dataScopeId, normalized.visitorId, safeLimit, safeOffset).map(rowToReaction)
}

function getFavorites(context, options) {
  return getReactions(context, 'favorited = 1', options)
}

function getContentInteractions(context, options) {
  return getReactions(context, "source IN ('daily_content', 'letters', 'article') AND (liked_at <> '' OR shared_at <> '')", options)
}

function getContentActivity(context, { limit = 100, offset = 0 } = {}) {
  const normalized = normalizeContext(context)
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
  const safeOffset = Math.max(0, Number(offset) || 0)
  return getDatabase().prepare(`
    WITH activity AS (
      SELECT source, source_id, liked_at, shared_at, '' AS message_at
      FROM reactions
      WHERE data_scope_id = ? AND visitor_id = ?
        AND source IN ('daily_content', 'letters', 'article') AND (liked_at <> '' OR shared_at <> '')
      UNION ALL
      SELECT source, source_id, '', '', updated_at
      FROM messages
      WHERE data_scope_id = ? AND visitor_id = ? AND status = 'saved'
        AND source IN ('daily_content', 'letters', 'article')
    ), grouped AS (
      SELECT source, source_id,
        MAX(liked_at) AS liked_at,
        MAX(shared_at) AS shared_at,
        MAX(message_at) AS message_at
      FROM activity
      GROUP BY source, source_id
    )
    SELECT *, MAX(liked_at, shared_at, message_at) AS interacted_at FROM grouped
    ORDER BY interacted_at DESC, source, source_id
    LIMIT ? OFFSET ?
  `).all(
    normalized.dataScopeId, normalized.visitorId,
    normalized.dataScopeId, normalized.visitorId,
    safeLimit, safeOffset,
  ).map((item) => ({
    source: item.source,
    sourceId: item.source_id,
    likedAt: item.liked_at,
    sharedAt: item.shared_at,
    messageAt: item.message_at,
    interactedAt: item.interacted_at,
  }))
}

function countContentActivity(context) {
  const normalized = normalizeContext(context)
  return getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT source, source_id FROM reactions
      WHERE data_scope_id = ? AND visitor_id = ?
        AND source IN ('daily_content', 'letters', 'article') AND (liked_at <> '' OR shared_at <> '')
      UNION
      SELECT source, source_id FROM messages
      WHERE data_scope_id = ? AND visitor_id = ? AND status = 'saved'
        AND source IN ('daily_content', 'letters', 'article')
    )
  `).get(
    normalized.dataScopeId, normalized.visitorId,
    normalized.dataScopeId, normalized.visitorId,
  ).count
}

function getOpened(context, { limit = 100, offset = 0 } = {}) {
  const normalized = normalizeContext(context)
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500))
  const safeOffset = Math.max(0, Number(offset) || 0)
  return getDatabase().prepare(`
    SELECT * FROM opened_records
    WHERE data_scope_id = ? AND visitor_id = ?
    ORDER BY created_at DESC, opened_id DESC
    LIMIT ? OFFSET ?
  `).all(normalized.dataScopeId, normalized.visitorId, safeLimit, safeOffset).map(rowToOpened)
}

function getInteractionSummary(context) {
  const normalized = normalizeContext(context)
  const cacheKey = interactionCacheKey(normalized)
  const cached = summaryCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const db = getDatabase()
  const value = {
    favorites: db.prepare(`
      SELECT COUNT(*) AS count FROM reactions
      WHERE data_scope_id = ? AND visitor_id = ? AND favorited = 1
    `).get(normalized.dataScopeId, normalized.visitorId).count,
    totalOpened: db.prepare(`
      SELECT COUNT(*) AS count FROM opened_records
      WHERE data_scope_id = ? AND visitor_id = ?
    `).get(normalized.dataScopeId, normalized.visitorId).count,
  }
  summaryCache.set(cacheKey, { value, expiresAt: Date.now() + SUMMARY_TTL_MS })
  return value
}

function getReactionMetrics(context) {
  const normalized = normalizeContext(context)
  const row = getDatabase().prepare(`
    SELECT SUM(liked) AS likes, SUM(favorited) AS favorites FROM reactions
    WHERE data_scope_id = ? AND visitor_id = ?
  `).get(normalized.dataScopeId, normalized.visitorId)
  return { likes: Number(row.likes || 0), favorites: Number(row.favorites || 0) }
}

function deleteInteractionData(context = {}) {
  const normalized = normalizeContext(context)
  return getDatabase().transaction(() => ({
    reactions: getDatabase().prepare('DELETE FROM reactions WHERE data_scope_id = ? AND visitor_id = ?')
      .run(normalized.dataScopeId, normalized.visitorId).changes,
    opened: getDatabase().prepare('DELETE FROM opened_records WHERE data_scope_id = ? AND visitor_id = ?')
      .run(normalized.dataScopeId, normalized.visitorId).changes,
  }))()
}

function latest(left, right) {
  return String(left || '') > String(right || '') ? String(left || '') : String(right || '')
}

function moveInteractionData({ miniProgramId = '', fromVisitorIds = [], toVisitorId = '' } = {}) {
  const target = normalizeContext({ miniProgramId, visitorId: toVisitorId })
  const sources = [...new Set(fromVisitorIds.map((item) => String(item || '').trim()).filter(Boolean))]
    .filter((item) => item !== target.visitorId)
  if (!sources.length) return { opened: 0, reactions: 0 }
  const placeholders = sources.map(() => '?').join(', ')
  const db = getDatabase()
  const result = db.transaction(() => {
    const sourceRows = db.prepare(`
      SELECT * FROM reactions WHERE data_scope_id = ? AND visitor_id IN (${placeholders})
    `).all(target.dataScopeId, ...sources).map(rowToReaction)
    sourceRows.forEach((source) => {
      const current = getReaction(target, source.source, source.sourceId)
      const winner = !current || source.updatedAt > current.updatedAt ? source : current
      saveReaction({
        key: recordKey(target, source.source, source.sourceId),
        ...target,
        source: source.source,
        sourceId: source.sourceId,
        liked: Boolean(winner.liked),
        favorited: Boolean(winner.favorited),
        likedAt: latest(current?.likedAt, source.likedAt),
        sharedAt: latest(current?.sharedAt, source.sharedAt),
        updatedAt: latest(current?.updatedAt, source.updatedAt),
      })
    })
    db.prepare(`DELETE FROM reactions WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
      .run(target.dataScopeId, ...sources)
    // Move opened records one by one so the user/content unique key cannot
    // abort an account merge when both accounts opened the same item.
    const sourceOpened = db.prepare(`
      SELECT * FROM opened_records
      WHERE data_scope_id = ? AND visitor_id IN (${placeholders})
    `).all(target.dataScopeId, ...sources)
    const findTargetOpened = db.prepare(`
      SELECT * FROM opened_records
      WHERE data_scope_id = ? AND visitor_id = ? AND source = ? AND source_id = ?
    `)
    const updateOpened = db.prepare('UPDATE opened_records SET visitor_id = ?, item_json = ?, created_at = ? WHERE opened_id = ?')
    const deleteOpened = db.prepare('DELETE FROM opened_records WHERE opened_id = ?')
    let opened = 0
    sourceOpened.forEach((source) => {
      const current = findTargetOpened.get(target.dataScopeId, target.visitorId, source.source, source.source_id)
      if (!current) {
        opened += updateOpened.run(target.visitorId, source.item_json, source.created_at, source.opened_id).changes
        return
      }
      const sourceWins = String(source.created_at || '') > String(current.created_at || '')
        || (String(source.created_at || '') === String(current.created_at || '')
          && String(source.opened_id || '') > String(current.opened_id || ''))
      if (sourceWins) {
        updateOpened.run(target.visitorId, source.item_json, source.created_at, current.opened_id)
      }
      deleteOpened.run(source.opened_id)
    })
    return { opened, reactions: sourceRows.length }
  })()
  invalidateInteractionSummary(target)
  sources.forEach((visitorId) => invalidateInteractionSummary({
    miniProgramId: target.miniProgramId,
    visitorId,
  }))
  return result
}

module.exports = {
  countContentActivity,
  deleteInteractionData,
  getContentActivity,
  getContentInteractions,
  getFavorites,
  getInteractionSummary,
  invalidateInteractionSummary,
  getOpened,
  getPublicFavoriteCount,
  getPublicLikeCount,
  getReactionMetrics,
  getReactionState,
  moveInteractionData,
  recordOpened,
  recordShare,
  setReaction,
  toggleReaction,
}
