const {
  deleteMiniProgramAccount,
  getAccountById,
} = require('./account.store')
const { deleteMiniAppSessionsByAccountAndMiniProgramId } = require('./miniapp-session.store')
const { deleteUserAnalyticsEvents } = require('../analytics/analytics.store')
const { deleteAccountIdempotencyRecords } = require('../idempotency/idempotency.store')
const { appendOperationLog, getInternalAdminSettings } = require('../admin/admin-settings.store')
const {
  deleteCosObject,
  getCosObjectKeyFromPublicUrl,
  getManagedAvatarObjectKey,
} = require('../storage/cos.service')
const { getDatabase } = require('../../lib/state-database')
const { buildDataScopeId, getDataScopeOwnerIds } = require('../data-scope/data-scope')

function getConfiguredScopeId(settings, miniProgramId) {
  const miniProgram = settings.miniPrograms.find((item) => item.id === miniProgramId)
  if (!miniProgram) return ''
  return buildDataScopeId({
    miniProgramId,
    contentPoolId: miniProgram.config?.contentPoolId,
    dataMode: miniProgram.config?.dataMode,
  })
}

function collectAccountScopeIds(db, { accountId, miniProgramId, visitorIds, currentScopeId }) {
  const scopeIds = new Set([currentScopeId])
  const placeholders = visitorIds.map(() => '?').join(', ')
  const independentPrefix = `independent:${miniProgramId}:`
  const queries = [
    ['messages', 'account_id = ? OR visitor_id IN (' + placeholders + ')', [accountId, ...visitorIds], 'mini_program_id'],
    ['reactions', 'visitor_id IN (' + placeholders + ')', visitorIds, 'mini_program_id'],
    ['opened_records', 'visitor_id IN (' + placeholders + ')', visitorIds, 'mini_program_id'],
    ['article_unlocks', 'visitor_id IN (' + placeholders + ')', visitorIds, 'mini_program_id'],
    ['checkin_records', 'visitor_id IN (' + placeholders + ')', visitorIds, 'origin_mini_program_id'],
    ['user_scope_profiles', 'account_id = ?', [accountId], 'origin_mini_program_id'],
  ]
  queries.forEach(([table, userCondition, values, originColumn]) => {
    db.prepare(`
      SELECT DISTINCT data_scope_id FROM ${table}
      WHERE (${userCondition}) AND (${originColumn} = ? OR instr(data_scope_id, ?) = 1 OR data_scope_id = ?)
    `).all(...values, miniProgramId, independentPrefix, currentScopeId)
      .forEach((row) => scopeIds.add(row.data_scope_id))
  })
  return [...scopeIds].filter(Boolean)
}

