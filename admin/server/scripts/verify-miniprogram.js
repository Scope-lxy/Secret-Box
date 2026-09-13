const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '../../..')
const miniRoot = path.join(projectRoot, 'miniprogram')
const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'))
const issues = []

function readFile(file) {
  return fs.readFileSync(file, 'utf8')
}

function checkFile(file, message) {
  if (!fs.existsSync(file)) issues.push(message)
}

function listFiles(root, suffix) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) return listFiles(file, suffix)
    return entry.name.endsWith(suffix) ? [file] : []
  })
}

for (const page of appConfig.pages || []) {
  const pageRoot = path.join(miniRoot, page)
  for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
    checkFile(`${pageRoot}${extension}`, `页面文件缺失：${page}${extension}`)
  }
  const jsonFile = `${pageRoot}.json`
  if (fs.existsSync(jsonFile) && !String(JSON.parse(readFile(jsonFile)).navigationBarTitleText || '').trim()) {
    issues.push(`页面标题缺失：${page}`)
  }
  const wxmlFile = `${pageRoot}.wxml`
  const jsFile = `${pageRoot}.js`
  if (fs.existsSync(wxmlFile) && fs.existsSync(jsFile)) {
    const wxml = readFile(wxmlFile)
    const js = readFile(jsFile)
    if (!wxml.trimStart().startsWith('<view class="theme {{fontSizeMode === \'max\' ? \'font-max\' : (fontSizeMode === \'larger\' ? \'font-larger\' : \'\')}}">')) {
      issues.push(`页面缺少主题容器或字体模式绑定：${page}`)
    }
    const openingViews = (wxml.match(/<view(?:\s|>)/g) || []).length
    const closingViews = (wxml.match(/<\/view>/g) || []).length
    if (openingViews !== closingViews) {
      issues.push(`页面 view 标签未闭合：${page}`)
    }
    for (const match of wxml.matchAll(/(?:bind|catch)[A-Za-z]*="([A-Za-z_$][\w$]*)"/g)) {
      const method = match[1]
      if (!new RegExp(`(^|\\n)\\s*(?:async\\s+)?${method}\\s*\\(`).test(js)) {
        issues.push(`事件处理函数缺失：${page} -> ${method}`)
      }
    }
    if (/模拟广告|模拟广告未看完|本地占位预览/.test(wxml)) {
      issues.push(`用户页面存在演示文案：${page}`)
    }
    for (const match of wxml.matchAll(/src="(\/assets\/[^"\s}]+)"/g)) {
      checkFile(path.join(miniRoot, match[1].slice(1)), `资源缺失：${page} -> ${match[1]}`)
    }
  }
}

for (const tab of appConfig.tabBar?.list || []) {
  for (const asset of [tab.iconPath, tab.selectedIconPath]) {
    checkFile(path.join(miniRoot, asset), `Tab 图标缺失：${asset}`)
  }
}

const expectedTabBar = [
  ['pages/home/home', '首页'],
  ['pages/articles/articles', '文章'],
  ['pages/letters/letters', '心笺'],
  ['pages/mine/mine', '我的'],
]
const actualTabBar = (appConfig.tabBar?.list || []).map((tab) => [tab.pagePath, tab.text])
if (JSON.stringify(actualTabBar) !== JSON.stringify(expectedTabBar)
  || !appConfig.pages.includes('pages/article/article')) {
  issues.push('小程序页面或 TabBar 未使用首页、文章、心笺、我的的最终顺序')
}

