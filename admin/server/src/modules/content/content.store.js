const { getImagesByIds } = require('../images/image.store')
const { getDatabase } = require('../../lib/state-database')
const { safeArticleSource, articleFingerprint, articleDeduplicationKeys } = require('./article-identity')
const contentImageLimits = {
  contentAlbum: 9,
}
const randomContentOrderCache = new Map()
const RANDOM_CONTENT_ORDER_CACHE_TTL_MS = 10 * 60 * 1000
const RANDOM_CONTENT_ORDER_CACHE_MAX = 256
const randomArticleOrderCache = new Map()
const RANDOM_ARTICLE_ORDER_CACHE_TTL_MS = 30 * 60 * 1000
const RANDOM_ARTICLE_ORDER_CACHE_MAX = 64
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeCount(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
}

function normalizeLabel(value) {
  return String(value || '默认').trim() || '默认'
}

function normalizeContentText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim()
}

function normalizePoolId(poolId) {
  const id = String(poolId || '').trim()
  if (!id) throw new Error('内容池 ID 不能为空')
  return id
}

function normalizeAudioDuration(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0
}

function normalizeAudioTitle(value, originalFilename) {
  return String(value || '').trim()
    || String(originalFilename || '').replace(/\.[^.]+$/, '').trim()
    || '轻读音频'
}

function normalizeDailyContents(items, existing = []) {
  const source = Array.isArray(items) ? items : existing
  return source.map((item, index) => {
    if (item?.type === 'album') {
      return {
        id: String(item.id || `content-album-${index + 1}`).trim(),
        type: 'album',
        label: normalizeLabel(item.label),
        likeCount: normalizeCount(item.likeCount, 0),
        favoriteCount: normalizeCount(item.favoriteCount, 0),
        images: Array.isArray(item.images) ? item.images : [],
      }
    }
    if (item?.type === 'audio') {
      const originalFilename = String(item.originalFilename || '').trim()
      return {
        id: String(item.id || `content-audio-${index + 1}`).trim(),
        type: 'audio',
        label: normalizeLabel(item.label),
        title: normalizeAudioTitle(item.title, originalFilename),
        originalFilename,
        objectKey: String(item.objectKey || '').trim(),
        audioUrl: String(item.audioUrl || '').trim(),
        durationSeconds: normalizeAudioDuration(item.durationSeconds),
        sizeBytes: normalizeCount(item.sizeBytes, 0),
        contentType: String(item.contentType || '').trim(),
        likeCount: normalizeCount(item.likeCount, 0),
        favoriteCount: normalizeCount(item.favoriteCount, 0),
      }
    }
    return {
      id: String(item?.id || `content-text-${index + 1}`).trim(),
      type: 'text',
      label: normalizeLabel(item?.label),
      text: normalizeContentText(item?.text),
      likeCount: normalizeCount(item?.likeCount, 0),
      favoriteCount: normalizeCount(item?.favoriteCount, 0),
    }
  }).filter((item) => (
    item.type === 'album'
      ? item.images.length
      : item.type === 'audio'
        ? item.originalFilename && item.objectKey && item.audioUrl && item.sizeBytes
        : item.text
  ))
}

function normalizeLetters(items, existing = []) {
  const source = Array.isArray(items) ? items : existing
  return source.map((item, index) => ({
    id: String(item.id || `letter-${index + 1}`).trim(),
    label: normalizeLabel(item.label),
    content: normalizeContentText(item.content),
    likeCount: normalizeCount(item.likeCount, 0),
    favoriteCount: normalizeCount(item.favoriteCount, 0),
  })).filter((item) => item.content)
}

