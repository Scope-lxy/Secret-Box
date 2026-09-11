const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-release-hardening-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp-release-base',
  contentPools: [{ id: 'pool-release', name: '发布加固测试池' }],
  miniPrograms: [{
    id: 'mp-release-base',
    name: '发布加固测试小程序',
    appId: 'wx7000000000000099',
    status: 'active',
    config: { contentPoolId: 'pool-release', dataMode: 'shared' },
  }],
  operationLogs: [],
})

const {
  clearLoginFailures,
  getLoginRetryAfterSeconds,
  recordLoginFailure,
} = require('../src/modules/admin/admin-login-rate-limit')
const {
  createMiniProgram,
  deleteMiniProgramDefinition,
  getInternalAdminSettings,
  getMiniProgramByAppId,
  getMiniProgramRuntimeConfig,
  setCurrentMiniProgram,
  updateAdminSettings,
  updateMiniProgramConfig,
} = require('../src/modules/admin/admin-settings.store')
const { clearPublicApiRateLimit, consumePublicApiRequest } = require('../src/modules/auth/public-api-rate-limit')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function withRegisteredMiniPrograms(definitions, callback) {
  const settings = getInternalAdminSettings()
  const originalPrograms = settings.miniPrograms
  const originalCurrentMiniProgramId = settings.currentMiniProgramId
  const contentPoolId = settings.contentPools[0].id
  definitions.forEach((item) => createMiniProgram({
    ...item,
    status: 'active',
    config: { contentPoolId, dataMode: 'independent' },
  }))
  try {
    return callback()
  } finally {
    definitions.slice().reverse().forEach((item) => deleteMiniProgramDefinition(item.id))
    setCurrentMiniProgram(originalCurrentMiniProgramId)
  }
}

test('管理员登录在同一来源连续失败五次后短暂锁定', () => {
  const ip = '203.0.113.50'
  const account = 'admin-rate-limit-test'
  const now = Date.now()
  clearLoginFailures(ip, account)
  for (let index = 0; index < 4; index += 1) {
    assert.equal(recordLoginFailure(ip, account, now), 0)
  }
  assert.equal(recordLoginFailure(ip, account, now), 900)
  assert.equal(getLoginRetryAfterSeconds(ip, account, now), 900)
  clearLoginFailures(ip, account)
  assert.equal(getLoginRetryAfterSeconds(ip, account, now), 0)
})

test('公开入口按来源和路由执行温和限流', () => {
  const ip = '203.0.113.80'
  const route = 'home-rate-limit-test'
  clearPublicApiRateLimit(ip, route)
  for (let index = 0; index < 120; index += 1) {
    assert.equal(consumePublicApiRequest(ip, route, 1000), 0)
  }
  assert.equal(consumePublicApiRequest(ip, route, 1000), 60)
  assert.equal(consumePublicApiRequest(ip, route, 61000), 0)
  assert.equal(consumePublicApiRequest('203.0.113.81', route, 121000), 0)
  clearPublicApiRateLimit(ip, route)
})

