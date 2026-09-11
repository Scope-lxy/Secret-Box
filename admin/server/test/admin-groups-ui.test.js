const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { JSDOM } = require('jsdom')

const adminDir = path.resolve(__dirname, '../admin/src')
const markup = fs.readFileSync(path.join(adminDir, 'index.html'), 'utf8')
const script = fs.readFileSync(path.join(adminDir, 'main.js'), 'utf8')

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function settings(groups = [], group = '') {
  return {
    groups,
    currentMiniProgramId: 'mp-a',
    miniPrograms: [{ id: 'mp-a', name: '小程序 A', appId: '', group, status: 'active', config: {} }],
    contentPools: [],
    operationLogs: [],
    security: {},
    storage: {},
  }
}

function overview(groups = [], selectedGroup = '', value = '0') {
  return {
    groups,
    selectedGroup,
    dashboardCards: [{ label: '今日访问人次', value }],
    editableSections: [{ label: '今日访问人次', value: '当前' }],
    currentVisitTrend: [],
    recentOperationLogs: [],
  }
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await new Promise(setImmediate)
}

async function until(predicate, message) {
  for (let index = 0; index < 30; index += 1) {
    if (predicate()) return
    await new Promise(setImmediate)
  }
  assert.ok(predicate(), message)
}

async function createAdmin(t, initial = settings(), options = {}) {
  const dom = new JSDOM(markup, { url: 'http://localhost/admin/', runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const { window } = dom
  const requests = []
  const pending = new Map()
  let serverSettings = structuredClone(initial)
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.requestAnimationFrame = () => 0
  window.scrollTo = () => {}
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} })
  window.fetch = async (url, requestOptions = {}) => {
    const parsed = new URL(url)
    const pathname = `${parsed.pathname}${parsed.search}`
    const request = { pathname, method: requestOptions.method || 'GET', body: requestOptions.body ? JSON.parse(requestOptions.body) : undefined }
    requests.push(request)
    const key = `${request.method} ${pathname}`
    const queue = pending.get(key)
    let result
    if (queue?.length) result = await queue.shift().promise
    else if (parsed.pathname === '/api/admin/settings') result = serverSettings
    else if (parsed.pathname === '/api/admin/bootstrap') result = overview(serverSettings.groups, parsed.searchParams.get('groupId') || '')
    else if (parsed.pathname === '/api/admin/preflight' && options.preflight) result = await options.preflight.promise
    else if (parsed.pathname === '/api/admin/session') result = { account: 'admin', session: {} }
    else if (['/api/admin/images', '/api/admin/messages', '/api/admin/accounts'].includes(parsed.pathname)) result = { items: [], pagination: {}, policy: {} }
    else if (['/api/health', '/api/admin/preflight', '/api/admin/content'].includes(parsed.pathname)) result = {}
    else throw new Error(`Unexpected request: ${key}`)
    const status = result?.httpStatus || 200
    const data = result?.data ?? result
    return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) }
  }
  window.eval(script)
  const query = (selector) => window.document.querySelector(selector)
  await until(() => query('#miniProgramBody')?.textContent.includes('小程序 A'), 'settings should render during bootstrap')
  await settle()
  return {
    window,
    query,
    requests,
    setSettings(data) { serverSettings = structuredClone(data) },
    queue(method, pathname) {
      const response = deferred()
      const key = `${method} ${pathname}`
      if (!pending.has(key)) pending.set(key, [])
      pending.get(key).push(response)
      return response
    },
    options(selector) { return [...query(selector).options].map((option) => option.value) },
    change(selector, value) {
      const node = query(selector)
      node.value = value
      node.dispatchEvent(new window.Event('change', { bubbles: true }))
    },
  }
}

