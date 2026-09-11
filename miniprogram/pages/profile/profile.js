const { getCachedProfileData, getProfileData, syncLogin, uploadAvatar, updateProfile } = require('../../services/miniapp')
const { getFontSizeMode } = require('../../utils/font-mode')
const { getAccountScopedStorageKey } = require('../../utils/request')

Page({
  data: {
    fontSizeMode: 'larger',
    error: '',
    form: {
      avatarText: '你',
      avatarUrl: '',
      nickname: '轻读用户',
      phone: '',
    },
    saving: false,
    phoneAuthorizing: false,
    uploadingAvatar: false,
  },

  onLoad() {
    this.setData({ fontSizeMode: getFontSizeMode() })
    const cached = getCachedProfileData()
    if (cached) this.applyProfile(cached)
    this.loadProfile()
  },

  onReady() {
    this.getAvatarCanvas().catch(() => {})
  },

  getAvatarCanvas() {
    if (!this.avatarCanvasPromise) {
      this.avatarCanvasPromise = new Promise((resolve, reject) => {
        wx.createSelectorQuery()
          .in(this)
          .select('#avatarProcessingCanvas')
          .fields({ node: true })
          .exec((result) => {
            const canvas = result?.[0]?.node
            if (!canvas) {
              reject(new Error('头像处理服务不可用'))
              return
            }
            canvas.width = 256
            canvas.height = 256
            resolve(canvas)
          })
      })
    }
    return this.avatarCanvasPromise
  },

  applyProfile(data) {
    const profile = data.profile || {}
    this.setData({
      error: '',
      form: {
        avatarText: profile.avatarText || (profile.nickname || '你').slice(0, 1),
        avatarUrl: profile.avatarUrl || '',
        nickname: profile.nickname || '轻读用户',
        phone: profile.phone || '',
      },
    })
  },

  async loadProfile() {
    try {
      this.applyProfile(await getProfileData())
      const autoFetchedKey = getAccountScopedStorageKey('profileAutoFetched')
      if (!wx.getStorageSync(autoFetchedKey)) {
        wx.setStorageSync(autoFetchedKey, '1')
        wx.showToast({ title: '可选择头像昵称或手动填写', icon: 'none' })
      }
    } catch (error) {
      const message = error.message || '个人资料加载失败，请稍后再试'
      this.setData({ error: message })
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  async handleChooseAvatar(event) {
    const avatarUrl = String(event.detail?.avatarUrl || '').trim()
    if (!avatarUrl || this.data.uploadingAvatar) return
    const previousAvatar = {
      avatarText: this.data.form.avatarText,
      avatarUrl: this.data.form.avatarUrl,
    }
    const nickname = this.data.form.nickname || '轻读用户'
    this.setData({
      error: '',
      uploadingAvatar: true,
      'form.avatarText': nickname.slice(0, 1) || '你',
      'form.avatarUrl': avatarUrl,
    })
    try {
      this.applyProfile(await uploadAvatar(avatarUrl, await this.getAvatarCanvas()))
      wx.showToast({ title: '头像已保存', icon: 'none' })
    } catch (error) {
      const errorCode = String(error.message || '').match(/错误编号：([A-Za-z0-9_-]+)/)?.[1] || ''
      const avatarError = errorCode ? `头像处理失败（错误编号：${errorCode}）` : '头像处理失败，请稍后重试'
      this.setData({
        error: avatarError,
        'form.avatarText': previousAvatar.avatarText,
        'form.avatarUrl': previousAvatar.avatarUrl,
      })
      wx.showToast({ title: '头像处理失败', icon: 'none' })
    } finally {
      this.setData({ uploadingAvatar: false })
    }
  },

  onUnload() {
    this.avatarCanvasPromise = null
  },

  handleNicknameInput(event) {
    const nickname = event.detail.value
    this.setData({
      'form.nickname': nickname,
      'form.avatarText': (nickname || '你').slice(0, 1),
    })
  },

  async handleGetPhoneNumber(event) {
    if (this.data.phoneAuthorizing) return
    const phoneCode = String(event.detail?.code || '').trim()
    if (!phoneCode) {
      wx.showToast({ title: '手机号快捷登录未完成', icon: 'none' })
      return
    }
    const hadPhone = Boolean(this.data.form.phone)
    this.setData({ phoneAuthorizing: true })
    try {
      const data = await syncLogin({ ...this.data.form, phoneCode })
      const profile = data.profile || this.data.form
      this.setData({
        'form.phone': profile.phone || this.data.form.phone,
        'form.nickname': profile.nickname || this.data.form.nickname,
        'form.avatarText': profile.avatarText || this.data.form.avatarText,
        'form.avatarUrl': profile.avatarUrl || this.data.form.avatarUrl,
      })
      wx.showToast({ title: profile.phone ? (hadPhone ? '手机号已更新' : '手机号已自动保存') : '手机号尚未同步', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '手机号获取失败', icon: 'none' })
    } finally {
      this.setData({ phoneAuthorizing: false })
    }
  },

  handleSave(event) {
    const nickname = String(event.detail?.value?.nickname || this.data.form.nickname || '').trim()
    this.setData({
      'form.nickname': nickname,
      'form.avatarText': (nickname || '你').slice(0, 1),
    }, () => this.saveProfile('个人资料已保存'))
  },

  async saveProfile(message = '个人资料已保存') {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      await updateProfile(this.data.form)
      wx.showToast({ title: typeof message === 'string' ? message : '个人资料已保存', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
