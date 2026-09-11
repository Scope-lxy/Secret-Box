const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-transaction-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [{ id: 'pool-1', name: '测试内容池' }],
  miniPrograms: [
    {
      id: 'mp1',
      name: '测试小程序',
      appId: 'wx03d0fa4e3c10441d',
      status: 'active',
      config: { contentPoolId: 'pool-1' },
    },
    {
      id: 'mp-merge-rollback',
      name: '账号合并回滚测试',
      appId: 'wx7000000000000201',
      status: 'active',
      config: { contentPoolId: 'pool-1', dataMode: 'independent' },
    },
    {
      id: 'mp-delete-rollback',
      name: '账号删除回滚测试',
      appId: 'wx7000000000000202',
      status: 'active',
      config: { contentPoolId: 'pool-1', dataMode: 'independent' },
    },
  ],
  operationLogs: [],
})

const { serverError } = require('../src/lib/response')
const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')
const { syncLogin, getAccountById, getAccountSummary } = require('../src/modules/auth/account.store')
const { deleteAccountForMiniProgram } = require('../src/modules/auth/account-deletion.service')
const { getMiniProgramRuntimeConfig, updateCurrentMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { recordAnalyticsEvent } = require('../src/modules/analytics/analytics.store')
const { getContentItem, updateContentAlbums, updateContentTexts } = require('../src/modules/content/content.store')
const { updateImages } = require('../src/modules/images/image.store')
const { getOpened, recordOpened } = require('../src/modules/interactions/interaction.store')
const { createMessage } = require('../src/modules/messages/message.store')
const {
  clearAuthenticatedApiRateLimit,
  consumeAuthenticatedApiRequest,
} = require('../src/modules/auth/authenticated-api-rate-limit')

const contentFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'content.json'), 'utf8'))
updateImages(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'images.json'), 'utf8')).items)
updateContentTexts(contentFixture.contentTexts, 'pool-1')
updateContentAlbums(contentFixture.contentAlbums, 'pool-1')

test('high-cost mini-program operations are limited per account, source IP, and route', () => {
  const accountId = 'rate-limit-account'
  const ip = '203.0.113.101'
  const route = 'avatar'
  clearAuthenticatedApiRateLimit(accountId, ip, route)
  for (let index = 0; index < 5; index += 1) {
    assert.equal(consumeAuthenticatedApiRequest(accountId, ip, route, 1000), 0)
  }
  assert.equal(consumeAuthenticatedApiRequest(accountId, ip, route, 1000), 60)
  assert.equal(consumeAuthenticatedApiRequest('another-account', ip, route, 1000), 0)
  assert.equal(consumeAuthenticatedApiRequest(accountId, '203.0.113.102', route, 1000), 60)
  clearAuthenticatedApiRateLimit(accountId, ip, route)
})

test('article unlock requests have an effective authenticated rate limit', () => {
  const accountId = 'article-unlock-rate-limit-account'
  const ip = '203.0.113.110'
  const route = 'article_unlock'
  clearAuthenticatedApiRateLimit(accountId, ip, route)
  for (let index = 0; index < 20; index += 1) {
    assert.equal(consumeAuthenticatedApiRequest(accountId, ip, route, 1000), 0)
  }
  assert.equal(consumeAuthenticatedApiRequest(accountId, ip, route, 1000), 60)
  clearAuthenticatedApiRateLimit(accountId, ip, route)
})

test('first WeChat login claims an anonymous account without losing its identity', () => {
  const context = { miniProgramId: 'mp1', visitorId: 'first-login-device' }
  const anonymous = getAccountSummary(context)
  const loggedIn = syncLogin(context, { openid: 'first-login-openid' })
  assert.equal(loggedIn.accountId, anonymous.accountId)
  assert.deepEqual(loggedIn.wechatIdentities, [{ miniProgramId: 'mp1', openid: 'first-login-openid' }])
})

test('an unseen WeChat openid on the same device receives a separate account', () => {
  const context = { miniProgramId: 'mp1', visitorId: 'shared-login-device' }
  const first = syncLogin(context, { openid: 'shared-device-openid-a' })
  const second = syncLogin(context, { openid: 'shared-device-openid-b' })
  assert.notEqual(second.accountId, first.accountId)
  assert.deepEqual(getAccountById(first.accountId, 'mp1').wechatIdentities, [
    { miniProgramId: 'mp1', openid: 'shared-device-openid-a' },
  ])
  assert.deepEqual(second.wechatIdentities, [
    { miniProgramId: 'mp1', openid: 'shared-device-openid-b' },
  ])
})

