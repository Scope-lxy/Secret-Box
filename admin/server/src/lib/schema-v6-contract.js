const {
  SCHEMA_V6_PRESERVED_TABLES,
  SCHEMA_V6_USER_DATA_TABLES,
} = require('./schema-v6-tables')

const SCHEMA_VERSION = 6
const contentTypes = {
  contentTexts: 'text',
  contentAudios: 'audio',
  contentAlbums: 'album',
  letters: '',
  articles: '',
}
const requiredColumns = {
  application_state: ['state_key', 'value_json', 'updated_at'],
  schema_migrations: ['version', 'applied_at'],
  content_items: ['pool_id', 'content_type', 'item_id', 'position', 'item_json'],
  image_assets: ['asset_id', 'status', 'uploaded_at', 'item_json'],
  messages: ['message_id', 'data_scope_id', 'account_id', 'mini_program_id', 'visitor_id', 'status', 'source', 'source_id', 'created_at', 'updated_at', 'item_json'],
  reactions: ['reaction_key', 'data_scope_id', 'mini_program_id', 'visitor_id', 'source', 'source_id', 'liked', 'favorited', 'liked_at', 'shared_at', 'updated_at'],
  opened_records: ['opened_id', 'event_id', 'data_scope_id', 'mini_program_id', 'visitor_id', 'source', 'source_id', 'created_at', 'item_json'],
  analytics_events: ['event_id', 'event_type', 'mini_program_id', 'visitor_id', 'created_at', 'date_key', 'meta_json'],
  accounts: ['account_id', 'unionid', 'phone', 'phone_verified', 'login_synced', 'visitor_id', 'primary_mini_program_id', 'created_at', 'updated_at', 'item_json'],
  account_mini_programs: ['account_id', 'mini_program_id'],
  wechat_identities: ['mini_program_id', 'openid', 'account_id'],
  user_scope_profiles: ['data_scope_id', 'account_id', 'nickname', 'avatar_text', 'avatar_url', 'preferences_json', 'updated_at', 'nickname_updated_at', 'avatar_updated_at', 'preferences_updated_at', 'origin_mini_program_id'],
  miniapp_sessions: ['token_hash', 'account_id', 'mini_program_id', 'created_at', 'expires_at'],
  checkin_users: ['data_scope_id', 'visitor_id', 'total_days'],
  checkin_records: ['data_scope_id', 'visitor_id', 'date_key', 'checked_at', 'origin_mini_program_id'],
  idempotency_records: ['operation', 'data_scope_id', 'origin_mini_program_id', 'account_id', 'request_key', 'request_hash', 'response_status', 'response_json', 'created_at'],
  article_unlocks: ['unlock_id', 'data_scope_id', 'account_id', 'mini_program_id', 'visitor_id', 'article_id', 'date_key', 'unlocked_at'],
  article_import_jobs: ['job_id', 'pool_id', 'status', 'created_at', 'updated_at', 'item_json'],
}

