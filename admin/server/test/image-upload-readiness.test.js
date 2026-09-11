const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-image-readiness-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase } = require('../src/lib/state-database')
const { withCors } = require('../src/lib/cors')
const { getInternalAdminSettings, updateAdminSettings } = require('../src/modules/admin/admin-settings.store')
const { getImageById } = require('../src/modules/images/image.store')
const { doesCosObjectExist } = require('../src/modules/storage/cos.service')
const { createAppRouter, waitForCosObjectsReady } = require('../src/routes')

updateAdminSettings({
  storage: {
    ...getInternalAdminSettings().storage,
    bucket: 'test-bucket-1234567890',
    region: 'ap-shanghai',
    secretId: 'test-secret-id',
    secretKey: 'test-secret-key',
  },
})

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('派生图 404 后自动重试并在就绪后完成', async () => {
  const originalFetch = global.fetch
  let calls = 0
  const sleeps = []
  global.fetch = async () => {
    calls += 1
    return new Response('', { status: calls <= 2 ? 404 : 200 })
  }
  try {
    await waitForCosObjectsReady(['medium.jpg', 'thumb.jpg'], {
      concurrency: 2,
      maxAttempts: 3,
      baseDelayMs: 10,
      objectExists: doesCosObjectExist,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    })
  } finally {
    global.fetch = originalFetch
  }

  assert.equal(calls, 4)
  assert.deepEqual(sleeps, [10])
})

test('派生图永久未就绪时按上限重试后失败', async () => {
  let calls = 0
  await assert.rejects(
    waitForCosObjectsReady(['medium.jpg'], {
      maxAttempts: 3,
      objectExists: async () => {
        calls += 1
        return false
      },
      sleep: async () => {},
    }),
    /图片尚未处理完成/,
  )
  assert.equal(calls, 3)
})

test('批次超时会中断退避等待，不延后返回失败', async () => {
  const startedAt = Date.now()
  await assert.rejects(
    waitForCosObjectsReady(['medium.jpg'], {
      maxAttempts: 2,
      batchTimeoutMs: 1,
      baseDelayMs: 1000,
      objectExists: async () => false,
    }),
    /图片尚未处理完成/,
  )
  assert.equal(Date.now() - startedAt < 200, true)
})

test('派生图检查遇到瞬时网络错误后自动重试', async () => {
  let calls = 0
  await waitForCosObjectsReady(['medium.jpg'], {
    maxAttempts: 2,
    objectExists: async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return true
    },
    sleep: async () => {},
  })
  assert.equal(calls, 2)
})

test('146 个派生图检查遵守并发上限且只重查未就绪项', async () => {
  let active = 0
  let maxActive = 0
  const calls = new Map()
  await waitForCosObjectsReady(Array.from({ length: 146 }, (_, index) => `${index}.jpg`), {
    concurrency: 4,
    objectExists: async (key) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const count = (calls.get(key) || 0) + 1
      calls.set(key, count)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return !key.endsWith('0.jpg') || count >= 2
    },
    sleep: async () => {},
  })
  assert.equal(maxActive, 4)
  assert.equal(calls.get('1.jpg'), 1)
  assert.equal(calls.get('10.jpg'), 2)
})

test('COS 500 错误会重试，恢复后继续完成', async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async () => {
    calls += 1
    return new Response('', { status: calls === 1 ? 500 : 200 })
  }
  try {
    await waitForCosObjectsReady(['derived.jpg'], {
      maxAttempts: 2,
      objectExists: doesCosObjectExist,
      sleep: async () => {},
    })
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(calls, 2)
})

test('COS 403 配置错误立即失败且不重试', async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async () => {
    calls += 1
    return new Response('', { status: 403 })
  }
  try {
    await assert.rejects(
      waitForCosObjectsReady(['derived.jpg'], {
        maxAttempts: 3,
        objectExists: doesCosObjectExist,
        sleep: async () => {},
      }),
      (error) => error.cosStatus === 403 && error.code === 'COS_HTTP_403',
    )
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(calls, 1)
})

