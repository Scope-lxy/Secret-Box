const MarkdownIt = require('markdown-it')
const sanitizeHtml = require('sanitize-html')
const { JSDOM } = require('jsdom')

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: false,
  typographer: false,
})

const allowedTags = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'strong', 'em', 's', 'del', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'pre', 'code',
]

const MIDDLE_AD_MIN_TEXT_LENGTH = 800
const MIDDLE_AD_MIN_SIDE_TEXT_LENGTH = 320

function normalizeArticleMarkdown(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sanitizeRenderedArticleHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      img: ['src', 'alt', 'title', 'style'],
      code: ['class'],
    },
    allowedClasses: {
      code: [/^language-[a-z0-9_-]+$/i],
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...(attribs.href ? { href: attribs.href } : {}),
          ...(attribs.title ? { title: attribs.title } : {}),
          rel: 'noopener noreferrer',
        },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...(attribs.src ? { src: attribs.src } : {}),
          ...(attribs.alt ? { alt: attribs.alt } : {}),
          ...(attribs.title ? { title: attribs.title } : {}),
          style: 'width:100%;max-width:100%;height:auto;display:block;object-fit:contain;',
        },
      }),
    },
  }).trim()
}

function renderArticleMarkdown(value) {
  return sanitizeRenderedArticleHtml(markdown.render(normalizeArticleMarkdown(value)))
}

function makeArticlePreviewHtml(value, maxTextLength = 320) {
  const renderedHtml = renderArticleMarkdown(value)
  const dom = new JSDOM(`<body>${renderedHtml}</body>`)
  const output = []
  let textLength = 0
  for (const child of dom.window.document.body.children) {
    output.push(child.outerHTML)
    textLength += String(child.textContent || '').trim().length
    if (textLength >= maxTextLength) break
  }
  return sanitizeRenderedArticleHtml(output.join(''))
}

// Keep one middle ad far from both ends. The conservative text buffer avoids
// placing it beside the start/end ad when rich-text block heights vary.
function splitArticleHtmlForMiddleAd(value, options = {}) {
  const renderedHtml = sanitizeRenderedArticleHtml(value)
  if (!renderedHtml) return []

  const dom = new JSDOM(`<body>${renderedHtml}</body>`)
  const blocks = Array.from(dom.window.document.body.children)
  const textLengths = blocks.map((block) => String(block.textContent || '').trim().length)
  const totalTextLength = textLengths.reduce((sum, length) => sum + length, 0)
  const minTextLength = Math.max(1, Number(options.minTextLength) || MIDDLE_AD_MIN_TEXT_LENGTH)
  const minSideTextLength = Math.max(1, Number(options.minSideTextLength) || MIDDLE_AD_MIN_SIDE_TEXT_LENGTH)
  if (totalTextLength < minTextLength || blocks.length < 2) {
    return [{ type: 'html', html: renderedHtml }]
  }

  let bestSplit = null
  let beforeTextLength = 0
  for (let index = 1; index < blocks.length; index += 1) {
    beforeTextLength += textLengths[index - 1]
    const afterTextLength = totalTextLength - beforeTextLength
    if (beforeTextLength < minSideTextLength || afterTextLength < minSideTextLength) continue
    const distanceFromMiddle = Math.abs(beforeTextLength - totalTextLength / 2)
    if (!bestSplit || distanceFromMiddle < bestSplit.distanceFromMiddle) {
      bestSplit = { index, distanceFromMiddle }
    }
  }
  if (!bestSplit) return [{ type: 'html', html: renderedHtml }]

  const beforeHtml = blocks.slice(0, bestSplit.index).map((block) => block.outerHTML).join('')
  const afterHtml = blocks.slice(bestSplit.index).map((block) => block.outerHTML).join('')
  return [
    { type: 'html', html: beforeHtml },
    { type: 'middle-ad' },
    { type: 'html', html: afterHtml },
  ]
}

function hasReadableArticleContent(value) {
  const html = renderArticleMarkdown(value)
  if (!html) return false
  const dom = new JSDOM(`<body>${html}</body>`)
  return Boolean(
    String(dom.window.document.body.textContent || '').trim()
    || dom.window.document.body.querySelector('img'),
  )
}

module.exports = {
  hasReadableArticleContent,
  makeArticlePreviewHtml,
  normalizeArticleMarkdown,
  renderArticleMarkdown,
  sanitizeRenderedArticleHtml,
  splitArticleHtmlForMiddleAd,
}
