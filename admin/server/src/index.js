const http = require('http')
const { env } = require('./config/env')
const { withCors } = require('./lib/cors')
const { createAppRouter } = require('./routes')

if (!String(process.env.NODE_ENV || '').trim()) {
  console.error('NODE_ENV must be explicitly set to start the server')
  process.exit(1)
}

const router = createAppRouter()
const server = http.createServer(withCors(router.handle))
server.requestTimeout = 60 * 1000
server.headersTimeout = 15 * 1000
server.keepAliveTimeout = 5 * 1000

server.listen(env.port, () => {
  console.log(`secretbox-server listening on http://127.0.0.1:${env.port}`)
})