function normalizeArticles(items, existing = []) {
  const source = Array.isArray(items) ? items : existing
  return source.map((item, index) => {
    const bodyMarkdown = String(item.bodyMarkdown || '').replace(/\r\n?/g, '\n').trim()
    const requestedBodyImageIds = [...new Set((Array.isArray(item.bodyImageAssetIds) ? item.bodyImageAssetIds : [])
      .map((id) => String(id || '').trim()).filter(Boolean))]
    const bodyImageAssetIds = getImagesByIds(requestedBodyImageIds)
      .filter((image) => [image.originalUrl, image.mediumUrl, image.thumbUrl].some((url) => url && bodyMarkdown.includes(url)))
      .map((image) => image.id)
    return {
      id: String(item.id || `article-${index + 1}`).trim(),
      label: normalizeLabel(item.label),
      title: String(item.title || '').trim(),
      author: String(item.author || '').trim(),
      bodyMarkdown,
      bodyImageAssetIds,
      publishedAt: String(item.publishedAt || '').trim(),
      coverImage: item.coverImage && typeof item.coverImage === 'object'
        ? { id: String(item.coverImage.id || '').trim() }
        : null,
      sourceUrl: String(item.sourceUrl || '').trim(),
      sourceType: ['url', 'document'].includes(String(item.sourceType || '').trim())
        ? String(item.sourceType).trim()
        : (String(item.sourceUrl || '').trim() ? 'url' : ''),
      sourceName: String(item.sourceName || item.fileName || '').trim(),
      sourceHash: String(item.sourceHash || '').trim().toLowerCase(),
      sourceIdentity: safeArticleSource(item.sourceUrl).sourceIdentity,
      importFingerprint: /^[a-f0-9]{64}$/.test(item.importFingerprint || '') ? item.importFingerprint : '',
      contentFingerprint: articleFingerprint({ ...item, bodyMarkdown }),
      likeCount: normalizeCount(item.likeCount, 0),
      favoriteCount: normalizeCount(item.favoriteCount, 0),
    }
  }).filter((item) => item.title && item.bodyMarkdown)
}

function compactImageRefs(items, maxImages) {
  if (!Array.isArray(items)) return []
  return items.slice(0, maxImages).map((item) => ({ id: String(item?.id || '').trim() })).filter((item) => item.id)
}

function insertTypeItems(db, poolId, type, items) {
  const insert = db.prepare(`
    INSERT INTO content_items (pool_id, content_type, item_id, position, item_json)
    VALUES (?, ?, ?, ?, ?)
  `)
  items.forEach((item, position) => insert.run(poolId, type, item.id, position, JSON.stringify(item)))
}

function replaceTypeItems(poolId, type, items) {
  const id = normalizePoolId(poolId)
  const db = getDatabase()
  db.transaction(() => {
    db.prepare('DELETE FROM content_items WHERE pool_id = ? AND content_type = ?').run(id, type)
    insertTypeItems(db, id, type, items)
  })()
}

function ensureContentPool(poolId) {
  return normalizePoolId(poolId)
}

function getTypeItems(poolId, type) {
  const id = ensureContentPool(poolId)
  const items = getDatabase().prepare(`
    SELECT item_json FROM content_items
    WHERE pool_id = ? AND content_type = ?
    ORDER BY position, item_id
  `).all(id, type).map((row) => JSON.parse(row.item_json))
  if (type === 'contentTexts') return normalizeDailyContents(items, []).filter((item) => item.type === 'text')
  if (type === 'contentAudios') return normalizeDailyContents(items, []).filter((item) => item.type === 'audio')
  if (type === 'contentAlbums') return normalizeDailyContents(items, []).filter((item) => item.type === 'album')
  if (type === 'letters') return normalizeLetters(items, [])
  if (type === 'articles') return normalizeArticles(items, [])
  throw new Error('content type is invalid')
}

function getPool(poolId) {
  return {
    dailyContents: [
      ...getTypeItems(poolId, 'contentTexts'),
      ...getTypeItems(poolId, 'contentAlbums'),
      ...getTypeItems(poolId, 'contentAudios'),
    ],
    letters: getTypeItems(poolId, 'letters'),
    articles: getTypeItems(poolId, 'articles'),
  }
}

function resolvePoolImages(pool) {
  const snapshot = clone(pool)
  const refs = [
    ...snapshot.dailyContents.flatMap((item) => item.images || []),
    ...snapshot.articles.map((item) => item.coverImage).filter(Boolean),
  ]
  const assets = new Map(getImagesByIds(refs.map((item) => item.id)).map((item) => [item.id, item]))
  const resolve = (items, limit) => items.filter(Boolean).slice(0, limit).map((item) => assets.get(item.id)).filter(Boolean)
  snapshot.dailyContents = snapshot.dailyContents.map((item) => (
    item.type === 'album'
      ? { ...item, images: resolve(item.images, contentImageLimits.contentAlbum) }
      : item
  ))
  snapshot.articles = snapshot.articles.map((item) => ({
    ...item,
    coverImage: resolve([item.coverImage], 1)[0] || null,
  }))
  return snapshot
}

function getContentSnapshot(poolId) {
  return resolvePoolImages(getPool(poolId))
}

