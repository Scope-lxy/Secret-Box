const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-import-reliability-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase } = require('../src/lib/state-database')
const { withCors } = require('../src/lib/cors')
const { getInternalAdminSettings, updateAdminSettings } = require('../src/modules/admin/admin-settings.store')
const { appendContentItems, getContentItem } = require('../src/modules/content/content.store')
const { encodeCosSignatureComponent, uploadBufferToCos } = require('../src/modules/storage/cos.service')
const { createAppRouter, processAudioUpload, validateAppendedContent, validateImageBatchClientIds } = require('../src/routes')

updateAdminSettings({
  storage: {
    ...getInternalAdminSettings().storage,
    bucket: 'test-bucket-1234567890',
    folderPrefix: 'secretbox',
    region: 'ap-shanghai',
    secretId: 'test-secret-id',
    secretKey: 'test-secret-key',
  },
})

function itemFor(type, index) {
  const id = `reliable-${type}-${index}`
  if (type === 'contentTexts') return { id, label: '批量', text: `文案 ${index}` }
  if (type === 'contentAudios') {
    return {
      id,
      label: '批量',
      title: `音频 ${index}`,
      originalFilename: `${index}.mp3`,
      objectKey: `secretbox/audio/${index}.mp3`,
      audioUrl: `https://example.com/audio/${index}.mp3`,
      contentType: 'audio/mpeg',
      sizeBytes: 1024,
    }
  }
  if (type === 'contentAlbums') return { id, label: '批量', images: [{ id: 'image-ready' }] }
  if (type === 'letters') return { id, label: '批量', content: `心笺 ${index}` }
  return {
    id,
    title: `文章 ${index}`,
    author: `作者 ${index}`,
    bodyMarkdown: `文章正文 ${index}`,
    publishedAt: '2026-08-29T00:00:00.000Z',
  }
}

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('五种内容导入统一限制为每批 200 条', () => {
  for (const type of ['contentTexts', 'contentAudios', 'contentAlbums', 'letters', 'articles']) {
    assert.doesNotThrow(() => validateAppendedContent(type, Array.from({ length: 200 }, (_, index) => itemFor(type, index))))
    assert.throws(
      () => validateAppendedContent(type, Array.from({ length: 201 }, (_, index) => itemFor(type, index))),
      /单次最多导入 200 条内容/,
    )
  }
})

test('导入内容必须有唯一且非空的 ID', () => {
  assert.throws(
    () => validateAppendedContent('letters', [{ ...itemFor('letters', 1), id: '' }]),
    /内容 ID 不能为空/,
  )
  assert.throws(
    () => validateAppendedContent('letters', [itemFor('letters', 1), itemFor('letters', 1)]),
    /重复的内容 ID/,
  )
})

test('图片批次任务 ID 必须合法且唯一', () => {
  assert.deepEqual(
    validateImageBatchClientIds([{ clientId: 'image-a' }, {}], (_item, index) => `fallback-${index}`),
    ['image-a', 'fallback-1'],
  )
  assert.throws(
    () => validateImageBatchClientIds([{ clientId: 'image-a' }, { clientId: 'image-a' }], () => ''),
    /重复的图片上传任务 ID/,
  )
  assert.throws(
    () => validateImageBatchClientIds([{ clientId: 'invalid id' }], () => ''),
    /图片上传任务 ID 无效/,
  )
})