test('生产环境缺少微信凭据时不会跳过留言内容安全检测', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-message-security-'))
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const { checkMessageBeforeSave } = require('./src/modules/messages/message-security.service')
      checkMessageBeforeSave('普通留言').then((value) => {
        process.exit(value.status === 'blocked' && !value.passed ? 0 : 1)
      })
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir, NODE_ENV: 'production' },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('空数据库不会生成示例用户账号', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-empty-accounts-'))
  try {
    const output = execFileSync(process.execPath, [
      '-e',
      "const { getAccounts } = require('./src/modules/auth/account.store'); process.stdout.write(JSON.stringify(getAccounts()))",
    ], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir },
    })
    assert.deepEqual(JSON.parse(output), [])
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('账号偏好设置在服务重启后仍从 SQLite 恢复', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-account-preferences-'))
  try {
    const output = execFileSync(process.execPath, ['-e', `
      const path = require('path')
      const database = require('./src/lib/state-database')
      database.writeState(path.join(process.env.MINIAPP_DATA_DIR, 'admin-settings.json'), {
        currentMiniProgramId: 'mp1',
        contentPools: [{ id: 'pool-1', name: '偏好测试池' }],
        miniPrograms: [{
          id: 'mp1', name: '偏好测试小程序', appId: 'wx7000000000000001', status: 'active',
          config: { contentPoolId: 'pool-1', dataMode: 'shared' },
        }],
        operationLogs: [],
      })
      const account = {
        accountId: 'acct-preferences',
        miniProgramId: 'mp1',
        miniProgramIds: ['mp1'],
        wechatIdentities: [],
        visitorId: 'preferences-user',
        preferences: { theme: 'light', messageNotice: false },
      }
      const db = database.getDatabase()
      db.prepare(\`INSERT INTO accounts (
        account_id, unionid, phone, phone_verified, login_synced, visitor_id, primary_mini_program_id,
        created_at, updated_at, item_json
      ) VALUES (?, '', '', 0, 0, ?, 'mp1', ?, ?, ?)\`).run(
        account.accountId, account.visitorId, new Date().toISOString(), new Date().toISOString(), JSON.stringify(account),
      )
      db.prepare('INSERT INTO account_mini_programs (account_id, mini_program_id) VALUES (?, ?)')
        .run(account.accountId, 'mp1')
      db.prepare(\`INSERT INTO user_scope_profiles (
        data_scope_id, account_id, nickname, avatar_text, avatar_url, preferences_json,
        updated_at, nickname_updated_at, avatar_updated_at, preferences_updated_at,
        origin_mini_program_id
      ) VALUES ('shared:pool-1', ?, '轻读用户', '你', '', ?, ?, ?, ?, ?, 'mp1')\`).run(
        account.accountId,
        JSON.stringify(account.preferences),
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      database.closeDatabase()
      const { getPreferences } = require('./src/modules/auth/account.store')
      process.stdout.write(JSON.stringify(getPreferences({
        accountId: 'acct-preferences',
        miniProgramId: 'mp1',
        visitorId: 'preferences-user',
      })))
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir },
    })
    assert.deepEqual(JSON.parse(output), { preferences: { theme: 'light', messageNotice: false } })
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('管理员认证状态损坏时服务拒绝使用默认密码启动', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-invalid-admin-auth-'))
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const path = require('path')
      const database = require('./src/lib/state-database')
      database.writeState(path.join(process.env.MINIAPP_DATA_DIR, 'admin-auth.json'), { account: { account: 'admin' } })
      database.closeDatabase()
      require('./src/modules/admin/admin-auth.store')
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /admin auth state is invalid/)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('生产环境缺少管理员认证状态时不会启用默认密码', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-production-admin-auth-'))
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const path = require('path')
      const database = require('./src/lib/state-database')
      process.env.MINIAPP_DATA_DIR = ${JSON.stringify(dataDir)}
      process.env.NODE_ENV = 'production'
      const auth = require('./src/modules/admin/admin-auth.store')
      const login = auth.loginAdmin('admin', '123456')
      process.stdout.write(JSON.stringify({ login: Boolean(login), state: database.readState(path.join(process.env.MINIAPP_DATA_DIR, 'admin-auth.json')) }))
      database.closeDatabase()
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir, NODE_ENV: 'production' },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.deepEqual(JSON.parse(result.stdout), { login: false, state: null })
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('已配置管理员密码仍可登录并续建会话', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-configured-admin-auth-'))
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const auth = require('./src/modules/admin/admin-auth.store')
      const first = auth.loginAdmin('admin', '123456')
      const second = auth.loginAdmin('admin', '123456')
      process.stdout.write(JSON.stringify({ first: Boolean(first), second: Boolean(second) }))
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir, NODE_ENV: 'test' },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.deepEqual(JSON.parse(result.stdout), { first: true, second: true })
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('未知 NODE_ENV 按生产安全策略处理，不启用默认管理员密码或跳过留言检测', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-unknown-node-env-'))
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const path = require('path')
      const database = require('./src/lib/state-database')
      const auth = require('./src/modules/admin/admin-auth.store')
      const { checkMessageBeforeSave } = require('./src/modules/messages/message-security.service')
      Promise.resolve(checkMessageBeforeSave('普通留言')).then((message) => {
        process.stdout.write(JSON.stringify({
          login: Boolean(auth.loginAdmin('admin', '123456')),
          state: database.readState(path.join(process.env.MINIAPP_DATA_DIR, 'admin-auth.json')),
          message: { passed: message.passed, status: message.status },
        }))
        database.closeDatabase()
      })
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir, NODE_ENV: 'stagin' },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.deepEqual(JSON.parse(result.stdout), {
      login: false,
      state: null,
      message: { passed: false, status: 'blocked' },
    })
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('客户端不能伪造登录限流 IP，可信代理才可提供转发头', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-client-ip-'))
  const run = (trustedProxy) => spawnSync(process.execPath, ['-e', `
    const { getClientIp } = require('./src/routes')
    process.stdout.write(getClientIp({
      socket: { remoteAddress: '198.51.100.7' },
      headers: { 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '203.0.113.11, 203.0.113.12' },
    }))
  `], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, MINIAPP_DATA_DIR: dataDir, NODE_ENV: 'test', TRUSTED_PROXY: trustedProxy },
  })
  try {
    const untrusted = run('')
    assert.equal(untrusted.status, 0, untrusted.stderr || untrusted.stdout)
    assert.equal(untrusted.stdout, '198.51.100.7')
    const trusted = run('198.51.100.7')
    assert.equal(trusted.status, 0, trusted.stderr || trusted.stdout)
    assert.equal(trusted.stdout, '203.0.113.10')
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('独立数据模式下多小程序的公开互动计数互不影响', () => {
  const {
    deleteInteractionData,
    getPublicLikeCount,
    toggleReaction,
  } = require('../src/modules/interactions/interaction.store')
  withRegisteredMiniPrograms([
    { id: 'mp-isolation-a', name: '互动隔离 A', appId: 'wx7000000000000002' },
    { id: 'mp-isolation-b', name: '互动隔离 B', appId: 'wx7000000000000003' },
  ], () => {
    const mp1 = { miniProgramId: 'mp-isolation-a', visitorId: 'isolation-user-a' }
    const mp2 = { miniProgramId: 'mp-isolation-b', visitorId: 'isolation-user-b' }
    try {
      toggleReaction(mp1, { source: 'letters', sourceId: 'shared-content-id', type: 'like' })
      assert.equal(getPublicLikeCount(mp1, 'letters', 'shared-content-id'), 1)
      assert.equal(getPublicLikeCount(mp2, 'letters', 'shared-content-id'), 0)
    } finally {
      deleteInteractionData(mp1)
      deleteInteractionData(mp2)
    }
  })
})

test('独立数据模式下多小程序签到按小程序和账号共同隔离', () => {
  const { checkInToday, deleteCheckinState, getCheckinState } = require('../src/modules/checkin/checkin.store')
  withRegisteredMiniPrograms([
    { id: 'mp-isolation-a', name: '签到隔离 A', appId: 'wx7000000000000004' },
    { id: 'mp-isolation-b', name: '签到隔离 B', appId: 'wx7000000000000005' },
  ], () => {
    const mp1 = { miniProgramId: 'mp-isolation-a', visitorId: 'same-account' }
    const mp2 = { miniProgramId: 'mp-isolation-b', visitorId: 'same-account' }
    const date = new Date('2026-08-12T12:00:00+08:00')
    try {
      assert.equal(checkInToday(mp1, date).created, true)
      assert.equal(getCheckinState(mp2, date).checkIn.checkedToday, false)
    } finally {
      deleteCheckinState(mp1)
      deleteCheckinState(mp2)
    }
  })
})

test('自然日按北京时间零点切换，签到排名按完成时间计算', () => {
  const { checkInToday, deleteCheckinState, getCheckinState, toDateKey } = require('../src/modules/checkin/checkin.store')
  withRegisteredMiniPrograms([
    { id: 'mp-business-day', name: '北京时间测试', appId: 'wx7000000000000006' },
  ], () => {
    const first = { miniProgramId: 'mp-business-day', visitorId: 'rank-first' }
    const second = { miniProgramId: 'mp-business-day', visitorId: 'rank-second' }
    try {
      assert.equal(toDateKey(new Date('2026-08-24T00:30:00+08:00')), '2026-08-24')
      assert.equal(toDateKey(new Date('2026-08-23T23:59:59+08:00')), '2026-08-23')
      assert.equal(getCheckinState(first, new Date('2026-08-24T08:00:00+08:00')).checkIn.rankToday, 1)
      assert.equal(checkInToday(first, new Date('2026-08-24T08:01:00+08:00')).checkIn.rankToday, 1)
      assert.equal(getCheckinState(second, new Date('2026-08-24T08:02:00+08:00')).checkIn.rankToday, 2)
      assert.equal(checkInToday(second, new Date('2026-08-24T08:03:00+08:00')).checkIn.rankToday, 2)
    } finally {
      deleteCheckinState(first)
      deleteCheckinState(second)
    }
  })
})

test('Secret Box 由 1Panel 管理反向代理，生产容器使用北京时间', () => {
  const deployDirectory = path.resolve(__dirname, '../../deploy')
  const compose = fs.readFileSync(path.resolve(__dirname, '../../deploy/secretbox.1panel.compose.yaml'), 'utf8')
  const dockerfile = fs.readFileSync(path.resolve(__dirname, '../../deploy/secretbox.Dockerfile'), 'utf8')
  const deployment = fs.readFileSync(path.resolve(__dirname, '../../docs/deployment-1panel.md'), 'utf8')
  assert.deepEqual(fs.readdirSync(deployDirectory).filter((fileName) => fileName.endsWith('.conf')), [])
  assert.match(compose, /TZ:\s*Asia\/Shanghai/)
  assert.match(compose, /^name:\s*secretbox/m)
  assert.match(compose, /context:\s*\/opt\/secretbox\/app/)
  assert.match(compose, /\/opt\/secretbox\/runtime\.env/)
  assert.match(compose, /\/opt\/secretbox\/data:\/app\/data/)
  assert.match(compose, /\/opt\/secretbox\/miniprogram:\/app\/miniprogram:ro/)
  assert.match(compose, /127\.0\.0\.1:3101:3101/)
  assert.match(dockerfile, /apk add --no-cache ffmpeg tzdata/)
  assert.match(dockerfile, /EXPOSE 3101/)
  assert.match(dockerfile, /127\.0\.0\.1:3101\/api\/health/)
  assert.match(deployment, /Secret Box/)
  assert.match(deployment, /1Panel/)
  assert.match(deployment, /127\.0\.0\.1:3101/)
})

test('全局分享模板不能通过通用设置或单个小程序配置更新', () => {
  const settings = getInternalAdminSettings()
  const current = settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId)
  const shareSettings = settings.shareSettings

  assert.throws(
    () => updateAdminSettings({ shareSettings: { ...shareSettings, version: shareSettings.version + 1 } }),
    /只能通过全局分享设置更新/,
  )
  assert.throws(
    () => updateMiniProgramConfig(current.id, { shareSettings }),
    /只能通过全局分享设置更新/,
  )
  assert.deepEqual(getInternalAdminSettings().shareSettings, shareSettings)
})

test('通用设置入口拒绝新增小程序，不会静默清空已有配置', () => {
  const settings = getInternalAdminSettings()
  const originalPrograms = settings.miniPrograms
  const originalCurrentMiniProgramId = settings.currentMiniProgramId
  const appId = originalPrograms.find((item) => item.appId)?.appId
  assert.ok(appId)
  try {
    assert.throws(() => updateAdminSettings({
      miniPrograms: [
        ...originalPrograms,
        {
          id: 'mp-duplicate-appid-test',
          name: '重复 AppID 测试',
          appId,
          status: 'active',
          config: { contentPoolId: settings.contentPools[0].id },
        },
      ],
    }), /专用管理接口/)
    assert.equal(getInternalAdminSettings().miniPrograms.some((item) => item.id === 'mp-duplicate-appid-test'), false)
  } finally {
    setCurrentMiniProgram(originalCurrentMiniProgramId)
  }
})

test('后台拒绝重复小程序内部 ID', () => {
  const settings = getInternalAdminSettings()
  const originalPrograms = settings.miniPrograms
  const originalCurrentMiniProgramId = settings.currentMiniProgramId
  const existing = originalPrograms[0]
  assert.ok(existing)
  try {
    assert.throws(() => updateAdminSettings({
      miniPrograms: [
        ...originalPrograms,
        {
          id: existing.id,
          name: '重复内部 ID 测试',
          appId: 'wx1111111111111111',
          status: 'active',
          config: { contentPoolId: settings.contentPools[0].id },
        },
      ],
    }), /小程序内部 ID 已存在/)
    assert.equal(getInternalAdminSettings().miniPrograms.length, originalPrograms.length)
  } finally {
    updateAdminSettings({ miniPrograms: originalPrograms, currentMiniProgramId: originalCurrentMiniProgramId })
  }
})

test('后台拒绝格式错误的开发者联系邮箱', () => {
  const settings = getInternalAdminSettings()
  assert.throws(() => updateAdminSettings({
    miniPrograms: settings.miniPrograms.map((item, index) => (
      index === 0 ? { ...item, developerEmail: 'invalid-email' } : item
    )),
  }), /开发者联系邮箱格式无效/)
})

test('服务端按 AppID 唯一解析已接入小程序', () => {
  const settings = getInternalAdminSettings()
  const active = settings.miniPrograms.find((item) => item.status !== 'archived' && item.appId)
  assert.ok(active)
  assert.equal(getMiniProgramByAppId(active.appId)?.id, active.id)
  assert.equal(getMiniProgramByAppId('wx0000000000000000'), null)
  assert.equal(getMiniProgramByAppId(active.id), null)
})

test('后台拒绝格式错误的 AppID', () => {
  const settings = getInternalAdminSettings()
  assert.throws(() => updateAdminSettings({
    miniPrograms: settings.miniPrograms.map((item, index) => (
      index === 0 ? { ...item, appId: 'mp1' } : item
    )),
  }), /AppID 格式无效/)
})

test('原生广告位置和插屏广告循环规则按范围保存', () => {
  const settings = getInternalAdminSettings()
  const miniProgram = settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId)
  const originalConfig = miniProgram.config
  try {
    updateMiniProgramConfig(miniProgram.id, {
      ...originalConfig,
      ads: {
        ...originalConfig.ads,
        homeInterstitial: {
          ...originalConfig.ads.homeInterstitial,
          delaySeconds: 999,
          repeatSeconds: 999,
        },
        lettersNative: {
          ...originalConfig.ads.lettersNative,
          firstAfter: 0,
          interval: 999,
        },
      },
    })
    const ads = getMiniProgramRuntimeConfig({ miniProgramId: miniProgram.id }).ads
    assert.equal(ads.homeInterstitial.delaySeconds, 300)
    assert.equal(ads.homeInterstitial.repeatSeconds, 300)
    assert.equal(ads.lettersNative.firstAfter, 1)
    assert.equal(ads.lettersNative.interval, 100)
    assert.equal(ads.articlesNative.adType, 'native')
    assert.equal(ads.articlesInterstitial.repeatSeconds, 90)
    assert.equal(ads.articlesStartNative.adType, 'native')
    assert.equal(ads.articlesEndNative.adType, 'native')
    assert.equal(ads.articleExpandRewarded.adType, 'rewarded')
    assert.equal(ads.articleInterstitial.repeatSeconds, 90)
    assert.deepEqual(Object.keys(ads).sort(), [
      'articleExpandRewarded',
      'articleInterstitial',
      'articlesInterstitial',
      'articlesNative',
      'articlesEndNative',
      'articlesStartNative',
      'homeCheckInRewarded',
      'homeDailyContentRewarded',
      'homeInterstitial',
      'homeNative',
      'lettersInterstitial',
      'lettersNative',
      'mineInterstitial',
      'mineNative',
    ].sort())
    assert.equal(ads.mineNative.firstAfter, 3)
    assert.equal(ads.mineInterstitial.repeatSeconds, 90)
  } finally {
    updateMiniProgramConfig(miniProgram.id, originalConfig)
  }
})

test('当前账号的服务端头像地址和历史前缀都可提取可删除的对象 key', () => {
  const { getCosObjectKeyFromPublicUrl, getManagedAvatarObjectKey } = require('../src/modules/storage/cos.service')
  const storage = {
    bucket: 'example-1250000000',
    region: 'ap-chengdu',
    url: 'https://media.example.com/assets',
  }
  assert.equal(
    getCosObjectKeyFromPublicUrl(storage, 'https://media.example.com/assets/assets-v1/avatars/a/avatar.jpg'),
    'assets-v1/avatars/a/avatar.jpg',
  )
  assert.equal(getCosObjectKeyFromPublicUrl(storage, 'https://attacker.example/avatar.jpg'), '')
  assert.equal(getCosObjectKeyFromPublicUrl(storage, 'https://media.example.com/other/avatar.jpg'), '')
  assert.equal(
    getCosObjectKeyFromPublicUrl(storage, 'https://example-1250000000.cos.ap-chengdu.myqcloud.com/assets-v1/avatars/a/avatar.jpg'),
    'assets-v1/avatars/a/avatar.jpg',
  )
  const managedAvatarUrl = 'https://media.example.com/assets/assets-v1/avatars/account-a/mabc123-0123456789abcdef.jpg'
  assert.equal(
    getManagedAvatarObjectKey(storage, 'account-a', managedAvatarUrl),
    'assets-v1/avatars/account-a/mabc123-0123456789abcdef.jpg',
  )
  assert.equal(getManagedAvatarObjectKey(storage, 'account-b', managedAvatarUrl), '')
  assert.equal(getManagedAvatarObjectKey(storage, 'account-a', 'https://media.example.com/assets/assets-v1/avatars/account-a/avatar.jpg'), '')
})

test('上线预检只接受安装包图片和当前 COS 媒体地址', () => {
  const { isSupportedMediaUrl, isValidAdUnitId } = require('../src/modules/admin/admin-config.service')
  const storage = {
    bucket: 'example-1250000000',
    region: 'ap-chengdu',
    url: 'https://media.example.com/assets',
  }
  assert.equal(isSupportedMediaUrl(storage, '/assets/images/share-1.jpg', 'image'), true)
  assert.equal(isSupportedMediaUrl(storage, 'https://media.example.com/assets/assets-v1/image.jpg', 'image'), true)
  assert.equal(isSupportedMediaUrl(storage, 'data:image/svg+xml;utf8,%3Csvg%3E', 'image'), false)
  assert.equal(isSupportedMediaUrl(storage, 'https://attacker.example/image.jpg', 'image'), false)
  assert.equal(isSupportedMediaUrl(storage, '/assets/images/share-1.jpg', 'audio'), false)
  assert.equal(isValidAdUnitId('adunit-1234567890abcdef'), true)
  assert.equal(isValidAdUnitId('adunit-xxx-xxx'), true)
  assert.equal(isValidAdUnitId('test-ad-unit'), false)
})

test('生产前置检查优先使用容器挂载的小程序源码路径', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/verify-production-prereqs.js'), 'utf8')
  assert.match(source, /process\.env\.MINIPROGRAM_SOURCE_DIR/)
  assert.match(source, /path\.resolve\(configuredMiniRoot\)/)
})
