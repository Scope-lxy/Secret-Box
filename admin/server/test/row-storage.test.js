const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-row-storage-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [{ id: 'pool-1', name: '行存储内容池' }],
  miniPrograms: [{
    id: 'mp1',
    name: '行存储小程序',
    appId: '',
    status: 'active',
    config: { contentPoolId: 'pool-1' },
  }],
  operationLogs: [],
})
const { appendContentItems, deleteContentItems, getContentPreflightData, getContentTypePage } = require('../src/modules/content/content.store')
const { getAdminContent } = require('../src/modules/content/content.service')
const { addImageAssets, countImages, getImagePreflightData, getImages } = require('../src/modules/images/image.store')
const { createMessage, countMessages } = require('../src/modules/messages/message.store')
const { recordAnalyticsEvent } = require('../src/modules/analytics/analytics.store')
const { recordOpened } = require('../src/modules/interactions/interaction.store')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('近期增长记录超过旧上限后仍保留全部历史', () => {
  const db = getDatabase()
  db.transaction(() => {
    for (let index = 0; index < 200; index += 1) {
      createMessage({ content: `留言 ${index}`, miniProgramId: 'mp1', visitorId: 'visitor-limit' })
    }
    const openedInsert = db.prepare(`
      INSERT INTO opened_records (
        opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
        source, source_id, created_at, item_json
      ) VALUES (?, ?, 'shared:pool-1', 'mp1', 'visitor-limit', 'daily_content', ?, ?, ?)
    `)
    for (let index = 0; index < 2000; index += 1) {
      const item = { id: `old-open-${index}`, miniProgramId: 'mp1', visitorId: 'visitor-limit', source: 'daily_content', sourceId: `box-${index}`, createdAt: new Date(index).toISOString() }
      openedInsert.run(item.id, item.id, item.sourceId, item.createdAt, JSON.stringify(item))
    }
    const analyticsInsert = db.prepare(`
      INSERT INTO analytics_events (
        event_id, event_type, mini_program_id, visitor_id, created_at, date_key, meta_json
      ) VALUES (?, 'page_view', 'mp1', 'visitor-limit', ?, '2026-08-24', '{}')
    `)
    for (let index = 0; index < 5000; index += 1) {
      // Keep the fixture within the 180-day retention window. This test covers
      // growth beyond the old in-memory cap; historical cleanup is tested by
      // the analytics retention behavior separately.
      analyticsInsert.run(`old-event-${index}`, new Date(Date.now() - index * 1000).toISOString())
    }
  })()

  createMessage({ content: '第 201 条留言', miniProgramId: 'mp1', visitorId: 'visitor-limit' })
  recordOpened({ miniProgramId: 'mp1', visitorId: 'visitor-limit' }, 'daily_content', { id: 'new-box', text: '新记录', type: 'text' })
  recordAnalyticsEvent('page_view', { miniProgramId: 'mp1', visitorId: 'visitor-limit' }, { page: 'new-page' })

  assert.equal(countMessages(), 201)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM opened_records').get().count, 2001)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count, 5001)
})

test('内容和图片按行保存并支持分页', () => {
  const letters = Array.from({ length: 250 }, (_, index) => ({
    id: `paged-letter-${index}`,
    content: `分页文案 ${index}`,
    label: '分页',
  }))
  assert.equal(appendContentItems('pool-pagination', 'letters', letters), 250)
  const contentPage = getContentTypePage('pool-pagination', 'letters', { limit: 50, offset: 200 })
  assert.equal(contentPage.total, 250)
  assert.equal(contentPage.items.length, 50)
  assert.equal(contentPage.items[0].id, 'paged-letter-200')

  addImageAssets(Array.from({ length: 250 }, (_, index) => ({
    id: `paged-image-${index}`,
    label: `分页图片 ${index}`,
    status: 'ready',
    thumbUrl: `/assets/images/share-${index % 3 + 1}.jpg`,
    mediumUrl: `/assets/images/share-${index % 3 + 1}.jpg`,
    uploadedAt: new Date(index).toISOString(),
  })))
  assert.equal(countImages(), 250)
  assert.equal(getImages({ limit: 50, offset: 200 }).length, 50)
})

