const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-articles-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp-articles',
  contentPools: [{ id: 'pool-articles', name: '文章池' }],
  miniPrograms: [{
    id: 'mp-articles',
    name: '文章小程序',
    appId: 'wx1111111111111111',
    status: 'active',
    config: { contentPoolId: 'pool-articles', dataMode: 'shared' },
  }],
})
const { appendContentItems, updateArticles } = require('../src/modules/content/content.store')
const { addImageAsset } = require('../src/modules/images/image.store')
const { updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { deleteAdminContentItem, getAdminContent, getArticleDetail, getArticleRecommendations, getArticles, unlockArticle, updateAdminContentItem } = require('../src/modules/content/content.service')
const { recordOpened, setReaction } = require('../src/modules/interactions/interaction.store')
const contentStoreSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/content/content.store.js'), 'utf8')

const context = {
  accountId: 'account-articles',
  authenticated: true,
  miniProgramId: 'mp-articles',
  visitorId: 'visitor-articles',
}

addImageAsset({
  id: 'cover-before-edit',
  label: '编辑前封面',
  mediumUrl: 'https://assets.example.test/cover-medium.jpg',
  status: 'ready',
  thumbUrl: 'https://assets.example.test/cover-thumb.jpg',
  usage: 'article',
})

const articles = Array.from({ length: 22 }, (_, index) => ({
  id: `article-${String(index + 1).padStart(2, '0')}`,
  title: `文章 ${index + 1}`,
  bodyMarkdown: `完整正文 ${index + 1}\n\n第二段`,
  publishedAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T08:00:00.000Z`,
  likeCount: 0,
  favoriteCount: 0,
  coverImage: index === 0 ? { id: 'cover-before-edit' } : null,
}))
updateArticles(articles, 'pool-articles')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('article list returns summaries and per-article daily unlock state', () => {
  const result = getArticles(context, { page: 1, pageSize: 10 })
  assert.equal(result.items.length, 10)
  assert.equal(result.pagination.total, 22)
  assert.equal(result.items.every((item) => !Object.hasOwn(item, 'bodyHtml')), true)
  assert.equal(result.items.every((item) => !Object.hasOwn(item, 'bodyMarkdown')), true)
  assert.equal(result.items.every((item) => !Object.hasOwn(item, 'label')), true)
  assert.equal(result.items.every((item) => !Object.hasOwn(item, 'excerpt') && !Object.hasOwn(item, 'recommended')), true)
  assert.deepEqual(result.todayUnlockedArticleIds, [])
})

test('article list follows the configured insertion-order mode before pagination', () => {
  try {
    updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'sequence' } })
    const sequence = getArticles(context, { page: 1, pageSize: 3 })
    assert.deepEqual(sequence.items.map((item) => item.id), ['article-22', 'article-21', 'article-20'])

    updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'random' } })
    const randomPage = getArticles(context, { page: 1, pageSize: 3 })
    assert.deepEqual([...randomPage.items.map((item) => item.id)].sort(), ['article-01', 'article-02', 'article-03'])
  } finally {
    updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'random' } })
  }
})

test('article list includes a requested shared article once even when it is outside the page', () => {
  updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'sequence' } })
  const result = getArticles(context, { page: 1, pageSize: 3, includeId: 'article-01' })
  assert.equal(result.items.filter((item) => item.id === 'article-01').length, 1)
  assert.equal(result.items[0].id, 'article-01')
  assert.equal(result.pagination.total, 22)
  updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'random' } })
})

test('article detail hides full body until this article is unlocked today', () => {
  const locked = getArticleDetail(context, 'article-01')
  assert.equal(locked.unlockedToday, false)
  assert.equal(locked.article.liked, false)
  assert.equal(locked.article.favorited, false)
  assert.equal(locked.article.likeCount, 0)
  assert.equal(locked.article.favoriteCount, 0)
  assert.equal(locked.article.myMessage, '')
  assert.match(locked.article.previewHtml, /完整正文 1/)
  assert.equal(locked.article.bodyHtml, '')

  const unlocked = unlockArticle(context, 'article-01')
  assert.equal(unlocked.unlockedToday, true)
  assert.equal(unlocked.article.unlockedToday, true)
  assert.match(unlocked.article.bodyHtml, /完整正文 1/)
  assert.ok(unlocked.recommendations.length <= 20)
  assert.equal(unlocked.recommendationPagination.pageSize, 20)
  assert.equal(unlocked.recommendationPagination.total, 21)
  assert.equal(unlocked.recommendations.some((item) => item.id === 'article-01'), false)

  const other = getArticleDetail(context, 'article-02')
  assert.equal(other.unlockedToday, false)
  assert.equal(other.article.bodyHtml, '')
})

test('article detail can show full body without unlock when configured', () => {
  updateMiniProgramConfig('mp-articles', { articleDisplay: { hideFullArticle: false } })
  const visible = getArticleDetail(context, 'article-02')
  assert.equal(visible.unlockedToday, true)
  assert.equal(visible.article.unlockedToday, true)
  assert.match(visible.article.bodyHtml, /完整正文 2/)

  updateMiniProgramConfig('mp-articles', { articleDisplay: { hideFullArticle: true } })
  const hidden = getArticleDetail(context, 'article-02')
  assert.equal(hidden.article.bodyHtml, '')
})

test('unlocked long articles expose one middle-ad segment only when the shared ad is configured', () => {
  const longBody = Array.from({ length: 3 }, (_, index) => `段落 ${index + 1} ${'正文内容'.repeat(120)}`).join('\n\n')
  appendContentItems('pool-articles', 'articles', [{
    id: 'article-long-body',
    title: '长文章',
    bodyMarkdown: longBody,
    publishedAt: '2026-09-02T08:00:00.000Z',
  }])

  const locked = getArticleDetail(context, 'article-long-body')
  assert.equal(locked.article.bodySegments.length, 0)

  updateMiniProgramConfig('mp-articles', {
    articleDisplay: { hideFullArticle: false },
    ads: { articlesEndNative: { enabled: true, adUnitId: 'adunit-middle' } },
  })
  const unlocked = getArticleDetail(context, 'article-long-body')
  assert.deepEqual(unlocked.article.bodySegments.map((segment) => segment.type), ['html', 'middle-ad', 'html'])
  assert.match(unlocked.article.bodySegments[0].html, /<p>[\s\S]*<\/p>$/)
  assert.match(unlocked.article.bodySegments[2].html, /^<p>/)

  updateMiniProgramConfig('mp-articles', {
    articleDisplay: { hideFullArticle: true },
    ads: { articlesEndNative: { enabled: true, adUnitId: '' } },
  })
})

test('admin can save simple article fields without losing the full article body', () => {
  const article = getAdminContent('pool-articles', 'mp-articles', { articles: { page: 1, pageSize: 100 } }).articles
    .find((item) => item.id === 'article-01')
  assert.ok(article)
  const updated = {
    ...article,
    excerpt: '旧字段应被忽略',
    publishedAt: '2026-09-01T09:30:00.000Z',
    recommended: true,
    title: '已更新标题',
  }
  updateAdminContentItem({ poolId: 'pool-articles', type: 'articles', item: updated, miniProgramId: 'mp-articles' })

  const saved = getAdminContent('pool-articles', 'mp-articles', { articles: { page: 1, pageSize: 100 } }).articles
    .find((item) => item.id === article.id)
  assert.equal(saved.title, '已更新标题')
  assert.equal(saved.publishedAt, '2026-09-01T09:30:00.000Z')
  assert.equal(Object.hasOwn(saved, 'excerpt'), false)
  assert.equal(Object.hasOwn(saved, 'recommended'), false)
  assert.equal(saved.coverImage.id, 'cover-before-edit')
  assert.equal(saved.label, '默认')
  const stored = require('../src/lib/state-database').getDatabase()
    .prepare("SELECT item_json FROM content_items WHERE pool_id = ? AND content_type = 'articles' AND item_id = ?")
    .get('pool-articles', article.id)
  assert.equal(JSON.parse(stored.item_json).label, '默认')
  assert.match(saved.bodyMarkdown, /完整正文/)
  assert.equal(Object.hasOwn(saved, 'bodyHtml'), false)
  assert.equal(Object.hasOwn(saved, 'previewHtml'), false)
})

test('article labels default, persist, and survive a subsequent body edit', () => {
  const [article] = getAdminContent('pool-articles', 'mp-articles', { articles: { page: 1, pageSize: 10 } }).articles
  updateAdminContentItem({
    poolId: 'pool-articles',
    type: 'articles',
    miniProgramId: 'mp-articles',
    item: { ...article, label: '产品观察' },
  })
  const labeled = getAdminContent('pool-articles', 'mp-articles', { articles: { page: 1, pageSize: 10 } }).articles
    .find((item) => item.id === article.id)
  assert.equal(labeled.label, '产品观察')

  updateAdminContentItem({
    poolId: 'pool-articles',
    type: 'articles',
    miniProgramId: 'mp-articles',
    item: { ...labeled, bodyMarkdown: '更新后的完整正文' },
  })
  const saved = getAdminContent('pool-articles', 'mp-articles', { articles: { page: 1, pageSize: 10 } }).articles
    .find((item) => item.id === article.id)
  assert.equal(saved.label, '产品观察')
  assert.equal(saved.bodyMarkdown, '更新后的完整正文')
})

test('删除文章同步清理当前数据范围内的打开、解锁和互动记录', () => {
  const target = {
    id: 'article-delete-behavior',
    title: '待删除文章',
    bodyMarkdown: '待删除正文',
    publishedAt: '2026-09-01T10:00:00.000Z',
  }
  appendContentItems('pool-articles', 'articles', [target])
  const behaviorContext = { ...context, visitorId: 'article-delete-visitor' }
  recordOpened(behaviorContext, 'article', target)
  unlockArticle(behaviorContext, target.id)
  setReaction(behaviorContext, {
    source: 'article', sourceId: target.id, type: 'favorite', desiredState: true,
  })

  deleteAdminContentItem({ poolId: 'pool-articles', type: 'articles', itemId: target.id, miniProgramId: 'mp-articles' })
  const db = require('../src/lib/state-database').getDatabase()
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM opened_records WHERE source = 'article' AND source_id = ?").get(target.id).count, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM article_unlocks WHERE article_id = ?").get(target.id).count, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reactions WHERE source = 'article' AND source_id = ?").get(target.id).count, 0)
})

test('继续阅读按稳定随机顺序分页，最多返回一百条且不读取旧推荐标记', () => {
  appendContentItems('pool-articles', 'articles', Array.from({ length: 105 }, (_, index) => ({
    id: `article-recommendation-${index + 1}`,
    title: `分页推荐 ${index + 1}`,
    bodyMarkdown: `分页正文 ${index + 1}`,
  })))
  const first = getArticleRecommendations(context, 'article-01', { page: 1, pageSize: 20, seed: 'recommendation-test' })
  const second = getArticleRecommendations(context, 'article-01', { page: 2, pageSize: 20, seed: 'recommendation-test' })
  const fifth = getArticleRecommendations(context, 'article-01', { page: 5, pageSize: 20, seed: 'recommendation-test' })
  const sixth = getArticleRecommendations(context, 'article-01', { page: 6, pageSize: 20, seed: 'recommendation-test' })
  const allIds = [...first.recommendations, ...second.recommendations, ...fifth.recommendations].map((item) => item.id)
  assert.equal(first.recommendationPagination.total, 100)
  assert.equal(first.recommendationPagination.totalPages, 5)
  assert.equal(first.recommendations.length, 20)
  assert.equal(second.recommendations.length, 20)
  assert.equal(fifth.recommendations.length, 20)
  assert.equal(sixth.recommendations.length, 0)
  assert.equal(new Set(allIds).size, 60)
  assert.deepEqual(
    getArticleRecommendations(context, 'article-01', { page: 1, pageSize: 20, seed: 'recommendation-test' }).recommendations.map((item) => item.id),
    first.recommendations.map((item) => item.id),
  )
  assert.equal(allIds.includes('article-01'), false)
  assert.equal(contentStoreSource.includes('const RANDOM_ARTICLE_MAX = 100'), true)
  assert.doesNotMatch(contentStoreSource, /json_extract\(item_json, '\$\.recommended'\)/)
})
