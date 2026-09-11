const path = require('path')
const { env } = require('../../config/env')
const { toBusinessDateKey } = require('../../lib/business-date')
const { buildAnalyticsMetrics, buildDailyVisitTrend } = require('../analytics/analytics.store')
const { countAccounts, countSyncedAccounts } = require('../auth/account.store')
const { getContentPoolSummaries, getContentPreflightData } = require('../content/content.store')
const { countMessages, countMessagesByStatus } = require('../messages/message.store')
const { getMiniProgramUploadReadiness } = require('../release/miniapp-upload.service')
const { doesCosObjectExist, getCosObjectKeyFromPublicUrl, testCosConnection } = require('../storage/cos.service')
const { getInternalAdminSettings, getMiniProgramRuntimeConfig } = require('./admin-settings.store')
const { getStableAccessToken, hasWechatCredentials } = require('../auth/wechat-auth.service')

function makeMetric(label, value, hint = '') {
  return { label, value, hint }
}

function requireCurrentMiniProgram(settings) {
  const currentMiniProgramId = String(settings.currentMiniProgramId || '').trim()
  const currentMiniProgram = settings.miniPrograms.find((item) => (
    item.id === currentMiniProgramId && item.status !== 'archived'
  ))
  if (!currentMiniProgram) throw new Error('当前小程序已停用或不存在')
  return currentMiniProgram
}

function makeActivityMetrics(metrics) {
  return [
    makeMetric('总用户数', String(metrics.totalUsers), '所选小程序的账号总数，跨小程序已关联的同一账号只计一次'),
    makeMetric('周活用户', String(metrics.weeklyActiveUsers), '今日及前 6 天有登录复核或已登录首页访问的去重用户，按北京时间统计'),
    makeMetric('今日访问人数', String(metrics.todayVisitors), '今日有登录复核或已登录首页访问的去重用户'),
    makeMetric('今日访问人次', String(metrics.todayVisits), '按登录复核和已登录首页访问记录；每个小程序内同一用户 60 秒内多个请求合并一次'),
    makeMetric('成功打卡', String(metrics.todayCheckins), '今日成功打卡次数'),
    makeMetric('打开手记', String(metrics.todayDailyContentOpens), '今日成功打开手记次数，同一请求重试不重复计数'),
    makeMetric('打开文章', String(metrics.todayArticleOpens), '今日成功提供全文次数，每个小程序内同一用户同一文章每天只计一次'),
    makeMetric('新增留言', String(metrics.todayMessages), '今日成功提交留言数，不含审核拦截和失败请求'),
  ]
}