const homeSource = readFile(path.join(miniRoot, 'pages/home/home.js'))
const homeTemplate = readFile(path.join(miniRoot, 'pages/home/home.wxml'))
const homeStyles = readFile(path.join(miniRoot, 'pages/home/home.wxss'))
const articlesSource = readFile(path.join(miniRoot, 'pages/articles/articles.js'))
const articlesTemplate = readFile(path.join(miniRoot, 'pages/articles/articles.wxml'))
const articlesStyles = readFile(path.join(miniRoot, 'pages/articles/articles.wxss'))
const articleSource = readFile(path.join(miniRoot, 'pages/article/article.js'))
const articleTemplate = readFile(path.join(miniRoot, 'pages/article/article.wxml'))
const componentStyles = readFile(path.join(miniRoot, 'styles/components.wxss'))
const mineStyles = readFile(path.join(miniRoot, 'pages/mine/mine.wxss'))
const openedHistoryStyles = readFile(path.join(miniRoot, 'pages/opened-history/opened-history.wxss'))
const favoritesStyles = readFile(path.join(miniRoot, 'pages/favorites/favorites.wxss'))
const expandableTextStyles = readFile(path.join(miniRoot, 'components/expandable-text/expandable-text.wxss'))
const expandToggleStyles = readFile(path.join(miniRoot, 'styles/expand-toggle.wxss'))
const tokenStyles = readFile(path.join(miniRoot, 'styles/tokens.wxss'))
const baseStyles = readFile(path.join(miniRoot, 'styles/base.wxss'))
const miniPostmarkSource = readFile(path.join(miniRoot, 'assets/icons/daily-content-postmark.svg'))
if (!/>等你亲启<\/text>/.test(miniPostmarkSource)) {
  issues.push('小程序邮戳资源未使用最终中心文案')
}
if (!/function getPrivateShareType\(type\)/.test(homeSource)
  || !/const HOME_SHARE_TYPE_ORDER = \['text', 'audio', 'album'\]/.test(homeSource)
  || !/function getHomeShareDailyContentTypes\(dailyContentTypes\)/.test(homeSource)
  || !/getLatestStartupConfig\(\)\?\.config\?\.dailyContentTypes/.test(homeSource)
  || !/function getNextHomeShareType\(dailyContentTypes, startIndex = 0\)/.test(homeSource)
  || !/dailyContentTypes && dailyContentTypes\.imageEnabled !== false/.test(homeSource)
  || !/dailyContentTypes\?\.audioEnabled === true/.test(homeSource)
  || !/const index = \(startIndex \+ offset\) % HOME_SHARE_TYPE_ORDER\.length/.test(homeSource)
  || !/return \{ type, nextIndex: \(index \+ 1\) % HOME_SHARE_TYPE_ORDER\.length \}/.test(homeSource)
  || !/this\.homeShareTypeIndex = 0/.test(homeSource)
  || !/getNextHomeShareType\(getHomeShareDailyContentTypes\(this\.data\.dailyContentTypes\), this\.homeShareTypeIndex\)/.test(homeSource)
  || !/if \(nextHomeShare\) this\.homeShareTypeIndex = nextHomeShare\.nextIndex/.test(homeSource)
  || !/const nextHomeShare = isOpenedDailyContent\s*\? null\s*:\s*getNextHomeShareType/s.test(homeSource)
  || /const nextHomeShare = isOpenedDailyContent \|\| !this\.privateShareCardsReady/.test(homeSource)
  || !/nextHomeShare\?\.type \|\| 'text'/.test(homeSource)
  || !/handleDailyContentPrimaryAction\(\)/.test(homeSource)
  || !/const privateType = getPrivateShareType\(type\)/.test(homeSource)
  || !/const sharePath = `\/pages\/home\/home\?type=\$\{encodeURIComponent\(type\)\}\$\{isOpenedDailyContent \? `&contentId=\$\{encodeURIComponent\(this\.data\.dailyContent\.id\)\}` : ''\}`/.test(homeSource)
  || !/path: sharePath/.test(homeSource)
  || !/promise: cardPromise\.then\(\(card\) => \(\{[\s\S]*path: sharePath/.test(homeSource)) {
  issues.push('手记分享没有按启用类型轮换并匹配模板，或没有安全携带内容类型和已打开内容 ID')
}
if (!/getDailyContentAvailability/.test(homeSource)
  || !/sharedDailyContentChecking/.test(homeSource)
  || !/preflightSharedDailyContent\(\)/.test(homeSource)
  || !/getDailyContentAvailability\(\{ type: target\.type, contentId: target\.contentId \}\)/.test(homeSource)
  || !/disabled="\{\{dailyContentLoading \|\| sharedDailyContentChecking\}\}"/.test(homeTemplate)
  || !/bindtap="handleDailyContentPrimaryAction"/.test(homeTemplate)
  || !/this\.handleOpenDailyContent\('random', '', \{ rewardedConfirmed: true \}\)/.test(homeSource)
  || !/wx\.showModal\(\{\s*title: '内容暂时无法打开',\s*content: '可随机打开另一份',\s*cancelText: '暂不',\s*confirmText: '随机打开',\s*success: \(res\) => \{\s*if \(!res\.confirm \|\| !this\.isCurrentSharedDailyContentTarget\(target\)\) return/s.test(homeSource)
  || /sharedDailyContentFallback/.test(homeTemplate)) {
  issues.push('分享手记失效时缺少广告前校验或原生随机打开兜底弹窗')
}
if (/simulateAdFail|模拟广告未看完/.test(homeSource)) {
  issues.push('首页仍保留模拟广告逻辑')
}
if (/本地占位预览/.test(`${homeSource}\n${articlesSource}\n${articleSource}`)) {
  issues.push('图片预览仍使用演示文案')
}
const defaultCopy = require(path.join(miniRoot, 'utils/default-copy.js'))
const defaultPrompt = defaultCopy.splitDailyContentPrompt()
if (!/pickDailyContentPrompt\(copyPack\.getCopyList\('dailyContentPrompt'\)/.test(homeSource)
  || !/splitDailyContentPrompt\(\)/.test(homeSource)
  || !defaultPrompt.firstLine.endsWith('，') || !defaultPrompt.secondLine
  || defaultPrompt.firstLine + defaultPrompt.secondLine !== defaultCopy.DEFAULT_COPY_PACK.dailyContentPrompt[0]) {
  issues.push('首页缺少手记引导文案池、中文逗号拆分或内置兜底')
}
if (!/dailyContentPrompt\.firstLine/.test(homeTemplate)
  || !/dailyContentPrompt\.secondLine/.test(homeTemplate)
  || !/daily-content-postmark\.svg/.test(homeTemplate)) {
  issues.push('首页未按最终稿展示两行手记引导文案和邮戳')
}
if (!/\.daily-content-prompt\s*\{[^}]*padding-left:\s*8rpx;[^}]*line-height:\s*1\.6;/s.test(homeStyles)) {
  issues.push('首页手记引导文案的缩进或行高不符合最终稿')
}
if (!/\.daily-content-card\s*\{[^}]*padding:\s*var\(--card-padding-y\)\s+var\(--card-padding-x\);/s.test(homeStyles)
  || !/\.daily-content-ready\s*\{[^}]*gap:\s*20rpx;/s.test(homeStyles)
  || !/\.daily-content-ready\s*\{[^}]*padding-bottom:\s*12rpx;/s.test(homeStyles)
  || !/\.daily-content-ready\s+\.button-primary\s*\{[^}]*width:\s*100%;/s.test(homeStyles)) {
  issues.push('首页手记卡片的最终垂直节奏没有同步')
}
if (!/\.article-card\s*\{[^}]*gap:\s*var\(--card-content-gap\);/s.test(articlesStyles)
  || /\.article-card--stacked\s*\{[^}]*gap:/s.test(articlesStyles)
  || !/\.history-card\s*\{[^}]*gap:\s*var\(--card-meta-gap\);/s.test(componentStyles)
  || !/\.history-audio-card\s*\{[^}]*gap:\s*var\(--card-meta-gap\);/s.test(componentStyles)) {
  issues.push('文章与历史卡片的媒体/标签间距没有使用统一语义 token')
}
if (!/\.daily-content-ready-head\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+224rpx;/s.test(homeStyles)
  || !/\.daily-content-ready-intro\s*\{[^}]*min-width:\s*0;[^}]*gap:\s*20rpx;/s.test(homeStyles)) {
  issues.push('首页手记首屏没有使用可收缩的图文布局')
}
if (!/\.sub-prompt\s+\.text\s*\{[^}]*font-size:\s*var\(--type-control\);[^}]*line-height:\s*1\.4;/s.test(homeStyles)
  || !/\.sub-prompt\s+\.small-button\s*\{[^}]*flex:\s*0\s+0\s+168rpx;[^}]*border:\s*0;/s.test(homeStyles)) {
  issues.push('首页提醒区的文案或授权入口样式没有同步')
}
if (!/\.checkin-success\s*\{[^}]*gap:\s*20rpx;/s.test(homeStyles)
  || !/\.checkin-success\s+\.title-lg\s*\{[^}]*font-size:\s*var\(--type-success\);[^}]*font-weight:\s*800;/s.test(homeStyles)) {
  issues.push('打卡成功标题没有使用 Web 的字号和字重')
}
if (!/\.button-primary\s*\{[^}]*min-height:\s*96rpx;/s.test(componentStyles)
  || !/\.button-secondary\s*\{[^}]*min-height:\s*80rpx;/s.test(componentStyles)) {
  issues.push('主按钮或打卡按钮高度没有同步 Web 参数')
}
if (!/\.message-input-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+100rpx;[^}]*gap:\s*var\(--control-gap\);/s.test(componentStyles)
  || !/\.message-input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s.test(componentStyles)
  || !/\.message-input\s*\{[^}]*min-height:\s*80rpx;[^}]*max-height:\s*240rpx;/s.test(componentStyles)
  || !/\.message-submit\s*\{[^}]*width:\s*100rpx;[^}]*min-width:\s*100rpx;[^}]*height:\s*56rpx;[^}]*box-shadow:\s*0\s+16rpx\s+36rpx\s+rgba\(166,\s*107,\s*66,\s*0\.22\);[^}]*white-space:\s*nowrap;/s.test(componentStyles)) {
  issues.push('留言输入区没有保持自适应输入与确认按钮布局')
}
for (const page of ['home', 'letters']) {
  const template = readFile(path.join(miniRoot, `pages/${page}/${page}.wxml`))
  if (!/<textarea[^>]*class="message-input"[^>]*auto-height/.test(template)) {
    issues.push(`${page}页面的留言输入框没有启用自适应高度`)
  }
}

