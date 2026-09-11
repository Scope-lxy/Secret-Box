const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-admin-create-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { withCors } = require('../src/lib/cors')
const { closeDatabase } = require('../src/lib/state-database')
const { createAppRouter } = require('../src/routes')

let baseUrl
let server

async function request(pathname, { body, cookie = '', headers = {}, method = 'GET' } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
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

test('新建小程序补齐默认配置，后台面板可用且既有数据不变', async () => {
  const login = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]

  const settingsBefore = await request('/api/admin/settings', { cookie })
  assert.equal(settingsBefore.status, 200)
  const originalMiniProgramId = settingsBefore.data.currentMiniProgramId
  const originalContentPoolId = settingsBefore.data.contentPools[0].id
  const contentBefore = await request(`/api/admin/content?miniProgramId=${originalMiniProgramId}`, { cookie })
  assert.equal(contentBefore.status, 200)

  const created = await request('/api/admin/miniprogram/create', {
    method: 'POST',
    cookie,
    body: {
      miniProgram: {
        id: 'mp-create-regression',
        name: '新增配置回归',
        appId: 'wx1234567890abcdef',
        appSecret: 'test-secret',
        developerEmail: 'developer@example.com',
        status: 'active',
        config: { contentPoolId: originalContentPoolId },
      },
    },
  })
  assert.equal(created.status, 200)
  const newMiniProgram = created.data.miniPrograms.find((item) => item.id === 'mp-create-regression')
  assert.equal(created.data.currentMiniProgramId, newMiniProgram.id)
  assert.equal(newMiniProgram.config.ads.homeNative.placement, 'dailyContent')
  assert.equal(newMiniProgram.config.system.dailyContentButtonText, '打开今日手记')
  assert.equal(newMiniProgram.config.system.dailyContentAdIncompleteText, '完整观看广告后，即可打开手记')
  assert.equal(newMiniProgram.config.system.articleAdIncompleteText, '完整观看广告后，即可展开全文')
  assert.equal(newMiniProgram.config.system.checkinButtonText, '立即打卡')
  assert.equal(newMiniProgram.config.system.checkinAdIncompleteText, '完整观看广告后，即可完成打卡')
  assert.equal(newMiniProgram.config.system.tabs.home.visible, false)
  // 新建实例预填后台默认文案（与服务端 defaultSystem / 客户端 default-copy.js 定稿一致）
  assert.deepEqual(newMiniProgram.config.system.dailyContentPromptTexts, ['想说的，都悄悄放这里了', '打开前，猜猜里面是什么'])
  assert.deepEqual(newMiniProgram.config.system.checkinBeforeTexts, ['今天也等到你了', '每天都来打卡吧'])
  assert.deepEqual(newMiniProgram.config.system.checkinAfterTexts, ['今日已点亮，明天再来打卡吧！', '感谢你的支持，明天我等你哦！'])

  const [bootstrap, runtimeConfig, settingsAfter, contentAfter] = await Promise.all([
    request('/api/admin/bootstrap', { cookie }),
    request('/api/miniapp/config', {
      headers: { 'x-miniapp-appid': newMiniProgram.appId, 'x-visitor-id': 'admin-create-regression' },
    }),
    request('/api/admin/settings', { cookie }),
    request(`/api/admin/content?miniProgramId=${originalMiniProgramId}`, { cookie }),
  ])

  assert.equal(bootstrap.status, 200)
  assert.equal(runtimeConfig.status, 200)
  for (const key of [
    'dataScopeId', 'miniProgram', 'apiBaseUrl', 'ads', 'articleDisplay',
    'system', 'dailyContentTypes', 'limits', 'messagesEnabled', 'storage',
  ]) {
    assert.ok(Object.hasOwn(runtimeConfig.data, key), `公开启动配置缺少 ${key}`)
  }
  assert.deepEqual(runtimeConfig.data.limits, newMiniProgram.config.limits)
  assert.equal(runtimeConfig.data.system.tabs.home.visible, false)
  assert.equal(runtimeConfig.data.miniProgram.contentPoolId, newMiniProgram.config.contentPoolId)
  assert.equal(settingsAfter.status, 200)
  assert.equal(contentAfter.status, 200)
  assert.deepEqual(
    settingsAfter.data.miniPrograms.filter((item) => item.id !== newMiniProgram.id),
    settingsBefore.data.miniPrograms,
  )
  assert.deepEqual(settingsAfter.data.contentPools, settingsBefore.data.contentPools)
  assert.deepEqual(settingsAfter.data.shareSettings, settingsBefore.data.shareSettings)
  assert.deepEqual(settingsAfter.data.storage, settingsBefore.data.storage)
  assert.deepEqual(settingsAfter.data.security, settingsBefore.data.security)
  assert.deepEqual(contentAfter.data, contentBefore.data)

  const legacyDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-admin-legacy-'))
  const legacySettings = structuredClone(settingsAfter.data)
  const legacyMiniProgram = legacySettings.miniPrograms.find((item) => item.id === newMiniProgram.id)
  delete legacyMiniProgram.config.ads.homeNative.placement
  const fixturePath = path.join(legacyDataDir, 'legacy-settings.json')
  fs.writeFileSync(fixturePath, JSON.stringify(legacySettings))
  const reload = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs')
    const path = require('node:path')
    const { writeState } = require('./src/lib/state-database')
    const saved = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'))
    writeState(path.join(process.env.MINIAPP_DATA_DIR, 'admin-settings.json'), saved)
    const { getMiniProgramRuntimeConfig } = require('./src/modules/admin/admin-settings.store')
    process.stdout.write(getMiniProgramRuntimeConfig({ miniProgramId: 'mp-create-regression' }).ads.homeNative.placement)
  `, fixturePath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, MINIAPP_DATA_DIR: legacyDataDir },
  })
  fs.rmSync(legacyDataDir, { recursive: true, force: true })
  assert.equal(reload.status, 0, reload.stderr)
  assert.equal(reload.stdout, 'dailyContent')
})
