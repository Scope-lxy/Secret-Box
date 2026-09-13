const crypto = require('crypto')
const { getDatabase } = require('../../lib/state-database')
const { getInternalAdminSettings } = require('../admin/admin-settings.store')
const { getImagesByIds, getImagesByOriginalSha256 } = require('../images/image.store')
const { reclaimImageAssets } = require('../images/image-reclamation.service')
const { appendDeduplicatedContentItems } = require('./content.store')
const { renderArticleMarkdown, hasReadableArticleContent } = require('./article-markdown')
const { articleSource, safeArticleSource, articleFingerprint, articleTextFingerprint, articleDeduplicationKeys, normalizedText } = require('./article-identity')
const { parseArticleDocument, parseDocumentDate, decodeDocument, collectMarkdownImages, replaceMarkdownImages } = require('./article-document-parser')
const { activeJobIds, readJob, saveJob, prepareImage, uploadPreparedImage, registerImportedArticleImage, toTransferredExistingImage, validateRemoteUrl } = require('./article-import.service')

const limits = { files: 200, fileBytes: 1024 * 1024, totalBytes: 20 * 1024 * 1024, chunkBytes: 2 * 1024 * 1024 }
const terminal = new Set(['imported', 'removed', 'duplicate'])
let queue = Promise.resolve()
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const isoNow = () => new Date().toISOString()

function touch(job) { job.updatedAt = isoNow(); return saveJob(job) }
function checkContext(context) {
  const settings = getInternalAdminSettings()
  if (!context?.poolId || !settings.contentPools.some((pool) => pool.id === context.poolId)) throw new Error('目标内容池不存在或不可用')
  if (!context.miniProgramId || !settings.miniPrograms.some((mp) => mp.id === context.miniProgramId && mp.status !== 'archived')) throw new Error('当前小程序不可用')
}

function readDocumentJob(id, context) {
  checkContext(context)
  const job = readJob(id)
  if (!job || job.sourceType !== 'document' || job.poolId !== context.poolId || job.miniProgramId !== context.miniProgramId) throw new Error('此内容池中没有该文档任务')
  if (Date.parse(job.updatedAt) < Date.now() - 86400000 && !activeJobIds.has(id)) throw new Error('文档草稿已超过 24 小时保留期')
  if (['queued', 'processing'].includes(job.status) && !activeJobIds.has(id)) {
    job.status = 'interrupted'
    job.items.filter((item) => item.status === 'processing').forEach((item) => { item.status = 'pending' })
    saveJob(job) // Merely detecting an interruption must not extend retention.
  }
  return job
}

function ensureIdle(job) {
  if (activeJobIds.has(job.id)) throw new Error('图片正在准备，请完成后再编辑或确认')
}

