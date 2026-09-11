const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-acceptance-'))
process.env.MINIAPP_DATA_DIR = dataDir
const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [
    { id: 'pool-1', name: '验收内容池' },
    { id: 'pool-2', name: '备用验收内容池' },
  ],
  miniPrograms: [
    {
      id: 'mp1',
      name: '验收小程序',
      appId: 'wx03d0fa4e3c10441d',
      status: 'active',
      config: { contentPoolId: 'pool-1' },
    },
    {
      id: 'mp2',
      name: '第二验收小程序',
      appId: 'wx0987654321fedcba',
      status: 'active',
      config: { contentPoolId: 'pool-2' },
    },
    ...[
      ['mp-union-a', 'UnionID 验收 A', 'wx7000000000000101'],
      ['mp-union-b', 'UnionID 验收 B', 'wx7000000000000102'],
      ['mp-phone-a', '手机号验收 A', 'wx7000000000000103'],
      ['mp-phone-b', '手机号验收 B', 'wx7000000000000104'],
      ['mp-phone-c', '手机号验收 C', 'wx7000000000000105'],
      ['mp-manual-a', '手工手机号验收 A', 'wx7000000000000106'],
      ['mp-manual-b', '手工手机号验收 B', 'wx7000000000000107'],
    ].map(([id, name, appId]) => ({
      id,
      name,
      appId,
      status: 'active',
      config: { contentPoolId: 'pool-1', dataMode: 'shared' },
    })),
  ],
  operationLogs: [],
})
const { updateImages } = require('../src/modules/images/image.store')
const imageFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'images.json'), 'utf8'))
updateImages(imageFixture.items)

const { withCors } = require('../src/lib/cors')
const { createAppRouter, makePicOperations } = require('../src/routes')
const { countEvents, getAnalyticsEvents, recordAnalyticsEvent } = require('../src/modules/analytics/analytics.store')
const { getInternalAdminSettings, updateAdminSettings, updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { toMiniProgramShareSettings } = require('../src/modules/content/content.service')
const { getDataScope } = require('../src/modules/data-scope/data-scope')
const {
  getContentSnapshot,
  updateContentAlbums,
  updateContentTexts,
  updateArticles,
  updateLetters,
} = require('../src/modules/content/content.store')
const { getAccounts, syncLogin, updateProfile } = require('../src/modules/auth/account.store')
const { createMiniAppSession, getMiniAppSession } = require('../src/modules/auth/miniapp-session.store')
const { checkInToday, getCheckinState } = require('../src/modules/checkin/checkin.store')
const { getContentActivity, getFavorites, getOpened, recordOpened, toggleReaction } = require('../src/modules/interactions/interaction.store')
const { createMessage, getCurrentMessages, getMessages, getVisibleMessages } = require('../src/modules/messages/message.store')

const contentFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'content.json'), 'utf8'))
updateContentTexts(contentFixture.contentTexts, 'pool-1')
updateContentAlbums(contentFixture.contentAlbums, 'pool-1')
updateLetters(contentFixture.letters, 'pool-1')
updateArticles(contentFixture.articles, 'pool-1')

let server
let baseUrl
const sessionTokens = new Map()

function headers(visitorId, sessionToken = '', appId = 'wx03d0fa4e3c10441d', dataScopeId = '') {
  const miniProgram = getInternalAdminSettings().miniPrograms.find((item) => item.appId === appId)
  const currentDataScopeId = dataScopeId || (miniProgram ? getDataScope({ miniProgramId: miniProgram.id }).dataScopeId : '')
  return {
    'content-type': 'application/json',
    'x-miniapp-appid': appId,
    ...(sessionToken ? { 'x-miniapp-session': sessionToken } : {}),
    'x-visitor-id': visitorId,
    ...(currentDataScopeId ? { 'x-miniapp-data-scope': currentDataScopeId } : {}),
  }
}

async function getSessionToken(visitorId) {
  if (sessionTokens.has(visitorId)) return sessionTokens.get(visitorId)
  const response = await fetch(`${baseUrl}/api/miniapp/session`, {
    method: 'POST',
    headers: headers(visitorId),
    body: JSON.stringify({ code: 'development-test-code' }),
  })
  const data = await response.json()
  assert.equal(response.status, 200)
  const token = String(data.sessionToken || '')
  assert.ok(token)
  sessionTokens.set(visitorId, token)
  return token
}

async function request(pathname, { method = 'GET', visitorId = 'acceptance-a', body } = {}) {
  const sessionToken = await getSessionToken(visitorId)
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: headers(visitorId, sessionToken),
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, data: await response.json() }
}

async function deletePrivateMessage({ source, sourceId, visitorId = 'acceptance-a', idempotencyKey = '' }) {
  const sessionToken = await getSessionToken(visitorId)
  const response = await fetch(`${baseUrl}/api/miniapp/messages`, {
    method: 'DELETE',
    headers: {
      ...headers(visitorId, sessionToken),
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ source, sourceId }),
  })
  return { status: response.status, data: await response.json() }
}

async function avatarRequest({ visitorId = 'acceptance-avatar', content = 'not an image' } = {}) {
  const sessionToken = await getSessionToken(visitorId)
  const form = new FormData()
  form.append('nickname', '头像验收用户')
  form.append('avatar', new Blob([content], { type: 'image/jpeg' }), 'avatar.jpg')
  const response = await fetch(`${baseUrl}/api/miniapp/profile/avatar`, {
    method: 'POST',
    headers: {
      'x-miniapp-appid': 'wx03d0fa4e3c10441d',
      'x-miniapp-data-scope': getDataScope({ miniProgramId: 'mp1' }).dataScopeId,
      'x-miniapp-session': sessionToken,
      'x-visitor-id': visitorId,
    },
    body: form,
  })
  return { status: response.status, data: await response.json() }
}

async function mediaRequest(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`)
  return { status: response.status, contentType: response.headers.get('content-type'), body: await response.arrayBuffer() }
}

async function adminRequest(pathname, { method = 'GET', body, cookie = '' } = {}) {
  const requestBody = pathname === '/api/admin/settings' && method === 'POST' && body
    ? { settings: body }
    : body
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  })
  return { status: response.status, data: await response.json(), headers: response.headers }
}

test.before(async () => {
  server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  baseUrl = `http://127.0.0.1:${port}`
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('P0: 微信凭据只读取所属小程序在 admin 后台保存的值', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const settingsBefore = await adminRequest('/api/admin/settings', { cookie })
  const managedMiniProgram = {
    ...settingsBefore.data.miniPrograms[0],
    id: 'mp-admin-credentials',
    name: '凭据来源验收',
    appId: 'wx1111111111111111',
    appSecret: 'admin-only-secret',
  }
  const originalFetch = global.fetch
  const previousEnvAppId = process.env.WECHAT_APP_ID
  const previousEnvAppSecret = process.env.WECHAT_APP_SECRET
  const wechatLoginUrls = []
  const stableTokenRequests = []
  const phoneRequests = []
  let created = false
  process.env.WECHAT_APP_ID = 'wx2222222222222222'
  process.env.WECHAT_APP_SECRET = 'environment-only-secret'
  global.fetch = async (input, options) => {
    const url = String(input)
    if (url.startsWith('https://api.weixin.qq.com/sns/jscode2session')) {
      wechatLoginUrls.push(new URL(url))
      return new Response(JSON.stringify({ openid: 'admin-credential-openid' }), { status: 200 })
    }
    if (url === 'https://api.weixin.qq.com/cgi-bin/stable_token') {
      stableTokenRequests.push(JSON.parse(String(options?.body || '{}')))
      return new Response(JSON.stringify({ access_token: 'stable-admin-token', expires_in: 7200 }), { status: 200 })
    }
    if (url.startsWith('https://api.weixin.qq.com/wxa/business/getuserphonenumber')) {
      phoneRequests.push(new URL(url))
      return new Response(JSON.stringify({ phone_info: { phoneNumber: '13800138000' } }), { status: 200 })
    }
    return originalFetch(input, options)
  }

  try {
    const saved = await adminRequest('/api/admin/miniprogram/create', {
      method: 'POST',
      cookie,
      body: { miniProgram: managedMiniProgram },
    })
    assert.equal(saved.status, 200, saved.data.message)
    created = true

    const response = await fetch(`${baseUrl}/api/miniapp/session`, {
      method: 'POST',
      headers: headers('admin-credential-source', '', managedMiniProgram.appId),
      body: JSON.stringify({ code: 'admin-credential-code' }),
    })
    const data = await response.json()
    assert.equal(response.status, 200)
    assert.equal(data.wechatConfigured, true)
    assert.equal(wechatLoginUrls.length, 1)
    assert.equal(wechatLoginUrls[0].searchParams.get('appid'), managedMiniProgram.appId)
    assert.equal(wechatLoginUrls[0].searchParams.get('secret'), managedMiniProgram.appSecret)

    const phoneResponse = await fetch(`${baseUrl}/api/miniapp/profile/sync-login`, {
      method: 'POST',
      headers: headers('admin-credential-source', data.sessionToken, managedMiniProgram.appId),
      body: JSON.stringify({ phoneCode: 'phone-credential-code' }),
    })
    const phoneData = await phoneResponse.json()
    assert.equal(phoneResponse.status, 200)
    assert.equal(phoneData.profile.phone, '13800138000')
    assert.deepEqual(stableTokenRequests, [{
      grant_type: 'client_credential',
      appid: managedMiniProgram.appId,
      secret: managedMiniProgram.appSecret,
      force_refresh: false,
    }])
    assert.equal(phoneRequests[0].searchParams.get('access_token'), 'stable-admin-token')
  } finally {
    global.fetch = originalFetch
    if (previousEnvAppId === undefined) delete process.env.WECHAT_APP_ID
    else process.env.WECHAT_APP_ID = previousEnvAppId
    if (previousEnvAppSecret === undefined) delete process.env.WECHAT_APP_SECRET
    else process.env.WECHAT_APP_SECRET = previousEnvAppSecret
    if (created) {
      await adminRequest('/api/admin/miniprogram/delete', {
        method: 'POST',
        cookie,
        body: { id: managedMiniProgram.id },
      })
    }
  }
})

