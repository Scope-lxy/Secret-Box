const { moveUserAnalyticsEvents } = require('../analytics/analytics.store')
const { moveCheckinState } = require('../checkin/checkin.store')
const { moveInteractionData } = require('../interactions/interaction.store')
const { moveUserMessages } = require('../messages/message.store')
const { moveArticleUnlocks } = require('../content/article-unlock.store')
const { moveMiniAppSessions } = require('./miniapp-session.store')
const { getDatabase } = require('../../lib/state-database')
const { normalizeDataContext } = require('../data-scope/data-scope')

function mergeScopeProfile({ fromAccountId, miniProgramId, toAccountId }) {
  const scopeId = normalizeDataContext({ miniProgramId, visitorId: toAccountId }).dataScopeId
  const db = getDatabase()
  const source = db.prepare(`
    SELECT * FROM user_scope_profiles WHERE data_scope_id = ? AND account_id = ?
  `).get(scopeId, fromAccountId)
  if (!source) return
  db.prepare(`
    INSERT INTO user_scope_profiles (
      data_scope_id, account_id, nickname, avatar_text, avatar_url, preferences_json,
      updated_at, nickname_updated_at, avatar_updated_at, preferences_updated_at,
      origin_mini_program_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_scope_id, account_id) DO UPDATE SET
      nickname = CASE WHEN excluded.nickname_updated_at > nickname_updated_at THEN excluded.nickname ELSE nickname END,
      avatar_text = CASE WHEN excluded.avatar_updated_at > avatar_updated_at THEN excluded.avatar_text ELSE avatar_text END,
      avatar_url = CASE WHEN excluded.avatar_updated_at > avatar_updated_at THEN excluded.avatar_url ELSE avatar_url END,
      preferences_json = CASE WHEN excluded.preferences_updated_at > preferences_updated_at THEN excluded.preferences_json ELSE preferences_json END,
      updated_at = MAX(updated_at, excluded.updated_at),
      nickname_updated_at = MAX(nickname_updated_at, excluded.nickname_updated_at),
      avatar_updated_at = MAX(avatar_updated_at, excluded.avatar_updated_at),
      preferences_updated_at = MAX(preferences_updated_at, excluded.preferences_updated_at)
  `).run(
    scopeId, toAccountId, source.nickname, source.avatar_text, source.avatar_url,
    source.preferences_json, source.updated_at, source.nickname_updated_at, source.avatar_updated_at,
    source.preferences_updated_at, source.origin_mini_program_id,
  )
}

function moveMiniProgramAccountData({ fromAccountId, fromVisitorId, miniProgramId, toAccountId }) {
  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) return
  const fromVisitorIds = [...new Set([fromAccountId, fromVisitorId].filter(Boolean))]
  mergeScopeProfile({ fromAccountId, miniProgramId, toAccountId })
  moveUserAnalyticsEvents({ miniProgramId, fromVisitorIds, toVisitorId: toAccountId })
  moveCheckinState({ miniProgramId, fromVisitorIds, toVisitorId: toAccountId })
  moveInteractionData({ miniProgramId, fromVisitorIds, toVisitorId: toAccountId })
  moveArticleUnlocks({ miniProgramId, fromVisitorIds, toVisitorId: toAccountId, toAccountId })
  moveUserMessages({ miniProgramId, fromAccountId, fromVisitorIds, toAccountId })
  moveMiniAppSessions({ fromAccountId, miniProgramId, toAccountId })
}

module.exports = {
  moveMiniProgramAccountData,
}
