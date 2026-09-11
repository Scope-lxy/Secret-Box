const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-mini-program-api-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'first',
  contentPools: [{ id: 'shared-pool', name: '共享内容池' }],
  miniPrograms: [
    {
      id: 'first',
      name: '待删除小程序',
      appId: 'wx1111111111111111',
      status: 'active',
      config: { contentPoolId: 'shared-pool' },
    },
    {
      id: 'archived',
      name: '历史停用小程序',
      appId: 'wx2222222222222222',
      status: 'archived',
      config: { contentPoolId: 'shared-pool' },
    },
    {
      id: 'second',
      name: '保留小程序',
      appId: 'wx3333333333333333',
      status: 'active',
      config: { contentPoolId: 'shared-pool' },
    },
  ],
  operationLogs: [],
})

const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')

let baseUrl
let server

async function request(pathname, { body, cookie = '', method = 'GET' } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { data: await response.json(), headers: response.headers, status: response.status }
}

test.before(async () => {
  server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('删除接口返回完整 settings，并附带删除清理摘要', async () => {
  const login = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(login.status, 200)
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]

  const response = await request('/api/admin/miniprogram/delete', {
    method: 'POST',
    cookie,
    body: { id: 'first' },
  })
  assert.equal(response.status, 200)
  assert.equal(response.data.currentMiniProgramId, 'second')
  assert.deepEqual(response.data.miniPrograms.map((item) => item.id), ['archived', 'second'])
  assert.equal(response.data.miniPrograms.every((item) => Object.hasOwn(item, 'uploadKeyConfigured')), true)
  assert.deepEqual(response.data.contentPools.map((item) => item.id), ['shared-pool'])
  assert.equal(response.data.deletion.deleted, true)
  assert.equal(response.data.deletion.id, 'first')
  assert.equal(typeof response.data.deletion.summary, 'object')
  assert.equal(typeof response.data.deletion.uploadCleanup, 'object')
})
