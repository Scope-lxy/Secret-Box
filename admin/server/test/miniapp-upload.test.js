const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const uploadDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-upload-state-'))
process.env.MINIAPP_DATA_DIR = uploadDataDir

const { closeDatabase, readState, writeState } = require('../src/lib/state-database')
const { createMiniProgramUploader } = require('../src/modules/release/miniapp-upload.service')

test.after(() => {
  closeDatabase()
  fs.rmSync(uploadDataDir, { recursive: true, force: true })
})

function createPrivateKey() {
  return crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  })
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-upload-'))
  const sourceDirectory = path.join(root, 'source')
  const keyDirectory = path.join(root, 'keys')
  const appId = 'wx1234567890abcdef'
  fs.mkdirSync(sourceDirectory)
  fs.mkdirSync(keyDirectory)
  fs.writeFileSync(path.join(sourceDirectory, 'project.config.json'), JSON.stringify({ appid: appId }))
  fs.writeFileSync(path.join(keyDirectory, `${appId}.key`), 'test-private-key', { mode: 0o600 })
  return { appId, keyDirectory, root, sourceDirectory }
}

test('小程序上传使用指定 AppID 的服务器私钥和当前源码', async () => {
  const fixture = createFixture()
  const calls = []
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async (options) => calls.push(options),
  })

  try {
    const result = await uploader.upload({ appId: fixture.appId, version: '1.0.0', description: '首次上传' })
    assert.deepEqual(result, { appId: fixture.appId, version: '1.0.0' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].version, '1.0.0')
    assert.equal(calls[0].description, '首次上传')
    assert.equal(calls[0].appId, fixture.appId)
    assert.equal(calls[0].projectPath, fixture.sourceDirectory)
    assert.equal(calls[0].privateKeyPath, path.join(fixture.keyDirectory, `${fixture.appId}.key`))
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('上线检查可复用上传服务判断源码与密钥是否就绪', async () => {
  const fixture = createFixture()
  fs.unlinkSync(path.join(fixture.keyDirectory, `${fixture.appId}.key`))
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async () => {},
  })
  try {
    assert.equal(uploader.getReadiness(fixture.appId).ok, false)
    await uploader.upload({
      appId: fixture.appId,
      privateKey: createPrivateKey(),
      version: '1.0.0',
      description: '准备上传通道',
    })
    assert.deepEqual(uploader.getReadiness(fixture.appId), {
      ok: true,
      message: '小程序源码与代码上传密钥均已就绪',
    })
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('小程序上传会拒绝非法版本号和缺失上传密钥', async () => {
  const fixture = createFixture()
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async () => {},
  })

  try {
    await assert.rejects(
      uploader.upload({ appId: fixture.appId, version: '1.0.0; rm -rf', description: '' }),
      /版本号只能使用/,
    )
    await assert.rejects(
      uploader.upload({ appId: fixture.appId, version: '1.0.0', description: '' }),
      /请填写更新说明/,
    )
    fs.unlinkSync(path.join(fixture.keyDirectory, `${fixture.appId}.key`))
    await assert.rejects(
      uploader.upload({ appId: fixture.appId, version: '1.0.0', description: '修复问题' }),
      /尚未配置代码上传密钥/,
    )
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('小程序上传以选中的 AppID 为目标，不受 project.config.json 内 AppID 影响', async () => {
  const fixture = createFixture()
  const selectedAppId = 'wxabcdef1234567890'
  const calls = []
  fs.writeFileSync(path.join(fixture.keyDirectory, `${selectedAppId}.key`), 'test-private-key', { mode: 0o600 })
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async (options) => calls.push(options),
  })

  try {
    await uploader.upload({ appId: selectedAppId, version: '1.0.0', description: '修复问题' })
    assert.equal(calls[0].appId, selectedAppId)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('同一服务进程只允许一个小程序上传任务', async () => {
  const fixture = createFixture()
  let finishUpload
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: () => new Promise((resolve) => { finishUpload = resolve }),
  })

  try {
    const firstUpload = uploader.upload({ appId: fixture.appId, version: '1.0.0', description: '首次上传' })
    await assert.rejects(
      uploader.upload({ appId: fixture.appId, version: '1.0.1', description: '再次上传' }),
      /已有代码上传正在进行/,
    )
    finishUpload()
    await firstUpload
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('代码上传进行中拒绝删除上传配置，且不会产生半删除状态', async () => {
  const fixture = createFixture()
  let finishUpload
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: () => new Promise((resolve) => { finishUpload = resolve }),
  })

  try {
    const upload = uploader.upload({ appId: fixture.appId, version: '1.0.0', description: '上传中删除门禁' })
    assert.throws(() => uploader.deleteUploadArtifacts(fixture.appId), /上传正在进行/)
    assert.equal(fs.existsSync(path.join(fixture.keyDirectory, `${fixture.appId}.key`)), true)
    finishUpload()
    await upload
    assert.equal(uploader.getUploadInfo(fixture.appId).version, '1.0.0')
    uploader.deleteUploadArtifacts(fixture.appId)
    assert.equal(fs.existsSync(path.join(fixture.keyDirectory, `${fixture.appId}.key`)), false)
    assert.equal(uploader.getUploadInfo(fixture.appId), null)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('历史非标准 AppID 删除时仍会清理上传记录且不误报失败', () => {
  const fixture = createFixture()
  const legacyAppId = 'wx-legacy-acceptance'
  const releaseStateFile = path.join(uploadDataDir, 'miniapp-release-state.json')
  writeState(releaseStateFile, {
    versions: {},
    uploads: { [legacyAppId]: { fingerprint: 'legacy', version: 'V1' } },
  })
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    releaseStateFile,
    sourceDirectory: fixture.sourceDirectory,
  })

  try {
    assert.deepEqual(uploader.deleteUploadArtifacts(legacyAppId), {
      uploadKeyDeleted: false,
      uploadRecordDeleted: true,
    })
    assert.equal(Object.hasOwn(readState(releaseStateFile).uploads, legacyAppId), false)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('首次在弹窗提交密钥后，同一 AppID 后续上传会自动复用', async () => {
  const fixture = createFixture()
  const calls = []
  fs.unlinkSync(path.join(fixture.keyDirectory, `${fixture.appId}.key`))
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async (options) => calls.push(options),
  })

  try {
    assert.equal(uploader.hasUploadKey(fixture.appId), false)
    await uploader.upload({
      appId: fixture.appId,
      privateKey: createPrivateKey(),
      version: '1.0.0',
      description: '首次配置密钥',
    })
    assert.equal(uploader.hasUploadKey(fixture.appId), true)
    await uploader.upload({ appId: fixture.appId, version: '1.0.1', description: '复用密钥' })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].privateKeyPath, calls[1].privateKeyPath)
    assert.equal(fs.readFileSync(calls[1].privateKeyPath, 'utf8').includes('PRIVATE KEY'), true)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('上传密钥按 AppID 隔离且非法密钥不会落盘', async () => {
  const fixture = createFixture()
  const anotherAppId = 'wxabcdef1234567890'
  fs.unlinkSync(path.join(fixture.keyDirectory, `${fixture.appId}.key`))
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async () => {},
  })

  try {
    await assert.rejects(
      uploader.upload({
        appId: fixture.appId,
        privateKey: 'not-a-private-key',
        version: '1.0.0',
        description: '非法密钥',
      }),
      /代码上传密钥格式无效/,
    )
    assert.equal(uploader.hasUploadKey(fixture.appId), false)
    await uploader.upload({
      appId: fixture.appId,
      privateKey: createPrivateKey(),
      version: '1.0.0',
      description: '配置第一个小程序',
    })
    assert.equal(uploader.hasUploadKey(fixture.appId), true)
    assert.equal(uploader.hasUploadKey(anotherAppId), false)
    await assert.rejects(
      uploader.upload({ appId: anotherAppId, version: '1.0.0', description: '不能共用密钥' }),
      /尚未配置代码上传密钥/,
    )
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('重新提交密钥会原子替换当前 AppID 的旧密钥', async () => {
  const fixture = createFixture()
  const firstKey = createPrivateKey()
  const secondKey = createPrivateKey()
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async () => {},
  })

  try {
    await uploader.upload({ appId: fixture.appId, privateKey: firstKey, version: '1.0.0', description: '首次密钥' })
    await uploader.upload({ appId: fixture.appId, privateKey: secondKey, version: '1.0.1', description: '替换密钥' })
    const keyPath = path.join(fixture.keyDirectory, `${fixture.appId}.key`)
    assert.equal(fs.readFileSync(keyPath, 'utf8'), `${secondKey.trim()}\n`)
    assert.equal(fs.readdirSync(fixture.keyDirectory).some((name) => name.endsWith('.tmp')), false)
    if (process.platform !== 'win32') assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('上传工具错误会保留具体原因，便于定位非密钥问题', async () => {
  const fixture = createFixture()
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    uploadRunner: async () => {
      const error = new Error("EROFS: read-only file system, mkdir '/app/cache'")
      error.code = 'EROFS'
      throw error
    },
  })

  try {
    await assert.rejects(
      uploader.upload({ appId: fixture.appId, version: '1.0.0', description: '测试错误提示' }),
      /代码上传服务临时目录不可写/,
    )
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('上传 worker 使用项目编译设置并由服务指定可写工作目录', () => {
  const workerSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/release/miniapp-upload.worker.js'), 'utf8')
  const serviceSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/release/miniapp-upload.service.js'), 'utf8')
  assert.match(workerSource, /setting: \{ useProjectConfig: true \}/)
  assert.match(serviceSource, /cwd: process\.env\.MINIPROGRAM_UPLOAD_TEMP_DIR \|\| os\.tmpdir\(\)/)
})

test('相同源码在不同 AppID 上传时复用同一自动版本号，源码变化才递增', async () => {
  const fixture = createFixture()
  const secondAppId = 'wxabcdef1234567890'
  fs.writeFileSync(path.join(fixture.keyDirectory, `${secondAppId}.key`), 'test-private-key', { mode: 0o600 })
  const calls = []
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    releaseStateFile: path.join(fixture.root, 'release-state.json'),
    uploadRunner: async (options) => calls.push(options),
  })
  try {
    const first = await uploader.upload({ appId: fixture.appId, description: '首次上传' })
    const second = await uploader.upload({ appId: secondAppId, description: '同步上传' })
    assert.equal(first.version, second.version)
    fs.writeFileSync(path.join(fixture.sourceDirectory, 'app.js'), 'changed')
    const third = await uploader.upload({ appId: secondAppId, description: '源码更新' })
    assert.notEqual(third.version, first.version)
    assert.equal(calls.length, 3)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('手动版本号不能与其他源码版本冲突', async () => {
  const fixture = createFixture()
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    releaseStateFile: path.join(fixture.root, 'release-state.json'),
    uploadRunner: async () => {},
  })
  try {
    const first = await uploader.upload({ appId: fixture.appId, version: 'V26.8.30', description: '首次上传' })
    fs.writeFileSync(path.join(fixture.sourceDirectory, 'app.js'), 'changed')
    await assert.rejects(
      uploader.upload({ appId: fixture.appId, version: first.version, description: '冲突版本' }),
      /已对应其他源码/,
    )
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('首次手动版本会成为同一源码后续小程序的默认版本', async () => {
  const fixture = createFixture()
  const secondAppId = 'wxabcdef1234567890'
  fs.writeFileSync(path.join(fixture.keyDirectory, `${secondAppId}.key`), 'test-private-key', { mode: 0o600 })
  const uploader = createMiniProgramUploader({
    keyDirectory: fixture.keyDirectory,
    sourceDirectory: fixture.sourceDirectory,
    releaseStateFile: path.join(fixture.root, 'release-state.json'),
    uploadRunner: async () => {},
  })
  try {
    const first = await uploader.upload({ appId: fixture.appId, version: 'V26.8.30', description: '定版' })
    const second = await uploader.upload({ appId: secondAppId, description: '同步定版' })
    assert.equal(first.version, 'V26.8.30')
    assert.equal(second.version, first.version)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})
