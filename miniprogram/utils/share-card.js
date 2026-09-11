const DESIGN_WIDTH = 750
const DESIGN_HEIGHT = 600
const SHARE_WIDTH = 500
const SHARE_HEIGHT = 400
const RENDER_SCALE = Math.min(SHARE_WIDTH / DESIGN_WIDTH, SHARE_HEIGHT / DESIGN_HEIGHT)
const MAX_SAVED_CARDS = 12
const SAVED_CARD_KEY = 'share-card-saved-files-v4'
const PRIVATE_COVER_RENDER_VERSION = 17
const { getImageCandidates } = require('./image-display')
const PUBLIC_SHARE_TITLE_MAX_LENGTH = 50
const COVER_COPY_MIN_LENGTH = 4
const COVER_COPY_MAX_LENGTH = 20
const COVER_COPY_CHARS_PER_LINE = 10
const COVER_COPY_FONT_SIZE = 60
const COVER_COPY_LINE_GAP_RATIO = 0.25
const COVER_DATE_FONT_SIZE = 60
const COVER_DIVIDER_GAP = 60
const COVER_DIVIDER_LENGTH = 60

const { DEFAULT_COPY_PACK } = require('./default-copy')

const fallbackBackgrounds = DEFAULT_COPY_PACK.shareBackgrounds

const fallbackPrivatePools = DEFAULT_COPY_PACK.sharePools

const privateCoverLayouts = [
  {
    id: 'centered',
    index: 0,
  },
  {
    id: 'left-title',
    index: 1,
  },
]

const defaultPrivateCoverStyle = {
  globalWashOpacity: 0.2,
  readingZoneOpacity: 0.1,
  copyFontSize: COVER_COPY_FONT_SIZE,
  dateFontSize: COVER_DATE_FONT_SIZE,
  dividerGap: COVER_DIVIDER_GAP,
  dividerLength: COVER_DIVIDER_LENGTH,
  text: {
    copyColor: '#FFFFFF',
    dateColor: '#F0D9A8',
    dividerColor: '#F0D9A8',
    readingZoneColor: '#1C1813',
  },
  layouts: {
    centered: { enabled: true, offsetY: 0 },
    leftTitle: { enabled: true, offsetY: 0 },
  },
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeStyleNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? clamp(number, min, max) : fallback
}

function normalizeStyleColor(value, fallback) {
  const color = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback
}

function colorToRgb(color) {
  const hex = color.slice(1)
  return `${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}`
}

function getPrivateCoverStyle(settings = {}) {
  const source = settings.private?.coverStyle || {}
  const text = source.text || {}
  const layouts = source.layouts || {}
  const copyFontSize = normalizeStyleNumber(source.copyFontSize, defaultPrivateCoverStyle.copyFontSize, 20, 100)
  const style = {
    globalWashOpacity: normalizeStyleNumber(source.globalWashOpacity, defaultPrivateCoverStyle.globalWashOpacity, 0, 0.4),
    readingZoneOpacity: normalizeStyleNumber(source.readingZoneOpacity, defaultPrivateCoverStyle.readingZoneOpacity, 0, 0.65),
    copyFontSize,
    dateFontSize: normalizeStyleNumber(source.dateFontSize, defaultPrivateCoverStyle.dateFontSize, 20, 100),
    dividerGap: normalizeStyleNumber(source.dividerGap, defaultPrivateCoverStyle.dividerGap, 20, 100),
    dividerLength: normalizeStyleNumber(source.dividerLength, defaultPrivateCoverStyle.dividerLength, 20, 100),
    text: {
      copyColor: normalizeStyleColor(text.copyColor, defaultPrivateCoverStyle.text.copyColor),
      dateColor: normalizeStyleColor(text.dateColor, defaultPrivateCoverStyle.text.dateColor),
      dividerColor: normalizeStyleColor(text.dividerColor, defaultPrivateCoverStyle.text.dividerColor),
      readingZoneColor: normalizeStyleColor(text.readingZoneColor, defaultPrivateCoverStyle.text.readingZoneColor),
    },
    layouts: {
      centered: {
        enabled: layouts.centered?.enabled !== false,
        offsetY: normalizeStyleNumber(layouts.centered?.offsetY, 0, -72, 72),
      },
      leftTitle: {
        enabled: layouts.leftTitle?.enabled !== false,
        offsetY: normalizeStyleNumber(layouts.leftTitle?.offsetY, 0, -72, 72),
      },
    },
  }
  if (!style.layouts.centered.enabled && !style.layouts.leftTitle.enabled) style.layouts.centered.enabled = true
  return style
}

