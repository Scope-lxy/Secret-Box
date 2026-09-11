const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const miniappRoot = path.resolve(__dirname, '../../../miniprogram')

function readMiniappFile(relativePath) {
  return fs.readFileSync(path.join(miniappRoot, relativePath), 'utf8')
}

function createComponentInstance(definition, getHeight) {
  const instance = {
    data: { ...definition.data },
    ...definition.methods,
    setData(update, callback) {
      Object.assign(this.data, update)
      callback?.()
    },
    createSelectorQuery() {
      const selectors = []
      return {
        select(selector) {
          selectors.push(selector)
          return this
        },
        boundingClientRect() {
          return this
        },
        exec(callback) {
          callback(selectors.map((selector) => ({ height: getHeight(selector, instance.data) })))
        },
      }
    },
  }
  return instance
}

async function flushMeasurements(rounds = 16) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('expandable text only shows controls when continuous preview text exceeds two lines', async () => {
  const componentPath = path.join(miniappRoot, 'components/expandable-text/expandable-text.js')
  const previousComponent = global.Component
  const previousWx = global.wx
  let definition

  try {
    global.Component = (value) => { definition = value }
    global.wx = { nextTick: (callback) => setImmediate(callback) }
    delete require.cache[require.resolve(componentPath)]
    require(componentPath)

    const lineHeight = 24
    const lineCapacity = 6
    const renderedHeight = (length) => Math.ceil(length / lineCapacity) * lineHeight
    const getHeight = (selector, data) => {
      if (selector.endsWith('--full')) return renderedHeight(Array.from(data.content).length)
      if (selector.endsWith('--collapsed')) return Math.min(renderedHeight(Array.from(data.content).length), lineHeight * 2)
      return 0
    }

    const shortText = createComponentInstance(definition, getHeight)
    definition.observers['text, paragraphs'].call(shortText, '短文本', [])
    await flushMeasurements()
    assert.equal(shortText.data.showToggle, false)
    assert.equal(shortText.data.content, '短文本')

    const longText = createComponentInstance(definition, getHeight)
    definition.observers['text, paragraphs'].call(longText, `${'甲'.repeat(15)}\n${'乙'.repeat(15)}`, ['自动第一段', '自动第二段'])
    await flushMeasurements()
    assert.equal(longText.data.showToggle, true)
    assert.equal(longText.data.content, `${'甲'.repeat(15)}${'乙'.repeat(15)}`)
    longText.toggleExpanded()
    assert.equal(longText.data.expanded, true)
    longText.toggleExpanded()
    assert.equal(longText.data.expanded, false)

    const latestText = createComponentInstance(definition, getHeight)
    definition.observers['text, paragraphs'].call(latestText, '旧'.repeat(30), [])
    definition.observers['text, paragraphs'].call(latestText, '', ['新段落', '仍保留'])
    await flushMeasurements()
    assert.equal(latestText.data.content, '新段落仍保留')
    assert.equal(latestText.data.showToggle, false)
    assert.equal(latestText.measureVersion, 2)
  } finally {
    global.Component = previousComponent
    global.wx = previousWx
    delete require.cache[require.resolve(componentPath)]
  }
})

test('five activity entry points use the two-line expandable text component', () => {
  const pages = ['mine', 'opened-history', 'interactions', 'messages', 'favorites']
  pages.forEach((page) => {
    const config = JSON.parse(readMiniappFile(`pages/${page}/${page}.json`))
    const template = readMiniappFile(`pages/${page}/${page}.wxml`)
    assert.equal(config.usingComponents?.['expandable-text'], '/components/expandable-text/expandable-text')
    assert.match(template, /<expandable-text\b/)
  })

  const componentTemplate = readMiniappFile('components/expandable-text/expandable-text.wxml')
  const componentStyles = readMiniappFile('components/expandable-text/expandable-text.wxss')
  const componentSource = readMiniappFile('components/expandable-text/expandable-text.js')
  assert.match(componentTemplate, /wx:if="\{\{!expanded\}\}"[^>]*is-collapsed/)
  assert.match(componentTemplate, /is-collapsed">\{\{content\}\}<\/text>/)
  assert.doesNotMatch(componentTemplate, /expandable-text__fade/)
  assert.match(componentTemplate, /expanded \? '收起' : '展开'/)
  assert.match(componentTemplate, /wx:for="\{\{paragraphs\}\}"/)
  assert.doesNotMatch(componentTemplate, /【|】|\.\.\.|…|展开全文|收起全文|measure--candidate/)
  assert.doesNotMatch(componentSource, /collapsedText|measureText|measureCandidate|Array\.from|while \(low < high\)/)
  assert.match(componentStyles, /\.expandable-text__copy\.is-collapsed,[\s\S]*?max-height:\s*3em;/)
  assert.match(componentStyles, /\.expandable-text__copy\.is-collapsed\s*\{[^}]*text-align:\s*justify;[^}]*text-justify:\s*inter-character;/s)
  assert.doesNotMatch(componentStyles, /\.expandable-text__paragraphs[^}]*text-align:\s*justify|\.expandable-text__measure[^}]*text-align:\s*justify/s)
  assert.doesNotMatch(componentStyles, /-webkit-line-clamp|-webkit-box-orient/)
  assert.match(componentStyles, /@import ['"]\.\.\/\.\.\/styles\/expand-toggle\.wxss['"];/)
  assert.match(componentStyles, /\.expandable-text__toggle\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*0;/s)
  const expandToggleStyles = readMiniappFile('styles/expand-toggle.wxss')
  assert.match(expandToggleStyles, /\.expandable-text__toggle\s*\{[^}]*width:\s*2\.25em;[^}]*background:\s*var\(--color-card\);/s)
  assert.match(expandToggleStyles, /\.expandable-text__toggle::before[\s\S]*?linear-gradient\(90deg,\s*transparent,\s*var\(--color-card\)\)/s)
  assert.doesNotMatch(componentStyles, /measure--candidate/)
})

test('opened history keeps audio and image records outside text folding', () => {
  for (const page of ['mine', 'opened-history']) {
    const template = readMiniappFile(`pages/${page}/${page}.wxml`)
    assert.match(template, /wx:(?:if|elif)="\{\{item\.isAudio\}\}"[^>]*history-audio-player/)
    assert.match(template, /wx:elif="\{\{item\.images\.length\}\}"[^>]*history-album-wrap/)
    assert.match(template, /class="history-image-grid"/)
    assert.match(template, /<expandable-text\s+wx:else\b/)
  }
})
