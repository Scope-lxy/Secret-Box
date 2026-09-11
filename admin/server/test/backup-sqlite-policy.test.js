const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const test = require('node:test')
const { resolveBackupDirectory } = require('../scripts/backup-sqlite')

test('SQLite backup requires an explicit directory outside every active data directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-backup-policy-'))
  try {
    const dataDir = path.join(root, 'data')
    const customDatabasePath = path.join(root, 'custom-data', 'secretbox.sqlite')

    assert.throws(
      () => resolveBackupDirectory({ configuredBackupDir: '', dataDir, databasePath: customDatabasePath }),
      /MINIAPP_BACKUP_DIR is required/,
    )
    for (const configuredBackupDir of [
      dataDir,
      path.join(dataDir, 'backups'),
      path.dirname(customDatabasePath),
      path.join(path.dirname(customDatabasePath), 'backups'),
    ]) {
      assert.throws(
        () => resolveBackupDirectory({ configuredBackupDir, dataDir, databasePath: customDatabasePath }),
        /must be outside the active data directory/,
      )
    }

    const externalDirectory = path.join(root, 'operator-managed-backups')
    assert.equal(
      resolveBackupDirectory({ configuredBackupDir: externalDirectory, dataDir, databasePath: customDatabasePath }),
      path.resolve(externalDirectory),
    )
    assert.equal(fs.existsSync(externalDirectory), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('db:backup fails closed without creating a default data/backups directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-backup-disabled-'))
  try {
    const env = { ...process.env, MINIAPP_DATA_DIR: dataDir }
    delete env.MINIAPP_BACKUP_DIR
    const result = spawnSync(process.execPath, ['scripts/backup-sqlite.js'], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /MINIAPP_BACKUP_DIR is required/)
    assert.equal(fs.existsSync(path.join(dataDir, 'backups')), false)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
