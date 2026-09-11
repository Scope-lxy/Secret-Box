const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('interaction history renders daily audio and album entries with their controls', () => {
  const script = read('pages/interactions/interactions.js')
  const template = read('pages/interactions/interactions.wxml')
  assert.match(script, /createHistoryAudioPlayer\(this, 'items'\)/)
  assert.match(script, /openImagePreview\(this, item\.images/)
  assert.match(script, /toggleHistoryAudio\(event\)/)
  assert.match(template, /wx:elif="\{\{item\.isAudio\}\}" class="history-audio-player"/)
  assert.match(template, /wx:elif="\{\{item\.isAlbum\}\}" class="history-album-wrap"/)
  assert.match(template, /bindtap="toggleHistoryAudio"/)
  assert.match(template, /bindtap="previewHistoryImage"/)
})

test('home shares record only opened daily content with a source identity', () => {
  const source = read('pages/home/home.js')
  assert.match(source, /if \(isOpenedDailyContent\) \{[\s\S]*recordShareInteraction\(\{ source: 'daily_content', sourceId: this\.data\.dailyContent\.id \}\)/)
})
