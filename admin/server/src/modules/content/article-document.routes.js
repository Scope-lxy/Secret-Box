const { readJsonBody } = require('../../lib/body')
const { ok, sendJson, badRequest } = require('../../lib/response')
const documents = require('./article-document.service')

function registerDocumentRoutes(router, requireAdminSession, dependencies = {}) {
  const root = '/api/admin/articles/documents'
  const handle = (action, status = 200) => async (req, res, url) => {
    if (!requireAdminSession(req, res)) return
    try {
      const body = req.method === 'GET' ? {} : await readJsonBody(req)
      const context = {
        poolId: String(body.poolId || url.searchParams.get('poolId') || '').trim(),
        miniProgramId: String(body.miniProgramId || url.searchParams.get('miniProgramId') || '').trim(),
      }
      const result = await action(body, context, url)
      if (status === 200) ok(res, result)
      else sendJson(res, status, result)
    } catch (error) { badRequest(res, error.message || '文档导入操作失败') }
  }
  router.get(root, handle((_body, context) => ({ jobs: documents.listDocumentJobs(context) })))
  router.get(root + '/existing/:itemId', handle((_body, context, url) => ({ article: documents.getExistingDocumentArticle(url.params.itemId, context) })))
  router.post(root, handle((body, context) => documents.createDocumentJob({ ...context, files: body.files, requestId: body.requestId, skippedCount: body.skippedCount }), 202))
  router.get(root + '/:jobId', handle((_body, context, url) => documents.getDocumentJob(url.params.jobId, context, Object.fromEntries(url.searchParams))))
  router.post(root + '/:jobId/files', handle((body, context, url) => documents.uploadDocumentChunk(url.params.jobId, context, body.files)))
  router.post(root + '/:jobId/start', handle((_body, context, url) => documents.startDocumentJob(url.params.jobId, context, dependencies), 202))
  router.post(root + '/:jobId/items/:itemId', handle((body, context, url) => documents.editDocumentItem(url.params.jobId, context, url.params.itemId, body.patch || {}, dependencies)))
  router.post(root + '/:jobId/items/:itemId/image', handle((body, context, url) => documents.changeDocumentImage(url.params.jobId, context, url.params.itemId, body, dependencies)))
  router.post(root + '/:jobId/items/:itemId/remove', handle((_body, context, url) => documents.removeDocumentItem(url.params.jobId, context, url.params.itemId, dependencies)))
  router.post(root + '/:jobId/author', handle(async (body, context, url) => {
    const author = String(body.author || '').trim()
    if (!author || author.length > 200 || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > documents.limits.files) throw new Error('请选择需补充账号的文章并填写账号')
    const job = documents.readDocumentJob(url.params.jobId, context)
    if (body.ids.some((id) => !job.items.some((item) => item.id === id && !item.author && !['imported', 'removed', 'duplicate'].includes(item.status)))) throw new Error('仅允许为本任务缺少账号的文档批量补充')
    for (const id of new Set(body.ids)) await documents.editDocumentItem(job.id, context, id, { author }, dependencies)
    return documents.getDocumentJob(job.id, context)
  }))
  router.post(root + '/:jobId/publish', handle((_body, context, url) => documents.publishDocumentJob(url.params.jobId, context, dependencies)))
  router.post(root + '/:jobId/abandon', handle((_body, context, url) => documents.abandonDocumentJob(url.params.jobId, context, dependencies)))
}

module.exports = { registerDocumentRoutes }
