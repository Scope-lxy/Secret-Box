const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-content-pool-initialization-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase } = require('../src/lib/state-database')
const { getContentSnapshot, getContentTypePage } = require('../src/modules/content/content.store')
const { countImages, getImages } = require('../src/modules/images/image.store')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('已配置内容池首次读取时保持为空', () => {
  const db = getDatabase()

  assert.deepEqual(getContentSnapshot('pool-1'), {
    dailyContents: [],
    letters: [],
    articles: [],
  })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM content_items WHERE pool_id = ?').get('pool-1').count, 0)
})

test('未配置内容池首次读取时保持为空', () => {
  const page = getContentTypePage('unconfigured-pool', 'letters')

  assert.equal(page.total, 0)
  assert.deepEqual(page.items, [])
})

test('空素材库读取时不生成演示图片', () => {
  assert.equal(countImages(), 0)
  assert.deepEqual(getImages(), [])
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM image_assets').get().count, 0)
})
