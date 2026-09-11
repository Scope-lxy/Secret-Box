const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-copy-version-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase } = require('../src/lib/state-database')
const {
  createMiniProgram,
  getInternalAdminSettings,
  updateAdminSettings,
  updateMiniProgram,
} = require('../src/modules/admin/admin-settings.store')
const { getAdminContent } = require('../src/modules/content/content.service')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('文案列表由后台完整读取，所有小程序配置入口统一维护 copyVersion', () => {
  updateMiniProgram('default-mini-program', { appId: 'wx1234567890abcde0' })
  createMiniProgram({
    id: 'copy-version-app',
    name: '文案版本测试',
    appId: 'wx1234567890abcde1',
    appSecret: 'test-secret',
    config: { contentPoolId: 'default-pool', copyVersion: 999 },
  })

  const initial = getInternalAdminSettings().miniPrograms.find((item) => item.id === 'copy-version-app')
  assert.equal(initial.config.copyVersion, 1)
  const adminContent = getAdminContent('default-pool', initial.id)
  assert.deepEqual(adminContent.system.dailyContentPromptTexts, initial.config.system.dailyContentPromptTexts)
  assert.deepEqual(adminContent.system.checkinBeforeTexts, initial.config.system.checkinBeforeTexts)
  assert.deepEqual(adminContent.system.checkinAfterTexts, initial.config.system.checkinAfterTexts)

  updateMiniProgram(initial.id, {
    config: {
      system: {
        ...initial.config.system,
        dailyContentPromptTexts: ['版本入口，已更新'],
      },
    },
  })
  const afterDedicatedUpdate = getInternalAdminSettings().miniPrograms.find((item) => item.id === initial.id)
  assert.equal(afterDedicatedUpdate.config.copyVersion, initial.config.copyVersion + 1)

  updateMiniProgram(initial.id, {
    config: { ...afterDedicatedUpdate.config, copyVersion: 999 },
  })
  const afterForgedVersion = getInternalAdminSettings().miniPrograms.find((item) => item.id === initial.id)
  assert.equal(afterForgedVersion.config.copyVersion, afterDedicatedUpdate.config.copyVersion)

  const nextPrograms = getInternalAdminSettings().miniPrograms.map((item) => ({
    ...item,
    config: item.id === initial.id
      ? {
          ...item.config,
          system: {
            ...item.config.system,
            checkinBeforeTexts: ['批量入口，已更新'],
          },
        }
      : item.config,
  }))
  updateAdminSettings({ miniPrograms: nextPrograms })
  const afterBulkUpdate = getInternalAdminSettings().miniPrograms.find((item) => item.id === initial.id)
  assert.equal(afterBulkUpdate.config.copyVersion, afterDedicatedUpdate.config.copyVersion + 1)
})
