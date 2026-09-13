const crypto = require('crypto')
const dns = require('dns').promises
const http = require('http')
const https = require('https')
const net = require('net')
const { JSDOM } = require('jsdom')
const { Readability } = require('@mozilla/readability')
const sanitizeHtml = require('sanitize-html')
const TurndownService = require('turndown')
const { getDatabase } = require('../../lib/state-database')
const { appendDeduplicatedContentItems, getDuplicateContentItemIndexes } = require('./content.store')
const { normalizeArticleMarkdown, renderArticleMarkdown } = require('./article-markdown')
const { addImageAsset, getImageIdsByProcessingMode, getImagesByIds, getImagesByOriginalSha256 } = require('../images/image.store')
const { reclaimImageAssets } = require('../images/image-reclamation.service')
const { getInternalAdminSettings } = require('../admin/admin-settings.store')
const { getPublicCosUrl, uploadBufferToCos, waitForCosObjectsReady } = require('../storage/cos.service')
const { DISPLAY_IMAGE_PROFILE, findReusableImage, getImageDisplayUrls, makePicOperations } = require('../images/image-policy')

const pageHosts = new Set(['mp.weixin.qq.com'])
const wechatUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.58 NetType/WIFI Language/zh_CN'
const maxPageBytes = 8 * 1024 * 1024
const maxImageBytes = 5 * 1024 * 1024
const importJobRetentionMs = 24 * 60 * 60 * 1000
const importJobCleanupIntervalMs = 60 * 60 * 1000
const smallBodyImageMaxEdge = 96
const boundaryBodyImageMinLongEdge = 400
const boundaryBodyImageAspectRatio = 5
const boundaryBodyImageMaxTextLength = 40
const boundaryRecommendationTitlePattern = /(?:推荐阅读|相关推荐|相关阅读|延伸阅读|往期(?:精选|回顾)|近期精选|更多精彩|精选推荐|热门文章|热文推荐|相关文章|猜你喜欢|你可能还喜欢|阅读推荐|推荐更多|更多(?:精彩|文章|内容|标题))/u
const activeJobIds = new Set()
let processingQueue = Promise.resolve()

class ArticleImportError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ArticleImportError'
    this.code = code
  }
}

function isAllowedHost(hostname, kind) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '')
  if (kind === 'image') return Boolean(host)
  return pageHosts.has(host)
}

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
  )
}

function isPublicIp(address) {
  const version = net.isIP(address)
  if (version === 4) return isPublicIpv4(address)
  if (version !== 6) return false
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized.startsWith('::ffff:')) return isPublicIpv4(normalized.slice(7))
  return normalized !== '::' && normalized !== '::1'
    && !normalized.startsWith('fc') && !normalized.startsWith('fd')
    && !/^fe[89ab]/.test(normalized)
    && !normalized.startsWith('ff')
}

function validateRemoteUrl(value, kind = 'page') {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch (error) {
    throw new ArticleImportError('INVALID_URL', '仅支持有效的 http(s) URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ArticleImportError('INVALID_URL', '仅支持不含账号信息的 http(s) URL')
  }
  if ((url.protocol === 'http:' && url.port && url.port !== '80') || (url.protocol === 'https:' && url.port && url.port !== '443')) {
    throw new ArticleImportError('UNSAFE_PORT', 'URL 使用了不允许的端口')
  }
  if (!isAllowedHost(url.hostname, kind)) {
    throw new ArticleImportError('HOST_NOT_ALLOWED', kind === 'page' ? '首版仅支持 mp.weixin.qq.com 文章链接' : '正文图片地址无效或不可访问')
  }
  return url
}

async function resolvePublicAddresses(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) {
    throw new ArticleImportError('SSRF_BLOCKED', '目标域名解析到非公网地址，已拒绝抓取')
  }
  return addresses
}

async function requestOnce(url, { kind, maxBytes, timeoutMs }) {
  const addresses = await resolvePublicAddresses(url.hostname)
  const selected = addresses[0]
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      headers: {
        accept: kind === 'page' ? 'text/html,application/xhtml+xml' : 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/gif,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9',
        'user-agent': wechatUserAgent,
      },
      lookup: (_hostname, options, callback) => {
        if (options?.all) return callback(null, [selected])
        callback(null, selected.address, selected.family)
      },
      servername: url.hostname,
    }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          request.destroy(new ArticleImportError('RESPONSE_TOO_LARGE', kind === 'page' ? '公众号页面超过 8MB 限制' : '正文图片超过 5MB 限制'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode || 0,
      }))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new ArticleImportError('FETCH_TIMEOUT', '抓取超时，请稍后重试')))
    request.on('error', reject)
    request.end()
  })
}

async function fetchSafeResource(value, { kind = 'page', maxRedirects = 5, timeoutMs = 12000 } = {}) {
  let current = validateRemoteUrl(value, kind)
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await requestOnce(current, {
      kind,
      maxBytes: kind === 'page' ? maxPageBytes : maxImageBytes,
      timeoutMs,
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === maxRedirects) throw new ArticleImportError('TOO_MANY_REDIRECTS', '重定向次数过多')
      const location = String(response.headers.location || '').trim()
      if (!location) throw new ArticleImportError('INVALID_REDIRECT', '重定向响应缺少目标地址')
      current = validateRemoteUrl(new URL(location, current).toString(), kind)
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ArticleImportError('HTTP_ERROR', `抓取失败：HTTP ${response.status}`)
    }
    const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (kind === 'page' && !['text/html', 'application/xhtml+xml'].includes(contentType)) {
      throw new ArticleImportError('INVALID_MIME', '目标响应不是 HTML 页面')
    }
    if (kind === 'image' && !contentType.startsWith('image/')) {
      throw new ArticleImportError('INVALID_MIME', '正文图片响应类型无效')
    }
    return { ...response, contentType, finalUrl: current.toString() }
  }
  throw new ArticleImportError('TOO_MANY_REDIRECTS', '重定向次数过多')
}

function sanitizeImportHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'strong', 'b', 'em', 'i', 's', 'del', 'ul', 'ol', 'li', 'img', 'a', 'hr', 'pre', 'code'],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href || '', title: attribs.title || '' } }),
    },
  }).trim()
}

const semanticBlockTags = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'HR',
])

