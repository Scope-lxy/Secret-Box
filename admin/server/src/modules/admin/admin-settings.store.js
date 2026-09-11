const path = require('path')
const { getDataDir } = require('../../lib/data-dir')
const { getDatabase, readState, writeState } = require('../../lib/state-database')
const { deleteMiniAppSessionsByMiniProgramId } = require('../auth/miniapp-session.store')
const { buildDataScopeId } = require('../data-scope/data-scope')

const dataDir = getDataDir(path.resolve(__dirname, '../../../data'))
const dataFile = path.join(dataDir, 'admin-settings.json')
const miniProgramAppIdPattern = /^wx[a-zA-Z0-9]{16}$/
const nativeAdPlacementValues = ['dailyContent', 'checkIn', 'stats']
const articleAdLabels = {
  articlesNative: '文章原生模板广告',
  articlesInterstitial: '文章插屏广告',
  articleExpandRewarded: '文章详情激励视频',
  articleInterstitial: '文章详情插屏广告',
  articlesStartNative: '文章详情开头广告',
  articlesEndNative: '文章详情正文广告',
}

const defaultAds = {
  homeNative: { enabled: true, adUnitId: '', label: '首页原生模板广告', adType: 'native', placement: 'dailyContent' },
  lettersNative: { enabled: true, adUnitId: '', label: '心笺原生模板广告', adType: 'native', firstAfter: 3, interval: 10 },
  articlesNative: { enabled: true, adUnitId: '', label: '文章原生模板广告', adType: 'native', firstAfter: 3, interval: 10 },
  articlesStartNative: { enabled: true, adUnitId: '', label: '文章详情开头广告', adType: 'native' },
  articlesEndNative: { enabled: true, adUnitId: '', label: '文章详情正文广告', adType: 'native' },
  mineNative: { enabled: true, adUnitId: '', label: '我的页原生模板广告', adType: 'native', firstAfter: 3, interval: 10 },
  homeDailyContentRewarded: {
    enabled: true,
    adUnitId: '',
    label: '手记激励视频',
    adType: 'rewarded',
    freeCount: 0,
    confirmPopupEnabled: true,
    allowOnUnavailable: true,
  },
  homeCheckInRewarded: {
    enabled: true,
    adUnitId: '',
    label: '打卡激励视频',
    adType: 'rewarded',
    freeCount: 0,
    confirmPopupEnabled: true,
    allowOnUnavailable: true,
  },
  articleExpandRewarded: {
    enabled: true,
    adUnitId: '',
    label: '文章详情激励视频',
    adType: 'rewarded',
    freeCount: 0,
    confirmPopupEnabled: true,
    allowOnUnavailable: true,
  },
  homeInterstitial: { enabled: false, adUnitId: '', label: '首页插屏广告', adType: 'interstitial', delaySeconds: 3, repeatSeconds: 90 },
  lettersInterstitial: { enabled: false, adUnitId: '', label: '心笺插屏广告', adType: 'interstitial', delaySeconds: 3, repeatSeconds: 90 },
  articlesInterstitial: { enabled: false, adUnitId: '', label: '文章插屏广告', adType: 'interstitial', delaySeconds: 3, repeatSeconds: 90 },
  articleInterstitial: { enabled: false, adUnitId: '', label: '文章详情插屏广告', adType: 'interstitial', delaySeconds: 3, repeatSeconds: 90 },
  mineInterstitial: { enabled: false, adUnitId: '', label: '我的页插屏广告', adType: 'interstitial', delaySeconds: 3, repeatSeconds: 90 },
}

const privateShareTypes = ['text', 'image', 'audio']
const privateCoverCopyMinLength = 4
const privateCoverCopyMaxLength = 20

const defaultPrivateShareTitles = {
  text: ['分享一段文案，希望你喜欢', '给你写的句子，适合慢慢读'],
  image: ['分享一组图片，想让你欣赏', '给你拍的照片，记得看一看'],
  audio: ['分享一段音频，慢慢听完吧', '为你录的音频，记得慢慢听'],
}

const defaultPrivateCoverCopies = {
  text: ['点击阅读', '值得打开'],
  image: ['今日图册', '值得看看'],
  audio: ['今日音频', '值得听听'],
}

function buildShareTextPool(values, prefix, field) {
  return values.map((value, index) => ({
    id: `${prefix}-${index + 1}`,
    [field]: value,
    enabled: true,
  }))
}

function buildDefaultPrivateSharePools() {
  return Object.fromEntries(privateShareTypes.map((type) => [type, {
    titles: buildShareTextPool(defaultPrivateShareTitles[type], `private-${type}-title`, 'title'),
    coverCopies: buildShareTextPool(defaultPrivateCoverCopies[type], `private-${type}-cover-copy`, 'text'),
  }]))
}

const defaultPrivateCoverStyle = {
  globalWashOpacity: 0.2,
  readingZoneOpacity: 0.1,
  copyFontSize: 60,
  dateFontSize: 60,
  dividerGap: 60,
  dividerLength: 60,
  text: {
    copyColor: '#FFFFFF',
    dateColor: '#F0D9A8',
    dividerColor: '#F0D9A8',
    readingZoneColor: '#1C1813',
  },
  layouts: {
    centered: { enabled: true, offsetY: 0 },
    leftTitle: { enabled: true, offsetY: 0 },
  },
}

const defaultShareSettings = {
  version: 1,
  private: {
    coverCopyEnabled: true,
    pools: buildDefaultPrivateSharePools(),
    backgrounds: [],
    coverStyle: defaultPrivateCoverStyle,
  },
}

const defaultSystem = {
  homeHero: '给你的专属秘密',
  lettersHero: '暖心的文案短句',
  articlesHero: '走心的精选文章',
  articlesSortMode: 'random',
  lettersSortMode: 'random',
  checkinButtonText: '立即打卡',
  // 会随运营增长的列表型文案：服务端内置「后台默认文案」，新建小程序实例时预填，
  // 下发给小程序后以自定义配置的形式生效。内容与客户端 miniprogram/utils/default-copy.js
  // 的定稿文案保持一致（两处需同步更新）。后台显式清空时原样下发空数组，
  // 由客户端回落到内置默认文案包，服务端不做兜底回填。
  checkinBeforeTexts: ['今天也等到你了', '每天都来打卡吧'],
  checkinAfterTexts: ['今日已点亮，明天再来打卡吧！', '感谢你的支持，明天我等你哦！'],
  dailyContentPromptTexts: [
    '想说的，都悄悄放这里了',
    '打开前，猜猜里面是什么',
  ],
  checkinAdIncompleteText: '完整观看广告后，即可完成打卡',
  dailyContentButtonText: '打开今日手记',
  dailyContentAdIncompleteText: '完整观看广告后，即可打开手记',
  articleAdIncompleteText: '完整观看广告后，即可展开全文',
  homeStats: {
    rankToday: { label: '今天第几位', visible: true },
    checkInDays: { label: '已连续打卡', visible: true },
    companionValue: { label: '累计阅读值', visible: true },
  },
  tabs: {
    // 首页采用审核 fail-safe：只有管理员明确保存 visible:true 才开启。
    home: { label: '首页', visible: false, locked: true },
    articles: { label: '文章', visible: true },
    letters: { label: '心笺', visible: true },
    mine: { label: '我的', visible: true, locked: true },
  },
}