function getCoverCopyLength(value) {
  return Array.from(compactText(value)).length
}

function isValidCoverCopy(value) {
  const length = getCoverCopyLength(value)
  return length >= COVER_COPY_MIN_LENGTH && length <= COVER_COPY_MAX_LENGTH
}

function getCoverCopyLines(value) {
  const characters = Array.from(compactText(value)).slice(0, COVER_COPY_MAX_LENGTH)
  return Array.from({ length: Math.ceil(characters.length / COVER_COPY_CHARS_PER_LINE) }, (_, index) => (
    characters.slice(index * COVER_COPY_CHARS_PER_LINE, (index + 1) * COVER_COPY_CHARS_PER_LINE).join('')
  ))
}

function getCoverCopyLineHeight(fontSize, dividerGap) {
  return fontSize + Math.round(dividerGap * COVER_COPY_LINE_GAP_RATIO)
}

function getChineseDate() {
  const now = new Date()
  return `${now.getMonth() + 1}月${now.getDate()}日`
}

function getPublicShareTitle(item = {}, fallback = DEFAULT_COPY_PACK.publicShareTitleFallback[0]) {
  const articleTitle = compactText(item.title)
  if (articleTitle) return Array.from(articleTitle).slice(0, PUBLIC_SHARE_TITLE_MAX_LENGTH).join('')
  const content = String(item.content || item.text || '').replace(/\r\n?/g, '\n').trim()
  if (!content) return fallback
  const firstSentence = content.match(/^\s*(.+?[。！？!?])/)
  if (firstSentence?.[1]) return Array.from(compactText(firstSentence[1])).slice(0, PUBLIC_SHARE_TITLE_MAX_LENGTH).join('')
  const paragraphs = content.split(/\n\s*\n|\n/).map(compactText).filter(Boolean)
  if (paragraphs.length > 1) return Array.from(paragraphs[0]).slice(0, PUBLIC_SHARE_TITLE_MAX_LENGTH).join('')
  return Array.from(compactText(content)).slice(0, PUBLIC_SHARE_TITLE_MAX_LENGTH).join('') || fallback
}

function pickPublicCoverCopy(settings = {}, item = {}) {
  if (settings.private?.coverCopyEnabled === false) return null
  const configured = settings.private?.pools?.text?.coverCopies
  const fallback = fallbackPrivatePools.text.coverCopies
  const candidates = (Array.isArray(configured) ? configured : [])
    .filter((entry) => entry?.enabled !== false && isValidCoverCopy(entry.text))
  const pool = candidates.length
    ? candidates
    : fallback.map((text, index) => ({ id: `fallback-public-copy-${index + 1}`, text }))
  if (!pool.length) return null
  const key = String(item.id || item.title || item.content || '')
  let hash = 0
  for (const character of key) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
  return pool[hash % pool.length]
}

function getShareImageSource(item = {}, source = 'content') {
  // The current letters payload is text-only. Keep it on the generic
  // background path even if an older record still carries image metadata.
  const image = source === 'article'
    ? item.coverImage
    : source === 'letters'
      ? null
      : item.images?.[0]
  return getImageCandidates(image)[0] || ''
}

function normalizePrivateType(type) {
  if (type === 'text') return 'text'
  if (type === 'album' || type === 'image') return 'image'
  return 'audio'
}

function getRecentItems(scope, limit) {
  try {
    const items = wx.getStorageSync(`share-card-recent-${scope}`)
    return Array.isArray(items) ? items.slice(-limit) : []
  } catch (error) {
    return []
  }
}

function saveRecentItem(scope, id, limit) {
  try {
    const recent = [...getRecentItems(scope, limit), id].slice(-limit)
    wx.setStorageSync(`share-card-recent-${scope}`, recent)
  } catch (error) {
    // Sharing remains available when storage cannot be written.
  }
}