const strongEndMarkerPattern = /^[\s"“”'‘’—–*\-]*(?:全文完|完|the\s+end|end)[\s"“”'‘’—–*\-]*[。.!！]?$/iu
const tailPatterns = [
  { category: '尾部栏目', score: 6, pattern: /^(?:推荐阅读|相关推荐|相关阅读|延伸阅读|往期精选|近期精选|往期回顾|更多精彩|精选推荐|热门文章|其他热文|热文推荐|相关文章|猜你喜欢|你可能还喜欢|阅读推荐|查看往期精选(?:内容)?|投稿指南|征稿启事|商务合作|联系我们|关注我们)[：:]?$/u },
  { category: '关注引导', score: 6, pattern: /^(?:关注我|关注我们)[，,、\s]*(?:发现更多|获取更多|查看更多|解锁更多)(?:精彩|内容|资讯|文章|动态)?[。.!！]?$/u },
  { category: '互动引导', score: 6, pattern: /(?:点赞.{0,12}(?:在看|转发|分享)|点(?:个|一下)?赞.{0,12}(?:在看|转发|分享)|(?:在看|转发).{0,12}(?:点赞|点个赞|分享)|(?:点亮|戳|点击).{0,12}(?:在看|爱心|大拇指)|一键三连|随手.{0,8}(?:点赞|点个赞|在看|转发)|(?:每个|每一个)赞和在看.{0,12}(?:喜欢|感谢|支持))/u },
  { category: '留言引导', score: 6, pattern: /^(?:(?:欢迎|请|记得|快来).{0,8}(?:留言|评论)|去留言|写留言|留言区见)[。！!]?$/u },
  { category: '关注引导', score: 6, pattern: /(?:(?:扫码|长按).{0,16}(?:二维码|识别|关注|添加|进群)|点击.{0,8}蓝字.{0,8}关注|搜索.{0,8}关注.{0,8}公众号)/u },
  { category: '一般引导', score: 4, pattern: /(?:(?:欢迎|请|记得|快来).{0,10}(?:关注|点赞|在看|转发|分享|留言|评论)|(?:星标|置顶).{0,8}公众号)/u },
  { category: '星标引导', score: 6, pattern: /(?:给我个|给我们个|帮忙点个|记得加个|设为|点个).{0,4}星标|星标一下/u },
  { category: '投稿合作', score: 5, pattern: /(?:投稿(?:邮箱|方式|须知)?|商务合作|品牌合作|广告合作|转载合作|合作(?:微信|联系)|联系我们|客服微信|加入.{0,6}(?:社群|读者群)|读者群|交流群|添加微信|加微信|欢迎爆料|(?:预定|预订|报名|购买|咨询).{0,12}(?:微信|电话|联系|二维码))/u },
  { category: '作者介绍', score: 2, pattern: /^(?:作者简介|关于作者|作者介绍|本文作者|作者[：:]|编辑[：:]|责编[：:]|排版[：:]|校对[：:]|来源[：:])/u },
  { category: '版权声明', score: 2, pattern: /^(?:免责声明|版权声明|版权归属|转载授权|转载须知|未经授权|侵权联系|声明[：:]|风险提示|仅供参考)/u },
  { category: '结束标记', score: 6, pattern: strongEndMarkerPattern },
  { category: '结束标记', score: 3, pattern: /^(?:感谢阅读|下次再见)[。.!！]?$/iu },
  { category: '阅读引导', score: 3, pattern: /^(?:点击|查看)?阅读原文[。！!]?$/u },
]

const strongContactPattern = /(?:投稿邮箱|投稿方式|商务合作|品牌合作|广告合作|合作微信|联系邮箱|添加微信|客服微信|微信号[：:]|进群|入群|社群)/u
const compliancePrefixPattern = /(?:免责声明|风险提示|不构成.{0,20}建议|仅供参考|版权归原作者)/u
const protectedTailPattern = /^(?:作者(?:简介|介绍|长期|系|为|是|[：:])|关于作者|本文作者|来源[：:]|编辑[：:]|责编[：:]|排版[：:]|校对[：:]|供稿[：:]|免责声明|风险提示|版权声明|版权归属|未经授权|侵权联系|声明[：:]|仅供参考|不构成.{0,20}建议)/u

// WeChat may put a short subscription prompt before the article body. Keep
// this intentionally narrow: a CTA phrase (or the fixed "订阅号消息" label)
// is required, and heading blocks are never treated as prompts.
const headMarketingPattern = /(?:点击|长按|扫码|请|欢迎|记得|别忘(?:了)?|先|将|设为|置顶).{0,24}(?:蓝字|星标|置顶|公众号|订阅号)(?:我们|本号|本公众号|该公众号)?|(?:订阅号消息|星标(?:本|该)?(?:公众号|我们|本号)|置顶(?:公众号|我们|本号)|公众号.{0,8}(?:关注|星标|置顶|蓝字))/u
const headSingleMarketingPattern = /^\s*(?:[【\[（(]\s*)?(?:请|欢迎|记得|点击|长按|扫码)?\s*(?:星标(?:我们|公众号|本号)?|订阅号?(?:消息)?|关注(?:我们|公众号|本号)?|蓝字(?:关注)?|置顶(?:我们|公众号|本号)?)\s*(?:[】\]）)]\s*)?[。.!！?？,，、~～…]*$/u

function unwrapContainer(element) {
  element.replaceWith(...element.childNodes)
}

function normalizeWechatBody(bodyNode, sourceUrl) {
  const document = bodyNode.ownerDocument
  const root = bodyNode.cloneNode(true)
  root.querySelectorAll('script,style,iframe,video,audio,object,embed,form,template,svg,canvas,table').forEach((element) => element.remove())
  root.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('data-src') || image.getAttribute('src') || ''
    try {
      if (source) image.setAttribute('src', new URL(source, sourceUrl).toString())
      else image.remove()
    } catch (_error) {
      image.remove()
    }
    image.removeAttribute('data-src')
  })
  ;[...root.querySelectorAll('section,div')].reverse().forEach((element) => {
    const hasDirectBlock = [...element.children].some((child) => semanticBlockTags.has(child.tagName))
    const hasContent = String(element.textContent || '').trim() || element.querySelector('img')
    if (!hasContent) {
      element.remove()
      return
    }
    if (hasDirectBlock) {
      unwrapContainer(element)
      return
    }
    const paragraph = document.createElement('p')
    paragraph.append(...element.childNodes)
    element.replaceWith(paragraph)
  })

  let paragraph = null
  ;[...root.childNodes].forEach((node) => {
    const isBlock = node.nodeType === 1 && semanticBlockTags.has(node.tagName)
    if (isBlock) {
      paragraph = null
      return
    }
    const meaningful = node.nodeType === 1 || String(node.textContent || '').trim()
    if (!meaningful) {
      node.remove()
      return
    }
    if (!paragraph) {
      paragraph = document.createElement('p')
      root.insertBefore(paragraph, node)
    }
    paragraph.append(node)
  })
  root.querySelectorAll('p').forEach((item) => {
    if (!String(item.textContent || '').trim() && !item.querySelector('img')) item.remove()
  })
  return root
}

