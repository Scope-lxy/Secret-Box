const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'article-document-test-'))
process.env.MINIAPP_DATA_DIR = dataDir
const { getDatabase, closeDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'document-mp',
  miniPrograms: [{ id: 'document-mp', name: '文档测试', status: 'active', appId: 'wx1234567890000000', config: { contentPoolId: 'documents' } }],
  contentPools: [{ id: 'documents', name: '文档测试池' }, { id: 'other', name: '另一个池' }],
  storage: { bucket: 'test-1250000000', region: 'ap-chengdu', url: 'https://media.example.com', folderPrefix: 'document-test' },
})
const docs = require('../src/modules/content/article-document.service')
const parser = require('../src/modules/content/article-document-parser')
const { renderArticleMarkdown } = require('../src/modules/content/article-markdown')
const { sanitizeArticleHtml } = require('../../../miniprogram/utils/article-content')
const { appendContentItems, getContentItem, updateContentItem, updateArticles } = require('../src/modules/content/content.store')
const { addImageAsset, getImageById } = require('../src/modules/images/image.store')
const { activeJobIds, saveJob, purgeExpiredImportJobs } = require('../src/modules/content/article-import.service')
const context = { poolId: 'documents', miniProgramId: 'document-mp' }
const source = 'https://mp.weixin.qq.com/s?__biz=YWJj%3D&mid=1234&idx=2&sn=first'
let counter = 0
const sample = (title, body = '第一段完整正文。\n\n第二段完整正文。', url = '') => '# ' + title + '\n\n示例账号A丨2026-09-13 09:30:00\n\n' + body + (url ? '\n\n---\n\n原文链接：<' + url + '>' : '') + '\n'
const create = (texts, names) => {
  const files = texts.map((text, i) => ({ path: names?.[i] || '下载/账号/文章' + i + '.md', size: Buffer.byteLength(text) }))
  const job = docs.createDocumentJob({ ...context, files, requestId: 'test-request-' + String(++counter).padStart(10, '0') })
  docs.uploadDocumentChunk(job.id, context, texts.map((text, i) => ({ id: job.items[i].id, base64: Buffer.from(text).toString('base64') })))
  return job
}
async function ready(id, dependencies = {}) {
  docs.startDocumentJob(id, context, dependencies)
  for (let count = 0; count < 400; count++) {
    if (!activeJobIds.has(id)) return docs.getDocumentJob(id, context)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('文档任务超时')
}
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00])
const fakeStorage = { uploadBuffer: async () => {}, deleteObject: async () => {} }
test.after(() => { closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true }) })

test('current skill document separates visible fields and minimal source footer without altering the body', () => {
  const body = '## 正文标题\n\n---\n\n正文里有来源说明，原样保留。\n\n~~~md\n---\n\n原文链接：<https://example.com/example>\n~~~'
  const value = parser.parseArticleDocument('\ufeff![封面](<https://image.example.com/cover.jpg>)\r\n\r\n' + sample('可读标题', body, source).replace(/\n/g, '\r\n'), '下载/示例账号A/原文.md')
  assert.equal(value.title, '可读标题')
  assert.equal(value.author, '示例账号A')
  assert.equal(value.publishedAt, '2026-09-13T01:30:00.000Z')
  assert.equal(value.sourceUrl, source)
  assert.equal(value.sourceIdentity, 'wechat:YWJj=:1234:2')
  assert.equal(value.bodyMarkdown, body)
  assert.equal(value.coverUrl, 'https://image.example.com/cover.jpg')
  assert.deepEqual(value.issues, [])
})