function invariant(condition, message) {
  if (!condition) throw new Error(`schema v6 validation failed: ${message}`)
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function assertSchemaV6Version(db) {
  invariant(tableExists(db, 'schema_migrations'), 'schema_migrations table is missing')
  invariant(
    db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(SCHEMA_VERSION),
    'only schema v6 databases are supported',
  )
}

function assertOpenedRecordsUniqueIndex(db) {
  const index = db.prepare("PRAGMA index_list('opened_records')").all()
    .find((item) => item.name === 'idx_opened_records_user_content')
  invariant(index && index.unique === 1, 'opened_records unique index is missing')
  const columns = db.prepare("PRAGMA index_info('idx_opened_records_user_content')").all().map((row) => row.name)
  invariant(
    JSON.stringify(columns) === JSON.stringify(['data_scope_id', 'visitor_id', 'source', 'source_id']),
    'opened_records unique index has unexpected columns',
  )
}

function removeDuplicateOpenedRecords(db) {
  return db.prepare(`
    DELETE FROM opened_records
    WHERE rowid IN (
      SELECT older.rowid
      FROM opened_records AS older
      JOIN opened_records AS newer
        ON newer.data_scope_id = older.data_scope_id
       AND newer.visitor_id = older.visitor_id
       AND newer.source = older.source
       AND newer.source_id = older.source_id
       AND (
         newer.created_at > older.created_at
         OR (newer.created_at = older.created_at AND newer.opened_id > older.opened_id)
       )
    )
  `).run().changes
}

function createSchemaV6(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE application_state (
        state_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE content_items (
        pool_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        item_json TEXT NOT NULL,
        PRIMARY KEY (pool_id, content_type, item_id)
      );
      CREATE INDEX idx_content_items_list ON content_items (pool_id, content_type, position);
      CREATE TABLE article_import_jobs (
        job_id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        item_json TEXT NOT NULL
      );
      CREATE INDEX idx_article_import_jobs_list ON article_import_jobs (created_at DESC, job_id);
      CREATE TABLE image_assets (
        asset_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        item_json TEXT NOT NULL
      );
      CREATE INDEX idx_image_assets_list ON image_assets (uploaded_at DESC, asset_id);
      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        data_scope_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        item_json TEXT NOT NULL
      );
      CREATE INDEX idx_messages_admin ON messages (created_at DESC, message_id);
      CREATE INDEX idx_messages_visitor ON messages (data_scope_id, visitor_id, status, updated_at DESC);
      CREATE INDEX idx_messages_account ON messages (data_scope_id, account_id);
      CREATE UNIQUE INDEX idx_messages_current_user_content
        ON messages (data_scope_id, account_id, source, source_id)
        WHERE status = 'saved' AND account_id <> '' AND source <> '' AND source_id <> '';
      CREATE TABLE reactions (
        reaction_key TEXT PRIMARY KEY,
        data_scope_id TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        liked INTEGER NOT NULL DEFAULT 0,
        favorited INTEGER NOT NULL DEFAULT 0,
        liked_at TEXT NOT NULL,
        shared_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_reactions_user_content
        ON reactions (data_scope_id, visitor_id, source, source_id);
      CREATE INDEX idx_reactions_visitor ON reactions (data_scope_id, visitor_id, source);
      CREATE INDEX idx_reactions_content ON reactions (data_scope_id, source, source_id);
      CREATE TABLE opened_records (
        opened_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        data_scope_id TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        item_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_opened_records_event ON opened_records (data_scope_id, event_id);
      CREATE UNIQUE INDEX idx_opened_records_user_content
        ON opened_records (data_scope_id, visitor_id, source, source_id);
      CREATE INDEX idx_opened_records_visitor
        ON opened_records (data_scope_id, visitor_id, created_at DESC, opened_id);
      CREATE TABLE article_unlocks (
        unlock_id TEXT PRIMARY KEY,
        data_scope_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        unlocked_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_article_unlocks_daily
        ON article_unlocks (data_scope_id, visitor_id, article_id, date_key);
      CREATE INDEX idx_article_unlocks_visitor
        ON article_unlocks (data_scope_id, visitor_id, date_key, unlocked_at DESC);
      CREATE TABLE analytics_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        date_key TEXT NOT NULL,
        meta_json TEXT NOT NULL
      );
      CREATE INDEX idx_analytics_scope
        ON analytics_events (mini_program_id, date_key, event_type, created_at);
      CREATE INDEX idx_analytics_visitor
        ON analytics_events (mini_program_id, visitor_id, event_type, created_at DESC);
      CREATE TABLE accounts (
        account_id TEXT PRIMARY KEY,
        unionid TEXT NOT NULL,
        phone TEXT NOT NULL,
        phone_verified INTEGER NOT NULL DEFAULT 0,
        login_synced INTEGER NOT NULL DEFAULT 0,
        visitor_id TEXT NOT NULL,
        primary_mini_program_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        item_json TEXT NOT NULL
      );
      CREATE INDEX idx_accounts_unionid ON accounts (unionid) WHERE unionid <> '';
      CREATE INDEX idx_accounts_phone ON accounts (phone, phone_verified) WHERE phone <> '';
      CREATE INDEX idx_accounts_visitor ON accounts (visitor_id);
      CREATE TABLE account_mini_programs (
        account_id TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        PRIMARY KEY (account_id, mini_program_id),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_account_mini_programs_program
        ON account_mini_programs (mini_program_id, account_id);
      CREATE TABLE wechat_identities (
        mini_program_id TEXT NOT NULL,
        openid TEXT NOT NULL,
        account_id TEXT NOT NULL,
        PRIMARY KEY (mini_program_id, openid),
        UNIQUE (account_id, mini_program_id, openid),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
      );
      CREATE TABLE user_scope_profiles (
        data_scope_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        avatar_text TEXT NOT NULL,
        avatar_url TEXT NOT NULL,
        preferences_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        nickname_updated_at TEXT NOT NULL,
        avatar_updated_at TEXT NOT NULL,
        preferences_updated_at TEXT NOT NULL,
        origin_mini_program_id TEXT NOT NULL,
        PRIMARY KEY (data_scope_id, account_id)
      );
      CREATE TABLE miniapp_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_miniapp_sessions_account
        ON miniapp_sessions (account_id, mini_program_id);
      CREATE INDEX idx_miniapp_sessions_expiry ON miniapp_sessions (expires_at);
      CREATE TABLE checkin_users (
        data_scope_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        total_days INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (data_scope_id, visitor_id)
      );
      CREATE TABLE checkin_records (
        data_scope_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        origin_mini_program_id TEXT NOT NULL,
        PRIMARY KEY (data_scope_id, visitor_id, date_key)
      );
      CREATE INDEX idx_checkin_records_rank
        ON checkin_records (data_scope_id, date_key, checked_at, visitor_id);
      CREATE TABLE idempotency_records (
        operation TEXT NOT NULL,
        data_scope_id TEXT NOT NULL,
        origin_mini_program_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        request_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (operation, data_scope_id, account_id, request_key)
      );
    `)
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, new Date().toISOString())
  })()
}

function migrateRuntimeConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  const next = { ...config }
  const ads = { ...(next.ads || {}) }
  if (ads.diaryNative && !ads.articlesStartNative) ads.articlesStartNative = { ...ads.diaryNative, label: '文章详情开头广告' }
  if (ads.diaryNative && !ads.articlesEndNative) ads.articlesEndNative = { ...ads.diaryNative, label: '文章详情正文广告' }
  if (ads.diaryInterstitial && !ads.articleInterstitial) ads.articleInterstitial = { ...ads.diaryInterstitial, label: '文章详情插屏广告' }
  if (!ads.articleExpandRewarded) {
    const rewarded = ads.homeDailyContentRewarded || {}
    ads.articleExpandRewarded = {
      enabled: true,
      adUnitId: String(rewarded.adUnitId || '').trim(),
      label: '文章详情激励视频',
      adType: 'rewarded',
      freeCount: 0,
      confirmPopupEnabled: rewarded.confirmPopupEnabled !== false,
      allowOnUnavailable: rewarded.allowOnUnavailable !== false,
    }
  }
  delete ads.diaryNative
  delete ads.diaryInterstitial
  next.ads = ads

  const system = { ...(next.system || {}) }
  if (system.diaryHero && !system.articlesHero) system.articlesHero = system.diaryHero
  delete system.diaryHero
  const tabs = { ...(system.tabs || {}) }
  if (tabs.diary && !tabs.articles) tabs.articles = { ...tabs.diary, label: '文章' }
  if (tabs.articles) tabs.articles = { ...tabs.articles, visible: true }
  delete tabs.diary
  system.tabs = Object.fromEntries(['home', 'articles', 'letters', 'mine']
    .filter((key) => tabs[key])
    .map((key) => [key, tabs[key]]))
  next.system = system
  const articleDisplay = { ...(next.articleDisplay || {}) }
  const previewPresets = ['earliest', 'early', 'medium', 'late', 'latest']
  articleDisplay.layout = ['title-left', 'stacked', 'mixed'].includes(articleDisplay.layout)
    ? articleDisplay.layout
    : 'mixed'
  articleDisplay.previewPreset = previewPresets.includes(articleDisplay.previewPreset)
    ? articleDisplay.previewPreset
    : 'early'
  articleDisplay.expandButtonText = String(articleDisplay.expandButtonText || '展开全文').trim().slice(0, 12) || '展开全文'
  articleDisplay.hideFullArticle = articleDisplay.hideFullArticle !== false
  delete articleDisplay.previewHeightRpx
  next.articleDisplay = articleDisplay
  return next
}

function migrateApplicationState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!Array.isArray(value.miniPrograms)) return value
  return {
    ...value,
    miniPrograms: value.miniPrograms.map((item) => ({
      ...item,
      config: migrateRuntimeConfig(item.config),
    })),
  }
}

function migrateSchemaV5ToV6(db) {
  invariant(tableExists(db, 'schema_migrations'), 'schema_migrations table is missing')
  invariant(db.prepare('SELECT 1 FROM schema_migrations WHERE version = 5').get(), 'schema v5 database is required')
  invariant(!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 6').get(), 'schema v6 is already applied')
  db.transaction(() => {
    db.exec(`
      CREATE TABLE article_import_jobs (
        job_id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        item_json TEXT NOT NULL
      );
      CREATE INDEX idx_article_import_jobs_list ON article_import_jobs (created_at DESC, job_id);
      CREATE TABLE article_unlocks (
        unlock_id TEXT PRIMARY KEY,
        data_scope_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        mini_program_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        unlocked_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_article_unlocks_daily
        ON article_unlocks (data_scope_id, visitor_id, article_id, date_key);
      CREATE INDEX idx_article_unlocks_visitor
        ON article_unlocks (data_scope_id, visitor_id, date_key, unlocked_at DESC);
    `)
    db.prepare("DELETE FROM content_items WHERE content_type = 'diaryEntries'").run()
    for (const table of ['messages', 'reactions', 'opened_records']) {
      db.prepare(`DELETE FROM ${table} WHERE source = 'diary'`).run()
    }
    db.prepare("DELETE FROM analytics_events WHERE json_extract(meta_json, '$.source') = 'diary'").run()
    db.prepare("DELETE FROM idempotency_records WHERE instr(response_json, '\"diary\"') > 0").run()

    const stateRows = db.prepare('SELECT state_key, value_json FROM application_state').all()
    const updateState = db.prepare('UPDATE application_state SET value_json = ?, updated_at = ? WHERE state_key = ?')
    const now = new Date().toISOString()
    stateRows.forEach((row) => {
      const current = JSON.parse(row.value_json)
      const migrated = migrateApplicationState(current)
      if (JSON.stringify(current) !== JSON.stringify(migrated)) {
        updateState.run(JSON.stringify(migrated), now, row.state_key)
      }
    })
    db.prepare(`
      UPDATE image_assets
      SET item_json = json_set(
        item_json,
        '$.usage',
        trim(replace(replace(replace(COALESCE(json_extract(item_json, '$.usage'), ''), 'daily_content,diary', 'daily_content'), 'diary,daily_content', 'daily_content'), 'diary', ''), ',')
      )
      WHERE instr(COALESCE(json_extract(item_json, '$.usage'), ''), 'diary') > 0
    `).run()
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)').run(now)
    removeDuplicateOpenedRecords(db)
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_opened_records_user_content
        ON opened_records (data_scope_id, visitor_id, source, source_id)
    `)
  })()
  return validateSchemaV6(db)
}

function parseJson(value, label) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`schema v6 validation failed: ${label} contains invalid JSON: ${error.message}`)
  }
}

