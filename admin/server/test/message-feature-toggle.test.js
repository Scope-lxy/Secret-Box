const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-message-toggle-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase } = require('../src/lib/state-database')
const { getAdminSettings, updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { isMessageCreationEnabled } = require('../src/routes')

function currentConfig() {
  return getAdminSettings().miniPrograms.find((item) => item.id === 'default-mini-program').config
}

const interstitialAdKeys = ['homeInterstitial', 'lettersInterstitial', 'articlesInterstitial', 'articleInterstitial', 'mineInterstitial']
const rewardedAdKeys = ['homeDailyContentRewarded', 'homeCheckInRewarded', 'articleExpandRewarded']

function mapAds(ads, update) {
  return Object.fromEntries(Object.entries(ads).map(([key, item]) => [key, update(key, item)]))
}

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('留言创建仅在运行时配置明确开启时放行', () => {
  assert.equal(isMessageCreationEnabled({ messagesEnabled: true }), true)
  assert.equal(isMessageCreationEnabled({ messagesEnabled: false }), false)
  assert.equal(isMessageCreationEnabled({}), false)
  assert.equal(isMessageCreationEnabled(null), false)
  assert.equal(isMessageCreationEnabled({ messagesEnabled: 'true' }), false)
})

test('模式字段切换不会在服务端强制修改其他配置', () => {
  const initial = currentConfig()
  assert.equal(initial.limits.dailyContentLimit, 5)
  interstitialAdKeys.forEach((key) => assert.equal(initial.ads[key].repeatSeconds, 90, key))
  updateMiniProgramConfig('default-mini-program', {
    ads: mapAds(initial.ads, (key, item) => ({
      ...item,
      ...(interstitialAdKeys.includes(key) ? { enabled: true } : {}),
      ...(rewardedAdKeys.includes(key) ? {
        freeCount: 7,
        confirmPopupEnabled: false,
        allowOnUnavailable: false,
      } : {}),
    })),
    dailyContentTypes: { imageEnabled: false, audioEnabled: true },
    messagesEnabled: true,
    limits: { dailyContentLimit: 9 },
    system: {
      ...initial.system,
      tabs: {
        ...initial.system.tabs,
        home: { ...initial.system.tabs.home, visible: true },
        articles: { ...initial.system.tabs.articles, visible: false },
      },
    },
  })

  updateMiniProgramConfig('default-mini-program', { mode: 'audit' })
  const audit = currentConfig()
  assert.equal(audit.mode, 'audit')
  assert.equal(audit.system.tabs.home.visible, true)
  assert.equal(audit.system.tabs.articles.visible, false)
  assert.equal(audit.messagesEnabled, true)
  assert.equal(audit.dailyContentTypes.imageEnabled, false)
  assert.equal(audit.dailyContentTypes.audioEnabled, true)
  assert.equal(audit.limits.dailyContentLimit, 9)
  rewardedAdKeys.forEach((key) => {
    assert.equal(audit.ads[key].freeCount, 7, key)
    assert.equal(audit.ads[key].confirmPopupEnabled, false, key)
    assert.equal(audit.ads[key].allowOnUnavailable, false, key)
  })
  interstitialAdKeys.forEach((key) => assert.equal(audit.ads[key].enabled, true, key))

  updateMiniProgramConfig('default-mini-program', {
    ads: mapAds(audit.ads, (key, item) => ({
      ...item,
      ...(key === 'homeDailyContentRewarded' ? { freeCount: 4 } : {}),
    })),
    messagesEnabled: true,
  })
  const adjustedAudit = currentConfig()
  assert.equal(adjustedAudit.messagesEnabled, true)
  updateMiniProgramConfig('default-mini-program', { mode: 'audit' })
  assert.deepEqual(currentConfig(), adjustedAudit)

  updateMiniProgramConfig('default-mini-program', { mode: 'default' })
  const normal = currentConfig()
  assert.equal(normal.mode, 'default')
  assert.equal(normal.system.tabs.home.visible, true)
  assert.equal(normal.system.tabs.articles.visible, false)
  assert.equal(normal.messagesEnabled, true)
  assert.equal(normal.dailyContentTypes.imageEnabled, false)
  assert.equal(normal.dailyContentTypes.audioEnabled, true)
  assert.equal(normal.limits.dailyContentLimit, 9)
  rewardedAdKeys.forEach((key) => {
    assert.equal(normal.ads[key].freeCount, key === 'homeDailyContentRewarded' ? 4 : 7, key)
    assert.equal(normal.ads[key].confirmPopupEnabled, false, key)
    assert.equal(normal.ads[key].allowOnUnavailable, false, key)
  })
  interstitialAdKeys.forEach((key) => assert.equal(normal.ads[key].enabled, true, key))
  Object.entries(normal.ads).forEach(([key, item]) => assert.equal(item.enabled, true, key))
})
