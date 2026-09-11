const { getFontSizeMode } = require('../../../utils/font-mode')
Page({
  data: { fontSizeMode: 'larger' },
  onShow() { this.setData({ fontSizeMode: getFontSizeMode() }) },
})
