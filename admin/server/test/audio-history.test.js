const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-audio-history-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [{ id: 'pool-1', name: '音频历史测试池' }],
  miniPrograms: [{
    id: 'mp1',
    name: '音频历史测试小程序',
    appId: 'wx7000000000000098',
    status: 'active',
    config: { contentPoolId: 'pool-1', dataMode: 'shared' },
  }],
  operationLogs: [],
})

const { deleteInteractionData, getInteractionSummary, getOpened, recordOpened } = require('../src/modules/interactions/interaction.store')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('audio daily-content records keep the playback fields needed by the mini program', () => {
  const context = { miniProgramId: 'mp1', visitorId: 'audio-history-test' }

  try {
    const recorded = recordOpened(context, 'daily_content', {
      id: 'content-audio-history-test',
      type: 'audio',
      title: '给你的晚安',
      originalFilename: '晚安前想说的话.m4a',
      audioUrl: 'https://cos.example.com/audio/history-test.m4a',
      durationSeconds: 28,
    })

    assert.equal(recorded.type, 'audio')
    assert.equal(recorded.title, '给你的晚安')
    assert.equal(recorded.preview, '给你的晚安')
    assert.equal(recorded.originalFilename, '晚安前想说的话.m4a')
    assert.equal(recorded.audioUrl, 'https://cos.example.com/audio/history-test.m4a')
    assert.equal(recorded.durationSeconds, 28)

    const [opened] = getOpened(context)
    assert.equal(opened.title, '给你的晚安')
    assert.equal(opened.originalFilename, '晚安前想说的话.m4a')
    assert.equal(opened.audioUrl, 'https://cos.example.com/audio/history-test.m4a')
    assert.equal(opened.durationSeconds, 28)
  } finally {
    deleteInteractionData(context)
  }
})

test('daily-content records persist only the current technical type enum', () => {
  const context = { miniProgramId: 'mp1', visitorId: 'daily-content-type-test' }

  try {
    const text = recordOpened(context, 'daily_content', { id: 'content-text-type-test', type: 'text', text: '手记内容' })
    const audio = recordOpened(context, 'daily_content', { id: 'content-audio-type-test', type: 'audio', audioUrl: 'https://example.com/audio.m4a' })
    const album = recordOpened(context, 'daily_content', { id: 'content-album-type-test', type: 'album', images: [] })

    assert.deepEqual([text.type, audio.type, album.type], ['text', 'audio', 'album'])
  } finally {
    deleteInteractionData(context)
  }
})

test('opened summary counts each source and source id once', () => {
  const context = { miniProgramId: 'mp1', visitorId: 'opened-summary-dedupe-test' }

  try {
    const first = recordOpened(context, 'daily_content', { id: 'same-box', type: 'text', text: '第一次打开' })
    const repeated = recordOpened(context, 'daily_content', { id: 'same-box', type: 'text', text: '重复打开' })
    recordOpened(context, 'daily_content', { id: 'other-box', type: 'text', text: '另一份内容' })

    assert.equal(repeated.id, first.id)
    assert.equal(getInteractionSummary(context).totalOpened, 2)
    assert.equal(getOpened(context).length, 2)
    assert.equal(getOpened(context).filter((item) => item.sourceId === 'same-box').length, 1)
  } finally {
    deleteInteractionData(context)
  }
})
