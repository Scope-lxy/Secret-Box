const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const test = require('node:test')
const { createSchemaV6, migrateSchemaV5ToV6 } = require('../src/lib/schema-v6-contract')

test('v5 to v6 migration removes duplicate opened records and adds a unique index', () => {
  const database = new Database(':memory:')
  createSchemaV6(database)
  database.exec(`
    DROP INDEX idx_opened_records_user_content;
    DROP TABLE article_unlocks;
    DROP TABLE article_import_jobs;
    DELETE FROM schema_migrations;
    INSERT INTO schema_migrations (version, applied_at) VALUES (5, '2026-08-01T00:00:00.000Z');
  `)
  const insert = database.prepare(`
    INSERT INTO opened_records (
      opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
      source, source_id, created_at, item_json
    ) VALUES (?, ?, 'shared:pool-1', 'mp1', 'visitor-1', 'article', 'article-1', ?, '{}')
  `)
  insert.run('old', 'old', '2026-09-01T00:00:00.000Z')
  insert.run('new', 'new', '2026-09-02T00:00:00.000Z')

  migrateSchemaV5ToV6(database)

  assert.deepEqual(database.prepare('SELECT opened_id FROM opened_records').all(), [{ opened_id: 'new' }])
  assert.throws(
    () => insert.run('duplicate', 'duplicate', '2026-09-03T00:00:00.000Z'),
    /UNIQUE constraint failed/,
  )
  database.close()
})
