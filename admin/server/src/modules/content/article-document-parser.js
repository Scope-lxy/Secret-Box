const MarkdownIt = require('markdown-it')
const YAML = require('yaml')
const { articleSource, articleFingerprint } = require('./article-identity')

const parser = new MarkdownIt({ html: false, typographer: false })
// Collect even unsupported image destinations so they become explicit repair
// slots. The reading renderer keeps its own strict link validation.
const imageParser = new MarkdownIt({ html: false, typographer: false })
imageParser.validateLink = () => true
const originalImageRule = imageParser.inline.ruler.__rules__.find((rule) => rule.name === 'image').fn
imageParser.inline.ruler.at('image', (state, silent) => {
  const start = state.pos
  if (!originalImageRule(state, silent)) return false
  if (!silent && state.env.collectImages) {
    const token = state.tokens[state.tokens.length - 1]
    const labelEnd = state.md.helpers.parseLinkLabel(state, start + 1, false)
    let targetStart = labelEnd + 2
    let targetEnd = targetStart
    const inline = state.src[labelEnd + 1] === '('
    if (inline) {
      while (/\s/.test(state.src[targetStart] || '') && targetStart < state.src.length) targetStart++
      const destination = state.md.helpers.parseLinkDestination(state.src, targetStart, state.posMax)
      targetEnd = destination.pos
    }
    state.env.collectImages.push({
      start: state.env.offset + start, end: state.env.offset + state.pos,
      targetStart: state.env.offset + targetStart, targetEnd: state.env.offset + targetEnd,
      inline, label: state.src.slice(start + 2, labelEnd), url: token.attrGet('src') || '',
      title: token.attrGet('title') || '',
    })
  }
  return true
})

function collectMarkdownImages(value) {
  const source = String(value || '')
  const env = {}
  const tokens = imageParser.parse(source, env)
  const lines = source.split('\n')
  const offsets = [0]
  lines.forEach((line) => offsets.push(offsets[offsets.length - 1] + line.length + 1))
  const images = []
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.map) continue
    const [from, through] = token.map
    const start = offsets[from], end = Math.min(source.length, offsets[through])
    imageParser.inline.parse(source.slice(start, end), imageParser, { ...env, offset: start, collectImages: images }, [])
  }
  return images.sort((a, b) => a.start - b.start)
}

function replaceMarkdownImages(source, replacements) {
  let result = String(source || '')
  for (const { image, url } of [...replacements].sort((a, b) => b.image.start - a.image.start)) {
    if (url === null) result = result.slice(0, image.start) + result.slice(image.end)
    else if (image.inline) result = result.slice(0, image.targetStart) + '<' + url + '>' + result.slice(image.targetEnd)
    else {
      const title = image.title ? ' "' + image.title.replace(/["\\]/g, '\\$&') + '"' : ''
      result = result.slice(0, image.start) + '![' + image.label + '](<' + url + '>' + title + ')' + result.slice(image.end)
    }
  }
  return result
}

function parseDocumentDate(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const local = text.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日)?[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/u)
  if (local) {
    const [, y, m, d, h, min, sec = '0'] = local
    const date = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +sec))
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d
      || +h > 23 || +min > 59 || +sec > 59) return ''
    return new Date(date.getTime() - 8 * 3600000).toISOString()
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return ''
  const [year, month, day] = text.slice(0, 10).split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return ''
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function decodeDocument(buffer, name) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch (error) {
    if (!/\.txt$/i.test(name)) throw new Error('文件不是有效的 UTF-8 文本，请另存为 UTF-8 后重试')
    try { return new TextDecoder('gb18030', { fatal: true }).decode(buffer) }
    catch { throw new Error('无法识别 TXT 编码，请另存为 UTF-8 后重试') }
  }
}