const defaultLimits = {
  dailyContentLimit: 5,
}

const defaultDailyContentTypes = {
  imageEnabled: true,
  audioEnabled: false,
}

const defaultMiniProgramConfig = {
  ads: defaultAds,
  articleDisplay: {
    layout: 'mixed',
    previewPreset: 'early',
    expandButtonText: '展开全文',
    hideFullArticle: true,
  },
  dailyContentTypes: defaultDailyContentTypes,
  messagesEnabled: true,
  contentPoolId: 'default-pool',
  dataMode: 'shared',
  limits: defaultLimits,
  mode: 'default',
  copyVersion: 1,
  system: defaultSystem,
}

const defaultSettings = {
  currentMiniProgramId: 'default-mini-program',
  groups: [],
  contentPools: [
    {
      id: 'default-pool',
      name: '默认内容池',
      remark: '',
      createdAt: '2026-06-28T10:00:00.000Z',
    },
  ],
  shareSettings: defaultShareSettings,
  miniPrograms: [
    {
      id: 'default-mini-program',
      name: '默认小程序',
      appId: '',
      appSecret: '',
      developerEmail: '',
      remark: '',
      status: 'active',
      config: defaultMiniProgramConfig,
      createdAt: '2026-06-28T10:00:00.000Z',
    },
  ],
  storage: {
    appId: '',
    secretId: '',
    secretKey: '',
    bucket: '',
    region: '',
    url: '',
    folderPrefix: 'secretbox',
  },
  security: {
    textCheck: true,
    imageCheck: true,
    mode: 'auto-block',
    blockedWords: ['违法', '诈骗', '博彩', '违规', '广告', '辱骂'],
  },
  operationLogs: [],
}

let settings = loadSettings()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function compactString(value, fallback = '') {
  const next = String(value ?? '').trim()
  return next || fallback
}

function normalizeStatus(value) {
  return value === 'archived' ? 'archived' : 'active'
}

function normalizeRange(value, fallback, min, max) {
  const number = Number(value)
  const normalized = Number.isFinite(number) ? Math.floor(number) : fallback
  return Math.min(max, Math.max(min, normalized))
}

function normalizeDecimal(value, fallback, min, max) {
  const number = Number(value)
  const normalized = Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback
  return Math.min(max, Math.max(min, normalized))
}

function normalizeId(value, fallback) {
  return compactString(value, fallback).replace(/\s+/g, '-')
}

function normalizeContentPool(item, index = 0) {
  const id = normalizeId(item?.id, `pool-${index + 1}`)
  return {
    id,
    name: compactString(item?.name, `内容池${index + 1}`),
    remark: compactString(item?.remark, ''),
    createdAt: compactString(item?.createdAt, new Date().toISOString()),
  }
}

function normalizeMiniProgram(item, index = 0, existing = {}) {
  const id = normalizeId(item?.id, `mp-${index + 1}`)
  const incomingSecret = item?.appSecret
  const normalizedIncomingSecret = String(incomingSecret || '').trim()
  const shouldKeepSecret = incomingSecret === undefined
    || normalizedIncomingSecret === ''
    || normalizedIncomingSecret === maskSecret(existing.appSecret)
    || (Boolean(existing.appSecret) && normalizedIncomingSecret.includes('******'))
  const config = normalizeMiniProgramConfig(item?.config || {}, existing.config || {})
  return {
    id,
    name: compactString(item?.name, `小程序${index + 1}`),
    appId: compactString(item?.appId, ''),
    appSecret: shouldKeepSecret ? compactString(existing.appSecret, '') : compactString(incomingSecret, ''),
    developerEmail: compactString(item?.developerEmail, existing.developerEmail || ''),
    remark: compactString(item?.remark, ''),
    group: item?.group === undefined ? compactString(existing.group, '') : compactString(item.group, ''),
    status: normalizeStatus(item?.status),
    config,
    createdAt: compactString(item?.createdAt, existing.createdAt || new Date().toISOString()),
  }
}

function normalizeTabs(items = {}, base = defaultSystem.tabs) {
  const next = {}
  Object.entries(base).forEach(([key, current]) => {
    const incoming = items[key] || {}
    const label = Array.from(compactString(incoming.label, current.label)).slice(0, 5).join('')
    next[key] = {
      ...current,
      label: key === 'home' || key === 'mine' ? current.label : (label || current.label),
      // home is opt-in. Preserve a previously explicit choice during partial
      // updates, while new/legacy configs with no choice remain hidden.
      visible: key === 'mine'
        ? true
        : key === 'home'
          ? (Object.hasOwn(incoming, 'visible') ? incoming.visible === true : current.visible === true)
          : incoming.visible !== false,
      locked: Boolean(current.locked),
    }
  })
  return next
}

function normalizeHomeStats(items = {}, base = defaultSystem.homeStats) {
  const source = items && typeof items === 'object' ? items : {}
  return Object.fromEntries(Object.entries(base).map(([key, current]) => {
    const incoming = source[key] && typeof source[key] === 'object' ? source[key] : {}
    return [key, {
      label: compactString(incoming.label, current.label),
      visible: incoming.visible !== false,
    }]
  }))
}

function normalizeLettersSortMode(value) {
  return value === 'sequence' ? 'sequence' : 'random'
}

function normalizeArticlesSortMode(value) {
  return value === 'sequence' ? 'sequence' : 'random'
}

function normalizeMiniProgramMode(value) {
  return value === 'audit' ? 'audit' : 'default'
}

function normalizeDataMode(value) {
  return value === 'independent' ? 'independent' : 'shared'
}

function normalizeTextList(value, fallback = []) {
  // 未配置过：沿用基线；显式清空：空列表原样透传，由客户端回落内置默认文案包
  if (value === undefined) return clone(fallback)
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
  const items = source.map((item) => String(item || '').trim()).filter(Boolean)
  return items.slice(0, 12)
}

