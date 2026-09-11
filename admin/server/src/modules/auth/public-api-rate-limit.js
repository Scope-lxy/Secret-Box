const windowMs = 60 * 1000
const maxRequests = 120

const requests = new Map()
let lastCleanupAt = 0

function normalizeKey(ip, route) {
  return `${String(ip || 'unknown').trim() || 'unknown'}\u0000${String(route || 'public').trim() || 'public'}`
}

function consumePublicApiRequest(ip, route, now = Date.now()) {
  if (lastCleanupAt + windowMs <= now) {
    requests.forEach((item, key) => {
      if (item.startedAt + windowMs <= now) requests.delete(key)
    })
    lastCleanupAt = now
  }
  const key = normalizeKey(ip, route)
  const current = requests.get(key)
  if (!current || current.startedAt + windowMs <= now) {
    requests.set(key, { count: 1, startedAt: now })
    return 0
  }
  current.count += 1
  if (current.count <= maxRequests) return 0
  return Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000))
}

function clearPublicApiRateLimit(ip, route) {
  requests.delete(normalizeKey(ip, route))
}

module.exports = {
  clearPublicApiRateLimit,
  consumePublicApiRequest,
}
