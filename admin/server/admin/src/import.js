(() => {
  function readApiBase() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') return window.location.origin
    return 'http://127.0.0.1:3000'
  }

  const API_BASE = readApiBase()
  const typeConfig = {
    text: {
      contentType: 'contentTexts',
      hint: '导入 TXT 文本，每段内容会成为一条文案手记。',
      sourceHint: '用空行、序号或 --- 分隔多条文案。',
      noun: '条',
      source: 'text',
    },
    audio: {
      contentType: 'contentAudios',
      hint: '导入多个音频文件，每个文件会成为一条音频手记。',
      sourceHint: '支持 MP3、M4A，单个文件不超过 50MB。初始标题自动取原始文件名去掉后缀，可在内容管理中修改。',
      noun: '条音频',
      source: 'audio',
    },
    album: {
      contentType: 'contentAlbums',
      hint: '导入图片文件夹，每个子目录或同名前缀图片会组成一个图册手记组。',
      sourceHint: '可识别不同子目录内的图片，或用相同名称加序号作为分组标识，例如 春日01.jpg、春日02.jpg。每组 1-9 张。',
      noun: '个图片组',
      source: 'files',
    },
    article: {
      hint: '每行粘贴一个公众号文章链接，系统将抓取并转换为统一阅读模式。',
      source: 'article',
    },
    'letter-copy': {
      contentType: 'letters',
      hint: '导入 TXT 文本，每段内容会成为一条心笺。',
      sourceHint: '用空行、序号或 --- 分隔多条内容。导入后默认归入“默认”标签。',
      noun: '条',
      source: 'text',
    },
  }
  let type = 'text'
  const state = {
    commonRoot: '',
    batchLimitError: '',
    checkingDuplicates: false,
    completed: false,
    content: null,
    items: [],
    loading: false,
    locked: false,
    miniProgramId: '',
    operationError: '',
    targetLocked: false,
    targetPoolId: '',
    progress: { completed: 0, stage: '', total: 0 },
    records: [],
    selectionGeneration: 0,
    showErrors: false,
    skippedContentCount: 0,
    skippedImageCount: 0,
    sourceName: '',
    sourceResultStatus: '',
    sourceText: '',
    splitMode: 'auto',
  }
  const nodes = {
    audioFiles: document.querySelector('#importAudioFiles'),
    back: document.querySelector('#importBackBtn'),
    confirm: document.querySelector('#importConfirmBtn'),
    errorCount: document.querySelector('#importErrorCount'),
    errorFilter: document.querySelector('#importErrorFilterBtn'),
    folderFiles: document.querySelector('#importFolderFiles'),
    operationError: document.querySelector('#importOperationError'),
    previewHint: document.querySelector('#importPreviewHint'),
    previewList: document.querySelector('#importPreviewList'),
    progress: document.querySelector('#importProgress'),
    selectFolder: document.querySelector('#importSelectFolderBtn'),
    selectAudio: document.querySelector('#importSelectAudioBtn'),
    selectText: document.querySelector('#importSelectTextBtn'),
    sourceActions: document.querySelector('#importSourceActions'),
    sourceHint: document.querySelector('#importSourceHint'),
    sourceStatus: document.querySelector('#importSourceStatus'),
    sourceTitle: document.querySelector('#importSourceTitle'),
    splitControl: document.querySelector('#importSplitControl'),
    splitMode: document.querySelector('#importSplitMode'),
    textFile: document.querySelector('#importTextFile'),
    toast: document.querySelector('#importToast'),
    targetPool: document.querySelector('#importTargetPool'),
    typeTabs: document.querySelector('#importTypeTabs'),
    validCount: document.querySelector('#importValidCount'),
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  async function apiRequest(path, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
    const { headers: optionHeaders = {}, ...requestOptions } = options
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...requestOptions,
      headers: {
        ...(isFormData ? {} : { 'content-type': 'application/json' }),
        ...optionHeaders,
      },
    })
    const responseText = await response.text()
    let data = {}
    let parsedJson = false
    try {
      data = responseText ? JSON.parse(responseText) : {}
      parsedJson = true
    } catch (error) {
      data = {}
    }
    if (!response.ok) {
      const rawMessage = responseText.trim()
      const readableMessage = rawMessage && !parsedJson && !/^\s*</.test(rawMessage) ? rawMessage.slice(0, 160) : ''
      const error = new Error(data.message || readableMessage || `请求失败：HTTP ${response.status}`)
      error.status = response.status
      const pendingClientIds = data?.pendingClientIds || data?.details?.pendingClientIds
      if (Array.isArray(pendingClientIds)) {
        error.details = {
          pendingClientIds: pendingClientIds
            .map((item) => String(item || '').trim().slice(0, 200))
            .filter(Boolean)
            .slice(0, 100),
        }
      }
      throw error
    }
    return data
  }

  function wait(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay))
  }

  async function runWithRetry(operation, { delays = [], onRetry, shouldRetry } = {}) {
    let attempt = 0
    while (true) {
      try {
        return await operation()
      } catch (error) {
        if (attempt >= delays.length || !shouldRetry?.(error)) throw error
        const delay = delays[attempt]
        attempt += 1
        onRetry?.(error, attempt, delays.length)
        await wait(delay)
      }
    }
  }

  function isTemporaryRequestError(error) {
    const status = Number(error?.status || 0)
    const message = String(error?.message || '')
    if (status >= 400 && status < 500) return [408, 425, 429].includes(status)
    return error instanceof TypeError
      || status >= 500
      || /网络|请求超时|Failed to fetch|fetch failed/i.test(message)
  }

  function isTemporaryImageCompletionError(error) {
    return isTemporaryRequestError(error)
  }

  function getBatchLimitError(items) {
    return items.length > 200 ? `单批最多导入 200 条内容，当前识别 ${items.length} 条，请减少文件后重新选择。` : ''
  }

  function syncBatchLimitError() {
    const previousError = state.batchLimitError
    state.batchLimitError = getBatchLimitError(state.items)
    if (state.batchLimitError) state.operationError = state.batchLimitError
    else if (state.operationError === previousError) state.operationError = ''
  }

  function markPendingCompletedImages(completedChunk, error) {
    if (Number(error?.status || 0) !== 409) return false
    const pendingClientIds = new Set(error?.details?.pendingClientIds || [])
    if (!pendingClientIds.size) return false
    completedChunk.forEach(({ image }) => {
      if (!pendingClientIds.has(image.clientId)) return
      image.error = '图片仍在处理中，请稍后重试'
      image.retryable = true
    })
    return true
  }

  function beginSourceSelection() {
    state.selectionGeneration += 1
    state.checkingDuplicates = false
    return state.selectionGeneration
  }

  function isCurrentSourceSelection(selectionGeneration) {
    return selectionGeneration === state.selectionGeneration
  }

  function showToast(message) {
    if (!nodes.toast) return
    nodes.toast.textContent = message
    nodes.toast.classList.remove('hidden')
    clearTimeout(showToast.timer)
    showToast.timer = setTimeout(() => nodes.toast.classList.add('hidden'), 2200)
  }

  function makeId(prefix) {
    const suffix = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
    return `${prefix}-${Date.now().toString(36)}-${suffix}`
  }

  function fileExt(name) {
    return String(name || '').toLowerCase().match(/\.([^.]+)$/)?.[1] || ''
  }

  function mimeByName(name) {
    const ext = fileExt(name)
    if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg'
    if (ext === 'png') return 'image/png'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    if (ext === 'mp3') return 'audio/mpeg'
    if (ext === 'm4a') return 'audio/mp4'
    if (ext === 'txt') return 'text/plain;charset=utf-8'
    return 'application/octet-stream'
  }

  function isImageRecord(record) {
    const type = String(record?.file?.type || '').toLowerCase()
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fileExt(record?.name))
      && (!type || type.startsWith('image/'))
  }

  function isAudioRecord(record) {
    const extension = fileExt(record?.name)
    const contentType = String(record?.file?.type || '').toLowerCase().split(';')[0]
    if (!['mp3', 'm4a'].includes(extension)) return false
    if (!contentType || contentType === 'application/octet-stream') return true
    return extension === 'mp3'
      ? ['audio/mpeg', 'audio/mp3', 'audio/mpeg3'].includes(contentType)
      : ['audio/mp4', 'audio/x-m4a', 'audio/m4a'].includes(contentType)
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0)
    if (!Number.isFinite(value) || value <= 0) return '-'
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`
  }

  function formatAudioDuration(seconds) {
    const duration = Number(seconds || 0)
    if (!Number.isFinite(duration) || duration <= 0) return ''
    const total = Math.round(duration)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  function cleanPath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .map((item) => item.trim())
      .filter((item) => item && item !== '.' && item !== '..')
      .join('/')
  }

  function recordParts(record) {
    const path = cleanPath(record?.path || record?.name)
    const parts = path.split('/').filter(Boolean)
    return state.commonRoot && parts[0] === state.commonRoot ? parts.slice(1) : parts
  }

  function refreshCommonRoot() {
    const partLists = state.records.map((record) => cleanPath(record.path).split('/').filter(Boolean))
    const roots = new Set(partLists.filter((parts) => parts.length > 1).map((parts) => parts[0]))
    state.commonRoot = roots.size === 1 && partLists.every((parts) => parts.length > 1) ? [...roots][0] : ''
  }

  function parseOrder(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '')
    const trailing = base.match(/(\d+)$/)
    if (trailing) return Number(trailing[1])
    const leading = base.match(/^(\d+)/)
    return leading ? Number(leading[1]) : Number.MAX_SAFE_INTEGER
  }

  function trimGroupSeparator(value, direction) {
    const pattern = direction === 'start' ? /^[^\p{L}\p{N}]+/u : /[^\p{L}\p{N}]+$/u
    return String(value || '').replace(pattern, '').trim()
  }

  function groupPrefix(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '')
    const match = base.match(/^(.*?)(\d+)$/)
    return trimGroupSeparator(match?.[1], 'end')
  }

  function groupSuffix(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '')
    const match = base.match(/^(\d+)(.*)$/)
    return trimGroupSeparator(match?.[2], 'start')
  }

  function fileGroupName(name) {
    return groupPrefix(name) || groupSuffix(name)
  }

  function sortRecords(records) {
    return [...records].sort((left, right) => (
      parseOrder(left.name) - parseOrder(right.name)
      || String(left.name).localeCompare(String(right.name), 'zh-CN', { numeric: true })
    ))
  }

  function makeImage(record) {
    const errors = []
    if (Number(record.file?.size || 0) > 5 * 1024 * 1024) errors.push('图片超过 5MB')
    return {
      assetId: '',
      clientId: makeId('import-image'),
      completion: null,
      error: errors.join('；'),
      originalSha256: '',
      label: String(record.name || '').replace(/\.[^.]+$/, ''),
      previewUrl: '',
      record,
      retryable: false,
    }
  }

  function readAudioDuration(file) {
    if (!file) return Promise.resolve(0)
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const audio = new Audio()
      const finish = (value) => {
        URL.revokeObjectURL(url)
        resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0)
      }
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => finish(audio.duration)
      audio.onerror = () => finish(0)
      audio.src = url
    })
  }

  async function makeAudio(record) {
    const errors = []
    if (!isAudioRecord(record)) errors.push('仅支持 MP3、M4A 音频')
    if (Number(record.file?.size || 0) > 50 * 1024 * 1024) errors.push('音频超过 50MB')
    return {
      audio: null,
      durationSeconds: errors.length ? 0 : await readAudioDuration(record.file),
      errors,
      id: makeId('audio-import'),
      kind: 'audio',
      originalFilename: String(record.name || ''),
      record,
      retryable: false,
      uploadError: '',
    }
  }

  function itemErrors(item) {
    const errors = [
      ...(item.errors || []),
      ...(item.uploadError ? [item.uploadError] : []),
      ...(item.images || []).map((image) => image.error).filter(Boolean),
    ]
    if (item.kind === 'album' && !(item.images || []).length) errors.push('至少保留 1 张图片')
    return errors
  }

  function hasErrors(item) {
    return itemErrors(item).length > 0
  }

  function getPreviewUrl(image) {
    if (!image?.record?.file) return ''
    if (!image.previewUrl) image.previewUrl = URL.createObjectURL(image.record.file)
    return image.previewUrl
  }

  function revokeImagePreviewUrl(image, removedFromItem) {
    const stillReferenced = state.items.some((item) => item !== removedFromItem && (item.images || []).includes(image))
    if (image.previewUrl && !stillReferenced) {
      URL.revokeObjectURL(image.previewUrl)
      image.previewUrl = ''
    }
  }

  function revokeItemPreviewUrls(item) {
    ;(item?.images || []).forEach((image) => revokeImagePreviewUrl(image, item))
  }

  function revokePreviewUrls() {
    const seen = new Set()
    imageContexts().forEach(({ image }) => {
      if (!image.previewUrl || seen.has(image.previewUrl)) return
      seen.add(image.previewUrl)
      URL.revokeObjectURL(image.previewUrl)
      image.previewUrl = ''
    })
  }

  async function readTextFile(file) {
    const buffer = await file.arrayBuffer()
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch (error) {
      return new TextDecoder('gb18030').decode(buffer)
    }
  }

  function textBlocks(value, mode = 'auto') {
    const source = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
    if (!source) return { blocks: [], detected: '自动识别' }
    const bySeparator = () => source
      .split(/^\s*(?:-{3,}|\*{3,}|={3,})\s*$/m)
      .map((item) => item.trim())
      .filter(Boolean)
    const byNumber = () => {
      const lines = source.split('\n')
      const numberRule = /^\s*(?:(?:\d{1,3}|[一二三四五六七八九十]+)[.、．)]|[（(]\d+[）)])\s*/
      if (lines.filter((line) => numberRule.test(line)).length < 2) return []
      const blocks = []
      let current = ''
      lines.forEach((line) => {
        if (numberRule.test(line)) {
          if (current.trim()) blocks.push(current.trim())
          current = line.replace(numberRule, '')
          return
        }
        current += `${current ? '\n' : ''}${line}`
      })
      if (current.trim()) blocks.push(current.trim())
      return blocks
    }
    const byBlank = () => source
      .split(/\n[ \t]*\n(?:[ \t]*\n)*/)
      .map((item) => item.trim())
      .filter(Boolean)

    const candidates = {
      blank: { blocks: byBlank(), detected: '空行' },
      number: { blocks: byNumber(), detected: '序号' },
      separator: { blocks: bySeparator(), detected: '分隔线' },
    }
    if (mode !== 'auto') return candidates[mode]
    if (candidates.separator.blocks.length > 1) return candidates.separator
    if (candidates.number.blocks.length > 1) return candidates.number
    if (candidates.blank.blocks.length > 1) return candidates.blank
    return { blocks: [source], detected: '整份文本' }
  }

  function normalizeContentText(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim()
  }

  function skippedSummary() {
    const parts = []
    if (state.skippedContentCount) parts.push(`跳过 ${state.skippedContentCount} ${typeConfig[type].noun}重复内容`)
    if (state.skippedImageCount) parts.push(`复用 ${state.skippedImageCount} 张重复图片`)
    return parts.join('，')
  }

  function renderSourceResultStatus() {
    const skipped = skippedSummary()
    nodes.sourceStatus.textContent = [state.sourceResultStatus, skipped].filter(Boolean).join(' · ')
  }

  async function sha256File(file) {
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持图片去重，请升级浏览器后重试')
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  }

  async function hashImportImages(items) {
    const images = imageContexts(items).map(({ image }) => image).filter((image) => !image.error && !image.originalSha256)
    let cursor = 0
    const worker = async () => {
      while (cursor < images.length) {
        const image = images[cursor]
        cursor += 1
        image.originalSha256 = await sha256File(image.record.file)
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, images.length) }, worker))
  }

  function preflightContentItems() {
    if (type === 'text') return state.items.map((item) => ({ id: item.id, text: normalizeContentText(item.content) }))
    if (type === 'letter-copy') return state.items.map((item) => ({ id: item.id, content: normalizeContentText(item.content) }))
    return state.items.map((item) => ({ id: item.id, images: [] }))
  }

  function applyImageDeduplication(reusableImages = []) {
    const reusableByClientId = new Map(reusableImages.map((item) => [item.clientId, item.assetId]))
    const canonicalByHash = new Map()
    let skipped = 0
    state.items.forEach((item) => {
      const seenInItem = new Set()
      item.images = (item.images || []).filter((image) => {
        const hash = image.originalSha256
        if (!hash) return true
        if (seenInItem.has(hash)) {
          if (image.previewUrl) URL.revokeObjectURL(image.previewUrl)
          skipped += 1
          return false
        }
        seenInItem.add(hash)
        return true
      }).map((image) => {
        const hash = image.originalSha256
        if (!hash) return image
        const canonical = canonicalByHash.get(hash)
        if (canonical) {
          image.duplicateOfClientId = canonical.clientId
          skipped += 1
          return image
        }
        const reusableAssetId = reusableByClientId.get(image.clientId)
        if (reusableAssetId) {
          image.assetId = reusableAssetId
          skipped += 1
        }
        canonicalByHash.set(hash, image)
        return image
      })
    })
    return skipped
  }

  async function preflightParsedItems(selectionGeneration, sourceResultStatus) {
    state.completed = false
    state.skippedContentCount = 0
    state.skippedImageCount = 0
    state.sourceResultStatus = sourceResultStatus
    syncBatchLimitError()
    if (state.batchLimitError || type === 'audio' || !state.items.length) {
      renderSourceResultStatus()
      render()
      return true
    }
    state.checkingDuplicates = true
    nodes.sourceStatus.textContent = `${sourceResultStatus} · 正在检查重复内容`
    renderSummary()
    try {
      await hashImportImages(state.items)
      if (!isCurrentSourceSelection(selectionGeneration)) return false
      const preflightBody = {
        images: imageContexts().map(({ image }) => ({ clientId: image.clientId, originalSha256: image.originalSha256 })).filter((image) => image.originalSha256),
        items: preflightContentItems(),
        miniProgramId: state.miniProgramId,
        poolId: state.targetPoolId,
        type: typeConfig[type].contentType,
      }
      const response = await runWithRetry(() => apiRequest('/api/admin/content/import/preflight', {
        method: 'POST',
        body: JSON.stringify(preflightBody),
      }), {
        delays: [500, 1500],
        onRetry: (_error, retryAttempt, retryTotal) => {
          nodes.sourceStatus.textContent = `${sourceResultStatus} · 正在检查重复内容（自动重试 ${retryAttempt}/${retryTotal}）`
        },
        shouldRetry: isTemporaryRequestError,
      })
      if (!isCurrentSourceSelection(selectionGeneration)) return false
      const duplicateIndexes = new Set(response.duplicateItemIndexes || [])
      state.items = state.items.filter((item, index) => {
        if (!duplicateIndexes.has(index)) return true
        revokeItemPreviewUrls(item)
        return false
      })
      state.skippedContentCount = duplicateIndexes.size
      state.skippedImageCount = applyImageDeduplication(response.reusableImages || [])
      state.completed = state.items.length === 0
      renderSourceResultStatus()
      return true
    } finally {
      if (isCurrentSourceSelection(selectionGeneration)) {
        state.checkingDuplicates = false
        render()
      }
    }
  }

  async function parseTextSource(selectionGeneration) {
    const parsed = textBlocks(state.sourceText, state.splitMode)
    state.items = parsed.blocks.map(normalizeContentText).filter(Boolean).map((content) => (
      type === 'text'
        ? { content, errors: content ? [] : ['文案为空'], id: makeId('text-import'), kind: 'text', label: '默认' }
        : { content, errors: content ? [] : ['文案为空'], id: makeId('letter-import'), kind: 'text', label: '默认' }
    ))
    render()
    return preflightParsedItems(selectionGeneration, `${state.sourceName} · 已按${parsed.detected}拆分`)
  }

  function buildDailyContentImageItems() {
    const folderGroups = new Map()
    const flatGroups = new Map()
    const ungrouped = []
    const records = state.records.filter(isImageRecord)
    records.forEach((record) => {
      const parts = recordParts(record)
      if (parts.length > 1) {
        const key = parts.slice(0, -1).join('/')
        if (!folderGroups.has(key)) folderGroups.set(key, [])
        folderGroups.get(key).push(record)
        return
      }
      const groupName = fileGroupName(record.name)
      if (!groupName) {
        ungrouped.push(record)
        return
      }
      if (!flatGroups.has(groupName)) flatGroups.set(groupName, [])
      flatGroups.get(groupName).push(record)
    })
    const groups = [
      ...[...folderGroups.entries()].map(([key, recordsInGroup]) => ({
        records: recordsInGroup,
        label: key.split('/').pop(),
      })),
      ...[...flatGroups.entries()].map(([label, recordsInGroup]) => ({ records: recordsInGroup, label })),
      ...ungrouped.map((record) => ({
        records: [record],
        label: String(record.name || '').replace(/\.[^.]+$/, ''),
      })),
    ]
    return groups.map((group) => {
      const images = sortRecords(group.records).map(makeImage).slice(0, 9)
      const errors = [...(group.errors || [])]
      return {
        errors,
        id: makeId('album-import'),
        images,
        kind: 'album',
        label: group.label || '默认',
      }
    })
  }

  async function buildDailyContentAudioItems() {
    return Promise.all(state.records.map(makeAudio))
  }

  async function parseFileSource(selectionGeneration) {
    let items
    if (type === 'album') items = buildDailyContentImageItems()
    else if (type === 'audio') items = await buildDailyContentAudioItems()
    else return false
    if (!isCurrentSourceSelection(selectionGeneration)) return false
    state.items = items
    render()
    return true
  }

  async function selectTextFile(file) {
    if (!file) return
    const selectionGeneration = beginSourceSelection()
    revokePreviewUrls()
    state.completed = false
    state.items = []
    state.operationError = ''
    state.progress = { completed: 0, stage: '', total: 0 }
    state.records = []
    state.showErrors = false
    state.skippedContentCount = 0
    state.skippedImageCount = 0
    state.sourceName = file.name
    state.sourceResultStatus = ''
    state.sourceText = ''
    nodes.sourceStatus.textContent = `${file.name} · 正在解析`
    render()
    let sourceText
    try {
      sourceText = await readTextFile(file)
    } catch (error) {
      if (!isCurrentSourceSelection(selectionGeneration)) return
      throw error
    }
    if (!isCurrentSourceSelection(selectionGeneration)) return
    state.sourceText = sourceText
    await parseTextSource(selectionGeneration)
  }

  async function selectRecords(records, sourceName) {
    const selectionGeneration = beginSourceSelection()
    revokePreviewUrls()
    state.completed = false
    state.items = []
    state.operationError = ''
    state.progress = { completed: 0, stage: '', total: 0 }
    state.records = records
    state.showErrors = false
    state.skippedContentCount = 0
    state.skippedImageCount = 0
    state.sourceName = sourceName
    state.sourceResultStatus = ''
    state.sourceText = ''
    refreshCommonRoot()
    nodes.sourceStatus.textContent = `${sourceName} · 正在解析`
    let parsed
    try {
      parsed = await parseFileSource(selectionGeneration)
    } catch (error) {
      if (!isCurrentSourceSelection(selectionGeneration)) return
      throw error
    }
    if (!parsed) return
    await preflightParsedItems(selectionGeneration, `${sourceName} · 已识别 ${state.items.length} ${typeConfig[type].noun}`)
  }

  function itemThumbnail(image) {
    const url = getPreviewUrl(image)
    return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(image.record.name)}">` : ''
  }

  function itemMetaText(item, errors = itemErrors(item)) {
    if (errors.length) return errors.join('；')
    if (item.kind === 'audio') {
      return [formatFileSize(item.record?.file?.size), formatAudioDuration(item.durationSeconds)].filter(Boolean).join(' · ')
    }
    const images = item.images || []
    return [item.textSourceName || '', images.length ? `${images.length} 张图片` : ''].filter(Boolean).join(' · ')
  }

  function renderItem(item, index) {
    const errors = itemErrors(item)
    const isError = errors.length > 0
    const disabled = state.loading ? ' disabled' : ''
    const remove = `<button class="btn-text btn-danger" data-import-remove="${index}" type="button"${disabled}>移除</button>`
    if (item.kind === 'text') {
      return `
        <article class="import-item import-item-text ${isError ? 'has-error' : ''}">
          <span class="import-item-index">${index + 1}</span>
          <div class="import-item-content">
            <textarea data-import-field="content" data-import-index="${index}" rows="1"${disabled}>${escapeHtml(item.content)}</textarea>
            <div class="import-item-meta ${isError ? '' : 'hidden'}">${escapeHtml(itemMetaText(item, errors))}</div>
          </div>
          <div class="import-item-actions">${remove}</div>
        </article>
      `
    }
    if (item.kind === 'audio') {
      const retry = item.retryable
        ? `<button class="btn-text" data-import-retry-audio="${index}" type="button"${disabled}>重试上传</button>`
        : ''
      return `
        <article class="import-item import-item-media import-item-audio ${isError ? 'has-error' : ''}">
          <span class="import-item-index">${index + 1}</span>
          <div class="import-item-body">
            <strong title="${escapeHtml(item.originalFilename)}">${escapeHtml(item.originalFilename)}</strong>
            <div class="import-item-meta">${escapeHtml(itemMetaText(item, errors))}</div>
          </div>
          <div class="import-item-actions">${retry}${remove}</div>
        </article>
      `
    }
    const images = item.images || []
    const thumbnails = images.map(itemThumbnail).join('')
    const mediaPreview = images.length
      ? `<div class="import-thumb-list">${thumbnails}</div>`
      : ''
    const retry = images.some((image) => image.error && image.retryable)
      ? `<button class="btn-text" data-import-retry-images="${index}" type="button"${disabled}>重试图片</button>`
      : ''
    const removeFailed = images.some((image) => image.error)
      ? `<button class="btn-text btn-danger" data-import-remove-failed-images="${index}" type="button"${disabled}>移除异常图片</button>`
      : ''
    const fields = `<input data-import-field="label" data-import-index="${index}" value="${escapeHtml(item.label)}" aria-label="标签"${disabled}>`
    const itemContent = `${fields}${mediaPreview}`
    const meta = `<div class="import-item-meta">${escapeHtml(itemMetaText(item, errors))}</div>`
    return `
      <article class="import-item import-item-media import-item-album ${isError ? 'has-error' : ''}">
        <span class="import-item-index">${index + 1}</span>
        <div class="import-item-body">
          ${itemContent}
          ${meta}
        </div>
        <div class="import-item-actions">${retry}${removeFailed}${remove}</div>
      </article>
    `
  }

  function setImportLocked(locked) {
    state.locked = locked
    ;[nodes.back, nodes.audioFiles, nodes.errorCount, nodes.errorFilter, nodes.folderFiles, nodes.selectAudio, nodes.selectFolder, nodes.selectText, nodes.splitMode, nodes.textFile].forEach((node) => {
      if (node) node.disabled = locked
    })
    nodes.typeTabs.querySelectorAll('[data-import-type]').forEach((button) => { button.disabled = locked })
    nodes.previewList.querySelectorAll('button, input, textarea').forEach((node) => { node.disabled = locked })
    if (nodes.targetPool) nodes.targetPool.disabled = locked || state.targetLocked
  }

  function renderSummary() {
    syncBatchLimitError()
    const validItems = state.items.filter((item) => !hasErrors(item))
    const errorItems = state.items.filter(hasErrors)
    const noun = typeConfig[type].noun
    nodes.validCount.textContent = `${validItems.length} ${noun}可导入`
    nodes.validCount.classList.toggle('hidden', validItems.length === 0)
    nodes.errorCount.textContent = `${errorItems.length} ${noun}需处理`
    nodes.errorCount.classList.toggle('hidden', errorItems.length === 0)
    nodes.errorFilter.classList.toggle('hidden', errorItems.length === 0)
    nodes.errorFilter.textContent = state.showErrors ? '查看全部' : '只看需处理'
    const skipped = skippedSummary()
    nodes.previewHint.textContent = state.items.length
      ? `${state.showErrors ? `显示 ${errorItems.length} ${noun}需处理项` : `已识别 ${state.items.length} ${noun}`}${skipped ? `，${skipped}` : ''}`
      : (state.completed && skipped ? skipped : '选择文件后显示预览')
    const mediaLabel = type === 'audio' ? '条音频' : '张图片'
    nodes.progress.textContent = state.progress.total
      ? (state.progress.stage === 'registering'
        ? `第 2/3 步：等待图片处理 ${state.progress.completed}/${state.progress.total} ${mediaLabel}${state.progress.retryAttempt ? `（自动重试 ${state.progress.retryAttempt}/${state.progress.retryTotal}）` : ''}`
        : state.progress.stage === 'saving'
          ? `${type === 'album' ? '第 3/3 步' : type === 'audio' ? '第 2/2 步' : '第 1/1 步'}：正在写入 ${state.progress.total} ${noun}${state.progress.retryAttempt ? `（自动重试 ${state.progress.retryAttempt}/${state.progress.retryTotal}）` : ''}`
          : state.progress.stage === 'processing'
            ? `第 1/2 步：正在上传并统一响度 ${state.progress.completed}/${state.progress.total} ${mediaLabel}`
            : `第 1/3 步：正在上传原图 ${state.progress.completed}/${state.progress.total} ${mediaLabel}${state.progress.retryAttempt ? `（自动重试 ${state.progress.retryAttempt}/${state.progress.retryTotal}）` : ''}`)
      : ''
    nodes.progress.classList.toggle('hidden', !state.loading || !state.progress.total)
    nodes.operationError.textContent = state.operationError
    nodes.operationError.classList.toggle('hidden', !state.operationError)
    const canContinue = state.operationError && !state.batchLimitError && state.items.length && errorItems.length === 0
    nodes.confirm.disabled = state.loading || state.checkingDuplicates || !state.content || !state.items.length || state.batchLimitError || errorItems.length > 0 || state.completed
    nodes.confirm.textContent = state.completed
      ? '导入完成'
      : state.checkingDuplicates
        ? '检查中…'
      : state.loading
        ? (state.progress.stage === 'registering' ? '等待处理中…' : state.progress.stage === 'saving' ? '写入中…' : '上传中…')
        : canContinue ? '继续导入' : '确认导入'
    setImportLocked(state.loading || state.checkingDuplicates)
  }

  function render() {
    const visibleItems = state.showErrors
      ? state.items.map((item, index) => ({ item, index })).filter(({ item }) => hasErrors(item))
      : state.items.map((item, index) => ({ item, index }))
    nodes.previewList.innerHTML = visibleItems.length
      ? visibleItems.map(({ item, index }) => renderItem(item, index)).join('')
      : '<div class="import-empty">暂无可预览内容</div>'
    renderSummary()
  }

  function imageContexts(items = state.items) {
    const seenClientIds = new Set()
    return items.flatMap((item) => (item.images || []).flatMap((image) => {
      if (seenClientIds.has(image.clientId)) return []
      seenClientIds.add(image.clientId)
      return [{ image, item }]
    }))
  }

  function chunkItems(items, size = 100) {
    const chunks = []
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
    return chunks
  }

  async function processInChunks(items, handler, size = 100) {
    for (const chunk of chunkItems(items, size)) await handler(chunk)
  }

  function imageUploadBody(image) {
    const file = image.record.file
    return {
      clientId: image.clientId,
      label: image.label,
      name: image.record.name,
      originalSha256: image.originalSha256,
      size: Number(file.size || 0),
      type: String(file.type || mimeByName(image.record.name)).trim(),
      usage: 'daily_content',
    }
  }

  function resolveDuplicateImageAssets(items = state.items) {
    const contexts = imageContexts(items)
    const imagesByClientId = new Map(contexts.map(({ image }) => [image.clientId, image]))
    contexts.forEach(({ image }) => {
      if (!image.duplicateOfClientId) return
      const canonical = imagesByClientId.get(image.duplicateOfClientId)
      if (!canonical) {
        image.duplicateOfClientId = ''
        return
      }
      image.assetId = canonical.assetId || ''
      if (image.assetId) image.duplicateOfClientId = ''
    })
  }

  async function uploadPreparedImage(context, prepared) {
    const { image } = context
    const response = await fetch(prepared.upload.uploadUrl, {
      method: 'PUT',
      headers: {
        ...(prepared.upload.headers || {}),
        authorization: prepared.upload.authorization || '',
      },
      body: image.record.file,
    })
    await assertCosImageProcessingSucceeded(response, [prepared.urls.mediumUrl, prepared.urls.thumbUrl])
    image.completion = {
      clientId: image.clientId,
      imageId: prepared.task.imageId,
      label: prepared.task.label,
      mediumUrl: prepared.urls.mediumUrl,
      originalName: prepared.task.originalName,
      originalSha256: prepared.task.originalSha256,
      originalSize: prepared.task.originalSize,
      originalUrl: prepared.urls.originalUrl,
      taskId: prepared.task.id,
      thumbUrl: prepared.urls.thumbUrl,
      token: prepared.task.token,
      usage: prepared.task.usage,
    }
    image.error = ''
    image.retryable = false
  }

  async function uploadPendingImages(items = state.items) {
    resolveDuplicateImageAssets(items)
    const contexts = imageContexts(items).filter(({ image }) => !image.assetId && !image.error)
    const fresh = contexts.filter(({ image }) => !image.completion && !image.duplicateOfClientId)
    if (fresh.length) {
      state.progress = { completed: 0, stage: 'uploading', total: fresh.length }
      renderSummary()
      await processInChunks(fresh, async (freshChunk) => {
        const prepared = await runWithRetry(() => apiRequest('/api/admin/images/upload/prepare-batch', {
          method: 'POST',
          body: JSON.stringify({ items: freshChunk.map(({ image }) => imageUploadBody(image)) }),
        }), {
          delays: [800, 2000],
          onRetry: (_error, retryAttempt, retryTotal) => {
            state.progress = { ...state.progress, retryAttempt, retryTotal }
            renderSummary()
          },
          shouldRetry: isTemporaryRequestError,
        })
        const preparedByClientId = new Map((prepared.items || []).map((item) => [item.clientId, item]))
        freshChunk.forEach((context) => {
          const preparedItem = preparedByClientId.get(context.image.clientId)
          if (preparedItem?.reusedAssetId) context.image.assetId = preparedItem.reusedAssetId
          if (preparedItem?.duplicateOfClientId) context.image.duplicateOfClientId = preparedItem.duplicateOfClientId
        })
        const uploadableChunk = freshChunk.filter(({ image }) => !image.assetId && !image.duplicateOfClientId)
        state.progress.completed += freshChunk.length - uploadableChunk.length
        let cursor = 0
        state.progress = { completed: state.progress.completed, stage: 'uploading', total: fresh.length }
        renderSummary()
        const worker = async () => {
          while (cursor < uploadableChunk.length) {
            const context = uploadableChunk[cursor]
            cursor += 1
            try {
              const upload = preparedByClientId.get(context.image.clientId)
              if (!upload) throw new Error('上传任务缺失，请重试')
              await runWithRetry(
                () => uploadPreparedImage(context, upload),
                {
                  delays: [500, 1000],
                  onRetry: (_error, retryAttempt, retryTotal) => {
                    state.progress = { ...state.progress, retryAttempt, retryTotal }
                    renderSummary()
                  },
                  shouldRetry: isTemporaryRequestError,
                },
              )
            } catch (error) {
              context.image.error = error.message || '图片上传失败'
              context.image.retryable = isTemporaryRequestError(error) || /上传任务缺失/.test(context.image.error)
            } finally {
              state.progress.completed += 1
              renderSummary()
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(3, uploadableChunk.length) }, worker))
      })
    }

    const completed = imageContexts(items).filter(({ image }) => !image.assetId && image.completion)
    if (!completed.length) {
      resolveDuplicateImageAssets(items)
      return
    }
    state.progress = { completed: 0, stage: 'registering', total: completed.length }
    renderSummary()
    await processInChunks(completed, async (completedChunk) => {
      let assetsByClientId
      try {
        assetsByClientId = await runWithRetry(async () => {
          const registered = await apiRequest('/api/admin/images/upload/complete-batch', {
            method: 'POST',
            body: JSON.stringify({ items: completedChunk.map(({ image }) => image.completion) }),
          })
          const assets = new Map((registered.items || []).map((item) => [item.clientId, item.item]))
          if (completedChunk.some(({ image }) => !assets.get(image.clientId)?.id)) {
            const error = new Error('图片登记结果缺失，请重试')
            error.status = 425
            throw error
          }
          return assets
        }, {
          delays: [800, 2000],
          onRetry: (_error, retryAttempt, retryTotal) => {
            state.progress = { ...state.progress, retryAttempt, retryTotal }
            renderSummary()
          },
          shouldRetry: isTemporaryImageCompletionError,
        })
      } catch (error) {
        if (markPendingCompletedImages(completedChunk, error)) return
        throw error
      }
      completedChunk.forEach(({ image }) => {
        const asset = assetsByClientId.get(image.clientId)
        image.assetId = asset.id
        image.completion = null
        image.error = ''
        image.retryable = false
      })
      state.progress = {
        completed: state.progress.completed + completedChunk.length,
        stage: 'registering',
        total: completed.length,
      }
      renderSummary()
    })
    resolveDuplicateImageAssets(items)
  }

  async function uploadPreparedAudio(item) {
    const file = item.record.file
    const formData = new FormData()
    formData.append('audio', file, item.originalFilename)
    formData.append('clientId', item.id)
    formData.append('durationSeconds', String(item.durationSeconds || 0))
    formData.append('label', String(item.label || '默认'))
    const uploaded = await apiRequest('/api/admin/audios/upload', {
      method: 'POST',
      body: formData,
    })
    item.audio = uploaded.item
    item.uploadError = ''
    item.retryable = false
  }

  async function uploadPendingAudios(items = state.items) {
    const candidates = items.filter((item) => item.kind === 'audio' && !item.audio && !hasErrors(item))
    const fresh = candidates.filter((item) => !item.audio)
    if (fresh.length) {
      let cursor = 0
      state.progress = { completed: 0, stage: 'processing', total: fresh.length }
      renderSummary()
      const worker = async () => {
        while (cursor < fresh.length) {
          const item = fresh[cursor]
          cursor += 1
          try {
            await runWithRetry(
              () => uploadPreparedAudio(item),
              { delays: [1000, 2500], shouldRetry: isTemporaryRequestError },
            )
          } catch (error) {
            item.uploadError = error.message || '音频上传失败'
            item.retryable = true
          } finally {
            state.progress.completed += 1
            renderSummary()
          }
        }
      }
      await Promise.all(Array.from({ length: 1 }, worker))
    }

  }

  function importPayload() {
    const payload = {
      poolId: state.targetPoolId,
      miniProgramId: state.miniProgramId,
      type: typeConfig[type].contentType,
      items: [],
    }
    if (type === 'text') {
      payload.items = state.items.map((item) => ({ id: item.id, label: item.label, text: normalizeContentText(item.content), likeCount: 0, favoriteCount: 0 }))
    } else if (type === 'letter-copy') {
      payload.items = state.items.map((item) => ({ id: item.id, label: item.label, content: normalizeContentText(item.content), likeCount: 0, favoriteCount: 0 }))
    } else if (type === 'album') {
      payload.items = state.items.map((item) => ({
        id: item.id,
        label: item.label,
        images: item.images.map((image) => ({ id: image.assetId })),
        likeCount: 0,
        favoriteCount: 0,
    }))
    } else if (type === 'audio') {
      payload.items = state.items.map((item) => ({ ...item.audio, id: item.id }))
    } else throw new Error('不支持的导入类型')
    return payload
  }

  function notifyOpener(importedCount) {
    window.dispatchEvent(new CustomEvent('content-import-complete', {
      detail: { importedCount, miniProgramId: state.miniProgramId, noun: typeConfig[type].noun, poolId: state.targetPoolId },
    }))
  }

  async function confirmImport() {
    if (state.loading || state.completed) return
    syncBatchLimitError()
    if (state.batchLimitError) {
      render()
      showToast(state.batchLimitError)
      return
    }
    if (state.items.some(hasErrors)) {
      state.showErrors = true
      render()
      showToast('请先处理标记的内容')
      return
    }
    state.operationError = ''
    state.loading = true
    if (type === 'album') {
      const pending = imageContexts().filter(({ image }) => !image.assetId && !image.error)
      const fresh = pending.filter(({ image }) => !image.completion)
      state.progress = {
        completed: 0,
        stage: fresh.length ? 'uploading' : 'registering',
        total: fresh.length || pending.length,
      }
    } else if (type === 'audio') {
      state.progress = { completed: 0, stage: 'processing', total: state.items.filter((item) => !item.audio).length }
    } else {
      state.progress = { completed: 0, stage: 'saving', total: state.items.length }
    }
    render()
    try {
      if (type === 'album') {
        await uploadPendingImages()
        if (state.items.some(hasErrors)) {
          state.showErrors = true
          state.operationError = '有图片上传失败。请重试标记的图片，或移除异常图片后继续导入。'
          showToast('存在上传失败图片，请处理后重试')
          return
        }
      }
      if (type === 'audio') {
        await uploadPendingAudios()
        if (state.items.some(hasErrors)) {
          state.showErrors = true
          state.operationError = '有音频上传失败。请重试标记的音频，或移除异常内容后继续导入。'
          showToast('存在上传失败音频，请处理后重试')
          return
        }
      }
      state.progress = { completed: 0, stage: 'saving', total: state.items.length }
      renderSummary()
      const payload = importPayload()
      state.content = await runWithRetry(() => apiRequest('/api/admin/content/items', {
        method: 'POST',
        body: JSON.stringify(payload),
      }), {
        delays: [800, 2000],
        onRetry: (_error, retryAttempt, retryTotal) => {
          state.progress = { completed: 0, retryAttempt, retryTotal, stage: 'saving', total: state.items.length }
          renderSummary()
        },
        shouldRetry: isTemporaryRequestError,
      })
      state.completed = true
      const importedCount = Number(state.content.importedCount || 0)
      state.skippedContentCount += Number(state.content.duplicateCount || 0)
      renderSourceResultStatus()
      notifyOpener(importedCount)
      const skipped = skippedSummary()
      showToast(importedCount
        ? `已成功导入 ${importedCount} ${typeConfig[type].noun}${skipped ? `，${skipped}` : ''}`
        : '本批内容已存在，未重复导入')
    } catch (error) {
      const message = error.message || '导入失败'
      const hasReusableUploads = imageContexts().some(({ image }) => image.completion || image.assetId)
        || state.items.some((item) => item.audio)
      state.operationError = hasReusableUploads
        ? `${message}。已上传的素材会保留，点击“继续导入”将从中断处继续。`
        : `${message}。请点击“继续导入”重试。`
      showToast(message)
    } finally {
      state.loading = false
      render()
    }
  }

  function returnToContent() {
    if (state.loading) {
      showToast('正在导入，请等待当前批次完成')
      return
    }
    if (type === 'article') {
      window.dispatchEvent(new CustomEvent('close-article-import'))
      return
    }
    window.showSection?.('content')
  }

  async function retryFailedImages(index) {
    const item = state.items[index]
    if (!item || state.loading || state.completed) return
    const retryable = (item.images || []).filter((image) => image.error && image.retryable)
    if (!retryable.length) return
    retryable.forEach((image) => {
      image.error = ''
      image.retryable = false
    })
    state.operationError = ''
    state.loading = true
    state.progress = { completed: 0, stage: '', total: 0 }
    render()
    try {
      await uploadPendingImages([item])
      if (hasErrors(item)) showToast('仍有异常图片，请移除异常图片或重新选择文件夹')
      else showToast('异常图片已重新上传')
    } catch (error) {
      const message = error.message || '图片重试失败'
      state.operationError = `${message}。已上传的图片会保留，请稍后继续导入。`
      showToast(message)
    } finally {
      state.loading = false
      render()
    }
  }

  async function retryFailedAudio(index) {
    const item = state.items[index]
    if (!item || item.kind !== 'audio' || state.loading || state.completed || !item.retryable) return
    item.uploadError = ''
    item.retryable = false
    state.operationError = ''
    state.loading = true
    state.progress = { completed: 0, stage: '', total: 0 }
    render()
    try {
      await uploadPendingAudios([item])
      if (hasErrors(item)) showToast('音频仍未上传成功，请重新选择文件后再试')
      else showToast('音频已重新上传，等待确认导入')
    } catch (error) {
      item.uploadError = error.message || '音频重试失败'
      item.retryable = true
      state.operationError = `${item.uploadError}。请稍后重试。`
      showToast(item.uploadError)
    } finally {
      state.loading = false
      render()
    }
  }

  function updateItemField(event) {
    const target = event.target
    const index = Number(target.dataset.importIndex)
    const field = target.dataset.importField
    const item = state.items[index]
    if (state.loading || !Number.isInteger(index) || !field || !item) return
    const hadErrors = hasErrors(item)
    item[field] = target.value
    if (field === 'content') {
      item.errors = (item.errors || []).filter((message) => message !== '文案为空' && message !== '正文为空')
      if (!String(target.value || '').trim()) item.errors.push('文案为空')
    }
    const errors = itemErrors(item)
    const row = target.closest('.import-item')
    if (row) {
      row.classList.toggle('has-error', errors.length > 0)
      const meta = row.querySelector('.import-item-meta')
      if (meta) {
        meta.textContent = itemMetaText(item, errors)
        meta.classList.toggle('hidden', !errors.length && item.kind === 'text')
      }
    }
    renderSummary()
    if (state.showErrors && hadErrors !== (errors.length > 0)) render()
  }

  function normalizeItemContent(event) {
    const target = event.target
    if (target.dataset.importField !== 'content') return
    const normalized = normalizeContentText(target.value)
    if (target.value === normalized) return
    target.value = normalized
    updateItemField(event)
  }

  function handleSourceError(error, fallbackMessage) {
    const message = error?.message || fallbackMessage
    state.items = []
    state.operationError = message
    state.progress = { completed: 0, stage: '', total: 0 }
    nodes.sourceStatus.textContent = `${state.sourceName || '所选文件'} · 解析失败`
    render()
    showToast(message)
  }

  function configurePage() {
    const config = typeConfig[type]
    document.querySelector('#importHint').textContent = config.hint
    nodes.sourceTitle.textContent = config.source === 'audio' ? '选择音频文件' : '选择导入文件'
    nodes.sourceHint.textContent = config.sourceHint
    nodes.selectText.classList.toggle('hidden', config.source !== 'text')
    nodes.selectAudio.classList.toggle('hidden', config.source !== 'audio')
    nodes.selectFolder.classList.toggle('hidden', config.source !== 'files')
    nodes.splitControl.classList.toggle('hidden', config.source !== 'text')
    nodes.typeTabs.querySelectorAll('[data-import-type]').forEach((button) => {
      const active = button.dataset.importType === type
      button.classList.toggle('active', active)
      button.setAttribute('aria-selected', String(active))
      button.setAttribute('aria-pressed', String(active))
    })
  }

  function resetImportState() {
    revokePreviewUrls()
    state.completed = false
    state.batchLimitError = ''
    state.checkingDuplicates = false
    state.content = null
    state.items = []
    state.operationError = ''
    state.records = []
    state.selectionGeneration += 1
    state.progress = { completed: 0, stage: '', total: 0 }
    state.showErrors = false
    state.skippedContentCount = 0
    state.skippedImageCount = 0
    state.sourceName = ''
    state.sourceResultStatus = ''
    state.sourceText = ''
    state.splitMode = 'auto'
    nodes.splitMode.value = 'auto'
    nodes.textFile.value = ''
    nodes.audioFiles.value = ''
    nodes.folderFiles.value = ''
    nodes.sourceStatus.textContent = '尚未选择文件'
  }

  async function loadContent() {
    const query = new URLSearchParams()
    if (state.targetPoolId) query.set('poolId', state.targetPoolId)
    if (state.miniProgramId) query.set('miniProgramId', state.miniProgramId)
    const path = query.size ? `/api/admin/content?${query}` : '/api/admin/content'
    state.content = await apiRequest(path)
    state.targetPoolId = state.content.poolId
    if (nodes.targetPool) nodes.targetPool.value = state.targetPoolId
  }

  function readImportContext(detail = {}) {
    const current = window.getAdminContentImportContext?.() || {}
    const contentPools = Array.isArray(current.contentPools) ? current.contentPools : []
    const miniProgramId = String(detail.miniProgramId || current.miniProgramId || '').trim()
    const fallbackPoolId = String(current.boundPoolId || contentPools[0]?.id || '').trim()
    const preservedPoolId = detail.preserveTarget ? String(detail.poolId || '').trim() : ''
    const targetPoolId = contentPools.some((item) => item.id === preservedPoolId) ? preservedPoolId : fallbackPoolId
    return { ...current, contentPools, miniProgramId, targetPoolId }
  }

  function renderTargetPoolOptions(context) {
    if (!nodes.targetPool) return
    nodes.targetPool.innerHTML = context.contentPools.map((item) => {
      const bound = item.id === context.boundPoolId ? '（当前实例绑定）' : ''
      return `<option value="${escapeHtml(item.id)}" ${item.id === context.targetPoolId ? 'selected' : ''}>${escapeHtml(item.name)}${bound}</option>`
    }).join('')
    nodes.targetPool.value = context.targetPoolId
  }

  async function changeTargetPool() {
    if (state.loading || state.checkingDuplicates || state.targetLocked) return
    const targetPoolId = String(nodes.targetPool?.value || '').trim()
    if (!targetPoolId || targetPoolId === state.targetPoolId) return
    state.targetPoolId = targetPoolId
    state.content = null
    if (type === 'article') {
      window.dispatchEvent(new CustomEvent('content-import-target-change', {
        detail: { miniProgramId: state.miniProgramId, poolId: state.targetPoolId },
      }))
      return
    }
    try {
      await loadContent()
      if (state.sourceText) {
        const selectionGeneration = beginSourceSelection()
        await parseTextSource(selectionGeneration)
      } else if (state.records.length && type === 'album') {
        await selectRecords(state.records, state.sourceName)
      } else render()
    } catch (error) {
      state.operationError = error.message || '内容池切换失败'
      render()
      showToast(state.operationError)
    }
  }

  async function openImport(detail = {}) {
    if (state.loading) {
      showToast('正在导入，请等待当前批次完成')
      return
    }
    const nextType = String(detail.type || type).trim()
    if (typeConfig[nextType]) type = nextType
    const context = readImportContext(detail)
    state.targetPoolId = context.targetPoolId
    state.miniProgramId = context.miniProgramId
    state.targetLocked = false
    resetImportState()
    renderTargetPoolOptions(context)
    configurePage()
    if (type === 'article') {
      window.dispatchEvent(new CustomEvent('open-article-import', {
        detail: { miniProgramId: state.miniProgramId, poolId: state.targetPoolId },
      }))
      return
    }
    document.querySelector('#import')?.classList.remove('article-url-import-active')
    document.querySelector('#articleUrlImportPanel')?.classList.add('hidden')
    nodes.sourceActions.classList.remove('hidden')
    window.showSection?.('import')
    try {
      await loadContent()
    } catch (error) {
      nodes.sourceActions.classList.add('hidden')
      nodes.sourceStatus.textContent = '请先登录后台后再导入内容'
      state.operationError = error.message || '内容池加载失败'
      showToast(error.message || '内容池加载失败')
    }
    render()
  }

  function bindEvents() {
    nodes.selectText.addEventListener('click', () => {
      if (state.loading) return
      nodes.textFile.value = ''
      nodes.textFile.click()
    })
    nodes.selectFolder.addEventListener('click', () => {
      if (state.loading) return
      nodes.folderFiles.value = ''
      nodes.folderFiles.click()
    })
    nodes.selectAudio.addEventListener('click', () => {
      if (state.loading) return
      nodes.audioFiles.value = ''
      nodes.audioFiles.click()
    })
    nodes.textFile.addEventListener('change', () => {
      if (!state.loading) selectTextFile(nodes.textFile.files?.[0]).catch((error) => handleSourceError(error, 'TXT 读取失败'))
    })
    nodes.folderFiles.addEventListener('change', () => {
      if (state.loading) return
      const records = Array.from(nodes.folderFiles.files || []).map((file) => ({ file, name: file.name, path: file.webkitRelativePath || file.name }))
      selectRecords(records, '已选择文件夹').catch((error) => handleSourceError(error, '文件夹读取失败'))
    })
    nodes.audioFiles.addEventListener('change', () => {
      if (state.loading) return
      const records = Array.from(nodes.audioFiles.files || []).map((file) => ({ file, name: file.name, path: file.name }))
      selectRecords(records, `已选择 ${records.length} 个音频文件`).catch((error) => handleSourceError(error, '音频读取失败'))
    })
    nodes.splitMode.addEventListener('change', () => {
      if (state.loading || state.checkingDuplicates) return
      state.splitMode = nodes.splitMode.value
      if (state.sourceText) {
        const selectionGeneration = beginSourceSelection()
        parseTextSource(selectionGeneration).catch((error) => handleSourceError(error, 'TXT 解析失败'))
      }
    })
    nodes.errorFilter.addEventListener('click', () => {
      if (state.loading) return
      state.showErrors = !state.showErrors
      render()
    })
    nodes.errorCount.addEventListener('click', () => {
      if (state.loading) return
      state.showErrors = true
      render()
    })
    nodes.previewList.addEventListener('click', (event) => {
      if (state.loading) return
      const retry = event.target.closest('[data-import-retry-images]')
      if (retry) {
        retryFailedImages(Number(retry.dataset.importRetryImages))
        return
      }
      const retryAudio = event.target.closest('[data-import-retry-audio]')
      if (retryAudio) {
        retryFailedAudio(Number(retryAudio.dataset.importRetryAudio))
        return
      }
      const removeFailed = event.target.closest('[data-import-remove-failed-images]')
      if (removeFailed) {
        const index = Number(removeFailed.dataset.importRemoveFailedImages)
        if (!Number.isInteger(index) || !state.items[index]) return
        state.items[index].images.filter((image) => image.error).forEach((image) => revokeImagePreviewUrl(image, state.items[index]))
        state.items[index].images = state.items[index].images.filter((image) => !image.error)
        render()
        return
      }
      const remove = event.target.closest('[data-import-remove]')
      if (!remove) return
      const index = Number(remove.dataset.importRemove)
      if (!Number.isInteger(index) || !state.items[index]) return
      revokeItemPreviewUrls(state.items[index])
      state.items.splice(index, 1)
      render()
    })
    nodes.previewList.addEventListener('input', updateItemField)
    nodes.previewList.addEventListener('change', normalizeItemContent)
    nodes.confirm.addEventListener('click', confirmImport)
    nodes.targetPool?.addEventListener('change', () => { void changeTargetPool() })
    nodes.back.addEventListener('click', returnToContent)
    nodes.typeTabs.addEventListener('click', (event) => {
      if (state.loading) return
      const button = event.target.closest('[data-import-type]')
      if (!button || button.dataset.importType === type) return
      openImport({ type: button.dataset.importType, miniProgramId: state.miniProgramId, poolId: state.targetPoolId, preserveTarget: true })
    })
    document.querySelector('.nav-item[data-section="import"]')?.addEventListener('click', () => openImport({ type }))
    window.addEventListener('open-content-import', (event) => openImport(event.detail || {}))
    window.addEventListener('content-import-target-lock', (event) => {
      state.targetLocked = Boolean(event.detail?.locked)
      if (nodes.targetPool) nodes.targetPool.disabled = state.locked || state.targetLocked
    })
    window.addEventListener('beforeunload', revokePreviewUrls)
  }

  async function bootstrap() {
    configurePage()
    bindEvents()
    render()
  }

  bootstrap()
})()