test('image replacement respects code, inline and reference images, wrappers and ordinary links', () => {
  const md = '![一](<https://a.example/a(b).jpg> "说明")\n\n[![二][photo]](https://target.example/)\n\n普通链接 [链接][photo]\n\n[photo]: https://a.example/ref.jpg "图片说明"\n\n~~~md\n![示例](https://code.example/x.jpg)\n~~~'
  const images = parser.collectMarkdownImages(md)
  assert.equal(images.length, 2)
  const result = parser.replaceMarkdownImages(md, images.map((image, i) => ({ image, url: 'https://cos.example/' + i + '.jpg' })))
  assert.match(result, /!\[一\]\(<https:\/\/cos.example\/0.jpg> "说明"\)/)
  assert.match(result, /\[!\[二\]\(<https:\/\/cos.example\/1.jpg> "图片说明"\)\]\(https:\/\/target.example\/\)/)
  assert.match(result, /普通链接 \[链接\]\[photo\]/)
  assert.match(result, /!\[示例\]\(https:\/\/code.example\/x.jpg\)/)
  const linkedCover = parser.parseArticleDocument('[![封面][photo]](https://target.example/)\n\n' + sample('引用封面') + '\n[photo]: https://a.example/cover.jpg', 'a.md')
  assert.equal(linkedCover.coverUrl, 'https://a.example/cover.jpg')
  assert.equal(linkedCover.title, '引用封面')
  assert.equal(linkedCover.author, '示例账号A')
  assert.doesNotMatch(linkedCover.bodyMarkdown, /!\[封面\]/)
})

test('legacy JSON and safe YAML supplement missing fields while visible fields take precedence', () => {
  const old = { title: '旧标题', account: '旧账号', published_at: '2020-01-01T08:00:00Z', source_url: source, source_id: 'untrusted', body_sha256: 'untrusted' }
  const value = parser.parseArticleDocument(sample('新标题') + '\n<!-- article-capture:v1\n' + JSON.stringify(old) + '\n-->', 'a.md')
  assert.equal(value.title, '新标题')
  assert.equal(value.author, '示例账号A')
  assert.equal(value.sourceUrl, source)
  assert.doesNotMatch(value.bodyMarkdown, /article-capture/)
  const yaml = parser.parseArticleDocument('---\ntitle: YAML 标题\nauthor: 作者\npublishedAt: 2025-01-01 12:30:00\n---\n\n原始正文', 'a.md')
  assert.equal(yaml.publishedAt, '2025-01-01T04:30:00.000Z')
  assert.deepEqual(yaml.issues, [])
  const unsafe = parser.parseArticleDocument('---\ntitle: !!js/function evil\n---\n\n正文', 'a.md')
  assert(unsafe.issues.some((issue) => issue.field === 'metadata'))
})

test('invalid or missing original date never becomes today, and malformed metadata remains repairable', () => {
  assert.equal(parser.parseDocumentDate('2025-02-30 12:30:00'), '')
  assert.equal(parser.parseDocumentDate('2025-02-10'), '')
  const value = parser.parseArticleDocument(sample('坏日期').replace('2026-09-13', '2026-02-30'), 'a.md')
  assert.equal(value.publishedAt, '')
  const plain = parser.parseArticleDocument('第一段不是标题。\n\n第二段也属于正文。', '日记.txt')
  assert.equal(plain.title, '日记')
  assert.equal(plain.bodyMarkdown, '第一段不是标题。\n\n第二段也属于正文。')
  assert(plain.issues.some((issue) => issue.field === 'author'))
})

test('200 documents in deep sibling directories keep separate paths; oversized and hidden manifests are rejected', async () => {
  const texts = Array.from({ length: 200 }, (_, i) => sample('文章 ' + i, '第 ' + i + ' 篇'))
  const paths = texts.map((_text, i) => '下载/账号' + i + '/更深一层/同名.md')
  const job = create(texts, paths)
  const result = await ready(job.id)
  assert.equal(result.total, 200)
  assert.equal(result.counts.ready, 200)
  assert.equal(result.previewItems.length, 18)
  assert.equal(result.pagination.pageCount, 12)
  const last = docs.getDocumentJob(job.id, context, { page: 12 })
  assert.equal(last.previewItems.length, 2)
  assert.equal(last.previewItems[1].filePath, paths[199])
  for (const files of [
    Array.from({ length: 201 }, (_, i) => ({ path: i + '.md', size: 1 })),
    [{ path: '下载/.article-capture/草稿.md', size: 1 }],
    [{ path: '下载/../错误.md', size: 1 }],
    [{ path: 'a.md', size: 1024 * 1024 + 1 }],
    Array.from({ length: 21 }, (_, i) => ({ path: i + '.md', size: 1024 * 1024 })),
  ]) assert.throws(() => docs.createDocumentJob({ ...context, files, requestId: 'invalid-request-id' }))
})

