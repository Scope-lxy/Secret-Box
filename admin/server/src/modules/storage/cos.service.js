const crypto = require('crypto')
const { env } = require('../../config/env')
const { getInternalAdminSettings } = require('../admin/admin-settings.store')

const DEFAULT_FOLDER_PREFIX = 'secretbox'

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function hmacSha1(key, value) {
  return crypto.createHmac('sha1', key).update(value).digest('hex')
}

function encodeCosSignatureComponent(value) {
  return encodeURIComponent(String(value || ''))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeCosSignatureKey(value) {
  return encodeCosSignatureComponent(String(value || '').toLowerCase())
}

function getCosHost(storage) {
  return `${storage.bucket}.cos.${storage.region}.myqcloud.com`
}

function getPublicCosUrl(storage, key) {
  const cleanKey = String(key || '').replace(/^\/+/, '')
  const baseUrl = String(storage.url || '').trim().replace(/\/+$/, '')
  if (baseUrl) return `${baseUrl}/${cleanKey}`
  return `https://${getCosHost(storage)}/${cleanKey}`
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function readCosErrorField(body, field) {
  const match = String(body || '').match(new RegExp(`<${field}>([\\s\\S]*?)</${field}>`, 'i'))
  return decodeXmlEntities(match?.[1]).replace(/\s+/g, ' ').trim().slice(0, 240)
}

async function getCosErrorDetail(response) {
  const body = await response.text().catch(() => '')
  const code = readCosErrorField(body, 'Code')
  const message = readCosErrorField(body, 'Message')
  return {
    code: /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(code) ? code : '',
    message,
  }
}

class CosRequestError extends Error {
  constructor(operation, status, detail) {
    const codeSuffix = detail.code ? `（${detail.code}）` : ''
    super(`${operation}：HTTP ${status}${codeSuffix}`)
    this.name = 'CosRequestError'
    this.code = detail.code || `COS_HTTP_${status}`
    this.cosCode = detail.code
    this.cosMessage = detail.message
    this.cosStatus = status
  }
}

function isRetryableCosRequestError(error) {
  const status = Number(error?.cosStatus || 0)
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return true
  if (error instanceof TypeError) return true
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']
    .includes(String(error?.code || error?.cause?.code || ''))
}

function wait(delayMs, signal) {
  return new Promise((resolve) => {
    let timer
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, delayMs)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(Number(concurrency) || 1)))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }))
  return results
}

async function waitForCosObjectsReady(objectKeys, {
  concurrency = 4,
  maxAttempts = 7,
  requestTimeoutMs = 5000,
  batchTimeoutMs = 45000,
  baseDelayMs = 500,
  maxDelayMs = 4000,
  objectExists = doesCosObjectExist,
  sleep = wait,
} = {}) {
  let pending = [...new Set(objectKeys.filter(Boolean))]
  const attempts = Math.max(1, Math.floor(Number(maxAttempts) || 1))
  const batchSignal = AbortSignal.timeout(Math.max(1, Math.floor(Number(batchTimeoutMs) || 45000)))
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const results = await mapWithConcurrency(pending, concurrency, async (objectKey) => {
      try {
        return await objectExists(objectKey, { signal: batchSignal, timeoutMs: requestTimeoutMs })
      } catch (error) {
        if (!isRetryableCosRequestError(error)) throw error
        return false
      }
    })
    pending = pending.filter((_, index) => !results[index])
    if (!pending.length) return
    if (batchSignal.aborted) break
    if (attempt < attempts) {
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)))
      await sleep(delayMs, batchSignal)
    }
  }
  const error = new Error('图片尚未处理完成，请稍后重试')
  error.pendingObjectKeys = pending
  throw error
}

function getCosObjectKeyFromPublicUrl(storage, value) {
  const sourceValue = String(value || '').trim()
  if (!sourceValue) return ''
  try {
    const source = new URL(sourceValue)
    const baseUrls = [
      String(storage.url || '').trim().replace(/\/+$/, ''),
      `https://${getCosHost(storage)}`,
    ].filter(Boolean)
    for (const baseUrl of [...new Set(baseUrls)]) {
      const base = new URL(`${baseUrl}/`)
      if (source.origin !== base.origin || !source.pathname.startsWith(base.pathname)) continue
      return source.pathname.slice(base.pathname.length).split('/').map(decodeURIComponent).join('/')
    }
    return ''
  } catch (error) {
    return ''
  }
}

