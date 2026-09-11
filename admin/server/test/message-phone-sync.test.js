const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const miniappRoot = path.resolve(__dirname, '../../../miniprogram')
const helperPath = path.join(miniappRoot, 'utils', 'message-phone-sync.js')
const servicePath = path.join(miniappRoot, 'services', 'miniapp.js')

test('message phone sync prompt is resolved only after a skip or successful authorization', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    getAccountInfoSync() { return { miniProgram: { appId: 'wx-message-sync', envVersion: 'release' } } },
  }

  const service = require(servicePath)
  const originalSyncLogin = service.syncLogin
  service.syncLogin = async (payload) => {
    assert.deepEqual(payload, { phoneCode: 'phone-code' })
    return { profile: { phone: '13800138000' } }
  }
  delete require.cache[require.resolve(helperPath)]
  const { resolvePhoneSyncPrompt, shouldPromptForMessage, syncPhoneForMessage } = require(helperPath)

  try {
    assert.equal(shouldPromptForMessage(), true)
    assert.equal(await syncPhoneForMessage({ detail: {} }), false)
    assert.equal(shouldPromptForMessage(), true)

    assert.equal(await syncPhoneForMessage({ detail: { code: 'phone-code' } }), true)
    assert.equal(shouldPromptForMessage(), false)

    storage.delete('message-phone-sync-prompt-resolved')
    resolvePhoneSyncPrompt()
    assert.equal(shouldPromptForMessage(), false)
  } finally {
    service.syncLogin = originalSyncLogin
    delete require.cache[require.resolve(helperPath)]
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('every message entry keeps authorization and continuation on the current page', () => {
  for (const page of ['home', 'letters']) {
    const script = fs.readFileSync(path.join(miniappRoot, 'pages', page, `${page}.js`), 'utf8')
    const template = fs.readFileSync(path.join(miniappRoot, 'pages', page, `${page}.wxml`), 'utf8')
    assert.match(script, /handlePhoneSyncAuthorize/)
    assert.match(script, /handlePhoneSyncDecline/)
    assert.match(script, /await this\.submitMessage\(/)
    assert.match(template, /open-type="getPhoneNumber"/)
    assert.match(template, /bindgetphonenumber="handlePhoneSyncAuthorize"/)
  }
})
