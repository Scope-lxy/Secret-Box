function getDayKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeTextPool(values, defaults) {
  const items = Array.isArray(values)
    ? values.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (items.length) return items
  // 覆盖语义：admin 未配置时整体回落默认包，绝不合并
  if (Array.isArray(defaults)) return defaults.map((item) => String(item || '').trim()).filter(Boolean)
  return [defaults]
}

function pickDailyCopy({ values, defaults, storageKey, date = new Date(), storage = wx } = {}) {
  const pool = normalizeTextPool(values, defaults)
  const day = getDayKey(date)
  const cached = storage.getStorageSync(storageKey) || {}
  if (cached.day === day && pool.includes(cached.text)) return cached.text

  const candidates = pool.length > 1 ? pool.filter((item) => item !== cached.text) : pool
  const text = candidates[Math.floor(Math.random() * candidates.length)] || pool[0]
  storage.setStorageSync(storageKey, { day, text })
  return text
}

module.exports = {
  getDayKey,
  pickDailyCopy,
}
