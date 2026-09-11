const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { formatArticlePublishedAt, prepareDetailPayload, resolvePreviewHeight } = require('../utils/article-detail')

function restoreGlobal(name, previous) {
  if (previous === undefined) delete global[name]
  else global[name] = previous
}

test('article detail formats its existing publication timestamp for the header', () => {
  assert.equal(formatArticlePublishedAt('2026-09-03T08:00:00.000Z'), '2026.09.03')
  assert.equal(formatArticlePublishedAt('invalid-date'), '')
  assert.equal(formatArticlePublishedAt(null), '')

  const payload = prepareDetailPayload({
    article: { id: 'article-1', title: '标题', author: '作者', publishedAt: '2026-09-03T08:00:00.000Z' },
  })
  assert.equal(payload.article.author, '作者')
  assert.equal(payload.article.publishedAtText, '2026.09.03')
})

test('article detail marks mixed rich-text media boundaries for ad adjacency', () => {
  const payload = prepareDetailPayload({
    article: {
      id: 'article-media',
      title: '媒体边界',
      bodyHtml: '<p>正文</p><p><img src="https://example.com/last.jpg"></p>',
    },
    unlockedToday: true,
  })
  assert.equal(payload.article.bodySegments[0].startsWithMedia, false)
  assert.equal(payload.article.bodySegments[0].endsWithMedia, true)
  assert.equal(payload.article.bodyEndsWithMedia, true)
})

test('article detail marks middle ads as both media boundaries', () => {
  const payload = prepareDetailPayload({
    article: {
      id: 'article-ad',
      title: '广告边界',
      bodySegments: [
        { type: 'html', html: '<p>正文</p><p><img src="https://example.com/last.jpg"></p>' },
        { type: 'middle-ad' },
        { type: 'html', html: '<p><img src="https://example.com/first.jpg"></p><p>正文</p>' },
      ],
    },
    unlockedToday: true,
  })
  assert.deepEqual(payload.article.bodySegments.map((segment) => [segment.startsWithMedia, segment.endsWithMedia]), [
    [false, true],
    [true, true],
    [true, false],
  ])
})

test('preview presets resolve to five fixed viewport-height percentages', () => {
  assert.equal(resolvePreviewHeight(), 20)
  assert.equal(resolvePreviewHeight({ previewPreset: 'earliest' }), 10)
  assert.equal(resolvePreviewHeight({ previewPreset: 'early' }), 20)
  assert.equal(resolvePreviewHeight({ previewPreset: 'medium' }), 30)
  assert.equal(resolvePreviewHeight({ previewPreset: 'late' }), 40)
  assert.equal(resolvePreviewHeight({ previewPreset: 'latest' }), 50)
  assert.equal(resolvePreviewHeight({ previewPreset: 'unknown' }), 20)
})

test('locked article preview height is applied in viewport units', () => {
  const page = fs.readFileSync(path.join(__dirname, '../pages/article/article.js'), 'utf8')
  const template = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxml'), 'utf8')
  assert.match(page, /previewMaxHeightVh:\s*PREVIEW_HEIGHTS\.early/)
  assert.match(template, /style="max-height: \{\{previewMaxHeightVh\}\}vh;"/)
})

test('locked detail never invents full content and keeps each recommendation page at twenty', () => {
  const payload = prepareDetailPayload({
    article: {
      id: 'current',
      title: '文章标题',
      previewHtml: '<p>预览</p>',
      bodyHtml: '',
    },
    recommendations: [
      { id: 'current', title: '当前文章' },
      ...Array.from({ length: 35 }, (_, index) => ({ id: `r-${index}`, title: `继续阅读 ${index}` })),
    ],
    unlockedToday: false,
  })

  assert.equal(payload.unlockedToday, false)
  assert.equal(payload.article.bodyHtml, '')
  assert.equal(payload.article.previewHtml, '<p style="margin:0;">预览</p>')
  assert.equal(payload.recommendations.length, 20)
  assert.equal(payload.recommendations.some((item) => item.id === 'current'), false)
  assert.equal(payload.recommendations[0].cardLayout, 'stacked')
  assert.equal(payload.recommendations[1].cardLayout, 'title-left')
})

test('detail recommendations reuse the article list card structure', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxss'), 'utf8')
  assert.match(styles, /@import '\.\.\/articles\/articles\.wxss';/)
  assert.match(template, /class="article-card article-card--\{\{item\.cardLayout\}\}[^"]*"/)
  assert.match(template, /class="article-card-media"/)
  assert.match(template, /class="article-card-copy"/)
  assert.match(template, /class="article-card-title"/)
  assert.match(template, /class="article-card-meta article-card-meta--overlay"/)
  assert.doesNotMatch(template, /recommend-item|recommend-cover|recommend-copy/)
  assert.doesNotMatch(styles, /\.recommend-item|\.recommend-cover|\.recommend-copy/)
})

