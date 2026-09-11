const {
  appendContentItems,
  appendDeduplicatedContentItems,
  deleteContentItem,
  getContentItem,
  getContentImageAssetIds,
  deleteContentItems,
  getContentItemsByIds,
  getDuplicateContentItemIndexes,
  getContentPoolSummaries,
  getContentTypePage,
  getRandomDailyContent,
  getRandomArticlePage,
  updateContentItem,
  upsertContentItems,
  updateContentAlbums,
  updateContentAudios,
  updateContentTexts,
  updateArticles,
  updateLetters,
} = require('./content.store')
const { getUnlockedArticleIds, isArticleUnlocked, unlockArticle: saveArticleUnlock } = require('./article-unlock.store')
const { makeArticlePreviewHtml, renderArticleMarkdown, splitArticleHtmlForMiddleAd } = require('./article-markdown')
const { getAccountSummary } = require('../auth/account.store')
const { getDatabase } = require('../../lib/state-database')
const { recordArticleFullOpen } = require('../analytics/analytics.store')
const { normalizeDataContext } = require('../data-scope/data-scope')
const { checkInToday, getCheckinState } = require('../checkin/checkin.store')
const { getImagesByIds } = require('../images/image.store')
const { getImageDisplayUrls } = require('../images/image-policy')
const { countVisibleMessages, getCurrentMessages, getVisibleMessages } = require('../messages/message.store')
const {
  countContentActivity,
  getContentActivity,
  getFavorites,
  getInteractionSummary,
  getOpened,
  getPublicFavoriteCount,
  getPublicLikeCount,
  getReactionMetrics,
  getReactionState,
} = require('../interactions/interaction.store')
const {
  getInternalAdminSettings,
  getMiniProgramRuntimeConfig,
  stripPublicCopyLists,
  updateCurrentMiniProgramConfig,
} = require('../admin/admin-settings.store')

const defaultHomeStats = [
  { key: 'rankToday', label: '今天第几位', value: '1位' },
  { key: 'checkInDays', label: '已连续打卡', value: '0天' },
  { key: 'companionValue', label: '累计阅读值', value: '1.2k' },
]

const companionValueRewards = Object.freeze({
  checkin: 5,
  dailyContentOpen: 3,
  like: 1,
  favorite: 1,
  message: 1,
})

const recentDailyContentExclusionMs = 30 * 24 * 60 * 60 * 1000

function getActivityContentType(source, content = {}) {
  if (source === 'letters') return 'letter'
  if (source === 'article') return 'article'
  if (source === 'daily_content' && ['text', 'audio', 'album'].includes(content.type)) return content.type
  return 'text'
}

function formatMessageAudioDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`
}

function getMessageTargetPreview(source, content = {}) {
  const type = getActivityContentType(source, content)
  if (type === 'audio') {
    const title = String(content.title || content.originalFilename || '').replace(/\.[^.]+$/, '').trim()
    return `${formatMessageAudioDuration(content.durationSeconds)}：${title || '轻读音频'}`
  }
  if (type === 'album') return `共 ${Array.isArray(content.images) ? content.images.length : 0} 张图片`
  if (type === 'article') {
    const author = String(content.author || '').trim()
    const title = String(content.title || '').trim()
    return author && title ? `${author}：${title}` : title || author
  }
  return String(content.text || content.content || '').trim()
}

function enrichContentItem(item = {}, context = {}, source = '') {
  const reaction = getReactionState(context, source, item.id)
  return {
    ...item,
    ...reaction,
    favoriteCount: Number(item.favoriteCount || 0) + getPublicFavoriteCount(context, source, item.id),
    likeCount: Number(item.likeCount || 0) + getPublicLikeCount(context, source, item.id),
  }
}

function toMiniProgramImage(image = {}) {
  const display = getImageDisplayUrls(image)
  const mediaBaseUrl = String(process.env.PUBLIC_MINIAPP_API_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '')
  const resolveMediaUrl = (value, variant) => {
    const url = String(value || '').trim()
    if (!url.startsWith('data:')) return url
    return `${mediaBaseUrl}/media/image?id=${encodeURIComponent(image.id || '')}&variant=${variant}`
  }
  return {
    id: image.id,
    mediumUrl: resolveMediaUrl(display.mediumUrl, 'medium'),
    originalUrl: resolveMediaUrl(image.originalUrl, 'original'),
    status: image.status,
    thumbUrl: resolveMediaUrl(display.thumbUrl, 'thumb'),
  }
}

function toMiniProgramContentItem(item = {}) {
  const { label, myMessage, ...publicItem } = item
  if (!Array.isArray(publicItem.images)) return publicItem
  return {
    ...publicItem,
    images: publicItem.images.map(toMiniProgramImage),
  }
}

function enrichMiniProgramContentItems(items = [], context = {}, source = '') {
  const messages = getCurrentMessages(context, source, items.map((item) => item.id))
  return items.map((item) => ({
    ...toMiniProgramContentItem(enrichContentItem(item, context, source)),
    myMessage: messages.get(item.id)?.content || '',
  }))
}

function toMiniProgramShareSettings(settings = {}) {
  const backgrounds = Array.isArray(settings.private?.backgrounds) ? settings.private.backgrounds : []
  const assets = new Map(getImagesByIds(backgrounds.map((item) => item.imageId))
    .map((item) => [item.id, { raw: item, mini: toMiniProgramImage(item) }]))
  return {
    ...settings,
    private: {
      ...(settings.private || {}),
      backgrounds: backgrounds.map((background) => {
        const asset = assets.get(background.imageId)
        const image = asset?.mini
        const rawImage = asset?.raw
        return {
          ...background,
          // Legacy share backgrounds were generated as 125x125. Until they are
          // re-uploaded with share-background-v2, use the original asset to avoid
          // silently shipping a low-resolution square as the public cover.
          imageUrl: rawImage?.processingProfile === 'share-background-v2'
            ? image.mediumUrl
            : rawImage?.originalUrl || background.originalUrl || image?.mediumUrl || image?.thumbUrl || background.imageUrl || '',
        }
      }),
    },
  }
}

// 独立文案包（L3）：会增长的列表型文案唯一下发通道。
// - 客户端携带已缓存的 version：相等则只回 changed:false（省流量），不等才回全量包；
// - 版本号 = `${copyVersion}.${shareSettings.version}`，文案列表或分享设置任一变更都会递增；
// - 该接口永不参与启动门，加载失败由客户端默认文案包兜底。
function getPublicCopyPack(context = {}, clientVersion = '') {
  const runtimeConfig = getMiniProgramRuntimeConfig(context)
  const shareSettings = toMiniProgramShareSettings(runtimeConfig.shareSettings)
  const system = runtimeConfig.system || {}
  const version = `${Number(runtimeConfig.copyVersion) || 1}.${Number(shareSettings.version) || 1}`
  if (String(clientVersion || '').trim() === version) {
    return { version, changed: false }
  }
  return {
    version,
    changed: true,
    copyPack: {
      checkinBeforeTexts: Array.isArray(system.checkinBeforeTexts) ? system.checkinBeforeTexts : [],
      checkinAfterTexts: Array.isArray(system.checkinAfterTexts) ? system.checkinAfterTexts : [],
      dailyContentPromptTexts: Array.isArray(system.dailyContentPromptTexts) ? system.dailyContentPromptTexts : [],
      share: {
        version: Number(shareSettings.version) || 1,
        private: shareSettings.private,
      },
    },
  }
}

function getCompanionValue(context = {}, checkin = getCheckinState(context)) {
  const reactions = getReactionMetrics(context)
  const opened = getInteractionSummary(context).totalOpened
  const messages = countVisibleMessages(context)
  return Math.min(100000, Math.max(0, (
    Number(checkin.checkIn.totalDays || 0) * companionValueRewards.checkin
    + opened * companionValueRewards.dailyContentOpen
    + reactions.likes * companionValueRewards.like
    + reactions.favorites * companionValueRewards.favorite
    + messages * companionValueRewards.message
  )))
}

function getMiniProgramForContext(context = {}) {
  const settings = getInternalAdminSettings()
  const miniProgramId = String(context.miniProgramId || '').trim()
  if (!miniProgramId) throw new Error('小程序 ID 不能为空')
  return settings.miniPrograms.find((item) => item.id === miniProgramId && item.status !== 'archived') || null
}

function getContentPoolIdForContext(context = {}) {
  const miniProgram = getMiniProgramForContext(context)
  const contentPoolId = String(miniProgram?.config?.contentPoolId || '').trim()
  if (!contentPoolId) throw new Error('当前小程序已停用、不存在或未配置内容池')
  return contentPoolId
}

function getSystemSettings() {
  return getMiniProgramRuntimeConfig({ miniProgramId: getInternalAdminSettings().currentMiniProgramId }).system || {}
}

function shuffleItems(items = []) {
  return [...items]
    .map((item) => ({ item, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ item }) => item)
}

function getCurrentAdminContentPoolId() {
  return getContentPoolIdForContext({ miniProgramId: getInternalAdminSettings().currentMiniProgramId })
}

function getAdminContentPoolId(requestedPoolId = '', miniProgramId = '') {
  const id = String(requestedPoolId || '').trim()
  const settings = getInternalAdminSettings()
  if (id && settings.contentPools.some((item) => item.id === id)) return id
  return miniProgramId ? getContentPoolIdForContext({ miniProgramId }) : getCurrentAdminContentPoolId()
}

function getHomeData(context = {}) {
  const config = getMiniProgramRuntimeConfig(context)
  const checkin = getCheckinState(context, new Date(), { create: Boolean(context.authenticated) })
  const homeStats = config.system?.homeStats || {}
  const companionValue = getCompanionValue(context, checkin)
  return {
    stats: defaultHomeStats
      .filter((item) => homeStats[item.key]?.visible !== false)
      .map((item) => {
        const configured = homeStats[item.key] || {}
        const stat = { ...item, label: String(configured.label || '').trim() || item.label }
        return (
        item.key === 'rankToday'
          ? { ...stat, value: `${checkin.checkIn.rankToday}位` }
          : item.key === 'checkInDays'
          ? { ...stat, value: `${checkin.checkIn.streakDays}天` }
          : item.key === 'companionValue'
            ? { ...stat, value: `${companionValue}点` }
          : stat
        )
      }),
    checkIn: checkin.checkIn,
    calendarDays: checkin.calendarDays,
    companionValueRewards: {
      checkin: companionValueRewards.checkin,
    },
    ads: config.ads,
    articleDisplay: config.articleDisplay,
    dailyContentTypes: config.dailyContentTypes,
    messagesEnabled: config.messagesEnabled !== false,
    limits: config.limits,
    system: stripPublicCopyLists(config.system),
  }
}

function getDailyContentTypeMap(context = {}) {
  const dailyContentTypes = getMiniProgramRuntimeConfig(context).dailyContentTypes || {}
  return {
    text: { contentType: 'contentTexts', itemType: 'text', enabled: true },
    album: { contentType: 'contentAlbums', itemType: 'album', enabled: dailyContentTypes.imageEnabled !== false },
    audio: { contentType: 'contentAudios', itemType: 'audio', enabled: dailyContentTypes.audioEnabled === true },
  }
}

function getEnabledDailyContentContentTypes(typeMap = {}) {
  return Object.values(typeMap)
    .filter((type, index, types) => type.enabled && types.findIndex((item) => item.contentType === type.contentType) === index)
    .map((type) => type.contentType)
}

function getRecentDailyContentCutoff() {
  return new Date(Date.now() - recentDailyContentExclusionMs).toISOString()
}

function getRandomAvailableDailyContent(poolId, contentTypes, context, excludeId = '', openedAfter = getRecentDailyContentCutoff()) {
  return getRandomDailyContent(poolId, contentTypes, excludeId, {
    openedAfter,
    openedContext: context,
  })
}

function getDailyContentAvailability(requestedType = 'random', context = {}, contentId = '', excludeId = '') {
  const typeMap = getDailyContentTypeMap(context)
  const normalizedType = String(requestedType || 'random').trim() || 'random'
  const requested = typeMap[normalizedType]
  const poolId = getContentPoolIdForContext(context)
  const requestedContentId = String(contentId || '').trim()
  const requestedExcludeId = String(excludeId || '').trim()
  const openedAfter = getRecentDailyContentCutoff()
  const fallbackAvailable = Boolean(getRandomAvailableDailyContent(poolId, getEnabledDailyContentContentTypes(typeMap), context, requestedExcludeId, openedAfter))

  if (normalizedType !== 'random' && !requested) {
    return { available: false, fallbackAvailable, message: '手记类型无效' }
  }
  if (requestedContentId) {
    const item = requested && requested.enabled
      ? getContentItem(poolId, requested.contentType, requestedContentId)
      : null
    return {
      available: Boolean(item && item.type === requested.itemType),
      fallbackAvailable,
    }
  }
  if (requested) {
    return {
      available: Boolean(requested.enabled && getRandomAvailableDailyContent(poolId, [requested.contentType], context, requestedExcludeId, openedAfter)),
      fallbackAvailable,
    }
  }
  return { available: fallbackAvailable, fallbackAvailable }
}

function openDailyContent(requestedType = 'random', context = {}, excludeId = '', contentId = '') {
  const typeMap = getDailyContentTypeMap(context)
  const normalizedType = String(requestedType || 'random').trim() || 'random'
  const requested = typeMap[normalizedType]
  const poolId = getContentPoolIdForContext(context)
  const requestedContentId = String(contentId || '').trim()

  if (normalizedType !== 'random' && !requested) {
    return { dailyContent: null, message: '手记类型无效' }
  }
  if (requestedContentId) {
    if (!requested || !requested.enabled) {
      return { dailyContent: null, message: '这篇手记暂时无法打开' }
    }
    const item = getContentItem(poolId, requested.contentType, requestedContentId)
    if (!item || item.type !== requested.itemType) {
      return { dailyContent: null, message: '这篇手记已失效，无法打开' }
    }
    return { dailyContent: enrichMiniProgramContentItems([item], context, 'daily_content')[0] }
  }
  if (requested && !requested.enabled) {
    return { dailyContent: null, message: '该类型手记暂不可用' }
  }

  const selectedTypes = requested
    ? [requested.contentType]
    : getEnabledDailyContentContentTypes(typeMap)
  const item = getRandomAvailableDailyContent(poolId, selectedTypes, context, excludeId)
  return item
    ? { dailyContent: enrichMiniProgramContentItems([item], context, 'daily_content')[0] }
    : { dailyContent: null, message: requested ? '该类型手记暂不可用' : '暂无可打开内容' }
}

function checkIn(context = {}) {
  const result = checkInToday(context)
  return {
    ...result,
    companionValueDelta: result.created ? companionValueRewards.checkin : 0,
  }
}

function pageResult(items, total, page, pageSize) {
  return {
    items,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  }
}

function getLetters(context = {}, { page = 1, pageSize = 20, includeId = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safePageSize = Math.max(1, Math.min(Number(pageSize) || 20, 20))
  const system = getMiniProgramRuntimeConfig(context).system || {}
  const orderedByNewest = system.lettersSortMode === 'sequence'
  const { items: letters, total } = getContentTypePage(getContentPoolIdForContext(context), 'letters', {
    limit: safePageSize,
    offset: (safePage - 1) * safePageSize,
    descending: orderedByNewest,
  })
  const included = includeId && !letters.some((item) => item.id === includeId)
    ? getContentItem(getContentPoolIdForContext(context), 'letters', includeId)
    : null
  const items = [
    ...(included ? [included] : []),
    ...(orderedByNewest ? letters : shuffleItems(letters)),
  ]
  return pageResult(
    enrichMiniProgramContentItems(items, context, 'letters'),
    total,
    safePage,
    safePageSize,
  )
}

function toArticleSummary(item, unlockedToday = false) {
  return {
    id: item.id,
    title: item.title,
    author: item.author,
    publishedAt: item.publishedAt,
    coverImage: item.coverImage ? toMiniProgramImage(item.coverImage) : null,
    likeCount: item.likeCount,
    favoriteCount: item.favoriteCount,
    liked: item.liked,
    favorited: item.favorited,
    myMessage: item.myMessage || '',
    unlockedToday,
  }
}

const RANDOM_ARTICLE_PAGE_SIZE = 20

function getArticleRecommendations(context = {}, contentId = '', options = {}) {
  const poolId = getContentPoolIdForContext(context)
  const item = getContentItem(poolId, 'articles', contentId)
  if (!item) return null
  const page = getRandomArticlePage(poolId, item.id, {
    page: options.page,
    pageSize: Math.min(Number(options.pageSize) || RANDOM_ARTICLE_PAGE_SIZE, RANDOM_ARTICLE_PAGE_SIZE),
    seed: options.seed,
  })
  const recommendationItems = enrichMiniProgramContentItems(page.items, context, 'article')
  return {
    recommendations: recommendationItems.map((entry) => toArticleSummary(
      entry,
      isArticleUnlocked(context, entry.id),
    )),
    recommendationPagination: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
      seed: page.seed,
    },
  }
}

function getArticles(context = {}, { page = 1, pageSize = 20, includeId = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safePageSize = Math.max(1, Math.min(Number(pageSize) || 20, 20))
  const system = getMiniProgramRuntimeConfig(context).system || {}
  const orderedByNewest = system.articlesSortMode === 'sequence'
  const { items: articles, total } = getContentTypePage(getContentPoolIdForContext(context), 'articles', {
    limit: safePageSize,
    offset: (safePage - 1) * safePageSize,
    descending: orderedByNewest,
  })
  const unlockedIds = new Set(getUnlockedArticleIds(context))
  const included = includeId && !articles.some((item) => item.id === includeId)
    ? getContentItem(getContentPoolIdForContext(context), 'articles', includeId)
    : null
  const pageArticles = [
    ...(included ? [included] : []),
    ...(orderedByNewest ? articles : shuffleItems(articles)),
  ]
  const enrichedArticles = enrichMiniProgramContentItems(
    pageArticles,
    context,
    'article',
  )
  const items = enrichedArticles.map((item) => toArticleSummary(
    item,
    unlockedIds.has(item.id),
  ))
  return {
    ...pageResult(items, total, safePage, safePageSize),
    todayUnlockedArticleIds: [...unlockedIds],
  }
}

function getArticleDetail(context = {}, contentId = '') {
  const poolId = getContentPoolIdForContext(context)
  const runtimeConfig = getMiniProgramRuntimeConfig(context)
  const item = getContentItem(poolId, 'articles', contentId)
  if (!item) return null
  const unlockedToday = isArticleUnlocked(context, item.id)
    || runtimeConfig.articleDisplay?.hideFullArticle === false
  const enriched = enrichMiniProgramContentItems([item], context, 'article')[0]
  const bodyHtml = unlockedToday ? renderArticleMarkdown(enriched.bodyMarkdown) : ''
  const middleAdConfig = runtimeConfig.ads?.articlesEndNative || {}
  const middleAdEnabled = Boolean(middleAdConfig.enabled && String(middleAdConfig.adUnitId || '').trim())
  const article = {
    ...toArticleSummary(enriched, unlockedToday),
    previewHtml: makeArticlePreviewHtml(enriched.bodyMarkdown),
    bodyHtml,
    bodySegments: unlockedToday && middleAdEnabled
      ? splitArticleHtmlForMiddleAd(bodyHtml)
      : (bodyHtml ? [{ type: 'html', html: bodyHtml }] : []),
  }
  const recommendationPage = getArticleRecommendations(context, item.id)
  if (unlockedToday) recordArticleFullOpen(context, item.id)
  return {
    article,
    recommendations: recommendationPage.recommendations,
    recommendationPagination: recommendationPage.recommendationPagination,
    articleDisplay: runtimeConfig.articleDisplay,
    unlockedToday,
  }
}

function unlockArticle(context = {}, contentId = '') {
  const item = getContentItem(getContentPoolIdForContext(context), 'articles', contentId)
  if (!item) return null
  return getDatabase().transaction(() => {
    const unlock = saveArticleUnlock(context, item.id)
    return { ...getArticleDetail(context, item.id), unlockDate: unlock.dateKey }
  })()
}

function findContentItem(context = {}, source = '', sourceId = '') {
  const poolId = getContentPoolIdForContext(context)
  if (source === 'letters') return getContentItem(poolId, 'letters', sourceId)
  if (source === 'article') return getContentItem(poolId, 'articles', sourceId)
  if (source !== 'daily_content') return null
  return ['contentTexts', 'contentAlbums', 'contentAudios']
    .map((type) => getContentItem(poolId, type, sourceId))
    .find(Boolean) || null
}

function getProfileData(context = {}) {
  const account = getAccountSummary(context)
  const checkin = getCheckinState(context)
  const interactionSummary = getInteractionSummary(context)
  return {
    profile: {
      accountId: account.accountId,
      avatarText: account.avatarText,
      avatarUrl: account.avatarUrl,
      nickname: account.nickname,
      phone: account.phone,
      phoneAuthorized: account.phoneAuthorized,
      accountStatus: account.accountStatus,
      syncLabel: account.syncLabel,
      checkInDays: checkin.checkIn.streakDays,
      dailyContentCount: interactionSummary.totalOpened,
      companionValue: String(getCompanionValue(context, checkin)),
    },
    settings: [
      { key: 'profile', label: '个人资料' },
      { key: 'privacy', label: '隐私政策' },
      { key: 'agreement', label: '用户协议' },
      { key: 'personalInfo', label: '个人信息收集清单' },
      { key: 'thirdParty', label: '第三方共享清单' },
      { key: 'deleteAccount', label: '注销账号', danger: true },
    ],
  }
}

function formatMessageTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚留言'
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60 * 60 * 1000) return '刚刚留言'
  if (diff < 24 * 60 * 60 * 1000) return '今天留言'
  return `${date.getMonth() + 1}月${date.getDate()}日 留言`
}

function getActivityData(context = {}, { section = '', page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safePageSize = Math.max(1, Math.min(Number(pageSize) || 20, 20))
  const pageOptions = { limit: safePageSize, offset: (safePage - 1) * safePageSize }
  const defaultOptions = { limit: 20, offset: 0 }
  const optionsFor = (name) => {
    if (section === name) return pageOptions
    if (name === 'opened') return defaultOptions
    return defaultOptions
  }
  const visibleMessages = !section || section === 'messages'
    ? getVisibleMessages(context, optionsFor('messages').limit, optionsFor('messages').offset)
    : []
  const favoriteRecords = !section || section === 'favorites' ? getFavorites(context, optionsFor('favorites')) : []
  const contentActivityRecords = !section || section === 'interactions' ? getContentActivity(context, optionsFor('interactions')) : []
  const openedRecords = !section || section === 'opened' ? getOpened(context, optionsFor('opened')) : []
  const itemBySource = getContentItemsByIds(getContentPoolIdForContext(context), [
    ...favoriteRecords,
    ...contentActivityRecords,
    ...openedRecords,
    ...visibleMessages,
  ])
  const messages = visibleMessages.map((item) => {
    const content = itemBySource.get(`${item.source}:${item.sourceId}`)
    const targetPreview = getMessageTargetPreview(item.source, content || {})
    return {
      id: item.id,
      source: item.source,
      sourceId: item.sourceId,
      type: getActivityContentType(item.source, content),
      time: formatMessageTime(item.updatedAt),
      preview: item.content,
      targetPreview,
      images: content?.type === 'album' && Array.isArray(content.images) ? content.images.slice(0, 9).map(toMiniProgramImage) : [],
      originalFilename: content?.type === 'audio' ? String(content.originalFilename || '').trim() : '',
      audioUrl: content?.type === 'audio' ? String(content.audioUrl || '').trim() : '',
      durationSeconds: content?.type === 'audio' ? Math.max(0, Number(content.durationSeconds) || 0) : 0,
    }
  })

  const favorites = favoriteRecords.map((item) => {
    const content = itemBySource.get(`${item.source}:${item.sourceId}`)
    const type = getActivityContentType(item.source, content)
    const isAlbum = type === 'album'
    const isAudio = type === 'audio'
    const preview = isAlbum
      ? ''
      : content?.text
        || content?.content
        || String(content?.title || '').trim()
        || String(content?.originalFilename || '').replace(/\.[^.]+$/, '').trim()
    return {
      id: `fav-${item.source}-${item.sourceId}`,
      source: item.source,
      sourceId: item.sourceId,
      type,
      time: formatMessageTime(item.updatedAt).replace('留言', '收藏'),
      preview,
      title: String(content?.title || '').trim(),
      coverImage: item.source === 'article' && content?.coverImage ? toMiniProgramImage(content.coverImage) : null,
      images: isAlbum && Array.isArray(content?.images)
        ? content.images.slice(0, 9).map(toMiniProgramImage)
        : [],
      originalFilename: isAudio ? String(content?.originalFilename || '').trim() : '',
      audioUrl: isAudio ? String(content?.audioUrl || '').trim() : '',
      durationSeconds: isAudio ? Math.max(0, Number(content?.durationSeconds) || 0) : 0,
    }
  })
  const interactions = contentActivityRecords.map((item) => {
    const content = itemBySource.get(`${item.source}:${item.sourceId}`)
    if (!content) return null
    const type = getActivityContentType(item.source, content)
    const isAlbum = type === 'album'
    const isAudio = type === 'audio'
    const actions = [
      item.likedAt ? '点赞' : '',
      item.sharedAt ? '分享' : '',
      item.messageAt ? '留言' : '',
    ].filter(Boolean)
    return {
      id: `interaction-${item.source}-${item.sourceId}`,
      source: item.source,
      sourceId: item.sourceId,
      type,
      time: formatMessageTime(item.interactedAt).replace('留言', '互动'),
      preview: isAlbum ? '' : String(content.title || '').trim() || content.text || content.content
        || String(content.originalFilename || '').replace(/\.[^.]+$/, '').trim(),
      title: String(content.title || '').trim(),
      coverImage: item.source === 'article' && content.coverImage ? toMiniProgramImage(content.coverImage) : null,
      images: isAlbum && Array.isArray(content.images) ? content.images.slice(0, 9).map(toMiniProgramImage) : [],
      originalFilename: isAudio ? String(content.originalFilename || '').trim() : '',
      audioUrl: isAudio ? String(content.audioUrl || '').trim() : '',
      durationSeconds: isAudio ? Math.max(0, Number(content.durationSeconds) || 0) : 0,
      actions,
      interactedAt: item.interactedAt,
    }
  }).filter(Boolean)
  const openedImageAssets = new Map(getImagesByIds(openedRecords.flatMap((record) => (record.images || []).map((image) => image.id)))
    .map((image) => [image.id, image]))
  const opened = openedRecords.map((item) => {
    const sourceContent = itemBySource.get(`${item.source}:${item.sourceId}`)
    const sourceImages = sourceContent?.images || []
    const coverImage = item.source === 'article' && sourceContent?.coverImage
      ? toMiniProgramImage(sourceContent.coverImage)
      : null
    const images = item.images?.length ? item.images.map((image) => toMiniProgramImage({
      ...image,
      originalUrl: image.originalUrl || openedImageAssets.get(image.id)?.originalUrl || '',
    })) : sourceImages.map(toMiniProgramImage)
    const sourceAudio = sourceContent?.type === 'audio'
      ? toMiniProgramContentItem(enrichContentItem(sourceContent, context, item.source))
      : null
    return {
      id: item.id,
      source: item.source,
      sourceId: item.sourceId,
      type: item.type,
      time: formatMessageTime(item.createdAt).replace('留言', '打开'),
      preview: item.preview,
      title: item.title || sourceAudio?.title || '',
      coverImage,
      images,
      originalFilename: item.originalFilename || sourceAudio?.originalFilename || '',
      audioUrl: item.audioUrl || sourceAudio?.audioUrl || '',
      durationSeconds: Math.max(0, Number(item.durationSeconds) || Number(sourceAudio?.durationSeconds) || 0),
    }
  })
  const summary = getInteractionSummary(context)
  const messageCount = countVisibleMessages(context)
  const interactionCount = countContentActivity(context)
  const sectionTotals = {
    favorites: summary.favorites,
    interactions: interactionCount,
    messages: messageCount,
    opened: summary.totalOpened,
  }

  return {
    messages,
    favorites,
    interactions,
    totalOpened: opened,
    summary: {
      totalOpened: summary.totalOpened,
      interactions: interactionCount,
      messages: messageCount,
      favorites: summary.favorites,
    },
    pagination: section ? {
      page: safePage,
      pageSize: safePageSize,
      total: sectionTotals[section] || 0,
      totalPages: Math.max(1, Math.ceil((sectionTotals[section] || 0) / safePageSize)),
    } : undefined,
  }
}

function getAdminContent(requestedPoolId = '', miniProgramId = '', pagination = {}) {
  const poolId = getAdminContentPoolId(requestedPoolId, miniProgramId)
  const settings = getInternalAdminSettings()
  const config = getMiniProgramRuntimeConfig({ miniProgramId: miniProgramId || settings.currentMiniProgramId })
  const types = ['contentAlbums', 'contentAudios', 'contentTexts', 'articles', 'letters']
  const pages = Object.fromEntries(types.map((type) => {
    const page = Math.max(1, Number(pagination[type]?.page) || 1)
    const requestedPageSize = Number(pagination[type]?.pageSize)
    const pageSize = [10, 20, 50, 100].includes(requestedPageSize) ? requestedPageSize : 10
    // Admin lists put the most recently appended records first. This is scoped
    // to the management view; mini-program content ordering remains unchanged.
    const result = getContentTypePage(poolId, type, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      descending: true,
    })
    return [type, {
      ...result,
      pagination: { page, pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) },
    }]
  }))
  return {
    contentAlbums: pages.contentAlbums.items,
    contentAudios: pages.contentAudios.items,
    contentTexts: pages.contentTexts.items,
    articles: pages.articles.items,
    imageAssets: [],
    ads: config.ads,
    letters: pages.letters.items,
    limits: config.limits,
    pagination: Object.fromEntries(types.map((type) => [type, pages[type].pagination])),
    poolId,
    poolSummaries: getContentPoolSummaries(settings.contentPools.map((item) => item.id)),
    // Admin editors need the complete system object, including copy lists.
    // Public mini-app responses strip these lists through getPublicMiniAppConfig.
    system: config.system,
  }
}

function updateAdminContent(payload, miniProgramId = '') {
  const targetMiniProgramId = miniProgramId || getInternalAdminSettings().currentMiniProgramId
  const poolId = getAdminContentPoolId(payload.poolId, targetMiniProgramId)
  const result = {}
  const removedImageAssetIds = new Set()
  const trackExistingImages = (type) => getContentImageAssetIds(poolId, { type }).forEach((id) => removedImageAssetIds.add(id))
  if (payload.contentTexts) {
    result.contentTexts = updateContentTexts(payload.contentTexts, poolId).filter((item) => item.type === 'text')
  }
  if (payload.contentAlbums) {
    trackExistingImages('contentAlbums')
    result.contentAlbums = updateContentAlbums(payload.contentAlbums, poolId).filter((item) => item.type === 'album')
  }
  if (payload.contentAudios) {
    result.contentAudios = updateContentAudios(payload.contentAudios, poolId).filter((item) => item.type === 'audio')
  }
  if (payload.letters) {
    result.letters = updateLetters(payload.letters, poolId)
  }
  if (payload.articles) {
    trackExistingImages('articles')
    result.articles = updateArticles(payload.articles, poolId)
  }
  if (payload.ads || payload.limits || payload.system) {
    const configPatch = {}
    if (Object.hasOwn(payload, 'ads')) configPatch.ads = payload.ads
    if (Object.hasOwn(payload, 'limits')) configPatch.limits = payload.limits
    if (Object.hasOwn(payload, 'system')) configPatch.system = payload.system
    const config = updateCurrentMiniProgramConfig(configPatch, targetMiniProgramId)
    result.ads = config.ads
    result.limits = config.limits
    result.system = config.system
  }
  return {
    ...getAdminContent(poolId, targetMiniProgramId),
    ...result,
    removedImageAssetIds: [...removedImageAssetIds],
  }
}

function updateAdminContentPage(payload, miniProgramId = '') {
  const targetMiniProgramId = miniProgramId || getInternalAdminSettings().currentMiniProgramId
  const poolId = getAdminContentPoolId(payload.poolId, targetMiniProgramId)
  for (const type of ['contentTexts', 'contentAlbums', 'contentAudios', 'letters', 'articles']) {
    if (Array.isArray(payload[type])) upsertContentItems(poolId, type, payload[type])
  }
  if (payload.ads || payload.limits || payload.system) {
    const configPatch = {}
    if (Object.hasOwn(payload, 'ads')) configPatch.ads = payload.ads
    if (Object.hasOwn(payload, 'limits')) configPatch.limits = payload.limits
    if (Object.hasOwn(payload, 'system')) configPatch.system = payload.system
    updateCurrentMiniProgramConfig(configPatch, targetMiniProgramId)
  }
  return { poolId }
}

function deleteAdminContentItem({ poolId, type, itemId, miniProgramId = '' }) {
  const targetPoolId = getAdminContentPoolId(poolId, miniProgramId)
  const removedImageAssetIds = getContentImageAssetIds(targetPoolId, { type, itemId })
  if (!deleteContentItem(targetPoolId, type, itemId)) throw new Error('内容不存在，请刷新后重试')
  clearDeletedArticleUserData(type, itemId, miniProgramId)
  return { id: itemId, poolId: targetPoolId, type, removedImageAssetIds }
}

function deleteAdminContentItems({ poolId, type, itemIds, miniProgramId = '' }) {
  const targetPoolId = getAdminContentPoolId(poolId, miniProgramId)
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map((itemId) => String(itemId || '').trim()).filter(Boolean))]
  const removedImageAssetIds = ids.flatMap((itemId) => getContentImageAssetIds(targetPoolId, { type, itemId }))
  const deletedIds = deleteContentItems(targetPoolId, type, ids)
  deletedIds.forEach((itemId) => clearDeletedArticleUserData(type, itemId, miniProgramId))
  return { ids: deletedIds, poolId: targetPoolId, type, removedImageAssetIds: [...new Set(removedImageAssetIds)] }
}

function clearDeletedArticleUserData(type, itemId, miniProgramId = '') {
  if (type !== 'articles' || !miniProgramId) return
  const scope = normalizeDataContext({ miniProgramId, visitorId: 'cleanup' })
  const db = getDatabase()
  const sourceId = String(itemId || '').trim()
  if (!sourceId) return
  db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE data_scope_id = ? AND source = 'article' AND source_id = ?")
      .run(scope.dataScopeId, sourceId)
    db.prepare("DELETE FROM reactions WHERE data_scope_id = ? AND source = 'article' AND source_id = ?")
      .run(scope.dataScopeId, sourceId)
    db.prepare("DELETE FROM opened_records WHERE data_scope_id = ? AND source = 'article' AND source_id = ?")
      .run(scope.dataScopeId, sourceId)
    db.prepare("DELETE FROM article_unlocks WHERE data_scope_id = ? AND article_id = ?")
      .run(scope.dataScopeId, sourceId)
  })()
}

function updateAdminContentItem({ poolId, type, item, miniProgramId = '' }) {
  const targetPoolId = getAdminContentPoolId(poolId, miniProgramId)
  const removedImageAssetIds = getContentImageAssetIds(targetPoolId, { type, itemId: item.id })
  updateContentItem(targetPoolId, type, item)
  return { ...getAdminContent(targetPoolId, miniProgramId), removedImageAssetIds }
}

function appendAdminContentItems({ poolId, type, items, miniProgramId = '' }) {
  if (!Array.isArray(items)) throw new Error('导入内容无效')
  const targetPoolId = getAdminContentPoolId(poolId, miniProgramId)
  const { duplicateCount, importedCount } = appendDeduplicatedContentItems(targetPoolId, type, items)
  const content = getAdminContent(targetPoolId, miniProgramId)
  return {
    ...content,
    duplicateCount,
    importedCount,
  }
}

function getAdminContentDuplicateIndexes({ poolId, type, items, miniProgramId = '' }) {
  const targetPoolId = getAdminContentPoolId(poolId, miniProgramId)
  return getDuplicateContentItemIndexes(targetPoolId, type, items)
}

module.exports = {
  toMiniProgramShareSettings,
  getMessageTargetPreview,
  formatMessageAudioDuration,
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
}
