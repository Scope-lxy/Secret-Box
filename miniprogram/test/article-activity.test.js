const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const miniappRoot = path.resolve(__dirname, '..')
const { normalizeActivityItem } = require('../utils/format')
const { markListAdSlots } = require('../utils/list-ads')

function readMiniappFile(relativePath) {
  return fs.readFileSync(path.join(miniappRoot, relativePath), 'utf8')
}

test('article details record successful opens and shares with the article identity', () => {
  const service = readMiniappFile('services/miniapp.js')
  const article = readMiniappFile('pages/article/article.js')

  assert.match(service, /function openArticle\(contentId\)/)
  assert.match(service, /articles\/\$\{encodeURIComponent\((?:contentId|payload\.contentId)\)\}\/open/)
  assert.match(service, /prepareActionIdempotency\('article_open', payload\)/)
  assert.match(service, /expectedAccountId: action\.accountId/)
  assert.match(service, /'x-idempotency-key': action\.key/)
  assert.match(service, /clearActionIdempotencyKey\(action\.storageKey\)/)
  assert.match(service, /invalidateResource\('activity'\)/)
  assert.match(article, /this\.applyDetail\(detail\)[\s\S]*(?:openArticle\(this\.contentId\)\.catch|this\.ensureOpenRecorded\(\))/)
  assert.match(article, /recordShareInteraction\(\{ source: 'article', sourceId: this\.contentId \}\)/)
  assert.match(article, /const fallbackTitle = this\.data\.article\.title \|\| resolveCopyText\(null, 'articleShareTitle'\)/)
  assert.match(article, /const fallbackImage = getArticleCoverUrl\(this\.data\.article\.coverImage\)\s*\|\| resolveFallbackCoverUrl\(settings, 0, this\.contentId\)/)
  assert.match(article, /imageUrl: this\.publicShareCard\?\.imageUrl \|\| fallbackImage/)
})

test('article activity entries keep their route identity', () => {
  const item = normalizeActivityItem({
    id: 'open-a-1',
    source: 'article',
    sourceId: 'a-1',
    type: 'article',
    preview: '文章标题',
    title: '文章标题',
    coverImage: { thumbUrl: 'https://example.com/article-thumb.jpg' },
  })

  assert.equal(item.source, 'article')
  assert.equal(item.sourceId, 'a-1')
  assert.equal(item.isArticle, true)
  assert.equal(item.title, '文章标题')
  assert.equal(item.coverUrl, 'https://example.com/article-thumb.jpg')
  assert.equal(normalizeActivityItem({ source: 'article' }).coverUrl, '/assets/images/share-1.jpg')
  assert.equal(normalizeActivityItem({ source: 'article' }, {
    shareSettings: { private: { backgrounds: [{ enabled: true, imageUrl: 'https://example.com/fallback.jpg' }] } },
  }).coverUrl, 'https://example.com/fallback.jpg')

  for (const page of ['mine', 'opened-history', 'interactions', 'favorites']) {
    const script = readMiniappFile(`pages/${page}/${page}.js`)
    const template = readMiniappFile(`pages/${page}/${page}.wxml`)
    assert.match(script, /openActivityItem\(event\)/)
    assert.match(script, /item\.isArticle && item\.sourceId/)
    assert.match(script, /\/pages\/article\/article\?contentId=/)
    assert.match(template, /bindtap="openActivityItem"/)
  }

  for (const page of ['mine', 'opened-history', 'interactions']) {
    const template = readMiniappFile(`pages/${page}/${page}.wxml`)
    assert.match(template, /item\.isArticle \? 'history-article-card' : ''/)
    assert.match(template, /class="history-meta"[^>]*>[\s\S]*class="history-time"/)
    assert.match(template, /wx:if="\{\{item\.isArticle\}\}" class="history-article-layout/)
    assert.match(template, /class="history-article-title">\{\{item\.title \|\| item\.preview\}\}<\/text>/)
    assert.doesNotMatch(template, /history-article-(?:author|stat|meta)/)
  }

  const styles = readMiniappFile('styles/components.wxss')
  assert.match(styles, /\.history-time\s*\{[^}]*flex:\s*0 0 auto;[^}]*align-self:\s*flex-start;[^}]*margin-left:\s*auto;[^}]*text-align:\s*right;[^}]*white-space:\s*nowrap;/s)
  assert.match(styles, /\.history-card\.history-article-card\s*\{[^}]*gap:\s*8rpx;[^}]*padding:\s*var\(--card-padding-y\)\s+var\(--card-padding-x\);/s)
  assert.match(styles, /\.history-article-layout\s*\{[^}]*align-items:\s*start;/s)
  assert.match(styles, /\.history-article-copy\s*\{[^}]*align-items:\s*flex-start;/s)
  assert.match(styles, /\.history-article-media\s*\{[^}]*width:\s*112rpx;[^}]*height:\s*112rpx;/s)
  assert.match(styles, /\.history-article-title\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/)

  const interactions = readMiniappFile('pages/interactions/interactions.js')
  assert.match(interactions, /this\.articleShareSettings = copyPack\.getShareSettings\(\)/)
  assert.match(interactions, /normalizeActivityListItem\(item, \{[\s\S]*shareSettings: this\.articleShareSettings,[\s\S]*displayIndex: displayOffset \+ index/)
})