function resolveWechatImageUrl(value, sourceUrl) {
  try {
    const url = new URL(String(value || '').trim(), sourceUrl)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch (_error) {
    return ''
  }
}

function normalizeBlockText(block) {
  return String(block.textContent || '').replace(/[\u200b-\u200f\ufeff]/gu, '').replace(/\s+/gu, ' ').trim()
}

function splitMixedComplianceBlocks(root) {
  ;[...root.querySelectorAll('p')].forEach((block) => {
    const text = normalizeBlockText(block)
    if (!compliancePrefixPattern.test(text) && !protectedTailPattern.test(text)) return
    const contact = text.match(strongContactPattern)
    if (!contact || contact.index <= 0) return
    const keptText = text.slice(0, contact.index).replace(/[；;，,\s]+$/u, '').trim()
    const removedText = text.slice(contact.index).trim()
    if (!keptText || !removedText) return
    const kept = root.ownerDocument.createElement('p')
    const removed = root.ownerDocument.createElement('p')
    kept.textContent = keptText
    removed.textContent = removedText
    block.replaceWith(kept, removed)
  })
}

function classifyTailBlock(block) {
  const text = normalizeBlockText(block)
  const links = block.querySelectorAll('a').length
  const images = block.querySelectorAll('img').length
  const categories = new Set()
  let score = 0
  for (const rule of tailPatterns) {
    if (!rule.pattern.test(text)) continue
    categories.add(rule.category)
    score += rule.score
  }
  const wechatLinks = [...block.querySelectorAll('a')].filter((link) => {
    try { return new URL(link.href).hostname === 'mp.weixin.qq.com' } catch (_error) { return false }
  }).length
  if (wechatLinks >= 2 && text.length <= 400) {
    categories.add('链接列表')
    score += wechatLinks >= 4 ? 4 : 3
  }
  const imageOnly = images > 0 && text.length <= 12
  const separator = block.tagName === 'HR'
  if (separator) score += 1
  if (strongContactPattern.test(text)) score += 2
  return { categories, imageOnly, links, score, separator, text, wechatLinks }
}

function classifyHeadBlock(block) {
  const text = normalizeBlockText(block)
  const links = block.querySelectorAll('a').length
  const images = block.querySelectorAll('img').length
  const imageOnly = images > 0 && text.length <= 12
  const isHeading = /^H[1-6]$/u.test(block.tagName)
  const comboPrompt = !isHeading && text.length > 0 && text.length <= 120 && headMarketingPattern.test(text)
  const singlePrompt = !isHeading && text.length > 0 && text.length <= 16 && headSingleMarketingPattern.test(text)
  return { comboPrompt, hasImage: images > 0, imageOnly, links, prompt: comboPrompt || singlePrompt, singlePrompt, text, isHeading }
}

function cleanWechatArticleHead(root) {
  const blocks = [...root.children]
  if (blocks.length < 2) return { removedRoot: null, removedBlockIndexes: [], details: { applied: false, categories: [], removedBlocks: 0 } }
  const classified = blocks.map(classifyHeadBlock)
  const limit = Math.min(blocks.length, 5)
  const firstTextIndex = classified.findIndex((item) => item.text.length > 0)
  let cutIndex = -1
  for (let index = 0; index < limit; index += 1) {
    const item = classified[index]
    const precedingStructure = index === firstTextIndex && classified
      .slice(0, index)
      .every((entry) => entry.imageOnly || (entry.links > 0 && entry.text.length <= 180))
    if (item.comboPrompt || (item.singlePrompt && precedingStructure)) {
      cutIndex = index
      break
    }
  }
  if (cutIndex < 0) return { removedRoot: null, removedBlockIndexes: [], details: { applied: false, categories: [], removedBlocks: 0 } }

  // A visual/link card immediately around the prompt confirms that this is a
  // subscription banner. The fixed WeChat "订阅号消息" label and explicit
  // click/star prompts are high-confidence enough to stand alone.
  const hasStructure = classified
    .slice(Math.max(0, cutIndex - 2), Math.min(blocks.length, cutIndex + 3))
    .some((item) => item.imageOnly || (item.hasImage && item.text.length <= 220) || (item.links > 0 && item.text.length <= 180))
  const highConfidencePrompt = headSingleMarketingPattern.test(classified[cutIndex].text)
    || /(?:订阅号消息|点击.{0,24}(?:蓝字|关注)|请.{0,24}(?:星标|置顶|蓝字|公众号|订阅号)|星标(?:本|该)?(?:公众号|我们|本号)|置顶(?:公众号|我们|本号)|关注(?:公众号|我们|本号)?|订阅号|公众号(?:请)?(?:关注|星标|置顶)|蓝字(?:关注)?)/u.test(classified[cutIndex].text)
  if (!hasStructure && !highConfidencePrompt) return { removedRoot: null, removedBlockIndexes: [], details: { applied: false, categories: [], removedBlocks: 0 } }

  const removedIndexes = new Set([cutIndex])
  // Include an ad image/link card directly before the prompt, and short
  // visual/link blocks directly after it. Never consume a normal paragraph.
  for (let steps = 1; steps <= 2 && cutIndex - steps >= 0; steps += 1) {
    const index = cutIndex - steps
    const item = classified[index]
    if (!item.imageOnly && !(item.hasImage && item.text.length <= 220) && !(item.links > 0 && item.text.length <= 180)) break
    removedIndexes.add(index)
  }
  for (let index = cutIndex + 1; index < Math.min(blocks.length, cutIndex + 4); index += 1) {
    const item = classified[index]
    if (item.imageOnly || (item.links > 0 && item.text.length <= 180) || item.prompt) removedIndexes.add(index)
    else break
  }
  const keptBlocks = blocks.filter((_block, index) => !removedIndexes.has(index) && (normalizeBlockText(_block) || _block.querySelector('img')))
  const keptText = keptBlocks.map(normalizeBlockText).join('')
  if (keptBlocks.length < 2 || keptText.length < 80) return { removedRoot: null, removedBlockIndexes: [], details: { applied: false, categories: [], removedBlocks: 0 } }

  const removedRoot = root.ownerDocument.createElement('div')
  blocks.filter((_block, index) => removedIndexes.has(index)).forEach((block) => removedRoot.append(block))
  return {
    removedRoot,
    removedBlockIndexes: [...removedIndexes],
    details: {
      applied: true,
      categories: ['头部引导'],
      removedBlocks: removedIndexes.size,
      summary: `已自动移除 ${removedIndexes.size} 个头部段落（头部引导）`,
    },
  }
}

function cleanWechatArticleTail(root) {
  const blocks = [...root.children]
  if (blocks.length < 2) return { cleanedRoot: root, removedRoot: null, removedBlockIndexes: [], details: { applied: false, categories: [], removedBlocks: 0 } }
  // Keep the normal tail window, but always inspect the final eight blocks so a
  // short recommendation section is not missed just because it starts early.
  const windowStart = Math.max(1, Math.min(Math.floor(blocks.length * 0.65), blocks.length - 8), blocks.length - 60)
  const classified = blocks.map(classifyTailBlock)
  let cutIndex = -1

  for (let index = windowStart; index < blocks.length; index += 1) {
    const first = classified[index]
    if (first.categories.has('结束标记') && index === blocks.length - 1) continue
    const seedWindow = classified.slice(index, Math.min(blocks.length, index + 4))
    const seedScore = seedWindow.reduce((sum, item) => sum + item.score, 0)
    const seedCategories = new Set(seedWindow.flatMap((item) => [...item.categories]))
    const isSeed = first.score >= 6 || (seedScore >= 9 && seedWindow.some((item) => item.score >= 4) && seedCategories.size >= 2)
    if (!isSeed || (blocks.length < 6 && first.score < 6)) continue
    const suffix = classified.slice(index)
    let narrativeBlockRun = 0
    let bodyResumed = false
    for (const item of suffix.slice(1)) {
      if (item.score <= 0 && item.wechatLinks <= 1 && item.text.length >= 40) narrativeBlockRun += 1
      else if (!item.imageOnly && !item.separator) narrativeBlockRun = 0
      if (narrativeBlockRun >= 2) {
        bodyResumed = true
        break
      }
    }
    if (!bodyResumed) {
      cutIndex = index
      break
    }
  }

  if (cutIndex < 0) return { cleanedRoot: root, removedRoot: null, removedBlockIndexes: [], details: { applied: false, categories: [], removedBlocks: 0 } }
  for (let steps = 0; steps < 2 && cutIndex > 0; steps += 1) {
    const previous = classified[cutIndex - 1]
    const absorbPrevious = previous.separator || previous.imageOnly
      || previous.categories.has('结束标记')
    if (!absorbPrevious) break
    cutIndex -= 1
  }
  const removedIndexes = new Set()
  let promotionSection = false
  let endMarkerSection = false
  let bridgeBudget = 0
  while (classified[cutIndex + bridgeBudget]?.imageOnly || classified[cutIndex + bridgeBudget]?.separator) {
    bridgeBudget += 1
  }
  for (let index = cutIndex; index < blocks.length; index += 1) {
    const item = classified[index]
    if (endMarkerSection) {
      removedIndexes.add(index)
      continue
    }
    const protectedBlock = protectedTailPattern.test(item.text) && !strongContactPattern.test(item.text)
    if (protectedBlock) {
      promotionSection = false
      bridgeBudget = 0
      continue
    }
    const explicitPromotion = item.score >= 3
    const linkedPromotion = promotionSection && (
      (item.wechatLinks >= 1 && item.text.length <= 400) || item.imageOnly
    )
    const sectionCopy = promotionSection && item.score <= 0 && item.text.length > 0 && item.text.length <= 400
    const bridge = bridgeBudget > 0 && (item.imageOnly || item.separator || !item.text)
    if (explicitPromotion || linkedPromotion || sectionCopy) {
      removedIndexes.add(index)
      endMarkerSection = strongEndMarkerPattern.test(item.text)
      promotionSection = explicitPromotion && item.categories.has('尾部栏目')
        ? true
        : promotionSection
      bridgeBudget = 2
    } else if (bridge) {
      removedIndexes.add(index)
      bridgeBudget -= 1
    } else {
      promotionSection = false
      bridgeBudget = 0
    }
  }

  const keptBlocks = blocks.filter((block, index) => !removedIndexes.has(index) && (normalizeBlockText(block) || block.querySelector('img')))
  const keptText = keptBlocks.map(normalizeBlockText).join('')
  if (!removedIndexes.size || keptBlocks.length < 2 || keptText.length < 80) {
    return { cleanedRoot: root, removedRoot: null, removedBlockIndexes: [], details: { applied: false, categories: [], removedBlocks: 0 } }
  }

  const removedRoot = root.ownerDocument.createElement('div')
  const removedBlocks = blocks.filter((_block, index) => removedIndexes.has(index))
  removedBlocks.forEach((block) => removedRoot.append(block))
  const categories = [...new Set(classified.filter((_item, index) => removedIndexes.has(index)).flatMap((item) => [...item.categories]))]
  return {
    cleanedRoot: root,
    removedRoot,
    removedBlockIndexes: [...removedIndexes],
    details: {
      applied: true,
      categories,
      removedBlocks: removedBlocks.length,
      summary: `已自动移除 ${removedBlocks.length} 个尾部段落${categories.length ? `（${categories.join('、')}）` : ''}`,
    },
  }
}

function createTurndownService() {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  })
  service.addRule('lineBreak', {
    filter: 'br',
    replacement: () => '  \n',
  })
  service.remove(['u', 'figure', 'figcaption'])
  return service
}

function htmlToMarkdown(value) {
  return normalizeArticleMarkdown(createTurndownService().turndown(sanitizeImportHtml(value)))
}

function splitWechatArticleHtml(value, sourceUrl = 'https://mp.weixin.qq.com/') {
  const dom = new JSDOM(`<body>${value}</body>`)
  const root = normalizeWechatBody(dom.window.document.body, sourceUrl)
  splitMixedComplianceBlocks(root)
  const originalHtml = root.innerHTML
  const originalBlocks = [...root.children]
  const head = cleanWechatArticleHead(root)
  const cleaned = cleanWechatArticleTail(root)
  const removedRoots = [head.removedRoot, cleaned.removedRoot].filter(Boolean)
  const removedBlocksList = removedRoots.flatMap((removed) => [...removed.children])
  const removedRoot = dom.window.document.createElement('div')
  removedBlocksList.forEach((block) => removedRoot.append(block))
  const removedBlockIndexes = [...new Set(
    removedBlocksList.map((block) => originalBlocks.indexOf(block)).filter((index) => index >= 0),
  )].sort((a, b) => a - b)
  const categories = [...new Set([...(head.details.categories || []), ...(cleaned.details.categories || [])])]
  const removedBlocks = removedBlockIndexes.length
  const tailCleanup = {
    applied: Boolean(head.details.applied || cleaned.details.applied),
    categories,
    removedBlocks,
    ...(removedBlocks ? { summary: `已自动移除 ${removedBlocks} 个段落${categories.length ? `（${categories.join('、')}）` : ''}` } : {}),
  }
  return {
    normalizedHtml: cleaned.cleanedRoot.innerHTML,
    originalHtml,
    removedTailHtml: removedRoot.innerHTML,
    removedBlockIndexes,
    tailCleanup,
  }
}

function convertWechatArticleHtmlToMarkdown(value, sourceUrl) {
  const split = splitWechatArticleHtml(value, sourceUrl)
  const bodyMarkdown = htmlToMarkdown(split.normalizedHtml)
  const removedTailMarkdown = htmlToMarkdown(split.removedTailHtml)
  return { bodyMarkdown, removedTailMarkdown, tailCleanup: split.tailCleanup }
}