test('后台内容分页默认每页 10 条，并支持指定页容量', () => {
  const letters = Array.from({ length: 100 }, (_, index) => ({
    id: `admin-page-letter-${index}`,
    content: `后台分页文案 ${index}`,
    label: '分页',
  }))
  assert.equal(appendContentItems('pool-1', 'letters', letters), 100)

  const defaultPage = getAdminContent('pool-1')
  assert.equal(defaultPage.pagination.letters.pageSize, 10)
  assert.equal(defaultPage.letters.length, 10)

  const secondPage = getAdminContent('pool-1', '', {
    letters: { page: 2, pageSize: 50 },
  })
  assert.equal(secondPage.pagination.letters.page, 2)
  assert.equal(secondPage.pagination.letters.pageSize, 50)
  assert.equal(secondPage.letters.length, 50)

  const unsupportedPageSize = getAdminContent('pool-1', '', {
    letters: { pageSize: 30 },
  })
  assert.equal(unsupportedPageSize.pagination.letters.pageSize, 10)
})

test('后台内容分页按新增顺序倒序展示', () => {
  const poolId = 'pool-1'
  const letters = Array.from({ length: 12 }, (_, index) => ({
    id: `newest-letter-${index}`,
    content: `新增顺序 ${index}`,
    label: '排序',
  }))
  appendContentItems(poolId, 'letters', letters)

  const firstPage = getAdminContent(poolId, '', { letters: { page: 1, pageSize: 10 } })
  assert.deepEqual(firstPage.letters.map((item) => item.id), [
    'newest-letter-11', 'newest-letter-10', 'newest-letter-9', 'newest-letter-8',
    'newest-letter-7', 'newest-letter-6', 'newest-letter-5', 'newest-letter-4',
    'newest-letter-3', 'newest-letter-2',
  ])

  const secondPage = getAdminContent(poolId, '', { letters: { page: 2, pageSize: 10 } })
  assert.deepEqual(secondPage.letters.slice(0, 2).map((item) => item.id), ['newest-letter-1', 'newest-letter-0'])
})

test('批量删除在事务中预校验最低保留数量和内容存在性', () => {
  const poolId = 'pool-batch-delete'
  appendContentItems(poolId, 'letters', [
    { id: 'batch-letter-1', content: '第一条', label: '批量' },
    { id: 'batch-letter-2', content: '第二条', label: '批量' },
  ])

  assert.deepEqual(deleteContentItems(poolId, 'letters', ['batch-letter-1', 'batch-letter-1']), ['batch-letter-1'])
  assert.equal(getContentTypePage(poolId, 'letters').total, 1)
  assert.throws(() => deleteContentItems(poolId, 'letters', ['batch-letter-2']), /至少保留一条/)
  assert.throws(() => deleteContentItems(poolId, 'letters', ['batch-letter-2', 'missing-letter']), /部分内容不存在/)
  assert.equal(getContentTypePage(poolId, 'letters').total, 1)
})

test('预检对超过一万条的增长数据直接聚合并限制样本数量', () => {
  addImageAssets(Array.from({ length: 10000 }, (_, index) => ({
    id: `preflight-image-${index}`,
    label: `预检图片 ${index}`,
    status: 'ready',
    thumbUrl: `/assets/images/preflight-${index}.jpg`,
    mediumUrl: `/assets/images/preflight-${index}.jpg`,
    uploadedAt: new Date(index).toISOString(),
  })))

  const imageData = getImagePreflightData({ urlPrefixes: ['/assets/images/'] })
  assert.equal(imageData.total, 10250)
  assert.equal(imageData.structurallyUsable, 10250)
  assert.equal(imageData.sample.length, 20)

  const contentData = getContentPreflightData('pool-pagination', {
    audioUrlPrefixes: ['https://media.example/'],
    imageUrlPrefixes: ['/assets/images/'],
  })
  assert.equal(contentData.summary.letters, 250)
  assert.equal(contentData.imageRefs.total, 0)
  assert.equal(contentData.imageRefs.sample.length, 0)
})

test('增长型集合不能重新写回整份 JSON 状态', () => {
  assert.throws(
    () => writeState(path.join(dataDir, 'messages.json'), []),
    /uses row-based SQLite storage/,
  )
})