test('one malformed document does not block the batch; chunks and context are validated and idempotent', async () => {
  const job = create([sample('正常文档'), '二进制\0内容'])
  const result = await ready(job.id)
  assert.equal(result.counts.ready, 1)
  assert.equal(result.counts.failed, 1)
  assert.throws(() => docs.getDocumentJob(job.id, { ...context, poolId: 'other' }), /没有该文档任务/)
  const published = await docs.publishDocumentJob(job.id, context, fakeStorage)
  assert.equal(published.importedCount, 1)
  assert.equal(published.counts.failed, 1)
  assert.equal((await docs.publishDocumentJob(job.id, context, fakeStorage)).importedCount, 0)
})

test('source identity matches historic URL imports and changed sharing parameters before any image requests', async () => {
  appendContentItems('documents', 'articles', [{ id: 'old-url-article', title: '历史 URL', author: '来源', publishedAt: '2024-01-01T00:00:00Z', bodyMarkdown: '历史正文', sourceUrl: source, sourceHash: 'legacy-hash' }])
  const job = create([sample('新文件名和标题', '![图片](https://no-fetch.example/x.jpg)', source.replace('sn=first', 'sn=another&from=timeline'))])
  const result = await ready(job.id, { fetchResource: async () => { throw new Error('重复文章不应下载图片') } })
  assert.equal(result.counts.duplicate, 1)
  assert.equal(result.previewItems[0].duplicateOf.id, 'old-url-article')
})

