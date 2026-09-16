const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const { createRequire } = require('node:module')
const vm = require('node:vm')

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
const { appendContentItems, getContentSnapshot, getRandomArticlePage, updateArticles } = require('../src/modules/content/content.store')
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

test('article list keeps sequence order and uses one stable random order across pages', () => {
  try {
    updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'sequence' } })
    const sequence = getArticles(context, { page: 1, pageSize: 3 })
    assert.deepEqual(sequence.items.map((item) => item.id), ['article-22', 'article-21', 'article-20'])

    updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'random' } })
    const randomPage = getArticles(context, { page: 1, pageSize: 3 })
    const randomSecondPage = getArticles(context, { page: 2, pageSize: 3 })
    const randomPageRefresh = getArticles(context, { page: 1, pageSize: 3 })
    assert.notDeepEqual(randomPage.items.map((item) => item.id), randomPageRefresh.items.map((item) => item.id))
    assert.equal(new Set([
      ...randomPage.items.map((item) => item.id),
      ...randomSecondPage.items.map((item) => item.id),
    ]).size, 6)
  } finally {
    updateMiniProgramConfig('mp-articles', { system: { articlesSortMode: 'random' } })
  }
})

test('different source articles have independent recommendations while users share the same article order', () => {
  const first = getArticleRecommendations(context, 'article-01')
  const second = getArticleRecommendations(context, 'article-02')
  const otherUser = getArticleRecommendations({
    ...context, accountId: 'another-account', visitorId: 'another-visitor',
  }, 'article-01')
  assert.ok(first.recommendationPagination.seed)
  assert.notEqual(second.recommendationPagination.seed, first.recommendationPagination.seed)
  assert.equal(otherUser.recommendationPagination.seed, first.recommendationPagination.seed)
  assert.deepEqual(otherUser.recommendations.map((item) => item.id), first.recommendations.map((item) => item.id))
  // Compare the order of shared candidates, not just the removal of A or B.
  const secondIds = new Set(second.recommendations.map((item) => item.id))
  const commonIds = new Set(first.recommendations.map((item) => item.id).filter((id) => secondIds.has(id)))
  const commonOrder = (result) => result.recommendations.map((item) => item.id).filter((id) => commonIds.has(id))
  assert.ok(commonIds.size > 10)
  assert.notDeepEqual(commonOrder(first), commonOrder(second))
  assert.equal(first.recommendations.some((item) => item.id === 'article-01'), false)
  assert.equal(second.recommendations.some((item) => item.id === 'article-02'), false)
})

test('recommendation seeds reorder articles with similar IDs', () => {
  // These two seeds produced exactly the same order with the previous hash.
  const seeds = [3, 10].map((window) => JSON.stringify([
    `article-recommendations:pool-articles:regression-window-${window}`, 'article-01',
  ]))
  const orders = seeds.map((seed) => getRandomArticlePage('pool-articles', 'article-01', { seed })
    .items.map((item) => item.id))
  assert.notDeepEqual(orders[0], orders[1])
})

