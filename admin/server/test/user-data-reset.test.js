const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const test = require('node:test')
const Database = require('better-sqlite3')
const {
  SCHEMA_V6_PRESERVED_TABLES,
  SCHEMA_V6_USER_DATA_TABLES,
} = require('../src/lib/schema-v6-tables')
const { clearUserData } = require('../src/lib/user-data-reset')

function createSchemaV6Database(databasePath) {
  const result = spawnSync(process.execPath, ['-e', `
    const database = require('./src/lib/state-database')
    database.getDatabase()
    database.closeDatabase()
  `], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, MINIAPP_DATABASE_FILE: databasePath },
  })
  assert.equal(result.status, 0, result.stderr)
}

function seedPreservedData(database) {
  const now = '2026-08-31T00:00:00.000Z'
  const insertState = database.prepare('INSERT INTO application_state VALUES (?, ?, ?)')
  insertState.run('admin-settings', JSON.stringify({ currentMiniProgramId: 'mp1', secret: 'preserved' }), now)
  insertState.run('release-state', JSON.stringify({ version: '1.0.0' }), now)
  database.prepare('INSERT INTO image_assets VALUES (?, ?, ?, ?)').run(
    'image-1',
    'ready',
    now,
    JSON.stringify({ id: 'image-1', status: 'ready', usage: 'daily_content', thumbUrl: '/thumb.jpg', mediumUrl: '/medium.jpg' }),
  )
  const insertContent = database.prepare('INSERT INTO content_items VALUES (?, ?, ?, ?, ?)')
  insertContent.run('pool-1', 'contentAlbums', 'content-album-1', 0, JSON.stringify({
    id: 'content-album-1', type: 'album', label: '图册', likeCount: 7, favoriteCount: 3,
    images: [{ id: 'image-1', thumbUrl: '/thumb.jpg', mediumUrl: '/medium.jpg' }],
  }))
  insertContent.run('pool-1', 'contentAudios', 'content-audio-1', 0, JSON.stringify({
    id: 'content-audio-1', type: 'audio', label: '音频', title: '保留音频',
    audioUrl: 'https://cos.scopeview.cn/letterbox/audio/example.mp3', likeCount: 5, favoriteCount: 2,
  }))
  insertContent.run('pool-1', 'contentTexts', 'content-text-1', 0, JSON.stringify({
    id: 'content-text-1', type: 'text', label: '手记', text: '保留内容', likeCount: 4, favoriteCount: 1,
  }))
}

