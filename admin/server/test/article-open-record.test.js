const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-article-open-'))
process.env.MINIAPP_DATA_DIR = dataDir

const database = require('../src/lib/state-database')
database.writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'article-open-app',
  contentPools: [{ id: 'article-open-pool', name: '文章打开记录池' }],
  miniPrograms: [{
    id: 'article-open-app',
    name: '文章打开记录应用',
    appId: 'wx7000000000000201',
    status: 'active',
    config: { contentPoolId: 'article-open-pool', dataMode: 'shared' },
  }],
})

const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')
const { updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { buildAnalyticsMetrics, countEvents } = require('../src/modules/analytics/analytics.store')
const { getDataScope } = require('../src/modules/data-scope/data-scope')
const { updateArticles } = require('../src/modules/content/content.store')
const { updateImages } = require('../src/modules/images/image.store')

updateImages([{
  id: 'article-open-cover',
  thumbUrl: 'https://cdn.scopeview.cn/article-open-thumb.jpg',
  mediumUrl: 'https://cdn.scopeview.cn/article-open-medium.jpg',
}])

updateMiniProgramConfig('article-open-app', {
  ads: {
    homeDailyContentRewarded: {
      adUnitId: 'adunit-article-open-daily-quota',
      enabled: true,
      freeCount: 2,
    },
  },
})

updateArticles([
  {
    id: 'article-open-target',
    title: '应进入打开记录的文章标题',
    bodyMarkdown: '这是文章正文。',
    coverImage: { id: 'article-open-cover' },
    publishedAt: '2026-09-01T08:00:00.000Z',
  },
  {
    id: 'article-open-spare',
    title: '用于保留内容池的文章',
    bodyMarkdown: '这是另一篇文章。',
    publishedAt: '2026-08-31T08:00:00.000Z',
  },
], 'article-open-pool')

let baseUrl
let server
let sessionToken

function headers(extra = {}) {
  return {
    'content-type': 'application/json',
    'x-miniapp-appid': 'wx7000000000000201',
    'x-miniapp-data-scope': getDataScope({ miniProgramId: 'article-open-app' }).dataScopeId,
    'x-miniapp-session': sessionToken,
    'x-visitor-id': 'article-open-visitor',
    ...extra,
  }
}

async function request(pathname, { method = 'GET', body, extraHeaders } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: headers(extraHeaders),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: await response.json() }
}