function normalizeSystem(item = {}, base = defaultSystem) {
  const saved = item && typeof item === 'object' ? item : {}
  return {
    homeHero: compactString(saved.homeHero, base.homeHero),
    lettersHero: compactString(saved.lettersHero, base.lettersHero),
    articlesHero: compactString(saved.articlesHero, base.articlesHero),
    articlesSortMode: normalizeArticlesSortMode(saved.articlesSortMode || base.articlesSortMode),
    lettersSortMode: normalizeLettersSortMode(saved.lettersSortMode || base.lettersSortMode),
    checkinButtonText: compactString(saved.checkinButtonText, base.checkinButtonText),
    checkinBeforeTexts: normalizeTextList(saved.checkinBeforeTexts, base.checkinBeforeTexts),
    checkinAfterTexts: normalizeTextList(saved.checkinAfterTexts, base.checkinAfterTexts),
    checkinAdIncompleteText: compactString(saved.checkinAdIncompleteText, base.checkinAdIncompleteText),
    dailyContentButtonText: compactString(saved.dailyContentButtonText, base.dailyContentButtonText),
    dailyContentPromptTexts: normalizeTextList(saved.dailyContentPromptTexts, base.dailyContentPromptTexts),
    dailyContentAdIncompleteText: compactString(saved.dailyContentAdIncompleteText, base.dailyContentAdIncompleteText),
    articleAdIncompleteText: compactString(saved.articleAdIncompleteText, base.articleAdIncompleteText),
    homeStats: normalizeHomeStats(saved.homeStats || {}, base.homeStats),
    tabs: normalizeTabs(saved.tabs || {}, base.tabs),
  }
}

function validateHomeNativePlacement(config = {}) {
  if (!Object.hasOwn(config, 'ads')) return
  const homeNative = config.ads?.homeNative
  if (!homeNative || !Object.hasOwn(homeNative, 'placement')) return
  const placement = homeNative.placement
  if (!nativeAdPlacementValues.includes(placement)) {
    throw new Error('首页原生广告展示位置无效')
  }
}

function normalizeAdsConfig(items, existing = defaultAds) {
  const source = items && typeof items === 'object' ? items : {}
  return Object.fromEntries(Object.entries(existing).map(([key, current]) => {
    const next = source[key] || {}
    const normalized = {
      enabled: next.enabled !== undefined ? Boolean(next.enabled) : current.enabled !== false,
      label: articleAdLabels[key] || compactString(next.label, current.label),
      adType: compactString(next.adType, current.adType),
      adUnitId: next.adUnitId !== undefined ? String(next.adUnitId || '').trim() : current.adUnitId,
    }
    if (normalized.adType === 'rewarded') {
      normalized.freeCount = normalizeRange(next.freeCount, current.freeCount || 0, 0, 9)
      normalized.confirmPopupEnabled = next.confirmPopupEnabled !== undefined
        ? Boolean(next.confirmPopupEnabled)
        : current.confirmPopupEnabled !== false
      normalized.allowOnUnavailable = next.allowOnUnavailable !== undefined
        ? Boolean(next.allowOnUnavailable)
        : current.allowOnUnavailable !== false
    }
    if (normalized.adType === 'native' && current.firstAfter !== undefined) {
      normalized.firstAfter = normalizeRange(next.firstAfter, current.firstAfter, 1, 100)
      normalized.interval = normalizeRange(next.interval, current.interval, 1, 100)
    }
    if (key === 'homeNative' && normalized.adType === 'native') {
      normalized.placement = nativeAdPlacementValues.includes(next.placement)
        ? next.placement
        : current.placement
    }
    if (normalized.adType === 'interstitial') {
      normalized.delaySeconds = normalizeRange(next.delaySeconds, current.delaySeconds || 3, 0, 300)
      normalized.repeatSeconds = normalizeRange(next.repeatSeconds, current.repeatSeconds ?? 90, 0, 300)
    }
    return [key, normalized]
  }))
}

function normalizeArticleDisplay(value = {}, base = defaultMiniProgramConfig.articleDisplay) {
  const source = value && typeof value === 'object' ? value : {}
  const layouts = ['title-left', 'stacked', 'mixed']
  const previewPresets = ['earliest', 'early', 'medium', 'late', 'latest']
  const fallbackLayout = layouts.includes(base?.layout) ? base.layout : 'mixed'
  const fallbackPreviewPreset = previewPresets.includes(base?.previewPreset) ? base.previewPreset : 'early'
  return {
    layout: layouts.includes(source.layout) ? source.layout : fallbackLayout,
    previewPreset: previewPresets.includes(source.previewPreset) ? source.previewPreset : fallbackPreviewPreset,
    expandButtonText: Array.from(compactString(source.expandButtonText, base.expandButtonText)).slice(0, 12).join(''),
    hideFullArticle: source.hideFullArticle !== undefined
      ? source.hideFullArticle !== false
      : base.hideFullArticle !== false,
  }
}

function mergeShareSettings(saved, base = defaultShareSettings) {
  if (!saved || typeof saved !== 'object') return clone(base)
  const sourcePools = saved.private?.pools && typeof saved.private.pools === 'object' ? saved.private.pools : {}
  const pools = Object.fromEntries(privateShareTypes.map((type) => {
    const source = sourcePools[type] && typeof sourcePools[type] === 'object' ? sourcePools[type] : {}
    const defaults = base.private.pools[type]
    return [type, {
      titles: normalizeShareTextPool(source.titles, defaults.titles, 'title', `private-${type}-title`, 120),
      coverCopies: normalizeShareTextPool(source.coverCopies, defaults.coverCopies, 'text', `private-${type}-cover-copy`, 80, privateCoverCopyMinLength, privateCoverCopyMaxLength),
    }]
  }))
  const sourceBackgrounds = Array.isArray(saved.private?.backgrounds) ? saved.private.backgrounds : base.private.backgrounds
  return {
    version: normalizeShareSettingsVersion(saved.version, base.version),
    private: {
      coverCopyEnabled: saved.private?.coverCopyEnabled !== undefined
        ? Boolean(saved.private.coverCopyEnabled)
        : base.private.coverCopyEnabled !== false,
      pools,
      backgrounds: normalizeShareBackgrounds(sourceBackgrounds, base.private.backgrounds),
      coverStyle: normalizePrivateCoverStyle(saved.private?.coverStyle, base.private.coverStyle),
    },
  }
}

function normalizeShareSettingsVersion(value, fallback = 1) {
  const version = Number(value)
  return Number.isInteger(version) && version > 0 ? Math.min(version, 1000000000) : fallback
}

