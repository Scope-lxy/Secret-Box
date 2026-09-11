const { getCachedProfileData, syncLogin } = require('../services/miniapp')
const { getAccountScopedStorageKey } = require('./request')

function getStorageKey() {
  return getAccountScopedStorageKey('message-phone-sync-prompt-resolved')
}

function hasAuthorizedPhone() {
  return Boolean(getCachedProfileData()?.profile?.phone)
}

function shouldPromptForMessage() {
  return !hasAuthorizedPhone() && !wx.getStorageSync(getStorageKey())
}

function resolvePhoneSyncPrompt() {
  wx.setStorageSync(getStorageKey(), '1')
}

async function syncPhoneForMessage(event) {
  const phoneCode = String(event.detail?.code || '').trim()
  if (!phoneCode) return false
  await syncLogin({ phoneCode })
  resolvePhoneSyncPrompt()
  return true
}

module.exports = {
  resolvePhoneSyncPrompt,
  shouldPromptForMessage,
  syncPhoneForMessage,
}