function getAdminBootstrap({ groupId = '' } = {}) {
  const now = new Date()
  const today = toBusinessDateKey(now)
  const settings = getInternalAdminSettings()
  const currentMiniProgram = requireCurrentMiniProgram(settings)
  const currentMiniProgramId = currentMiniProgram.id
  const runtimeConfig = getMiniProgramRuntimeConfig({ miniProgramId: currentMiniProgramId })
  const summary = getContentPoolSummaries([runtimeConfig.contentPoolId])[0]
  const currentAccountCount = countAccounts(currentMiniProgramId)
  const requestedGroup = String(groupId || '').trim()
  const group = settings.groups.includes(requestedGroup) ? requestedGroup : ''
  const groupedIds = settings.miniPrograms
    .filter((item) => item.status !== 'archived' && (!group || item.group === group))
    .map((item) => item.id)
  const selectedScope = { miniProgramIds: groupedIds, filterMiniProgramIds: true }
  const allMetrics = buildAnalyticsMetrics({ ...selectedScope, today })
  const currentMetrics = groupedIds.length === 1 && groupedIds[0] === currentMiniProgramId
    ? allMetrics
    : buildAnalyticsMetrics({ miniProgramId: currentMiniProgramId, today })
  const currentVisitTrend = buildDailyVisitTrend({ ...selectedScope, days: 15, baseDate: now })
  const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || '').trim()
  const adminRoot = String(process.env.ADMIN_ROOT || path.resolve(__dirname, '../../..')).trim()
  const syncedAccounts = countSyncedAccounts(currentMiniProgramId)
  const currentContentMedia = getContentPreflightData(runtimeConfig.contentPoolId)
  const messageCount = countMessages()
  const blockedMessages = countMessagesByStatus('blocked')

  return {
    service: {
      name: 'secretbox-server',
      baseUrl: baseUrl || '未配置',
      adminRoot,
    },
    modules: [
      '小程序管理',
      '内容池',
      '分享设置',
      '广告设置',
      '图片素材',
      '文案设置',
      '留言管理',
    ],
    guardrails: [
      '广告位按页面和场景独立配置',
      '图片列表默认展示 thumb，点击打开 medium',
      '私密留言保存前必须完成服务端 msgSecCheck',
    ],
    dashboardCards: makeActivityMetrics(allMetrics),
    editableSections: makeActivityMetrics(currentMetrics),
    contentStats: [
      makeMetric('私密文案', String(summary.contentTexts), '来自内容池'),
      makeMetric('私密音频', String(summary.contentAudios), '来自内容池'),
      makeMetric('私密图册', String(summary.contentAlbums), '来自内容池'),
      makeMetric('心笺文案', String(summary.letters), '来自内容池'),
      makeMetric('文章内容', String(summary.articles), '来自内容池'),
    ],
    currentVisitTrend,
    configStats: [
      makeMetric('图片素材', `${currentContentMedia.imageRefs.total} 张`, '当前内容池实际引用'),
      makeMetric('留言状态', `${messageCount} 条`, `已拦截 ${blockedMessages}`),
      makeMetric('账号同步', `${syncedAccounts}/${currentAccountCount}`, 'UnionID 优先，微信验证手机号兜底'),
      makeMetric('启用广告位', `${Object.values(runtimeConfig.ads).filter((item) => item.enabled).length} 个`, '来自当前小程序广告设置'),
      makeMetric('接入小程序', `${settings.miniPrograms.filter((item) => item.status !== 'archived').length} 个`, '来自小程序管理'),
    ],
    recentOperationLogs: settings.operationLogs || [],
    selectedGroup: group,
    groups: settings.groups || [],
  }
}

function makeCheck(label, status, message) {
  return { label, status, message }
}

function isBundledImageUrl(value) {
  return /^\/assets\/images\/[a-zA-Z0-9._/-]+$/.test(String(value || '').trim())
}

function isSupportedMediaUrl(storage, value, type) {
  if (type === 'image' && isBundledImageUrl(value)) return true
  return Boolean(getCosObjectKeyFromPublicUrl(storage, value))
}

function getSupportedMediaPrefixes(storage, type) {
  const prefixes = [
    String(storage?.url || '').trim().replace(/\/+$/, ''),
    storage?.bucket && storage?.region
      ? `https://${storage.bucket}.cos.${storage.region}.myqcloud.com`
      : '',
  ].filter(Boolean).map((value) => `${value}/`)
  if (type === 'image') prefixes.push('/assets/images/')
  return [...new Set(prefixes)]
}

function hasUsableImageUrl(image, storage) {
  const urls = [image?.thumbUrl, image?.mediumUrl].map((value) => String(value || '').trim())
  return image?.status === 'ready'
    && urls.every((url) => isSupportedMediaUrl(storage, url, 'image'))
}

async function areSampleMediaObjectsReachable(storage, urls, cosReady) {
  const keys = [...new Set(urls
    .map((url) => getCosObjectKeyFromPublicUrl(storage, url))
    .filter(Boolean))]
  if (!keys.length) return true
  if (!cosReady) return false
  try {
    return (await Promise.all(keys.map((key) => doesCosObjectExist(key)))).every(Boolean)
  } catch (error) {
    return false
  }
}

function isValidAdUnitId(value) {
  return /^adunit-[a-zA-Z0-9_-]+$/.test(String(value || '').trim())
}

