const { getDatabase } = require('../../lib/state-database')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeImage(item, index = 0) {
  const id = String(item.id || `img-${String(index + 1).padStart(3, '0')}`).trim()
  return {
    id,
    label: String(item.label || id).trim(),
    height: Number(item.height || 0),
    mediumSize: Number(item.mediumSize || 0),
    mediumUrl: String(item.mediumUrl || item.thumbUrl || '').trim(),
    originalName: String(item.originalName || '').trim(),
    originalSha256: /^[a-f0-9]{64}$/.test(String(item.originalSha256 || '').trim().toLowerCase())
      ? String(item.originalSha256).trim().toLowerCase()
      : '',
    originalSize: Number(item.originalSize || 0),
    originalUrl: String(item.originalUrl || '').trim(),
    processingMode: String(item.processingMode || '').trim(),
    processingProfile: String(item.processingProfile || '').trim(),
    usage: String(item.usage || 'daily_content,article').trim(),
    status: ['ready', 'processing', 'failed'].includes(item.status) ? item.status : 'ready',
    thumbSize: Number(item.thumbSize || 0),
    thumbUrl: String(item.thumbUrl || '').trim(),
    uploadedAt: String(item.uploadedAt || '').trim(),
    width: Number(item.width || 0),
  }
}

function rowToImage(row) {
  if (!row) return null
  return normalizeImage({
    ...JSON.parse(row.item_json),
    id: row.asset_id,
    status: row.status,
    uploadedAt: row.uploaded_at,
  })
}

function saveImage(db, image) {
  db.prepare(`
    INSERT INTO image_assets (asset_id, status, uploaded_at, item_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      status = excluded.status,
      uploaded_at = excluded.uploaded_at,
      item_json = excluded.item_json
  `).run(image.id, image.status, image.uploadedAt, JSON.stringify(image))
}

function getImages({ limit = 10000, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10000, 10000))
  const safeOffset = Math.max(0, Number(offset) || 0)
  return getDatabase().prepare(`
    SELECT * FROM image_assets
    ORDER BY uploaded_at DESC, rowid DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset).map(rowToImage)
}

function countImages() {
  return getDatabase().prepare('SELECT COUNT(*) AS count FROM image_assets').get().count
}

function buildUrlPrefixPredicate(expression, prefixes) {
  const values = [...new Set(prefixes.map((value) => String(value || '').trim()).filter(Boolean))]
  return {
    sql: values.length ? `(${values.map(() => `instr(${expression}, ?) = 1`).join(' OR ')})` : '0',
    values,
  }
}

function getImagePreflightData({ urlPrefixes = [], sampleLimit = 20 } = {}) {
  const db = getDatabase()
  const thumb = buildUrlPrefixPredicate("COALESCE(json_extract(item_json, '$.thumbUrl'), '')", urlPrefixes)
  const medium = buildUrlPrefixPredicate("COALESCE(json_extract(item_json, '$.mediumUrl'), '')", urlPrefixes)
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'ready' AND ${thumb.sql} AND ${medium.sql} THEN 1 ELSE 0 END), 0) AS structurally_usable,
      COALESCE(SUM(CASE WHEN json_extract(item_json, '$.processingMode') = 'original-only' THEN 1 ELSE 0 END), 0) AS no_compression
    FROM image_assets
  `).get(...thumb.values, ...medium.values)
  const safeLimit = Math.max(1, Math.min(Number(sampleLimit) || 20, 20))
  const sample = db.prepare(`
    SELECT * FROM image_assets
    ORDER BY uploaded_at DESC, rowid DESC
    LIMIT ?
  `).all(safeLimit).map(rowToImage)
  return {
    noCompression: stats.no_compression,
    sample,
    structurallyUsable: stats.structurally_usable,
    total: stats.total,
  }
}

function getImageById(id) {
  return rowToImage(getDatabase().prepare('SELECT * FROM image_assets WHERE asset_id = ?').get(String(id || '').trim()))
}

function getImagesByIds(ids = []) {
  const values = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  if (!values.length) return []
  const placeholders = values.map(() => '?').join(', ')
  return getDatabase().prepare(`SELECT * FROM image_assets WHERE asset_id IN (${placeholders})`)
    .all(...values).map(rowToImage)
}

