const MESSAGE_CONTENT_MAX_UNITS = 200
const MESSAGE_CONTENT_LIMIT_TEXT = '最多可输入 100 个中文字符'

function getMessageContentUnits(value) {
  let units = 0
  for (const character of String(value || '')) {
    units += character.codePointAt(0) <= 0x7f ? 1 : 2
  }
  return units
}

function truncateMessageContent(value) {
  let units = 0
  let result = ''
  for (const character of String(value || '')) {
    const characterUnits = character.codePointAt(0) <= 0x7f ? 1 : 2
    if (units + characterUnits > MESSAGE_CONTENT_MAX_UNITS) break
    units += characterUnits
    result += character
  }
  return result
}

function normalizeMessageContent(value) {
  return String(value || '').trim()
}

function isMessageContentWithinLimit(value) {
  return getMessageContentUnits(value) <= MESSAGE_CONTENT_MAX_UNITS
}

module.exports = {
  MESSAGE_CONTENT_LIMIT_TEXT,
  getMessageContentUnits,
  isMessageContentWithinLimit,
  normalizeMessageContent,
  truncateMessageContent,
}