async function getWechatConnection(miniProgramId) {
  if (!hasWechatCredentials({ miniProgramId })) {
    return { ok: false, message: '当前小程序缺少 AppID 或 AppSecret' }
  }
  if (!env.productionLike) {
    return { ok: true, message: '当前小程序微信凭据已配置' }
  }
  try {
    await getStableAccessToken({ miniProgramId })
    return { ok: true, message: '微信服务凭据已通过接口验证' }
  } catch (error) {
    return { ok: false, message: `微信服务凭据验证失败：${error.message || '无法获取 access token'}` }
  }
}

async function getCosConnection(storage) {
  const required = ['secretId', 'secretKey', 'bucket', 'region']
  const missing = required.filter((key) => !String(storage?.[key] || '').trim())
  if (missing.length) return { ok: false, message: `COS 配置缺少：${missing.join(', ')}` }
  try {
    return await testCosConnection()
  } catch (error) {
    return { ok: false, message: `COS 连接测试失败：${error.message || '网络异常'}` }
  }
}

async function getAdminPreflight() {
  const messageCount = countMessages()
  const settings = getInternalAdminSettings()
  const currentMiniProgram = requireCurrentMiniProgram(settings)
  const currentMiniProgramId = currentMiniProgram.id
  const runtimeConfig = getMiniProgramRuntimeConfig({ miniProgramId: currentMiniProgramId })
  const storage = settings.storage || {}
  const imageUrlPrefixes = getSupportedMediaPrefixes(storage, 'image')
  const audioUrlPrefixes = getSupportedMediaPrefixes(storage, 'audio')
  const contentData = getContentPreflightData(runtimeConfig.contentPoolId, {
    audioUrlPrefixes,
    imageUrlPrefixes,
  })
  const contentSummary = contentData.summary
  const [cosConnection, wechatConnection] = await Promise.all([
    getCosConnection(storage),
    getWechatConnection(currentMiniProgram?.id),
  ])
  const contentImageSampleReady = contentData.imageRefs.sample
    .every((item) => hasUsableImageUrl(item, storage))
  const contentImageObjectsReachable = await areSampleMediaObjectsReachable(
    storage,
    contentData.imageRefs.sample.flatMap((item) => [item.thumbUrl, item.mediumUrl]),
    cosConnection.objectAccessOk,
  )
  const contentAudioSampleReady = contentData.audios.sample
    .every((item) => isSupportedMediaUrl(storage, item.audioUrl, 'audio'))
  const contentMediaReady = contentData.imageRefs.structurallyUsable === contentData.imageRefs.total
    && contentData.audios.structurallyUsable === contentData.audios.total
    && contentImageSampleReady
    && contentImageObjectsReachable
    && contentAudioSampleReady
  const enabledAds = Object.values(runtimeConfig.ads || {}).filter((item) => item.enabled)
  const invalidAds = enabledAds.filter((item) => !isValidAdUnitId(item.adUnitId))
  const dailyContentTypes = runtimeConfig.dailyContentTypes || {}
  const missingDailyContentTypes = [
    dailyContentTypes.imageEnabled && !contentSummary.contentAlbums ? '图片' : '',
    dailyContentTypes.audioEnabled && !contentSummary.contentAudios ? '音频' : '',
  ].filter(Boolean)
  const uploadReadiness = getMiniProgramUploadReadiness(currentMiniProgram?.appId)
  const privateShareSettings = runtimeConfig.shareSettings?.private || {}
  const privateSharePools = privateShareSettings.pools || {}
  const coverCopyEnabled = privateShareSettings.coverCopyEnabled !== false
  const hasPrivateShareCards = ['text', 'image'].every((type) => {
    const pool = privateSharePools[type] || {}
    return Array.isArray(pool.titles) && pool.titles.some((item) => item.enabled !== false && String(item.title || '').trim())
      && (!coverCopyEnabled || (Array.isArray(pool.coverCopies) && pool.coverCopies.some((item) => item.enabled !== false && String(item.text || '').trim())))
  })
  const checks = [
    makeCheck('微信凭据', wechatConnection.ok ? 'pass' : 'fail', wechatConnection.message),
    makeCheck('开发者邮箱', currentMiniProgram?.developerEmail ? 'pass' : 'fail', currentMiniProgram?.developerEmail ? currentMiniProgram.developerEmail : '请在小程序设置中填写开发者联系邮箱'),
    makeCheck('内容池绑定', runtimeConfig.contentPoolId ? 'pass' : 'fail', runtimeConfig.contentPoolId ? `当前绑定 ${runtimeConfig.contentPoolId}` : '当前小程序未绑定内容池'),
    makeCheck('发布通道', uploadReadiness.ok ? 'pass' : 'fail', uploadReadiness.message),
    makeCheck('COS配置', cosConnection.ok ? 'pass' : 'fail', cosConnection.ok ? `${settings.storage.bucket} · ${settings.storage.region}，连接与 CORS 正常` : cosConnection.message),
    makeCheck('手记内容', contentSummary.contentTexts + contentSummary.contentAlbums + contentSummary.contentAudios ? 'pass' : 'fail', contentSummary.contentTexts + contentSummary.contentAlbums + contentSummary.contentAudios ? `已有 ${contentSummary.contentTexts + contentSummary.contentAlbums + contentSummary.contentAudios} 条手记内容` : '当前内容池没有手记内容'),
    makeCheck('心笺内容', contentSummary.letters ? 'pass' : 'fail', contentSummary.letters ? `已有 ${contentSummary.letters} 条心笺` : '当前内容池没有心笺内容'),
    makeCheck('文章内容', contentSummary.articles ? 'pass' : 'fail', contentSummary.articles ? `已有 ${contentSummary.articles} 篇文章` : '当前内容池没有文章内容'),
    makeCheck('手记投放', missingDailyContentTypes.length ? 'fail' : 'pass', missingDailyContentTypes.length ? `已启用但缺少对应内容：${missingDailyContentTypes.join('、')}` : '已启用的内容类型均有对应内容'),
    makeCheck('图片素材', contentData.imageRefs.structurallyUsable === contentData.imageRefs.total ? 'pass' : 'fail', contentData.imageRefs.total ? `当前内容池引用图片 ${contentData.imageRefs.total} 张，${contentData.imageRefs.structurallyUsable} 张通过地址检查` : '当前内容池未引用图片素材'),
    makeCheck('媒体访问', contentMediaReady ? 'pass' : 'fail', `结构可用图片 ${contentData.imageRefs.structurallyUsable}/${contentData.imageRefs.total}、音频 ${contentData.audios.structurallyUsable}/${contentData.audios.total}`),
    makeCheck('留言管理', messageCount ? 'pass' : 'warn', messageCount ? `已有 ${messageCount} 条留言记录` : '暂无留言记录，需真机提交后验证'),
    makeCheck('分享卡片', hasPrivateShareCards ? 'pass' : 'fail', hasPrivateShareCards ? '小程序本地合成规则已配置' : `请为文案和私密图册补充标题${coverCopyEnabled ? '、封面文案' : ''}和通用底图`),
    makeCheck('广告配置', invalidAds.length ? 'fail' : 'pass', invalidAds.length ? `${invalidAds.length} 个已开启广告位缺少或使用了无效 adUnitId` : '已开启广告位均使用有效格式的 adUnitId'),
    makeCheck('内容安全', settings.security?.textCheck ? 'pass' : 'warn', settings.security?.textCheck ? '文本安全检测已开启' : '文本安全检测已关闭'),
  ]
  const failed = checks.filter((item) => item.status === 'fail').length
  const warnings = checks.filter((item) => item.status === 'warn').length
  return {
    scope: '仅检查 Admin 与服务端配置；不代表微信审核、发布、隐私保护指引或合法域名状态。',
    summary: {
      failed,
      passed: checks.filter((item) => item.status === 'pass').length,
      ready: failed === 0,
      warnings,
    },
    checks,
  }
}

module.exports = {
  getAdminBootstrap,
  getAdminPreflight,
  isValidAdUnitId,
  isSupportedMediaUrl,
}