function getContentTypePage(poolId, type, { limit = 100, offset = 0, descending = false, sortByPublishedAt = false } = {}) {
  const id = ensureContentPool(poolId)
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200))
  const safeOffset = Math.max(0, Number(offset) || 0)
  const orderBy = sortByPublishedAt
    ? "json_extract(item_json, '$.publishedAt') DESC, position DESC, item_id DESC"
    : `position ${descending ? 'DESC' : 'ASC'}, item_id ${descending ? 'DESC' : 'ASC'}`
  const db = getDatabase()
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM content_items WHERE pool_id = ? AND content_type = ?
  `).get(id, type).count
  const raw = db.prepare(`
    SELECT item_json FROM content_items
    WHERE pool_id = ? AND content_type = ?
    ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `).all(id, type, safeLimit, safeOffset).map((row) => JSON.parse(row.item_json))
  const items = normalizeItemsForType(type, raw)
  let resolved = items
  if (type === 'contentAlbums') {
    resolved = resolvePoolImages({ dailyContents: items, articles: [], letters: [] }).dailyContents
  } else if (type === 'articles') {
    resolved = resolvePoolImages({ dailyContents: [], articles: items, letters: [] }).articles
  }
  return { items: resolved, total }
}

// Public list randomization is seeded by the service layer so pages requested
// by the unchanged mini-program client share one order without extra requests.
function getRandomContentTypePage(poolId, type, { page = 1, pageSize = 20, seed = '' } = {}) {
  const id = ensureContentPool(poolId)
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  const safePageSize = Math.max(1, Math.min(Math.floor(Number(pageSize) || 20), 20))
  const safeSeed = String(seed || '').trim() || createRandomSeed()
  const ids = getDatabase().prepare(`
    SELECT item_id FROM content_items
    WHERE pool_id = ? AND content_type = ?
  `).all(id, type).map((row) => String(row.item_id))
  const cacheKey = `${id}:${type}:${safeSeed}`
  const signature = ids.join('\u0000')
  const cached = randomContentOrderCache.get(cacheKey)
  const now = Date.now()
  const rankedIds = cached?.signature === signature && cached.expiresAt > now
    ? cached.ids
    : ids
      .map((itemId) => ({ itemId, rank: stableRandomValue(safeSeed, itemId) }))
      .sort((left, right) => left.rank - right.rank || left.itemId.localeCompare(right.itemId))
      .map((entry) => entry.itemId)
  if (!cached || cached.signature !== signature || cached.expiresAt <= now) {
    if (randomContentOrderCache.size >= RANDOM_CONTENT_ORDER_CACHE_MAX) {
      randomContentOrderCache.delete(randomContentOrderCache.keys().next().value)
    }
    randomContentOrderCache.set(cacheKey, {
      ids: rankedIds,
      signature,
      expiresAt: now + RANDOM_CONTENT_ORDER_CACHE_TTL_MS,
    })
  }
  const offset = (safePage - 1) * safePageSize
  const pageIds = rankedIds.slice(offset, offset + safePageSize)
  const placeholders = pageIds.map(() => '?').join(', ')
  const itemRows = pageIds.length
    ? getDatabase().prepare(`
      SELECT item_id, item_json FROM content_items
      WHERE pool_id = ? AND content_type = ? AND item_id IN (${placeholders})
    `).all(id, type, ...pageIds)
    : []
  const itemById = new Map(itemRows.map((row) => [String(row.item_id), JSON.parse(row.item_json)]))
  const items = normalizeItemsForType(type, pageIds.map((itemId) => itemById.get(itemId)).filter(Boolean))
  let resolved = items
  if (type === 'contentAlbums') {
    resolved = resolvePoolImages({ dailyContents: items, articles: [], letters: [] }).dailyContents
  } else if (type === 'articles') {
    resolved = resolvePoolImages({ dailyContents: [], articles: items, letters: [] }).articles
  }
  return {
    items: resolved,
    total: rankedIds.length,
    page: safePage,
    pageSize: safePageSize,
    seed: safeSeed,
  }
}

function getContentItem(poolId, type, itemId) {
  const id = ensureContentPool(poolId)
  const row = getDatabase().prepare(`
    SELECT item_json FROM content_items WHERE pool_id = ? AND content_type = ? AND item_id = ?
  `).get(id, type, String(itemId || '').trim())
  if (!row) return null
  const [item] = normalizeItemsForType(type, [JSON.parse(row.item_json)])
  if (!item) return null
  if (type === 'contentAlbums') {
    return resolvePoolImages({ dailyContents: [item], articles: [], letters: [] }).dailyContents[0] || null
  }
  if (type === 'articles') {
    return resolvePoolImages({ dailyContents: [], articles: [item], letters: [] }).articles[0] || null
  }
  return item
}

function getContentItemsByIds(poolId, entries = []) {
  const id = ensureContentPool(poolId)
  const sourceIds = {
    daily_content: [...new Set(entries.filter((item) => item.source === 'daily_content').map((item) => item.sourceId).filter(Boolean))],
    letters: [...new Set(entries.filter((item) => item.source === 'letters').map((item) => item.sourceId).filter(Boolean))],
    article: [...new Set(entries.filter((item) => item.source === 'article').map((item) => item.sourceId).filter(Boolean))],
  }
  const db = getDatabase()
  const rows = []
  const collect = (types, ids) => {
    if (!ids.length) return
    const typePlaceholders = types.map(() => '?').join(', ')
    const idPlaceholders = ids.map(() => '?').join(', ')
    rows.push(...db.prepare(`
      SELECT content_type, item_json FROM content_items
      WHERE pool_id = ? AND content_type IN (${typePlaceholders}) AND item_id IN (${idPlaceholders})
    `).all(id, ...types, ...ids))
  }
  collect(['contentTexts', 'contentAlbums', 'contentAudios'], sourceIds.daily_content)
  collect(['letters'], sourceIds.letters)
  collect(['articles'], sourceIds.article)
  const dailyContents = []
  const letters = []
  const articles = []
  rows.forEach((row) => {
    const [item] = normalizeItemsForType(row.content_type, [JSON.parse(row.item_json)])
    if (!item) return
    if (['contentTexts', 'contentAlbums', 'contentAudios'].includes(row.content_type)) dailyContents.push(item)
    else if (row.content_type === 'letters') letters.push(item)
    else articles.push(item)
  })
  const resolved = resolvePoolImages({ dailyContents, letters, articles })
  return new Map([
    ...resolved.dailyContents.map((item) => [`daily_content:${item.id}`, item]),
    ...resolved.letters.map((item) => [`letters:${item.id}`, item]),
    ...resolved.articles.map((item) => [`article:${item.id}`, item]),
  ])
}

function getRandomDailyContent(poolId, contentTypes, excludeId = '', options = {}) {
  const id = ensureContentPool(poolId)
  const types = [...new Set(contentTypes.filter((type) => ['contentTexts', 'contentAlbums', 'contentAudios'].includes(type)))]
  if (!types.length) return null
  const placeholders = types.map(() => '?').join(', ')
  const excludedId = String(excludeId || '').trim()
  const openedAfter = String(options.openedAfter || '').trim()
  const openedContext = options.openedContext || {}
  const openedVisitorId = String(openedContext.visitorId || '').trim()
  const conditions = ['content_item.pool_id = ?', `content_item.content_type IN (${placeholders})`]
  const values = [id, ...types]
  if (excludedId) {
    conditions.push('content_item.item_id <> ?')
    values.push(excludedId)
  }
  if (openedAfter && openedContext.miniProgramId && openedVisitorId) {
    const { normalizeDataContext } = require('../data-scope/data-scope')
    const openedDataScopeId = normalizeDataContext(openedContext).dataScopeId
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM opened_records AS recent_opened
      WHERE recent_opened.data_scope_id = ? AND recent_opened.visitor_id = ?
        AND recent_opened.source = ? AND recent_opened.source_id = content_item.item_id
        AND recent_opened.created_at > ?
    )`)
    values.push(openedDataScopeId, openedVisitorId, 'daily_content', openedAfter)
  }
  const db = getDatabase()
  const count = db.prepare(`SELECT COUNT(*) AS count FROM content_items AS content_item WHERE ${conditions.join(' AND ')}`)
    .get(...values).count
  if (!count) return null
  const row = db.prepare(`
    SELECT content_item.content_type, content_item.item_id FROM content_items AS content_item
    WHERE ${conditions.join(' AND ')} ORDER BY content_item.position, content_item.item_id LIMIT 1 OFFSET ?
  `).get(...values, Math.floor(Math.random() * count))
  return getContentItem(id, row.content_type, row.item_id)
}

