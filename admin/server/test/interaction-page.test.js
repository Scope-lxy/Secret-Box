const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const { normalizeActivityListItem } = require('../../../miniprogram/utils/format')

test('interaction records use content type and action labels in one badge row', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/interactions/interactions.wxml'), 'utf8')
  const styles = fs.readFileSync(path.resolve(__dirname, '../../../miniprogram/pages/interactions/interactions.wxss'), 'utf8')

  assert.match(template, /<view class="history-meta"><text class="type-badge">\{\{item\.type\}\}<\/text><text wx:for="\{\{item\.actions\}\}"/)
  assert.equal(template.includes('{{item.type}}'), true)
  assert.equal(template.includes('interaction-actions'), false)
  assert.equal(styles.includes('interaction-badge'), false)
})

test('secondary activity lists remove redundant action words from time labels', () => {
  const cases = [
    ['刚刚互动', '刚刚'],
    ['8月15日 互动', '8月15日'],
    ['今天留言', '今天'],
    ['昨天 21:10 打开', '昨天 21:10'],
    ['收藏于 前天', '前天'],
  ]

  cases.forEach(([time, expected]) => {
    assert.equal(normalizeActivityListItem({ time }).time, expected)
  })
})