function manifestFile(file, index) {
  const name = String(file?.path || file?.name || '').replace(/\\/g, '/')
  const segments = name.split('/')
  if (!name || name.length > 1024 || segments.some((part) => !part || part.startsWith('.') || /[\x00-\x1f<>:"|?*]/.test(part))) throw new Error('文档相对路径无效或位于隐藏辅助目录')
  if (!/\.(?:md|markdown|txt)$/i.test(name)) throw new Error('仅支持 MD、Markdown 和 TXT 文件')
  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) throw new Error(name + '：单文件不能超过 1MB')
  return { id: 'document-' + (index + 1), fileName: segments[segments.length - 1], filePath: name, size, status: 'waiting_upload', revision: 0 }
}

function createDocumentJob({ files, requestId, skippedCount = 0, ...context }) {
  checkContext(context)
  if (!Number.isSafeInteger(skippedCount) || skippedCount < 0) throw new Error('跳过数量无效')
  if (!Array.isArray(files) || !files.length || files.length > limits.files) throw new Error('每批请选择 1–200 份文档；超过时请分批选择，不会截断导入')
  const items = files.map(manifestFile)
  if (new Set(items.map((item) => item.filePath)).size !== items.length) throw new Error('同一相对路径不能重复选择')
  if (items.reduce((sum, item) => sum + item.size, 0) > limits.totalBytes) throw new Error('本批原始文件合计不能超过 20MB')
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(String(requestId || ''))) throw new Error('缺少有效的上传请求标识')
  const id = 'document-import-' + hash(context.miniProgramId + ':' + context.poolId + ':' + requestId).slice(0, 32)
  const prior = readJob(id)
  const manifestHash = hash(JSON.stringify(items.map(({ filePath, size }) => [filePath, size])))
  if (prior) {
    const job = readDocumentJob(id, context)
    if (job.manifestHash !== manifestHash) throw new Error('本次上传清单已变化，请重新选择文件')
    return documentView(job)
  }
  const job = { id, sourceType: 'document', ...context, manifestHash, skippedCount, createdAt: isoNow(), updatedAt: isoNow(), status: 'uploading', items, imageCache: {}, publishedIds: [] }
  touch(job)
  return documentView(job)
}

function uploadDocumentChunk(id, context, files) {
  const job = readDocumentJob(id, context)
  ensureIdle(job)
  if (job.status !== 'uploading') throw new Error('文件已提交，不能更换原始文档')
  if (!Array.isArray(files) || !files.length || files.length > limits.files) throw new Error('上传分组无效')
  let bytes = 0
  const changes = files.map((file) => {
    const item = job.items.find((entry) => entry.id === file.id)
    if (!item) throw new Error('文件不属于当前上传清单')
    if (file.error) return { item, error: String(file.error).slice(0, 300) }
    if (typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error(item.fileName + '：文件数据无效')
    const buffer = Buffer.from(file.base64, 'base64')
    bytes += buffer.length
    if (buffer.length !== item.size || buffer.length > limits.fileBytes || bytes > limits.chunkBytes) throw new Error('文件大小与清单不符，或上传分组超过 2MB')
    const fileHash = hash(buffer)
    if (item.fileHash && item.fileHash !== fileHash) throw new Error(item.fileName + ' 已上传不同内容，请新建任务')
    return { item, buffer, fileHash }
  })
  for (const { item, buffer, fileHash, error } of changes) {
    if (item.fileHash || item.status !== 'waiting_upload') continue
    try {
      if (error) throw new Error(error)
      Object.assign(item, parseArticleDocument(decodeDocument(buffer, item.fileName), item.fileName), { fileHash, status: 'pending', revision: 1 })
      item.needsTitleConfirmation = item.issues.some((issue) => issue.field === 'title')
      item.imageSlots = makeImageSlots(item)
    } catch (problem) { Object.assign(item, { status: 'failed', error: problem.message, fileHash }) }
  }
  touch(job)
  return documentView(job)
}

function makeImageSlots(item, oldSlots = []) {
  const bodyImages = collectMarkdownImages(item.bodyMarkdown)
  const specs = [...(item.coverUrl ? [{ kind: 'cover', url: item.coverUrl }] : []), ...bodyImages.map((image, index) => ({ kind: 'body', url: image.url, occurrence: index }))]
  return specs.map((spec, index) => {
    const matches = oldSlots.filter((slot) => slot.kind === spec.kind && (slot.url === spec.url || slot.displayUrl === spec.url))
    const old = matches.find((slot) => slot.status === 'ready') || matches.find((slot) => slot.status === 'failed')
    const state = old?.status === 'ready' ? { status: 'ready', assetId: old.assetId, displayUrl: old.displayUrl }
      : old?.status === 'failed' ? { status: 'failed', error: old.error } : { status: 'pending' }
    return { id: 'image-' + (index + 1), ...spec, ...state }
  })
}

function existingArticles(poolId) {
  return getDatabase().prepare("SELECT item_json FROM content_items WHERE pool_id = ? AND content_type = 'articles'").all(poolId).map((row) => JSON.parse(row.item_json))
}

function refreshDuplicates(job) {
  const previous = existingArticles(job.poolId)
  const previousIds = new Set(previous.map((item) => item.id))
  const byKey = new Map(), byTitle = new Map(), byText = new Map()
  const pair = (author, value) => JSON.stringify([author, value])
  const index = (item, keys = articleDeduplicationKeys(item)) => {
    keys.forEach((key) => { if (!byKey.has(key)) byKey.set(key, item) })
    const author = normalizedText(item.author)
    if (!author) return
    const titleKey = pair(author, normalizedText(item.title)), textKey = pair(author, articleTextFingerprint(item))
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, item)
    if (!byText.has(textKey)) byText.set(textKey, item)
  }
  previous.forEach((item) => index(item))
  for (const item of job.items) {
    if (['removed', 'imported', 'waiting_upload', 'failed'].includes(item.status)) continue
    const keys = articleDeduplicationKeys(item)
    const exact = keys.map((key) => byKey.get(key)).find((other) => other && other.id !== item.id)
    if (exact) {
      item.duplicateOf = { id: exact.id, title: exact.title, existing: previousIds.has(exact.id) }
      item.status = 'duplicate'
      item.duplicate = true
      continue
    }
    delete item.duplicateOf
    item.duplicate = false
    if (item.status === 'duplicate') item.status = 'pending'
    const author = normalizedText(item.author)
    const similar = author && (byTitle.get(pair(author, normalizedText(item.title))) || byText.get(pair(author, articleTextFingerprint(item))))
    item.possibleDuplicate = similar ? { id: similar.id, title: similar.title, existing: previousIds.has(similar.id) } : null
    if (!similar) item.acceptAsNew = false
    index(item, keys)
  }
}

function refreshItem(item) {
  if (terminal.has(item.status) || item.status === 'failed' || item.status === 'waiting_upload') return
  const problems = (item.issues || []).filter((issue) => !['title', 'author', 'publishedAt', 'bodyMarkdown'].includes(issue.field))
  if (!item.title?.trim()) problems.push({ field: 'title', message: '缺少标题' })
  if (item.needsTitleConfirmation) problems.push({ field: 'title', message: '请核对文件名标题并保存' })
  if (!item.author?.trim()) problems.push({ field: 'author', message: '缺少账号 / 作者' })
  if (!parseDocumentDate(item.publishedAt)) problems.push({ field: 'publishedAt', message: '缺少有效的原始发布时间' })
  if (!hasReadableArticleContent(item.bodyMarkdown)) problems.push({ field: 'bodyMarkdown', message: '缺少可读正文' })
  item.issues = problems
  const pending = item.imageSlots?.some((slot) => slot.status === 'pending')
  const failed = item.imageSlots?.some((slot) => slot.status === 'failed')
  item.bodyImageAssetIds = [...new Set((item.imageSlots || []).filter((slot) => slot.kind === 'body' && slot.status === 'ready').map((slot) => slot.assetId))]
  if (pending) item.status = 'pending'
  else item.status = problems.length || failed || (item.possibleDuplicate && !item.acceptAsNew) ? 'needs_attention' : 'ready'
}

function previewItem(item) {
  const result = { ...item }
  delete result.fileHash
  const cover = getImagesByIds([item.coverImage?.id].filter(Boolean))[0]
  result.coverImage = cover || null
  const failed = (item.imageSlots || []).filter((slot) => slot.kind === 'body' && slot.status !== 'ready')
  let preview = String(item.bodyMarkdown || '')
  const images = collectMarkdownImages(preview)
  for (const slot of [...failed].sort((a, b) => b.occurrence - a.occurrence)) {
    const image = images[slot.occurrence]
    if (image) preview = preview.slice(0, image.start) + '**[图片 ' + (slot.occurrence + 1) + ' 待处理]**' + preview.slice(image.end)
  }
  result.renderedHtml = renderArticleMarkdown(preview)
  return result
}

function documentView(job, options = {}) {
  const counts = {}
  job.items.forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1 })
  const query = normalizedText(options.q).toLowerCase()
  const filtered = job.items.filter((item) => !['removed', 'imported'].includes(item.status)
    && (!options.filter || item.status === options.filter)
    && (!query || [item.title, item.author, item.filePath].join(' ').toLowerCase().includes(query)))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 18))
  const page = Math.min(pageCount, Math.max(1, Number(options.page) || 1))
  return {
    id: job.id, sourceType: 'document', poolId: job.poolId, miniProgramId: job.miniProgramId,
    status: job.status, updatedAt: job.updatedAt, counts, total: job.items.length, skippedCount: job.skippedCount || 0,
    publishedIds: job.publishedIds, error: job.error,
    items: job.items.map(({ id, title, author, filePath, size, status, revision, issues, duplicateOf }) => ({ id, title, author, filePath, size, status, revision, issues, duplicateOf })),
    previewItems: filtered.slice((page - 1) * 18, page * 18).map(previewItem),
    pagination: { page, pageCount, total: filtered.length, pageSize: 18 },
  }
}

