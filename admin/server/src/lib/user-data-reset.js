const { validateSchemaV6 } = require('./schema-v6-contract')
const {
  SCHEMA_V6_PRESERVED_TABLES,
  SCHEMA_V6_USER_DATA_TABLES,
} = require('./schema-v6-tables')

function invariant(condition, message) {
  if (!condition) throw new Error(`user data clear failed: ${message}`)
}

function listApplicationTables(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name)
}

function validateSchemaTableOwnership(db) {
  const expected = [...SCHEMA_V6_PRESERVED_TABLES, ...SCHEMA_V6_USER_DATA_TABLES].sort()
  const actual = listApplicationTables(db)
  invariant(JSON.stringify(actual) === JSON.stringify(expected), `unexpected schema tables: ${actual.join(', ')}`)
}

function countRows(db, tables) {
  return Object.fromEntries(tables.map((table) => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count,
  ]))
}

function clearUserData(db) {
  db.pragma('foreign_keys = ON')
  validateSchemaTableOwnership(db)
  invariant(db.prepare('SELECT 1 FROM schema_migrations WHERE version = 6').get(), 'schema v6 is required')
  validateSchemaV6(db)

  return db.transaction(() => {
    const preservedRows = countRows(db, SCHEMA_V6_PRESERVED_TABLES)
    const clearedRows = Object.fromEntries(SCHEMA_V6_USER_DATA_TABLES.map((table) => [
      table,
      db.prepare(`DELETE FROM "${table}"`).run().changes,
    ]))
    const remainingUserRows = countRows(db, SCHEMA_V6_USER_DATA_TABLES)
    Object.entries(remainingUserRows).forEach(([table, count]) => invariant(count === 0, `${table} was not cleared`))
    const preservedRowsAfter = countRows(db, SCHEMA_V6_PRESERVED_TABLES)
    invariant(JSON.stringify(preservedRowsAfter) === JSON.stringify(preservedRows), 'preserved table row counts changed')

    const validation = validateSchemaV6(db)
    return {
      schemaVersion: validation.schemaVersion,
      integrity: validation.integrity,
      preservedRows,
      clearedRows,
      remainingUserRows,
    }
  })()
}

module.exports = {
  clearUserData,
  listApplicationTables,
  validateSchemaTableOwnership,
}
