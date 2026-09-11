const businessTimeZone = 'Asia/Shanghai'

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: businessTimeZone,
  year: 'numeric',
})

function toBusinessDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(businessDateFormatter
    .formatToParts(date)
    .filter((item) => item.type !== 'literal')
    .map((item) => [item.type, item.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

module.exports = {
  businessTimeZone,
  toBusinessDateKey,
}
