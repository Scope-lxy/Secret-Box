const fs = require('fs')
const path = require('path')
const { getDataDir } = require('../src/lib/data-dir')
const { closeDatabase, getDatabase, getDatabasePath } = require('../src/lib/state-database')

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function isWithinDirectory(directory, target) {
  const relative = path.relative(path.resolve(directory), path.resolve(target))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function resolveBackupDirectory({ configuredBackupDir, dataDir, databasePath }) {
  const configured = String(configuredBackupDir || '').trim()
  if (!configured) throw new Error('MINIAPP_BACKUP_DIR is required; SQLite backups are disabled by default')

  const backupDir = path.resolve(configured)
  const activeDirectories = new Set([
    path.resolve(dataDir),
    path.dirname(path.resolve(databasePath)),
  ])
  for (const activeDirectory of activeDirectories) {
    if (isWithinDirectory(activeDirectory, backupDir)) {
      throw new Error(`MINIAPP_BACKUP_DIR must be outside the active data directory: ${activeDirectory}`)
    }
  }
  return backupDir
}

async function main() {
  const dataDir = getDataDir(path.resolve(__dirname, '../data'))
  const backupDir = resolveBackupDirectory({
    configuredBackupDir: process.env.MINIAPP_BACKUP_DIR,
    dataDir,
    databasePath: getDatabasePath(),
  })
  fs.mkdirSync(backupDir, { recursive: true })

  const destination = path.join(backupDir, `secretbox-${timestamp()}.sqlite`)
  await getDatabase().backup(destination)
  closeDatabase()
  console.log(`SQLITE_BACKUP_OK file=${destination}`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message)
    closeDatabase()
    process.exit(1)
  })
}

module.exports = {
  resolveBackupDirectory,
}