test('daily content activity items use short canonical labels at their view-model source', () => {
  assert.equal(normalizeActivityItem({ source: 'daily_content', type: 'text' }).type, '手记')
  assert.equal(normalizeActivityItem({ source: 'daily_content', type: 'audio' }).type, '音频')
  assert.equal(normalizeActivityItem({ source: 'daily_content', type: 'album' }).type, '图册')
  assert.equal(normalizeActivityItem({ source: 'article', type: 'article' }).type, '文章')
  assert.equal(normalizeActivityItem({ source: 'letters', type: 'letter' }).type, '心笺')
  assert.equal(normalizeActivityItem({ source: 'daily_content', type: 'audio' }).isAudio, true)
  assert.equal(normalizeActivityItem({ source: 'daily_content', type: 'text', audioUrl: 'https://example.com/audio.m4a' }).isAudio, false)
  assert.equal(normalizeActivityItem({ source: 'article', type: 'article' }).isArticle, true)
  assert.equal(normalizeActivityItem({ source: 'article', type: 'text' }).isArticle, false)

  const home = readMiniappFile('pages/home/home.wxml')
  assert.equal((home.match(/class="tag">专属内容<\/text>/g) || []).length, 1)
  assert.equal((home.match(/class="tag">手记<\/text>/g) || []).length, 1)
  assert.match(home, /class="tag">音频<\/text>/)
  assert.match(home, /class="tag">图册<\/text>/)

  for (const page of ['mine', 'opened-history', 'interactions', 'favorites', 'messages']) {
    const template = readMiniappFile(`pages/${page}/${page}.wxml`)
    assert.match(template, /class="type-badge">\{\{item\.type\}\}<\/text>/)
  }

  const format = readMiniappFile('utils/format.js')
  const interactionStore = fs.readFileSync(path.resolve(miniappRoot, '../admin/server/src/modules/interactions/interaction.store.js'), 'utf8')
  assert.doesNotMatch(format, /今日手记|今日音频|今日图册/)
  assert.doesNotMatch(interactionStore, /今日手记|今日音频|今日图册/)

})

test('favorites retain album identity when the API has no displayable images', () => {
  const item = normalizeActivityItem({
    id: 'favorite-album-unavailable',
    type: 'album',
    preview: '已打开 9 张图片',
    images: [],
  })
  const favoritesTemplate = readMiniappFile('pages/favorites/favorites.wxml')

  assert.equal(item.isAlbum, true)
  assert.equal(item.isAudio, false)
  assert.match(favoritesTemplate, /wx:elif="\{\{item\.isAlbum\}\}" class="history-album-wrap"/)
  assert.match(favoritesTemplate, /class="history-album-unavailable" catchtap="retryFavoriteAlbum"><text>图片加载失败，点击重试<\/text>/)
  assert.doesNotMatch(favoritesTemplate, /wx:elif="\{\{item\.images\.length\}\}" class="history-album-wrap"/)
})