function normalizePublishedAt(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw)
    const date = new Date(raw.length === 10 ? numeric * 1000 : numeric)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  const normalized = raw
    .replace(/[年./]/gu, '-')
    .replace(/月/gu, '-')
    .replace(/日/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function extractPublishedAt(document, html = '') {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="weibo:article:create_at"]',
    'meta[name="publish_time"]',
    'meta[property="publish_time"]',
    'meta[name="datePublished"]',
    'meta[itemprop="datePublished"]',
    '#publish_time',
    '[data-publish-time]',
    '[data-create-time]',
  ]
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    const value = element?.getAttribute('content')
      || element?.getAttribute('datetime')
      || element?.getAttribute('data-publish-time')
      || element?.getAttribute('data-create-time')
      || element?.textContent
    const publishedAt = normalizePublishedAt(value)
    if (publishedAt) return publishedAt
  }
  const source = String(html || '')
  const patterns = [
    /(?:^|[;,{\s])(?:ct|create_time|ori_create_time|oriCreateTime|publish_time|msg_time|datePublished)\s*[=:]\s*["']?(\d{10,13})["']?/iu,
    /(?:publish_time|create_time|ori_create_time|oriCreateTime|msg_time)\s*[=:]\s*["']([^"']+)["']/iu,
  ]
  for (const pattern of patterns) {
    const match = source.match(pattern)
    const publishedAt = normalizePublishedAt(match?.[1])
    if (publishedAt) return publishedAt
  }
  return ''
}

function extractAuthor(document) {
  const normalizeName = (value) => String(value || '').replace(/\s+/gu, ' ').trim()
  const readNodes = (selectors) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const name = normalizeName(element.getAttribute('content') || element.textContent)
        if (name) return name
      }
    }
    return ''
  }
  const readScripts = (pattern) => {
    for (const script of document.querySelectorAll('script')) {
      for (const match of script.textContent.matchAll(pattern)) {
        const name = normalizeName(match[2]
          .replace(/\\u([0-9a-f]{4})/giu, (_value, code) => String.fromCharCode(parseInt(code, 16)))
          .replace(/\\([\\"'])/gu, '$1'))
        if (name) return name
      }
    }
    return ''
  }

  // Exhaust account-name sources before falling back to the article byline.
  return readNodes(['#js_name', '.profile_nickname'])
    || readScripts(/(?:^|[;,{.\s])["']?(?:nickname|profile_nickname)["']?\s*[=:]\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/giu)
    || readNodes(['meta[name="author"]', 'meta[property="article:author"]', '#js_author_name', '#meta_content .rich_media_meta_text:not([id])'])
    || readScripts(/(?:^|[;,{.\s])["']?author["']?\s*[=:]\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/giu)
}

function parseWechatArticleHtml(html, sourceUrl) {
  const dom = new JSDOM(html, { url: sourceUrl })
  const document = dom.window.document
  const bodyNode = document.querySelector('#js_content')
  if (!bodyNode) {
    throw new ArticleImportError('ARTICLE_BODY_MISSING', '页面缺少公众号正文，可能是反爬占位页或文章已失效')
  }
  const readable = new Readability(document.cloneNode(true)).parse()
  const title = String(
    document.querySelector('meta[property="og:title"]')?.content
    || readable?.title
    || document.title,
  ).replace(/\s+/gu, ' ').trim()
  if (!title) throw new ArticleImportError('ARTICLE_TITLE_MISSING', '未能识别公众号文章标题')
  const normalizedBody = normalizeWechatBody(bodyNode, sourceUrl)
  const normalizedHtml = normalizedBody.innerHTML.trim()
  const textContent = String(bodyNode.textContent || '').replace(/\s+/gu, ' ').trim()
  if (!normalizedHtml || !textContent) throw new ArticleImportError('ARTICLE_BODY_EMPTY', '公众号文章正文为空')
  const coverSource = document.querySelector('meta[property="og:image"]')?.content
    || bodyNode.querySelector('img')?.getAttribute('data-src')
    || bodyNode.querySelector('img')?.getAttribute('src')
    || ''
  const coverUrl = resolveWechatImageUrl(coverSource, sourceUrl)
  const author = extractAuthor(document)
  const publishedAt = extractPublishedAt(document, html)
  if (!publishedAt) {
    throw new ArticleImportError('ARTICLE_PUBLISHED_AT_MISSING', '未能识别公众号原始发布时间，请确认文章有效后重新爬取')
  }
  return {
    normalizedHtml,
    coverUrl,
    author,
    publishedAt,
    title,
  }
}

function detectImageType(buffer, declaredType = '') {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: 'image/jpeg', extension: 'jpg' }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', extension: 'png' }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return { contentType: 'image/gif', extension: 'gif' }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { contentType: 'image/webp', extension: 'webp' }
  throw new ArticleImportError('INVALID_IMAGE', `不支持或伪造的图片格式：${declaredType || 'unknown'}`)
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return { width: 0, height: 0 }
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset++]
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 1 >= buffer.length) break
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame && segmentLength >= 7) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) }
    }
    offset += segmentLength
  }
  return { width: 0, height: 0 }
}

function readGifDimensions(buffer) {
  if (buffer.length < 10) return { width: 0, height: 0 }
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return { width: 0, height: 0 }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function readWebpDimensions(buffer) {
  if (buffer.length < 20) return { width: 0, height: 0 }
  const chunk = buffer.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16),
      height: 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16),
    }
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    const frame = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20)
    if (frame >= 0 && frame + 7 < buffer.length) {
      return { width: buffer.readUInt16LE(frame + 3) & 0x3fff, height: buffer.readUInt16LE(frame + 5) & 0x3fff }
    }
  }
  if (chunk === 'VP8L' && buffer.length >= 26 && buffer[21] === 0x2f) {
    const bits = buffer[22] | (buffer[23] << 8) | (buffer[24] << 16) | (buffer[25] << 24)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
  }
  return { width: 0, height: 0 }
}

function inspectImage(buffer, declaredType = '') {
  const imageType = detectImageType(buffer, declaredType)
  let dimensions = { width: 0, height: 0 }
  let animated = false
  if (imageType.contentType === 'image/jpeg') dimensions = readJpegDimensions(buffer)
  if (imageType.contentType === 'image/png') {
    dimensions = readPngDimensions(buffer)
    animated = buffer.includes(Buffer.from('acTL'))
  }
  if (imageType.contentType === 'image/gif') {
    dimensions = readGifDimensions(buffer)
    animated = true
  }
  if (imageType.contentType === 'image/webp') {
    dimensions = readWebpDimensions(buffer)
    animated = buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF'))
  }
  return { ...imageType, ...dimensions, animated }
}

function isBoundaryBodyImage(image) {
  let block = image
  while (block.parentElement && block.parentElement.tagName !== 'BODY') block = block.parentElement
  const body = block.parentElement
  if (!body) return false
  const blocks = [...body.children]
  const index = blocks.indexOf(block)
  if (index < 0) return false
  const isBoundaryBlock = (candidate) => {
    const text = String(candidate.textContent || '').replace(/\s+/gu, '').trim()
    if (text.length > boundaryBodyImageMaxTextLength) return false
    if (candidate.querySelector('img')) return true
    return boundaryRecommendationTitlePattern.test(text)
  }
  return (
    isBoundaryBlock(block)
    && blocks.slice(0, index).every(isBoundaryBlock)
  ) || (
    isBoundaryBlock(block)
    && blocks.slice(index + 1).every(isBoundaryBlock)
  )
}

function findAdjacentBoundaryRecommendationTitles(image) {
  let block = image
  while (block.parentElement && block.parentElement.tagName !== 'BODY') block = block.parentElement
  const body = block.parentElement
  if (!body) return []
  const blocks = [...body.children]
  const index = blocks.indexOf(block)
  if (index < 0) return []
  const titles = []
  for (const neighbor of [blocks[index - 1], blocks[index + 1]]) {
    if (!neighbor || neighbor.querySelector('img')) continue
    const text = normalizeBlockText(neighbor)
    if (text.length <= boundaryBodyImageMaxTextLength && boundaryRecommendationTitlePattern.test(text)) titles.push(neighbor)
  }
  return titles
}

function removeAdjacentBoundaryRecommendationTitle(image) {
  findAdjacentBoundaryRecommendationTitles(image).forEach((title) => title.remove())
}

function removeBoundaryRecommendationTitlesForSources(root, sources) {
  const sourceSet = new Set(sources || [])
  if (!sourceSet.size) return
  root.querySelectorAll('img').forEach((image) => {
    const source = String(image.getAttribute('src') || '').trim()
    if (sourceSet.has(source)) {
      findAdjacentBoundaryRecommendationTitles(image).forEach((title) => title.remove())
    }
  })
}

function getBodyImageFilterReason(image, boundary = false) {
  const width = Number(image.width) || 0
  const height = Number(image.height) || 0
  const maxEdge = Math.max(width, height)
  const minEdge = Math.min(width, height)
  // Only discard animations that fit the usual decorative sticker/banner profile.
  // Large animated illustrations or information panels remain available to readers.
  if (image.animated && (maxEdge <= 200 || (minEdge > 0 && minEdge <= 160 && maxEdge <= 800))) return 'animated'
  if (
    boundary
    && minEdge > 0
    && minEdge <= 160
    && maxEdge >= boundaryBodyImageMinLongEdge
    && maxEdge / minEdge >= boundaryBodyImageAspectRatio
  ) return 'boundary'
  return maxEdge > 0 && maxEdge <= smallBodyImageMaxEdge ? 'small' : ''
}

function getArticleObjectKey(hash, extension) {
  const prefix = String(getInternalAdminSettings().storage?.folderPrefix || 'secretbox').replace(/^\/+|\/+$/g, '') || 'secretbox'
  return `${prefix}/articles/imported/${hash}.${extension}`
}