function pickRecentSafe(scope, items, limit, remember = true) {
  const candidates = items.filter((item) => item && String(item.id || '').trim())
  if (!candidates.length) return null
  const recent = getRecentItems(scope, limit)
  const available = candidates.filter((item) => !recent.includes(item.id))
  const withoutPrevious = candidates.filter((item) => item.id !== recent[recent.length - 1])
  const pool = available.length ? available : (withoutPrevious.length ? withoutPrevious : candidates)
  const selected = pool[Math.floor(Math.random() * pool.length)] || pool[0]
  if (remember) saveRecentItem(scope, selected.id, limit)
  return selected
}

function getPrivatePool(settings = {}, type) {
  const configured = settings.private?.pools?.[type] || {}
  const fallback = fallbackPrivatePools[type]
  const titles = Array.isArray(configured.titles)
    ? configured.titles.filter((item) => item.enabled !== false && compactText(item.title))
    : []
  const coverCopies = Array.isArray(configured.coverCopies)
    ? configured.coverCopies.filter((item) => item.enabled !== false && isValidCoverCopy(item.text))
    : []
  return {
    titles: titles.length ? titles : fallback.titles.map((title, index) => ({ id: `fallback-${type}-title-${index + 1}`, title })),
    coverCopies: coverCopies.length ? coverCopies : fallback.coverCopies.map((text, index) => ({ id: `fallback-${type}-copy-${index + 1}`, text })),
  }
}

function getBackgrounds(settings = {}) {
  const configured = Array.isArray(settings.private?.backgrounds)
    ? settings.private.backgrounds.filter((item) => item.enabled !== false && String(item.imageUrl || '').trim())
    : []
  return configured.length ? configured : fallbackBackgrounds
}

function pickStableBackground(settings = {}, stableKey = '') {
  const backgrounds = getBackgrounds(settings)
  if (!backgrounds.length) return null
  const key = String(stableKey || '').trim()
  if (!key) return backgrounds[0]
  let hash = 0
  for (const character of key) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
  return backgrounds[hash % backgrounds.length]
}

function pickTemplate(type, settings, { scope = `private-${type}-template`, preview = false } = {}) {
  const style = getPrivateCoverStyle(settings)
  const layouts = privateCoverLayouts.filter((layout) => style.layouts[layout.id === 'left-title' ? 'leftTitle' : layout.id].enabled)
  return pickRecentSafe(scope, layouts, 2, !preview) || layouts[0] || privateCoverLayouts[0]
}

function getSavedCards() {
  try {
    const value = wx.getStorageSync(SAVED_CARD_KEY)
    return Array.isArray(value) ? value : []
  } catch (error) {
    return []
  }
}

function saveSavedCards(cards) {
  try {
    wx.setStorageSync(SAVED_CARD_KEY, cards)
  } catch (error) {
    // A temporary file can still be used in the current session.
  }
}

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject })
  })
}

function saveFile(tempFilePath) {
  const fileSystemManager = wx.getFileSystemManager()
  return new Promise((resolve) => {
    fileSystemManager.saveFile({
      tempFilePath,
      success: (result) => resolve(result.savedFilePath || tempFilePath),
      fail: () => resolve(tempFilePath),
    })
  })
}

function removeFile(filePath) {
  const fileSystemManager = wx.getFileSystemManager()
  fileSystemManager.unlink({ filePath, fail: () => {} })
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src, success: resolve, fail: reject })
  })
}

function isRemoteImageSource(src) {
  return /^https?:\/\//i.test(String(src || '').trim())
}

function downloadImage(src) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: src,
      success: (result) => {
        const statusCode = Number(result?.statusCode)
        const tempFilePath = String(result?.tempFilePath || '').trim()
        if ((statusCode && (statusCode < 200 || statusCode >= 300)) || !tempFilePath) {
          reject(new Error('图片下载失败'))
          return
        }
        resolve(tempFilePath)
      },
      fail: reject,
    })
  })
}

function exportCanvas(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: SHARE_WIDTH,
      height: SHARE_HEIGHT,
      destWidth: SHARE_WIDTH,
      destHeight: SHARE_HEIGHT,
      fileType: 'jpg',
      quality: 0.8,
      success: (result) => resolve(result.tempFilePath),
      fail: reject,
    })
  })
}

