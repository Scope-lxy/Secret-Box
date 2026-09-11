const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const adminSource = path.resolve(__dirname, '../admin/src')
const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
const main = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
const importer = fs.readFileSync(path.join(adminSource, 'import.js'), 'utf8')
const articles = fs.readFileSync(path.join(adminSource, 'article-manager.js'), 'utf8')

test('导入页展示全部内容池并默认使用当前实例绑定池', () => {
  assert.match(markup, /<label class="import-target-pool" for="importTargetPool">[\s\S]*?<span>导入到<\/span>[\s\S]*?id="importTargetPool"/)
  assert.match(main, /function getAdminContentImportContext\(\)[\s\S]*?boundPoolId: getMiniProgramContentPoolId\(miniProgram\)[\s\S]*?contentPools:[\s\S]*?miniProgramId:/)
  assert.match(importer, /const fallbackPoolId = String\(current\.boundPoolId \|\| contentPools\[0\]\?\.id \|\| ''\)/)
  assert.match(importer, /item\.id === context\.boundPoolId \? '（当前实例绑定）' : ''/)
})

test('所有入口默认绑定池且页内切换类型保留本次手动选择', () => {
  assert.match(importer, /nav-item\[data-section="import"\][^\n]*openImport\(\{ type \}\)/)
  assert.doesNotMatch(importer, /nav-item\[data-section="import"\][^\n]*state\.(?:poolId|targetPoolId)/)
  const cardImport = main.slice(main.indexOf('function openContentImport(type)'), main.indexOf('function setStatus'))
  assert.match(cardImport, /miniProgramId: getCurrentMiniProgram\(\)\?\.id \|\| ''[\s\S]*?type,/)
  assert.doesNotMatch(cardImport, /poolId/)
  assert.match(importer, /const preservedPoolId = detail\.preserveTarget \? String\(detail\.poolId \|\| ''\)\.trim\(\) : ''/)
  assert.match(importer, /contentPools\.some\(\(item\) => item\.id === preservedPoolId\) \? preservedPoolId : fallbackPoolId/)
  assert.match(importer, /openImport\(\{ type: button\.dataset\.importType,[^\n]*preserveTarget: true \}\)/)
})

test('切换实例和修改绑定后内容编辑池跟随当前绑定', () => {
  assert.match(main, /function syncEditingContentPoolToCurrentMiniProgram\(\)[\s\S]*?editingContentPoolId = pools\.some[\s\S]*?contentPagination = createContentPaginationState\(\)/)
  const switchMiniProgram = main.slice(main.indexOf('async function setActiveMiniProgram'), main.indexOf('function collectStorageSettings'))
  assert.match(switchMiniProgram, /saveMiniProgramRequest[\s\S]*?syncEditingContentPoolToCurrentMiniProgram\(\)[\s\S]*?loadContentEditor\(\)/)
  const saveMiniProgram = main.slice(main.indexOf('async function saveMiniProgramInfo'), main.indexOf('function collectDailyContentTypes'))
  assert.match(saveMiniProgram, /if \(contentPoolChanged\) \{[\s\S]*?syncEditingContentPoolToCurrentMiniProgram\(\)[\s\S]*?loadContentEditor\(\)/)
})

test('普通批量导入的预检和最终写入始终使用所选目标池', () => {
  assert.match(importer, /const preflightBody = \{[\s\S]*?miniProgramId: state\.miniProgramId,[\s\S]*?poolId: state\.targetPoolId/)
  assert.match(importer, /function importPayload\(\)[\s\S]*?poolId: state\.targetPoolId,[\s\S]*?miniProgramId: state\.miniProgramId/)
  assert.match(importer, /async function changeTargetPool\(\)[\s\S]*?await loadContent\(\)[\s\S]*?await parseTextSource\(selectionGeneration\)[\s\S]*?await selectRecords\(state\.records, state\.sourceName\)/)
  assert.doesNotMatch(importer, /state\.poolId/)
})

test('文章抓取锁定并贯穿本次所选内容池', () => {
  assert.match(articles, /importContext: \{ miniProgramId: '', poolId: '' \}/)
  assert.match(articles, /articlePath\('\/import', \{\}, state\.importContext\)/)
  assert.match(articles, /body: JSON\.stringify\(\{ \.\.\.state\.importContext, urls \}\)/)
  assert.match(articles, /content-import-target-lock'[\s\S]*?locked: true/)
  assert.match(articles, /articlePath\(`\/import\/\$\{encodeURIComponent\(state\.importJobId\)\}\/publish`, \{\}, state\.importContext\)/)
  assert.match(articles, /content-import-complete'[\s\S]*?miniProgramId: state\.importContext\.miniProgramId[\s\S]*?poolId: state\.importContext\.poolId/)
  assert.match(articles, /showToast\(`已导入 \$\{selectedIds\.length\} 篇文章`\)[\s\S]*?resetImportWorkspace\(\)[\s\S]*?renderImportItems\(\)/)
  const publishImported = articles.slice(articles.indexOf('async function publishImported'), articles.indexOf('async function retryImportItem'))
  assert.doesNotMatch(publishImported, /document\.querySelector\('#import'\)\?\.classList\.remove\('article-url-import-active'\)|nodes\.importPanel\?\.classList\.add\('hidden'\)/)
  assert.doesNotMatch(main, /window\.addEventListener\('content-import-complete'/)
  assert.match(importer, /content-import-target-change'[\s\S]*?poolId: state\.targetPoolId/)
})

test('文章分页复用 main.js 的公共结构和事件注册器', () => {
  assert.match(main, /window\.AdminPagination = \{[\s\S]*?register\(scope, handler\)[\s\S]*?render: renderPagination/)
  assert.match(main, /if \(adminPaginationHandlers\.has\(scope\)\)[\s\S]*?adminPaginationHandlers\.get\(scope\)\(\{ page \}\)/)
  assert.match(main, /adminPaginationHandlers\.get\(scope\)\(\{ page: 1, pageSize \}\)/)
  assert.match(articles, /window\.AdminPagination\?\.render\('articles'/)
  assert.match(articles, /window\.AdminPagination\?\.register\('articles'/)
  assert.doesNotMatch(articles, /data-article-page|pagination-actions|function renderPagination\(/)
})
