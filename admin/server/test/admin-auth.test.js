const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-admin-auth-'))
process.env.MINIAPP_DATA_DIR = dataDir
process.env.NODE_ENV = 'test'

const { withCors } = require('../src/lib/cors')
const { closeDatabase } = require('../src/lib/state-database')
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
  return {
    data: await response.json(),
    headers: response.headers,
    status: response.status,
  }
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

test('修改管理员密码后，新密码跨进程生效，默认密码失效', async () => {
  const initialLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(initialLogin.status, 200)
  const cookie = String(initialLogin.headers.get('set-cookie') || '').split(';')[0]

  const staleProcess = spawn(process.execPath, ['-e', `
    const readline = require('node:readline')
    const auth = require('./src/modules/admin/admin-auth.store')
    process.stderr.write('ready\\n')
    readline.createInterface({ input: process.stdin }).once('line', () => {
      process.stdout.write(JSON.stringify({
        defaultPassword: Boolean(auth.loginAdmin('admin', '123456')),
        changedPassword: Boolean(auth.loginAdmin('admin', 'changed-password-2026')),
      }))
    })
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, MINIAPP_DATA_DIR: dataDir, NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let staleOutput = ''
  let staleReady = ''
  staleProcess.stdout.setEncoding('utf8')
  staleProcess.stdout.on('data', (chunk) => { staleOutput += chunk })
  staleProcess.stderr.setEncoding('utf8')
  const ready = new Promise((resolve, reject) => {
    staleProcess.stderr.on('data', (chunk) => {
      staleReady += chunk
      if (staleReady.includes('ready')) resolve()
    })
    staleProcess.once('error', reject)
  })
  await ready

  const update = await request('/api/admin/auth', {
    method: 'POST',
    cookie,
    body: { account: 'admin', currentPassword: '123456', password: 'changed-password-2026', confirmPassword: 'changed-password-2026' },
  })
  assert.equal(update.status, 200)
  assert.equal(update.data.changed, true)

  staleProcess.stdin.end('\n')
  await new Promise((resolve, reject) => {
    staleProcess.once('error', reject)
    staleProcess.once('close', (code) => {
      if (code !== 0) reject(new Error(`stale auth process exited with ${code}`))
      else resolve()
    })
  })
  assert.deepEqual(JSON.parse(staleOutput), {
    defaultPassword: false,
    changedPassword: true,
  })

  const defaultPasswordLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '123456' },
  })
  assert.equal(defaultPasswordLogin.status, 401)

  const newPasswordLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: 'changed-password-2026' },
  })
  assert.equal(newPasswordLogin.status, 200)

  closeDatabase()
  const reloaded = spawnSync(process.execPath, ['-e', `
    const auth = require('./src/modules/admin/admin-auth.store')
    process.stdout.write(JSON.stringify({
      defaultPassword: Boolean(auth.loginAdmin('admin', '123456')),
      changedPassword: Boolean(auth.loginAdmin('admin', 'changed-password-2026')),
    }))
  `], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, MINIAPP_DATA_DIR: dataDir, NODE_ENV: 'test' },
  })
  assert.equal(reloaded.status, 0, reloaded.stderr)
  assert.deepEqual(JSON.parse(reloaded.stdout), {
    defaultPassword: false,
    changedPassword: true,
  })

  const postReloadLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: 'changed-password-2026' },
  })
  assert.equal(postReloadLogin.status, 200)

  const spacedUpdate = await request('/api/admin/auth', {
    method: 'POST',
    cookie: String(postReloadLogin.headers.get('set-cookie') || '').split(';')[0],
    body: {
      account: 'admin',
      currentPassword: 'changed-password-2026',
      password: '  spaced-password-2026\n',
      confirmPassword: '  spaced-password-2026\n',
    },
  })
  assert.equal(spacedUpdate.status, 200)
  assert.equal(spacedUpdate.data.changed, true)

  const spacedPasswordLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { account: 'admin', password: '\tspaced-password-2026  ' },
  })
  assert.equal(spacedPasswordLogin.status, 200)
})