function validateSchemaV6(db, { requireCleanUserData = false } = {}) {
  const requiredTables = [...SCHEMA_V6_PRESERVED_TABLES, ...SCHEMA_V6_USER_DATA_TABLES]
  requiredTables.forEach((table) => {
    invariant(tableExists(db, table), `required table is missing: ${table}`)
    const actual = db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name).sort()
    const expected = [...requiredColumns[table]].sort()
    invariant(JSON.stringify(actual) === JSON.stringify(expected), `table structure mismatch: ${table}`)
  })
  assertSchemaV6Version(db)
  assertOpenedRecordsUniqueIndex(db)

  const assets = new Set()
  db.prepare('SELECT asset_id, item_json FROM image_assets ORDER BY asset_id').all().forEach((row) => {
    const item = parseJson(row.item_json, `image asset ${row.asset_id}`)
    invariant(String(item.id || '') === row.asset_id, `image asset id mismatch: ${row.asset_id}`)
    assets.add(row.asset_id)
  })

  const contentCounts = {}
  db.prepare(`
    SELECT pool_id, content_type, item_id, item_json FROM content_items
    ORDER BY pool_id, content_type, position, item_id
  `).all().forEach((row) => {
    invariant(Object.hasOwn(contentTypes, row.content_type), `unsupported content type ${row.content_type}`)
    const item = parseJson(row.item_json, `content item ${row.item_id}`)
    invariant(String(item.id || '') === row.item_id, `content item id mismatch: ${row.item_id}`)
    const expectedType = contentTypes[row.content_type]
    if (expectedType) invariant(item.type === expectedType, `content item type mismatch: ${row.item_id}`)
    if (requireCleanUserData) {
      invariant(item.likeCount === 0 && item.favoriteCount === 0, `interaction counters remain: ${row.item_id}`)
    }
    invariant(!Object.hasOwn(item, 'myMessage'), `myMessage remains: ${row.item_id}`)
    for (const image of item.images || []) {
      invariant(assets.has(image.id), `missing image ${image.id} referenced by ${row.item_id}`)
    }
    if (item.coverImage?.id) {
      invariant(assets.has(item.coverImage.id), `missing cover image ${item.coverImage.id} referenced by ${row.item_id}`)
    }
    contentCounts[row.content_type] = (contentCounts[row.content_type] || 0) + 1
  })

  const stateKeys = []
  db.prepare('SELECT state_key, value_json FROM application_state ORDER BY state_key').all().forEach((row) => {
    parseJson(row.value_json, `application state ${row.state_key}`)
    stateKeys.push(row.state_key)
  })

  const userDataCounts = Object.fromEntries(SCHEMA_V6_USER_DATA_TABLES.map((table) => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count,
  ]))
  if (requireCleanUserData) {
    Object.entries(userDataCounts).forEach(([table, count]) => {
      invariant(count === 0, `${table} was not cleared`)
    })
  }

  const foreignKeyErrors = db.pragma('foreign_key_check')
  invariant(foreignKeyErrors.length === 0, `foreign key check failed with ${foreignKeyErrors.length} row(s)`)
  const integrity = db.pragma('integrity_check', { simple: true })
  invariant(integrity === 'ok', `integrity check failed: ${integrity}`)
  return {
    schemaVersion: SCHEMA_VERSION,
    integrity,
    stateKeys,
    contentCounts,
    imageAssets: assets.size,
    userDataCounts,
  }
}

module.exports = {
  SCHEMA_VERSION,
  assertSchemaV6Version,
  createSchemaV6,
  migrateSchemaV5ToV6,
  validateSchemaV6,
}
