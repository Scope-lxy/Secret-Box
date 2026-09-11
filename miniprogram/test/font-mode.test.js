const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const fontModePath = path.join(__dirname, '../utils/font-mode')

test('font size mode persists normal, larger, and max while unknown values fall back to larger', () => {
  const storage = {}
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value },
  }
  delete require.cache[require.resolve(fontModePath)]
  const { getFontSizeMode, setFontSizeMode } = require(fontModePath)

  assert.equal(getFontSizeMode(), 'larger')
  assert.equal(setFontSizeMode('normal'), 'normal')
  assert.equal(getFontSizeMode(), 'normal')
  assert.equal(setFontSizeMode('max'), 'max')
  assert.equal(getFontSizeMode(), 'max')
  assert.equal(setFontSizeMode('unexpected'), 'larger')
  assert.equal(getFontSizeMode(), 'larger')
  delete global.wx
})

test('max mode exposes the requested reading sizes and scales supporting tokens', () => {
  const tokens = fs.readFileSync(path.join(__dirname, '../styles/tokens.wxss'), 'utf8')
  const maxBlock = tokens.match(/\.theme\.font-max\s*\{([\s\S]*?)\}/)?.[1] || ''
  assert.match(maxBlock, /--type-title:\s*44rpx;/)
  assert.match(maxBlock, /--type-body:\s*40rpx;/)
  assert.match(maxBlock, /--type-article-detail-title:\s*42rpx;/)
  assert.match(maxBlock, /--type-tab:\s*26rpx;/)
  assert.match(maxBlock, /--type-action:\s*30rpx;/)
  assert.match(maxBlock, /--action-height:\s*80rpx;/)
  assert.match(maxBlock, /--action-icon-size:\s*40rpx;/)
  assert.match(maxBlock, /--article-side-title-height:\s*138rpx;/)
})

test('interaction counts use compactNumber for numeric labels and share action typography', () => {
  const { compactNumber, withInteractionDisplayCounts } = require('../utils/format')
  assert.equal(compactNumber(999), '999')
  assert.equal(compactNumber(1000), '1k')
  assert.equal(compactNumber(1200), '1.2k')
  assert.equal(compactNumber(9999), '10k')
  assert.equal(compactNumber(10000), '1w')
  assert.equal(compactNumber(12000), '1.2w')
  assert.deepEqual(withInteractionDisplayCounts({ likeCount: 12000, favoriteCount: 0 }), {
    likeCount: 12000,
    favoriteCount: 0,
    displayLikeCount: '1.2w',
    displayFavoriteCount: '',
  })
  const components = fs.readFileSync(path.join(__dirname, '../styles/components.wxss'), 'utf8')
  assert.match(components, /\.action-pill\s*\{[\s\S]*font-size:\s*var\(--type-action\);/)
  assert.match(components, /\.action-icon\s*\{[\s\S]*var\(--action-icon-size\)/)
  const mine = fs.readFileSync(path.join(__dirname, '../pages/mine/mine.js'), 'utf8')
  assert.match(mine, /compactNumber\(\(activity\.summary\s*&&\s*activity\.summary\.favorites\)/)
  for (const relativePath of ['../pages/home/home.wxml', '../pages/article/article.wxml', '../pages/letters/letters.wxml']) {
    const template = fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
    assert.match(template, /displayLikeCount\s*\|\|\s*'点赞'/)
    assert.match(template, /displayFavoriteCount\s*\|\|\s*'收藏'/)
  }
})

test('secondary nav and mine identity typography stay fixed in every font mode', () => {
  const navStyles = fs.readFileSync(path.join(__dirname, '../components/immersive-nav/immersive-nav.wxss'), 'utf8')
  const tokens = fs.readFileSync(path.join(__dirname, '../styles/tokens.wxss'), 'utf8')
  const mineStyles = fs.readFileSync(path.join(__dirname, '../pages/mine/mine.wxss'), 'utf8')

  assert.doesNotMatch(navStyles, /\.nav-row\s*\{[^}]*padding-left:/s)
  assert.match(navStyles, /\.nav-title\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*font-size:\s*var\(--type-nav-title\);[^}]*transform:\s*translate\(-50%,\s*-50%\);/s)
  assert.match(tokens, /--type-nav-title:\s*36rpx;/)
  for (const mode of ['font-larger', 'font-max']) {
    const modeBlock = tokens.match(new RegExp(`\\.theme\\.${mode}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || ''
    assert.doesNotMatch(modeBlock, /--type-nav-title\s*:/)
  }
  assert.match(navStyles, /\.immersive-hero-title\s*\{[^}]*font-size:\s*var\(--type-hero\);/s)
  assert.match(mineStyles, /\.avatar\s*\{[^}]*font-size:\s*var\(--type-metric\);/s)
  assert.match(mineStyles, /\.profile-copy\s+\.title-lg\s*\{[^}]*font-size:\s*var\(--type-metric\);/s)
  assert.match(mineStyles, /\.settings-link\s*\{[^}]*font-size:\s*var\(--type-control\);/s)
  assert.match(mineStyles, /\.section-title\s*\{[^}]*font-size:\s*var\(--type-section\);/s)
})

test('settings offers max mode and every page root maps it to font-max', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../pages/settings/settings.js'), 'utf8')
  assert.match(settings, /\['普通',\s*'较大',\s*'最大'\]/)
  assert.match(settings, /index === 2 \? 'max'/)

  const wxmlFiles = [
    '../custom-tab-bar/index.wxml',
    ...fs.readdirSync(path.join(__dirname, '../pages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const file = path.join(__dirname, '../pages', entry.name, `${entry.name}.wxml`)
        return fs.existsSync(file) ? [`../pages/${entry.name}/${entry.name}.wxml`] : []
      }),
  ]
  for (const relativePath of wxmlFiles) {
    const template = fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
    if (template.includes('fontSizeMode')) assert.match(template, /fontSizeMode === 'max' \? 'font-max'/)
  }
})
