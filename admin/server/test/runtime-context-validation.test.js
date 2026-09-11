const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-runtime-context-'))
process.env.MINIAPP_DATA_DIR = dataDir

const { closeDatabase, getDatabase } = require('../src/lib/state-database')
const { recordAnalyticsEvent } = require('../src/modules/analytics/analytics.store')
const { getAccountSummary } = require('../src/modules/auth/account.store')
const { createMiniAppSession, getMiniAppSession } = require('../src/modules/auth/miniapp-session.store')
const { getActivityData, getHomeData } = require('../src/modules/content/content.service')
const { getContentSnapshot } = require('../src/modules/content/content.store')
const { createMessage } = require('../src/modules/messages/message.store')

test.after(() => {
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('缺失运行时上下文时不会回退到 mp1 或 pool-1', () => {
  assert.throws(() => recordAnalyticsEvent('page_view', {}, {}), /小程序 ID 不能为空/)
  assert.throws(() => getAccountSummary({}), /小程序 ID 不能为空/)
  assert.throws(() => createMiniAppSession({ accountId: 'account-1' }), /小程序 ID 不能为空/)
  assert.throws(() => getMiniAppSession('token'), /小程序 ID 不能为空/)
  assert.throws(() => createMessage({ accountId: 'account-1', content: '测试', visitorId: 'account-1' }), /当前小程序已停用或不存在/)
  assert.throws(() => getHomeData({ miniProgramId: 'unknown-program' }), /当前小程序已停用/)
  assert.throws(() => getContentSnapshot(), /内容池 ID 不能为空/)

  const db = getDatabase()
  for (const table of ['accounts', 'analytics_events', 'messages', 'miniapp_sessions']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0)
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM content_items WHERE pool_id = 'pool-1'").get().count, 0)
})

test('未知留言来源在小程序活动记录中只显示中性名称', () => {
  const now = new Date().toISOString()
  const item = {
    id: 'message-unknown-source',
    accountId: 'account-activity',
    content: '测试留言',
    miniProgramId: 'default-mini-program',
    visitorId: 'account-activity',
    status: 'saved',
    source: 'unknown-source',
    sourceId: 'unknown-content',
    createdAt: now,
    updatedAt: now,
  }
  getDatabase().prepare(`
    INSERT INTO messages (
      message_id, data_scope_id, account_id, mini_program_id, visitor_id, status,
      source, source_id, created_at, updated_at, item_json
    ) VALUES (?, 'shared:default-pool', ?, ?, ?, 'saved', ?, ?, ?, ?, ?)
  `).run(
    item.id, item.accountId, item.miniProgramId, item.visitorId,
    item.source, item.sourceId, now, now, JSON.stringify(item),
  )

  const activity = getActivityData({
    accountId: item.accountId,
    miniProgramId: item.miniProgramId,
    visitorId: item.visitorId,
  }, { section: 'messages' })
  assert.equal(activity.messages[0].type, 'text')
  assert.doesNotMatch(JSON.stringify(activity), /私密留言/)
})
