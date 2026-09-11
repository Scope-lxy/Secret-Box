const STORAGE_KEY = 'fontSizeMode'

function getFontSizeMode() {
  const savedMode = wx.getStorageSync(STORAGE_KEY)
  return savedMode === 'normal' || savedMode === 'max' ? savedMode : 'larger'
}

function setFontSizeMode(mode) {
  const value = mode === 'normal' || mode === 'max' ? mode : 'larger'
  wx.setStorageSync(STORAGE_KEY, value)
  return value
}

module.exports = { getFontSizeMode, setFontSizeMode }