test('failed images stay in place, successful assets are reused, partial confirmation and a restart retain edits', async () => {
  let allowSecond = false, firstFetches = 0, secondFetches = 0
  const dependencies = { ...fakeStorage, fetchResource: async (url, options) => {
    assert.equal(options.kind, 'image')
    if (url.includes('second')) { secondFetches++; if (!allowSecond) throw new Error('图片临时不可用') }
    else firstFetches++
    return { body: jpeg, contentType: 'image/jpeg' }
  } }
  const job = create([sample('没有图片的正常文章', '这篇的文字与其他历史样文不同，可以直接导入。'), sample('修复图片的文章', '正文前。\n\n![一](https://images.example/first.jpg)\n\n中间段。\n\n![二](https://images.example/second.jpg)\n\n正文后。')])
  let result = await ready(job.id, dependencies)
  assert.equal(result.counts.ready, 1)
  assert.equal(result.counts.needs_attention, 1)
  let item = result.previewItems.find((entry) => entry.title === '修复图片的文章')
  assert.match(item.bodyMarkdown, /second.jpg/)
  assert.match(item.renderedHtml, /图片 2 待处理/)
  assert.doesNotMatch(item.renderedHtml, /src="https:\/\/images.example\/second/)
  assert.equal(firstFetches, 1)
  await docs.editDocumentItem(job.id, context, item.id, { revision: item.revision, title: '已保存的编辑' }, dependencies)
  result = await docs.publishDocumentJob(job.id, context, dependencies)
  assert.equal(result.importedCount, 1)
  assert.equal(result.counts.needs_attention, 1)
  const raw = docs.readDocumentJob(job.id, context)
  raw.status = 'processing'
  saveJob(raw)
  const oldUpdatedAt = raw.updatedAt
  result = docs.getDocumentJob(job.id, context)
  assert.equal(result.status, 'interrupted')
  assert.equal(result.updatedAt, oldUpdatedAt)
  assert.equal(result.previewItems[0].title, '已保存的编辑')
  item = result.previewItems[0]
  allowSecond = true
  await docs.changeDocumentImage(job.id, context, item.id, { slotId: item.imageSlots.find((slot) => slot.status === 'failed').id, action: 'retry' }, dependencies)
  result = await ready(job.id, dependencies)
  assert.equal(firstFetches, 1)
  assert.equal(secondFetches, 3)
  result = await docs.publishDocumentJob(job.id, context, dependencies)
  assert.equal(result.importedCount, 1)
  assert.equal(result.counts.imported, 2)
  assert.equal(result.status, 'complete')
  const stored = getContentItem('documents', 'articles', result.publishedIds[1])
  assert.equal(stored.title, '已保存的编辑')
  assert.equal(stored.bodyImageAssetIds.length, 1)
  assert(stored.importFingerprint)
  updateContentItem('documents', 'articles', { ...stored, title: '管理页编辑', importFingerprint: undefined })
  assert.equal(getContentItem('documents', 'articles', stored.id).importFingerprint, stored.importFingerprint)
})

test('simple tables retain cells and bounded layout in admin and mini program without accepting file HTML', () => {
  const html = renderArticleMarkdown('| 指标 | 数值 |\n| --- | --- |\n| 体温 | **36.5** |\n\n<script>alert(1)</script>')
  assert.match(html, /<table/)
  assert.match(html, /<th[^>]*>指标<\/th>/)
  const mini = sanitizeArticleHtml(html)
  assert.match(mini, /table-layout:fixed/)
  assert.match(mini, /<td[^>]*><strong>36.5<\/strong><\/td>/)
  assert.doesNotMatch(mini, /<script>/)
})

test('document HTTP routes require login and pool context, serve browser modules and replay file upload safely', async () => {
  const http = require('node:http')
  const { createAppRouter } = require('../src/routes')
  const router = createAppRouter({ articleImportDependencies: fakeStorage })
  const server = http.createServer(router.handle)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  let cookie = ''
  const call = async (suffix, body, query = context) => {
    const response = await fetch(base + '/api/admin/articles/documents' + suffix + '?' + new URLSearchParams(query), {
      method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }
  try {
    assert.equal((await call('')).status, 401)
    const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'admin', password: '123456' }) })
    cookie = login.headers.get('set-cookie').split(';')[0]
    for (const script of ['article-document-files.js', 'article-document-import.js']) assert.equal((await fetch(base + '/admin/' + script)).status, 200)
    const text = sample('通过实际接口导入', '实际接口验证独立正文。')
    const manifest = { requestId: 'http-replay-request-0001', skippedCount: 7, files: [{ path: '下载/示例账号B/更深/测试.md', size: Buffer.byteLength(text) }] }
    const first = await call('', manifest)
    assert.equal(first.status, 202)
    const id = first.data.id
    assert.equal(first.data.skippedCount, 7)
    assert.equal((await call('', manifest)).data.id, id)
    const data = { files: [{ id: first.data.items[0].id, base64: Buffer.from(text).toString('base64') }] }
    assert.equal((await call('/' + id + '/files', data)).status, 200)
    assert.equal((await call('/' + id + '/files', data)).status, 200)
    assert.equal((await call('/' + id, undefined, { ...context, poolId: 'other' })).status, 400)
    assert.equal((await call('/' + id + '/start', {})).status, 202)
    await ready(id, fakeStorage)
    assert.equal((await call('/' + id + '/publish', {})).data.importedCount, 1)
    assert.equal((await call('/' + id)).data.skippedCount, 7)
    assert.equal((await call('/' + id + '/publish', {})).data.importedCount, 0)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})

test('image replacement and removal retain other failed slots and reclaim only unreferenced replacements', async () => {
  const dependencies = { ...fakeStorage, fetchResource: async () => { throw new Error('图片不可用') } }
  const job = create([sample('图片逐个处理', '正文内容。\n\n![第一张](./local.png)\n\n![第二张](https://image.example.com/missing.jpg)')])
  let result = await ready(job.id, dependencies)
  let item = result.previewItems[0]
  assert.equal(item.imageSlots.filter((slot) => slot.status === 'failed').length, 2)
  const replacement = addImageAsset({ id: 'document-replacement', usage: 'article', status: 'ready', mediumUrl: 'https://media.example.com/document-replacement.jpg', originalUrl: 'https://media.example.com/document-replacement.jpg' })
  result = await docs.changeDocumentImage(job.id, context, item.id, { action: 'replace', slotId: item.imageSlots[0].id, assetId: replacement.id }, dependencies)
  item = result.previewItems[0]
  assert.equal(item.status, 'needs_attention')
  assert.equal(item.imageSlots[0].status, 'ready')
  assert.equal(item.imageSlots[1].status, 'failed')
  assert.match(item.bodyMarkdown, /document-replacement.jpg/)
  result = await docs.changeDocumentImage(job.id, context, item.id, { action: 'remove', slotId: item.imageSlots[1].id }, dependencies)
  item = result.previewItems[0]
  assert.equal(item.status, 'ready')
  assert.doesNotMatch(item.bodyMarkdown, /missing.jpg/)
  assert.equal(getImageById(replacement.id).id, replacement.id)
  await docs.removeDocumentItem(job.id, context, item.id, dependencies)
  assert.equal(getImageById(replacement.id), null)
})