test('图片接口限制每块 100 张，内容接口允许 200 条并拒绝 201 条', async () => {
  const server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const post = async (pathname, body, cookie = '') => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
    return { data: await response.json(), status: response.status, headers: response.headers }
  }
  try {
    const login = await post('/api/admin/login', { account: 'admin', password: '123456' })
    assert.equal(login.status, 200)
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
    const images = Array.from({ length: 101 }, (_, index) => ({
      clientId: `limit-image-${index}`,
      name: `${index}.jpg`,
      size: 1024,
      type: 'image/jpeg',
    }))
    const prepared = await post('/api/admin/images/upload/prepare-batch', { items: images }, cookie)
    assert.equal(prepared.status, 400)
    assert.match(prepared.data.message, /单次最多上传 100 张图片/)

    const completed = await post('/api/admin/images/upload/complete-batch', { items: images }, cookie)
    assert.equal(completed.status, 400)
    assert.match(completed.data.message, /单次最多登记 100 张图片/)

    const content = await post('/api/admin/content/items', {
      type: 'contentTexts',
      items: Array.from({ length: 201 }, (_, index) => itemFor('contentTexts', index)),
    }, cookie)
    assert.equal(content.status, 400)
    assert.match(content.data.message, /单次最多导入 200 条内容/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('五种内容各 200 条可在 SQLite 事务中安全重放', () => {
  for (const type of ['contentTexts', 'contentAudios', 'contentAlbums', 'letters', 'articles']) {
    const poolId = `pool-replay-${type}`
    const items = Array.from({ length: 200 }, (_, index) => itemFor(type, 1000 + index))
    assert.equal(appendContentItems(poolId, type, items), 200)
    assert.equal(appendContentItems(poolId, type, items), 0)
    assert.ok(getContentItem(poolId, type, items[0].id))
    assert.ok(getContentItem(poolId, type, items.at(-1).id))
  }
})

test('同 ID 异内容使整批回滚，不留下前序项目', () => {
  const poolId = 'pool-conflict-atomic'
  const existing = itemFor('letters', 2000)
  const preceding = itemFor('letters', 2001)
  assert.equal(appendContentItems(poolId, 'letters', [existing]), 1)
  assert.throws(
    () => appendContentItems(poolId, 'letters', [preceding, { ...existing, content: '冲突内容' }]),
    /内容 ID 已存在且内容不一致/,
  )
  assert.equal(getContentItem(poolId, 'letters', preceding.id), null)
  assert.equal(getContentItem(poolId, 'letters', existing.id).content, existing.content)
})

test('COS PUT 瞬时 503 自动重试且 403 立即失败', async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async () => {
    calls += 1
    return new Response('', { status: calls === 1 ? 503 : 200 })
  }
  try {
    await uploadBufferToCos({
      buffer: Buffer.from('audio'),
      contentType: 'audio/mpeg',
      key: 'secretbox/audio/retry.mp3',
      retryDelays: [0],
      sleep: async () => {},
    })
    assert.equal(calls, 2)

    calls = 0
    global.fetch = async () => {
      calls += 1
      return new Response('', { status: 403 })
    }
    await assert.rejects(
      uploadBufferToCos({
        buffer: Buffer.from('audio'),
        contentType: 'audio/mpeg',
        key: 'secretbox/audio/forbidden.mp3',
        retryDelays: [0, 0],
        sleep: async () => {},
      }),
      (error) => error.cosStatus === 403,
    )
    assert.equal(calls, 1)
  } finally {
    global.fetch = originalFetch
  }
})

test('COS 签名对图片处理参数中的 RFC 3986 保留字符进行编码', () => {
  assert.equal(
    encodeCosSignatureComponent('imageMogr2/crop/!1280x545r/gravity/center'),
    'imageMogr2%2Fcrop%2F%211280x545r%2Fgravity%2Fcenter',
  )
})

test('相同音频 clientId 重试返回同一 ID 并覆盖同一 COS 对象', async () => {
  const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-import-audio-'))
  const samplePath = path.join(sampleDir, 'sample.mp3')
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1',
    '-c:a', 'libmp3lame', samplePath,
  ])
  assert.equal(generated.status, 0, generated.stderr.toString())

  const originalFetch = global.fetch
  const urls = []
  global.fetch = async (input) => {
    urls.push(String(input))
    return new Response('', { status: 200 })
  }
  try {
    const file = { buffer: fs.readFileSync(samplePath), contentType: 'audio/mpeg', filename: 'sample.mp3' }
    const fields = { clientId: 'content-audio-import-stable-001', durationSeconds: '0.1', label: '批量' }
    const first = await processAudioUpload(file, fields)
    const retry = await processAudioUpload(file, fields)
    assert.deepEqual(retry, first)
    assert.equal(urls.length, 2)
    assert.equal(urls[1], urls[0])
    assert.match(first.objectKey, /^secretbox\/audio\/imports\/[a-f0-9]{32}\.mp3$/)
  } finally {
    global.fetch = originalFetch
    fs.rmSync(sampleDir, { recursive: true, force: true })
  }
})