function drawPrivateBackgroundWash(context, style) {
  context.fillStyle = `rgba(28, 24, 19, ${style.globalWashOpacity})`
  context.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT)
}

function drawReadingZone(context, templateIndex, style, offsetY) {
  const surface = colorToRgb(style.text.readingZoneColor)
  const opacity = style.readingZoneOpacity
  context.shadowColor = 'transparent'
  if (templateIndex === 0) {
    const centerStop = clamp(0.5 + (offsetY / DESIGN_HEIGHT), 0.1, 0.9)
    const gradient = context.createLinearGradient(0, 0, 0, DESIGN_HEIGHT)
    gradient.addColorStop(0, `rgba(${surface}, 0)`)
    gradient.addColorStop(centerStop, `rgba(${surface}, ${opacity})`)
    gradient.addColorStop(1, `rgba(${surface}, 0)`)
    context.fillStyle = gradient
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
    return
  }
  if (templateIndex === 1) {
    const gradient = context.createLinearGradient(0, 0, DESIGN_WIDTH, 0)
    gradient.addColorStop(0, `rgba(${surface}, ${opacity})`)
    gradient.addColorStop(1, `rgba(${surface}, 0)`)
    context.fillStyle = gradient
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
    return
  }
}

class ShareCardComposer {
  constructor(page, canvasSelector = '#shareCanvas') {
    this.page = page
    this.canvasSelector = canvasSelector
    this.canvas = null
    this.context = null
    this.initializePromise = null
    this.memoryCache = new Map()
    this.imageInfoCache = new Map()
    this.downloadCache = new Map()
    this.downloadPromiseCache = new Map()
    this.renderQueue = Promise.resolve()
  }

  async initialize() {
    if (this.canvas && this.context) return true
    if (!this.initializePromise) {
      this.initializePromise = new Promise((resolve) => {
        wx.createSelectorQuery()
          .in(this.page)
          .select(this.canvasSelector)
          .fields({ node: true })
          .exec((result) => {
            const canvas = result?.[0]?.node
            if (!canvas) {
              resolve(false)
              return
            }
            canvas.width = SHARE_WIDTH
            canvas.height = SHARE_HEIGHT
            this.canvas = canvas
            this.context = canvas.getContext('2d')
            resolve(Boolean(this.context))
          })
      }).then((ready) => {
        // A page can call warm-up before its canvas node exists. Do not cache
        // that transient failure or all later shares will stay on the fallback.
        if (!ready) this.initializePromise = null
        return ready
      })
    }
    return this.initializePromise
  }

  async getCachedPath(key) {
    // Other page composers can evict the same saved file. Memory entries must
    // pass the same existence check as paths restored from persistent storage.
    const saved = this.memoryCache.get(key) || getSavedCards().find((item) => item.key === key)?.path
    if (!saved) return ''
    try {
      const info = await getFileInfo(saved)
      if (!Number(info.size)) throw new Error('分享图片文件为空')
      this.memoryCache.set(key, saved)
      return saved
    } catch (error) {
      this.memoryCache.delete(key)
      saveSavedCards(getSavedCards().filter((item) => item.path !== saved))
      return ''
    }
  }

  async rememberPath(key, tempFilePath) {
    const path = await saveFile(tempFilePath)
    this.memoryCache.set(key, path)
    const previous = getSavedCards().filter((item) => item.key !== key && item.path !== path)
    const next = [...previous, { key, path, updatedAt: Date.now() }]
    const expired = next.slice(0, Math.max(0, next.length - MAX_SAVED_CARDS))
    saveSavedCards(next.slice(-MAX_SAVED_CARDS))
    expired.forEach((item) => removeFile(item.path))
    return path
  }

  async downloadRemoteImage(src) {
    const cached = this.downloadCache.get(src)
    if (cached) {
      try {
        await getFileInfo(cached)
        return cached
      } catch (error) {
        this.downloadCache.delete(src)
        this.imageInfoCache.delete(src)
      }
    }
    let pending = this.downloadPromiseCache.get(src)
    if (!pending) {
      pending = downloadImage(src).then((tempFilePath) => {
        this.downloadCache.set(src, tempFilePath)
        this.downloadPromiseCache.delete(src)
        return tempFilePath
      }, (error) => {
        this.downloadPromiseCache.delete(src)
        throw error
      })
      this.downloadPromiseCache.set(src, pending)
    }
    return pending
  }

