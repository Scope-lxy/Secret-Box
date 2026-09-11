const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-image-reclamation-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [
    { id: 'pool-1', name: '图片回收内容池' },
    { id: 'pool-2', name: '图片替换内容池' },
  ],
  miniPrograms: [{
    id: 'mp1',
    name: '图片回收小程序',
    appId: '',
    status: 'active',
    config: { contentPoolId: 'pool-1' },
  }],
  operationLogs: [],
})
const { appendContentItems, getContentImageAssetIds } = require('../src/modules/content/content.store')
const { deleteAdminContentItem, updateAdminContent, updateAdminContentItem } = require('../src/modules/content/content.service')
const { addImageAsset, getImageById, getImageIdsByProcessingMode } = require('../src/modules/images/image.store')
const { reclaimImageAssets } = require('../src/modules/images/image-reclamation.service')
const { updateAdminSettings } = require('../src/modules/admin/admin-settings.store')
const { getAdminPreflight } = require('../src/modules/admin/admin-config.service')

updateAdminSettings({ storage: {
  secretId: 'test-secret-id',
  secretKey: 'test-secret-key',
  bucket: 'test-bucket-1250000000',
  region: 'ap-guangzhou',
  url: 'https://cos.example.test',
} })

function addRemoteImage(id) {
  return addImageAsset({
    id,
    label: id,
    status: 'ready',
    uploadedAt: new Date().toISOString(),
    originalUrl: `https://cos.example.test/secretbox/${id}/original.jpg`,
    mediumUrl: `https://cos.example.test/secretbox/${id}/medium.jpg`,
    thumbUrl: `https://cos.example.test/secretbox/${id}/thumb.jpg`,
  })
}

function album(id, imageId) {
  return { id, type: 'album', label: '测试', images: [{ id: imageId }] }
}

function article(id, imageId) {
  return {
    id,
    title: '测试文章',
    bodyMarkdown: '测试文章',
    publishedAt: '2026-09-01T00:00:00.000Z',
    coverImage: { id: imageId },
  }
}

function bodyImageArticle(id, imageId = '') {
  const image = imageId ? getImageById(imageId) : null
  return {
    id,
    title: '正文图片测试文章',
    bodyMarkdown: image ? `正文内容\n\n![](${image.originalUrl})` : '正文内容已更新且不再包含图片。',
    bodyImageAssetIds: imageId ? [imageId] : [],
    publishedAt: '2026-09-01T00:00:00.000Z',
    coverImage: null,
  }
}

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('零引用图片会删除三个 COS 对象和素材登记', async () => {
  addRemoteImage('reclaim-zero')
  const deletedKeys = []
  const result = await reclaimImageAssets(['reclaim-zero'], {
    deleteObject: async (key) => deletedKeys.push(key),
  })

  assert.deepEqual(result, { reclaimed: ['reclaim-zero'], retained: [] })
  assert.equal(deletedKeys.length, 3)
  assert.equal(getImageById('reclaim-zero'), null)
})

test('任一内容池仍引用的图片不会回收', async () => {
  addRemoteImage('reclaim-content')
  appendContentItems('pool-other', 'contentAlbums', [album('album-other', 'reclaim-content')])
  const result = await reclaimImageAssets(['reclaim-content'], {
    deleteObject: async () => assert.fail('仍被内容引用时不应删除 COS 对象'),
  })

  assert.deepEqual(result, { reclaimed: [], retained: ['reclaim-content'] })
  assert.ok(getImageById('reclaim-content'))
})

test('文章封面仍被引用时不会回收', async () => {
  addRemoteImage('reclaim-article-cover')
  appendContentItems('pool-other', 'articles', [article('article-other', 'reclaim-article-cover')])
  const result = await reclaimImageAssets(['reclaim-article-cover'], {
    deleteObject: async () => assert.fail('仍被文章封面引用时不应删除 COS 对象'),
  })

  assert.deepEqual(result, { reclaimed: [], retained: ['reclaim-article-cover'] })
  assert.ok(getImageById('reclaim-article-cover'))
})

test('状态面板图片检查只统计当前内容池实际引用', async () => {
  addRemoteImage('reclaim-global-only')
  const previousFetch = global.fetch
  global.fetch = async () => new Response('', { status: 200 })
  try {
    const result = await getAdminPreflight()
    const imageCheck = result.checks.find((item) => item.label === '图片素材')
    assert.equal(imageCheck.message, '当前内容池未引用图片素材')
  } finally {
    global.fetch = previousFetch
  }
})

test('历史打开记录与 COS 删除失败都会保留素材登记', async () => {
  addRemoteImage('reclaim-history')
  getDatabase().prepare(`
    INSERT INTO opened_records (
      opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
      source, source_id, created_at, item_json
    ) VALUES (
      'opened-reclaim', 'opened-reclaim', 'shared:pool-1', 'mp1', 'visitor',
      'daily_content', 'history', '2026-08-28T00:00:00.000Z', ?
    )
  `).run(JSON.stringify(album('history', 'reclaim-history')))
  const retained = await reclaimImageAssets(['reclaim-history'], {
    deleteObject: async () => assert.fail('历史记录引用时不应删除 COS 对象'),
  })
  assert.deepEqual(retained, { reclaimed: [], retained: ['reclaim-history'] })

  addRemoteImage('reclaim-failure')
  await assert.rejects(
    reclaimImageAssets(['reclaim-failure'], { deleteObject: async () => { throw new Error('COS unavailable') } }),
    /COS unavailable/,
  )
  assert.ok(getImageById('reclaim-failure'))
})

