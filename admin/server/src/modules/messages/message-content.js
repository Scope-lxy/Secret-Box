const MESSAGE_CONTENT_MAX_UNITS = 200
const MESSAGE_CONTENT_LIMIT_TEXT = '最多可输入 100 个中文字符'

function getMessageContentUnits(value) {
  let units = 0
  for (const character of String(value || '')) {
    units += character.codePointAt(0) <= 0x7f ? 1 : 2
  }
  return units
}

function normalizeMessageContent(value) {
  return String(value || '').trim()
}

function assertMessageContentWithinLimit(value) {
  if (getMessageContentUnits(value) > MESSAGE_CONTENT_MAX_UNITS) {
    throw new Error(MESSAGE_CONTENT_LIMIT_TEXT)
  }
}

module.exports = {
  MESSAGE_CONTENT_MAX_UNITS,
  MESSAGE_CONTENT_LIMIT_TEXT,
  assertMessageContentWithinLimit,
  getMessageContentUnits,
  normalizeMessageContent,
}