test('detail recommendations keep same-image fallbacks for both cover layouts', () => {
  const coverImage = { thumbUrl: '/thumb.jpg', mediumUrl: '/medium.jpg', originalUrl: '/original.jpg' }
  const data = prepareDetailPayload({
    article: { id: 'current' },
    recommendations: [{ id: 'wide', coverImage }, { id: 'small', coverImage }],
  })
  assert.equal(data.recommendations[0].coverUrl, '/medium.jpg')
  assert.equal(data.recommendations[1].coverUrl, '/thumb.jpg')
  assert.ok(data.recommendations.every((item) => item.coverCandidates.includes('/original.jpg')))
})

test('article detail keeps header metadata and content spacing on shared tokens', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxss'), 'utf8')
  const tokens = fs.readFileSync(path.join(__dirname, '../styles/tokens.wxss'), 'utf8')
  assert.match(template, /class="article-card-meta article-header-meta"[\s\S]*article\.author[\s\S]*article\.publishedAtText/)
  assert.match(template, /class="article-intro"[\s\S]*class="article-header"[\s\S]*data-position="start"/)
  assert.match(styles, /\.article-main\s*\{[^}]*gap:\s*var\(--card-content-gap\);/s)
  assert.match(styles, /\.article-intro\s*\{[^}]*gap:\s*20rpx;/s)
  assert.match(styles, /\.article-rich-text\s*\{[^}]*padding:\s*0;/s)
  assert.match(styles, /\.article-rich-text\s*\{[^}]*line-height:\s*1\.7;/s)
  assert.match(styles, /\.article-media-flow\s*\{[^}]*gap:\s*var\(--article-content-gap\);[^}]*padding:\s*var\(--article-media-start-gap\)\s+0\s+var\(--article-media-end-gap\);/s)
  assert.match(tokens, /--article-content-gap:\s*20rpx;/)
  assert.doesNotMatch(tokens, /--article-text-edge-gap:/)
  assert.match(tokens, /--article-media-gap:\s*24rpx;/)
  assert.match(tokens, /\.theme\.font-larger\s*\{[^}]*--article-content-gap:\s*24rpx;[^}]*--article-media-gap:\s*28rpx;/s)
  assert.match(tokens, /\.theme\.font-max\s*\{[^}]*--article-content-gap:\s*28rpx;[^}]*--article-media-gap:\s*32rpx;/s)
  assert.match(styles, /\.article-rich-text\s*\{[^}]*line-height:\s*1\.7;/s)
  assert.match(tokens, /--article-media-start-gap:\s*10rpx;/)
  assert.match(tokens, /--article-media-end-gap:\s*32rpx;/)
  assert.doesNotMatch(tokens, /--article-media-consecutive-gap/)
  assert.doesNotMatch(styles, /article-media-consecutive-gap/)
  assert.match(styles, /\.article-header-meta\s*\{[^}]*font-size:\s*var\(--type-article-detail-meta\);[^}]*font-weight:\s*400;/s)
})

test('article detail keeps full-article display controlled by the server unlock state', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/article/article.js'), 'utf8')
  const template = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxml'), 'utf8')
  assert.doesNotMatch(source, /showFullArticle|articleFullArticleMode/)
  assert.match(template, /wx:elif="\{\{unlockedToday\}\}" class="article-rich-text \{\{article\.bodyMediaOnly \? 'article-media-block article-media-block--pure' : ''\}\}[^\"]*"/)
  assert.match(template, /article\.bodySegments[\s\S]*data-position="middle"/)
  assert.match(template, /item\.startsWithMedia \? 'article-media-block--media-start'/)
  assert.match(template, /item\.endsWithMedia \? 'article-media-block--media-end'/)
  assert.match(template, /class="article-ad article-media-block article-media-block--pure article-media-block--media-start article-media-block--media-end[^\"]*"\s*>\s*<ad-custom[^>]*data-position="start"/s)
  assert.match(template, /wx:if="\{\{unlockedToday && ads\.articlesEndNative\.enabled/)
})