const dailyContentIndex = homeTemplate.search(/class="card card-soft daily-content-card stack(?:\s|\")/)
const checkinIndex = homeTemplate.indexOf('class="card checkin-card"')
const homeStatsIndex = homeTemplate.indexOf('class="stats-row home-stats-row')
const homeNativePlacementIndexes = Object.fromEntries(['dailyContent', 'checkIn', 'stats'].map((placement) => [
  placement,
  homeTemplate.indexOf(`homeNativePlacement === '${placement}' && ads.homeNative.enabled && ads.homeNative.adUnitId`),
]))
if (dailyContentIndex < 0 || checkinIndex < 0 || homeStatsIndex < 0
  || homeNativePlacementIndexes.dailyContent <= dailyContentIndex || homeNativePlacementIndexes.dailyContent >= checkinIndex
  || homeNativePlacementIndexes.checkIn <= checkinIndex || homeNativePlacementIndexes.checkIn >= homeStatsIndex
  || homeNativePlacementIndexes.stats <= homeStatsIndex
  || !/const homeNativePlacement = ads\.homeNative\.placement/.test(homeSource)) {
  issues.push('首页原生广告缺少手记、打卡、统计三处条件展示位置，或没有直接使用后台校验后的展示位置')
}

const lettersListSource = readFile(path.join(miniRoot, 'pages/letters/letters.js'))
const lettersListTemplate = readFile(path.join(miniRoot, 'pages/letters/letters.wxml'))
if (!/home\?\.ads\?\.lettersNative/.test(lettersListSource)
  || !/nativeAd\.firstAfter \|\| 3/.test(lettersListSource)
  || !/nativeAd\.interval \|\| 10/.test(lettersListSource)
  || !/markListAdSlots\(/.test(lettersListSource)
  || !/item\.showNativeAdAfter/.test(lettersListTemplate)) {
  issues.push('心笺没有读取后台原生广告位置，或缺少第 3 条、每 10 条的默认值')
}
if (!/articlesStartNative: ads\.articlesStartNative \|\| \{\}/.test(articleSource)
  || !/articlesEndNative: ads\.articlesEndNative \|\| \{\}/.test(articleSource)
  || !/articleInterstitial: ads\.articleInterstitial \|\| \{\}/.test(articleSource)
  || !/articleExpandRewarded: ads\.articleExpandRewarded \|\| \{\}/.test(articleSource)
  || !/ads\.articlesStartNative\.adUnitId/.test(articleTemplate)
  || !/unlockedToday && ads\.articlesEndNative\.enabled/.test(articleTemplate)) {
  issues.push('文章详情没有完整读取开头、末尾、插屏和全文激励广告配置')
}
if (!/getArticles\(\{[\s\S]*includeId:\s*requestedSharedContentId/.test(articlesSource)
  || !/wx\.navigateTo\(\{\s*url:\s*[`'\"]\/pages\/article\/article\?contentId=\$\{encodeURIComponent\(contentId\)\}/.test(articlesSource)
  || !/getArticle\(this\.contentId\)/.test(articleSource)
  || !/unlockArticle\(\s*this\.contentId\s*(?:,\s*\{[^{}]*\})?\s*\)/.test(articleSource)
  || !/article\.previewHtml/.test(articleTemplate)
  || !/article\.bodyHtml/.test(articleTemplate)) {
  issues.push('文章列表、详情预览或全文解锁没有使用最终 articles 契约')
}

for (const page of ['mine', 'interactions', 'opened-history', 'favorites', 'messages']) {
  const source = readFile(path.join(miniRoot, `pages/${page}/${page}.js`))
  const template = readFile(path.join(miniRoot, `pages/${page}/${page}.wxml`))
  if (!/markListAdSlots\(/.test(source)
    || !/nativeAd\.firstAfter \|\| 3/.test(source)
    || !/nativeAd\.interval \|\| 10/.test(source)
    || !/item\.showNativeAdAfter/.test(template)
    || !/ads\.mineNative\.adUnitId/.test(template)) {
    issues.push(`${page}没有读取我的页面原生广告位置，或缺少第 3 条、每 10 条的默认值`)
  }
  if (page !== 'mine' && (!/ads\.mineInterstitial/.test(source) || !new RegExp(`scheduleInterstitialAd\\([\\s\\S]*'${page}'`).test(source))) {
    issues.push(`${page}没有复用我的页面插屏广告配置或独立展示位置`)
  }
}

const mineStatsTemplate = readFile(path.join(miniRoot, 'pages/mine/mine.wxml'))
const mineTemplateOrder = [
  'summary.totalOpened',
  'summary.interactions',
  'summary.messages',
  'summary.favorites',
].map((needle) => mineStatsTemplate.indexOf(needle))
if (mineTemplateOrder.some((index) => index < 0) || mineTemplateOrder.some((index, i) => i > 0 && index <= mineTemplateOrder[i - 1])) {
  issues.push('我的页面四个统计卡片顺序不是累计打开、互动记录、我的留言、我的收藏')
}

if (!/<view\s+wx:if="\{\{stats\.length\}\}"\s+class="stats-row\s+home-stats-row\s+stats-row--\{\{stats\.length\}\}">/.test(homeTemplate)
  || !/\.stats-row--2\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s.test(componentStyles)
  || !/\.stats-row--1\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s.test(componentStyles)
  || !/\.stat-cell\s*\{[^}]*min-height:\s*128rpx;[^}]*padding:\s*var\(--space-3\)\s+var\(--space-1\);[^}]*gap:\s*var\(--space-2\);/s.test(componentStyles)
  || !/\.stat-value\s*\{[^}]*line-height:\s*1\.1;/s.test(componentStyles)
  || !/\.stat-label\s*\{[^}]*line-height:\s*1\.2;/s.test(componentStyles)
  || !/\.home-stats-row\s+\.stat-cell\s*\{[^}]*min-height:\s*var\(--home-stat-card-min-height\);[^}]*padding:\s*var\(--home-stat-padding-top\)\s+var\(--space-1\)\s+var\(--home-stat-padding-bottom\);[^}]*gap:\s*var\(--home-stat-content-gap\);/s.test(componentStyles)
  || !/\.home-stats-row\s+\.stat-value\s*\{[^}]*font-size:\s*var\(--type-metric\);[^}]*font-weight:\s*650;/s.test(componentStyles)
  || !/\.home-stats-row\s+\.stat-label\s*\{[^}]*font-size:\s*var\(--type-home-stat-detail\);[^}]*font-weight:\s*400;/s.test(componentStyles)
  || !/\.home-stats-row\s+\.stat-unit\s*\{[^}]*font-size:\s*var\(--type-home-stat-detail\);/s.test(componentStyles)
  || !/\.mine-stats-row\s+\.stat-value\s*\{[^}]*font-size:\s*var\(--type-title\);[^}]*font-weight:\s*650;/s.test(componentStyles)
  || !/\.mine-stats-row\s+\.stat-label\s*\{[^}]*font-size:\s*var\(--type-mine-stat-label\);/s.test(componentStyles)
  || !/\.mine-stats-row\s+\.stat-unit\s*\{[^}]*font-size:\s*var\(--type-caption\);/s.test(componentStyles)) {
  issues.push('首页统计项缺少按可见数量重排或首页、我的统计字号参数')
}
const formatSource = readFile(path.join(miniRoot, 'utils/format.js'))
const mineTemplate = readFile(path.join(miniRoot, 'pages/mine/mine.wxml'))
const shareCardSource = readFile(path.join(miniRoot, 'utils/share-card.js'))
const imagePreviewSource = readFile(path.join(miniRoot, 'utils/image-preview.js'))
const { getImageCandidates } = require(path.join(miniRoot, 'utils/image-display.js'))
if (!/function resolveCanvasImagePath\(source, info = \{\}\)/.test(shareCardSource)
  || !/src\.startsWith\('\/assets\/'\) \? src : String\(info\.path \|\| src\)/.test(shareCardSource)
  || /wx\.getFileInfo|wx\.saveFile|wx\.removeSavedFile/.test(shareCardSource)
  || !/wx\.getFileSystemManager\(\)\.getFileInfo\(\{ filePath, success: resolve, fail: reject \}\)/.test(shareCardSource)) {
  issues.push('分享卡片仍可能把内置图片解析成页面相对路径，或使用已弃用的文件缓存 API')
}
if (!/rankToday:\s*'位'/.test(formatSource)
  || !/checkInDays:\s*'天'/.test(formatSource)
  || !/companionValue:\s*'点'/.test(formatSource)
  || !/displayUnit:\s*match\s*\?\s*match\[2\]\s*:\s*fallbackUnits\[item\.key\]\s*\|\|\s*''/.test(formatSource)
  || !/summary\.totalOpened\}\}<\/text><text class="stat-unit">条/.test(mineTemplate)
  || !/summary\.interactions\}\}<\/text><text class="stat-unit">条/.test(mineTemplate)
  || !/summary\.messages\}\}<\/text><text class="stat-unit">条/.test(mineTemplate)
  || !/summary\.favorites\}\}<\/text><text class="stat-unit">条/.test(mineTemplate)) {
  issues.push('首页或我的统计项缺少单位展示')
}
if (!/\.photo-card\s*\{[^}]*aspect-ratio:\s*1;/s.test(componentStyles)
  || !/\.album-shell\s*\{[^}]*position:\s*relative;/s.test(homeStyles)
  || !/\.album-frame\s*\{[^}]*width:\s*100%;[^}]*overflow:\s*hidden;/s.test(homeStyles)
  || !/\.album-photo\s*\{[^}]*min-height:\s*0;/s.test(homeStyles)) {
  issues.push('图片或图册没有使用跨屏稳定比例布局')
}
if (!/<swiper[^>]*current="\{\{currentAlbumIndex\}\}"[^>]*bindchange="handleAlbumChange"/.test(homeTemplate)
  || !/<swiper-item/.test(homeTemplate)
  || !/aspect-ratio:\s*3 \/ 4;/.test(homeStyles)
  || !/class="album-nav album-nav--prev"/.test(homeTemplate)
  || !/class="album-nav album-nav--next"/.test(homeTemplate)) {
  issues.push('首页图册必须使用 3:4 单张大图、原生跟手轮播和左右箭头')
}
if (!/data-image-index="\{\{index\}\}"\s+bindtap="openAlbumPreview"/.test(homeTemplate)
  || !/mode="aspectFill"/.test(homeTemplate)
  || !/openImagePreview\(this, images, index\)/.test(homeSource)) {
  issues.push('首页图册没有按缩略图点击索引、覆盖裁切和原生预览实现')
}
if (!/^@import '..\/..\/styles\/expand-toggle\.wxss';/m.test(expandableTextStyles)
  || !/\.expandable-text__toggle\s*\{[\s\S]*background:\s*var\(--color-card\);/.test(expandToggleStyles)
  || !/\.expandable-text__toggle::before[\s\S]*right:\s*100%;[\s\S]*height:\s*1\.5em;[\s\S]*background:\s*linear-gradient\(90deg, transparent, var\(--color-card\)\);[\s\S]*pointer-events:\s*none;/.test(expandToggleStyles)
  || !/\.expandable-text__toggle\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*bottom:\s*0;/s.test(expandableTextStyles)
  || !/\.expandable-text__toggle\.is-expanded\s*\{[^}]*position:\s*static;[^}]*align-self:\s*flex-end;[^}]*width:\s*auto;/s.test(expandableTextStyles)
  || /expandable-text__fade/.test(readFile(path.join(miniRoot, 'components/expandable-text/expandable-text.wxml')))) {
  issues.push('展开/收起控件未统一导入共享渐变样式，或图册与文本布局约束不完整')
}
if (!/function hasRewardedDailyContentAd/.test(homeSource)
  || !/wx\.showModal\(\{\s*title: '观看广告',\s*content: excludeId\s*\? resolveCopyText\(null, 'changeDailyContentConfirm'\)\s*: resolveCopyText\(null, 'openDailyContentConfirm'\),\s*cancelText: '暂不',\s*confirmText: '去观看',\s*success: \(res\) => \{\s*if \(res\.confirm && canContinueOpening\(\)\)/s.test(homeSource)
  || !/wx\.showModal\(\{\s*title: '观看广告',\s*content: resolveCopyText\(null, 'checkinAdConfirm'\),\s*cancelText: '暂不',\s*confirmText: '去观看',\s*success: \(res\) => \{\s*if \(res\.confirm\)/s.test(homeSource)
  || !/pendingSharedDailyContentType/.test(homeSource)
  || !/excludeId/.test(homeSource)
  || !/openDailyContent\(\{\s*type:\s*requestType,\s*excludeId,\s*contentId:\s*options\.contentId\s*\|\|\s*'',\s*\}\)/.test(homeSource)
  || !/const canContinueOpening = \(\) => isCurrentOperation\(\)/.test(homeSource)) {
  issues.push('手记打开流程没有在广告确认后同时传递排除内容和指定内容参数')
}
if (!/\['album', 'audio'\]\.includes\(item\.type\)/.test(homeSource)
  || !/createInnerAudioContext\(\)/.test(homeSource)
  || !/context\.autoplay\s*=\s*false/.test(homeSource)
  || !/audioContext\.src\s*=\s*url/.test(homeSource)
  || !/String\(item\.title \|\| ''\)\.trim\(\)/.test(homeSource)
  || !/originalFilename.*replace\(\/\\\.\[\^\.\]\+\$\//.test(homeSource)
  || !/<block wx:elif="\{\{dailyContent\.isAudio\}\}">/.test(homeTemplate)
  || !/class="audio-player/.test(homeTemplate)
  || !/data-share="audio"/.test(homeTemplate)
  || !/\.audio-player\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*36rpx;/s.test(homeStyles)
  || !/\.audio-control-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+64rpx\s+112rpx;/s.test(homeStyles)
  || !/\.audio-tick\.is-long\s*\{[^}]*height:\s*24rpx;/s.test(homeStyles)
  || !/\.audio-tick\.is-short\s*\{[^}]*height:\s*16rpx;/s.test(homeStyles)) {
  issues.push('首页今日音频缺少 V3 播放器、手动播放或分享类型实现')
}
for (const page of ['mine', 'opened-history']) {
  const source = readFile(path.join(miniRoot, `pages/${page}/${page}.js`))
  const template = readFile(path.join(miniRoot, `pages/${page}/${page}.wxml`))
  if (!/previewHistoryImage/.test(source)
    || !/openImagePreview\(this, item\.images, event\.currentTarget\.dataset\.imageIndex\)/.test(source)
    || !/item\.images\.length/.test(template)
    || !/scroll-view[^>]*scroll-x[^>]*class="history-image-grid"/.test(template)
    || !/class="history-image-track"/.test(template)) {
    issues.push(`${page}没有展示并预览打开记录中的图册缩略图`)
  }
  if (!/createHistoryAudioPlayer/.test(source)
    || !/toggleHistoryAudio/.test(source)
    || !/item\.isAudio/.test(template)
    || !/item\.audioTitle/.test(template)
    || !/class="history-audio-player"/.test(template)
    || !/audio-play\.svg/.test(template)
    || !/audio-pause\.svg/.test(template)) {
    issues.push(`${page}缺少可播放的今日音频打开记录卡片`)
  }
}
const historyAudioSource = readFile(path.join(miniRoot, 'utils/history-audio.js'))
if (!/createInnerAudioContext\(\)/.test(historyAudioSource)
  || !/context\.autoplay\s*=\s*false/.test(historyAudioSource)
  || !/context\.src\s*=\s*url/.test(historyAudioSource)
  || !/context\.onTimeUpdate/.test(historyAudioSource)) {
  issues.push('打开记录音频播放器缺少真实流式播放实现')
}
const immersiveNavTemplate = readFile(path.join(miniRoot, 'components/immersive-nav/immersive-nav.wxml'))
const immersiveNavStyles = readFile(path.join(miniRoot, 'components/immersive-nav/immersive-nav.wxss'))
if (!/chevron-left\.svg/.test(immersiveNavTemplate)
  || /[‹›]/.test(`${immersiveNavTemplate}\n${homeTemplate}`)
  || !/\.back-icon\s*\{[^}]*width:\s*40rpx;[^}]*height:\s*40rpx;/s.test(immersiveNavStyles)) {
  issues.push('返回或图册箭头仍使用文字字号而非图标资源')
}
if (!/wx:if="\{\{back\}\}"\s+class="immersive-nav-placeholder"[^>]*navTotalHeight/.test(immersiveNavTemplate)
  || !/back\s*\?\s*'immersive-nav--fixed'/.test(immersiveNavTemplate)
  || !/\.immersive-nav--fixed\s*\{[^}]*position:\s*fixed;[^}]*top:\s*0;[^}]*left:\s*0;[^}]*right:\s*0;/s.test(immersiveNavStyles)) {
  issues.push('二级页面顶部导航没有固定，或内容区缺少等高占位')
}
if (/album-caption|photo-label/.test(`${homeTemplate}\n${articlesTemplate}\n${articleTemplate}`)) {
  issues.push('用户页面仍展示图片素材标签')
}
if (!/\.calendar-day\s*\{[^}]*gap:\s*0rpx;/s.test(homeStyles)
  || /\.calendar-date\s*\{[^}]*margin-top:/s.test(homeStyles)
  || !/\.stat-value\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*4rpx;/s.test(componentStyles)
  || /\.stat-unit\s*\{[^}]*margin-left:/s.test(componentStyles)
  || !/\.daily-content-postmark\s*\{[^}]*transform:\s*translate\(22\.2rpx,\s*-24rpx\)\s+rotate\(-6deg\);/s.test(homeStyles)
  || /\.daily-content-postmark\s*\{[^}]*margin:/s.test(homeStyles)) {
  issues.push('组件内部间距没有统一由 gap 或定位变换控制')
}
if (!/\.action-pill\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;[^}]*gap:\s*8rpx;[^}]*white-space:\s*nowrap;/s.test(componentStyles)
  || !/\.action-button\s*\{[^}]*padding:\s*0;/s.test(componentStyles)
  || !/\.sub-prompt\s+\.text\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;/s.test(componentStyles)
  || !/\.stat-cell\s*\{[^}]*min-width:\s*0;/s.test(componentStyles)) {
  issues.push('窄屏内容区缺少可收缩约束')
}
if (!/\.profile-copy\s*\{[^}]*gap:\s*var\(--space-2\);/s.test(mineStyles)
  || !/\.profile-copy\s+\.title-lg\s*\{[^}]*font-size:\s*var\(--type-metric\);[^}]*font-weight:\s*600;/s.test(mineStyles)) {
  issues.push('个人页昵称区没有同步 Web 的字号、字重或间距')
}
const profileStyles = readFile(path.join(miniRoot, 'pages/profile/profile.wxss'))
const profileTemplate = readFile(path.join(miniRoot, 'pages/profile/profile.wxml'))
const profileSource = readFile(path.join(miniRoot, 'pages/profile/profile.js'))
if (!/\.save-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*100%;[^}]*align-self:\s*stretch;/s.test(profileStyles)) {
  issues.push('个人资料保存按钮没有保持全宽')
}
if (!/<button\s+class="profile-phone-button"\s+open-type="getPhoneNumber"\s+bindgetphonenumber="handleGetPhoneNumber">/.test(profileTemplate)
  || !/form\.phone\s*\?\s*'重新获取'\s*:\s*'快速授权'/.test(profileTemplate)
  || /wx:if="\{\{!form\.phone\}\}"/.test(profileTemplate)
  || !/hadPhone\s*\?\s*'手机号已更新'/.test(profileSource)) {
  issues.push('个人资料页在已有手机号时无法重新调用微信手机号组件')
}
const minePageSource = readFile(path.join(miniRoot, 'pages/mine/mine.js'))
const lettersSource = readFile(path.join(miniRoot, 'pages/letters/letters.js'))
const lettersTemplate = readFile(path.join(miniRoot, 'pages/letters/letters.wxml'))
if (!/class="title-lg"\s+bindtap="goProfile"/.test(mineTemplate)
  || !/class="settings-link"\s+bindtap="goSettings"/.test(mineTemplate)
  || !/goProfile\(\)\s*\{\s*wx\.navigateTo/.test(minePageSource)) {
  issues.push('我的页面昵称没有保留设置入口并进入个人资料页')
}
if (!/previousAvatar\s*=\s*\{[\s\S]*avatarUrl:\s*this\.data\.form\.avatarUrl/.test(profileSource)
  || !/'form\.avatarUrl':\s*previousAvatar\.avatarUrl/.test(profileSource)) {
  issues.push('头像上传失败后没有回滚本地预览')
}
if (!/\['text', 'image', 'audio'\]/.test(homeSource)) {
  issues.push('私密分享卡没有预热音频类型')
}
if (JSON.stringify(getImageCandidates({ mediumUrl: 'medium', thumbUrl: 'thumb', originalUrl: 'original' })) !== JSON.stringify(['medium', 'thumb', 'original'])
  || !/getImageCandidates\((?:sourceImages\[index\]|image), 'medium'\)/.test(imagePreviewSource)
  || !/await resolvePreviewImageUrls/.test(imagePreviewSource)
  || !/wx\.previewImage/.test(imagePreviewSource)
  || !/downloadTask\?\.abort/.test(imagePreviewSource)) {
  issues.push('图册预览未按中图、小图、原图顺序验证可用性或缺少超时处理')
}
for (const [page, source, template] of [
  ['home', homeSource, homeTemplate],
  ['letters', lettersSource, lettersTemplate],
]) {
  const isHome = page === 'home'
  const submitting = isHome ? 'messageSubmitting' : 'item.messageSubmitting'
  const guard = isHome
    ? 'if (this.data.messageSubmitting || this.data.messageDeleting) return'
    : 'if (!item || item.messageSubmitting || item.messageDeleting) return'
  const messageButtons = template.match(/<button\b[^>]*class="message-submit[^>]*>[\s\S]*?<\/button>/g) || []
  const loadingDots = `<view wx:if="{{${submitting}}}" class="button-loading-dots button-loading-dots--light"><view></view><view></view><view></view></view>`
  const loadingLabel = `aria-label="{{${submitting} ? '正在提交留言' : '确认留言'}}"`
  if (!source.includes(guard)
    || !/submitPrivateMessage/.test(source)
    || !/wx\.showToast\(\{ title: error\.message \|\| '留言失败/.test(source)
    || !messageButtons.length
    || messageButtons.some((button) => !button.includes(`class="message-submit {{${submitting} ? 'is-loading' : ''}}"`)
      || !button.includes(loadingLabel)
      || !new RegExp(`disabled="\\{\\{${submitting}(?:\\s*\\|\\|[^}]*)?\\}\\}"`).test(button)
      || !button.includes(loadingDots)
      || !button.includes('<text wx:else>确认</text>')
      || /\sloading=|提交中/.test(button))) {
    issues.push(`${page}页面留言缺少提交锁定或失败提示`)
  }
}
if (!/\.button-loading-dots\s*\{[^}]*height:\s*18rpx;[^}]*align-items:\s*center;/s.test(componentStyles)
  || !/\.button-loading-dots\s*>\s*view\s*\{[^}]*animation:\s*button-dot-pulse\s+0\.9s\s+ease-in-out\s+infinite;/s.test(componentStyles)
  || !/@keyframes\s+button-dot-pulse\s*\{\s*0%,\s*100%\s*\{\s*opacity:\s*0\.32;\s*transform:\s*translateY\(4rpx\);\s*\}\s*50%\s*\{\s*opacity:\s*1;\s*transform:\s*translateY\(-4rpx\);\s*\}/s.test(componentStyles)
  || /message-submit-dot-pulse|\.message-submit\s+\.button-loading-dots/.test(componentStyles)) {
  issues.push('手记、打卡和留言的加载三点没有复用固定轨道的对称位移动画')
}
const settingsTemplate = readFile(path.join(miniRoot, 'pages/settings/settings.wxml'))
const settingsStyles = readFile(path.join(miniRoot, 'pages/settings/settings.wxss'))
if (!/class="page plain-page settings-page"/.test(settingsTemplate)
  || !/\.settings-page\s*\{[^}]*padding-bottom:\s*calc\(80rpx\s*\+\s*var\(--space-6\)\s*\+\s*var\(--space-3\)\s*\+\s*env\(safe-area-inset-bottom\)\);/s.test(settingsStyles)
  || !/\.settings-delete-button\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*calc\(var\(--space-6\)\s*\+\s*env\(safe-area-inset-bottom\)\);[^}]*width:\s*320rpx;/s.test(settingsStyles)) {
  issues.push('设置页注销账号按钮没有固定在底部，或内容区缺少安全间距')
}
if (!/^\.theme\s*\{/m.test(tokenStyles) || !/^\.theme\s*\{/m.test(baseStyles)) {
  issues.push('主题变量或基础样式没有挂在页面主题容器上')
}
if (/^\s*(?:page|view|text|image|button|textarea|input|switch)(?:::[\w-]+)?\s*(?:,|\{)/m.test(`${tokenStyles}\n${baseStyles}`)) {
  issues.push('全局样式仍包含会触发组件编译告警的标签选择器')
}

if (!/action-heart-active\.svg/.test(lettersTemplate) || !/action-bookmark-active\.svg/.test(lettersTemplate)) {
  issues.push('心笺的点赞或收藏选中态图标缺失')
}

for (const [page, asset] of [
  ['messages', 'empty-message.svg'],
  ['favorites', 'empty-bookmark.svg'],
  ['interactions', 'empty-record.svg'],
  ['opened-history', 'empty-record.svg'],
]) {
  const template = readFile(path.join(miniRoot, `pages/${page}/${page}.wxml`))
  if (!new RegExp(asset.replace('.', '\\.')).test(template)) {
    issues.push(`${page}缺少与 Web 一致的空状态资源`)
  }
}

const typographyTokens = [
  ['--type-tab', '22rpx'],
  ['--type-caption', '24rpx'],
  ['--type-assist', '26rpx'],
  ['--type-control', '30rpx'],
  ['--type-body', '32rpx'],
  ['--type-section', '34rpx'],
  ['--type-prompt', '34rpx'],
  ['--type-title', '36rpx'],
  ['--type-metric', '38rpx'],
  ['--type-success', '40rpx'],
  ['--type-hero', '44rpx'],
]
if (!typographyTokens.every(([name, miniValue]) => (
  new RegExp(`${name}:\\s*${miniValue};`).test(tokenStyles)
))) {
  issues.push('小程序的字体语义 Token 缺失或默认字号不符合最终稿')
}
const miniTypographySource = listFiles(miniRoot, '.wxss').map(readFile).join('\n')
if (/font-size:\s*\d+(?:rpx|px)/.test(miniTypographySource)) {
  issues.push('正式页面仍存在未登记的裸字号')
}
if (!/--space-3:\s*24rpx;[\s\S]*--space-4:\s*32rpx;/.test(tokenStyles)
  || !/\.daily-content-postmark\s*\{[^}]*width:\s*216rpx;/s.test(homeStyles)
  || !/\.daily-content-prompt\s*\{[^}]*padding-left:\s*8rpx;[^}]*font-size:\s*var\(--type-daily-content-prompt\);[^}]*line-height:\s*1\.6;/s.test(homeStyles)
  || !/\.button-primary\s*\{[^}]*min-height:\s*96rpx;/s.test(componentStyles)) {
  issues.push('小程序的最终视觉参数不一致')
}
if (!/\.stats-row--2\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s.test(componentStyles)
  || !/\.home-stats-row \.stat-value\s*\{[^}]*font-size:\s*var\(--type-metric\);[^}]*font-weight:\s*650;/s.test(componentStyles)
  || !/\.home-stats-row \.stat-label\s*\{[^}]*font-size:\s*var\(--type-home-stat-detail\);[^}]*line-height:\s*var\(--home-stat-label-line-height\);/s.test(componentStyles)
  || !/\.mine-stats-row \.stat-value\s*\{[^}]*font-size:\s*var\(--type-title\);[^}]*font-weight:\s*650;/s.test(componentStyles)) {
  issues.push('首页统计项没有按可见数量重排或统计字号没有同步')
}
if (!/openImagePreview\(this, images, index\)/.test(homeSource)) {
  issues.push('图册没有按缩略图点击索引、覆盖裁切和完整图片预览实现')
}
const requiredPages = [
  'pages/home/home',
  'pages/letters/letters',
  'pages/mine/mine',
  'pages/messages/messages',
  'pages/favorites/favorites',
  'pages/interactions/interactions',
  'pages/opened-history/opened-history',
  'pages/settings/settings',
  'pages/legal/agreement/agreement',
  'pages/profile/profile',
]
for (const miniPage of requiredPages) {
  if (!appConfig.pages.includes(miniPage)) {
    issues.push(`小程序页面配置缺失：${miniPage}`)
  }
}

for (const page of [
  'pages/messages/messages',
  'pages/favorites/favorites',
  'pages/interactions/interactions',
  'pages/opened-history/opened-history',
  'pages/settings/settings',
  'pages/profile/profile',
  'pages/legal/agreement/agreement',
  'pages/preferences/subscription/subscription',
]) {
  const template = readFile(path.join(miniRoot, `${page}.wxml`))
  const hasExpectedTitleVisibility = page === 'pages/messages/messages'
    ? /show-title="\{\{messagesEnabled\}\}"/.test(template)
    : /show-title="\{\{true\}\}"/.test(template)
  if (!/immersive-nav\s+variant="plain"[^>]*back="\{\{true\}\}"/.test(template)
    || !hasExpectedTitleVisibility
    || !/class="page plain-page/.test(template)) {
    issues.push(`二级页面没有保持统一的微信返回与内容安全区：${page}`)
  }
}

for (const page of [
  'pages/letters/letters',
  'pages/articles/articles',
  'pages/article/article',
  'pages/mine/mine',
  'pages/messages/messages',
  'pages/favorites/favorites',
  'pages/interactions/interactions',
  'pages/opened-history/opened-history',
  'pages/profile/profile',
]) {
  const source = readFile(path.join(miniRoot, `${page}.js`))
  const template = readFile(path.join(miniRoot, `${page}.wxml`))
  if (!/error:\s*''/.test(source) || !/state-card/.test(template) || !/\{\{error/.test(template)) {
    issues.push(`页面缺少统一的错误状态：${page}`)
  }
}

for (const page of ['home', 'letters']) {
  const template = readFile(path.join(miniRoot, `pages/${page}/${page}.wxml`))
  if (!/liked\s*\?\s*'active'/.test(template) || !/favorited\s*\?\s*'active'/.test(template)
    || !/action-heart-active\.svg/.test(template) || !/action-bookmark-active\.svg/.test(template)) {
    issues.push(`${page}的互动选中态缺少颜色和资源切换`)
  }
  if (!/(?:likeCount\s*>\s*0\s*\?\s*(?:dailyContent|item)\.likeCount\s*:\s*'点赞'|(?:dailyContent|item)\.displayLikeCount\s*\|\|\s*'点赞')/.test(template)) {
    issues.push(`${page}的零点赞状态没有显示点赞文案`)
  }
  if (!/(?:favoriteCount\s*>\s*0\s*\?\s*(?:dailyContent|item)\.favoriteCount\s*:\s*'收藏'|(?:dailyContent|item)\.displayFavoriteCount\s*\|\|\s*'收藏')/.test(template)) {
    issues.push(`${page}的零收藏状态没有显示收藏文案`)
  }
}

const customTabBarSource = readFile(path.join(miniRoot, 'custom-tab-bar/index.js'))
const customTabBarStyles = readFile(path.join(miniRoot, 'custom-tab-bar/index.wxss'))
if (!/selectedTab\s*&&\s*!selectedTab\.visible/.test(customTabBarSource)) {
  issues.push('自定义 TabBar 会错误拦截普通二级页面')
}
if (!/\.page\s*\{[^}]*padding:\s*var\(--page-padding\)\s+var\(--page-padding\)\s+var\(--tab-safe-padding\);/s.test(baseStyles)
  || !/\.custom-tabbar\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;[^}]*height:\s*calc\(112rpx\s*\+\s*env\(safe-area-inset-bottom\)\);/s.test(customTabBarStyles)
  || /\.page\s*\{[^}]*\n\s*height\s*:\s*(?!auto)/s.test(baseStyles)) {
  issues.push('页面或 TabBar 缺少短屏安全区和自然内容流保护')
}

const appSource = readFile(path.join(miniRoot, 'app.js'))
const immersiveNavSource = readFile(path.join(miniRoot, 'components/immersive-nav/immersive-nav.js'))
if (/getSystemInfoSync/.test(appSource) || /getSystemInfoSync/.test(immersiveNavSource)) {
  issues.push('导航安全区仍使用已弃用的系统信息接口')
}
if (!/wx\.getWindowInfo\(\)/.test(immersiveNavSource)
  || !/wx\.getMenuButtonBoundingClientRect\(\)/.test(immersiveNavSource)
  || !/statusBarHeight/.test(immersiveNavSource)
  || !/navHeight/.test(immersiveNavSource)
  || !/navTotalHeight:\s*statusBarHeight\s*\+\s*navHeight/.test(immersiveNavSource)) {
  issues.push('沉浸式导航没有根据设备状态栏和胶囊位置动态计算')
}

for (const viewportWidth of [320, 375, 430]) {
  const rpx = viewportWidth / 750
  const pageContentWidth = viewportWidth - 48 * rpx
  const cardContentWidth = pageContentWidth - 64 * rpx
  const contentTextWidth = cardContentWidth - 160 * rpx - 32 * rpx
  const promptCopyWidth = cardContentWidth - 64 * rpx - 168 * rpx - 16 * rpx
  const checkinCopyWidth = cardContentWidth - 176 * rpx - 32 * rpx
  const actionWidth = (cardContentWidth - 3 * 16 * rpx) / 4
  const statWidth = (pageContentWidth - 3 * 16 * rpx) / 4
  const albumFrameWidth = cardContentWidth

  if (contentTextWidth < 160 || promptCopyWidth < 140 || checkinCopyWidth < 160
    || actionWidth < 52 || statWidth < 56 || albumFrameWidth < 185) {
    issues.push(`宽度 ${viewportWidth}px 下的首页内容或操作区可用空间不足`)
  }
}

const serverEnvSource = readFile(path.join(projectRoot, 'admin/server/src/config/env.js'))
if (/process\.env\.WECHAT_APP_(?:ID|SECRET)|wechat\s*:/.test(serverEnvSource)) {
  issues.push('服务端仍允许通过环境变量配置微信凭据')
}

const adminSettingsSource = readFile(path.join(projectRoot, 'admin/server/src/modules/admin/admin-settings.store.js'))
if (/appSecret:\s*'[^']+'/.test(adminSettingsSource) || /secret(?:Id|Key):\s*'[^']+'/.test(adminSettingsSource)) {
  issues.push('服务端默认配置不能包含明文密钥')
}

const serverGitignore = readFile(path.join(projectRoot, 'admin/server/.gitignore'))
if (!/^data\/\*\.json$/m.test(serverGitignore)
  || !/^data\/\*\.sqlite$/m.test(serverGitignore)
  || !/^\.env$/m.test(serverGitignore)) {
  issues.push('服务端运行数据或环境文件没有被 Git 忽略')
}

const legacyBusinessDataFiles = [
  'accounts.json',
  'admin-auth.json',
  'admin-settings.json',
  'analytics.json',
  'checkin.json',
  'content.json',
  'images.json',
  'interactions.json',
  'messages.json',
  'miniapp-sessions.json',
]
for (const file of legacyBusinessDataFiles) {
  if (fs.existsSync(path.join(projectRoot, 'admin/server/data', file))) {
    issues.push(`服务端仍保留旧业务 JSON 数据文件：${file}`)
  }
}

const mineSource = readFile(path.join(miniRoot, 'pages/mine/mine.js'))
if (!/wx\.navigateTo\(\{\s*url:\s*'\/pages\/favorites\/favorites'\s*\}\)/.test(mineSource)) {
  issues.push('我的收藏入口没有使用普通页面跳转')
}

if (issues.length) {
  console.error(issues.join('\n'))
  process.exit(1)
}

console.log(`MINIPROGRAM_STATIC_CHECK_OK pages=${appConfig.pages.length}`)