function getManagedAvatarObjectKey(storage, accountId, value) {
  const objectKey = getCosObjectKeyFromPublicUrl(storage, value)
  const accountIdText = String(accountId || '').trim()
  const avatarPath = new RegExp(`(?:^|/)avatars/${escapeRegExp(accountIdText)}/[a-z0-9]+-[a-f0-9]{16}\\.jpg$`)
  return avatarPath.test(objectKey) ? objectKey : ''
}

function withoutHostHeader(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'host'))
}

function buildCosAuthorization(storage, method, pathname, headers = {}, query = {}) {
  const now = Math.floor(Date.now() / 1000)
  const keyTime = `${now - 60};${now + 600}`
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    String(value || '').trim(),
  ]))
  const headerKeys = Object.keys(normalizedHeaders).sort()
  const headerList = headerKeys.join(';')
  const httpHeaders = headerKeys.map((key) => `${encodeCosSignatureKey(key)}=${encodeCosSignatureComponent(normalizedHeaders[key])}`).join('&')
  const queryKeys = Object.keys(query).sort()
  const queryList = queryKeys.map(encodeCosSignatureKey).join(';')
  const httpQuery = queryKeys.map((key) => `${encodeCosSignatureKey(key)}=${encodeCosSignatureComponent(query[key] || '')}`).join('&')
  const httpString = [
    method.toLowerCase(),
    pathname || '/',
    httpQuery,
    httpHeaders,
    '',
  ].join('\n')
  const stringToSign = [
    'sha1',
    keyTime,
    sha1(httpString),
    '',
  ].join('\n')
  const signKey = hmacSha1(storage.secretKey, keyTime)
  const signature = hmacSha1(signKey, stringToSign)
  return [
    `q-sign-algorithm=sha1`,
    `q-ak=${storage.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${queryList}`,
    `q-signature=${signature}`,
  ].join('&')
}

function getCosObjectUrl(storage, key) {
  const objectKey = String(key || '').replace(/^\/+/, '')
  const pathname = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  return `https://${getCosHost(storage)}${pathname}`
}

function getDirectUploadCorsOrigins() {
  const origins = String(env.corsOrigin || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return origins.length ? origins : ['https://secretbox.scopeview.cn']
}

function buildDirectUploadCorsRules(origins = getDirectUploadCorsOrigins()) {
  return origins.map((origin) => [
    '<CORSRule>',
    `<AllowedOrigin>${origin}</AllowedOrigin>`,
    '<AllowedMethod>GET</AllowedMethod>',
    '<AllowedMethod>HEAD</AllowedMethod>',
    '<AllowedMethod>PUT</AllowedMethod>',
    '<AllowedHeader>Authorization</AllowedHeader>',
    '<AllowedHeader>Content-Type</AllowedHeader>',
    '<AllowedHeader>Pic-Operations</AllowedHeader>',
    '<ExposeHeader>ETag</ExposeHeader>',
    '<MaxAgeSeconds>600</MaxAgeSeconds>',
    '</CORSRule>',
  ].join('')).join('')
}

function isCorsResponseReady(response, origin) {
  const allowOrigin = String(response.headers.get('access-control-allow-origin') || '').trim()
  const allowedMethods = String(response.headers.get('access-control-allow-methods') || '')
    .toLowerCase().split(',').map((item) => item.trim())
  const allowedHeaders = String(response.headers.get('access-control-allow-headers') || '')
    .toLowerCase().split(',').map((item) => item.trim())
  const requiredHeaders = ['authorization', 'content-type', 'pic-operations']
  return response.ok
    && (allowOrigin === '*' || allowOrigin === origin)
    && allowedMethods.includes('put')
    && (allowedHeaders.includes('*') || requiredHeaders.every((header) => allowedHeaders.includes(header)))
}

async function testDirectUploadCors() {
  const origins = getDirectUploadCorsOrigins()
  const origin = origins[0] === '*' ? 'http://localhost:3000' : origins[0]
  const target = createDirectUploadTarget({
    contentType: 'audio/mpeg',
    key: 'secretbox/_diagnostics/cors-probe.mp3',
  })
  const response = await fetch(target.uploadUrl, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'authorization,content-type,pic-operations',
    },
  })
  const ok = isCorsResponseReady(response, origin)
  return {
    ok,
    status: response.status,
    message: ok
      ? 'COS 直传跨域规则正常'
      : `COS 直传跨域规则不可用：HTTP ${response.status}`,
  }
}