async function prepareImage(sourceUrl, dependencies = {}) {
  const fetchResource = dependencies.fetchResource || fetchSafeResource
  const response = await fetchResource(sourceUrl, { kind: 'image' })
  const imageType = inspectImage(response.body, response.contentType)
  const hash = crypto.createHash('sha256').update(response.body).digest('hex')
  const key = getArticleObjectKey(hash, imageType.extension)
  return {
    contentType: imageType.contentType,
    extension: imageType.extension,
    hash,
    key,
    size: response.body.length,
    width: imageType.width,
    height: imageType.height,
    animated: imageType.animated,
    buffer: response.body,
  }
}

async function uploadPreparedImage(prepared, dependencies = {}, options = {}) {
  const upload = dependencies.uploadBuffer || uploadBufferToCos
  const isCover = options.cover === true
  const preserveBodySource = !isCover && shouldPreserveBodySource(prepared)
  const mediumKey = `${prepared.key}.${DISPLAY_IMAGE_PROFILE}.medium.jpg`
  const thumbKey = `${prepared.key}.${DISPLAY_IMAGE_PROFILE}.thumb.jpg`
  const storage = getInternalAdminSettings().storage || {}
  const operations = preserveBodySource ? null : makePicOperations({
    mediumKey, thumbKey, usage: 'article', bucket: storage.bucket,
  })
  await upload({ buffer: prepared.buffer, contentType: prepared.contentType, key: prepared.key, operations })
  if (operations) {
    const waitForReady = dependencies.waitForCosObjectsReady
      || (dependencies.uploadBuffer ? null : waitForCosObjectsReady)
    if (waitForReady) await waitForReady([mediumKey, thumbKey], dependencies.imageReadinessOptions)
  }
  return {
    ...prepared,
    url: getPublicCosUrl(getInternalAdminSettings().storage, prepared.key),
    mediumUrl: operations ? getPublicCosUrl(storage, mediumKey) : undefined,
    thumbUrl: operations ? getPublicCosUrl(storage, thumbKey) : undefined,
    processingProfile: operations ? DISPLAY_IMAGE_PROFILE : 'original-only',
  }
}

function shouldPreserveBodySource(prepared = {}) {
  return prepared.animated || prepared.contentType === 'image/gif'
    || (prepared.width > 0 && prepared.height > prepared.width * 3)
}

function registerImportedArticleImage(transferred, title, kind) {
  const existing = findReusableImage(getImagesByOriginalSha256([transferred.hash]), transferred.processingProfile)
  if (existing) return existing
  return addImageAsset({
    id: `article-${kind}-${transferred.processingProfile}-${transferred.hash.slice(0, 24)}`,
    label: title,
    mediumUrl: transferred.mediumUrl || transferred.url,
    originalName: `${kind}.${transferred.key.split('.').pop()}`,
    originalSha256: transferred.hash,
    originalSize: transferred.size,
    originalUrl: transferred.url,
    processingMode: 'article-import',
    processingProfile: transferred.processingProfile,
    status: 'ready',
    thumbUrl: transferred.thumbUrl || transferred.url,
    width: transferred.width,
    height: transferred.height,
    uploadedAt: new Date().toISOString(),
    usage: 'article',
  })
}

function toTransferredExistingImage(prepared, existing, { cover = false } = {}) {
  if (!existing) return null
  const preserveBodySource = !cover && shouldPreserveBodySource(prepared)
  if (preserveBodySource ? !(existing.status === 'ready' && existing.originalUrl) : !findReusableImage([existing])) return null
  const display = getImageDisplayUrls(existing)
  const original = String(existing.originalUrl || display.mediumUrl || display.thumbUrl || '').trim()
  return {
    ...prepared,
    url: original,
    mediumUrl: preserveBodySource ? original : display.mediumUrl,
    thumbUrl: preserveBodySource ? original : display.thumbUrl,
    processingProfile: existing.processingProfile,
  }
}

async function transferArticleImages(parsed, dependencies = {}) {
  const dom = new JSDOM(`<body>${parsed.normalizedHtml}</body>`)
  const images = [...dom.window.document.body.querySelectorAll('img')]
  const transferredByUrl = new Map()
  const preparedByUrl = new Map()
  const bodyImageAssetIds = new Set()
  const mediaWarnings = []
  const filteredCounts = { animated: 0, small: 0, boundary: 0 }
  const filteredBoundarySources = []
  for (const image of images) {
    const source = String(image.getAttribute('src') || '').trim()
    if (!source) {
      image.remove()
      continue
    }
    try {
      if (!preparedByUrl.has(source)) preparedByUrl.set(source, await prepareImage(source, dependencies))
      const prepared = preparedByUrl.get(source)
      const filterReason = getBodyImageFilterReason(prepared, isBoundaryBodyImage(image))
      if (filterReason) {
        if (filterReason === 'boundary') {
          filteredBoundarySources.push(source)
          removeAdjacentBoundaryRecommendationTitle(image)
        }
        image.remove()
        filteredCounts[filterReason] += 1
        continue
      }
      if (!transferredByUrl.has(source)) {
        const existing = getImagesByOriginalSha256([prepared.hash]).find((image) => toTransferredExistingImage(prepared, image))
        transferredByUrl.set(source, existing
          ? toTransferredExistingImage(prepared, existing)
          : await uploadPreparedImage(prepared, dependencies))
      }
      const transferred = transferredByUrl.get(source)
      const asset = registerImportedArticleImage(transferred, parsed.title, 'body')
      bodyImageAssetIds.add(asset.id)
      image.setAttribute('src', transferred.mediumUrl || transferred.url)
    } catch (error) {
      image.remove()
      mediaWarnings.push({
        type: 'body-image',
        message: `一张正文图片转存失败，已从文章中移除：${error.message || '图片不可用'}`,
      })
    }
  }
  let coverImage = null
  if (parsed.coverUrl) {
    try {
      const prepared = preparedByUrl.get(parsed.coverUrl) || await prepareImage(parsed.coverUrl, dependencies)
      const bodyTransfer = transferredByUrl.get(parsed.coverUrl)
      const cover = (bodyTransfer?.processingProfile === DISPLAY_IMAGE_PROFILE ? bodyTransfer : null)
        || toTransferredExistingImage(prepared, findReusableImage(getImagesByOriginalSha256([prepared.hash])), { cover: true })
        || await uploadPreparedImage(prepared, dependencies, { cover: true })
      const asset = registerImportedArticleImage(cover, parsed.title, 'cover')
      coverImage = { id: asset.id }
    } catch (error) {
      mediaWarnings.push({
        type: 'cover-image',
        message: `封面图片转存失败，文章将不显示封面：${error.message || '图片不可用'}`,
      })
    }
  }
  const filteredTotal = filteredCounts.animated + filteredCounts.small + filteredCounts.boundary
  if (filteredTotal) {
    const reasons = []
    if (filteredCounts.animated) reasons.push(`${filteredCounts.animated} 张动图`)
    if (filteredCounts.small) reasons.push(`${filteredCounts.small} 张超小图片（最长边 <= ${smallBodyImageMaxEdge}px）`)
    if (filteredCounts.boundary) reasons.push(`${filteredCounts.boundary} 张首尾极端比例图片`)
    mediaWarnings.push({
      type: 'body-image-filtered',
      count: filteredTotal,
      message: `已过滤 ${reasons.join('、')}，避免无效装饰图片进入正文。`,
    })
  }
  const normalizedHtml = dom.window.document.body.innerHTML.trim()
  return {
    normalizedHtml,
    bodyImageAssetIds: [...bodyImageAssetIds],
    coverImage,
    mediaWarnings,
    filteredBoundarySources,
    transferredUrls: Object.fromEntries([...transferredByUrl].map(([source, transferred]) => [
      source,
      transferred.mediumUrl || transferred.url,
    ])),
  }
}

function withDerivedImportPreviews(job) {
  if (!job) return job
  const coverIds = (job.items || []).map((item) => item.coverImage?.id).filter(Boolean)
  const covers = new Map(getImagesByIds(coverIds).map((image) => [image.id, image]))
  return {
    ...job,
    items: (job.items || []).map((item) => {
      const { _batchCleanupBase, ...publicItem } = item
      return {
        ...publicItem,
        coverImage: covers.get(item.coverImage?.id) || item.coverImage || null,
        renderedHtml: renderArticleMarkdown(item.bodyMarkdown),
        removedTailHtml: renderArticleMarkdown(item.removedTailMarkdown),
      }
    }),
  }
}

function saveJob(job) {
  getDatabase().prepare(`
    INSERT INTO article_import_jobs (job_id, pool_id, status, created_at, updated_at, item_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, item_json = excluded.item_json
  `).run(job.id, job.poolId, job.status, job.createdAt, job.updatedAt, JSON.stringify(job))
  return job
}

function readJob(jobId) {
  const row = getDatabase().prepare('SELECT item_json FROM article_import_jobs WHERE job_id = ?').get(String(jobId || '').trim())
  return row ? JSON.parse(row.item_json) : null
}

function getImportedArticleImageAssetIds() {
  if (activeJobIds.size) return []
  return getImageIdsByProcessingMode('article-import')
}

