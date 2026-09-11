const crypto = require('crypto')
const { getDatabase } = require('../../lib/state-database')

const sessionTtlMs = 30 * 24 * 60 * 60 * 1000

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

function rowToSession(row) {
  if (!row) return null
  return {
    accountId: row.account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    miniProgramId: row.mini_program_id,
    tokenHash: row.token_hash,
  }
}

function pruneExpiredSessions() {
  return getDatabase().prepare('DELETE FROM miniapp_sessions WHERE expires_at <= ?')
    .run(new Date().toISOString()).changes
}

function createMiniAppSession({ accountId, miniProgramId }) {
  pruneExpiredSessions()
  const targetMiniProgramId = String(miniProgramId || '').trim()
  if (!targetMiniProgramId) throw new Error('小程序 ID 不能为空')
  const token = crypto.randomBytes(32).toString('hex')
  const createdAt = new Date()
  const session = {
    accountId: String(accountId || '').trim(),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + sessionTtlMs).toISOString(),
    miniProgramId: targetMiniProgramId,
    tokenHash: hashToken(token),
  }
  if (!session.accountId) throw new Error('账号身份无效')
  getDatabase().prepare(`
    INSERT INTO miniapp_sessions (token_hash, account_id, mini_program_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(session.tokenHash, session.accountId, session.miniProgramId, session.createdAt, session.expiresAt)
  return { expiresAt: session.expiresAt, token }
}

function getMiniAppSession(token, miniProgramId) {
  const tokenHash = hashToken(token)
  const targetMiniProgramId = String(miniProgramId || '').trim()
  if (!targetMiniProgramId) throw new Error('小程序 ID 不能为空')
  const row = getDatabase().prepare(`
    SELECT * FROM miniapp_sessions
    WHERE token_hash = ? AND mini_program_id = ? AND expires_at > ?
  `).get(tokenHash, targetMiniProgramId, new Date().toISOString())
  return row ? clone(rowToSession(row)) : null
}

function deleteMiniAppSessionsByAccountId(accountId) {
  const target = String(accountId || '').trim()
  if (!target) return 0
  return getDatabase().prepare('DELETE FROM miniapp_sessions WHERE account_id = ?').run(target).changes
}

function deleteMiniAppSessionsByAccountAndMiniProgramId(accountId, miniProgramId) {
  const targetAccountId = String(accountId || '').trim()
  const targetMiniProgramId = String(miniProgramId || '').trim()
  if (!targetAccountId || !targetMiniProgramId) return 0
  return getDatabase().prepare(`
    DELETE FROM miniapp_sessions WHERE account_id = ? AND mini_program_id = ?
  `).run(targetAccountId, targetMiniProgramId).changes
}

function deleteMiniAppSessionsByMiniProgramId(miniProgramId) {
  const target = String(miniProgramId || '').trim()
  if (!target) return 0
  return getDatabase().prepare('DELETE FROM miniapp_sessions WHERE mini_program_id = ?').run(target).changes
}

function moveMiniAppSessions({ fromAccountId = '', miniProgramId = '', toAccountId = '' } = {}) {
  const sourceAccountId = String(fromAccountId || '').trim()
  const targetAccountId = String(toAccountId || '').trim()
  const targetMiniProgramId = String(miniProgramId || '').trim()
  if (!sourceAccountId || !targetAccountId || !targetMiniProgramId || sourceAccountId === targetAccountId) return 0
  return getDatabase().prepare(`
    UPDATE miniapp_sessions SET account_id = ? WHERE account_id = ? AND mini_program_id = ?
  `).run(targetAccountId, sourceAccountId, targetMiniProgramId).changes
}

module.exports = {
  createMiniAppSession,
  deleteMiniAppSessionsByAccountAndMiniProgramId,
  deleteMiniAppSessionsByAccountId,
  deleteMiniAppSessionsByMiniProgramId,
  getMiniAppSession,
  moveMiniAppSessions,
}