function normalizeShareTextPool(items, fallback = [], field, idPrefix, limit, minLength = 1, maxLength = Infinity) {
  const source = Array.isArray(items) ? items : fallback
  const knownValues = new Set()
  return source
    .map((item, index) => ({
      id: compactString(item?.id, `${idPrefix}-${index + 1}`),
      [field]: compactString(item?.[field], ''),
      enabled: item?.enabled !== false,
    }))
    .filter((item) => {
      const length = Array.from(item[field]).length
      return length >= minLength && length <= maxLength && !knownValues.has(item[field]) && (knownValues.add(item[field]) || true)
    })
    .slice(0, limit)
}

function normalizeShareBackgrounds(items, fallback = []) {
  const source = Array.isArray(items) ? items : fallback
  const knownSources = new Set()
  return source
    .map((item, index) => ({
      id: compactString(item?.id, `private-background-${index + 1}`),
      imageId: compactString(item?.imageId, ''),
      imageUrl: compactString(item?.imageUrl, ''),
      originalUrl: compactString(item?.originalUrl, ''),
      enabled: item?.enabled !== false,
    }))
    .filter((item) => {
      const sourceKey = item.imageId || item.imageUrl
      const isRetiredIllustration = /^\/assets\/images\/share-(note|album)-/.test(item.imageUrl)
      return sourceKey && !isRetiredIllustration && !knownSources.has(sourceKey) && (knownSources.add(sourceKey) || true)
    })
    .slice(0, 60)
}

function normalizeShareColor(value, fallback) {
  const color = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback
}

function normalizePrivateCoverStyle(value, fallback = defaultPrivateCoverStyle) {
  const source = value && typeof value === 'object' ? value : {}
  const text = source.text && typeof source.text === 'object' ? source.text : {}
  const layouts = source.layouts && typeof source.layouts === 'object' ? source.layouts : {}
  const copyFontSize = normalizeRange(source.copyFontSize, fallback.copyFontSize, 20, 100)
  const style = {
    globalWashOpacity: normalizeDecimal(source.globalWashOpacity, fallback.globalWashOpacity, 0, 0.4),
    readingZoneOpacity: normalizeDecimal(source.readingZoneOpacity, fallback.readingZoneOpacity, 0, 0.65),
    copyFontSize,
    dateFontSize: normalizeRange(source.dateFontSize, fallback.dateFontSize, 20, 100),
    dividerGap: normalizeRange(source.dividerGap, fallback.dividerGap, 20, 100),
    dividerLength: normalizeRange(source.dividerLength, fallback.dividerLength, 20, 100),
    text: {
      copyColor: normalizeShareColor(text.copyColor, fallback.text.copyColor),
      dateColor: normalizeShareColor(text.dateColor, fallback.text.dateColor),
      dividerColor: normalizeShareColor(text.dividerColor, fallback.text.dividerColor),
      readingZoneColor: normalizeShareColor(text.readingZoneColor, fallback.text.readingZoneColor),
    },
    layouts: {
      centered: {
        enabled: layouts.centered?.enabled !== undefined ? Boolean(layouts.centered.enabled) : fallback.layouts.centered.enabled,
        offsetY: normalizeRange(layouts.centered?.offsetY, fallback.layouts.centered.offsetY, -72, 72),
      },
      leftTitle: {
        enabled: layouts.leftTitle?.enabled !== undefined ? Boolean(layouts.leftTitle.enabled) : fallback.layouts.leftTitle.enabled,
        offsetY: normalizeRange(layouts.leftTitle?.offsetY, fallback.layouts.leftTitle.offsetY, -72, 72),
      },
    },
  }
  if (!style.layouts.centered.enabled && !style.layouts.leftTitle.enabled) style.layouts.centered.enabled = true
  return style
}

function normalizeLimits(value = {}, base = defaultLimits) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    ...base,
    dailyContentLimit: normalizeRange(source.dailyContentLimit, base.dailyContentLimit ?? 5, 0, 9),
  }
}

function normalizeDailyContentTypes(value = {}, base = defaultDailyContentTypes) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    imageEnabled: source.imageEnabled !== undefined ? Boolean(source.imageEnabled) : base.imageEnabled !== false,
    audioEnabled: source.audioEnabled !== undefined ? Boolean(source.audioEnabled) : Boolean(base.audioEnabled),
  }
}

function normalizeMiniProgramConfig(item = {}, existing = {}) {
  const base = clone(defaultMiniProgramConfig)
  const previous = existing && typeof existing === 'object' ? existing : {}
  const saved = item && typeof item === 'object' ? item : {}
  const articleDisplay = {
    ...(previous.articleDisplay && typeof previous.articleDisplay === 'object' ? previous.articleDisplay : {}),
    ...(saved.articleDisplay && typeof saved.articleDisplay === 'object' ? saved.articleDisplay : {}),
  }
  validateHomeNativePlacement(saved)
  const mode = normalizeMiniProgramMode(saved.mode || previous.mode || base.mode)
  const ads = {
    ...(previous.ads && typeof previous.ads === 'object' ? previous.ads : {}),
    ...(saved.ads && typeof saved.ads === 'object' ? saved.ads : {}),
  }
  const dailyContentTypes = {
    ...(previous.dailyContentTypes && typeof previous.dailyContentTypes === 'object' ? previous.dailyContentTypes : {}),
    ...(saved.dailyContentTypes && typeof saved.dailyContentTypes === 'object' ? saved.dailyContentTypes : {}),
  }
  const limits = {
    ...(previous.limits && typeof previous.limits === 'object' ? previous.limits : {}),
    ...(saved.limits && typeof saved.limits === 'object' ? saved.limits : {}),
  }
  const system = {
    ...(previous.system && typeof previous.system === 'object' ? previous.system : {}),
    ...(saved.system && typeof saved.system === 'object' ? saved.system : {}),
  }
  return {
    ads: normalizeAdsConfig(ads, base.ads),
    articleDisplay: normalizeArticleDisplay(articleDisplay, base.articleDisplay),
    dailyContentTypes: normalizeDailyContentTypes(dailyContentTypes, base.dailyContentTypes),
    messagesEnabled: saved.messagesEnabled !== undefined
      ? Boolean(saved.messagesEnabled)
      : previous.messagesEnabled !== undefined ? Boolean(previous.messagesEnabled) : base.messagesEnabled,
    contentPoolId: compactString(saved.contentPoolId, previous.contentPoolId || base.contentPoolId),
    dataMode: normalizeDataMode(saved.dataMode ?? previous.dataMode ?? base.dataMode),
    limits: normalizeLimits(limits, base.limits),
    mode,
    copyVersion: normalizeShareSettingsVersion(saved.copyVersion ?? previous.copyVersion, base.copyVersion),
    system: normalizeSystem(system, base.system),
  }
}

