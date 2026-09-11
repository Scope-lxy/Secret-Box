function markListAdSlots(items = [], firstAfter = 1, interval = 10) {
  const source = Array.isArray(items) ? items : []
  const firstPosition = Math.max(1, Number(firstAfter) || 1)
  const step = Math.max(1, Number(interval) || 10)
  return source.map((item, index) => {
    const position = index + 1
    return {
      ...item,
      showNativeAdAfter: position >= firstPosition && (position - firstPosition) % step === 0,
    }
  })
}

module.exports = {
  markListAdSlots,
}
