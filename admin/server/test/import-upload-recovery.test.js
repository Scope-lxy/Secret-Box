const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const importer = fs.readFileSync(path.resolve(__dirname, '../admin/src/import.js'), 'utf8')
const importGuide = fs.readFileSync(path.resolve(__dirname, '../../docs/content-import.md'), 'utf8')
const main = fs.readFileSync(path.resolve(__dirname, '../admin/src/main.js'), 'utf8')
const page = fs.readFileSync(path.resolve(__dirname, '../admin/src/index.html'), 'utf8')

function loadRetryHelpers() {
  const source = importer.match(/  function wait\(delay\) \{[\s\S]*?  function showToast\(message\) \{/)
  assert.ok(source, 'retry helpers should remain available in import.js')
  const helperSource = source[0].replace(/\n  function showToast\(message\) \{[\s\S]*$/, '')
  return Function(`${helperSource}; return { runWithRetry, isTemporaryRequestError, isTemporaryImageCompletionError }`)()
}

function loadApiRequest(fetch) {
  const source = importer.match(/  async function apiRequest\(path, options = \{\}\) \{[\s\S]*?\n  \}\n\n  function wait/)
  assert.ok(source)
  const helperSource = source[0].replace(/\n\n  function wait[\s\S]*$/, '')
  return Function('fetch', 'FormData', `const API_BASE = 'https://example.test'; ${helperSource}; return apiRequest`)(fetch, class FormData {})
}

function loadSelectionHelpers(state) {
  const source = importer.match(/  function beginSourceSelection\(\) \{[\s\S]*?  function isCurrentSourceSelection\(selectionGeneration\) \{[\s\S]*?\n  \}/)
  assert.ok(source)
  return Function('state', `${source[0]}; return { beginSourceSelection, isCurrentSourceSelection }`)(state)
}

function loadChunkHelpers() {
  const source = importer.match(/  function chunkItems\(items, size = 100\) \{[\s\S]*?  async function processInChunks\(items, handler, size = 100\) \{[\s\S]*?\n  \}/)
  assert.ok(source)
  return Function(`${source[0]}; return { chunkItems, processInChunks }`)()
}

function loadImportPolicyHelpers() {
  const source = importer.match(/  function getBatchLimitError\(items\) \{[\s\S]*?  function markPendingCompletedImages\(completedChunk, error\) \{[\s\S]*?\n  \}/)
  assert.ok(source)
  return Function(`${source[0]}; return { getBatchLimitError, markPendingCompletedImages }`)()
}

function loadImageDeduplicationHelpers(state) {
  const deduplicationSource = importer.match(/  function applyImageDeduplication\(reusableImages = \[\]\) \{[\s\S]*?\n  \}\n\n  async function preflightParsedItems/)
  const contextsSource = importer.match(/  function imageContexts\(items = state\.items\) \{[\s\S]*?\n  \}\n\n  function chunkItems/)
  const aliasSource = importer.match(/  function resolveDuplicateImageAssets\(items = state\.items\) \{[\s\S]*?\n  \}\n\n  async function uploadPreparedImage/)
  assert.ok(deduplicationSource)
  assert.ok(contextsSource)
  assert.ok(aliasSource)
  const functions = `${deduplicationSource[0].replace(/\n\n  async function preflightParsedItems[\s\S]*$/, '')}\n${contextsSource[0].replace(/\n\n  function chunkItems[\s\S]*$/, '')}\n${aliasSource[0].replace(/\n\n  async function uploadPreparedImage[\s\S]*$/, '')}`
  return Function('state', 'URL', `${functions}; return { applyImageDeduplication, imageContexts, resolveDuplicateImageAssets }`)(state, { revokeObjectURL() {} })
}

test('temporary image processing failures retry and permanent failures stop immediately', async () => {
  const { isTemporaryImageCompletionError, isTemporaryRequestError, runWithRetry } = loadRetryHelpers()
  let attempts = 0
  const result = await runWithRetry(async () => {
    attempts += 1
    if (attempts < 3) {
      const error = new Error('temporary upstream failure')
      error.status = 503
      throw error
    }
    return 'registered'
  }, {
    delays: [0, 0, 0],
    shouldRetry: isTemporaryImageCompletionError,
  })

  assert.equal(result, 'registered')
  assert.equal(attempts, 3)

  let permanentAttempts = 0
  await assert.rejects(() => runWithRetry(async () => {
    permanentAttempts += 1
    throw new Error('图片上传凭证无效')
  }, {
    delays: [0, 0, 0],
    shouldRetry: isTemporaryImageCompletionError,
  }), /图片上传凭证无效/)
  assert.equal(permanentAttempts, 1)

  let serverAttempts = 0
  const recovered = await runWithRetry(async () => {
    serverAttempts += 1
    if (serverAttempts < 3) {
      const error = new Error('temporary upstream failure')
      error.status = 503
      throw error
    }
    return 'saved'
  }, {
    delays: [0, 0],
    shouldRetry: isTemporaryRequestError,
  })
  assert.equal(recovered, 'saved')
  assert.equal(serverAttempts, 3)

  let unauthorizedAttempts = 0
  await assert.rejects(() => runWithRetry(async () => {
    unauthorizedAttempts += 1
    const error = new Error('网络登录状态失效')
    error.status = 401
    throw error
  }, {
    delays: [0, 0],
    shouldRetry: isTemporaryRequestError,
  }), /网络登录状态失效/)
  assert.equal(unauthorizedAttempts, 1)

  let pendingAttempts = 0
  await assert.rejects(() => runWithRetry(async () => {
    pendingAttempts += 1
    const error = new Error('图片尚未处理完成，请稍后重试')
    error.status = 409
    throw error
  }, {
    delays: [0, 0],
    shouldRetry: isTemporaryImageCompletionError,
  }), /图片尚未处理完成/)
  assert.equal(pendingAttempts, 1)
  assert.match(importer, /\[408, 425, 429\]\.includes\(status\)/)
  assert.doesNotMatch(importer, /\[408, 409, 425, 429\]/)
  assert.match(importer, /delays: \[500, 1000\],[\s\S]*?shouldRetry: isTemporaryRequestError/)
  assert.match(importer, /context\.image\.retryable = isTemporaryRequestError\(error\)/)
})

test('continuing an interrupted import reuses completion data and does not upload originals again', () => {
  assert.match(importer, /const fresh = contexts\.filter\(\(\{ image \}\) => !image\.completion && !image\.duplicateOfClientId\)/)
  assert.match(importer, /const completed = imageContexts\(items\)\.filter\(\(\{ image \}\) => !image\.assetId && image\.completion\)/)
  assert.match(importer, /body: JSON\.stringify\(\{ items: completedChunk\.map\(\(\{ image \}\) => image\.completion\) \}\)/)
  assert.match(importer, /image\.assetId = asset\.id\s+image\.completion = null/)
  assert.match(importer, /const canContinue = state\.operationError && !state\.batchLimitError && state\.items\.length && errorItems\.length === 0/)
  assert.match(importer, /canContinue \? '继续导入' : '确认导入'/)
})

test('image requests use 100-item chunks and completed chunks stay finished after a later failure', async () => {
  const { chunkItems, processInChunks } = loadChunkHelpers()
  assert.deepEqual(chunkItems(Array.from({ length: 201 }), 100).map((chunk) => chunk.length), [100, 100, 1])

  const images = Array.from({ length: 101 }, (_, index) => ({ assetId: '', completion: { clientId: `image-${index}` } }))
  const completedSizes = []
  await assert.rejects(() => processInChunks(images, async (chunk) => {
    completedSizes.push(chunk.length)
    if (completedSizes.length === 2) throw new Error('second chunk failed')
    chunk.forEach((image) => {
      image.assetId = `asset-${image.completion.clientId}`
      image.completion = null
    })
  }, 100), /second chunk failed/)

  assert.deepEqual(completedSizes, [100, 1])
  assert.equal(images.filter((image) => image.assetId).length, 100)
  assert.equal(images.filter((image) => !image.assetId && image.completion).length, 1)
  assert.match(importer, /processInChunks\(fresh, async \(freshChunk\) =>/)
  assert.match(importer, /Math\.min\(3, uploadableChunk\.length\)/)
  assert.match(importer, /processInChunks\(completed, async \(completedChunk\) =>/)
  assert.match(importer, /completedChunk\.forEach\(\(\{ image \}\) => \{[\s\S]*?image\.assetId = asset\.id[\s\S]*?image\.completion = null/)
  assert.match(importGuide, /每批最多导入 200 条内容/)
  assert.match(importGuide, /底层按每组最多 100 张依次准备和登记/)
})

test('201 content items stop before media upload and a business 409 marks only pending images', async () => {
  const { getBatchLimitError, markPendingCompletedImages } = loadImportPolicyHelpers()
  let prepareCalls = 0
  let audioCalls = 0
  const items = Array.from({ length: 201 }, () => ({}))
  assert.equal(getBatchLimitError(Array.from({ length: 200 }, () => ({}))), '')
  if (!getBatchLimitError(items)) {
    prepareCalls += 1
    audioCalls += 1
  }
  assert.match(getBatchLimitError(items), /单批最多导入 200 条内容/)
  assert.equal(prepareCalls, 0)
  assert.equal(audioCalls, 0)

  const ready = { assetId: '', clientId: 'ready', completion: { clientId: 'ready' }, error: '', retryable: false }
  const pending = { assetId: '', clientId: 'pending', completion: { clientId: 'pending' }, error: '', retryable: false }
  const handled = markPendingCompletedImages([{ image: ready }, { image: pending }], {
    status: 409,
    details: { pendingClientIds: ['pending'] },
  })
  assert.equal(handled, true)
  assert.equal(ready.error, '')
  assert.equal(ready.retryable, false)
  assert.deepEqual(ready.completion, { clientId: 'ready' })
  assert.match(pending.error, /处理中/)
  assert.equal(pending.retryable, true)
  assert.deepEqual(pending.completion, { clientId: 'pending' })

  const confirmImport = importer.match(/  async function confirmImport\(\) \{[\s\S]*?\n  \}\n\n  function returnToContent/)[0]
  const limitIndex = confirmImport.indexOf('if (state.batchLimitError)')
  assert.ok(limitIndex >= 0)
  assert.ok(limitIndex < confirmImport.indexOf('state.loading = true'))
  assert.ok(limitIndex < confirmImport.indexOf('await uploadPendingImages()'))
  assert.ok(limitIndex < confirmImport.indexOf('await uploadPendingAudios()'))

  const preflightImport = importer.match(/  async function preflightParsedItems\(selectionGeneration, sourceResultStatus\) \{[\s\S]*?\n  \}\n\n  async function parseTextSource/)[0]
  assert.ok(preflightImport.indexOf('syncBatchLimitError()') < preflightImport.indexOf('await hashImportImages(state.items)'))
  assert.ok(preflightImport.indexOf('if (state.batchLimitError') < preflightImport.indexOf('await hashImportImages(state.items)'))
})

test('two album groups keep their image refs while identical bytes need only one PUT', () => {
  const sameHash = 'a'.repeat(64)
  const historicalHash = 'b'.repeat(64)
  const first = { assetId: '', clientId: 'first', originalSha256: sameHash, previewUrl: '' }
  const repeatedInItem = { assetId: '', clientId: 'same-item', originalSha256: sameHash, previewUrl: '' }
  const repeatedAcrossItems = { assetId: '', clientId: 'other-item', originalSha256: sameHash, previewUrl: '' }
  const historical = { assetId: '', clientId: 'historical', originalSha256: historicalHash, previewUrl: '' }
  const state = {
    items: [
      { images: [first, repeatedInItem], kind: 'album', label: '图册一' },
      { images: [repeatedAcrossItems, historical], kind: 'album', label: '图册二' },
    ],
  }
  const { applyImageDeduplication, imageContexts, resolveDuplicateImageAssets } = loadImageDeduplicationHelpers(state)
  assert.equal(applyImageDeduplication([{ assetId: 'asset-history', clientId: 'historical' }]), 3)
  assert.deepEqual(state.items[0].images, [first])
  assert.equal(state.items[1].images[0], repeatedAcrossItems)
  assert.equal(repeatedAcrossItems.duplicateOfClientId, first.clientId)
  assert.equal(historical.assetId, 'asset-history')
  const contexts = imageContexts()
  assert.equal(contexts.length, 3)
  assert.deepEqual(
    contexts.filter(({ image }) => !image.assetId && !image.duplicateOfClientId).map(({ image }) => image.clientId),
    ['first'],
  )
  first.assetId = 'asset-new'
  resolveDuplicateImageAssets()
  assert.equal(repeatedAcrossItems.assetId, 'asset-new')
  assert.equal(repeatedAcrossItems.duplicateOfClientId, '')
  repeatedAcrossItems.assetId = ''
  repeatedAcrossItems.duplicateOfClientId = 'removed-canonical'
  resolveDuplicateImageAssets()
  assert.equal(repeatedAcrossItems.duplicateOfClientId, '')
  assert.match(importer, /crypto\.subtle\.digest\('SHA-256', await file\.arrayBuffer\(\)\)/)
  assert.match(importer, /originalSha256: image\.originalSha256/)
})

test('content is submitted only after image completion succeeds and all stages stay visible', () => {
  const confirmImport = importer.match(/  async function confirmImport\(\) \{[\s\S]*?\n  \}\n\n  function returnToContent/)
  assert.ok(confirmImport)
  const source = confirmImport[0]
  const uploadIndex = source.indexOf('await uploadPendingImages()')
  const contentIndex = source.indexOf("runWithRetry(() => apiRequest('/api/admin/content/items'")
  assert.ok(uploadIndex >= 0 && contentIndex > uploadIndex)
  assert.doesNotMatch(source.slice(uploadIndex, contentIndex), /catch\s*\([^)]*\)\s*\{[\s\S]*?apiRequest\('\/api\/admin\/content\/items'/)

  assert.match(importer, /第 1\/3 步：正在上传原图/)
  assert.match(importer, /第 2\/3 步：等待/)
  assert.match(importer, /第 3\/3 步/)
  assert.match(importer, /notifyOpener\(importedCount\)/)
  assert.match(page, /id="importOperationError" role="alert"/)
})

test('import defaults to the opening mini program binding and reports non-JSON gateway errors', () => {
  const openImport = main.slice(main.indexOf('function openContentImport(type)'), main.indexOf('function setStatus'))
  assert.match(openImport, /miniProgramId: getCurrentMiniProgram\(\)\?\.id \|\| '',\s+type,/)
  assert.doesNotMatch(openImport, /poolId/)
  assert.match(importer, /const fallbackPoolId = String\(current\.boundPoolId \|\| contentPools\[0\]\?\.id \|\| ''\)/)
  assert.match(importer, /state\.miniProgramId = context\.miniProgramId/)
  assert.match(importer, /if \(state\.miniProgramId\) query\.set\('miniProgramId', state\.miniProgramId\)/)
  assert.match(importer, /miniProgramId: state\.miniProgramId,\s+type: typeConfig\[type\]\.contentType/)
  assert.match(importer, /!parsedJson && !\/\^\\s\*<\/\.test\(rawMessage\) \? rawMessage\.slice\(0, 160\) : ''/)
  assert.match(importer, /data\.message \|\| readableMessage \|\| `请求失败：HTTP \$\{response\.status\}`/)
})

test('HTML gateway errors stay short and only the latest source selection remains current', async () => {
  const apiRequest = loadApiRequest(async () => ({
    ok: false,
    status: 502,
    text: async () => '<html><body>proxy diagnostic page that must not be shown</body></html>',
  }))
  await assert.rejects(() => apiRequest('/api/admin/content'), (error) => {
    assert.equal(error.status, 502)
    assert.match(error.message, /HTTP 502/)
    assert.doesNotMatch(error.message, /<html>|proxy diagnostic/)
    return true
  })

  const state = { selectionGeneration: 0 }
  const { beginSourceSelection, isCurrentSourceSelection } = loadSelectionHelpers(state)
  const first = beginSourceSelection()
  const second = beginSourceSelection()
  assert.equal(isCurrentSourceSelection(first), false)
  assert.equal(isCurrentSourceSelection(second), true)
})

test('api errors retain only safe pending image details', async () => {
  const apiRequest = loadApiRequest(async () => ({
    ok: false,
    status: 409,
    text: async () => JSON.stringify({
      message: '图片尚未处理完成，请稍后重试',
      pendingClientIds: ['pending-1'],
      token: 'must-not-be-copied',
      uploadUrl: 'must-not-be-copied',
    }),
  }))
  await assert.rejects(() => apiRequest('/api/admin/images/upload/complete-batch'), (error) => {
    assert.equal(error.status, 409)
    assert.deepEqual(error.details, { pendingClientIds: ['pending-1'] })
    assert.equal(error.details.token, undefined)
    assert.equal(error.details.uploadUrl, undefined)
    return true
  })
})

test('all four batch imports replace stale selections and use recoverable final submission', () => {
  ;['text', 'audio', 'album', 'letter-copy'].forEach((type) => {
    assert.match(importer, new RegExp(`'${type}'|${type}:`))
  })
  assert.match(importer, /const selectionGeneration = beginSourceSelection\(\)/g)
  assert.match(importer, /if \(!isCurrentSourceSelection\(selectionGeneration\)\) return/g)
  assert.match(importer, /state\.items = \[\][\s\S]*?nodes\.sourceStatus\.textContent = `\$\{file\.name\} · 正在解析`/)
  assert.match(importer, /runWithRetry\(\(\) => apiRequest\('\/api\/admin\/images\/upload\/prepare-batch'/)
  assert.match(importer, /runWithRetry\(\(\) => apiRequest\('\/api\/admin\/content\/items'/)
  assert.match(importer, /delays: \[800, 2000\]/)
  assert.match(importer, /第 1\/1 步/)
  assert.match(importer, /state\.items\.some\(\(item\) => item\.audio\)/)
})
