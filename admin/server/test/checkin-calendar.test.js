const assert = require('node:assert/strict')
const test = require('node:test')

const { getLunarLabel, getRecentCalendar } = require('../src/modules/checkin/checkin.store')

test('calendar labels prioritize major festivals, then solar terms, then lunar dates', () => {
  assert.equal(getLunarLabel('2024-02-10'), '春节')
  assert.equal(getLunarLabel('2024-04-04'), '清明')
  assert.equal(getLunarLabel('2024-12-25'), '廿五')
  assert.equal(getLunarLabel('2024-03-12'), '初三')
  assert.equal(getLunarLabel('1900-09-08'), '中秋')
})

test('calendar labels keep lunar month starts and leap months compact', () => {
  assert.equal(getLunarLabel('2024-02-10'), '春节')
  assert.equal(getLunarLabel('2024-02-11'), '初二')
  assert.equal(getLunarLabel('2023-03-22'), '闰二')
  assert.equal(getLunarLabel('2024-01-11'), '腊月')
})

test('recent calendar retains its 14-day Monday-first range and check-in states', () => {
  const days = getRecentCalendar({ checkedDates: ['2024-02-10'] }, new Date('2024-02-10T12:00:00+08:00'))

  assert.equal(days.length, 14)
  assert.equal(days[0].date, '2024-01-29')
  assert.equal(days.at(-1).date, '2024-02-11')
  assert.deepEqual(days.slice(0, 7).map((item) => item.label), ['一', '二', '三', '四', '五', '六', '日'])
  assert.deepEqual(days.slice(7).map((item) => item.label), ['一', '二', '三', '四', '五', '六', '日'])

  const today = days.find((item) => item.date === '2024-02-10')
  assert.deepEqual(today, {
    date: '2024-02-10',
    label: '六',
    lunarLabel: '春节',
    checked: true,
    today: true,
  })
})