function normalizeStorage(item = {}, existing = {}) {
  const incomingSecretKey = item.secretKey
  const normalizedIncomingSecretKey = String(incomingSecretKey || '').trim()
  const shouldKeepSecretKey = incomingSecretKey === undefined
    || normalizedIncomingSecretKey === ''
    || normalizedIncomingSecretKey === maskSecret(existing.secretKey)
    || (Boolean(existing.secretKey) && normalizedIncomingSecretKey.includes('******'))
  return {
    appId: compactString(item.appId, existing.appId || defaultSettings.storage.appId),
    secretId: compactString(item.secretId, existing.secretId || defaultSettings.storage.secretId),
    secretKey: shouldKeepSecretKey ? compactString(existing.secretKey, defaultSettings.storage.secretKey) : compactString(incomingSecretKey, defaultSettings.storage.secretKey),
    bucket: compactString(item.bucket, existing.bucket || defaultSettings.storage.bucket),
    region: compactString(item.region, existing.region || defaultSettings.storage.region),
    url: compactString(item.url, existing.url || defaultSettings.storage.url),
    folderPrefix: normalizeStorageFolderPrefix(item.folderPrefix, existing.folderPrefix || defaultSettings.storage.folderPrefix),
  }
}

function normalizeStorageFolderPrefix(value, fallback = 'secretbox') {
  const source = String(value ?? fallback)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
  const prefix = source
    .split('/')
    .map((part) => part.replace(/[^a-zA-Z0-9-]/g, ''))
    .filter(Boolean)
    .join('/')
  return prefix || 'secretbox'
}

function normalizeWordList(items, fallback = []) {
  const source = Array.isArray(items) ? items : fallback
  const words = source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  return [...new Set(words)].slice(0, 50)
}

function normalizeSecurity(item = {}, base = defaultSettings.security) {
  const saved = item && typeof item === 'object' ? item : {}
  return {
    textCheck: saved.textCheck !== false,
    imageCheck: saved.imageCheck !== false,
    mode: 'auto-block',
    blockedWords: normalizeWordList(saved.blockedWords, base.blockedWords),
  }
}

function normalizeSettings(input = {}, existing = defaultSettings) {
  const base = clone(defaultSettings)
  const saved = input && typeof input === 'object' ? input : {}
  const previous = existing && typeof existing === 'object' ? existing : base
  const existingMiniPrograms = Object.fromEntries((previous.miniPrograms || []).map((item) => [item.id, item]))
  const contentPools = Array.isArray(saved.contentPools) && saved.contentPools.length
    ? saved.contentPools.slice(0, 20).map(normalizeContentPool)
    : clone(base.contentPools)
  const validPoolIds = new Set(contentPools.map((item) => item.id))
  const groups = [...new Set((Array.isArray(saved.groups) ? saved.groups : (previous.groups || base.groups))
    .map((item) => compactString(typeof item === 'string' ? item : item?.name, ''))
    .filter(Boolean))].slice(0, 50)
  const validGroupNames = new Set(groups)
  const sourceMiniPrograms = Array.isArray(saved.miniPrograms) && saved.miniPrograms.length
    ? saved.miniPrograms
    : base.miniPrograms
  const miniPrograms = sourceMiniPrograms.length
    ? sourceMiniPrograms.slice(0, 30).map((item, index) => {
      const normalized = normalizeMiniProgram(item, index, existingMiniPrograms[item.id] || {})
      if (!validPoolIds.has(normalized.config.contentPoolId)) normalized.config.contentPoolId = contentPools[0].id
      if (!validGroupNames.has(normalized.group)) normalized.group = ''
      return normalized
    }) : clone(base.miniPrograms)
  const activeMiniProgramIds = miniPrograms
    .filter((item) => item.status !== 'archived')
    .map((item) => item.id)
  const requestedCurrentId = compactString(saved.currentMiniProgramId, previous.currentMiniProgramId || base.currentMiniProgramId)
  const currentMiniProgramId = activeMiniProgramIds.includes(requestedCurrentId)
    ? requestedCurrentId
    : activeMiniProgramIds[0] || miniPrograms[0]?.id || base.currentMiniProgramId
  const shareSettings = mergeShareSettings(
    saved.shareSettings || previous.shareSettings || base.shareSettings,
    defaultShareSettings,
  )

  return {
    currentMiniProgramId,
    contentPools,
    groups,
    shareSettings,
    miniPrograms,
    storage: normalizeStorage(saved.storage || {}, previous.storage || {}),
    security: normalizeSecurity(saved.security || {}, base.security),
    operationLogs: Array.isArray(saved.operationLogs)
      ? saved.operationLogs.slice(0, 20).map(normalizeOperationLog)
      : clone(base.operationLogs),
  }
}

function normalizeOperationLog(item, index = 0) {
  return {
    id: compactString(item?.id, `log-${index + 1}`),
    time: compactString(item?.time, new Date().toLocaleString('zh-CN', { hour12: false })),
    actor: compactString(item?.actor, 'admin'),
    type: compactString(item?.type, '配置更新'),
    target: compactString(item?.target, '后台配置'),
    badge: ['info', 'success', 'warning', 'danger'].includes(item?.badge) ? item.badge : 'info',
    description: compactString(item?.description, ''),
  }
}

function loadSettings() {
  const saved = readState(dataFile)
  if (saved === null) return normalizeSettings(defaultSettings, defaultSettings)
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.miniPrograms) || !Array.isArray(saved.contentPools)) {
    throw new Error('admin settings state is invalid')
  }
  return normalizeSettings(saved, defaultSettings)
}

function saveSettings() {
  writeState(dataFile, settings)
}

function persistSettingsAtomically(update) {
  const previous = clone(settings)
  try {
    return getDatabase().transaction(update)()
  } catch (error) {
    settings = previous
    throw error
  }
}

function maskSecret(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= 12) return '******'
  return `${text.slice(0, 4)}******${text.slice(-4)}`
}

function sanitizeMiniProgram(item) {
  const { appSecret, ...sanitized } = item
  return {
    ...sanitized,
    appSecretConfigured: Boolean(appSecret),
    appSecretMasked: maskSecret(appSecret),
  }
}

function sanitizeStorage(item) {
  const { secretKey, ...sanitized } = item
  return {
    ...sanitized,
    secretKeyConfigured: Boolean(secretKey),
    secretKeyMasked: maskSecret(secretKey),
  }
}

function sanitizeSettings(value) {
  return {
    ...clone(value),
    miniPrograms: value.miniPrograms.map(sanitizeMiniProgram),
    storage: sanitizeStorage(value.storage),
  }
}