test('P0: 用户会话忽略伪造访客编号，并按 openid 归并跨设备账号', async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/miniapp/check-in`, {
    method: 'POST',
    headers: headers('forged-visitor'),
    body: JSON.stringify({}),
  })
  assert.equal(unauthenticated.status, 401)

  const firstDevice = syncLogin({ miniProgramId: 'mp1', visitorId: 'openid-device-a' }, {
    openid: 'openid-identity-acceptance',
  })
  const secondDevice = syncLogin({ miniProgramId: 'mp1', visitorId: 'openid-device-b' }, {
    openid: 'openid-identity-acceptance',
  })
  assert.equal(secondDevice.accountId, firstDevice.accountId)

  const session = createMiniAppSession({
    accountId: firstDevice.accountId,
    miniProgramId: 'mp1',
  })
  const updated = await fetch(`${baseUrl}/api/miniapp/profile`, {
    method: 'POST',
    headers: headers('forged-visitor', session.token),
    body: JSON.stringify({ nickname: '真实用户' }),
  })
  const updatedData = await updated.json()
  assert.equal(updated.status, 200)
  assert.equal(updatedData.profile.accountId, firstDevice.accountId)
  assert.equal(updatedData.profile.nickname, '真实用户')
})

test('P0: 多小程序按 UnionID 或微信验证手机号归并，忽略手工提交的手机号', () => {
  const unionFirst = syncLogin({ miniProgramId: 'mp-union-a', visitorId: 'union-device-a' }, {
    openid: 'openid-union-a',
    unionid: 'union-identity-acceptance',
  })
  const unionSecond = syncLogin({ miniProgramId: 'mp-union-b', visitorId: 'union-device-b' }, {
    openid: 'openid-union-b',
    unionid: 'union-identity-acceptance',
  })
  assert.equal(unionSecond.accountId, unionFirst.accountId)

  const phoneFirst = syncLogin({ miniProgramId: 'mp-phone-a', visitorId: 'phone-device-a' }, {
    openid: 'openid-phone-a',
    phone: '13900139000',
    phoneVerified: true,
  })
  const phoneSecond = syncLogin({ miniProgramId: 'mp-phone-b', visitorId: 'phone-device-b' }, {
    openid: 'openid-phone-b',
    phone: '13900139000',
    phoneVerified: true,
  })
  assert.equal(phoneSecond.accountId, phoneFirst.accountId)

  const sourceAccount = syncLogin({ miniProgramId: 'mp-phone-c', visitorId: 'phone-device-c' }, {
    openid: 'openid-phone-c',
  })
  const linkedAccount = syncLogin({
    accountId: sourceAccount.accountId,
    miniProgramId: 'mp-phone-c',
    visitorId: 'phone-device-c',
  }, {
    phone: '13900139000',
    phoneVerified: true,
  })
  const reloginAfterPhoneLink = syncLogin({ miniProgramId: 'mp-phone-c', visitorId: 'phone-device-d' }, {
    openid: 'openid-phone-c',
  })
  assert.equal(linkedAccount.accountId, phoneFirst.accountId)
  assert.equal(reloginAfterPhoneLink.accountId, phoneFirst.accountId)

  const manualPhoneUpdate = syncLogin({
    accountId: phoneFirst.accountId,
    miniProgramId: 'mp-phone-a',
    visitorId: 'phone-device-a',
  }, {
    phone: '13600136000',
  })
  assert.equal(manualPhoneUpdate.phone, '13900139000')

  const manualPhoneFirst = syncLogin({ miniProgramId: 'mp-manual-a', visitorId: 'manual-device-a' }, {
    openid: 'openid-manual-a',
    phone: '13700137000',
  })
  const manualPhoneSecond = syncLogin({ miniProgramId: 'mp-manual-b', visitorId: 'manual-device-b' }, {
    openid: 'openid-manual-b',
    phone: '13700137000',
  })
  assert.equal(manualPhoneFirst.phone, '')
  assert.equal(manualPhoneSecond.phone, '')
})

test('P0: 微信身份归并会迁移当前小程序的账号数据和登录会话', () => {
  const target = syncLogin({ miniProgramId: 'mp1', visitorId: 'merge-target-device' }, {
    openid: 'merge-target-openid',
    unionid: 'merge-shared-unionid',
  })
  const source = syncLogin({ miniProgramId: 'mp1', visitorId: 'merge-source-device' }, {
    openid: 'merge-source-openid',
  })
  assert.notEqual(source.accountId, target.accountId)
  const sourceContext = { miniProgramId: 'mp1', visitorId: source.accountId }
  const sourceSession = createMiniAppSession({ accountId: source.accountId, miniProgramId: 'mp1' })
  const targetMessage = createMessage({
    accountId: target.accountId,
    content: '归并前的旧留言',
    miniProgramId: 'mp1',
    source: 'letters',
    sourceId: 'merge-letter',
    visitorId: target.accountId,
  })
  getDatabase().prepare('UPDATE messages SET updated_at = ? WHERE message_id = ?')
    .run('2000-01-01T00:00:00.000Z', targetMessage.id)
  checkInToday(sourceContext, new Date('2026-08-13T12:00:00+08:00'))
  toggleReaction(sourceContext, { source: 'letters', sourceId: 'merge-letter', type: 'favorite' })
  recordOpened(sourceContext, 'daily_content', { id: 'merge-daily-content', type: 'text', text: '账号归并记录' })
  createMessage({
    accountId: source.accountId,
    content: '账号归并留言',
    miniProgramId: 'mp1',
    source: 'letters',
    sourceId: 'merge-letter',
    visitorId: source.accountId,
  })
  recordAnalyticsEvent('page_view', sourceContext, { page: 'merge-test' })

  const merged = syncLogin({
    accountId: source.accountId,
    miniProgramId: 'mp1',
    visitorId: source.accountId,
  }, {
    openid: 'merge-source-openid',
    unionid: 'merge-shared-unionid',
  })
  const targetContext = { miniProgramId: 'mp1', visitorId: target.accountId }
  assert.equal(merged.accountId, target.accountId)
  assert.equal(getAccounts().some((item) => item.accountId === source.accountId), false)
  assert.equal(getCheckinState(targetContext, new Date('2026-08-13T12:00:00+08:00')).checkIn.checkedToday, true)
  assert.equal(getFavorites(targetContext).some((item) => item.sourceId === 'merge-letter'), true)
  assert.equal(getOpened(targetContext).some((item) => item.sourceId === 'merge-daily-content'), true)
  assert.equal(getMessages().some((item) => item.content === '账号归并留言' && item.accountId === target.accountId && item.visitorId === target.accountId), true)
  const currentMessages = getCurrentMessages({ miniProgramId: 'mp1', accountId: target.accountId }, 'letters', ['merge-letter'])
  assert.equal(currentMessages.size, 1)
  assert.equal(currentMessages.get('merge-letter').content, '账号归并留言')
  assert.equal(getAnalyticsEvents().some((item) => item.meta?.page === 'merge-test' && item.visitorId === target.accountId), true)
  assert.equal(getMiniAppSession(sourceSession.token, 'mp1')?.accountId, target.accountId)
})

test('P0: 永久删除小程序会移除接入配置、撤销旧会话并保留内容池', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const settingsBefore = await adminRequest('/api/admin/settings', { cookie })
  const miniProgram = {
    id: 'mp-archive-acceptance',
    name: '停用验收小程序',
    appId: 'wx3333333333333333',
    appSecret: '',
    status: 'active',
    config: {
      contentPoolId: settingsBefore.data.contentPools[0].id,
      ads: { homeNative: { placement: 'checkIn' } },
    },
  }
  let created = false

  try {
    const saved = await adminRequest('/api/admin/miniprogram/create', {
      method: 'POST',
      cookie,
      body: { miniProgram },
    })
    assert.equal(saved.status, 200, saved.data.message)
    created = true
    const sessionResponse = await fetch(`${baseUrl}/api/miniapp/session`, {
      method: 'POST',
      headers: headers('archive-acceptance', '', miniProgram.appId),
      body: JSON.stringify({ code: 'archive-acceptance-code' }),
    })
    const session = await sessionResponse.json()
    assert.equal(sessionResponse.status, 200)

    const deleted = await adminRequest('/api/admin/miniprogram/delete', {
      method: 'POST',
      cookie,
      body: { id: miniProgram.id },
    })
    assert.equal(deleted.status, 200)
    created = false
    assert.equal(deleted.data.miniPrograms.some((item) => item.id === miniProgram.id), false)
    assert.equal(deleted.data.contentPools.some((item) => item.id === miniProgram.config.contentPoolId), true)
    const blocked = await fetch(`${baseUrl}/api/miniapp/profile`, {
      headers: { 'x-miniapp-appid': miniProgram.appId, 'x-miniapp-session': session.sessionToken },
    })
    assert.equal(blocked.status, 400)
  } finally {
    if (created) {
      await adminRequest('/api/admin/miniprogram/delete', {
        method: 'POST',
        cookie,
        body: { id: miniProgram.id },
      })
    }
  }
})

test('P0: 后台内容请求拒绝不存在的小程序，不回退到当前小程序', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const response = await adminRequest('/api/admin/content?miniProgramId=mp-not-found-test', { cookie })
  assert.equal(response.status, 400)
  assert.equal(response.data.message, '当前小程序已停用或不存在')
})

test('P0: 后台保存会截断超量图册，并允许文章不设置封面', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const original = await adminRequest('/api/admin/content', { cookie })
  assert.equal(original.status, 200)

  const article = {
    id: 'article-cover-acceptance',
    title: '无封面文章',
    author: '验收作者',
    bodyMarkdown: '这是一篇不带封面的文章。',
    publishedAt: '2026-07-24T08:00:00.000Z',
    coverImage: null,
  }

  try {
    const saved = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        articles: [...original.data.articles, article],
      },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.data.articles.some((item) => item.id === article.id && item.coverImage === null), true)

    const savedCover = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        articles: [{
          ...article,
          coverImage: { id: 'article-cover-001' },
        }],
      },
    })
    assert.equal(savedCover.status, 200, savedCover.data.message)
    assert.equal(savedCover.data.articles[0].coverImage.id, 'article-cover-001')

    const truncatedDailyContentImages = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        contentAlbums: [{
          id: 'content-album-limit-acceptance',
          label: '验收图片组',
          images: Array.from({ length: 10 }, () => ({ id: 'img-001' })),
        }],
      },
    })
    assert.equal(truncatedDailyContentImages.status, 200)
    assert.equal(truncatedDailyContentImages.data.contentAlbums[0].images.length, 9)
  } finally {
    updateImages(imageFixture.items)
    const restored = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        contentAlbums: original.data.contentAlbums,
        articles: original.data.articles,
      },
    })
    assert.equal(restored.status, 200, restored.data.message)
  }
})

test('P0: 内容追加接口可安全重试，并校验文章标题和正文', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const original = await adminRequest('/api/admin/content', { cookie })
  assert.equal(original.status, 200)
  const note = {
    id: 'append-idempotent-note',
    label: '默认',
    text: '这条私密文案重复提交时只能保存一次。',
  }

  try {
    const first = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: { type: 'contentTexts', items: [note] },
    })
    assert.equal(first.status, 200)
    assert.equal(first.data.importedCount, 1)
    assert.equal(first.data.contentTexts.filter((item) => item.id === note.id).length, 1)

    const retry = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: { type: 'contentTexts', items: [note] },
    })
    assert.equal(retry.status, 200)
    assert.equal(retry.data.importedCount, 0)
    assert.equal(retry.data.contentTexts.filter((item) => item.id === note.id).length, 1)

    const article = {
      id: 'append-article',
      title: '追加文章',
      author: '追加作者',
      author: '追加作者',
      bodyMarkdown: '追加文章正文。',
      publishedAt: '2026-07-24T08:00:00.000Z',
      coverImage: null,
    }
    const appendedArticle = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: {
        type: 'articles',
        items: [article],
      },
    })
    assert.equal(appendedArticle.status, 200)
    assert.equal(appendedArticle.data.articles.some((item) => item.id === article.id && item.coverImage === null), true)

    const articleRetry = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: {
        type: 'articles',
        items: [article],
      },
    })
    assert.equal(articleRetry.status, 200)
    assert.equal(articleRetry.data.importedCount, 0)

    const oversizedDailyContentAlbum = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: {
        type: 'contentAlbums',
        items: [{
          id: 'append-oversized-content-album',
          label: '默认',
          images: Array.from({ length: 10 }, () => ({ id: 'img-001' })),
        }],
      },
    })
    assert.equal(oversizedDailyContentAlbum.status, 200)
    assert.equal(oversizedDailyContentAlbum.data.contentAlbums.find((item) => item.id === 'append-oversized-content-album').images.length, 9)

    const invalidArticle = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: {
        type: 'articles',
        items: [{ id: 'append-invalid-article', title: '缺少正文', bodyMarkdown: '' }],
      },
    })
    assert.equal(invalidArticle.status, 400)

    const invalidDiaryItem = await adminRequest('/api/admin/content/item', {
      method: 'POST',
      cookie,
      body: {
        type: 'articles',
        item: { ...original.data.articles[0], title: '' },
      },
    })
    assert.equal(invalidDiaryItem.status, 400)
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        contentAlbums: original.data.contentAlbums,
        contentTexts: original.data.contentTexts,
        articles: original.data.articles,
      },
    })
  }
})

test('P0: 内容管理支持逐条保存，且不会覆盖其他内容', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const original = await adminRequest('/api/admin/content', { cookie })
  assert.equal(original.status, 200)
  const target = original.data.contentTexts[0]
  const unchanged = original.data.contentTexts[1]
  const edited = { ...target, label: '逐条保存验收', text: '这条内容通过操作列的保存按钮更新。' }

  try {
    const saved = await adminRequest('/api/admin/content/item', {
      method: 'POST',
      cookie,
      body: { type: 'contentTexts', item: edited },
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.data.contentTexts.find((item) => item.id === target.id), {
      ...edited,
      type: 'text',
    })
    if (unchanged) {
      assert.deepEqual(saved.data.contentTexts.find((item) => item.id === unchanged.id), unchanged)
    }

    const emptyAlbum = await adminRequest('/api/admin/content/item', {
      method: 'POST',
      cookie,
      body: { type: 'contentAlbums', item: { ...original.data.contentAlbums[0], images: [] } },
    })
    assert.equal(emptyAlbum.status, 400)
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { contentTexts: original.data.contentTexts },
    })
  }
})

test('P0: 文本内容保存为单行，文章 HTML 正文保留段落结构', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const original = await adminRequest('/api/admin/content', { cookie })
  assert.equal(original.status, 200)
  const source = '  第一段\r\n\t第二段\u2028第三段  \u2029第四段  '
  const expected = '第一段 第二段 第三段 第四段'

  try {
    const imported = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: {
        type: 'contentTexts',
        items: [{ id: 'normalized-import-note', label: '默认', text: source }],
      },
    })
    assert.equal(imported.status, 200)
    assert.equal(imported.data.contentTexts.find((item) => item.id === 'normalized-import-note').text, expected)

    const pageSaved = await adminRequest('/api/admin/content/page', {
      method: 'POST',
      cookie,
      body: {
        letters: [{ id: 'normalized-page-letter', label: '默认', content: source }],
      },
    })
    assert.equal(pageSaved.status, 200)
    const afterPageSave = await adminRequest('/api/admin/content', { cookie })
    assert.equal(afterPageSave.data.letters.find((item) => item.id === 'normalized-page-letter').content, expected)

    const articleBodyMarkdown = '第一段\n\n**第二段**'
    const savedArticle = await adminRequest('/api/admin/content/item', {
      method: 'POST',
      cookie,
      body: {
        type: 'articles',
        item: {
          ...original.data.articles[0],
          bodyMarkdown: articleBodyMarkdown,
        },
      },
    })
    assert.equal(savedArticle.status, 200)
    assert.equal(
      savedArticle.data.articles.find((item) => item.id === original.data.articles[0].id).bodyMarkdown,
      articleBodyMarkdown,
    )
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        contentTexts: original.data.contentTexts,
        articles: original.data.articles,
        letters: original.data.letters,
      },
    })
  }
})

test('P0: 音频标题独立于标签和原始文件名，并同步到小程序', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const original = await adminRequest('/api/admin/content', { cookie })
  const originalSettings = await adminRequest('/api/admin/settings', { cookie })
  assert.equal(original.status, 200)
  assert.equal(originalSettings.status, 200)

  const audio = {
    id: 'audio-title-acceptance',
    label: '晚间分类',
    title: '初始标题',
    originalFilename: '原始文件名.m4a',
    objectKey: 'audio/audio-title-acceptance.m4a',
    audioUrl: 'https://cos.example.com/audio/audio-title-acceptance.m4a',
    durationSeconds: 28,
    sizeBytes: 1024,
    contentType: 'audio/mp4',
    likeCount: 0,
    favoriteCount: 0,
  }

  try {
    const imported = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { contentAudios: [audio] },
    })
    assert.equal(imported.status, 200)

    const editedAudio = { ...audio, title: '给你的晚安' }
    const saved = await adminRequest('/api/admin/content/item', {
      method: 'POST',
      cookie,
      body: { type: 'contentAudios', item: editedAudio },
    })
    assert.equal(saved.status, 200)
    const savedAudio = saved.data.contentAudios.find((item) => item.id === audio.id)
    assert.equal(savedAudio.label, '晚间分类')
    assert.equal(savedAudio.title, '给你的晚安')
    assert.equal(savedAudio.originalFilename, '原始文件名.m4a')

    const savedSettings = await adminRequest('/api/admin/settings', {
      method: 'POST',
      cookie,
      body: {
        miniPrograms: originalSettings.data.miniPrograms.map((item) => (
          item.id === originalSettings.data.currentMiniProgramId
            ? { ...item, config: { ...item.config, dailyContentTypes: { ...item.config.dailyContentTypes, audioEnabled: true } } }
            : item
        )),
      },
    })
    assert.equal(savedSettings.status, 200)

    const opened = await request('/api/miniapp/daily-content/open', {
      method: 'POST',
      visitorId: 'audio-title-acceptance',
      body: { type: 'audio' },
    })
    assert.equal(opened.status, 201)
    assert.equal(opened.data.dailyContent.title, '给你的晚安')

    const activity = await request('/api/miniapp/activity', { visitorId: 'audio-title-acceptance' })
    assert.equal(activity.status, 200)
    assert.equal(activity.data.totalOpened[0].title, '给你的晚安')

    const profile = await request('/api/miniapp/profile', { visitorId: 'audio-title-acceptance' })
    assert.equal(profile.status, 200)
    assert.equal(profile.data.histories, undefined)
    const openedHistory = activity.data.totalOpened[0]
    assert.deepEqual({
      id: openedHistory.id,
      type: 'audio',
      summary: '给你的晚安',
      title: '给你的晚安',
      images: [],
      originalFilename: '原始文件名.m4a',
      audioUrl: 'https://cos.example.com/audio/audio-title-acceptance.m4a',
      durationSeconds: 28,
    }, (({ id, type, preview, title, images, originalFilename, audioUrl, durationSeconds }) => ({
      id,
      type,
      summary: preview,
      title,
      images,
      originalFilename,
      audioUrl,
      durationSeconds,
    }))(openedHistory))
    assert.match(openedHistory.time, /打开$/)
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { contentAudios: original.data.contentAudios },
    })
    await adminRequest('/api/admin/settings', {
      method: 'POST',
      cookie,
      body: { miniPrograms: originalSettings.data.miniPrograms },
    })
  }
})

test('P0: 每日手记上限为 0 时不限次数', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const originalHome = await request('/api/miniapp/home')
  const originalLimits = originalHome.data.limits

  try {
    const saved = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { limits: { dailyContentLimit: 0 } },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.data.limits.dailyContentLimit, 0)

    const home = await request('/api/miniapp/home')
    assert.equal(home.data.limits.dailyContentLimit, 0)
    for (let index = 0; index < 4; index += 1) {
      const opened = await request('/api/miniapp/daily-content/open', {
        method: 'POST',
        visitorId: 'unlimited-daily-content-visitor',
        body: { type: 'text', contentId: contentFixture.contentTexts[0].id },
      })
      assert.equal(opened.status, 201)
    }
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { limits: originalLimits },
    })
  }
})

test('P0: 手记和打卡展示文案池支持默认值和后台配置', async () => {
  const initialHome = await request('/api/miniapp/home')
  const originalSystem = initialHome.data.system
  const originalLimits = initialHome.data.limits
  // 会增长的文案列表改由独立文案包接口下发，home payload 的 system 不再携带
  assert.equal('dailyContentPromptTexts' in originalSystem, false)
  assert.equal('checkinBeforeTexts' in originalSystem, false)
  assert.equal('checkinAfterTexts' in originalSystem, false)
  assert.equal(originalSystem.dailyContentAdIncompleteText, '完整观看广告后，即可打开手记')
  assert.equal(originalSystem.articleAdIncompleteText, '完整观看广告后，即可展开全文')
  assert.equal(originalSystem.checkinAdIncompleteText, '完整观看广告后，即可完成打卡')
  const initialCopyPack = await request('/api/miniapp/copy-pack')
  assert.equal(initialCopyPack.data.changed, true)
  // 未自定义时下发后台默认文案（与服务端 defaultSystem / 客户端定稿一致）
  assert.deepEqual(initialCopyPack.data.copyPack.dailyContentPromptTexts, ['想说的，都悄悄放这里了', '打开前，猜猜里面是什么'])
  assert.deepEqual(initialCopyPack.data.copyPack.checkinBeforeTexts, ['今天也等到你了', '每天都来打卡吧'])
  assert.deepEqual(initialCopyPack.data.copyPack.checkinAfterTexts, ['今日已点亮，明天再来打卡吧！', '感谢你的支持，明天我等你哦！'])
  const unchangedInitialPack = await request(`/api/miniapp/copy-pack?version=${encodeURIComponent(initialCopyPack.data.version)}`)
  assert.equal(unchangedInitialPack.data.changed, false)
  assert.equal(initialHome.data.companionValueRewards.checkin, 5)
  assert.equal('checkinCalendarText' in originalSystem, false)
  assert.equal('deprecatedSuccessTexts' in originalSystem, false)
  assert.equal('checkinSuccessTexts' in originalSystem, false)
  assert.equal('deprecatedNewContentText' in originalSystem, false)
  assert.equal('checkinReminderText' in originalSystem, false)
  assert.equal('subscriptionProtection' in originalSystem, false)
  // home payload 不再携带文案列表：用文案包内容补全 system 快照，保证后续保存不丢失列表
  const originalFullSystem = {
    ...originalSystem,
    dailyContentPromptTexts: initialCopyPack.data.copyPack.dailyContentPromptTexts,
    checkinBeforeTexts: initialCopyPack.data.copyPack.checkinBeforeTexts,
    checkinAfterTexts: initialCopyPack.data.copyPack.checkinAfterTexts,
  }

  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  assert.match(String(login.headers.get('set-cookie') || ''), /; Secure;/)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  assert.ok(cookie)

  const invalid = await adminRequest('/api/admin/content', {
    method: 'POST',
    cookie,
    body: { system: { ...originalSystem, dailyContentPromptTexts: ['没有中文逗号'] } },
  })
  assert.equal(invalid.status, 400)
  assert.match(JSON.stringify(invalid.data), /中文逗号/)

  // 显式清空（空数组）合法：保存后文案包下发空数组，由客户端回落内置默认包
  const cleared = await adminRequest('/api/admin/content', {
    method: 'POST',
    cookie,
    body: { system: { ...originalSystem, dailyContentPromptTexts: [] } },
  })
  assert.equal(cleared.status, 200, cleared.data.message)
  assert.deepEqual(cleared.data.system.dailyContentPromptTexts, [])
  const clearedPack = await request('/api/miniapp/copy-pack')
  assert.equal(clearedPack.data.changed, true)
  assert.deepEqual(clearedPack.data.copyPack.dailyContentPromptTexts, [])

  const customPrompts = ['后台配置，文案一', '后台配置，文案二']
  const customCheckinBeforeTexts = ['今天也来看看', '给今天留个脚印']
  const customCheckinAfterTexts = ['今天已经点亮', '明天也在这里等你']
  try {
    const updated = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
    body: {
      system: {
        ...originalSystem,
        dailyContentPromptTexts: customPrompts,
        checkinBeforeTexts: customCheckinBeforeTexts,
        checkinAfterTexts: customCheckinAfterTexts,
        dailyContentAdIncompleteText: '完整观看后再打开',
        checkinAdIncompleteText: '完整观看后再打卡',
        deprecatedSuccessTexts: ['旧版手记成功提示'],
        checkinSuccessTexts: ['旧版打卡成功提示'],
        deprecatedNewContentText: '旧版手记提醒文案',
        checkinReminderText: '旧版打卡提醒文案',
        subscriptionProtection: { quietStart: '22:00', quietEnd: '08:00', authorizationCooldownDays: 7, dailyLimit: 2 },
      },
    },
    })
    assert.equal(updated.status, 200)
    assert.deepEqual(updated.data.system.dailyContentPromptTexts, customPrompts)
    assert.equal(updated.data.system.dailyContentAdIncompleteText, '完整观看后再打开')
    assert.equal(updated.data.system.checkinAdIncompleteText, '完整观看后再打卡')
    assert.deepEqual(updated.data.system.checkinBeforeTexts, customCheckinBeforeTexts)
    assert.deepEqual(updated.data.system.checkinAfterTexts, customCheckinAfterTexts)
    assert.equal('checkinCalendarText' in updated.data.system, false)
    assert.equal('deprecatedSuccessTexts' in updated.data.system, false)
    assert.equal('checkinSuccessTexts' in updated.data.system, false)
    assert.equal('deprecatedNewContentText' in updated.data.system, false)
    assert.equal('checkinReminderText' in updated.data.system, false)
    assert.equal('subscriptionProtection' in updated.data.system, false)

    const updatedHome = await request('/api/miniapp/home')
    assert.equal('dailyContentPromptTexts' in updatedHome.data.system, false)
    assert.equal(updatedHome.data.system.dailyContentAdIncompleteText, '完整观看后再打开')
    assert.equal(updatedHome.data.system.checkinAdIncompleteText, '完整观看后再打卡')

    // 文案列表变更后：文案包版本递增，新版本全量下发，同版本二次请求只回 changed:false
    const updatedCopyPack = await request('/api/miniapp/copy-pack')
    assert.equal(updatedCopyPack.data.changed, true)
    assert.notEqual(updatedCopyPack.data.version, initialCopyPack.data.version)
    assert.deepEqual(updatedCopyPack.data.copyPack.dailyContentPromptTexts, customPrompts)
    assert.deepEqual(updatedCopyPack.data.copyPack.checkinBeforeTexts, customCheckinBeforeTexts)
    assert.deepEqual(updatedCopyPack.data.copyPack.checkinAfterTexts, customCheckinAfterTexts)
    const unchangedCopyPack = await request(`/api/miniapp/copy-pack?version=${encodeURIComponent(updatedCopyPack.data.version)}`)
    assert.equal(unchangedCopyPack.data.changed, false)

    const updatedLimit = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { limits: { dailyContentLimit: 5 } },
    })
    assert.equal(updatedLimit.status, 200)
    assert.equal(updatedLimit.data.limits.dailyContentLimit, 5)
    const homeWithUpdatedLimit = await request('/api/miniapp/home')
    assert.equal(homeWithUpdatedLimit.data.limits.dailyContentLimit, 5)

    const statVisibilityCases = [
      [{
        rankToday: { label: '今日排名', visible: true },
        checkInDays: { label: '连续打卡', visible: true },
        companionValue: { label: '阅读值', visible: true },
      }, [
        { key: 'rankToday', label: '今日排名' },
        { key: 'checkInDays', label: '连续打卡' },
        { key: 'companionValue', label: '阅读值' },
      ]],
      [{
        rankToday: { label: '今天第几位', visible: false },
        checkInDays: { label: '已连续打卡', visible: true },
        companionValue: { label: '累计阅读值', visible: true },
      }, [
        { key: 'checkInDays', label: '已连续打卡' },
        { key: 'companionValue', label: '累计阅读值' },
      ]],
      [{
        rankToday: { label: '今天第几位', visible: false },
        checkInDays: { label: '已连续打卡', visible: true },
        companionValue: { label: '累计阅读值', visible: false },
      }, [
        { key: 'checkInDays', label: '已连续打卡' },
      ]],
      [{
        rankToday: { label: '今天第几位', visible: false },
        checkInDays: { label: '已连续打卡', visible: false },
        companionValue: { label: '累计阅读值', visible: false },
      }, []],
    ]
    for (const [homeStats, expectedStats] of statVisibilityCases) {
      const saved = await adminRequest('/api/admin/content', {
        method: 'POST',
        cookie,
        body: { system: { ...originalFullSystem, homeStats } },
      })
      assert.equal(saved.status, 200)
      const configuredHome = await request('/api/miniapp/home')
      assert.deepEqual(
        configuredHome.data.stats.map((item) => ({ key: item.key, label: item.label })),
        expectedStats,
      )
    }

    const tabVisibility = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        system: {
          ...originalFullSystem,
          tabs: {
            ...originalSystem.tabs,
            home: { label: '不应生效', visible: false },
            letters: { ...originalSystem.tabs.letters, visible: false },
            articles: { ...originalSystem.tabs.articles, visible: false },
            mine: { label: '不应生效', visible: false },
          },
        },
      },
    })
    assert.equal(tabVisibility.status, 200)
    assert.equal(tabVisibility.data.system.tabs.home.label, '首页')
    assert.equal(tabVisibility.data.system.tabs.home.visible, false)
    assert.equal(tabVisibility.data.system.tabs.articles.visible, false)
    assert.equal(tabVisibility.data.system.tabs.mine.label, '我的')
    assert.equal(tabVisibility.data.system.tabs.mine.visible, true)

    const tabsFromMiniApp = await request('/api/miniapp/home')
    assert.equal(tabsFromMiniApp.data.system.tabs.home.visible, false)
    assert.equal(tabsFromMiniApp.data.system.tabs.mine.visible, true)
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { limits: originalLimits, system: originalFullSystem },
    })
  }
})

test('P0: 分享模板全局共享，每日免广告次数仍按当前小程序配置生效', async () => {
  const initialHome = await request('/api/miniapp/home')
  const originalAds = initialHome.data.ads
  const initialCopyPack = await request('/api/miniapp/copy-pack')
  const originalShareSettings = initialCopyPack.data.copyPack.share
  assert.equal(originalShareSettings.private.coverCopyEnabled, true)
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]

  try {
    const unwrappedShare = await adminRequest('/api/admin/share-settings', {
      method: 'POST',
      cookie,
      body: originalShareSettings,
    })
    assert.equal(unwrappedShare.status, 400)

    const genericSettingsShare = await adminRequest('/api/admin/settings', {
      method: 'POST',
      cookie,
      body: { shareSettings: originalShareSettings },
    })
    assert.equal(genericSettingsShare.status, 400)

    const contentShare = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { shareSettings: originalShareSettings },
    })
    assert.equal(contentShare.status, 400)

    const invalidCoverCopy = await adminRequest('/api/admin/share-settings', {
      method: 'POST',
      cookie,
      body: {
        shareSettings: {
          ...originalShareSettings,
          private: {
            ...originalShareSettings.private,
            pools: {
              ...originalShareSettings.private.pools,
              text: {
                ...originalShareSettings.private.pools.text,
                coverCopies: [{ id: 'invalid-cover-copy', text: '太短' }],
              },
            },
          },
        },
      },
    })
    assert.equal(invalidCoverCopy.status, 400)
    assert.match(JSON.stringify(invalidCoverCopy.data), /4 至 20 个字/)

    const configured = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: {
        ads: {
          ...originalAds,
          homeDailyContentRewarded: { ...originalAds.homeDailyContentRewarded, enabled: true, adUnitId: 'adunit-daily-content', freeCount: 1 },
        },
      },
    })
    const configuredShare = await adminRequest('/api/admin/share-settings', {
      method: 'POST',
      cookie,
      body: {
        shareSettings: {
          ...originalShareSettings,
          private: {
            ...originalShareSettings.private,
            coverCopyEnabled: false,
            coverStyle: {
              globalWashOpacity: 0.4,
              readingZoneOpacity: 0,
              copyFontSize: 100,
              dateFontSize: 20,
              dividerLength: 100,
              text: {
                copyColor: '#fffdf8',
                dateColor: '#f4cf86',
                dividerColor: '#f4cf86',
                readingZoneColor: '#211a16',
              },
              layouts: {
                centered: { enabled: false, offsetY: 23 },
                leftTitle: { enabled: false, offsetY: -19 },
              },
            },
          },
        },
      },
    })
    assert.equal(configured.status, 200)
    assert.equal(configuredShare.status, 200)
    assert.equal('templateStyle' in configured.data.ads.homeNative, false)

    const configuredHome = await request('/api/miniapp/home')
    assert.equal('shareSettings' in configuredHome.data, false)
    const configuredCopyPack = await request('/api/miniapp/copy-pack')
    const shareSettings = configuredCopyPack.data.copyPack.share
    assert.ok(shareSettings.version >= 1)
    assert.equal(shareSettings.private.coverCopyEnabled, false)
    assert.ok(shareSettings.private.pools.text.titles.every((item) => item.title))
    assert.ok(shareSettings.private.pools.image.titles.every((item) => item.title))
    assert.ok(shareSettings.private.pools.text.coverCopies.every((item) => item.text))
    assert.ok(shareSettings.private.pools.image.coverCopies.every((item) => item.text))
    assert.deepEqual(shareSettings.private.backgrounds, [])
    assert.equal(shareSettings.private.coverStyle.globalWashOpacity, 0.4)
    assert.equal(shareSettings.private.coverStyle.readingZoneOpacity, 0)
    assert.equal(shareSettings.private.coverStyle.copyFontSize, 100)
    assert.equal(shareSettings.private.coverStyle.dateFontSize, 20)
    assert.equal(shareSettings.private.coverStyle.dividerLength, 100)
    assert.equal(shareSettings.private.coverStyle.text.copyColor, '#FFFDF8')
    assert.equal(shareSettings.private.coverStyle.text.dateColor, '#F4CF86')
    assert.equal(shareSettings.private.coverStyle.text.dividerColor, '#F4CF86')
    assert.equal(shareSettings.private.coverStyle.text.readingZoneColor, '#211A16')
    assert.equal(shareSettings.private.coverStyle.layouts.centered.enabled, true)
    assert.equal(shareSettings.private.coverStyle.layouts.leftTitle.enabled, false)
    const globalSettings = await adminRequest('/api/admin/settings', { cookie })
    assert.deepEqual(globalSettings.data.shareSettings, shareSettings)
    assert.equal(globalSettings.data.miniPrograms.every((item) => !Object.hasOwn(item.config, 'shareSettings')), true)
    assert.equal(globalSettings.data.operationLogs[0].target, '全局分享模板')
    const anotherMiniProgram = globalSettings.data.miniPrograms.find((item) => (
      item.id !== globalSettings.data.currentMiniProgramId && item.status !== 'archived'
    ))
    assert.ok(anotherMiniProgram)
    const anotherHomeResponse = await fetch(`${baseUrl}/api/miniapp/home`, {
      headers: {
        'x-miniapp-appid': anotherMiniProgram.appId,
        'x-visitor-id': 'global-share-settings-second-miniapp',
      },
    })
    assert.equal(anotherHomeResponse.status, 200)
    const anotherHome = await anotherHomeResponse.json()
    const anotherCopyPackResponse = await fetch(`${baseUrl}/api/miniapp/copy-pack`, {
      headers: {
        'x-miniapp-appid': anotherMiniProgram.appId,
        'x-visitor-id': 'global-share-settings-second-miniapp',
      },
    })
    assert.equal(anotherCopyPackResponse.status, 200)
    const anotherCopyPack = await anotherCopyPackResponse.json()
    assert.deepEqual(anotherCopyPack.copyPack.share, shareSettings)
    const preflight = await adminRequest('/api/admin/preflight', { cookie })
    const shareCheck = preflight.data.checks.find((item) => item.label === '分享卡片')
    assert.equal(shareCheck.status, 'pass')
    const preflightLabels = preflight.data.checks.map((item) => item.label)
    for (const label of ['COS配置', '图片素材', '媒体访问', '手记投放', '发布通道', '开发者邮箱', '微信凭据']) {
      assert.equal(preflightLabels.includes(label), true)
    }
    assert.deepEqual(preflightLabels, [
      '微信凭据', '开发者邮箱', '内容池绑定', '发布通道', 'COS配置', '手记内容', '心笺内容', '文章内容',
      '手记投放', '图片素材', '媒体访问', '留言管理', '分享卡片', '广告配置', '内容安全',
    ])
    assert.equal(preflight.data.checks.some((item) => item.label === '微信平台人工确认'), false)

    const visitorId = 'rewarded-access-visitor'
    const beforeOpen = await request('/api/miniapp/rewarded-ad-access', {
      method: 'POST',
      visitorId,
      body: { placement: 'daily_content' },
    })
    assert.equal(beforeOpen.status, 200)
    assert.deepEqual(beforeOpen.data, { free: true, freeCount: 1, usedCount: 0 })

    const opened = await request('/api/miniapp/daily-content/open', {
      method: 'POST',
      visitorId,
      body: { type: 'text' },
    })
    assert.equal(opened.status, 201)

    const afterOpen = await request('/api/miniapp/rewarded-ad-access', {
      method: 'POST',
      visitorId,
      body: { placement: 'daily_content' },
    })
    assert.equal(afterOpen.status, 200)
    assert.deepEqual(afterOpen.data, { free: false, freeCount: 1, usedCount: 1 })
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { ads: originalAds },
    })
    await adminRequest('/api/admin/share-settings', {
      method: 'POST',
      cookie,
      body: { shareSettings: originalShareSettings },
    })
  }
})

test('P0: 分享只下发规则，服务端不再生成分享 PNG', async () => {
  const home = await request('/api/miniapp/home')
  assert.equal(home.status, 200)
  const copyPack = await request('/api/miniapp/copy-pack')
  assert.equal(typeof copyPack.data.copyPack.share.private.pools.text.titles[0].title, 'string')
  assert.deepEqual(copyPack.data.copyPack.share.private.backgrounds, [])

  const imageResponse = await fetch(`${baseUrl}/api/miniapp/share-image?source=daily_content&miniProgramId=mp1`)
  assert.equal(imageResponse.status, 404)
})

test('P0: 公开内容不保存分享标题或指定封面', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const original = await adminRequest('/api/admin/content', { cookie })
  const target = original.data.articles[0]
  const nextEntries = original.data.articles.map((item) => (
    item.id === target.id
      ? { ...item, shareTitle: '想把这一刻留给你', shareImageId: 'article-cover-002' }
      : item
  ))

  try {
    const saved = await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { articles: nextEntries },
    })
    assert.equal(saved.status, 200)
    const savedTarget = saved.data.articles.find((item) => item.id === target.id)
    assert.equal('shareTitle' in savedTarget, false)
    assert.equal('shareImageId' in savedTarget, false)

    const publicDiary = await request('/api/miniapp/articles')
    const publicTarget = publicDiary.data.items.find((item) => item.id === target.id)
    assert.equal('shareTitle' in publicTarget, false)
    assert.equal('shareImageId' in publicTarget, false)
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { articles: original.data.articles },
    })
  }
})

test('P0: 心笺按选中的倒序入库规则展示，文章按发布时间和入库顺序倒序展示', async () => {
  const settings = getInternalAdminSettings()
  const currentMiniProgram = settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId)
  const poolId = currentMiniProgram.config.contentPoolId
  const originalContent = getContentSnapshot(poolId)

  assert.equal(currentMiniProgram.config.system.lettersSortMode, 'random')
  assert.equal(currentMiniProgram.config.system.articlesSortMode, 'random')

  try {
    updateMiniProgramConfig(currentMiniProgram.id, {
      ...currentMiniProgram.config,
      system: {
        ...currentMiniProgram.config.system,
        articlesSortMode: 'sequence',
        lettersSortMode: 'sequence',
      },
    })
    updateLetters([
      { id: 'sort-letter-earliest', content: '最早入库的心笺' },
      { id: 'sort-letter-middle', content: '中间入库的心笺' },
      { id: 'sort-letter-latest', content: '最新入库的心笺' },
    ], poolId)
    updateArticles([
      { id: 'sort-article-old', title: '较早文章', author: '排序作者', bodyMarkdown: '较早文章', publishedAt: '2026-07-01T08:00:00.000Z', coverImage: null },
      { id: 'sort-article-same-earlier', title: '同日先入库文章', author: '排序作者', bodyMarkdown: '同日先入库文章', publishedAt: '2026-08-01T08:00:00.000Z', coverImage: null },
      { id: 'sort-article-same-later', title: '同日后入库文章', author: '排序作者', bodyMarkdown: '同日后入库文章', publishedAt: '2026-08-01T08:00:00.000Z', coverImage: null },
      { id: 'sort-article-newest', title: '最新文章', author: '排序作者', bodyMarkdown: '最新文章', publishedAt: '2026-08-02T08:00:00.000Z', coverImage: null },
    ], poolId)

    const lettersFirstPage = await request('/api/miniapp/letters?page=1&pageSize=2')
    const lettersSecondPage = await request('/api/miniapp/letters?page=2&pageSize=2')
    const articlesFirstPage = await request('/api/miniapp/articles?page=1&pageSize=2')
    const articlesSecondPage = await request('/api/miniapp/articles?page=2&pageSize=2')

    assert.equal(lettersFirstPage.data.items[0].id, 'sort-letter-latest')
    assert.deepEqual(lettersFirstPage.data.items.map((item) => item.id), ['sort-letter-latest', 'sort-letter-middle'])
    assert.deepEqual(lettersSecondPage.data.items.map((item) => item.id), ['sort-letter-earliest'])
    assert.equal(articlesFirstPage.data.items[0].id, 'sort-article-newest')
    assert.deepEqual(articlesFirstPage.data.items.map((item) => item.id), ['sort-article-newest', 'sort-article-same-later'])
    assert.deepEqual(articlesSecondPage.data.items.map((item) => item.id), ['sort-article-same-earlier', 'sort-article-old'])
  } finally {
    updateLetters(originalContent.letters, poolId)
    updateArticles(originalContent.articles, poolId)
    updateMiniProgramConfig(currentMiniProgram.id, currentMiniProgram.config)
  }
})

test('P0: 手记、互动、历史和留言只归属当前用户', async () => {
  const home = await request('/api/miniapp/home')
  assert.equal(home.status, 200)
  assert.equal(home.data.checkIn.checkedToday, false)
  assert.equal(home.data.stats.find((item) => item.key === 'checkInDays').label, '已连续打卡')

  const letters = await request('/api/miniapp/letters')
  assert.equal(letters.status, 200)
  const letter = letters.data.items[0]
  assert.ok(letter?.id)
  assert.equal('label' in letter, false)

  const favorite = await request('/api/miniapp/interactions/toggle', {
    method: 'POST',
    body: { source: 'letters', sourceId: letter.id, type: 'favorite' },
  })
  assert.equal(favorite.status, 200)
  assert.equal(favorite.data.interaction.favorited, true)
  assert.equal(favorite.data.interaction.favoriteCount, Number(letter.favoriteCount) + 1)

  const refreshedLetters = await request('/api/miniapp/letters')
  const refreshedLetter = refreshedLetters.data.items.find((item) => item.id === letter.id)
  assert.equal(refreshedLetter.favorited, true)
  assert.equal(refreshedLetter.favoriteCount, Number(letter.favoriteCount) + 1)

  const otherVisitorLetters = await request('/api/miniapp/letters', { visitorId: 'acceptance-b' })
  const otherVisitorLetter = otherVisitorLetters.data.items.find((item) => item.id === letter.id)
  assert.equal(otherVisitorLetter.favorited, false)
  assert.equal(otherVisitorLetter.favoriteCount, Number(letter.favoriteCount) + 1)

  const like = await request('/api/miniapp/interactions/toggle', {
    method: 'POST',
    body: { source: 'letters', sourceId: letter.id, type: 'like' },
  })
  assert.equal(like.status, 200)
  assert.equal(like.data.interaction.liked, true)
  assert.equal(like.data.interaction.likeCount, Number(letter.likeCount) + 1)

  const share = await request('/api/miniapp/interactions/share', {
    method: 'POST',
    body: { source: 'letters', sourceId: letter.id },
  })
  assert.equal(share.status, 201)
  assert.equal(share.data.recorded, true)

  const opened = await request('/api/miniapp/daily-content/open', {
    method: 'POST',
    body: { type: 'text' },
  })
  assert.equal(opened.status, 201)
  assert.equal(opened.data.dailyContent.type, 'text')
  assert.equal('label' in opened.data.dailyContent, false)

  const dailyContentFavorite = await request('/api/miniapp/interactions/toggle', {
    method: 'POST',
    body: { source: 'daily_content', sourceId: opened.data.dailyContent.id, type: 'favorite' },
  })
  assert.equal(dailyContentFavorite.status, 200)
  assert.equal(dailyContentFavorite.data.interaction.favorited, true)

  const dailyContentLike = await request('/api/miniapp/interactions/toggle', {
    method: 'POST',
    body: { source: 'daily_content', sourceId: opened.data.dailyContent.id, type: 'like' },
  })
  assert.equal(dailyContentLike.status, 200)
  const dailyContentShare = await request('/api/miniapp/interactions/share', {
    method: 'POST',
    body: { source: 'daily_content', sourceId: opened.data.dailyContent.id },
  })
  assert.equal(dailyContentShare.status, 201)

  const dailyContentMessage = await request('/api/miniapp/messages', {
    method: 'POST',
    body: { source: 'daily_content', sourceId: opened.data.dailyContent.id, content: '这是一条手记验收留言。' },
  })
  assert.equal(dailyContentMessage.status, 201)

  const legacyDailyContentMessage = await request('/api/miniapp/messages', {
    method: 'POST',
    body: { source: 'home', sourceId: opened.data.dailyContent.id, content: '旧来源不应再被接受。' },
  })
  assert.equal(legacyDailyContentMessage.status, 400)

  const checkin = await request('/api/miniapp/check-in', { method: 'POST', body: {} })
  assert.equal(checkin.status, 201)
  assert.equal(checkin.data.checkIn.checkedToday, true)
  assert.equal(checkin.data.calendarDays.length, 14)
  assert.equal(checkin.data.companionValueDelta, 5)

  const repeatedCheckin = await request('/api/miniapp/check-in', { method: 'POST', body: {} })
  assert.equal(repeatedCheckin.status, 400)
  assert.equal(repeatedCheckin.data.message, '今天已经打过卡，请明天再试')

  const homeAfterCheckin = await request('/api/miniapp/home')
  const streak = homeAfterCheckin.data.stats.find((item) => item.key === 'checkInDays')
  const companionValue = homeAfterCheckin.data.stats.find((item) => item.key === 'companionValue')
  assert.equal(streak.value, '1天')
  assert.match(companionValue.value, /^\d+点$/)
  assert.ok(Number(companionValue.value.replace('点', '')) >= 5)

  const message = await request('/api/miniapp/messages', {
    method: 'POST',
    body: { source: 'letters', sourceId: letter.id, content: '这是一条验收留言。' },
  })
  assert.equal(message.status, 201)

  const activity = await request('/api/miniapp/activity')
  assert.equal(activity.status, 200)
  assert.equal(activity.data.favorites.length, 2)
  assert.equal(activity.data.totalOpened.length, 1)
  assert.equal(activity.data.messages.length, 2)
  assert.equal(activity.data.interactions.length, 2)
  assert.deepEqual(activity.data.favorites.map((item) => item.type).sort(), ['letter', 'text'])
  assert.equal(activity.data.totalOpened[0].type, 'text')
  assert.deepEqual(activity.data.messages.map((item) => item.type).sort(), ['letter', 'text'])
  const letterInteraction = activity.data.interactions.find((item) => item.source === 'letters')
  const dailyContentInteraction = activity.data.interactions.find((item) => item.source === 'daily_content')
  assert.equal(letterInteraction.type, 'letter')
  assert.deepEqual(letterInteraction.actions, ['点赞', '分享', '留言'])
  assert.equal(dailyContentInteraction.sourceId, opened.data.dailyContent.id)
  assert.equal(dailyContentInteraction.type, 'text')
  assert.deepEqual(dailyContentInteraction.actions, ['点赞', '分享', '留言'])
  assert.equal(activity.data.summary.interactions, 2)

  const otherUser = await request('/api/miniapp/activity', { visitorId: 'acceptance-b' })
  assert.equal(otherUser.status, 200)
  assert.equal(otherUser.data.favorites.length, 0)
  assert.equal(otherUser.data.totalOpened.length, 0)
  assert.equal(otherUser.data.messages.length, 0)
  assert.equal(otherUser.data.interactions.length, 0)
})

test('P0: 留言以当前用户和内容为单位替换，刷新三种内容仍返回最新值', async () => {
  const visitorId = 'message-replacement-a'
  const letters = await request('/api/miniapp/letters', { visitorId })
  const articles = await request('/api/miniapp/articles', { visitorId })
  const letterId = letters.data.items[0].id
  const articleId = articles.data.items[0].id
  const opened = await request('/api/miniapp/daily-content/open', {
    method: 'POST', visitorId, body: { type: 'text' },
  })
  const dailyContentId = opened.data.dailyContent.id

  const submit = async (source, sourceId, first, second) => {
    const created = await request('/api/miniapp/messages', {
      method: 'POST', visitorId, body: { source, sourceId, content: first },
    })
    const replaced = await request('/api/miniapp/messages', {
      method: 'POST', visitorId, body: { source, sourceId, content: second },
    })
    assert.equal(created.status, 201)
    assert.equal(replaced.status, 201)
    assert.equal(replaced.data.messageId, created.data.messageId)
  }
  await submit('letters', letterId, '心笺旧留言', '心笺新留言')
  await submit('article', articleId, '文章旧留言', '文章新留言')
  await submit('daily_content', dailyContentId, '手记旧留言', '手记新留言')

  const accountId = getMiniAppSession(await getSessionToken(visitorId), 'mp1').accountId
  const initialLetter = getCurrentMessages({ miniProgramId: 'mp1', accountId }, 'letters', [letterId]).get(letterId)
  const initialArticle = getCurrentMessages({ miniProgramId: 'mp1', accountId }, 'article', [articleId]).get(articleId)
  getDatabase().prepare('UPDATE messages SET created_at = ?, updated_at = ? WHERE message_id = ?')
    .run('2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', initialLetter.id)
  getDatabase().prepare('UPDATE messages SET created_at = ?, updated_at = ? WHERE message_id = ?')
    .run('2001-01-01T00:00:00.000Z', '2001-01-01T00:00:00.000Z', initialArticle.id)
  const finalReplacement = await request('/api/miniapp/messages', {
    method: 'POST', visitorId, body: { source: 'letters', sourceId: letterId, content: '心笺最终留言' },
  })
  assert.equal(finalReplacement.status, 201)
  const visibleMessages = getVisibleMessages({ miniProgramId: 'mp1', accountId })
  const currentLetter = visibleMessages.find((item) => item.id === initialLetter.id)
  const contentActivity = getContentActivity({ miniProgramId: 'mp1', visitorId: accountId })
  assert.equal(visibleMessages[0].id, initialLetter.id)
  assert.equal(currentLetter.createdAt, '2000-01-01T00:00:00.000Z')
  assert.ok(currentLetter.updatedAt > initialArticle.updatedAt)
  assert.equal(contentActivity[0].sourceId, letterId)
  assert.equal(contentActivity[0].messageAt, currentLetter.updatedAt)

  const refreshedLetters = await request('/api/miniapp/letters', { visitorId })
  const refreshedArticles = await request('/api/miniapp/articles', { visitorId })
  const refreshedDailyContent = await request('/api/miniapp/daily-content/open', {
    method: 'POST', visitorId, body: { type: 'text', contentId: dailyContentId },
  })
  assert.equal(refreshedLetters.data.items.find((item) => item.id === letterId).myMessage, '心笺最终留言')
  assert.equal(refreshedArticles.data.items.find((item) => item.id === articleId).myMessage, '文章新留言')
  assert.equal(refreshedDailyContent.data.dailyContent.id, dailyContentId)
  assert.equal(refreshedDailyContent.data.dailyContent.myMessage, '手记新留言')

  const otherUser = await request('/api/miniapp/letters', { visitorId: 'message-replacement-b' })
  assert.equal(otherUser.data.items.find((item) => item.id === letterId).myMessage, '')
  const forgedAnonymous = await fetch(`${baseUrl}/api/miniapp/letters`, {
    headers: headers(accountId),
  })
  const forgedAnonymousData = await forgedAnonymous.json()
  assert.equal(forgedAnonymous.status, 200)
  assert.equal(forgedAnonymousData.items.find((item) => item.id === letterId).myMessage, '')
  const stored = getMessages({ source: 'letters' }).filter((item) => item.content === '心笺最终留言' || item.content === '心笺旧留言')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].content, '心笺最终留言')
})

test('P0: 留言接口按 200 加权额度拒绝超限内容且不静默截断', async () => {
  const visitorId = 'message-weighted-limit-a'
  const letters = await request('/api/miniapp/letters', { visitorId })
  const letterId = letters.data.items[0].id
  const exactContent = `${'a'.repeat(198)}中`

  const rejected = await request('/api/miniapp/messages', {
    method: 'POST',
    visitorId,
    body: { source: 'letters', sourceId: letterId, content: `${exactContent}x` },
  })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.data.message, '最多可输入 100 个中文字符')

  const accepted = await request('/api/miniapp/messages', {
    method: 'POST',
    visitorId,
    body: { source: 'letters', sourceId: letterId, content: exactContent },
  })
  assert.equal(accepted.status, 201)

  const accountId = getMiniAppSession(await getSessionToken(visitorId), 'mp1').accountId
  const stored = getCurrentMessages({ miniProgramId: 'mp1', accountId }, 'letters', [letterId]).get(letterId)
  assert.equal(stored.content, exactContent)
})

test('P0: 删除当前留言只移除留言状态，并同步更新列表、统计和互动标签', async () => {
  const visitorId = 'message-delete-a'
  const letters = await request('/api/miniapp/letters', { visitorId })
  const letter = letters.data.items[0]
  const liked = await request('/api/miniapp/interactions/toggle', {
    method: 'POST', visitorId, body: { source: 'letters', sourceId: letter.id, type: 'like' },
  })
  const shared = await request('/api/miniapp/interactions/share', {
    method: 'POST', visitorId, body: { source: 'letters', sourceId: letter.id },
  })
  const favorited = await request('/api/miniapp/interactions/toggle', {
    method: 'POST', visitorId, body: { source: 'letters', sourceId: letter.id, type: 'favorite' },
  })
  const otherVisitorId = 'message-delete-other-user'
  await request('/api/miniapp/interactions/toggle', {
    method: 'POST', visitorId: otherVisitorId, body: { source: 'letters', sourceId: letter.id, type: 'like' },
  })
  await request('/api/miniapp/interactions/share', {
    method: 'POST', visitorId: otherVisitorId, body: { source: 'letters', sourceId: letter.id },
  })
  assert.equal(liked.status, 200)
  assert.equal(shared.status, 201)
  assert.equal(favorited.status, 200)
  const created = await request('/api/miniapp/messages', {
    method: 'POST', visitorId, body: { source: 'letters', sourceId: letter.id, content: '删除前的留言' },
  })
  assert.equal(created.status, 201)
  const homeWithMessage = await request('/api/miniapp/home', { visitorId })
  const companionWithMessage = Number(homeWithMessage.data.stats.find((item) => item.key === 'companionValue').value.replace('点', ''))
  const activityWithMessage = await request('/api/miniapp/activity', { visitorId })
  const contentWithMessage = await request('/api/miniapp/letters', { visitorId })
  const stateBeforeDelete = contentWithMessage.data.items.find((item) => item.id === letter.id)
  assert.equal(activityWithMessage.data.summary.messages, 1)
  assert.deepEqual(activityWithMessage.data.interactions[0].actions, ['点赞', '分享', '留言'])

  const deleted = await deletePrivateMessage({ source: 'letters', sourceId: letter.id, visitorId })
  const repeated = await deletePrivateMessage({ source: 'letters', sourceId: letter.id, visitorId })
  assert.equal(deleted.status, 200)
  assert.equal(deleted.data.deleted, true)
  assert.equal(repeated.status, 200)
  assert.equal(repeated.data.deleted, false)

  const refreshed = await request('/api/miniapp/letters', { visitorId })
  const after = await request('/api/miniapp/activity', { visitorId })
  const homeWithoutMessage = await request('/api/miniapp/home', { visitorId })
  const companionWithoutMessage = Number(homeWithoutMessage.data.stats.find((item) => item.key === 'companionValue').value.replace('点', ''))
  const stateAfterDelete = refreshed.data.items.find((item) => item.id === letter.id)
  const otherActivity = await request('/api/miniapp/activity', { visitorId: otherVisitorId })
  assert.equal(stateAfterDelete.myMessage, '')
  assert.equal(stateAfterDelete.liked, true)
  assert.equal(stateAfterDelete.favorited, true)
  assert.equal(stateAfterDelete.likeCount, stateBeforeDelete.likeCount)
  assert.equal(stateAfterDelete.favoriteCount, stateBeforeDelete.favoriteCount)
  assert.equal(after.data.summary.messages, 0)
  assert.deepEqual(after.data.interactions.find((item) => item.id === `interaction-letters-${letter.id}`).actions, ['点赞', '分享'])
  assert.deepEqual(otherActivity.data.interactions[0].actions, ['点赞', '分享'])
  assert.equal(companionWithoutMessage, companionWithMessage - 1)
})

test('P0: 删除文章和手记留言后，重新加载仍不返回旧值', async () => {
  const visitorId = 'message-delete-other-sources'
  const articles = await request('/api/miniapp/articles', { visitorId })
  const articleId = articles.data.items[0].id
  const opened = await request('/api/miniapp/daily-content/open', {
    method: 'POST', visitorId, body: { type: 'text' },
  })
  const dailyContentId = opened.data.dailyContent.id
  await request('/api/miniapp/messages', {
    method: 'POST', visitorId, body: { source: 'article', sourceId: articleId, content: '待删除文章留言' },
  })
  await request('/api/miniapp/messages', {
    method: 'POST', visitorId, body: { source: 'daily_content', sourceId: dailyContentId, content: '待删除手记留言' },
  })
  await deletePrivateMessage({ source: 'article', sourceId: articleId, visitorId })
  await deletePrivateMessage({ source: 'daily_content', sourceId: dailyContentId, visitorId })

  const refreshedArticles = await request('/api/miniapp/articles', { visitorId })
  const refreshedDailyContent = await request('/api/miniapp/daily-content/open', {
    method: 'POST', visitorId, body: { type: 'text', contentId: dailyContentId },
  })
  const activity = await request('/api/miniapp/activity', { visitorId })
  assert.equal(refreshedArticles.data.items.find((item) => item.id === articleId).myMessage, '')
  assert.equal(refreshedDailyContent.data.dailyContent.id, dailyContentId)
  assert.equal(refreshedDailyContent.data.dailyContent.myMessage, '')
  assert.equal(activity.data.interactions.some((item) => item.id === `interaction-article-${articleId}`), false)
})

test('P0: 删除留言要求登录、校验内容且无法删除其他用户留言', async () => {
  const visitorId = 'message-delete-owner'
  const letters = await request('/api/miniapp/letters', { visitorId })
  const letterId = letters.data.items[0].id
  await request('/api/miniapp/messages', {
    method: 'POST', visitorId, body: { source: 'letters', sourceId: letterId, content: '仅本人可删' },
  })
  const foreign = await deletePrivateMessage({ source: 'letters', sourceId: letterId, visitorId: 'message-delete-other' })
  const invalid = await deletePrivateMessage({ source: 'letters', sourceId: 'missing', visitorId })
  const ownerRefresh = await request('/api/miniapp/letters', { visitorId })
  const unauthenticated = await fetch(`${baseUrl}/api/miniapp/messages`, {
    method: 'DELETE',
    headers: headers('message-delete-forged'),
    body: JSON.stringify({ source: 'letters', sourceId: letterId }),
  })
  assert.equal(foreign.status, 200)
  assert.equal(foreign.data.deleted, false)
  assert.equal(invalid.status, 400)
  assert.equal(ownerRefresh.data.items.find((item) => item.id === letterId).myMessage, '仅本人可删')
  assert.equal(unauthenticated.status, 401)
})

test('P0: 文章写入独立打开记录，心笺不写打开记录', () => {
  const context = { miniProgramId: 'mp1', visitorId: 'opened-source-guard' }

  assert.equal(recordOpened(context, 'letters', { id: 'letter-001', type: 'text' }), null)
  const article = recordOpened(context, 'article', { id: 'article-001', title: '一篇文章' })
  assert.equal(article.source, 'article')
  assert.equal(article.type, 'article')
  assert.equal(article.preview, '一篇文章')
  assert.equal(getOpened(context).length, 1)
  assert.equal(countEvents('daily_content_open', context), 0)

  const recorded = recordOpened(context, 'daily_content', {
    id: 'content-text-001',
    type: 'text',
    text: '手记内容',
  })
  assert.equal(recorded.source, 'daily_content')
  assert.equal(recorded.type, 'text')
  assert.equal(getOpened(context).length, 2)
  assert.equal(countEvents('daily_content_open', context), 1)
})

test('P0: 下一个手记排除当前内容，图册打开记录保留预览图片', async () => {
  const visitorId = 'acceptance-next-daily-content'
  const first = await request('/api/miniapp/daily-content/open', {
    method: 'POST',
    visitorId,
    body: { type: 'text' },
  })
  assert.equal(first.status, 201)
  assert.equal('label' in first.data.dailyContent, false)

  const next = await request('/api/miniapp/daily-content/open', {
    method: 'POST',
    visitorId,
    body: { type: 'random', excludeId: first.data.dailyContent.id },
  })
  assert.equal(next.status, 201)
  assert.notEqual(next.data.dailyContent.id, first.data.dailyContent.id)
  assert.equal(next.data.dailyContent.type, 'album')
  assert.equal('label' in next.data.dailyContent, false)
  assert.ok(next.data.dailyContent.images.every((image) => typeof image.originalUrl === 'string'))

  const activity = await request('/api/miniapp/activity', { visitorId })
  const albumRecord = activity.data.totalOpened.find((item) => item.id && item.type === 'album')
  assert.equal(albumRecord.images.length, 3)
  assert.ok(albumRecord.images.every((image) => image.thumbUrl && image.mediumUrl))
  assert.ok(albumRecord.images.every((image) => typeof image.originalUrl === 'string'))
  const snapshot = getDatabase().prepare('SELECT item_json FROM opened_records WHERE opened_id = ?').get(albumRecord.id)
  const legacyRecord = JSON.parse(snapshot.item_json)
  legacyRecord.images = legacyRecord.images.map(({ originalUrl, ...image }) => image)
  getDatabase().prepare('UPDATE opened_records SET item_json = ? WHERE opened_id = ?').run(JSON.stringify(legacyRecord), albumRecord.id)
  const assetId = albumRecord.images[0].id
  const assetRow = getDatabase().prepare('SELECT item_json FROM image_assets WHERE asset_id = ?').get(assetId)
  const asset = { ...JSON.parse(assetRow.item_json), originalUrl: 'https://example.test/original-history.jpg' }
  try {
    getDatabase().prepare('UPDATE image_assets SET item_json = ? WHERE asset_id = ?').run(JSON.stringify(asset), assetId)
    const legacyActivity = await request('/api/miniapp/activity', { visitorId })
    const restoredRecord = legacyActivity.data.totalOpened.find((item) => item.id === albumRecord.id)
    assert.equal(restoredRecord.images[0].originalUrl, asset.originalUrl)
    assert.deepEqual(restoredRecord.images.map((image) => image.thumbUrl), albumRecord.images.map((image) => image.thumbUrl))
  } finally {
    getDatabase().prepare('UPDATE image_assets SET item_json = ? WHERE asset_id = ?').run(assetRow.item_json, assetId)
  }
})

test('P0: 收藏图册保留九张图片，缺图图册也保持图册类型', async () => {
  const visitorId = 'favorite-album-contract'
  const originalAlbums = getContentSnapshot('pool-1').dailyContents.filter((item) => item.type === 'album')
  const nineImageAlbum = {
    id: 'favorite-album-nine-images',
    label: '九张图片图册',
    images: Array.from({ length: 9 }, () => ({ id: 'img-001' })),
  }
  const unavailableAlbum = {
    id: 'favorite-album-unavailable-images',
    label: '缺图图册',
    images: [{ id: 'missing-image-asset' }],
  }

  try {
    updateContentAlbums([...originalAlbums, nineImageAlbum, unavailableAlbum], 'pool-1')
    for (const sourceId of [nineImageAlbum.id, unavailableAlbum.id]) {
      const favorite = await request('/api/miniapp/interactions/toggle', {
        method: 'POST',
        visitorId,
        body: { source: 'daily_content', sourceId, type: 'favorite' },
      })
      assert.equal(favorite.status, 200)
      assert.equal(favorite.data.interaction.favorited, true)
    }

    const activity = await request('/api/miniapp/activity?section=favorites', { visitorId })
    assert.equal(activity.status, 200)
    const favorites = new Map(activity.data.favorites.map((item) => [item.sourceId, item]))
    const nineImageFavorite = favorites.get(nineImageAlbum.id)
    const unavailableFavorite = favorites.get(unavailableAlbum.id)
    assert.deepEqual({ type: nineImageFavorite.type, preview: nineImageFavorite.preview }, { type: 'album', preview: '' })
    assert.equal(nineImageFavorite.images.length, 9)
    assert.ok(nineImageFavorite.images.every((image) => image.thumbUrl && image.mediumUrl && typeof image.originalUrl === 'string'))
    assert.deepEqual({ type: unavailableFavorite.type, preview: unavailableFavorite.preview, images: unavailableFavorite.images }, {
      type: 'album', preview: '', images: [],
    })
  } finally {
    updateContentAlbums(originalAlbums, 'pool-1')
  }
})

test('P0: 个人资料按用户隔离，手动保存后生效', async () => {
  const updated = await request('/api/miniapp/profile', {
    method: 'POST',
    body: { nickname: '验收用户', phone: '13800000000', avatarText: '验' },
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.profile.nickname, '验收用户')
  assert.equal(updated.data.profile.phone, '')
  assert.equal(updated.data.profile.phoneAuthorized, false)

  const profile = await request('/api/miniapp/profile')
  assert.equal(profile.data.profile.nickname, '验收用户')

  const otherProfile = await request('/api/miniapp/profile', { visitorId: 'acceptance-b' })
  assert.equal(otherProfile.data.profile.nickname, '轻读用户')

})

test('P0: 头像上传拒绝伪造的图片文件', async () => {
  const response = await avatarRequest()

  assert.equal(response.status, 400)
  assert.match(response.data.message, /头像格式无效/)
})

test('P0: 头像上传在超过 200KB 时立即中止请求', async () => {
  await assert.rejects(
    avatarRequest({
      visitorId: 'avatar-file-too-large',
      content: Buffer.alloc((200 * 1024) + 1, 0),
    }),
    /fetch failed|socket|aborted|closed/i,
  )
})

test('P0: COS 头像上传失败记录安全诊断并返回错误编号', async () => {
  const settingsBefore = getInternalAdminSettings()
  const storage = {
    ...settingsBefore.storage,
    bucket: 'avatar-processing-error-1250000000',
    region: 'ap-chengdu',
    secretId: 'avatar-processing-error-secret-id',
    secretKey: 'avatar-processing-error-secret-key',
  }
  const originalFetch = global.fetch
  updateAdminSettings({ storage })
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input))
    if (url.hostname === `${storage.bucket}.cos.${storage.region}.myqcloud.com`) {
      if (options.method === 'PUT') {
        return new Response('<Error><Code>AccessDenied</Code><Message>Upload permission denied</Message></Error>', {
          status: 400,
          headers: { 'content-type': 'application/xml' },
        })
      }
      return new Response('', { status: 200 })
    }
    return originalFetch(input, options)
  }

  try {
    const response = await avatarRequest({
      visitorId: 'avatar-processing-error',
      content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    })
    assert.equal(response.status, 400)
    assert.match(response.data.message, /头像处理失败/)
    assert.match(response.data.message, /AccessDenied/)
    assert.doesNotMatch(response.data.message, /Upload permission denied/)

    const accountId = getMiniAppSession(sessionTokens.get('avatar-processing-error'), 'mp1').accountId
    const log = getInternalAdminSettings().operationLogs.find((item) => item.type === '头像上传失败' && item.target === accountId)
    assert.ok(log)
    assert.match(log.description, /HTTP 400/)
    assert.match(log.description, /COS Code: AccessDenied/)
    assert.match(log.description, /COS Message: Upload permission denied/)
    assert.doesNotMatch(log.description, /avatar-processing-error-secret-key/)
  } finally {
    global.fetch = originalFetch
    updateAdminSettings({ storage: settingsBefore.storage })
  }
})

test('P1: 头像替换只清理当前账号的服务端头像对象，并兼容历史前缀', async () => {
  const visitorId = 'avatar-replacement-cleanup'
  const settingsBefore = getInternalAdminSettings()
  const storage = {
    ...settingsBefore.storage,
    bucket: 'avatar-test-1250000000',
    region: 'ap-chengdu',
    secretId: 'avatar-test-secret-id',
    secretKey: 'avatar-test-secret-key',
    url: 'https://media.example.com/assets',
  }
  updateAdminSettings({ storage })
  const profileUpdate = await request('/api/miniapp/profile', {
    method: 'POST',
    visitorId,
    body: { avatarUrl: `${storage.url}/assets-v1/avatars/old/avatar.jpg` },
  })
  assert.equal(profileUpdate.status, 200)
  assert.equal(profileUpdate.data.profile.avatarUrl, '')
  const accountId = getMiniAppSession(sessionTokens.get(visitorId), 'mp1').accountId
  const oldAvatarKey = `assets-v1/avatars/${accountId}/mabc123-0123456789abcdef.jpg`
  updateProfile({ accountId, miniProgramId: 'mp1', visitorId }, {
    avatarUrl: `${storage.url}/${oldAvatarKey}`,
  })

  const originalFetch = global.fetch
  const deletedPaths = []
  const uploadPaths = []
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input))
    if (url.hostname === `${storage.bucket}.cos.${storage.region}.myqcloud.com`) {
      if (options.method === 'DELETE') deletedPaths.push(decodeURIComponent(url.pathname))
      if (options.method === 'PUT') uploadPaths.push({
        path: decodeURIComponent(url.pathname),
        picOperations: options.headers['pic-operations'],
      })
      return new Response('', { status: 200 })
    }
    return originalFetch(input, options)
  }

  try {
    const response = await avatarRequest({
      visitorId,
      content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    })
    assert.equal(response.status, 200)
    assert.match(response.data.profile.avatarUrl, /^https:\/\/media\.example\.com\/assets\/secretbox\/avatars\//)
    assert.equal(deletedPaths.includes(`/${oldAvatarKey}`), true)
    assert.equal(deletedPaths.includes('/assets-v1/avatars/old/avatar.jpg'), false)
    assert.equal(deletedPaths.some((item) => /-source\.jpg$/.test(item)), false)
    assert.equal(uploadPaths.length, 1)
    assert.equal(uploadPaths[0].picOperations, undefined)
    assert.equal(new URL(response.data.profile.avatarUrl).pathname.endsWith(uploadPaths[0].path), true)
  } finally {
    global.fetch = originalFetch
    updateAdminSettings({ storage: settingsBefore.storage })
  }
})

test('P1: 登录复核与已登录首页访问统一去重，短时间刷新不重复记录', async () => {
  const visitorId = 'home-page-view-dedupe'
  const before = getAnalyticsEvents().filter((item) => item.type === 'page_view' && item.visitorId === visitorId).length
  const anonymousFirst = await fetch(`${baseUrl}/api/miniapp/home`, { headers: headers(visitorId) })
  const anonymousSecond = await fetch(`${baseUrl}/api/miniapp/home`, { headers: headers(visitorId) })
  assert.equal(anonymousFirst.status, 200)
  assert.equal(anonymousSecond.status, 200)
  const afterAnonymous = getAnalyticsEvents().filter((item) => item.type === 'page_view' && item.visitorId === visitorId).length
  assert.equal(afterAnonymous, before)

  const sessionToken = await getSessionToken(visitorId)
  const accountId = getMiniAppSession(sessionToken, 'mp1').accountId
  const beforeAuthenticated = getAnalyticsEvents().filter((item) => item.type === 'page_view' && item.visitorId === accountId).length
  const requestOptions = { headers: headers(visitorId, sessionToken) }
  const first = await fetch(`${baseUrl}/api/miniapp/home`, requestOptions)
  const second = await fetch(`${baseUrl}/api/miniapp/home`, requestOptions)
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  const after = getAnalyticsEvents().filter((item) => item.type === 'page_view' && item.visitorId === accountId).length
  assert.equal(beforeAuthenticated, 1)
  assert.equal(after - beforeAuthenticated, 0)
})

test('P0/P1: 服务端拒绝无效互动和超额打开，并返回缩略图与预览图', async () => {
  const visitorId = 'acceptance-limit'
  const articles = await request('/api/miniapp/articles', { visitorId })
  assert.equal(articles.status, 200)
  assert.ok(articles.data.items.every((item) => !('label' in item)))
  const image = articles.data.items.find((item) => item.coverImage)?.coverImage
  assert.ok(image?.thumbUrl)
  assert.ok(image?.mediumUrl)
  assert.match(image.thumbUrl, /\/api\/media\/image\?id=article-cover-001&variant=thumb$/)
  assert.match(image.mediumUrl, /\/api\/media\/image\?id=article-cover-001&variant=medium$/)
  assert.equal('label' in image, false)
  assert.doesNotMatch(image.thumbUrl, /%3Ctext/)

  const media = await mediaRequest('/api/media/image?id=article-cover-001&variant=medium')
  assert.equal(media.status, 200)
  assert.match(media.contentType, /^image\//)
  assert.ok(media.body.byteLength > 0)

  const svgMedia = await mediaRequest('/api/media/image?id=svg-img-001&variant=medium')
  assert.equal(svgMedia.status, 200)
  assert.match(svgMedia.contentType, /^image\/svg\+xml/)
  assert.ok(svgMedia.body.byteLength > 0)

  const invalid = await request('/api/miniapp/interactions/toggle', {
    method: 'POST',
    visitorId,
    body: { source: 'letters', sourceId: 'missing', type: 'favorite' },
  })
  assert.equal(invalid.status, 400)

  for (let index = 0; index < 3; index += 1) {
    const opened = await request('/api/miniapp/daily-content/open', {
      method: 'POST',
      visitorId,
      body: { type: 'random' },
    })
    assert.equal(opened.status, 201)
    const dailyContent = opened.data.dailyContent
    assert.equal(Boolean(dailyContent.text) && Array.isArray(dailyContent.images), false)
  }
  const overflow = await request('/api/miniapp/daily-content/open', {
    method: 'POST',
    visitorId,
    body: { type: 'random' },
  })
  assert.equal(overflow.status, 400)
  assert.equal(overflow.data.message, '暂无可打开内容')

  const blocked = await request('/api/miniapp/messages', {
    method: 'POST',
    visitorId,
    body: { source: 'article', sourceId: articles.data.items[0].id, content: '广告内容' },
  })
  assert.equal(blocked.status, 400)
})

test('P0: 后台关键词必须先于微信文本安全检测拦截留言', () => {
  const script = `
    global.fetch = async () => { throw new Error('不应调用微信接口') }
    const { checkMessageBeforeSave } = require('./src/modules/messages/message-security.service')
    checkMessageBeforeSave('这是广告内容').then((result) => {
      process.exit(result.status === 'blocked' && result.keyword === '广告' ? 0 : 1)
    })
  `
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      MINIAPP_DATA_DIR: dataDir,
      NODE_ENV: 'production',
      WECHAT_APP_ID: 'wx0123456789abcdef',
      WECHAT_APP_SECRET: 'test-secret',
    },
  })

  assert.equal(child.status, 0, child.stderr || child.stdout)
})

test('P0: COS 上传使用后台配置的文件夹前缀', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const settings = await adminRequest('/api/admin/settings', { cookie })
  const savedSettings = await adminRequest('/api/admin/settings', {
    method: 'POST',
    cookie,
    body: {
      storage: {
        ...settings.data.storage,
        folderPrefix: 'secretbox',
        secretId: 'test-secret-id',
        secretKey: 'test-secret-key',
        bucket: 'test-1250000000',
        region: 'ap-chengdu',
        url: 'https://test-1250000000.cos.ap-chengdu.myqcloud.com/assets',
      },
    },
  })

  const prepared = await adminRequest('/api/admin/images/upload/prepare', {
    method: 'POST',
    cookie,
    body: { name: '文章封面.png', size: 1024, type: 'image/png', usage: 'article' },
  })

  assert.equal(prepared.status, 200)
  assert.match(prepared.data.upload.key, /^secretbox\/uploads\/\d{4}\/\d{2}\/\d{2}\//)
  assert.doesNotMatch(prepared.data.upload.key, /[^\x00-\x7f]/)
  assert.doesNotMatch(prepared.data.upload.headers['pic-operations'], /[^\x00-\x7f]/)
  const imageOperations = JSON.parse(prepared.data.upload.headers['pic-operations'])
  assert.equal(imageOperations.rules[0].rule, 'imageMogr2/thumbnail/1280x1280>/format/jpg/quality/82')
  assert.equal(imageOperations.rules[1].rule, 'imageMogr2/thumbnail/480x480>/format/jpg/quality/72')
  assert.equal(imageOperations.rules.every((rule) => rule.bucket === savedSettings.data.storage.bucket), true)
  assert.equal(imageOperations.rules.every((rule) => rule.fileid.startsWith('%2F')), true)
  const uploadDirectory = prepared.data.upload.key.replace(/\/original\.[^/]+$/, '')
  const operationKeys = [
    `${uploadDirectory}/medium.jpg`,
    `${uploadDirectory}/thumb.jpg`,
  ]
  assert.deepEqual(
    imageOperations.rules.map((rule) => decodeURIComponent(rule.fileid)),
    operationKeys.map((key) => `/${key}`),
  )
  assert.deepEqual(
    [prepared.data.urls.mediumUrl, prepared.data.urls.thumbUrl]
      .map((url) => decodeURIComponent(new URL(url).pathname)),
    operationKeys.map((key) => `/assets/${key}`),
  )
  assert.equal(prepared.data.task.originalName, '文章封面.png')
  assert.match(prepared.data.urls.originalUrl, /\/secretbox\/uploads\//)
  assert.match(prepared.data.urls.mediumUrl, /\/secretbox\/uploads\//)
  assert.match(prepared.data.urls.thumbUrl, /\/secretbox\/uploads\//)

  const preparedShareBackground = await adminRequest('/api/admin/images/upload/prepare', {
    method: 'POST',
    cookie,
    body: { name: 'share-background.png', size: 1024, type: 'image/png', usage: 'share-background' },
  })
  assert.equal(preparedShareBackground.status, 200)
  const shareBackgroundOperations = JSON.parse(preparedShareBackground.data.upload.headers['pic-operations'])
  assert.deepEqual(
    shareBackgroundOperations.rules.map((rule) => rule.rule),
    [
      'imageMogr2/rcrop/500x400/format/jpg/quality/82',
      'imageMogr2/rcrop/250x200/format/jpg/quality/72',
    ],
  )

  const preparedBatch = await adminRequest('/api/admin/images/upload/prepare-batch', {
    method: 'POST',
    cookie,
    body: {
      items: [
        { clientId: 'batch-image-a', name: '01.jpg', size: 1024, type: 'image/jpeg' },
        { clientId: 'batch-image-b', name: '02.png', size: 1024, type: 'image/png' },
      ],
    },
  })
  assert.equal(preparedBatch.status, 200)
  assert.deepEqual(preparedBatch.data.items.map((item) => item.clientId), ['batch-image-a', 'batch-image-b'])
  assert.equal(preparedBatch.data.items.every((item) => item.task.token && item.upload.uploadUrl), true)

  const originalFetch = global.fetch
  global.fetch = async (input, options = {}) => {
    if (options.method === 'HEAD') return new Response('', { status: 200 })
    return originalFetch(input, options)
  }
  let completedBatch
  try {
    completedBatch = await adminRequest('/api/admin/images/upload/complete-batch', {
      method: 'POST',
      cookie,
      body: {
        items: preparedBatch.data.items.map((item) => ({
          clientId: item.clientId,
          imageId: item.task.imageId,
          label: item.task.label,
          mediumUrl: item.urls.mediumUrl,
          originalName: item.task.originalName,
          originalSize: item.task.originalSize,
          originalUrl: item.urls.originalUrl,
          taskId: item.task.id,
          thumbUrl: item.urls.thumbUrl,
          token: item.task.token,
          usage: item.task.usage,
        })),
      },
    })
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(completedBatch.status, 200)
  assert.deepEqual(completedBatch.data.items.map((item) => item.clientId), ['batch-image-a', 'batch-image-b'])
  assert.equal(completedBatch.data.items.every((item) => item.item.id && item.item.status === 'ready'), true)
})

test('P0: 通用图片直传的 COS 派生图目标键使用绝对路径并经过 URI 编码', () => {
  const operations = makePicOperations({
    bucket: 'test-1250000000',
    mediumKey: '/secretbox/文章 封面?#.jpg',
    thumbKey: '/secretbox/缩略 图?#.jpg',
    usage: 'article',
  })

  assert.deepEqual(
    operations.rules.map((rule) => rule.fileid),
    [
      '%2Fsecretbox%2F%E6%96%87%E7%AB%A0%20%E5%B0%81%E9%9D%A2%3F%23.jpg',
      '%2Fsecretbox%2F%E7%BC%A9%E7%95%A5%20%E5%9B%BE%3F%23.jpg',
    ],
  )
  assert.equal(operations.rules.every((rule) => rule.fileid.startsWith('%2F')), true)
  assert.deepEqual(
    operations.rules.map((rule) => rule.rule),
    [
      'imageMogr2/thumbnail/1280x1280>/format/jpg/quality/82',
      'imageMogr2/thumbnail/480x480>/format/jpg/quality/72',
    ],
  )
})

test('P0: 文章封面拒绝 GIF，其他图片上传用途不受影响', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const cover = await adminRequest('/api/admin/images/upload/prepare', {
    method: 'POST',
    cookie,
    body: { name: 'animated-cover.gif', size: 1024, type: 'image/gif', usage: 'article' },
  })

  assert.equal(cover.status, 400)
  assert.match(cover.data.message, /封面仅支持 JPG、PNG 或 WebP/)
})

test('P0: 私密音频保留原始文件名，并按小程序开关投放', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const settingsBefore = await adminRequest('/api/admin/settings', { cookie })
  const contentBefore = await adminRequest('/api/admin/content', { cookie })
  const currentMiniProgramId = settingsBefore.data.currentMiniProgramId

  await adminRequest('/api/admin/settings', {
    method: 'POST',
    cookie,
    body: {
      storage: {
        ...settingsBefore.data.storage,
        folderPrefix: 'secretbox',
        secretId: 'test-secret-id',
        secretKey: 'test-secret-key',
      },
    },
  })

  try {
    const completed = {
      id: 'content-audio-acceptance',
      label: '默认',
      title: '留给夜晚的轻读音频',
      originalFilename: '留给夜晚的轻读音频.m4a',
      objectKey: 'secretbox/audio/2026/08/16/acceptance.m4a',
      audioUrl: 'https://example.com/secretbox/audio/2026/08/16/acceptance.m4a',
      contentType: 'audio/mp4',
      durationSeconds: 24.6,
      sizeBytes: 1024,
      likeCount: 0,
      favoriteCount: 0,
    }
    assert.equal(completed.title, '留给夜晚的轻读音频')
    assert.equal(completed.originalFilename, '留给夜晚的轻读音频.m4a')
    assert.equal('status' in completed, false)

    const appended = await adminRequest('/api/admin/content/items', {
      method: 'POST',
      cookie,
      body: { type: 'contentAudios', items: [completed] },
    })
    assert.equal(appended.status, 200)
    assert.equal(appended.data.contentAudios.some((item) => item.id === completed.id), true)
    assert.equal('status' in appended.data.contentAudios.find((item) => item.id === completed.id), false)

    const settingsWithAudioDisabled = settingsBefore.data.miniPrograms.map((item) => (
      item.id === currentMiniProgramId
        ? { ...item, config: { ...item.config, dailyContentTypes: { imageEnabled: false, audioEnabled: false } } }
        : item
    ))
    await adminRequest('/api/admin/settings', {
      method: 'POST',
      cookie,
      body: { miniPrograms: settingsWithAudioDisabled },
    })

    const disabledAudio = await request('/api/miniapp/daily-content/open', {
      method: 'POST',
      visitorId: 'audio-delivery-disabled',
      body: { type: 'audio' },
    })
    assert.equal(disabledAudio.status, 400)
    assert.match(disabledAudio.data.message, /该类型手记暂不可用/)

    const settingsWithAudioEnabled = settingsWithAudioDisabled.map((item) => (
      item.id === currentMiniProgramId
        ? { ...item, config: { ...item.config, dailyContentTypes: { imageEnabled: false, audioEnabled: true } } }
        : item
    ))
    await adminRequest('/api/admin/settings', {
      method: 'POST',
      cookie,
      body: { miniPrograms: settingsWithAudioEnabled },
    })

    const audio = await request('/api/miniapp/daily-content/open', {
      method: 'POST',
      visitorId: 'audio-delivery-enabled',
      body: { type: 'audio' },
    })
    assert.equal(audio.status, 201)
    assert.equal(audio.data.dailyContent.type, 'audio')
    assert.equal(audio.data.dailyContent.originalFilename, '留给夜晚的轻读音频.m4a')
    assert.equal(audio.data.dailyContent.audioUrl, completed.audioUrl)
  } finally {
    await adminRequest('/api/admin/content', {
      method: 'POST',
      cookie,
      body: { contentAudios: contentBefore.data.contentAudios || [] },
    })
    await adminRequest('/api/admin/settings', {
      method: 'POST',
      cookie,
      body: { miniPrograms: settingsBefore.data.miniPrograms },
    })
  }
})

test('P0: 留言审核仅支持拦截和恢复通过', async () => {
  const visitorId = 'message-moderation-a'
  const articles = await request('/api/miniapp/articles', { visitorId })
  assert.equal(articles.status, 200)

  const created = await request('/api/miniapp/messages', {
    method: 'POST',
    visitorId,
    body: { source: 'article', sourceId: articles.data.items[0].id, content: '这是一条待审核留言。' },
  })
  assert.equal(created.status, 201)

  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const messageId = created.data.messageId

  const invalidStatus = await adminRequest('/api/admin/messages/status', {
    method: 'POST',
    cookie,
    body: { id: messageId, status: 'pending' },
  })
  assert.equal(invalidStatus.status, 400)

  const blocked = await adminRequest('/api/admin/messages/status', {
    method: 'POST',
    cookie,
    body: { id: messageId, status: 'blocked' },
  })
  assert.equal(blocked.status, 200)
  assert.equal(blocked.data.status, 'blocked')

  const blockedActivity = await request('/api/miniapp/activity', { visitorId })
  assert.equal(blockedActivity.status, 200)
  assert.equal(blockedActivity.data.messages.some((item) => item.id === messageId), false)

  const restored = await adminRequest('/api/admin/messages/status', {
    method: 'POST',
    cookie,
    body: { id: messageId, status: 'saved' },
  })
  assert.equal(restored.status, 200)
  assert.equal(restored.data.status, 'saved')

  const restoredActivity = await request('/api/miniapp/activity', { visitorId })
  assert.equal(restoredActivity.status, 200)
  assert.equal(restoredActivity.data.messages.some((item) => item.id === messageId), true)
})

test('P0: 编辑内容池不会修改小程序绑定关系', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const settingsBefore = await adminRequest('/api/admin/settings', { cookie })
  const currentMiniProgram = settingsBefore.data.miniPrograms.find((item) => item.id === settingsBefore.data.currentMiniProgramId)
  const editingPool = settingsBefore.data.contentPools.find((item) => item.id !== currentMiniProgram.config.contentPoolId)
  const liveContentBefore = await request('/api/miniapp/letters')

  assert.ok(editingPool)
  const selected = await adminRequest(`/api/admin/content?poolId=${editingPool.id}`, { cookie })
  assert.equal(selected.status, 200)
  assert.equal(selected.data.poolId, editingPool.id)

  const saved = await adminRequest('/api/admin/content', {
    method: 'POST',
    cookie,
    body: {
      poolId: editingPool.id,
      contentTexts: [{ id: 'pool-isolated-note', label: '独立内容池', text: '这条内容不应改变小程序绑定。' }],
    },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.data.poolId, editingPool.id)

  const settingsAfter = await adminRequest('/api/admin/settings', { cookie })
  const updatedMiniProgram = settingsAfter.data.miniPrograms.find((item) => item.id === currentMiniProgram.id)
  assert.equal(updatedMiniProgram.config.contentPoolId, currentMiniProgram.config.contentPoolId)
  assert.equal(settingsAfter.data.operationLogs[0].type, '内容变更')
  assert.equal(settingsAfter.data.operationLogs[0].target, editingPool.name)

  const anotherMiniProgram = settingsAfter.data.miniPrograms.find((item) => item.id !== currentMiniProgram.id)
  assert.ok(anotherMiniProgram)
  const operationLogCount = settingsAfter.data.operationLogs.length
  const switched = await adminRequest('/api/admin/settings', {
    method: 'POST',
    cookie,
    body: { currentMiniProgramId: anotherMiniProgram.id },
  })
  assert.equal(switched.status, 200)
  assert.equal(switched.data.operationLogs.length, operationLogCount)
  await adminRequest('/api/admin/settings', {
    method: 'POST',
    cookie,
    body: { currentMiniProgramId: currentMiniProgram.id },
  })

  const liveContentAfter = await request('/api/miniapp/letters')
  const byId = (items) => [...items].sort((left, right) => left.id.localeCompare(right.id))
  assert.deepEqual(byId(liveContentAfter.data.items), byId(liveContentBefore.data.items))
})

test('P0: 旧版通用底图下发原图，避免继续使用低清 medium', () => {
  const legacyId = 'legacy-share-background-001'
  updateImages([{
    id: legacyId,
    status: 'ready',
    processingMode: 'cos-ci-direct',
    originalUrl: 'https://cdn.example.com/legacy-original.jpg',
    mediumUrl: 'https://cdn.example.com/legacy-medium-125.jpg',
    thumbUrl: 'https://cdn.example.com/legacy-thumb.jpg',
  }])
  const result = toMiniProgramShareSettings({
    version: 1,
    private: { backgrounds: [{ id: 'legacy-bg', imageId: legacyId, imageUrl: 'https://cdn.example.com/legacy-medium-125.jpg' }] },
  })
  assert.equal(result.private.backgrounds[0].imageUrl, 'https://cdn.example.com/legacy-original.jpg')
})

test('P0: 封面文案样式只从全局接口保存并随文案包下发', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const settingsBefore = await adminRequest('/api/admin/settings', { cookie })
  const shareSettings = settingsBefore.data.shareSettings
  const coverStyle = shareSettings.private.coverStyle

  try {
    const saved = await adminRequest('/api/admin/share-settings', {
      method: 'POST',
      cookie,
      body: {
        shareSettings: {
          ...shareSettings,
          private: {
            ...shareSettings.private,
            coverStyle: {
              ...coverStyle,
              copyLineHeight: 20,
              dividerGap: 20,
            },
          },
        },
      },
    })
    assert.equal(saved.status, 200)

    const downloaded = await request('/api/miniapp/copy-pack')
    assert.equal(downloaded.status, 200)
    assert.equal('copyLineHeight' in downloaded.data.copyPack.share.private.coverStyle, false)
    assert.equal(downloaded.data.copyPack.share.private.coverStyle.copyFontSize, coverStyle.copyFontSize)
    assert.equal(downloaded.data.copyPack.share.private.coverStyle.dividerGap, 20)
  } finally {
    await adminRequest('/api/admin/share-settings', {
      method: 'POST',
      cookie,
      body: { shareSettings },
    })
  }
})

test('P0: Admin 手动注销只清理当前小程序，保留同一账号的其他小程序身份', async () => {
  const accountA = syncLogin({ miniProgramId: 'mp1', visitorId: 'manual-delete-mp1' }, {
    openid: 'manual-delete-openid-mp1',
    unionid: 'manual-delete-unionid',
    nickname: '多小程序用户',
  })
  const accountB = syncLogin({ miniProgramId: 'mp2', visitorId: 'manual-delete-mp2' }, {
    openid: 'manual-delete-openid-mp2',
    unionid: 'manual-delete-unionid',
    nickname: '多小程序用户',
  })
  assert.equal(accountA.accountId, accountB.accountId)
  const sessionA = createMiniAppSession({ accountId: accountA.accountId, miniProgramId: 'mp1' })
  const sessionB = createMiniAppSession({ accountId: accountA.accountId, miniProgramId: 'mp2' })

  const responseA = await fetch(`${baseUrl}/api/miniapp/check-in`, {
    method: 'POST',
    headers: headers('manual-delete-mp1', sessionA.token, 'wx03d0fa4e3c10441d'),
    body: '{}',
  })
  const responseB = await fetch(`${baseUrl}/api/miniapp/check-in`, {
    method: 'POST',
    headers: headers('manual-delete-mp2', sessionB.token, 'wx0987654321fedcba'),
    body: '{}',
  })
  assert.equal(responseA.status, 201)
  assert.equal(responseB.status, 201)

  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const scopedBefore = await adminRequest('/api/admin/accounts?miniProgramId=mp1', { cookie })
  assert.equal(scopedBefore.data.items.some((item) => item.accountId === accountA.accountId), true)

  const deletion = await adminRequest('/api/admin/accounts/delete', {
    method: 'POST',
    cookie,
    body: { accountId: accountA.accountId, miniProgramId: 'mp1' },
  })
  assert.equal(deletion.status, 200)
  assert.equal(deletion.data.accountRemoved, false)
  assert.equal(deletion.data.summary.sessions, 1)

  const deletedSession = await fetch(`${baseUrl}/api/miniapp/activity`, {
    headers: headers('manual-delete-mp1', sessionA.token, 'wx03d0fa4e3c10441d'),
  })
  const preservedSession = await fetch(`${baseUrl}/api/miniapp/activity`, {
    headers: headers('manual-delete-mp2', sessionB.token, 'wx0987654321fedcba'),
  })
  assert.equal(deletedSession.status, 401)
  assert.equal(preservedSession.status, 200)

  const remainingAccount = getAccounts().find((item) => item.accountId === accountA.accountId)
  assert.deepEqual(remainingAccount.miniProgramIds, ['mp2'])
  assert.equal(remainingAccount.wechatIdentities.some((item) => item.miniProgramId === 'mp1'), false)
  assert.equal(remainingAccount.wechatIdentities.some((item) => item.miniProgramId === 'mp2'), true)

  const scopedAfter = await adminRequest('/api/admin/accounts?miniProgramId=mp1', { cookie })
  assert.equal(scopedAfter.data.items.some((item) => item.accountId === accountA.accountId), false)
  const otherProgram = await adminRequest('/api/admin/accounts?miniProgramId=mp2', { cookie })
  assert.equal(otherProgram.data.items.some((item) => item.accountId === accountA.accountId), true)
})

test('P0: 历史 COS 头像清理失败不阻断 Admin 手动注销，并记录待处理项', async () => {
  const originalStorage = getInternalAdminSettings().storage
  const originalFetch = global.fetch
  const account = syncLogin({ miniProgramId: 'mp1', visitorId: 'manual-delete-cos-failure' }, {
    openid: 'manual-delete-cos-failure-openid',
    nickname: 'COS 清理失败用户',
  })
  const session = createMiniAppSession({ accountId: account.accountId, miniProgramId: 'mp1' })
  const avatarKey = `assets-v1/avatars/${account.accountId}/mabc123-0123456789abcdef.jpg`
  updateProfile({ accountId: account.accountId, miniProgramId: 'mp1', visitorId: 'manual-delete-cos-failure' }, {
    avatarUrl: `https://media.example.com/assets/${avatarKey}`,
  })
  updateAdminSettings({
    storage: {
      ...originalStorage,
      bucket: 'delete-failure-1250000000',
      region: 'ap-chengdu',
      secretId: 'delete-failure-secret-id',
      secretKey: 'delete-failure-secret-key',
      url: 'https://media.example.com/assets',
    },
  })

  try {
    global.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      if (url === `https://delete-failure-1250000000.cos.ap-chengdu.myqcloud.com/${avatarKey}`) {
        throw new Error('COS temporarily unavailable')
      }
      return originalFetch(input, init)
    }

    const login = await adminRequest('/api/admin/login', {
      method: 'POST',
      body: { account: 'admin', password: '123456' },
    })
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
    const deletion = await adminRequest('/api/admin/accounts/delete', {
      method: 'POST',
      cookie,
      body: { accountId: account.accountId, miniProgramId: 'mp1' },
    })

    assert.equal(deletion.status, 200)
    assert.equal(deletion.data.summary.sessions, 1)
    assert.equal(getMiniAppSession(session.token, 'mp1'), null)
    assert.equal(getAccounts().some((item) => item.accountId === account.accountId), false)
    await new Promise((resolve) => setImmediate(resolve))
    const cleanupLog = getInternalAdminSettings().operationLogs.find((item) => item.type === 'COS清理失败' && item.target === account.accountId)
    assert.match(cleanupLog.description, new RegExp(avatarKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(cleanupLog.description, /COS temporarily unavailable/)
  } finally {
    global.fetch = originalFetch
    updateAdminSettings({ storage: originalStorage })
  }
})

