const windowMs = 60 * 1000

const routeLimits = Object.freeze({
  article_unlock: { account: 20, ip: 80 },
  avatar: { account: 5, ip: 20 },
  interaction_share: { account: 20, ip: 80 },
  interaction_toggle: { account: 40, ip: 160 },
  message_create: { account: 12, ip: 60 },
  message_delete: { account: 20, ip: 80 },
  profile_save: { account: 20, ip: 80 },
  profile_sync_login: { account: 10, ip: 40 },
})

const requests = new Map()
let lastCleanupAt = 0

function normalizeKey(scope, value, route) {
  return [scope, value, route].map((item) => String(item || 'unknown').trim() || 'unknown').join('\u0000')
}

function consumeAuthenticatedApiRequest(accountId, ip, route, now = Date.now()) {
  const limits = routeLimits[route]
  if (!limits) return 0
  if (lastCleanupAt + windowMs <= now) {
    requests.forEach((item, key) => {
      if (item.startedAt + windowMs <= now) requests.delete(key)
    })
    lastCleanupAt = now
  }
  return Math.max(0, ...[
    ['account', accountId, limits.account],
    ['ip', ip, limits.ip],
  ].map(([scope, value, limit]) => {
    const key = normalizeKey(scope, value, route)
    const current = requests.get(key)
    if (!current || current.startedAt + windowMs <= now) {
      requests.set(key, { count: 1, startedAt: now })
      return 0
    }
    current.count += 1
    if (current.count <= limit) return 0
    return Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000))
  }))
}

function clearAuthenticatedApiRateLimit(accountId, ip, route) {
  requests.delete(normalizeKey('account', accountId, route))
  requests.delete(normalizeKey('ip', ip, route))
}

module.exports = {
  clearAuthenticatedApiRateLimit,
  consumeAuthenticatedApiRequest,
}
