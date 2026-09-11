const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-article-layout-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase } = require('../src/lib/state-database')
const { getAdminSettings, updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('new article display settings default the expand position to early', () => {
  const config = getAdminSettings().miniPrograms[0].config
  assert.equal(config.articleDisplay.previewPreset, 'early')
})

test('partial article display updates preserve a saved valid expand position', () => {
  updateMiniProgramConfig('default-mini-program', {
    articleDisplay: { previewPreset: 'late' },
  })
  const result = updateMiniProgramConfig('default-mini-program', {
    articleDisplay: { layout: 'stacked' },
  })
  const config = result.miniPrograms.find((item) => item.id === 'default-mini-program').config
  assert.equal(config.articleDisplay.previewPreset, 'late')
})

test('invalid expand positions are normalized to early', () => {
  const result = updateMiniProgramConfig('default-mini-program', {
    articleDisplay: { previewPreset: 'custom' },
  })
  const config = result.miniPrograms.find((item) => item.id === 'default-mini-program').config
  assert.equal(config.articleDisplay.previewPreset, 'early')
})

test('removed cover-left layout is normalized to mixed in admin config', () => {
  const result = updateMiniProgramConfig('default-mini-program', {
    articleDisplay: { layout: 'cover-left' },
  })
  const config = result.miniPrograms.find((item) => item.id === 'default-mini-program').config
  assert.equal(config.articleDisplay.layout, 'mixed')
  assert.equal(getAdminSettings().miniPrograms[0].config.articleDisplay.layout, 'mixed')
})
