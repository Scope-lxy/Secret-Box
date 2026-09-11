const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const adminSource = path.resolve(__dirname, '../admin/src')
const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
const script = fs.readFileSync(path.join(adminSource, 'article-manager.js'), 'utf8')
const main = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
const importer = fs.readFileSync(path.join(adminSource, 'import.js'), 'utf8')
const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')
const routesSource = fs.readFileSync(path.resolve(__dirname, '../src/routes.js'), 'utf8')

test('admin article manager exposes the required article fields and reading preview', () => {
  ;[
    'articleTitleInput',
    'articleCoverInput',
    'articleBodyEditor',
    'articlePublishAtInput',
    'articlePreviewModal',
  ].forEach((id) => assert.match(markup, new RegExp(`id="${id}"`)))
  assert.match(markup, /<textarea class="article-body-editor article-import-markdown-editor" id="articleBodyEditor"/)
  assert.match(markup, /aria-label="文章正文（Markdown）"/)
  assert.doesNotMatch(markup, /articleEditorToolbar|data-article-command|contenteditable/)
  assert.match(script, /bodyMarkdown/)
  assert.match(script, /body: JSON\.stringify\(\{ \.\.\.currentContext\(\), article: payload \}\)/)
  assert.match(script, /method: 'POST'/)
  assert.match(script, /coverImage: coverImageId \? selectedCoverImage\(\) : null/)
  assert.match(script, /label: previous\.label \|\| '默认'/)
  assert.doesNotMatch(`${markup}\n${script}`, /articleSummaryInput|articleRecommendedInput|data-article-excerpt|data-article-recommended/)
  assert.doesNotMatch(`${markup}\n${script}`, /保存草稿|articleStatusFilter|articleSearchInput|method: 'PUT'/)
})

test('文章编辑器允许空作者并使用统一兜底，导入发布仍校验作者', () => {
  assert.match(markup, /id="articleAuthorInput"[^>]*aria-label="文章作者"[^>]*placeholder="请输入文章作者（可留空）"/)
  assert.match(script, /const author = nodes\.author\.value\.trim\(\) \|\| '轻读手记'/)
  assert.match(script, /缺少作者 \$\{missingAuthor\} 篇，请编辑补充/)
  assert.match(script, /未识别到作者，请编辑补充后再导入/)
  assert.match(script, /请先为所有文章补充作者信息/)
  assert.match(routesSource, /item\.author = String\(item\.author \|\| ''\)\.trim\(\) \|\| '轻读手记'/)
})

