const windowMs = 15 * 60 * 1000
const maxFailures = 5
const lockMs = 15 * 60 * 1000

const attempts = new Map()

function normalizeKey(ip, account) {
  return `${String(ip || 'unknown').trim() || 'unknown'}\u0000${String(account || '').trim() || 'unknown'}`
}

function getAttempt(ip, account, now = Date.now()) {
  const key = normalizeKey(ip, account)
  const current = attempts.get(key)
  if (!current) return { key, failures: 0, firstFailureAt: now, lockedUntil: 0 }
  if (current.lockedUntil > now) return { key, ...current }
  if (current.firstFailureAt + windowMs <= now) {
    attempts.delete(key)
    return { key, failures: 0, firstFailureAt: now, lockedUntil: 0 }
  }
  return { key, ...current, lockedUntil: 0 }
}

function getLoginRetryAfterSeconds(ip, account, now = Date.now()) {
  return [account, '*'].reduce((retryAfter, target) => {
    const attempt = getAttempt(ip, target, now)
    return Math.max(retryAfter, attempt.lockedUntil > now ? Math.max(1, Math.ceil((attempt.lockedUntil - now) / 1000)) : 0)
  }, 0)
}

function recordLoginFailure(ip, account, now = Date.now()) {
  return [account, '*'].reduce((retryAfter, target) => {
    const attempt = getAttempt(ip, target, now)
    const failures = attempt.failures + 1
    const lockedUntil = failures >= maxFailures ? now + lockMs : 0
    attempts.set(attempt.key, { failures, firstFailureAt: attempt.firstFailureAt, lockedUntil })
    return Math.max(retryAfter, lockedUntil ? Math.ceil(lockMs / 1000) : 0)
  }, 0)
}

function clearLoginFailures(ip, account) {
  attempts.delete(normalizeKey(ip, account))
  attempts.delete(normalizeKey(ip, '*'))
}

module.exports = {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
}
