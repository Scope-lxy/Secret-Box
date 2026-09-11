const { URL } = require('url')
const crypto = require('crypto')
const { notFound, serverError } = require('./response')

function redactErrorMessage(error) {
  return String(error?.message || 'unknown error')
    .replace(/\b(password|secret|token|authorization|cookie|key)\b\s*[:=]?\s*\S*/gi, '[redacted]')
    .slice(0, 500)
}

function createRouter() {
  const routes = []

  function add(method, path, handler) {
    const keys = []
    const pattern = path.split('/').map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      keys.push(part.slice(1))
      return '([^/]+)'
    }).join('/')
    routes.push({ method, path, handler, keys, matcher: new RegExp(`^${pattern}$`) })
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    let match
    const matches = (item) => {
      if (item.method !== req.method) return false
      return Boolean(url.pathname.match(item.matcher))
    }
    const route = routes.find((item) => !item.keys.length && matches(item))
      || routes.find((item) => item.keys.length && matches(item))
    match = route ? url.pathname.match(route.matcher) : null

    if (!route) {
      notFound(res)
      return
    }

    try {
      url.params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]))
      await route.handler(req, res, url)
    } catch (error) {
      const requestId = crypto.randomUUID()
      console.error(JSON.stringify({
        error: redactErrorMessage(error),
        errorName: error?.name || 'Error',
        requestId,
      }))
      serverError(res, error, requestId)
    }
  }

  return {
    delete: (path, handler) => add('DELETE', path, handler),
    get: (path, handler) => add('GET', path, handler),
    post: (path, handler) => add('POST', path, handler),
    handle,
  }
}

module.exports = {
  createRouter,
}
