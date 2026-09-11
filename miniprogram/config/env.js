const activeEnv = 'prod'

const environments = {
  local: {
    name: 'local',
    apiBaseUrl: 'http://127.0.0.1:3000/api',
  },
  prod: {
    name: 'prod',
    apiBaseUrl: 'https://secretbox.scopeview.cn/api',
  },
}

function getEnvName() {
  if (!isDevelopmentBuild()) return 'prod'
  return wx.getStorageSync('apiEnv') || activeEnv
}

function getMiniProgramAppId() {
  try {
    return String(wx.getAccountInfoSync()?.miniProgram?.appId || '').trim()
  } catch (error) {
    return ''
  }
}

function getEnvConfig() {
  return { ...(environments[getEnvName()] || environments.local), appId: getMiniProgramAppId() }
}

function switchEnv(name) {
  if (!isDevelopmentBuild() || !['local', 'prod'].includes(name)) return false
  wx.setStorageSync('apiEnv', name)
  return true
}

function isDevelopmentBuild() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'develop'
  } catch (error) {
    return false
  }
}

function getDevelopmentDataSources() {
  if (!isDevelopmentBuild()) return []
  return [
    { name: 'local', label: '本地服务器' },
    { name: 'prod', label: '正式服务器' },
  ]
}

module.exports = {
  activeEnv,
  environments,
  getDevelopmentDataSources,
  getEnvConfig,
  getMiniProgramAppId,
  isDevelopmentBuild,
  switchEnv,
}