test('单项删除和全量替换都会返回被移除内容的图片候选', () => {
  addRemoteImage('reclaim-single')
  appendContentItems('pool-1', 'contentAlbums', [album('album-single', 'reclaim-single')])
  const deleted = deleteAdminContentItem({ poolId: 'pool-1', type: 'contentAlbums', itemId: 'album-single' })
  assert.deepEqual(deleted.removedImageAssetIds, ['reclaim-single'])

  addRemoteImage('reclaim-replace')
  appendContentItems('pool-2', 'contentAlbums', [album('album-replace', 'reclaim-replace')])
  const replaced = updateAdminContent({ poolId: 'pool-2', contentAlbums: [] })
  assert.deepEqual(replaced.removedImageAssetIds, ['reclaim-replace'])
  assert.deepEqual(getContentImageAssetIds('pool-2'), [])
})

test('文章正文更新移除图片后会回收对应导入素材', async () => {
  addRemoteImage('reclaim-article-body-update')
  appendContentItems('pool-1', 'articles', [
    bodyImageArticle('body-update-target', 'reclaim-article-body-update'),
    bodyImageArticle('body-update-keeper'),
  ])
  const updated = updateAdminContentItem({
    poolId: 'pool-1',
    type: 'articles',
    item: { ...bodyImageArticle('body-update-target'), bodyImageAssetIds: ['reclaim-article-body-update'] },
  })
  assert.deepEqual(updated.removedImageAssetIds, ['reclaim-article-body-update'])
  const reclaimed = await reclaimImageAssets(updated.removedImageAssetIds, { deleteObject: async () => {} })
  assert.deepEqual(reclaimed, { reclaimed: ['reclaim-article-body-update'], retained: [] })
  assert.equal(getImageById('reclaim-article-body-update'), null)
})

test('共享正文图片只在最后一个文章引用删除后回收', async () => {
  addRemoteImage('reclaim-article-body-shared')
  appendContentItems('pool-2', 'articles', [
    bodyImageArticle('body-shared-a', 'reclaim-article-body-shared'),
    bodyImageArticle('body-shared-b', 'reclaim-article-body-shared'),
    bodyImageArticle('body-shared-keeper'),
  ])
  const first = deleteAdminContentItem({ poolId: 'pool-2', type: 'articles', itemId: 'body-shared-a' })
  const retained = await reclaimImageAssets(first.removedImageAssetIds, {
    deleteObject: async () => assert.fail('仍有文章引用时不应删除共享正文图片'),
  })
  assert.deepEqual(retained, { reclaimed: [], retained: ['reclaim-article-body-shared'] })

  const second = deleteAdminContentItem({ poolId: 'pool-2', type: 'articles', itemId: 'body-shared-b' })
  const reclaimed = await reclaimImageAssets(second.removedImageAssetIds, { deleteObject: async () => {} })
  assert.deepEqual(reclaimed, { reclaimed: ['reclaim-article-body-shared'], retained: [] })
  assert.equal(getImageById('reclaim-article-body-shared'), null)
})

test('文章删除后的 COS 清理失败会保留素材登记以便重试', async () => {
  addRemoteImage('reclaim-article-delete-failure')
  appendContentItems('pool-1', 'articles', [bodyImageArticle('body-delete-failure', 'reclaim-article-delete-failure')])
  const deleted = deleteAdminContentItem({ poolId: 'pool-1', type: 'articles', itemId: 'body-delete-failure' })
  assert.deepEqual(deleted.removedImageAssetIds, ['reclaim-article-delete-failure'])
  await assert.rejects(
    reclaimImageAssets(deleted.removedImageAssetIds, { deleteObject: async () => { throw new Error('COS unavailable') } }),
    /COS unavailable/,
  )
  assert.ok(getImageById('reclaim-article-delete-failure'))
})

test('导入图片候选分页查询不会遗漏一万条之前的素材', () => {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT INTO image_assets (asset_id, status, uploaded_at, item_json)
    VALUES (?, 'ready', ?, ?)
  `)
  db.transaction(() => {
    for (let index = 0; index < 10025; index += 1) {
      const id = `article-import-volume-${String(index).padStart(5, '0')}`
      insert.run(id, new Date(1700000000000 + index).toISOString(), JSON.stringify({ id, processingMode: 'article-import-volume-test' }))
    }
    insert.run('article-import-other-mode', new Date().toISOString(), JSON.stringify({ id: 'article-import-other-mode', processingMode: 'other-mode' }))
  })()

  const ids = getImageIdsByProcessingMode('article-import-volume-test', { batchSize: 137 })
  assert.equal(ids.length, 10025)
  assert.equal(ids[0], 'article-import-volume-00000')
  assert.equal(ids.at(-1), 'article-import-volume-10024')
  assert.equal(ids.includes('article-import-other-mode'), false)
})
