const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { getDataDir } = require('./data-dir')
const {
  assertSchemaV6Version,
  createSchemaV6,
  validateSchemaV6,
} = require('./schema-v6-contract')

let database
let databasePath

const rowStateKeys = [
  'accounts',
  'analytics',
  'checkin',
  'content',
  'images',
  'interactions',
  'messages',
  'miniapp-sessions',
]

function getDatabasePath() {
  const configured = String(process.env.MINIAPP_DATABASE_FILE || '').trim()
  if (configured) return path.resolve(configured)
  const dataDir = getDataDir(path.resolve(__dirname, '../../data'))
  return path.join(dataDir, 'secretbox.sqlite')
}

function getDatabase() {
  const nextPath = getDatabasePath()
  if (database && databasePath === nextPath) return database
  if (database) {
    database.close()
    database = undefined
    databasePath = undefined
  }

  fs.mkdirSync(path.dirname(nextPath), { recursive: true })
  const isNewDatabase = !fs.existsSync(nextPath)
  const nextDatabase = new Database(nextPath)
  try {
    if (!isNewDatabase) assertSchemaV6Version(nextDatabase)
    nextDatabase.pragma('journal_mode = DELETE')
    nextDatabase.pragma('synchronous = FULL')
    nextDatabase.pragma('foreign_keys = ON')
    if (isNewDatabase) createSchemaV6(nextDatabase)
    validateSchemaV6(nextDatabase)
  } catch (error) {
    nextDatabase.close()
    throw error
  }
  database = nextDatabase
  databasePath = nextPath
  return database
}

function stateKey(file) {
  return path.basename(file, path.extname(file))
}

function readState(file) {
  if (rowStateKeys.includes(stateKey(file))) {
    throw new Error(`${stateKey(file)} uses row-based SQLite storage`)
  }
  const row = getDatabase()
    .prepare('SELECT value_json FROM application_state WHERE state_key = ?')
    .get(stateKey(file))
  if (!row) return null
  return JSON.parse(row.value_json)
}

function writeState(file, value) {
  if (rowStateKeys.includes(stateKey(file))) {
    throw new Error(`${stateKey(file)} uses row-based SQLite storage`)
  }
  getDatabase().prepare(`
    INSERT INTO application_state (state_key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(stateKey(file), JSON.stringify(value), new Date().toISOString())
}

function listStateKeys() {
  return getDatabase()
    .prepare('SELECT state_key FROM application_state ORDER BY state_key')
    .all()
    .map((item) => item.state_key)
}

function closeDatabase() {
  if (!database) return
  database.close()
  database = undefined
  databasePath = undefined
}

module.exports = {
  closeDatabase,
  getDatabase,
  getDatabasePath,
  listStateKeys,
  readState,
  writeState,
}
