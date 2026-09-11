const SCHEMA_V6_PRESERVED_TABLES = [
  'application_state',
  'article_import_jobs',
  'content_items',
  'image_assets',
  'schema_migrations',
]

const SCHEMA_V6_USER_DATA_TABLES = [
  'account_mini_programs',
  'wechat_identities',
  'user_scope_profiles',
  'miniapp_sessions',
  'checkin_records',
  'checkin_users',
  'messages',
  'reactions',
  'opened_records',
  'analytics_events',
  'idempotency_records',
  'article_unlocks',
  'accounts',
]

module.exports = {
  SCHEMA_V6_PRESERVED_TABLES,
  SCHEMA_V6_USER_DATA_TABLES,
}
