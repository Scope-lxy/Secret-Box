const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'code',
  's', 'del', 'section', 'span', 'strong', 'u', 'ul',
])
const BLOCKED_CONTENT = /<(script|style|iframe|object|embed|form|template|svg|math)[^>]*>[\s\S]*?<\/\1\s*>/gi
const HTML_TAG = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g
const ATTRIBUTE = /([a-zA-Z0-9:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unwrapAttribute(value) {
  const text = String(value || '')
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  return text
}

function sanitizeImageAttributes(source) {
  const attributes = {}
  let match
  ATTRIBUTE.lastIndex = 0
  while ((match = ATTRIBUTE.exec(source))) {
    const name = match[1].toLowerCase()
    if (!['src', 'alt'].includes(name)) continue
    attributes[name] = unwrapAttribute(match[2])
  }
  const src = String(attributes.src || '').trim()
  if (!/^https:\/\//i.test(src)) return ''
  const alt = attributes.alt ? ` alt="${escapeAttribute(attributes.alt)}"` : ''
  return `<img src="${escapeAttribute(src)}"${alt} style="width:100%;max-width:100%;height:auto;display:block;object-fit:contain;">`
}

function sanitizeLinkAttributes(source) {
  const attributes = {}
  let match
  ATTRIBUTE.lastIndex = 0
  while ((match = ATTRIBUTE.exec(source))) {
    const name = match[1].toLowerCase()
    if (!['href', 'title'].includes(name)) continue
    attributes[name] = unwrapAttribute(match[2])
  }
  const href = String(attributes.href || '').trim()
  if (!/^https:\/\//i.test(href)) return '<a>'
  const title = attributes.title ? ` title="${escapeAttribute(attributes.title)}"` : ''
  return `<a href="${escapeAttribute(href)}"${title} rel="noopener noreferrer">`
}

function hasRenderableContent(value) {
  const html = String(value || '')
  return Boolean(html.replace(/<[^>]*>/g, '').trim() || /<(img|hr)\b/i.test(html))
}

function hasOnlyImageSeparators(value) {
  const html = String(value || '')
    .replace(/<img\b[^>]*>/gi, '')
  if (/<hr\b/i.test(html)) return false
  return html.replace(/<[^>]*>/g, '').trim() === ''
}

function isMediaOnlyHtml(value) {
  const source = String(value || '')
  const withoutMedia = source
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<hr\b[^>]*>/gi, '')
  return withoutMedia.replace(/<[^>]*>/g, '').trim() === ''
    && /<(img|hr)\b/i.test(source)
}

// Determine whether the first/last visible node in a rich-text fragment is media.
// Wrapper tags and whitespace separators do not affect the boundary.
function hasMediaAtBoundary(value, fromStart = true) {
  const tokens = String(value || '').match(/<[^>]*>|[^<]+/g) || []
  const ordered = fromStart ? tokens : [...tokens].reverse()
  for (const token of ordered) {
    if (token.startsWith('<')) {
      if (/^<\/?\s*(img|hr)\b/i.test(token)) return true
      continue
    }
    if (token.trim()) return false
  }
  return false
}

function getMediaBoundaryFlags(value) {
  return {
    startsWithMedia: hasMediaAtBoundary(value, true),
    endsWithMedia: hasMediaAtBoundary(value, false),
  }
}

function addImageSpacing(html) {
  const source = String(html || '')
  const images = []
  const imagePattern = /<img\b[^>]*>/gi
  let imageMatch
  while ((imageMatch = imagePattern.exec(source))) {
    images.push({ start: imageMatch.index, end: imageMatch.index + imageMatch[0].length })
  }

  let imageIndex = 0
  const spaced = source.replace(imagePattern, (image, offset) => {
    const index = imageIndex
    imageIndex += 1
    const previous = images[index - 1]
    const next = images[index + 1]
    const followsImage = previous && hasOnlyImageSeparators(source.slice(previous.end, offset))
    const precedesImage = next && hasOnlyImageSeparators(source.slice(offset + image.length, next.start))
    const marginTop = followsImage
      ? '0'
      : (hasRenderableContent(source.slice(0, offset))
        ? 'var(--article-content-gap)'
        : '0')
    const marginBottom = precedesImage
      ? 'var(--article-media-gap)'
      : (hasRenderableContent(source.slice(offset + image.length))
        ? 'var(--article-content-gap)'
        : '0')
    return image.replace('object-fit:contain;', `object-fit:contain;margin-top:${marginTop};margin-bottom:${marginBottom};`)
  })
  return spaced.replace(/<p>\s*((?:<img\b[^>]*>\s*)+)<\/p>/gi, '<p style="margin:0;">$1</p>')
}

// rich-text renders all paragraphs inside one node, so add spacing only when
// two adjacent paragraphs are both text-only. Media paragraphs already carry
// their own boundary spacing through the image styles above.
function addTextParagraphSpacing(html) {
  let previousTextOnly = false
  return String(html || '').replace(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi, (full, inner) => {
    const hasMedia = /<(?:img|hr)\b/i.test(inner)
    const textOnly = !hasMedia && Boolean(inner.replace(/<[^>]*>/g, '').trim())
    const style = previousTextOnly && textOnly
      ? 'margin:var(--article-content-gap) 0 0;'
      : 'margin:0;'
    previousTextOnly = textOnly
    return `<p style="${style}">${inner}</p>`
  })
}

function sanitizeArticleHtml(value) {
  const html = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(BLOCKED_CONTENT, '')
  const sanitized = html.replace(HTML_TAG, (full, rawTag) => {
    const tag = rawTag.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (full.startsWith('</')) return tag === 'img' || tag === 'br' ? '' : `</${tag}>`
    if (tag === 'img') return sanitizeImageAttributes(full)
    if (tag === 'a') return sanitizeLinkAttributes(full)
    if (tag === 'br') return '<br>'
    return `<${tag}>`
  })
  return addTextParagraphSpacing(addImageSpacing(sanitized))
}

module.exports = {
  getMediaBoundaryFlags,
  isMediaOnlyHtml,
  sanitizeArticleHtml,
}