test.before(async () => {
  server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${baseUrl}/api/miniapp/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-miniapp-appid': 'wx7000000000000201',
      'x-miniapp-data-scope': getDataScope({ miniProgramId: 'article-open-app' }).dataScopeId,
      'x-visitor-id': 'article-open-visitor',
    },
    body: JSON.stringify({ code: 'development-test-code' }),
  })
  const data = await response.json()
  assert.equal(response.status, 200)
  sessionToken = data.sessionToken
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  database.closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('文章打开动作幂等写入打开记录，并进入我的与互动记录接口', async () => {
  const dailyAccessBefore = await request('/api/miniapp/rewarded-ad-access', {
    method: 'POST',
    body: { placement: 'daily_content' },
  })
  assert.deepEqual(dailyAccessBefore.data, { free: true, freeCount: 2, usedCount: 0 })

  const detail = await request('/api/miniapp/articles/article-open-target')
  assert.equal(detail.status, 200)
  assert.equal(database.getDatabase().prepare("SELECT COUNT(*) AS count FROM opened_records WHERE source = 'article'").get().count, 0)

  const idempotencyKey = 'article_open_record_20260901'
  const first = await request('/api/miniapp/articles/article-open-target/open', {
    method: 'POST',
    body: {},
    extraHeaders: { 'x-idempotency-key': idempotencyKey },
  })
  const replay = await request('/api/miniapp/articles/article-open-target/open', {
    method: 'POST',
    body: {},
    extraHeaders: { 'x-idempotency-key': idempotencyKey },
  })
  assert.equal(first.status, 201)
  assert.equal(replay.status, 201)
  assert.equal(replay.data.openedId, first.data.openedId)

  const repeatWithNewRequest = await request('/api/miniapp/articles/article-open-target/open', {
    method: 'POST',
    body: {},
    extraHeaders: { 'x-idempotency-key': `${idempotencyKey}_after_refresh` },
  })
  assert.equal(repeatWithNewRequest.status, 201)
  assert.equal(repeatWithNewRequest.data.openedId, first.data.openedId)

  const openedRows = database.getDatabase().prepare(`
    SELECT source, source_id, item_json FROM opened_records WHERE source = 'article'
  `).all()
  assert.equal(openedRows.length, 1)
  assert.equal(openedRows[0].source_id, 'article-open-target')
  const openedItem = JSON.parse(openedRows[0].item_json)
  assert.equal(openedItem.type, 'article')
  assert.equal(openedItem.title, '应进入打开记录的文章标题')
  assert.equal(openedItem.preview, '应进入打开记录的文章标题')
  assert.equal(countEvents('daily_content_open', {
    miniProgramId: 'article-open-app',
    visitorId: openedItem.visitorId,
  }), 0)

  const dailyAccessAfter = await request('/api/miniapp/rewarded-ad-access', {
    method: 'POST',
    body: { placement: 'daily_content' },
  })
  assert.deepEqual(dailyAccessAfter.data, dailyAccessBefore.data)

  const shared = await request('/api/miniapp/interactions/share', {
    method: 'POST',
    body: { source: 'article', sourceId: 'article-open-target' },
  })
  assert.equal(shared.status, 201)

  const activity = await request('/api/miniapp/activity')
  assert.equal(activity.status, 200)
  assert.deepEqual(activity.data.totalOpened[0].coverImage, {
    id: 'article-open-cover',
    mediumUrl: 'https://cdn.scopeview.cn/article-open-medium.jpg',
    originalUrl: '',
    status: 'ready',
    thumbUrl: 'https://cdn.scopeview.cn/article-open-thumb.jpg',
  })
  assert.deepEqual(activity.data.totalOpened.map((item) => ({
    preview: item.preview,
    source: item.source,
    sourceId: item.sourceId,
    type: item.type,
  })), [{
    preview: '应进入打开记录的文章标题',
    source: 'article',
    sourceId: 'article-open-target',
    type: 'article',
  }])
  assert.equal(activity.data.interactions[0].preview, '应进入打开记录的文章标题')
  assert.equal(activity.data.interactions[0].source, 'article')
  assert.equal(activity.data.interactions[0].sourceId, 'article-open-target')
  assert.equal(activity.data.interactions[0].actions[0], '分享')
  assert.equal(activity.data.interactions[0].coverImage.thumbUrl, 'https://cdn.scopeview.cn/article-open-thumb.jpg')

  const profile = await request('/api/miniapp/profile')
  assert.equal(profile.status, 200)
  assert.equal(Object.prototype.hasOwnProperty.call(profile.data, 'histories'), false)
})

test('文章详情必须使用有效会话，不能伪造访客 ID 读取解锁正文', async () => {
  const response = await fetch(`${baseUrl}/api/miniapp/articles/article-open-target`, {
    headers: {
      'x-miniapp-appid': 'wx7000000000000201',
      'x-miniapp-data-scope': getDataScope({ miniProgramId: 'article-open-app' }).dataScopeId,
      'x-visitor-id': 'article-open-visitor',
    },
  })
  assert.equal(response.status, 401)
})

test('文章解锁拒绝已过期的数据范围', async () => {
  const oldScope = getDataScope({ miniProgramId: 'article-open-app' }).dataScopeId
  updateMiniProgramConfig('article-open-app', { dataMode: 'independent' })
  const stale = await request('/api/miniapp/articles/article-open-target/unlock', {
    method: 'POST',
    body: {},
    extraHeaders: { 'x-miniapp-data-scope': oldScope },
  })
  assert.equal(stale.status, 409)
  updateMiniProgramConfig('article-open-app', { dataMode: 'shared' })
})

test('文章解锁在广告额度用尽后要求广告完成标记', async () => {
  updateMiniProgramConfig('article-open-app', {
    ads: {
      articleExpandRewarded: { enabled: true, adUnitId: 'adunit-article-expand', freeCount: 1 },
    },
  })
  const freeUnlock = await request('/api/miniapp/articles/article-open-target/unlock', { method: 'POST', body: {} })
  assert.equal(freeUnlock.status, 200)
  const repeatedFreeUnlock = await request('/api/miniapp/articles/article-open-target/unlock', { method: 'POST', body: {} })
  assert.equal(repeatedFreeUnlock.status, 200)

  const blocked = await request('/api/miniapp/articles/article-open-spare/unlock', { method: 'POST', body: {} })
  assert.equal(blocked.status, 400)

  const rewarded = await request('/api/miniapp/articles/article-open-spare/unlock', {
    method: 'POST',
    body: { rewarded: true },
  })
  assert.equal(rewarded.status, 200)
  assert.equal(buildAnalyticsMetrics({ miniProgramId: 'article-open-app' }).todayArticleOpens, 2)
})
