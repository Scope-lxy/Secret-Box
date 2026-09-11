const assert = require('node:assert/strict')
const test = require('node:test')

const { splitContentParagraphs } = require('../../../miniprogram/utils/paragraphs')
const { normalizeActivityListItem, withPreviewParagraphs } = require('../../../miniprogram/utils/format')

test('content paragraphs prefer sentence endings near the 25-character target', () => {
  const text = '第一句刚好有十个字呀。第二句补足到二十五字左右。第三句继续补充内容让总长度超过四十字。'

  assert.deepEqual(splitContentParagraphs(text), [
    '第一句刚好有十个字呀。第二句补足到二十五字左右。',
    '第三句继续补充内容让总长度超过四十字。',
  ])
})

test('content at or below 30 characters stays in one paragraph even with sentence endings', () => {
  const text = '第一句很短。第二句也很短。'

  assert.deepEqual(splitContentParagraphs(text), [text])
})

test('a complete sentence takes priority over a comma near the 25-character target', () => {
  const text = `${'甲'.repeat(24)}，${'乙'.repeat(13)}。${'丙'.repeat(11)}`

  assert.deepEqual(splitContentParagraphs(text), [
    `${'甲'.repeat(24)}，${'乙'.repeat(13)}。`,
    '丙'.repeat(11),
  ])
})

test('content paragraphs use secondary punctuation only when no sentence ending fits', () => {
  const text = '这是一段没有句号但是在合适位置有逗号可以切开的较长文本，后半段继续补充内容直到超过四十个字仍然没有完整句号'

  assert.deepEqual(splitContentParagraphs(text), [
    '这是一段没有句号但是在合适位置有逗号可以切开的较长文本，',
    '后半段继续补充内容直到超过四十个字仍然没有完整句号',
  ])
})

test('content paragraphs use normal spaces only when the full text has no punctuation', () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'

  assert.deepEqual(splitContentParagraphs(text), [
    'one two three four five',
    'six seven eight nine ten',
    'eleven twelve thirteen',
    'fourteen fifteen sixteen',
  ])
})

test('content paragraphs evenly split continuous text without punctuation or spaces', () => {
  const text = '甲'.repeat(50)

  assert.deepEqual(splitContentParagraphs(text), [
    '甲'.repeat(25),
    '甲'.repeat(25),
  ])
})

test('an overlong sentence can use a secondary punctuation boundary', () => {
  const text = `${'甲'.repeat(24)}，${'乙'.repeat(25)}。`

  assert.deepEqual(splitContentParagraphs(text), [
    `${'甲'.repeat(24)}，`,
    `${'乙'.repeat(25)}。`,
  ])
})

test('content paragraphs keep closing quotes and continuous ellipses with the preceding sentence', () => {
  const quoted = `${'甲'.repeat(23)}。”${'乙'.repeat(12)}`
  const ellipsis = `${'甲'.repeat(23)}……${'乙'.repeat(12)}`
  const asciiEllipsis = `${'甲'.repeat(23)}...${'乙'.repeat(12)}`

  assert.deepEqual(splitContentParagraphs(quoted), [
    `${'甲'.repeat(23)}。”`,
    '乙'.repeat(12),
  ])
  assert.deepEqual(splitContentParagraphs(ellipsis), [
    `${'甲'.repeat(23)}……`,
    '乙'.repeat(12),
  ])
  assert.deepEqual(splitContentParagraphs(asciiEllipsis), [
    `${'甲'.repeat(23)}...`,
    '乙'.repeat(12),
  ])
})

test('content paragraphs do not use spaces when a long sentence contains punctuation later', () => {
  const text = '文本里已经有标点但它在四十字之后 English words must not create a paragraph before this comma，剩余内容'
  const paragraphs = splitContentParagraphs(text)

  assert.equal(paragraphs.length, 3)
  assert.equal(paragraphs[0], Array.from(text).slice(0, 27).join(''))
  assert.equal(paragraphs[0].endsWith(' '), false)
})

test('activity preview paragraphs are opt-in so user messages keep one preview string', () => {
  const preview = '第一段内容足够长。第二段内容也足够长。第三段继续补充直到超过四十个字。第四段继续补充以确保需要自动分段。'
  const activity = normalizeActivityListItem({ preview })

  assert.equal(activity.previewParagraphs, undefined)
  assert.equal(activity.preview, preview)
  assert.ok(withPreviewParagraphs(activity).previewParagraphs.length > 1)
})
