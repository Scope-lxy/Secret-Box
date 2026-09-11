const { splitContentParagraphs } = require('./paragraphs')
const { prepareArticleSummary } = require('./article-feed')
const { getImageCandidates, prepareDisplayImage } = require('./image-display')

const ACTIVITY_TYPE_LABELS = {
  text: '手记',
  audio: '音频',
  album: '图册',
  article: '文章',
  letter: '心笺',
}

function splitStatValue(item) {
  const raw = String(item.value || '')
  const fallbackUnits = {
    rankToday: '位',
    checkInDays: '天',
    companionValue: '点',
  }
  const match = raw.match(/^(.+?)([^\d.kKmM]+)$/)
  return {
    ...item,
    displayValue: match ? match[1] : raw,
    displayUnit: match ? match[2] : fallbackUnits[item.key] || '',
  }
}

function compactNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value || '0')
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(1).replace(/\.0$/, '')}w`
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(number)
}

function withInteractionDisplayCounts(item = {}) {
  const likeCount = Number(item.likeCount) > 0 ? compactNumber(item.likeCount) : ''
  const favoriteCount = Number(item.favoriteCount) > 0 ? compactNumber(item.favoriteCount) : ''
  return { ...item, displayLikeCount: likeCount, displayFavoriteCount: favoriteCount }
}

function normalizeActivityImages(images = []) {
  if (!Array.isArray(images)) return []
  return images.map((image) => prepareDisplayImage({
    id: image.id || '',
    mediumUrl: image.mediumUrl || '',
    thumbUrl: image.thumbUrl || '',
    originalUrl: image.originalUrl || '',
    url: image.url || '',
  }, 'thumb')).filter((image) => image.displayUrl)
}

function normalizeActivityItem(item = {}, options = {}) {
  const source = String(item.source || '').trim()
  const isAudio = item.type === 'audio'
  const isAlbum = item.type === 'album'
  const isArticle = item.type === 'article'
  const type = ACTIVITY_TYPE_LABELS[item.type] || '内容'
  const sourceId = String(item.sourceId || '').trim()
  const title = String(item.title || '').trim()
  const cover = source === 'article'
    ? prepareArticleSummary({ id: sourceId || item.id, coverImage: item.coverImage }, 'title-left', options.displayIndex, options.shareSettings)
    : { coverUrl: '', coverCandidates: [] }
  const originalFilename = String(item.originalFilename || '').trim()
  const audioUrl = String(item.audioUrl || '').trim()
  const audioTitle = String(item.title || '').trim()
    || (originalFilename || String(item.preview || '').trim()).replace(/\.[^.]+$/, '')
    || '轻读音频'
  const durationSeconds = Math.max(0, Number(item.durationSeconds) || 0)
  const images = normalizeActivityImages(item.images)
  const preview = item.preview || item.summary || item.content || ''
  const targetPreview = String(item.targetPreview || '').trim()
  return {
    id: item.id || `${item.type || 'item'}-${Date.now()}`,
    type,
    time: item.time || (item.date ? `${item.date} 打开` : ''),
    preview,
    targetPreview,
    title,
    coverUrl: cover.coverUrl,
    coverCandidates: cover.coverCandidates,
    actions: Array.isArray(item.actions) ? item.actions : [],
    images,
    isAudio,
    isAlbum,
    isArticle,
    source,
    sourceId,
    originalFilename,
    audioUrl,
    audioTitle,
    durationSeconds,
    audioCurrentSeconds: 0,
    audioCurrentTime: '00:00',
    audioProgressStyle: 'width: 0%;',
    audioIsPlaying: false,
    audioIsBuffering: false,
  }
}

function withPreviewParagraphs(item = {}) {
  return {
    ...item,
    previewParagraphs: splitContentParagraphs(item.preview),
  }
}

function normalizeActivityListItem(item = {}, options = {}) {
  const normalized = normalizeActivityItem(item, options)
  return {
    ...normalized,
    time: normalized.time
      .replace(/^收藏于\s*/, '')
      .replace(/\s*(互动|打开|收藏|留言)$/, ''),
  }
}

function imageUrls(images = [], field = 'thumbUrl') {
  return images.map((image) => image[field] || getImageCandidates(image, field === 'thumbUrl' ? 'thumb' : 'medium')[0]).filter(Boolean)
}

function getPreviewImageUrls(images = [], currentIndex = 0) {
  const urls = imageUrls(images, 'mediumUrl')
  return {
    urls,
    current: getImageCandidates(images[currentIndex])[0] || urls[0] || '',
  }
}

module.exports = {
  compactNumber,
  withInteractionDisplayCounts,
  getPreviewImageUrls,
  imageUrls,
  normalizeActivityItem,
  normalizeActivityListItem,
  splitStatValue,
  withPreviewParagraphs,
}
