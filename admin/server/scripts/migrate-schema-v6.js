const Database = require('better-sqlite3')
const { getDatabasePath } = require('../src/lib/state-database')
const { migrateSchemaV5ToV6 } = require('../src/lib/schema-v6-contract')

const databasePath = getDatabasePath()
const database = new Database(databasePath)
try {
  database.pragma('journal_mode = DELETE')
  database.pragma('synchronous = FULL')
  database.pragma('foreign_keys = ON')
  const result = migrateSchemaV5ToV6(database)
  process.stdout.write(`${JSON.stringify({ databasePath, ...result }, null, 2)}\n`)
} finally {
  database.close()
}
