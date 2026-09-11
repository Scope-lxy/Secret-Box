const crypto = require('crypto')
const path = require('path')
const { env } = require('../../config/env')
const { getDataDir } = require('../../lib/data-dir')
const { readState, writeState } = require('../../lib/state-database')

const dataDir = getDataDir(path.resolve(__dirname, '../../../data'))
const dataFile = path.join(dataDir, 'admin-auth.json')
const sessionTtlMs = 24 * 60 * 60 * 1000

const defaultState = {
  account: 'admin',
  passwordHash: '',
  salt: '',
  session: {
    token: '',
    createdAt: '',
    expiresAt: '',
  },
}

let state = loadState()

function refreshState() {
  state = loadState()
  return state
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), String(salt || ''), 120000, 32, 'sha256').toString('hex')
}

function createSalt() {
  return crypto.randomBytes(16).toString('hex')
}

function normalizeAccount(value) {
  const next = String(value || '').trim()
  return next || defaultState.account
}

function normalizePassword(value) {
  return String(value || '').trim()
}

function normalizeSession(session = {}) {
  return {
    token: String(session.token || '').trim(),
    createdAt: String(session.createdAt || '').trim(),
    expiresAt: String(session.expiresAt || '').trim(),
  }
}

function normalizeState(input = {}) {
  const saved = input && typeof input === 'object' ? input : {}
  const account = normalizeAccount(saved.account)
  const salt = String(saved.salt || '').trim() || createSalt()
  const passwordHash = String(saved.passwordHash || '').trim()
  return {
    account,
    salt,
    passwordHash,
    session: normalizeSession(saved.session),
  }
}

function loadState() {
  const saved = readState(dataFile)
  if (saved === null) return normalizeState(defaultState)
  if (!saved || typeof saved !== 'object' || !saved.account || !saved.salt || !saved.passwordHash) {
    throw new Error('admin auth state is invalid')
  }
  return normalizeState(saved)
}

function saveState() {
  writeState(dataFile, state)
}

function ensureDefaultPassword() {
  if (state.passwordHash) return true
  if (env.productionLike) return false
  state.salt = createSalt()
  state.passwordHash = hashPassword('123456', state.salt)
  state.session = normalizeSession()
  saveState()
  return true
}

function verifyPassword(password) {
  if (!ensureDefaultPassword()) return false
  return hashPassword(normalizePassword(password), state.salt) === state.passwordHash
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex')
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + sessionTtlMs)
  state.session = {
    token,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }
  saveState()
  return clone(state.session)
}

function clearSession() {
  state.session = normalizeSession()
  saveState()
}

function getSessionFromHeaders(req) {
  const header = String(req.headers?.cookie || '')
  const cookies = Object.fromEntries(header.split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf('=')
    if (index < 0) return [item, '']
    return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))]
  }))
  return cookies.admin_session || ''
}

function isSessionValid(token) {
  refreshState()
  if (!ensureDefaultPassword()) return false
  if (!token || !state.session.token) return false
  if (token !== state.session.token) return false
  const expiresAt = new Date(state.session.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) return false
  return expiresAt.getTime() > Date.now()
}

function getAdminProfile() {
  refreshState()
  ensureDefaultPassword()
  return {
    account: state.account,
    passwordConfigured: Boolean(state.passwordHash),
    passwordResetHint: '管理员账号密码已启用，请妥善保管并定期修改',
    session: {
      createdAt: state.session.createdAt,
      expiresAt: state.session.expiresAt,
    },
  }
}

function loginAdmin(account, password) {
  refreshState()
  ensureDefaultPassword()
  if (normalizeAccount(account) !== state.account || !verifyPassword(password)) {
    return null
  }
  return createSession()
}

function logoutAdmin(token) {
  refreshState()
  if (token && token === state.session.token) {
    clearSession()
  }
}

function updateAdminCredentials(payload = {}) {
  refreshState()
  ensureDefaultPassword()
  const currentPassword = normalizePassword(payload.currentPassword)
  const nextAccount = normalizeAccount(payload.account || state.account)
  const nextPassword = normalizePassword(payload.password)
  const confirmPassword = normalizePassword(payload.confirmPassword)
  const hasAccountChange = nextAccount !== state.account
  const hasPasswordChange = Boolean(nextPassword)

  if (hasPasswordChange && nextPassword !== confirmPassword) {
    return { error: '两次输入的新密码不一致' }
  }

  if (!hasAccountChange && !hasPasswordChange) {
    return {
      changed: false,
      profile: getAdminProfile(),
    }
  }

  if (!currentPassword || !verifyPassword(currentPassword)) {
    return null
  }

  state.account = nextAccount
  if (hasPasswordChange) {
    state.salt = createSalt()
    state.passwordHash = hashPassword(nextPassword, state.salt)
  }
  state.session = normalizeSession()
  saveState()
  return {
    changed: true,
    profile: getAdminProfile(),
  }
}

function setAdminPassword(password, currentPassword = '') {
  refreshState()
  return updateAdminCredentials({
    currentPassword,
    password,
    account: state.account,
  })
}

function getAdminAuthState() {
  refreshState()
  ensureDefaultPassword()
  return {
    account: state.account,
    passwordConfigured: Boolean(state.passwordHash),
    passwordResetHint: '管理员账号密码已启用，请妥善保管并定期修改',
    session: {
      createdAt: state.session.createdAt,
      expiresAt: state.session.expiresAt,
    },
  }
}

module.exports = {
  clearSession,
  getAdminAuthState,
  getAdminProfile,
  getSessionFromHeaders,
  isSessionValid,
  loginAdmin,
  logoutAdmin,
  setAdminPassword,
  updateAdminCredentials,
}
