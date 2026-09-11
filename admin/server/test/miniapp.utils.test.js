const assert = require('node:assert/strict')
const test = require('node:test')

const { createPrivateShareCard, createPublicShareCard, createShareCardComposer, getCoverCopyLineHeight, getCoverCopyLines, getPublicShareTitle, resolveCanvasImagePath } = require('../../../miniprogram/utils/share-card')
const { prepareArticleSummary, resolveFallbackCoverUrl } = require('../../../miniprogram/utils/article-feed')
const { getDayKey, pickDailyCopy } = require('../../../miniprogram/utils/daily-copy')
const { normalizeTabs } = require('../../../miniprogram/utils/tabs')

test('tab config allows hiding home but always keeps mine visible', () => {
  const tabs = normalizeTabs({
    home: { label: '不应生效', visible: false },
    articles: { visible: false },
    letters: { visible: false },
    mine: { label: '不应生效', visible: false },
  })

  assert.deepEqual(
    tabs.map((item) => ({ key: item.key, text: item.text, visible: item.visible })),
    [
      { key: 'home', text: '首页', visible: false },
      { key: 'articles', text: '文章', visible: false },
      { key: 'letters', text: '心笺', visible: false },
      { key: 'mine', text: '我的', visible: true },
    ],
  )
})

test('check-in copy remains stable during the day and changes on the next day', () => {
  const values = ['第一条', '第二条']
  const storage = new Map()
  const adapter = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
  }
  const originalRandom = Math.random
  Math.random = () => 0

  try {
    const firstDay = new Date(2026, 7, 24, 9, 0, 0)
    const secondDay = new Date(2026, 7, 25, 9, 0, 0)
    assert.equal(getDayKey(firstDay), '2026-08-24')
    assert.equal(pickDailyCopy({ values, fallback: '兜底', storageKey: 'checkin', date: firstDay, storage: adapter }), '第一条')
    assert.equal(pickDailyCopy({ values: [...values].reverse(), fallback: '兜底', storageKey: 'checkin', date: firstDay, storage: adapter }), '第一条')
    assert.equal(pickDailyCopy({ values, fallback: '兜底', storageKey: 'checkin', date: secondDay, storage: adapter }), '第二条')
  } finally {
    Math.random = originalRandom
  }
})

