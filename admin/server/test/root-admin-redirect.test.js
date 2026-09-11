const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-root-admin-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { createAppRouter } = require('../src/routes')
const { closeDatabase } = require('../src/lib/state-database')

test('root redirects to the admin page while admin assets and API remain available', async (t) => {
  const server = http.createServer(createAppRouter().handle)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.close()
    closeDatabase()
    fs.rmSync(dataDir, { force: true, recursive: true })
  })

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  const root = await fetch(`${baseUrl}/`, { redirect: 'manual' })
  assert.equal(root.status, 302)
  assert.equal(root.headers.get('location'), '/admin/')

  const admin = await fetch(`${baseUrl}/admin/`)
  assert.equal(admin.status, 200)
  assert.match(admin.headers.get('content-type'), /^text\/html/)
  assert.match(await admin.text(), /轻读手记/)

  const styles = await fetch(`${baseUrl}/admin/styles.css`)
  assert.equal(styles.status, 200)
  assert.match(styles.headers.get('content-type'), /^text\/css/)

  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).ok, true)
})