test('new group is immediately selectable after save, even while the statistics response is pending', async (t) => {
  const app = await createAdmin(t)
  const save = app.queue('POST', '/api/admin/groups')
  const refresh = app.queue('GET', '/api/admin/bootstrap')
  const beforeSettingsReads = app.requests.filter((request) => request.pathname === '/api/admin/settings').length
  app.query('#manageGroupsBtn').click()
  app.query('#groupManagerNewName').value = '新建分组'
  app.query('#groupManagerSave').click()
  app.query('#groupManagerSave').click()
  assert.equal(app.query('#groupManagerSave').disabled, true)
  assert.equal(app.requests.filter((request) => request.pathname === '/api/admin/groups').length, 1)
  assert.deepEqual(app.requests.find((request) => request.pathname === '/api/admin/groups').body, {
    groups: [{ original: '', name: '新建分组' }], expectedGroups: [],
  })

  const saved = settings(['新建分组'])
  app.setSettings(saved)
  save.resolve(saved)
  await until(() => app.query('#groupManagerModal').classList.contains('hidden'), 'successful save should close the dialog')
  assert.deepEqual(app.options('#dashboardGroupFilter'), ['', '新建分组'])
  assert.equal(app.query('#dashboardGroupFilter').value, '')
  assert.equal(app.query('#dashboardGroupFilter').disabled, false)
  assert.equal(app.requests.filter((request) => request.pathname === '/api/admin/settings').length, beforeSettingsReads)

  app.query('[data-mp-group="mp-a"]').click()
  assert.deepEqual(app.options('#groupAssignSelect'), ['', '新建分组'])
  assert.equal(app.query('#groupAssignSelect').disabled, false)
  const assign = app.queue('POST', '/api/admin/miniprogram/update')
  app.change('#groupAssignSelect', '新建分组')
  app.query('#groupAssignSave').click()
  app.query('#groupAssignSave').click()
  const assigned = settings(['新建分组'], '新建分组')
  app.setSettings(assigned)
  assign.resolve(assigned)
  await until(() => app.query('#groupAssignModal').classList.contains('hidden'), 'assignment should close after success')
  assert.match(app.query('[data-label="分组"]').textContent, /新建分组/)
  assert.equal(app.requests.filter((request) => request.pathname === '/api/admin/miniprogram/update').length, 1)
  refresh.resolve(overview([]))
  await settle()
  assert.deepEqual(app.options('#dashboardGroupFilter'), ['', '新建分组'])
})

test('late settings and overview reads cannot restore the group catalog from before a save', async (t) => {
  const app = await createAdmin(t, settings(['原分组']))
  const oldSettings = app.queue('GET', '/api/admin/settings')
  const oldOverview = app.queue('GET', '/api/admin/bootstrap')
  const settingsRead = app.window.loadAdminSettings()
  const overviewRead = app.window.refreshAdminOverview({ reloadPreflight: false })
  const save = app.queue('POST', '/api/admin/groups')
  const newOverview = app.queue('GET', '/api/admin/bootstrap')
  app.query('#manageGroupsBtn').click()
  app.query('#groupManagerNewName').value = '新分组'
  app.query('#groupManagerSave').click()
  const saved = settings(['原分组', '新分组'])
  app.setSettings(saved)
  save.resolve(saved)
  await until(() => app.options('#dashboardGroupFilter').includes('新分组'), 'saved catalog should update immediately')
  oldSettings.resolve(settings(['原分组']))
  oldOverview.resolve(overview(['原分组']))
  await Promise.all([settingsRead, overviewRead])
  assert.deepEqual(app.options('#dashboardGroupFilter'), ['', '原分组', '新分组'])
  app.query('[data-mp-group="mp-a"]').click()
  assert.deepEqual(app.options('#groupAssignSelect'), ['', '原分组', '新分组'])
  newOverview.resolve(overview(saved.groups))
  await settle()
})

test('rapid filter changes keep the latest group and data when responses arrive in reverse order', async (t) => {
  const app = await createAdmin(t, settings(['A', 'B']))
  const first = app.queue('GET', '/api/admin/bootstrap?groupId=A')
  const last = app.queue('GET', '/api/admin/bootstrap?groupId=B')
  const optionB = app.query('#dashboardGroupFilter').options[2]
  app.change('#dashboardGroupFilter', 'A')
  app.change('#dashboardGroupFilter', 'B')
  last.resolve(overview(['A', 'B'], 'B', '22'))
  await until(() => app.query('#dashboardCards').textContent.includes('22'), 'latest group metrics should render')
  first.resolve(overview(['A', 'B'], 'A', '11'))
  await settle()
  assert.equal(app.query('#dashboardGroupFilter').value, 'B')
  assert.match(app.query('#dashboardCards').textContent, /22/)
  assert.doesNotMatch(app.query('#dashboardCards').textContent, /11/)
  assert.equal(app.query('#dashboardGroupFilter').options[2], optionB, 'unchanged options should not be rebuilt')
})

