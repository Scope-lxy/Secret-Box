const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const Database = require('better-sqlite3')
const {
  createSchemaV6,
  validateSchemaV6,
} = require('../src/lib/schema-v6-contract')

function withDatabase(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-v6-contract-'))
  const database = new Database(path.join(directory, 'secretbox.sqlite'))
  database.pragma('foreign_keys = ON')
  createSchemaV6(database)
  try {
    return callback(database)
  } finally {
    database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('schema v6 contract validates a directly initialized empty database', () => {
  withDatabase((database) => {
    const validation = validateSchemaV6(database, { requireCleanUserData: true })
    assert.equal(validation.schemaVersion, 6)
    assert.equal(validation.integrity, 'ok')
    assert.equal(validation.imageAssets, 0)
    assert.deepEqual(validation.contentCounts, {})
  })
})

test('schema v6 contract permits operational copy and rejects structural drift', () => {
  withDatabase((database) => {
    const now = new Date().toISOString()
    database.prepare('INSERT INTO application_state VALUES (?, ?, ?)').run(
      'admin-settings',
      JSON.stringify({ system: { homeHero: '运营可以自由维护这段文案' } }),
      now,
    )
    database.prepare('INSERT INTO content_items VALUES (?, ?, ?, ?, ?)').run(
      'pool-current',
      'contentTexts',
      'content-text-current',
      0,
      JSON.stringify({
        id: 'content-text-current',
        type: 'text',
        text: '运营内容不做词汇扫描，只校验当前数据结构。',
        likeCount: 0,
        favoriteCount: 0,
      }),
    )
    assert.equal(validateSchemaV6(database).integrity, 'ok')

    database.prepare("UPDATE content_items SET content_type = 'unsupportedType'").run()
    assert.throws(() => validateSchemaV6(database), /unsupported content type unsupportedType/)
    database.prepare("UPDATE content_items SET content_type = 'contentTexts'").run()

    const row = database.prepare('SELECT item_json FROM content_items').get()
    const item = JSON.parse(row.item_json)
    item.type = 'audio'
    database.prepare('UPDATE content_items SET item_json = ?').run(JSON.stringify(item))
    assert.throws(() => validateSchemaV6(database), /content item type mismatch/)
  })
})

test('schema v6 contract rejects an incomplete structure even when its version marker exists', () => {
  withDatabase((database) => {
    database.exec('ALTER TABLE analytics_events RENAME COLUMN date_key TO wrong_date_key')
    assert.throws(() => validateSchemaV6(database), /table structure mismatch: analytics_events/)
  })
})
