function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

function ok(res, data = {}, headers = {}) {
  sendJson(res, 200, data, headers)
}

function created(res, data = {}, headers = {}) {
  sendJson(res, 201, data, headers)
}

function badRequest(res, message, headers = {}) {
  sendJson(res, 400, { message }, headers)
}

function unauthorized(res, message = 'Unauthorized', headers = {}) {
  sendJson(res, 401, { message }, headers)
}

function tooManyRequests(res, message = '请求过于频繁，请稍后再试', headers = {}) {
  sendJson(res, 429, { message }, headers)
}

function notFound(res) {
  sendJson(res, 404, { message: 'Not found' })
}

function serverError(res, error, requestId = '') {
  sendJson(res, 500, {
    message: '服务暂时不可用，请稍后重试',
    ...(requestId ? { requestId } : {}),
  }, requestId ? { 'x-request-id': requestId } : {})
}

module.exports = {
  sendJson,
  ok,
  created,
  badRequest,
  tooManyRequests,
  unauthorized,
  notFound,
  serverError,
}
