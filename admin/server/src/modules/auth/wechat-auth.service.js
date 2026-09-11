const { getMiniProgramWechatCredentials } = require('../admin/admin-settings.store')

const tokenCache = new Map()

function getWechatCredentials(context = {}) {
  return getMiniProgramWechatCredentials(context)
}

function hasWechatCredentials(context = {}) {
  const credentials = getWechatCredentials(context)
  return Boolean(credentials.appId && credentials.appSecret)
}

async function readJson(response) {
  try {
    return await response.json()
  } catch (error) {
    return null
  }
}

async function getStableAccessToken(context = {}) {
  const credentials = getWechatCredentials(context)
  if (!credentials.appId || !credentials.appSecret) return ''
  const cacheKey = `${credentials.appId}\u0000${credentials.appSecret}`
  const cached = tokenCache.get(cacheKey)
  if (cached?.value && cached.expiresAt > Date.now() + 60 * 1000) return cached.value

  const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: credentials.appId,
      secret: credentials.appSecret,
      force_refresh: false,
    }),
  })
  const data = await readJson(response)
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.errmsg || '微信服务凭据获取失败')
  }
  const value = String(data.access_token)
  tokenCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + Math.max(0, Number(data.expires_in || 7200) - 120) * 1000,
  })
  return value
}

async function exchangeLoginCode(code, context = {}) {
  const normalizedCode = String(code || '').trim()
  const credentials = getWechatCredentials(context)
  if (!normalizedCode || !credentials.appId || !credentials.appSecret) return null
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', credentials.appId)
  url.searchParams.set('secret', credentials.appSecret)
  url.searchParams.set('js_code', normalizedCode)
  url.searchParams.set('grant_type', 'authorization_code')
  const response = await fetch(url)
  const data = await readJson(response)
  if (!response.ok || !data?.openid) {
    throw new Error(data?.errmsg || '微信登录凭据校验失败')
  }
  return {
    openid: String(data.openid),
    unionid: String(data.unionid || ''),
  }
}

async function exchangePhoneCode(code, context = {}) {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode || !hasWechatCredentials(context)) return ''
  const accessToken = await getStableAccessToken(context)
  const response = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: normalizedCode }),
  })
  const data = await readJson(response)
  const phone = String(data?.phone_info?.phoneNumber || '').trim()
  if (!response.ok || !phone) {
    throw new Error(data?.errmsg || '微信手机号获取失败')
  }
  return phone
}

module.exports = {
  exchangeLoginCode,
  exchangePhoneCode,
  getStableAccessToken,
  hasWechatCredentials,
}