  loadCanvasImage(source, info = {}) {
    return new Promise((resolve, reject) => {
      const image = this.canvas.createImage()
      image.onload = () => resolve({
        image,
        width: Number(image.width) || Number(info.width) || 0,
        height: Number(image.height) || Number(info.height) || 0,
      })
      image.onerror = () => reject(new Error('图片加载失败'))
      image.src = resolveCanvasImagePath(source, info)
    })
  }

  async loadImage(source) {
    const src = String(source || '').trim()
    if (!src) throw new Error('图片地址为空')
    let info = this.imageInfoCache.get(src)
    let imageSource = src
    let downloaded = false
    if (!info) {
      try {
        info = await getImageInfo(src)
        this.imageInfoCache.set(src, info)
      } catch (error) {
        if (!isRemoteImageSource(src)) throw error
        imageSource = await this.downloadRemoteImage(src)
        info = { path: imageSource }
        this.imageInfoCache.set(src, info)
        downloaded = true
      }
    } else if (info.path && !src.startsWith('/assets/')) {
      imageSource = info.path
    }
    try {
      return await this.loadCanvasImage(imageSource, info)
    } catch (error) {
      // Some COS formats pass getImageInfo but still fail in canvas. Download once
      // and retry with the local temporary path; callers still receive the error
      // when both paths fail, allowing the normal share fallback.
      if (!downloaded && isRemoteImageSource(src)) {
        const tempFilePath = await this.downloadRemoteImage(src)
        const downloadedInfo = { path: tempFilePath }
        this.imageInfoCache.set(src, downloadedInfo)
        return this.loadCanvasImage(tempFilePath, downloadedInfo)
      }
      throw error
    }
  }