function getDocumentJob(id, context, options) { return documentView(readDocumentJob(id, context), options) }
function listDocumentJobs(context) {
  checkContext(context)
  return getDatabase().prepare('SELECT job_id FROM article_import_jobs WHERE pool_id = ? ORDER BY updated_at DESC').all(context.poolId).flatMap(({ job_id }) => {
    try {
      const job = readDocumentJob(job_id, context)
      if (['complete', 'abandoned'].includes(job.status)) return []
      return [{ id: job.id, status: job.status, updatedAt: job.updatedAt, total: job.items.length }]
    } catch { return [] }
  }).slice(0, 20)
}

async function transferSlot(job, item, slot, dependencies) {
  const cacheKey = slot.kind + ':' + slot.url
  const cached = job.imageCache[cacheKey]
  let asset
  if (cached && getImagesByIds([cached.id]).length) asset = getImagesByIds([cached.id])[0]
  else {
    validateRemoteUrl(slot.url, 'image')
    let prepared
    for (let attempt = 0; attempt < 2; attempt++) {
      try { prepared = await prepareImage(slot.url, dependencies); break }
      catch (error) {
        if (attempt || ['SSRF_BLOCKED', 'INVALID_URL', 'INVALID_MIME', 'INVALID_IMAGE', 'UNSAFE_PORT', 'RESPONSE_TOO_LARGE'].includes(error.code)) throw error
      }
    }
    const existing = getImagesByOriginalSha256([prepared.hash]).map((image) => toTransferredExistingImage(prepared, image, { cover: slot.kind === 'cover' })).find(Boolean)
    const transferred = existing || await uploadPreparedImage(prepared, dependencies, { cover: slot.kind === 'cover' })
    asset = registerImportedArticleImage(transferred, item.title, slot.kind)
    job.imageCache[cacheKey] = { id: asset.id, images: [{ id: asset.id }] }
  }
  Object.assign(slot, { status: 'ready', assetId: asset.id, displayUrl: asset.mediumUrl || asset.originalUrl })
  delete slot.error
  if (slot.kind === 'cover') item.coverImage = { id: asset.id }
  else {
    const image = collectMarkdownImages(item.bodyMarkdown)[slot.occurrence]
    if (image) item.bodyMarkdown = replaceMarkdownImages(item.bodyMarkdown, [{ image, url: slot.displayUrl }])
  }
  refreshItem(item)
  touch(job)
}