test('article detail exposes shared interactions and message controls', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/article/article.js'), 'utf8')
  const template = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxml'), 'utf8')
  assert.match(source, /toggleInteraction\(\{[\s\S]*source: 'article',[\s\S]*sourceId: this\.contentId/)
  assert.match(source, /submitPrivateMessage\(\{[\s\S]*source: 'article',[\s\S]*sourceId: this\.contentId/)
  assert.match(source, /deletePrivateMessage\(\{ source: 'article', sourceId: this\.contentId \}\)/)
  assert.match(template, /class="article-body-followup"[\s\S]*data-position="end"[\s\S]*class="article-interactions action-bar-surface"[\s\S]*class="action-bar"[\s\S]*class="recommend-section"/)
  assert.ok(template.indexOf('class="article-body-followup"') < template.indexOf('class="article-interactions action-bar-surface"'))
  assert.ok(template.indexOf('data-position="end"') < template.indexOf('class="article-interactions action-bar-surface"'))
  assert.match(template, /class="action-pill action-button[\s\S]*action-heart(?:-active)?\.svg/)
  assert.match(template, /open-type="share" data-share="article"/)
  assert.match(template, /wx:if="\{\{messagesEnabled\}\}" class="action-pill action-button"/)
  assert.match(template, /wx:if="\{\{messagesEnabled && article\.myMessage\}\}" class="message-box"/)
  assert.match(template, /wx:if="\{\{messagesEnabled && articleMessageVisible\}\}" class="message-box"/)
  assert.match(source, /messagesEnabled:\s*false/)
  assert.match(source, /const messagesEnabled = config\.messagesEnabled === true/)
  assert.match(source, /unlockArticle\(this\.contentId, \{ rewarded: Boolean\(hasAd && reward\.completed\) \}\)/)
  const styles = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxss'), 'utf8')
  assert.match(styles, /\.article-interactions\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*var\(--card-content-gap\);/s)
})

test('article detail supports pull-to-refresh and scoped follow-up spacing', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/article/article.json'), 'utf8'))
  const homeConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/home/home.json'), 'utf8'))
  const source = fs.readFileSync(path.join(__dirname, '../pages/article/article.js'), 'utf8')
  const template = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../pages/article/article.wxss'), 'utf8')
  assert.equal(config.enablePullDownRefresh, true)
  assert.equal(config.backgroundColor, '#f6efe6')
  assert.equal(config.enablePullDownRefresh, homeConfig.enablePullDownRefresh)
  assert.equal(config.backgroundTextStyle, homeConfig.backgroundTextStyle)
  assert.match(source, /async onPullDownRefresh\(\)\s*\{[\s\S]*setData\(\{ refreshing: true \}\)[\s\S]*loadData\(\{ force: true, notify: true \}\)[\s\S]*setData\(\{ refreshing: false \}\)[\s\S]*wx\.stopPullDownRefresh\(\)/)
  assert.match(template, /<immersive-nav[^>]*refreshing="\{\{refreshing\}\}"/)
  assert.match(source, /if \(this\.loadingRequest\) return this\.loadingRequest/)
  assert.match(source, /if \(options\.notify\) wx\.showToast\(\{ title: message, icon: 'none' \}\)/)
  assert.match(template, /class="article-flow"[\s\S]*class="article-body-followup"[\s\S]*data-position="end"[\s\S]*class="recommend-section"/)
  assert.match(styles, /\.article-flow\s*\{[^}]*gap:\s*var\(--space-4\);/s)
  assert.match(styles, /\.article-body-followup\s*\{[^}]*gap:\s*0;/s)
  assert.match(styles, /\.article-media-block\s*\{[^}]*margin:\s*0;/s)
  assert.match(styles, /\.article-media-flow\s*\{[^}]*padding:\s*var\(--article-media-start-gap\)\s+0\s+var\(--article-media-end-gap\);/s)
  assert.match(template, /startAdHidden \? 'article-media-block--hidden' : ''/)
  assert.match(template, /middleAdHidden \? 'article-media-block--hidden' : ''/)
  assert.match(template, /endAdHidden \? 'article-media-block--hidden' : ''/)
  assert.match(template, /article-media-block article-media-block--pure/)
  assert.doesNotMatch(styles, /\.article-interactions\s+\.action-bar\s*\{/s)
})

test('article detail falls back to safe defaults when the startup config degraded', async () => {
  const startupPath = require.resolve('../utils/startup-config')
  const servicePath = require.resolve('../services/miniapp')
  const pagePath = require.resolve('../pages/article/article')
  const startupConfig = require(startupPath)
  const service = require(servicePath)
  const previousGetStartupConfig = startupConfig.getStartupConfig
  const previousGetArticle = service.getArticle
  const previousPage = global.Page
  const previousWx = global.wx
  let definition
  // 统一启动服务永不 reject：降级时 config 为空，页面必须用安全默认值继续渲染
  startupConfig.getStartupConfig = () => Promise.resolve({ tabs: [], system: {}, config: null, dataScopeId: '', source: 'timeout' })
  service.getArticle = () => Promise.resolve({ article: { id: 'article-1' } })
  global.Page = (value) => { definition = value }
  global.wx = { showToast() {} }
  delete require.cache[pagePath]

  try {
    require(pagePath)
    const page = {
      ...definition,
      contentId: 'article-1',
      data: {
        ...definition.data,
        articleMessageVisible: true,
        messagesEnabled: true,
        phoneSyncPromptVisible: true,
      },
      setData(value) { Object.assign(this.data, value) },
    }

    await page.loadData({ force: true, notify: true })

    assert.equal(page.data.messagesEnabled, false)
    assert.equal(page.data.articleMessageVisible, false)
    assert.equal(page.data.phoneSyncPromptVisible, false)
    assert.equal(page.data.error, '')
    assert.equal(page.data.ready, true)
  } finally {
    startupConfig.getStartupConfig = previousGetStartupConfig
    service.getArticle = previousGetArticle
    restoreGlobal('Page', previousPage)
    restoreGlobal('wx', previousWx)
    delete require.cache[pagePath]
  }
})
