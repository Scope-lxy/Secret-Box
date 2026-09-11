const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const test = require('node:test')
const { createSchemaV6, migrateSchemaV5ToV6 } = require('../src/lib/schema-v6-contract')

function makeV5Fixture() {
  const database = new Database(':memory:')
  createSchemaV6(database)
  database.exec(`
    DROP TABLE article_unlocks;
    DROP TABLE article_import_jobs;
    DELETE FROM schema_migrations;
    INSERT INTO schema_migrations (version, applied_at) VALUES (5, '2026-08-01T00:00:00.000Z');
  `)
  return database
}

test('v5 to v6 migration deletes only diary content and diary-linked behavior', () => {
  const database = makeV5Fixture()
  const now = '2026-08-01T00:00:00.000Z'
  database.prepare('INSERT INTO content_items VALUES (?, ?, ?, ?, ?)').run(
    'pool-1', 'diaryEntries', 'diary-1', 0,
    JSON.stringify({ id: 'diary-1', content: '旧日记', images: [] }),
  )
  database.prepare('INSERT INTO content_items VALUES (?, ?, ?, ?, ?)').run(
    'pool-1', 'letters', 'letter-1', 0,
    JSON.stringify({ id: 'letter-1', content: '保留心笺', likeCount: 0, favoriteCount: 0 }),
  )
  database.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'message-diary', 'scope-1', '', 'mp-1', 'visitor-1', 'saved', 'diary', 'diary-1', now, now,
    JSON.stringify({ id: 'message-diary', source: 'diary', sourceId: 'diary-1' }),
  )
  database.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'message-letter', 'scope-1', '', 'mp-1', 'visitor-1', 'saved', 'letters', 'letter-1', now, now,
    JSON.stringify({ id: 'message-letter', source: 'letters', sourceId: 'letter-1' }),
  )
  database.prepare('INSERT INTO reactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'reaction-diary', 'scope-1', 'mp-1', 'visitor-1', 'diary', 'diary-1', 1, 0, now, '', now,
  )
  database.prepare('INSERT INTO opened_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'opened-diary', 'event-diary', 'scope-1', 'mp-1', 'visitor-1', 'diary', 'diary-1', now, '{}',
  )
  database.prepare('INSERT INTO analytics_events VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'event-diary', 'interaction_like', 'mp-1', 'visitor-1', now, '2026-08-01', JSON.stringify({ source: 'diary' }),
  )
  database.prepare('INSERT INTO application_state VALUES (?, ?, ?)').run(
    'admin-settings',
    JSON.stringify({
      miniPrograms: [{
        id: 'mp-1',
        config: {
          ads: {
            diaryNative: { enabled: true },
            diaryInterstitial: { enabled: false },
          homeDailyContentRewarded: { adUnitId: 'adunit-existing', confirmPopupEnabled: true, allowOnUnavailable: true },
        },
          articleDisplay: {
            layout: 'stacked',
            previewPreset: 'custom',
            previewHeightRpx: 880,
            expandButtonText: '展开全文',
          },
          system: {
            diaryHero: '旧标题',
            tabs: {
              home: { label: '首页', visible: true },
              letters: { label: '心笺', visible: true },
              diary: { label: '日记', visible: false },
              mine: { label: '我的', visible: true },
            },
          },
        },
      }, {
        id: 'mp-2',
        config: {
          articleDisplay: {
            previewPreset: 'latest',
          },
        },
      }],
    }),
    now,
  )

  const result = migrateSchemaV5ToV6(database)

  assert.equal(result.schemaVersion, 6)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM content_items WHERE content_type = 'diaryEntries'").get().count, 0)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM content_items WHERE content_type = 'letters'").get().count, 1)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE source = 'diary'").get().count, 0)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE source = 'letters'").get().count, 1)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM reactions WHERE source = 'diary'").get().count, 0)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM opened_records WHERE source = 'diary'").get().count, 0)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM analytics_events").get().count, 0)
  const settings = JSON.parse(database.prepare("SELECT value_json FROM application_state WHERE state_key = 'admin-settings'").get().value_json)
  const config = settings.miniPrograms[0].config
  assert.equal(config.system.articlesHero, '旧标题')
  assert.equal(config.system.tabs.articles.label, '文章')
  assert.equal(config.system.tabs.articles.visible, true)
  assert.deepEqual(Object.keys(config.system.tabs), ['home', 'articles', 'letters', 'mine'])
  assert.deepEqual(config.articleDisplay, {
    layout: 'stacked',
    previewPreset: 'early',
    expandButtonText: '展开全文',
    hideFullArticle: true,
  })
  assert.equal(settings.miniPrograms[1].config.articleDisplay.previewPreset, 'latest')
  assert.equal(config.ads.articleExpandRewarded.adUnitId, 'adunit-existing')
  assert.equal(config.ads.articleExpandRewarded.freeCount, 0)
  assert.equal('diaryHero' in config.system, false)
  assert.equal('diary' in config.system.tabs, false)
  assert.equal('diaryNative' in config.ads, false)
  assert.equal('diaryInterstitial' in config.ads, false)
  assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'article_unlocks'").get())
  database.close()
})
