const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-article-import-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
const { withCors } = require('../src/lib/cors')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp-import',
  contentPools: [{ id: 'pool-import', name: '导入池' }],
  miniPrograms: [{
    id: 'mp-import',
    name: '导入小程序',
    appId: 'wx2222222222222222',
    status: 'active',
    config: { contentPoolId: 'pool-import' },
  }],
  storage: {
    bucket: 'test-1250000000',
    region: 'ap-chengdu',
    url: 'https://media.example.com',
    folderPrefix: 'secretbox-test',
  },
})
const {
  ArticleImportError,
  createArticleImportJob,
  convertWechatArticleHtmlToMarkdown,
  getArticleImportJob,
  importOneArticle,
  applyBatchDuplicateBoundaryCleanup,
  fetchSafeResource,
  isPublicIp,
  parseWechatArticleHtml,
  purgeExpiredImportJobs,
  publishArticleImportJob,
  retryArticleImportEntry,
  normalizeEditedItems,
  toTransferredExistingImage,
  uploadPreparedImage,
  validateRemoteUrl,
} = require('../src/modules/content/article-import.service')
const { renderArticleMarkdown } = require('../src/modules/content/article-markdown')
const { getContentItem } = require('../src/modules/content/content.store')
const { addImageAsset, getImageById } = require('../src/modules/images/image.store')
const { createAppRouter } = require('../src/routes')
const tailCases = require('./fixtures/wechat-article-tail-cases.json')

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00])
const sourceUrl = 'https://mp.weixin.qq.com/s/test-article'
const imageUrl = 'https://mmbiz.qpic.cn/mmbiz_jpg/test/0?wx_fmt=jpeg'
const publishedMeta = '<meta property="article:published_time" content="2026-08-30T12:00:00+08:00"><meta name="author" content="测试作者">'
const articleHtml = `<!doctype html><html><head>
  <meta property="og:title" content="一篇测试文章">
  <meta property="og:image" content="${imageUrl}">
  <meta property="article:published_time" content="2026-08-30T12:00:00+08:00">
  <meta name="author" content="测试作者">
  </head><body><a id="js_name">测试公众号</a><div id="js_content">
  <p onclick="alert(1)">第一段 <strong>保留强调</strong><script>alert(1)</script></p>
  <p style="color:red">第二段</p>
  <img data-src="${imageUrl}" onerror="alert(2)">
  <iframe src="https://evil.example.com"></iframe>
  </div></body></html>`

function pngWithDimensions(width, height) {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function gifWithDimensions(width, height) {
  const buffer = Buffer.alloc(10)
  Buffer.from('GIF89a').copy(buffer)
  buffer.writeUInt16LE(width, 6)
  buffer.writeUInt16LE(height, 8)
  return buffer
}

function animatedWebpWithDimensions(width, height) {
  const buffer = Buffer.alloc(40)
  Buffer.from('RIFF').copy(buffer, 0)
  Buffer.from('WEBP').copy(buffer, 8)
  Buffer.from('VP8X').copy(buffer, 12)
  buffer[24] = (width - 1) & 0xff
  buffer[25] = ((width - 1) >> 8) & 0xff
  buffer[26] = ((width - 1) >> 16) & 0xff
  buffer[27] = (height - 1) & 0xff
  buffer[28] = ((height - 1) >> 8) & 0xff
  buffer[29] = ((height - 1) >> 16) & 0xff
  Buffer.from('ANIM').copy(buffer, 32)
  return buffer
}

async function waitForJob(jobId, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const job = getArticleImportJob(jobId)
    if (job && predicate(job)) return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`等待导入任务 ${jobId} 超时`)
}

function createFetchResource({ failedUrls = new Set(), gate = null, onPageFetch = null } = {}) {
  return async (url, { kind }) => {
    if (kind === 'image') return { body: jpeg, contentType: 'image/jpeg', finalUrl: imageUrl, headers: {}, status: 200 }
    if (onPageFetch) onPageFetch(url)
    if (gate) await gate
    if (failedUrls.has(url)) throw new ArticleImportError('TEST_FETCH_FAILED', '测试抓取失败')
    return { body: Buffer.from(articleHtml), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
  }
}

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('remote URL policy rejects non-WeChat pages and private IP ranges', () => {
  assert.equal(validateRemoteUrl(sourceUrl).hostname, 'mp.weixin.qq.com')
  assert.throws(() => validateRemoteUrl('https://example.com/article'), /首版仅支持/)
  assert.equal(validateRemoteUrl('https://images.example.com/article-cover.jpg', 'image').hostname, 'images.example.com')
  assert.throws(() => validateRemoteUrl('file:///etc/passwd'), /http\(s\)/)
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPublicIp(address), false, address)
  }
  assert.equal(isPublicIp('1.1.1.1'), true)
  assert.equal(isPublicIp('2606:4700:4700::1111'), true)
})

test('任意图片域名仍拒绝私有地址，避免开放图片主机造成 SSRF', async () => {
  await assert.rejects(
    fetchSafeResource('http://127.0.0.1/image.jpg', { kind: 'image', timeoutMs: 1000 }),
    (error) => error.code === 'SSRF_BLOCKED',
  )
})

test('无 og:image 时使用正文 data-src 作为封面，并与正文图片共用转存结果', async () => {
  const coverUrl = 'https://images.example.com/covers/no-og-image.jpg'
  const html = `<!doctype html><html><head><meta property="og:title" content="data-src 封面">${publishedMeta}</head><body><div id="js_content"><p>正文第一段用于验证没有 og:image 时，正文图片仍可作为封面。</p><p>正文第二段补充足够的内容，确保导入流程不会因为封面字段缺失而降级。</p><img data-src="${coverUrl}"></div></body></html>`
  const fetched = []
  const item = await importOneArticle('https://mp.weixin.qq.com/s/data-src-cover', {
    fetchResource: async (url, { kind }) => {
      if (kind === 'page') return { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      fetched.push(url)
      return { body: jpeg, contentType: 'image/jpeg', finalUrl: url, headers: {}, status: 200 }
    },
    uploadBuffer: async () => {},
  })
  assert.deepEqual(fetched, [coverUrl])
  assert.equal(item.coverImage.id.startsWith('article-'), true)
  assert.equal(item.bodyImageAssetIds.length, 1)
})

test('公众号时间字段优先于抓取时间，并支持 ct Unix 秒时间戳', () => {
  const html = `<!doctype html><html><head><meta property="og:title" content="时间字段测试"><meta name="publish_time" content="2025-04-03 10:20:30"></head><body><div id="js_content"><p>正文内容足够长，用于验证发布时间解析不会回退为当前抓取时间。</p></div><script>var ct = "1712110830";</script></body></html>`
  const parsed = parseWechatArticleHtml(html, sourceUrl)
  assert.equal(parsed.publishedAt, new Date('2025-04-03T10:20:30+08:00').toISOString())

  const ctHtml = `<!doctype html><html><head><meta property="og:title" content="ct 时间测试"></head><body><div id="js_content"><p>正文内容足够长，用于验证脚本中的 ct 字段也会被正确提取。</p></div><script>var ori_create_time = "1712110830";</script></body></html>`
  assert.equal(parseWechatArticleHtml(ctHtml, sourceUrl).publishedAt, new Date(1712110830 * 1000).toISOString())

  const visibleHtml = '<!doctype html><html><head><meta property="og:title" content="可见时间测试"></head><body><div id="js_content"><p>正文内容足够长，用于验证页面可见发布时间字段。</p></div><em id="publish_time">2025年04月03日 10:20</em></body></html>'
  assert.equal(parseWechatArticleHtml(visibleHtml, sourceUrl).publishedAt, new Date('2025-04-03T10:20:00+08:00').toISOString())
})

test('正文图片过滤仅移除装饰动图和超小静态图，大尺寸动图与封面保留', async () => {
  const coverUrl = 'https://images.example.com/cover.gif'
  const smallUrl = 'https://images.example.com/small.png'
  const stickerUrl = 'https://images.example.com/sticker.gif'
  const bannerUrl = 'https://images.example.com/banner.gif'
  const imageBodies = new Map([
    [coverUrl, gifWithDimensions(640, 360)],
    [smallUrl, pngWithDimensions(64, 64)],
    [stickerUrl, gifWithDimensions(637, 117)],
    [bannerUrl, animatedWebpWithDimensions(1079, 192)],
  ])
  const html = `<!doctype html><html><head><meta property="og:title" content="图片过滤测试"><meta property="og:image" content="${coverUrl}">${publishedMeta}</head><body><div id="js_content"><p>正文第一段包含足够的内容，用于验证图片过滤不会影响文章正文的导入和阅读。</p><img data-src="${smallUrl}"><img data-src="${stickerUrl}"><img data-src="${bannerUrl}"><p>正文最后一段继续说明结论和适用范围，确保过滤图片后仍有完整正文内容。</p></div></body></html>`
  const fetched = []
  const uploaded = []
  const item = await importOneArticle('https://mp.weixin.qq.com/s/image-filtering', {
    fetchResource: async (url, { kind }) => {
      if (kind === 'page') return { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      fetched.push(url)
      return { body: imageBodies.get(url), contentType: url.endsWith('.png') ? 'image/png' : url.endsWith('.gif') ? 'image/gif' : 'image/webp', finalUrl: url, headers: {}, status: 200 }
    },
    uploadBuffer: async ({ key }) => uploaded.push(key),
  })
  assert.deepEqual(fetched.sort(), [bannerUrl, coverUrl, smallUrl, stickerUrl].sort())
  assert.equal(uploaded.length, 2)
  assert.equal(item.bodyImageAssetIds.length, 1)
  assert.match(item.bodyMarkdown, /\.webp\)/u)
  assert.doesNotMatch(item.bodyMarkdown, /small\.png|sticker\.gif/u)
  assert.match(item.restoredBodyMarkdown, /\.webp\)/u)
  assert.doesNotMatch(item.restoredBodyMarkdown, /small\.png|sticker\.gif/u)
  assert.equal(item.coverImage?.id.startsWith('article-cover-'), true)
  const filtered = item.mediaWarnings.find((warning) => warning.type === 'body-image-filtered')
  assert.equal(filtered?.count, 2)
})

