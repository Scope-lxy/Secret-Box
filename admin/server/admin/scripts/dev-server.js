const http = require('http')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'src')
const port = Number(process.env.PORT || 5173)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  const filePath = path.normalize(path.join(root, urlPath))

  if (!filePath.startsWith(root)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    res.writeHead(200, {
      'content-type': mime[path.extname(filePath)] || 'application/octet-stream',
    })
    res.end(data)
  })
})

server.listen(port, () => {
  console.log(`secretbox-admin listening on http://127.0.0.1:${port}`)
})
