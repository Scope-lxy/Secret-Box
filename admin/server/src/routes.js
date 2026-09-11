const crypto = require('crypto')
const { env } = require('./config/env')
const { getDatabase } = require('./lib/state-database')
const { createRouter } = require('./lib/router')
const { readJsonBody, readMultipartFile } = require('./lib/body')
const { sendJson, ok, created, badRequest, tooManyRequests, unauthorized } = require('./lib/response')
const { TaskBusyError, createSingleTaskRunner } = require('./lib/single-task-runner')
const {
  getHomeData,
  getPublicCopyPack,
  getActivityData,
  getDailyContentAvailability,
  openDailyContent,
  checkIn,
  getLetters,
  getArticles,
  getArticleDetail,
  getArticleRecommendations,
  unlockArticle,
  findContentItem,
  getProfileData,
  getAdminContent,
  appendAdminContentItems,
  getAdminContentDuplicateIndexes,
  deleteAdminContentItem,
  deleteAdminContentItems,
  updateAdminContentItem,
  updateAdminContent,
  updateAdminContentPage,
} = require('./modules/content/content.service')
const {
  createArticleImportJob,
  getArticleImportJob,
  publishArticleImportJob,
  retryArticleImportEntry,
} = require('./modules/content/article-import.service')
const { hasReadableArticleContent, renderArticleMarkdown } = require('./modules/content/article-markdown')
const { deleteContentPool: deleteContentPoolData, getContentImageAssetIds } = require('./modules/content/content.store')
const { reclaimImageAssets } = require('./modules/images/image-reclamation.service')
const { checkMessageBeforeSave } = require('./modules/messages/message-security.service')
const { MESSAGE_CONTENT_MAX_UNITS, MESSAGE_CONTENT_LIMIT_TEXT, getMessageContentUnits, normalizeMessageContent } = require('./modules/messages/message-content')
const {
  deleteCurrentMessage,
  deleteMessage,
  countMessages,
  createMessage,
  getMessages,
  updateMessageStatus,
} = require('./modules/messages/message.store')
const { imagePolicy, getImageProcessingProfile, findReusableImage, makePicOperations } = require('./modules/images/image-policy')
const {
  addImageAsset,
  addImageAssets,
  countImages,
  deleteImageAsset,
  getImageById,
  getImages,
  getImagesByIds,
  getImagesByOriginalSha256,
  updateImages,
} = require('./modules/images/image.store')
const { accountPolicy } = require('./modules/auth/account-policy')
const { exchangeLoginCode, exchangePhoneCode, hasWechatCredentials } = require('./modules/auth/wechat-auth.service')
const { countEvents, recordAnalyticsEvent, recordPageView } = require('./modules/analytics/analytics.store')
const { recordOpened, recordShare, setReaction, toggleReaction } = require('./modules/interactions/interaction.store')
const { executeIdempotently, getStoredResult } = require('./modules/idempotency/idempotency.store')
const { decodeDataScopeHeader, getDataScope } = require('./modules/data-scope/data-scope')
const {
  getAccountById,
  getAccountSummary,
  getAccounts,
  countAccounts,
  getPreferences,
  syncLogin,
  updateProfile,
} = require('./modules/auth/account.store')
const { deleteAccountForMiniProgram } = require('./modules/auth/account-deletion.service')
const { createMiniAppSession, getMiniAppSession } = require('./modules/auth/miniapp-session.store')
const { clearLoginFailures, getLoginRetryAfterSeconds, recordLoginFailure } = require('./modules/admin/admin-login-rate-limit')
const { consumePublicApiRequest } = require('./modules/auth/public-api-rate-limit')
const { consumeAuthenticatedApiRequest } = require('./modules/auth/authenticated-api-rate-limit')
const { getAdminBootstrap, getAdminPreflight } = require('./modules/admin/admin-config.service')
const {
  appendOperationLog,
  createMiniProgram,
  getAdminSettings,
  getInternalAdminSettings,
  getMiniProgramByAppId,
  getPublicMiniAppConfig,
  getMiniProgramRuntimeConfig,
  reorderMiniProgram,
  setCurrentMiniProgram,
  setMiniProgramStatus,
  updateAdminSettings,
  updateGlobalShareSettings,
  updateMiniProgram,
  updateMiniProgramGroups,
  updateMiniProgramConfig,
} = require('./modules/admin/admin-settings.store')
const { deleteMiniProgram } = require('./modules/admin/mini-program-deletion.service')
const {
  getAdminAuthState,
  getSessionFromHeaders,
  isSessionValid,
  loginAdmin,
  logoutAdmin,
  updateAdminCredentials,
} = require('./modules/admin/admin-auth.store')
const {
  getAdminAssetPaths,
  redirectToAdminRoot,
  serveAdminAsset,
} = require('./modules/admin/admin-static.service')
const {
  getMiniProgramNextVersion,
  getMiniProgramUploadInfo,
  hasMiniProgramUploadKey,
  MiniProgramUploadError,
  uploadMiniProgramCode,
} = require('./modules/release/miniapp-upload.service')
const {
  configureDirectUploadCors,
  createDirectUploadTarget,
  deleteCosObject,
  getCosObjectKeyFromPublicUrl,
  getManagedAvatarObjectKey,
  getPublicCosUrl,
  testCosConnection,
  uploadBufferToCos,
  waitForCosObjectsReady,
} = require('./modules/storage/cos.service')
const { normalizeAudioBuffer } = require('./modules/storage/audio-normalization.service')

const runSingleAudioUpload = createSingleTaskRunner()
const adminContentImportBatchLimit = 200
const adminImageUploadBatchLimit = 100
const IMAGE_UPLOAD_RULE_VERSION = 'display-v1'