const RANDOM_ARTICLE_MAX = 100
const RANDOM_ARTICLE_PAGE_SIZE = 20

function createRandomSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function stableRandomValue(seed, itemId) {
  let hash = 2166136261
  const value = `${seed}:${itemId}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function getRandomArticleRankedIds(poolId, seed) {
  const id = ensureContentPool(poolId)
  const safeSeed = String(seed || '').trim() || createRandomSeed()
  const ids = getDatabase().prepare(`
    SELECT item_id FROM content_items
    WHERE pool_id = ? AND content_type = 'articles'
  `).all(id).map((row) => String(row.item_id))
  const cacheKey = `${id}:${safeSeed}`
  const signature = ids.join('\u0000')
  const cached = randomArticleOrderCache.get(cacheKey)
  const now = Date.now()
  if (cached?.signature === signature && cached.expiresAt > now) return cached.ids
  const rankedIds = ids
    .map((itemId) => ({ itemId, rank: stableRandomValue(safeSeed, itemId) }))
    .sort((left, right) => left.rank - right.rank || left.itemId.localeCompare(right.itemId))
    .map((entry) => entry.itemId)
  if (randomArticleOrderCache.size >= RANDOM_ARTICLE_ORDER_CACHE_MAX) {
    randomArticleOrderCache.delete(randomArticleOrderCache.keys().next().value)
  }
  randomArticleOrderCache.set(cacheKey, {
    ids: rankedIds,
    signature,
    expiresAt: now + RANDOM_ARTICLE_ORDER_CACHE_TTL_MS,
  })
  return rankedIds
}

function getRandomArticlePage(poolId, excludeId = '', { page = 1, pageSize = RANDOM_ARTICLE_PAGE_SIZE, seed = '' } = {}) {
  const id = ensureContentPool(poolId)
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  const safePageSize = Math.max(1, Math.min(Math.floor(Number(pageSize) || RANDOM_ARTICLE_PAGE_SIZE), RANDOM_ARTICLE_PAGE_SIZE))
  const safeSeed = String(seed || '').trim() || createRandomSeed()
  const excludedId = String(excludeId || '').trim()
  const ranked = getRandomArticleRankedIds(id, safeSeed)
    .filter((itemId) => itemId !== excludedId)
    .slice(0, RANDOM_ARTICLE_MAX)
  const offset = (safePage - 1) * safePageSize
  return {
    items: ranked
      .slice(offset, offset + safePageSize)
      .map((itemId) => getContentItem(id, 'articles', itemId))
      .filter(Boolean),
    total: ranked.length,
    page: safePage,
    pageSize: safePageSize,
    seed: safeSeed,
  }
}

function getRandomArticles(poolId, excludeId = '', limit = 30, seed = '') {
  return getRandomArticlePage(poolId, excludeId, { page: 1, pageSize: limit, seed }).items
}

function getContentPoolSummaries(poolIds = []) {
  const db = getDatabase()
  const ids = poolIds.length
    ? poolIds.map(normalizePoolId)
    : db.prepare('SELECT DISTINCT pool_id FROM content_items ORDER BY pool_id').all().map((row) => row.pool_id)
  return ids.map((poolId) => {
    ensureContentPool(poolId)
    const rows = db.prepare(`
      SELECT content_type, COUNT(*) AS count FROM content_items WHERE pool_id = ? GROUP BY content_type
    `).all(poolId)
    const counts = Object.fromEntries(rows.map((row) => [row.content_type, row.count]))
    return {
      id: poolId,
      contentTexts: counts.contentTexts || 0,
      contentAudios: counts.contentAudios || 0,
      contentAlbums: counts.contentAlbums || 0,
      letters: counts.letters || 0,
      articles: counts.articles || 0,
    }
  })
}

function collectImageAssetIds(items = []) {
  return [...new Set(items.flatMap((item) => [
    ...(item?.images || []),
    ...(item?.bodyImageAssetIds || []).map((id) => ({ id })),
    item?.coverImage,
  ].filter(Boolean).map((image) => String(image?.id || '').trim()).filter(Boolean)))]
}

function getContentImageAssetIds(poolId, { type = '', itemId = '' } = {}) {
  const conditions = ['pool_id = ?', "content_type IN ('contentAlbums', 'articles')"]
  const values = [normalizePoolId(poolId)]
  if (type) {
    conditions.push('content_type = ?')
    values.push(type)
  }
  if (itemId) {
    conditions.push('item_id = ?')
    values.push(String(itemId).trim())
  }
  const rows = getDatabase().prepare(`
    SELECT item_json FROM content_items WHERE ${conditions.join(' AND ')}
  `).all(...values)
  return collectImageAssetIds(rows.map((row) => JSON.parse(row.item_json)))
}

function buildUrlPrefixPredicate(expression, prefixes) {
  const values = [...new Set(prefixes.map((value) => String(value || '').trim()).filter(Boolean))]
  return {
    sql: values.length ? `(${values.map(() => `instr(${expression}, ?) = 1`).join(' OR ')})` : '0',
    values,
  }
}

function getContentPreflightData(poolId, {
  audioUrlPrefixes = [],
  imageUrlPrefixes = [],
  sampleLimit = 20,
} = {}) {
  const id = ensureContentPool(poolId)
  const db = getDatabase()
  const safeLimit = Math.max(1, Math.min(Number(sampleLimit) || 20, 20))
  const thumb = buildUrlPrefixPredicate("COALESCE(json_extract(asset.item_json, '$.thumbUrl'), '')", imageUrlPrefixes)
  const medium = buildUrlPrefixPredicate("COALESCE(json_extract(asset.item_json, '$.mediumUrl'), '')", imageUrlPrefixes)
  const imageStats = db.prepare(`
    WITH image_refs AS (
      SELECT json_extract(ref.value, '$.id') AS asset_id
      FROM content_items AS content, json_each(content.item_json, '$.images') AS ref
      WHERE content.pool_id = ? AND content.content_type IN ('contentAlbums', 'articles')
      UNION ALL
      SELECT json_extract(content.item_json, '$.coverImage.id') AS asset_id
      FROM content_items AS content
      WHERE content.pool_id = ? AND content.content_type = 'articles'
        AND json_extract(content.item_json, '$.coverImage.id') <> ''
    )
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN asset.status = 'ready' AND ${thumb.sql} AND ${medium.sql} THEN 1 ELSE 0 END), 0) AS structurally_usable
    FROM image_refs
    LEFT JOIN image_assets AS asset ON asset.asset_id = image_refs.asset_id
  `).get(id, id, ...thumb.values, ...medium.values)
  const imageSampleIds = db.prepare(`
    SELECT asset.asset_id FROM image_assets AS asset
    WHERE asset.asset_id IN (
      SELECT json_extract(ref.value, '$.id')
      FROM content_items AS content, json_each(content.item_json, '$.images') AS ref
      WHERE content.pool_id = ? AND content.content_type IN ('contentAlbums', 'articles')
      UNION
      SELECT json_extract(content.item_json, '$.coverImage.id')
      FROM content_items AS content
      WHERE content.pool_id = ? AND content.content_type = 'articles'
    )
    GROUP BY asset.asset_id
    ORDER BY asset.asset_id
    LIMIT ?
  `).all(id, id, safeLimit).map((row) => row.asset_id)
  const audio = buildUrlPrefixPredicate("COALESCE(json_extract(item_json, '$.audioUrl'), '')", audioUrlPrefixes)
  const audioStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN ${audio.sql} THEN 1 ELSE 0 END), 0) AS structurally_usable
    FROM content_items
    WHERE pool_id = ? AND content_type = 'contentAudios'
  `).get(...audio.values, id)
  const audioSample = db.prepare(`
    SELECT item_json FROM content_items
    WHERE pool_id = ? AND content_type = 'contentAudios'
    ORDER BY position, item_id
    LIMIT ?
  `).all(id, safeLimit).map((row) => JSON.parse(row.item_json))
  return {
    audios: {
      sample: audioSample,
      structurallyUsable: audioStats.structurally_usable,
      total: audioStats.total,
    },
    imageRefs: {
      sample: getImagesByIds(imageSampleIds),
      structurallyUsable: imageStats.structurally_usable,
      total: imageStats.total,
    },
    summary: getContentPoolSummaries([id])[0],
  }
}

