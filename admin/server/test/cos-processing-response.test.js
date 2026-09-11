const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const main = fs.readFileSync(path.resolve(__dirname, '../admin/src/main.js'), 'utf8')

class FakeNode {
  constructor(name, values = {}) {
    this.localName = name
    this.nodeName = name
    this.values = values
  }

  getElementsByTagName(name) {
    return this.values[name] || []
  }
}

function textNode(value) {
  return { textContent: value }
}

function objectNode({ code = '', key = '', message = '' } = {}) {
  return new FakeNode('Object', {
    Code: code ? [textNode(code)] : [],
    Key: key ? [textNode(key)] : [],
    Message: message ? [textNode(message)] : [],
  })
}

function documentNode(root) {
  return {
    documentElement: root,
    getElementsByTagName: () => [],
  }
}

function loadHelpers(documents) {
  const source = main.match(/function normalizeCosResultKey\(value\) \{[\s\S]*?\n\}\n\nasync function uploadImageFileToCos/)
  assert.ok(source, 'COS processing helpers should remain available in main.js')
  const helperSource = source[0].replace(/\n\nasync function uploadImageFileToCos[\s\S]*$/, '')
  class DOMParser {
    parseFromString(value) {
      return documents[value]
    }
  }
  return Function('DOMParser', `${helperSource}; return { assertCosImageProcessingSucceeded }`)(DOMParser)
}

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => body }
}

test('COS 200 is accepted only when both requested derivatives are present', async () => {
  const medium = objectNode({ key: 'secretbox/uploads/task/medium.jpg' })
  const thumb = objectNode({ key: 'secretbox/uploads/task/thumb.jpg' })
  const successRoot = new FakeNode('UploadResult', { Object: [medium, thumb] })
  const partialRoot = new FakeNode('UploadResult', { Object: [medium] })
  const { assertCosImageProcessingSucceeded } = loadHelpers({
    success: documentNode(successRoot),
    partial: documentNode(partialRoot),
  })

  const expected = [
    'https://media.example.com/secretbox/uploads/task/medium.jpg',
    'https://media.example.com/secretbox/uploads/task/thumb.jpg',
  ]
  await assertCosImageProcessingSucceeded(response('success'), expected)
  await assert.rejects(
    assertCosImageProcessingSucceeded(response('partial'), expected),
    (error) => error.status === 502 && /处理结果不完整/.test(error.message),
  )
})

test('COS processing error codes distinguish retryable and permanent failures', async () => {
  const invalid = objectNode({ code: 'InvalidArgument', message: 'Pic-Operations is invalid' })
  const temporary = objectNode({ code: 'InternalError', message: 'try again later' })
  const { assertCosImageProcessingSucceeded } = loadHelpers({
    invalid: documentNode(new FakeNode('UploadResult', { Object: [invalid] })),
    temporary: documentNode(new FakeNode('UploadResult', { Object: [temporary] })),
  })

  await assert.rejects(
    assertCosImageProcessingSucceeded(response('invalid'), []),
    (error) => error.status === 422 && error.cosCode === 'InvalidArgument' && /Pic-Operations is invalid/.test(error.message),
  )
  await assert.rejects(
    assertCosImageProcessingSucceeded(response('temporary'), []),
    (error) => error.status === 503 && error.cosCode === 'InternalError',
  )
})

test('batch importer validates the COS processing body before marking an upload complete', () => {
  const importer = fs.readFileSync(path.resolve(__dirname, '../admin/src/import.js'), 'utf8')
  const upload = importer.match(/  async function uploadPreparedImage\(context, prepared\) \{[\s\S]*?\n  \}/)
  assert.ok(upload)
  const validationIndex = upload[0].indexOf('await assertCosImageProcessingSucceeded')
  const completionIndex = upload[0].indexOf('image.completion =')
  assert.ok(validationIndex >= 0 && completionIndex > validationIndex)
  assert.match(importer, /delays: \[500, 1000\],[\s\S]*?shouldRetry: isTemporaryRequestError/)
})
