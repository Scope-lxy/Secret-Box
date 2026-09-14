window.createArticleDocumentImport = function createArticleDocumentImport(bridge) {
  const $ = (id) => document.getElementById(id)
  const nodes = {
    panel: $('articleDocumentPanel'), folder: $('articleDocumentFolder'),
    selectFolder: $('articleDocumentSelectFolder'), drop: $('articleDocumentDrop'),
    summary: $('articleDocumentSummary'), progress: $('articleDocumentProgress'), list: $('articleDocumentList'),
    publish: $('articleDocumentPublish'), continue: $('articleDocumentContinue'), resume: $('articleDocumentResume'),
    drafts: $('articleDocumentDrafts'), filter: $('articleDocumentFilter'), search: $('articleDocumentSearch'),
    pagination: $('articleDocumentPagination'), template: $('articleDocumentTemplate'), replace: $('articleDocumentImageFile'),
    author: $('articleDocumentBatchAuthor'), authorApply: $('articleDocumentBatchAuthorApply'), authorRow: $('articleDocumentAuthorRow'),
    retryQuery: $('articleDocumentRetryQuery'),
  }
  if (!nodes.panel) return null
  const state = { context: {}, job: null, page: 1, filter: '', q: '', timer: null, generation: 0, busy: false, active: false, uploads: null, imageTarget: null }
  window.isArticleDocumentUploading = () => state.busy
  const escape = bridge.escapeHtml
  const isProcessing = () => state.busy || ['queued', 'processing'].includes(state.job?.status)
  const request = (suffix = '', body, query = {}) => bridge.apiRequest('/api/admin/articles/documents' + suffix + '?' + new URLSearchParams({ ...state.context, ...query }), body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
  const lock = (locked) => window.dispatchEvent(new CustomEvent('content-import-target-lock', { detail: { locked } }))
  const setMessage = (message) => { nodes.progress.textContent = message }
  const fail = (error) => { setMessage(error.message || '操作失败，请重试'); bridge.showToast(error.message || '操作失败') }
  const stop = () => { clearTimeout(state.timer); state.timer = null; state.generation++ }

  function render() {
    const job = state.job, counts = job?.counts || {}
    const ready = counts.ready || 0
    nodes.summary.textContent = job ? '共 ' + job.total + ' 篇 · 可导入 ' + ready + ' · 需处理 ' + (counts.needs_attention || 0) + ' · 重复 ' + (counts.duplicate || 0) + ' · 失败 ' + (counts.failed || 0) + ' · 已导入 ' + (counts.imported || 0) + (job.skippedCount ? ' · 跳过 ' + job.skippedCount + ' 个非文章文件或辅助目录' : '') : '选择文件夹开始'
    nodes.publish.textContent = '确认导入全部 ' + ready + ' 篇'
    nodes.publish.disabled = !ready || isProcessing()
    nodes.publish.classList.toggle('hidden', !job || job.status === 'complete')
    nodes.continue.classList.toggle('hidden', !state.uploads && (!job || !['uploading', 'interrupted'].includes(job.status)))
    nodes.continue.textContent = state.uploads ? '继续上传' : job?.status === 'uploading' ? '处理已上传文件' : '继续准备'
    nodes.selectFolder.disabled = isProcessing()
    nodes.drop.setAttribute('aria-disabled', String(isProcessing()))
    nodes.drop.tabIndex = isProcessing() ? -1 : 0
    if (isProcessing()) nodes.drop.classList.remove('is-dragging')
    const missingAuthors = (job?.items || []).filter((item) => !item.author && item.status === 'needs_attention' && (!state.q || [item.title, item.filePath].join(' ').includes(state.q)))
    nodes.authorRow.classList.toggle('hidden', !missingAuthors.length)
    nodes.authorApply.textContent = '补充 ' + missingAuthors.length + ' 篇缺失账号'
    nodes.list.innerHTML = (job?.previewItems || []).map((item) => {
      const preview = bridge.renderReadingPreviewCard({ ...item, coverUrl: bridge.coverImageUrl(item.coverImage), bodyHtml: item.renderedHtml || '<p>' + escape(item.error || '等待文档准备') + '</p>' })
      const issueText = [...(item.issues || []).map((issue) => issue.message), ...(item.warnings || [])]
      const images = (item.imageSlots || []).filter((slot) => slot.status === 'failed').map((slot) =>
        '<div class="article-document-image-issue"><span>' + escape(slot.kind === 'cover' ? '封面' : '正文图 ' + (slot.occurrence + 1)) + '：' + escape(slot.error) + '</span><div>' +
        ['retry', 'replace', 'remove'].map((action, index) => '<button class="btn-text" type="button" data-doc-image="' + action + '" data-item="' + escape(item.id) + '" data-slot="' + escape(slot.id) + '">' + ['重试', '本地替换', '移除该图'][index] + '</button>').join('') + '</div></div>').join('')
      return '<article class="article-import-entry article-document-entry" data-document-id="' + escape(item.id) + '">' +
        (bridge.renderArticleImportMetadata ? bridge.renderArticleImportMetadata(item, 'document', 'data-doc-cleanup="' + escape(item.id) + '" data-doc-revision="' + escape(item.revision) + '"') : '<div class="article-import-meta"><span>' + escape(item.fileName || String(item.filePath || '').split(/[\\/]/u).pop() || '') + '</span></div>') +
        '<div class="article-import-reading-card-viewport"><div class="article-reading-preview article-reading-layout article-reading-card-scroll article-reading-preview--stacked article-reading-layout--stacked">' +
        preview.headerHtml + '<div class="article-reading-body">' + preview.bodyHtml + '</div></div>' +
        '<div class="article-import-card-tools"><button class="article-import-tool-button article-import-tool-button--danger" data-doc-remove="' + escape(item.id) + '" aria-label="从本批次移除" title="从本批次移除" type="button">' + bridge.icons.delete + '</button>' +
        (!['duplicate', 'failed', 'waiting_upload', 'processing', 'pending'].includes(item.status) ? '<button class="article-import-tool-button" data-doc-edit="' + escape(item.id) + '" aria-label="编辑文档文章" title="编辑文档文章" type="button">' + bridge.icons.edit + '</button>' : '') +
        '</div></div>' +
        (issueText.length ? '<p class="article-import-warning">' + issueText.map(escape).join('；') + '</p>' : '') +
        (item.error ? '<p class="article-import-warning">' + escape(item.error) + '</p>' : '') + images +
        '</article>'
    }).join('') || '<div class="import-empty">' + (job ? (job.status === 'complete' ? '本批处理完成，可以继续选择下一个文件夹。' : '当前筛选没有文章。') : '可直接选择“下载”，读取各账号子目录里的文章。') + '</div>'
    nodes.list.querySelectorAll('img').forEach((image) => { image.loading = 'lazy' })
    nodes.list.querySelectorAll('button').forEach((button) => { button.disabled = isProcessing() })
    const pages = job?.pagination
    nodes.pagination.innerHTML = pages && pages.pageCount > 1
      ? '<button class="btn-ghost" type="button" data-doc-page="' + (pages.page - 1) + '"' + (pages.page <= 1 ? ' disabled' : '') + '>上一页</button><span>' + pages.page + ' / ' + pages.pageCount + ' 页</span><button class="btn-ghost" type="button" data-doc-page="' + (pages.page + 1) + '"' + (pages.page >= pages.pageCount ? ' disabled' : '') + '>下一页</button>' : ''
  }

  async function refresh() {
    if (!state.job || !state.active) return
    const generation = ++state.generation, id = state.job.id
    clearTimeout(state.timer)
    try {
      const result = await request('/' + encodeURIComponent(id), undefined, { page: state.page, filter: state.filter, q: state.q })
      if (generation !== state.generation || !state.active || state.job?.id !== id) return
      state.job = result
      state.page = result.pagination.page
      nodes.retryQuery.classList.add('hidden')
      render()
      if (['queued', 'processing'].includes(result.status)) {
        setMessage('正在识别、去重并准备图片，完成后可确认导入。')
        state.timer = setTimeout(refresh, 1500)
      } else if (result.status === 'complete') { lock(false); setMessage('本批处理完成。') }
      else if (result.status === 'interrupted') setMessage('准备曾中断，已保存的编辑和成功图片仍保留，可继续准备。')
      else if (result.status !== 'uploading') setMessage('准备完成。可先导入全部正常文章，其余项目处理后再确认。')
    } catch (error) {
      if (generation !== state.generation) return
      nodes.retryQuery.classList.remove('hidden')
      fail(error)
    }
  }

  async function mutation(suffix, body = {}) {
    state.busy = true
    render()
    try { await request('/' + encodeURIComponent(state.job.id) + suffix, body) }
    catch (error) { state.busy = false; await refresh(); throw error }
    finally { state.busy = false }
    await refresh()
  }

  async function findDrafts() {
    const contextKey = JSON.stringify(state.context), generation = state.generation
    try {
      const result = await request()
      if (!state.active || contextKey !== JSON.stringify(state.context) || generation !== state.generation) return
      nodes.drafts.innerHTML = (result.jobs || []).map((job) => '<option value="' + escape(job.id) + '">' + escape(new Date(job.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })) + ' · ' + job.total + ' 份</option>').join('')
      nodes.resume.classList.toggle('hidden', !result.jobs?.length)
    } catch (error) { fail(error) }
  }

  async function readRecord(record, id) {
    try {
      const bytes = new Uint8Array(await record.file.arrayBuffer())
      let binary = ''
      for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768))
      return { id, base64: btoa(binary) }
    } catch (error) { return { id, error: record.path + '：' + (error.message || '无法读取文件') } }
  }

  async function uploadRemaining() {
    if (!state.uploads) return
    state.busy = true
    render()
    try {
      if (!state.job) state.job = await request('', { requestId: state.uploads.requestId, skippedCount: state.uploads.skipped, files: state.uploads.records.map((record) => ({ path: record.path, size: record.size })) })
      const job = await request('/' + encodeURIComponent(state.job.id))
      const pending = state.uploads.records.filter((_record, index) => job.items[index]?.status === 'waiting_upload')
      for (const group of window.ArticleDocumentFiles.chunks(pending)) {
        const files = []
        for (const record of group) files.push(await readRecord(record, job.items[state.uploads.records.indexOf(record)].id))
        await request('/' + encodeURIComponent(job.id) + '/files', { files })
        setMessage('已上传 ' + (state.uploads.records.length - pending.length + pending.indexOf(group[group.length - 1]) + 1) + '/' + state.uploads.records.length + ' 份；跳过 ' + state.uploads.skipped + ' 个非文章文件或辅助目录')
      }
      state.uploads = null
      await request('/' + encodeURIComponent(job.id) + '/start', {})
    } finally { state.busy = false; render() }
    await refresh()
  }

  async function acceptSelection(selection) {
    if (isProcessing()) throw new Error('当前任务正在处理，请完成后再选择文件夹')
    const begin = async () => {
      stop()
      if (state.job && !['complete', 'abandoned'].includes(state.job.status)) await request('/' + encodeURIComponent(state.job.id) + '/abandon', {})
      state.page = 1; state.filter = ''; state.q = ''; nodes.filter.value = ''; nodes.search.value = ''
      state.busy = true
      state.job = null
      state.uploads = { ...selection, requestId: crypto.randomUUID() }
      lock(true)
      render()
      try {
        state.busy = false
        await uploadRemaining()
      } catch (error) { state.busy = false; render(); if (!state.job) lock(false); fail(error) }
    }
    if (state.job && !['complete', 'abandoned'].includes(state.job.status)) bridge.openConfirm({
      title: '放弃当前批次并导入新文档？', message: '已经导入的文章会保留，未导入的草稿和编辑将被放弃。', confirmLabel: '替换当前批次', danger: true,
      onConfirm: () => { void begin().catch(fail) },
    })
    else await begin()
  }
  const selected = (input) => { try { void acceptSelection(window.ArticleDocumentFiles.fromFiles(input.files)).catch(fail) } catch (error) { fail(error) } finally { input.value = '' } }

  function selectFolder() {
    if (isProcessing()) return
    nodes.folder.value = ''
    nodes.folder.click()
  }
  nodes.selectFolder.addEventListener('click', selectFolder)
  nodes.drop.addEventListener('click', selectFolder)
  nodes.drop.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!event.repeat) selectFolder()
  })
  nodes.folder.addEventListener('change', () => selected(nodes.folder))
  nodes.drop.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (isProcessing()) { event.dataTransfer.dropEffect = 'none'; return }
    event.dataTransfer.dropEffect = 'copy'
    nodes.drop.classList.add('is-dragging')
  })
  nodes.drop.addEventListener('dragleave', (event) => {
    if (!nodes.drop.contains(event.relatedTarget)) nodes.drop.classList.remove('is-dragging')
  })
  nodes.drop.addEventListener('drop', (event) => {
    event.preventDefault()
    nodes.drop.classList.remove('is-dragging')
    if (isProcessing()) return
    void window.ArticleDocumentFiles.fromDrop(event.dataTransfer).then(acceptSelection).catch(fail)
  })
  nodes.continue.addEventListener('click', () => { void (state.uploads ? uploadRemaining() : mutation('/start')).catch(fail) })
  nodes.retryQuery.addEventListener('click', refresh)
  $('articleDocumentResumeButton').addEventListener('click', () => {
    const id = nodes.drafts.value
    if (!id) return
    state.job = { id }; lock(true); nodes.resume.classList.add('hidden'); void refresh()
  })
  nodes.filter.addEventListener('change', () => { state.filter = nodes.filter.value; state.page = 1; void refresh() })
  let searchTimer
  nodes.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = nodes.search.value.trim(); state.page = 1; void refresh() }, 300) })
  nodes.pagination.addEventListener('click', (event) => { const button = event.target.closest('[data-doc-page]'); if (button) { state.page = Number(button.dataset.docPage); void refresh() } })
  nodes.publish.addEventListener('click', async () => {
    if (isProcessing()) return
    try {
      state.busy = true; render()
      const result = await request('/' + encodeURIComponent(state.job.id) + '/publish', {})
      bridge.showToast('已导入 ' + result.importedCount + ' 篇文章')
      state.busy = false
      await refresh()
    } catch (error) { state.busy = false; render(); fail(error) }
  })
  nodes.authorApply.addEventListener('click', () => {
    const ids = (state.job?.items || []).filter((item) => !item.author && item.status === 'needs_attention' && (!state.q || [item.title, item.filePath].join(' ').includes(state.q))).map((item) => item.id)
    void mutation('/author', { ids, author: nodes.author.value.trim() }).catch(fail)
  })
  nodes.list.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button || isProcessing()) return
    const id = button.dataset.docEdit || button.dataset.docRemove || button.dataset.docCleanup || button.dataset.item
    const item = state.job?.previewItems.find((entry) => entry.id === id)
    if (!item) return
    if (button.dataset.docEdit) bridge.openEditor(item, 'document')
    else if (button.dataset.docRemove) void mutation('/items/' + encodeURIComponent(id) + '/remove').catch(fail)
    else if (button.dataset.docCleanup) void mutation('/items/' + encodeURIComponent(id) + '/cleanup', { revision: item.revision }).catch(fail)
    else if (button.dataset.docImage === 'replace') { state.imageTarget = { itemId: id, slotId: button.dataset.slot, revision: item.revision }; nodes.replace.click() }
    else if (button.dataset.docImage) void mutation('/items/' + encodeURIComponent(id) + '/image', { action: button.dataset.docImage, slotId: button.dataset.slot, revision: item.revision }).catch(fail)
  })
  nodes.replace.addEventListener('change', async () => {
    const file = nodes.replace.files?.[0], target = state.imageTarget
    nodes.replace.value = ''
    if (!file || !target || isProcessing()) return
    let uploaded
    try {
      state.busy = true; render(); setMessage('正在上传替换图片…')
      uploaded = await bridge.uploadImage(file)
      state.busy = false
      await mutation('/items/' + encodeURIComponent(target.itemId) + '/image', { ...target, assetId: uploaded.id, action: 'replace' })
    } catch (error) {
      state.busy = false; render(); fail(error)
      if (uploaded) await bridge.reclaim([uploaded.id])
    }
  })
  nodes.template.addEventListener('click', () => {
    const content = ['# 文章标题', '', '账号名称丨2026-09-13 09:30:00', '', '将这里替换为已经整理好的正文。', '', '---', '', '原文链接：<https://example.com/article>', ''].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '文章导入模板.md'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  return {
    isProcessing,
    open(context) { stop(); state.context = { ...context }; state.active = true; state.job = null; state.uploads = null; state.page = 1; state.filter = ''; state.q = ''; nodes.filter.value = ''; nodes.search.value = ''; setMessage(''); render(); void findDrafts() },
    close() { state.active = false; stop() },
    hasJob() { return Boolean(state.job && !['complete', 'abandoned'].includes(state.job.status)) },
    abandonThen(action) {
      if (isProcessing()) { bridge.showToast('文档正在准备，请完成后再切换来源'); return }
      bridge.openConfirm({ title: '放弃未导入的文档草稿？', message: '已导入的文章会保留；切换来源会放弃本批尚未导入的文档和编辑。', confirmLabel: '放弃并切换', danger: true,
        onConfirm: () => { void mutation('/abandon').then(() => { state.job = null; lock(false); render(); action() }).catch(fail) },
      })
    },
    updateContext(context) { if (!state.job) { state.context = { ...context }; void findDrafts() } },
    async save(editingItem, payload, extra) {
      const item = state.job.previewItems.find((entry) => entry.id === editingItem.id) || editingItem
      const patch = { revision: item.revision, title: payload.title }
      for (const field of ['author', 'bodyMarkdown', 'publishedAt']) if (payload[field] !== item[field]) patch[field] = payload[field]
      if ((payload.coverImage?.id || '') !== (item.coverImage?.id || '')) patch.coverImage = payload.coverImage?.id ? { id: payload.coverImage.id } : null
      if (extra.sourceUrl !== item.sourceUrl) patch.sourceUrl = extra.sourceUrl
      if (extra.acknowledgeMetadata) patch.acknowledgeMetadata = true
      await mutation('/items/' + encodeURIComponent(item.id), { patch })
    },
  }
}