function normalizeItemsForType(type, items) {
  if (type === 'contentTexts') return normalizeDailyContents(items.map((item) => ({ ...item, type: 'text' })), [])
    .filter((item) => item.type === 'text')
  if (type === 'contentAudios') return normalizeDailyContents(items.map((item) => ({ ...item, type: 'audio' })), [])
    .filter((item) => item.type === 'audio')
  if (type === 'contentAlbums') return normalizeDailyContents(items.map((item) => ({ ...item, type: 'album' })), [])
    .filter((item) => item.type === 'album')
    .map((item) => ({ ...item, images: compactImageRefs(item.images, contentImageLimits.contentAlbum) }))
    .filter((item) => item.images.length)
  if (type === 'letters') return normalizeLetters(items, [])
  if (type === 'articles') return normalizeArticles(items, [])
  throw new Error('content type is invalid')
}

function getContentDeduplicationValue(type, item = {}) {
  if (type === 'contentTexts') return String(item.text || '')
  if (type === 'letters') return String(item.content || '')
  if (type === 'articles') return String(item.sourceHash || item.sourceUrl || item.bodyMarkdown || '')
  return ''
}

function getContentDeduplicationKeys(type, item = {}) {
  return type === 'articles' ? articleDeduplicationKeys(item) : [getContentDeduplicationValue(type, item)].filter(Boolean)
}

