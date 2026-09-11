const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-admin-batch-delete-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase } = require('../src/lib/state-database')
const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')
const { appendContentItems, getContentTypePage } = require('../src/modules/content/content.store')
const { addImageAssets } = require('../src/modules/images/image.store')
const { getInternalAdminSettings, updateAdminSettings } = require('../src/modules/admin/admin-settings.store')

let server
let baseUrl

async function request(pathname, { method = 'GET', body, cookie = '' } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, data: await response.json(), headers: response.headers }
}

async function login() {
  const response = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(response.status, 200)
  return response.headers.get('set-cookie')
}

test.before(async () => {
  server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('批量删除路由校验登录、成功删除并记录审计', async () => {
  const unauthenticated = await request('/api/admin/content/batch-delete', {
    method: 'POST',
    body: { type: 'letters', itemIds: ['unauthenticated-item'] },
  })
  assert.equal(unauthenticated.status, 401)

  const poolId = getInternalAdminSettings().contentPools[0].id
  appendContentItems(poolId, 'letters', [
    { id: 'http-batch-letter-1', content: '一', label: 'HTTP' },
    { id: 'http-batch-letter-2', content: '二', label: 'HTTP' },
    { id: 'http-batch-letter-3', content: '三', label: 'HTTP' },
  ])
  const cookie = await login()
  const deleted = await request('/api/admin/content/batch-delete', {
    method: 'POST',
    cookie,
    body: { poolId, type: 'letters', itemIds: ['http-batch-letter-1', 'http-batch-letter-1', 'http-batch-letter-2'] },
  })
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.data.ids, ['http-batch-letter-1', 'http-batch-letter-2'])
  assert.equal(getContentTypePage(poolId, 'letters').items.some((item) => item.id === 'http-batch-letter-1'), false)
  assert.match(getInternalAdminSettings().operationLogs[0].description, /批量删除 2 条心笺/)
})

test('批量删除路由限制 100 条且所有预校验失败都不部分删除', async () => {
  const poolId = getInternalAdminSettings().contentPools[0].id
  const cookie = await login()
  const tooMany = await request('/api/admin/content/batch-delete', {
    method: 'POST',
    cookie,
    body: { poolId, type: 'letters', itemIds: Array.from({ length: 101 }, (_, index) => `too-many-${index}`) },
  })
  assert.equal(tooMany.status, 400)

  appendContentItems(poolId, 'letters', [
    { id: 'http-batch-letter-4', content: '四', label: 'HTTP' },
    { id: 'http-batch-letter-5', content: '五', label: 'HTTP' },
  ])
  const beforeMinimum = getContentTypePage(poolId, 'letters').total
  const minimumRejected = await request('/api/admin/content/batch-delete', {
    method: 'POST',
    cookie,
    body: { poolId, type: 'letters', itemIds: ['http-batch-letter-3', 'http-batch-letter-4', 'http-batch-letter-5'] },
  })
  assert.equal(minimumRejected.status, 400)
  assert.equal(getContentTypePage(poolId, 'letters').total, beforeMinimum)

  const missingRejected = await request('/api/admin/content/batch-delete', {
    method: 'POST',
    cookie,
    body: { poolId, type: 'letters', itemIds: ['http-batch-letter-3', 'missing-http-letter'] },
  })
  assert.equal(missingRejected.status, 400)
  assert.equal(getContentTypePage(poolId, 'letters').items.some((item) => item.id === 'http-batch-letter-3'), true)
})

test('显式无效内容池不会回退并删除当前绑定池', async () => {
  const poolId = getInternalAdminSettings().contentPools[0].id
  const cookie = await login()
  appendContentItems(poolId, 'letters', [{ id: 'invalid-pool-sentinel', content: '保留', label: 'HTTP' }])
  const response = await request('/api/admin/content/batch-delete', {
    method: 'POST',
    cookie,
    body: { poolId: 'missing-content-pool', type: 'letters', itemIds: ['invalid-pool-sentinel'] },
  })
  assert.equal(response.status, 400)
  assert.equal(getContentTypePage(poolId, 'letters').items.some((item) => item.id === 'invalid-pool-sentinel'), true)
})

test('图片回收失败仍返回真实删除结果和清理告警', async () => {
  const poolId = getInternalAdminSettings().contentPools[0].id
  const cookie = await login()
  updateAdminSettings({ storage: {
    bucket: 'cleanup-warning-bucket',
    region: 'ap-shanghai',
    url: 'https://cleanup-warning-bucket.cos.ap-shanghai.myqcloud.com',
  } })
  addImageAssets([{ id: 'cleanup-warning-image', originalUrl: 'https://cleanup-warning-bucket.cos.ap-shanghai.myqcloud.com/original.jpg', mediumUrl: 'https://cleanup-warning-bucket.cos.ap-shanghai.myqcloud.com/medium.jpg', thumbUrl: 'https://cleanup-warning-bucket.cos.ap-shanghai.myqcloud.com/thumb.jpg' }])
  appendContentItems(poolId, 'contentAlbums', [{ id: 'cleanup-warning-album', type: 'album', images: [{ id: 'cleanup-warning-image' }] }])
  const response = await request('/api/admin/content/batch-delete', {
    method: 'POST',
    cookie,
    body: { poolId, type: 'contentAlbums', itemIds: ['cleanup-warning-album'] },
  })
  assert.equal(response.status, 200)
  assert.match(response.data.cleanupWarning, /COS 配置缺少/)
  assert.equal(getContentTypePage(poolId, 'contentAlbums').items.some((item) => item.id === 'cleanup-warning-album'), false)
})