test('failed group refresh never presents the previous group numbers under the new selection', async (t) => {
  const app = await createAdmin(t, settings(['A', 'B']))
  const first = app.queue('GET', '/api/admin/bootstrap?groupId=A')
  app.change('#dashboardGroupFilter', 'A')
  first.resolve(overview(['A', 'B'], 'A', '12345'))
  await settle()
  assert.match(app.query('#dashboardCards').textContent, /12345/)
  const failed = app.queue('GET', '/api/admin/bootstrap?groupId=B')
  app.change('#dashboardGroupFilter', 'B')
  failed.resolve({ httpStatus: 500, data: { message: '临时故障' } })
  await settle()
  assert.equal(app.query('#dashboardGroupFilter').value, 'B')
  assert.equal(app.query('#dashboardGroupFilter').disabled, false)
  assert.doesNotMatch(app.query('#dashboardCards').textContent, /12345/)
  assert.equal(app.query('#dashboardCards').querySelectorAll('.stat-value').length, 8)
  assert.equal([...app.query('#dashboardCards').querySelectorAll('.stat-value')].every((node) => node.textContent === '--'), true)
  assert.match(app.query('#dashboardCards .stat-card').title, /未能刷新/)
  app.change('#dashboardGroupFilter', 'A')
  await settle()
  assert.doesNotMatch(app.query('#dashboardCards').textContent, /--/)
})

test('rename preserves the selected group and deleting another group updates choices immediately', async (t) => {
  const app = await createAdmin(t, settings(['A', 'B'], 'A'))
  app.change('#dashboardGroupFilter', 'A')
  await settle()
  app.query('#manageGroupsBtn').click()
  app.query('[data-group-original="A"]').value = '改名 A'
  app.query('[data-group-original="B"]').closest('.group-manager-row').querySelector('button').click()
  const save = app.queue('POST', '/api/admin/groups')
  const refresh = app.queue('GET', `/api/admin/bootstrap?groupId=${encodeURIComponent('改名 A')}`)
  app.query('#groupManagerSave').click()
  const saved = settings(['改名 A'], '改名 A')
  app.setSettings(saved)
  save.resolve(saved)
  await until(() => app.query('#groupManagerModal').classList.contains('hidden'), 'save should close dialog')
  assert.deepEqual(app.options('#dashboardGroupFilter'), ['', '改名 A'])
  assert.equal(app.query('#dashboardGroupFilter').value, '改名 A')
  assert.match(app.query('[data-label="分组"]').textContent, /改名 A/)
  assert.deepEqual(app.requests.find((request) => request.pathname === '/api/admin/groups').body, {
    groups: [{ original: 'A', name: '改名 A' }], expectedGroups: ['A', 'B'],
  })
  refresh.resolve(overview(['改名 A'], '改名 A'))
  await settle()
})

test('cancel discards additions, renames and removals without sending a mutation', async (t) => {
  const app = await createAdmin(t, settings(['A', 'B']))
  app.query('#manageGroupsBtn').click()
  app.query('[data-group-original="A"]').value = '改名'
  app.query('[data-group-original="B"]').closest('.group-manager-row').querySelector('button').click()
  app.query('#groupManagerNewName').value = '新增'
  app.query('#groupManagerAdd').click()
  app.query('#groupManagerCancel').click()
  app.query('#manageGroupsBtn').click()
  assert.deepEqual([...app.window.document.querySelectorAll('[data-group-index]')].map((input) => input.value), ['A', 'B'])
  assert.deepEqual(app.options('#dashboardGroupFilter'), ['', 'A', 'B'])
  assert.equal(app.requests.some((request) => request.method === 'POST'), false)
})

test('deleting the selected group returns the filter and assigned mini program to ungrouped state', async (t) => {
  const app = await createAdmin(t, settings(['A'], 'A'))
  app.change('#dashboardGroupFilter', 'A')
  await settle()
  app.query('#manageGroupsBtn').click()
  app.query('[data-group-remove]').click()
  const save = app.queue('POST', '/api/admin/groups')
  const refresh = app.queue('GET', '/api/admin/bootstrap')
  app.query('#groupManagerSave').click()
  const saved = settings()
  app.setSettings(saved)
  save.resolve(saved)
  await until(() => app.query('#groupManagerModal').classList.contains('hidden'), 'delete should close dialog after save')
  assert.deepEqual(app.options('#dashboardGroupFilter'), [''])
  assert.equal(app.query('#dashboardGroupFilter').value, '')
  assert.match(app.query('[data-label="分组"]').textContent, /未分组/)
  app.query('[data-mp-group="mp-a"]').click()
  assert.deepEqual(app.options('#groupAssignSelect'), [''])
  refresh.resolve(overview())
  await settle()
})