test('switching WeChat accounts with an old session does not merge account data', () => {
  const first = syncLogin({ miniProgramId: 'mp1', visitorId: 'session-switch-device' }, {
    openid: 'session-switch-openid-a',
  })
  const second = syncLogin({
    accountId: first.accountId,
    miniProgramId: 'mp1',
    visitorId: first.accountId,
  }, {
    openid: 'session-switch-openid-b',
  })
  assert.notEqual(second.accountId, first.accountId)
  assert.ok(getAccountById(first.accountId, 'mp1'))
})

test('unexpected server errors expose a request ID but never the underlying failure', () => {
  const response = {
    end(body) { this.body = JSON.parse(body) },
    writeHead(status, headers) { this.status = status; this.headers = headers },
  }
  serverError(response, new Error('database password leaked'), 'req-test-001')
  assert.equal(response.status, 500)
  assert.equal(response.body.message, '服务暂时不可用，请稍后重试')
  assert.equal(response.body.requestId, 'req-test-001')
  assert.equal(response.headers['x-request-id'], 'req-test-001')
})

test('account merge rolls back every moved record when a later account write fails', () => {
  const miniProgramId = 'mp-merge-rollback'
  const source = syncLogin({ miniProgramId, visitorId: 'merge-source' }, { openid: 'merge-source-openid' })
  const target = syncLogin({ miniProgramId, visitorId: 'merge-target' }, {
    openid: 'merge-target-openid',
    unionid: 'merge-target-unionid',
  })
  const sourceContext = { accountId: source.accountId, miniProgramId, visitorId: source.accountId }
  recordAnalyticsEvent('merge_rollback_probe', sourceContext)
  recordOpened(sourceContext, 'daily_content', { id: 'merge-rollback-box', text: '事务回滚', type: 'text' })
  const db = getDatabase()
  db.exec(`
    CREATE TRIGGER abort_merge_target_update
    BEFORE UPDATE ON accounts WHEN NEW.account_id = '${target.accountId}'
    BEGIN SELECT RAISE(ABORT, 'forced merge rollback'); END;
  `)
  try {
    assert.throws(
      () => syncLogin({ accountId: source.accountId, miniProgramId, visitorId: source.accountId }, {
        openid: 'merge-source-openid',
        unionid: 'merge-target-unionid',
      }),
      /forced merge rollback/,
    )
    assert.ok(getAccountById(source.accountId, miniProgramId))
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM analytics_events WHERE visitor_id = ?').get(source.accountId).count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM analytics_events WHERE visitor_id = ?').get(target.accountId).count, 0)
    assert.equal(getOpened(sourceContext).length, 1)
  } finally {
    db.exec('DROP TRIGGER abort_merge_target_update')
  }
})

test('account merge deduplicates opened records with the same content', () => {
  const miniProgramId = 'mp1'
  const source = syncLogin({ miniProgramId, visitorId: 'merge-open-source' }, { openid: 'merge-open-source' })
  const target = syncLogin({ miniProgramId, visitorId: 'merge-open-target' }, {
    openid: 'merge-open-target',
    unionid: 'merge-open-unionid',
  })
  recordOpened({ miniProgramId, visitorId: target.accountId }, 'daily_content', {
    id: 'merge-duplicate-content', type: 'text', text: 'target copy', createdAt: '2026-01-01T00:00:00.000Z',
  })
  recordOpened({ miniProgramId, visitorId: source.accountId }, 'daily_content', {
    id: 'merge-duplicate-content', type: 'text', text: 'source copy', createdAt: '2026-01-02T00:00:00.000Z',
  })
  const merged = syncLogin({ accountId: source.accountId, miniProgramId, visitorId: source.accountId }, {
    openid: 'merge-open-source', unionid: 'merge-open-unionid',
  })
  assert.equal(merged.accountId, target.accountId)
  const rows = getOpened({ miniProgramId, visitorId: target.accountId })
    .filter((item) => item.sourceId === 'merge-duplicate-content')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].preview, 'source copy')
})

test('manual account deletion rolls back all prior removals when the account row cannot be deleted', async () => {
  const miniProgramId = 'mp-delete-rollback'
  const account = syncLogin({ miniProgramId, visitorId: 'delete-source' }, { openid: 'delete-source-openid' })
  const context = { accountId: account.accountId, miniProgramId, visitorId: account.accountId }
  const message = createMessage({
    accountId: account.accountId,
    content: '事务回滚留言',
    miniProgramId,
    source: 'letters',
    sourceId: 'delete-rollback-letter',
    visitorId: account.accountId,
  })
  recordOpened(context, 'daily_content', { id: 'delete-rollback-box', text: '事务回滚', type: 'text' })
  const db = getDatabase()
  db.exec(`
    CREATE TRIGGER abort_account_delete
    BEFORE DELETE ON accounts WHEN OLD.account_id = '${account.accountId}'
    BEGIN SELECT RAISE(ABORT, 'forced delete rollback'); END;
  `)
  try {
    await assert.rejects(
      deleteAccountForMiniProgram({ accountId: account.accountId, miniProgramId }),
      /forced delete rollback/,
    )
    assert.ok(getAccountById(account.accountId, miniProgramId))
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE message_id = ?').get(message.id).count, 1)
    assert.equal(getOpened(context).length, 1)
  } finally {
    db.exec('DROP TRIGGER abort_account_delete')
    await deleteAccountForMiniProgram({ accountId: account.accountId, miniProgramId })
  }
})

