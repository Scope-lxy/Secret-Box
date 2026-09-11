const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('phone quick-login prompts use neutral review-safe copy', () => {
  ;['pages/home/home.wxml', 'pages/article/article.wxml', 'pages/letters/letters.wxml'].forEach((relativePath) => {
    const source = read(relativePath)
    assert.match(source, /<text class="phone-sync-prompt-title">手机号快捷登录<\/text>/)
    assert.match(source, /完成手机号快捷登录后，可在多个小程序中同步你的记录。/)
    assert.doesNotMatch(source, /授权微信手机号/)
    assert.match(source, /open-type="getPhoneNumber"/)
  })
})

test('profile authorization entry does not imply an official WeChat action', () => {
  const template = read('pages/profile/profile.wxml')
  const page = read('pages/profile/profile.js')

  assert.match(template, /\{\{form\.phone \? '重新获取' : '快速授权'\}\}/)
  assert.match(template, /placeholder="填写昵称"/)
  assert.doesNotMatch(`${template}\n${page}`, /微信获取|微信资料|微信昵称|微信用户|未授权微信手机号/)
  assert.match(page, /手机号快捷登录未完成/)
  assert.match(template, /open-type="getPhoneNumber"/)
})

test('message phone-sync flows use the same neutral cancellation feedback', () => {
  ;['pages/home/home.js', 'pages/article/article.js', 'pages/letters/letters.js'].forEach((relativePath) => {
    const source = read(relativePath)
    assert.match(source, /手机号快捷登录未完成/)
    assert.doesNotMatch(source, /未授权微信手机号/)
  })
})