async function purgeExpiredImportJobs(now = Date.now(), dependencies = {}) {
  const cutoff = new Date(now - importJobRetentionMs).toISOString()
  const db = getDatabase()
  const expiredJobs = db.prepare('SELECT job_id, item_json FROM article_import_jobs WHERE updated_at < ?')
    .all(cutoff)
    .filter((row) => !activeJobIds.has(row.job_id))
  const expiredIds = expiredJobs.map((row) => row.job_id)
  // A document can also reference locally uploaded replacements, whose
  // processing mode differs from the remote article-image importer.
  const expiredAssetIds = expiredJobs.flatMap((row) => {
    try {
      return (JSON.parse(row.item_json).items || []).flatMap((item) => [item.coverImage?.id, ...(item.bodyImageAssetIds || [])]).filter(Boolean)
    } catch { return [] }
  })
  let changes = 0
  if (expiredIds.length) {
    const placeholders = expiredIds.map(() => '?').join(', ')
    changes = db.prepare(`DELETE FROM article_import_jobs WHERE job_id IN (${placeholders})`).run(...expiredIds).changes
  }
  const options = dependencies.deleteObject ? { deleteObject: dependencies.deleteObject } : {}
  await reclaimImageAssets([...expiredAssetIds, ...getImportedArticleImageAssetIds()], options)
  return changes
}

function getArticleImportJob(jobId) {
  void purgeExpiredImportJobs().catch(() => {})
  const job = readJob(jobId)
  if (job?.sourceType === 'document') return null
  if (!job || job.status !== 'processing' || activeJobIds.has(job.id)) return withDerivedImportPreviews(job)
  job.status = 'failed'
  job.updatedAt = new Date().toISOString()
  job.fatalError = {
    code: 'IMPORT_INTERRUPTED',
    message: '导入进程已中断，请重新创建任务后重试',
  }
  return withDerivedImportPreviews(saveJob(job))
}

function buildRestoredBodyMarkdown(split, transferredUrls, filteredBoundarySources = []) {
  const dom = new JSDOM(`<body>${split.originalHtml}</body>`)
  removeBoundaryRecommendationTitlesForSources(dom.window.document.body, filteredBoundarySources)
  const blocks = [...dom.window.document.body.children]
  for (const index of split.removedBlockIndexes || []) {
    blocks[index]?.querySelectorAll('img').forEach((image) => image.remove())
  }
  dom.window.document.body.querySelectorAll('img').forEach((image) => {
    const source = String(image.getAttribute('src') || '').trim()
    const transferred = transferredUrls[source]
    if (transferred) image.setAttribute('src', transferred)
    else image.remove()
  })
  return htmlToMarkdown(dom.window.document.body.innerHTML)
}

async function importOneArticle(sourceUrl, dependencies = {}) {
  const fetchResource = dependencies.fetchResource || fetchSafeResource
  const response = await fetchResource(sourceUrl, { kind: 'page' })
  const parsed = parseWechatArticleHtml(response.body.toString('utf8'), response.finalUrl)
  const split = splitWechatArticleHtml(parsed.normalizedHtml, response.finalUrl)
  const media = await transferArticleImages({
    ...parsed,
    normalizedHtml: split.normalizedHtml,
  }, dependencies)
  const removedTailDom = new JSDOM(`<body>${split.removedTailHtml}</body>`)
  const excludedTailImages = removedTailDom.window.document.body.querySelectorAll('img').length
  removedTailDom.window.document.body.querySelectorAll('img').forEach((image) => image.remove())
  const mediaWarnings = [
    ...media.mediaWarnings,
    ...(excludedTailImages ? [{ type: 'removed-tail-image', message: `自动清理的尾部包含 ${excludedTailImages} 张图片，未上传；恢复尾部时仅保留文字。` }] : []),
  ]
  const converted = {
    bodyMarkdown: htmlToMarkdown(media.normalizedHtml),
    removedTailMarkdown: htmlToMarkdown(removedTailDom.window.document.body.innerHTML),
    restoredBodyMarkdown: buildRestoredBodyMarkdown(split, media.transferredUrls, media.filteredBoundarySources),
    tailCleanup: split.tailCleanup,
  }
  if (!converted.bodyMarkdown) throw new ArticleImportError('ARTICLE_BODY_EMPTY', '公众号文章正文转换后为空')
  const canonicalUrl = new URL(response.finalUrl)
  canonicalUrl.hash = ''
  const sourceHash = crypto.createHash('sha256').update(canonicalUrl.toString()).digest('hex')
  return {
    id: `article-${sourceHash.slice(0, 24)}`,
    title: parsed.title,
    author: parsed.author,
    bodyMarkdown: converted.bodyMarkdown,
    bodyImageAssetIds: media.bodyImageAssetIds,
    removedTailMarkdown: converted.removedTailMarkdown,
    restoredBodyMarkdown: converted.restoredBodyMarkdown,
    tailCleanup: converted.tailCleanup,
    mediaWarnings,
    publishedAt: parsed.publishedAt,
    coverImage: media.coverImage,
    sourceUrl: canonicalUrl.toString(),
    sourceHash,
    likeCount: 0,
    favoriteCount: 0,
  }
}

function updateDuplicateFlags(job) {
  const duplicateIndexes = new Set(getDuplicateContentItemIndexes(job.poolId, 'articles', job.items))
  job.items = job.items.map((item, index) => ({ ...item, duplicate: duplicateIndexes.has(index) }))
}

function splitMarkdownBlocks(value) {
  return String(value || '').trim().split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean)
}

function normalizeBatchBlock(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
}

function removeBatchImagesFromRestoredBody(value, removedBlocks = []) {
  let blocks = splitMarkdownBlocks(value)
  for (const removed of removedBlocks) {
    if (!/!\[[^\]]*\]\(/u.test(removed)) continue
    const key = normalizeBatchBlock(removed)
    const index = blocks.findIndex((block) => normalizeBatchBlock(block) === key)
    if (index < 0) continue
    blocks[index] = blocks[index].replace(/!\[[^\]]*\]\([^)]*\)/gu, '').trim()
  }
  return blocks.filter(Boolean).join('\n\n')
}

function isBatchTemplateBlock(value) {
  const block = String(value || '').trim()
  if (!block) return false
  const text = block
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_#>-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const links = (block.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/gu) || []).length
  const hasImage = /!\[[^\]]*\]\(/u.test(block)
  return Boolean(
    /(?:本号导读|导读|推荐阅读|相关推荐|相关阅读|延伸阅读|往期精选|近期精选|更多精彩|精选推荐|热门文章|相关文章|猜你喜欢|你可能还喜欢|阅读原文|投稿|征稿|商务合作|联系我们|关注我们|扫码|长按|点赞|在看|转发|分享|留言|评论|星标|公众号)/u.test(text)
      || links >= 2
      || (hasImage && text.length <= 20),
  )
}