function deleteAccountScopeRows(db, dataScopeId, accountId, visitorIds, avatarCandidates) {
  const placeholders = visitorIds.map(() => '?').join(', ')
  const summary = {
    checkins: 0,
    messages: 0,
    opened: 0,
    profiles: 0,
    reactions: 0,
    unlocks: 0,
  }
  summary.messages += db.prepare(`
    DELETE FROM messages WHERE data_scope_id = ? AND (account_id = ? OR visitor_id IN (${placeholders}))
  `).run(dataScopeId, accountId, ...visitorIds).changes
  summary.reactions += db.prepare(`DELETE FROM reactions WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
    .run(dataScopeId, ...visitorIds).changes
  summary.opened += db.prepare(`DELETE FROM opened_records WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
    .run(dataScopeId, ...visitorIds).changes
  summary.unlocks += db.prepare(`DELETE FROM article_unlocks WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
    .run(dataScopeId, ...visitorIds).changes
  summary.checkins += db.prepare(`DELETE FROM checkin_records WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
    .run(dataScopeId, ...visitorIds).changes
  summary.checkins += db.prepare(`DELETE FROM checkin_users WHERE data_scope_id = ? AND visitor_id IN (${placeholders})`)
    .run(dataScopeId, ...visitorIds).changes
  const profile = db.prepare(`
    SELECT account_id, avatar_url FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?
  `).get(dataScopeId, accountId)
  if (profile?.avatar_url) avatarCandidates.push({ accountId: profile.account_id, avatarUrl: profile.avatar_url })
  summary.profiles += db.prepare('DELETE FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?')
    .run(dataScopeId, accountId).changes
  return summary
}

async function deleteAccountForMiniProgram({ accountId, miniProgramId }) {
  const account = getAccountById(accountId, miniProgramId)
  if (!account) return null

  const removesSharedAccount = account.miniProgramIds.length === 1
  const settings = getInternalAdminSettings()
  const currentScopeId = getConfiguredScopeId(settings, miniProgramId)
  if (!currentScopeId) return null
  const remainingAccountProgramIds = new Set(account.miniProgramIds.filter((id) => id !== miniProgramId))
  const avatarKey = removesSharedAccount
    ? getManagedAvatarObjectKey(settings.storage, account.accountId, account.avatarUrl)
    : ''
  const avatarCandidates = []

  const contexts = [{ miniProgramId, visitorId: account.accountId }]
  if (account.miniProgramId === miniProgramId && account.visitorId !== account.accountId) {
    contexts.push({ miniProgramId, visitorId: account.visitorId })
  }
  const visitorIds = [...new Set([account.accountId, account.visitorId].filter(Boolean))]
  const { result, summary } = getDatabase().transaction(() => {
    const db = getDatabase()
    const summary = {
      analytics: contexts.reduce((total, context) => total + deleteUserAnalyticsEvents(context), 0),
      checkins: 0,
      idempotency: deleteAccountIdempotencyRecords({ accountId: account.accountId, miniProgramId }),
      messages: 0,
      opened: 0,
      profiles: 0,
      reactions: 0,
      unlocks: 0,
      sessions: deleteMiniAppSessionsByAccountAndMiniProgramId(account.accountId, miniProgramId),
    }
    collectAccountScopeIds(db, {
      accountId: account.accountId,
      currentScopeId,
      miniProgramId,
      visitorIds,
    }).filter((dataScopeId) => !getDataScopeOwnerIds(db, dataScopeId, settings.miniPrograms)
      .some((ownerId) => remainingAccountProgramIds.has(ownerId))).forEach((dataScopeId) => {
      const removed = deleteAccountScopeRows(db, dataScopeId, account.accountId, visitorIds, avatarCandidates)
      Object.keys(removed).forEach((key) => { summary[key] += removed[key] })
    })
    return { result: deleteMiniProgramAccount(account.accountId, miniProgramId), summary }
  })()

  try {
    appendOperationLog({
      actor: 'admin',
      type: '账号注销',
      target: account.accountId,
      description: `已手动注销当前小程序账号，清理 ${summary.checkins + summary.messages + summary.opened + summary.unlocks + summary.reactions + summary.analytics + summary.idempotency + summary.profiles} 条关联数据`,
      badge: 'info',
    })
  } catch (error) {
    // The deletion is complete even if the audit log cannot be written.
  }

  const retainedAvatarKeys = new Set(getDatabase().prepare(`
    SELECT avatar_url FROM user_scope_profiles WHERE avatar_url <> ''
  `).all().map((row) => getCosObjectKeyFromPublicUrl(settings.storage, row.avatar_url)).filter(Boolean))
  const unusedAvatarKeys = [...new Set([
    avatarKey,
    ...avatarCandidates.map((item) => getManagedAvatarObjectKey(settings.storage, item.accountId, item.avatarUrl)),
  ].filter((key) => key && !retainedAvatarKeys.has(key)))]
  unusedAvatarKeys.forEach((key) => {
    void deleteCosObject(key).catch((error) => {
      try {
        appendOperationLog({
          actor: 'admin',
          type: 'COS清理失败',
          target: account.accountId,
          description: `账号已注销，但头像对象 ${key} 清理失败，需人工处理：${error.message || '未知错误'}`,
          badge: 'warning',
        })
      } catch (logError) {
        // The account deletion must remain complete even when follow-up logging fails.
      }
    })
  })

  return {
    accountId: account.accountId,
    accountRemoved: result.accountRemoved,
    miniProgramId,
    summary,
  }
}

module.exports = {
  deleteAccountForMiniProgram,
}