function seedUserData(database) {
  const now = '2026-08-31T00:00:00.000Z'
  database.pragma('foreign_keys = ON')
  database.prepare(`
    INSERT INTO accounts (
      account_id, unionid, phone, phone_verified, login_synced, visitor_id,
      primary_mini_program_id, created_at, updated_at, item_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('account-1', 'union-1', '13800000000', 1, 1, 'visitor-1', 'mp1', now, now, '{}')
  database.prepare('INSERT INTO account_mini_programs VALUES (?, ?)').run('account-1', 'mp1')
  database.prepare('INSERT INTO wechat_identities VALUES (?, ?, ?)').run('mp1', 'openid-1', 'account-1')
  database.prepare('INSERT INTO user_scope_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'shared:pool-1', 'account-1', '用户昵称', '用', '/avatar.jpg', '{}', now, now, now, now, 'mp1',
  )
  database.prepare('INSERT INTO miniapp_sessions VALUES (?, ?, ?, ?, ?)').run('token-1', 'account-1', 'mp1', now, '2099-01-01T00:00:00.000Z')
  database.prepare('INSERT INTO checkin_records VALUES (?, ?, ?, ?, ?)').run('shared:pool-1', 'visitor-1', '2026-08-31', now, 'mp1')
  database.prepare('INSERT INTO checkin_users VALUES (?, ?, ?)').run('shared:pool-1', 'visitor-1', 1)
  database.prepare(`
    INSERT INTO messages (
      message_id, account_id, mini_program_id, visitor_id, status, source, source_id,
      created_at, updated_at, item_json, data_scope_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('message-1', 'account-1', 'mp1', 'visitor-1', 'saved', 'daily_content', 'content-text-1', now, now, '{}', 'shared:pool-1')
  database.prepare(`
    INSERT INTO reactions (
      reaction_key, mini_program_id, visitor_id, source, source_id, liked, favorited,
      liked_at, shared_at, updated_at, data_scope_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('reaction-1', 'mp1', 'visitor-1', 'letters', 'letter-1', 1, 1, now, now, now, 'shared:pool-1')
  database.prepare(`
    INSERT INTO opened_records (
      opened_id, mini_program_id, visitor_id, source, source_id, created_at, item_json,
      data_scope_id, event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('opened-1', 'mp1', 'visitor-1', 'daily_content', 'content-text-1', now, '{}', 'shared:pool-1', 'opened-1')
  database.prepare('INSERT INTO analytics_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'event-1', 'daily_content_open', 'mp1', 'visitor-1', now, '2026-08-31', '{}',
  )
  database.prepare(`
    INSERT INTO idempotency_records (
      operation, data_scope_id, origin_mini_program_id, account_id, request_key,
      request_hash, response_status, response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('daily_content_open', 'shared:pool-1', 'mp1', 'account-1', 'request-1', 'hash-1', 200, '{}', now)
  database.prepare('INSERT INTO article_unlocks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'unlock-1', 'shared:pool-1', 'account-1', 'mp1', 'visitor-1', 'article-1', '2026-08-31', now,
  )
}

function snapshotTables(database, tables) {
  return Object.fromEntries(tables.map((table) => [
    table,
    database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
  ]))
}

test('user data clear is transactional, preserves content/config/assets byte-for-byte, and is idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-user-clear-'))
  const databasePath = path.join(directory, 'secretbox.sqlite')
  createSchemaV6Database(databasePath)
  const database = new Database(databasePath)
  try {
    seedPreservedData(database)
    seedUserData(database)
    const preservedBefore = snapshotTables(database, SCHEMA_V6_PRESERVED_TABLES)

    const first = clearUserData(database)
    assert.deepEqual(first.remainingUserRows, Object.fromEntries(SCHEMA_V6_USER_DATA_TABLES.map((table) => [table, 0])))
    assert.deepEqual(first.clearedRows, Object.fromEntries(SCHEMA_V6_USER_DATA_TABLES.map((table) => [table, 1])))
    assert.deepEqual(snapshotTables(database, SCHEMA_V6_PRESERVED_TABLES), preservedBefore)
    assert.deepEqual(database.pragma('foreign_key_check'), [])

    const second = clearUserData(database)
    assert.deepEqual(second.clearedRows, Object.fromEntries(SCHEMA_V6_USER_DATA_TABLES.map((table) => [table, 0])))
    assert.deepEqual(snapshotTables(database, SCHEMA_V6_PRESERVED_TABLES), preservedBefore)
  } finally {
    database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('user data clear rejects missing schema markers and unknown tables before deleting records', () => {
  for (const scenario of ['missing-version', 'unknown-table']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `secretbox-user-clear-${scenario}-`))
    const databasePath = path.join(directory, 'secretbox.sqlite')
    createSchemaV6Database(databasePath)
    const database = new Database(databasePath)
    try {
      seedUserData(database)
      if (scenario === 'missing-version') database.prepare('DELETE FROM schema_migrations WHERE version = 6').run()
      else database.exec('CREATE TABLE unexpected_user_data (id TEXT PRIMARY KEY)')

      assert.throws(
        () => clearUserData(database),
        scenario === 'missing-version' ? /schema v6 is required/ : /unexpected schema tables/,
      )
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1)
    } finally {
      database.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

test('db:clear-user-data runs explicitly against the configured v6 database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-user-clear-cli-'))
  const databasePath = path.join(directory, 'secretbox.sqlite')
  createSchemaV6Database(databasePath)
  const fixture = new Database(databasePath)
  seedPreservedData(fixture)
  seedUserData(fixture)
  const preservedBefore = snapshotTables(fixture, SCHEMA_V6_PRESERVED_TABLES)
  fixture.close()
  try {
    const result = spawnSync(process.execPath, ['scripts/clear-user-data.js'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATABASE_FILE: databasePath },
    })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.schemaVersion, 6)
    assert.equal(output.integrity, 'ok')
    assert.deepEqual(output.remainingUserRows, Object.fromEntries(SCHEMA_V6_USER_DATA_TABLES.map((table) => [table, 0])))

    const verify = new Database(databasePath, { readonly: true })
    try {
      assert.deepEqual(snapshotTables(verify, SCHEMA_V6_PRESERVED_TABLES), preservedBefore)
      assert.deepEqual(snapshotTables(verify, SCHEMA_V6_USER_DATA_TABLES), Object.fromEntries(SCHEMA_V6_USER_DATA_TABLES.map((table) => [table, []])))
    } finally {
      verify.close()
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
