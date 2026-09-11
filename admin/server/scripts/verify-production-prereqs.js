const fs = require('fs')
const path = require('path')

const configuredMiniRoot = String(process.env.MINIPROGRAM_SOURCE_DIR || '').trim()
const miniRoot = configuredMiniRoot
  ? path.resolve(configuredMiniRoot)
  : path.resolve(__dirname, '../../../miniprogram')
const projectConfigPath = path.join(miniRoot, 'project.config.json')
const miniEnvPath = path.join(miniRoot, 'config/env.js')
const projectConfig = fs.existsSync(projectConfigPath)
  ? JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'))
  : null
const miniEnvSource = fs.existsSync(miniEnvPath)
  ? fs.readFileSync(miniEnvPath, 'utf8')
  : ''
const { getInternalAdminSettings } = require('../src/modules/admin/admin-settings.store')
const { getMiniProgramUploadReadiness } = require('../src/modules/release/miniapp-upload.service')
const expectedAppId = String(projectConfig?.appid || '').trim()
const issues = []

if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
  issues.push('NODE_ENV 必须显式设置为 production，禁止以开发模式执行生产预检')
}

const settings = getInternalAdminSettings()
const matchedMiniProgram = settings.miniPrograms.find((item) => item.appId === expectedAppId && item.status !== 'archived')
const configuredAppId = String(matchedMiniProgram?.appId || '').trim()
const configuredAppSecret = String(matchedMiniProgram?.appSecret || '').trim()
if (!expectedAppId) {
  issues.push('小程序工程缺少 AppID')
} else if (!matchedMiniProgram) {
  issues.push(`Admin 未接入小程序工程的 AppID：${expectedAppId}`)
} else {
  if (!configuredAppSecret) issues.push('Admin 中该 AppID 缺少 AppSecret')
  if (configuredAppId && !/^wx[a-zA-Z0-9]{16}$/.test(configuredAppId)) {
    issues.push('Admin 中该小程序 AppID 格式无效')
  }
  const uploadReadiness = getMiniProgramUploadReadiness(configuredAppId)
  if (!uploadReadiness.ok) issues.push(`小程序发布通道未就绪：${uploadReadiness.message}`)
}

const sourceApiUrlMatch = miniEnvSource.match(/prod:\s*\{[\s\S]*?apiBaseUrl:\s*'([^']+)'/)
const configuredApiUrl = sourceApiUrlMatch
  ? sourceApiUrlMatch[1]
  : String(process.env.PUBLIC_MINIAPP_API_BASE_URL || '').trim()
if (!configuredApiUrl || !/^https:\/\//.test(configuredApiUrl) || /example\.com/i.test(configuredApiUrl)) {
  issues.push('生产 API 地址必须配置为真实 HTTPS 域名')
}
if (miniEnvSource && /\bmock\b/i.test(miniEnvSource)) {
  issues.push('小程序生产配置不能包含 Mock 数据源')
}

if (issues.length) {
  console.error(`PRODUCTION_PREREQUISITES_FAILED\n${issues.join('\n')}`)
  process.exit(1)
}

console.log(`PRODUCTION_PREREQUISITES_OK appId=${configuredAppId}`)