async function processDocumentJob(id, dependencies = {}) {
  const job = readJob(id)
  if (!job || job.sourceType !== 'document') { activeJobIds.delete(id); return }
  try {
    job.status = 'processing'
    refreshDuplicates(job)
    touch(job)
    for (const item of job.items) {
      if (terminal.has(item.status) || ['failed', 'waiting_upload'].includes(item.status)) continue
      item.status = 'processing'
      touch(job)
      for (const slot of item.imageSlots || []) {
        if (slot.status !== 'pending') continue
        try { await transferSlot(job, item, slot, dependencies) }
        catch (error) { slot.status = 'failed'; slot.error = error.message || '图片准备失败'; touch(job) }
      }
      refreshItem(item)
      item.revision++
      touch(job)
    }
    refreshDuplicates(job)
    job.items.forEach(refreshItem)
    job.status = job.items.every((item) => terminal.has(item.status)) ? 'complete' : 'ready'
    delete job.error
    const before = referencedAssets(job)
    if (job.status === 'complete') compactCompletedJob(job)
    touch(job)
    if (job.status === 'complete') await cleanUnused(job, before, dependencies)
  } catch (error) { job.status = 'interrupted'; job.error = error.message; touch(job) }
  finally { activeJobIds.delete(id) }
}

function enqueue(job, dependencies) {
  job.status = 'queued'
  activeJobIds.add(job.id)
  touch(job)
  queue = queue.catch(() => {}).then(() => processDocumentJob(job.id, dependencies))
}