function parseArticleDocument(text, name = '') {
  let source = String(text || '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').trim()
  if (source.includes('\0')) throw new Error('文件包含二进制内容，不能作为文章读取')
  const issues = [], warnings = []
  let legacy = {}, yaml = {}
  if (/^---\n/.test(source)) {
    const end = source.indexOf('\n---', 4)
    if (end > 0 && /^[ \t]*(?:\n|$)/.test(source.slice(end + 4))) {
      const candidate = source.slice(4, end)
      if (/^(?:title|author|publishedAt|sourceUrl|cover):/m.test(candidate)) {
        try {
          const doc = YAML.parseDocument(candidate, { schema: 'failsafe', uniqueKeys: true })
          if (doc.errors.length || doc.warnings.length) throw new Error('字段或标签无效')
          yaml = doc.toJS({ maxAliasCount: 0 })
          if (!yaml || typeof yaml !== 'object' || Array.isArray(yaml)
            || Object.values(yaml).some((value) => value !== null && typeof value !== 'string')) throw new Error('仅支持普通文本字段')
        } catch { issues.push({ field: 'metadata', message: 'YAML 资料格式损坏，请核对文章字段并确认资料已修复' }); yaml = {} }
        source = source.slice(end + 4).trimStart()
      }
    }
  }
  // Only boundary metadata is eligible; code fences and examples in the
  // middle of an article are ordinary content.
  const blockTokens = parser.parse(source, {})
  const protectedLines = new Set()
  blockTokens.filter((token) => ['fence', 'code_block'].includes(token.type)).forEach((token) => {
    for (let line = token.map[0]; line < token.map[1]; line++) protectedLines.add(line)
  })
  const legacyPattern = /(?:^|\n)<!-- article-capture:v1\n([\s\S]*?)\n-->\s*(?=\n|$)/g
  const metadataRanges = []
  for (const match of source.matchAll(legacyPattern)) {
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0)
    const line = source.slice(0, start).split('\n').length - 1
    if (protectedLines.has(line) || (start !== 0 && source.slice(match.index + match[0].length).trim())) continue
    try {
      const data = JSON.parse(match[1])
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid metadata')
      legacy = { ...legacy, ...data }
    } catch { issues.push({ field: 'metadata', message: '旧版资料格式损坏，请核对文章字段并确认资料已修复' }) }
    metadataRanges.push({ start: match.index, end: match.index + match[0].length })
  }
  for (const range of metadataRanges.reverse()) source = source.slice(0, range.start) + source.slice(range.end)
  source = source.trim()
  let sourceUrl = ''
  const footer = source.match(/(?:^|\n)---\n[ \t]*\n原文链接[：:][ \t]*(.*?)\s*$/u)
  if (footer) {
    const footerLine = source.slice(0, footer.index).split('\n').length - 1 + (footer[0].startsWith('\n') ? 1 : 0)
    const inCode = parser.parse(source, {}).some((token) => ['fence', 'code_block'].includes(token.type) && token.map[0] <= footerLine && token.map[1] > footerLine)
    if (!inCode && !footer[1].includes('\n')) {
      sourceUrl = footer[1].replace(/^<|>$/g, '').trim()
      source = source.slice(0, footer.index).trimEnd()
      if (!sourceUrl) issues.push({ field: 'sourceUrl', message: '原文链接为空，请修正或明确移除来源' })
    }
  }
  let coverUrl = '', title = '', author = '', publishedAt = ''
  const headImages = collectMarkdownImages(source)
  const firstImage = headImages[0]
  const headTokens = parser.parse(source, {})
  const headContent = (headTokens[1]?.children || []).filter((token) => token.type !== 'text' || token.content.trim())
  const standaloneImage = headContent.length === 1 && headContent[0].type === 'image'
  const linkedImage = headContent.map((token) => token.type).join(',') === 'link_open,image,link_close'
  if (firstImage && headTokens[0]?.type === 'paragraph_open' && (standaloneImage || linkedImage)
    && headTokens[3]?.type === 'heading_open' && headTokens[3].tag === 'h1') {
    coverUrl = firstImage.url
    source = source.split('\n').slice(headTokens[0].map[1]).join('\n').trimStart()
  }
  const heading = source.match(/^# ([^\n]+)(?:\n|$)/)
  if (heading) {
    title = parser.parseInline(heading[1], {})[0]?.children?.map((child) => child.content || '').join('') || heading[1]
    source = source.slice(heading[0].length).trimStart()
    const meta = source.match(/^([^\n]+?)[丨|｜]([^\n]*)(?:\n|$)/u)
    if (meta && (meta[0].includes('丨') || /^\s*\d{4}[-/年]/u.test(meta[2]))) {
      author = meta[1].trim()
      publishedAt = parseDocumentDate(meta[2])
      if (!publishedAt) issues.push({ field: 'publishedAt', message: '文首发布时间无效，请填写原始发布时间' })
      source = source.slice(meta[0].length).trimStart()
    }
  } else if (!/\.txt$/i.test(name)) {
    const tokens = parser.parse(source, {})
    const firstHeading = tokens.findIndex((token) => token.type === 'heading_open')
    if (firstHeading >= 0) {
      title = tokens[firstHeading + 1]?.content || ''
      warnings.push('文章标题取自正文首个标题，正文保留原样；请核对文章头')
    }
  }
  title = title || String(yaml.title || legacy.title || '').trim()
  author = author || String(yaml.author || legacy.account || legacy.author || '').trim()
  if (!issues.some((issue) => issue.field === 'publishedAt')) publishedAt = publishedAt || parseDocumentDate(yaml.publishedAt || legacy.published_at)
  sourceUrl = sourceUrl || String(yaml.sourceUrl || legacy.source_url || '').trim()
  coverUrl = coverUrl || String(yaml.cover || legacy.cover_url || '').trim()
  if (!title) {
    title = name.split(/[\\/]/).pop().replace(/\.(?:md|markdown|txt)$/i, '')
    issues.push({ field: 'title', message: '暂用文件名作为标题，请核对后保存' })
  }
  if (!author) issues.push({ field: 'author', message: '缺少账号 / 作者' })
  if (!publishedAt) issues.push({ field: 'publishedAt', message: '缺少有效的原始发布时间' })
  if (!source.trim()) issues.push({ field: 'bodyMarkdown', message: '文章正文为空' })
  let identity = { sourceIdentity: '', canonicalSourceUrl: '' }
  try { identity = articleSource(sourceUrl) } catch { issues.push({ field: 'sourceUrl', message: '原文链接无效，请修正或明确移除来源' }) }
  if (/^<!-- article-capture:v1/m.test(source)) issues.push({ field: 'metadata', message: '资料区未完整闭合，请在编辑器中修复' })
  if (/^\[\^[^\]]+\]:|^\$\$|<iframe\b|<video\b/im.test(source)) warnings.push('文档含脚注、公式或嵌入媒体，请检查预览；首版仅支持标准 Markdown 和简单表格')
  const result = { title, author, publishedAt, sourceUrl, ...identity, coverUrl, bodyMarkdown: source.trim(), issues, warnings }
  return { ...result, importFingerprint: articleFingerprint(result, coverUrl) }
}

module.exports = { collectMarkdownImages, replaceMarkdownImages, parseArticleDocument, parseDocumentDate, decodeDocument }