function buildAdminSessionCookie(token) {
  return `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
}

function clearAdminSessionCookie() {
  return 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
}

function requireAdminSession(req, res) {
  const token = getSessionFromHeaders(req)
  if (!isSessionValid(token)) {
    unauthorized(res, '请先登录')
    return null
  }
  return token
}

function getAdminSettingsWithUploadKeys() {
  return addUploadKeyState(getAdminSettings())
}

function addUploadKeyState(settings) {
  return {
    ...settings,
    miniPrograms: settings.miniPrograms.map((item) => ({
      ...item,
      uploadKeyConfigured: hasMiniProgramUploadKey(item.appId),
      lastUpload: (() => {
        const upload = getMiniProgramUploadInfo(item.appId)
        return upload ? { version: upload.version, uploadedAt: upload.uploadedAt } : null
      })(),
    })),
  }
}

function getHeader(req, name) {
  const target = String(name || '').toLowerCase()
  const headers = req.headers || {}
  return headers[target] || headers[name] || ''
}

function getClientIp(req) {
  const remoteAddress = String(req.socket?.remoteAddress || '').trim()
  const trustedProxies = String(env.trustedProxy || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!trustedProxies.includes(remoteAddress)) return remoteAddress || 'unknown'
  const realIp = String(getHeader(req, 'x-real-ip') || '').trim()
  const forwarded = String(getHeader(req, 'x-forwarded-for') || '').split(',').map((item) => item.trim()).filter(Boolean)
  return realIp || forwarded[0] || remoteAddress || 'unknown'
}

function enforcePublicApiRateLimit(req, res, route) {
  const retryAfter = consumePublicApiRequest(getClientIp(req), route)
  if (!retryAfter) return true
  tooManyRequests(res, '请求过于频繁，请稍后再试', { 'retry-after': String(retryAfter) })
  return false
}

function enforceAuthenticatedApiRateLimit(req, res, context, route) {
  const retryAfter = consumeAuthenticatedApiRequest(context.accountId, getClientIp(req), route)
  if (!retryAfter) return true
  tooManyRequests(res, '操作过于频繁，请稍后再试', { 'retry-after': String(retryAfter) })
  return false
}

function isMessageCreationEnabled(config) {
  return config?.messagesEnabled === true
}

const adminPageSizes = [10, 20, 50, 100]

function getAdminPageSize(value, defaultPageSize = 10) {
  const pageSize = Number(value)
  return adminPageSizes.includes(pageSize) ? pageSize : defaultPageSize
}

function getAdminPagination(url, defaultPageSize = 10) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = getAdminPageSize(url.searchParams.get('pageSize'), defaultPageSize)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function getAdminContentPagination(url) {
  return Object.fromEntries([
    'contentAlbums',
    'contentAudios',
    'contentTexts',
    'articles',
    'letters',
  ].map((type) => [type, {
    page: Math.max(1, Number(url.searchParams.get(`${type}Page`)) || 1),
    pageSize: getAdminPageSize(
      url.searchParams.get(`${type}PageSize`) || url.searchParams.get('pageSize'),
    ),
  }]))
}

function getMiniProgramId(req, body = {}) {
  const appId = String(body.appId || getHeader(req, 'x-miniapp-appid') || '').trim()
  return getMiniProgramByAppId(appId)?.id || ''
}

function isActiveMiniProgram(miniProgramId) {
  const target = String(miniProgramId || '').trim()
  return getInternalAdminSettings().miniPrograms.some((item) => item.id === target && item.status !== 'archived')
}

function getCurrentAdminMiniProgramId() {
  const settings = getInternalAdminSettings()
  const current = settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId && item.status !== 'archived')
    || settings.miniPrograms.find((item) => item.status !== 'archived')
  return current?.id || ''
}

function requireAdminContentMiniProgramId(res, body = {}) {
  const requested = String(body.miniProgramId || '').trim()
  if (requested && !isActiveMiniProgram(requested)) {
    badRequest(res, '当前小程序已停用或不存在')
    return null
  }
  const miniProgramId = requested || getCurrentAdminMiniProgramId()
  if (!miniProgramId) {
    badRequest(res, '没有可用的小程序')
    return null
  }
  return miniProgramId
}

function readMiniAppContext(req, body = {}) {
  const miniProgramId = getMiniProgramId(req, body)
  if (!isActiveMiniProgram(miniProgramId)) return null
  const session = getMiniAppSession(getHeader(req, 'x-miniapp-session'), miniProgramId)
  const account = session ? getAccountById(session.accountId, miniProgramId) : null
  if (account) {
    return {
      accountId: account.accountId,
      authenticated: true,
      miniProgramId,
      visitorId: account.accountId,
    }
  }
  return {
    accountId: '',
    authenticated: false,
    miniProgramId,
    visitorId: String(body.visitorId || getHeader(req, 'x-visitor-id') || 'anonymous').trim() || 'anonymous',
  }
}

function requireMiniAppSession(req, res, body = {}) {
  const context = readMiniAppContext(req, body)
  if (!context) {
    badRequest(res, '当前 AppID 未在 Admin 接入或已停用')
    return null
  }
  if (!context.authenticated) {
    unauthorized(res, '请先完成微信登录后再操作')
    return null
  }
  return context
}

function sendDataScopeChanged(res) {
  sendJson(res, 409, {
    code: 'DATA_SCOPE_CHANGED',
    message: '数据空间已变化，请刷新后重试',
  })
}

function isExpectedDataScope(context, expectedDataScopeId) {
  return Boolean(expectedDataScopeId && getDataScope(context).dataScopeId === expectedDataScopeId)
}

function requireExpectedDataScope(res, context, expectedDataScopeId) {
  if (isExpectedDataScope(context, expectedDataScopeId)) return true
  sendDataScopeChanged(res)
  return false
}

function requireCurrentDataScope(req, res, context) {
  const requested = decodeDataScopeHeader(getHeader(req, 'x-miniapp-data-scope'))
  const current = getDataScope(context).dataScopeId
  if (requested && requested === current) return current
  sendDataScopeChanged(res)
  return ''
}

function hasValidDailyContentPromptTexts(system = {}) {
  if (!Object.prototype.hasOwnProperty.call(system, 'dailyContentPromptTexts')) return true
  const values = system.dailyContentPromptTexts
  // 空数组 = 显式清空文案，由客户端回落内置默认包，属于合法配置
  if (Array.isArray(values) && !values.length) return true
  if (!Array.isArray(values)) return false
  return values.every((value) => {
    const text = String(value || '').trim()
    const commaIndex = text.indexOf('，')
    return commaIndex > 0 && commaIndex < text.length - 1
  })
}

function getInvalidShareCoverCopy(shareSettings = {}) {
  const pools = shareSettings.private?.pools || {}
  for (const type of ['text', 'image', 'audio']) {
    const coverCopies = Array.isArray(pools[type]?.coverCopies) ? pools[type].coverCopies : []
    const invalid = coverCopies.find((item) => {
      const length = Array.from(String(item?.text || '').replace(/\s+/g, ' ').trim()).length
      return length < 4 || length > 20
    })
    if (invalid) return invalid.text
  }
  return ''
}

function getAdminContentOperationLog(body = {}, miniProgramId = '') {
  const settings = getInternalAdminSettings()
  const miniProgram = settings.miniPrograms.find((item) => item.id === miniProgramId && item.status !== 'archived')
    || settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId)
    || settings.miniPrograms.find((item) => item.status !== 'archived')
    || settings.miniPrograms[0]
  const miniProgramName = miniProgram?.name || '当前小程序'
  const poolId = String(body.poolId || miniProgram?.config?.contentPoolId || '').trim()
  const poolName = settings.contentPools.find((item) => item.id === poolId)?.name || '内容池'
  const action = String(body.auditAction || '').trim()
  const actions = {
    ads: { type: '小程序配置', target: miniProgramName, description: '广告设置已保存' },
    content: { type: '内容变更', target: poolName, description: `内容池「${poolName}」已保存` },
    copy: { type: '小程序配置', target: miniProgramName, description: '页面与按钮文案已保存' },
    display: { type: '小程序配置', target: miniProgramName, description: '首页显示设置已保存' },
    rules: { type: '小程序配置', target: miniProgramName, description: '使用规则已保存' },
  }
  if (actions[action]) return actions[action]
  if (Array.isArray(body.contentTexts) || Array.isArray(body.contentAudios) || Array.isArray(body.contentAlbums) || Array.isArray(body.letters) || Array.isArray(body.articles)) {
    return actions.content
  }
  if (body.ads) return actions.ads
  if (body.limits) return actions.rules
  if (body.system) return actions.copy
  return null
}

function normalizeUploadContentType(value) {
  const contentType = String(value || '').toLowerCase()
  if (contentType === 'image/jpg') return 'image/jpeg'
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) return contentType
  throw new Error('请上传 jpg、png、webp 或 gif 图片')
}

function getImageExtension(contentType, name = '') {
  const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'image/gif') return 'gif'
  return 'jpg'
}

function normalizeAudioUploadContentType(value, name = '') {
  const contentType = String(value || '').toLowerCase().split(';')[0].trim()
  const extension = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  const supported = {
    mp3: ['audio/mpeg', 'audio/mp3', 'audio/mpeg3'],
    m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
  }
  if (!supported[extension]) throw new Error('请上传 mp3 或 m4a 音频')
  if (contentType && contentType !== 'application/octet-stream' && !supported[extension].includes(contentType)) {
    throw new Error('音频格式与文件扩展名不一致')
  }
  return extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg'
}

function getAudioExtension(name = '') {
  const extension = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension === 'm4a' ? 'm4a' : 'mp3'
}

function makeUploadImageId(name = '') {
  const base = String(name || '')
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
  return `img-${base || Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function makeUploadAudioId(clientId = '') {
  if (clientId) return `audio-${crypto.createHash('sha256').update(clientId).digest('hex').slice(0, 24)}`
  return `audio-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`
}

function makeUploadBaseKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const folderPrefix = String(getInternalAdminSettings().storage?.folderPrefix || 'secretbox')
    .replace(/^\/+|\/+$/g, '')
  return `${folderPrefix || 'secretbox'}/uploads/${year}/${month}/${day}/${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`
}

function makeAudioUploadKey(name = '', clientId = '') {
  const folderPrefix = String(getInternalAdminSettings().storage?.folderPrefix || 'secretbox')
    .replace(/^\/+|\/+$/g, '')
  if (clientId) {
    const stableId = crypto.createHash('sha256').update(clientId).digest('hex').slice(0, 32)
    return `${folderPrefix || 'secretbox'}/audio/imports/${stableId}.${getAudioExtension(name)}`
  }
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const random = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`
  return `${folderPrefix || 'secretbox'}/audio/${year}/${month}/${day}/${random}.${getAudioExtension(name)}`
}

function getAvatarImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  throw new Error('头像格式无效，请重新选择图片')
}

function makeAvatarObjectKey(accountId) {
  const folderPrefix = String(getInternalAdminSettings().storage?.folderPrefix || 'secretbox')
    .replace(/^\/+|\/+$/g, '') || 'secretbox'
  const baseKey = `${folderPrefix}/avatars/${accountId}/${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`
  return `${baseKey}.jpg`
}

function signUploadTask(task) {
  const secret = String(getInternalAdminSettings().storage?.secretKey || 'secretbox-upload-task').trim()
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify({ imageRuleVersion: IMAGE_UPLOAD_RULE_VERSION, task }))
    .digest('hex')
}

function isUploadTaskSignatureValid(task, token) {
  const expected = signUploadTask(task)
  const actual = String(token || '').trim()
  if (!actual || actual.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

function normalizeOriginalSha256(value, { required = false } = {}) {
  const hash = String(value || '').trim().toLowerCase()
  if (!hash && !required) return ''
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('图片 SHA-256 无效，请重新选择文件')
  return hash
}

function prepareImageUpload(body = {}) {
  const name = String(body.name || 'image.jpg').trim()
  const size = Number(body.size || 0)
  const contentType = normalizeUploadContentType(body.type)
  const usage = String(body.usage || 'daily_content,article').trim()
  if (usage === 'article' && contentType === 'image/gif') {
    throw new Error('文章封面仅支持 JPG、PNG 或 WebP 图片')
  }
  const originalSha256 = normalizeOriginalSha256(body.originalSha256)
  if (!size || size > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5MB')

  const baseKey = makeUploadBaseKey()
  const originalKey = `${baseKey}/original.${getImageExtension(contentType, name)}`
  const mediumKey = `${baseKey}/medium.jpg`
  const thumbKey = `${baseKey}/thumb.jpg`
  const task = {
    id: `upload-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    imageId: makeUploadImageId(name),
    label: String(body.label || name.replace(/\.[^.]+$/, '') || '图片素材').trim(),
    originalName: name,
    originalSha256,
    originalSize: size,
    usage,
  }
  const storage = getInternalAdminSettings().storage
  const urls = {
    mediumUrl: getPublicCosUrl(storage, mediumKey),
    originalUrl: getPublicCosUrl(storage, originalKey),
    thumbUrl: getPublicCosUrl(storage, thumbKey),
  }
  return {
    task: {
      ...task,
      token: signUploadTask({ ...task, ...urls }),
    },
    upload: createDirectUploadTarget({
      contentType,
      key: originalKey,
      operations: makePicOperations({ mediumKey, thumbKey, usage: task.usage, bucket: storage?.bucket }),
    }),
    urls,
  }
}

function normalizeAudioDuration(value) {
  const duration = Number(value || 0)
  return Number.isFinite(duration) && duration >= 0 && duration <= 24 * 60 * 60
    ? Math.round(duration * 100) / 100
    : 0
}

function getAudioDefaultTitle(originalFilename) {
  return String(originalFilename || '').replace(/\.[^.]+$/, '').trim() || '轻读音频'
}

async function processAudioUpload(file, fields = {}) {
  const originalFilename = String(file?.filename || '').trim()
  const sizeBytes = Number(file?.buffer?.length || 0)
  const clientId = String(fields.clientId || '').trim()
  if (clientId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(clientId)) throw new Error('音频上传任务 ID 无效，请重新选择文件')
  const contentType = normalizeAudioUploadContentType(file?.contentType, originalFilename)
  if (!originalFilename) throw new Error('音频文件名不能为空')
  if (!sizeBytes || sizeBytes > 50 * 1024 * 1024) throw new Error('单个音频不能超过 50MB')

  const normalized = await normalizeAudioBuffer({ buffer: file.buffer, filename: originalFilename })
  const objectKey = makeAudioUploadKey(originalFilename, clientId)
  await uploadBufferToCos({
    buffer: normalized.buffer,
    contentType: normalized.contentType,
    key: objectKey,
  })
  return {
    id: makeUploadAudioId(clientId),
    label: String(fields.label || '默认').trim() || '默认',
    title: String(fields.title || '').trim() || getAudioDefaultTitle(originalFilename),
    originalFilename,
    objectKey,
    audioUrl: getPublicCosUrl(getInternalAdminSettings().storage, objectKey),
    durationSeconds: normalizeAudioDuration(fields.durationSeconds),
    sizeBytes: normalized.buffer.length,
    contentType: normalized.contentType || contentType,
    likeCount: 0,
    favoriteCount: 0,
  }
}

function getCompletedImageTask(body = {}) {
  return {
    id: String(body.taskId || '').trim(),
    imageId: String(body.imageId || '').trim(),
    label: String(body.label || '').trim(),
    originalName: String(body.originalName || '').trim(),
    originalSha256: normalizeOriginalSha256(body.originalSha256),
    originalSize: Number(body.originalSize || 0),
    usage: String(body.usage || 'daily_content,article').trim(),
    mediumUrl: String(body.mediumUrl || '').trim(),
    originalUrl: String(body.originalUrl || '').trim(),
    thumbUrl: String(body.thumbUrl || '').trim(),
  }
}

async function registerCompletedImageUploads(items = [], readinessOptions = {}) {
  const completed = items.map((body) => {
    const task = getCompletedImageTask(body)
    if (!isUploadTaskSignatureValid(task, body.token)) {
      throw new Error('上传任务校验失败，请重新选择图片上传')
    }
    return {
      clientId: String(body.clientId || task.id).trim(),
      task,
    }
  })
  const storage = getInternalAdminSettings().storage || {}
  const objectKeys = completed.flatMap(({ task }) => [task.mediumUrl, task.thumbUrl]
    .map((url) => getCosObjectKeyFromPublicUrl(storage, url)))
  if (objectKeys.some((objectKey) => !objectKey)) throw new Error('上传任务校验失败，请重新选择图片上传')
  try {
    await waitForCosObjectsReady(objectKeys, readinessOptions)
  } catch (error) {
    if (Array.isArray(error.pendingObjectKeys)) {
      const pendingObjectKeys = new Set(error.pendingObjectKeys)
      error.pendingClientIds = completed
        .filter(({ task }) => [task.mediumUrl, task.thumbUrl]
          .map((url) => getCosObjectKeyFromPublicUrl(storage, url))
          .some((objectKey) => pendingObjectKeys.has(objectKey)))
        .map(({ clientId }) => clientId)
      delete error.pendingObjectKeys
    }
    throw error
  }
  const savedItems = addImageAssets(completed.map(({ task }) => ({
    id: task.imageId,
    label: task.label,
    mediumUrl: task.mediumUrl,
    originalName: task.originalName,
    originalSha256: task.originalSha256,
    originalSize: task.originalSize,
    originalUrl: task.originalUrl,
    processingMode: 'cos-ci-direct',
    processingProfile: getImageProcessingProfile(task.usage),
    status: 'ready',
    thumbUrl: task.thumbUrl,
    uploadedAt: new Date().toISOString(),
    usage: task.usage,
  })))
  return completed.map((item, index) => ({ clientId: item.clientId, item: savedItems[index] }))
}

function isValidAudioContentItem(item = {}) {
  try {
    normalizeAudioUploadContentType(item.contentType, item.originalFilename)
  } catch (error) {
    return false
  }
  return Boolean(
    String(item.id || '').trim()
    && String(item.originalFilename || '').trim()
    && String(item.objectKey || '').trim()
    && String(item.audioUrl || '').trim()
    && Number(item.sizeBytes || 0) > 0
    && Number(item.sizeBytes || 0) <= 50 * 1024 * 1024
  )
}

function collectContentImageIds(items = []) {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => [
    ...(Array.isArray(item?.images) ? item.images : []),
    ...(Array.isArray(item?.bodyImageAssetIds) ? item.bodyImageAssetIds.map((id) => ({ id })) : []),
    item?.coverImage,
  ].filter(Boolean).map((image) => String(image?.id || '').trim()).filter(Boolean))
}