test('article display settings use the three-layout global contract and deterministic mixed layout', () => {
  ;['title-left', 'stacked', 'mixed'].forEach((layout) => {
    assert.match(markup, new RegExp(`<option value="${layout}"`))
  })
  assert.doesNotMatch(markup, /value="cover-left"/)
  assert.match(markup, /value="title-left">常规卡片/)
  assert.match(markup, /value="stacked">大图卡片/)
  assert.match(markup, /value="mixed">混搭模式/)
  assert.match(markup, /option value="earliest">最早（10vh）<\/option>/)
  assert.match(markup, /option value="early" selected>较早（20vh）<\/option>/)
  assert.match(markup, /option value="medium">适中（30vh）<\/option>/)
  assert.match(markup, /option value="late">较后（40vh）<\/option>/)
  assert.match(markup, /option value="latest">最晚（50vh）<\/option>/)
  ;['earliest', 'early', 'medium', 'late', 'latest'].forEach((preset) => {
    assert.match(markup, new RegExp(`<option value="${preset}"`))
  })
  assert.match(markup, /id="articleHideFullArticle"[\s\S]*option value="hidden"[\s\S]*option value="visible"/)
  assert.match(markup, /<label for="articleHideFullArticle">文章详情页默认状态<\/label>/)
  assert.doesNotMatch(markup, /value="custom"|articleExpandCustomRpx|articleLayoutPreview|文章列表布局预览/)
  assert.ok(markup.indexOf('id="system"') < markup.indexOf('id="articleDisplaySettingsSaveBtn"'))
  assert.doesNotMatch(markup.slice(markup.indexOf('id="content"'), markup.indexOf('id="import"')), /文章展示设置/)
  assert.match(main, /articleDisplay: \{[\s\S]*expandButtonText:[\s\S]*previewPreset:[\s\S]*hideFullArticle:/)
  assert.match(main, /articleDisplay\.previewPreset\) \? articleDisplay\.previewPreset : 'early'/)
  assert.match(main, /nodes\.articleHideFullArticle\.value = articleDisplay\.hideFullArticle === false \? 'visible' : 'hidden'/)
  assert.doesNotMatch(main, /previewHeightRpx|articleExpandCustomRpx|articleLayoutPreview|renderArticleLayoutPreview/)
  assert.match(main, /saveMiniProgramRequest\('\/api\/admin\/miniprogram\/config'/)
  assert.doesNotMatch(script, /articleDisplay|articleStartAdEnabled|articleEndAdEnabled|articleInterstitialEnabled|articleExpandRewardedEnabled/)
  assert.doesNotMatch(styles, /article-layout-preview|article-layout-sample/)
})

test('article ads and URL import use only the new article contract', () => {
  ;['articlesNative', 'articlesInterstitial', 'articlesStartNative', 'articlesEndNative', 'articleInterstitial', 'articleExpandRewarded'].forEach((key) => {
    assert.match(`${main}\n${script}`, new RegExp(key))
  })
  assert.match(markup, /id="articleImportUrls"[\s\S]*每行粘贴一个 mp\.weixin\.qq\.com/)
  assert.match(script, /split\(\/\\r\?\\n\/\)/)
  assert.match(script, /\/import\/\$\{encodeURIComponent\(state\.importJobId\)\}\/publish/)
  assert.doesNotMatch(script, /importStatusLabel/)
  assert.match(script, /data-import-retry=/)
  assert.match(script, /\/import\/\$\{encodeURIComponent\(state\.importJobId\)\}\/retry/)
  assert.match(script, /body: JSON\.stringify\(\{ selectedIds, restoreTailIds, editedItems \}\)/)
  assert.match(markup, /id="articlePreviewRemovedSection"/)
  assert.match(script, /removedTailHtml/)
  assert.match(script, /restoreTailIds/)
  assert.match(script, /item\.duplicate \? 'duplicate'/)
  assert.doesNotMatch(script, /articleIds|\/batch-delete|\/articles\/settings/)
  ;['articleStartAdEnabled', 'articleEndAdEnabled', 'articleInterstitialEnabled', 'articleExpandRewardedEnabled'].forEach((id) => {
    assert.doesNotMatch(markup, new RegExp(`id="${id}"`))
  })
  assert.doesNotMatch(`${markup}\n${main}\n${importer}\n${script}`, /diary|日记/)
})

test('article import starts blank on every entry and keeps complete per-URL progress in the active view', () => {
  assert.doesNotMatch(script, /sessionStorage\.setItem|sessionStorage\.getItem|readStoredImportJobId|rememberImportJobId/)
  assert.match(script, /function resetImportWorkspace\(\)[\s\S]*state\.importJobId = ''[\s\S]*state\.importItems = \[\][\s\S]*nodes\.importUrls\.value = ''/)
  assert.match(script, /function openArticleImport\(\)\s*\{\s*resetImportWorkspace\(\)/)
  assert.match(script, /key\?\.startsWith\('secretbox:article-import:'\)/)
  assert.match(script, /const entries = Array\.isArray\(result\.entries\) \? result\.entries : \[\]/)
  assert.match(script, /state\.importProgress = result\.progress \|\| state\.importProgress/)
  assert.match(script, /if \(state\.importQueryFailed && state\.importJobId\) pollImportJob\(\)/)
  assert.match(script, /item\.mediaWarnings/)
  assert.match(script, /恢复已移除文字/)
  assert.match(script, /导入时保留已移除文字（图片不会恢复）/)
  assert.doesNotMatch(script, /恢复尾部|发布时保留原尾部/)
})

test('editor body preview refresh does not replace the title and cover header', () => {
  const start = script.indexOf('function scheduleEditorBodyPreview')
  const end = script.indexOf('function openEditor', start)
  const source = script.slice(start, end)
  assert.match(source, /nodes\.editorPreviewBody\.innerHTML = result\.renderedHtml \|\| ''/)
  assert.doesNotMatch(source, /nodes\.editorPreviewHeader\.innerHTML/)
})

test('article ad editor keeps all six placements when older responses omit new keys', () => {
  assert.match(main, /const articleAdEditorDefaults = \{[\s\S]*articlesNative:[\s\S]*articlesInterstitial:[\s\S]*articleExpandRewarded:[\s\S]*articleInterstitial:[\s\S]*articlesStartNative:[\s\S]*articlesEndNative:/)
  assert.match(main, /articlesStartNative: \{[^\n]*label: '文章详情开头广告'/)
  assert.match(main, /articlesEndNative: \{[^\n]*label: '文章详情正文广告'/)
  assert.match(main, /function mergeArticleAdEditorItems\(items = \{\}\)/)
  assert.match(main, /const editorItems = mergeArticleAdEditorItems\(items\)/)
  assert.match(main, /const editorSource = group === 'ads' \? mergeArticleAdEditorItems\(source\)/)
  assert.match(main, /const listNativeAdKeys = new Set\(\['lettersNative', 'articlesNative', 'mineNative'\]\)/)
  assert.match(main, /const isListNative = \['lettersNative', 'articlesNative', 'mineNative'\]\.includes\(key\)/)
})

test('article rewarded ad incomplete copy is configurable through system settings', () => {
  assert.match(markup, /data-system-field="articleAdIncompleteText" value="完整观看广告后，即可展开全文"/)
  assert.match(main, /data-system-field="articleAdIncompleteText"\]\'\)\?\.value\.trim\(\) \|\| ''/)
})

test('article layout belongs to global settings while article reading fields stay together', () => {
  const cardStart = markup.indexOf('<h3>文章设置</h3>')
  const cardEnd = markup.indexOf('</div>\n            </div>', cardStart)
  const card = markup.slice(cardStart, cardEnd)
  const fields = [
    'id="articleExpandText"',
    'data-system-field="articleAdIncompleteText"',
    'id="articleExpandPosition"',
  ].map((field) => card.indexOf(field))
  assert.ok(fields.every((index) => index >= 0))
  assert.deepEqual([...fields].sort((a, b) => a - b), fields)
  assert.match(card, /<label for="articleExpandPosition">展开按钮位置<\/label>/)
  assert.doesNotMatch(card, /articleListLayout|文章列表布局/)

  const globalStart = markup.indexOf('<h3>全局设置</h3>')
  const globalEnd = markup.indexOf('<h3>文章设置</h3>')
  const globalCard = markup.slice(globalStart, globalEnd)
  assert.ok(globalCard.indexOf('id="articleListLayout"') >= 0)
  assert.ok(globalCard.indexOf('id="articleListLayout"') < globalCard.indexOf('data-system-field="lettersSortMode"'))
  assert.match(styles, /\.form-grid\.article-settings-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)

  const articleSave = main.slice(main.indexOf('async function saveArticleDisplaySettings()'), main.indexOf('function setSecretVisibilityById'))
  const globalCollect = main.slice(main.indexOf('function collectGlobalFeatureRules()'), main.indexOf('async function saveGlobalFeatureRules()'))
  assert.doesNotMatch(articleSave, /nodes\.articleListLayout/)
  assert.match(globalCollect, /articleDisplay: \{[\s\S]*?layout: \['title-left', 'stacked', 'mixed'\]\.includes\(nodes\.articleListLayout\?\.value\)/)
})

test('global settings keep feature order and hand-note limit in the hand-note card', () => {
  const globalStart = markup.indexOf('<h3>全局设置</h3>')
  const globalEnd = markup.indexOf('<h3>文章设置</h3>')
  const globalCard = markup.slice(globalStart, globalEnd)
  const globalFields = [
    'data-daily-content-type-field="imageEnabled"',
    'data-daily-content-type-field="audioEnabled"',
    'data-feature-field="messagesEnabled"',
    'id="articleListLayout"',
    'data-system-field="articlesSortMode"',
    'data-system-field="lettersSortMode"',
  ].map((field) => globalCard.indexOf(field))
  assert.ok(globalFields.every((index) => index >= 0))
  assert.deepEqual([...globalFields].sort((a, b) => a - b), globalFields)
  assert.doesNotMatch(globalCard, /limitConfigEditor|单用户每日手记上限/)

  const handNoteStart = markup.indexOf('<h3>手记设置</h3>')
  const handNoteEnd = markup.indexOf('<h3>打卡设置</h3>')
  const handNoteCard = markup.slice(handNoteStart, handNoteEnd)
  assert.ok(handNoteCard.indexOf('data-system-field="dailyContentPromptTexts"') < handNoteCard.indexOf('id="limitConfigEditor"'))
  assert.match(styles, /\.daily-content-limit-field\s*\{\s*grid-column: 2;/)
  assert.match(styles, /\.copy-field-grid--flow \.copy-field-wide\s*\{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 2;/)
  assert.match(styles, /\.copy-field-grid--flow \.daily-content-limit-field\s*\{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 2;[\s\S]*?align-self: start;/)
  assert.match(main, /const payload = \{ system: collectSystemSettings\(\) \}[\s\S]*payload\.limits = collectLimitConfig\(\)/)
  const globalCollect = main.slice(main.indexOf('function collectGlobalFeatureRules()'), main.indexOf('async function saveGlobalFeatureRules()'))
  assert.match(globalCollect, /delete configWithoutLimits\.limits/)
  assert.doesNotMatch(globalCollect, /limits: collectLimitConfig\(\)/)
})

test('admin navigation controls keep the final tab order', () => {
  const home = markup.indexOf('data-tab-field="home"')
  const articles = markup.indexOf('data-tab-field="articles"')
  const letters = markup.indexOf('data-tab-field="letters"')
  const mine = markup.indexOf('data-tab-field="mine"')
  assert.ok(home >= 0 && home < articles && articles < letters)
  assert.equal(mine, -1)
})

test('mini program settings cards follow the product order', () => {
  const headings = [
    '小程序与内容池',
    '首页导航',
    '页面标题',
    '全局设置',
    '文章设置',
    '手记设置',
    '打卡设置',
  ].map((heading) => markup.indexOf(`<h3>${heading}</h3>`))
  assert.ok(headings.every((index) => index >= 0))
  assert.deepEqual([...headings].sort((a, b) => a - b), headings)
  assert.equal((markup.match(/data-system-field="articleAdIncompleteText"/g) || []).length, 1)
  assert.equal((markup.match(/id="articleDisplaySettingsSaveBtn"/g) || []).length, 1)
})

test('admin article controls and cards precede heart-letter controls consistently', () => {
  const contentStart = markup.indexOf('id="content"')
  const importStart = markup.indexOf('id="import"')
  const contentMarkup = markup.slice(contentStart, importStart)
  assert.ok(contentMarkup.indexOf('id="articleManager"') < contentMarkup.indexOf('<h3>心笺文案</h3>'))

  const poolTableStart = markup.indexOf('pool-table')
  const poolTable = markup.slice(poolTableStart, poolTableStart + 1200)
  assert.ok(poolTable.indexOf('<th>文章</th>') < poolTable.indexOf('<th>心笺</th>'))

  assert.ok(markup.indexOf('data-system-field="articlesHero"') < markup.indexOf('data-system-field="lettersHero"'))
  assert.match(markup, /id="messageSourceFilter"[^>]*>.*value="articles">文章<\/option><option value="letters">心笺/s)

  assert.ok(main.indexOf("title: '文章'") < main.indexOf("title: '心笺'"))
  assert.ok(main.indexOf('data-label="文章"') < main.indexOf('data-label="心笺"'))
})
