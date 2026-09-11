const payload = JSON.parse(process.env.MINIPROGRAM_UPLOAD_PAYLOAD || '{}')
delete process.env.MINIPROGRAM_UPLOAD_PAYLOAD

async function upload() {
  const ci = require('miniprogram-ci')
  const project = new ci.Project({
    appid: payload.appId,
    privateKeyPath: payload.privateKeyPath,
    projectPath: payload.projectPath,
    type: 'miniProgram',
  })
  await ci.upload({
    desc: payload.description,
    project,
    setting: { useProjectConfig: true },
    version: payload.version,
  })
}

function sanitizeUploadError(error, payload) {
  let message = String(error?.message || 'upload failed').trim().slice(0, 500)
  ;[payload.privateKeyPath, payload.projectPath].filter(Boolean).forEach((value) => {
    message = message.split(String(value)).join('[protected path]')
  })
  return {
    code: String(error?.code || error?.errCode || '').slice(0, 64),
    message,
  }
}

upload()
  .then(() => process.send?.({ ok: true }, () => process.exit(0)))
  .catch((error) => {
    process.send?.({ error: sanitizeUploadError(error, payload), ok: false }, () => process.exit(1))
  })
