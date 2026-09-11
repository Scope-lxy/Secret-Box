const {
  getArticleCoverUrl,
  normalizeArticleLayout,
  prepareArticleSummary,
  resolveFallbackCoverUrl,
} = require('./article-feed')
const { getMediaBoundaryFlags, isMediaOnlyHtml, sanitizeArticleHtml } = require('./article-content')
const { withInteractionDisplayCounts } = require('./format')

const PREVIEW_HEIGHTS = {
  earliest: 10,
  early: 20,
  medium: 30,
  late: 40,
  latest: 50,
}

function formatArticlePublishedAt(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

function resolvePreviewHeight(display = {}) {
  const preset = String(display.previewPreset || 'early')
  return PREVIEW_HEIGHTS[preset] || PREVIEW_HEIGHTS.early
}

function prepareArticleBodySegments(article = {}, unlockedToday = false) {
  if (!unlockedToday) return []
  if (Array.isArray(article.bodySegments) && article.bodySegments.length) {
    return article.bodySegments
      .filter((segment) => segment && (segment.type === 'middle-ad' || segment.type === 'html'))
      .map((segment) => {
        if (segment.type === 'middle-ad') {
          return { type: 'middle-ad', startsWithMedia: true, endsWithMedia: true }
        }
        const html = sanitizeArticleHtml(segment.html)
        return {
          type: 'html',
          html,
          mediaOnly: isMediaOnlyHtml(html),
          ...getMediaBoundaryFlags(html),
        }
      })
      .filter((segment) => segment.type === 'middle-ad' || segment.html)
  }
  const bodyHtml = sanitizeArticleHtml(article.bodyHtml)
  return bodyHtml ? [{
    type: 'html',
    html: bodyHtml,
    mediaOnly: isMediaOnlyHtml(bodyHtml),
    ...getMediaBoundaryFlags(bodyHtml),
  }] : []
}

function prepareDetailPayload(data = {}, layout = 'mixed', shareSettings = {}) {
  const article = data.article || {}
  const resolvedLayout = normalizeArticleLayout(data.articleDisplay?.layout || layout)
  const unlockedToday = data.unlockedToday === true || article.unlockedToday === true
  const bodyHtml = sanitizeArticleHtml(article.bodyHtml)
  const bodyMediaBoundaries = getMediaBoundaryFlags(bodyHtml)
  return {
    article: withInteractionDisplayCounts({
      ...article,
      bodyHtml,
      bodyMediaOnly: isMediaOnlyHtml(bodyHtml),
      bodyStartsWithMedia: bodyMediaBoundaries.startsWithMedia,
      bodyEndsWithMedia: bodyMediaBoundaries.endsWithMedia,
      bodySegments: prepareArticleBodySegments(article, unlockedToday),
      coverUrl: getArticleCoverUrl(article.coverImage) || resolveFallbackCoverUrl(shareSettings, 0, article.id),
      previewHtml: sanitizeArticleHtml(article.previewHtml),
      publishedAtText: formatArticlePublishedAt(article.publishedAt),
      title: String(article.title || '').trim(),
    }),
    recommendations: (data.recommendations || [])
      .filter((item) => String(item.id) !== String(article.id))
      .slice(0, 20)
      .map((item, index) => prepareArticleSummary(item, resolvedLayout, index, shareSettings)),
    unlockedToday,
  }
}

module.exports = {
  PREVIEW_HEIGHTS,
  formatArticlePublishedAt,
  prepareDetailPayload,
  resolvePreviewHeight,
}
