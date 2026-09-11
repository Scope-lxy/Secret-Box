const assert = require('node:assert/strict')
const test = require('node:test')

const { getMediaBoundaryFlags, sanitizeArticleHtml } = require('../utils/article-content')

test('article media boundaries detect images at either rich-text edge', () => {
  assert.deepEqual(getMediaBoundaryFlags('<p><img src="https://example.com/first.jpg"></p><p>正文</p>'), {
    startsWithMedia: true,
    endsWithMedia: false,
  })
  assert.deepEqual(getMediaBoundaryFlags('<p>正文</p><p><img src="https://example.com/last.jpg"></p>'), {
    startsWithMedia: false,
    endsWithMedia: true,
  })
  assert.deepEqual(getMediaBoundaryFlags('<p>正文</p><p><img src="https://example.com/last.jpg"></p><br>'), {
    startsWithMedia: false,
    endsWithMedia: true,
  })
})

test('article HTML keeps controlled reading tags and strips executable markup', () => {
  const html = sanitizeArticleHtml(`
    <script>alert(1)</script>
    <p class="foreign" onclick="alert(2)">正文<strong>重点</strong></p>
    <iframe src="https://example.com"></iframe>
  `)

  assert.equal(html.includes('<script'), false)
  assert.equal(html.includes('<iframe'), false)
  assert.equal(html.includes('onclick'), false)
  assert.equal(html.includes('class='), false)
  assert.match(html, /<p style="margin:0;">正文<strong>重点<\/strong><\/p>/)
})

test('article images require HTTPS and receive fixed responsive styling', () => {
  const html = sanitizeArticleHtml(`
    <img src="javascript:alert(1)" onerror="alert(2)">
    <img src="http://example.com/a.jpg">
    <img src="https://example.com/b.jpg" alt="封面">
  `)

  assert.equal(html.includes('javascript:'), false)
  assert.equal(html.includes('http://example.com'), false)
  assert.match(html, /src="https:\/\/example\.com\/b\.jpg"/)
  assert.match(html, /width:100%/)
  assert.match(html, /max-width:100%/)
  assert.match(html, /object-fit:contain/)
})

test('article images use the paragraph gap without adding outer or wrapper spacing', () => {
  const middle = sanitizeArticleHtml('<p>前一段</p><p><img src="https://example.com/middle.jpg"></p><p>后一段</p>')
  assert.match(middle, /<p style="margin:0;"><img[^>]*margin-top:var\(--article-content-gap\);margin-bottom:var\(--article-content-gap\);"><\/p>/)

  const first = sanitizeArticleHtml('<p><img src="https://example.com/first.jpg"></p><p>后一段</p>')
  assert.match(first, /<img[^>]*margin-top:0;margin-bottom:var\(--article-content-gap\);">/)

  const last = sanitizeArticleHtml('<p>前一段</p><p><img src="https://example.com/last.jpg"></p>')
  assert.match(last, /<img[^>]*margin-top:var\(--article-content-gap\);margin-bottom:0;">/)
})

test('text-only paragraphs receive one article reading gap without affecting media boundaries', () => {
  const html = sanitizeArticleHtml([
    '<p>第一段</p>',
    '<p>第二段<strong>重点</strong></p>',
    '<p><img src="https://example.com/photo.jpg"></p>',
    '<p>第三段</p>',
  ].join(''))

  assert.match(html, /<p style="margin:0;">第一段<\/p><p style="margin:var\(--article-content-gap\) 0 0;">第二段<strong>重点<\/strong><\/p>/)
  assert.match(html, /<\/p><p style="margin:0;"><img[^>]*margin-bottom:var\(--article-content-gap\);"><\/p><p style="margin:0;">第三段<\/p>/)
})

test('consecutive images use one base media gap for any run length', () => {
  const html = sanitizeArticleHtml([
    '<p>前一段</p>',
    '<p><img src="https://example.com/one.jpg"></p>',
    '<p><img src="https://example.com/two.jpg"></p>',
    '<p><img src="https://example.com/three.jpg"></p>',
    '<p>后一段</p>',
  ].join(''))

  const images = [...html.matchAll(/<img[^>]*>/g)].map((match) => match[0])
  assert.equal(images.length, 3)
  assert.match(images[0], /margin-top:var\(--article-content-gap\);margin-bottom:var\(--article-media-gap\);/)
  assert.match(images[1], /margin-top:0;margin-bottom:var\(--article-media-gap\);/)
  assert.match(images[2], /margin-top:0;margin-bottom:var\(--article-content-gap\);/)
})

test('article HTML preserves horizontal rules, code blocks, and strikethrough', () => {
  const html = sanitizeArticleHtml('<hr><pre><code class="language-js">const answer = 42</code></pre><p><s>旧内容</s><del>已删除</del></p>')

  assert.match(html, /<hr>/)
  assert.match(html, /<pre><code>const answer = 42<\/code><\/pre>/)
  assert.match(html, /<s>旧内容<\/s>/)
  assert.match(html, /<del>已删除<\/del>/)
  assert.doesNotMatch(html, /class=/)
})

test('article links keep HTTPS destinations and strip unsafe protocols', () => {
  const html = sanitizeArticleHtml(`
    <p><a href="https://example.com/read" title="继续阅读" onclick="alert(1)">安全链接</a></p>
    <p><a href="javascript:alert(2)">危险链接</a></p>
    <p><a href="http://example.com/plain">非 HTTPS 链接</a></p>
  `)

  assert.match(html, /<a href="https:\/\/example\.com\/read" title="继续阅读" rel="noopener noreferrer">安全链接<\/a>/)
  assert.match(html, /<a>危险链接<\/a>/)
  assert.match(html, /<a>非 HTTPS 链接<\/a>/)
  assert.doesNotMatch(html, /javascript:|http:\/\/|onclick/)
})