function getExistingContentDeduplicationValues(db, poolId, type) {
  const values = new Set()
  db.prepare(`
    SELECT item_json FROM content_items WHERE pool_id = ? AND content_type = ?
  `).all(poolId, type).forEach((row) => {
    const [existing] = normalizeItemsForType(type, [JSON.parse(row.item_json)])
    getContentDeduplicationKeys(type, existing).forEach((value) => values.add(value))
  })
  return values
}

function getDuplicateContentItemIndexes(poolId, type, items) {
  const id = ensureContentPool(poolId)
  const existingValues = getExistingContentDeduplicationValues(getDatabase(), id, type)
  const seenValues = new Set()
  const duplicateIndexes = []
  ;(Array.isArray(items) ? items : []).forEach((item, index) => {
    const [normalized] = normalizeItemsForType(type, [item])
    const keys = getContentDeduplicationKeys(type, normalized)
    if (keys.some((value) => existingValues.has(value) || seenValues.has(value))) duplicateIndexes.push(index)
    else keys.forEach((value) => seenValues.add(value))
  })
  return duplicateIndexes
}

function replaceItems(type, items, poolId) {
  if (!Array.isArray(items)) return getTypeItems(poolId, type)
  const normalized = normalizeItemsForType(type, items)
  replaceTypeItems(poolId, type, normalized)
  return clone(normalized)
}