  drawCoverImage(source) {
    const context = this.context
    return this.loadImage(source).then(({ image, width, height }) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效')
      const sourceRatio = width / height
      const targetRatio = SHARE_WIDTH / SHARE_HEIGHT
      let sx = 0
      let sy = 0
      let sw = width
      let sh = height
      if (sourceRatio > targetRatio) {
        sw = height * targetRatio
        sx = (width - sw) / 2
      } else if (sourceRatio < targetRatio) {
        sh = width / targetRatio
        sy = (height - sh) / 2
      }
      context.drawImage(image, sx, sy, sw, sh, 0, 0, SHARE_WIDTH, SHARE_HEIGHT)
    })
  }

  drawPrivateCopy({ date, text, templateIndex, style: configuredStyle }) {
    const context = this.context
    const layout = privateCoverLayouts[templateIndex] || privateCoverLayouts[0]
    const style = getPrivateCoverStyle({ private: { coverStyle: configuredStyle } })
    const layoutStyle = layout.id === 'left-title' ? style.layouts.leftTitle : style.layouts.centered
    const lines = getCoverCopyLines(text)
    const dividerHeight = 6
    const getMetrics = (value, fontSize) => {
      context.font = `700 ${fontSize}px sans-serif`
      const metrics = context.measureText(value)
      return {
        ascent: Number(metrics.actualBoundingBoxAscent) || Math.round(fontSize * 0.86),
        descent: Number(metrics.actualBoundingBoxDescent) || Math.round(fontSize * 0.14),
      }
    }
    const dateMetrics = getMetrics(date, style.dateFontSize)
    const copyMetrics = getMetrics(lines[0] || text, style.copyFontSize)
    const dateHeight = dateMetrics.ascent + dateMetrics.descent
    const dividerGap = style.dividerGap
    const copyLineHeight = getCoverCopyLineHeight(style.copyFontSize, dividerGap)
    const copyHeight = copyMetrics.ascent + copyMetrics.descent + ((lines.length - 1) * copyLineHeight)
    const contentHeight = dateHeight + dividerGap + copyHeight
    const contentTop = ((DESIGN_HEIGHT - contentHeight) / 2) + layoutStyle.offsetY
    const dateY = contentTop + dateMetrics.ascent
    const dividerY = contentTop + dateHeight + ((dividerGap - dividerHeight) / 2)
    const phraseY = contentTop + dateHeight + dividerGap + copyMetrics.ascent
    const drawDate = (x, y, align = 'left') => {
      context.font = `700 ${style.dateFontSize}px sans-serif`
      context.textAlign = align
      context.textBaseline = 'alphabetic'
      context.fillText(date, x, y)
    }
    const drawPhrase = (x, y, align = 'left') => {
      context.font = `700 ${style.copyFontSize}px sans-serif`
      context.textAlign = align
      context.textBaseline = 'alphabetic'
      lines.forEach((line, index) => context.fillText(line, x, y + (index * copyLineHeight)))
    }

    context.save()
    context.scale(RENDER_SCALE, RENDER_SCALE)
    drawReadingZone(context, layout.index, style, layoutStyle.offsetY)
    context.shadowColor = 'rgba(23, 19, 15, 0.4)'
    context.shadowBlur = 2
    context.shadowOffsetY = 1
    if (layout.index === 0) {
      context.fillStyle = style.text.dateColor
      drawDate(375, dateY, 'center')
      context.shadowColor = 'transparent'
      context.fillStyle = style.text.dividerColor
      context.fillRect(375 - (style.dividerLength / 2), dividerY, style.dividerLength, dividerHeight)
      context.shadowColor = 'rgba(23, 19, 15, 0.4)'
      context.fillStyle = style.text.copyColor
      drawPhrase(375, phraseY, 'center')
    } else {
      context.fillStyle = style.text.dateColor
      drawDate(56, dateY)
      context.shadowColor = 'transparent'
      context.fillStyle = style.text.dividerColor
      context.fillRect(56, dividerY, style.dividerLength, dividerHeight)
      context.shadowColor = 'rgba(23, 19, 15, 0.4)'
      context.fillStyle = style.text.copyColor
      drawPhrase(56, phraseY)
    }
    context.restore()
  }

  renderCover(options = {}) {
    const task = this.renderQueue.then(() => this.renderCoverNow(options))
    this.renderQueue = task.catch(() => {})
    return task
  }

  async renderCoverNow({ cacheKey, imageUrl, imageFallbacks = [], privateCopy }) {
    const cached = await this.getCachedPath(cacheKey)
    if (cached) return cached
    if (!await this.initialize()) throw new Error('分享画布尚未准备好')
    const context = this.context
    context.clearRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT)
    context.fillStyle = '#efe3d2'
    context.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT)
    let drawnSource = ''
    let imageError
    for (const candidate of [...new Set([imageUrl, ...imageFallbacks].filter(Boolean))]) {
      try {
        await this.drawCoverImage(candidate)
        drawnSource = candidate
        break
      } catch (error) {
        imageError = error
      }
    }
    if (!drawnSource && (!privateCopy || privateCopy.publicImageRequired)) throw imageError || new Error('图片加载失败')
    if (privateCopy) {
      drawPrivateBackgroundWash(context, getPrivateCoverStyle({ private: { coverStyle: privateCopy.style } }))
      this.drawPrivateCopy(privateCopy)
    }
    const tempFilePath = await exportCanvas(this.canvas)
    // A transient fallback must not hide recovery of the preferred image.
    if (drawnSource !== imageUrl) return tempFilePath
    return this.rememberPath(cacheKey, tempFilePath)
  }
}

function makePrivateCardKey(settings, type, title, coverCopy, background, template, date, imageSource = '') {
  return [
    'private',
    PRIVATE_COVER_RENDER_VERSION,
    Number(settings.version) || 1,
    type,
    title.id,
    coverCopy?.id || 'plain-cover',
    background.id,
    imageSource || 'no-content-image',
    template.id,
    date,
  ].join(':')
}

