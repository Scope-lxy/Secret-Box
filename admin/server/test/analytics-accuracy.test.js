const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-analytics-accuracy-'))
process.env.MINIAPP_DATA_DIR = dataDir
process.env.MINIAPP_DATABASE_FILE = path.join(dataDir, 'secretbox.sqlite')
process.env.NODE_ENV = 'test'

const database = require('../src/lib/state-database')
const { SCHEMA_V6_USER_DATA_TABLES } = require('../src/lib/schema-v6-tables')
const { toBusinessDateKey } = require('../src/lib/business-date')
database.writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'metrics-a',
  contentPools: [{ id: 'metrics-pool', name: '统计验收池' }],
  groups: ['运营组', '空组'],
  miniPrograms: [
    { id: 'metrics-a', name: '统计 A', appId: 'wx7100000000000001', group: '运营组', status: 'active', config: { contentPoolId: 'metrics-pool', dataMode: 'shared' } },
    { id: 'metrics-b', name: '统计 B', appId: 'wx7100000000000002', group: '运营组', status: 'active', config: { contentPoolId: 'metrics-pool', dataMode: 'shared' } },
    { id: 'metrics-c', name: '统计 C', appId: 'wx7100000000000003', status: 'active', config: { contentPoolId: 'metrics-pool', dataMode: 'shared' } },
    { id: 'metrics-archived', name: '已停用', appId: 'wx7100000000000004', status: 'archived', config: { contentPoolId: 'metrics-pool', dataMode: 'shared' } },
  ],
})

