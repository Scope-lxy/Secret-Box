const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const test = require('node:test')
const Database = require('better-sqlite3')

function runNode(script, dataDir) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, MINIAPP_DATA_DIR: dataDir },
  })
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

test('existing non-v6 databases are rejected without changing their files', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-unsupported-schema-'))
  const databasePath = path.join(dataDir, 'secretbox.sqlite')
  try {
    const existing = new Database(databasePath)
    existing.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE sentinel (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO sentinel VALUES ('content', 'preserve-me');
    `)
    existing.close()
    const beforeHash = sha256(databasePath)

    const result = runNode(`
      const database = require('./src/lib/state-database')
      try {
        database.getDatabase()
        process.exit(2)
      } catch (error) {
        if (!/only schema v6 databases are supported/.test(error.message)) process.exit(3)
      }
    `, dataDir)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(sha256(databasePath), beforeHash)

    const verify = new Database(databasePath, { readonly: true })
    assert.equal(verify.prepare("SELECT value FROM sentinel WHERE id = 'content'").get().value, 'preserve-me')
    verify.close()
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('new databases initialize the complete schema v6 directly', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-new-v6-'))
  try {
    const result = runNode(`
      const database = require('./src/lib/state-database')
      const db = database.getDatabase()
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version)
      if (JSON.stringify(versions) !== JSON.stringify([6])) process.exit(2)
      database.closeDatabase()
    `, dataDir)
    assert.equal(result.status, 0, result.stderr)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('opening an existing schema v6 database preserves content, images, and settings exactly', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-runtime-v6-'))
  const snapshotScript = `
    const database = require('./src/lib/state-database')
    const db = database.getDatabase()
    const snapshot = {
      content: db.prepare('SELECT * FROM content_items ORDER BY pool_id, content_type, position, item_id').all(),
      images: db.prepare('SELECT * FROM image_assets ORDER BY asset_id').all(),
      settings: db.prepare("SELECT * FROM application_state WHERE state_key = 'admin-settings'").all(),
    }
    process.stdout.write(JSON.stringify(snapshot))
    database.closeDatabase()
  `
  try {
    const seed = runNode(`
      const database = require('./src/lib/state-database')
      const db = database.getDatabase()
      const now = '2026-09-01T00:00:00.000Z'
      db.prepare('INSERT INTO application_state VALUES (?, ?, ?)').run(
        'admin-settings',
        JSON.stringify({ currentMiniProgramId: 'app-1', contentPools: [{ id: 'pool-live' }], miniPrograms: [{ id: 'app-1', status: 'active', config: { contentPoolId: 'pool-live' } }] }),
        now,
      )
      db.prepare('INSERT INTO content_items VALUES (?, ?, ?, ?, ?)').run(
        'pool-live', 'contentTexts', 'content-text-live', 0,
        JSON.stringify({ id: 'content-text-live', type: 'text', text: '保留内容', likeCount: 0, favoriteCount: 0 }),
      )
      db.prepare('INSERT INTO image_assets VALUES (?, ?, ?, ?)').run(
        'image-live', 'ready', now,
        JSON.stringify({ id: 'image-live', status: 'ready', uploadedAt: now, thumbUrl: '/live-thumb.jpg', mediumUrl: '/live.jpg' }),
      )
      database.closeDatabase()
    `, dataDir)
    assert.equal(seed.status, 0, seed.stderr)

    const before = runNode(snapshotScript, dataDir)
    assert.equal(before.status, 0, before.stderr)
    const after = runNode(snapshotScript, dataDir)
    assert.equal(after.status, 0, after.stderr)
    assert.deepEqual(JSON.parse(after.stdout), JSON.parse(before.stdout))
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
