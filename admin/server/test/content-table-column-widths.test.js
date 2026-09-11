const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const adminSource = path.resolve(__dirname, '../admin/src')
const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
const script = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')
const styles = fs.readFileSync(path.join(adminSource, 'styles.css'), 'utf8')

test('content tables share stable auxiliary widths and leave one elastic core column', () => {
  const coreColumns = {
    'content-texts': 'col-copy col-core',
    'content-audios': 'col-audio-title col-core',
    letters: 'col-copy col-core',
  }
  Object.entries(coreColumns).forEach(([name, coreClass]) => {
    const table = markup.match(new RegExp(`<table class="data-table content-edit-table content-table-${name}">[\\s\\S]*?<\\/table>`))?.[0] || ''
    assert.match(table, /<col class="col-label">/)
    assert.ok(table.includes(`<col class="${coreClass}">`))
  })
  const contentAlbumTable = markup.match(/<table class="data-table content-edit-table content-table-content-albums">[\s\S]*?<\/table>/)?.[0] || ''
  assert.match(contentAlbumTable, /<col class="col-album-preview col-core">/)
  const articleTable = markup.match(/<table class="data-table article-table">[\s\S]*?<\/table>/)?.[0] || ''
  ;['select', 'id', 'label', 'article-title', 'cover', 'published-at', 'actions'].forEach((name) => {
    assert.match(articleTable, new RegExp(`<col class="col-${name}">`))
  })

  const expectedWidths = {
    select: 44,
    id: 44,
    label: 120,
    date: 120,
    metric: 72,
    'audio-name': 150,
    preview: 132,
    'album-preview': 408,
    actions: 112,
  }
  Object.entries(expectedWidths).forEach(([name, width]) => {
    assert.match(styles, new RegExp(`--content-col-${name}: ${width}px;`))
  })
  ;['select', 'id', 'label', 'date', 'metric', 'audio-name', 'preview', 'actions'].forEach((name) => {
    assert.match(styles, new RegExp(`\\.content-edit-table \\.col-${name} \\{ width: var\\(--content-col-${name}\\); \\}`))
  })
  assert.doesNotMatch(styles, /\.content-edit-table \.col-album-preview \{[^}]*width:/)
  ;['select', 'id', 'label'].forEach((name) => {
    assert.match(styles, new RegExp(`\\.article-table \\.col-${name} \\{ width: var\\(--content-col-${name}\\); \\}`))
  })
  assert.match(styles, /\.article-table \.col-cover \{ width: 76px; \}/)
  assert.match(styles, /--content-col-author: 144px;/)
  assert.match(styles, /--content-col-audio-preview: 76px;/)
  assert.match(styles, /\.content-edit-table \.col-audio-preview \{ width: var\(--content-col-audio-preview\); \}/)
  assert.match(styles, /\.article-table \.col-article-author \{ width: var\(--content-col-author\); \}/)
  assert.match(styles, /\.article-table td\[data-label="作者"\] \{[\s\S]*padding-right: 16px;/)
  assert.match(styles, /\.article-table td\[data-label="作者"\] \.article-list-author \{[\s\S]*width: 100%;[\s\S]*min-width: 0;/)
  assert.match(styles, /\.article-table td\[data-label="封面"\] \{[\s\S]*padding-left: 16px;/)
  assert.match(styles, /\.article-list-cover-link,[\s\S]*\.article-list-cover \{[\s\S]*width: 56px;[\s\S]*height: 32px;/)
  assert.match(styles, /\.article-table \.col-published-at \{ width: 144px; \}/)
  assert.match(styles, /\.article-table \.col-actions \{ width: var\(--content-col-actions\); \}/)
  assert.match(styles, /\.data-table \.col-id \{ width: var\(--content-col-id\); \}/)
  assert.match(styles, /\.data-table \.col-label \{ width: var\(--content-col-label\); \}/)
  assert.match(markup, /<table class="data-table pool-table">[\s\S]*<col class="col-id">/)
  assert.match(markup, /<table class="data-table">[\s\S]*<col class="col-id">[\s\S]*<thead>[\s\S]*<th>ID<\/th>/)
  assert.match(script, /<table class="data-table config-table">\s*<colgroup><col class="col-id"><\/colgroup>/)
  assert.match(script, /<table class="data-table image-table">[\s\S]*<col class="col-id">[\s\S]*<col class="col-label">/)
  assert.match(script, /<table class="data-table">\s*<colgroup><col class="col-id"><\/colgroup>[\s\S]*<th>ID<\/th><th>留言内容/)
  assert.match(script, /<table class="data-table">\s*<colgroup><col class="col-id"><\/colgroup>[\s\S]*<th>ID<\/th><th>账号/)
  assert.match(styles, /\.article-table td\[data-label="标签"\] \.content-label-input \{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*max-width: 100%;[\s\S]*box-sizing: border-box;/)
  assert.match(styles, /\.article-table td\[data-label="操作"\] \.content-row-actions \.btn-text \{[\s\S]*padding: 0 6px;/)
  assert.match(styles, /\.content-table-content-albums \.thumb-strip \{\s*flex-wrap: nowrap;\s*overflow-x: auto;/)
  assert.match(styles, /\.content-table-content-albums \.thumb-link \{\s*flex: 0 0 32px;/)
  assert.match(styles, /\.content-edit-table \{\s+table-layout: fixed;/)
  assert.doesNotMatch(styles, /\.content-edit-table \.col-core \{[^}]*width:/)
  assert.equal((markup.match(/col-metric/g) || []).length, 3)
  assert.match(styles, /\.content-label-input,[\s\S]*?max-width: 100%;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/)
  assert.match(styles, /\.data-table input:not\(\[type="checkbox"\]\),[\s\S]*?\.data-table select,[\s\S]*?\.data-table textarea \{[\s\S]*?font-size: var\(--font-compact\);[\s\S]*?font-weight: var\(--font-weight-regular\);/)
  assert.match(styles, /\.data-table input:not\(\[type="checkbox"\]\),[\s\S]*?\.data-table select \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/)
  assert.match(styles, /\.data-table textarea \{\s*white-space: normal;/)
  assert.equal((script.match(/class="content-label-input"/g) || []).length, 4)
  assert.doesNotMatch(styles, /\.content-table-[^{]+\.col-[^{]+\{[^}]*width:/)

  const minimumTableWidth = 1200 - 120 - (28 * 2) - (24 * 2) - 2
  const fixedWidths = {
    'content-texts': 44 + 44 + 84 + 72 + 112,
    'content-audios': 44 + 44 + 84 + 150 + 76 + 72 + 72 + 112,
    'content-albums': 44 + 44 + 84 + 112,
    letters: 44 + 44 + 84 + 112,
  }
  Object.entries(fixedWidths).forEach(([name, width]) => {
    assert.ok(minimumTableWidth - width >= 220, `${name} should leave at least 220px for its core column`)
  })

  const contentAlbumPreviewContentWidth = minimumTableWidth - fixedWidths['content-albums'] - (12 * 2)
  const nineThumbnailsWidth = (9 * 32) + (8 * 5)
  assert.ok(contentAlbumPreviewContentWidth >= nineThumbnailsWidth, 'content album preview should fit nine thumbnails on one line at the desktop minimum width')
})

test('audio content table uses one lazy global preview player', () => {
  const audioTable = markup.match(/<table class="data-table content-edit-table content-table-content-audios">[\s\S]*?<\/table>/)?.[0] || ''
  assert.match(audioTable, /<col class="col-audio-preview">/)
  assert.match(audioTable, /<th>试听<\/th>/)
  assert.match(script, /data-audio-play/)
  assert.match(script, /adminAudio = new Audio\(\)/)
  assert.match(script, /adminAudio\.preload = 'none'/)
  assert.match(markup, /id="adminAudioPlayer"/)
  assert.match(markup, /id="adminAudioProgress"[^>]*type="range"/)
})