function appendOperationLog({ actor = 'admin', type, target, description, badge = 'success' }) {
  const log = normalizeOperationLog({
    id: `log-${Date.now().toString(36)}`,
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    actor,
    type,
    target,
    badge,
    description,
  })
  settings.operationLogs = [log, ...settings.operationLogs].slice(0, 20)
  saveSettings()
  return clone(log)
}

function getAdminSettings() {
  return sanitizeSettings(settings)
}

function getInternalAdminSettings() {
  return clone(settings)
}

function getMiniProgramForContext(context = {}) {
  const requestedMiniProgramId = String(context.miniProgramId || '').trim()
  if (requestedMiniProgramId) {
    return settings.miniPrograms.find((item) => item.id === requestedMiniProgramId && item.status !== 'archived') || null
  }
  return settings.miniPrograms.find((item) => item.id === settings.currentMiniProgramId && item.status !== 'archived')
    || settings.miniPrograms.find((item) => item.status !== 'archived')
    || null
}

function getMiniProgramByAppId(appId = '') {
  const target = compactString(appId, '')
  if (!miniProgramAppIdPattern.test(target)) return null
  return settings.miniPrograms.find((item) => item.appId === target && item.status !== 'archived') || null
}

function getCurrentMiniProgram() {
  return getMiniProgramForContext({ miniProgramId: settings.currentMiniProgramId })
}

function getMiniProgramWechatCredentials(context = {}) {
  const miniProgram = getMiniProgramForContext(context)
  return {
    appId: compactString(miniProgram?.appId, ''),
    appSecret: compactString(miniProgram?.appSecret, ''),
  }
}

function getMiniProgramRuntimeConfig(context = {}) {
  const current = getMiniProgramForContext(context)
  if (!current) return null
  const config = normalizeMiniProgramConfig(current?.config || {})
  return {
    ...config,
    shareSettings: clone(settings.shareSettings),
  }
}

function migrateMiniProgramDataMode(miniProgramId, currentConfig, nextConfig) {
  if (currentConfig.contentPoolId !== nextConfig.contentPoolId || currentConfig.dataMode === nextConfig.dataMode) return
  const { migrateDataMode } = require('../data-scope/data-scope-migration.service')
  migrateDataMode({
    miniProgramId,
    contentPoolId: currentConfig.contentPoolId,
    fromMode: currentConfig.dataMode,
    toMode: nextConfig.dataMode,
  })
}

const publicCopyListKeys = ['checkinBeforeTexts', 'checkinAfterTexts', 'dailyContentPromptTexts']

// 文案包指纹：三个下发给独立文案包的列表是否变化（用于 copyVersion 递增判断）
function copyListsFingerprint(system = {}) {
  return JSON.stringify(publicCopyListKeys.map((key) => system[key] || []))
}

// 文案列表变化时递增 copyVersion：所有修改小程序配置的入口都必须经过这里，
// 否则客户端带旧版本号请求会拿到 changed:false，一直用旧文案
function bumpCopyVersionIfNeeded(previousConfig, nextConfig) {
  const previousVersion = normalizeShareSettingsVersion(Number(previousConfig?.copyVersion || 0), 1)
  if (copyListsFingerprint(previousConfig?.system) !== copyListsFingerprint(nextConfig.system)) {
    nextConfig.copyVersion = normalizeShareSettingsVersion(
      previousVersion + 1,
      1,
    )
  } else if (previousConfig) {
    // copyVersion is server-owned; callers cannot rewind or forge it.
    nextConfig.copyVersion = previousVersion
  }
  return nextConfig
}

function bumpCopyVersions(previousSettings, nextSettings) {
  const previousById = new Map((previousSettings?.miniPrograms || []).map((item) => [item.id, item]))
  nextSettings.miniPrograms = nextSettings.miniPrograms.map((item) => {
    const previous = previousById.get(item.id)
    if (!previous) return item
    return {
      ...item,
      config: bumpCopyVersionIfNeeded(previous.config, item.config),
    }
  })
  return nextSettings
}

function updateCurrentMiniProgramConfig(payload = {}, miniProgramId = '') {
  if (Object.hasOwn(payload, 'shareSettings')) throw new Error('分享模板只能通过全局分享设置更新')
  const current = miniProgramId
    ? getMiniProgramForContext({ miniProgramId })
    : getCurrentMiniProgram()
  if (!current) return normalizeMiniProgramConfig()
  const nextConfig = bumpCopyVersionIfNeeded(current.config, normalizeMiniProgramConfig(payload, current.config))
  return persistSettingsAtomically(() => {
    migrateMiniProgramDataMode(current.id, current.config, nextConfig)
    current.config = nextConfig
    saveSettings()
    return getMiniProgramRuntimeConfig({ miniProgramId: current.id })
  })
}

// 比较分享设置内容（剔除 version）：重复保存相同内容不应触发客户端重新下载文案包
function shareSettingsContentFingerprint(value = {}) {
  const { version, ...content } = value
  return JSON.stringify(content)
}

function setGlobalShareSettings(payload = {}) {
  const previous = settings.shareSettings
  const shareSettings = mergeShareSettings(payload, previous)
  if (shareSettingsContentFingerprint(previous) !== shareSettingsContentFingerprint(shareSettings)) {
    shareSettings.version = normalizeShareSettingsVersion(Number(previous?.version || 0) + 1, 1)
  } else {
    shareSettings.version = normalizeShareSettingsVersion(Number(previous?.version || 0), 1)
  }
  settings.shareSettings = shareSettings
  return clone(settings.shareSettings)
}

function updateGlobalShareSettings(payload = {}) {
  const shareSettings = setGlobalShareSettings(payload)
  saveSettings()
  return shareSettings
}

function validateMiniProgram(item, excludedId = '') {
  validateMiniProgramGroup(item.group)
  if (item.developerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.developerEmail)) {
    throw new Error(`开发者联系邮箱格式无效：${item.name}`)
  }
  if (!miniProgramAppIdPattern.test(item.appId)) {
    throw new Error(`AppID 格式无效：${item.name}`)
  }
  const duplicate = settings.miniPrograms.find((existing) => (
    existing.id !== excludedId && existing.appId === item.appId
  ))
  if (duplicate) throw new Error(`AppID 已被其他小程序使用：${item.appId}`)
}

function validateMiniProgramGroup(group) {
  if (typeof group !== 'string' || (group && !settings.groups.includes(group))) {
    throw new Error('分组不存在，请刷新后重新选择')
  }
}

