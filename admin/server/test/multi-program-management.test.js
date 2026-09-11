const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-multi-program-'))
process.env.MINIAPP_DATA_DIR = dataDir
const { closeDatabase, readState, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp-valid',
  contentPools: [{ id: 'pool-1', name: '内容池1' }],
  miniPrograms: [
    {
      id: 'mp-valid',
      name: '正常小程序',
      appId: 'wx1111111111111111',
      appSecret: 'valid-secret',
      status: 'active',
      config: { contentPoolId: 'pool-1', ads: { homeNative: { placement: 'checkIn' } } },
    },
    {
      id: 'mp-invalid',
      name: '待修正小程序',
      appId: 'wx-invalid-history',
      appSecret: 'invalid-secret',
      status: 'active',
      config: { contentPoolId: 'pool-1', ads: { homeNative: { placement: 'checkIn' } } },
    },
  ],
})

const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')

let baseUrl
let server

async function adminRequest(pathname, { method = 'GET', body, cookie = '' } = {}) {
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

test('错误 AppID 记录可进入编辑，且不阻塞其他实例保存', async () => {
  const login = await adminRequest('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]

  const selected = await adminRequest('/api/admin/miniprogram/select', {
    method: 'POST',
    cookie,
    body: { id: 'mp-invalid' },
  })
  assert.equal(selected.status, 200)
  assert.equal(selected.data.currentMiniProgramId, 'mp-invalid')
  const legacyRewardedAds = selected.data.miniPrograms.find((item) => item.id === 'mp-invalid').config.ads
  assert.equal(legacyRewardedAds.homeDailyContentRewarded.confirmPopupEnabled, true)
  assert.equal(legacyRewardedAds.homeDailyContentRewarded.allowOnUnavailable, true)
  assert.equal(legacyRewardedAds.homeCheckInRewarded.confirmPopupEnabled, true)
  assert.equal(legacyRewardedAds.homeCheckInRewarded.allowOnUnavailable, true)

  const savedRewardedControls = await adminRequest('/api/admin/miniprogram/config', {
    method: 'POST',
    cookie,
    body: {
      id: 'mp-invalid',
      config: {
        ads: {
          homeNative: { placement: 'checkIn' },
          homeDailyContentRewarded: {
            enabled: true,
            adUnitId: 'adunit-daily-content-test',
            adType: 'rewarded',
            freeCount: 0,
            confirmPopupEnabled: false,
            allowOnUnavailable: false,
          },
        },
      },
    },
  })
  assert.equal(savedRewardedControls.status, 200)
  const savedDailyContentAd = savedRewardedControls.data.miniPrograms.find((item) => item.id === 'mp-invalid').config.ads.homeDailyContentRewarded
  assert.equal(savedDailyContentAd.confirmPopupEnabled, false)
  assert.equal(savedDailyContentAd.allowOnUnavailable, false)

  const savedValid = await adminRequest('/api/admin/miniprogram/update', {
    method: 'POST',
    cookie,
    body: {
      id: 'mp-valid',
      miniProgram: { remark: '不受错误实例影响' },
    },
  })
  assert.equal(savedValid.status, 200)
  assert.equal(savedValid.data.miniPrograms.find((item) => item.id === 'mp-valid').remark, '不受错误实例影响')

  const preservedSecret = await adminRequest('/api/admin/miniprogram/update', {
    method: 'POST',
    cookie,
    body: {
      id: 'mp-valid',
      miniProgram: { appSecret: '', remark: '留空密钥时保留原值' },
    },
  })
  assert.equal(preservedSecret.status, 200)
  const sanitizedMiniProgram = preservedSecret.data.miniPrograms.find((item) => item.id === 'mp-valid')
  assert.equal(Object.hasOwn(sanitizedMiniProgram, 'appSecret'), false)
  assert.equal(sanitizedMiniProgram.appSecretConfigured, true)
  assert.equal(
    readState(path.join(dataDir, 'admin-settings.json')).miniPrograms.find((item) => item.id === 'mp-valid').appSecret,
    'valid-secret',
  )

  const blockedPublicRequest = await fetch(`${baseUrl}/api/miniapp/home`, {
    headers: { 'x-miniapp-appid': 'wx-invalid-history', 'x-visitor-id': 'invalid-appid-visitor' },
  })
  assert.equal(blockedPublicRequest.status, 400)

  const corrected = await adminRequest('/api/admin/miniprogram/update', {
    method: 'POST',
    cookie,
    body: {
      id: 'mp-invalid',
      miniProgram: { appId: 'wx2222222222222222' },
    },
  })
  assert.equal(corrected.status, 200)
  assert.equal(corrected.data.miniPrograms.find((item) => item.id === 'mp-invalid').appId, 'wx2222222222222222')

  const archived = await adminRequest('/api/admin/miniprogram/status', {
    method: 'POST',
    cookie,
    body: { id: 'mp-valid', status: 'archived' },
  })
  assert.equal(archived.status, 200)

  const duplicateArchivedAppId = await adminRequest('/api/admin/miniprogram/create', {
    method: 'POST',
    cookie,
    body: {
      miniProgram: {
        id: 'mp-duplicate-archived-appid',
        name: '重复停用 AppID',
        appId: 'wx1111111111111111',
        appSecret: 'another-secret',
        developerEmail: 'developer@example.com',
        config: { contentPoolId: 'pool-1' },
      },
    },
  })
  assert.equal(duplicateArchivedAppId.status, 400)
  assert.match(duplicateArchivedAppId.data.message, /AppID 已被其他小程序使用/)
})