function findMissingContentImageIds(body = {}) {
  const ids = [
    ...collectContentImageIds(body.contentAlbums),
    ...collectContentImageIds(body.articles),
  ]
  const uniqueIds = [...new Set(ids)]
  const knownIds = new Set(getImagesByIds(uniqueIds).map((item) => item.id))
  return uniqueIds.filter((id) => !knownIds.has(id))
}

function validateAppendedContent(type, items) {
  if (!Array.isArray(items) || !items.length) throw new Error('没有可导入的内容')
  if (items.length > adminContentImportBatchLimit) throw new Error(`单次最多导入 ${adminContentImportBatchLimit} 条内容`)
  const ids = items.map((item) => String(item?.id || '').trim())
  if (ids.some((id) => !id)) throw new Error('导入内容 ID 不能为空')
  if (new Set(ids).size !== ids.length) throw new Error('同一批次存在重复的内容 ID')
  if (type === 'contentTexts' && items.some((item) => !String(item?.text || '').trim())) throw new Error('私密文案不能为空')
  if (type === 'contentAudios' && items.some((item) => !isValidAudioContentItem(item))) throw new Error('音频文件信息无效，请重新上传')
  if (type === 'letters' && items.some((item) => !String(item?.content || '').trim())) throw new Error('心笺内容不能为空')
  if (type === 'contentAlbums' && items.some((item) => !Array.isArray(item?.images) || !item.images.length)) throw new Error('每个私密图册组至少需要一张图片')
  if (type === 'articles' && items.some((item) => !String(item?.title || '').trim() || !String(item?.author || '').trim() || !String(item?.bodyMarkdown || '').trim())) throw new Error('文章标题、作者和正文不能为空')
}

function validateImageBatchClientIds(items, fallback) {
  const clientIds = items.map((item, index) => String(item?.clientId || fallback(item, index)).trim())
  if (clientIds.some((clientId) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(clientId))) {
    throw new Error('图片上传任务 ID 无效，请重新选择图片')
  }
  if (new Set(clientIds).size !== clientIds.length) throw new Error('同一批次存在重复的图片上传任务 ID')
  return clientIds
}

