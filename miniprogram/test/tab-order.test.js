const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))

test('native and custom tabs keep the final home, articles, letters, mine order', () => {
  const expectedPaths = [
    'pages/home/home',
    'pages/articles/articles',
    'pages/letters/letters',
    'pages/mine/mine',
  ]
  assert.deepEqual(appConfig.tabBar.list.map((item) => item.pagePath), expectedPaths)

  const tabsPath = require.resolve('../utils/tabs')
  delete require.cache[tabsPath]
  global.wx = {
    getStorageSync() { return '' },
    removeStorageSync() {},
  }
  const { defaultTabs, normalizeTabs } = require(tabsPath)
  assert.deepEqual(defaultTabs.map((item) => item.pagePath), expectedPaths)
  assert.deepEqual(normalizeTabs().map((item) => item.pagePath), expectedPaths)
  delete global.wx
})