function startDocumentJob(id, context, dependencies = {}) {
  const job = readDocumentJob(id, context)
  if (activeJobIds.has(id)) return documentView(job)
  if (['complete', 'abandoned'].includes(job.status)) return documentView(job)
  job.items.filter((item) => item.status === 'waiting_upload').forEach((item) => { item.status = 'failed'; item.error = '文件未上传完成，请重新选择此文件' })
  enqueue(job, dependencies)
  return documentView(job)
}

function itemIn(job, itemId, revision) {
  const item = job.items.find((entry) => entry.id === itemId)
  if (!item || terminal.has(item.status) || item.status === 'waiting_upload') throw new Error('文章已移除、导入或不在此任务中')
  if (revision !== undefined && item.revision !== Number(revision)) throw new Error('此草稿已有更新，请刷新后再修改')
  return item
}

function referencedAssets(job) {
  return [...new Set(job.items.flatMap((item) => [item.coverImage?.id, ...(item.bodyImageAssetIds || [])]).filter(Boolean))]
}

function compactCompletedJob(job) {
  job.items.forEach((item) => Object.assign(item, { bodyMarkdown: '', coverImage: null, coverUrl: '', imageSlots: [], bodyImageAssetIds: [] }))
}

async function cleanUnused(job, before, dependencies) {
  const used = new Set(referencedAssets(job))
  Object.entries(job.imageCache).forEach(([key, entry]) => { if (!used.has(entry.id)) delete job.imageCache[key] })
  saveJob(job)
  try { await reclaimImageAssets(before.filter((id) => !used.has(id)), dependencies.deleteObject ? { deleteObject: dependencies.deleteObject } : {}) }
  catch { /* Asset rows remain for the existing periodic cleanup to retry. */ }
}

function registeredBodyImages(item, images) {
  const assets = getImagesByIds(item.bodyImageAssetIds || [])
  return images.every((image) => assets.some((asset) => [asset.originalUrl, asset.mediumUrl, asset.thumbUrl].includes(image.url)))
}