test('仅过滤正文首尾的极端比例横幅或竖条，中间同类图片保留', async () => {
  const coverUrl = 'https://images.example.com/boundary-cover.png'
  const headUrl = 'https://images.example.com/boundary-head.png'
  const middleUrl = 'https://images.example.com/boundary-middle.png'
  const tailUrl = 'https://images.example.com/boundary-tail.png'
  const infoUrl = 'https://images.example.com/boundary-info.png'
  const imageBodies = new Map([
    [coverUrl, pngWithDimensions(640, 360)],
    [headUrl, pngWithDimensions(638, 94)],
    [middleUrl, pngWithDimensions(638, 94)],
    [tailUrl, pngWithDimensions(94, 638)],
    [infoUrl, pngWithDimensions(300, 2000)],
  ])
  const html = `<!doctype html><html><head><meta property="og:title" content="首尾比例图片过滤"><meta property="og:image" content="${coverUrl}">${publishedMeta}</head><body><div id="js_content"><p><img data-src="${headUrl}"></p><p>正文开头先交代文章背景、信息来源和判断依据，确保首部横幅移除后仍然保留可独立阅读的内容。</p><p><img data-src="${middleUrl}"></p><p>正文中段继续说明关键差异、适用边界和核验方法，中间同样比例的图片属于文章内容，不应因为尺寸比例被误删。</p><p>正文结尾收束全文，并给出下一步可以复核的公开材料和具体操作建议。</p><p><img data-src="${tailUrl}"></p><p><img data-src="${infoUrl}"></p></div></body></html>`
  const uploaded = []
  const item = await importOneArticle('https://mp.weixin.qq.com/s/boundary-image-filtering', {
    fetchResource: async (url, { kind }) => kind === 'page'
      ? { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      : { body: imageBodies.get(url), contentType: 'image/png', finalUrl: url, headers: {}, status: 200 },
    uploadBuffer: async ({ key }) => uploaded.push(key),
  })
  assert.equal(uploaded.length <= 3, true, '重复原图可复用已存在的 COS 素材')
  assert.equal(item.bodyImageAssetIds.length, 2)
  const retainedImages = item.bodyImageAssetIds.map((id) => getImageById(id)).filter(Boolean)
  assert.ok(retainedImages.some((image) => image.width === 638 && image.height === 94))
  assert.ok(retainedImages.some((image) => image.width === 300 && image.height === 2000))
  assert.match(item.bodyMarkdown, /media\.example\.com/u)
  assert.match(item.restoredBodyMarkdown, /media\.example\.com/u)
  const filtered = item.mediaWarnings.find((warning) => warning.type === 'body-image-filtered')
  assert.equal(filtered?.count, 2)
  assert.match(filtered?.message || '', /首尾极端比例图片/u)
})

test('边界极端比例图片允许短标题，中间图片和长正文图片保留', async () => {
  const coverUrl = 'https://images.example.com/boundary-title-cover.png'
  const headUrl = 'https://images.example.com/boundary-title-head.png'
  const middleUrl = 'https://images.example.com/boundary-title-middle.png'
  const longTextUrl = 'https://images.example.com/boundary-title-long.png'
  const tailUrl = 'https://images.example.com/boundary-title-tail.png'
  const imageBodies = new Map([
    [coverUrl, pngWithDimensions(640, 360)],
    [headUrl, pngWithDimensions(638, 94)],
    [middleUrl, pngWithDimensions(638, 95)],
    [longTextUrl, pngWithDimensions(638, 96)],
    [tailUrl, pngWithDimensions(94, 638)],
  ])
  const longText = '这是一段超过边界短标题长度的正文说明，用于验证图片旁边存在较长正文时不会因为图片比例夸张而被自动删除。'
  const html = `<!doctype html><html><head><meta property="og:title" content="边界标题图片过滤">${publishedMeta}<meta property="og:image" content="${coverUrl}"></head><body><div id="js_content"><p><img data-src="${headUrl}">开篇标题</p><p>正文开头先交代文章背景、信息来源和判断依据，确保首部图片过滤后仍然保留可独立阅读的内容。</p><p><img data-src="${middleUrl}">中间配图说明</p><p>正文中段继续说明关键差异、适用边界和核验方法，中间图片属于文章内容，不应因为尺寸比例被误删。</p><p><img data-src="${longTextUrl}">${longText}</p><p><img data-src="${tailUrl}">作者署名</p></div></body></html>`
  const uploaded = []
  const item = await importOneArticle('https://mp.weixin.qq.com/s/boundary-image-title-filtering', {
    fetchResource: async (url, { kind }) => kind === 'page'
      ? { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      : { body: imageBodies.get(url), contentType: 'image/png', finalUrl: url, headers: {}, status: 200 },
    uploadBuffer: async ({ key }) => uploaded.push(key),
  })
  assert.equal(uploaded.length <= 3, true, '重复原图可复用已存在的 COS 素材')
  assert.equal(item.bodyImageAssetIds.length, 2)
  const retainedImages = item.bodyImageAssetIds.map((id) => getImageById(id)).filter(Boolean)
  assert.ok(retainedImages.some((image) => image.width === 638 && image.height === 95))
  assert.ok(retainedImages.some((image) => image.width === 638 && image.height === 96))
  assert.equal(retainedImages.some((image) => image.width === 638 && image.height === 94), false)
  assert.equal(retainedImages.some((image) => image.width === 94 && image.height === 638), false)
  assert.match(item.bodyMarkdown, /中间配图说明/u)
  assert.match(item.bodyMarkdown, /超过边界短标题长度/u)
  assert.match(item.bodyMarkdown, /开篇标题|作者署名/u)
  assert.equal((item.bodyMarkdown.match(/!\[/gu) || []).length, 2)
  assert.equal((item.restoredBodyMarkdown.match(/!\[/gu) || []).length, 2)
  const filtered = item.mediaWarnings.find((warning) => warning.type === 'body-image-filtered')
  assert.equal(filtered?.count, 2)
})

test('边界推荐标题与极端比例图片交错出现时成对清理', async () => {
  const coverUrl = 'https://images.example.com/recommend-pair-cover.png'
  const firstUrl = 'https://images.example.com/recommend-pair-first.png'
  const secondUrl = 'https://images.example.com/recommend-pair-second.png'
  const imageBodies = new Map([
    [coverUrl, pngWithDimensions(640, 360)],
    [firstUrl, pngWithDimensions(638, 94)],
    [secondUrl, pngWithDimensions(638, 94)],
  ])
  const html = `<!doctype html><html><head><meta property="og:title" content="推荐标题图片对"><meta property="og:image" content="${coverUrl}">${publishedMeta}</head><body><div id="js_content"><p>正文第一段完整交代文章背景和判断前提，确保清理推荐卡片后仍保留足够的核心内容。</p><p>正文第二段继续解释关键差异和适用范围，让文章在移除尾部推荐卡片后仍然可以独立阅读。</p><p>推荐阅读更多的标题1</p><p><img data-src="${firstUrl}"></p><p>推荐阅读更多的标题2</p><p><img data-src="${secondUrl}"></p></div></body></html>`
  const item = await importOneArticle('https://mp.weixin.qq.com/s/recommend-pair-forward', {
    fetchResource: async (url, { kind }) => kind === 'page'
      ? { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      : { body: imageBodies.get(url), contentType: 'image/png', finalUrl: url, headers: {}, status: 200 },
    uploadBuffer: async () => {},
  })
  assert.equal(item.bodyImageAssetIds.length, 0)
  assert.doesNotMatch(item.bodyMarkdown, /推荐阅读更多的标题|recommend-pair-(?:first|second)/u)
  assert.doesNotMatch(item.restoredBodyMarkdown, /推荐阅读更多的标题|recommend-pair-(?:first|second)/u)
  assert.match(item.bodyMarkdown, /正文第一段|正文第二段/u)
})

test('图片在推荐标题前的边界推荐卡片同样清理，普通图注和中间内容保留', async () => {
  const coverUrl = 'https://images.example.com/recommend-reverse-cover.png'
  const firstUrl = 'https://images.example.com/recommend-reverse-first.png'
  const secondUrl = 'https://images.example.com/recommend-reverse-second.png'
  const middleUrl = 'https://images.example.com/recommend-reverse-middle.png'
  const imageBodies = new Map([
    [coverUrl, pngWithDimensions(640, 360)],
    [firstUrl, pngWithDimensions(638, 94)],
    [secondUrl, pngWithDimensions(638, 94)],
    [middleUrl, pngWithDimensions(638, 94)],
  ])
  const html = `<!doctype html><html><head><meta property="og:title" content="反向推荐标题图片对"><meta property="og:image" content="${coverUrl}">${publishedMeta}</head><body><div id="js_content"><p><img data-src="${firstUrl}"></p><p>相关推荐标题1</p><p>正文中段插图说明</p><p><img data-src="${middleUrl}">普通图注</p><p>正文结尾继续补充完整结论和可执行建议，确保中间图片属于正文内容。</p><p><img data-src="${secondUrl}"></p><p>相关阅读标题2</p></div></body></html>`
  const item = await importOneArticle('https://mp.weixin.qq.com/s/recommend-pair-reverse', {
    fetchResource: async (url, { kind }) => kind === 'page'
      ? { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      : { body: imageBodies.get(url), contentType: 'image/png', finalUrl: url, headers: {}, status: 200 },
    uploadBuffer: async () => {},
  })
  assert.equal(item.bodyImageAssetIds.length, 1)
  assert.match(item.bodyMarkdown, /普通图注|正文中段插图说明/u)
  assert.doesNotMatch(item.bodyMarkdown, /相关推荐标题1|相关阅读标题2|recommend-reverse-(?:first|second)/u)
  assert.doesNotMatch(item.restoredBodyMarkdown, /相关推荐标题1|相关阅读标题2|recommend-reverse-(?:first|second)/u)
  const retainedImage = getImageById(item.bodyImageAssetIds[0])
  assert.equal(retainedImage?.width, 638)
  assert.equal(retainedImage?.height, 94)
})

test('推荐标题旁混入长正文时不按边界比例清理图片', async () => {
  const coverUrl = 'https://images.example.com/recommend-long-cover.png'
  const imageUrl = 'https://images.example.com/recommend-long-image.png'
  const imageBodies = new Map([
    [coverUrl, pngWithDimensions(640, 360)],
    [imageUrl, pngWithDimensions(638, 94)],
  ])
  const longText = '推荐阅读标题后紧接着是一段较长的正文说明，包含背景、限制和具体方法，这应当被视为文章内容而不是推荐卡片。'
  const html = `<!doctype html><html><head><meta property="og:title" content="推荐长正文保护"><meta property="og:image" content="${coverUrl}">${publishedMeta}</head><body><div id="js_content"><p>正文第一段内容足够完整，确保文章在任何过滤规则下都可以独立阅读。</p><p>推荐阅读</p><p><img data-src="${imageUrl}"></p><p>${longText}</p></div></body></html>`
  const item = await importOneArticle('https://mp.weixin.qq.com/s/recommend-pair-long', {
    fetchResource: async (url, { kind }) => kind === 'page'
      ? { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      : { body: imageBodies.get(url), contentType: 'image/png', finalUrl: url, headers: {}, status: 200 },
    uploadBuffer: async () => {},
  })
  assert.equal(item.bodyImageAssetIds.length, 1)
  assert.match(item.bodyMarkdown, /推荐阅读标题后紧接/u)
  assert.match(item.restoredBodyMarkdown, /推荐阅读标题后紧接/u)
})

test('推荐阅读小节后的连续图片块会整体作为尾部推广清理', () => {
  const body = '正文内容足够长，确保尾部清理后仍保留完整论述。'.repeat(20)
  const html = `<p>${body}</p><p>第二段正文继续补充背景、限制和结论，保证清理推广尾部后仍是完整文章内容。</p><h2>推荐阅读</h2><p><a href="https://mp.weixin.qq.com/s/recommended">相关文章</a></p><p><img src="https://images.example.com/first.gif"></p><p><img src="https://images.example.com/second.gif"></p><p><img src="https://images.example.com/third.gif"></p>`
  const result = convertWechatArticleHtmlToMarkdown(html, sourceUrl)
  assert.equal(result.tailCleanup.applied, true)
  assert.doesNotMatch(result.bodyMarkdown, /推荐阅读|recommended|first\.gif|second\.gif|third\.gif/u)
  assert.match(result.removedTailMarkdown, /推荐阅读|recommended/u)
})

test('独立 END 结束标记后的内容整体作为尾部推广清理', () => {
  const body = '正文内容足够长，确保结束标记清理后仍保留完整论述。'.repeat(20)
  const html = `<p>${body}</p><p>第二段正文继续补充背景、限制和结论，保证清理后仍是完整文章内容。</p><p>*—END—*</p><p><img src="https://images.example.com/qr.gif"></p><p>关注我，发现更多精彩</p><p>你的每个赞和在看，我都喜欢！</p>`
  const result = convertWechatArticleHtmlToMarkdown(html, sourceUrl)
  assert.equal(result.tailCleanup.applied, true)
  assert.match(result.tailCleanup.categories.join(','), /结束标记/u)
  assert.doesNotMatch(result.bodyMarkdown, /END|关注我|每个赞|qr\.gif/u)
  assert.match(result.removedTailMarkdown, /END|关注我|每个赞/u)
})

test('文章末尾单独 END 结束标记不触发尾部清理', () => {
  const body = '正文内容足够长，确保末尾结束标记不会被误判为推广尾部。'.repeat(20)
  const result = convertWechatArticleHtmlToMarkdown(`<p>${body}</p><p>END</p>`, sourceUrl)
  assert.equal(result.tailCleanup.applied, false)
  assert.equal(result.removedTailMarkdown, '')
  assert.match(result.bodyMarkdown, /END/u)
})

test('图片结束标记后接关注和互动文案时，图片与营销尾巴一并清理', () => {
  const body = '正文内容足够长，确保图片营销尾巴清理后仍保留完整论述。'.repeat(20)
  const html = `<p>${body}</p><p>第二段正文继续补充背景、限制和结论，保证清理后仍是完整文章内容。</p><p><img src="https://images.example.com/end-card.png"></p><p>关注我，发现更多精彩</p><p>你的每个赞和在看，我都喜欢！</p>`
  const result = convertWechatArticleHtmlToMarkdown(html, sourceUrl)
  assert.equal(result.tailCleanup.applied, true)
  assert.match(result.tailCleanup.categories.join(','), /关注引导|互动引导/u)
  assert.doesNotMatch(result.bodyMarkdown, /end-card\.png|关注我|每个赞和在看/u)
  assert.match(result.removedTailMarkdown, /end-card\.png|关注我|每个赞和在看/u)
})

test('正文末尾单独图片没有文字信号时不自动清理', () => {
  const body = '正文内容足够长，说明这张图片属于正文的一部分，不能因为位于末尾就被误删。'.repeat(20)
  const result = convertWechatArticleHtmlToMarkdown(`<p>${body}</p><p><img src="https://images.example.com/body-photo.png"></p>`, sourceUrl)
  assert.equal(result.tailCleanup.applied, false)
  assert.match(result.bodyMarkdown, /body-photo\.png/u)
  assert.equal(result.removedTailMarkdown, '')
})

test('头部订阅引导与相邻营销图片会自动清理', () => {
  const body = '正文第一段完整说明文章背景、方法和结论，确保移除头部引导后仍保留可独立阅读的内容。'.repeat(3)
  const html = `<p><img src="https://images.example.com/header-ad.png"></p><p>请一定要星标我们，星标我们不失联</p><p>${body}</p><p>正文第二段继续补充适用边界和核验方法，保留完整文章结构。</p>`
  const result = convertWechatArticleHtmlToMarkdown(html, sourceUrl)
  assert.equal(result.tailCleanup.applied, true)
  assert.match(result.tailCleanup.categories.join(','), /头部引导/u)
  assert.doesNotMatch(result.bodyMarkdown, /header-ad\.png|星标我们/u)
  assert.match(result.removedTailMarkdown, /header-ad\.png|星标我们/u)
})

test('头部提示前的图片加短广告文案会一并清理', () => {
  const body = '正文第一段完整说明文章背景、方法和结论，确保头部广告卡移除后仍保留可独立阅读的内容。'.repeat(3)
  const html = `<p><img src="https://images.example.com/header-card.png">每日更新高颜值内容，承包你的每日心动</p><p>点击上方蓝字，订阅号星标我们</p><p>${body}</p><p>正文第二段继续补充适用边界和核验方法，保留完整文章结构。</p>`
  const result = convertWechatArticleHtmlToMarkdown(html, sourceUrl)
  assert.equal(result.tailCleanup.applied, true)
  assert.doesNotMatch(result.bodyMarkdown, /header-card\.png|每日更新高颜值内容|订阅号星标我们/u)
  assert.match(result.removedTailMarkdown, /header-card\.png|每日更新高颜值内容/u)
})

test('头部点击蓝字和订阅号消息引导会清理，普通关注标题保留', () => {
  const body = '正文内容足够长，确保头部清理后仍然有完整文章内容。'.repeat(8)
  const clicked = convertWechatArticleHtmlToMarkdown(`<p>点击上方蓝字关注我们吧</p><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
  assert.doesNotMatch(clicked.bodyMarkdown, /点击上方蓝字关注我们/u)

  const subscribed = convertWechatArticleHtmlToMarkdown(`<p>订阅号消息：请先星标本公众号</p><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
  assert.doesNotMatch(subscribed.bodyMarkdown, /订阅号消息|星标本公众号/u)

  const ordinary = convertWechatArticleHtmlToMarkdown(`<h2>关注是内容传播的重要入口</h2><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
  assert.match(ordinary.bodyMarkdown, /关注是内容传播的重要入口/u)

  const ordinaryParagraph = convertWechatArticleHtmlToMarkdown(`<p>本文关注公众号生态的变化及其传播机制</p><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
  assert.match(ordinaryParagraph.bodyMarkdown, /本文关注公众号生态的变化/u)

  const shortPrompt = convertWechatArticleHtmlToMarkdown(`<p>关注公众号</p><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
  assert.doesNotMatch(shortPrompt.bodyMarkdown, /关注公众号/u)

  for (const keyword of ['星标', '订阅', '订阅号', '关注', '蓝字', '置顶', '关注我们', '星标我们', '置顶本号']) {
    const single = convertWechatArticleHtmlToMarkdown(`<p>${keyword}！</p><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
    assert.doesNotMatch(single.bodyMarkdown, new RegExp(keyword, 'u'))
  }
  for (const prompt of ['欢迎关注', '请关注我们', '点击关注']) {
    const single = convertWechatArticleHtmlToMarkdown(`<p>${prompt}</p><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
    assert.doesNotMatch(single.bodyMarkdown, new RegExp(prompt, 'u'))
  }

  const laterShortBlock = convertWechatArticleHtmlToMarkdown(`<p>文章导语</p><p>第二段普通说明</p><p>关注</p><p>${body}</p><p>正文结尾继续补充说明和验证步骤。</p>`, sourceUrl)
  assert.match(laterShortBlock.bodyMarkdown, /文章导语|第二段普通说明|关注/u)
})

for (const fixture of [
  {
    name: '蓝色账号优先于灰色署名和作者元信息',
    head: '<meta name="author" content="快乐派大星"><meta property="article:author" content="快乐派大星">',
    body: '<div id="meta_content"><span id="js_author_name">快乐派大星</span><a id="js_name">  派大星说车  </a></div>',
    author: '派大星说车',
  },
  {
    name: '账号主节点为空时继续读取简介账号',
    head: '<meta name="author" content="灰色作者">',
    body: '<a id="js_name"> \n </a><strong class="profile_nickname">简介公众号</strong>',
    author: '简介公众号',
  },
  {
    name: '脚本账号优先于先出现的脚本作者和作者元信息',
    head: '<meta name="author" content="灰色作者">',
    body: '<script>var author = "脚本作者"; var nickname = "\\u6d3e\\u5927\\u661f说车";</script>',
    author: '派大星说车',
  },
  {
    name: '空白脚本账号不阻止读取后续账号字段',
    head: '<meta name="author" content="灰色作者">',
    body: '<script>var nickname = " "; var profile_nickname = "脚本公众号";</script>',
    author: '脚本公众号',
  },
  {
    name: '支持脚本对象中的带引号账号键和转义引号',
    head: '<meta name="author" content="灰色作者">',
    body: '<script>var profile = { "nickname": "Reader\\\'s Account" };</script>',
    author: "Reader's Account",
  },
  {
    name: '账号全部为空时使用作者元信息兜底',
    head: '<meta name="author" content="  快乐派大星  ">',
    body: '<a id="js_name"> </a><strong class="profile_nickname"> </strong><script>var nickname = " ";</script>',
    author: '快乐派大星',
  },
  {
    name: '首个作者元信息为空时继续读取 article:author',
    head: '<meta name="author" content=" "><meta property="article:author" content="元信息作者">',
    author: '元信息作者',
  },
  {
    name: '仅有可见署名时使用作者节点兜底',
    body: '<span id="js_author_name">可见作者</span>',
    author: '可见作者',
  },
  {
    name: '支持旧版头部无 ID 的作者署名',
    body: '<div id="meta_content"><span class="rich_media_meta rich_media_meta_text">旧版作者</span><em id="publish_time" class="rich_media_meta_text">2025-04-03</em></div>',
    author: '旧版作者',
  },
  {
    name: '仅有脚本作者时使用脚本作者兜底',
    body: '<script>var author = "脚本作者";</script>',
    author: '脚本作者',
  },
  {
    name: '两种名称均为空时保留空值',
    head: '<meta name="author" content=" ">',
    body: '<a id="js_name"> </a><span id="js_author_name"> </span><script>var nickname = " "; var author = " ";</script>',
    author: '',
  },
  {
    name: '名称缺失时不把正文示例或时间误认为账号作者',
    body: '<div id="meta_content"><em id="publish_time" class="rich_media_meta_text">2025-04-03</em></div><p>nickname = "正文中的示例"</p><script>var other_nickname = "其他昵称";</script>',
    author: '',
  },
]) {
  test(`公众号作者抓取：${fixture.name}`, () => {
    const html = `<!doctype html><html><head><meta property="og:title" content="作者字段测试"><meta name="publish_time" content="2025-04-03 10:20:30">${fixture.head || ''}</head><body>${fixture.body || ''}<div id="js_content"><p>正文内容用于验证账号名称优先，作者名称作为账号抓取失败时的兜底。</p></div></body></html>`
    assert.equal(parseWechatArticleHtml(html, sourceUrl).author, fixture.author)
  })
}

test('导入发布拒绝缺少作者的文章，并允许编辑时补充作者', () => {
  const publishable = [{
    id: 'article-without-author',
    title: '标题',
    author: '',
    bodyMarkdown: '正文',
    publishedAt: new Date().toISOString(),
  }]
  assert.throws(
    () => normalizeEditedItems([{
      id: 'article-without-author',
      title: '标题',
      bodyMarkdown: '正文',
      coverImage: null,
      publishedAt: new Date().toISOString(),
      author: '',
    }], publishable),
    (error) => error.code === 'ARTICLE_AUTHOR_EMPTY' && /作者不能为空/u.test(error.message),
  )
  const edited = normalizeEditedItems([{
    id: 'article-without-author',
    title: '标题',
    bodyMarkdown: '正文',
    coverImage: null,
    publishedAt: new Date().toISOString(),
    author: '补充作者',
  }], publishable)
  assert.equal(edited.get('article-without-author').author, '补充作者')
})

test('公众号没有有效发布时间时明确失败，不使用抓取时间冒充', () => {
  const html = '<!doctype html><html><head><meta property="og:title" content="无时间测试"></head><body><div id="js_content"><p>正文内容足够长，用于验证没有时间字段时才使用当前时间作为回退值。</p></div></body></html>'
  assert.throws(
    () => parseWechatArticleHtml(html, sourceUrl),
    (error) => error.code === 'ARTICLE_PUBLISHED_AT_MISSING' && /原始发布时间/u.test(error.message),
  )

  const invalidMetaHtml = '<!doctype html><html><head><meta property="og:title" content="无效时间测试"><meta name="publish_time" content="not-a-date"></head><body><div id="js_content"><p>正文内容足够长，用于验证无效时间字段不会回退为当前抓取时间。</p></div></body></html>'
  assert.throws(
    () => parseWechatArticleHtml(invalidMetaHtml, sourceUrl),
    (error) => error.code === 'ARTICLE_PUBLISHED_AT_MISSING',
  )
})

test('无效的优先时间字段不会遮蔽脚本中的有效原始发布时间', () => {
  const html = '<!doctype html><html><head><meta property="og:title" content="时间字段降级测试"><meta name="publish_time" content="not-a-date"></head><body><div id="js_content"><p>正文内容足够长，用于验证系统会继续读取脚本中的有效原始发布时间。</p></div><script>var ori_create_time = "1712110830";</script></body></html>'
  assert.equal(parseWechatArticleHtml(html, sourceUrl).publishedAt, new Date(1712110830 * 1000).toISOString())
})

test('批次重复头尾模板仅清理高频边界片段，正文重复和低频片段保留', () => {
  const items = [
    { id: 'a', bodyMarkdown: '【本号导读】\n\n核心正文甲有足够长度，确保清理后仍然是完整文章内容并且不会误删。这里继续补充背景、过程、限制和可执行建议，让剩余正文超过最小安全长度。\n\n第二段正文继续解释方法、边界和验证步骤，保证删除模板后仍保留两段核心内容。\n\n推荐阅读\n\n[更多文章](https://mp.weixin.qq.com/a)' , removedTailMarkdown: '', tailCleanup: { applied: false, categories: [], removedBlocks: 0 }, restoredBodyMarkdown: '原文甲' },
    { id: 'b', bodyMarkdown: '【本号导读】\n\n核心正文乙有足够长度，确保清理后仍然是完整文章内容并且不会误删。这里继续补充背景、过程、限制和可执行建议，让剩余正文超过最小安全长度。\n\n第二段正文继续解释方法、边界和验证步骤，保证删除模板后仍保留两段核心内容。\n\n推荐阅读\n\n[更多文章](https://mp.weixin.qq.com/b)' , removedTailMarkdown: '', tailCleanup: { applied: false, categories: [], removedBlocks: 0 }, restoredBodyMarkdown: '原文乙' },
    { id: 'c', bodyMarkdown: '【本号导读】\n\n核心正文丙有足够长度，确保只保留正文中的重复主题段落，不将低频模板片段当作推广内容。这里继续补充背景、过程、限制和可执行建议，让剩余正文超过最小安全长度。\n\n第二段正文继续解释方法、边界和验证步骤，保证删除模板后仍保留两段核心内容。\n\n仅此一文' , removedTailMarkdown: '', tailCleanup: { applied: false, categories: [], removedBlocks: 0 }, restoredBodyMarkdown: '原文丙' },
  ]
  const changed = applyBatchDuplicateBoundaryCleanup(items)
  assert.deepEqual(changed.sort(), ['a', 'b', 'c'])
  for (const item of items) {
    assert.doesNotMatch(item.bodyMarkdown, /本号导读/u)
    if (item.id !== 'c') assert.match(item.bodyMarkdown, /推荐阅读/u)
    assert.match(item.removedTailMarkdown, /本号导读/u)
    assert.equal(item.tailCleanup.applied, true)
    assert.match(item.tailCleanup.categories.join(','), /批次重复模板/u)
  }
  assert.match(items[2].bodyMarkdown, /核心正文丙|仅此一文/u)
})

test('批次移除的图片不随恢复正文带回', () => {
  const items = ['a', 'b', 'c'].map((id) => ({
    id,
    bodyMarkdown: `核心正文 ${id} 内容足够长，保证移除模板图片后仍有完整正文并通过安全长度校验。这里补充背景、方法、限制和结论，并说明读者可以如何复核这些判断。\n\n第二段正文继续提供上下文、分析过程和可核验依据，确保删除模板后仍是完整文章。这里再补充适用范围、失败情形和后续建议。\n\n![二维码](https://img.example.com/qr.png)`,
    restoredBodyMarkdown: `核心正文 ${id} 内容足够长，保证移除模板图片后仍有完整正文并通过安全长度校验。这里补充背景、方法、限制和结论，并说明读者可以如何复核这些判断。\n\n第二段正文继续提供上下文、分析过程和可核验依据，确保删除模板后仍是完整文章。这里再补充适用范围、失败情形和后续建议。\n\n![二维码](https://img.example.com/qr.png)`,
    bodyImageAssetIds: [],
    removedTailMarkdown: '',
    tailCleanup: { applied: false, categories: [], removedBlocks: 0 },
  }))
  const changed = applyBatchDuplicateBoundaryCleanup(items)
  assert.deepEqual(changed.sort(), ['a', 'b', 'c'])
  for (const item of items) {
    assert.doesNotMatch(item.bodyMarkdown, /qr\.png/u)
    assert.doesNotMatch(item.restoredBodyMarkdown, /qr\.png/u)
  }
})

test('20 篇批次中 3 篇重复推广模板触发，2 篇或正文重复不触发', () => {
  const makeItem = (id, sharedTail) => ({
    id,
    bodyMarkdown: `核心正文 ${id} 说明背景、方法、限制和结论，内容足够长以通过清理后的安全长度校验。这里继续补充可以复核的依据和执行步骤。\n\n第二段正文 ${id} 继续提供上下文、过程和边界，保证文章主题内容不会因为模板检测而丢失。\n\n${sharedTail ? '推荐阅读' : `正文结尾 ${id}`}`,
    restoredBodyMarkdown: '',
    removedTailMarkdown: '',
    tailCleanup: { applied: false, categories: [], removedBlocks: 0 },
  })
  const three = Array.from({ length: 20 }, (_value, index) => makeItem(`three-${index}`, index < 3))
  assert.equal(applyBatchDuplicateBoundaryCleanup(three).length, 3)
  assert.equal(three.slice(0, 3).every((item) => item.tailCleanup.applied), true)
  assert.equal(three.slice(3).every((item) => !item.tailCleanup.applied), true)

  const two = Array.from({ length: 20 }, (_value, index) => makeItem(`two-${index}`, index < 2))
  assert.equal(applyBatchDuplicateBoundaryCleanup(two).length, 0)
  assert.equal(two.slice(0, 2).every((item) => !item.tailCleanup.applied), true)
})

test('article import cleanup runs on startup and an unref hourly timer', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/content/article-import.service.js'), 'utf8')
  assert.match(source, /setImmediate\(\(\) => \{ void purgeExpiredImportJobs\(\)/)
  assert.match(source, /setInterval\(\(\) => \{ void purgeExpiredImportJobs\(\)[\s\S]*importJobCleanupIntervalMs\)/)
  assert.match(source, /timer\.unref\?\.\(\)/)
  assert.match(source, /startArticleImportJobCleanup\(\)/)
})

test('文章抓取封面的 COS 派生图目标键使用绝对路径并经过 URI 编码', async () => {
  const uploaded = []
  await uploadPreparedImage({
    buffer: jpeg,
    contentType: 'image/jpeg',
    extension: 'jpg',
    hash: 'test-cover-hash',
    key: 'secretbox-test/articles/文章 封面?#.jpg',
    size: jpeg.length,
    width: 1280,
    height: 545,
  }, {
    uploadBuffer: async (item) => uploaded.push(item),
  }, { cover: true })

  assert.deepEqual(
    uploaded[0].operations.rules.map((rule) => rule.fileid),
    [
      '%2Fsecretbox-test%2Farticles%2F%E6%96%87%E7%AB%A0%20%E5%B0%81%E9%9D%A2%3F%23.jpg.display-v1.medium.jpg',
      '%2Fsecretbox-test%2Farticles%2F%E6%96%87%E7%AB%A0%20%E5%B0%81%E9%9D%A2%3F%23.jpg.display-v1.thumb.jpg',
    ],
  )
  assert.equal(uploaded[0].operations.rules.every((rule) => rule.fileid.startsWith('%2F')), true)
  assert.deepEqual(
    uploaded[0].operations.rules.map((rule) => rule.rule),
    [
      'imageMogr2/thumbnail/1280x1280>/format/jpg/quality/82',
      'imageMogr2/thumbnail/480x480>/format/jpg/quality/72',
    ],
  )
})

test('文章静态图等待 COS 派生图可读，长图保留原图且不等待', async () => {
  const readyKeys = []
  const staticImage = await uploadPreparedImage({
    buffer: jpeg,
    contentType: 'image/jpeg',
    extension: 'jpg',
    hash: 'test-static-hash',
    key: 'secretbox-test/articles/static.jpg',
    size: jpeg.length,
    width: 1280,
    height: 720,
  }, {
    uploadBuffer: async () => {},
    waitForCosObjectsReady: async (keys) => readyKeys.push(...keys),
  })
  assert.deepEqual(readyKeys, [
    'secretbox-test/articles/static.jpg.display-v1.medium.jpg',
    'secretbox-test/articles/static.jpg.display-v1.thumb.jpg',
  ])
  assert.match(staticImage.mediumUrl, /static\.jpg\.display-v1\.medium\.jpg$/)
  assert.match(staticImage.thumbUrl, /static\.jpg\.display-v1\.thumb\.jpg$/)

  const longImage = await uploadPreparedImage({
    ...staticImage,
    key: 'secretbox-test/articles/long.jpg',
    width: 600,
    height: 2000,
  }, {
    uploadBuffer: async () => {},
    waitForCosObjectsReady: async () => assert.fail('长图不应等待 JPG 派生图'),
  })
  assert.equal(longImage.mediumUrl, undefined)
  assert.equal(longImage.thumbUrl, undefined)
  assert.equal(longImage.processingProfile, 'original-only')
})

test('复用素材时，正文动图和长图仍使用原图，封面保留展示版本', () => {
  const existing = {
    status: 'ready',
    originalUrl: 'https://media.example.com/imported/original.gif',
    mediumUrl: 'https://media.example.com/imported/medium.jpg',
    thumbUrl: 'https://media.example.com/imported/thumb.jpg',
    processingProfile: 'display-v1',
  }
  const prepared = { animated: true, contentType: 'image/gif', width: 640, height: 360 }
  const body = toTransferredExistingImage(prepared, existing)
  assert.equal(body.mediumUrl, existing.originalUrl)
  assert.equal(body.thumbUrl, existing.originalUrl)
  const cover = toTransferredExistingImage(prepared, existing, { cover: true })
  assert.equal(cover.mediumUrl, existing.mediumUrl)
  assert.equal(cover.thumbUrl, existing.thumbUrl)
  const cropped = { ...existing, processingProfile: 'share-background-v2' }
  assert.equal(toTransferredExistingImage(prepared, cropped, { cover: true }), null)
  assert.equal(toTransferredExistingImage({ width: 800, height: 600 }, cropped), null)
  assert.equal(toTransferredExistingImage(prepared, cropped).mediumUrl, cropped.originalUrl)
})

test('WeChat parser normalizes blocks and Markdown rendering strips executable markup', () => {
  const article = parseWechatArticleHtml(articleHtml, sourceUrl)
  assert.equal(article.title, '一篇测试文章')
  assert.match(article.normalizedHtml, /https:\/\/mmbiz\.qpic\.cn/)
  const converted = convertWechatArticleHtmlToMarkdown(article.normalizedHtml, sourceUrl)
  const rendered = renderArticleMarkdown(converted.bodyMarkdown)
  assert.match(converted.bodyMarkdown, /第一段/)
  assert.doesNotMatch(rendered, /data-src|onclick|onerror|script|iframe/)
  assert.match(rendered, /style="width:100%;max-width:100%;height:auto;display:block;object-fit:contain"/)
  assert.throws(
    () => parseWechatArticleHtml('<html><body>访问频繁</body></html>', sourceUrl),
    (error) => error.code === 'ARTICLE_BODY_MISSING' && /反爬占位页/.test(error.message),
  )
})

for (const fixture of tailCases) {
  test(`tail cleaner: ${fixture.name}`, () => {
    const result = convertWechatArticleHtmlToMarkdown(fixture.html, sourceUrl)
    assert.equal(result.tailCleanup.applied, fixture.shouldClean)
    if (fixture.keptText) assert.match(result.bodyMarkdown, new RegExp(fixture.keptText))
    if (fixture.removedText) assert.match(result.removedTailMarkdown, new RegExp(fixture.removedText))
    for (const text of fixture.keptTexts || []) assert.match(result.bodyMarkdown, new RegExp(text))
    for (const text of fixture.removedTexts || []) assert.match(result.removedTailMarkdown, new RegExp(text))
    if (!fixture.shouldClean) assert.equal(result.removedTailMarkdown, '')
  })
}

test('article import creates a preview job, publishes once, and detects a duplicate URL', async () => {
  const fetchResource = createFetchResource()
  const uploaded = []
  const uploadBuffer = async (item) => uploaded.push(item)
  const first = createArticleImportJob({ poolId: 'pool-import', urls: [sourceUrl] }, { fetchResource, uploadBuffer })
  assert.equal(first.status, 'queued')
  assert.deepEqual(first.progress, { total: 1, processed: 0, succeeded: 0, failed: 0 })
  await assert.rejects(publishArticleImportJob(first.id), /当前不可发布/)
  const firstReady = await waitForJob(first.id, (job) => job.status === 'ready')
  assert.equal(firstReady.status, 'ready')
  assert.equal(firstReady.progress.processed, 1)
  assert.equal(firstReady.entries[0].status, 'ready')
  assert.equal(firstReady.items.length, 1)
  assert.equal(firstReady.items[0].author, '测试公众号')
  assert.equal(firstReady.items[0].duplicate, false)
  assert.equal(firstReady.items[0].coverImage.id.startsWith('article-'), true)
  assert.match(firstReady.items[0].coverImage.thumbUrl, /^https:\/\/media\.example\.com\//)
  assert.match(firstReady.items[0].coverImage.mediumUrl, /^https:\/\/media\.example\.com\//)
  assert.match(firstReady.items[0].bodyMarkdown, /https:\/\/media\.example\.com/)
  assert.match(firstReady.items[0].renderedHtml, /第一段/)
  const storedJob = getDatabase().prepare('SELECT item_json FROM article_import_jobs WHERE job_id = ?').get(first.id)
  assert.equal(JSON.parse(storedJob.item_json).items[0].author, '测试公众号')
  assert.doesNotMatch(storedJob.item_json, /bodyHtml|previewHtml|renderedHtml/)
  assert.equal(uploaded.length, 0, '已存在相同原图时复用素材，不重复上传 COS')

  const published = await publishArticleImportJob(first.id, [], [], { deleteObject: async () => {} })
  assert.equal(published.importedCount, 1)
  assert.equal(getContentItem('pool-import', 'articles', firstReady.items[0].id).label, '默认')
  const storedArticle = getDatabase().prepare("SELECT item_json FROM content_items WHERE pool_id = ? AND content_type = 'articles' AND item_id = ?")
    .get('pool-import', firstReady.items[0].id)
  assert.equal(JSON.parse(storedArticle.item_json).label, '默认')
  assert.equal(JSON.parse(storedArticle.item_json).author, '测试公众号')
  assert.equal(getContentItem('pool-import', 'articles', firstReady.items[0].id).author, '测试公众号')
  assert.equal(getDatabase().prepare('SELECT 1 FROM article_import_jobs WHERE job_id = ?').get(first.id), undefined)

  const second = createArticleImportJob({ poolId: 'pool-import', urls: [sourceUrl] }, { fetchResource, uploadBuffer })
  const secondReady = await waitForJob(second.id, (job) => job.status === 'ready')
  assert.equal(secondReady.items[0].duplicate, true)
  await assert.rejects(publishArticleImportJob(second.id, ['article-not-in-this-job']), /不存在于当前导入任务/)
  await assert.rejects(publishArticleImportJob(second.id, [secondReady.items[0].id]), /重复内容/)
  await assert.rejects(publishArticleImportJob(second.id), /没有可发布的新文章/)
})

test('article import route returns 202 before fetching completes and persists per-item progress', async () => {
  const secondUrl = 'https://mp.weixin.qq.com/s/test-article-failure'
  const failedUrls = new Set([secondUrl])
  let releaseFetch
  const gate = new Promise((resolve) => { releaseFetch = resolve })
  let signalPageFetch
  const pageFetchStarted = new Promise((resolve) => { signalPageFetch = resolve })
  const fetchResource = createFetchResource({
    failedUrls,
    gate,
    onPageFetch: signalPageFetch,
  })
  const uploadBuffer = async () => {}
  const server = http.createServer(withCors(createAppRouter({
    articleImportDependencies: { fetchResource, uploadBuffer },
  }).handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const request = async (pathname, { body, cookie = '', method = 'GET' } = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { data: await response.json(), headers: response.headers, status: response.status }
  }
  try {
    const login = await request('/api/admin/login', { method: 'POST', body: { account: 'admin', password: '123456' } })
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
    const markdownPreview = await request('/api/admin/articles/preview', {
      method: 'POST',
      cookie,
      body: { bodyMarkdown: '# 标题\n\n**正文**' },
    })
    assert.equal(markdownPreview.status, 200)
    assert.match(markdownPreview.data.renderedHtml, /<h1>标题<\/h1>/)
    const importRequest = request('/api/admin/articles/import', {
      method: 'POST',
      cookie,
      body: { poolId: 'pool-import', urls: ['https://mp.weixin.qq.com/s/test-article-route', secondUrl] },
    })
    const raced = await Promise.race([
      importRequest.then((response) => ({ response })),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 300)),
    ])
    assert.equal(raced.timeout, undefined, '导入接口不应等待后台抓取完成')
    assert.equal(raced.response.status, 202)
    assert.equal(raced.response.data.status, 'queued')
    assert.deepEqual(raced.response.data.progress, { total: 2, processed: 0, succeeded: 0, failed: 0 })

    await pageFetchStarted
    const processing = await request(`/api/admin/articles/import/${raced.response.data.id}`, { cookie })
    assert.equal(processing.status, 200)
    assert.equal(processing.data.status, 'processing')
    assert.equal(processing.data.entries[0].status, 'processing')
    assert.equal(processing.data.progress.processed, 0)

    releaseFetch()
    const ready = await waitForJob(raced.response.data.id, (job) => job.status === 'ready')
    assert.deepEqual(ready.progress, { total: 2, processed: 2, succeeded: 1, failed: 1 })
    assert.equal(ready.entries[0].status, 'ready')
    assert.equal(ready.entries[1].status, 'failed')
    assert.equal(ready.errors[0].code, 'TEST_FETCH_FAILED')

    failedUrls.delete(secondUrl)
    const retry = await request(`/api/admin/articles/import/${raced.response.data.id}/retry`, {
      method: 'POST',
      cookie,
      body: { url: secondUrl },
    })
    assert.equal(retry.status, 202)
    assert.equal(retry.data.entries[1].status, 'queued')
    assert.deepEqual(retry.data.progress, { total: 2, processed: 1, succeeded: 1, failed: 0 })
    const retried = await waitForJob(raced.response.data.id, (job) => job.status === 'ready' && job.progress.succeeded === 2)
    assert.deepEqual(retried.progress, { total: 2, processed: 2, succeeded: 2, failed: 0 })
    assert.equal(retried.entries[0].status, 'ready')
    assert.equal(retried.entries[1].status, 'ready')
    assert.equal(retried.errors.length, 0)
  } finally {
    releaseFetch()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('single failed entry retries in place without replacing successful items or allowing concurrent retries', async () => {
  const goodUrl = 'https://mp.weixin.qq.com/s/retry-keeps-success'
  const failedUrl = 'https://mp.weixin.qq.com/s/retry-one-failure'
  let shouldFail = true
  let retryStarted
  let signalRetryStarted
  let releaseRetry
  const retryGate = new Promise((resolve) => { releaseRetry = resolve })
  retryStarted = new Promise((resolve) => { signalRetryStarted = resolve })
  const fetchResource = async (url, { kind }) => {
    if (kind === 'image') return { body: jpeg, contentType: 'image/jpeg', finalUrl: imageUrl, headers: {}, status: 200 }
    if (url === failedUrl && shouldFail) throw new ArticleImportError('TEST_FETCH_FAILED', '测试抓取失败')
    if (url === failedUrl) {
      signalRetryStarted()
      await retryGate
    }
    const html = articleHtml.replace('一篇测试文章', url === goodUrl ? '已成功文章' : '重试成功文章')
    return { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
  }
  const job = createArticleImportJob({ poolId: 'pool-import', urls: [goodUrl, failedUrl] }, {
    fetchResource,
    uploadBuffer: async () => {},
  })
  const initial = await waitForJob(job.id, (candidate) => candidate.status === 'ready')
  const preservedId = initial.entries[0].itemId
  assert.deepEqual(initial.progress, { total: 2, processed: 2, succeeded: 1, failed: 1 })

  shouldFail = false
  const queued = retryArticleImportEntry(job.id, failedUrl, { fetchResource, uploadBuffer: async () => {} })
  assert.equal(queued.status, 'queued')
  assert.equal(queued.entries[1].status, 'queued')
  assert.deepEqual(queued.progress, { total: 2, processed: 1, succeeded: 1, failed: 0 })
  assert.throws(
    () => retryArticleImportEntry(job.id, failedUrl, { fetchResource, uploadBuffer: async () => {} }),
    (error) => error.code === 'JOB_BUSY',
  )

  await retryStarted
  const processing = getArticleImportJob(job.id)
  assert.equal(processing.status, 'processing')
  assert.equal(processing.entries[0].itemId, preservedId)
  assert.equal(processing.entries[1].status, 'processing')
  releaseRetry()
  const completed = await waitForJob(job.id, (candidate) => candidate.status === 'ready' && candidate.progress.succeeded === 2)
  assert.deepEqual(completed.progress, { total: 2, processed: 2, succeeded: 2, failed: 0 })
  assert.equal(completed.entries[0].itemId, preservedId)
  assert.equal(completed.items.some((item) => item.id === preservedId), true)
  assert.equal(completed.errors.length, 0)
})

test('retry re-evaluates three-item batch boundary cleanup across existing successful articles', async () => {
  const urls = [1, 2, 3].map((index) => `https://mp.weixin.qq.com/s/retry-batch-cleanup-${index}`)
  let thirdFails = true
  const fetchResource = async (url, { kind }) => {
    assert.equal(kind, 'page')
    if (url === urls[2] && thirdFails) throw new ArticleImportError('TEST_FETCH_FAILED', '测试抓取失败')
    const html = `<!doctype html><html><head><meta property="og:title" content="批次清理测试">${publishedMeta}</head><body><div id="js_content"><p>【本号导读】</p><p>核心正文第一段完整说明文章背景、信息来源、判断依据和适用边界，确保移除固定导读后仍然保留足够长且可独立阅读的正文内容。</p><p>核心正文第二段继续说明实施过程、现实限制和核验方法，避免读者把个别经验误解为普遍结论。</p></div></body></html>`
    return { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
  }
  const job = createArticleImportJob({ poolId: 'pool-import', urls }, { fetchResource, uploadBuffer: async () => {} })
  const initial = await waitForJob(job.id, (candidate) => candidate.status === 'ready')
  assert.equal(initial.items.length, 2)
  initial.items.forEach((item) => assert.match(item.bodyMarkdown, /本号导读/u))

  thirdFails = false
  retryArticleImportEntry(job.id, urls[2], { fetchResource, uploadBuffer: async () => {} })
  const completed = await waitForJob(job.id, (candidate) => candidate.status === 'ready' && candidate.items.length === 3)
  completed.items.forEach((item) => {
    assert.doesNotMatch(item.bodyMarkdown, /本号导读/u)
    assert.equal(item.tailCleanup.categories.includes('批次重复模板'), true)
  })
})

test('failed and interrupted jobs remain unpublishable with an explicit retry message', async () => {
  const failedUrl = 'https://mp.weixin.qq.com/s/test-all-failed'
  const failed = createArticleImportJob(
    { poolId: 'pool-import', urls: [failedUrl] },
    { fetchResource: createFetchResource({ failedUrls: new Set([failedUrl]) }), uploadBuffer: async () => {} },
  )
  const finished = await waitForJob(failed.id, (job) => job.status === 'failed')
  assert.deepEqual(finished.progress, { total: 1, processed: 1, succeeded: 0, failed: 1 })
  await assert.rejects(publishArticleImportJob(failed.id), /当前不可发布/)

  const now = new Date().toISOString()
  const interrupted = {
    id: 'article-import-interrupted-test',
    poolId: 'pool-import',
    status: 'processing',
    createdAt: now,
    updatedAt: now,
    urls: [sourceUrl],
    progress: { total: 1, processed: 0, succeeded: 0, failed: 0 },
    entries: [{ url: sourceUrl, status: 'processing' }],
    items: [],
    errors: [],
  }
  getDatabase().prepare(`
    INSERT INTO article_import_jobs (job_id, pool_id, status, created_at, updated_at, item_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(interrupted.id, interrupted.poolId, interrupted.status, now, now, JSON.stringify(interrupted))
  const recovered = getArticleImportJob(interrupted.id)
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.fatalError.code, 'IMPORT_INTERRUPTED')
  assert.match(recovered.fatalError.message, /重新创建任务后重试/)
  await assert.rejects(publishArticleImportJob(interrupted.id), /当前不可发布/)
})

test('article media failures degrade per image without failing the article', async () => {
  const goodCover = 'https://mmbiz.qpic.cn/mmbiz_jpg/good-cover/0?wx_fmt=jpeg'
  const badBody = 'https://mmbiz.qpic.cn/mmbiz_jpg/bad-body/0?wx_fmt=jpeg'
  const badCover = 'https://mmbiz.qpic.cn/mmbiz_jpg/bad-cover/0?wx_fmt=jpeg'
  const page = (cover, body = '') => `<!doctype html><html><head><meta property="og:title" content="图片降级测试"><meta property="og:image" content="${cover}">${publishedMeta}</head><body><div id="js_content"><p>第一段正文用于验证图片失败不会让整篇文章导入失败。</p><p>第二段正文继续提供足够内容，确保阅读模式仍然可以正常保存。</p>${body}</div></body></html>`
  const fetchFor = (html, failedImages) => async (url, { kind }) => {
    if (kind === 'page') return { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
    if (failedImages.has(url)) throw new ArticleImportError('TEST_IMAGE_FAILED', '测试图片失败')
    return { body: jpeg, contentType: 'image/jpeg', finalUrl: url, headers: {}, status: 200 }
  }

  const bodyFailure = await importOneArticle(
    'https://mp.weixin.qq.com/s/body-image-failure',
    { fetchResource: fetchFor(page(goodCover, `<img data-src="${badBody}">`), new Set([badBody])), uploadBuffer: async () => {} },
  )
  assert.doesNotMatch(bodyFailure.bodyMarkdown, /bad-body/)
  assert.equal(bodyFailure.mediaWarnings.some((warning) => warning.type === 'body-image'), true)
  assert.ok(bodyFailure.coverImage)

  const coverFailure = await importOneArticle(
    'https://mp.weixin.qq.com/s/cover-image-failure',
    { fetchResource: fetchFor(page(badCover), new Set([badCover])), uploadBuffer: async () => {} },
  )
  assert.equal(coverFailure.coverImage, null)
  assert.equal(coverFailure.mediaWarnings.some((warning) => warning.type === 'cover-image'), true)
})

test('images found only in a removed tail are not uploaded and restoration remains text-only', async () => {
  const coverUrl = 'https://mmbiz.qpic.cn/mmbiz_jpg/tail-cover/0?wx_fmt=jpeg'
  const tailImageUrl = 'https://mmbiz.qpic.cn/mmbiz_jpg/tail-qr/0?wx_fmt=jpeg'
  const html = `<!doctype html><html><head><meta property="og:title" content="尾部图片测试"><meta property="og:image" content="${coverUrl}">${publishedMeta}</head><body><div id="js_content"><p>正文第一段完整介绍事情的背景和判断依据，让清理后仍然保留足够的主要内容。</p><p>正文第二段继续说明实施过程和限制条件，避免把单一经验误解成普遍结论。</p><p>正文最后一段收束全文并给出可执行的建议，核心内容到这里已经完整结束。</p><p>长按下方二维码识别并关注公众号</p><p><img data-src="${tailImageUrl}"></p></div></body></html>`
  const fetchedImages = []
  const uploadedKeys = []
  const item = await importOneArticle('https://mp.weixin.qq.com/s/removed-tail-image', {
    fetchResource: async (url, { kind }) => {
      if (kind === 'page') return { body: Buffer.from(html), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
      fetchedImages.push(url)
      return { body: jpeg, contentType: 'image/jpeg', finalUrl: url, headers: {}, status: 200 }
    },
    uploadBuffer: async ({ key }) => uploadedKeys.push(key),
  })
  assert.deepEqual(fetchedImages, [coverUrl])
  assert.equal(uploadedKeys.length <= 1, true, '封面可复用已有素材，尾部图片仍不会上传')
  assert.doesNotMatch(item.removedTailMarkdown, /!\[/)
  assert.equal(item.mediaWarnings.some((warning) => warning.type === 'removed-tail-image'), true)
})

test('restoring removed text preserves its original order around protected blocks', async () => {
  const url = 'https://mp.weixin.qq.com/s/restore-interleaved-tail'
  const html = `<!doctype html><html><head><meta property="og:title" content="交错尾部恢复测试">${publishedMeta}</head><body><div id="js_content"><p>正文第一段完整交代文章背景、资料范围和判断前提，确保自动清理后核心内容仍可独立阅读。</p><p>正文第二段继续解释关键差异和适用边界，避免读者把个别经验误解成普遍结论。</p><p>正文最后一段完成观点收束，并列出下一步可以核验的公开材料和具体方法。</p><p>喜欢这篇文章请点赞、在看和转发。</p><p>免责声明：以上内容仅供参考，不构成投资建议。</p><p>投稿邮箱：hello@example.com，商务合作请添加微信。</p></div></body></html>`
  const item = await importOneArticle(url, {
    fetchResource: async (source, { kind }) => {
      assert.equal(kind, 'page')
      return { body: Buffer.from(html), contentType: 'text/html', finalUrl: source, headers: {}, status: 200 }
    },
    uploadBuffer: async () => {},
  })
  assert.doesNotMatch(item.bodyMarkdown, /点赞、在看和转发|投稿邮箱/)
  assert.match(item.bodyMarkdown, /免责声明/)
  const restoredOrder = ['点赞、在看和转发', '免责声明', '投稿邮箱'].map((text) => item.restoredBodyMarkdown.indexOf(text))
  assert.ok(restoredOrder.every((index) => index >= 0))
  assert.deepEqual([...restoredOrder].sort((a, b) => a - b), restoredOrder)

  const now = new Date().toISOString()
  const job = {
    id: 'article-import-interleaved-restore-test',
    poolId: 'pool-import',
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    urls: [url],
    progress: { total: 1, processed: 1, succeeded: 1, failed: 0 },
    entries: [{ url, status: 'ready', itemId: item.id }],
    items: [item],
    errors: [],
  }
  getDatabase().prepare(`
    INSERT INTO article_import_jobs (job_id, pool_id, status, created_at, updated_at, item_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(job.id, job.poolId, job.status, now, now, JSON.stringify(job))
  await publishArticleImportJob(job.id, [item.id], [item.id], { deleteObject: async () => {} })
  const saved = getContentItem('pool-import', 'articles', item.id)
  const savedOrder = ['点赞、在看和转发', '免责声明', '投稿邮箱'].map((text) => saved.bodyMarkdown.indexOf(text))
  assert.deepEqual([...savedOrder].sort((a, b) => a - b), savedOrder)
})

test('expired import jobs are purged while recent jobs remain available', async () => {
  const now = Date.now()
  const insert = getDatabase().prepare(`
    INSERT INTO article_import_jobs (job_id, pool_id, status, created_at, updated_at, item_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const expiredAt = new Date(now - 25 * 60 * 60 * 1000).toISOString()
  const recentAt = new Date(now - 23 * 60 * 60 * 1000).toISOString()
  insert.run('article-import-expired-test', 'pool-import', 'failed', expiredAt, expiredAt, '{}')
  insert.run('article-import-recent-test', 'pool-import', 'failed', recentAt, recentAt, '{}')
  assert.equal(await purgeExpiredImportJobs(now, { deleteObject: async () => {} }), 1)
  assert.equal(getDatabase().prepare('SELECT 1 FROM article_import_jobs WHERE job_id = ?').get('article-import-expired-test'), undefined)
  assert.ok(getDatabase().prepare('SELECT 1 FROM article_import_jobs WHERE job_id = ?').get('article-import-recent-test'))
})

test('publishing reclaims unselected imported images and retains selected or shared images', async () => {
  const urls = [
    'https://mp.weixin.qq.com/s/import-lifecycle-selected',
    'https://mp.weixin.qq.com/s/import-lifecycle-unselected',
  ]
  const imageByPage = new Map(urls.map((url, index) => [url, `https://mmbiz.qpic.cn/mmbiz_jpg/lifecycle-${index}/0?wx_fmt=jpeg`]))
  const pageFor = (url) => `<!doctype html><html><head><meta property="og:title" content="生命周期 ${url.slice(-8)}">${publishedMeta}</head><body><div id="js_content"><p>正文第一段完整说明文章背景、信息来源和判断依据，确保内容可以独立阅读。</p><p>正文第二段补充实施过程、现实限制和结果差异，避免把个例写成普遍结论。</p><img data-src="${imageByPage.get(url)}"></div></body></html>`
  const fetchResource = async (url, { kind }) => {
    if (kind === 'page') return { body: Buffer.from(pageFor(url)), contentType: 'text/html', finalUrl: url, headers: {}, status: 200 }
    const index = [...imageByPage.values()].indexOf(url)
    return { body: Buffer.concat([jpeg, Buffer.from([index + 1])]), contentType: 'image/jpeg', finalUrl: url, headers: {}, status: 200 }
  }
  const job = createArticleImportJob({ poolId: 'pool-import', urls }, { fetchResource, uploadBuffer: async () => {} })
  const ready = await waitForJob(job.id, (candidate) => candidate.status === 'ready')
  const selected = ready.items[0]
  const unselected = ready.items[1]
  const selectedAssetId = selected.bodyImageAssetIds[0]
  const unselectedAssetId = unselected.bodyImageAssetIds[0]
  assert.notEqual(selectedAssetId, unselectedAssetId)
  const deletedKeys = []
  await publishArticleImportJob(job.id, [selected.id], [], { deleteObject: async (key) => deletedKeys.push(key) })
  assert.ok(getImageById(selectedAssetId))
  assert.equal(getImageById(unselectedAssetId), null)
  assert.ok(deletedKeys.length >= 1)
})

test('expiring an unpublished job reclaims its imported COS images', async () => {
  const url = 'https://mp.weixin.qq.com/s/import-lifecycle-expired'
  const imageUrlForJob = 'https://mmbiz.qpic.cn/mmbiz_jpg/lifecycle-expired/0?wx_fmt=jpeg'
  const html = `<!doctype html><html><head><meta property="og:title" content="过期任务图片">${publishedMeta}</head><body><div id="js_content"><p>正文第一段完整说明文章背景和资料范围，确保导入任务具备可发布的核心内容。</p><p>正文第二段继续解释判断过程和适用边界，避免把单一经验写成普遍结论。</p><img data-src="${imageUrlForJob}"></div></body></html>`
  const job = createArticleImportJob({ poolId: 'pool-import', urls: [url] }, {
    fetchResource: async (source, { kind }) => kind === 'page'
      ? { body: Buffer.from(html), contentType: 'text/html', finalUrl: source, headers: {}, status: 200 }
      : { body: Buffer.concat([jpeg, Buffer.from([99])]), contentType: 'image/jpeg', finalUrl: source, headers: {}, status: 200 },
    uploadBuffer: async () => {},
  })
  const ready = await waitForJob(job.id, (candidate) => candidate.status === 'ready')
  const assetId = ready.items[0].bodyImageAssetIds[0]
  const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  getDatabase().prepare('UPDATE article_import_jobs SET updated_at = ? WHERE job_id = ?').run(expiredAt, job.id)
  const deletedKeys = []
  assert.equal(await purgeExpiredImportJobs(Date.now(), { deleteObject: async (key) => deletedKeys.push(key) }), 1)
  assert.equal(getImageById(assetId), null)
  assert.ok(deletedKeys.length >= 1)
})

test('publishing can restore an inspected tail while persisting only canonical Markdown', async () => {
  const now = new Date().toISOString()
  const job = {
    id: 'article-import-restore-tail-test',
    poolId: 'pool-import',
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    urls: ['https://mp.weixin.qq.com/s/restore-tail-test'],
    progress: { total: 1, processed: 1, succeeded: 1, failed: 0 },
    entries: [{ url: 'https://mp.weixin.qq.com/s/restore-tail-test', status: 'ready', itemId: 'article-restore-tail-test' }],
    items: [{
      id: 'article-restore-tail-test',
      title: '恢复尾部测试',
      bodyMarkdown: '核心正文第一段。\n\n核心正文第二段。',
      bodyImageAssetIds: [],
      removedTailMarkdown: '## 推荐阅读\n\n另一篇文章',
      restoredBodyMarkdown: '核心正文第一段。\n\n核心正文第二段。\n\n## 推荐阅读\n\n另一篇文章',
      tailCleanup: { applied: true, categories: ['尾部栏目'], removedBlocks: 2 },
      publishedAt: now,
      author: '测试作者',
      coverImage: null,
      sourceUrl: 'https://mp.weixin.qq.com/s/restore-tail-test',
      sourceHash: 'b'.repeat(64),
      likeCount: 0,
      favoriteCount: 0,
    }],
    errors: [],
  }
  getDatabase().prepare(`
    INSERT INTO article_import_jobs (job_id, pool_id, status, created_at, updated_at, item_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(job.id, job.poolId, job.status, now, now, JSON.stringify(job))

  const published = await publishArticleImportJob(job.id, ['article-restore-tail-test'], ['article-restore-tail-test'], { deleteObject: async () => {} })
  assert.equal(published.importedCount, 1)
  assert.equal(getDatabase().prepare('SELECT 1 FROM article_import_jobs WHERE job_id = ?').get(job.id), undefined)
  const saved = getContentItem('pool-import', 'articles', 'article-restore-tail-test')
  assert.match(saved.bodyMarkdown, /推荐阅读/)
  assert.equal(Object.hasOwn(saved, 'removedTailMarkdown'), false)
  assert.equal(Object.hasOwn(saved, 'restoredBodyMarkdown'), false)
  assert.equal(Object.hasOwn(saved, 'tailCleanup'), false)
  assert.equal(Object.hasOwn(saved, 'bodyHtml'), false)
  assert.equal(Object.hasOwn(saved, 'previewHtml'), false)
})

test('发布保存编辑后的作者、标题、Markdown、封面和发布时间，并拒绝越权字段或条目', async () => {
  const now = new Date().toISOString()
  const createReadyJob = (id) => {
    const job = {
      id,
      poolId: 'pool-import',
      status: 'ready',
      createdAt: now,
      updatedAt: now,
      urls: [`https://mp.weixin.qq.com/s/${id}`],
      progress: { total: 1, processed: 1, succeeded: 1, failed: 0 },
      entries: [{ url: `https://mp.weixin.qq.com/s/${id}`, status: 'ready', itemId: `${id}-item` }],
      items: [{
        id: `${id}-item`, title: '原始标题', bodyMarkdown: '原始正文', bodyImageAssetIds: [],
        removedTailMarkdown: '', restoredBodyMarkdown: '原始正文', publishedAt: now, author: '原始作者', coverImage: null,
        sourceUrl: `https://mp.weixin.qq.com/s/${id}`, sourceHash: 'c'.repeat(64), likeCount: 0, favoriteCount: 0,
      }],
      errors: [],
    }
    getDatabase().prepare(`
      INSERT INTO article_import_jobs (job_id, pool_id, status, created_at, updated_at, item_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(job.id, job.poolId, job.status, now, now, JSON.stringify(job))
    return job
  }

  const job = createReadyJob('article-import-edited-fields')
  addImageAsset({
    id: 'article-import-edited-cover',
    label: '编辑后封面',
    mediumUrl: 'https://media.example.com/edited-cover-medium.jpg',
    thumbUrl: 'https://media.example.com/edited-cover-thumb.jpg',
    status: 'ready',
    uploadedAt: now,
  })
  const editedPublishedAt = '2026-08-28T03:20:00.000Z'
  const published = await publishArticleImportJob(
    job.id,
    ['article-import-edited-fields-item'],
    [],
    { deleteObject: async () => {} },
    [{
      id: 'article-import-edited-fields-item',
      title: '编辑后标题',
      bodyMarkdown: '# 编辑后正文',
      author: '编辑作者',
      coverImage: { id: 'article-import-edited-cover' },
      publishedAt: editedPublishedAt,
    }],
  )
  assert.equal(published.importedCount, 1)
  const saved = getContentItem('pool-import', 'articles', 'article-import-edited-fields-item')
  assert.equal(saved.title, '编辑后标题')
  assert.equal(saved.author, '编辑作者')
  assert.equal(saved.bodyMarkdown, '# 编辑后正文')
  assert.equal(saved.coverImage.id, 'article-import-edited-cover')
  assert.equal(saved.publishedAt, editedPublishedAt)

  const item = { id: 'item-1', title: '标题', author: '测试作者', bodyMarkdown: '正文' }
  const validEdited = { ...item, coverImage: null, publishedAt: now }
  assert.throws(() => normalizeEditedItems([{ ...validEdited, extra: true }], [item]), /仅允许包含/)
  assert.throws(() => normalizeEditedItems([{ ...validEdited, id: 'not-selected' }], [item]), /不在本次发布范围/)
  assert.throws(() => normalizeEditedItems([{ ...validEdited, coverImage: { id: '', url: 'bad' } }], [item]), /封面格式无效/)
  assert.throws(() => normalizeEditedItems([{ ...validEdited, publishedAt: 'not-a-date' }], [item]), /发布时间无效/)
  assert.throws(() => normalizeEditedItems([{ ...validEdited, publishedAt: null }], [item]), /发布时间无效/)
})