test('recommendations rotate after 30 minutes while continuation keeps its original order', (t) => {
  let now = Date.now() + 24 * 60 * 60 * 1000
  t.mock.method(Date, 'now', () => now)
  const first = getArticleRecommendations(context, 'article-01')
  const seed = first.recommendationPagination.seed
  const secondPage = getArticleRecommendations(context, 'article-01', { page: 2, seed })
  now += 30 * 60 * 1000 - 1
  assert.deepEqual(getArticleRecommendations(context, 'article-01'), first)
  now += 1
  const refreshed = getArticleRecommendations(context, 'article-01')
  assert.notEqual(refreshed.recommendationPagination.seed, seed)
  assert.notDeepEqual(refreshed.recommendations.map((item) => item.id), first.recommendations.map((item) => item.id))
  assert.deepEqual(getArticleRecommendations(context, 'article-01', { page: 2, seed }), secondPage)
  assert.deepEqual(getArticleRecommendations(context, 'article-01', { seed }), first)
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

test('继续阅读不足两百条时完整分页，超过一百条后仍可续页且无重复或遗漏', () => {
  appendContentItems('pool-articles', 'articles', Array.from({ length: 105 }, (_, index) => ({
    id: `article-recommendation-${index + 1}`,
    title: `分页推荐 ${index + 1}`,
    bodyMarkdown: `分页正文 ${index + 1}`,
  })))
  const first = getArticleRecommendations(context, 'article-01')
  const { seed, total, totalPages } = first.recommendationPagination
  const expectedIds = getContentSnapshot('pool-articles').articles.map((item) => item.id).filter((id) => id !== 'article-01')
  assert.ok(total > 100)
  assert.ok(total < 200)
  assert.equal(total, expectedIds.length)
  assert.equal(totalPages, Math.ceil(total / 20))
  assert.equal(first.recommendations.length, 20)
  const items = [...first.recommendations]
  for (let page = 2; page <= totalPages; page += 1) {
    const next = getArticleRecommendations(context, 'article-01', { page, pageSize: 20, seed })
    assert.equal(next.recommendationPagination.seed, seed)
    assert.equal(next.recommendations.length, Math.min(20, total - (page - 1) * 20))
    items.push(...next.recommendations)
  }
  const allIds = items.map((item) => item.id)
  assert.equal(new Set(allIds).size, total)
  assert.deepEqual(allIds.slice().sort(), expectedIds.sort())
  assert.ok(items.every((item) => !Object.hasOwn(item, 'bodyMarkdown') && !Object.hasOwn(item, 'bodyHtml')))
  assert.deepEqual(getArticleRecommendations(context, 'article-01', { seed }), first)
  assert.deepEqual(getArticleRecommendations(context, 'article-01', { page: totalPages + 1, seed }).recommendations, [])
  assert.equal(getArticleRecommendations(context, 'article-01', { pageSize: 200, seed }).recommendations.length, 20)
  assert.doesNotMatch(contentStoreSource, /json_extract\(item_json, '\$\.recommended'\)/)
})

test('继续阅读从全池随机选择最多两百条，第十页后停止且不重复', () => {
  appendContentItems('pool-articles', 'articles', Array.from({ length: 150 }, (_, index) => ({
    id: `article-cap-${index + 1}`,
    title: `推荐上限验证 ${index + 1}`,
    bodyMarkdown: '推荐上限验证正文',
  })))
  const candidateIds = getContentSnapshot('pool-articles').articles.map((item) => item.id).filter((id) => id !== 'article-01')
  assert.ok(candidateIds.length > 200)
  const seed = 'recommendation-cap-regression'
  const first = getArticleRecommendations(context, 'article-01', { seed })
  assert.equal(first.recommendationPagination.total, 200)
  assert.equal(first.recommendationPagination.totalPages, 10)
  assert.equal(first.recommendationPagination.pageSize, 20)
  const allIds = first.recommendations.map((item) => item.id)
  for (let page = 2; page <= 10; page += 1) {
    const result = getArticleRecommendations(context, 'article-01', { page, seed })
    assert.equal(result.recommendations.length, 20)
    assert.equal(result.recommendationPagination.seed, seed)
    allIds.push(...result.recommendations.map((item) => item.id))
  }
  assert.equal(allIds.length, 200)
  assert.equal(new Set(allIds).size, 200)
  assert.ok(allIds.every((id) => candidateIds.includes(id)))
  // The cap applies after random selection, so later entries can be recommended.
  const laterCandidates = new Set(candidateIds.slice(200))
  assert.ok(allIds.some((id) => laterCandidates.has(id)))
  const ended = getArticleRecommendations(context, 'article-01', { page: 11, seed })
  assert.deepEqual(ended.recommendations, [])
  assert.equal(ended.recommendationPagination.total, 200)
  assert.equal(ended.recommendationPagination.totalPages, 10)
})

test('evicting cached orders does not change an existing recommendation sequence', () => {
  const first = getArticleRecommendations(context, 'article-01')
  const seed = first.recommendationPagination.seed
  const second = getArticleRecommendations(context, 'article-01', { page: 2, seed })
  for (let index = 0; index < 70; index += 1) {
    getRandomArticlePage('pool-articles', 'article-01', { seed: `eviction-${index}`, pageSize: 1 })
  }
  assert.deepEqual(getArticleRecommendations(context, 'article-01', { seed }), first)
  assert.deepEqual(getArticleRecommendations(context, 'article-01', { page: 2, seed }), second)
})

test('small recommendation pools end naturally and stay isolated from other pools', () => {
  updateArticles([{ id: 'article-01', title: '另一内容池', bodyMarkdown: '唯一文章' }], 'pool-recommendation-small')
  const empty = getRandomArticlePage('pool-recommendation-small', 'article-01', { seed: 'small' })
  assert.equal(empty.total, 0)
  assert.deepEqual(empty.items, [])
  appendContentItems('pool-recommendation-small', 'articles', [{
    id: 'small-other', title: '另一篇', bodyMarkdown: '正文',
  }])
  const page = getRandomArticlePage('pool-recommendation-small', 'article-01', { seed: 'small' })
  assert.equal(page.total, 1)
  assert.deepEqual(page.items.map((item) => item.id), ['small-other'])
  assert.deepEqual(getRandomArticlePage('pool-recommendation-small', 'article-01', { seed: 'small', page: 2 }).items, [])
})

test('shared recommendation orders keep reactions personal and read fresh article data', () => {
  const otherUser = { ...context, accountId: 'recommendation-reader', visitorId: 'recommendation-reader' }
  const first = getArticleRecommendations(context, 'article-01')
  const target = first.recommendations[0]
  setReaction(context, { source: 'article', sourceId: target.id, type: 'like', desiredState: true })
  const mine = getArticleRecommendations(context, 'article-01')
  const theirs = getArticleRecommendations(otherUser, 'article-01')
  assert.deepEqual(theirs.recommendations.map((item) => item.id), mine.recommendations.map((item) => item.id))
  assert.equal(mine.recommendations[0].liked, true)
  assert.equal(theirs.recommendations[0].liked, false)
  updateAdminContentItem({ poolId: 'pool-articles', type: 'articles', item: { ...target, title: '更新后的推荐标题' } })
  const updated = getArticleRecommendations(context, 'article-01')
  assert.equal(updated.recommendations[0].id, target.id)
  assert.equal(updated.recommendations[0].title, '更新后的推荐标题')
})

test('unchanged mini-program stops at 200 recommendations with continuous ad positions', async () => {
  const pagePath = path.resolve(__dirname, '../../../miniprogram/pages/article/article.js')
  const requirePage = createRequire(pagePath)
  const requests = []
  const notices = []
  let definition
  vm.runInNewContext(fs.readFileSync(pagePath, 'utf8'), {
    Page(value) { definition = value },
    wx: { setNavigationBarTitle() {}, showToast(value) { notices.push(value) } },
    require(moduleId) {
      if (moduleId === '../../services/miniapp') {
        return { async getArticleRecommendations(contentId, options) {
          requests.push({ contentId, ...options })
          return getArticleRecommendations(context, contentId, options)
        } }
      }
      if (moduleId === '../../utils/copy-pack') return { getShareSettings: () => ({}) }
      return requirePage(moduleId)
    },
  }, { filename: pagePath })

  for (const [firstAfter, interval] of [[3, 10], [2, 7]]) {
    requests.length = 0
    const instance = {
      ...definition,
      contentId: 'article-01',
      data: structuredClone(definition.data),
      setData(patch) { Object.assign(this.data, patch) },
      preparePublicShareCard() { return null },
    }
    instance.data.ads = { articlesNative: { firstAfter, interval } }
    const detail = getArticleDetail(context, instance.contentId)
    instance.applyDetail(detail)
    const { seed, total, totalPages } = instance.recommendationPagination
    assert.equal(total, 200)
    assert.equal(totalPages, 10)
    for (let page = 2; page <= totalPages; page += 1) {
      await instance.onReachBottom()
      assert.equal(instance.recommendationPagination.page, page)
      assert.equal(instance.data.recommendations.length, Math.min(page * 20, total))
      assert.equal(requests.at(-1).seed, seed)
      assert.equal(requests.at(-1).page, page)
    }
    const ids = instance.data.recommendations.map((item) => item.id)
    assert.equal(new Set(ids).size, total)
    assert.equal(ids.includes(instance.contentId), false)
    const adPositions = Array.from(instance.data.recommendations, (item, index) => item.showNativeAdAfter ? index + 1 : 0).filter(Boolean)
    const expectedPositions = []
    for (let position = firstAfter + 5; position <= total; position += interval) expectedPositions.push(position)
    assert.deepEqual(adPositions, expectedPositions)
    assert.ok(adPositions.some((position) => position > 100))
    await instance.onReachBottom()
    assert.equal(requests.length, totalPages - 1)
  }
  assert.deepEqual(notices, [])
})
