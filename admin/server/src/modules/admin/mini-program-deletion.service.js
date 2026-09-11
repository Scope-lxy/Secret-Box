const { getDatabase } = require('../../lib/state-database')
const {
  appendOperationLog,
  deleteMiniProgramDefinition,
  getInternalAdminSettings,
} = require('./admin-settings.store')
const {
  assertMiniProgramUploadDeletionReady,
  deleteMiniProgramUploadArtifacts,
} = require('../release/miniapp-upload.service')
const {
  deleteCosObject,
  getCosObjectKeyFromPublicUrl,
  getManagedAvatarObjectKey,
} = require('../storage/cos.service')
const { buildDataScopeId, getDataScopeOwnerIds } = require('../data-scope/data-scope')

const scopeTables = ['messages', 'reactions', 'opened_records', 'article_unlocks', 'checkin_records', 'checkin_users', 'user_scope_profiles']

function getMiniProgramScopeId(miniProgram) {
  return buildDataScopeId({
    miniProgramId: miniProgram.id,
    contentPoolId: miniProgram.config?.contentPoolId,
    dataMode: miniProgram.config?.dataMode,
  })
}

function collectMiniProgramScopeIds(db, miniProgram) {
  const scopeIds = new Set([getMiniProgramScopeId(miniProgram)])
  const originQueries = [
    ['messages', 'mini_program_id'],
    ['reactions', 'mini_program_id'],
    ['opened_records', 'mini_program_id'],
    ['article_unlocks', 'mini_program_id'],
    ['checkin_records', 'origin_mini_program_id'],
    ['user_scope_profiles', 'origin_mini_program_id'],
  ]
  originQueries.forEach(([table, column]) => {
    db.prepare(`SELECT DISTINCT data_scope_id FROM ${table} WHERE ${column} = ?`).all(miniProgram.id)
      .forEach((row) => scopeIds.add(row.data_scope_id))
  })
  const independentPrefix = `independent:${miniProgram.id}:`
  scopeTables.forEach((table) => {
    db.prepare(`SELECT DISTINCT data_scope_id FROM ${table} WHERE instr(data_scope_id, ?) = 1`).all(independentPrefix)
      .forEach((row) => scopeIds.add(row.data_scope_id))
  })
  return [...scopeIds].filter(Boolean)
}

function collectProfileAvatars(rows, avatarCandidates) {
  rows.forEach((row) => {
    if (row.avatar_url) avatarCandidates.push({ accountId: row.account_id, avatarUrl: row.avatar_url })
  })
}

function deleteWholeScope(db, dataScopeId, summary, avatarCandidates) {
  collectProfileAvatars(db.prepare(`
    SELECT account_id, avatar_url FROM user_scope_profiles WHERE data_scope_id = ?
  `).all(dataScopeId), avatarCandidates)
  scopeTables.forEach((table) => {
    summary[table] += db.prepare(`DELETE FROM ${table} WHERE data_scope_id = ?`).run(dataScopeId).changes
  })
}

function deleteAccountFromScope(db, dataScopeId, row, summary, avatarCandidates) {
  const visitorIds = [...new Set([row.account_id, row.visitor_id].filter(Boolean))]
  summary.messages += db.prepare(`
    DELETE FROM messages WHERE data_scope_id = ? AND (account_id = ? OR visitor_id = ?)
  `).run(dataScopeId, row.account_id, row.visitor_id).changes
  visitorIds.forEach((visitorId) => {
    summary.reactions += db.prepare('DELETE FROM reactions WHERE data_scope_id = ? AND visitor_id = ?')
      .run(dataScopeId, visitorId).changes
    summary.opened_records += db.prepare('DELETE FROM opened_records WHERE data_scope_id = ? AND visitor_id = ?')
      .run(dataScopeId, visitorId).changes
    summary.checkin_records += db.prepare('DELETE FROM checkin_records WHERE data_scope_id = ? AND visitor_id = ?')
      .run(dataScopeId, visitorId).changes
    summary.checkin_users += db.prepare('DELETE FROM checkin_users WHERE data_scope_id = ? AND visitor_id = ?')
      .run(dataScopeId, visitorId).changes
  })
  collectProfileAvatars(db.prepare(`
    SELECT account_id, avatar_url FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?
  `).all(dataScopeId, row.account_id), avatarCandidates)
  summary.user_scope_profiles += db.prepare(`
    DELETE FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?
  `).run(dataScopeId, row.account_id).changes
}

