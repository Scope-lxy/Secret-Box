const AVATAR_SIZE = 256
const MAX_AVATAR_BYTES = 100 * 1024
const JPEG_QUALITIES = [0.82, 0.68, 0.54, 0.4, 0.28, 0.16, 0.06, 0.01]

function getCenteredSquareCrop(width, height) {
  const sourceWidth = Math.max(0, Number(width) || 0)
  const sourceHeight = Math.max(0, Number(height) || 0)
  const size = Math.min(sourceWidth, sourceHeight)
  if (!size) throw new Error('头像图片尺寸无效')
  return {
    sx: (sourceWidth - size) / 2,
    sy: (sourceHeight - size) / 2,
    size,
  }
}

function loadCanvasImage(canvas, sourcePath) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('头像图片读取失败'))
    image.src = sourcePath
  })
}

function exportAvatarJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      destWidth: AVATAR_SIZE,
      destHeight: AVATAR_SIZE,
      fileType: 'jpg',
      quality,
      success: (result) => result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error('头像图片导出失败')),
      fail: () => reject(new Error('头像图片导出失败')),
    })
  })
}

function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: (result) => Number.isFinite(Number(result.size)) ? resolve(Number(result.size)) : reject(new Error('头像文件读取失败')),
      fail: () => reject(new Error('头像文件读取失败')),
    })
  })
}

function removeTemporaryAvatar(filePath) {
  if (!filePath) return
  wx.getFileSystemManager().unlink({ filePath, fail: () => {} })
}

async function createAvatarJpeg(canvas, sourcePath) {
  if (!canvas || !String(sourcePath || '').trim()) throw new Error('头像处理服务不可用')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('头像处理服务不可用')
  const image = await loadCanvasImage(canvas, sourcePath)
  const crop = getCenteredSquareCrop(image.width, image.height)
  context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  context.drawImage(image, crop.sx, crop.sy, crop.size, crop.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE)

  const temporaryPaths = []
  let selectedPath = ''
  try {
    for (const quality of JPEG_QUALITIES) {
      const tempFilePath = await exportAvatarJpeg(canvas, quality)
      temporaryPaths.push(tempFilePath)
      if (await getFileSize(tempFilePath) <= MAX_AVATAR_BYTES) {
        selectedPath = tempFilePath
        return selectedPath
      }
    }
    throw new Error('头像图片导出失败')
  } finally {
    temporaryPaths.filter((filePath) => filePath !== selectedPath).forEach(removeTemporaryAvatar)
  }
}

module.exports = {
  AVATAR_SIZE,
  JPEG_QUALITIES,
  MAX_AVATAR_BYTES,
  createAvatarJpeg,
  getCenteredSquareCrop,
  removeTemporaryAvatar,
}