async function editDocumentItem(id, context, itemId, patch, dependencies = {}) {
  const job = readDocumentJob(id, context)
  ensureIdle(job)
  const item = itemIn(job, itemId, patch.revision)
  const before = referencedAssets(job)
  const allowed = new Set(['revision', 'title', 'author', 'publishedAt', 'sourceUrl', 'bodyMarkdown', 'coverImage', 'acknowledgeMetadata', 'acceptAsNew'])
  if (Object.keys(patch).some((key) => !allowed.has(key))) throw new Error('包含不支持的文章字段')
  const updated = { ...item }
  for (const field of ['title', 'author', 'sourceUrl', 'bodyMarkdown']) if (Object.hasOwn(patch, field)) updated[field] = String(patch[field] || '').trim()
  if (Buffer.byteLength(updated.bodyMarkdown || '') > limits.fileBytes) throw new Error('编辑后的正文不能超过 1MB')
  if ((updated.title || '').length > 500 || (updated.author || '').length > 200) throw new Error('标题或账号过长')
  if (Object.hasOwn(patch, 'publishedAt')) updated.publishedAt = parseDocumentDate(patch.publishedAt)
  const oldSlots = item.imageSlots || []
  if (Object.hasOwn(patch, 'coverImage')) {
    const coverId = patch.coverImage?.id
    if (patch.coverImage !== null && (!coverId || !getImagesByIds([coverId]).length)) throw new Error('所选封面不是已登记素材')
    updated.coverImage = coverId ? { id: coverId } : null
    updated.coverUrl = coverId ? getImagesByIds([coverId])[0].mediumUrl : ''
  }
  updated.issues = (item.issues || []).filter((issue) => !(Object.hasOwn(patch, issue.field) || (issue.field === 'metadata' && patch.acknowledgeMetadata === true)))
  if (Object.hasOwn(patch, 'title')) updated.needsTitleConfirmation = false
  if (Object.hasOwn(patch, 'sourceUrl')) Object.assign(updated, articleSource(updated.sourceUrl))
  if (Object.hasOwn(patch, 'acceptAsNew')) updated.acceptAsNew = patch.acceptAsNew === true
  if (Object.hasOwn(patch, 'bodyMarkdown') || Object.hasOwn(patch, 'coverImage')) {
    updated.imageSlots = makeImageSlots(updated, oldSlots)
    if (updated.coverImage?.id) {
      const cover = updated.imageSlots.find((slot) => slot.kind === 'cover')
      if (cover) Object.assign(cover, { status: 'ready', assetId: updated.coverImage.id, displayUrl: updated.coverUrl })
    }
    // Keep registered images pasted from this article's previous body.
    const assets = getImagesByIds(item.bodyImageAssetIds || [])
    updated.imageSlots.forEach((slot) => {
      const asset = assets.find((entry) => [entry.mediumUrl, entry.originalUrl, entry.thumbUrl].includes(slot.url))
      if (asset) Object.assign(slot, { status: 'ready', assetId: asset.id, displayUrl: slot.url })
    })
  }
  Object.assign(item, updated, { revision: item.revision + 1 })
  refreshDuplicates(job)
  job.items.forEach(refreshItem)
  touch(job)
  await cleanUnused(job, before, dependencies)
  if (job.items.some((entry) => entry.status === 'pending')) enqueue(job, dependencies)
  return documentView(job)
}

async function changeDocumentImage(id, context, itemId, body, dependencies = {}) {
  const job = readDocumentJob(id, context)
  ensureIdle(job)
  const item = itemIn(job, itemId, body.revision)
  const slot = (item.imageSlots || []).find((entry) => entry.id === body.slotId)
  if (!slot) throw new Error('图片不属于当前文章')
  const before = referencedAssets(job)
  if (body.action === 'retry') {
    if (slot.status !== 'failed') throw new Error('仅重试失败图片')
    slot.status = 'pending'
    delete slot.error
    enqueue(job, dependencies)
  } else if (['remove', 'replace'].includes(body.action)) {
    const asset = body.action === 'replace' ? getImagesByIds([String(body.assetId || '')])[0] : null
    if (body.action === 'replace' && !asset) throw new Error('请先上传本地替换图片')
    if (slot.kind === 'cover') {
      item.coverUrl = asset ? asset.mediumUrl || asset.originalUrl : ''
      item.coverImage = asset ? { id: asset.id } : null
    } else {
      const image = collectMarkdownImages(item.bodyMarkdown)[slot.occurrence]
      if (!image) throw new Error('正文已变化，请刷新后处理图片')
      item.bodyMarkdown = replaceMarkdownImages(item.bodyMarkdown, [{ image, url: asset ? asset.mediumUrl || asset.originalUrl : null }])
    }
    const previous = [...item.imageSlots]
    if (asset) previous.push({ kind: slot.kind, url: asset.mediumUrl || asset.originalUrl, displayUrl: asset.mediumUrl || asset.originalUrl, assetId: asset.id, status: 'ready' })
    item.imageSlots = makeImageSlots(item, previous)
    refreshItem(item)
    touch(job)
    await cleanUnused(job, before, dependencies)
  } else throw new Error('不支持的图片操作')
  item.revision++
  touch(job)
  return documentView(job)
}

