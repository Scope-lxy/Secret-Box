const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-admin-secret-reveal-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, writeState } = require('../src/lib/state-database')

writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'configured',
  contentPools: [{ id: 'pool-1', name: '默认内容池' }],
  miniPrograms: [
    {
      id: 'configured',
      name: '已配置小程序',
      appId: 'wx1111111111111111',
      appSecret: 'BU3S12345678H7S3',
      status: 'active',
      config: { contentPoolId: 'pool-1' },
    },
    {
      id: 'empty',
      name: '未配置小程序',
      appId: 'wx2222222222222222',
      appSecret: '',
      status: 'active',
      config: { contentPoolId: 'pool-1' },
    },
    {
      id: 'short',
      name: '历史短密钥小程序',
      appId: 'wx3333333333333333',
      appSecret: 'short-secret',
      status: 'active',
      config: { contentPoolId: 'pool-1' },
    },
  ],
  storage: {
    appId: '1300000000',
    secretId: 'AKIDEXAMPLE',
    secretKey: 'COSK12345678TAIL',
    bucket: 'bucket-1300000000',
    region: 'ap-chengdu',
    url: 'https://cos.example.test',
    folderPrefix: 'secretbox',
  },
})

const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')
const {
  getInternalAdminSettings,
  updateAdminSettings,
  updateMiniProgram,
} = require('../src/modules/admin/admin-settings.store')

let baseUrl
let server

async function request(pathname, { body, cookie = '', method = 'GET' } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return {
    data: await response.json(),
    headers: response.headers,
    status: response.status,
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

test('saved secrets stay masked in settings and require an authenticated reveal request', async () => {
  const settings = await request('/api/admin/settings')
  assert.equal(settings.status, 401)

  const unauthorizedReveal = await request('/api/admin/secrets/reveal', {
    method: 'POST',
    body: { secret: 'appSecret', miniProgramId: 'configured' },
  })
  assert.equal(unauthorizedReveal.status, 401)

  const login = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]

  const authenticatedSettings = await request('/api/admin/settings', { cookie })
  assert.equal(authenticatedSettings.status, 200)
  assert.equal(authenticatedSettings.data.miniPrograms[0].appSecretMasked, 'BU3S******H7S3')
  assert.equal(authenticatedSettings.data.miniPrograms.find((item) => item.id === 'short').appSecretMasked, '******')
  assert.equal(authenticatedSettings.data.storage.secretKeyMasked, 'COSK******TAIL')
  assert.doesNotMatch(JSON.stringify(authenticatedSettings.data), /BU3S12345678H7S3|COSK12345678TAIL/)

  const appSecret = await request('/api/admin/secrets/reveal', {
    method: 'POST',
    cookie,
    body: { secret: 'appSecret', miniProgramId: 'configured' },
  })
  assert.equal(appSecret.status, 200)
  assert.deepEqual(appSecret.data, { value: 'BU3S12345678H7S3' })
  assert.equal(appSecret.headers.get('cache-control'), 'no-store')

  const storageSecret = await request('/api/admin/secrets/reveal', {
    method: 'POST',
    cookie,
    body: { secret: 'storageSecretKey' },
  })
  assert.equal(storageSecret.status, 200)
  assert.deepEqual(storageSecret.data, { value: 'COSK12345678TAIL' })
  assert.equal(storageSecret.headers.get('cache-control'), 'no-store')
})

test('invalid or unconfigured reveal requests never return another saved secret', async () => {
  const login = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]

  for (const body of [
    { secret: 'appSecret', miniProgramId: 'empty' },
    { secret: 'appSecret', miniProgramId: 'missing' },
    { secret: 'unknown', miniProgramId: 'configured' },
  ]) {
    const response = await request('/api/admin/secrets/reveal', { method: 'POST', cookie, body })
    assert.equal(response.status, 400)
    assert.doesNotMatch(JSON.stringify(response.data), /BU3S12345678H7S3|COSK12345678TAIL/)
  }
})

test('submitting the current masks cannot overwrite saved secrets', () => {
  updateMiniProgram('configured', { appSecret: 'BU3S******H7S3', remark: '只修改备注' })
  updateAdminSettings({ storage: { secretKey: 'COSK******TAIL' } })

  updateMiniProgram('configured', { appSecret: 'BU3S******H7S3x', remark: '局部编辑掩码也不写入' })
  updateAdminSettings({ storage: { secretKey: 'xCOSK******TAIL' } })

  const internalSettings = getInternalAdminSettings()
  assert.equal(internalSettings.miniPrograms.find((item) => item.id === 'configured').appSecret, 'BU3S12345678H7S3')
  assert.equal(internalSettings.storage.secretKey, 'COSK12345678TAIL')
})
