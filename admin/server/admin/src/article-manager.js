(function initArticleManager() {
  const nodes = {
    batchDelete: document.querySelector('#articleBatchDeleteBtn'),
    body: document.querySelector('#articleBodyEditor'),
    cancelEditor: document.querySelector('#articleEditorCancel'),
    cover: document.querySelector('#articleCoverInput'),
    coverPreview: document.querySelector('#articleCoverPreview'),
    coverRemove: document.querySelector('#articleCoverRemoveBtn'),
    coverUpload: document.querySelector('#articleCoverUploadInput'),
    coverUploadButton: document.querySelector('#articleCoverUploadBtn'),
    coverUploadStatus: document.querySelector('#articleCoverUploadStatus'),
    create: document.querySelector('#articleCreateBtn'),
    editorModal: document.querySelector('#articleEditorModal'),
    editorPreviewBody: document.querySelector('#articleEditorPreviewBody'),
    editorPreviewHeader: document.querySelector('#articleEditorPreviewHeader'),
    editorStatus: document.querySelector('#articleEditorStatus'),
    editorTitle: document.querySelector('#articleEditorTitle'),
    importList: document.querySelector('#articleImportList'),
    importPanel: document.querySelector('#articleUrlImportPanel'),
    importOpen: document.querySelector('#articleUrlImportBtn'),
    importPublish: document.querySelector('#articleImportPublishBtn'),
    importResultDetail: document.querySelector('#articleImportResultDetail'),
    importStart: document.querySelector('#articleImportStartBtn'),
    importSummary: document.querySelector('#articleImportSummary'),
    importUrls: document.querySelector('#articleImportUrls'),
    importValidCount: document.querySelector('#articleImportValidCount'),
    list: document.querySelector('#articleList'),
    listSave: document.querySelector('#articleListSaveBtn'),
    pagination: document.querySelector('#articlePagination'),
    previewBody: document.querySelector('#articlePreviewBody'),
    previewClose: document.querySelector('#articlePreviewClose'),
    previewCleanupSummary: document.querySelector('#articlePreviewCleanupSummary'),
    previewHeader: document.querySelector('#articlePreviewHeader'),
    previewModal: document.querySelector('#articlePreviewModal'),
    previewRemovedBody: document.querySelector('#articlePreviewRemovedBody'),
    previewRemovedSection: document.querySelector('#articlePreviewRemovedSection'),
    previewRestoreTail: document.querySelector('#articlePreviewRestoreTail'),
    publish: document.querySelector('#articlePublishBtn'),
    publishAt: document.querySelector('#articlePublishAtInput'),
    author: document.querySelector('#articleAuthorInput'),
    refresh: document.querySelector('#articleRefreshBtn'),
    selectAll: document.querySelector('#articleSelectAll'),
    title: document.querySelector('#articleTitleInput'),
  }

  if (!nodes.list) return

  const state = {
    contextKey: '',
    dirty: new Set(),
    editingArticle: null,
    editorInitialValues: '',
    editorMode: '',
    editorPreviewGeneration: 0,
    editorPreviewTimer: null,
    editorSupersededCoverIds: new Set(),
    editorUploadedCoverIds: new Set(),
    editingId: '',
    importJobId: '',
    importItems: [],
    importJobStatus: '',
    importEditedIds: new Set(),
    importPollGeneration: 0,
    importPolling: false,
    importPollTimer: null,
    importProgress: { total: 0, processed: 0, succeeded: 0, failed: 0 },
    importQueryFailed: false,
    importContext: { miniProgramId: '', poolId: '' },
    removedImportIds: new Set(),
    importTransientCoverIds: new Set(),
    previewImportId: '',
    items: [],
    page: 1,
    pageSize: 10,
    selected: new Set(),
    total: 0,
    uploadingCover: false,
    importEditingId: '',
  }

  // Lucide Static v0.468.0 (ISC): trash-2, pencil, refresh-cw.
  const importToolIcons = {
    delete: '<svg class="article-import-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    edit: '<svg class="article-import-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
    retry: '<svg class="article-import-tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function currentContext() {
    return {
      miniProgramId: getCurrentMiniProgram?.()?.id || document.querySelector('#mpSelect')?.value || '',
      poolId: getEditingContentPoolId?.() || document.querySelector('#contentPoolSelect')?.value || '',
    }
  }

  function clearLegacyImportJobPointers() {
    try {
      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index)
        if (key?.startsWith('secretbox:article-import:')) window.sessionStorage.removeItem(key)
      }
    } catch (_error) {}
  }

  function stopImportPolling() {
    if (state.importPollTimer) window.clearTimeout(state.importPollTimer)
    state.importPollTimer = null
    state.importPollGeneration += 1
    state.importPolling = false
  }

  function articlePath(path = '', query = {}, context = currentContext()) {
    const params = new URLSearchParams({ ...context, ...query })
    Object.keys(query).forEach((key) => {
      if (query[key] === '' || query[key] === undefined || query[key] === null) params.delete(key)
    })
    const suffix = params.size ? `?${params}` : ''
    return `/api/admin/articles${path}${suffix}`
  }

  function formatDateTime(value) {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  }

  function renderReadingMeta(author, publishedAt, fallbackText = '') {
    const authorText = String(author || '').trim()
    const dateText = publishedAt ? formatDateTime(publishedAt) : String(fallbackText || '')
    if (!authorText && !dateText) return ''
    return `<span>${escapeHtml(authorText || '未署名')}</span><span>${escapeHtml(dateText)}</span>`
  }

  function renderReadingHeader({ title = '', author = '', publishedAt = '', metaText = '', coverUrl = '' } = {}) {
    const titleText = String(title || '').trim() || '未命名文章'
    const meta = renderReadingMeta(author, publishedAt, metaText)
    const cover = coverUrl
      ? `<img class="article-reading-cover" src="${escapeHtml(coverUrl)}" alt="">`
      : '<div class="article-reading-cover article-reading-cover--empty" role="img" aria-label="暂无封面">暂无封面</div>'
    return `<div class="article-reading-header article-reading-header--stacked"><div class="article-reading-heading"><h1>${escapeHtml(titleText)}</h1>${meta ? `<p class="article-reading-meta">${meta}</p>` : ''}</div>${cover}</div>`
  }

  function hasNonImageContentBetween(container, startNode, endNode) {
    const range = container.ownerDocument.createRange()
    range.setStartAfter(startNode)
    range.setEndBefore(endNode)
    const holder = container.ownerDocument.createElement('div')
    holder.appendChild(range.cloneContents())
    holder.querySelectorAll('img').forEach((node) => node.remove())
    return Boolean(String(holder.textContent || '').trim() || holder.querySelector('hr'))
  }

  function applyReadingImageSpacing(element) {
    const images = Array.from(element.querySelectorAll?.('img') || [])
    images.forEach((image, index) => {
      const block = image.closest?.('.article-reading-block')
      if (block?.classList.contains('article-reading-block--media')) {
        const blockImages = Array.from(block.querySelectorAll('img'))
        image.style.marginTop = '0'
        image.style.marginBottom = blockImages.indexOf(image) < blockImages.length - 1
          ? 'var(--article-reading-media-gap)'
          : '0'
        return
      }
      const previous = images[index - 1]
      const next = images[index + 1]
      const followsImage = previous && !hasNonImageContentBetween(element, previous, image)
      const precedesImage = next && !hasNonImageContentBetween(element, image, next)
      const beforeRange = element.ownerDocument.createRange()
      beforeRange.selectNodeContents(element)
      beforeRange.setEndBefore(image)
      const afterRange = element.ownerDocument.createRange()
      afterRange.selectNodeContents(element)
      afterRange.setStartAfter(image)
      const hasContentBefore = Boolean(String(beforeRange.toString() || '').trim())
      const hasContentAfter = Boolean(String(afterRange.toString() || '').trim())
      image.style.marginTop = followsImage ? '0' : (hasContentBefore ? 'var(--article-reading-content-gap)' : '0')
      image.style.marginBottom = precedesImage
        ? 'var(--article-reading-media-gap)'
        : (hasContentAfter ? 'var(--article-reading-content-gap)' : '0')
    })
  }

  function decorateReadingBodyElement(element) {
    if (!element || !element.children) return
    Array.from(element.children).forEach((child) => {
      child.classList.add('article-reading-block')
      const media = child.querySelector?.('img, hr')
      if (!media) return
      const text = String(child.textContent || '').trim()
      const nonMedia = child.cloneNode(true)
      nonMedia.querySelectorAll?.('img, hr').forEach((node) => node.remove())
      if (!text && !String(nonMedia.textContent || '').trim()) child.classList.add('article-reading-block--media')
    })
    applyReadingImageSpacing(element)
  }

  function normalizeReadingBodyHtml(value) {
    const source = String(value || '')
    if (!source.trim() || typeof DOMParser === 'undefined') return source
    const document = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html')
    decorateReadingBodyElement(document.body)
    return document.body.innerHTML
  }

  function renderReadingPreviewCard(data) {
    const { title = '', author = '', publishedAt = '', metaText = '', coverUrl = '', bodyHtml = '' } = data || {}
    return {
      headerHtml: renderReadingHeader({ title, author, publishedAt, metaText, coverUrl }),
      bodyHtml: normalizeReadingBodyHtml(bodyHtml),
    }
  }

  function toDateTimeLocal(value) {
    const date = value ? new Date(value) : new Date()
    if (Number.isNaN(date.getTime())) return ''
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    return local.toISOString().slice(0, 16)
  }

  function renderCover(coverImage, title = '') {
    const url = coverImageUrl(coverImage)
    const originalUrl = coverImage && typeof coverImage === 'object'
      ? coverImage.originalUrl || coverImage.mediumUrl || url
      : url
    return url
      ? `<a class="article-list-cover-link" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="查看${escapeHtml(title || '文章')}封面原图"><img class="article-list-cover" src="${escapeHtml(url)}" alt="${escapeHtml(title)}"></a>`
      : '<div class="article-list-cover article-list-cover--empty">无封面</div>'
  }

  function coverImageUrl(coverImage) {
    if (!coverImage) return ''
    if (typeof coverImage === 'string') return coverImage
    if (!coverImage.processingProfile && coverImage.usage === 'article' && coverImage.originalUrl) return coverImage.originalUrl
    return coverImage.mediumUrl || coverImage.thumbUrl || coverImage.originalUrl
      || (coverImage.id ? `/api/media/image?id=${encodeURIComponent(coverImage.id)}&variant=thumb` : '')
  }

  function syncSelection() {
    const visibleIds = state.items.map((item) => item.id)
    const selectedCount = visibleIds.filter((id) => state.selected.has(id)).length
    nodes.selectAll.checked = Boolean(visibleIds.length) && selectedCount === visibleIds.length
    nodes.selectAll.indeterminate = selectedCount > 0 && selectedCount < visibleIds.length
    nodes.batchDelete.disabled = state.selected.size === 0
    nodes.listSave.disabled = state.dirty.size === 0
  }

  function renderList() {
    nodes.list.innerHTML = state.items.length ? state.items.map((item, index) => `
      <tr>
        <td data-label="选择"><input type="checkbox" data-article-select="${escapeHtml(item.id)}" aria-label="选择文章" ${state.selected.has(item.id) ? 'checked' : ''}></td>
        <td data-label="ID">${(state.page - 1) * state.pageSize + index + 1}</td>
        <td data-label="标签"><input class="content-label-input" data-article-label="${escapeHtml(item.id)}" value="${escapeHtml(item.label || '默认')}" placeholder="标签" aria-label="文章标签"></td>
        <td data-label="标题"><input class="article-list-title" data-article-title="${escapeHtml(item.id)}" value="${escapeHtml(item.title || '')}" aria-label="文章标题"></td>
        <td data-label="作者"><input class="article-list-author" data-article-author="${escapeHtml(item.id)}" value="${escapeHtml(item.author || '')}" placeholder="请输入作者" aria-label="文章作者（必填）" required></td>
        <td data-label="封面">${renderCover(item.coverImage, item.title)}</td>
        <td data-label="发布时间"><input class="article-list-published-at" type="datetime-local" data-article-published-at="${escapeHtml(item.id)}" value="${escapeHtml(toDateTimeLocal(item.publishedAt))}" aria-label="发布时间"></td>
        <td data-label="操作"><div class="content-row-actions"><button class="btn-text" data-article-edit="${escapeHtml(item.id)}" type="button">编辑</button><button class="btn-text btn-danger" data-article-delete="${escapeHtml(item.id)}" type="button">删除</button></div></td>
      </tr>
    `).join('') : '<tr class="article-list-empty"><td colspan="8">暂无文章</td></tr>'
    renderArticlePagination()
    syncSelection()
  }

  function renderArticlePagination() {
    nodes.pagination.innerHTML = window.AdminPagination?.render('articles', {
      page: state.page,
      pageSize: state.pageSize,
      total: state.total,
      totalPages: Math.max(1, Math.ceil(state.total / state.pageSize)),
    }) || ''
  }

  async function loadArticles() {
    const context = currentContext()
    const contextKey = `${context.miniProgramId}:${context.poolId}`
    if (state.contextKey && state.contextKey !== contextKey) {
      state.page = 1
      state.selected.clear()
      stopImportPolling()
      state.importJobId = ''
      state.importItems = []
      state.importJobStatus = ''
      state.importProgress = { total: 0, processed: 0, succeeded: 0, failed: 0 }
      state.importQueryFailed = false
      state.importEditedIds.clear()
      nodes.importUrls.value = ''
    }
    state.contextKey = contextKey
    nodes.list.innerHTML = '<tr><td colspan="7">正在加载文章…</td></tr>'
    try {
      const result = await apiRequest(articlePath('', {
        page: state.page,
        pageSize: state.pageSize,
      }))
      state.items = Array.isArray(result.items) ? result.items : []
      state.total = Number(result.pagination?.total ?? result.total ?? state.items.length)
      state.page = Number(result.pagination?.page || state.page)
      state.selected = new Set([...state.selected].filter((id) => state.items.some((item) => item.id === id)))
      state.dirty.clear()
      renderList()
    } catch (error) {
      nodes.list.innerHTML = '<tr><td colspan="8">文章加载失败，请稍后重试</td></tr>'
      showToast(error.message || '文章加载失败')
    }
  }

  function emptyArticle() {
    return {
      bodyMarkdown: '',
      coverImage: null,
      favoriteCount: 0,
      id: makeId('article'),
      label: '默认',
      likeCount: 0,
      publishedAt: new Date().toISOString(),
      sourceHash: '',
      sourceUrl: '',
      title: '',
      author: '',
    }
  }

  function setCoverUploadStatus(message, status = '') {
    if (!nodes.coverUploadStatus) return
    nodes.coverUploadStatus.textContent = message
    nodes.coverUploadStatus.dataset.status = status
  }

  function selectedCoverImage() {
    const id = nodes.cover.value.trim()
    if (!id) return null
    return (imageState || []).find((item) => item.id === id)
      || (state.editingArticle?.coverImage?.id === id ? state.editingArticle.coverImage : null)
      || { id }
  }

  function updateCoverPreview() {
    const asset = selectedCoverImage()
    const url = coverImageUrl(asset)
    nodes.coverPreview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="封面预览">` : '<span>暂无封面</span>'
    const uploadLabel = url ? '替换封面' : '上传封面'
    nodes.coverUploadButton.setAttribute('aria-label', uploadLabel)
    nodes.coverUploadButton.title = uploadLabel
    nodes.coverRemove.classList.toggle('hidden', !asset)
    updateEditorPreviewHeader()
  }

  function updateEditorPreviewHeader() {
    const preview = renderReadingPreviewCard({
      title: nodes.title.value,
      author: nodes.author.value,
      publishedAt: nodes.publishAt.value,
      coverUrl: coverImageUrl(selectedCoverImage()),
    })
    nodes.editorPreviewHeader.innerHTML = preview.headerHtml
  }

  async function reclaimTransientCoverIds(ids) {
    const values = [...new Set([...ids].map((id) => String(id || '').trim()).filter(Boolean))]
    if (!values.length) return
    try {
      const reclaimed = new Set()
      for (let index = 0; index < values.length; index += 20) {
        const batch = values.slice(index, index + 20)
        const result = await apiRequest('/api/admin/images/reclaim', {
          method: 'POST',
          body: JSON.stringify({ ids: batch }),
        })
        ;(result.reclaimed || []).forEach((id) => reclaimed.add(id))
      }
      imageState = (imageState || []).filter((item) => !reclaimed.has(item.id))
      values.forEach((id) => {
        state.editorUploadedCoverIds.delete(id)
        state.importTransientCoverIds.delete(id)
      })
    } catch (error) {
      showToast(error.message || '临时封面清理失败，请稍后重试')
    }
  }

  async function cleanupEditorUploads(preserveId = '', { commit = false } = {}) {
    const disposable = [
      ...[...state.editorUploadedCoverIds].filter((id) => id !== preserveId),
      ...(commit ? state.editorSupersededCoverIds : []),
    ]
    await reclaimTransientCoverIds(disposable)
    state.editorUploadedCoverIds.clear()
    state.editorSupersededCoverIds.clear()
  }

  async function uploadCover(file) {
    if (state.uploadingCover || !file) return
    if (!isArticleCoverFile(file)) {
      setCoverUploadStatus('封面仅支持 JPG、PNG 或 WebP 图片', 'error')
      showToast('封面仅支持 JPG、PNG 或 WebP 图片')
      nodes.coverUpload.value = ''
      return
    }
    state.uploadingCover = true
    nodes.coverUploadButton.disabled = true
    nodes.coverUpload.disabled = true
    setCoverUploadStatus('正在上传封面图片…', 'uploading')
    showToast('正在上传封面图片…')
    try {
      const previousCoverId = nodes.cover.value.trim()
      const data = await uploadImageFileToCos(file, {
        label: file.name.replace(/\.[^.]+$/, ''),
        usage: 'article',
        onProgress: (message) => setCoverUploadStatus(message, 'uploading'),
      })
      const coverImage = data.item
      imageState = [coverImage, ...(imageState || []).filter((item) => item.id !== coverImage.id)]
      state.editingArticle = { ...(state.editingArticle || emptyArticle()), coverImage }
      const previousWasCurrentUpload = state.editorUploadedCoverIds.has(previousCoverId)
      state.editorUploadedCoverIds.add(coverImage.id)
      if (state.editorMode === 'import') state.importTransientCoverIds.add(coverImage.id)
      nodes.cover.value = coverImage.id
      updateCoverPreview()
      if (previousCoverId && previousCoverId !== coverImage.id && previousWasCurrentUpload) {
        await reclaimTransientCoverIds([previousCoverId])
      } else if (previousCoverId && previousCoverId !== coverImage.id && state.importTransientCoverIds.has(previousCoverId)) {
        state.editorSupersededCoverIds.add(previousCoverId)
      }
      setCoverUploadStatus('已上传并选为文章封面', 'success')
      showToast('封面已上传并选中')
    } catch (error) {
      setCoverUploadStatus(error.message || '封面上传失败，请重试', 'error')
      showToast(error.message || '封面上传失败')
    } finally {
      state.uploadingCover = false
      nodes.coverUploadButton.disabled = false
      nodes.coverUpload.disabled = false
      nodes.coverUpload.value = ''
    }
  }

  function editorFormValues() {
    return JSON.stringify({
      bodyMarkdown: nodes.body.value,
      coverImageId: nodes.cover.value,
      publishedAt: nodes.publishAt.value,
      author: nodes.author.value,
      title: nodes.title.value,
      documentSource: state.editorMode === 'document' ? document.querySelector('#articleDocumentSourceInput')?.value : '',
      documentMetadata: state.editorMode === 'document' ? document.querySelector('#articleDocumentMetadataAck')?.checked : false,
    })
  }

  function isEditorDirty() {
    return Boolean(state.editorMode) && editorFormValues() !== state.editorInitialValues
  }

  function updateEditorPreviewChrome() {
    updateCoverPreview()
  }

  function scheduleEditorBodyPreview({ immediate = false } = {}) {
    if (state.editorPreviewTimer) window.clearTimeout(state.editorPreviewTimer)
    const generation = ++state.editorPreviewGeneration
    const render = async () => {
      const bodyMarkdown = nodes.body.value
      if (!bodyMarkdown.trim()) {
        if (generation === state.editorPreviewGeneration) nodes.editorPreviewBody.innerHTML = ''
        return
      }
      try {
        const result = await apiRequest(articlePath('/preview'), {
          method: 'POST',
          body: JSON.stringify({ bodyMarkdown }),
        })
        if (generation !== state.editorPreviewGeneration || nodes.editorModal.classList.contains('hidden')) return
        nodes.editorPreviewBody.innerHTML = result.renderedHtml || ''
        decorateReadingBodyElement(nodes.editorPreviewBody)
      } catch (error) {
        if (generation === state.editorPreviewGeneration) showToast(error.message || '文章预览更新失败')
      }
    }
    if (immediate) void render()
    else state.editorPreviewTimer = window.setTimeout(render, 300)
  }

  function openEditor(article = emptyArticle(), mode = 'content') {
    state.editingArticle = { ...article }
    state.editorMode = mode
    state.editorSupersededCoverIds.clear()
    state.editorUploadedCoverIds.clear()
    const exists = mode === 'content' && state.items.some((item) => item.id === article.id)
    state.editingId = exists ? article.id : ''
    state.importEditingId = mode === 'import' ? article.id : ''
    nodes.editorTitle.textContent = mode === 'import' ? '编辑导入文章' : exists ? '编辑文章' : '新增文章'
    nodes.editorStatus.textContent = mode === 'import'
      ? '保存后更新本次导入内容，确认导入前不会发布。'
      : exists ? '保存后将立即更新当前内容池中的文章。' : '保存后将立即发布到当前内容池。'
    nodes.title.value = article.title || ''
    nodes.author.value = article.author || ''
    nodes.body.value = article.bodyMarkdown || ''
    nodes.cover.value = article.coverImage?.id || ''
    nodes.publishAt.value = mode === 'document'
      ? (article.publishedAt ? new Date(new Date(article.publishedAt).getTime() + 8 * 3600000).toISOString().slice(0, 19) : '')
      : toDateTimeLocal(article.publishedAt)
    nodes.publishAt.step = mode === 'document' ? '1' : '60'
    document.querySelector('#articleDocumentEditorFields')?.classList.toggle('hidden', mode !== 'document')
    if (mode === 'document') {
      nodes.editorTitle.textContent = '编辑导入文档'
      nodes.editorStatus.textContent = '保存后更新本批文档，确认导入后才加入内容池；时间使用北京时间。'
      nodes.author.placeholder = '账号 / 作者（必填）'
      document.querySelector('#articleDocumentSourceInput').value = article.sourceUrl || ''
      document.querySelector('#articleDocumentMetadataAck').checked = false
      document.querySelector('#articleDocumentMetadataRow').classList.toggle('hidden', !(article.issues || []).some((issue) => issue.field === 'metadata'))
    } else nodes.author.placeholder = '请输入文章作者（可留空）'
    updateCoverPreview()
    setCoverUploadStatus('')
    const editorPreview = renderReadingPreviewCard({
      title: article.title,
      author: article.author,
      publishedAt: article.publishedAt,
      coverUrl: coverImageUrl(article.coverImage),
      bodyHtml: article.renderedHtml || '',
    })
    nodes.editorPreviewHeader.innerHTML = editorPreview.headerHtml
    nodes.editorPreviewBody.innerHTML = editorPreview.bodyHtml
    updateEditorPreviewChrome()
    state.editorInitialValues = editorFormValues()
    openModal(nodes.editorModal)
    scheduleEditorBodyPreview({ immediate: !article.renderedHtml })
    requestAnimationFrame(() => nodes.title.focus())
  }

  async function closeEditor({ discard = false } = {}) {
    if (state.editorPreviewTimer) window.clearTimeout(state.editorPreviewTimer)
    state.editorPreviewTimer = null
    state.editorPreviewGeneration += 1
    if (discard) await cleanupEditorUploads()
    closeModal(nodes.editorModal)
    state.editingArticle = null
    state.editingId = ''
    state.importEditingId = ''
    state.editorMode = ''
    state.editorInitialValues = ''
    nodes.coverUpload.value = ''
  }

  function requestCloseEditor() {
    if (!isEditorDirty()) {
      void closeEditor({ discard: true })
      return
    }
    openConfirm({
      title: '放弃未保存修改？',
      message: '当前修改尚未保存，关闭后将无法恢复。',
      confirmLabel: '放弃修改',
      danger: true,
      onConfirm: () => { void closeEditor({ discard: true }) },
    })
  }

  async function removeEditorCover() {
    const coverId = nodes.cover.value.trim()
    nodes.cover.value = ''
    state.editingArticle = { ...(state.editingArticle || emptyArticle()), coverImage: null }
    updateCoverPreview()
    setCoverUploadStatus('')
    if (coverId && state.editorUploadedCoverIds.has(coverId)) {
      await reclaimTransientCoverIds([coverId])
    } else if (coverId && state.importTransientCoverIds.has(coverId)) {
      state.editorSupersededCoverIds.add(coverId)
    }
  }

  function collectArticle() {
    const title = nodes.title.value.trim()
    const author = nodes.author.value.trim() || '轻读手记'
    const bodyMarkdown = nodes.body.value.trim()
    if (state.editorMode === 'document') {
      const coverId = nodes.cover.value.trim()
      const date = nodes.publishAt.value ? new Date(nodes.publishAt.value + '+08:00') : null
      return {
        ...state.editingArticle, title, author: nodes.author.value.trim(), bodyMarkdown,
        publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : '',
        coverImage: coverId ? selectedCoverImage() : null,
      }
    }
    if (!title) throw new Error('请输入文章标题')
    if (!bodyMarkdown) throw new Error('请输入文章正文')
    if (!nodes.publishAt.value) throw new Error('请输入发布时间')
    const publishedAt = new Date(nodes.publishAt.value)
    if (Number.isNaN(publishedAt.getTime())) throw new Error('请输入有效的发布时间')
    const previous = state.editingArticle || emptyArticle()
    const coverImageId = nodes.cover.value.trim()
    return {
      id: previous.id || makeId('article'),
      label: previous.label || '默认',
      title,
      author,
      bodyMarkdown,
      bodyImageAssetIds: previous.bodyImageAssetIds || [],
      publishedAt: publishedAt.toISOString(),
      coverImage: coverImageId ? selectedCoverImage() : null,
      sourceUrl: previous.sourceUrl || '',
      sourceHash: previous.sourceHash || '',
      likeCount: Number(previous.likeCount || 0),
      favoriteCount: Number(previous.favoriteCount || 0),
    }
  }

  async function saveEditor(button) {
    let payload
    try {
      payload = collectArticle()
    } catch (error) {
      showToast(error.message)
      return
    }
    const restore = setButtonsLoading([button], '保存中…')
    try {
      if (state.editorMode === 'document') {
        await documentImport.save(state.editingArticle, payload, {
          sourceUrl: document.querySelector('#articleDocumentSourceInput').value.trim(),
          acknowledgeMetadata: document.querySelector('#articleDocumentMetadataAck').checked,
        })
        await cleanupEditorUploads(payload.coverImage?.id || '', { commit: true })
        await closeEditor()
        showToast('文档草稿已保存')
        return
      }
      if (state.editorMode === 'import') {
        const article = state.importItems.find((item) => item.id === state.importEditingId && item.status === 'success')
        if (!article) throw new Error('当前导入文章不存在，请重新抓取')
        const result = await apiRequest(articlePath('/preview'), {
          method: 'POST',
          body: JSON.stringify({ bodyMarkdown: payload.bodyMarkdown }),
        })
        Object.assign(article, {
          title: payload.title,
          author: payload.author,
          bodyMarkdown: payload.bodyMarkdown,
          coverImage: payload.coverImage,
          publishedAt: payload.publishedAt,
          renderedHtml: result.renderedHtml || '',
        })
        state.importEditedIds.add(article.id)
        await cleanupEditorUploads(payload.coverImage?.id || '', { commit: true })
        await closeEditor()
        renderImportItems()
        showToast('已保存当前文章修改')
        return
      }
      const path = state.editingId ? `/${encodeURIComponent(state.editingId)}` : ''
      await apiRequest(articlePath(path), {
        method: 'POST',
        body: JSON.stringify({ ...currentContext(), article: payload }),
      })
      await cleanupEditorUploads(payload.coverImage?.id || '', { commit: true })
      await closeEditor()
      showToast('文章已保存并发布')
      await loadArticles()
    } catch (error) {
      showToast(error.message || '文章保存失败')
    } finally {
      restore()
    }
  }

  async function showPreview(article) {
    const data = article || collectArticle()
    const renderedHtml = data.renderedHtml || (await apiRequest(articlePath('/preview'), {
      method: 'POST',
      body: JSON.stringify({ bodyMarkdown: data.bodyMarkdown }),
    })).renderedHtml
    const preview = renderReadingPreviewCard({
      title: data.title,
      author: data.author,
      publishedAt: data.publishedAt,
      coverUrl: coverImageUrl(data.coverImage),
      bodyHtml: renderedHtml || '',
    })
    preview.headerHtml = renderReadingHeader({ title: data.title, author: data.author, publishedAt: data.publishedAt, coverUrl: coverImageUrl(data.coverImage) })
    nodes.previewHeader.innerHTML = preview.headerHtml
    nodes.previewBody.innerHTML = preview.bodyHtml
    state.previewImportId = data.removedTailHtml ? data.id : ''
    nodes.previewRemovedSection.classList.toggle('hidden', !data.removedTailHtml)
    nodes.previewRemovedBody.innerHTML = data.removedTailHtml || ''
    nodes.previewCleanupSummary.textContent = data.removedTailHtml ? `${data.tailCleanup?.summary || '已清理推广尾部'}（图片不会恢复）` : ''
    nodes.previewRestoreTail.textContent = data.restoreTail ? '重新移除已恢复文字' : '恢复已移除文字'
    openModal(nodes.previewModal)
  }

  async function deleteArticles(ids) {
    if (!ids.length) return
    if (ids.length >= state.total) {
      showToast('文章至少保留一篇')
      return
    }
    if (!window.confirm(`确定删除 ${ids.length} 篇文章？删除后不可恢复。`)) return
    try {
      for (const id of ids) await apiRequest(articlePath(`/${encodeURIComponent(id)}`), { method: 'DELETE' })
      state.selected.clear()
      showToast('文章已删除')
      await loadArticles()
    } catch (error) {
      showToast(error.message || '文章删除失败')
    }
  }

  function updateInlineArticle(id, patch) {
    const index = state.items.findIndex((item) => item.id === id)
    if (index < 0) return
    state.items[index] = { ...state.items[index], ...patch }
    state.dirty.add(id)
    syncSelection()
  }

  async function saveInlineArticles() {
    const changed = state.items.filter((item) => state.dirty.has(item.id))
    if (!changed.length) return
    if (changed.some((item) => !String(item.title || '').trim() || !String(item.author || '').trim() || Number.isNaN(new Date(item.publishedAt).getTime()))) {
      showToast('请填写有效的标题和发布时间；作者为必填项')
      return
    }
    const restore = setButtonsLoading([nodes.listSave], '保存中…')
    try {
      await Promise.all(changed.map((article) => apiRequest(articlePath(`/${encodeURIComponent(article.id)}`), {
        method: 'POST',
        body: JSON.stringify({
          ...currentContext(),
          article: {
            ...article,
            publishedAt: new Date(article.publishedAt).toISOString(),
            title: article.title.trim(),
          },
        }),
      })))
      state.dirty.clear()
      await loadArticles()
      showToast(`已保存 ${changed.length} 篇文章`)
    } catch (error) {
      showToast(error.message || '文章保存失败')
    } finally {
      restore()
      syncSelection()
    }
  }

  function renderImportItems() {
    const counts = state.importItems.reduce((result, item) => {
      result[item.status] = (result[item.status] || 0) + 1
      return result
    }, {})
    const completed = Number(counts.success || 0) + Number(counts.failed || 0) + Number(counts.duplicate || 0) + Number(counts.published || 0)
    const total = state.importItems.length
    const failed = Number(counts.failed || 0)
    const duplicate = Number(counts.duplicate || 0)
    const secondary = [failed ? `失败 ${failed} 篇` : '', duplicate ? `重复 ${duplicate} 篇` : ''].filter(Boolean).join('，')
    nodes.importSummary.textContent = total
      ? (completed >= total ? `已抓取 ${completed} 篇` : `已抓取 ${completed}/${total} 篇`)
      : (state.importJobId ? '本批次已清空' : '等待提交链接')
    const successCount = Number(counts.success || 0)
    const missingAuthor = state.importItems.filter((item) => item.status === 'success' && !String(item.author || '').trim()).length
    const success = Math.max(0, successCount - missingAuthor)
    nodes.importValidCount.textContent = `${success} 篇可导入`
    nodes.importValidCount.classList.toggle('hidden', !total)
    const authorWarning = missingAuthor ? `缺少作者 ${missingAuthor} 篇，请编辑补充` : ''
    nodes.importResultDetail.textContent = [secondary, authorWarning].filter(Boolean).join('，')
    nodes.importResultDetail.classList.toggle('hidden', !secondary && !authorWarning)
    nodes.importList.innerHTML = state.importItems.map((item, index) => {
      const id = item.id || `entry-${index}`
      const canEdit = item.status === 'success'
      const canRemove = ['success', 'failed', 'duplicate'].includes(item.status)
      const canRetry = item.status === 'failed' && Boolean(state.importJobId)
      const coverUrl = coverImageUrl(item.coverImage)
      const pending = ['pending', 'processing'].includes(item.status)
      const title = item.title || (item.status === 'failed' ? '抓取失败' : pending ? '正在抓取文章' : item.url || '文章预览')
      const fallbackMeta = item.publishedAt ? '' : item.url || ''
      const body = item.renderedHtml
        || `<p>${escapeHtml(item.error || (pending ? '请稍候，完成后会自动更新当前预览。' : item.status === 'duplicate' ? '检测到重复内容，本篇不会导入。' : '暂无正文内容'))}</p>`
      const preview = renderReadingPreviewCard({
        title,
        author: item.author,
        publishedAt: item.publishedAt,
        metaText: fallbackMeta,
        coverUrl,
        bodyHtml: body,
      })
      // Keep the card header in the same rendering path while preserving the hydrated import metadata.
      preview.headerHtml = renderReadingHeader({ title, author: item.author, publishedAt: item.publishedAt, metaText: fallbackMeta, coverUrl })
      return `
      <article class="article-import-entry article-import-entry--${escapeHtml(item.status)}">
        <div class="article-import-reading-card-viewport">
          <div class="article-reading-preview article-reading-layout article-reading-card-scroll article-reading-preview--stacked article-reading-layout--stacked">
            ${preview.headerHtml}
            ${(item.mediaWarnings || []).map((warning) => `<p class="article-import-warning">${escapeHtml(warning.message || warning)}</p>`).join('')}
            ${item.status === 'duplicate' ? '<p class="article-import-state">检测到重复内容，本篇不会导入。</p>' : ''}
            ${item.status === 'success' && !String(item.author || '').trim() ? '<p class="article-import-state">未识别到作者，请编辑补充后再导入。</p>' : ''}
            <div class="article-reading-body">${preview.bodyHtml}</div>
          </div>
          ${canEdit || canRemove || canRetry ? `<div class="article-import-card-tools">${canRemove ? `<button class="article-import-tool-button article-import-tool-button--danger" data-import-remove="${escapeHtml(id)}" type="button" aria-label="从本批次移除" title="从本批次移除">${importToolIcons.delete}</button>` : ''}${canRetry ? `<button class="article-import-tool-button" data-import-retry="${escapeHtml(id)}" type="button" aria-label="重新抓取该篇" title="重新抓取该篇">${importToolIcons.retry}</button>` : ''}${canEdit ? `<button class="article-import-tool-button" data-import-edit="${escapeHtml(id)}" type="button" aria-label="编辑当前文章" title="编辑当前文章">${importToolIcons.edit}</button>` : ''}</div>` : ''}
        </div>
        ${item.removedTailHtml ? `<div class="article-import-card-actions"><button class="btn-text" data-import-restore="${escapeHtml(id)}" type="button">${item.restoreTail ? '重新移除已恢复文字' : '恢复已移除文字'}</button><span>${escapeHtml(item.restoreTail ? '导入时保留已移除文字（图片不会恢复）' : `${item.tailCleanup?.summary || '已清理推广尾部'}（图片不会恢复）`)}</span></div>` : ''}
      </article>
    `
    }).join('') || `<div class="import-empty">${state.importJobId ? '本批次没有保留的文章' : '尚未提交文章链接'}</div>`
    nodes.importPublish.classList.toggle('hidden', !state.importItems.some((item) => item.status === 'success'))
    nodes.importPublish.disabled = ['queued', 'processing'].includes(state.importJobStatus) || missingAuthor > 0 || success === 0
  }

  function normalizeImportItems(result) {
    const items = Array.isArray(result.items) ? result.items : []
    const errors = Array.isArray(result.errors) ? result.errors : []
    const entries = Array.isArray(result.entries) ? result.entries : []
    const restoredById = new Map(state.importItems.map((item) => [item.id, item.restoreTail === true]))
    const editedById = new Map(state.importItems
      .filter((item) => state.importEditedIds.has(item.id))
      .map((item) => [item.id, item]))
    const itemsById = new Map(items.map((item) => [item.id, item]))
    const itemsByUrl = new Map(items.map((item) => [item.sourceUrl, item]))
    const errorsByUrl = new Map(errors.map((item) => [item.url, item]))
    if (!entries.length) {
      return [
        ...items.map((item) => ({
          ...item,
          ...(editedById.has(item.id) ? {
            title: editedById.get(item.id).title,
            bodyMarkdown: editedById.get(item.id).bodyMarkdown,
            coverImage: editedById.get(item.id).coverImage,
            publishedAt: editedById.get(item.id).publishedAt,
            author: editedById.get(item.id).author,
            renderedHtml: editedById.get(item.id).renderedHtml,
          } : {}),
          restoreTail: restoredById.get(item.id) === true,
          status: item.duplicate ? 'duplicate' : 'success',
        })),
        ...errors.map((item, index) => ({ ...item, id: `error-${index}`, error: item.message, status: 'failed' })),
      ].filter((item) => !state.removedImportIds.has(item.id))
    }
    return entries.map((entry, index) => {
      const item = itemsById.get(entry.itemId) || itemsByUrl.get(entry.url)
      if (item) {
        return {
          ...item,
          ...(editedById.has(item.id) ? {
            title: editedById.get(item.id).title,
            bodyMarkdown: editedById.get(item.id).bodyMarkdown,
            coverImage: editedById.get(item.id).coverImage,
            publishedAt: editedById.get(item.id).publishedAt,
            author: editedById.get(item.id).author,
            renderedHtml: editedById.get(item.id).renderedHtml,
          } : {}),
          url: entry.url,
          restoreTail: restoredById.get(item.id) === true,
          status: item.duplicate ? 'duplicate' : 'success',
        }
      }
      const failure = entry.error || errorsByUrl.get(entry.url)
      return {
        id: `entry-${index}`,
        url: entry.url,
        error: failure?.message || '',
        status: entry.status === 'failed' ? 'failed' : entry.status === 'processing' ? 'processing' : 'pending',
      }
    }).filter((item) => !state.removedImportIds.has(item.id))
  }

  async function pollImportJob() {
    if (!state.importJobId || state.importPolling) return
    stopImportPolling()
    const generation = state.importPollGeneration
    const jobId = state.importJobId
    state.importPolling = true
    state.importQueryFailed = false
    nodes.importStart.disabled = true
    nodes.importStart.textContent = '读取进度…'
    try {
      const result = await apiRequest(articlePath(`/import/${encodeURIComponent(jobId)}`, {}, state.importContext))
      if (generation !== state.importPollGeneration || jobId !== state.importJobId) return
      state.importJobStatus = result.status || ''
      state.importProgress = result.progress || state.importProgress
      state.importItems = normalizeImportItems(result)
      if (!nodes.importUrls.value.trim() && Array.isArray(result.urls)) nodes.importUrls.value = result.urls.join('\n')
      renderImportItems()
      if (!['ready', 'failed', 'published'].includes(result.status)) {
        nodes.importStart.textContent = '抓取中…'
        state.importPollTimer = window.setTimeout(pollImportJob, 1000)
      }
      else {
        nodes.importStart.disabled = false
        nodes.importStart.textContent = '重新抓取'
      }
    } catch (error) {
      if (generation !== state.importPollGeneration || jobId !== state.importJobId) return
      state.importQueryFailed = true
      nodes.importStart.disabled = false
      nodes.importStart.textContent = '重试查询'
      nodes.importSummary.textContent = error.message || '导入进度查询失败'
    } finally {
      if (generation === state.importPollGeneration) state.importPolling = false
    }
  }

  async function startImport() {
    if (['queued', 'processing'].includes(state.importJobStatus)) return
    const urls = [...new Set(nodes.importUrls.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))]
    if (!urls.length) {
      showToast('请至少输入一个公众号文章链接')
      return
    }
    nodes.importStart.disabled = true
    nodes.importStart.textContent = '提交中…'
    void reclaimTransientCoverIds([...state.importTransientCoverIds])
    state.removedImportIds.clear()
    state.importEditedIds.clear()
    state.importItems = urls.map((url) => ({ status: 'pending', url }))
    state.importProgress = { total: urls.length, processed: 0, succeeded: 0, failed: 0 }
    state.importQueryFailed = false
    renderImportItems()
    try {
      window.dispatchEvent(new CustomEvent('content-import-target-lock', { detail: { locked: true } }))
      const result = await apiRequest(articlePath('/import', {}, state.importContext), {
        method: 'POST',
        body: JSON.stringify({ ...state.importContext, urls }),
      })
      state.importJobId = result.id
      state.importJobStatus = result.status || 'queued'
      state.importProgress = result.progress || state.importProgress
      state.importItems = normalizeImportItems(result).length ? normalizeImportItems(result) : state.importItems
      renderImportItems()
      await pollImportJob()
    } catch (error) {
      if (!state.importJobId) window.dispatchEvent(new CustomEvent('content-import-target-lock', { detail: { locked: false } }))
      nodes.importStart.disabled = false
      nodes.importStart.textContent = '重新抓取'
      nodes.importSummary.textContent = error.message || '文章导入失败'
    }
  }

  async function publishImported() {
    const selectedIds = state.importItems.filter((item) => item.status === 'success').map((item) => item.id)
    const missingAuthor = state.importItems.find((item) => item.status === 'success' && !String(item.author || '').trim())
    if (missingAuthor) {
      showToast('请先为所有文章补充作者信息')
      return
    }
    const restoreTailIds = state.importItems.filter((item) => item.restoreTail && selectedIds.includes(item.id)).map((item) => item.id)
    const editedItems = state.importItems
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => ({
        id: item.id,
        title: String(item.title || '').trim(),
        author: String(item.author || '').trim(),
        bodyMarkdown: String(item.bodyMarkdown || '').trim(),
        coverImage: item.coverImage?.id ? { id: item.coverImage.id } : null,
        publishedAt: item.publishedAt,
      }))
    if (!selectedIds.length) {
      showToast('暂无可导入文章')
      return
    }
    const restore = setButtonsLoading([nodes.importPublish], '导入中…')
    try {
      await apiRequest(articlePath(`/import/${encodeURIComponent(state.importJobId)}/publish`, {}, state.importContext), {
        method: 'POST',
        body: JSON.stringify({ selectedIds, restoreTailIds, editedItems }),
      })
      selectedIds.forEach((id) => {
        const coverId = state.importItems.find((item) => item.id === id)?.coverImage?.id
        if (coverId) state.importTransientCoverIds.delete(coverId)
      })
      await reclaimTransientCoverIds([...state.importTransientCoverIds])
      state.importItems = state.importItems.map((item) => selectedIds.includes(item.id) ? { ...item, status: 'published' } : item)
      state.importJobId = ''
      state.importJobStatus = 'published'
      showToast(`已导入 ${selectedIds.length} 篇文章`)
      window.dispatchEvent(new CustomEvent('content-import-complete', {
        detail: { importedCount: selectedIds.length, miniProgramId: state.importContext.miniProgramId, noun: '篇文章', poolId: state.importContext.poolId },
      }))
      // Keep the importer open and ready for the next batch. The success toast
      // is the only completion feedback needed here; the content list can be
      // refreshed explicitly from its own page when the operator is finished.
      resetImportWorkspace()
      renderImportItems()
    } catch (error) {
      showToast(error.message || '文章导入失败')
    } finally {
      restore()
    }
  }

  async function retryImportItem(article) {
    if (!state.importJobId || article?.status !== 'failed') return
    const previous = { ...article }
    article.status = 'processing'
    state.importJobStatus = 'processing'
    renderImportItems()
    try {
      const result = await apiRequest(articlePath(`/import/${encodeURIComponent(state.importJobId)}/retry`, {}, state.importContext), {
        method: 'POST',
        body: JSON.stringify({ url: article.url }),
      })
      state.importJobStatus = result.status || 'queued'
      state.importProgress = result.progress || state.importProgress
      state.importItems = normalizeImportItems(result)
      renderImportItems()
      await pollImportJob()
    } catch (error) {
      Object.assign(article, previous)
      state.importJobStatus = state.importItems.some((item) => item.status === 'success') ? 'ready' : 'failed'
      renderImportItems()
      showToast(error.message || '当前文章重新抓取失败')
    }
  }

  function resetImportWorkspace() {
    void reclaimTransientCoverIds([...state.importTransientCoverIds])
    stopImportPolling()
    state.importJobId = ''
    state.importItems = []
    state.importJobStatus = ''
    state.importProgress = { total: 0, processed: 0, succeeded: 0, failed: 0 }
    state.importQueryFailed = false
    state.importEditingId = ''
    state.removedImportIds.clear()
    state.importEditedIds.clear()
    nodes.importUrls.value = ''
    nodes.importStart.disabled = false
    nodes.importStart.textContent = '立即抓取'
    window.dispatchEvent(new CustomEvent('content-import-target-lock', { detail: { locked: false } }))
    clearLegacyImportJobPointers()
  }

  function openArticleImport() {
    resetImportWorkspace()
    renderImportItems()
    nodes.importPanel?.classList.remove('hidden')
    document.querySelector('#import')?.classList.add('article-url-import-active')
    window.showSection?.('import')
    selectArticleSource('document')
    documentImport?.open(state.importContext)
  }

  function setArticleImportContext(event) {
    state.importContext = {
      miniProgramId: String(event.detail?.miniProgramId || '').trim(),
      poolId: String(event.detail?.poolId || '').trim(),
    }
  }

  function closeArticleImport() {
    documentImport?.close()
    if (state.editorMode === 'document') void closeEditor({ discard: true })
    if (state.editorMode === 'import') void closeEditor({ discard: true })
    void reclaimTransientCoverIds([...state.importTransientCoverIds])
    document.querySelector('#import')?.classList.remove('article-url-import-active')
    nodes.importPanel?.classList.add('hidden')
    window.showSection?.('content')
  }

  function removeImportItem(id) {
    const index = state.importItems.findIndex((item) => item.id === id)
    if (index < 0) return
    const coverId = state.importItems[index].coverImage?.id
    state.importItems.splice(index, 1)
    state.removedImportIds.add(id)
    state.importEditedIds.delete(id)
    if (coverId && state.importTransientCoverIds.has(coverId)) void reclaimTransientCoverIds([coverId])
    renderImportItems()
  }

  function bindEvents() {
    nodes.create.addEventListener('click', () => openEditor())
    nodes.cancelEditor.addEventListener('click', requestCloseEditor)
    nodes.publish.addEventListener('click', () => saveEditor(nodes.publish))
    nodes.editorModal.querySelector('.modal-backdrop')?.addEventListener('click', requestCloseEditor)
    nodes.title.addEventListener('input', updateEditorPreviewChrome)
    nodes.author.addEventListener('input', updateEditorPreviewChrome)
    nodes.publishAt.addEventListener('input', updateEditorPreviewChrome)
    nodes.body.addEventListener('input', () => scheduleEditorBodyPreview())
    nodes.previewClose.addEventListener('click', () => closeModal(nodes.previewModal))
    nodes.coverUploadButton.addEventListener('click', () => nodes.coverUpload.click())
    nodes.coverUpload.addEventListener('change', () => uploadCover(nodes.coverUpload.files?.[0]))
    nodes.coverRemove.addEventListener('click', () => { void removeEditorCover() })
    nodes.refresh.addEventListener('click', loadArticles)
    nodes.listSave.addEventListener('click', saveInlineArticles)
    nodes.selectAll.addEventListener('change', () => {
      state.items.forEach((item) => nodes.selectAll.checked ? state.selected.add(item.id) : state.selected.delete(item.id))
      renderList()
    })
    nodes.batchDelete.addEventListener('click', () => deleteArticles([...state.selected]))
    nodes.list.addEventListener('change', (event) => {
      const input = event.target.closest('[data-article-select]')
      if (input) {
        if (input.checked) state.selected.add(input.dataset.articleSelect)
        else state.selected.delete(input.dataset.articleSelect)
        syncSelection()
        return
      }
    })
    nodes.list.addEventListener('input', (event) => {
      const title = event.target.closest('[data-article-title]')
      if (title) updateInlineArticle(title.dataset.articleTitle, { title: title.value })
      const label = event.target.closest('[data-article-label]')
      if (label) updateInlineArticle(label.dataset.articleLabel, { label: label.value })
      const author = event.target.closest('[data-article-author]')
      if (author) updateInlineArticle(author.dataset.articleAuthor, { author: author.value })
    })
    nodes.list.addEventListener('change', (event) => {
      const publishedAt = event.target.closest('[data-article-published-at]')
      if (publishedAt) updateInlineArticle(publishedAt.dataset.articlePublishedAt, { publishedAt: publishedAt.value })
      const author = event.target.closest('[data-article-author]')
      if (author) updateInlineArticle(author.dataset.articleAuthor, { author: author.value })
    })
    nodes.list.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-article-edit]')
      const remove = event.target.closest('[data-article-delete]')
      const id = edit?.dataset.articleEdit || remove?.dataset.articleDelete
      const article = state.items.find((item) => item.id === id)
      if (edit && article) openEditor(article)
      else if (remove) deleteArticles([id])
    })
    nodes.importOpen.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-content-import', {
      detail: { miniProgramId: currentContext().miniProgramId, type: 'article' },
    })))
    nodes.importStart.addEventListener('click', () => {
      if (state.importQueryFailed && state.importJobId) pollImportJob()
      else startImport()
    })
    nodes.importPublish.addEventListener('click', publishImported)
    nodes.importList.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-import-edit]')
      const remove = event.target.closest('[data-import-remove]')
      const retry = event.target.closest('[data-import-retry]')
      const preview = event.target.closest('[data-import-preview]')
      const restore = event.target.closest('[data-import-restore]')
      const id = edit?.dataset.importEdit || remove?.dataset.importRemove || retry?.dataset.importRetry || preview?.dataset.importPreview || restore?.dataset.importRestore
      const article = state.importItems.find((item) => item.id === id)
      if (edit && article) {
        openEditor(article, 'import')
      } else if (remove && article) {
        removeImportItem(id)
      } else if (retry && article) {
        retryImportItem(article)
      } else if (restore && article) {
        article.restoreTail = !article.restoreTail
        renderImportItems()
      } else if (preview && article) showPreview(article).catch((error) => showToast(error.message))
    })
    nodes.previewRestoreTail.addEventListener('click', () => {
      const article = state.importItems.find((item) => item.id === state.previewImportId)
      if (!article) return
      article.restoreTail = !article.restoreTail
      nodes.previewRestoreTail.textContent = article.restoreTail ? '重新移除已恢复文字' : '恢复已移除文字'
      nodes.previewCleanupSummary.textContent = article.restoreTail ? '已选择恢复，导入时将保留已移除文字，图片不会恢复' : `${article.tailCleanup?.summary || ''}${article.removedTailHtml ? '（图片不会恢复）' : ''}`
      renderImportItems()
    })
  }

  let selectedArticleSource = 'document'
  const documentImport = window.createArticleDocumentImport?.({
    apiRequest: (...args) => apiRequest(...args), escapeHtml, renderReadingPreviewCard, coverImageUrl,
    icons: importToolIcons, openEditor, openConfirm, showToast,
    uploadImage: async (file) => {
      const result = await uploadImageFileToCos(file, { label: file.name, usage: 'article' })
      imageState = [result.item, ...(imageState || []).filter((item) => item.id !== result.item.id)]
      return result.item
    },
    reclaim: reclaimTransientCoverIds,
    showExisting: async (duplicate, context) => {
      const result = await apiRequest('/api/admin/articles/documents/existing/' + encodeURIComponent(duplicate.id) + '?' + new URLSearchParams(context))
      await showPreview(result.article)
    },
  })

  function selectArticleSource(mode) {
    selectedArticleSource = mode
    document.querySelector('#articleImportSource').value = mode
    document.querySelector('#articleUrlSourcePanel')?.classList.toggle('hidden', mode !== 'url')
    document.querySelector('#articleDocumentPanel')?.classList.toggle('hidden', mode !== 'document')
    document.querySelector('#articleUrlSourceFields')?.classList.toggle('hidden', mode !== 'url')
    document.querySelector('#articleDocumentSourceFields')?.classList.toggle('hidden', mode !== 'document')
    document.querySelector('#articleDocumentTemplate')?.classList.toggle('hidden', mode !== 'document')
    document.querySelector('#articleDocumentSelectFolder')?.classList.toggle('hidden', mode !== 'document')
    nodes.importStart?.classList.toggle('hidden', mode !== 'url')
    document.querySelector('#articleImportSourceTitle').textContent = mode === 'document' ? '选择导入文件夹' : '批量导入文章'
    document.querySelector('#articleImportSourceHint').textContent = mode === 'document'
      ? '每份一篇；每批最多 200 份，单份 1MB，合计 20MB。'
      : '每行一个公众号链接，自动清理推广后预览。'
  }
  document.querySelector('#articleImportSource')?.addEventListener('change', (event) => {
    const mode = event.target.value
    event.target.value = selectedArticleSource
    if (mode === selectedArticleSource) return
    if (mode === 'document') {
      if (['queued', 'processing'].includes(state.importJobStatus)) { showToast('链接正在抓取，请完成后再切换'); return }
      if (state.importJobId && state.importItems.length) {
        openConfirm({ title: '放弃当前链接抓取预览？', message: '尚未确认导入的编辑将被清空，已导入的文章会保留。', confirmLabel: '切换到文件导入', danger: true,
          onConfirm: () => { resetImportWorkspace(); renderImportItems(); selectArticleSource('document') },
        })
        return
      }
    } else {
      if (documentImport?.isProcessing()) { showToast('文档正在准备，请完成后再切换'); return }
      if (documentImport?.hasJob()) { documentImport.abandonThen(() => { selectArticleSource('url'); nodes.importUrls.focus() }); return }
    }
    selectArticleSource(mode)
    if (mode === 'url') nodes.importUrls.focus()
  })
  bindEvents()
  window.AdminPagination?.register('articles', async ({ page, pageSize }) => {
    state.page = Number(page || 1)
    if (pageSize) state.pageSize = Number(pageSize)
    await loadArticles()
  })
  window.addEventListener('article-manager-refresh', loadArticles)
  window.addEventListener('open-article-import', setArticleImportContext)
  window.addEventListener('open-article-import', openArticleImport)
  window.addEventListener('content-import-target-change', (event) => {
    documentImport?.updateContext({ miniProgramId: String(event.detail?.miniProgramId || '').trim(), poolId: String(event.detail?.poolId || '').trim() })
    if (state.importJobId) return
    state.importContext = {
      miniProgramId: String(event.detail?.miniProgramId || '').trim(),
      poolId: String(event.detail?.poolId || '').trim(),
    }
  })
  window.addEventListener('close-article-import', closeArticleImport)
})()
