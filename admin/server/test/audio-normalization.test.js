const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const systemTempDir = os.tmpdir()
const testTempDir = fs.mkdtempSync(path.join(systemTempDir, 'secretbox-audio-normalization-test-'))
const previousTempEnv = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]))
for (const key of Object.keys(previousTempEnv)) process.env[key] = testTempDir

const {
  cleanupStaleAudioTempDirs,
  normalizeAudioBuffer,
} = require('../src/modules/storage/audio-normalization.service')

test.after(() => {
  for (const [key, value] of Object.entries(previousTempEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(testTempDir, { recursive: true, force: true })
})

function listAudioTempDirs() {
  return fs.readdirSync(testTempDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('secretbox-audio-'))
    .map((entry) => entry.name)
}

test('audio normalization keeps the requested format and clears its temporary files', async () => {
  const sampleDir = fs.mkdtempSync(path.join(testTempDir, 'secretbox-audio-test-'))
  const samplePath = path.join(sampleDir, 'sample.mp3')
  const before = new Set(listAudioTempDirs())
  try {
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.2',
      '-c:a', 'libmp3lame', samplePath,
    ])
    assert.equal(generated.status, 0, generated.stderr.toString())

    const normalized = await normalizeAudioBuffer({
      buffer: fs.readFileSync(samplePath),
      filename: 'sample.mp3',
    })
    assert.equal(normalized.contentType, 'audio/mpeg')
    assert.equal(normalized.extension, 'mp3')
    assert.ok(normalized.buffer.length > 0)
    assert.deepEqual(new Set(listAudioTempDirs()), before)
  } finally {
    fs.rmSync(sampleDir, { recursive: true, force: true })
  }
})

test('audio normalization removes its temporary files after a processing failure', async () => {
  const before = new Set(listAudioTempDirs())
  await assert.rejects(
    normalizeAudioBuffer({ buffer: Buffer.from('not audio'), filename: 'invalid.mp3' }),
    /音频处理失败/,
  )
  assert.deepEqual(new Set(listAudioTempDirs()), before)
})

test('stale audio processing directories are removed automatically', async () => {
  const tempDir = fs.mkdtempSync(path.join(testTempDir, 'secretbox-audio-stale-'))
  const oldTime = new Date(Date.now() - 60 * 1000)
  fs.utimesSync(tempDir, oldTime, oldTime)
  await cleanupStaleAudioTempDirs({ maxAgeMs: 1 })
  assert.equal(fs.existsSync(tempDir), false)
})
