const fs = require('fs')
const os = require('os')
const path = require('path')

if (!process.env.MINIAPP_DATA_DIR) {
  process.env.MINIAPP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'copybox-dev-'))
}
process.env.NODE_ENV = process.env.NODE_ENV || 'development'
process.env.PORT = process.env.PORT || '3000'

console.log(`acceptance data: ${process.env.MINIAPP_DATA_DIR}`)
require('../src/index')
