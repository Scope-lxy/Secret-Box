const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const test = require('node:test')

const {
  getAdminAssetPaths,
  serveAdminAsset,
} = require('../src/modules/admin/admin-static.service')
const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')

test('three default share covers are included in the server build and can be served', async () => {
  const assetPaths = [
    '/admin/share-covers/share-1.jpg',
    '/admin/share-covers/share-2.jpg',
    '/admin/share-covers/share-3.jpg',
  ]
  assert.deepEqual(getAdminAssetPaths().filter((path) => path.startsWith('/admin/share-covers/')), assetPaths)
  const assetPath = assetPaths[0]

  const response = {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }

  await serveAdminAsset({}, response, new URL(`http://localhost${assetPath}`))

  assert.equal(response.status, 200)
  assert.equal(response.headers['cache-control'], 'public, max-age=86400')
  assert.equal(response.headers['content-type'], 'image/jpeg')
  assert.ok(Buffer.isBuffer(response.body))
  assert.ok(response.body.length > 0)
})

test('admin HTML, styles, and scripts are not cached after a release', async () => {
  const response = {
    status: 0,
    headers: {},
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end() {},
  }

  await serveAdminAsset({}, response, new URL('http://localhost/admin/main.js'))

  assert.equal(response.status, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
})

test('article manager script is reachable through the actual admin static route', async () => {
  const server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/admin/article-manager.js`)
    const source = await response.text()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /text\/javascript/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(source, /function initArticleManager\(\)/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('saved AppSecret and COS SecretKEY use masked previews with authenticated reveal controls', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')

  assert.match(markup, /id="storageSecretKeyInput"[^>]*data-secret-reveal="storageSecretKey"/)
  assert.match(markup, /id="miniProgramAppSecretInput"[^>]*data-secret-reveal="appSecret"/)
  assert.match(script, /storage\.secretKeyMasked/)
  assert.match(script, /item\.appSecretMasked/)
  assert.match(script, /apiRequest\('\/api\/admin\/secrets\/reveal'/)
  assert.match(script, /input\.dataset\.secretDirty === 'true'/)
  assert.match(script, /const miniProgramId = getCurrentMiniProgram\(\)\?\.id \|\| ''/)
  assert.match(script, /input\.dataset\.secretRequestId !== requestId/)
  assert.match(script, /getCurrentMiniProgram\(\)\?\.id !== miniProgramId/)
  assert.match(script, /addEventListener\('beforeinput'/)
})

test('admin keeps the import return action in the import page action area', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const importScript = fs.readFileSync(path.join(adminSource, 'import.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(markup, /<div class="topbar-user">\s*<span id="adminAccountLabel">admin<\/span>\s*<button class="btn-text btn-danger" id="logoutBtn"/)
  assert.equal(markup.match(/id="importBackBtn"/g)?.length, 1)
  assert.match(markup, /<section class="section" id="import">\s*<div class="section-page-head import-section-head">[\s\S]*?<div class="save-bar save-bar--top">\s*<button class="btn-outline" id="importBackBtn" type="button">返回内容管理<\/button>\s*<\/div>/)
  assert.doesNotMatch(styles, /scrollbar-gutter:/)
  assert.doesNotMatch(styles, /\.import-section-head \{[\s\S]*?align-items: center;/)
  assert.doesNotMatch(script, /importBackBtn/)
  assert.match(importScript, /nodes\.back\.addEventListener\('click', returnToContent\)/)
  assert.match(importScript, /window\.showSection\?\.\('content'\)/)
})

test('content management tabs match import sizing and isolate each content panel', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')
  const types = ['contentTexts', 'contentAudios', 'contentAlbums', 'articles', 'letters']
  const panelIds = { articles: 'articleManager' }

  types.forEach((type) => {
    const panelId = panelIds[type] || `contentPanel-${type}`
    assert.match(markup, new RegExp(`data-content-type="${type}"[^>]*aria-controls="${panelId}"`))
    assert.match(markup, new RegExp(`id="${panelId}"[^>]*data-content-panel="${type}"`))
    assert.match(markup, new RegExp(`id="${panelId}"[\\s\\S]*?aria-labelledby="contentTypeTab-${type}"`))
  })
  assert.match(script, /const CONTENT_EDITOR_TYPES = \['contentTexts', 'contentAudios', 'contentAlbums', 'articles', 'letters'\]/)
  assert.match(script, /if \(!CONTENT_EDITOR_TYPES\.includes\(type\)\) return/)
  assert.match(script, /document\.querySelectorAll\('\[data-content-panel\]'\)/)
  assert.match(styles, /\.import-type-tab,\s*\.content-type-tab \{[\s\S]*?min-width: 96px;[\s\S]*?height: 36px;[\s\S]*?padding: 0 14px;/)
  assert.match(styles, /\.content-type-panel\[hidden\] \{\s*display: none;\s*}/)
  assert.doesNotMatch(styles, /\.content-type-tab \{[\s\S]*?min-width: 120px;/)
})

test('admin saves data sharing and mini-program modes together through the dedicated save button', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(markup, /<div class="system-mode-actions">\s*<select id="miniProgramDataMode"[\s\S]*?<option value="shared">共享矩阵数据<\/option>[\s\S]*?<option value="independent">使用独立数据<\/option>[\s\S]*?<select id="miniProgramMode"[\s\S]*?<button class="btn-primary" id="saveMiniProgramMode" type="button">保存模式配置<\/button>/)
  assert.match(markup, /<select id="miniProgramMode" aria-label="配置模式">\s*<option value="default">默认正常模式<\/option>\s*<option value="audit">临时提审模式<\/option>\s*<\/select>/)
  assert.match(styles, /\.system-mode-actions \{\s*display: flex;\s*align-items: center;\s*gap: 12px;/)
  assert.match(script, /saveMiniProgramMode: document\.querySelector\('#saveMiniProgramMode'\)/)
  assert.match(script, /nodes\.saveMiniProgramMode\?\.addEventListener\('click', saveModePreset\)/)
  assert.match(script, /nodes\.miniProgramMode\?\.addEventListener\('change', \(event\) => applyModePreset\(event\.target\.value\)\)/)
  assert.doesNotMatch(script, /nodes\.miniProgramDataMode\?\.addEventListener\('change', saveModePreset\)/)
  assert.doesNotMatch(script, /mode: nodes\.miniProgramMode\?\.value/)
  assert.match(script, /function collectGlobalFeatureRules\(\) \{[\s\S]*?mode: config\.mode === 'audit' \? 'audit' : 'default'/)
  assert.match(script, /function collectModeConfig\(mode, dataMode\) \{[\s\S]*?dataMode: dataMode === 'independent' \? 'independent' : 'shared'/)
  assert.match(script, /function applyModePreset\(mode\) \{[\s\S]*?item\.adType === 'rewarded'[\s\S]*?freeCount\.value = isAudit \? '3' : '0'[\s\S]*?item\.adType === 'interstitial'[\s\S]*?const homeVisible = document\.querySelector\('\[data-tab-visible="home"\]'\)/)
  assert.match(script, /if \(!isAudit && enabled\) enabled\.checked = true/)
  assert.match(script, /dailyContentLimit\.value = isAudit \? '0' : '5'/)
  assert.doesNotMatch(script, /item\.adType === 'native' && isAudit/)
  assert.match(script, /async function saveModePreset\(\) \{[\s\S]*?const mode = nodes\.miniProgramMode\?\.value === 'audit' \? 'audit' : 'default'[\s\S]*?if \(nodes\.miniProgramDataMode\) nodes\.miniProgramDataMode\.disabled = true[\s\S]*?'迁移中…'[\s\S]*?saveMiniProgramRequest\('\/api\/admin\/miniprogram\/config'/)
  const saveModeSource = script.slice(script.indexOf('async function saveModePreset'), script.indexOf('async function createMiniProgram'))
  assert.doesNotMatch(saveModeSource, /previousMode|modeChanged|applyModePreset\(mode\)/)
  assert.match(script, /getMiniProgramDataMode\(\) !== dataMode/)
  assert.match(script, /catch \(error\) \{\s*restoreSavedModeConfig\(\)/)
})

test('admin keeps native single selects aligned with a shared inset chevron', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../admin/src/styles.css'), 'utf8')

  assert.match(styles, /select:not\(\[multiple\]\) \{[\s\S]*?appearance: none;[\s\S]*?padding-right: 30px;[\s\S]*?background-image: url\([\s\S]*?background-position: right 6px center;/)
  assert.match(styles, /\.miniprogram-switcher select \{[\s\S]*?background-color: rgba\(255, 255, 255, 0\.08\);/)
  assert.match(styles, /\.miniprogram-switcher select:not\(\[multiple\]\) \{\s*background-image: url\(/)
  assert.match(styles, /select:not\(\[multiple\]\):disabled \{\s*background-image: url\(/)
  assert.match(styles, /\.table-page-size select \{[\s\S]*?padding: 0 24px 0 6px;[\s\S]*?background-position: right 6px center;/)
})

test('admin uses a responsive, shared 10/20/50/100 pagination control', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(script, /const PAGE_SIZES = \[10, 20, 50, 100\]/)
  assert.match(script, /data-page-size-scope=/)
  assert.match(script, /data-page-scope=.*data-page=/)
  assert.match(script, />上一页<\/button>/)
  assert.match(script, />下一页<\/button>/)
  assert.match(script, /page: 1, pageSize/)
  assert.match(script, /pageSize: messagePagination\.pageSize/)
  assert.match(script, /pageSize = accountPagination\.pageSize/)
  assert.match(script, /PageSize/, '内容请求应携带各类型页容量')
  assert.match(styles, /\.table-pagination \{\s+display: flex;[\s\S]*flex-wrap: nowrap;/)
  assert.match(styles, /\.table-pagination > \* \{\s+white-space: nowrap;/)
  const contentTables = {
    contentTexts: 'contentTextEditor',
    contentAudios: 'contentAudioEditor',
    contentAlbums: 'contentAlbumEditor',
    letters: 'letterEditor',
  }
  for (const [type, tbodyId] of Object.entries(contentTables)) {
    assert.match(markup, new RegExp(`<tbody id="${tbodyId}"></tbody>\\s*</table>\\s*<div class="table-pagination-container" id="${type}Pagination"></div>`))
  }
  assert.doesNotMatch(script, /nodes\.(?:contentTextEditor|contentAudioEditor|contentAlbumEditor|letterEditor)\.insertAdjacentHTML\('beforeend', renderPagination/)
})

test('admin content supports page-scoped bulk deletion with an explicit server limit', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes.js'), 'utf8')
  const store = fs.readFileSync(path.resolve(__dirname, '../src/modules/content/content.store.js'), 'utf8')

  const batchImportTypes = {
    contentTexts: 'text',
    contentAudios: 'audio',
    contentAlbums: 'album',
    letters: 'letter-copy',
  }
  Object.entries(batchImportTypes).forEach(([type, importType]) => {
    assert.match(markup, new RegExp(`data-content-select-all="${type}"`))
    assert.match(markup, new RegExp(`class="btn-outline btn-danger" data-content-batch-delete="${type}"[^>]*disabled>批量删除<`))
    assert.match(markup, new RegExp(`data-batch-import="${importType}"[\\s\\S]*?data-content-batch-delete="${type}"[\\s\\S]*?data-add-content="${type}"[\\s\\S]*?data-save-content[^>]*>保存<`))
    assert.ok(script.includes(`renderContentSelectionCell('${type}', item)`))
  })
  assert.match(markup, /<button class="btn-primary" data-save-content type="button">保存全部内容<\/button>/)
  assert.match(script, /function hasUnsavedContentEdits\(type\)/)
  assert.match(script, /batchButton\.textContent = '批量删除'/)
  assert.doesNotMatch(script, /batchButton\.textContent = `删除所选/)
  assert.match(script, /contentFormSnapshots = Object\.fromEntries\(CONTENT_TYPES\.map/)
  assert.match(script, /collectContentEditor\(\{ includeConfig: false \}\)/)
  assert.match(script, /if \(!includeConfig\) return content/)
  assert.match(script, /请先保存\$\{getContentTypeLabel\(type\)\}的编辑，再批量删除/)
  assert.match(script, /apiRequest\('\/api\/admin\/content\/batch-delete'/)
  assert.match(script, /clearContentSelection\(\)/)
  assert.match(routes, /router\.post\('\/api\/admin\/content\/batch-delete'/)
  assert.match(routes, /单次最多删除 100 条内容/)
  assert.match(routes, /let cleanupWarning = ''/)
  assert.match(routes, /deleted\.cleanupWarning = cleanupWarning/)
  assert.match(store, /function deleteContentItems\(poolId, type, itemIds\)/)
  assert.match(store, /count - ids\.length < 1/)
})

test('content tables do not invent a publish status for immediately saved content', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const articleScript = fs.readFileSync(path.join(adminSource, 'article-manager.js'), 'utf8')
  const albumTable = markup.match(/<table class="data-table content-edit-table content-table-content-albums">[\s\S]*?<\/table>/)?.[0] || ''
  const articleTable = markup.match(/<table class="data-table article-table">[\s\S]*?<\/table>/)?.[0] || ''

  assert.ok(albumTable)
  assert.ok(articleTable)
  assert.doesNotMatch(albumTable, /<th>状态<\/th>|col-status/)
  assert.doesNotMatch(articleTable, /<th>状态<\/th>|col-status/)
  assert.doesNotMatch(script, /整组可用|可发布|需补正文/)
  assert.doesNotMatch(articleScript, /草稿|data-label="状态"/)
  assert.doesNotMatch(script, /data-label="状态"><span class="badge[^>]*>\$\{hasError/)
  assert.match(script, /data-album-error="\$\{hasError \? '1' : '0'\}"/)
  assert.match(markup, /data-filter-album-errors[^>]*>仅看压缩失败<\/button>/)
})

test('content image previews preserve image data without exposing image ID inputs', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const albumTable = markup.match(/<table class="data-table content-edit-table content-table-content-albums">[\s\S]*?<\/table>/)?.[0] || ''

  assert.doesNotMatch(albumTable, /图片 ID|col-image-ids/)
  assert.doesNotMatch(script, /data-album-field="images"/)
  assert.match(script, /label: nodes\.contentAlbumEditor[\s\S]*?images: item\.images,/)
})

test('admin presents share templates as a global resource and saves them independently', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')

  assert.match(markup, /<h2>全局分享模板<\/h2>/)
  assert.match(markup, /<h3>分享效果预览<\/h3>/)
  assert.match(markup, /这套模板由所有小程序共用/)
  assert.match(script, /apiRequest\('\/api\/admin\/share-settings'/)
  const renderAdminSettingsBlock = script.match(/function renderAdminSettings\(data\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.doesNotMatch(renderAdminSettingsBlock, /renderSystemSettings\(\)/)
  assert.match(script, /公开文章/)
  assert.match(script, /公开心笺/)
  assert.match(script, /sharePreviewTypeOffset = \(sharePreviewTypeOffset \+ 1\) % shareContentTypes\.length/)
  assert.doesNotMatch(script, /withEditingContentPool\(\{ shareSettings \}/)
})

test('admin exposes daily-stable check-in copy pools', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')

  assert.match(markup, /<label>打卡前展示文案<\/label>[\s\S]*data-system-field="checkinBeforeTexts"/)
  assert.match(markup, /<label>打卡后展示文案<\/label>[\s\S]*data-system-field="checkinAfterTexts"/)
  // 编辑框预填后台默认文案（与客户端定稿一致），提示「留空时使用小程序内置默认文案」
  assert.match(markup, /data-system-field="checkinBeforeTexts">今天也等到你了/)
  assert.match(markup, /data-system-field="checkinAfterTexts">今日已点亮，明天再来打卡吧！/)
  assert.match(markup, /留空时使用小程序内置默认文案/)
  assert.match(markup, /<h3>手记设置<\/h3>[\s\S]*<h3>打卡设置<\/h3>/)
  assert.match(markup, /<h3>文章设置<\/h3>[\s\S]*data-system-field="articleAdIncompleteText"/)
  assert.doesNotMatch(markup, /<h3>文章流程<\/h3>|<h3>文章展示设置<\/h3>|<h3>手记流程<\/h3>|<h3>打卡流程<\/h3>/)
  assert.doesNotMatch(markup, /data-tab-field="mine"|data-tab-visible="mine"/)
  assert.doesNotMatch(markup, /copy-field-wide"><label>打卡(?:前|后)展示文案/)
  assert.match(script, /system\.checkinBeforeTexts/)
  assert.match(script, /system\.checkinAfterTexts/)
  assert.match(script, /articleAdIncompleteText/)
  assert.doesNotMatch(markup, /data-system-field="checkinCalendarText"/)
})

test('admin labels sequential letters as reverse insertion order', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../admin/src/index.html'), 'utf8')
  const settingsSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/admin/admin-settings.store.js'), 'utf8')

  assert.match(markup, /<option value="sequence">倒序排列（按入库顺序展示）<\/option>/)
  assert.match(markup, /data-system-field="articlesSortMode"/)
  assert.match(settingsSource, /lettersSortMode: 'random'/)
  assert.match(settingsSource, /articlesSortMode: 'random'/)
})

test('audio content rows prioritize editable titles and keep auxiliary fields compact', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(markup, /<col class="col-audio-title col-core">/)
  assert.match(script, /<textarea data-audio-field="title"[^>]*rows="1"/)
  assert.match(script, /audio-original-filename/)
  assert.match(script, /function renderContentRowActions\(type, index\)/)
  assert.match(script, /requestAnimationFrame\(\(\) => resizeAllTextareas\(document\.querySelector\(`#\$\{target\}`\) \|\| document\)\)/)
  assert.match(script, /function initTextareaAutoResize\(\)/)
  assert.match(script, /new ResizeObserver/)
  assert.match(script, /window\.addEventListener\('resize', scheduleTextareaResize\)/)
  assert.doesNotMatch(script, /requestAnimationFrame\(resizeAllTextareas\)/)
  assert.match(script, /event\.target instanceof HTMLTextAreaElement/)
  assert.match(script, /<input data-content-text-field="label"/)
  assert.match(script, /<input data-audio-field="label"/)
  assert.match(script, /<input data-album-field="label"/)
  assert.match(script, /<input data-letter-field="label"/)
  assert.match(script, /<label>单用户每日手记上限<\/label>\s*<p class="field-hint">每位用户每天最多打开多少篇，填 0 表示不限制。<\/p>/)
  assert.doesNotMatch(script, /dailyContentLimitHint|填 0 表示不限次数/)
  ;['contentTexts', 'contentAudios', 'contentAlbums', 'letters'].forEach((type) => {
    assert.ok(script.includes(`renderContentRowActions('${type}', index)`))
  })
  assert.doesNotMatch(styles, /\.content-table-content-audios \.col-(?:audio-title|audio-name|actions) \{[^}]*width:/)
  assert.doesNotMatch(styles, /\.content-table-content-audios textarea\[data-audio-field="title"\]/)
  assert.match(styles, /\.audio-original-filename \{\s+overflow: hidden;\s+text-overflow: ellipsis;\s+white-space: nowrap;/)
  assert.match(styles, /textarea \{\s+overflow-y: auto;\s+resize: none;/)
  assert.doesNotMatch(styles, /resize:\s*vertical/)
  assert.match(styles, /\.content-row-actions \{\s+display: flex;\s+align-items: center;\s+gap: 4px;\s+white-space: nowrap;/)
})

test('admin content pool rows switch on click and edit pool metadata in a standard modal', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(markup, /<tr><th>ID<\/th><th>名称<\/th><th>备注<\/th><th>文案<\/th><th>音频<\/th><th>图册<\/th><th>文章<\/th><th>心笺<\/th><th>已关联<\/th><th>操作<\/th><\/tr>/)
  const poolTable = markup.match(/<table class="data-table pool-table">[\s\S]*?<\/table>/)?.[0] || ''
  assert.match(poolTable, /<colgroup>\s*<col class="col-id">\s*<col span="8">\s*<col class="col-actions">\s*<\/colgroup>/)
  assert.match(styles, /\.pool-table \.col-actions \{ width: 104px; \}/)
  assert.match(styles, /\.pool-table th:last-child,\s+\.pool-table td:last-child \{\s+white-space: nowrap;\s+\}/)
  assert.match(markup, /id="editPoolModal"[\s\S]*id="editPoolName"[\s\S]*id="editPoolRemark"/)
  assert.match(script, /data-pool-edit="\$\{escapeAttr\(pool\.id\)\}">编辑<\/button>/)
  assert.match(script, /const poolRow = event\.target\.closest\('\.pool-row\[data-pool-id\]'\)/)
  assert.match(script, /function saveEditedContentPool\(\)/)
  assert.match(script, /contentPools: adminSettingsState\.contentPools\.map/)
  assert.doesNotMatch(script, /data-pool-select|切换编辑/)
  assert.doesNotMatch(styles, /\.pool-table \{\s+width: 100%;\s+table-layout: fixed;\s+min-width: 0;/)
  assert.doesNotMatch(styles, /\.panel:has\(\.pool-table\) \{\s+overflow-x: hidden;/)
  assert.doesNotMatch(styles, /\.pool-table th:nth-child\([0-9]+\),\s+\.pool-table td:nth-child\([0-9]+\) \{[^}]*width:/)
})

test('form modals place cancel and the primary action in the top-right header', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')
  const editorModals = [
    ['singleContentModal', '保存'],
    ['addMpModal', '创建'],
    ['uploadMiniProgramModal', '上传'],
    ['addPoolModal', '创建'],
    ['editPoolModal', '保存'],
    ['articleEditorModal', '保存'],
  ]

  editorModals.forEach(([id, primaryLabel]) => {
    const modal = markup.match(new RegExp(`<div class="modal hidden" id="${id}"[\\s\\S]*?(?=\\n    <div class="modal hidden"|\\n    <div class="admin-toast)`))?.[0] || ''
    assert.match(modal, /class="[^"]*modal-editor-head[^"]*"/)
    assert.match(modal, new RegExp(`class="[^"]*modal-editor-actions[^"]*">[\\s\\S]*?>取消<\\/button>[\\s\\S]*?>${primaryLabel}<\\/button>`))
    assert.doesNotMatch(modal, /class="modal-actions"/)
  })

  assert.match(styles, /\.modal-editor-head\s*\{[\s\S]*justify-content:\s*space-between;/)
  assert.match(styles, /\.modal-editor-actions\s*\{[\s\S]*gap:\s*8px;/)
})

test('mini program messages use the shared 200-unit weighted limit and show submit state', () => {
  const miniRoot = path.resolve(__dirname, '../../../miniprogram/pages')
  const messageStyles = fs.readFileSync(path.resolve(miniRoot, '../styles/components.wxss'), 'utf8')
  const templates = [
    fs.readFileSync(path.join(miniRoot, 'home/home.wxml'), 'utf8'),
    fs.readFileSync(path.join(miniRoot, 'letters/letters.wxml'), 'utf8'),
  ]
  assert.equal(templates.reduce((count, template) => count + (template.match(/maxlength="-1"/g) || []).length, 0), 4)
  const scripts = ['home/home.js', 'letters/letters.js']
    .map((file) => fs.readFileSync(path.join(miniRoot, file), 'utf8'))
  scripts.forEach((script) => {
    assert.match(script, /truncateMessageContent\(event\.detail\.value\)/)
    assert.match(script, /isMessageContentWithinLimit\(content\)/)
    assert.match(script, /MESSAGE_CONTENT_LIMIT_TEXT/)
  })
  assert.match(messageStyles, /\.message-text\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-all;/s)
  assert.match(messageStyles, /\.history-preview\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-all;/s)
  const submitButtons = [
    { template: templates[0], count: 3, state: 'messageSubmitting' },
    { template: templates[1], count: 1, state: 'item.messageSubmitting' },
  ]
  submitButtons.forEach(({ template, count, state }) => {
    const escapedState = state.replace('.', '\\.')
    const statePattern = new RegExp(`<button class="message-submit \\{\\{${escapedState} \\? 'is-loading' : ''\\}\\}"[^>]*disabled="\\{\\{${escapedState}(?:\\s*\\|\\|[^}]*)?\\}\\}"[^>]*bindtap="handleSubmitMessage"`, 'g')
    const dotsPattern = new RegExp(`<view wx:if="\\{\\{${escapedState}\\}\\}" class="button-loading-dots button-loading-dots--light"><view></view><view></view><view></view></view>`, 'g')
    assert.equal((template.match(statePattern) || []).length, count)
    assert.equal((template.match(dotsPattern) || []).length, count)
    assert.doesNotMatch(template, /提交中/)
  })
})

test('mini program keeps returned daily-content and queued interaction state', () => {
  const miniRoot = path.resolve(__dirname, '../../../miniprogram')
  const homeScript = fs.readFileSync(path.join(miniRoot, 'pages/home/home.js'), 'utf8')
  const serviceScript = fs.readFileSync(path.join(miniRoot, 'services/miniapp.js'), 'utf8')
  const templates = [
    fs.readFileSync(path.join(miniRoot, 'pages/home/home.wxml'), 'utf8'),
    fs.readFileSync(path.join(miniRoot, 'pages/letters/letters.wxml'), 'utf8'),
  ]

  assert.match(homeScript, /dailyContentMessage: dailyContent\.myMessage \|\| ''/)
  assert.match(homeScript, /liked: Boolean\(dailyContent\.liked\)/)
  assert.match(homeScript, /favorited: Boolean\(dailyContent\.favorited\)/)
  assert.match(homeScript, /const data = await submitPrivateMessage\(/)
  assert.match(homeScript, /liked: interaction\.liked === undefined \? this\.data\.liked : Boolean\(interaction\.liked\)/)
  assert.match(homeScript, /favorited: interaction\.favorited === undefined \? this\.data\.favorited : Boolean\(interaction\.favorited\)/)
  assert.match(serviceScript, /liked: interaction\.liked === undefined \? item\.liked : Boolean\(interaction\.liked\)/)
  assert.match(serviceScript, /favorited: interaction\.favorited === undefined \? item\.favorited : Boolean\(interaction\.favorited\)/)
  assert.match(serviceScript, /async function deletePrivateMessage\(payload\)/)
  assert.match(serviceScript, /runOfflineOperation\('message_delete', payload\)/)
  assert.match(serviceScript, /item\.id === payload\.sourceId \? \{ \.\.\.item, myMessage: '' \} : item/)
  assert.match(serviceScript, /invalidateResource\('home'\)/)
  assert.equal((templates[0].match(/class="[^"]*\bmessage-delete\b[^"]*"/g) || []).length, 3)
  assert.equal((templates[1].match(/class="[^"]*\bmessage-delete\b[^"]*"/g) || []).length, 1)
  templates.forEach((template) => assert.match(template, /bindtap="handleDeleteMessage"/))
  assert.match(homeScript, /if \(this\.data\.messageSubmitting \|\| this\.data\.messageDeleting \|\| !this\.data\.dailyContentMessage \|\| !dailyContent\?\.id\) return/)
})

test('mini program account deletion uses a standard button and a direct email request', () => {
  const settingsRoot = path.resolve(__dirname, '../../../miniprogram/pages/settings')
  const markup = fs.readFileSync(path.join(settingsRoot, 'settings.wxml'), 'utf8')
  const script = fs.readFileSync(path.join(settingsRoot, 'settings.js'), 'utf8')

  assert.match(markup, /<button class="button-secondary settings-delete-button" bindtap="requestDelete">注销账号<\/button>/)
  assert.match(markup, /<view class="settings-item" hover-class="settings-item--pressed" bindtap="openOfficialPrivacy"><text>隐私政策<\/text>/)
  assert.match(markup, /<text>用户协议<\/text>/)
  assert.doesNotMatch(markup, /个人信息收集清单|第三方共享清单|pages\/legal\/privacy/)
  assert.doesNotMatch(markup, /developerEmail|settings-item-description|settings-item danger/)
  assert.match(script, /const ACCOUNT_DELETION_EMAIL = '609307776@qq\.com'/)
  assert.match(script, /请发送注销申请至\$\{this\.data\.developerEmail \|\| ACCOUNT_DELETION_EMAIL\}，并注明需要注销的小程序名称和对应的账号信息。/)
  assert.match(script, /getStartupConfig\(\)/)
  assert.match(script, /startup\.config\?\.miniProgram\?\.developerEmail/)
  assert.match(script, /developerEmail: ACCOUNT_DELETION_EMAIL/)
  assert.match(script, /wx\.openPrivacyContract\(/)
  assert.doesNotMatch(script, /小程序已获取的信息|通知开发者删除/)
})

test('admin exposes current-mini-program account deletion and developer contact controls', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(markup, /data-section="accounts"[^>]*>用户管理</)
  assert.match(markup, /id="accountList"/)
  assert.match(markup, /data-mp-field="developerEmail"/)
  assert.match(markup, /id="newMpDeveloperEmail"/)
  assert.match(markup, /<label>绑定内容池<\/label>[\s\S]*data-mp-field="contentPoolId"[\s\S]*<label>开发者邮箱<\/label>[\s\S]*data-mp-field="developerEmail"[\s\S]*<label>备注<\/label>[\s\S]*data-mp-field="remark"/)
  assert.match(styles, /\.mini-program-form-grid \{\s+display: grid;\s+grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
  assert.doesNotMatch(styles, /\.mp-remark-field/)
  assert.match(script, /api\/admin\/accounts\?miniProgramId=/)
  assert.match(script, /data-account-delete=/)
  assert.match(script, /<table class="data-table">[\s\S]*data-account-delete=/)
  assert.match(script, /api\/admin\/accounts\/delete/)
  assert.match(script, /其他小程序中的账号不受影响/)
})

test('admin keeps platform status out of business instance management', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')

  assert.match(markup, /这里管理接入我们服务的业务实例/)
  assert.match(markup, /审核、发布、隐私保护指引和合法域名仍以微信公众平台为准/)
  assert.match(markup, /<thead><tr><th>名称<\/th><th>绑定内容池<\/th><th>AppID<\/th><th>最近上传版本<\/th><th>分组<\/th><th>备注<\/th><th>排序<\/th><th>操作<\/th><\/tr><\/thead>/)
  assert.doesNotMatch(markup, /<th>状态<\/th><th>绑定内容池<\/th>/)
  assert.doesNotMatch(script, /待发布<\/span>|运行中<\/span>/)
  assert.match(script, /const items = getActiveMiniPrograms\(\)/)
  assert.match(script, /item\.lastUpload\?\.version \|\| '未上传'/)
  assert.doesNotMatch(script, /online-version/)
  assert.match(script, /data-label="备注">\$\{escapeHtml\(item\.remark \|\| '-'\)\}/)
  assert.match(script, /colspan="8">暂无已接入的小程序/)
  assert.match(script, /删除后无法恢复。该小程序将立即停止访问服务/)
  assert.match(script, /绑定的内容池及池内全部内容会保留，不受影响/)
})

test('admin provides code upload from each active mini-program row only', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(markup, /id="uploadMiniProgramModal"/)
  assert.match(markup, /<label>代码上传密钥<\/label>/)
  assert.match(markup, /id="uploadMiniProgramPrivateKey"[^>]*autocomplete="new-password"/)
  assert.match(markup, /id="uploadMiniProgramVersion"/)
  assert.match(markup, /id="uploadMiniProgramDescription"[^>]*required/)
  assert.match(styles, /\.modal-actions \{\s+justify-content: flex-end;/)
  assert.match(script, /data-mp-edit="\$\{escapeAttr\(item\.id\)\}">编辑<\/button>[\s\S]*data-mp-upload="\$\{escapeAttr\(item\.id\)\}">上传<\/button>[\s\S]*data-mp-delete="\$\{escapeAttr\(item\.id\)\}"/)
  assert.match(script, /api\/admin\/miniprogram\/upload/)
  assert.match(script, /uploadKeyConfigured/)
  assert.match(script, /privateKey/)
  assert.match(script, /showToast\('请填写更新说明'\)/)
  assert.match(script, /setButtonsLoading\(\[\s*document\.querySelector\('#confirmUploadMiniProgram'\),?\s*\], '上传中…'\)/)
  assert.doesNotMatch(script, /setButtonsLoading\(\[\s*document\.querySelector\('#cancelUploadMiniProgram'\)/)
  assert.doesNotMatch(markup, /发布记录|撤回发布|提交审核/)
})

test('mini program table supports persistent ordering and permanent deletion', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(markup, /<table class="data-table mini-program-table">[\s\S]*<col class="col-order">[\s\S]*<col class="col-actions">[\s\S]*<th>分组<\/th><th>备注<\/th><th>排序<\/th><th>操作<\/th>/)
  assert.doesNotMatch(markup, /已停用接入|archivedMiniProgramPanel/)
  assert.doesNotMatch(markup, /wx03d0fa4e3c10441d|主要面向读者群体A|轻读手记二号|内容池2/)
  assert.match(script, /data-mp-direction="up"[^>]*title="上移「\$\{escapeAttr\(item\.name\)\}」"[^>]*aria-label="上移「\$\{escapeAttr\(item\.name\)\}」"[^>]*\$\{index === 0 \? 'disabled' : ''\}>↑<\/button>/)
  assert.match(script, /data-mp-direction="down"[^>]*title="下移「\$\{escapeAttr\(item\.name\)\}」"[^>]*aria-label="下移「\$\{escapeAttr\(item\.name\)\}」"[^>]*\$\{index === items\.length - 1 \? 'disabled' : ''\}>↓<\/button>/)
  assert.match(script, /apiRequest\('\/api\/admin\/miniprogram\/reorder'/)
  assert.match(script, /apiRequest\('\/api\/admin\/miniprogram\/delete'/)
  assert.match(script, /items\.length <= 1 \? `disabled title="至少保留一个小程序" aria-label="无法删除「\$\{escapeAttr\(item\.name\)\}」：至少保留一个小程序"`/)
  assert.match(script, /data\.deletion\?\.cleanupError[\s\S]*小程序记录已删除，但上传密钥\/记录清理失败，请检查/)
  assert.match(script, /confirmLabel: '永久删除'/)
  assert.match(script, /danger: true/)
  assert.doesNotMatch(script, /data-mp-archive|data-mp-restore|archiveMiniProgram|restoreMiniProgram/)
  assert.match(styles, /\.mini-program-order-actions \{[\s\S]*gap: 4px;[\s\S]*width: 68px;/)
  assert.match(styles, /\.btn-order \{[\s\S]*width: 32px;[\s\S]*height: 32px;/)
  assert.match(styles, /\.mini-program-row-actions \{[\s\S]*display: flex;[\s\S]*gap: 12px;[\s\S]*white-space: nowrap;/)
  assert.match(styles, /\.mini-program-table \{\s+width: 100%;\s+table-layout: fixed;/)
  assert.doesNotMatch(styles, /\.mini-program-table \{[^}]*min-width:/)
  assert.match(styles, /\.mini-program-table \.col-name \{ width: 10%; \}/)
  assert.match(styles, /\.mini-program-table \.col-pool \{ width: 10%; \}/)
  assert.match(styles, /\.mini-program-table \.col-app-id \{ width: 20%; \}/)
  assert.match(styles, /\.mini-program-table \.col-version \{ width: 13%; \}/)
  assert.match(styles, /\.mini-program-table \.col-group \{ width: 12%; \}/)
  assert.match(styles, /\.mini-program-table \.col-remark \{ width: 11%; \}/)
  assert.match(styles, /\.mini-program-table \.col-order \{ width: 7%; \}/)
  assert.match(styles, /\.mini-program-table \.col-actions \{ width: 17%; \}/)
  assert.match(styles, /\.mini-program-table th,[\s\S]*\.mini-program-table td \{[\s\S]*padding-right: 8px;[\s\S]*padding-left: 8px;/)
  assert.match(styles, /\.mini-program-table th:nth-child\(5\),\s*\.mini-program-table td:nth-child\(5\) \{[\s\S]*padding-right: 8px;[\s\S]*padding-left: 8px;/)
  assert.match(styles, /\.mini-program-table th,[\s\S]*\.mini-program-table td \{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/)
})

test('mini program groups use the shared modal pattern and dashboard filter', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')
  assert.match(markup, /id="manageGroupsBtn"[^>]*>设置分组<\/button>/)
  assert.match(markup, /class="modal hidden" id="groupManagerModal"/)
  assert.match(markup, /class="modal hidden" id="groupAssignModal"/)
  assert.match(script, /function saveGroupManager\(\)/)
  assert.match(script, /function saveMiniProgramGroup\(\)/)
  assert.match(script, /data-mp-group="\$\{escapeAttr\(item\.id\)\}" aria-label="修改分组">改<\/button>/)
  assert.match(script, /body: JSON\.stringify\(\{ id, miniProgram: \{ group \} \}\)/)
  assert.match(styles, /\.group-manager-modal-body,\s*\.group-assign-modal-body \{[\s\S]*width: min\(520px, 100%\);/)
})

test('successful mini program uploads, deletion, and reordering refresh only the table', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../admin/src/main.js'), 'utf8')
  const sourceBetween = (startMarker, endMarker) => {
    const start = script.indexOf(startMarker)
    const end = script.indexOf(endMarker, start + startMarker.length)
    assert.ok(start >= 0 && end > start, `missing source between ${startMarker} and ${endMarker}`)
    return script.slice(start, end)
  }
  const successAndFailure = (source) => source.split('} catch (error) {')
  const refreshSource = sourceBetween('async function refreshMiniProgramTable', 'window.showSection = showSection')
  const [reorderSuccess, reorderFailure] = successAndFailure(sourceBetween('async function reorderMiniProgram', 'async function deleteMiniProgram'))
  const [deleteSuccess, deleteFailure] = successAndFailure(sourceBetween('async function deleteMiniProgram', 'function openMiniProgramUpload'))
  const [uploadSuccess, uploadFailure] = successAndFailure(sourceBetween('async function uploadMiniProgramCode', 'function initShellInteractions'))
  const bootstrapSource = sourceBetween('async function bootstrap', 'initShellInteractions()')

  assert.match(refreshSource, /apiRequest\('\/api\/admin\/settings'\)/)
  assert.match(refreshSource, /renderMiniProgramSwitcher\(\)[\s\S]*renderMiniPrograms\(\)[\s\S]*updateCurrentMiniProgramName\(\)/)
  assert.match(refreshSource, /showToast\(message\)/)
  assert.match(refreshSource, /列表刷新失败，请手动重试/)
  assert.doesNotMatch(script, /window\.location\.reload\(\)|SECTION_AFTER_RELOAD_KEY|TOAST_AFTER_RELOAD_KEY/)
  assert.match(bootstrapSource, /await loadAdminSettings\(\)[\s\S]*await Promise\.all\(/)

  assert.match(reorderSuccess, /await apiRequest\('\/api\/admin\/miniprogram\/reorder'/)
  assert.match(reorderSuccess, /await refreshMiniProgramTable\(direction === 'up' \? '小程序已上移' : '小程序已下移'\)/)
  assert.doesNotMatch(reorderSuccess, /saveMiniProgramRequest|refreshAdminOverview/)
  assert.doesNotMatch(reorderFailure, /refreshMiniProgramTable/)

  assert.match(deleteSuccess, /await apiRequest\('\/api\/admin\/miniprogram\/delete'/)
  assert.match(deleteSuccess, /await refreshMiniProgramTable\(message\)/)
  assert.doesNotMatch(deleteSuccess, /saveMiniProgramRequest|loadContentEditor|loadAccounts/)
  assert.doesNotMatch(deleteFailure, /refreshMiniProgramTable/)

  assert.match(uploadSuccess, /await apiRequest\('\/api\/admin\/miniprogram\/upload'/)
  assert.match(uploadSuccess, /closeMiniProgramUpload\(\)[\s\S]*await refreshMiniProgramTable\('代码已上传至微信公众平台开发版'\)/)
  assert.doesNotMatch(uploadFailure, /refreshMiniProgramTable/)
})

test('admin sidebar separates menu groups without visible group labels', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.doesNotMatch(markup, /实例管理|共享资源|全局运营|后台设置/)
  ;['miniprograms', 'content', 'messages', 'admin-account'].forEach((section) => {
    assert.match(markup, new RegExp(`class="nav-item nav-group-start" data-section="${section}"`))
  })
  assert.match(styles, /\.nav-group-start::before/)
})

test('admin brand and home default copy match the current product baseline', () => {
  const projectRoot = path.resolve(__dirname, '../../..')
  const adminSource = path.join(projectRoot, 'admin/server/admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')
  const settingsSource = fs.readFileSync(path.join(projectRoot, 'admin/server/src/modules/admin/admin-settings.store.js'), 'utf8')
  const homeTemplate = fs.readFileSync(path.join(projectRoot, 'miniprogram/pages/home/home.wxml'), 'utf8')
  const articlesPage = fs.readFileSync(path.join(projectRoot, 'miniprogram/pages/articles/articles.js'), 'utf8')
  const lettersPage = fs.readFileSync(path.join(projectRoot, 'miniprogram/pages/letters/letters.js'), 'utf8')

  assert.match(markup, /<div class="sidebar-brand">\s*<h1>管理后台<\/h1>/)
  assert.match(styles, /\.sidebar-brand h1 \{\s*margin: 0;\s*text-align: center;/)
  assert.match(markup, /data-system-field="homeHero" value="给你的专属秘密"/)
  assert.match(markup, /data-system-field="articlesHero" value="走心的精选文章"/)
  assert.match(markup, /data-system-field="lettersHero" value="暖心的文案短句"/)
  assert.match(settingsSource, /homeHero: '给你的专属秘密'/)
  assert.match(settingsSource, /articlesHero: '走心的精选文章'/)
  assert.match(settingsSource, /lettersHero: '暖心的文案短句'/)
  // 页面不再各自写死兜底文案：统一从 default-copy 的默认包解析
  assert.match(homeTemplate, /title="\{\{homeHeroText\}\}"/)
  assert.match(articlesPage, /resolveCopyText\(system\.articlesHero, 'articlesHero'\)/)
  assert.match(lettersPage, /resolveCopyText\(home\.system\?\.lettersHero, 'lettersHero'\)/)
  assert.match(fs.readFileSync(path.join(projectRoot, 'miniprogram/utils/default-copy.js'), 'utf8'), /articlesHero: \['走心的精选文章'\]/)
})

test('mini program identifies its Admin instance by runtime AppID', () => {
  const projectRoot = path.resolve(__dirname, '../../..')
  const envSource = fs.readFileSync(path.join(projectRoot, 'miniprogram/config/env.js'), 'utf8')
  const requestSource = fs.readFileSync(path.join(projectRoot, 'miniprogram/utils/request.js'), 'utf8')
  const routesSource = fs.readFileSync(path.join(projectRoot, 'admin/server/src/routes.js'), 'utf8')

  assert.match(envSource, /wx\.getAccountInfoSync\(\)\?\.miniProgram\?\.appId/)
  assert.doesNotMatch(envSource, /const miniProgramId\s*=/)
  assert.match(requestSource, /'x-miniapp-appid': appId/)
  assert.doesNotMatch(requestSource, /'x-miniapp-id'/)
  assert.match(routesSource, /getMiniProgramByAppId\(appId\)\?\.id/)
})

test('admin edits a mini program by internal record id before opening settings', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../admin/src/main.js'), 'utf8')
  const routesSource = fs.readFileSync(path.resolve(__dirname, '../src/routes.js'), 'utf8')

  assert.match(script, /saveMiniProgramRequest\('\/api\/admin\/miniprogram\/select', \{ id \}\)/)
  assert.match(script, /if \(await setActiveMiniProgram\(editMpButton\.dataset\.mpEdit\)\) showSection\('system'\)/)
  assert.match(routesSource, /setCurrentMiniProgram\(body\.id\)/)
})

test('admin groups home ads and exposes per-placement fallback controls', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../admin/src/main.js'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../admin/src/styles.css'), 'utf8')
  const settingsSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/admin/admin-settings.store.js'), 'utf8')

  const homeIndex = script.indexOf("title: '首页'")
  assert.ok(homeIndex >= 0)
  assert.match(script, /keys: \['homeDailyContentRewarded', 'homeCheckInRewarded', 'homeNative', 'homeInterstitial'\]/)
  assert.doesNotMatch(script, /title: '激励广告'/)
  assert.match(script, /<label>激励广告弹窗提醒<\/label>/)
  assert.match(script, /data-config-field="confirmPopupEnabled"/)
  assert.match(script, /<label>无广告时视为看完<\/label>/)
  assert.match(script, /data-config-field="allowOnUnavailable"/)
  assert.match(script, /data-config-field="delaySeconds" type="number" min="0" max="300"/)
  assert.doesNotMatch(script, /data-config-field="delaySeconds" type="number" min="0" max="30"/)
  assert.match(script, /Number\(item\.delaySeconds \?\? 3\)/)
  assert.match(script, /<label>首次展示在第几条后<\/label>/)
  assert.match(script, /data-config-field="firstAfter" type="number" min="1" max="100"/)
  assert.match(script, /<label>之后每隔几条展示<\/label>/)
  assert.match(script, /data-config-field="interval" type="number" min="1" max="100"/)
  assert.match(script, /<label>插屏循环（秒）<\/label>/)
  assert.match(script, /data-config-field="repeatSeconds" type="number" min="0" max="300"/)
  assert.match(script, /data-config-field="repeatSeconds"[^>]*placeholder="设为 0 时只展示一次"/)
  assert.doesNotMatch(script, /<span class="field-hint">设为 0 时只展示一次<\/span>/)
  assert.match(script, /item\.adType === 'rewarded' \? 'ad-config-card-balanced' : 'ad-config-card-stacked'/)
  assert.match(script, /form-field ad-config-id-field/)
  assert.match(styles, /\.ad-config-card-stacked \.ad-config-id-field\s*\{[^}]*grid-column: 1 \/ -1;/)
  assert.match(settingsSource, /confirmPopupEnabled: true/)
  assert.match(settingsSource, /allowOnUnavailable: true/)
  assert.match(settingsSource, /lettersNative: \{[^\n]*firstAfter: 3, interval: 10/)
  assert.match(settingsSource, /articlesNative: \{[^\n]*firstAfter: 3, interval: 10/)
  assert.match(settingsSource, /articlesNative: \{[^\n]*adType: 'native'/)
  assert.match(settingsSource, /articlesInterstitial: \{[^\n]*adType: 'interstitial'/)
  assert.match(settingsSource, /articlesStartNative: \{[^\n]*adType: 'native'/)
  assert.match(settingsSource, /articlesEndNative: \{[^\n]*adType: 'native'/)
  const articlePage = script.indexOf("title: '文章'")
  const articleKeys = script.slice(articlePage, articlePage + 260)
  assert.match(articleKeys, /keys: \['articlesNative', 'articlesInterstitial', 'articleExpandRewarded', 'articleInterstitial', 'articlesStartNative', 'articlesEndNative'\]/)
  assert.match(settingsSource, /mineNative: \{[^\n]*firstAfter: 3, interval: 10/)
  assert.equal((settingsSource.match(/repeatSeconds: 90/g) || []).length, 5)
})

test('saving ad settings does not submit unrelated content', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../admin/src/main.js'), 'utf8')

  assert.match(script, /async function saveContentEditor\(event\)/)
  assert.match(script, /event\?\.currentTarget\?\.closest\('#ads'\)[\s\S]*?\{ ads: collectSwitchConfig\('ads', contentState\.ads\) \}[\s\S]*?: collectContentEditor\(\)/)
})

test('service preflight does not repeat explicitly deferred image safety work', () => {
  const adminSource = path.resolve(__dirname, '../admin/src')
  const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const serviceSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/admin/admin-config.service.js'), 'utf8')

  assert.doesNotMatch(markup, /仅检查我们的 Admin 与服务端/)
  assert.match(script, /if \(preflightLoadPromise\) return preflightLoadPromise/)
  assert.match(script, /preflightLoadPromise = null/)
  assert.match(script, /const statusOrder = \{ fail: 0, warn: 1, pass: 2 \}/)
  assert.doesNotMatch(serviceSource, /makeCheck\('图片安全'/)
  assert.doesNotMatch(serviceSource, /auditPublicMediaUrls|method: 'HEAD'|redirect: 'follow'/)
})

