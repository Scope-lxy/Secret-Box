const fs = require('fs')
const Database = require('better-sqlite3')
const { getDatabasePath } = require('../src/lib/state-database')
const { clearUserData } = require('../src/lib/user-data-reset')

function main() {
  const databasePath = getDatabasePath()
  if (!fs.existsSync(databasePath)) throw new Error(`database does not exist: ${databasePath}`)
  const database = new Database(databasePath, { fileMustExist: true })
  try {
    const result = clearUserData(database)
    console.log(JSON.stringify({ databasePath, ...result }, null, 2))
  } finally {
    database.close()
  }
}

try {
  main()
} catch (error) {
  console.error(`USER_DATA_CLEAR_FAILED ${error.message}`)
  process.exitCode = 1
}
