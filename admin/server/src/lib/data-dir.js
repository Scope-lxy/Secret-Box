const path = require('path')

function getDataDir(defaultDir) {
  const configured = String(process.env.MINIAPP_DATA_DIR || '').trim()
  return configured ? path.resolve(configured) : defaultDir
}

module.exports = {
  getDataDir,
}
