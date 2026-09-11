const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-recent-daily-content-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase, writeState } = require('../src/lib/state-database')
writeState(path.join(dataDir, 'admin-settings.json'), {
  currentMiniProgramId: 'mp1',
  contentPools: [{ id: 'pool-1', name: '最近打开过滤内容池' }],
  miniPrograms: [{
    id: 'mp1',
    name: '最近打开过滤小程序',
    appId: 'wxrecentdailytest1',
    status: 'active',
    config: { contentPoolId: 'pool-1' },
  }],
  operationLogs: [],
})
const { getDailyContentAvailability, openDailyContent } = require('../src/modules/content/content.service')
const { updateContentAlbums, updateContentAudios, updateContentTexts } = require('../src/modules/content/content.store')
const { recordOpened } = require('../src/modules/interactions/interaction.store')
const { updateMiniProgramConfig } = require('../src/modules/admin/admin-settings.store')
const { syncLogin } = require('../src/modules/auth/account.store')
const { createMiniAppSession } = require('../src/modules/auth/miniapp-session.store')
const { getDataScope } = require('../src/modules/data-scope/data-scope')
const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')

const noteA = { id: 'recent-filter-note-a', label: '测试', text: '内容 A' }
const noteB = { id: 'recent-filter-note-b', label: '测试', text: '内容 B' }

function recordDailyContentOpen(context, item) {
  return recordOpened(context, 'daily_content', { ...item, type: 'text' })
}

function withFixedNow(now, callback) {
  const originalNow = Date.now
  Date.now = () => now
  try {
    return callback()
  } finally {
    Date.now = originalNow
  }
}

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('随机手记只排除当前用户近 30 天打开记录，指定分享内容不受影响', () => {
  const now = Date.now()
  withFixedNow(now, () => {
    updateContentTexts([noteA, noteB], 'pool-1')
    updateContentAlbums([], 'pool-1')
    updateContentAudios([], 'pool-1')

    const recentUser = { miniProgramId: 'mp1', visitorId: 'recent-open-user' }
    recordDailyContentOpen(recentUser, noteA)
    assert.equal(openDailyContent('random', recentUser).dailyContent.id, noteB.id)
    assert.deepEqual(getDailyContentAvailability('text', recentUser), {
      available: true,
      fallbackAvailable: true,
    })

    const oldOpenUser = { miniProgramId: 'mp1', visitorId: 'old-open-user' }
    const oldRecord = recordDailyContentOpen(oldOpenUser, noteA)
    getDatabase().prepare('UPDATE opened_records SET created_at = ? WHERE opened_id = ?').run(
      new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
      oldRecord.id,
    )
    recordDailyContentOpen(oldOpenUser, noteB)
    assert.equal(openDailyContent('random', oldOpenUser).dailyContent.id, noteA.id)

    updateContentTexts([noteA], 'pool-1')
    const exhaustedUser = { miniProgramId: 'mp1', visitorId: 'exhausted-open-user' }
    recordDailyContentOpen(exhaustedUser, noteA)
    assert.deepEqual(openDailyContent('random', exhaustedUser), {
      dailyContent: null,
      message: '暂无可打开内容',
    })
    assert.deepEqual(getDailyContentAvailability('text', exhaustedUser), {
      available: false,
      fallbackAvailable: false,
    })

    const otherUser = { miniProgramId: 'mp1', visitorId: 'other-open-user' }
    assert.equal(openDailyContent('random', otherUser).dailyContent.id, noteA.id)
    assert.deepEqual(getDailyContentAvailability('random', otherUser, '', noteA.id), {
      available: false,
      fallbackAvailable: false,
    })
    assert.deepEqual(openDailyContent('random', otherUser, noteA.id), {
      dailyContent: null,
      message: '暂无可打开内容',
    })

    const largeHistoryUser = { miniProgramId: 'mp1', visitorId: 'large-history-user' }
    const insertOpened = getDatabase().prepare(`
      INSERT INTO opened_records (
        opened_id, event_id, data_scope_id, mini_program_id, visitor_id,
        source, source_id, created_at, item_json
      ) VALUES (?, ?, 'shared:pool-1', ?, ?, 'daily_content', ?, ?, '{}')
    `)
    getDatabase().transaction(() => {
      for (let index = 0; index < 1100; index += 1) {
        insertOpened.run(
          `large-history-open-${index}`,
          `large-history-open-${index}`,
          largeHistoryUser.miniProgramId,
          largeHistoryUser.visitorId,
          `unrelated-history-item-${index}`,
          new Date(now).toISOString(),
        )
      }
    })()
    assert.equal(openDailyContent('random', largeHistoryUser).dailyContent.id, noteA.id)

    assert.equal(getDailyContentAvailability('text', exhaustedUser, noteA.id).available, true)
    assert.equal(openDailyContent('text', exhaustedUser, '', noteA.id).dailyContent.id, noteA.id)
    assert.equal(openDailyContent('text', exhaustedUser, '', noteA.id).dailyContent.id, noteA.id)
  })
})