function updateMiniProgramGroups(payload = {}, meta = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Array.isArray(payload.groups) || !Array.isArray(payload.expectedGroups)
    || payload.expectedGroups.some((name) => typeof name !== 'string')) {
    throw new Error('分组保存请求格式无效，请重新打开设置分组')
  }
  if (JSON.stringify(payload.expectedGroups) !== JSON.stringify(settings.groups)) {
    throw new Error('分组已被修改，请关闭弹窗后重新打开设置分组')
  }
  if (payload.groups.length > 50) throw new Error('最多只能设置 50 个分组')
  const names = new Set()
  const renamedGroups = new Map()
  const groups = payload.groups.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.name !== 'string' || typeof item.original !== 'string') {
      throw new Error('分组保存请求格式无效')
    }
    const name = item.name.trim()
    if (!name) throw new Error('分组名称不能为空')
    if (Array.from(name).length > 30) throw new Error('分组名称不能超过 30 个字')
    if (names.has(name)) throw new Error(`分组名称重复：${name}`)
    names.add(name)
    if (item.original) {
      if (!settings.groups.includes(item.original) || renamedGroups.has(item.original)) {
        throw new Error('原分组无效，请重新打开设置分组')
      }
      renamedGroups.set(item.original, name)
    }
    return name
  })
  return persistSettingsAtomically(() => {
    settings.groups = groups
    // Apply renames to the latest app state, not a stale list from the dialog.
    settings.miniPrograms = settings.miniPrograms.map((item) => ({
      ...item,
      group: renamedGroups.get(item.group) || '',
    }))
    saveSettingsWithOperationLog({
      actor: meta.actor || 'admin',
      type: '小程序分组',
      target: '分组管理',
      description: '已更新小程序分组',
    })
    return getAdminSettings()
  })
}

function saveSettingsWithOperationLog(meta = {}) {
  if (meta.type || meta.description) {
    appendOperationLog({
      actor: meta.actor || 'admin',
      type: meta.type || '配置更新',
      target: meta.target || '后台配置',
      description: meta.description || '后台配置已保存',
      badge: meta.badge || 'success',
    })
    return
  }
  saveSettings()
}

function setCurrentMiniProgram(id = '') {
  const target = compactString(id, '')
  const miniProgram = settings.miniPrograms.find((item) => item.id === target && item.status !== 'archived')
  if (!miniProgram) throw new Error('当前小程序已停用或不存在')
  settings.currentMiniProgramId = miniProgram.id
  saveSettings()
  return getAdminSettings()
}

function createMiniProgram(payload = {}, meta = {}) {
  if (settings.miniPrograms.length >= 30) throw new Error('最多只能管理 30 个小程序')
  if (Object.hasOwn(payload, 'group')) validateMiniProgramGroup(payload.group)
  const miniProgram = normalizeMiniProgram(payload, settings.miniPrograms.length)
  if (settings.miniPrograms.some((item) => item.id === miniProgram.id)) {
    throw new Error(`小程序内部 ID 已存在：${miniProgram.id}`)
  }
  validateMiniProgram(miniProgram)
  // A new instance starts its own copy stream; callers cannot choose its version.
  miniProgram.config.copyVersion = defaultMiniProgramConfig.copyVersion
  settings.miniPrograms.push(miniProgram)
  settings.currentMiniProgramId = miniProgram.id
  saveSettingsWithOperationLog(meta)
  return getAdminSettings()
}

function updateMiniProgram(id = '', payload = {}, meta = {}) {
  const index = settings.miniPrograms.findIndex((item) => item.id === compactString(id, ''))
  if (index < 0) throw new Error('小程序不存在')
  const current = settings.miniPrograms[index]
  if (Object.hasOwn(payload, 'group')) validateMiniProgramGroup(payload.group)
  const miniProgram = normalizeMiniProgram({
    ...current,
    ...payload,
    id: current.id,
    status: current.status,
    createdAt: current.createdAt,
  }, index, current)
  // Group assignment must also work for an instance awaiting its AppID setup.
  const groupOnly = Object.keys(payload).length === 1 && Object.hasOwn(payload, 'group')
  if (!groupOnly) validateMiniProgram(miniProgram, current.id)
  miniProgram.config = bumpCopyVersionIfNeeded(current.config, miniProgram.config)
  return persistSettingsAtomically(() => {
    migrateMiniProgramDataMode(current.id, current.config, miniProgram.config)
    settings.miniPrograms[index] = miniProgram
    saveSettingsWithOperationLog(meta)
    return getAdminSettings()
  })
}

function updateMiniProgramConfig(id = '', payload = {}, meta = {}) {
  if (Object.hasOwn(payload, 'shareSettings')) throw new Error('分享模板只能通过全局分享设置更新')
  const miniProgram = settings.miniPrograms.find((item) => item.id === compactString(id, ''))
  if (!miniProgram || miniProgram.status === 'archived') throw new Error('当前小程序已停用或不存在')
  const nextConfig = bumpCopyVersionIfNeeded(miniProgram.config, normalizeMiniProgramConfig(payload, miniProgram.config))
  return persistSettingsAtomically(() => {
    migrateMiniProgramDataMode(miniProgram.id, miniProgram.config, nextConfig)
    miniProgram.config = nextConfig
    saveSettingsWithOperationLog(meta)
    return getAdminSettings()
  })
}

function deleteMiniProgramDefinition(id = '', meta = {}) {
  const index = settings.miniPrograms.findIndex((item) => item.id === compactString(id, ''))
  if (index < 0) throw new Error('小程序不存在')
  const remainingActiveCount = settings.miniPrograms.filter((item) => (
    item.id !== settings.miniPrograms[index].id && item.status !== 'archived'
  )).length
  if (remainingActiveCount < 1) throw new Error('至少保留一个已接入的小程序')
  const previous = clone(settings)
  const [miniProgram] = settings.miniPrograms.splice(index, 1)
  if (settings.currentMiniProgramId === miniProgram.id) {
    settings.currentMiniProgramId = settings.miniPrograms.find((item) => item.status !== 'archived')?.id
      || settings.miniPrograms[0].id
  }
  try {
    saveSettingsWithOperationLog(meta)
  } catch (error) {
    settings = previous
    throw error
  }
  return clone(miniProgram)
}