function createAppRouter({ imageReadinessOptions = {}, articleImportDependencies = {} } = {}) {
  const router = createRouter()

  router.get('/api/health', (req, res) => {
    getDatabase().prepare('SELECT 1 AS ok').get()
    ok(res, {
      database: 'ok',
      ok: true,
      service: 'secretbox-server',
      timestamp: new Date().toISOString(),
    })
  })

  router.get('/api/media/image', (req, res, url) => {
    const image = getImageById(url.searchParams.get('id'))
    const variants = {
      medium: 'mediumUrl',
      thumb: 'thumbUrl',
      original: 'originalUrl',
    }
    const variant = variants[url.searchParams.get('variant')]
    if (!variant) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ message: '图片不存在或暂不可预览' }))
      return
    }
    const dataUrl = String(image?.[variant] || '').trim()
    const match = dataUrl.match(/^data:([^;,]+)(;[^,]*)?,(.*)$/s)
    if (!match) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ message: '图片不存在或暂不可预览' }))
      return
    }
    const payload = /;base64(?:;|$)/.test(match[2] || '')
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]))
    res.writeHead(200, { 'content-type': match[1], 'cache-control': 'public, max-age=300' })
    res.end(payload)
  })

  router.get('/', (req, res) => redirectToAdminRoot(res))
  router.get('/admin', (req, res) => redirectToAdminRoot(res))
  router.get('/admin/', serveAdminAsset)
  getAdminAssetPaths()
    .filter((path) => path.startsWith('/admin/') && path !== '/admin/')
    .forEach((path) => router.get(path, serveAdminAsset))

  router.get('/api/admin/session', (req, res) => {
    const token = getSessionFromHeaders(req)
    if (!isSessionValid(token)) {
      unauthorized(res, '未登录')
      return
    }
    ok(res, getAdminAuthState())
  })
  router.post('/api/admin/login', async (req, res) => {
    const body = await readJsonBody(req)
    const account = String(body.account || '').trim()
    const ip = getClientIp(req)
    const retryAfter = getLoginRetryAfterSeconds(ip, account)
    if (retryAfter) {
      tooManyRequests(res, `登录尝试过于频繁，请 ${retryAfter} 秒后再试`, { 'retry-after': String(retryAfter) })
      return
    }
    const session = loginAdmin(body.account, body.password)
    if (!session) {
      recordLoginFailure(ip, account)
      unauthorized(res, '账号或密码错误')
      return
    }
    clearLoginFailures(ip, account)
    ok(res, { ok: true, admin: getAdminAuthState() }, {
      'set-cookie': buildAdminSessionCookie(session.token),
    })
  })
  router.post('/api/admin/logout', (req, res) => {
    const token = getSessionFromHeaders(req)
    logoutAdmin(token)
    ok(res, { ok: true }, {
      'set-cookie': clearAdminSessionCookie(),
    })
  })

  router.post('/api/miniapp/session', async (req, res) => {
    const body = await readJsonBody(req)
    const context = readMiniAppContext(req, body)
    if (!context) {
      badRequest(res, '当前 AppID 未在 Admin 接入或已停用')
      return
    }
    const expectedDataScopeId = requireCurrentDataScope(req, res, context)
    if (!expectedDataScopeId) return
    if (!enforcePublicApiRateLimit(req, res, 'session')) return
    const payload = {}
    if (hasWechatCredentials(context)) {
      if (!String(body.code || '').trim()) {
        badRequest(res, '微信登录凭据不能为空')
        return
      }
      Object.assign(payload, await exchangeLoginCode(body.code, context))
    } else if (env.productionLike) {
      badRequest(res, '当前小程序尚未在 admin 后台配置微信登录凭据')
      return
    }
    if (!requireExpectedDataScope(res, context, expectedDataScopeId)) return
    const profile = syncLogin(context, payload)
    const session = createMiniAppSession({
      accountId: profile.accountId,
      miniProgramId: context.miniProgramId,
    })
    recordPageView({ miniProgramId: context.miniProgramId, visitorId: profile.accountId }, 'app')
    ok(res, {
      profile,
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
      wechatConfigured: hasWechatCredentials(context),
    })
  })

  router.get('/api/miniapp/home', (req, res) => {
    if (!enforcePublicApiRateLimit(req, res, 'home')) return
    const context = readMiniAppContext(req)
    if (!context) {
      badRequest(res, '当前 AppID 未在 Admin 接入或已停用')
      return
    }
    if (context.authenticated) recordPageView(context, 'home')
    ok(res, getHomeData(context))
  })
  router.get('/api/miniapp/activity', (req, res, url) => {
    const context = requireMiniAppSession(req, res)
    if (!context) return
    ok(res, getActivityData(context, {
      section: url.searchParams.get('section'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }))
  })
  router.get('/api/miniapp/letters', (req, res, url) => {
    if (!enforcePublicApiRateLimit(req, res, 'letters')) return
    const context = readMiniAppContext(req)
    if (!context) return badRequest(res, '当前 AppID 未在 Admin 接入或已停用')
    ok(res, getLetters(context, {
      includeId: url.searchParams.get('contentId'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }))
  })
  router.get('/api/miniapp/articles', (req, res, url) => {
    if (!enforcePublicApiRateLimit(req, res, 'articles')) return
    const context = readMiniAppContext(req)
    if (!context) return badRequest(res, '当前 AppID 未在 Admin 接入或已停用')
    ok(res, getArticles(context, {
      includeId: url.searchParams.get('contentId'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }))
  })
  router.get('/api/miniapp/articles/:contentId', (req, res, url) => {
    if (!enforcePublicApiRateLimit(req, res, 'article-detail')) return
    const context = requireMiniAppSession(req, res)
    if (!context) return
    const result = getArticleDetail(context, url.params.contentId)
    if (!result) return badRequest(res, '文章不存在或已下线')
    ok(res, result)
  })
  router.get('/api/miniapp/articles/:contentId/recommendations', (req, res, url) => {
    if (!enforcePublicApiRateLimit(req, res, 'article-recommendations')) return
    const context = requireMiniAppSession(req, res)
    if (!context) return
    const result = getArticleRecommendations(context, url.params.contentId, {
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
      seed: url.searchParams.get('seed'),
    })
    if (!result) return badRequest(res, '文章不存在或已下线')
    ok(res, result)
  })
  router.post('/api/miniapp/articles/:contentId/open', async (req, res, url) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    if (!requireCurrentDataScope(req, res, context)) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'article_open')) return
    const article = findContentItem(context, 'article', url.params.contentId)
    if (!article) return badRequest(res, '文章不存在或已下线')
    try {
      const outcome = executeIdempotently({
        context,
        operation: 'article_open',
        requestKey: getHeader(req, 'x-idempotency-key'),
        payload: { contentId: article.id },
        execute() {
          const opened = recordOpened(context, 'article', article)
          recordAnalyticsEvent('article_open', context, { source: 'article', sourceId: article.id })
          return { status: 201, body: { openedId: opened.id, recorded: true } }
        },
      })
      created(res, outcome.body)
    } catch (error) {
      badRequest(res, error.message || '文章打开记录失败')
    }
  })
  router.post('/api/miniapp/articles/:contentId/unlock', async (req, res, url) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    if (!requireCurrentDataScope(req, res, context)) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'article_unlock')) return
    const detail = getArticleDetail(context, url.params.contentId)
    if (!detail) {
      badRequest(res, '文章不存在或已下线')
      return
    }
    const adConfig = getHomeData(context).ads?.articleExpandRewarded || {}
    const adConfigured = Boolean(adConfig.enabled && String(adConfig.adUnitId || '').trim())
    const freeCount = Math.max(0, Number(adConfig.freeCount || 0))
    if (!detail.unlockedToday && adConfigured && countEvents('article_unlock', context) >= freeCount && body.rewarded !== true) {
      badRequest(res, '请完整观看广告后再展开全文')
      return
    }
    const result = unlockArticle(context, url.params.contentId)
    if (!result) return badRequest(res, '文章不存在或已下线')
    ok(res, result)
  })
  router.get('/api/miniapp/config', (req, res) => {
    if (!enforcePublicApiRateLimit(req, res, 'config')) return
    const context = readMiniAppContext(req)
    if (!context) return badRequest(res, '当前 AppID 未在 Admin 接入或已停用')
    ok(res, getPublicMiniAppConfig(context))
  })
  // 独立文案包（L3）：客户端带版本号轮询，未变更只回 changed:false；永不参与启动门
  router.get('/api/miniapp/copy-pack', (req, res, url) => {
    if (!enforcePublicApiRateLimit(req, res, 'copy-pack')) return
    const context = readMiniAppContext(req)
    if (!context) return badRequest(res, '当前 AppID 未在 Admin 接入或已停用')
    ok(res, getPublicCopyPack(context, url.searchParams.get('version')))
  })
  router.get('/api/miniapp/profile', (req, res) => {
    const context = requireMiniAppSession(req, res)
    if (!context) return
    ok(res, getProfileData(context))
  })
  router.get('/api/miniapp/preferences', (req, res) => {
    const context = requireMiniAppSession(req, res)
    if (!context) return
    ok(res, getPreferences(context))
  })
  router.post('/api/miniapp/profile', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    const expectedDataScopeId = requireCurrentDataScope(req, res, context)
    if (!expectedDataScopeId) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'profile_save')) return
    delete body.phone
    delete body.phoneVerified
    delete body.avatarUrl
    ok(res, { profile: updateProfile(context, body) })
  })
  router.post('/api/miniapp/profile/avatar', async (req, res) => {
    const context = requireMiniAppSession(req, res)
    if (!context) return
    const expectedDataScopeId = requireCurrentDataScope(req, res, context)
    if (!expectedDataScopeId) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'avatar')) return
    let fields
    let file
    try {
      ({ fields, file } = await readMultipartFile(req, {
        fieldName: 'avatar',
        maxBytes: 200 * 1024,
        tooLargeMessage: '头像图片不能超过 200KB',
      }))
    } catch (error) {
      badRequest(res, error.message || '头像上传格式无效')
      return
    }
    if (!requireExpectedDataScope(res, context, expectedDataScopeId)) return
    let contentType
    try {
      contentType = getAvatarImageType(file.buffer)
    } catch (error) {
      badRequest(res, error.message)
      return
    }

    const account = getAccountSummary(context)
    const storage = getInternalAdminSettings().storage
    const previousAvatarKey = getManagedAvatarObjectKey(storage, account.accountId, account.avatarUrl)
    const avatarKey = makeAvatarObjectKey(account.accountId)
    try {
      await uploadBufferToCos({
        buffer: file.buffer,
        contentType,
        key: avatarKey,
      })
      if (!isExpectedDataScope(context, expectedDataScopeId)) {
        try {
          await deleteCosObject(avatarKey)
        } catch (cleanupError) {
          // Best-effort cleanup prevents an unreferenced upload after a scope switch.
        }
        sendDataScopeChanged(res)
        return
      }
      const profile = updateProfile(context, {
        avatarUrl: getPublicCosUrl(storage, avatarKey),
        nickname: fields.nickname,
      })
      if (previousAvatarKey && previousAvatarKey !== avatarKey) {
        try {
          await deleteCosObject(previousAvatarKey)
        } catch (cleanupError) {
          // The new profile is already durable; stale-file cleanup can be retried independently.
        }
      }
      ok(res, { profile })
    } catch (error) {
      try {
        await deleteCosObject(avatarKey)
      } catch (cleanupError) {
        // Best-effort cleanup keeps a failed upload from becoming a user profile image.
      }
      const cosCode = String(error?.cosCode || '')
      const cosMessage = String(error?.cosMessage || '')
      if (Number.isInteger(error?.cosStatus)) {
        appendOperationLog({
          actor: 'system',
          type: '头像上传失败',
          target: account.accountId,
          badge: 'danger',
          description: [
            `HTTP ${error.cosStatus}`,
            cosCode && `COS Code: ${cosCode}`,
            cosMessage && `COS Message: ${cosMessage}`,
          ].filter(Boolean).join('；'),
        })
      }
      const detail = cosCode ? `（错误编号：${cosCode}）` : ''
      badRequest(res, `头像处理失败，请稍后重试${detail}`)
    }
  })
  router.post('/api/miniapp/profile/sync-login', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    const expectedDataScopeId = requireCurrentDataScope(req, res, context)
    if (!expectedDataScopeId) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'profile_sync_login')) return
    const payload = {
      nickname: body.nickname,
      avatarText: body.avatarText,
      avatarUrl: body.avatarUrl,
    }
    if (body.phoneCode && hasWechatCredentials(context)) {
      payload.phone = await exchangePhoneCode(body.phoneCode, context)
      payload.phoneVerified = true
    }
    if (!requireExpectedDataScope(res, context, expectedDataScopeId)) return
    const profile = syncLogin(context, payload)
    const session = profile.accountId === context.accountId
      ? null
      : createMiniAppSession({ accountId: profile.accountId, miniProgramId: context.miniProgramId })
    ok(res, {
      profile,
      ...(session ? { sessionToken: session.token, sessionExpiresAt: session.expiresAt } : {}),
      wechatConfigured: hasWechatCredentials(context),
    })
  })

  router.post('/api/miniapp/daily-content/open', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    const expectedDataScopeId = requireCurrentDataScope(req, res, context)
    if (!expectedDataScopeId) return
    const requestedType = String(body.type || 'random').trim() || 'random'
    const excludeId = String(body.excludeId || '').trim()
    const contentId = String(body.contentId || '').trim()
    try {
      const outcome = executeIdempotently({
        context,
        operation: 'daily_content_open',
        requestKey: getHeader(req, 'x-idempotency-key'),
        payload: { contentId, excludeId, type: requestedType },
        execute() {
          const limit = Number(getHomeData(context).limits?.dailyContentLimit)
          const openedToday = countEvents('daily_content_open', context)
          if (Number.isFinite(limit) && limit > 0 && openedToday >= limit) {
            return { status: 400, body: { message: '今天没有更多手记，请明天再试' } }
          }
          const result = openDailyContent(requestedType, context, excludeId, contentId)
          if (!result.dailyContent) {
            return { status: 400, body: { message: result.message || '内容正在准备中，请稍后再来' } }
          }
          recordAnalyticsEvent('daily_content_open', context, {
            requestedType,
            dailyContentId: result.dailyContent.id,
            dailyContentType: result.dailyContent.type || '',
          })
          recordOpened(context, 'daily_content', result.dailyContent)
          return { status: 201, body: result }
        },
      })
      if (outcome.status === 201) created(res, outcome.body)
      else badRequest(res, outcome.body.message || '打开手记失败')
    } catch (error) {
      badRequest(res, error.message || '打开手记失败')
    }
  })

  router.post('/api/miniapp/daily-content/availability', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    const requestedType = String(body.type || 'random').trim() || 'random'
    const contentId = String(body.contentId || '').trim()
    const excludeId = String(body.excludeId || '').trim()
    ok(res, getDailyContentAvailability(requestedType, context, contentId, excludeId))
  })

  router.post('/api/miniapp/rewarded-ad-access', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    const placement = String(body.placement || '').trim()
    const placements = {
      daily_content: { adKey: 'homeDailyContentRewarded', eventType: 'daily_content_open' },
      checkin: { adKey: 'homeCheckInRewarded', eventType: 'check_in' },
      article_expand: { adKey: 'articleExpandRewarded', eventType: 'article_unlock' },
    }
    const target = placements[placement]
    if (!target) {
      badRequest(res, '广告场景无效')
      return
    }
    const config = getHomeData(context).ads?.[target.adKey] || {}
    const freeCount = Math.max(0, Number(config.freeCount || 0))
    const usedCount = countEvents(target.eventType, context)
    ok(res, { free: usedCount < freeCount, freeCount, usedCount })
  })

  router.post('/api/miniapp/interactions/toggle', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    if (!requireCurrentDataScope(req, res, context)) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'interaction_toggle')) return
    const source = String(body.source || '').trim()
    const sourceId = String(body.sourceId || '').trim()
    const content = findContentItem(context, source, sourceId)
    if (!content) {
      badRequest(res, '内容不存在或已下线')
      return
    }
    try {
      const outcome = executeIdempotently({
        context,
        operation: 'interaction',
        requestKey: getHeader(req, 'x-idempotency-key'),
        payload: { source, sourceId, type: String(body.type || '').trim(), desiredState: body.desiredState },
        execute() {
          const result = typeof body.desiredState === 'boolean'
            ? setReaction(context, { source, sourceId, type: body.type, desiredState: body.desiredState })
            : toggleReaction(context, { source, sourceId, type: body.type })
          const interaction = {
            ...result,
            favoriteCount: Number(content.favoriteCount || 0) + result.publicFavoriteDelta,
            likeCount: Number(content.likeCount || 0) + result.publicLikeDelta,
          }
          recordAnalyticsEvent(`interaction_${body.type}`, context, { source, sourceId })
          return { status: 200, body: { interaction } }
        },
      })
      ok(res, outcome.body)
    } catch (error) {
      badRequest(res, error.message || '互动失败')
    }
  })

  router.post('/api/miniapp/interactions/share', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    if (!requireCurrentDataScope(req, res, context)) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'interaction_share')) return
    const source = String(body.source || '').trim()
    const sourceId = String(body.sourceId || '').trim()
    if (!findContentItem(context, source, sourceId)) {
      badRequest(res, '内容不存在或已下线')
      return
    }
    try {
      recordShare(context, { source, sourceId })
      recordAnalyticsEvent('interaction_share', context, { source, sourceId })
      created(res, { recorded: true })
    } catch (error) {
      badRequest(res, error.message || '分享记录失败')
    }
  })

  router.post('/api/miniapp/check-in', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    if (!requireCurrentDataScope(req, res, context)) return
    try {
      const outcome = executeIdempotently({
        context,
        operation: 'check_in',
        requestKey: getHeader(req, 'x-idempotency-key'),
        payload: {},
        execute() {
          const result = checkIn(context)
          if (!result.created) return { status: 400, body: { message: '今天已经打过卡，请明天再试' } }
          recordAnalyticsEvent('check_in', context, {
            checkedToday: Boolean(result.checkIn?.checkedToday),
            totalDays: result.checkIn?.totalDays || 0,
          })
          return { status: 201, body: result }
        },
      })
      if (outcome.status === 201) created(res, outcome.body)
      else badRequest(res, outcome.body.message || '打卡失败')
    } catch (error) {
      badRequest(res, error.message || '打卡失败')
    }
  })

  router.post('/api/miniapp/messages', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    const expectedDataScopeId = requireCurrentDataScope(req, res, context)
    if (!expectedDataScopeId) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'message_create')) return
    if (!isMessageCreationEnabled(getMiniProgramRuntimeConfig(context))) {
      badRequest(res, '留言功能已关闭')
      return
    }
    const content = normalizeMessageContent(body.content)
    const source = String(body.source || '').trim()
    const sourceId = String(body.sourceId || '').trim()

    if (!content) {
      badRequest(res, '留言内容不能为空')
      return
    }
    if (getMessageContentUnits(content) > MESSAGE_CONTENT_MAX_UNITS) {
      badRequest(res, MESSAGE_CONTENT_LIMIT_TEXT)
      return
    }
    if (!findContentItem(context, source, sourceId)) {
      badRequest(res, '对应内容不存在或已下线')
      return
    }

    const idempotency = {
      context,
      operation: 'message',
      requestKey: getHeader(req, 'x-idempotency-key'),
      payload: { source, sourceId, content },
    }
    try {
      const stored = getStoredResult(idempotency)
      if (stored) {
        if (stored.status >= 200 && stored.status < 300) created(res, stored.body)
        else badRequest(res, stored.body.message || '留言失败')
        return
      }
    } catch (error) {
      badRequest(res, error.message || '请求幂等键无效')
      return
    }

    const security = await checkMessageBeforeSave(content, context)
    if (!requireExpectedDataScope(res, context, expectedDataScopeId)) return
    try {
      const outcome = executeIdempotently({
        ...idempotency,
        execute() {
          const message = createMessage({
            accountId: getProfileData(context).profile.accountId,
            content,
            miniProgramId: context.miniProgramId,
            source,
            sourceId,
            security,
            visitorId: context.visitorId,
          })
          recordAnalyticsEvent('message_create', context, {
            messageId: message.id,
            source,
            status: message.status,
          })
          if (!security.passed) {
            appendOperationLog({
              actor: 'system',
              type: '留言审核',
              target: message.id,
              description: security.reason || '留言内容未通过安全检测',
              badge: 'danger',
            })
            return { status: 400, body: { message: security.reason || '留言内容未通过安全检测' } }
          }
          return {
            status: 201,
            body: { messageId: message.id, status: message.status, security },
          }
        },
      })
      if (outcome.status >= 200 && outcome.status < 300) created(res, outcome.body)
      else badRequest(res, outcome.body.message || '留言失败')
    } catch (error) {
      badRequest(res, error.message || '留言失败')
    }
  })

  router.delete('/api/miniapp/messages', async (req, res) => {
    const body = await readJsonBody(req)
    const context = requireMiniAppSession(req, res, body)
    if (!context) return
    if (!requireCurrentDataScope(req, res, context)) return
    if (!enforceAuthenticatedApiRateLimit(req, res, context, 'message_delete')) return
    const source = String(body.source || '').trim()
    const sourceId = String(body.sourceId || '').trim()
    if (!findContentItem(context, source, sourceId)) {
      badRequest(res, '对应内容不存在或已下线')
      return
    }
    try {
      const outcome = executeIdempotently({
        context,
        operation: 'message_delete',
        requestKey: getHeader(req, 'x-idempotency-key'),
        payload: { source, sourceId },
        execute() {
          const message = deleteCurrentMessage({
            accountId: context.accountId,
            miniProgramId: context.miniProgramId,
            source,
            sourceId,
            visitorId: context.visitorId,
          })
          return { status: 200, body: { deleted: Boolean(message) } }
        },
      })
      ok(res, outcome.body)
    } catch (error) {
      badRequest(res, error.message || '删除留言失败')
    }
  })

  router.get('/api/admin/bootstrap', (req, res) => {
    if (!requireAdminSession(req, res)) return
    ok(res, getAdminBootstrap({ groupId: new URL(req.url, 'http://localhost').searchParams.get('groupId') || '' }))
  })
  router.get('/api/admin/preflight', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    ok(res, await getAdminPreflight())
  })
  router.get('/api/admin/settings', (req, res) => {
    if (!requireAdminSession(req, res)) return
    ok(res, getAdminSettingsWithUploadKeys())
  })
  router.post('/api/admin/secrets/reveal', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const internalSettings = getInternalAdminSettings()
    let value = ''
    if (body.secret === 'storageSecretKey') {
      value = String(internalSettings.storage?.secretKey || '').trim()
    } else if (body.secret === 'appSecret') {
      const miniProgramId = String(body.miniProgramId || '').trim()
      const miniProgram = internalSettings.miniPrograms.find((item) => (
        item.id === miniProgramId && item.status !== 'archived'
      ))
      value = String(miniProgram?.appSecret || '').trim()
    }
    if (!value) {
      badRequest(res, '密钥不存在或未配置', { 'cache-control': 'no-store' })
      return
    }
    ok(res, { value }, { 'cache-control': 'no-store' })
  })
  router.get('/api/admin/content', (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const miniProgramId = requireAdminContentMiniProgramId(res, { miniProgramId: url.searchParams.get('miniProgramId') || '' })
    if (!miniProgramId) return
    ok(res, getAdminContent(
      url.searchParams.get('poolId'),
      miniProgramId,
      getAdminContentPagination(url),
    ))
  })
  router.post('/api/admin/share-settings', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const shareSettings = body.shareSettings
    if (!shareSettings || typeof shareSettings !== 'object' || Array.isArray(shareSettings)) {
      badRequest(res, '分享模板请求格式无效')
      return
    }
    if (getInvalidShareCoverCopy(shareSettings)) {
      badRequest(res, '封面文案限 4 至 20 个字；超过 10 个字会自动分成两行')
      return
    }
    const saved = updateGlobalShareSettings(shareSettings)
    appendOperationLog({
      type: '全局配置',
      target: '全局分享模板',
      description: '所有小程序共用的分享模板已保存',
    })
    ok(res, { shareSettings: saved })
  })
  router.get('/api/admin/images', (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const { page, pageSize, offset } = getAdminPagination(url)
    const total = countImages()
    ok(res, {
      items: getImages({ limit: pageSize, offset }),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      policy: imagePolicy,
    })
  })
  router.get('/api/admin/messages', (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const { page, pageSize, offset } = getAdminPagination(url)
    const filters = {
      keyword: String(url.searchParams.get('keyword') || '').trim(),
      miniProgramId: String(url.searchParams.get('miniProgramId') || '').trim(),
      source: String(url.searchParams.get('source') || '').trim(),
      status: String(url.searchParams.get('status') || '').trim(),
    }
    const total = countMessages(filters)
    ok(res, {
      items: getMessages({ limit: pageSize, offset, ...filters }),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  })
  router.get('/api/admin/accounts', (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const miniProgramId = requireAdminContentMiniProgramId(res, { miniProgramId: url.searchParams.get('miniProgramId') || '' })
    if (!miniProgramId) return
    const { page, pageSize, offset } = getAdminPagination(url)
    const total = countAccounts(miniProgramId)
    ok(res, {
      items: getAccounts(miniProgramId, { limit: pageSize, offset }),
      miniProgramId,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      policy: accountPolicy,
    })
  })
  router.post('/api/admin/accounts/delete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const miniProgramId = requireAdminContentMiniProgramId(res, body)
    if (!miniProgramId) return
    const result = await deleteAccountForMiniProgram({ accountId: body.accountId, miniProgramId })
    if (!result) {
      badRequest(res, '当前小程序中不存在该账号')
      return
    }
    ok(res, result)
  })
  router.get('/api/admin/auth', (req, res) => {
    if (!requireAdminSession(req, res)) return
    ok(res, getAdminAuthState())
  })
  router.post('/api/admin/messages/status', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const status = String(body.status || '')
    if (!['saved', 'blocked'].includes(status)) {
      badRequest(res, '留言状态无效')
      return
    }
    const message = updateMessageStatus(String(body.id || ''), status)
    if (!message) {
      badRequest(res, '留言不存在')
      return
    }
    appendOperationLog({
      type: '留言审核',
      target: message.id,
      description: `留言状态已更新为 ${message.status}`,
      badge: message.status === 'blocked' ? 'warning' : 'success',
    })
    ok(res, message)
  })
  router.post('/api/admin/messages/delete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const message = deleteMessage(String(body.id || ''))
    if (!message) {
      badRequest(res, '留言不存在')
      return
    }
    appendOperationLog({
      type: '留言审核',
      target: message.id,
      description: '已删除私密留言记录',
      badge: 'danger',
    })
    ok(res, { deleted: true, id: message.id })
  })
  router.post('/api/admin/settings', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const payload = body.settings
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      badRequest(res, '后台设置请求格式无效')
      return
    }
    if (Object.hasOwn(payload, 'shareSettings')) {
      badRequest(res, '分享模板请使用全局分享设置保存')
      return
    }
    let settings
    try {
      settings = updateAdminSettings(payload, body.meta || {})
    } catch (error) {
      badRequest(res, error.message || '后台设置保存失败')
      return
    }
    if (Object.hasOwn(payload, 'storage')) {
      try {
        settings.storageCors = await configureDirectUploadCors()
      } catch (error) {
        settings.storageCors = {
          ok: false,
          message: error.message || 'COS 直传跨域规则配置失败',
        }
      }
    }
    ok(res, {
      ...settings,
      miniPrograms: settings.miniPrograms.map((item) => ({
        ...item,
        uploadKeyConfigured: hasMiniProgramUploadKey(item.appId),
      })),
    })
  })
  router.post('/api/admin/groups', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    try {
      const body = await readJsonBody(req)
      ok(res, addUploadKeyState(updateMiniProgramGroups(body, body?.meta || {})))
    } catch (error) {
      badRequest(res, error.message || '分组保存失败')
    }
  })
  router.post('/api/admin/miniprogram/select', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      ok(res, addUploadKeyState(setCurrentMiniProgram(body.id)))
    } catch (error) {
      badRequest(res, error.message || '小程序切换失败')
    }
  })
  router.post('/api/admin/miniprogram/create', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    if (!body.miniProgram || typeof body.miniProgram !== 'object' || Array.isArray(body.miniProgram)) {
      badRequest(res, '小程序创建请求格式无效')
      return
    }
    if (Object.hasOwn(body.miniProgram.config || {}, 'shareSettings')) {
      badRequest(res, '分享模板请使用全局分享设置保存')
      return
    }
    try {
      ok(res, addUploadKeyState(createMiniProgram(body.miniProgram, body.meta || {})))
    } catch (error) {
      badRequest(res, error.message || '小程序创建失败')
    }
  })
  router.post('/api/admin/miniprogram/update', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    if (!body.miniProgram || typeof body.miniProgram !== 'object' || Array.isArray(body.miniProgram)) {
      badRequest(res, '小程序更新请求格式无效')
      return
    }
    if (Object.hasOwn(body.miniProgram?.config || {}, 'shareSettings')) {
      badRequest(res, '分享模板请使用全局分享设置保存')
      return
    }
    try {
      ok(res, addUploadKeyState(updateMiniProgram(body.id, body.miniProgram || {}, body.meta || {})))
    } catch (error) {
      badRequest(res, error.message || '小程序保存失败')
    }
  })
  router.post('/api/admin/miniprogram/config', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
      badRequest(res, '小程序配置请求格式无效')
      return
    }
    try {
      ok(res, addUploadKeyState(updateMiniProgramConfig(body.id, body.config, body.meta || {})))
    } catch (error) {
      badRequest(res, error.message || '小程序配置保存失败')
    }
  })
  router.post('/api/admin/miniprogram/status', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      ok(res, addUploadKeyState(setMiniProgramStatus(body.id, body.status, body.meta || {})))
    } catch (error) {
      badRequest(res, error.message || '小程序状态更新失败')
    }
  })
  router.post('/api/admin/miniprogram/delete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      const deletion = deleteMiniProgram(body.id, { actor: body.meta?.actor || 'admin' })
      ok(res, {
        ...addUploadKeyState(getAdminSettings()),
        deletion,
      })
    } catch (error) {
      badRequest(res, error.message || '小程序删除失败')
    }
  })
  router.post('/api/admin/miniprogram/reorder', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      ok(res, addUploadKeyState(reorderMiniProgram(body.id, body.direction)))
    } catch (error) {
      badRequest(res, error.message || '小程序排序失败')
    }
  })
  router.post('/api/admin/miniprogram/version-preview', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const miniProgramId = String(body.miniProgramId || '').trim()
    const exists = getInternalAdminSettings().miniPrograms.some((item) => item.id === miniProgramId && item.status !== 'archived')
    if (!exists) {
      badRequest(res, '当前小程序已停用或不存在')
      return
    }
    try {
      ok(res, getMiniProgramNextVersion())
    } catch (error) {
      badRequest(res, error.message || '版本号生成失败')
    }
  })
  router.post('/api/admin/miniprogram/upload', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const miniProgramId = String(body.miniProgramId || '').trim()
    const miniProgram = getInternalAdminSettings().miniPrograms.find((item) => (
      item.id === miniProgramId && item.status !== 'archived'
    ))
    if (!miniProgram) {
      badRequest(res, '当前小程序已停用或不存在')
      return
    }
    try {
      const result = await uploadMiniProgramCode({
        appId: miniProgram.appId,
        description: body.description,
        privateKey: body.privateKey,
        version: body.version,
      })
      ok(res, result)
    } catch (error) {
      if (error instanceof MiniProgramUploadError) {
        badRequest(res, error.message)
        return
      }
      throw error
    }
  })
  router.post('/api/admin/storage/test', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    ok(res, await testCosConnection())
  })
  router.post('/api/admin/content-pools/delete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const id = String(body.id || '').trim()
    const settings = getInternalAdminSettings()
    const pool = settings.contentPools.find((item) => item.id === id)
    if (!pool) {
      badRequest(res, '内容池不存在')
      return
    }
    const usage = settings.miniPrograms.filter((item) => item.status !== 'archived' && item.config?.contentPoolId === id).length
    if (usage > 0) {
      badRequest(res, '该内容池正被小程序使用，无法删除')
      return
    }
    const removedImageAssetIds = getContentImageAssetIds(id)
    deleteContentPoolData(id)
    await reclaimImageAssets(removedImageAssetIds)
    const nextSettings = updateAdminSettings(
      { contentPools: settings.contentPools.filter((item) => item.id !== id) },
      { type: '内容池管理', target: pool.name, description: `已删除内容池「${pool.name}」`, badge: 'warning' },
    )
    ok(res, nextSettings)
  })
  router.post('/api/admin/content', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const contentTexts = Array.isArray(body.contentTexts) ? body.contentTexts : []
    const contentAudios = Array.isArray(body.contentAudios) ? body.contentAudios : []
    const letters = Array.isArray(body.letters) ? body.letters : []
    const articles = Array.isArray(body.articles) ? body.articles : []
    const missingImageIds = findMissingContentImageIds(body)

    if (missingImageIds.length) {
      badRequest(res, `图片 ID 不存在：${missingImageIds.slice(0, 8).join(', ')}`)
      return
    }

    if (body.contentTexts && !contentTexts.some((item) => String(item.text || '').trim())) {
      badRequest(res, '至少保留一条私密文案')
      return
    }

    if (body.contentAudios && contentAudios.some((item) => !isValidAudioContentItem(item))) {
      badRequest(res, '音频文件信息无效，请重新上传')
      return
    }

    if (body.letters && !letters.some((item) => String(item.content || '').trim())) {
      badRequest(res, '至少保留一条心笺')
      return
    }

    if (body.articles && !articles.some((item) => String(item.title || '').trim() && String(item.bodyMarkdown || '').trim())) {
      badRequest(res, '至少保留一篇标题和正文完整的文章')
      return
    }

    if (body.system && !hasValidDailyContentPromptTexts(body.system)) {
      badRequest(res, '打开前引导文案每行必须包含中文逗号“，”，且逗号前后都要有文字')
      return
    }

    if (Object.hasOwn(body, 'shareSettings')) {
      badRequest(res, '分享模板请使用全局分享设置保存')
      return
    }

    const miniProgramId = requireAdminContentMiniProgramId(res, body)
    if (!miniProgramId) return
    const content = updateAdminContent(body, miniProgramId)
    await reclaimImageAssets(content.removedImageAssetIds || [])
    delete content.removedImageAssetIds
    const operationLog = getAdminContentOperationLog(body, miniProgramId)
    if (operationLog) appendOperationLog(operationLog)
    ok(res, content)
  })
  router.get('/api/admin/articles', (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const body = {
      miniProgramId: url.searchParams.get('miniProgramId'),
      poolId: url.searchParams.get('poolId'),
    }
    const miniProgramId = requireAdminContentMiniProgramId(res, body)
    if (!miniProgramId) return
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = getAdminPageSize(url.searchParams.get('pageSize'), 20)
    const content = getAdminContent(body.poolId, miniProgramId, { articles: { page, pageSize } })
    ok(res, {
      items: content.articles,
      pagination: content.pagination.articles,
      poolId: content.poolId,
    })
  })
  router.post('/api/admin/articles', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const item = body.article && typeof body.article === 'object' ? body.article : null
    try {
      validateAppendedContent('articles', item ? [item] : [])
      const missingImageIds = findMissingContentImageIds({ articles: [item] })
      if (missingImageIds.length) throw new Error(`图片 ID 不存在：${missingImageIds.slice(0, 8).join(', ')}`)
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const content = appendAdminContentItems({ poolId: body.poolId, type: 'articles', items: [item], miniProgramId })
      ok(res, { article: content.articles.find((entry) => entry.id === item.id) || item, poolId: content.poolId })
    } catch (error) {
      badRequest(res, error.message || '文章创建失败')
    }
  })
  router.post('/api/admin/articles/preview', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    if (!hasReadableArticleContent(body.bodyMarkdown)) {
      badRequest(res, '文章正文不能为空')
      return
    }
    ok(res, { renderedHtml: renderArticleMarkdown(body.bodyMarkdown) })
  })
  router.post('/api/admin/articles/:contentId', async (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const item = body.article && typeof body.article === 'object'
      ? { ...body.article, id: url.params.contentId }
      : null
    try {
      validateAppendedContent('articles', item ? [item] : [])
      const missingImageIds = findMissingContentImageIds({ articles: [item] })
      if (missingImageIds.length) throw new Error(`图片 ID 不存在：${missingImageIds.slice(0, 8).join(', ')}`)
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const content = updateAdminContentItem({ poolId: body.poolId, type: 'articles', item, miniProgramId })
      await reclaimImageAssets(content.removedImageAssetIds || [])
      delete content.removedImageAssetIds
      ok(res, { article: content.articles.find((entry) => entry.id === item.id) || item, poolId: content.poolId })
    } catch (error) {
      badRequest(res, error.message || '文章保存失败')
    }
  })
  router.delete('/api/admin/articles/:contentId', async (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const body = {
      miniProgramId: url.searchParams.get('miniProgramId'),
      poolId: url.searchParams.get('poolId'),
    }
    try {
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const deleted = deleteAdminContentItem({ poolId: body.poolId, type: 'articles', itemId: url.params.contentId, miniProgramId })
      await reclaimImageAssets(deleted.removedImageAssetIds || [])
      delete deleted.removedImageAssetIds
      ok(res, deleted)
    } catch (error) {
      badRequest(res, error.message || '文章删除失败')
    }
  })
  router.post('/api/admin/articles/import', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const poolId = String(body.poolId || '').trim()
    if (!getInternalAdminSettings().contentPools.some((item) => item.id === poolId)) {
      badRequest(res, '内容池不存在或不可用')
      return
    }
    try {
      sendJson(res, 202, createArticleImportJob({ poolId, urls: body.urls }, articleImportDependencies))
    } catch (error) {
      badRequest(res, error.message || '公众号文章导入失败')
    }
  })
  router.get('/api/admin/articles/import/:jobId', (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const job = getArticleImportJob(url.params.jobId)
    if (!job) return badRequest(res, '导入任务不存在或已失效')
    ok(res, job)
  })
  router.post('/api/admin/articles/import/:jobId/retry', async (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      sendJson(res, 202, retryArticleImportEntry(url.params.jobId, body.url, articleImportDependencies))
    } catch (error) {
      badRequest(res, error.message || '文章重新抓取失败')
    }
  })
  router.post('/api/admin/articles/import/:jobId/publish', async (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      ok(res, await publishArticleImportJob(
        url.params.jobId,
        body.selectedIds,
        body.restoreTailIds,
        articleImportDependencies,
        body.editedItems,
      ))
    } catch (error) {
      badRequest(res, error.message || '文章发布失败')
    }
  })
  router.post('/api/admin/content/import/preflight', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const type = String(body.type || '').trim()
    const items = Array.isArray(body.items) ? body.items : []
    const images = Array.isArray(body.images) ? body.images : []
    if (!['contentTexts', 'contentAlbums', 'letters', 'articles'].includes(type)) {
      badRequest(res, '内容类型无效')
      return
    }
    if (items.length > adminContentImportBatchLimit) {
      badRequest(res, `单次最多导入 ${adminContentImportBatchLimit} 条内容`)
      return
    }
    if (images.length > adminContentImportBatchLimit * 9) {
      badRequest(res, '待检查图片数量过多')
      return
    }
    try {
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const duplicateItemIndexes = getAdminContentDuplicateIndexes({
        poolId: body.poolId,
        type,
        items,
        miniProgramId,
      })
      const imageClientIds = validateImageBatchClientIds(images, (_image, index) => `preflight-${index + 1}`)
      const imageCandidates = images.map((image, index) => ({
        clientId: imageClientIds[index],
        originalSha256: normalizeOriginalSha256(image?.originalSha256, { required: true }),
      }))
      const reusableAssets = getImagesByOriginalSha256(imageCandidates.map((image) => image.originalSha256))
      const reusableImages = imageCandidates.flatMap((image) => {
        const asset = findReusableImage(reusableAssets.filter((asset) => asset.originalSha256 === image.originalSha256))
        return asset ? [{ assetId: asset.id, clientId: image.clientId }] : []
      })
      ok(res, { duplicateItemIndexes, reusableImages })
    } catch (error) {
      badRequest(res, error.message || '导入预检失败')
    }
  })
  router.post('/api/admin/content/items', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const type = String(body.type || '').trim()
    const items = Array.isArray(body.items) ? body.items : []
    if (!['contentTexts', 'contentAudios', 'contentAlbums', 'letters', 'articles'].includes(type)) {
      badRequest(res, '内容类型无效')
      return
    }
    try {
      validateAppendedContent(type, items)
      const missingImageIds = findMissingContentImageIds({ [type]: items })
      if (missingImageIds.length) {
        badRequest(res, `图片 ID 不存在：${missingImageIds.slice(0, 8).join(', ')}`)
        return
      }
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const content = appendAdminContentItems({
        poolId: body.poolId,
        type,
        items,
        miniProgramId,
      })
      const settings = getInternalAdminSettings()
      const pool = settings.contentPools.find((item) => item.id === content.poolId)
      const names = {
        contentTexts: '私密文案',
        contentAudios: '私密音频',
        contentAlbums: '私密图册组',
        letters: '心笺',
        articles: '文章',
      }
      appendOperationLog({
        type: '内容变更',
        target: pool?.name || '内容池',
        description: content.importedCount ? `已导入 ${content.importedCount} 条${names[type]}` : '重复提交未新增内容',
      })
      ok(res, content)
    } catch (error) {
      badRequest(res, error.message || '内容导入失败')
    }
  })
  router.post('/api/admin/content/page', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      for (const type of ['contentTexts', 'contentAudios', 'contentAlbums', 'letters', 'articles']) {
        if (Array.isArray(body[type])) validateAppendedContent(type, body[type])
      }
      const missingImageIds = findMissingContentImageIds(body)
      if (missingImageIds.length) throw new Error(`图片 ID 不存在：${missingImageIds.slice(0, 8).join(', ')}`)
      if (body.system && !hasValidDailyContentPromptTexts(body.system)) {
        throw new Error('打开前引导文案每行必须包含中文逗号“，”，且逗号前后都要有文字')
      }
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const content = updateAdminContentPage(body, miniProgramId)
      const operationLog = getAdminContentOperationLog(body, miniProgramId)
      if (operationLog) appendOperationLog(operationLog)
      ok(res, content)
    } catch (error) {
      badRequest(res, error.message || '内容保存失败')
    }
  })
  router.post('/api/admin/content/delete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const type = String(body.type || '').trim()
    const itemId = String(body.itemId || '').trim()
    if (!['contentTexts', 'contentAudios', 'contentAlbums', 'letters', 'articles'].includes(type) || !itemId) {
      badRequest(res, '内容类型或内容无效')
      return
    }
    try {
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const deleted = deleteAdminContentItem({ poolId: body.poolId, type, itemId, miniProgramId })
      await reclaimImageAssets(deleted.removedImageAssetIds || [])
      delete deleted.removedImageAssetIds
      ok(res, deleted)
    } catch (error) {
      badRequest(res, error.message || '内容删除失败')
    }
  })
  router.post('/api/admin/content/batch-delete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const type = String(body.type || '').trim()
    const itemIds = [...new Set((Array.isArray(body.itemIds) ? body.itemIds : []).map((itemId) => String(itemId || '').trim()).filter(Boolean))]
    if (!['contentTexts', 'contentAudios', 'contentAlbums', 'letters', 'articles'].includes(type) || !itemIds.length) {
      badRequest(res, '内容类型或内容无效')
      return
    }
    if (itemIds.length > 100) {
      badRequest(res, '单次最多删除 100 条内容')
      return
    }
    const requestedPoolId = String(body.poolId || '').trim()
    if (requestedPoolId && !getInternalAdminSettings().contentPools.some((item) => item.id === requestedPoolId)) {
      badRequest(res, '内容池不存在或不可用')
      return
    }
    try {
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const deleted = deleteAdminContentItems({ poolId: body.poolId, type, itemIds, miniProgramId })
      const pool = getInternalAdminSettings().contentPools.find((item) => item.id === deleted.poolId)
      const names = { contentTexts: '私密文案', contentAudios: '私密音频', contentAlbums: '私密图册', letters: '心笺', articles: '文章' }
      let cleanupWarning = ''
      try {
        await reclaimImageAssets(deleted.removedImageAssetIds || [])
      } catch (error) {
        cleanupWarning = error.message || '图片素材清理失败'
        appendOperationLog({ type: 'COS清理失败', target: pool?.name || '内容池', description: `批量删除内容后的图片素材清理失败：${cleanupWarning}` })
      }
      appendOperationLog({
        type: '内容变更',
        target: pool?.name || '内容池',
        description: `已批量删除 ${deleted.ids.length} 条${names[type]}`,
      })
      delete deleted.removedImageAssetIds
      if (cleanupWarning) deleted.cleanupWarning = cleanupWarning
      ok(res, deleted)
    } catch (error) {
      badRequest(res, error.message || '内容删除失败')
    }
  })
  router.post('/api/admin/content/item', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const type = String(body.type || '').trim()
    const item = body.item && typeof body.item === 'object' ? body.item : null
    if (!['contentTexts', 'contentAudios', 'contentAlbums', 'letters', 'articles'].includes(type) || !item) {
      badRequest(res, '内容类型或内容无效')
      return
    }
    try {
      const missingImageIds = findMissingContentImageIds({ [type]: [item] })
      if (missingImageIds.length) {
        badRequest(res, `图片 ID 不存在：${missingImageIds.slice(0, 8).join(', ')}`)
        return
      }
      if (type === 'contentTexts' && !String(item.text || '').trim()) throw new Error('私密文案不能为空')
      if (type === 'contentAudios' && !isValidAudioContentItem(item)) throw new Error('音频文件信息无效，请重新上传')
      if (type === 'contentAlbums' && (!Array.isArray(item.images) || !item.images.length)) throw new Error('每个私密图册组至少需要一张图片')
      if (type === 'letters' && !String(item.content || '').trim()) throw new Error('心笺内容不能为空')
      if (type === 'articles') {
        if (!String(item.title || '').trim() || !String(item.bodyMarkdown || '').trim()) throw new Error('文章标题和正文不能为空')
        item.author = String(item.author || '').trim() || '轻读手记'
      }
      const miniProgramId = requireAdminContentMiniProgramId(res, body)
      if (!miniProgramId) return
      const content = updateAdminContentItem({ poolId: body.poolId, type, item, miniProgramId })
      await reclaimImageAssets(content.removedImageAssetIds || [])
      delete content.removedImageAssetIds
      const operationLog = getAdminContentOperationLog(body, miniProgramId)
      if (operationLog) appendOperationLog(operationLog)
      ok(res, content)
    } catch (error) {
      badRequest(res, error.message || '内容保存失败')
    }
  })
  router.post('/api/admin/images/upload/prepare', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      ok(res, prepareImageUpload(body))
    } catch (error) {
      badRequest(res, error.message || '创建上传任务失败')
    }
  })
  router.post('/api/admin/images/upload/prepare-batch', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) {
      badRequest(res, '请选择图片文件')
      return
    }
    if (items.length > adminImageUploadBatchLimit) {
      badRequest(res, `单次最多上传 ${adminImageUploadBatchLimit} 张图片`)
      return
    }
    try {
      const clientIds = validateImageBatchClientIds(items, (_item, index) => `upload-${index + 1}`)
      const hashes = items.map((item) => normalizeOriginalSha256(item?.originalSha256))
      const reusableAssets = getImagesByOriginalSha256(hashes)
      const firstClientIdByHash = new Map()
      ok(res, {
        items: items.map((item, index) => {
          const clientId = clientIds[index]
          const hash = hashes[index]
          const profile = getImageProcessingProfile(String(item.usage || 'daily_content,article').trim())
          const reusedAsset = hash ? findReusableImage(reusableAssets.filter((asset) => asset.originalSha256 === hash), profile) : null
          if (reusedAsset) return { clientId, reusedAssetId: reusedAsset.id }
          const reuseKey = `${hash}:${profile}`
          const duplicateOfClientId = hash ? firstClientIdByHash.get(reuseKey) : ''
          if (duplicateOfClientId) return { clientId, duplicateOfClientId }
          if (hash) firstClientIdByHash.set(reuseKey, clientId)
          return { clientId, ...prepareImageUpload(item) }
        }),
      })
    } catch (error) {
      badRequest(res, error.message || '创建上传任务失败')
    }
  })
  router.post('/api/admin/images/upload/complete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    try {
      const [completed] = await registerCompletedImageUploads([body], imageReadinessOptions)
      appendOperationLog({
        type: '内容变更',
        target: '图片素材',
        description: `已上传图片「${completed.item.label || completed.item.id}」`,
      })
      ok(res, {
        item: completed.item,
        policy: imagePolicy,
        message: '图片已直传 COS，数据万象将生成 thumb/medium。',
      })
    } catch (error) {
      badRequest(res, error.message || '图片登记失败')
    }
  })
  router.post('/api/admin/images/upload/complete-batch', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) {
      badRequest(res, '没有待登记的图片')
      return
    }
    if (items.length > adminImageUploadBatchLimit) {
      badRequest(res, `单次最多登记 ${adminImageUploadBatchLimit} 张图片`)
      return
    }
    try {
      validateImageBatchClientIds(items, (item, index) => item?.taskId || `upload-${index + 1}`)
      const completed = await registerCompletedImageUploads(items, imageReadinessOptions)
      appendOperationLog({
        type: '内容变更',
        target: '图片素材',
        description: `已批量上传 ${completed.length} 张图片`,
      })
      ok(res, { items: completed, policy: imagePolicy })
    } catch (error) {
      if (Array.isArray(error.pendingClientIds) && error.pendingClientIds.length) {
        sendJson(res, 409, {
          message: error.message || '图片尚未处理完成，请稍后重试',
          pendingClientIds: [...new Set(error.pendingClientIds)],
        })
        return
      }
      badRequest(res, error.message || '图片登记失败')
    }
  })
  router.post('/api/admin/audios/upload', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    try {
      const { fields, item } = await runSingleAudioUpload(async () => {
        const { fields, file } = await readMultipartFile(req, {
          fieldName: 'audio',
          maxBytes: 52 * 1024 * 1024,
          tooLargeMessage: '单个音频不能超过 50MB',
          multipleFileMessage: '一次只能上传一个音频',
          missingFileMessage: '请选择音频文件',
        })
        return { fields, item: await processAudioUpload(file, fields) }
      })
      appendOperationLog({
        type: '内容变更',
        target: '私密音频',
        description: `已上传音频「${item.originalFilename}」`,
      })
      ok(res, {
        clientId: String(fields.clientId || '').trim(),
        item,
      })
    } catch (error) {
      if (error instanceof TaskBusyError) {
        req.resume()
        tooManyRequests(res, '音频正在处理中，请稍后再试')
        return
      }
      badRequest(res, error.message || '音频处理失败')
    }
  })
  router.post('/api/admin/images', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const items = Array.isArray(body.items) ? body.items : []

    if (!items.some((item) => String(item.id || '').trim() && (String(item.mediumUrl || '').trim() || String(item.thumbUrl || '').trim()))) {
      badRequest(res, '至少保留一张可用图片素材')
      return
    }

    const updated = updateImages(items)
    appendOperationLog({
      type: '内容变更',
      target: '图片素材',
      description: '图片素材已保存',
    })
    ok(res, { items: updated, policy: imagePolicy })
  })
  router.post('/api/admin/images/delete', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const imageId = String(body.id || '').trim()
    const backgrounds = getInternalAdminSettings().shareSettings?.private?.backgrounds || []
    if (backgrounds.some((item) => item.imageId === imageId)) {
      badRequest(res, '图片仍被全局分享模板引用，请先解除引用')
      return
    }
    try {
      const item = deleteImageAsset(imageId)
      if (!item) {
        badRequest(res, '图片素材不存在')
        return
      }
      appendOperationLog({ type: '内容变更', target: '图片素材', description: `已删除图片「${item.label || item.id}」` })
      ok(res, { item })
    } catch (error) {
      badRequest(res, error.message || '图片删除失败')
    }
  })
  router.post('/api/admin/images/reclaim', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [])
      .map((id) => String(id || '').trim()).filter(Boolean))]
    if (!ids.length || ids.length > 20) {
      badRequest(res, '待清理的临时图片数量无效')
      return
    }
    try {
      const result = await reclaimImageAssets(ids)
      if (result.reclaimed.length) {
        appendOperationLog({ type: '内容变更', target: '临时图片', description: `已清理 ${result.reclaimed.length} 张未引用图片` })
      }
      ok(res, result)
    } catch (error) {
      badRequest(res, error.message || '临时图片清理失败')
    }
  })
  router.post('/api/admin/auth', async (req, res) => {
    if (!requireAdminSession(req, res)) return
    const body = await readJsonBody(req)
    const result = updateAdminCredentials({
      currentPassword: body.currentPassword,
      account: body.account,
      password: body.password,
      confirmPassword: body.confirmPassword,
    })
    if (result?.error) {
      badRequest(res, result.error)
      return
    }
    if (!result) {
      badRequest(res, '当前密码错误')
      return
    }
    if (!result.changed) {
      ok(res, { changed: false, admin: result.profile })
      return
    }
    appendOperationLog({
      type: '安全与存储',
      target: '管理员账号',
      description: '管理员账号或密码已更新',
    })
    ok(res, { changed: true, admin: result.profile }, {
      'set-cookie': clearAdminSessionCookie(),
    })
  })
  return router
}

module.exports = {
  createAppRouter,
  getClientIp,
  isMessageCreationEnabled,
  makePicOperations,
  processAudioUpload,
  validateAppendedContent,
  validateImageBatchClientIds,
  waitForCosObjectsReady,
}
