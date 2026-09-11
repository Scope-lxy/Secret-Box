const crypto = require('crypto')

const DATA_MODES = Object.freeze({
  SHARED: 'shared',
  INDEPENDENT: 'independent',
})

function normalizeDataMode(value) {
  return value === DATA_MODES.INDEPENDENT ? DATA_MODES.INDEPENDENT : DATA_MODES.SHARED
}

function decodeDataScopeHeader(value) {
  const headerValue = String(value || '').trim()
  if (!headerValue) return ''
  try {
    return decodeURIComponent(headerValue)
  } catch {
    return ''
  }
}

function buildDataScopeId({ miniProgramId = '', contentPoolId = '', dataMode = DATA_MODES.SHARED } = {}) {
  const programId = String(miniProgramId || '').trim()
  const poolId = String(contentPoolId || '').trim()
  if (!programId || !poolId) throw new Error('数据作用域配置不完整')
  return normalizeDataMode(dataMode) === DATA_MODES.INDEPENDENT
    ? `independent:${programId}:${poolId}`
    : `shared:${poolId}`
}

function getDataScope(context = {}) {
  const miniProgramId = String(context.miniProgramId || '').trim()
  const { getInternalAdminSettings } = require('../admin/admin-settings.store')
  const miniProgram = getInternalAdminSettings().miniPrograms.find((item) => (
    item.id === miniProgramId && item.status !== 'archived'
  ))
  if (!miniProgram) throw new Error('当前小程序已停用或不存在')
  const contentPoolId = String(miniProgram.config?.contentPoolId || '').trim()
  const dataMode = normalizeDataMode(miniProgram.config?.dataMode)
  return {
    contentPoolId,
    dataMode,
    dataScopeId: buildDataScopeId({ miniProgramId, contentPoolId, dataMode }),
    miniProgramId,
  }
}

function normalizeDataContext(context = {}) {
  const scope = getDataScope(context)
  return {
    ...scope,
    accountId: String(context.accountId || '').trim(),
    visitorId: String(context.visitorId || 'anonymous').trim() || 'anonymous',
  }
}

function scopedRecordId(scopeId, recordId) {
  const suffix = crypto.createHash('sha256').update(String(scopeId)).digest('hex').slice(0, 12)
  return `${String(recordId || '').trim()}_${suffix}`
}

function getDataScopeOwnerIds(db, dataScopeId, miniPrograms = []) {
  const scopeId = String(dataScopeId || '').trim()
  if (!scopeId) return []
  const knownIds = new Set(miniPrograms.map((item) => String(item?.id || '').trim()).filter(Boolean))
  const owners = new Set()
  const independent = /^independent:([^:]+):/.exec(scopeId)
  if (independent) owners.add(independent[1])
  miniPrograms.forEach((item) => {
    try {
      if (buildDataScopeId({
        miniProgramId: item.id,
        contentPoolId: item.config?.contentPoolId,
        dataMode: item.config?.dataMode,
      }) === scopeId) owners.add(item.id)
    } catch {
      // Historical rows still provide ownership evidence when current configuration is incomplete.
    }
  })
  db.prepare(`
    WITH scope_accounts(account_id) AS (
      SELECT account_id FROM messages WHERE data_scope_id = ?
      UNION SELECT visitor_id FROM reactions WHERE data_scope_id = ?
      UNION SELECT visitor_id FROM opened_records WHERE data_scope_id = ?
      UNION SELECT visitor_id FROM article_unlocks WHERE data_scope_id = ?
      UNION SELECT visitor_id FROM checkin_records WHERE data_scope_id = ?
      UNION SELECT visitor_id FROM checkin_users WHERE data_scope_id = ?
      UNION SELECT account_id FROM idempotency_records WHERE data_scope_id = ?
      UNION SELECT account_id FROM user_scope_profiles WHERE data_scope_id = ?
    ), scope_owners(mini_program_id) AS (
      SELECT mini_program_id FROM messages WHERE data_scope_id = ?
      UNION SELECT mini_program_id FROM reactions WHERE data_scope_id = ?
      UNION SELECT mini_program_id FROM opened_records WHERE data_scope_id = ?
      UNION SELECT mini_program_id FROM article_unlocks WHERE data_scope_id = ?
      UNION SELECT origin_mini_program_id FROM checkin_records WHERE data_scope_id = ?
      UNION SELECT origin_mini_program_id FROM idempotency_records WHERE data_scope_id = ?
      UNION SELECT origin_mini_program_id FROM user_scope_profiles WHERE data_scope_id = ?
      UNION SELECT account_mini_programs.mini_program_id
        FROM account_mini_programs JOIN scope_accounts USING (account_id)
        WHERE instr(?, 'shared:') = 1
    )
    SELECT DISTINCT mini_program_id FROM scope_owners WHERE mini_program_id <> ''
  `).all(scopeId, scopeId, scopeId, scopeId, scopeId, scopeId, scopeId, scopeId,
    scopeId, scopeId, scopeId, scopeId, scopeId, scopeId, scopeId, scopeId)
    .forEach((row) => owners.add(row.mini_program_id))
  return [...owners].filter((id) => !knownIds.size || knownIds.has(id))
}

module.exports = {
  DATA_MODES,
  buildDataScopeId,
  decodeDataScopeHeader,
  getDataScope,
  getDataScopeOwnerIds,
  normalizeDataContext,
  normalizeDataMode,
  scopedRecordId,
}
