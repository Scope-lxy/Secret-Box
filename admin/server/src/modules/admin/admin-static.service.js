const fs = require('fs/promises')
const path = require('path')

const adminRoot = path.resolve(__dirname, '../../../admin/src')
const shareCoverRoot = path.resolve(__dirname, '../../../admin/share-covers')
const shareCoverFiles = {
  'share-1.jpg': 'image/jpeg',
  'share-2.jpg': 'image/jpeg',
  'share-3.jpg': 'image/jpeg',
}
const assets = {
  '/admin/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/admin/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/admin/article-manager.js': { file: 'article-manager.js', type: 'text/javascript; charset=utf-8' },
  '/admin/folder-import-files.js': { file: 'folder-import-files.js', type: 'text/javascript; charset=utf-8' },
  '/admin/article-document-files.js': { file: 'article-document-files.js', type: 'text/javascript; charset=utf-8' },
  '/admin/article-document-import.js': { file: 'article-document-import.js', type: 'text/javascript; charset=utf-8' },
  '/admin/import.js': { file: 'import.js', type: 'text/javascript; charset=utf-8' },
  '/admin/main.js': { file: 'main.js', type: 'text/javascript; charset=utf-8' },
  '/admin/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/admin/shell.js': { file: 'shell.js', type: 'text/javascript; charset=utf-8' },
  ...Object.fromEntries(Object.entries(shareCoverFiles).map(([file, type]) => [
    `/admin/share-covers/${file}`,
    { file, root: shareCoverRoot, type },
  ])),
}

function getAdminAssetCacheControl(urlPath) {
  return urlPath.startsWith('/admin/share-covers/')
    ? 'public, max-age=86400'
    : 'no-store'
}

function redirectToAdminRoot(res) {
  res.writeHead(302, { location: '/admin/' })
  res.end()
}

async function serveAdminAsset(req, res, url) {
  const asset = assets[url.pathname]
  if (!asset) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  const filePath = path.join(asset.root || adminRoot, asset.file)
  const body = await fs.readFile(filePath)
  res.writeHead(200, {
    'cache-control': getAdminAssetCacheControl(url.pathname),
    'content-type': asset.type,
  })
  res.end(body)
}

module.exports = {
  getAdminAssetPaths: () => Object.keys(assets),
  redirectToAdminRoot,
  serveAdminAsset,
}
