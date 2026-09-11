const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const test = require('node:test')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbox-groups-api-'))
process.env.MINIAPP_DATA_DIR = dataDir
process.env.MINIAPP_DATABASE_FILE = path.join(dataDir, 'secretbox.sqlite')

const { closeDatabase, getDatabase, readState, writeState } = require('../src/lib/state-database')
const settingsFile = path.join(dataDir, 'admin-settings.json')
writeState(settingsFile, {
  currentMiniProgramId: 'first',
  groups: ['原分组', '待删除分组'],
  contentPools: [{ id: 'pool-1', name: '内容池' }],
  miniPrograms: [
    { id: 'first', name: '第一个小程序', appId: 'wx1111111111111111', appSecret: 'a-private-secret', group: '原分组', config: { contentPoolId: 'pool-1' } },
    { id: 'second', name: '第二个小程序', appId: 'wx2222222222222222', group: '待删除分组', config: { contentPoolId: 'pool-1' } },
    { id: 'draft', name: '待接入小程序', appId: '', group: '', config: { contentPoolId: 'pool-1' } },
    { id: 'archived', name: '停用小程序', appId: 'wx3333333333333333', group: '原分组', status: 'archived', config: { contentPoolId: 'pool-1' } },
  ],
  operationLogs: [],
})

const { withCors } = require('../src/lib/cors')
const { createAppRouter } = require('../src/routes')
let server
let baseUrl
let cookie

async function request(pathname, body, authenticated = true) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(authenticated && cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: await response.json(), headers: response.headers }
}

function groupPayload(names, expectedGroups) {
  return { groups: names.map((name) => ({ original: expectedGroups.includes(name) ? name : '', name })), expectedGroups }
}

test.before(async () => {
  server = http.createServer(withCors(createAppRouter().handle))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const login = await request('/api/admin/login', { account: 'admin', password: '123456' }, false)
  assert.equal(login.status, 200)
  cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
})

test.after(async () => {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('分组保存需要登录，返回完整脱敏设置，并支持尚未填写 AppID 的实例', async () => {
  const payload = groupPayload(['原分组', '待删除分组', '新增分组'], ['原分组', '待删除分组'])
  assert.equal((await request('/api/admin/groups', payload, false)).status, 401)
  const saved = await request('/api/admin/groups', payload)
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.data.groups, ['原分组', '待删除分组', '新增分组'])
  assert.equal(saved.data.miniPrograms.length, 4)
  assert.equal(saved.data.miniPrograms.every((item) => Object.hasOwn(item, 'uploadKeyConfigured') && Object.hasOwn(item, 'lastUpload')), true)
  assert.equal(saved.data.miniPrograms.some((item) => Object.hasOwn(item, 'appSecret')), false)
  assert.equal(saved.data.miniPrograms.find((item) => item.id === 'first').appSecretConfigured, true)
  assert.equal(readState(settingsFile).miniPrograms.find((item) => item.id === 'first').appSecret, 'a-private-secret')
  const assigned = await request('/api/admin/miniprogram/update', { id: 'draft', miniProgram: { group: '新增分组' } })
  assert.equal(assigned.status, 200)
  assert.equal(assigned.data.miniPrograms.find((item) => item.id === 'draft').group, '新增分组')
})

test('改名和删除原子更新关联，保留弹窗打开后修改的备注、配置与分组归属', async () => {
  const expectedGroups = (await request('/api/admin/settings')).data.groups
  assert.equal((await request('/api/admin/miniprogram/update', { id: 'first', miniProgram: { remark: '另一页面刚更新的备注' } })).status, 200)
  assert.equal((await request('/api/admin/miniprogram/config', { id: 'first', config: { limits: { dailyContentLimit: 8 } } })).status, 200)
  assert.equal((await request('/api/admin/miniprogram/update', { id: 'draft', miniProgram: { group: '原分组' } })).status, 200)
  const before = (await request('/api/admin/settings')).data
  assert.equal(before.miniPrograms.find((item) => item.id === 'first').config.limits.dailyContentLimit, 8)
  const saved = await request('/api/admin/groups', {
    groups: [{ original: '原分组', name: '改名后分组' }, { original: '新增分组', name: '新增分组' }],
    expectedGroups,
  })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.data.groups, ['改名后分组', '新增分组'])
  assert.deepEqual(Object.fromEntries(saved.data.miniPrograms.map((item) => [item.id, item.group])), {
    first: '改名后分组', second: '', draft: '改名后分组', archived: '改名后分组',
  })
  for (const item of saved.data.miniPrograms) {
    const old = before.miniPrograms.find((entry) => entry.id === item.id)
    assert.deepEqual({ ...item, group: old.group }, old)
  }
  assert.equal(saved.data.currentMiniProgramId, before.currentMiniProgramId)
})

