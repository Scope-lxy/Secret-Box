const crypto = require('crypto')
const MarkdownIt = require('markdown-it')

const markdown = new MarkdownIt({ html: false })
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizedText = (value) => String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim()

function articleSource(value) {
  const raw = String(value || '').trim()
  if (!raw) return { sourceIdentity: '', canonicalSourceUrl: '' }
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('原文链接必须是有效的 http(s) 地址')
  url.hash = ''
  if (url.hostname === 'mp.weixin.qq.com' && /^\/s(?:\/|$)/.test(url.pathname)) {
    const biz = url.searchParams.get('__biz')
    const mid = url.searchParams.get('mid')
    const idx = url.searchParams.get('idx')
    if (biz && mid && idx) {
      return { sourceIdentity: 'wechat:' + [biz, mid, idx].join(':'), canonicalSourceUrl: 'https://mp.weixin.qq.com/s?' + new URLSearchParams({ __biz: biz, mid, idx }) }
    }
    if (/^\/s\/[^/]+$/.test(url.pathname)) {
      return { sourceIdentity: 'wechat:https://mp.weixin.qq.com' + url.pathname, canonicalSourceUrl: 'https://mp.weixin.qq.com' + url.pathname }
    }
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
  }
  url.searchParams.sort()
  return { sourceIdentity: 'url:' + url.toString(), canonicalSourceUrl: url.toString() }
}

function safeArticleSource(value) {
  try { return articleSource(value) } catch { return { sourceIdentity: '', canonicalSourceUrl: '' } }
}

function articleFingerprint(item = {}, cover = item.coverUrl || item.coverImage?.id || '') {
  return hash(JSON.stringify([
    normalizedText(item.title), normalizedText(item.author),
    String(item.bodyMarkdown || '').replace(/\r\n?/g, '\n').trim(), String(cover || ''),
  ]))
}

function articleTextFingerprint(item = {}) {
  const texts = []
  for (const token of markdown.parse(String(item.bodyMarkdown || ''), {})) {
    if (['fence', 'code_block'].includes(token.type)) texts.push(token.content)
    for (const child of token.children || []) {
      if (['text', 'code_inline'].includes(child.type)) texts.push(child.content)
    }
  }
  return hash(normalizedText(texts.join(' ')))
}

function articleDeduplicationKeys(item = {}) {
  const identity = safeArticleSource(item.sourceUrl).sourceIdentity
  return [
    identity && 'source:' + identity,
    item.sourceHash && 'legacy:' + item.sourceHash,
    item.importFingerprint && 'import:' + item.importFingerprint,
    'content:' + articleFingerprint(item),
  ].filter(Boolean)
}

module.exports = { articleSource, safeArticleSource, articleFingerprint, articleTextFingerprint, articleDeduplicationKeys, normalizedText }
