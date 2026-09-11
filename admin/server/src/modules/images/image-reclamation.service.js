const { getDatabase } = require('../../lib/state-database')
const { getInternalAdminSettings } = require('../admin/admin-settings.store')
const { getImageById, removeImageAsset } = require('./image.store')
const { deleteCosObject, getCosObjectKeyFromPublicUrl } = require('../storage/cos.service')

function hasImageReference(value, assetId) {
  if (Array.isArray(value)) return value.some((item) => hasImageReference(item, assetId))
  if (!value || typeof value !== 'object') return false
  if (String(value.coverImage?.id || '').trim() === assetId) return true
  if (Array.isArray(value.images) && value.images.some((image) => String(image?.id || '').trim() === assetId)) return true
  if (Array.isArray(value.bodyImageAssetIds) && value.bodyImageAssetIds.some((id) => String(id || '').trim() === assetId)) return true
  return Object.values(value).some((item) => hasImageReference(item, assetId))
}

function stateTableReferencesImage(table, column, assetId) {
  const rows = getDatabase().prepare(`SELECT ${column} AS value FROM ${table}`).all()
  return rows.some((row) => {
    try {
      return hasImageReference(JSON.parse(row.value), assetId)
    } catch (error) {
      return false
    }
  })
}

function hasRemainingImageReference(assetId) {
  const db = getDatabase()
  const contentReference = db.prepare(`
    SELECT 1 FROM content_items
    WHERE json_extract(item_json, '$.coverImage.id') = ?
      OR EXISTS (
        SELECT 1 FROM json_each(content_items.item_json, '$.images') AS image
        WHERE json_extract(image.value, '$.id') = ?
      )
      OR EXISTS (
        SELECT 1 FROM json_each(content_items.item_json, '$.bodyImageAssetIds') AS image
        WHERE image.value = ?
      )
    LIMIT 1
  `).get(assetId, assetId, assetId)
  if (contentReference) return true

  const backgrounds = getInternalAdminSettings().shareSettings?.private?.backgrounds || []
  if (backgrounds.some((item) => String(item?.imageId || '').trim() === assetId)) return true

  return stateTableReferencesImage('opened_records', 'item_json', assetId)
    || stateTableReferencesImage('idempotency_records', 'response_json', assetId)
    || stateTableReferencesImage('article_import_jobs', 'item_json', assetId)
}

function getImageObjectKeys(image) {
  const storage = getInternalAdminSettings().storage || {}
  return [...new Set(['originalUrl', 'mediumUrl', 'thumbUrl']
    .map((field) => getCosObjectKeyFromPublicUrl(storage, image?.[field]))
    .filter(Boolean))]
}

async function reclaimImageAssets(assetIds = [], { deleteObject = deleteCosObject } = {}) {
  const reclaimed = []
  const retained = []
  for (const assetId of [...new Set(assetIds.map((item) => String(item || '').trim()).filter(Boolean))]) {
    const image = getImageById(assetId)
    if (!image) continue
    if (hasRemainingImageReference(assetId)) {
      retained.push(assetId)
      continue
    }

    // Keep the asset registration when COS deletion fails so the cleanup remains retryable.
    for (const key of getImageObjectKeys(image)) await deleteObject(key)
    removeImageAsset(assetId)
    reclaimed.push(assetId)
  }
  return { reclaimed, retained }
}

module.exports = {
  getImageObjectKeys,
  hasRemainingImageReference,
  reclaimImageAssets,
}
