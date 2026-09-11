const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const { fork } = require('child_process')
const { getDataDir } = require('../../lib/data-dir')
const { readState, writeState } = require('../../lib/state-database')

class MiniProgramUploadError extends Error {}

const uploadWorkerPath = path.join(__dirname, 'miniapp-upload.worker.js')
const uploadTimeoutMs = 5 * 60 * 1000
const releaseStateFileName = 'miniapp-release-state.json'

function normalizeReleaseState(saved) {
  if (!saved || typeof saved !== 'object') return { versions: {}, uploads: {} }
  return {
    versions: saved.versions && typeof saved.versions === 'object' ? saved.versions : {},
    uploads: saved.uploads && typeof saved.uploads === 'object' ? saved.uploads : {},
  }
}

function readReleaseState(file) {
  try {
    return normalizeReleaseState(readState(file))
  } catch {
    return { versions: {}, uploads: {} }
  }
}

function writeReleaseState(file, state) {
  writeState(file, normalizeReleaseState(state))
}

function runUploadInChild(payload) {
  return new Promise((resolve, reject) => {
    const child = fork(uploadWorkerPath, [], {
      cwd: process.env.MINIPROGRAM_UPLOAD_TEMP_DIR || os.tmpdir(),
      env: {
        HOME: process.env.HOME || '',
        LANG: process.env.LANG || '',
        NODE_ENV: process.env.NODE_ENV || 'production',
        PATH: process.env.PATH || '',
        TMPDIR: process.env.TMPDIR || '',
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '',
        MINIPROGRAM_UPLOAD_PAYLOAD: JSON.stringify(payload),
      },
      execArgv: ['--max-old-space-size=384'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    })
    let settled = false

    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.connected) child.disconnect()
      if (error) reject(error)
      else resolve()
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      const error = new Error('upload timed out')
      error.code = 'UPLOAD_TIMEOUT'
      finish(error)
    }, uploadTimeoutMs)

    child.once('message', (message) => {
      if (message?.ok) finish()
      else {
        const error = new Error(message?.error?.message || 'upload failed')
        if (message?.error?.code) error.code = message.error.code
        finish(error)
      }
    })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`upload worker exited with code ${code}`))
    })
  })
}