test('后台留言接口按 10/20/50/100 分页，并拒绝未支持的页容量', async () => {
  const marker = `分页验收-${Date.now()}`
  for (let index = 0; index < 21; index += 1) {
    createMessage({
      content: `${marker}-${index}`,
      miniProgramId: 'mp1',
      visitorId: `pagination-visitor-${index}`,
    })
  }
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const defaultPage = await adminRequest(`/api/admin/messages?keyword=${encodeURIComponent(marker)}`, { cookie })
  assert.equal(defaultPage.status, 200)
  assert.equal(defaultPage.data.pagination.pageSize, 10)
  assert.equal(defaultPage.data.pagination.totalPages, 3)
  assert.equal(defaultPage.data.items.length, 10)

  const secondPage = await adminRequest(`/api/admin/messages?keyword=${encodeURIComponent(marker)}&page=2&pageSize=20`, { cookie })
  assert.equal(secondPage.status, 200)
  assert.equal(secondPage.data.pagination.total, 21)
  assert.equal(secondPage.data.pagination.pageSize, 20)
  assert.equal(secondPage.data.pagination.totalPages, 2)
  assert.equal(secondPage.data.items.length, 1)

  const unsupportedSize = await adminRequest(`/api/admin/messages?keyword=${encodeURIComponent(marker)}&pageSize=30`, { cookie })
  assert.equal(unsupportedSize.status, 200)
  assert.equal(unsupportedSize.data.pagination.pageSize, 10)
})