test('daily-content and check-in retries replay their original success without duplicate writes', async () => {
  const server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const appId = 'wx03d0fa4e3c10441d'
  const visitorId = 'command-idempotency-user'
  const post = async (pathname, body, key = '') => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': key,
        'x-miniapp-appid': appId,
        'x-miniapp-data-scope': 'shared:pool-1',
        'x-miniapp-session': sessionToken,
      },
      body: JSON.stringify(body),
    })
    return { data: await response.json(), status: response.status }
  }
  let sessionToken = ''
  try {
    const sessionResponse = await fetch(`${baseUrl}/api/miniapp/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-miniapp-appid': appId, 'x-miniapp-data-scope': 'shared:pool-1', 'x-visitor-id': visitorId },
      body: JSON.stringify({ code: 'command-idempotency-code' }),
    })
    sessionToken = (await sessionResponse.json()).sessionToken
    assert.ok(sessionToken)
    const context = { accountId: getDatabase().prepare('SELECT account_id FROM accounts WHERE visitor_id = ?').get(visitorId).account_id, miniProgramId: 'mp1' }
    const beforeDailyContentEvents = getDatabase().prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'daily_content_open' AND visitor_id = ?").get(context.accountId).count
    const beforeOpened = getDatabase().prepare('SELECT COUNT(*) AS count FROM opened_records WHERE mini_program_id = ? AND visitor_id = ?').get(context.miniProgramId, context.accountId).count
    const dailyContentKey = 'daily-content-open-idempotency-0001'
    const firstDailyContent = await post('/api/miniapp/daily-content/open', { type: 'text' }, dailyContentKey)
    const retriedDailyContent = await post('/api/miniapp/daily-content/open', { type: 'text' }, dailyContentKey)
    const reusedDailyContentKey = await post('/api/miniapp/daily-content/open', { type: 'random' }, dailyContentKey)
    assert.equal(firstDailyContent.status, 201, firstDailyContent.data.message)
    assert.equal(retriedDailyContent.status, 201)
    assert.equal(retriedDailyContent.data.dailyContent.id, firstDailyContent.data.dailyContent.id)
    assert.equal(reusedDailyContentKey.status, 400)
    assert.match(reusedDailyContentKey.data.message, /幂等键与操作内容不一致/)
    assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'daily_content_open' AND visitor_id = ?").get(context.accountId).count, beforeDailyContentEvents + 1)
    assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM opened_records WHERE mini_program_id = ? AND visitor_id = ?').get(context.miniProgramId, context.accountId).count, beforeOpened + 1)

    const beforeCheckins = getDatabase().prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'check_in' AND visitor_id = ?").get(context.accountId).count
    const checkinKey = 'check-in-idempotency-0001'
    const firstCheckin = await post('/api/miniapp/check-in', {}, checkinKey)
    const retriedCheckin = await post('/api/miniapp/check-in', {}, checkinKey)
    assert.equal(firstCheckin.status, 201)
    assert.equal(retriedCheckin.status, 201)
    assert.deepEqual(retriedCheckin.data, firstCheckin.data)
    assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'check_in' AND visitor_id = ?").get(context.accountId).count, beforeCheckins + 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('shared daily content items keep their requested type and exact content without fallback', async () => {
  const server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const appId = 'wx03d0fa4e3c10441d'
  const visitorId = 'shared-daily-content-user'
  const previousConfig = getMiniProgramRuntimeConfig({ miniProgramId: 'mp1' })
  let sessionToken = ''
  const post = async (body, key = '') => {
    const response = await fetch(`${baseUrl}/api/miniapp/daily-content/open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': key,
        'x-miniapp-appid': appId,
        'x-miniapp-data-scope': 'shared:pool-1',
        'x-miniapp-session': sessionToken,
      },
      body: JSON.stringify(body),
    })
    return { data: await response.json(), status: response.status }
  }
  const availability = async (body) => {
    const response = await fetch(`${baseUrl}/api/miniapp/daily-content/availability`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-miniapp-appid': appId,
        'x-miniapp-session': sessionToken,
      },
      body: JSON.stringify(body),
    })
    return { data: await response.json(), status: response.status }
  }

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/miniapp/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-miniapp-appid': appId, 'x-miniapp-data-scope': 'shared:pool-1', 'x-visitor-id': visitorId },
      body: JSON.stringify({ code: 'shared-daily-content-code' }),
    })
    sessionToken = (await sessionResponse.json()).sessionToken
    assert.ok(sessionToken)

    const note = getContentItem('pool-1', 'contentTexts', 'content-text-001')
    assert.ok(note)
    const accountId = getDatabase().prepare('SELECT account_id FROM accounts WHERE visitor_id = ?').get(visitorId).account_id
    const beforePreflightEvents = getDatabase().prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'daily_content_open' AND visitor_id = ?").get(accountId).count
    const beforePreflightOpened = getDatabase().prepare('SELECT COUNT(*) AS count FROM opened_records WHERE mini_program_id = ?').get('mp1').count
    const exactAvailable = await availability({ type: 'text', contentId: note.id })
    const typedAvailable = await availability({ type: 'album' })
    const wrongType = await availability({ type: 'album', contentId: note.id })
    const missing = await availability({ type: 'text', contentId: 'missing-shared-box' })
    const randomAvailable = await availability({ type: 'random' })
    assert.equal(exactAvailable.status, 200)
    assert.equal(exactAvailable.data.available, true)
    assert.equal(typedAvailable.data.available, true)
    assert.equal(wrongType.data.available, false)
    assert.equal(missing.data.available, false)
    assert.equal(randomAvailable.data.available, true)
    assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_type = 'daily_content_open' AND visitor_id = ?").get(accountId).count, beforePreflightEvents)
    assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM opened_records WHERE mini_program_id = ?').get('mp1').count, beforePreflightOpened)
    const exactKey = 'shared-daily-content-exact-0001'
    const exact = await post({ type: 'text', contentId: note.id }, exactKey)
    const retriedExact = await post({ type: 'text', contentId: note.id }, exactKey)
    const reusedKey = await post({ type: 'text', contentId: 'missing-shared-box' }, exactKey)
    assert.equal(exact.status, 201)
    assert.equal(exact.data.dailyContent.id, note.id)
    assert.equal(retriedExact.status, 201)
    assert.equal(retriedExact.data.dailyContent.id, note.id)
    assert.equal(reusedKey.status, 400)
    assert.match(reusedKey.data.message, /幂等键与操作内容不一致/)

    const requestedAlbum = await post({ type: 'album' })
    assert.equal(requestedAlbum.status, 201)
    assert.equal(requestedAlbum.data.dailyContent.type, 'album')

    const mismatchedType = await post({ type: 'album', contentId: note.id })
    const missingContent = await post({ type: 'text', contentId: 'missing-shared-box' })
    const invalidType = await post({ type: 'unsupported' })
    assert.equal(mismatchedType.status, 400)
    assert.match(mismatchedType.data.message, /已失效/)
    assert.equal(missingContent.status, 400)
    assert.match(missingContent.data.message, /已失效/)
    assert.equal(invalidType.status, 400)
    assert.match(invalidType.data.message, /类型无效/)

    updateCurrentMiniProgramConfig({
      dailyContentTypes: { imageEnabled: true, audioEnabled: true },
    }, 'mp1')
    const unavailableAudio = await availability({ type: 'audio' })
    assert.equal(unavailableAudio.status, 200)
    assert.equal(unavailableAudio.data.available, false)
    assert.equal(unavailableAudio.data.fallbackAvailable, true)
    const emptyAudio = await post({ type: 'audio' })
    assert.equal(emptyAudio.status, 400)
    assert.match(emptyAudio.data.message, /该类型手记暂不可用/)

    updateCurrentMiniProgramConfig({
      dailyContentTypes: { imageEnabled: false, audioEnabled: false },
    }, 'mp1')
    const disabledAlbumAvailability = await availability({ type: 'album' })
    assert.equal(disabledAlbumAvailability.status, 200)
    assert.equal(disabledAlbumAvailability.data.available, false)
    const disabledAlbum = await post({ type: 'album' })
    assert.equal(disabledAlbum.status, 400)
    assert.match(disabledAlbum.data.message, /该类型手记暂不可用/)

  } finally {
    updateCurrentMiniProgramConfig({
      ads: previousConfig.ads,
      dailyContentTypes: previousConfig.dailyContentTypes,
      contentPoolId: previousConfig.contentPoolId,
      limits: previousConfig.limits,
      system: previousConfig.system,
    }, 'mp1')
    await new Promise((resolve) => server.close(resolve))
  }
})

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})