async function removeDocumentItem(id, context, itemId, dependencies = {}) {
  const job = readDocumentJob(id, context)
  ensureIdle(job)
  const item = job.items.find((entry) => entry.id === itemId)
  if (!item || item.status === 'imported') throw new Error('文章不属于可移除草稿')
  const before = referencedAssets(job)
  Object.assign(item, { status: 'removed', bodyMarkdown: '', coverImage: null, coverUrl: '', imageSlots: [], bodyImageAssetIds: [] })
  item.revision++
  refreshDuplicates(job)
  job.items.forEach(refreshItem)
  if (job.items.every((entry) => terminal.has(entry.status))) { job.status = 'complete'; compactCompletedJob(job) }
  touch(job)
  await cleanUnused(job, before, dependencies)
  if (job.items.some((entry) => entry.status === 'pending')) enqueue(job, dependencies)
  return documentView(job)
}

async function publishDocumentJob(id, context, dependencies = {}) {
  const job = readDocumentJob(id, context)
  ensureIdle(job)
  if (job.status === 'complete') return { ...documentView(job), importedCount: 0 }
  if (!['ready', 'interrupted'].includes(job.status)) throw new Error('请先完成文档准备')
  const before = referencedAssets(job)
  let importedCount = 0, duplicateCount = 0
  // Content insertion and receipts commit together; a retry cannot insert a
  // second copy or lose the still-unresolved drafts.
  getDatabase().transaction(() => {
    refreshDuplicates(job)
    job.items.forEach(refreshItem)
    for (const item of job.items.filter((entry) => entry.status === 'ready')) {
      if (!registeredBodyImages(item, collectMarkdownImages(item.bodyMarkdown))) throw new Error(item.title + '：正文仍有未登记图片')
      if (item.coverImage?.id && !getImagesByIds([item.coverImage.id]).length) throw new Error('封面素材不存在，请重新处理')
      const article = {
        id: job.id + '-' + item.id, label: '默认', title: item.title, author: item.author,
        bodyMarkdown: item.bodyMarkdown, publishedAt: item.publishedAt, sourceUrl: item.sourceUrl,
        sourceIdentity: safeArticleSource(item.sourceUrl).sourceIdentity, importFingerprint: item.importFingerprint,
        coverImage: item.coverImage || null, bodyImageAssetIds: item.bodyImageAssetIds || [], likeCount: 0, favoriteCount: 0,
      }
      const result = appendDeduplicatedContentItems(job.poolId, 'articles', [article])
      importedCount += result.importedCount
      duplicateCount += result.duplicateCount
      item.status = result.importedCount ? 'imported' : 'duplicate'
      item.publishedId = article.id
      if (result.importedCount) job.publishedIds.push(article.id)
      Object.assign(item, { bodyMarkdown: '', coverImage: null, imageSlots: [], bodyImageAssetIds: [] })
    }
    if (job.items.every((item) => terminal.has(item.status))) {
      job.status = 'complete'
      compactCompletedJob(job)
    }
    touch(job)
  })()
  await cleanUnused(job, before, dependencies)
  return { ...documentView(job), importedCount, duplicateCount }
}

async function abandonDocumentJob(id, context, dependencies = {}) {
  const job = readDocumentJob(id, context)
  ensureIdle(job)
  const before = referencedAssets(job)
  job.items.forEach((item) => Object.assign(item, { status: item.status === 'imported' ? 'imported' : 'removed', bodyMarkdown: '', coverImage: null, imageSlots: [], bodyImageAssetIds: [] }))
  job.status = 'abandoned'
  touch(job)
  await cleanUnused(job, before, dependencies)
  return { id, status: job.status }
}

module.exports = { limits, createDocumentJob, uploadDocumentChunk, startDocumentJob, getDocumentJob, listDocumentJobs, readDocumentJob, editDocumentItem, changeDocumentImage, removeDocumentItem, publishDocumentJob, abandonDocumentJob }
module.exports.getExistingDocumentArticle = (itemId, context) => {
  checkContext(context)
  const item = existingArticles(context.poolId).find((item) => item.id === itemId)
  if (!item) throw new Error('目标内容池内没有该文章')
  return previewItem(item)
}
