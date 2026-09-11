const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const TEMP_PREFIX = 'secretbox-audio-'
const MAX_INPUT_BYTES = 50 * 1024 * 1024
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000
const TARGET_LOUDNESS = -18
const TRUE_PEAK = -1.5
const LOUDNESS_RANGE = 11

function getExtension(filename = '') {
  const extension = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension === 'm4a' ? 'm4a' : extension === 'mp3' ? 'mp3' : ''
}

function getOutputArgs(extension) {
  if (extension === 'm4a') {
    return ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
  }
  return ['-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '1']
}

function runFfmpeg(args, { timeoutMs = PROCESS_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const stderr = []
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }

    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64) stderr.push(chunk.toString())
    })
    child.once('error', (error) => finish(reject, error))
    child.once('close', (code, signal) => {
      if (code === 0) finish(resolve, { stderr: stderr.join(''), signal })
      else finish(reject, new Error(`音频处理失败${signal ? `（${signal}）` : ''}`))
    })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(reject, new Error('音频处理超时，请尝试较短的音频文件'))
    }, timeoutMs)
  })
}

async function cleanupStaleAudioTempDirs({ maxAgeMs = PROCESS_TIMEOUT_MS * 2 } = {}) {
  let entries = []
  try {
    entries = await fs.readdir(os.tmpdir(), { withFileTypes: true })
  } catch (error) {
    return
  }
  const cutoff = Date.now() - maxAgeMs
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX))
    .map(async (entry) => {
      const target = path.join(os.tmpdir(), entry.name)
      try {
        const stat = await fs.stat(target)
        if (stat.mtimeMs < cutoff) await fs.rm(target, { recursive: true, force: true })
      } catch (error) {
        // The directory may have been removed by its active request.
      }
    }))
}

async function normalizeAudioBuffer({ buffer, filename }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('音频文件为空')
  if (buffer.length > MAX_INPUT_BYTES) throw new Error('单个音频不能超过 50MB')
  const extension = getExtension(filename)
  if (!extension) throw new Error('请上传 mp3 或 m4a 音频')

  await cleanupStaleAudioTempDirs()
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX))
  const inputPath = path.join(tempDir, `input.${extension}`)
  const outputPath = path.join(tempDir, `normalized.${extension}`)
  try {
    await fs.writeFile(inputPath, buffer, { flag: 'wx' })
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-map_metadata', '0',
      '-vn',
      '-af', `loudnorm=I=${TARGET_LOUDNESS}:TP=${TRUE_PEAK}:LRA=${LOUDNESS_RANGE}`,
      ...getOutputArgs(extension),
      outputPath,
    ])
    const output = await fs.readFile(outputPath)
    if (!output.length || output.length > MAX_OUTPUT_BYTES) throw new Error('音频处理后的文件大小不符合要求')
    return {
      buffer: output,
      contentType: extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg',
      extension,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

void cleanupStaleAudioTempDirs()

module.exports = {
  MAX_INPUT_BYTES,
  cleanupStaleAudioTempDirs,
  normalizeAudioBuffer,
}
