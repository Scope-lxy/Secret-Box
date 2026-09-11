const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const adminSource = path.resolve(__dirname, '../admin/src')

function getTextareaTag(source, systemField) {
  const match = source.match(new RegExp(`<textarea\\b(?=[^>]*\\bdata-system-field="${systemField}")[^>]*>`, 'u'))
  assert.ok(match, `missing textarea for ${systemField}`)
  return match[0]
}

function getTextareaTagById(source, id) {
  const match = source.match(new RegExp(`<textarea\\b(?=[^>]*\\bid="${id}")[^>]*>`, 'u'))
  assert.ok(match, `missing textarea for ${id}`)
  return match[0]
}

function getTextareaHeightBounds(script) {
  const match = script.match(/function textareaHeightBounds\(textarea\) \{[\s\S]*?\n\}/u)
  assert.ok(match, 'missing textareaHeightBounds')
  return new Function('getComputedStyle', `${match[0]}\nreturn textareaHeightBounds`)(() => ({
    lineHeight: '20px',
    fontSize: '14px',
    paddingTop: '5px',
    paddingBottom: '5px',
    borderTopWidth: '1px',
    borderBottomWidth: '1px',
    minHeight: '0px',
  }))
}

function createTextarea({ rows, copyLibrary = false, shareTitlePool = false }) {
  return {
    rows,
    classList: {
      contains: (className) => (copyLibrary && className === 'copy-library-textarea') || (shareTitlePool && className === 'share-title-pool'),
    },
  }
}

test('admin table textareas stop growing after two lines and scroll remaining content', () => {
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

  assert.match(styles, /textarea \{\s*overflow-y: auto;\s*resize: none;/)
  assert.doesNotMatch(styles, /\.keyword-row textarea \{[\s\S]*?min-height: 82px;/)
  assert.match(script, /function resizeTextarea\(textarea\) \{[\s\S]*?const \{ maximum, minimum \} = textareaHeightBounds\(textarea\);?\s*textarea\.style\.height = 'auto';?\s*textarea\.style\.height = `\$\{Math\.min\(maximum, Math\.max\(minimum, textarea\.scrollHeight\)\)\}px`;?/)

  const heightBounds = getTextareaHeightBounds(script)
  assert.deepEqual(heightBounds(createTextarea({ rows: 10 })), { maximum: 52, minimum: 52 })
})

test('system copy textareas use a ten-line semantic height limit', () => {
  const html = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
  const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
  const systemFields = ['dailyContentPromptTexts', 'checkinBeforeTexts', 'checkinAfterTexts']
  const markedTextareas = [...html.matchAll(/<textarea\b(?=[^>]*\bclass="[^"]*\bcopy-library-textarea\b[^"]*")[^>]*>/gu)]

  assert.equal(markedTextareas.length, 3)
  assert.doesNotMatch(html, /\bdata-textarea-rows\b/u)
  systemFields.forEach((systemField) => {
    const textarea = getTextareaTag(html, systemField)
    assert.match(textarea, /\brows="10"/u)
    assert.match(textarea, /\bclass="[^"]*\bcopy-library-textarea\b[^"]*"/u)
  })
  assert.doesNotMatch(getTextareaTag(html, 'dailyContentPromptTexts'), /share-title-pool/u)
  ;['shareTitlePoolInput', 'shareCoverCopyPoolInput'].forEach((id) => {
    const textarea = getTextareaTagById(html, id)
    assert.match(textarea, /\bclass="share-title-pool"/u)
    assert.match(textarea, /\brows="10"/u)
  })

  assert.match(script, /const maximumRows = textarea\.classList\.contains\('copy-library-textarea'\) \|\| textarea\.classList\.contains\('share-title-pool'\) \? 10 : 2/u)
  assert.doesNotMatch(script, /textarea\.dataset\.textareaRows/u)

  const heightBounds = getTextareaHeightBounds(script)
  assert.deepEqual(heightBounds(createTextarea({ rows: 10, copyLibrary: true })), { maximum: 212, minimum: 212 })
  assert.deepEqual(heightBounds(createTextarea({ rows: 10, shareTitlePool: true })), { maximum: 212, minimum: 212 })
})