test('COS HEAD 请求在配置的时限后中止', async () => {
  const originalFetch = global.fetch
  let receivedSignal
  global.fetch = async (_url, options = {}) => new Promise((resolve, reject) => {
    receivedSignal = options.signal
    if (receivedSignal.aborted) {
      reject(receivedSignal.reason)
      return
    }
    receivedSignal.addEventListener('abort', () => reject(receivedSignal.reason), { once: true })
  })

  try {
    await assert.rejects(doesCosObjectExist('derived.jpg', { timeoutMs: 10 }), { name: 'TimeoutError' })
    assert.equal(receivedSignal.aborted, true)
  } finally {
    global.fetch = originalFetch
  }
})

test('批量登记 409 只返回永久未就绪任务的 clientId', async () => {
  const server = http.createServer(withCors(createAppRouter({
    imageReadinessOptions: {
      maxAttempts: 2,
      sleep: async () => {},
    },
  }).handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const originalFetch = global.fetch
  const request = async (pathname, body, cookie = '') => {
    const response = await originalFetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
    const responseText = await response.text()
    return { data: JSON.parse(responseText), responseText, status: response.status, headers: response.headers }
  }
  try {
    const login = await request('/api/admin/login', { account: 'admin', password: '123456' })
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
    const prepared = await request('/api/admin/images/upload/prepare-batch', {
      items: [
        { clientId: 'ready-image', name: 'ready.jpg', size: 1024, type: 'image/jpeg' },
        { clientId: 'pending-image', name: 'pending.jpg', size: 1024, type: 'image/jpeg' },
      ],
    }, cookie)
    assert.equal(prepared.status, 200)
    const missingPaths = new Set([
      new URL(prepared.data.items[1].urls.mediumUrl).pathname,
      new URL(prepared.data.items[1].urls.thumbUrl).pathname,
    ])
    global.fetch = async (input, options = {}) => {
      if (options.method === 'HEAD' && String(input).includes('.myqcloud.com')) {
        return new Response('', { status: missingPaths.has(new URL(input).pathname) ? 404 : 200 })
      }
      return originalFetch(input, options)
    }
    const completionItems = prepared.data.items.map((item) => ({
      clientId: item.clientId,
      imageId: item.task.imageId,
      label: item.task.label,
      mediumUrl: item.urls.mediumUrl,
      originalName: item.task.originalName,
      originalSize: item.task.originalSize,
      originalUrl: item.urls.originalUrl,
      taskId: item.task.id,
      thumbUrl: item.urls.thumbUrl,
      token: item.task.token,
      usage: item.task.usage,
    }))
    const completed = await request('/api/admin/images/upload/complete-batch', { items: completionItems }, cookie)
    assert.equal(completed.status, 409)
    assert.deepEqual(completed.data, {
      message: '图片尚未处理完成，请稍后重试',
      pendingClientIds: ['pending-image'],
    })
    assert.doesNotMatch(completed.responseText, /token|https?:|secretbox\//i)
    assert.equal(getImageById(completionItems[0].imageId), null)
    assert.equal(getImageById(completionItems[1].imageId), null)

    const invalidSignature = await request('/api/admin/images/upload/complete-batch', {
      items: [{ ...completionItems[0], token: 'invalid' }],
    }, cookie)
    assert.equal(invalidSignature.status, 400)
    assert.equal('pendingClientIds' in invalidSignature.data, false)

    const legacyTask = {
      id: completionItems[0].taskId,
      imageId: completionItems[0].imageId,
      label: completionItems[0].label,
      originalName: completionItems[0].originalName,
      originalSha256: '',
      originalSize: completionItems[0].originalSize,
      usage: completionItems[0].usage,
      mediumUrl: completionItems[0].mediumUrl,
      originalUrl: completionItems[0].originalUrl,
      thumbUrl: completionItems[0].thumbUrl,
    }
    const legacyToken = crypto.createHmac('sha256', 'test-secret-key')
      .update(JSON.stringify(legacyTask))
      .digest('hex')
    const expiredRuleToken = await request('/api/admin/images/upload/complete-batch', {
      items: [{ ...completionItems[0], token: legacyToken }],
    }, cookie)
    assert.equal(expiredRuleToken.status, 400)
    assert.match(expiredRuleToken.data.message, /上传任务校验失败/)
  } finally {
    global.fetch = originalFetch
    await new Promise((resolve) => server.close(resolve))
  }
})