test('expand control tracks every body font size without wrapping or taking layout space', () => {
  const styles = readMiniappFile('components/expandable-text/expandable-text.wxss')
  const sharedStyles = readMiniappFile('styles/expand-toggle.wxss')
  assert.match(styles, /@import '..\/..\/styles\/expand-toggle\.wxss';/)
  assert.match(styles, /\.expandable-text__toggle\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*bottom:\s*0;/s)
  assert.match(sharedStyles, /\.expandable-text__toggle\s*\{[^}]*width:\s*2\.25em;[^}]*font-size:\s*var\(--type-body\);[^}]*white-space:\s*nowrap;/s)
  assert.match(sharedStyles, /\.expandable-text__toggle::before[\s\S]*right:\s*100%;[\s\S]*height:\s*1\.5em;[\s\S]*background:\s*linear-gradient\(90deg, transparent, var\(--color-card\)\);[\s\S]*pointer-events:\s*none;/)
  assert.doesNotMatch(readMiniappFile('components/expandable-text/expandable-text.wxml'), /expandable-text__fade/)
})

test('interaction and message records use the shared expandable text control', () => {
  const interactions = readMiniappFile('pages/interactions/interactions.wxml')
  const interactionsScript = readMiniappFile('pages/interactions/interactions.js')
  const messages = readMiniappFile('pages/messages/messages.wxml')
  const messagesScript = readMiniappFile('pages/messages/messages.js')

  assert.match(interactions, /<expandable-text wx:else text="\{\{item\.preview\}\}" paragraphs="\{\{item\.previewParagraphs\}\}"><\/expandable-text>/)
  assert.match(interactionsScript, /withPreviewParagraphs\(normalizeActivityListItem\(item, \{/)
  assert.match(messages, /<expandable-text text="\{\{item\.preview\}\}" paragraphs="\{\{item\.previewParagraphs\}\}"><\/expandable-text>/)
  assert.match(messagesScript, /withPreviewParagraphs\(normalizeActivityListItem\(item\)\)/)
})

test('article recommendations follow the list ad configuration with a five-item offset', () => {
  const article = readMiniappFile('pages/article/article.js')
  const template = readMiniappFile('pages/article/article.wxml')

  assert.match(template, /item\.showNativeAdAfter && ads\.articlesEndNative\.enabled && ads\.articlesEndNative\.adUnitId/)
  assert.match(template, /unit-id="\{\{ads\.articlesEndNative\.adUnitId\}\}" data-position="recommendation"/)
  assert.match(template, /class="article-card article-card--\{\{item\.cardLayout\}\}[^"]*"[\s\S]*class="article-card-media"[\s\S]*class="article-card-copy"[\s\S]*class="article-card-title"[\s\S]*class="article-card-meta"/)
  assert.match(template, /class="article-card-meta article-card-meta--overlay"/)
  assert.doesNotMatch(template, /recommend-item|recommend-cover|recommend-copy/)
  assert.match(article, /recommendationAdHidden: false/)
  assert.match(article, /recommendation:\s*'recommendationAdHidden'/)
  assert.match(article, /markListAdSlots\(prepared\.recommendations, firstAfter \+ 5, interval\)/)
  assert.match(article, /async onReachBottom\(\)/)
  assert.match(article, /getArticleRecommendations\(this\.contentId, \{[\s\S]*page:[\s\S]*seed:/)
  assert.match(article, /markListAdSlots\(\[[\s\S]*\.\.\.this\.data\.recommendations,[\s\S]*\.\.\.incoming,/)
})

test('article recommendation ad slots preserve the default and custom list cadence', () => {
  const items = Array.from({ length: 28 }, (_, index) => ({ id: `recommendation-${index + 1}` }))
  assert.deepEqual(
    markListAdSlots(items, 3 + 5, 10).filter((item) => item.showNativeAdAfter).map((item) => item.id),
    ['recommendation-8', 'recommendation-18', 'recommendation-28'],
  )
  assert.deepEqual(
    markListAdSlots(items, 4 + 5, 6).filter((item) => item.showNativeAdAfter).map((item) => item.id),
    ['recommendation-9', 'recommendation-15', 'recommendation-21', 'recommendation-27'],
  )
})

test('article recommendation ad slots remain global when later pages are appended', () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({ id: `recommendation-${index + 1}` }))
  const secondPage = Array.from({ length: 20 }, (_, index) => ({ id: `recommendation-${index + 21}` }))
  assert.deepEqual(
    markListAdSlots([...firstPage, ...secondPage], 3 + 5, 10)
      .filter((item) => item.showNativeAdAfter)
      .map((item) => item.id),
    ['recommendation-8', 'recommendation-18', 'recommendation-28', 'recommendation-38'],
  )
})

test('article pages read the top-level display config returned by the miniapp API', () => {
  const list = readMiniappFile('pages/articles/articles.js')
  const detail = readMiniappFile('pages/article/article.js')

  assert.match(list, /config\.articleDisplay \|\| system\.articleDisplay \|\| \{\}/)
  assert.match(list, /normalizeArticleLayout\(display\.layout\)/)
  assert.match(list, /normalizeArticleSortMode\(system\.articlesSortMode\)/)
  assert.match(list, /sortArticleItems\(data\.items \|\| \[\], this\.data\.sortMode\)/)
  assert.match(detail, /config\.articleDisplay \|\| system\.articleDisplay \|\| \{\}/)
  assert.match(detail, /display\.expandButtonText/)
  assert.match(detail, /resolvePreviewHeight\(display\)/)
})

test('article list ad slots are counted across paginated pages', () => {
  const source = readMiniappFile('pages/articles/articles.js')
  assert.match(source, /items: markListAdSlots\(items, nativeAd\.firstAfter \|\| 3, nativeAd\.interval \|\| 10\)/)
  assert.doesNotMatch(source, /const incoming = markListAdSlots\(/)
})

test('article list only reloads on first show or explicit pull-to-refresh', () => {
  const source = readMiniappFile('pages/articles/articles.js')
  assert.match(source, /if \(sharedTargetChanged\) this\.loadData\(\{ force: true \}\)\s*else if \(!this\.data\.ready \|\| shouldRefreshAfterBackground(?: \|\| \(this\.startupFallback && !this\.startupFallbackConfigRequested\))?\) \{[\s\S]*?this\.loadData\(\)/)
  assert.match(source, /this\.loadData\(\{ force: true, notify: true \}\)/)
})

test('letters list keeps return navigation from starting a second initial load', () => {
  const source = readMiniappFile('pages/letters/letters.js')
  assert.match(source, /if \(sharedTargetChanged\) this\.loadData\(\{ force: true \}\)\s*else if \(!this\.data\.ready \|\| shouldRefreshAfterBackground\) this\.loadData\(\)/)
  assert.match(source, /if \(this\.loadingRequest\) \{[\s\S]*if \(!options\.force\) return this\.loadingRequest[\s\S]*await this\.loadingRequest[\s\S]*return this\.loadData\(options\)/)
  assert.match(source, /this\.loadData\(\{ force: true, notify: true \}\)/)
})

test('article and letters lists refresh once after a real app background cycle', () => {
  const app = readMiniappFile('app.js')
  assert.match(app, /foregroundVersion: 0/)
  assert.match(app, /if \(this\.appWasHidden\) \{[\s\S]*foregroundVersion \+= 1/)
  assert.match(app, /onHide\(\) \{\s*this\.appWasHidden = true/)
  for (const page of ['articles', 'letters']) {
    const source = readMiniappFile(`pages/${page}/${page}.js`)
    assert.match(source, /onLoad\([\s\S]*?this\.foregroundVersion = getApp\(\)\.globalData\?\.foregroundVersion \|\| 0/)
    assert.match(source, /shouldRefreshAfterBackground = this\.data\.ready && this\.foregroundVersion !== foregroundVersion/)
    if (page === 'articles') {
      assert.match(source, /if \(sharedTargetChanged\) this\.loadData\(\{ force: true \}\)\s*else if \(!this\.data\.ready \|\| shouldRefreshAfterBackground(?: \|\| \(this\.startupFallback && !this\.startupFallbackConfigRequested\))?\) \{[\s\S]*?this\.loadData\(\)/)
    } else {
      assert.match(source, /if \(sharedTargetChanged\) this\.loadData\(\{ force: true \}\)\s*else if \(!this\.data\.ready \|\| shouldRefreshAfterBackground\) this\.loadData\(\)/)
    }
  }
})