function updateLetters(items, poolId) {
  return replaceItems('letters', items, poolId)
}

function updateContentTexts(items, poolId) {
  replaceItems('contentTexts', items, poolId)
  return clone(getPool(poolId).dailyContents)
}

function updateContentAlbums(items, poolId) {
  replaceItems('contentAlbums', items, poolId)
  return clone(getPool(poolId).dailyContents)
}

function updateContentAudios(items, poolId) {
  replaceItems('contentAudios', items, poolId)
  return clone(getPool(poolId).dailyContents)
}

function updateArticles(items, poolId) {
  if (!Array.isArray(items)) return replaceItems('articles', items, poolId)
  const previous = new Map(getTypeItems(poolId, 'articles').map((item) => [item.id, item]))
  return replaceItems('articles', items.map((item) => ({
    ...item, importFingerprint: previous.get(item.id)?.importFingerprint || '',
  })), poolId)
}

function updateContentItem(poolId, type, item) {
  const id = ensureContentPool(poolId)
  const previous = type === 'articles' ? getContentItem(id, type, item.id) : null
  const [normalized] = normalizeItemsForType(type, [{ ...previous, ...item, ...(type === 'articles' ? { importFingerprint: previous?.importFingerprint || '' } : {}) }])
  if (!normalized) throw new Error('content item is invalid')
  const result = getDatabase().prepare(`
    UPDATE content_items SET item_json = ?
    WHERE pool_id = ? AND content_type = ? AND item_id = ?
  `).run(JSON.stringify(normalized), id, type, normalized.id)
  if (!result.changes) throw new Error('内容不存在，请刷新后重试')
  return clone(normalized)
}

