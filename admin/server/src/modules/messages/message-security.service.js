const { env } = require('../../config/env')
const { getInternalAdminSettings, getMiniProgramWechatCredentials } = require('../admin/admin-settings.store')
const { getStableAccessToken } = require('../auth/wechat-auth.service')

function checkBlockedWords(content) {
  const text = String(content || '').trim()
  const settings = getInternalAdminSettings()
  const securitySettings = settings.security || {}
  const blockedWords = Array.isArray(securitySettings.blockedWords) && securitySettings.blockedWords.length
    ? securitySettings.blockedWords
    : ['违法', '诈骗', '博彩', '违规', '广告', '辱骂']
  const blockedHit = blockedWords.find((word) => text.includes(word))

  if (blockedHit) {
    return {
      passed: false,
      status: 'blocked',
      reason: `留言内容未通过安全检测：${blockedHit}`,
      keyword: blockedHit,
    }
  }

  return null
}

function isWechatMsgSecCheckAvailable(context = {}) {
  const credentials = getMiniProgramWechatCredentials(context)
  return Boolean(
    env.productionLike
    && credentials.appId
    && credentials.appSecret,
  )
}

async function readJsonResponse(response) {
  try {
    return await response.json()
  } catch (error) {
    return null
  }
}

async function fetchWechatAccessToken(context = {}) {
  if (!isWechatMsgSecCheckAvailable(context)) return null
  return getStableAccessToken(context)
}

async function runWechatMessageSecurityCheck(content, context = {}) {
  const accessToken = await fetchWechatAccessToken(context)
  if (!accessToken) {
    return {
      passed: false,
      status: 'blocked',
      reason: '发布环境未配置微信内容安全接口',
    }
  }

  const response = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })

  const data = await readJsonResponse(response)
  const errCode = Number(data?.errcode || 0)

  if (!response.ok || errCode !== 0) {
    return {
      passed: false,
      status: 'blocked',
      reason: data?.errmsg || `微信内容安全检测失败 (${response.status})`,
      errorCode: Number.isFinite(errCode) ? errCode : response.status,
    }
  }

  return {
    passed: true,
    status: 'passed',
    reason: '',
    provider: 'wechat',
  }
}

async function checkMessageBeforeSave(content, context = {}) {
  const settings = getInternalAdminSettings()
  const securitySettings = settings.security || {}
  const text = String(content || '').trim()

  if (!text) {
    return { passed: false, status: 'blocked', reason: '留言内容不能为空' }
  }

  const keywordResult = checkBlockedWords(text)
  if (keywordResult) return keywordResult

  if (securitySettings.textCheck === false) {
    return {
      passed: true,
      status: 'unchecked',
      reason: '后台已关闭文本安全检测',
    }
  }

  if (isWechatMsgSecCheckAvailable(context)) {
    try {
      const result = await runWechatMessageSecurityCheck(text, context)
      if (result.passed) return result
      return result
    } catch (error) {
      return {
        passed: false,
        status: 'blocked',
        reason: error.message || '微信内容安全检测失败',
      }
    }
  }

  if (env.productionLike) {
    return {
      passed: false,
      status: 'blocked',
      reason: '发布环境未配置微信内容安全接口',
    }
  }

  return { passed: true, status: 'passed', reason: '' }
}

module.exports = {
  checkMessageBeforeSave,
}