async function getExistingCorsRules(storage) {
  const host = getCosHost(storage)
  const headers = { host }
  const response = await fetch(`https://${host}/?cors`, {
    method: 'GET',
    headers: {
      ...headers,
      authorization: buildCosAuthorization(storage, 'GET', '/', headers, { cors: '' }),
    },
  })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`无法读取 COS 跨域规则：HTTP ${response.status}`)
  return (await response.text()).match(/<CORSRule>[\s\S]*?<\/CORSRule>/g) || []
}

async function configureDirectUploadCors() {
  const storage = getInternalAdminSettings().storage || {}
  const required = ['secretId', 'secretKey', 'bucket', 'region']
  const missing = required.filter((key) => !String(storage[key] || '').trim())
  if (missing.length) throw new Error(`COS 配置缺少：${missing.join(', ')}`)

  const current = await testDirectUploadCors()
  if (current.ok) {
    return {
      ok: true,
      message: 'COS 直传跨域规则已就绪',
    }
  }

  const existingRules = await getExistingCorsRules(storage)
  const xml = `<CORSConfiguration>${existingRules.join('')}${buildDirectUploadCorsRules()}</CORSConfiguration>`
  const host = getCosHost(storage)
  const headers = {
    'content-md5': crypto.createHash('md5').update(xml).digest('base64'),
    'content-type': 'application/xml',
    host,
  }
  const response = await fetch(`https://${host}/?cors`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: buildCosAuthorization(storage, 'PUT', '/', headers, { cors: '' }),
    },
    body: xml,
  })
  if (!response.ok) throw new Error(`COS 直传跨域规则配置失败：HTTP ${response.status}`)

  const verification = await testDirectUploadCors()
  if (!verification.ok) throw new Error(verification.message)
  return {
    ok: true,
    message: 'COS 直传跨域规则已同步',
  }
}

async function testCosConnection() {
  const storage = getInternalAdminSettings().storage || {}
  const required = ['secretId', 'secretKey', 'bucket', 'region']
  const missing = required.filter((key) => !String(storage[key] || '').trim())
  if (missing.length) {
    return {
      ok: false,
      objectAccessOk: false,
      message: `COS 配置缺少：${missing.join(', ')}`,
    }
  }

  const host = getCosHost(storage)
  const headers = {
    host,
  }
  const response = await fetch(`https://${host}/`, {
    method: 'GET',
    headers: {
      ...headers,
      authorization: buildCosAuthorization(storage, 'GET', '/', headers),
    },
  })

  if (!response.ok) {
    return {
      ok: false,
      objectAccessOk: false,
      bucket: storage.bucket,
      region: storage.region,
      status: response.status,
      message: `COS 连接测试失败：HTTP ${response.status}`,
    }
  }

  const cors = await testDirectUploadCors()
  return {
    ok: cors.ok,
    objectAccessOk: true,
    bucket: storage.bucket,
    region: storage.region,
    status: response.status,
    message: cors.ok ? 'COS 连接与直传规则均正常' : cors.message,
  }
}

