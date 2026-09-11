const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-import-deduplication-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase } = require('../src/lib/state-database')
const { withCors } = require('../src/lib/cors')
const { getInternalAdminSettings, updateAdminSettings } = require('../src/modules/admin/admin-settings.store')
const {
  appendDeduplicatedContentItems,
  getContentItem,
  getDuplicateContentItemIndexes,
} = require('../src/modules/content/content.store')
const {
  addImageAssets,
  getImageById,
  getImagesByOriginalSha256,
} = require('../src/modules/images/image.store')
const { createAppRouter } = require('../src/routes')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('三种可去重内容按各自稳定正文标识过滤同批和历史重复', () => {
  const cases = [
    {
      type: 'contentTexts',
      first: { id: 'note-1', label: '标题一', text: '同一段\n正文' },
      duplicate: { id: 'note-2', label: '标题二', text: '  同一段 正文  ' },
    },
    {
      type: 'letters',
      first: { id: 'letter-1', label: '标题一', content: '同一封\r\n信' },
      duplicate: { id: 'letter-2', label: '标题二', content: '同一封 信' },
    },
    {
      type: 'articles',
      first: {
        id: 'article-1',
        title: '文章标题一',
        bodyMarkdown: '第一版正文',
        sourceHash: 'A'.repeat(64),
      },
      duplicate: {
        id: 'article-2',
        title: '文章标题二',
        bodyMarkdown: '第二版正文',
        sourceHash: 'a'.repeat(64),
      },
    },
  ]

  cases.forEach(({ duplicate, first, type }) => {
    const poolId = `pool-${type}`
    assert.deepEqual(
      appendDeduplicatedContentItems(poolId, type, [first, duplicate]),
      { duplicateCount: 1, importedCount: 1 },
    )
    assert.deepEqual(
      appendDeduplicatedContentItems(poolId, type, [{ ...duplicate, id: `${duplicate.id}-history` }]),
      { duplicateCount: 1, importedCount: 0 },
    )
    assert.ok(getContentItem(poolId, type, first.id))
    assert.deepEqual(
      getDuplicateContentItemIndexes(poolId, type, [
        { ...duplicate, id: `${duplicate.id}-preflight` },
        { ...duplicate, id: `${duplicate.id}-preflight-2` },
      ]),
      [0, 1],
    )
  })
})

test('图片组和音频不启用内容级去重', () => {
  assert.deepEqual(
    appendDeduplicatedContentItems('pool-albums', 'contentAlbums', [
      { id: 'album-1', label: '标题一', images: [{ id: 'img-001' }, { id: 'img-002' }] },
      { id: 'album-2', label: '标题二', images: [{ id: 'img-001' }, { id: 'img-002' }] },
    ]),
    { duplicateCount: 0, importedCount: 2 },
  )
  assert.deepEqual(
    appendDeduplicatedContentItems('pool-albums', 'contentAlbums', [
      { id: 'album-3', label: '历史同素材新图片组', images: [{ id: 'img-001' }, { id: 'img-002' }] },
    ]),
    { duplicateCount: 0, importedCount: 1 },
  )

  const audio = (id) => ({
    id,
    label: '默认',
    title: '同一音频',
    originalFilename: 'same.mp3',
    objectKey: `secretbox/audio/${id}.mp3`,
    audioUrl: `https://example.test/${id}.mp3`,
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
  })
  assert.deepEqual(
    appendDeduplicatedContentItems('pool-audio', 'contentAudios', [audio('audio-1'), audio('audio-2')]),
    { duplicateCount: 0, importedCount: 2 },
  )
})

test('图片素材保存原始字节 SHA-256 并可供历史复用查询', () => {
  const sha256 = 'a'.repeat(64)
  addImageAssets([{
    id: 'sha-image-1',
    label: '历史图片',
    mediumUrl: 'https://example.test/medium.jpg',
    originalSha256: sha256.toUpperCase(),
    originalUrl: 'https://example.test/original.jpg',
    status: 'ready',
    thumbUrl: 'https://example.test/thumb.jpg',
  }])

  const [matched] = getImagesByOriginalSha256([sha256, 'invalid'])
  assert.equal(matched.id, 'sha-image-1')
  assert.equal(matched.originalSha256, sha256)
})

