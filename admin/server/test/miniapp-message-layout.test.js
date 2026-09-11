const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const miniappRoot = path.resolve(__dirname, '../../../miniprogram')

function readMiniappFile(relativePath) {
  return fs.readFileSync(path.join(miniappRoot, relativePath), 'utf8')
}

function declarationValue(rule, property) {
  return rule.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1].trim() || ''
}

test('message editors replace the input heading with a private hint below the full-width textarea', () => {
  const editorPattern = /<textarea class="message-input"[^>]*><\/textarea>\s*<view class="message-input-row">\s*<text class="message-label">留言仅你和对方可见<\/text>\s*<button class="message-submit[^>]*>[\s\S]*?<\/button>\s*<\/view>/g
  const expectedEditors = {
    'pages/home/home.wxml': 3,
    'pages/letters/letters.wxml': 1,
  }

  for (const [relativePath, expectedCount] of Object.entries(expectedEditors)) {
    const template = readMiniappFile(relativePath)
    assert.doesNotMatch(template, /输入留言/)
    const editors = template.match(editorPattern) || []
    assert.equal(editors.length, expectedCount, relativePath)
    editors.forEach((editor) => {
      assert.match(editor, /placeholder="写下你想说的话…"/)
      assert.match(editor, /placeholder-class="message-input-placeholder"/)
      assert.match(editor, /bindinput="handleMessageInput"/)
      assert.match(editor, /aria-label="\{\{[^}]*正在提交留言[^}]*确认留言[^}]*\}\}"/)
      assert.match(editor, /disabled="\{\{(?:item\.)?messageSubmitting \|\| !(?:item\.)?messageText\.length\}\}"/)
      assert.match(editor, /bindtap="handleSubmitMessage"/)
      assert.match(editor, /button-loading-dots button-loading-dots--light/)
    })
    assert.doesNotMatch(template, /placeholder="留句悄悄话"/)
  }
})

test('message editor shared styles keep the bottom row aligned and the textarea full width', () => {
  const styles = readMiniappFile('styles/components.wxss')
  assert.match(styles, /\.message-input-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+100rpx;[^}]*align-items:\s*center;[^}]*gap:\s*var\(--control-gap\);[^}]*padding-top:\s*var\(--space-2\);[^}]*border-top:\s*1rpx dashed var\(--color-line-soft\);/s)
  assert.match(styles, /\.message-input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*80rpx;[^}]*max-height:\s*240rpx;/s)
  const inputRule = styles.match(/\.message-input\s*\{([^}]*)\}/)?.[1] || ''
  const placeholderRule = styles.match(/\.message-input-placeholder\s*\{([^}]*)\}/)?.[1] || ''
  for (const property of ['font-size', 'line-height', 'font-weight', 'letter-spacing']) {
    assert.equal(declarationValue(placeholderRule, property), declarationValue(inputRule, property), property)
  }
  assert.notEqual(declarationValue(placeholderRule, 'color'), declarationValue(inputRule, 'color'))
  assert.deepEqual(
    [...placeholderRule.matchAll(/^\s*([\w-]+):/gm)].map((match) => match[1]).sort(),
    ['color', 'font-size', 'font-weight', 'letter-spacing', 'line-height'].sort(),
  )
  const submitRule = styles.match(/\.message-submit\s*\{([^}]*)\}/)?.[1] || ''
  const disabledSubmitRule = styles.match(/\.message-submit\[disabled\]\s*\{([^}]*)\}/)?.[1] || ''
  for (const property of ['color', 'background', 'box-shadow', 'opacity']) {
    assert.equal(declarationValue(disabledSubmitRule, property), declarationValue(submitRule, property), property)
  }
  assert.doesNotMatch(styles, /message-(?:private|privacy|hint)/)
})