const analytics = require('../src/modules/analytics/analytics.store')
const { getAdminBootstrap } = require('../src/modules/admin/admin-config.service')
const { updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { getAccountSummary, syncLogin } = require('../src/modules/auth/account.store')
const { createMiniAppSession } = require('../src/modules/auth/miniapp-session.store')
const { unlockArticle: saveUnlock } = require('../src/modules/content/article-unlock.store')
const { updateArticles, updateContentTexts } = require('../src/modules/content/content.store')
const { getArticleDetail } = require('../src/modules/content/content.service')
const { getDataScope } = require('../src/modules/data-scope/data-scope')
const { createAppRouter } = require('../src/routes')

updateArticles(['a', 'b', 'c'].map((id) => ({
  id: `article-${id}`, title: `文章 ${id}`, bodyMarkdown: `正文 ${id}`, publishedAt: '2026-09-01T00:00:00.000Z',
})), 'metrics-pool')
updateContentTexts(['a', 'b'].map((id) => ({ id: `text-${id}`, label: `手记 ${id}`, text: `手记内容 ${id}` })), 'metrics-pool')

const db = database.getDatabase()
const now = new Date()
const today = toBusinessDateKey(now)
const context = (miniProgramId, visitorId) => ({ miniProgramId, visitorId, accountId: visitorId, authenticated: true })
const zeroMetrics = {
  totalUsers: 0, weeklyActiveUsers: 0, todayVisitors: 0, todayVisits: 0,
  todayCheckins: 0, todayDailyContentOpens: 0, todayArticleOpens: 0, todayMessages: 0,
}
let server
let baseUrl

function insertAccount(accountId, miniProgramIds) {
  const item = { accountId, miniProgramId: miniProgramIds[0], miniProgramIds, visitorId: accountId }
  db.prepare(`INSERT INTO accounts (account_id, unionid, phone, phone_verified, login_synced,
    visitor_id, primary_mini_program_id, created_at, updated_at, item_json)
    VALUES (?, '', '', 0, 0, ?, ?, '2020-01-01T00:00:00.000Z', ?, ?)`)
    .run(accountId, accountId, miniProgramIds[0], now.toISOString(), JSON.stringify(item))
  miniProgramIds.forEach((id) => db.prepare('INSERT INTO account_mini_programs VALUES (?, ?)').run(accountId, id))
}

function event(type, appId, userId, offsetDays = 0, meta = {}) {
  return analytics.recordAnalyticsEvent(type, context(appId, userId), meta, new Date(now.getTime() + offsetDays * 86400000))
}

function scopedMetric(appId) {
  return analytics.buildAnalyticsMetrics({ miniProgramId: appId })
}

function client(appId, accountId) {
  const token = createMiniAppSession({ accountId, miniProgramId: appId }).token
  const appIds = { 'metrics-a': 'wx7100000000000001', 'metrics-b': 'wx7100000000000002' }
  return async (pathname, { method = 'GET', body, key = '' } = {}) => {
    const response = await fetch(`${baseUrl}/api/miniapp${pathname}`, {
      method,
      headers: {
        'content-type': 'application/json', 'x-miniapp-appid': appIds[appId],
        'x-miniapp-session': token, 'x-miniapp-data-scope': getDataScope({ miniProgramId: appId }).dataScopeId,
        ...(key ? { 'x-idempotency-key': `analytics-test-${key}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() }
  }
}

test.before(async () => {
  server = http.createServer(createAppRouter().handle)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.beforeEach(() => {
  db.transaction(() => SCHEMA_V6_USER_DATA_TABLES.forEach((table) => db.prepare(`DELETE FROM ${table}`).run()))()
  for (const id of ['metrics-a', 'metrics-b']) {
    updateMiniProgramConfig(id, {
      dataMode: 'shared', articleDisplay: { hideFullArticle: true }, messagesEnabled: true,
      ads: { articleExpandRewarded: { enabled: true, adUnitId: 'adunit-statistics-test', freeCount: 0 } },
    })
  }
})

test.after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  database.closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('账号总数不依赖近期日志，跨小程序同一账号去重；日周去重与成功次数分开统计', () => {
  insertAccount('shared', ['metrics-a', 'metrics-b'])
  insertAccount('user-a', ['metrics-a'])
  insertAccount('user-b', ['metrics-b'])
  insertAccount('old-inactive', ['metrics-a'])
  event('page_view', 'metrics-a', 'shared')
  event('page_view', 'metrics-a', 'shared')
  event('page_view', 'metrics-b', 'shared')
  event('page_view', 'metrics-a', 'user-a')
  event('page_view', 'metrics-a', 'user-a', -1)
  event('page_view', 'metrics-b', 'user-b', -6)
  event('page_view', 'metrics-b', 'outside-week', -7)
  event('page_view', 'metrics-b', 'future', 1)
  for (const id of ['metrics-a', 'metrics-b']) event('check_in', id, 'shared')
  for (const id of ['a', 'a', 'b']) event('daily_content_open', 'metrics-a', 'shared', 0, { dailyContentId: id })
  event('daily_content_open', 'metrics-b', 'shared', 0, { dailyContentId: 'a' })
  for (const status of ['saved', 'saved', 'blocked', 'failed']) event('message_create', 'metrics-a', 'shared', 0, { status })
  for (const id of ['a', 'a', 'b', 'c']) saveUnlock(context('metrics-a', 'shared'), `article-${id}`, now)
  saveUnlock(context('metrics-b', 'shared'), 'article-a', now)
  const metrics = analytics.buildAnalyticsMetrics({ miniProgramIds: ['metrics-a', 'metrics-b'], filterMiniProgramIds: true })
  assert.deepEqual(metrics, {
    totalUsers: 4, weeklyActiveUsers: 3, todayVisitors: 2, todayVisits: 4,
    todayCheckins: 2, todayDailyContentOpens: 4, todayArticleOpens: 4, todayMessages: 2,
  })
  assert.equal(scopedMetric('metrics-a').totalUsers, 3)
  assert.equal(scopedMetric('metrics-b').totalUsers, 2)
  const trend = analytics.buildDailyVisitTrend({ miniProgramIds: ['metrics-a', 'metrics-b'], days: 15, baseDate: now })
  assert.deepEqual(trend.at(-1), {
    date: today, label: trend.at(-1).label, visits: 4, visitors: 2, checkins: 2, dailyContentOpens: 4, articleOpens: 4,
  })
})

test('空分组所有指标及 15 日趋势均为零，不回落全局；全部与分组趋势和卡片范围一致', () => {
  insertAccount('shared', ['metrics-a', 'metrics-b'])
  insertAccount('ungrouped', ['metrics-c'])
  insertAccount('archived-user', ['metrics-archived'])
  event('page_view', 'metrics-a', 'shared')
  event('page_view', 'metrics-b', 'shared')
  event('page_view', 'metrics-c', 'ungrouped')
  event('page_view', 'metrics-archived', 'archived-user')
  saveUnlock(context('metrics-a', 'shared'), 'article-a', now)
  assert.deepEqual(analytics.buildAnalyticsMetrics({ miniProgramIds: [], filterMiniProgramIds: true }), zeroMetrics)
  const emptyTrend = analytics.buildDailyVisitTrend({ miniProgramIds: [], filterMiniProgramIds: true, days: 15 })
  assert.equal(emptyTrend.length, 15)
  assert.ok(emptyTrend.every((row) => [row.visits, row.visitors, row.checkins, row.dailyContentOpens, row.articleOpens].every((n) => n === 0)))
  const empty = getAdminBootstrap({ groupId: '空组' })
  assert.ok(empty.dashboardCards.every((metric) => metric.value === '0'))
  assert.ok(empty.currentVisitTrend.every((row) => row.visits === 0 && row.articleOpens === 0))
  const all = getAdminBootstrap()
  const grouped = getAdminBootstrap({ groupId: '运营组' })
  assert.equal(all.dashboardCards[0].value, '2')
  assert.equal(all.dashboardCards[3].value, '3')
  assert.equal(all.currentVisitTrend.at(-1).visits, 3)
  assert.equal(grouped.dashboardCards[0].value, '1')
  assert.equal(grouped.dashboardCards[3].value, '2')
  assert.equal(grouped.currentVisitTrend.at(-1).visits, 2)
  assert.deepEqual(all.editableSections, grouped.editableSections)
  const removed = getAdminBootstrap({ groupId: '已被其他窗口删除的分组' })
  assert.equal(removed.selectedGroup, '')
  assert.deepEqual(removed.dashboardCards, all.dashboardCards)
  assert.deepEqual(removed.currentVisitTrend, all.currentVisitTrend)
})

test('真实接口只把成功展开全文计入打开文章，重复返回同篇不增，新文章和跨实例成功提供全文各计一次', async () => {
  insertAccount('reader', ['metrics-a', 'metrics-b'])
  const a = client('metrics-a', 'reader')
  const b = client('metrics-b', 'reader')
  assert.equal((await a('/articles/article-a')).data.unlockedToday, false)
  assert.equal((await a('/articles/article-a/open', { method: 'POST', body: {}, key: 'open-article-before-unlock' })).status, 201)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 0)
  assert.equal((await a('/articles/missing/unlock', { method: 'POST', body: {} })).status, 400)
  assert.equal((await a('/articles/article-a/unlock', { method: 'POST', body: {} })).status, 400)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 0)
  for (const id of ['a', 'a', 'a', 'b', 'c']) {
    assert.equal((await a(`/articles/article-${id}/unlock`, { method: 'POST', body: { rewarded: true } })).status, 200)
  }
  for (let i = 0; i < 3; i += 1) assert.equal((await a('/articles/article-a')).data.unlockedToday, true)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 3)
  assert.equal((await b('/articles/article-a')).data.unlockedToday, true)
  assert.equal((await b('/articles/article-a')).status, 200)
  assert.equal(scopedMetric('metrics-b').todayArticleOpens, 1)
  assert.equal(analytics.buildAnalyticsMetrics().todayArticleOpens, 4)
})

test('无需展开按钮的全文展示按成功提供全文计数，目录、预览和重复访问不多计', () => {
  insertAccount('reader', ['metrics-a'])
  const reader = context('metrics-a', 'reader')
  assert.equal(getArticleDetail(reader, 'article-a').unlockedToday, false)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 0)
  updateMiniProgramConfig('metrics-a', { articleDisplay: { hideFullArticle: false } })
  assert.ok(getArticleDetail(reader, 'article-a').article.bodyHtml)
  assert.ok(getArticleDetail(reader, 'article-a').article.bodyHtml)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM article_unlocks').get().count, 0)
})

test('真实打卡、手记和留言接口排除失败与幂等重试，新的成功手记操作继续按次计数', async () => {
  insertAccount('operator', ['metrics-a'])
  const a = client('metrics-a', 'operator')
  const check = { method: 'POST', body: {}, key: 'check-success-and-retry' }
  assert.equal((await a('/check-in', check)).status, 201)
  assert.equal((await a('/check-in', check)).status, 201)
  assert.equal((await a('/check-in', { ...check, key: 'check-again' })).status, 400)
  for (const [index, id] of ['a', 'a', 'b'].entries()) {
    const result = await a('/daily-content/open', { method: 'POST', body: { type: 'text', contentId: `text-${id}` }, key: `daily-${index}` })
    assert.equal(result.status, 201, result.data.message)
  }
  assert.equal((await a('/daily-content/open', { method: 'POST', body: { type: 'text', contentId: 'text-a' }, key: 'daily-0' })).status, 201)
  assert.equal((await a('/daily-content/open', { method: 'POST', body: { type: 'text', contentId: 'missing' }, key: 'daily-failed' })).status, 400)
  const message = { method: 'POST', body: { source: 'article', sourceId: 'article-a', content: '愿你今天开心' }, key: 'message-success' }
  assert.equal((await a('/messages', message)).status, 201)
  assert.equal((await a('/messages', message)).status, 201)
  assert.equal((await a('/messages', { ...message, body: { ...message.body, content: '广告' }, key: 'message-blocked' })).status, 400)
  assert.equal(scopedMetric('metrics-a').todayCheckins, 1)
  assert.equal(scopedMetric('metrics-a').todayDailyContentOpens, 3)
  assert.equal(scopedMetric('metrics-a').todayMessages, 1)
})

test('模式迁移复制解锁状态不会翻倍，旧记录与新运营事件合并后仍按实例和每日去重', () => {
  insertAccount('reader', ['metrics-a'])
  updateMiniProgramConfig('metrics-a', { dataMode: 'independent' })
  saveUnlock(context('metrics-a', 'reader'), 'article-a', now)
  db.prepare("DELETE FROM analytics_events WHERE event_type = 'article_unlock'").run()
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 1)
  updateMiniProgramConfig('metrics-a', { dataMode: 'shared' })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM article_unlocks').get().count, 2)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 1)
  getArticleDetail(context('metrics-a', 'reader'), 'article-a')
  updateMiniProgramConfig('metrics-a', { dataMode: 'independent' })
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 1)
  assert.equal(analytics.buildDailyVisitTrend({ miniProgramId: 'metrics-a', days: 1 }).at(-1).articleOpens, 1)
})

test('账号合并重算同日文章与用户人数，合并后重复解锁仍只计一次', () => {
  const target = syncLogin({ miniProgramId: 'metrics-a', visitorId: 'target-device' }, { openid: 'target-openid', unionid: 'same-union' })
  const source = getAccountSummary({ miniProgramId: 'metrics-a', visitorId: 'source-device' })
  saveUnlock(context('metrics-a', target.accountId), 'article-a', now)
  saveUnlock(context('metrics-a', source.accountId), 'article-a', now)
  analytics.recordPageView(context('metrics-a', target.accountId), 'home')
  analytics.recordPageView(context('metrics-a', source.accountId), 'home')
  assert.equal(scopedMetric('metrics-a').totalUsers, 2)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 2)
  const merged = syncLogin(context('metrics-a', source.accountId), { openid: 'source-openid', unionid: 'same-union' })
  assert.equal(merged.accountId, target.accountId)
  saveUnlock(context('metrics-a', merged.accountId), 'article-a', now)
  assert.equal(scopedMetric('metrics-a').totalUsers, 1)
  assert.equal(scopedMetric('metrics-a').todayVisitors, 1)
  assert.equal(scopedMetric('metrics-a').todayArticleOpens, 1)
})

test('成功事件写入失败时解锁状态一起回滚', () => {
  insertAccount('reader', ['metrics-a'])
  db.exec("CREATE TRIGGER fail_article_analytics BEFORE INSERT ON analytics_events WHEN NEW.event_type = 'article_unlock' BEGIN SELECT RAISE(ABORT, 'injected analytics failure'); END")
  try {
    assert.throws(() => saveUnlock(context('metrics-a', 'reader'), 'article-a', now), /injected analytics failure/)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM article_unlocks').get().count, 0)
    assert.equal(scopedMetric('metrics-a').todayArticleOpens, 0)
  } finally {
    db.exec('DROP TRIGGER fail_article_analytics')
  }
})

test('北京时间日期与星期不受服务端时区影响，午夜两侧的首页和文章分别计入两天', (t) => {
  insertAccount('reader', ['metrics-a'])
  const reader = context('metrics-a', 'reader')
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T15:59:50.000Z') })
  analytics.recordPageView(reader, 'home')
  saveUnlock(reader, 'article-a')
  t.mock.timers.setTime(new Date('2026-09-01T16:00:10.000Z').getTime())
  analytics.recordPageView(reader, 'home')
  saveUnlock(reader, 'article-a')
  const previousTz = process.env.TZ
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
      process.env.TZ = tz
      const trend = analytics.buildDailyVisitTrend({ miniProgramId: 'metrics-a', days: 2, baseDate: new Date() })
      assert.deepEqual(trend.map(({ date, label, visits, articleOpens }) => ({ date, label, visits, articleOpens })), [
        { date: '2026-09-01', label: '周二', visits: 1, articleOpens: 1 },
        { date: '2026-09-02', label: '周三', visits: 1, articleOpens: 1 },
      ])
      assert.equal(analytics.buildAnalyticsMetrics({ miniProgramId: 'metrics-a', today: '2026-09-02' }).weeklyActiveUsers, 1)
    }
  } finally {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
    t.mock.timers.reset()
  }
})

test('复用登录复核统计任意入口，首页并发请求和登录重试合并为一次访问', async () => {
  const headers = {
    'content-type': 'application/json',
    'x-miniapp-appid': 'wx7100000000000001',
    'x-visitor-id': 'foreground-visitor',
    'x-miniapp-data-scope': getDataScope({ miniProgramId: 'metrics-a' }).dataScopeId,
  }
  async function login() {
    const response = await fetch(`${baseUrl}/api/miniapp/session`, {
      method: 'POST', headers, body: JSON.stringify({ code: 'visit-test' }),
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  const session = await login()
  assert.equal(scopedMetric('metrics-a').todayVisitors, 1)
  assert.equal(scopedMetric('metrics-a').weeklyActiveUsers, 1)
  assert.equal(scopedMetric('metrics-a').todayVisits, 1)
  const home = await fetch(`${baseUrl}/api/miniapp/home`, {
    headers: { ...headers, 'x-miniapp-session': session.sessionToken },
  })
  assert.equal(home.status, 200)
  await home.json()
  await login()
  assert.equal(scopedMetric('metrics-a').todayVisits, 1)

  db.prepare("UPDATE analytics_events SET created_at = ? WHERE event_type = 'page_view'")
    .run(new Date(Date.now() - 61000).toISOString())
  await login()
  assert.equal(scopedMetric('metrics-a').todayVisits, 2)
  assert.equal(scopedMetric('metrics-a').todayVisitors, 1)
  assert.equal(scopedMetric('metrics-b').todayVisits, 0)
})
