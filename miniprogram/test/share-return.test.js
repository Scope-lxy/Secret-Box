const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('share return is paired with the following hide and consumed once', () => {
  const app = read('app.js')
  assert.match(app, /shareReturnExpiresAt:\s*0/)
  assert.match(app, /shareReturnPending:\s*false/)
  assert.match(app, /this\.globalData\.shareReturnPending === true/)
  assert.match(app, /this\.globalData\.shareReturnPending = false/)
  assert.match(app, /if \(!shareReturn\) this\.globalData\.foregroundVersion \+= 1/)
  assert.match(app, /markShareReturn\(\)\s*\{[\s\S]*Date\.now\(\) \+ 10000/)
})

test('unpaired share marker expires before a real return', () => {
  const source = read('app.js')
  let appDefinition
  const context = {
    App(definition) { appDefinition = definition },
    wx: {},
    getCurrentPages() { return [] },
    require(request) {
      if (request.endsWith('/config/env')) return { getMiniProgramAppId: () => 'test' }
      if (request.endsWith('/services/miniapp')) return { handleDataScopeChange() {}, startOfflineSync() {} }
      if (request.endsWith('/utils/request')) return { getStoredDataScopeId: () => '', hasPersistedSession: () => false, refreshDataScopeId() {}, revalidateMiniAppSession() {} }
      if (request.endsWith('/utils/copy-pack')) return { fetchCopyPack() {} }
      if (request.endsWith('/utils/startup-config')) return { getStartupConfig: () => ({ finally() {} }) }
      throw new Error(`unexpected require: ${request}`)
    },
    Date,
  }
  vm.runInNewContext(source, context, { filename: 'app.js' })
  const app = { globalData: { ...appDefinition.globalData }, appWasHidden: false }
  let now = 1000
  const originalNow = Date.now
  Date.now = () => now
  try {
    app.markShareReturn = appDefinition.markShareReturn
    app.onHide = appDefinition.onHide
    app.onShow = appDefinition.onShow
    app.markShareReturn()
    app.onShow()
    assert.equal(app.globalData.foregroundVersion, 0)
    now = 12001
    app.onHide()
    app.onShow()
    assert.equal(app.globalData.foregroundVersion, 1)
  } finally {
    Date.now = originalNow
  }
})

test('article, letter, and home share entry points mark the app return', () => {
  for (const relativePath of ['pages/article/article.js', 'pages/letters/letters.js', 'pages/home/home.js']) {
    const source = read(relativePath)
    assert.match(source, /onShareAppMessage[\s\S]*getApp\(\)\.markShareReturn\?\.\(\)/)

    // Execute the entry method far enough to prove the marker is called.
    // The remaining share-card dependencies are intentionally absent here;
    // reaching that code after the marker is the behavior under test.
    const start = source.indexOf('onShareAppMessage(')
    const open = source.indexOf('{', start)
    let depth = 0
    let end = open
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      if (source[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const shareContext = { markerCalls: 0 }
    const method = vm.runInNewContext(`(function ${source.slice(start, end + 1)})`, {
      getApp: () => ({ markShareReturn() { shareContext.markerCalls += 1 } }),
    })
    assert.throws(() => method.call({ data: { article: { title: '' }, items: [] } }, {}))
    assert.equal(shareContext.markerCalls, 1, `${relativePath} should mark share return before composing the card`)
  }
})

test('article and letter async share payloads preserve the exact target path', () => {
  for (const [relativePath, expected] of [
    ['pages/article/article.js', /const sharePath = `\/pages\/article\/article\?contentId=/],
    ['pages/letters/letters.js', /const sharePath = `\/pages\/letters\/letters\?contentId=/],
  ]) {
    const source = read(relativePath)
    assert.match(source, expected)
    const start = source.indexOf('onShareAppMessage(')
    const body = source.slice(start)
    assert.match(body, /promise:\s*cardPromise/)
    assert.match(body, /path:\s*sharePath/)
    assert.match(body, /path: sharePath[\s\S]*?\}/)
  }
})
