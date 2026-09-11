const assert = require('node:assert/strict')
const test = require('node:test')

const {
  DEFAULT_COPY_PACK,
  pickDailyContentPrompt,
  resolveCopy,
  resolveCopyText,
  splitDailyContentPrompt,
} = require('../utils/default-copy')

test('default copy pack keeps two entries for random slots and one for fixed slots', () => {
  for (const key of ['dailyContentPrompt', 'checkinBefore', 'checkinAfter']) {
    assert.equal(DEFAULT_COPY_PACK[key].length, 2, key)
  }
  for (const key of [
    'dailyContentAdIncomplete',
    'checkinAdIncomplete',
    'articleAdIncomplete',
    'articleExpandButton',
    'articleShareTitle',
    'publicShareTitleFallback',
    'openDailyContentConfirm',
    'changeDailyContentConfirm',
    'checkinAdConfirm',
    'adUnavailable',
    'networkFailure',
    'serviceFailure',
  ]) {
    assert.equal(DEFAULT_COPY_PACK[key].length, 1, key)
  }
  for (const type of ['text', 'image', 'audio']) {
    assert.equal(DEFAULT_COPY_PACK.sharePools[type].titles.length, 1, type)
    assert.equal(DEFAULT_COPY_PACK.sharePools[type].coverCopies.length, 1, type)
  }
})

test('admin copy overrides the whole pool instead of merging with defaults', () => {
  assert.deepEqual(
    resolveCopy(['自定义一', '自定义二'], 'dailyContentPrompt'),
    ['自定义一', '自定义二'],
  )
  assert.deepEqual(resolveCopy(['仅一条自定义'], 'checkinBefore'), ['仅一条自定义'])
  assert.deepEqual(resolveCopy('单个字符串文案', 'articleAdIncomplete'), ['单个字符串文案'])
  assert.deepEqual(resolveCopy([], 'checkinBefore'), DEFAULT_COPY_PACK.checkinBefore)
  assert.deepEqual(resolveCopy(null, 'checkinAfter'), DEFAULT_COPY_PACK.checkinAfter)
  assert.deepEqual(resolveCopy(['', '   '], 'checkinBefore'), DEFAULT_COPY_PACK.checkinBefore)
})

test('fixed slots resolve to the first available copy', () => {
  assert.equal(resolveCopyText('自定义文案', 'articleAdIncomplete'), '自定义文案')
  assert.equal(resolveCopyText(null, 'articleAdIncomplete'), '完整观看广告后，即可展开全文')
  assert.equal(resolveCopyText('', 'adUnavailable'), '激励广告暂不可用，请稍后重试')
  assert.equal(resolveCopyText(null, 'articleExpandButton'), '展开全文')
})

test('prompt picking uses admin copy only when it is usable', () => {
  const usable = pickDailyContentPrompt(['不能用的提示', '有些话，只等你亲手打开'], '')
  assert.equal(usable.text, '有些话，只等你亲手打开')

  const fallback = pickDailyContentPrompt(['没有逗号', '还是没逗号'], '')
  assert.ok(DEFAULT_COPY_PACK.dailyContentPrompt.includes(fallback.text))

  const avoidsRepeat = pickDailyContentPrompt(
    ['有些话，只等你亲手打开', '这一封，只写给今天的你'],
    '有些话，只等你亲手打开',
  )
  assert.equal(avoidsRepeat.text, '这一封，只写给今天的你')
})

test('prompt splitting requires the full-width comma pair', () => {
  const split = splitDailyContentPrompt('有些话，只等你亲手打开')
  assert.equal(split.firstLine, '有些话，')
  assert.equal(split.secondLine, '只等你亲手打开')

  assert.ok(splitDailyContentPrompt('').text.includes('，'))
})