test('validation and server failures are visible, retain the draft, and allow retry', async (t) => {
  const app = await createAdmin(t, settings(['A']))
  app.query('#manageGroupsBtn').click()
  app.query('[data-group-original="A"]').value = ''
  app.query('#groupManagerSave').click()
  assert.match(app.query('#groupManagerStatus').textContent, /不能为空/)
  assert.equal(app.requests.some((request) => request.method === 'POST'), false)
  app.query('[data-group-original="A"]').value = 'A'
  app.query('#groupManagerNewName').value = 'A'
  app.query('#groupManagerSave').click()
  assert.match(app.query('#groupManagerStatus').textContent, /不能重复/)
  assert.equal(app.requests.some((request) => request.method === 'POST'), false)
  app.query('#groupManagerNewName').value = 'B'
  const failure = app.queue('POST', '/api/admin/groups')
  app.query('#groupManagerSave').click()
  app.query('#groupManagerModal .modal-backdrop').click()
  assert.equal(app.query('#groupManagerModal').classList.contains('hidden'), false)
  failure.resolve({ httpStatus: 409, data: { message: '分组已发生变化，请重新打开设置分组' } })
  await until(() => !app.query('#groupManagerSave').disabled, 'failed request should re-enable save')
  assert.match(app.query('#groupManagerStatus').textContent, /分组已发生变化/)
  assert.equal(app.query('#groupManagerNewName').value, 'B')
  assert.equal(app.query('#groupManagerModal').classList.contains('hidden'), false)
  const retry = app.queue('POST', '/api/admin/groups')
  app.query('#groupManagerSave').click()
  const saved = settings(['A', 'B'])
  app.setSettings(saved)
  retry.resolve(saved)
  await until(() => app.query('#groupManagerModal').classList.contains('hidden'), 'retry should be usable')
})

test('adding several draft groups preserves their new identities and assignment failures preserve selection', async (t) => {
  const app = await createAdmin(t, settings(['A']))
  app.query('#manageGroupsBtn').click()
  app.query('#groupManagerNewName').value = 'B'
  app.query('#groupManagerAdd').click()
  app.query('#groupManagerNewName').value = 'C'
  app.query('#groupManagerAdd').click()
  const save = app.queue('POST', '/api/admin/groups')
  app.query('#groupManagerSave').click()
  assert.deepEqual(app.requests.find((request) => request.pathname === '/api/admin/groups').body.groups, [
    { original: 'A', name: 'A' }, { original: '', name: 'B' }, { original: '', name: 'C' },
  ])
  const saved = settings(['A', 'B', 'C'])
  app.setSettings(saved)
  save.resolve(saved)
  await until(() => app.query('#groupManagerModal').classList.contains('hidden'), 'save should close dialog')
  app.query('[data-mp-group="mp-a"]').click()
  app.change('#groupAssignSelect', 'B')
  const assign = app.queue('POST', '/api/admin/miniprogram/update')
  app.query('#groupAssignSave').click()
  assign.resolve({ httpStatus: 400, data: { message: '分组已不存在，请重新选择' } })
  await until(() => !app.query('#groupAssignSave').disabled, 'failed assignment should re-enable controls')
  assert.equal(app.query('#groupAssignSelect').value, 'B')
  assert.equal(app.query('#groupAssignModal').classList.contains('hidden'), false)
  assert.match(app.query('#groupAssignStatus').textContent, /分组已不存在/)
  assert.match(app.query('[data-label="分组"]').textContent, /未分组/)
})

test('slow service preflight does not delay loading group settings or enabling the group controls', async (t) => {
  const preflight = deferred()
  const app = await createAdmin(t, settings(['可立即选择']), { preflight })
  assert.deepEqual(app.options('#dashboardGroupFilter'), ['', '可立即选择'])
  app.query('[data-mp-group="mp-a"]').click()
  assert.deepEqual(app.options('#groupAssignSelect'), ['', '可立即选择'])
  assert.equal(app.query('#groupAssignSelect').disabled, false)
  preflight.resolve({ checks: [] })
  await settle()
})

test('after a stale-catalog conflict, reopening the group dialog uses freshly loaded names', async (t) => {
  const app = await createAdmin(t, settings(['A']))
  app.query('#manageGroupsBtn').click()
  app.query('#groupManagerNewName').value = '我的新组'
  const save = app.queue('POST', '/api/admin/groups')
  app.query('#groupManagerSave').click()
  app.setSettings(settings(['A', '另一页面的新组']))
  save.resolve({ httpStatus: 400, data: { message: '分组已被修改，请关闭弹窗后重新打开设置分组' } })
  await until(() => !app.query('#groupManagerSave').disabled, 'conflict should refresh the catalog and release controls')
  assert.equal(app.query('#groupManagerNewName').value, '我的新组', 'unsaved draft must remain until the user closes it')
  assert.deepEqual(app.options('#dashboardGroupFilter'), ['', 'A', '另一页面的新组'])
  app.query('#groupManagerCancel').click()
  app.query('#manageGroupsBtn').click()
  assert.deepEqual([...app.window.document.querySelectorAll('[data-group-index]')].map((input) => input.value), ['A', '另一页面的新组'])
})
