const assert = require('node:assert/strict')
const test = require('node:test')
const { openImagePreview, preloadPreviewImages, resolvePreviewImageUrls } = require('../utils/image-preview')

test('each opening retries medium even after the card fell back to thumb', async () => {
  const image = { mediumUrl: '/medium', thumbUrl: '/thumb', originalUrl: '/original', displayUrl: '/thumb' }
  const calls = []
  let recovered = false
  const api = { getImageInfo({ src, success, fail }) {
    calls.push(src)
    if (src === '/medium' && !recovered) fail({})
    else success({ path: src })
  } }
  assert.deepEqual(await resolvePreviewImageUrls([image], 0, { wx: api }), { urls: ['/thumb'], current: '/thumb' })
  recovered = true
  assert.deepEqual(await resolvePreviewImageUrls([image], 0, { wx: api }), { urls: ['/medium'], current: '/medium' })
  assert.deepEqual(calls, ['/medium', '/thumb', '/medium'])
  assert.equal(image.displayUrl, '/thumb')
})

test('fallback to original only after medium and thumb fail; does not wait for unclicked images', async () => {
  const calls = []
  const api = { getImageInfo({ src, success, fail }) {
    calls.push(src)
    if (src === '/original' || src === '/last') success({ path: src })
    else fail({})
  } }
  const images = [
    { mediumUrl: '/broken', thumbUrl: '/broken' },
    { mediumUrl: '/medium', thumbUrl: '/thumb', originalUrl: '/original' },
    { mediumUrl: '/last' },
  ]
  const result = await resolvePreviewImageUrls(images, 1, { wx: api })
  assert.deepEqual(result, { urls: ['/original'], current: '/original' })
  assert.equal(calls.filter((src) => src === '/broken').length, 0)
  assert.ok(calls.indexOf('/medium') < calls.indexOf('/thumb'))
  assert.ok(calls.indexOf('/thumb') < calls.indexOf('/original'))
})

test('timed-out medium download is aborted and cached thumb remains usable', async () => {
  let aborted = 0
  const downloads = []
  const api = {
    downloadFile({ url }) { downloads.push(url); return { abort() { aborted += 1 } } },
    getImageInfo({ src, success }) { success({ path: `/cached/${src.split('/').pop()}` }) },
  }
  const result = await resolvePreviewImageUrls([{
    mediumUrl: 'https://example.test/medium', thumbUrl: 'https://example.test/thumb', originalUrl: 'https://example.test/original',
  }], 0, { wx: api, timeoutMs: 10, totalTimeoutMs: 100 })
  assert.deepEqual(downloads, ['https://example.test/medium'])
  assert.equal(aborted, 1)
  assert.deepEqual(result, { urls: ['/cached/thumb'], current: '/cached/thumb' })
})

test('gallery confirms the selected image before opening and does not wait for the group', async () => {
  let active = 0
  let maximum = 0
  const api = {
    downloadFile({ url, success }) {
      maximum = Math.max(maximum, ++active)
      setTimeout(() => { active -= 1; success({ statusCode: 200, tempFilePath: `/tmp/${url.split('/').pop()}` }) }, 5)
      return { abort() {} }
    },
    getImageInfo({ src, success }) { success({ path: src }) },
  }
  const images = Array.from({ length: 9 }, (_item, index) => ({ mediumUrl: `https://example.test/${index}` }))
  const result = await resolvePreviewImageUrls(images, 5, { wx: api, timeoutMs: 100, totalTimeoutMs: 500 })
  assert.equal(maximum, 1)
  assert.deepEqual(result.urls, ['/tmp/5'])
  assert.equal(result.current, '/tmp/5')
})

test('nearby prefetch tries medium and thumb without downloading the original', async () => {
  const calls = []
  const api = { getImageInfo({ src, success, fail }) {
    calls.push(src)
    if (src.includes('medium')) fail({})
    else success({ path: src })
  } }
  const images = [
    { mediumUrl: '/left-medium', thumbUrl: '/left-thumb', originalUrl: '/left-original' },
    { mediumUrl: '/selected-medium', thumbUrl: '/selected-thumb', originalUrl: '/selected-original' },
    { mediumUrl: '/right-medium', thumbUrl: '/right-thumb', originalUrl: '/right-original' },
  ]
  const results = await preloadPreviewImages(images, 1, { wx: api })
  assert.deepEqual(results.map((item) => item.preview.current), ['/left-thumb', '/right-thumb'])
  assert.equal(calls.some((src) => src.includes('original')), false)
})

test('native preview opens the clicked image before neighbor loading and preserves gallery order', async (t) => {
  const previousWx = global.wx
  const previousGetCurrentPages = global.getCurrentPages
  t.after(() => { global.wx = previousWx; global.getCurrentPages = previousGetCurrentPages })
  const page = {}
  const calls = []
  const pending = []
  let nativePreview
  global.getCurrentPages = () => [page]
  global.wx = {
    showLoading() {}, hideLoading() {},
    getImageInfo({ src, success }) {
      calls.push(src)
      if (src === '/medium-1') success({ path: '/cached/medium-1' })
      else pending.push(() => success({ path: src }))
    },
    previewImage(options) {
      assert.deepEqual(calls, ['/medium-1'])
      nativePreview = options
      options.success()
      options.complete()
    },
  }
  const images = Array.from({ length: 4 }, (_, index) => ({ mediumUrl: `/medium-${index}` }))
  await openImagePreview(page, images, 1)
  assert.deepEqual(nativePreview.urls, ['/medium-0', '/cached/medium-1', '/medium-2', '/medium-3'])
  assert.equal(nativePreview.current, '/cached/medium-1')
  assert.equal(nativePreview.showmenu, true)
  assert.deepEqual(calls, ['/medium-1', '/medium-0', '/medium-2'])
  assert.equal(page.imagePreviewLoading, false)
  pending.forEach((finish) => finish())
  await new Promise((resolve) => setImmediate(resolve))
})

test('duplicate taps stay blocked until native preview finishes opening', async (t) => {
  const previousWx = global.wx
  const previousGetCurrentPages = global.getCurrentPages
  t.after(() => { global.wx = previousWx; global.getCurrentPages = previousGetCurrentPages })
  const page = {}
  let openCount = 0
  let finishOpening
  global.getCurrentPages = () => [page]
  global.wx = {
    showLoading() {}, hideLoading() {},
    getImageInfo({ src, success }) { success({ path: src }) },
    previewImage(options) { openCount += 1; finishOpening = options.complete },
  }
  const opening = openImagePreview(page, [{ mediumUrl: '/one' }], 0)
  await new Promise((resolve) => setImmediate(resolve))
  await openImagePreview(page, [{ mediumUrl: '/one' }], 0)
  assert.equal(openCount, 1)
  assert.equal(page.imagePreviewLoading, true)
  finishOpening()
  await opening
  assert.equal(page.imagePreviewLoading, false)
})
