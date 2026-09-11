function readBufferBody(req, maxBytes = 12 * 1024 * 1024, tooLargeMessage = '上传文件不能超过 12MB') {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        tooLarge = true
        req.pause()
        const error = new Error(tooLargeMessage)
        fail(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (tooLarge) return
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })

    req.on('aborted', () => fail(new Error('上传已中断，请重试')))
    req.on('error', fail)
  })
}

async function readJsonBody(req) {
  const body = await readBufferBody(req)
  if (!body.length) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch (error) {
    throw new Error('Invalid JSON body')
  }
}

function getMultipartBoundary(contentType = '') {
  const match = String(contentType).match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)
  const boundary = String(match?.[1] || match?.[2] || '').trim()
  if (!boundary || boundary.length > 200) throw new Error('上传格式无效')
  return boundary
}

async function readMultipartFile(req, {
  fieldName = 'file',
  maxBytes = 2 * 1024 * 1024,
  tooLargeMessage = '上传文件不能超过 2MB',
  multipleFileMessage = '一次只能上传一个文件',
  missingFileMessage = '请选择文件',
} = {}) {
  const boundary = getMultipartBoundary(req.headers?.['content-type'])
  const body = await readBufferBody(req, maxBytes, tooLargeMessage)
  const boundaryBuffer = Buffer.from(`--${boundary}`)
  const partSeparator = Buffer.from(`\r\n--${boundary}`)
  const headerSeparator = Buffer.from('\r\n\r\n')
  const fields = {}
  let file = null
  let cursor = body.indexOf(boundaryBuffer)

  if (cursor !== 0) throw new Error('上传格式无效')

  while (cursor >= 0) {
    const partStart = cursor + boundaryBuffer.length
    if (body.subarray(partStart, partStart + 2).toString() === '--') break
    if (body.subarray(partStart, partStart + 2).toString() !== '\r\n') throw new Error('上传格式无效')

    const headerStart = partStart + 2
    const headerEnd = body.indexOf(headerSeparator, headerStart)
    if (headerEnd < 0) throw new Error('上传格式无效')

    const headers = body.subarray(headerStart, headerEnd).toString('utf8')
    const disposition = headers.match(/content-disposition:\s*form-data;[^\r\n]*/i)?.[0] || ''
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || ''
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || ''
    const contentType = headers.match(/content-type:\s*([^\r\n;]+)/i)?.[1]?.trim() || ''
    const contentStart = headerEnd + headerSeparator.length
    const nextBoundary = body.indexOf(partSeparator, contentStart)
    if (nextBoundary < 0) throw new Error('上传格式无效')

    const value = body.subarray(contentStart, nextBoundary)
    if (name === fieldName && filename) {
      if (file) throw new Error(multipleFileMessage)
      file = { buffer: value, contentType, filename }
    } else if (name) {
      fields[name] = value.toString('utf8')
    }

    cursor = nextBoundary + 2
  }

  if (!file?.buffer?.length) throw new Error(missingFileMessage)
  return { fields, file }
}

module.exports = {
  readBufferBody,
  readJsonBody,
  readMultipartFile,
}