test('removing the first of two same-batch documents prepares the remaining document automatically', async () => {
  let fetches = 0
  const dependencies = { ...fakeStorage, fetchResource: async () => { fetches++; return { body: jpeg, contentType: 'image/jpeg' } } }
  const text = sample('同批替代文章', '此批次的独立内容。\n\n![配图](https://image.example.com/batch.jpg)', 'https://example.com/batch-replacement')
  const job = create([text, text])
  let result = await ready(job.id, dependencies)
  assert.equal(result.counts.ready, 1)
  assert.equal(result.counts.duplicate, 1)
  await docs.removeDocumentItem(job.id, context, result.previewItems[0].id, dependencies)
  result = await ready(job.id, dependencies)
  assert.equal(result.counts.ready, 1)
  assert.equal(result.counts.removed, 1)
  assert.equal(result.counts.pending || 0, 0)
  assert.equal((await docs.publishDocumentJob(job.id, context, dependencies)).importedCount, 1)
  const repeated = create([text])
  result = await ready(repeated.id, dependencies)
  assert.equal(result.status, 'complete')
  assert.equal(result.counts.duplicate, 1)
  assert.equal(docs.readDocumentJob(repeated.id, context).items[0].bodyMarkdown, '')
})

test('expired document tasks reclaim local replacement assets while preserving assets referenced by saved articles', async () => {
  const orphan = addImageAsset({ id: 'document-expired-local', processingMode: 'direct-upload', status: 'ready', mediumUrl: 'https://media.example.com/expired-local.jpg' })
  const retained = addImageAsset({ id: 'document-expired-shared', processingMode: 'direct-upload', status: 'ready', mediumUrl: 'https://media.example.com/expired-shared.jpg' })
  appendContentItems(context.poolId, 'articles', [{ id: 'document-retain-expired-image', title: '已有文章仍引用素材', author: '保留图片', bodyMarkdown: '保留原有文章。', publishedAt: '2026-09-13T01:30:00Z', coverImage: { id: retained.id } }])
  const job = create([sample('待过期本地素材', '临时文档。')])
  await ready(job.id)
  const raw = docs.readDocumentJob(job.id, context)
  raw.items[0].coverImage = { id: orphan.id }
  raw.items[0].bodyImageAssetIds = [retained.id]
  raw.updatedAt = new Date(Date.now() - 25 * 3600000).toISOString()
  saveJob(raw)
  assert.equal(await purgeExpiredImportJobs(Date.now(), fakeStorage), 1)
  assert.equal(getImageById(orphan.id), null)
  assert.equal(getImageById(retained.id).id, retained.id)
})

test('legacy bulk article saves preserve the server-generated import fingerprint', () => {
  const original = parser.parseArticleDocument(sample('无来源原文件', '批量保存前的内容。'), 'a.md')
  appendContentItems('other', 'articles', [{ ...original, id: 'bulk-preserve-import-identity' }])
  const saved = getContentItem('other', 'articles', 'bulk-preserve-import-identity')
  updateArticles([{ ...saved, title: '运营修改过的标题', bodyMarkdown: '运营修改过的正文。', importFingerprint: undefined }], 'other')
  const updated = getContentItem('other', 'articles', saved.id)
  assert.equal(updated.importFingerprint, original.importFingerprint)
  assert.notEqual(updated.contentFingerprint, saved.contentFingerprint)
})