test('预检复用历史图片，同批相同 SHA-256 只签发一个上传任务', async () => {
  const historicalSha256 = 'c'.repeat(64)
  const freshSha256 = 'd'.repeat(64)
  const croppedSha256 = 'e'.repeat(64)
  const settings = getInternalAdminSettings()
  const miniProgram = settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId) || settings.miniPrograms[0]
  const poolId = miniProgram.config.contentPoolId
  updateAdminSettings({
    storage: {
      ...settings.storage,
      bucket: 'test-bucket-1234567890',
      region: 'ap-shanghai',
      secretId: 'test-secret-id',
      secretKey: 'test-secret-key',
    },
  })
  addImageAssets([{
    id: 'sha-image-preflight',
    processingProfile: 'display-v1',
    label: '历史图片',
    mediumUrl: 'https://example.test/medium-preflight.jpg',
    originalSha256: historicalSha256,
    originalUrl: 'https://example.test/original-preflight.jpg',
    status: 'ready',
    thumbUrl: 'https://example.test/thumb-preflight.jpg',
  }, {
    id: 'cropped-share-asset',
    originalSha256: croppedSha256,
    processingProfile: 'share-background-v2',
    usage: 'share-background',
    originalUrl: 'https://example.test/full.jpg',
    mediumUrl: 'https://example.test/cropped-medium.jpg',
    thumbUrl: 'https://example.test/cropped-thumb.jpg',
    status: 'ready',
  }])
  appendDeduplicatedContentItems(poolId, 'letters', [{ id: 'letter-preflight-existing', content: '历史心笺 正文', label: '默认' }])

  const server = http.createServer(withCors(createAppRouter({
    imageReadinessOptions: { objectExists: async () => true, sleep: async () => {} },
  }).handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const post = async (pathname, body, cookie = '') => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
    return { data: await response.json(), headers: response.headers, status: response.status }
  }
  try {
    const login = await post('/api/admin/login', { account: 'admin', password: '123456' })
    assert.equal(login.status, 200)
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
    const preflight = await post('/api/admin/content/import/preflight', {
      images: [
        { clientId: 'historical-image', originalSha256: historicalSha256 },
        { clientId: 'fresh-image', originalSha256: freshSha256 },
        { clientId: 'cropped-image', originalSha256: croppedSha256 },
      ],
      items: [
        { id: 'letter-preflight-duplicate', content: '  历史心笺\n正文  ' },
        { id: 'letter-preflight-new', content: '全新心笺正文' },
      ],
      miniProgramId: miniProgram.id,
      poolId,
      type: 'letters',
    }, cookie)
    assert.equal(preflight.status, 200)
    assert.deepEqual(preflight.data.duplicateItemIndexes, [0])
    assert.deepEqual(preflight.data.reusableImages, [{ assetId: 'sha-image-preflight', clientId: 'historical-image' }])

    const prepared = await post('/api/admin/images/upload/prepare-batch', {
      items: [
        { clientId: 'fresh-a', name: 'a.jpg', originalSha256: freshSha256, size: 1024, type: 'image/jpeg' },
        { clientId: 'fresh-b', name: 'b.jpg', originalSha256: freshSha256, size: 1024, type: 'image/jpeg' },
        { clientId: 'historical', name: 'old.jpg', originalSha256: historicalSha256, size: 1024, type: 'image/jpeg' },
        { clientId: 'cropped-as-album', name: 'crop.jpg', originalSha256: croppedSha256, size: 1024, type: 'image/jpeg', usage: 'daily_content' },
        { clientId: 'cropped-as-share', name: 'crop.jpg', originalSha256: croppedSha256, size: 1024, type: 'image/jpeg', usage: 'share-background' },
        { clientId: 'fresh-as-share', name: 'a.jpg', originalSha256: freshSha256, size: 1024, type: 'image/jpeg', usage: 'share-background' },
      ],
    }, cookie)
    assert.equal(prepared.status, 200)
    assert.ok(prepared.data.items[0].upload?.uploadUrl)
    assert.equal(prepared.data.items[1].duplicateOfClientId, 'fresh-a')
    assert.equal(prepared.data.items[1].upload, undefined)
    assert.equal(prepared.data.items[2].reusedAssetId, 'sha-image-preflight')
    assert.equal(prepared.data.items[2].upload, undefined)
    assert.ok(prepared.data.items[3].upload?.uploadUrl)
    assert.equal(prepared.data.items[3].reusedAssetId, undefined)
    assert.equal(prepared.data.items[4].reusedAssetId, 'cropped-share-asset')
    assert.ok(prepared.data.items[5].upload?.uploadUrl)
    assert.equal(prepared.data.items[5].duplicateOfClientId, undefined)
    assert.notEqual(prepared.data.items[0].urls.mediumUrl, prepared.data.items[5].urls.mediumUrl)

    const freshTask = prepared.data.items[0]
    const completed = await post('/api/admin/images/upload/complete-batch', {
      items: [{
        clientId: freshTask.clientId,
        imageId: freshTask.task.imageId,
        label: freshTask.task.label,
        mediumUrl: freshTask.urls.mediumUrl,
        originalName: freshTask.task.originalName,
        originalSha256: freshTask.task.originalSha256,
        originalSize: freshTask.task.originalSize,
        originalUrl: freshTask.urls.originalUrl,
        taskId: freshTask.task.id,
        thumbUrl: freshTask.urls.thumbUrl,
        token: freshTask.task.token,
        usage: freshTask.task.usage,
      }],
    }, cookie)
    assert.equal(completed.status, 200)
    assert.equal(completed.data.items[0].item.originalSha256, freshSha256)
    assert.equal(getImageById(freshTask.task.imageId).originalSha256, freshSha256)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