test('过期弹窗不能覆盖较新的分组设置，失败不改动数据', async () => {
  const before = readState(settingsFile)
  const stale = await request('/api/admin/groups', groupPayload(['丢失更新'], ['原分组', '待删除分组', '新增分组']))
  assert.equal(stale.status, 400)
  assert.match(stale.data.message, /分组已被修改/)
  assert.deepEqual(readState(settingsFile), before)
})

test('空名称、重复名称、超长名称、超额数量和伪造原分组全部拒绝', async () => {
  const expectedGroups = (await request('/api/admin/settings')).data.groups
  const before = readState(settingsFile)
  const invalidGroups = [
    [{ original: '', name: '   ' }],
    [{ original: '', name: '重复' }, { original: '', name: ' 重复 ' }],
    [{ original: '', name: '字'.repeat(31) }],
    Array.from({ length: 51 }, (_, index) => ({ original: '', name: `分组${index}` })),
    [{ original: '不存在', name: '新名字' }],
    [{ original: expectedGroups[0], name: '甲' }, { original: expectedGroups[0], name: '乙' }],
    [{ original: '', name: 123 }],
  ]
  for (const groups of invalidGroups) {
    const rejected = await request('/api/admin/groups', { groups, expectedGroups })
    assert.equal(rejected.status, 400, JSON.stringify(groups))
    assert.deepEqual(readState(settingsFile), before)
  }
  assert.equal((await request('/api/admin/groups', { groups: [] })).status, 400)
  for (const payload of [null, [], '分组']) {
    const malformed = await request('/api/admin/groups', payload)
    assert.equal(malformed.status, 400)
    assert.match(malformed.data.message, /请求格式无效/)
  }
})

test('各保存入口禁止悬空分组，普通设置入口不能绕过分组冲突校验', async () => {
  const before = readState(settingsFile)
  for (const group of ['不存在', null, 123]) {
    assert.equal((await request('/api/admin/miniprogram/update', { id: 'first', miniProgram: { group } })).status, 400)
    assert.equal((await request('/api/admin/miniprogram/create', { miniProgram: { id: 'unknown-group', name: '新实例', appId: 'wx4444444444444444', group } })).status, 400)
  }
  assert.equal((await request('/api/admin/settings', { settings: { groups: ['绕过修改'] } })).status, 400)
  assert.equal((await request('/api/admin/settings', { settings: { miniPrograms: before.miniPrograms.map((item) => ({ ...item, group: '不存在' })) } })).status, 400)
  assert.deepEqual(readState(settingsFile), before)
  const ungrouped = await request('/api/admin/miniprogram/update', { id: 'draft', miniProgram: { group: '' } })
  assert.equal(ungrouped.status, 200)
  assert.equal(ungrouped.data.miniPrograms.find((item) => item.id === 'draft').group, '')
})

test('数据库保存失败同时回滚分组定义、关联和内存缓存', async () => {
  const before = (await request('/api/admin/settings')).data
  const persistedBefore = readState(settingsFile)
  getDatabase().exec(`CREATE TRIGGER reject_group_test_write BEFORE UPDATE ON application_state
    WHEN NEW.state_key = 'admin-settings' BEGIN SELECT RAISE(ABORT, 'group test write failure'); END`)
  try {
    const failed = await request('/api/admin/groups', { groups: [], expectedGroups: before.groups })
    assert.equal(failed.status, 400)
    assert.deepEqual((await request('/api/admin/settings')).data, before)
    assert.deepEqual(readState(settingsFile), persistedBefore)
  } finally {
    getDatabase().exec('DROP TRIGGER reject_group_test_write')
  }
})

test('删除所有分组只解除归属，保留所有小程序和设置', async () => {
  const before = (await request('/api/admin/settings')).data
  const saved = await request('/api/admin/groups', { groups: [], expectedGroups: before.groups })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.data.groups, [])
  assert.equal(saved.data.miniPrograms.length, before.miniPrograms.length)
  assert.equal(saved.data.miniPrograms.every((item) => item.group === ''), true)
  assert.deepEqual(saved.data.miniPrograms.map((item) => item.config), before.miniPrograms.map((item) => item.config))
})

test('允许 50 个分组和 30 字 Unicode 名称，前后空格会规范化', async () => {
  const names = ['😀'.repeat(30), ...Array.from({ length: 49 }, (_, index) => `分组${index}`)]
  const payload = groupPayload(names, [])
  payload.groups[1].name = ` ${payload.groups[1].name} `
  const saved = await request('/api/admin/groups', payload)
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.data.groups, names)
})
