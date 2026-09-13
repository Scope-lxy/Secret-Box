const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const folders = require('../admin/src/folder-import-files')

const file = (relativePath) => ({ name: relativePath.split('/').pop(), webkitRelativePath: relativePath, size: 64 })
const options = (extensions) => ({ accept: (record) => extensions.includes(record.name.split('.').pop().toLowerCase()) })
const entry = (name) => ({ name, isFile: true, file: (resolve) => resolve(file(name)) })
function directory(name, children) {
  return { name, isDirectory: true, createReader() {
    let offset = 0
    return { readEntries(resolve) { const batch = children.slice(offset, offset + 100); offset += 100; resolve(batch) } }
  } }
}

test('mixed folders filter each content type, retain same names in separate directories, and sort naturally', () => {
  const input = ['素材/甲/10.txt', '素材/甲/2.TXT', '素材/乙/2.TXT', '素材/甲/a.mp3', '素材/乙/深层/a.m4a', '素材/甲/a.jpg', '素材/乙/深层/a.png', '素材/.cache/a.txt', '素材/node_modules/a.txt', '素材/__MACOSX/a.jpg', '素材/a.json'].map(file)
  const text = folders.fromFiles(input, options(['txt']))
  assert.deepEqual(text.records.map((record) => record.path), ['素材/甲/2.TXT', '素材/甲/10.txt', '素材/乙/2.TXT'])
  assert.equal(text.skipped, 8)
  assert.equal(folders.fromFiles(input, options(['mp3', 'm4a'])).records.length, 2)
  assert.equal(folders.fromFiles(input, options(['jpg', 'png'])).records.length, 2)
  assert.throws(() => folders.fromFiles([file('a.txt'), file('a.txt')], options(['txt'])), /同一路径/)
  assert.throws(() => folders.fromFiles([file('素材/.cache/a.txt'), file('a.mp3')], options(['txt'])), /已跳过 2/)
})

test('drop reads every directory page, captures entries before yielding, and never opens unrelated files', async () => {
  let readable = true
  const root = directory('素材', [directory('深层', Array.from({ length: 137 }, (_, i) => entry(i + '.txt'))),
    { name: 'movie.mp4', isFile: true, file() { assert.fail('unrelated file must not be read') } },
    { name: '.cache', isDirectory: true, createReader() { assert.fail('cache must not be visited') } }])
  const pending = folders.fromDrop({ items: [{ webkitGetAsEntry() { assert(readable); return root } }] }, options(['txt']))
  readable = false
  const result = await pending
  assert.equal(result.records.length, 137)
  assert.equal(result.skipped, 2)
  assert.equal(result.records.at(-1).path, '素材/深层/136.txt')
  await assert.rejects(folders.fromDrop({ items: [] }), /选择文件夹/)
  await assert.rejects(folders.fromDrop({ items: [{ webkitGetAsEntry: () => entry('a.txt') }] }), /请拖入文件夹/)
})

test('an unreadable directory reports its path and does not silently return a partial selection', async () => {
  const bad = { name: '无法读取', isDirectory: true, createReader: () => ({ readEntries(_resolve, reject) { reject(Object.assign(new Error('denied'), { name: 'SecurityError' })) } }) }
  await assert.rejects(folders.fromDrop({ items: [{ webkitGetAsEntry: () => directory('素材', [entry('a.txt'), bad]) }] }, options(['txt'])), /素材\/无法读取/)
})

function textParser(state) {
  const source = fs.readFileSync(path.resolve(__dirname, '../admin/src/import.js'), 'utf8')
  const helpers = source.slice(source.indexOf('  function textBlocks('), source.indexOf('  function skippedSummary('))
  const parser = source.slice(source.indexOf('  async function parseTextSource('), source.indexOf('  function buildDailyContentImageItems('))
  let id = 0
  return Function('state', 'makeId', `${helpers}\n${parser}\nconst type = 'text'; const render = () => {}; const preflightParsedItems = async () => {}; return parseTextSource`)(state, () => String(++id))
}

test('multiple TXT files choose their own split method and never merge across file boundaries', async () => {
  const state = { splitMode: 'auto', sourceName: '素材', textSources: [
    { path: '素材/甲/同名.txt', text: '1. 第一条\n2. 第二条' },
    { path: '素材/乙/同名.txt', text: '第三条\n\n第四条' },
    { path: '素材/丙.txt', text: '第五条\n---\n第六条' },
    { path: '素材/丁.txt', text: '独立文本' },
  ] }
  const parse = textParser(state)
  await parse(1)
  assert.deepEqual(state.items.map((item) => item.content), ['第一条', '第二条', '第三条', '第四条', '第五条', '第六条', '独立文本'])
  state.splitMode = 'separator'
  await parse(2)
  assert.deepEqual(state.items.map((item) => item.content), ['1. 第一条 2. 第二条', '第三条 第四条', '第五条', '第六条', '独立文本'])
  state.splitMode = 'auto'
  await parse(3)
  assert.equal(state.items.length, 7)
})

test('an unreadable TXT remains a named problem item beside the successfully parsed text', async () => {
  const state = { splitMode: 'auto', sourceName: '素材', textSources: [
    { path: '素材/正常.txt', text: '正常内容' },
    { path: '素材/深层/损坏.txt', text: '', error: '文件已移动' },
  ] }
  await textParser(state)(1)
  assert.equal(state.items.length, 2)
  assert.equal(state.items[0].content, '正常内容')
  assert.deepEqual(state.items[1].errors, ['素材/深层/损坏.txt：文件已移动'])
})