test('P1: 通过小程序配置接口修改文案列表同样递增 copyVersion', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const settings = await adminRequest('/api/admin/settings', { cookie })
  const miniProgramId = settings.data.currentMiniProgramId
  assert.ok(miniProgramId, 'admin settings 必须携带 currentMiniProgramId')

  const beforePack = await request('/api/miniapp/copy-pack')
  const beforeVersion = beforePack.data.version
  assert.deepEqual(beforePack.data.copyPack.checkinBeforeTexts, ['今天也等到你了', '每天都来打卡吧'])

  try {
    // 走 /api/admin/miniprogram/config（updateMiniProgramConfig）修改文案列表
    const saved = await adminRequest('/api/admin/miniprogram/config', {
      method: 'POST',
      cookie,
      body: {
        id: miniProgramId,
        config: { system: { checkinBeforeTexts: ['接口通道文案一', '接口通道文案二'] } },
      },
    })
    assert.equal(saved.status, 200, saved.data.message)

    const afterPack = await request('/api/miniapp/copy-pack')
    assert.equal(afterPack.data.changed, true)
    assert.notEqual(afterPack.data.version, beforeVersion)
    assert.deepEqual(afterPack.data.copyPack.checkinBeforeTexts, ['接口通道文案一', '接口通道文案二'])

    // 同版本二次请求只回 changed:false，不重复下载
    const unchanged = await request(`/api/miniapp/copy-pack?version=${encodeURIComponent(afterPack.data.version)}`)
    assert.equal(unchanged.data.changed, false)
  } finally {
    // 恢复后台默认基线文案，避免影响其他用例
    await adminRequest('/api/admin/miniprogram/config', {
      method: 'POST',
      cookie,
      body: { id: miniProgramId, config: { system: { checkinBeforeTexts: ['今天也等到你了', '每天都来打卡吧'] } } },
    })
  }
})

test('P2: 重复保存相同分享设置不递增版本，客户端不会重复下载文案包', async () => {
  const pack = await request('/api/miniapp/copy-pack')
  const share = pack.data.copyPack.share
  assert.ok(share && share.private, '文案包必须携带分享设置')

  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  const body = { shareSettings: { private: share.private } }

  const firstSave = await adminRequest('/api/admin/share-settings', { method: 'POST', cookie, body })
  assert.equal(firstSave.status, 200, firstSave.data.message)
  const versionAfterFirst = firstSave.data.shareSettings.version

  const secondSave = await adminRequest('/api/admin/share-settings', { method: 'POST', cookie, body })
  assert.equal(secondSave.status, 200, secondSave.data.message)
  assert.equal(secondSave.data.shareSettings.version, versionAfterFirst, '内容未变时版本必须保持不变')

  // 真实内容变化仍然递增
  const changedSave = await adminRequest('/api/admin/share-settings', {
    method: 'POST',
    cookie,
    body: { shareSettings: { private: { ...share.private, coverCopyEnabled: !share.private.coverCopyEnabled } } },
  })
  assert.equal(changedSave.status, 200, changedSave.data.message)
  assert.notEqual(changedSave.data.shareSettings.version, versionAfterFirst)
})