function reorderMiniProgram(id = '', direction = '') {
  const target = compactString(id, '')
  const activeMiniPrograms = settings.miniPrograms.filter((item) => item.status !== 'archived')
  const activeIndex = activeMiniPrograms.findIndex((item) => item.id === target)
  if (activeIndex < 0) throw new Error('当前小程序已停用或不存在')
  if (!['up', 'down'].includes(direction)) throw new Error('排序方向无效')
  const nextActiveIndex = direction === 'up' ? activeIndex - 1 : activeIndex + 1
  if (nextActiveIndex < 0 || nextActiveIndex >= activeMiniPrograms.length) return getAdminSettings()
  const index = settings.miniPrograms.findIndex((item) => item.id === target)
  const nextIndex = settings.miniPrograms.findIndex((item) => item.id === activeMiniPrograms[nextActiveIndex].id)
  const current = settings.miniPrograms[index]
  settings.miniPrograms[index] = settings.miniPrograms[nextIndex]
  settings.miniPrograms[nextIndex] = current
  saveSettings()
  return getAdminSettings()
}

function setMiniProgramStatus(id = '', status = 'active', meta = {}) {
  const miniProgram = settings.miniPrograms.find((item) => item.id === compactString(id, ''))
  if (!miniProgram) throw new Error('小程序不存在')
  const nextStatus = normalizeStatus(status)
  if (nextStatus === 'archived' && miniProgram.status !== 'archived') {
    const activeCount = settings.miniPrograms.filter((item) => item.status !== 'archived').length
    if (activeCount <= 1) throw new Error('至少保留一个已接入的小程序')
  }
  const wasActive = miniProgram.status !== 'archived'
  miniProgram.status = nextStatus
  if (wasActive && nextStatus === 'archived') deleteMiniAppSessionsByMiniProgramId(miniProgram.id)
  if (settings.currentMiniProgramId === miniProgram.id && nextStatus === 'archived') {
    settings.currentMiniProgramId = settings.miniPrograms.find((item) => item.status !== 'archived')?.id || ''
  }
  saveSettingsWithOperationLog(meta)
  return getAdminSettings()
}

function updateAdminSettings(payload = {}, meta = {}) {
  if (Object.hasOwn(payload, 'shareSettings')) throw new Error('分享模板只能通过全局分享设置更新')
  if (Object.hasOwn(payload, 'groups') && JSON.stringify(payload.groups) !== JSON.stringify(settings.groups)) {
    throw new Error('分组新增、改名或删除必须通过设置分组保存')
  }
  if (Array.isArray(payload.miniPrograms)) {
    payload.miniPrograms.forEach((item) => {
      if (item && Object.hasOwn(item, 'group')) validateMiniProgramGroup(item.group)
    })
  }
  const nextSettings = normalizeSettings({ ...settings, ...payload }, settings)
  if (Object.hasOwn(payload, 'miniPrograms')) {
    const usedMiniProgramIds = new Set()
    const duplicateMiniProgramId = nextSettings.miniPrograms.find((item) => {
      if (usedMiniProgramIds.has(item.id)) return true
      usedMiniProgramIds.add(item.id)
      return false
    })?.id
    if (duplicateMiniProgramId) throw new Error(`小程序内部 ID 已存在：${duplicateMiniProgramId}`)
    const currentIds = [...settings.miniPrograms.map((item) => item.id)].sort()
    const nextIds = [...nextSettings.miniPrograms.map((item) => item.id)].sort()
    if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
      throw new Error('小程序新增或删除必须使用专用管理接口')
    }
    nextSettings.miniPrograms.forEach((item) => {
      const current = settings.miniPrograms.find((existing) => existing.id === item.id)
      if (current.status !== item.status) throw new Error('小程序状态必须使用专用管理接口更新')
    })
    const usedAppIds = new Set()
    nextSettings.miniPrograms.forEach((item) => {
      if (usedAppIds.has(item.appId)) throw new Error(`AppID 已被其他小程序使用：${item.appId}`)
      usedAppIds.add(item.appId)
      if (item.developerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.developerEmail)) {
        throw new Error(`开发者联系邮箱格式无效：${item.name}`)
      }
      if (!miniProgramAppIdPattern.test(item.appId)) throw new Error(`AppID 格式无效：${item.name}`)
    })
  }
  bumpCopyVersions(settings, nextSettings)
  return persistSettingsAtomically(() => {
    if (Object.hasOwn(payload, 'miniPrograms')) {
      nextSettings.miniPrograms.forEach((item) => {
        const current = settings.miniPrograms.find((existing) => existing.id === item.id)
        migrateMiniProgramDataMode(item.id, current.config, item.config)
      })
    }
    settings = nextSettings
    saveSettingsWithOperationLog(meta)
    return getAdminSettings()
  })
}

// 公开通道的 system 不再携带会增长的文案列表：它们由独立文案包接口（/miniapp/copy-pack）下发
function stripPublicCopyLists(system = {}) {
  const next = clone(system)
  publicCopyListKeys.forEach((key) => delete next[key])
  return next
}

function getPublicMiniAppConfig(context = {}) {
  const current = getMiniProgramForContext(context)
  if (!current) return null
  const config = getMiniProgramRuntimeConfig(context)
  const apiBaseUrl = String(process.env.PUBLIC_MINIAPP_API_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim()
  return {
    dataScopeId: buildDataScopeId({
      miniProgramId: current.id,
      contentPoolId: config.contentPoolId,
      dataMode: config.dataMode,
    }),
    miniProgram: current ? {
      id: current.id,
      name: current.name,
      appId: current.appId,
      developerEmail: current.developerEmail,
      contentPoolId: config.contentPoolId,
    } : null,
    apiBaseUrl,
    ads: getPublicAds(config.ads),
    articleDisplay: clone(config.articleDisplay),
    system: stripPublicCopyLists(config.system),
    dailyContentTypes: clone(config.dailyContentTypes),
    // Keep all stable runtime controls in the startup (L2) payload so its
    // cache is sufficient during a degraded launch.
    limits: clone(config.limits),
    messagesEnabled: config.messagesEnabled !== false,
    storage: {
      appId: settings.storage.appId,
      bucket: settings.storage.bucket,
      region: settings.storage.region,
      url: settings.storage.url,
      configured: Boolean(settings.storage.bucket && settings.storage.region),
    },
  }
}

function getPublicAds(ads = {}) {
  return clone(ads)
}

module.exports = {
  appendOperationLog,
  createMiniProgram,
  deleteMiniProgramDefinition,
  getAdminSettings,
  getInternalAdminSettings,
  getMiniProgramByAppId,
  getMiniProgramWechatCredentials,
  getMiniProgramRuntimeConfig,
  getPublicAds,
  getPublicMiniAppConfig,
  stripPublicCopyLists,
  reorderMiniProgram,
  setCurrentMiniProgram,
  setMiniProgramStatus,
  updateCurrentMiniProgramConfig,
  updateGlobalShareSettings,
  updateAdminSettings,
  updateMiniProgram,
  updateMiniProgramGroups,
  updateMiniProgramConfig,
}