test('share card independently selects a title, cover copy, and background', async () => {
  const storage = new Map()
  const originalWx = global.wx
  const originalRandom = Math.random
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    getAccountInfoSync() { return { miniProgram: { envVersion: 'develop' } } },
  }
  const randomValues = [0, 0.75, 0, 0]
  Math.random = () => randomValues.shift()

  try {
    const rendered = []
    const card = await createPrivateShareCard({
      renderCover(options) {
        rendered.push(options)
        return Promise.resolve('/composed-cover.jpg')
      },
    }, {
      type: 'text',
      settings: {
        version: 3,
        private: {
          pools: {
            text: {
              titles: [{ id: 'title-1', title: '标题一' }, { id: 'title-2', title: '标题二' }],
              coverCopies: [{ id: 'copy-1', text: '封面文案一' }, { id: 'copy-2', text: '封面文案二' }],
            },
          },
          backgrounds: [{ id: 'background-1', imageUrl: '/background-1.png' }, { id: 'background-2', imageUrl: '/background-2.png' }],
        },
      },
    })

    assert.deepEqual(card, { title: '标题一', imageUrl: '/composed-cover.jpg' })
    assert.equal(rendered[0].imageUrl, '/background-1.png')
    assert.equal(rendered[0].privateCopy.text, '封面文案二')
    assert.equal(rendered[0].privateCopy.date.includes('月'), true)
    assert.equal(getPublicShareTitle({ content: '第一句。第二句。' }), '第一句。')
    const longContent = '这是一段没有句号而且长度超过五十个汉字的公开内容，用于验证公开分享标题会保留足够上下文并限制在五十个字符以内。继续补充文字。'
    assert.equal(getPublicShareTitle({ content: longContent }), Array.from(longContent).slice(0, 50).join(''))

    const plainRendered = []
    const plainCard = await createPrivateShareCard({
      renderCover(options) {
        plainRendered.push(options)
        return Promise.resolve('/plain-cover.jpg')
      },
    }, {
      type: 'text',
      settings: {
        version: 4,
        private: {
          coverCopyEnabled: false,
          pools: { text: { titles: [{ id: 'plain-title', title: '只保留标题' }] } },
          backgrounds: [{ id: 'plain-background', imageUrl: '/plain-background.png' }],
        },
      },
    })

    assert.deepEqual(plainCard, { title: '只保留标题', imageUrl: '/plain-cover.jpg' })
    assert.equal(plainRendered[0].imageUrl, '/plain-background.png')
    assert.equal(plainRendered[0].privateCopy, null)
  } finally {
    Math.random = originalRandom
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('share card uses downloaded cover style and skips disabled layouts', async () => {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    getAccountInfoSync() { return { miniProgram: { envVersion: 'develop' } } },
  }

  try {
    const rendered = []
    await createPrivateShareCard({
      renderCover(options) {
        rendered.push(options)
        return Promise.resolve('/styled-cover.jpg')
      },
    }, {
      type: 'text',
      settings: {
        version: 12,
        private: {
          pools: {
            text: {
              titles: [{ id: 'styled-title', title: '有几句话想对你说' }],
              coverCopies: [{ id: 'styled-copy', text: '今日手记' }],
            },
          },
          backgrounds: [{ id: 'styled-background', imageUrl: '/styled-background.jpg' }],
          coverStyle: {
            globalWashOpacity: 0.4,
            readingZoneOpacity: 0,
            copyFontSize: 100,
            dateFontSize: 20,
            dividerGap: 20,
            dividerLength: 100,
            text: {
              copyColor: '#FFFDF8',
              dateColor: '#F5D48D',
              dividerColor: '#F5D48D',
              readingZoneColor: '#211A16',
            },
            layouts: {
              centered: { enabled: false, offsetY: 0 },
              leftTitle: { enabled: true, offsetY: 18 },
            },
          },
        },
      },
    })

    assert.equal(rendered[0].privateCopy.templateIndex, 1)
    assert.equal(rendered[0].privateCopy.style.globalWashOpacity, 0.4)
    assert.equal(rendered[0].privateCopy.style.readingZoneOpacity, 0)
    assert.equal(rendered[0].privateCopy.style.copyFontSize, 100)
    assert.equal(rendered[0].privateCopy.style.dateFontSize, 20)
    assert.equal(rendered[0].privateCopy.style.dividerGap, 20)
    assert.equal(rendered[0].privateCopy.style.dividerLength, 100)
    assert.equal(rendered[0].privateCopy.style.text.dividerColor, '#F5D48D')
    assert.equal(rendered[0].privateCopy.style.text.readingZoneColor, '#211A16')
    assert.equal(rendered[0].privateCopy.style.layouts.leftTitle.offsetY, 18)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('share card checks cached files through the file system manager', async () => {
  const storage = new Map([
    ['share-card-saved-files-v3', [{ key: 'legacy-card', path: 'wxfile://saved/legacy.jpg' }]],
    ['share-card-saved-files-v4', [{ key: 'current-card', path: 'wxfile://saved/current.jpg' }]],
  ])
  const originalWx = global.wx
  const inspectedPaths = []
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    getFileSystemManager() {
      return {
        getFileInfo({ filePath, success }) {
          inspectedPaths.push(filePath)
          success({ size: 1 })
        },
      }
    },
  }

  try {
    const composer = createShareCardComposer({})
    assert.equal(await composer.getCachedPath('legacy-card'), '')
    assert.equal(await composer.getCachedPath('current-card'), 'wxfile://saved/current.jpg')
    assert.deepEqual(inspectedPaths, ['wxfile://saved/current.jpg'])
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('share cover copy keeps its font size and splits after every ten characters', () => {
  assert.deepEqual(getCoverCopyLines('给你留下一封需要慢慢读完的长信呀'), ['给你留下一封需要慢慢', '读完的长信呀'])
  assert.deepEqual(getCoverCopyLines('这是刚好二十个字的分享封面文案请你慢慢看'), ['这是刚好二十个字的分', '享封面文案请你慢慢看'])
})

test('share cards recover after a different composer evicts a cached image', async () => {
  const storage = new Map()
  const files = new Set()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    getFileSystemManager() {
      return {
        saveFile({ tempFilePath, success }) {
          files.add(tempFilePath)
          success({ savedFilePath: tempFilePath })
        },
        unlink({ filePath }) { files.delete(filePath) },
        getFileInfo({ filePath, success, fail }) {
          if (files.has(filePath)) success({ size: 1024 })
          else fail(new Error('file not found'))
        },
      }
    },
  }
  try {
    const letters = createShareCardComposer({})
    const articles = createShareCardComposer({})
    await letters.rememberPath('letter-first', 'wxfile://saved/letter.jpg')
    assert.equal(await letters.getCachedPath('letter-first'), 'wxfile://saved/letter.jpg')
    for (let index = 0; index < 12; index += 1) {
      await articles.rememberPath(`article-${index}`, `wxfile://saved/article-${index}.jpg`)
    }
    assert.equal(files.has('wxfile://saved/letter.jpg'), false)
    assert.equal(await letters.getCachedPath('letter-first'), '')
    await letters.rememberPath('letter-first', 'wxfile://saved/letter-regenerated.jpg')
    assert.equal(await letters.getCachedPath('letter-first'), 'wxfile://saved/letter-regenerated.jpg')
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('public share styles rotate on shares without warm-up or other share types consuming the next style', async () => {
  const storage = new Map()
  const originalWx = global.wx
  const originalRandom = Math.random
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
  }
  Math.random = () => 0
  try {
    const rendered = []
    const composer = { renderCover(options) { rendered.push(options); return Promise.resolve('/composed.jpg') } }
    const options = { source: 'article', item: { id: 'article-one', title: '文章' } }
    const shown = []
    for (let index = 0; index < 4; index += 1) {
      await createPublicShareCard(composer, { ...options, preview: true })
      await createPublicShareCard(composer, { ...options, preview: true })
      await createPrivateShareCard(composer, { type: 'text' })
      await createPublicShareCard(composer, { source: 'letters', item: { id: 'letter-one', content: '心笺' } })
      await createPublicShareCard(composer, options)
      shown.push(rendered[rendered.length - 1].privateCopy.templateIndex)
    }
    assert.deepEqual(shown, [0, 1, 0, 1])
    await createPublicShareCard(composer, {
      ...options,
      settings: { private: { coverStyle: { layouts: { centered: { enabled: false } } } } },
    })
    assert.equal(rendered[rendered.length - 1].privateCopy.templateIndex, 1)
  } finally {
    Math.random = originalRandom
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('downloaded share backgrounds are fetched again after their temporary file expires', async () => {
  const originalWx = global.wx
  let downloads = 0
  let fileExists = true
  global.wx = {
    downloadFile({ success }) {
      downloads += 1
      fileExists = true
      success({ statusCode: 200, tempFilePath: `wxfile://tmp/background-${downloads}.jpg` })
    },
    getFileSystemManager() {
      return { getFileInfo({ success, fail }) { if (fileExists) success({ size: 10 }); else fail(new Error('expired')) } }
    },
  }
  try {
    const composer = createShareCardComposer({})
    const url = 'https://cdn.example.com/background.jpg'
    assert.equal(await composer.downloadRemoteImage(url), 'wxfile://tmp/background-1.jpg')
    assert.equal(await composer.downloadRemoteImage(url), 'wxfile://tmp/background-1.jpg')
    fileExists = false
    assert.equal(await composer.downloadRemoteImage(url), 'wxfile://tmp/background-2.jpg')
    assert.equal(downloads, 2)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('share cover copy line height follows the divider gap', () => {
  assert.equal(getCoverCopyLineHeight(20, 20), 25)
  assert.equal(getCoverCopyLineHeight(60, 60), 75)
  assert.equal(getCoverCopyLineHeight(100, 100), 125)
  assert.equal(getCoverCopyLineHeight(60, 20), 65)
  assert.equal(getCoverCopyLineHeight(60, 100), 85)
})

test('share card downloads remote images when getImageInfo rejects and reuses the temp path', async () => {
  const originalWx = global.wx
  const downloads = []
  const image = { width: 1200, height: 960 }
  Object.defineProperty(image, 'src', {
    set(value) {
      image.loadedSrc = value
      image.onload?.()
    },
  })
  global.wx = {
    getImageInfo({ fail }) {
      fail(new Error('invalid image'))
    },
    downloadFile({ url, success }) {
      downloads.push(url)
      success({ statusCode: 200, tempFilePath: 'wxfile://tmp/share.webp' })
    },
  }
  try {
    const composer = createShareCardComposer({})
    composer.canvas = { createImage: () => image }
    composer.context = {}
    const first = await composer.loadImage('https://cdn.example.com/share.webp')
    const second = await composer.loadImage('https://cdn.example.com/share.webp')
    assert.equal(downloads.length, 1)
    assert.equal(image.loadedSrc, 'wxfile://tmp/share.webp')
    assert.equal(first.width, 1200)
    assert.equal(first.height, 960)
    assert.equal(second.width, 1200)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('packaged share backgrounds keep an absolute asset path on repeated canvas loads', async () => {
  assert.equal(
    resolveCanvasImagePath('/assets/images/share-3.jpg', { path: 'assets/images/share-3.jpg' }),
    '/assets/images/share-3.jpg',
  )
  assert.equal(
    resolveCanvasImagePath('https://cdn.example.com/share.jpg', { path: 'wxfile://tmp/share.jpg' }),
    'wxfile://tmp/share.jpg',
  )
  const originalWx = global.wx
  const loaded = []
  global.wx = {
    getImageInfo({ src, success }) {
      success({ path: src.slice(1), width: 500, height: 400 })
    },
  }
  try {
    const composer = createShareCardComposer({})
    composer.canvas = {
      createImage() {
        return {
          width: 500,
          height: 400,
          set src(value) {
            loaded.push(value)
            if (value.startsWith('/assets/')) this.onload()
            else this.onerror()
          },
        }
      },
    }
    for (let index = 0; index < 3; index += 1) {
      const result = await composer.loadImage('/assets/images/share-1.jpg')
      assert.equal(result.width, 500)
      assert.equal(result.height, 400)
    }
    assert.deepEqual(loaded, Array(3).fill('/assets/images/share-1.jpg'))
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('public letters shares use a stable configured background even with legacy images', async () => {
  const settings = {
    version: 2,
    private: {
      backgrounds: [
        { id: 'bg-a', imageUrl: '/configured-a.jpg' },
        { id: 'bg-b', imageUrl: '/configured-b.jpg' },
      ],
    },
  }
  const composer = { renderCover: ({ imageUrl }) => Promise.resolve(imageUrl) }
  const first = await createPublicShareCard(composer, { source: 'letters', item: { id: 'letter-1', content: '无图内容' }, settings })
  const repeated = await createPublicShareCard(composer, { source: 'letters', item: { id: 'letter-1', content: '无图内容' }, settings })
  const withImage = await createPublicShareCard(composer, { source: 'letters', item: { id: 'letter-1', images: [{ mediumUrl: '/content.jpg' }] }, settings })
  assert.equal(first.imageUrl, repeated.imageUrl)
  assert.ok(['/configured-a.jpg', '/configured-b.jpg'].includes(first.imageUrl))
  assert.equal(withImage.imageUrl, first.imageUrl)
})

test('article public shares use coverImage and ignore body images', async () => {
  const composer = { renderCover: ({ imageUrl }) => Promise.resolve(imageUrl) }
  const settings = { private: { backgrounds: [{ id: 'bg', imageUrl: '/configured.jpg' }] } }
  const card = await createPublicShareCard(composer, {
    source: 'article',
    item: {
      id: 'article-1',
      coverImage: { mediumUrl: '/article-cover.jpg' },
      images: [{ mediumUrl: '/body-image.jpg' }],
    },
    settings,
  })
  assert.equal(card.imageUrl, '/article-cover.jpg')
  const noCover = await createPublicShareCard(composer, {
    source: 'article',
    item: { id: 'article-2', images: [{ mediumUrl: '/body-image.jpg' }] },
    settings,
  })
  const summary = prepareArticleSummary({ id: 'article-2', title: '文章' }, 'mixed', 0, settings)
  assert.equal(noCover.imageUrl, summary.coverUrl)
})

test('article fallback covers are stable per article and prefer configured backgrounds', () => {
  const settings = {
    private: {
      backgrounds: [
        { imageUrl: '/configured-a.jpg' },
        { imageUrl: '/configured-b.jpg' },
      ],
    },
  }
  const first = prepareArticleSummary({ id: 'article-1', title: '一' }, 'mixed', 0, settings)
  const repeated = prepareArticleSummary({ id: 'article-1', title: '一' }, 'mixed', 9, settings)
  assert.equal(first.coverUrl, repeated.coverUrl)
  assert.ok(['/configured-a.jpg', '/configured-b.jpg'].includes(first.coverUrl))
  assert.ok(['/assets/images/share-1.jpg', '/assets/images/share-3.jpg'].includes(resolveFallbackCoverUrl({}, 0, 'article-1')))
})

test('missing article covers select the same background for list and share including packaged defaults', async () => {
  for (const settings of [{}, { private: { backgrounds: [{ imageUrl: '/a.jpg' }, { imageUrl: '/b.jpg' }] } }]) {
    for (const id of ['article-1', 'article-2', 'article-3']) {
      const article = { id, images: [{ mediumUrl: '/body-only.jpg' }] }
      const summary = prepareArticleSummary(article, 'title-left', 7, settings)
      const card = await createPublicShareCard(null, { source: 'article', item: article, settings })
      assert.equal(card.imageUrl, summary.coverUrl)
      assert.notEqual(card.imageUrl, '/body-only.jpg')
    }
  }
})

test('public share image failures try variants of the content cover before common and packaged backgrounds', async () => {
  let rendered
  const composer = { renderCover: async (options) => { rendered = options; return '/composed.jpg' } }
  await createPublicShareCard(composer, {
    source: 'article',
    item: { id: 'a-1', coverImage: { mediumUrl: '/medium.jpg', thumbUrl: '/thumb.jpg', originalUrl: '/original.jpg' }, images: [{ mediumUrl: '/body.jpg' }] },
    settings: { private: { backgrounds: [{ imageUrl: '/common.jpg' }] } },
  })
  assert.equal(rendered.imageUrl, '/medium.jpg')
  assert.deepEqual(rendered.imageFallbacks.slice(0, 4), ['/medium.jpg', '/thumb.jpg', '/original.jpg', '/common.jpg'])
  assert.ok(!rendered.imageFallbacks.includes('/body.jpg'))
})

test('share canvas center crops small, wide and tall images inside their source bounds', async () => {
  const composer = createShareCardComposer({})
  let rectangle
  composer.context = { drawImage(_image, ...args) { rectangle = args } }
  for (const [width, height] of [[50, 40], [2400, 200], [200, 2400], [300, 300]]) {
    composer.loadImage = async () => ({ image: {}, width, height })
    await composer.drawCoverImage('/test.jpg')
    const [sx, sy, sw, sh, dx, dy, dw, dh] = rectangle
    assert.ok([sx, sy, sw, sh].every(Number.isFinite))
    assert.ok(sx >= 0 && sy >= 0 && sw > 0 && sh > 0)
    assert.ok(sx + sw <= width && sy + sh <= height)
    assert.equal(sx, (width - sw) / 2)
    assert.equal(sy, (height - sh) / 2)
    assert.equal(sw / sh, 5 / 4)
    assert.deepEqual([dx, dy, dw, dh], [0, 0, 500, 400])
  }
  for (const [width, height] of [[0, 400], [500, -1], [Infinity, 400], [500, NaN]]) {
    composer.loadImage = async () => ({ image: {}, width, height })
    await assert.rejects(composer.drawCoverImage('/invalid.jpg'), /图片尺寸无效/)
  }
})

test('a recovered share fallback is temporary and the preferred image can be cached after recovery', async () => {
  const originalWx = global.wx
  let exports = 0
  let preferredAvailable = false
  const attempted = []
  const remembered = []
  global.wx = { canvasToTempFilePath({ success }) { exports += 1; success({ tempFilePath: `/temp-${exports}.jpg` }) } }
  try {
    const composer = createShareCardComposer({})
    composer.canvas = {}
    composer.context = { clearRect() {}, fillRect() {} }
    composer.getCachedPath = async () => ''
    composer.drawCoverImage = async (source) => {
      attempted.push(source)
      if (source === '/preferred.jpg' && !preferredAvailable) throw new Error('temporary failure')
    }
    composer.rememberPath = async (key, file) => { remembered.push({ key, file }); return file }
    const options = { cacheKey: 'same-card', imageUrl: '/preferred.jpg', imageFallbacks: ['/preferred.jpg', '/fallback.jpg'] }
    assert.equal(await composer.renderCover(options), '/temp-1.jpg')
    assert.deepEqual(attempted, ['/preferred.jpg', '/fallback.jpg'])
    assert.deepEqual(remembered, [])
    preferredAvailable = true
    assert.equal(await composer.renderCover(options), '/temp-2.jpg')
    assert.deepEqual(remembered, [{ key: 'same-card', file: '/temp-2.jpg' }])
    composer.drawCoverImage = async () => { throw new Error('all failed') }
    await assert.rejects(composer.renderCover(options), /all failed/)
    assert.equal(exports, 2)
    assert.equal(remembered.length, 1)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})