function deleteUnownedOriginRows(db, dataScopeId, miniProgramId, remainingAccounts, summary, avatarCandidates) {
  const candidates = [
    ['messages', 'message_id', 'account_id', 'mini_program_id'],
    ['reactions', 'reaction_key', 'visitor_id', 'mini_program_id'],
    ['opened_records', 'opened_id', 'visitor_id', 'mini_program_id'],
  ]
  candidates.forEach(([table, idColumn, accountColumn, originColumn]) => {
    const remove = db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`)
    db.prepare(`
      SELECT ${idColumn} AS id, ${accountColumn} AS account_id FROM ${table}
      WHERE data_scope_id = ? AND ${originColumn} = ?
    `).all(dataScopeId, miniProgramId).forEach((row) => {
      if (!remainingAccounts.has(row.account_id)) summary[table] += remove.run(row.id).changes
    })
  })

  const removeCheckin = db.prepare(`
    DELETE FROM checkin_records WHERE data_scope_id = ? AND visitor_id = ? AND date_key = ?
  `)
  const removedCheckinVisitors = new Set()
  db.prepare(`
    SELECT visitor_id, date_key FROM checkin_records
    WHERE data_scope_id = ? AND origin_mini_program_id = ?
  `).all(dataScopeId, miniProgramId).forEach((row) => {
    if (remainingAccounts.has(row.visitor_id)) return
    summary.checkin_records += removeCheckin.run(dataScopeId, row.visitor_id, row.date_key).changes
    removedCheckinVisitors.add(row.visitor_id)
  })
  removedCheckinVisitors.forEach((visitorId) => {
    const hasRecords = db.prepare(`
      SELECT 1 FROM checkin_records WHERE data_scope_id = ? AND visitor_id = ? LIMIT 1
    `).get(dataScopeId, visitorId)
    if (!hasRecords) {
      summary.checkin_users += db.prepare('DELETE FROM checkin_users WHERE data_scope_id = ? AND visitor_id = ?')
        .run(dataScopeId, visitorId).changes
    }
  })

  const removeProfile = db.prepare(`
    DELETE FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?
  `)
  db.prepare(`
    SELECT account_id, avatar_url FROM user_scope_profiles
    WHERE data_scope_id = ? AND origin_mini_program_id = ?
  `).all(dataScopeId, miniProgramId).forEach((row) => {
    if (!remainingAccounts.has(row.account_id)) {
      collectProfileAvatars([row], avatarCandidates)
      summary.user_scope_profiles += removeProfile.run(dataScopeId, row.account_id).changes
    }
  })
}

function updateSharedAccount(db, row, miniProgramId, remainingMiniProgramIds) {
  const nextPrimaryMiniProgramId = remainingMiniProgramIds.includes(row.primary_mini_program_id)
    ? row.primary_mini_program_id
    : remainingMiniProgramIds[0]
  let item = {}
  try {
    item = JSON.parse(row.item_json)
  } catch {
    item = {}
  }
  const identities = db.prepare(`
    SELECT mini_program_id AS miniProgramId, openid FROM wechat_identities
    WHERE account_id = ? AND mini_program_id <> ?
    ORDER BY mini_program_id, openid
  `).all(row.account_id, miniProgramId)
  const updatedAt = new Date().toISOString()
  const loginSynced = identities.length > 0
  const nextItem = {
    ...item,
    miniProgramId: nextPrimaryMiniProgramId,
    miniProgramIds: remainingMiniProgramIds,
    wechatIdentities: identities,
    loginSynced,
    updatedAt,
  }
  db.prepare(`
    UPDATE accounts SET
      primary_mini_program_id = ?, login_synced = ?, updated_at = ?, item_json = ?
    WHERE account_id = ?
  `).run(
    nextPrimaryMiniProgramId,
    loginSynced ? 1 : 0,
    updatedAt,
    JSON.stringify(nextItem),
    row.account_id,
  )
}

function deleteMiniProgramRows(db, miniProgramId, { avatarCandidates = [] } = {}) {
  const settings = getInternalAdminSettings()
  const miniProgram = settings.miniPrograms.find((item) => item.id === miniProgramId)
  if (!miniProgram) throw new Error('小程序不存在')
  const affectedScopeIds = collectMiniProgramScopeIds(db, miniProgram)
  const accountRows = db.prepare(`
    SELECT accounts.* FROM accounts
    JOIN account_mini_programs USING (account_id)
    WHERE account_mini_programs.mini_program_id = ?
  `).all(miniProgramId)
  const remainingProgramIds = new Set(settings.miniPrograms
    .filter((item) => item.id !== miniProgramId)
    .map((item) => item.id))
  const remainingAccounts = new Set(db.prepare(`
    SELECT account_id, mini_program_id FROM account_mini_programs WHERE mini_program_id <> ?
  `).all(miniProgramId)
    .filter((row) => remainingProgramIds.has(row.mini_program_id))
    .map((row) => row.account_id))
  const exclusiveAccounts = accountRows.filter((row) => !remainingAccounts.has(row.account_id))
  const summary = {
    analytics_events: db.prepare('DELETE FROM analytics_events WHERE mini_program_id = ?').run(miniProgramId).changes,
    miniapp_sessions: db.prepare('DELETE FROM miniapp_sessions WHERE mini_program_id = ?').run(miniProgramId).changes,
    idempotency_records: db.prepare('DELETE FROM idempotency_records WHERE origin_mini_program_id = ?').run(miniProgramId).changes,
    messages: 0,
    reactions: 0,
    opened_records: 0,
    article_unlocks: 0,
    checkin_records: 0,
    checkin_users: 0,
    user_scope_profiles: 0,
  }
  affectedScopeIds.forEach((dataScopeId) => {
    const hasOtherOwner = getDataScopeOwnerIds(db, dataScopeId, settings.miniPrograms)
      .some((ownerId) => ownerId !== miniProgramId)
    if (!hasOtherOwner) {
      deleteWholeScope(db, dataScopeId, summary, avatarCandidates)
      return
    }
    exclusiveAccounts.forEach((row) => deleteAccountFromScope(db, dataScopeId, row, summary, avatarCandidates))
    deleteUnownedOriginRows(db, dataScopeId, miniProgramId, remainingAccounts, summary, avatarCandidates)
  })

  summary.wechat_identities = db.prepare('DELETE FROM wechat_identities WHERE mini_program_id = ?')
    .run(miniProgramId).changes
  summary.account_mini_programs = 0
  summary.accounts = 0
  summary.sharedAccounts = 0

  accountRows.forEach((row) => {
    const remainingMiniProgramIds = db.prepare(`
      SELECT mini_program_id FROM account_mini_programs
      WHERE account_id = ? AND mini_program_id <> ?
      ORDER BY mini_program_id
    `).all(row.account_id, miniProgramId).map((item) => item.mini_program_id)
    if (!remainingMiniProgramIds.length) {
      summary.account_mini_programs += db.prepare('DELETE FROM account_mini_programs WHERE account_id = ?')
        .run(row.account_id).changes
      summary.accounts += db.prepare('DELETE FROM accounts WHERE account_id = ?').run(row.account_id).changes
      return
    }
    updateSharedAccount(db, row, miniProgramId, remainingMiniProgramIds)
    summary.account_mini_programs += db.prepare(`
      DELETE FROM account_mini_programs WHERE account_id = ? AND mini_program_id = ?
    `).run(row.account_id, miniProgramId).changes
    summary.sharedAccounts += 1
  })

  summary.account_mini_programs += db.prepare('DELETE FROM account_mini_programs WHERE mini_program_id = ?')
    .run(miniProgramId).changes
  return summary
}

function deleteMiniProgram(id = '', { actor = 'admin' } = {}) {
  const miniProgramId = String(id || '').trim()
  const settings = getInternalAdminSettings()
  const miniProgram = settings.miniPrograms.find((item) => item.id === miniProgramId)
  if (!miniProgram) throw new Error('小程序不存在')
  const remainingActiveCount = settings.miniPrograms.filter((item) => (
    item.id !== miniProgram.id && item.status !== 'archived'
  )).length
  if (remainingActiveCount < 1) throw new Error('至少保留一个已接入的小程序')
  assertMiniProgramUploadDeletionReady()

  const avatarCandidates = []
  const result = getDatabase().transaction(() => {
    const summary = deleteMiniProgramRows(getDatabase(), miniProgram.id, { avatarCandidates })
    const deletedRows = Object.entries(summary)
      .filter(([key]) => key !== 'sharedAccounts')
      .reduce((total, [, count]) => total + count, 0)
    deleteMiniProgramDefinition(miniProgram.id, {
      actor,
      type: '小程序删除',
      target: miniProgram.name,
      description: `已删除小程序及 ${deletedRows} 条专属记录，迁移 ${summary.sharedAccounts} 个共享账号；内容池和图片均保留`,
      badge: 'danger',
    })
    return summary
  })()

  const storage = getInternalAdminSettings().storage
  const retainedAvatarKeys = new Set(getDatabase().prepare(`
    SELECT avatar_url FROM user_scope_profiles WHERE avatar_url <> ''
  `).all().map((row) => getCosObjectKeyFromPublicUrl(storage, row.avatar_url)).filter(Boolean))
  const unusedAvatarKeys = [...new Set(avatarCandidates
    .map((item) => getManagedAvatarObjectKey(storage, item.accountId, item.avatarUrl))
    .filter((key) => key && !retainedAvatarKeys.has(key)))]
  unusedAvatarKeys.forEach((key) => {
    void deleteCosObject(key).catch((error) => {
      try {
        appendOperationLog({
          actor,
          type: 'COS清理失败',
          target: miniProgram.name,
          description: `小程序数据已删除，但头像对象 ${key} 清理失败，需人工处理：${error.message || '未知错误'}`,
          badge: 'warning',
        })
      } catch {
        // The data deletion must remain complete even when cleanup logging fails.
      }
    })
  })

  let uploadCleanup = { uploadKeyDeleted: false, uploadRecordDeleted: false }
  let cleanupError = ''
  if (miniProgram.appId) {
    try {
      uploadCleanup = deleteMiniProgramUploadArtifacts(miniProgram.appId)
    } catch (error) {
      cleanupError = error.message || '上传配置清理失败'
    }
  }

  if (cleanupError) {
    try {
      appendOperationLog({
        actor,
        type: '上传配置清理失败',
        target: miniProgram.name,
        description: `小程序及专属数据已删除，但上传配置需人工检查：${cleanupError}`,
        badge: 'warning',
      })
    } catch {
      // The transactional deletion and its audit log are already durable.
    }
  }

  return {
    deleted: true,
    id: miniProgram.id,
    appId: miniProgram.appId,
    summary: result,
    uploadCleanup,
    cleanupError,
  }
}

module.exports = {
  deleteMiniProgram,
  deleteMiniProgramRows,
}
