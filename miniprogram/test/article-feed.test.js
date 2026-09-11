const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  normalizeArticleSortMode,
  normalizeArticleLayout,
  getArticleCoverUrl,
  prepareArticleSummary,
  resolveArticleLayout,
  sortArticleItems,
} = require('../utils/article-feed')

test('article cover resolution tolerates null historical cover records', () => {
  assert.equal(getArticleCoverUrl(null), '')
  assert.equal(getArticleCoverUrl(undefined), '')
  assert.equal(getArticleCoverUrl({ mediumUrl: 'https://example.com/medium.jpg', thumbUrl: 'https://example.com/thumb.jpg' }), 'https://example.com/medium.jpg')
})

test('article sorting modes default to random and accept sequence', () => {
  assert.equal(normalizeArticleSortMode(), 'random')
  assert.equal(normalizeArticleSortMode('random'), 'random')
  assert.equal(normalizeArticleSortMode('sequence'), 'sequence')
  assert.equal(normalizeArticleSortMode('legacy-order'), 'random')
})

test('article sorting keeps server sequence order and random mode shuffles without mutation', () => {
  const items = [
    { id: 'inserted-later', publishedAt: '2026-07-01T08:00:00.000Z' },
    { id: 'inserted-earlier', publishedAt: '2026-08-01T08:00:00.000Z' },
    { id: 'inserted-undated' },
  ]
  assert.deepEqual(sortArticleItems(items, 'sequence').map((item) => item.id), ['inserted-later', 'inserted-earlier', 'inserted-undated'])
  assert.deepEqual(sortArticleItems(items, 'random', () => 0).map((item) => item.id), ['inserted-earlier', 'inserted-undated', 'inserted-later'])
  assert.deepEqual(items.map((item) => item.id), ['inserted-later', 'inserted-earlier', 'inserted-undated'])
})

test('the three configured layouts are accepted and removed values use mixed', () => {
  for (const layout of ['title-left', 'stacked', 'mixed']) {
    assert.equal(normalizeArticleLayout(layout), layout)
  }
  assert.equal(normalizeArticleLayout('legacy-layout'), 'mixed')
  assert.equal(normalizeArticleLayout('random'), 'mixed')
})

test('mixed layout follows a fixed five-card display cycle', () => {
  const layouts = Array.from({ length: 10 }, (_, index) => resolveArticleLayout('mixed', `article-${index}`, index))
  assert.deepEqual(layouts, ['stacked', 'title-left', 'title-left', 'title-left', 'title-left', 'stacked', 'title-left', 'title-left', 'title-left', 'title-left'])
})

test('article summaries use share backgrounds and local cover fallback', () => {
  const background = { private: { backgrounds: [{ enabled: true, imageUrl: 'https://example.com/share.jpg' }] } }
  assert.equal(prepareArticleSummary({ id: 'a-1', title: '无封面' }, 'mixed', 1, background).coverUrl, 'https://example.com/share.jpg')
  assert.equal(prepareArticleSummary({ id: 'a-2', title: '无配置' }, 'mixed', 2, {}).coverUrl, '/assets/images/share-1.jpg')
})

test('article summaries expose only presentation fields needed by the list', () => {
  const item = prepareArticleSummary({
    id: 'a-1',
    title: '  标题  ',
    author: '作者',
    likeCount: 12,
    favoriteCount: 3,
    excerpt: '不应出现在文章列表',
    publishedAt: '2026-09-03T00:00:00.000Z',
    coverImage: { mediumUrl: 'https://example.com/cover.jpg' },
  }, 'stacked')

  assert.equal(item.title, '标题')
  assert.equal(Object.hasOwn(item, 'excerpt'), false)
  assert.equal(Object.hasOwn(item, 'publishedAt'), false)
  assert.equal(item.coverUrl, 'https://example.com/cover.jpg')
  assert.equal(item.cardLayout, 'stacked')
  assert.equal(item.author, '作者')
  assert.equal(item.likeCount, 12)
  assert.equal(item.favoriteCount, 3)
})

test('article layout changes retain the cover asset and select the matching image version', () => {
  const coverImage = { thumbUrl: '/thumb.jpg', mediumUrl: '/medium.jpg', originalUrl: '/original.jpg' }
  const small = prepareArticleSummary({ id: 'a-1', coverImage }, 'title-left')
  const wide = prepareArticleSummary(small, 'stacked')
  assert.equal(small.coverUrl, '/thumb.jpg')
  assert.equal(wide.coverUrl, '/medium.jpg')
  assert.deepEqual(small.coverCandidates.slice(0, 3), ['/thumb.jpg', '/medium.jpg', '/original.jpg'])
  assert.deepEqual(wide.coverCandidates.slice(0, 3), ['/medium.jpg', '/thumb.jpg', '/original.jpg'])
  assert.deepEqual(wide.coverImage, coverImage)
})

test('side cards use a fixed square cover and stacked cards keep their wide ratio', () => {
  const css = fs.readFileSync(path.join(__dirname, '../pages/articles/articles.wxss'), 'utf8')
  assert.match(css, /\.article-card--title-left\s*\{[\s\S]*?grid-template-columns:/)
  assert.match(css, /\.article-card--title-left\s*\{[\s\S]*?var\(--article-side-card-size\)/)
  assert.doesNotMatch(css, /article-card--legacy-layout/)
  assert.match(css, /\.article-card-cover[\s\S]*?width:\s*var\(--article-side-card-size\)[\s\S]*?height:\s*var\(--article-side-card-size\)/)
  assert.match(css, /\.article-card--title-left \.article-card-copy[\s\S]*?justify-content:\s*space-between/)
  assert.match(css, /\.article-card--title-left \.article-card-title[\s\S]*?height:\s*var\(--article-side-title-height\)/)
  assert.match(css, /\.article-card--stacked \.article-card-media[\s\S]*?aspect-ratio:\s*2\.35\s*\/\s*1/)
  assert.match(css, /\.article-card-title[\s\S]*?-webkit-line-clamp:\s*2/)
  assert.match(css, /\.article-card-title[\s\S]*?font-size:\s*var\(--type-body\)[\s\S]*?font-weight:\s*400[\s\S]*?line-height:\s*var\(--line-height-content\)/)
  assert.doesNotMatch(css, /\.article-card--stacked \.article-card-title\s*\{/)
  assert.match(css, /\.article-card-media-gradient\s*\{[\s\S]*?linear-gradient/)

  const template = fs.readFileSync(path.join(__dirname, '../pages/articles/articles.wxml'), 'utf8')
  assert.match(template, /mode="aspectFill"/)
  assert.match(template, /article-card-meta--overlay/)
  assert.doesNotMatch(template, /action-heart\.svg|action-bookmark\.svg/)
  assert.match(template, /aria-label="点赞 \{\{item\.likeCount\}\}"/)
  assert.match(template, /aria-label="收藏 \{\{item\.favoriteCount\}\}"/)
  assert.match(template, />赞 \{\{item\.likeCount\}\}<\/text>/)
  assert.match(template, />藏 \{\{item\.favoriteCount\}\}<\/text>/)
  assert.match(template, /item\.cardLayout == 'title-left' \|\| !item\.coverUrl/)
  assert.match(template, /class="article-card-author">\{\{item\.author \|\| '轻读手记'\}\}<\/text>/)
})
