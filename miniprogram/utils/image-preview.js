const { getImageCandidates } = require('./image-display')

const REQUEST_TIMEOUT_MS = 2000
const nearbyRequests = new Map()

function probeImage(source, api, timeoutMs, refresh) {
  return new Promise((resolve) => {
    let settled = false
    let downloadTask
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      finish('')
      downloadTask?.abort?.()
    }, timeoutMs)
    const inspect = (path) => api.getImageInfo({
      src: path,
      success: (info) => finish(source.startsWith('/assets/') ? source : info.path || path),
      fail: () => finish(''),
    })
    try {
      if (refresh && /^https?:\/\//i.test(source) && typeof api.downloadFile === 'function') {
        downloadTask = api.downloadFile({
          url: source,
          timeout: timeoutMs,
          success: (result) => {
            if (settled) return
            if (result.statusCode !== 200 || !result.tempFilePath) return finish('')
            try { inspect(result.tempFilePath) } catch (_error) { finish('') }
          },
          fail: () => finish(''),
        })
      } else {
        inspect(source)
      }
    } catch (_error) {
      finish('')
    }
  })
}

function getSelectedIndex(images, currentIndex) {
  return Math.max(0, Math.min(images.length - 1, Math.floor(Number(currentIndex) || 0)))
}

function getPreviewCandidates(image, prefetch) {
  if (!prefetch) return getImageCandidates(image, 'medium')
  if (!image || typeof image !== 'object') return []
  return [...new Set([image.mediumUrl, image.thumbUrl].map((url) => String(url || '').trim()).filter(Boolean))]
}

async function resolvePreviewImageUrls(images = [], currentIndex = 0, options = {}) {
  const api = options.wx || wx
  const sourceImages = Array.isArray(images) ? images : []
  if (!sourceImages.length) return { urls: [], current: '' }
  const selected = getSelectedIndex(sourceImages, currentIndex)
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS)
  let current = ''
  const image = sourceImages[selected]
  for (const candidate of getPreviewCandidates(image, options.prefetch === true)) {
    const refresh = !options.prefetch && candidate === (typeof image === 'string' ? image : String(image?.mediumUrl || '').trim())
    current = await probeImage(candidate, api, timeoutMs, refresh)
    if (current) break
  }
  if (!current) return { urls: [], current: '' }

  return { urls: [current], current }
}

function preloadPreviewImages(images = [], currentIndex = 0, options = {}) {
  const sourceImages = Array.isArray(images) ? images : []
  const selected = getSelectedIndex(sourceImages, currentIndex)
  const nearby = [selected - 1, selected + 1]
    .filter((index) => index >= 0 && index < sourceImages.length)
  return Promise.all(nearby.map(async (index) => ({
    index,
    preview: await prefetchImage(sourceImages[index], options),
  })))
}

function prefetchImage(image, options) {
  const key = getPreviewCandidates(image, true).join('\n')
  if (!key) return Promise.resolve({ urls: [], current: '' })
  if (nearbyRequests.has(key)) return nearbyRequests.get(key)
  if (nearbyRequests.size >= 2) return Promise.resolve({ urls: [], current: '' })
  const request = resolvePreviewImageUrls([image], 0, { ...options, prefetch: true })
    .finally(() => nearbyRequests.delete(key))
  nearbyRequests.set(key, request)
  return request
}

async function openImagePreview(page, images, currentIndex = 0) {
  if (page.imagePreviewLoading) return
  page.imagePreviewLoading = true
  wx.showLoading({ title: '加载图片中', mask: true })
  let failed = false
  try {
    const sourceImages = Array.isArray(images) ? images : []
    const selected = getSelectedIndex(sourceImages, currentIndex)
    const preview = await resolvePreviewImageUrls(sourceImages, selected)
    // Ignore a completed request if the user has left its originating page.
    if (typeof getCurrentPages === 'function' && getCurrentPages().slice(-1)[0] !== page) return
    if (!preview.urls.length) {
      failed = true
    } else {
      const urls = sourceImages.map((image, index) => index === selected
        ? preview.current
        : getImageCandidates(image, 'medium')[0] || '').filter(Boolean)
      page.pauseInterstitialUntilNextShow?.()
      wx.hideLoading()
      await new Promise((resolve) => wx.previewImage({
        urls,
        current: preview.current,
        showmenu: true,
        success: () => { preloadPreviewImages(sourceImages, selected).catch(() => {}) },
        fail: () => { failed = true },
        complete: resolve,
      }))
    }
  } catch (_error) {
    failed = true
  } finally {
    wx.hideLoading()
    page.imagePreviewLoading = false
  }
  if (failed) wx.showToast({ title: '图片暂时无法查看，请稍后重试', icon: 'none' })
}

module.exports = { preloadPreviewImages, resolvePreviewImageUrls, openImagePreview }