function getImagesByOriginalSha256(hashes = []) {
  const values = [...new Set(hashes
    .map((hash) => String(hash || '').trim().toLowerCase())
    .filter((hash) => /^[a-f0-9]{64}$/.test(hash)))]
  if (!values.length) return []
  const placeholders = values.map(() => '?').join(', ')
  return getDatabase().prepare(`
    SELECT * FROM image_assets
    WHERE status = 'ready'
      AND json_extract(item_json, '$.originalSha256') IN (${placeholders})
    ORDER BY uploaded_at, rowid
  `).all(...values).map(rowToImage)
}

function getImageIdsByProcessingMode(processingMode, { batchSize = 500 } = {}) {
  const mode = String(processingMode || '').trim()
  if (!mode) return []
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 500, 2000))
  const ids = []
  let afterRowId = 0
  while (true) {
    const rows = getDatabase().prepare(`
      SELECT rowid AS row_id, asset_id FROM image_assets
      WHERE rowid > ? AND json_extract(item_json, '$.processingMode') = ?
      ORDER BY rowid
      LIMIT ?
    `).all(afterRowId, mode, safeBatchSize)
    if (!rows.length) break
    ids.push(...rows.map((row) => row.asset_id))
    afterRowId = rows[rows.length - 1].row_id
  }
  return ids
}

function usableUrl(value) {
  const url = String(value || '').trim()
  return url.includes('example.com/') ? '' : url
}

function resolveImageRef(ref) {
  if (!ref || typeof ref !== 'object') return null
  const id = String(ref.id || '').trim()
  const asset = id ? getImageById(id) : null
  if (!asset && !id) return null
  return normalizeImage({
    ...(asset || {}),
    ...ref,
    id: id || asset?.id,
    label: ref.label || asset?.label,
    thumbUrl: usableUrl(ref.thumbUrl) || asset?.thumbUrl,
    mediumUrl: usableUrl(ref.mediumUrl) || asset?.mediumUrl,
    originalUrl: usableUrl(ref.originalUrl) || asset?.originalUrl,
    status: ref.status || asset?.status,
    usage: ref.usage || asset?.usage,
  })
}

function updateImages(items) {
  if (!Array.isArray(items)) return getImages()
  const normalized = items.map(normalizeImage).filter((item) => item.id && (item.mediumUrl || item.thumbUrl))
  if (!normalized.length) return getImages()
  const db = getDatabase()
  db.transaction(() => normalized.forEach((image) => saveImage(db, image)))()
  return normalized.map(clone)
}

function deleteImageAsset(id) {
  const asset = getImageById(id)
  if (!asset) return null
  const db = getDatabase()
  if (db.prepare('SELECT COUNT(*) AS count FROM image_assets').get().count <= 1) {
    throw new Error('至少保留一张可用图片素材')
  }
  const referenced = db.prepare(`
    SELECT 1 FROM content_items, json_each(content_items.item_json, '$.images')
    WHERE json_extract(json_each.value, '$.id') = ? LIMIT 1
  `).get(asset.id)
  if (referenced) throw new Error('图片仍被内容引用，请先解除引用')
  db.prepare('DELETE FROM image_assets WHERE asset_id = ?').run(asset.id)
  return clone(asset)
}

function removeImageAsset(id) {
  const asset = getImageById(id)
  if (!asset) return null
  getDatabase().prepare('DELETE FROM image_assets WHERE asset_id = ?').run(asset.id)
  return clone(asset)
}

function addImageAsset(item) {
  return addImageAssets([item])[0]
}

function addImageAssets(items) {
  if (!Array.isArray(items) || !items.length) return []
  const count = countImages()
  const normalized = items.map((item, index) => {
    const image = normalizeImage(item, count + index)
    if (!image.id || (!image.mediumUrl && !image.thumbUrl)) throw new Error('图片素材缺少可用地址')
    return image
  })
  const db = getDatabase()
  db.transaction(() => normalized.forEach((image) => saveImage(db, image)))()
  return normalized.map(clone)
}

module.exports = {
  addImageAsset,
  addImageAssets,
  countImages,
  deleteImageAsset,
  getImageById,
  getImageIdsByProcessingMode,
  getImagePreflightData,
  getImages,
  getImagesByIds,
  getImagesByOriginalSha256,
  resolveImageRef,
  removeImageAsset,
  updateImages,
}
