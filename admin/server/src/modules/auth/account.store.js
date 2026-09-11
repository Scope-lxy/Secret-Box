const crypto = require('crypto')
const { getDatabase } = require('../../lib/state-database')
const { moveMiniProgramAccountData } = require('./account-data-migration.service')
const { normalizeDataContext } = require('../data-scope/data-scope')

const defaultAccount = {
  accountId: '',
  unionid: '',
  phone: '',
  phoneVerified: false,
  avatarUrl: '',
  miniProgramId: '',
  miniProgramIds: [],
  wechatIdentities: [],
  visitorId: 'anonymous',
  avatarText: '云',
  nickname: '轻读用户',
  syncLabel: '建议授权手机号',
  accountStatus: 'UnionID 优先，手机号作为跨主体兜底同步索引',
  loginSynced: false,
  phoneAuthorized: false,
  preferences: {},
  createdAt: '',
  updatedAt: '',
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeContext(context = {}) {
  const miniProgramId = String(context.miniProgramId || '').trim()
  if (!miniProgramId) throw new Error('小程序 ID 不能为空')
  return {
    accountId: String(context.accountId || '').trim(),
    miniProgramId,
    visitorId: String(context.visitorId || 'anonymous').trim() || 'anonymous',
  }
}

function normalizeMiniProgramIds(account = {}) {
  const ids = [
    ...(Array.isArray(account.miniProgramIds) ? account.miniProgramIds : []),
    account.miniProgramId,
  ].map((item) => String(item || '').trim()).filter(Boolean)
  if (!ids.length) throw new Error('账号缺少小程序归属')
  return [...new Set(ids)]
}

function normalizeWechatIdentities(account = {}, miniProgramIds = []) {
  const identities = Array.isArray(account.wechatIdentities) ? account.wechatIdentities : []
  const seen = new Set()
  return identities.reduce((items, item) => {
    const miniProgramId = String(item?.miniProgramId || '').trim()
    const openid = String(item?.openid || '').trim()
    const key = `${miniProgramId}\u0000${openid}`
    if (!miniProgramIds.includes(miniProgramId) || !openid || seen.has(key)) return items
    seen.add(key)
    items.push({ miniProgramId, openid })
    return items
  }, [])
}

function normalizeAccount(account = {}) {
  const miniProgramIds = normalizeMiniProgramIds(account)
  return {
    ...clone(defaultAccount),
    ...account,
    ...normalizeContext(account),
    miniProgramIds,
    wechatIdentities: normalizeWechatIdentities(account, miniProgramIds),
    phoneVerified: Boolean(account.phoneVerified),
    preferences: account.preferences && typeof account.preferences === 'object'
      ? clone(account.preferences)
      : clone(defaultAccount.preferences),
  }
}

function getScopeProfile(accountId, miniProgramId) {
  if (!miniProgramId) return null
  const context = normalizeDataContext({ accountId, miniProgramId, visitorId: accountId })
  return getDatabase().prepare(`
    SELECT * FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?
  `).get(context.dataScopeId, accountId) || null
}

function ensureScopeProfile(account, miniProgramId) {
  const existing = getScopeProfile(account.accountId, miniProgramId)
  if (existing) return existing
  const context = normalizeDataContext({ accountId: account.accountId, miniProgramId, visitorId: account.accountId })
  const now = String(account.updatedAt || new Date().toISOString())
  getDatabase().prepare(`
    INSERT INTO user_scope_profiles (
      data_scope_id, account_id, nickname, avatar_text, avatar_url, preferences_json,
      updated_at, nickname_updated_at, avatar_updated_at, preferences_updated_at,
      origin_mini_program_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    context.dataScopeId, account.accountId, String(account.nickname || '轻读用户'),
    String(account.avatarText || '你'), String(account.avatarUrl || ''),
    JSON.stringify(account.preferences && typeof account.preferences === 'object' ? account.preferences : {}),
    now, now, now, now, miniProgramId,
  )
  return getScopeProfile(account.accountId, miniProgramId)
}

function rowToAccount(row, miniProgramId = '') {
  if (!row) return null
  const db = getDatabase()
  const miniProgramIds = db.prepare(`
    SELECT mini_program_id FROM account_mini_programs WHERE account_id = ? ORDER BY mini_program_id
  `).all(row.account_id).map((item) => item.mini_program_id)
  const wechatIdentities = db.prepare(`
    SELECT mini_program_id AS miniProgramId, openid FROM wechat_identities
    WHERE account_id = ? ORDER BY mini_program_id, openid
  `).all(row.account_id)
  const stored = JSON.parse(row.item_json)
  delete stored.nickname
  delete stored.avatarText
  delete stored.avatarUrl
  delete stored.preferences
  const account = normalizeAccount({
    ...stored,
    accountId: row.account_id,
    unionid: row.unionid,
    phone: row.phone,
    phoneVerified: Boolean(row.phone_verified),
    visitorId: row.visitor_id,
    miniProgramId: row.primary_mini_program_id,
    miniProgramIds,
    wechatIdentities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!miniProgramId) return account
  const profile = ensureScopeProfile(account, miniProgramId)
  return normalizeAccount({
    ...account,
    nickname: profile.nickname,
    avatarText: profile.avatar_text,
    avatarUrl: profile.avatar_url,
    preferences: JSON.parse(profile.preferences_json),
  })
}

function saveAccount(input) {
  const account = normalizeAccount(input)
  if (!account.accountId) throw new Error('账号身份无效')
  const globalItem = clone(account)
  delete globalItem.nickname
  delete globalItem.avatarText
  delete globalItem.avatarUrl
  delete globalItem.preferences
  const db = getDatabase()
  db.transaction(() => {
    db.prepare(`
      INSERT INTO accounts (
        account_id, unionid, phone, phone_verified, login_synced, visitor_id, primary_mini_program_id,
        created_at, updated_at, item_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        unionid = excluded.unionid,
        phone = excluded.phone,
        phone_verified = excluded.phone_verified,
        login_synced = excluded.login_synced,
        visitor_id = excluded.visitor_id,
        primary_mini_program_id = excluded.primary_mini_program_id,
        updated_at = excluded.updated_at,
        item_json = excluded.item_json
    `).run(
      account.accountId, account.unionid, account.phone, account.phoneVerified ? 1 : 0,
      account.loginSynced ? 1 : 0,
      account.visitorId, account.miniProgramId, account.createdAt, account.updatedAt,
      JSON.stringify(globalItem),
    )
    db.prepare('DELETE FROM account_mini_programs WHERE account_id = ?').run(account.accountId)
    db.prepare('DELETE FROM wechat_identities WHERE account_id = ?').run(account.accountId)
    const insertProgram = db.prepare(`
      INSERT INTO account_mini_programs (account_id, mini_program_id) VALUES (?, ?)
    `)
    account.miniProgramIds.forEach((miniProgramId) => insertProgram.run(account.accountId, miniProgramId))
    const insertIdentity = db.prepare(`
      INSERT INTO wechat_identities (mini_program_id, openid, account_id) VALUES (?, ?, ?)
    `)
    account.wechatIdentities.forEach((identity) => {
      insertIdentity.run(identity.miniProgramId, identity.openid, account.accountId)
    })
  })()
  return account
}

function addWechatIdentity(account, miniProgramId, openid) {
  const targetMiniProgramId = String(miniProgramId || '').trim()
  if (!targetMiniProgramId) throw new Error('小程序 ID 不能为空')
  const normalizedOpenid = String(openid || '').trim()
  account.miniProgramIds = [...new Set([...account.miniProgramIds, targetMiniProgramId])]
  account.wechatIdentities = normalizeWechatIdentities({
    ...account,
    wechatIdentities: [
      ...account.wechatIdentities,
      ...(normalizedOpenid ? [{ miniProgramId: targetMiniProgramId, openid: normalizedOpenid }] : []),
    ],
  }, account.miniProgramIds)
}

function makeAccountId(context) {
  const normalized = normalizeContext(context)
  const hash = crypto.createHash('sha256')
    .update(`${normalized.miniProgramId}:${normalized.visitorId}`)
    .digest('hex')
    .slice(0, 16)
  return `acct_${hash}`
}

function createAccount(context, accountId = makeAccountId(context)) {
  const normalized = normalizeContext(context)
  const account = saveAccount(normalizeAccount({
    ...normalized,
    accountId,
    miniProgramIds: [normalized.miniProgramId],
    wechatIdentities: [],
    nickname: '轻读用户',
    avatarText: '你',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))
  ensureScopeProfile(account, normalized.miniProgramId)
  return getAccountById(account.accountId, normalized.miniProgramId)
}

function findAccountRow(context = {}) {
  const normalized = normalizeContext(context)
  const db = getDatabase()
  if (normalized.accountId) {
    const row = db.prepare(`
      SELECT accounts.* FROM accounts
      JOIN account_mini_programs USING (account_id)
      WHERE accounts.account_id = ? AND account_mini_programs.mini_program_id = ?
    `).get(normalized.accountId, normalized.miniProgramId)
    if (row) return row
  }
  return db.prepare(`
    SELECT accounts.* FROM accounts
    JOIN account_mini_programs USING (account_id)
    WHERE account_mini_programs.mini_program_id = ? AND accounts.visitor_id = ?
    ORDER BY accounts.created_at LIMIT 1
  `).get(normalized.miniProgramId, normalized.visitorId)
}

function getAccount(context = {}) {
  const normalized = normalizeContext(context)
  const row = findAccountRow(normalized)
  if (row) return rowToAccount(row, normalized.miniProgramId)
  return createAccount(normalized)
}

function getAccountById(accountId, miniProgramId = '') {
  const targetId = String(accountId || '').trim()
  const targetMiniProgramId = String(miniProgramId || '').trim()
  const db = getDatabase()
  const row = targetMiniProgramId
    ? db.prepare(`
      SELECT accounts.* FROM accounts JOIN account_mini_programs USING (account_id)
      WHERE accounts.account_id = ? AND account_mini_programs.mini_program_id = ?
    `).get(targetId, targetMiniProgramId)
    : db.prepare('SELECT * FROM accounts WHERE account_id = ?').get(targetId)
  return row ? clone(rowToAccount(row, targetMiniProgramId)) : null
}

function getAccountSummary(context = {}) {
  return clone(getAccount(context))
}

function updateProfile(context = {}, payload = {}) {
  const account = getAccount(context)
  const nickname = String(payload.nickname || account.nickname || '').trim()
  const avatarText = String(payload.avatarText || nickname.slice(0, 1) || account.avatarText || '你').trim()
  const phoneVerified = Boolean(payload.phoneVerified)
  const phone = phoneVerified ? String(payload.phone || account.phone || '').trim() : account.phone
  if (phoneVerified && phone) account.phoneVerified = true
  account.phone = phone
  account.phoneAuthorized = Boolean(phone && account.phoneVerified)
  account.syncLabel = account.phoneAuthorized ? '手机号已授权' : '建议授权手机号'
  account.accountStatus = account.phoneVerified
    ? '已用微信验证手机号作为跨主体同步兜底索引'
    : 'UnionID 优先，手机号作为跨主体兜底同步索引'
  account.updatedAt = new Date().toISOString()
  saveAccount(account)
  const normalized = normalizeDataContext(context)
  const current = ensureScopeProfile(account, normalized.miniProgramId)
  const currentClock = Math.max(
    Date.parse(current.nickname_updated_at) || 0,
    Date.parse(current.avatar_updated_at) || 0,
    Date.parse(current.preferences_updated_at) || 0,
  )
  const now = new Date(Math.max(Date.now(), currentClock + 1)).toISOString()
  const nextNickname = nickname || '轻读用户'
  const nextAvatarText = avatarText || nextNickname.slice(0, 1) || '你'
  const hasNickname = payload.nickname !== undefined || payload.avatarText !== undefined
  const hasAvatar = payload.avatarUrl !== undefined
  getDatabase().prepare(`
    UPDATE user_scope_profiles SET
      nickname = ?, avatar_text = ?, avatar_url = ?, updated_at = ?,
      nickname_updated_at = ?, avatar_updated_at = ?, origin_mini_program_id = ?
    WHERE data_scope_id = ? AND account_id = ?
  `).run(
    hasNickname ? nextNickname : current.nickname,
    hasNickname ? nextAvatarText : current.avatar_text,
    hasAvatar ? String(payload.avatarUrl || '').trim() : current.avatar_url,
    now,
    hasNickname ? now : current.nickname_updated_at,
    hasAvatar ? now : current.avatar_updated_at,
    normalized.miniProgramId,
    normalized.dataScopeId,
    account.accountId,
  )
  return clone(getAccount(context))
}

function getPreferences(context = {}) {
  const account = getAccount(context)
  return clone({ preferences: account.preferences })
}

function deleteAccountRow(accountId) {
  return getDatabase().prepare('DELETE FROM accounts WHERE account_id = ?').run(accountId).changes
}

function deleteMiniProgramAccount(accountId, miniProgramId) {
  const account = getAccountById(accountId, miniProgramId)
  if (!account) return null
  const remainingMiniProgramIds = account.miniProgramIds.filter((id) => id !== miniProgramId)
  if (!remainingMiniProgramIds.length) {
    deleteAccountRow(account.accountId)
    return { account: clone(account), accountRemoved: true }
  }
  account.miniProgramIds = remainingMiniProgramIds
  account.wechatIdentities = account.wechatIdentities.filter((identity) => identity.miniProgramId !== miniProgramId)
  account.miniProgramId = remainingMiniProgramIds.includes(account.miniProgramId)
    ? account.miniProgramId
    : remainingMiniProgramIds[0]
  account.updatedAt = new Date().toISOString()
  saveAccount(account)
  return { account: clone(account), accountRemoved: false }
}

function findLoginAccount({ unionid, phone, phoneVerified, openid, miniProgramId }) {
  const db = getDatabase()
  if (unionid) {
    const row = db.prepare('SELECT * FROM accounts WHERE unionid = ? LIMIT 1').get(unionid)
    if (row) return rowToAccount(row)
  }
  if (phoneVerified && phone) {
    const row = db.prepare('SELECT * FROM accounts WHERE phone = ? AND phone_verified = 1 LIMIT 1').get(phone)
    if (row) return rowToAccount(row)
  }
  if (openid) {
    const row = db.prepare(`
      SELECT accounts.* FROM accounts JOIN wechat_identities USING (account_id)
      WHERE wechat_identities.mini_program_id = ? AND wechat_identities.openid = ?
    `).get(miniProgramId, openid)
    if (row) return rowToAccount(row)
  }
  return null
}

function isAnonymousAccount(account) {
  return Boolean(account)
    && account.wechatIdentities.length === 0
    && !account.unionid
    && !(account.phoneVerified && account.phone)
}

function canMergeCurrentLogin(account, miniProgramId, openid) {
  if (!account || !openid) return Boolean(account)
  if (isAnonymousAccount(account)) return true
  return account.wechatIdentities.some((identity) => (
    identity.miniProgramId === miniProgramId && identity.openid === openid
  ))
}

function createWechatAccount(context, openid) {
  return createAccount(context, makeAccountId({
    ...context,
    visitorId: `wechat:${openid}`,
  }))
}

function mergeMiniProgramAccount(source, target, miniProgramId) {
  if (!source || source.accountId === target.accountId) return
  const identities = source.wechatIdentities.filter((identity) => identity.miniProgramId === miniProgramId)
  identities.forEach((identity) => addWechatIdentity(target, miniProgramId, identity.openid))
  moveMiniProgramAccountData({
    fromAccountId: source.accountId,
    fromVisitorId: source.visitorId,
    miniProgramId,
    toAccountId: target.accountId,
  })
  const remainingMiniProgramIds = source.miniProgramIds.filter((id) => id !== miniProgramId)
  if (!remainingMiniProgramIds.length) {
    deleteAccountRow(source.accountId)
    return
  }
  source.miniProgramIds = remainingMiniProgramIds
  source.wechatIdentities = source.wechatIdentities.filter((identity) => identity.miniProgramId !== miniProgramId)
  source.miniProgramId = remainingMiniProgramIds.includes(source.miniProgramId)
    ? source.miniProgramId
    : remainingMiniProgramIds[0]
  source.updatedAt = new Date().toISOString()
  saveAccount(source)
}

function syncLogin(context = {}, payload = {}) {
  return getDatabase().transaction(() => {
    const normalized = normalizeContext(context)
    const openid = String(payload.openid || '').trim()
    const unionid = String(payload.unionid || '').trim()
    const phone = String(payload.phone || '').trim()
    const phoneVerified = Boolean(payload.phoneVerified)
    const currentAccount = normalized.accountId ? getAccountById(normalized.accountId, normalized.miniProgramId) : null
    const loginAccount = findLoginAccount({ unionid, phone, phoneVerified, openid, miniProgramId: normalized.miniProgramId })
    const visitorAccount = loginAccount ? null : getAccount(context)
    const account = loginAccount || (
      openid && !isAnonymousAccount(visitorAccount)
        ? createWechatAccount(normalized, openid)
        : visitorAccount
    )
    if (loginAccount && canMergeCurrentLogin(currentAccount, normalized.miniProgramId, openid)) {
      mergeMiniProgramAccount(currentAccount, account, normalized.miniProgramId)
    }
    addWechatIdentity(account, normalized.miniProgramId, openid)
    account.unionid = unionid || account.unionid
    account.loginSynced = account.wechatIdentities.length > 0
    saveAccount(account)
    return updateProfile({
      accountId: account.accountId,
      miniProgramId: normalized.miniProgramId,
      visitorId: account.visitorId,
    }, {
      ...(payload.nickname !== undefined ? { nickname: payload.nickname } : {}),
      ...(payload.avatarText !== undefined ? { avatarText: payload.avatarText } : {}),
      ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
      phone: phone || account.phone,
      phoneVerified,
    })
  })()
}

function getAccounts(miniProgramId = '', { limit = 500, offset = 0 } = {}) {
  const targetMiniProgramId = String(miniProgramId || '').trim()
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000))
  const safeOffset = Math.max(0, Number(offset) || 0)
  const rows = targetMiniProgramId
    ? getDatabase().prepare(`
      SELECT accounts.* FROM accounts JOIN account_mini_programs USING (account_id)
      WHERE account_mini_programs.mini_program_id = ?
      ORDER BY accounts.created_at DESC LIMIT ? OFFSET ?
    `).all(targetMiniProgramId, safeLimit, safeOffset)
    : getDatabase().prepare(`
      SELECT * FROM accounts ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(safeLimit, safeOffset)
  return rows.map((row) => clone(rowToAccount(row, targetMiniProgramId)))
}

function countAccounts(miniProgramId = '') {
  const target = String(miniProgramId || '').trim()
  return target
    ? getDatabase().prepare(`
      SELECT COUNT(*) AS count FROM account_mini_programs WHERE mini_program_id = ?
    `).get(target).count
    : getDatabase().prepare('SELECT COUNT(*) AS count FROM accounts').get().count
}

function countSyncedAccounts(miniProgramId) {
  return getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM accounts
    JOIN account_mini_programs USING (account_id)
    WHERE account_mini_programs.mini_program_id = ?
      AND accounts.login_synced = 1
  `).get(String(miniProgramId || '').trim()).count
}

module.exports = {
  countAccounts,
  countSyncedAccounts,
  deleteMiniProgramAccount,
  getAccountById,
  getAccountSummary,
  getAccounts,
  getPreferences,
  syncLogin,
  updateProfile,
}
