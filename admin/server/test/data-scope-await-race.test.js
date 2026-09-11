const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-scope-await-race-'))
process.env.MINIAPP_DATA_DIR = dataDir

function createGate() {
  let release
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const pending = new Promise((resolve) => { release = resolve })
  return {
    started,
    release,
    wait() {
      markStarted()
      return pending
    },
  }
}

const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [
    { id: 'pool-1', name: '竞态池一' },
    { id: 'pool-2', name: '竞态池二' },
  ],
  miniPrograms: [{
    id: 'mp1',
    name: '竞态测试小程序',
    appId: 'wx13d0fa4e3c10441d',
    appSecret: 'test-secret',
    status: 'active',
    config: { contentPoolId: 'pool-1', dataMode: 'shared' },
  }],
  storage: {
    bucket: 'test-bucket',
    region: 'ap-test',
    secretId: 'test-id',
    secretKey: 'test-key',
    url: 'https://cdn.example.com',
    folderPrefix: 'secretbox',
  },
  security: { textCheck: true, blockedWords: [] },
  operationLogs: [],
})

const { appendContentItems } = require('../src/modules/content/content.store')
for (const poolId of ['pool-1', 'pool-2']) {
  appendContentItems(poolId, 'letters', [{ id: 'race-letter', content: '竞态测试心笺', label: '测试' }])
}

let loginGate
let phoneGate
let securityGate
let uploadGate
let uploadedAvatarKey = ''
const deletedAvatarKeys = []

const authPath = require.resolve('../src/modules/auth/wechat-auth.service')
const authService = require(authPath)
require.cache[authPath].exports = {
  ...authService,
  hasWechatCredentials: () => true,
  exchangeLoginCode: () => loginGate ? loginGate.wait() : Promise.resolve({ openid: 'default-login' }),
  exchangePhoneCode: () => phoneGate ? phoneGate.wait() : Promise.resolve('13800000000'),
}

const securityPath = require.resolve('../src/modules/messages/message-security.service')
const messageSecurity = require(securityPath)
require.cache[securityPath].exports = {
  ...messageSecurity,
  checkMessageBeforeSave: () => securityGate
    ? securityGate.wait()
    : Promise.resolve({ passed: true, status: 'passed', reason: '' }),
}

const storagePath = require.resolve('../src/modules/storage/cos.service')
const cosService = require(storagePath)
require.cache[storagePath].exports = {
  ...cosService,
  uploadBufferToCos: ({ key }) => {
    uploadedAvatarKey = key
    return uploadGate ? uploadGate.wait() : Promise.resolve()
  },
  deleteCosObject: async (key) => { deletedAvatarKeys.push(key) },
}

delete require.cache[require.resolve('../src/routes')]
const { createAppRouter } = require('../src/routes')
const { withCors } = require('../src/lib/cors')
const { updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { countMessages } = require('../src/modules/messages/message.store')
const { syncLogin } = require('../src/modules/auth/account.store')
const { createMiniAppSession } = require('../src/modules/auth/miniapp-session.store')

const existingProfile = syncLogin({ miniProgramId: 'mp1', visitorId: 'scope-race-user' }, { openid: 'scope-race-openid' })
const existingSession = createMiniAppSession({ accountId: existingProfile.accountId, miniProgramId: 'mp1' })

let server
let baseUrl

function setPool(contentPoolId) {
  updateMiniProgramConfig('mp1', { contentPoolId, dataMode: 'shared' })
}

function scopeHeaders(dataScopeId = 'shared:pool-1') {
  return {
    'content-type': 'application/json',
    'x-miniapp-appid': 'wx13d0fa4e3c10441d',
    'x-miniapp-data-scope': dataScopeId,
    'x-miniapp-session': existingSession.token,
    'x-visitor-id': 'scope-race-user',
  }
}

async function waitForGate(gate, responsePromise, label) {
  let timer
  try {
    await Promise.race([
      gate.started,
      responsePromise.then(async (response) => {
        throw new Error(`${label}提前结束：HTTP ${response.status} ${await response.text()}`)
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}未进入受控等待点`)), 3000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
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

test.beforeEach(() => {
  setPool('pool-1')
  loginGate = null
  phoneGate = null
  securityGate = null
  uploadGate = null
  uploadedAvatarKey = ''
  deletedAvatarKeys.length = 0
})

test('scoped writes revalidate after awaited work and remove an unreferenced avatar upload', async () => {
  const nativeFetch = global.fetch

  loginGate = createGate()
  const accountsBefore = getDatabase().prepare('SELECT COUNT(*) AS count FROM accounts').get().count
  const sessionRequest = nativeFetch(`${baseUrl}/api/miniapp/session`, {
    method: 'POST',
    headers: scopeHeaders(),
    body: JSON.stringify({ code: 'race-login-code' }),
  })
  await waitForGate(loginGate, sessionRequest, '登录交换')
  setPool('pool-2')
  loginGate.release({ openid: 'must-not-be-saved' })
  const sessionResponse = await sessionRequest
  assert.equal(sessionResponse.status, 409)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM accounts').get().count, accountsBefore)

  setPool('pool-1')
  phoneGate = createGate()
  const phoneRequest = nativeFetch(`${baseUrl}/api/miniapp/profile/sync-login`, {
    method: 'POST',
    headers: scopeHeaders(),
    body: JSON.stringify({ phoneCode: 'race-phone-code', nickname: '不得保存的新昵称' }),
  })
  await waitForGate(phoneGate, phoneRequest, '手机号交换')
  setPool('pool-2')
  phoneGate.release('13900000000')
  const phoneResponse = await phoneRequest
  assert.equal(phoneResponse.status, 409)
  const accountAfterPhone = getDatabase().prepare('SELECT phone FROM accounts WHERE account_id = ?').get(existingProfile.accountId)
  assert.equal(accountAfterPhone.phone, '')

  setPool('pool-1')
  securityGate = createGate()
  const messagesBefore = countMessages({ source: 'letters' })
  const messageRequest = nativeFetch(`${baseUrl}/api/miniapp/messages`, {
    method: 'POST',
    headers: { ...scopeHeaders(), 'x-idempotency-key': 'scope_race_message_01' },
    body: JSON.stringify({ source: 'letters', sourceId: 'race-letter', content: '等待检测期间切换范围' }),
  })
  await waitForGate(securityGate, messageRequest, '留言安全检测')
  setPool('pool-2')
  securityGate.release({ passed: true, status: 'passed', reason: '' })
  const messageResponse = await messageRequest
  assert.equal(messageResponse.status, 409)
  assert.equal(countMessages({ source: 'letters' }), messagesBefore)

  setPool('pool-1')
  uploadGate = createGate()
  const avatarBody = new FormData()
  avatarBody.append('avatar', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'avatar.jpg')
  const avatarHeaders = scopeHeaders()
  delete avatarHeaders['content-type']
  const avatarRequest = nativeFetch(`${baseUrl}/api/miniapp/profile/avatar`, {
    method: 'POST',
    headers: avatarHeaders,
    body: avatarBody,
  })
  await waitForGate(uploadGate, avatarRequest, '头像上传')
  setPool('pool-2')
  uploadGate.release()
  const avatarResponse = await avatarRequest
  assert.equal(avatarResponse.status, 409)
  assert.ok(uploadedAvatarKey)
  assert.deepEqual(deletedAvatarKeys, [uploadedAvatarKey])
  const avatarReferences = getDatabase().prepare(`
    SELECT COUNT(*) AS count FROM user_scope_profiles WHERE avatar_url LIKE ?
  `).get(`%${uploadedAvatarKey}%`).count
  assert.equal(avatarReferences, 0)
})
