const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('home, letters, and article share one action-bar spacing rule', () => {
  const tokens = fs.readFileSync(path.join(__dirname, '../styles/tokens.wxss'), 'utf8')
  const components = fs.readFileSync(path.join(__dirname, '../styles/components.wxss'), 'utf8')
  const pageStyles = ['home', 'letters', 'article'].map((page) => (
    fs.readFileSync(path.join(__dirname, `../pages/${page}/${page}.wxss`), 'utf8')
  ))
  const baseTokens = tokens.match(/\.theme\s*\{([\s\S]*?)\}/)?.[1] || ''
  const largerTokens = tokens.match(/\.theme\.font-larger\s*\{([\s\S]*?)\}/)?.[1] || ''
  const maxTokens = tokens.match(/\.theme\.font-max\s*\{([\s\S]*?)\}/)?.[1] || ''

  assert.match(tokens, /--action-bar-padding-y:\s*var\(--space-1\);/)
  assert.match(components, /\.action-bar-surface\s*\{[^}]*padding-bottom:\s*0;/s)
  assert.match(components, /\.action-bar\s*\{[^}]*display:\s*flex;[^}]*padding:\s*var\(--action-bar-padding-y\)\s+0;/s)
  assert.match(components, /\.action-pill\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*var\(--action-height\);/s)
  assert.match(baseTokens, /--action-height:\s*72rpx;/)
  assert.match(largerTokens, /--action-height:\s*76rpx;/)
  assert.match(maxTokens, /--action-height:\s*80rpx;/)

  for (const page of ['home', 'letters', 'article']) {
    const template = fs.readFileSync(path.join(__dirname, `../pages/${page}/${page}.wxml`), 'utf8')
    assert.match(template, /class="[^"]*action-bar-surface[^"]*"[\s\S]*class="action-bar"/)
  }
  for (const styles of pageStyles) assert.doesNotMatch(styles, /\.action-bar\s*\{/)
  assert.doesNotMatch(pageStyles[0], /\.daily-content-card\s*\{[^}]*padding-bottom\s*:/s)
  assert.match(pageStyles[0], /\.daily-content-card--with-actions\s*\{[^}]*padding-bottom:\s*0;/s)
  assert.match(fs.readFileSync(path.join(__dirname, '../pages/home/home.wxml'), 'utf8'), /daily-content-card stack \{\{dailyContent \? 'daily-content-card--with-actions' : ''\}\}/)
})
