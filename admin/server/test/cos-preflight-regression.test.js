const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const test = require('node:test')

test('COS 桶签名访问成功但直传 CORS 失败时仍允许样本对象探测', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-cos-preflight-'))
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const { updateAdminSettings } = require('./src/modules/admin/admin-settings.store')
      updateAdminSettings({ storage: {
        secretId: 'test-secret-id', secretKey: 'test-secret-key',
        bucket: 'test-bucket-1250000000', region: 'ap-guangzhou',
      } })
      global.fetch = async (_input, options = {}) => new Response('', {
        status: options.method === 'OPTIONS' ? 403 : 200,
      })
      const { testCosConnection } = require('./src/modules/storage/cos.service')
      testCosConnection().then((connection) => process.stdout.write(JSON.stringify(connection)))
    `], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, MINIAPP_DATA_DIR: dataDir },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const connection = JSON.parse(result.stdout)
    assert.equal(connection.ok, false)
    assert.equal(connection.objectAccessOk, true)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('后台预检只在 COS 对象访问不可用时跳过样本对象检查', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/admin/admin-config.service.js'), 'utf8')
  const objectProbeCalls = source.match(/areSampleMediaObjectsReachable\([\s\S]*?cosConnection\.[A-Za-z]+\)/g) || []
  assert.equal(objectProbeCalls.length, 1)
  assert.equal(objectProbeCalls.every((call) => call.includes('cosConnection.objectAccessOk')), true)
})
