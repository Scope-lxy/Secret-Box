const assert = require('node:assert/strict')
const test = require('node:test')

const { markListAdSlots } = require('../../../miniprogram/utils/list-ads')

test('list ad slots start after the requested item and repeat every ten items', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }))

  assert.deepEqual(
    markListAdSlots(items, 2).filter((item) => item.showNativeAdAfter).map((item) => item.id),
    [2, 12, 22],
  )
  assert.deepEqual(
    markListAdSlots(items, 1).filter((item) => item.showNativeAdAfter).map((item) => item.id),
    [1, 11, 21],
  )
  assert.deepEqual(items, Array.from({ length: 25 }, (_, index) => ({ id: index + 1 })))
})

test('ad markers are based on final display order', () => {
  const reordered = [{ id: 'shared' }, { id: 'second' }, { id: 'third' }]
  assert.equal(markListAdSlots(reordered, 2)[1].showNativeAdAfter, true)
  assert.equal(markListAdSlots(reordered, 2)[0].showNativeAdAfter, false)
})

test('list ad slots honor a configured first position and interval', () => {
  const items = Array.from({ length: 15 }, (_, index) => ({ id: index + 1 }))
  assert.deepEqual(
    markListAdSlots(items, 3, 4).filter((item) => item.showNativeAdAfter).map((item) => item.id),
    [3, 7, 11, 15],
  )
})
