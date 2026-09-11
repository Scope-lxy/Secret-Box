const { env } = require('../config/env')

function withCors(handler) {
  return (req, res) => {
    const origin = String(req.headers.origin || '').trim()
    const allowed = env.corsOrigin === '*'
      ? Boolean(origin)
      : Boolean(origin && env.corsOrigin.split(',').map((item) => item.trim()).includes(origin))
    if (allowed) res.setHeader('access-control-allow-origin', env.corsOrigin === '*' ? '*' : origin)
    if (origin) res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type,authorization,x-miniapp-appid,x-miniapp-session,x-visitor-id,x-miniapp-data-scope')
    handler(req, res)
  }
}

module.exports = {
  withCors,
}
