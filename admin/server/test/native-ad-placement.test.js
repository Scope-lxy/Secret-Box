const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-native-ad-placement-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp-native-ad',
  contentPools: [{ id: 'pool-native-ad', name: '原生广告测试池' }],
  miniPrograms: [{
    id: 'mp-native-ad',
    name: '原生广告测试小程序',
    appId: 'wx7000000000000097',
    status: 'active',
    config: { contentPoolId: 'pool-native-ad', dataMode: 'shared' },
  }],
  operationLogs: [],
})

const {
  getInternalAdminSettings,
  getMiniProgramRuntimeConfig,
  updateMiniProgramConfig,
} = require('../src/modules/admin/admin-settings.store')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('首页原生模板广告的 placement 只接受三项稳定枚举', () => {
  const settingsSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/admin/admin-settings.store.js'), 'utf8')
  const settings = getInternalAdminSettings()
  const miniProgram = settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId)
  assert.ok(miniProgram)
  const originalConfig = miniProgram.config
  const originalHomeNative = originalConfig.ads.homeNative

  assert.match(settingsSource, /homeNative: \{[^\n]*placement: 'dailyContent'/)
  assert.doesNotMatch(settingsSource, /defaultHomeNativePlacement/)

  try {
    for (const placement of ['dailyContent', 'checkIn', 'stats']) {
      updateMiniProgramConfig(miniProgram.id, {
        ...originalConfig,
        ads: { ...originalConfig.ads, homeNative: { ...originalHomeNative, placement } },
      })
      assert.equal(getMiniProgramRuntimeConfig({ miniProgramId: miniProgram.id }).ads.homeNative.placement, placement)
    }

    assert.throws(() => updateMiniProgramConfig(miniProgram.id, {
      ...originalConfig,
      ads: { ...originalConfig.ads, homeNative: { ...originalHomeNative, placement: 'unknown' } },
    }), /首页原生广告展示位置无效/)

    const missingPlacement = { ...originalHomeNative }
    delete missingPlacement.placement
    updateMiniProgramConfig(miniProgram.id, {
      ...originalConfig,
      ads: { ...originalConfig.ads, homeNative: missingPlacement },
    })
    assert.equal(getMiniProgramRuntimeConfig({ miniProgramId: miniProgram.id }).ads.homeNative.placement, 'dailyContent')
  } finally {
    updateMiniProgramConfig(miniProgram.id, originalConfig)
  }
})

test('后台首页原生广告表单提供三项中文展示位置', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../admin/src/main.js'), 'utf8')
  assert.match(script, /value: 'dailyContent', label: '手记模块下方'/)
  assert.match(script, /value: 'checkIn', label: '打卡模块下方'/)
  assert.match(script, /value: 'stats', label: '统计模块下方'/)
  assert.match(script, /homeNative: '可选择展示在手记、打卡或统计模块下方。'/)
  assert.match(script, /<label>广告展示位置<\/label>/)
  assert.match(script, /data-config-field="placement"/)
  assert.doesNotMatch(script, /item\.placement\s*\|\|\s*'checkIn'/)
})