function appendContentItemsInternal(poolId, type, items, { deduplicate = false } = {}) {
  const id = ensureContentPool(poolId)
  const normalized = normalizeItemsForType(type, items)
  const db = getDatabase()
  return db.transaction(() => {
    const findExisting = db.prepare(`
      SELECT item_json FROM content_items
      WHERE pool_id = ? AND content_type = ? AND item_id = ?
    `)
    normalized.forEach((item) => {
      const row = findExisting.get(id, type, item.id)
      if (!row) return
      const [existing] = normalizeItemsForType(type, [JSON.parse(row.item_json)])
      if (JSON.stringify(existing) !== JSON.stringify(item)) {
        throw new Error(`内容 ID 已存在且内容不一致：${item.id}`)
      }
    })
    const existingValues = deduplicate
      ? getExistingContentDeduplicationValues(db, id, type)
      : new Set()
    const seenValues = new Set()
    let duplicateCount = 0
    const pending = normalized.filter((item) => {
      if (!deduplicate) return true
      const keys = getContentDeduplicationKeys(type, item)
      if (keys.some((value) => existingValues.has(value) || seenValues.has(value))) {
        duplicateCount += 1
        return false
      }
      keys.forEach((value) => seenValues.add(value))
      return true
    })
    let position = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS position FROM content_items WHERE pool_id = ? AND content_type = ?
    `).get(id, type).position + 1
    const insert = db.prepare(`
      INSERT OR IGNORE INTO content_items (pool_id, content_type, item_id, position, item_json)
      VALUES (?, ?, ?, ?, ?)
    `)
    let importedCount = 0
    pending.forEach((item) => {
      const result = insert.run(id, type, item.id, position, JSON.stringify(item))
      if (result.changes) {
        importedCount += 1
        position += 1
      }
    })
    return { duplicateCount, importedCount }
  })()
}

function appendContentItems(poolId, type, items) {
  return appendContentItemsInternal(poolId, type, items).importedCount
}

function appendDeduplicatedContentItems(poolId, type, items) {
  return appendContentItemsInternal(poolId, type, items, { deduplicate: true })
}

function upsertContentItems(poolId, type, items) {
  const id = ensureContentPool(poolId)
  const normalized = normalizeItemsForType(type, items)
  const db = getDatabase()
  db.transaction(() => {
    let position = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS position FROM content_items WHERE pool_id = ? AND content_type = ?
    `).get(id, type).position + 1
    const upsert = db.prepare(`
      INSERT INTO content_items (pool_id, content_type, item_id, position, item_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pool_id, content_type, item_id) DO UPDATE SET item_json = excluded.item_json
    `)
    normalized.forEach((item) => {
      const result = upsert.run(id, type, item.id, position, JSON.stringify(item))
      if (result.changes) position += 1
    })
  })()
  return clone(normalized)
}

function deleteContentItem(poolId, type, itemId) {
  const id = normalizePoolId(poolId)
  if (['contentTexts', 'letters', 'articles'].includes(type)) {
    const count = getDatabase().prepare(`
      SELECT COUNT(*) AS count FROM content_items WHERE pool_id = ? AND content_type = ?
    `).get(id, type).count
    if (count <= 1) throw new Error('该内容类型至少保留一条')
  }
  return getDatabase().prepare(`
    DELETE FROM content_items WHERE pool_id = ? AND content_type = ? AND item_id = ?
  `).run(id, type, String(itemId || '').trim()).changes > 0
}

function deleteContentItems(poolId, type, itemIds) {
  const id = normalizePoolId(poolId)
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map((itemId) => String(itemId || '').trim()).filter(Boolean))]
  if (!ids.length) throw new Error('请至少选择一条内容')
  const placeholders = ids.map(() => '?').join(', ')
  const db = getDatabase()
  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT item_id FROM content_items
      WHERE pool_id = ? AND content_type = ? AND item_id IN (${placeholders})
    `).all(id, type, ...ids)
    if (rows.length !== ids.length) throw new Error('部分内容不存在，请刷新后重试')
    if (['contentTexts', 'letters', 'articles'].includes(type)) {
      const count = db.prepare(`
        SELECT COUNT(*) AS count FROM content_items WHERE pool_id = ? AND content_type = ?
      `).get(id, type).count
      if (count - ids.length < 1) throw new Error('该内容类型至少保留一条')
    }
    db.prepare(`
      DELETE FROM content_items WHERE pool_id = ? AND content_type = ? AND item_id IN (${placeholders})
    `).run(id, type, ...ids)
    return ids
  })()
}

module.exports = {
  collectImageAssetIds,
  contentImageLimits,
  deleteContentItem,
  deleteContentItems,
  getContentPoolSummaries,
  getContentPreflightData,
  getContentItem,
  getContentImageAssetIds,
  getContentItemsByIds,
  getDuplicateContentItemIndexes,
  getContentTypePage,
  getRandomContentTypePage,
  getRandomDailyContent,
  getRandomArticles,
  getRandomArticlePage,
  getContentSnapshot,
  appendContentItems,
  appendDeduplicatedContentItems,
  updateContentItem,
  updateContentAlbums,
  updateContentAudios,
  updateContentTexts,
  updateArticles,
  updateLetters,
  upsertContentItems,
}
