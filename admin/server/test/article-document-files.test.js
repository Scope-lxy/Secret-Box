const assert = require('node:assert/strict')
const test = require('node:test')
const files = require('../admin/src/article-document-files')
const file = (name, relativePath = name, size = 120) => ({ name, webkitRelativePath: relativePath, size })
const fileEntry = (name) => ({ name, isFile: true, file: (done) => done(file(name)) })
function directory(name, children, chunkSize = 100) {
  return { name, isDirectory: true, createReader() {
    let offset = 0
    return { readEntries(done) { const batch = children.slice(offset, offset + chunkSize); offset += chunkSize; done(batch) } }
  } }
}
test('selecting Downloads finds articles in multiple accounts and deeper subdirectories and skips helpers', () => {
  const result = files.fromFiles([
    file('同名.md', '下载/示例账号A/同名.md'),
    file('同名.md', '下载/示例账号B/2026/同名.md'),
    file('a.md', '下载/.article-capture/草稿/a.md'),
    file('b.txt', '下载/.state/报告/b.txt'),
    file('图片.jpg', '下载/示例账号B/图片.jpg'),
  ])
  assert.equal(result.records.length, 2)
  assert.equal(result.skipped, 3)
  assert.deepEqual(new Set(result.records.map((record) => record.path)), new Set(['下载/示例账号A/同名.md', '下载/示例账号B/2026/同名.md']))
})
test('dragged folders drain every 100-entry batch and walk nested directories without entering caches', async () => {
  let enteredHidden = false
  const hidden = { name: '.article-capture', isDirectory: true, createReader() { enteredHidden = true; throw new Error('must skip') } }
  const account = directory('示例账号A', Array.from({ length: 137 }, (_, i) => fileEntry('第' + i + '.md')))
  const second = directory('示例账号B', [directory('深层', [fileEntry('另一篇.markdown')])])
  const result = await files.fromDrop({ items: [{ webkitGetAsEntry: () => directory('下载', [account, hidden, second]) }] })
  assert.equal(result.records.length, 138)
  assert.equal(enteredHidden, false)
  assert(result.records.some((record) => record.path === '下载/示例账号B/深层/另一篇.markdown'))
  await assert.rejects(files.fromDrop({ items: [{ webkitGetAsEntry: () => fileEntry('单篇.md') }] }), /请拖入文件夹/)
})
test('limits reject the whole selection and groups respect both byte and file limits', async () => {
  assert.throws(() => files.fromFiles(Array.from({ length: 201 }, (_, i) => file(i + '.md'))), /未提交任何文件/)
  await assert.rejects(files.fromDrop({ items: [{ webkitGetAsEntry: () => directory('下载', Array.from({ length: 201 }, (_, i) => fileEntry(i + '.md'))) }] }), /200/)
  assert.throws(() => files.fromFiles([file('过大.md', '过大.md', 1048577)]), /1MB/)
  const result = files.fromFiles(Array.from({ length: 20 }, (_, i) => file(i + '.md', i + '.md', 1048576)))
  const chunks = files.chunks(result.records)
  assert.equal(chunks.length, 10)
  assert(chunks.every((chunk) => chunk.reduce((sum, record) => sum + record.size, 0) <= 2097152))
})