async function createPrivateShareCard(composer, options = {}) {
  const type = normalizePrivateType(options.type)
  const settings = options.settings || {}
  const pool = getPrivatePool(settings, type)
  const coverCopyEnabled = settings.private?.coverCopyEnabled !== false
  const title = pickRecentSafe(`private-${type}-title`, pool.titles, 12) || pool.titles[0]
  const coverCopy = coverCopyEnabled ? (pickRecentSafe(`private-${type}-copy`, pool.coverCopies, 12) || pool.coverCopies[0]) : null
  const background = pickRecentSafe('private-background', getBackgrounds(settings), 8) || fallbackBackgrounds[0]
  const template = pickTemplate(type, settings)
  const coverStyle = getPrivateCoverStyle(settings)
  const date = getChineseDate()
  const contentImage = type === 'image' ? options.item?.images?.[0] : null
  const contentImageCandidates = getImageCandidates(contentImage, 'medium')
  const contentImageUrl = contentImageCandidates[0] || ''
  const fallbackImageUrl = contentImageUrl || background?.imageUrl || fallbackBackgrounds[0].imageUrl
  const card = {
    title: compactText(title?.title),
    imageUrl: fallbackImageUrl,
  }
  if (!composer || !title || !background || (coverCopyEnabled && !coverCopy)) return card
  try {
    card.imageUrl = await composer.renderCover({
      cacheKey: makePrivateCardKey(settings, type, title, coverCopy, background, template, date, contentImageUrl),
      imageUrl: contentImageUrl || background.imageUrl,
      imageFallbacks: [
        ...contentImageCandidates.slice(1),
        background?.imageUrl,
        ...fallbackBackgrounds.map((item) => item.imageUrl),
      ].filter(Boolean),
      privateCopy: coverCopy ? {
        date,
        text: compactText(coverCopy.text),
        templateIndex: template.index,
        style: coverStyle,
      } : null,
    })
  } catch (error) {
    // Keep the selected background when canvas preparation is unavailable.
  }
  return card
}

async function createPublicShareCard(composer, options = {}) {
  const source = String(options.source || 'content').trim()
  const item = options.item || {}
  const settings = options.settings || {}
  const sourceImage = getShareImageSource(item, source)
  const stableBackgroundKey = source === 'article' ? (item.id || '') : `${source}:${item.id || ''}`
  const background = sourceImage ? null : pickStableBackground(settings, stableBackgroundKey)
  const recoveryBackground = background || pickStableBackground(settings, stableBackgroundKey)
  const imageUrl = sourceImage || background?.imageUrl || fallbackBackgrounds[0].imageUrl
  const coverCopy = pickPublicCoverCopy(settings, item)
  // Warm-up prepares the next style without consuming it. Only an actual
  // public share advances this source's history, independently of home cards.
  const template = pickTemplate('text', settings, { scope: `public-${source}-template`, preview: options.preview === true })
  const coverStyle = getPrivateCoverStyle(settings)
  const date = getChineseDate()
  const cacheKey = [
    'public',
    PRIVATE_COVER_RENDER_VERSION,
    Number(settings.version) || 1,
    source,
    item.id || '',
    background?.id || sourceImage,
    coverCopy?.id || 'plain-cover',
    template.id,
    date,
  ].join(':')
  const card = {
    title: getPublicShareTitle(item),
    imageUrl,
  }
  if (!composer || !imageUrl) return card
  try {
    const publicImage = source === 'article'
      ? item.coverImage
      : source === 'letters'
        ? null
        : item.images?.[0]
    card.imageUrl = await composer.renderCover({
      cacheKey,
      imageUrl,
      imageFallbacks: getImageCandidates(publicImage, 'medium', [
        recoveryBackground?.imageUrl, ...fallbackBackgrounds.map((item) => item.imageUrl),
      ]),
      privateCopy: coverCopy ? {
        date,
        text: compactText(coverCopy.text),
        templateIndex: template.index,
        style: coverStyle,
        publicImageRequired: true,
      } : null,
    })
  } catch (error) {
    // A direct COS or packaged image is still preferable to delaying the share action.
  }
  return card
}

function createShareCardComposer(page, canvasSelector) {
  return new ShareCardComposer(page, canvasSelector)
}

function resolveCanvasImagePath(source, info = {}) {
  const src = String(source || '').trim()
  return src.startsWith('/assets/') ? src : String(info.path || src)
}

module.exports = {
  createPrivateShareCard,
  createPublicShareCard,
  createShareCardComposer,
  getCoverCopyLineHeight,
  getCoverCopyLines,
  getPublicShareTitle,
  resolveCanvasImagePath,
}