function applyBatchDuplicateBoundaryCleanup(items = []) {
  const entries = items.map((item) => ({
    item,
    blocks: splitMarkdownBlocks(item.bodyMarkdown),
  }))
  const findBoundaryCandidate = (blocks, position) => {
    if (position === 'head') {
      if (!isBatchTemplateBlock(blocks[0])) return null
      return { index: 0, key: normalizeBatchBlock(blocks[0]) }
    }
    for (let index = blocks.length - 1; index >= Math.max(0, blocks.length - 4); index -= 1) {
      if (!isBatchTemplateBlock(blocks[index])) continue
      const trailing = blocks.slice(index + 1)
      const isLightTrailing = trailing.every((block) => {
        const text = block.replace(/!\[[^\]]*\]\([^)]*\)/gu, '').replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1').trim()
        return text.length <= 400 && (/!\[[^\]]*\]\(/u.test(block) || /\[[^\]]+\]\(https?:\/\//u.test(block))
      })
      if (isLightTrailing) return { index, key: normalizeBatchBlock(blocks[index]) }
    }
    return null
  }
  const counts = (position) => {
    const map = new Map()
    entries.forEach(({ blocks }) => {
      const candidate = findBoundaryCandidate(blocks, position)
      if (candidate?.key) map.set(candidate.key, (map.get(candidate.key) || 0) + 1)
    })
    return map
  }
  const headCounts = counts('head')
  const tailCounts = counts('tail')
  const requiredFrequency = 3
  const changed = []
  entries.forEach(({ item, blocks }) => {
    if (blocks.length < 3) return
    const remove = new Set()
    const headCandidate = findBoundaryCandidate(blocks, 'head')
    if (headCandidate?.key && headCounts.get(headCandidate.key) >= requiredFrequency) {
      for (let index = 0; index <= headCandidate.index; index += 1) remove.add(index)
    }
    const tailCandidate = findBoundaryCandidate(blocks, 'tail')
    if (tailCandidate?.key && tailCounts.get(tailCandidate.key) >= requiredFrequency) {
      for (let index = tailCandidate.index; index < blocks.length; index += 1) remove.add(index)
    }
    if (!remove.size) return
    const kept = blocks.filter((_block, index) => !remove.has(index))
    const keptText = kept.join('').replace(/[`*_#>\-![\]()]/gu, '').replace(/\s+/gu, '').trim()
    if (kept.length < 2 || keptText.length < 80) return
    const removedBlocks = [...remove].sort((a, b) => a - b).map((index) => blocks[index])
    const removed = removedBlocks.join('\n\n')
    item.bodyMarkdown = kept.join('\n\n')
    item.restoredBodyMarkdown = removeBatchImagesFromRestoredBody(item.restoredBodyMarkdown, removedBlocks)
    if (Array.isArray(item.bodyImageAssetIds) && item.bodyImageAssetIds.length) {
      const images = getImagesByIds(item.bodyImageAssetIds)
      const retainedBody = item.bodyMarkdown
      item.bodyImageAssetIds = item.bodyImageAssetIds.filter((id) => {
        const asset = images.find((entry) => entry.id === id)
        if (!asset) return true
        return [asset.mediumUrl, asset.thumbUrl, asset.originalUrl].some((url) => url && retainedBody.includes(url))
      })
    }
    item.removedTailMarkdown = [String(item.removedTailMarkdown || '').trim(), removed].filter(Boolean).join('\n\n')
    const cleanup = item.tailCleanup && typeof item.tailCleanup === 'object'
      ? item.tailCleanup
      : { applied: false, categories: [], removedBlocks: 0 }
    item.tailCleanup = {
      ...cleanup,
      applied: true,
      categories: [...new Set([...(cleanup.categories || []), '批次重复模板'])],
      removedBlocks: Number(cleanup.removedBlocks || 0) + remove.size,
      summary: `已自动移除 ${Number(cleanup.removedBlocks || 0) + remove.size} 个尾部段落（${[...(new Set([...(cleanup.categories || []), '批次重复模板']))].join('、')}）`,
    }
    changed.push(item.id)
  })
  return changed
}

function cloneTailCleanup(value) {
  if (!value || typeof value !== 'object') return value
  return {
    ...value,
    categories: Array.isArray(value.categories) ? [...value.categories] : [],
  }
}

function resetAndApplyBatchDuplicateBoundaryCleanup(items = []) {
  items.forEach((item) => {
    if (!item._batchCleanupBase) {
      item._batchCleanupBase = {
        bodyMarkdown: item.bodyMarkdown,
        restoredBodyMarkdown: item.restoredBodyMarkdown,
        removedTailMarkdown: item.removedTailMarkdown,
        bodyImageAssetIds: Array.isArray(item.bodyImageAssetIds) ? [...item.bodyImageAssetIds] : [],
        tailCleanup: cloneTailCleanup(item.tailCleanup),
      }
    }
    const base = item._batchCleanupBase
    item.bodyMarkdown = base.bodyMarkdown
    item.restoredBodyMarkdown = base.restoredBodyMarkdown
    item.removedTailMarkdown = base.removedTailMarkdown
    item.bodyImageAssetIds = [...base.bodyImageAssetIds]
    item.tailCleanup = cloneTailCleanup(base.tailCleanup)
  })
  return applyBatchDuplicateBoundaryCleanup(items)
}

function updateImportProgress(job) {
  const entries = Array.isArray(job.entries) ? job.entries : []
  job.progress = {
    total: entries.length,
    processed: entries.filter((entry) => ['ready', 'failed'].includes(entry.status)).length,
    succeeded: entries.filter((entry) => entry.status === 'ready').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
  }
}

async function processArticleImportJob(jobId, dependencies = {}) {
  activeJobIds.add(jobId)
  let job = readJob(jobId)
  try {
    if (!job || job.status !== 'queued') return job
    job.status = 'processing'
    job.updatedAt = new Date().toISOString()
    saveJob(job)
    for (let index = 0; index < job.urls.length; index += 1) {
      const sourceUrl = job.urls[index]
      job.entries[index] = { url: sourceUrl, status: 'processing' }
      job.updatedAt = new Date().toISOString()
      saveJob(job)
      try {
        const item = await importOneArticle(sourceUrl, dependencies)
        job.items.push(item)
        job.progress.succeeded += 1
        job.entries[index] = { url: sourceUrl, status: 'ready', itemId: item.id }
      } catch (error) {
        const itemError = { url: sourceUrl, code: error.code || 'IMPORT_FAILED', message: error.message || '导入失败' }
        job.errors.push(itemError)
        job.progress.failed += 1
        job.entries[index] = { url: sourceUrl, status: 'failed', error: itemError }
      }
      job.progress.processed += 1
      updateDuplicateFlags(job)
      job.updatedAt = new Date().toISOString()
      saveJob(job)
    }
    resetAndApplyBatchDuplicateBoundaryCleanup(job.items)
    updateDuplicateFlags(job)
    job.status = job.items.length ? 'ready' : 'failed'
    job.updatedAt = new Date().toISOString()
    return saveJob(job)
  } catch (error) {
    job = job || readJob(jobId)
    if (!job) return null
    job.status = 'failed'
    job.updatedAt = new Date().toISOString()
    job.fatalError = { code: error.code || 'IMPORT_JOB_FAILED', message: error.message || '导入任务异常中断' }
    return saveJob(job)
  } finally {
    activeJobIds.delete(jobId)
  }
}

async function processArticleImportRetry(jobId, entryIndex, dependencies = {}) {
  let job = readJob(jobId)
  try {
    if (!job || job.status !== 'queued' || job.retryEntryIndex !== entryIndex) return job
    const sourceUrl = job.entries[entryIndex]?.url
    if (!sourceUrl) throw new ArticleImportError('RETRY_ENTRY_NOT_FOUND', '待重试文章不存在')
    job.status = 'processing'
    job.entries[entryIndex] = { url: sourceUrl, status: 'processing' }
    job.updatedAt = new Date().toISOString()
    saveJob(job)
    try {
      const item = await importOneArticle(sourceUrl, dependencies)
      job.items.push(item)
      job.entries[entryIndex] = { url: sourceUrl, status: 'ready', itemId: item.id }
    } catch (error) {
      const itemError = { url: sourceUrl, code: error.code || 'IMPORT_FAILED', message: error.message || '导入失败' }
      job.errors.push(itemError)
      job.entries[entryIndex] = { url: sourceUrl, status: 'failed', error: itemError }
    }
    updateImportProgress(job)
    resetAndApplyBatchDuplicateBoundaryCleanup(job.items)
    updateDuplicateFlags(job)
    delete job.retryEntryIndex
    job.status = job.items.length ? 'ready' : 'failed'
    job.updatedAt = new Date().toISOString()
    return saveJob(job)
  } catch (error) {
    job = job || readJob(jobId)
    if (!job) return null
    const sourceUrl = job.entries?.[entryIndex]?.url || ''
    const itemError = { url: sourceUrl, code: error.code || 'IMPORT_RETRY_FAILED', message: error.message || '单篇重试异常中断' }
    if (sourceUrl) {
      job.errors = (job.errors || []).filter((entry) => entry.url !== sourceUrl)
      job.errors.push(itemError)
      job.entries[entryIndex] = { url: sourceUrl, status: 'failed', error: itemError }
    }
    updateImportProgress(job)
    delete job.retryEntryIndex
    job.status = job.items?.length ? 'ready' : 'failed'
    job.updatedAt = new Date().toISOString()
    return saveJob(job)
  } finally {
    activeJobIds.delete(jobId)
  }
}

function enqueueArticleImportJob(jobId, dependencies = {}) {
  setImmediate(() => {
    processingQueue = processingQueue
      .catch(() => {})
      .then(() => processArticleImportJob(jobId, dependencies))
      .catch(() => {})
  })
}

function enqueueArticleImportRetry(jobId, entryIndex, dependencies = {}) {
  setImmediate(() => {
    processingQueue = processingQueue
      .catch(() => {})
      .then(() => processArticleImportRetry(jobId, entryIndex, dependencies))
      .catch(() => {})
  })
}

function createArticleImportJob({ poolId, urls }, dependencies = {}) {
  void purgeExpiredImportJobs(Date.now(), dependencies).catch(() => {})
  const sourceUrls = [...new Set((Array.isArray(urls) ? urls : []).map((item) => String(item || '').trim()).filter(Boolean))]
  if (!sourceUrls.length) throw new ArticleImportError('URLS_REQUIRED', '请至少提供一个公众号文章 URL')
  if (sourceUrls.length > 20) throw new ArticleImportError('TOO_MANY_URLS', '单次最多导入 20 个公众号文章 URL')
  sourceUrls.forEach((url) => validateRemoteUrl(url, 'page'))
  const now = new Date().toISOString()
  const job = saveJob({
    id: `article-import-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`,
    poolId: String(poolId || '').trim(),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    urls: sourceUrls,
    progress: { total: sourceUrls.length, processed: 0, succeeded: 0, failed: 0 },
    entries: sourceUrls.map((url) => ({ url, status: 'queued' })),
    items: [],
    errors: [],
  })
  enqueueArticleImportJob(job.id, dependencies)
  return job
}

function retryArticleImportEntry(jobId, sourceUrl, dependencies = {}) {
  const id = String(jobId || '').trim()
  const url = String(sourceUrl || '').trim()
  const job = readJob(id)
  if (!job) throw new ArticleImportError('JOB_NOT_FOUND', '导入任务不存在或已失效')
  if (job.sourceType === 'document') throw new ArticleImportError('INVALID_SOURCE_TYPE', '请从文档入口继续此任务')
  if (activeJobIds.has(id) || ['queued', 'processing'].includes(job.status)) {
    throw new ArticleImportError('JOB_BUSY', '当前导入任务仍在处理中，请稍后再试')
  }
  if (!['ready', 'failed'].includes(job.status)) {
    throw new ArticleImportError('JOB_NOT_RETRYABLE', '当前导入任务不可重试')
  }
  const entryIndex = (job.entries || []).findIndex((entry) => entry.url === url)
  if (entryIndex < 0 || job.entries[entryIndex].status !== 'failed') {
    throw new ArticleImportError('RETRY_ENTRY_NOT_FAILED', '只能重新抓取当前批次中失败的文章')
  }
  job.errors = (job.errors || []).filter((entry) => entry.url !== url)
  job.entries[entryIndex] = { url, status: 'queued' }
  job.status = 'queued'
  job.retryEntryIndex = entryIndex
  delete job.fatalError
  updateImportProgress(job)
  job.updatedAt = new Date().toISOString()
  saveJob(job)
  activeJobIds.add(id)
  enqueueArticleImportRetry(id, entryIndex, dependencies)
  return withDerivedImportPreviews(job)
}

async function publishArticleImportJob(jobId, selectedIds = [], restoreTailIds = [], dependencies = {}, editedItems) {
  const job = readJob(jobId)
  if (!job) throw new ArticleImportError('JOB_NOT_FOUND', '导入任务不存在或已失效')
  if (job.sourceType === 'document') throw new ArticleImportError('INVALID_SOURCE_TYPE', '请从文档入口确认导入')
  if (job.status !== 'ready') throw new ArticleImportError('JOB_NOT_READY', '导入任务当前不可发布')
  updateDuplicateFlags(job)
  job.updatedAt = new Date().toISOString()
  saveJob(job)
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((item) => String(item || '').trim()).filter(Boolean))
  if (selected.size) {
    const selectedItems = job.items.filter((item) => selected.has(item.id))
    if (selectedItems.length !== selected.size) throw new ArticleImportError('INVALID_SELECTION', '选中的文章不存在于当前导入任务')
    if (selectedItems.some((item) => item.duplicate)) throw new ArticleImportError('DUPLICATE_SELECTED', '选中的文章包含重复内容，无法发布')
  }
  const items = job.items.filter((item) => !item.duplicate && (!selected.size || selected.has(item.id)))
  if (!items.length) throw new ArticleImportError('NO_PUBLISHABLE_ITEMS', '没有可发布的新文章')
  const restored = new Set((Array.isArray(restoreTailIds) ? restoreTailIds : []).map((item) => String(item || '').trim()).filter(Boolean))
  if ([...restored].some((id) => !items.some((item) => item.id === id))) {
    throw new ArticleImportError('INVALID_RESTORE_SELECTION', '恢复尾部的文章不在本次发布范围内')
  }
  const edited = normalizeEditedItems(editedItems, items)
  const missingAuthor = items.find((item) => {
    const editedItem = edited.get(item.id)
    return !String((editedItem ? editedItem.author : item.author) || '').trim()
  })
  if (missingAuthor) throw new ArticleImportError('ARTICLE_AUTHOR_EMPTY', '文章作者不能为空，请编辑补充后再导入')
  const publishItems = items.map((item) => {
    const editedItem = edited.get(item.id)
    return {
      id: item.id,
      label: '默认',
      title: editedItem ? editedItem.title : item.title,
      bodyMarkdown: normalizeArticleMarkdown(editedItem?.bodyMarkdown
        || (restored.has(item.id) ? item.restoredBodyMarkdown : item.bodyMarkdown)),
      bodyImageAssetIds: item.bodyImageAssetIds,
      publishedAt: editedItem ? editedItem.publishedAt : item.publishedAt,
      coverImage: editedItem ? editedItem.coverImage : item.coverImage,
      sourceUrl: item.sourceUrl,
      sourceHash: item.sourceHash,
      author: editedItem ? editedItem.author : item.author,
      likeCount: item.likeCount,
      favoriteCount: item.favoriteCount,
    }
  })
  const coverIds = [...new Set(publishItems.map((item) => item.coverImage?.id).filter(Boolean))]
  const knownCoverIds = new Set(getImagesByIds(coverIds).map((item) => item.id))
  if (coverIds.some((id) => !knownCoverIds.has(id))) {
    throw new ArticleImportError('ARTICLE_COVER_MISSING', '文章封面素材不存在，请重新上传')
  }
  const result = appendDeduplicatedContentItems(job.poolId, 'articles', publishItems)
  const publishedJob = {
    id: job.id,
    poolId: job.poolId,
    status: 'published',
    publishedIds: items.map((item) => item.id),
    updatedAt: new Date().toISOString(),
  }
  getDatabase().prepare('DELETE FROM article_import_jobs WHERE job_id = ?').run(job.id)
  const options = dependencies.deleteObject ? { deleteObject: dependencies.deleteObject } : {}
  const cleanup = await reclaimImageAssets(getImportedArticleImageAssetIds(), options)
  return { job: publishedJob, cleanup, ...result }
}

function normalizeEditedItems(value, publishableItems) {
  if (value === undefined || value === null) return new Map()
  if (!Array.isArray(value)) throw new ArticleImportError('INVALID_EDITED_ITEMS', '编辑后的文章格式无效')
  const allowed = new Set(publishableItems.map((item) => item.id))
  const seen = new Set()
  const edited = new Map()
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ArticleImportError('INVALID_EDITED_ITEMS', '编辑后的文章格式无效')
    }
    const keys = Object.keys(entry).sort()
    if (!['bodyMarkdown,coverImage,id,publishedAt,title', 'author,bodyMarkdown,coverImage,id,publishedAt,title'].includes(keys.join(','))) {
      throw new ArticleImportError('INVALID_EDITED_ITEMS', '编辑内容仅允许包含文章 ID、标题、正文、作者、封面和发布时间')
    }
    const id = String(entry.id || '').trim()
    if (!id || !allowed.has(id)) {
      throw new ArticleImportError('INVALID_EDITED_SELECTION', '编辑的文章不在本次发布范围内')
    }
    if (seen.has(id)) throw new ArticleImportError('INVALID_EDITED_ITEMS', '同一文章不能重复编辑')
    seen.add(id)
    const title = String(entry.title || '').trim()
    const sourceItem = publishableItems.find((item) => item.id === id)
    const author = Object.hasOwn(entry, 'author') ? String(entry.author || '').trim() : String(sourceItem?.author || '').trim()
    const bodyMarkdown = normalizeArticleMarkdown(entry.bodyMarkdown)
    const publishedAtValue = typeof entry.publishedAt === 'string' ? entry.publishedAt.trim() : ''
    const publishedAtDate = new Date(publishedAtValue)
    const coverImage = entry.coverImage === null
      ? null
      : entry.coverImage && typeof entry.coverImage === 'object' && !Array.isArray(entry.coverImage)
        && Object.keys(entry.coverImage).join(',') === 'id' && String(entry.coverImage.id || '').trim()
        ? { id: String(entry.coverImage.id).trim() }
        : undefined
    if (!title) throw new ArticleImportError('ARTICLE_TITLE_EMPTY', '文章标题不能为空')
    if (!author) throw new ArticleImportError('ARTICLE_AUTHOR_EMPTY', '文章作者不能为空，请编辑补充后再导入')
    if (!bodyMarkdown) throw new ArticleImportError('ARTICLE_BODY_EMPTY', '文章正文不能为空')
    if (Number.isNaN(publishedAtDate.getTime())) throw new ArticleImportError('ARTICLE_PUBLISHED_AT_INVALID', '文章发布时间无效')
    if (coverImage === undefined) throw new ArticleImportError('ARTICLE_COVER_INVALID', '文章封面格式无效')
    edited.set(id, { title, author, bodyMarkdown, coverImage, publishedAt: publishedAtDate.toISOString() })
  })
  return edited
}

function startArticleImportJobCleanup() {
  setImmediate(() => { void purgeExpiredImportJobs().catch(() => {}) })
  const timer = setInterval(() => { void purgeExpiredImportJobs().catch(() => {}) }, importJobCleanupIntervalMs)
  timer.unref?.()
  return timer
}

startArticleImportJobCleanup()

module.exports = {
  activeJobIds,
  readJob,
  saveJob,
  prepareImage,
  registerImportedArticleImage,
  ArticleImportError,
  createArticleImportJob,
  fetchSafeResource,
  getArticleImportJob,
  importOneArticle,
  isPublicIp,
  parseWechatArticleHtml,
  purgeExpiredImportJobs,
  publishArticleImportJob,
  retryArticleImportEntry,
  normalizeEditedItems,
  cleanWechatArticleTail,
  cleanWechatArticleHead,
  convertWechatArticleHtmlToMarkdown,
  htmlToMarkdown,
  extractPublishedAt,
  extractAuthor,
  applyBatchDuplicateBoundaryCleanup,
  normalizeWechatBody,
  sanitizeImportHtml,
  startArticleImportJobCleanup,
  splitWechatArticleHtml,
  toTransferredExistingImage,
  transferArticleImages,
  uploadPreparedImage,
  validateRemoteUrl,
}