async function uploadBufferToCos({
  buffer,
  contentType = 'application/octet-stream',
  key,
  operations = null,
  requestTimeoutMs = 60000,
  retryDelays = [500, 1500],
  sleep = wait,
}) {
  const storage = getInternalAdminSettings().storage || {}
  const required = ['secretId', 'secretKey', 'bucket', 'region']
  const missing = required.filter((item) => !String(storage[item] || '').trim())
  if (missing.length) {
    throw new Error(`COS 配置缺少：${missing.join(', ')}`)
  }

  const objectKey = String(key || '').replace(/^\/+/, '')
  if (!objectKey) throw new Error('COS 上传路径不能为空')

  const pathname = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  const host = getCosHost(storage)
  const headers = {
    'content-type': contentType,
    host,
  }
  if (operations) headers['pic-operations'] = JSON.stringify(operations)
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(`https://${host}${pathname}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(Math.max(1, Math.floor(Number(requestTimeoutMs) || 60000))),
        headers: {
          ...headers,
          authorization: buildCosAuthorization(storage, 'PUT', pathname, headers),
        },
        body: buffer,
      })
      if (response.ok) break
      throw new CosRequestError('COS 上传失败', response.status, await getCosErrorDetail(response))
    } catch (error) {
      if (attempt >= retryDelays.length || !isRetryableCosRequestError(error)) throw error
      await sleep(retryDelays[attempt])
    }
  }

  return {
    bucket: storage.bucket,
    key: objectKey,
    region: storage.region,
    url: getPublicCosUrl(storage, objectKey),
  }
}

async function deleteCosObject(key) {
  const storage = getInternalAdminSettings().storage || {}
  const required = ['secretId', 'secretKey', 'bucket', 'region']
  const missing = required.filter((item) => !String(storage[item] || '').trim())
  if (missing.length) throw new Error(`COS 配置缺少：${missing.join(', ')}`)

  const objectKey = String(key || '').replace(/^\/+/, '')
  if (!objectKey) throw new Error('COS 删除路径不能为空')

  const pathname = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  const host = getCosHost(storage)
  const headers = { host }
  const response = await fetch(`https://${host}${pathname}`, {
    method: 'DELETE',
    headers: {
      ...headers,
      authorization: buildCosAuthorization(storage, 'DELETE', pathname, headers),
    },
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`COS 删除失败：HTTP ${response.status}`)
  }
}

async function doesCosObjectExist(key, { signal, timeoutMs = 5000 } = {}) {
  const storage = getInternalAdminSettings().storage || {}
  const required = ['secretId', 'secretKey', 'bucket', 'region']
  const missing = required.filter((item) => !String(storage[item] || '').trim())
  if (missing.length) throw new Error(`COS 配置缺少：${missing.join(', ')}`)

  const objectKey = String(key || '').replace(/^\/+/, '')
  if (!objectKey) return false
  const pathname = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  const host = getCosHost(storage)
  const headers = { host }
  const timeoutSignal = Number(timeoutMs) > 0 ? AbortSignal.timeout(Number(timeoutMs)) : null
  const requestSignal = signal && timeoutSignal
    ? AbortSignal.any([signal, timeoutSignal])
    : signal || timeoutSignal || undefined
  const response = await fetch(`https://${host}${pathname}`, {
    method: 'HEAD',
    signal: requestSignal,
    headers: {
      ...headers,
      authorization: buildCosAuthorization(storage, 'HEAD', pathname, headers),
    },
  })
  if (response.status === 404) return false
  if (!response.ok) {
    throw new CosRequestError('COS 对象校验失败', response.status, {
      code: String(response.headers.get('x-cos-error-code') || '').trim(),
      message: '',
    })
  }
  return true
}

function createDirectUploadTarget({ contentType = 'application/octet-stream', key, operations = null }) {
  const storage = getInternalAdminSettings().storage || {}
  const required = ['secretId', 'secretKey', 'bucket', 'region']
  const missing = required.filter((item) => !String(storage[item] || '').trim())
  if (missing.length) {
    throw new Error(`COS 配置缺少：${missing.join(', ')}`)
  }

  const objectKey = String(key || '').replace(/^\/+/, '')
  if (!objectKey) throw new Error('COS 上传路径不能为空')

  const host = getCosHost(storage)
  const pathname = `/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  const headers = {
    'content-type': contentType,
    host,
  }
  if (operations) headers['pic-operations'] = JSON.stringify(operations)

  return {
    authorization: buildCosAuthorization(storage, 'PUT', pathname, headers),
    headers: withoutHostHeader(headers),
    key: objectKey,
    publicUrl: getPublicCosUrl(storage, objectKey),
    uploadUrl: `https://${host}${pathname}`,
  }
}

module.exports = {
  configureDirectUploadCors,
  createDirectUploadTarget,
  deleteCosObject,
  encodeCosSignatureComponent,
  doesCosObjectExist,
  getCosObjectKeyFromPublicUrl,
  getManagedAvatarObjectKey,
  getPublicCosUrl,
  isRetryableCosRequestError,
  testCosConnection,
  uploadBufferToCos,
  waitForCosObjectsReady,
}
