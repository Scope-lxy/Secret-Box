const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const adminSource = path.resolve(__dirname, '../admin/src')
const markup = fs.readFileSync(path.join(adminSource, 'index.html'), 'utf8')
const main = fs.readFileSync(path.join(adminSource, 'main.js'), 'utf8')

// 模式切换预设（applyModePreset）是后台一键填表行为，真正的保存走配置接口。
// 提审免广告次数 3 为用户定稿（2026-09-08，由规则中的 2 调整而来），防止将来漂移。
const AUDIT_FREE_COUNT = 3

function presetBody(mode) {
  const start = main.indexOf(`function applyModePreset(mode) {`)
  const end = main.indexOf('function collectModeConfig(', start)
  assert.ok(start > 0 && end > start, 'applyModePreset 必须存在于 main.js')
  const body = main.slice(start, end)
  assert.ok(body.includes(`applyModePreset`), '函数体不完整')
  return mode ? body : body
}

test('审核模式一键预设：激励广告免广告 3 次、插屏关闭、首页隐藏、留言关闭、今日手记上限 0', () => {
  const body = presetBody('audit')
  assert.match(body, new RegExp(`freeCount\\.value = isAudit \\? '${AUDIT_FREE_COUNT}' : '0'`))
  assert.match(body, /messagesEnabled\.value = isAudit \? 'disabled' : 'enabled'/)
  assert.match(body, /enabled\.checked = !isAudit/)
  assert.match(body, /homeVisible\.checked = !isAudit/)
  assert.match(body, /dailyContentLimit\.value = isAudit \? '0' : '5'/)
})

test('正常模式一键预设：免广告次数回到 0 且所有插屏与首页恢复', () => {
  const body = presetBody('default')
  // 非审核分支：freeCount 归 0、非审核时全部启用
  assert.match(body, /'0'/)
  assert.match(body, /if \(!isAudit && enabled\) enabled\.checked = true/)
})

test('模式预设只改允许的字段，不得触碰音频、图册、Tab 标签等配置', () => {
  const start = main.indexOf(`function applyModePreset(mode) {`)
  const end = main.indexOf('function collectModeConfig(', start)
  const body = main.slice(start, end)
  // 项目规则：模式切换仅切换首页可见性、留言状态、激励 freeCount、插屏开关与今日手记上限
  assert.doesNotMatch(body, /audio|album|letters.*visible|articles.*visible|tabLabel|adUnitId/)
})

test('后台文案编辑界面预填后台默认文案并声明「留空=使用内置默认文案」', () => {
  const expectedDefaults = {
    dailyContentPromptTexts: '想说的，都悄悄放这里了\n打开前，猜猜里面是什么',
    checkinBeforeTexts: '今天也等到你了\n每天都来打卡吧',
    checkinAfterTexts: '今日已点亮，明天再来打卡吧！\n感谢你的支持，明天我等你哦！',
  }
  for (const field of ['dailyContentPromptTexts', 'checkinBeforeTexts', 'checkinAfterTexts']) {
    const pattern = new RegExp(`data-system-field="${field}"[^>]*>([\\s\\S]*?)</textarea>`)
    const match = markup.match(pattern)
    assert.ok(match, `缺少 ${field} 编辑框`)
    assert.equal(match[1].trim(), expectedDefaults[field], `${field} 应预填后台默认文案（与客户端定稿一致）`)
    const hintBlock = markup.slice(Math.max(0, markup.indexOf(`data-system-field="${field}"`) - 400), markup.indexOf(`data-system-field="${field}"`))
    assert.match(hintBlock, /留空时使用小程序内置默认文案/)
  }
})

test('collectSystemSettings 允许清空打开前引导文案（空列表=显式清空，回落客户端默认包）', () => {
  // collectSystemSettings 是浏览器脚本无法直接 require：对校验条件做源码级守卫，
  // 确保不再把「空列表」判为非法（服务端 routes.js 已允许空数组）
  const start = main.indexOf('function collectSystemSettings() {')
  const end = main.indexOf('const settings = {', start)
  const body = main.slice(start, end)
  assert.ok(start > 0 && end > start, 'collectSystemSettings 必须存在于 main.js')
  assert.match(body, /dailyContentPromptTexts\.find/)
  assert.doesNotMatch(body, /!\s*dailyContentPromptTexts\.length/)
})
