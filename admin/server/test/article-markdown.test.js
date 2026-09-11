const assert = require('node:assert/strict')
const test = require('node:test')

const {
  makeArticlePreviewHtml,
  renderArticleMarkdown,
  splitArticleHtmlForMiddleAd,
} = require('../src/modules/content/article-markdown')

test('Markdown reading mode renders the supported common syntax', () => {
  const rendered = renderArticleMarkdown(`# 标题

正文包含 **加粗**、*强调*、~~删除~~ 和 [链接](https://example.com)。

> 引用内容

- 列表一
- 列表二

---

\`行内代码\`

\`\`\`js
const answer = 42
\`\`\`

![图片](https://media.example.com/image.jpg)`)

  for (const tag of ['h1', 'strong', 'em', 's', 'a', 'blockquote', 'ul', 'hr', 'code', 'pre', 'img']) {
    assert.match(rendered, new RegExp(`<${tag}(?:[ >])`), tag)
  }
  assert.match(rendered, /<img[^>]+style="width:100%;max-width:100%;height:auto;display:block;object-fit:contain"/)
})

test('Markdown renderer escapes custom HTML and removes unsafe URL attributes', () => {
  const rendered = renderArticleMarkdown('<script>alert(1)</script>\n\n[危险](javascript:alert(2))\n\n![危险](javascript:alert(3))')
  assert.doesNotMatch(rendered, /<script|(?:href|src)="javascript:|onclick|onerror/i)
  assert.match(rendered, /&lt;script&gt;/)
})

test('article preview HTML is derived from Markdown without mutating the source', () => {
  const source = '第一段内容。\n\n第二段内容。\n\n第三段内容。'
  const preview = makeArticlePreviewHtml(source, 6)
  assert.match(preview, /第一段内容/)
  assert.doesNotMatch(preview, /第二段内容/)
  assert.equal(source, '第一段内容。\n\n第二段内容。\n\n第三段内容。')
})

test('middle article ad splits only at paragraph boundaries with conservative buffers', () => {
  const paragraph = '这是一段用于测试中段广告距离的正文。'.repeat(40)
  const segments = splitArticleHtmlForMiddleAd(renderArticleMarkdown(`${paragraph}\n\n${paragraph}\n\n${paragraph}`))
  assert.deepEqual(segments.map((segment) => segment.type), ['html', 'middle-ad', 'html'])
  assert.match(segments[0].html, /<p>[\s\S]*<\/p>$/)
  assert.match(segments[2].html, /^<p>/)

  const singleParagraph = splitArticleHtmlForMiddleAd(renderArticleMarkdown(paragraph.repeat(3)))
  assert.deepEqual(singleParagraph.map((segment) => segment.type), ['html'])

  const short = splitArticleHtmlForMiddleAd('短正文')
  assert.deepEqual(short.map((segment) => segment.type), ['html'])
})
