const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const serverRules = require('../src/modules/messages/message-content')
const miniRules = require(path.resolve(__dirname, '../../../miniprogram/utils/message-content'))

test('留言长度统一按 ASCII 1、非 ASCII 2、总额度 200 计算', () => {
  const cases = [
    ['abc123!?', 8],
    ['中文ＡＢ', 8],
    ['a中🙂', 5],
  ]
  cases.forEach(([content, expected]) => {
    assert.equal(serverRules.getMessageContentUnits(content), expected)
    assert.equal(miniRules.getMessageContentUnits(content), expected)
  })
  assert.equal(serverRules.MESSAGE_CONTENT_MAX_UNITS, 200)
})

test('小程序输入超限时保留额度内前缀且不拆开 emoji', () => {
  const exact = `${'a'.repeat(198)}中`
  assert.equal(miniRules.truncateMessageContent(`${exact}tail`), exact)
  assert.equal(miniRules.truncateMessageContent('中'.repeat(101)), '中'.repeat(100))
  assert.equal(miniRules.truncateMessageContent('🙂'.repeat(101)), '🙂'.repeat(100))
})

test('服务端拒绝超限留言而不是静默截断', () => {
  assert.doesNotThrow(() => serverRules.assertMessageContentWithinLimit(`${'a'.repeat(198)}中`))
  assert.throws(
    () => serverRules.assertMessageContentWithinLimit(`${'a'.repeat(198)}中x`),
    /最多可输入 100 个中文字符/,
  )
})
