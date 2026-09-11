const ARTICLE_LAYOUTS = new Set(['title-left', 'stacked', 'mixed'])
const ARTICLE_SORT_MODES = new Set(['random', 'sequence'])
const DEFAULT_FALLBACK_COVER = '/assets/images/share-1.jpg'
const { DEFAULT_COPY_PACK } = require('./default-copy')
const { getImageCandidates } = require('./image-display')

function normalizeArticleLayout(value) {
  return ARTICLE_LAYOUTS.has(value) ? value : 'mixed'
}

function normalizeArticleSortMode(value) {
  return ARTICLE_SORT_MODES.has(value) ? value : 'random'
}

function shuffleArticles(items, random = Math.random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[target]
    result[target] = current
  }
  return result
}

function sortArticleItems(items = [], mode = 'random', random = Math.random) {
  const source = Array.isArray(items) ? items : []
  if (normalizeArticleSortMode(mode) === 'random') return shuffleArticles(source, random)
  return [...source]
}

function resolveArticleLayout(layout, articleId, displayIndex = 0) {
  const normalized = normalizeArticleLayout(layout)
  if (normalized !== 'mixed') return normalized
  return Number(displayIndex) % 5 === 0 ? 'stacked' : 'title-left'
}

function getArticleCoverUrl(coverImage = {}) {
  if (typeof coverImage === 'string') return coverImage
  if (!coverImage || typeof coverImage !== 'object') return ''
  return String(
    coverImage.mediumUrl
    || coverImage.thumbUrl
    || coverImage.originalUrl
    || coverImage.url
    || '',
  ).trim()
}

function getShareBackgroundUrls(shareSettings = {}) {
  const backgrounds = Array.isArray(shareSettings.private?.backgrounds)
    ? shareSettings.private.backgrounds
    : []
  return backgrounds
    .filter((item) => item?.enabled !== false && String(item?.imageUrl || '').trim())
    .map((item) => String(item.imageUrl).trim())
}

function resolveFallbackCoverUrl(shareSettings = {}, displayIndex = 0, stableKey = '') {
  const configured = getShareBackgroundUrls(shareSettings)
  const backgrounds = configured.length ? configured : DEFAULT_COPY_PACK.shareBackgrounds.map((item) => item.imageUrl)
  if (!backgrounds.length) return DEFAULT_FALLBACK_COVER
  const key = String(stableKey || '').trim()
  if (!key) return backgrounds[Math.abs(Number(displayIndex) || 0) % backgrounds.length]
  let hash = 0
  for (const character of key) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
  return backgrounds[hash % backgrounds.length]
}

function prepareArticleSummary(item = {}, layout = 'mixed', displayIndex = 0, shareSettings = {}) {
  const source = item && typeof item === 'object' ? item : {}
  const cardLayout = resolveArticleLayout(layout, source.id, displayIndex)
  const coverCandidates = getImageCandidates(source.coverImage, cardLayout === 'stacked' ? 'medium' : 'thumb', [
    resolveFallbackCoverUrl(shareSettings, displayIndex, source.id), DEFAULT_FALLBACK_COVER,
  ])
  return {
    id: source.id,
    cardLayout,
    coverImage: source.coverImage || null,
    coverCandidates,
    coverUrl: coverCandidates[0] || '',
    title: String(source.title || '').trim(),
    author: String(source.author || '').trim(),
    likeCount: Number(source.likeCount) || 0,
    favoriteCount: Number(source.favoriteCount) || 0,
  }
}

module.exports = {
  getArticleCoverUrl,
  getShareBackgroundUrls,
  normalizeArticleLayout,
  normalizeArticleSortMode,
  prepareArticleSummary,
  resolveFallbackCoverUrl,
  resolveArticleLayout,
  sortArticleItems,
}