test('HTTP 分享打开按指定类型选择，并拒绝已关闭类型', async () => {
  const albums = [
    { id: 'share-album-a', label: '图册 A', images: [{ id: 'share-image-a' }] },
    { id: 'share-album-b', label: '图册 B', images: [{ id: 'share-image-b' }] },
  ]
  const audio = {
    id: 'share-audio-a',
    label: '音频 A',
    title: '分享音频',
    originalFilename: 'share-audio-a.m4a',
    objectKey: 'audio/share-audio-a.m4a',
    audioUrl: 'https://example.test/audio/share-audio-a.m4a',
    durationSeconds: 12,
    sizeBytes: 1024,
    contentType: 'audio/mp4',
  }
  updateContentTexts([{ id: 'share-text-a', label: '文字 A', text: '不应被图册或音频请求选中。' }], 'pool-1')
  updateContentAlbums(albums, 'pool-1')
  updateContentAudios([audio], 'pool-1')
  updateMiniProgramConfig('mp1', { dailyContentTypes: { imageEnabled: true, audioEnabled: true } })

  const server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  async function openAs(visitorId, payload) {
    const account = syncLogin({ miniProgramId: 'mp1', visitorId }, { openid: `openid-${visitorId}` })
    const session = createMiniAppSession({ accountId: account.accountId, miniProgramId: 'mp1' })
    const dataScopeId = getDataScope({ miniProgramId: 'mp1', accountId: account.accountId }).dataScopeId
    const response = await fetch(`${baseUrl}/api/miniapp/daily-content/open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-miniapp-appid': 'wxrecentdailytest1',
        'x-miniapp-data-scope': dataScopeId,
        'x-miniapp-session': session.token,
        'x-visitor-id': visitorId,
      },
      body: JSON.stringify(payload),
    })
    return { status: response.status, data: await response.json() }
  }

  try {
    const albumOpens = await Promise.all([
      openAs('album-share-first', { type: 'album' }),
      openAs('album-share-second', { type: 'album' }),
    ])
    albumOpens.forEach((result) => {
      assert.equal(result.status, 201, result.data.message)
      assert.equal(result.data.dailyContent.type, 'album')
      assert.ok(albums.some((item) => item.id === result.data.dailyContent.id))
    })

    const openedAudio = await openAs('audio-share', { type: 'audio' })
    assert.equal(openedAudio.status, 201)
    assert.equal(openedAudio.data.dailyContent.type, 'audio')
    assert.equal(openedAudio.data.dailyContent.id, audio.id)

    const openedSharedAlbum = await openAs('album-share-target', { type: 'album', contentId: albums[0].id })
    assert.equal(openedSharedAlbum.status, 201)
    assert.equal(openedSharedAlbum.data.dailyContent.type, 'album')
    assert.equal(openedSharedAlbum.data.dailyContent.id, albums[0].id)

    updateMiniProgramConfig('mp1', { dailyContentTypes: { imageEnabled: false, audioEnabled: false } })
    for (const type of ['album', 'audio']) {
      const disabled = await openAs(`${type}-disabled`, { type })
      assert.equal(disabled.status, 400)
      assert.match(disabled.data.message, /该类型手记暂不可用/)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
