const assert = require('node:assert/strict')
const test = require('node:test')

const {
  AVATAR_SIZE,
  JPEG_QUALITIES,
  MAX_AVATAR_BYTES,
  createAvatarJpeg,
  getCenteredSquareCrop,
} = require('../../../miniprogram/utils/avatar-image')

test('avatar preprocessing keeps a centered square crop at 256 pixels and targets 100KB', () => {
  assert.equal(AVATAR_SIZE, 256)
  assert.equal(MAX_AVATAR_BYTES, 100 * 1024)
  assert.deepEqual(getCenteredSquareCrop(1200, 800), { sx: 200, sy: 0, size: 800 })
  assert.deepEqual(getCenteredSquareCrop(800, 1200), { sx: 0, sy: 200, size: 800 })
  assert.equal(JPEG_QUALITIES.at(-1), 0.01)
})

test('avatar preprocessing retries JPEG quality until the exported file is below 100KB', async () => {
  const originalWx = global.wx
  const exportedQualities = []
  const deletedPaths = []
  const drawCalls = []
  global.wx = {
    canvasToTempFilePath(options) {
      exportedQualities.push(options.quality)
      options.success({ tempFilePath: `/tmp/avatar-${options.quality}.jpg` })
    },
    getFileSystemManager() {
      return {
        getFileInfo({ filePath, success }) {
          success({ size: filePath.includes('0.82') ? (101 * 1024) : (99 * 1024) })
        },
        unlink({ filePath, fail }) {
          deletedPaths.push(filePath)
          fail()
        },
      }
    },
  }
  const canvas = {
    createImage() {
      return {
        width: 1200,
        height: 800,
        set src(value) {
          this.onload({ target: { src: value } })
        },
      }
    },
    getContext() {
      return {
        clearRect() {},
        drawImage(...args) { drawCalls.push(args) },
      }
    },
  }

  try {
    const result = await createAvatarJpeg(canvas, '/tmp/source.png')
    assert.equal(result, '/tmp/avatar-0.68.jpg')
    assert.deepEqual(exportedQualities, [0.82, 0.68])
    assert.deepEqual(drawCalls[0].slice(1, 5), [200, 0, 800, 800])
    assert.deepEqual(deletedPaths, ['/tmp/avatar-0.82.jpg'])
  } finally {
    global.wx = originalWx
  }
})