function createMiniProgramUploader({
  keyDirectory = path.join(getDataDir(path.resolve(__dirname, '../../../data')), 'miniapp-upload-keys'),
  sourceDirectory = process.env.MINIPROGRAM_SOURCE_DIR || '',
  uploadRunner = runUploadInChild,
  releaseStateFile = path.join(getDataDir(path.resolve(__dirname, '../../../data')), releaseStateFileName),
} = {}) {
  let uploading = false

  function loadReleaseState() {
    return readReleaseState(releaseStateFile)
  }

  function saveReleaseState(state) {
    writeReleaseState(releaseStateFile, state)
  }

  function getSourceFingerprint(projectPath) {
    const ignoredNames = new Set(['.git', 'node_modules', '.cache', 'dist', 'build'])
    const ignoredFiles = /^(?:\.env(?:\..*)?|\.DS_Store|project\.private\.config\.json|.*\.(?:key|pem|crt|p12|tmp|log|bak))$/i
    const entries = []
    function visit(directory, relative = '') {
      fs.readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name < b.name ? -1 : (a.name > b.name ? 1 : 0))
        .forEach((entry) => {
          if (ignoredNames.has(entry.name) || ignoredFiles.test(entry.name)) return
          const childRelative = relative ? path.join(relative, entry.name) : entry.name
          const childPath = path.join(directory, entry.name)
          if (entry.isDirectory()) visit(childPath, childRelative)
          else if (entry.isFile()) entries.push({ relative: childRelative.replace(/\\/g, '/'), path: childPath })
        })
    }
    visit(projectPath)
    const hash = crypto.createHash('sha256')
    entries.forEach(({ relative, path: filePath }) => {
      hash.update(relative)
      hash.update('\u0000')
      hash.update(fs.readFileSync(filePath))
      hash.update('\u0000')
    })
    return hash.digest('hex')
  }

  function dateVersion(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date).map(({ type, value }) => [type, value]))
    return `V${String(parts.year).slice(-2)}.${Number(parts.month)}.${Number(parts.day)}`
  }

  function resolveVersion(fingerprint, requestedVersion = '') {
    const state = loadReleaseState()
    const existing = state.versions[fingerprint]
    const requested = String(requestedVersion || '').trim()
    if (requested) {
      normalizeVersion(requested)
      const conflict = Object.entries(state.versions).find(([key, item]) => key !== fingerprint && item?.version === requested)
      if (conflict) throw new MiniProgramUploadError(`版本号 ${requested} 已对应其他源码，请使用新版本号`)
      return { version: requested, fingerprint, reused: existing?.version === requested }
    }
    if (existing?.version) return { version: existing.version, fingerprint, reused: true }
    const base = dateVersion()
    const used = new Set(Object.values(state.versions).map((item) => item?.version).filter(Boolean))
    let version = base
    if (used.has(version)) {
      let suffix = 1
      while (used.has(`${base}-${suffix}`)) suffix += 1
      version = `${base}-${suffix}`
    }
    return { version, fingerprint, reused: false }
  }

  function getProjectSource() {
    const directory = path.resolve(sourceDirectory)
    const configPath = path.join(directory, 'project.config.json')
    if (!sourceDirectory || !fs.existsSync(configPath)) {
      throw new MiniProgramUploadError('小程序源码未部署到发布服务，暂时无法上传')
    }
    return directory
  }

  function normalizeAppId(value) {
    const appId = String(value || '').trim()
    if (!/^wx[a-zA-Z0-9]{16}$/.test(appId)) {
      throw new MiniProgramUploadError('小程序 AppID 格式无效')
    }
    return appId
  }

  function getPrivateKeyPath(appId) {
    const directory = path.resolve(keyDirectory)
    const keyPath = path.resolve(directory, `${appId}.key`)
    if (!keyPath.startsWith(`${directory}${path.sep}`) || !fs.existsSync(keyPath)) {
      throw new MiniProgramUploadError('当前小程序尚未配置代码上传密钥')
    }

    const stat = fs.lstatSync(keyPath)
    if (!stat.isFile()) throw new MiniProgramUploadError('代码上传密钥文件无效')
    if (process.platform !== 'win32' && (stat.mode & 0o077)) {
      throw new MiniProgramUploadError('代码上传密钥权限过宽，请限制为仅发布服务可读')
    }
    return keyPath
  }

  function hasUploadKey(appId) {
    try {
      const normalizedAppId = normalizeAppId(appId)
      return fs.lstatSync(getPrivateKeyPath(normalizedAppId)).isFile()
    } catch {
      return false
    }
  }

  function getReadiness(appId) {
    try {
      const normalizedAppId = normalizeAppId(appId)
      getProjectSource()
      getPrivateKeyPath(normalizedAppId)
      return { ok: true, message: '小程序源码与代码上传密钥均已就绪' }
    } catch (error) {
      return { ok: false, message: error.message || '代码上传通道未就绪' }
    }
  }

  function saveUploadKey(appId, value) {
    const privateKey = String(value || '').trim()
    if (!privateKey) throw new MiniProgramUploadError('请填写代码上传密钥')
    if (privateKey.length > 16384) throw new MiniProgramUploadError('代码上传密钥内容无效')
    try {
      crypto.createPrivateKey(privateKey)
    } catch {
      throw new MiniProgramUploadError('代码上传密钥格式无效，请粘贴微信公众平台生成的完整密钥')
    }

    const directory = path.resolve(keyDirectory)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
    const keyPath = path.resolve(directory, `${appId}.key`)
    const temporaryPath = path.join(directory, `.${appId}.${process.pid}.${crypto.randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporaryPath, `${privateKey}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      fs.renameSync(temporaryPath, keyPath)
      if (process.platform !== 'win32') fs.chmodSync(keyPath, 0o600)
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
    }
    return keyPath
  }

  function normalizeVersion(value) {
    const version = String(value || '').trim()
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version)) {
      throw new MiniProgramUploadError('版本号只能使用字母、数字、点、下划线或短横线，最长 64 位')
    }
    return version
  }

  function normalizeDescription(value) {
    const description = String(value || '').trim()
    if (!description) throw new MiniProgramUploadError('请填写更新说明')
    if (description.length > 200) throw new MiniProgramUploadError('更新说明不能超过 200 个字符')
    return description
  }

  async function upload({ appId, description, privateKey, version }) {
    if (uploading) throw new MiniProgramUploadError('已有代码上传正在进行，请稍后再试')
    const normalizedAppId = normalizeAppId(appId)
    const requestedVersion = String(version || '').trim()
    if (requestedVersion) normalizeVersion(requestedVersion)
    const normalizedDescription = normalizeDescription(description)
    const projectPath = getProjectSource()
    const fingerprint = getSourceFingerprint(projectPath)
    const release = resolveVersion(fingerprint, requestedVersion)
    const normalizedVersion = release.version
    const privateKeyPath = String(privateKey || '').trim()
      ? saveUploadKey(normalizedAppId, privateKey)
      : getPrivateKeyPath(normalizedAppId)

    uploading = true
    try {
      await uploadRunner({
        appId: normalizedAppId,
        description: normalizedDescription,
        privateKeyPath,
        projectPath,
        version: normalizedVersion,
      })
      const state = loadReleaseState()
      const now = new Date().toISOString()
      state.versions[fingerprint] = {
        version: normalizedVersion,
        createdAt: state.versions[fingerprint]?.createdAt || now,
      }
      state.uploads[normalizedAppId] = {
        fingerprint,
        version: normalizedVersion,
        uploadedAt: now,
      }
      saveReleaseState(state)
      return { appId: normalizedAppId, version: normalizedVersion }
    } catch (error) {
      if (error instanceof MiniProgramUploadError) throw error
      if (error?.code === 'UPLOAD_TIMEOUT') {
        throw new MiniProgramUploadError('代码上传超时，请检查服务器网络后重试')
      }
      if (error?.code === 'EROFS' || error?.code === 'EACCES') {
        throw new MiniProgramUploadError('代码上传服务临时目录不可写，请联系管理员')
      }
      if (error?.message && error.message !== 'upload failed') {
        throw new MiniProgramUploadError(`代码上传失败：${error.message}`)
      }
      throw new MiniProgramUploadError('代码上传失败，请检查微信上传密钥、IP 白名单和项目配置')
    } finally {
      uploading = false
    }
  }

  function getUploadInfo(appId) {
    const state = loadReleaseState()
    return state.uploads[String(appId || '').trim()] || null
  }

  function assertCanDelete() {
    if (uploading) throw new MiniProgramUploadError('代码上传正在进行，暂时不能删除小程序')
    return true
  }

  function deleteUploadArtifacts(appId) {
    assertCanDelete()
    const storedAppId = String(appId || '').trim()
    const normalizedAppId = /^wx[a-zA-Z0-9]{16}$/.test(storedAppId) ? storedAppId : ''
    const directory = path.resolve(keyDirectory)
    let uploadKeyDeleted = false
    // Legacy non-standard AppIDs could not have created a key through the upload service.
    if (normalizedAppId) {
      const keyPath = path.resolve(directory, `${normalizedAppId}.key`)
      if (keyPath.startsWith(`${directory}${path.sep}`) && fs.existsSync(keyPath)) {
        const stat = fs.lstatSync(keyPath)
        if (!stat.isFile()) throw new MiniProgramUploadError('代码上传密钥文件无效')
        fs.unlinkSync(keyPath)
        uploadKeyDeleted = true
      }
    }

    const state = loadReleaseState()
    const uploadRecordDeleted = Object.hasOwn(state.uploads, storedAppId)
    if (uploadRecordDeleted) {
      delete state.uploads[storedAppId]
      saveReleaseState(state)
    }
    return { uploadKeyDeleted, uploadRecordDeleted }
  }

  function getNextVersion() {
    const projectPath = getProjectSource()
    const fingerprint = getSourceFingerprint(projectPath)
    const { version, reused } = resolveVersion(fingerprint)
    return { version, reused }
  }

  return {
    assertCanDelete,
    deleteUploadArtifacts,
    getReadiness,
    hasUploadKey,
    upload,
    getSourceFingerprint,
    resolveVersion,
    getNextVersion,
    getUploadInfo,
  }
}

const uploader = createMiniProgramUploader({
  sourceDirectory: process.env.MINIPROGRAM_SOURCE_DIR || path.resolve(__dirname, '../../../../../miniprogram'),
})

module.exports = {
  MiniProgramUploadError,
  assertMiniProgramUploadDeletionReady: uploader.assertCanDelete,
  createMiniProgramUploader,
  deleteMiniProgramUploadArtifacts: uploader.deleteUploadArtifacts,
  getMiniProgramSourceFingerprint: (projectPath) => {
    const uploader = createMiniProgramUploader({ sourceDirectory: projectPath })
    return uploader.getSourceFingerprint(path.resolve(projectPath))
  },
  getMiniProgramUploadReadiness: uploader.getReadiness,
  hasMiniProgramUploadKey: uploader.hasUploadKey,
  runUploadInChild,
  uploadMiniProgramCode: uploader.upload,
  getMiniProgramUploadInfo: uploader.getUploadInfo,
  getMiniProgramNextVersion: uploader.getNextVersion,
}
