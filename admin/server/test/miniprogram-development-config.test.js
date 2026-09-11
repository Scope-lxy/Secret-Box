const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '../../..')
const miniProgramRoot = path.join(projectRoot, 'miniprogram')

test('development project can use the local API without changing release data sources', () => {
  const projectConfig = JSON.parse(fs.readFileSync(path.join(miniProgramRoot, 'project.config.json'), 'utf8'))
  const privateConfigPath = path.join(miniProgramRoot, 'project.private.config.json')
  const envSource = fs.readFileSync(path.join(miniProgramRoot, 'config/env.js'), 'utf8')

  assert.equal(projectConfig.setting?.urlCheck, false)
  if (fs.existsSync(privateConfigPath)) {
    const privateConfig = JSON.parse(fs.readFileSync(privateConfigPath, 'utf8'))
    assert.equal(privateConfig.setting?.urlCheck, false)
  }
  assert.match(envSource, /apiBaseUrl: 'http:\/\/127\.0\.0\.1:3000\/api'/)
  assert.match(envSource, /if \(!isDevelopmentBuild\(\)\) return 'prod'/)
})
