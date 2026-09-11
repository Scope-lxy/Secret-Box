function getImageCandidates(image, variant = 'medium', fallbacks = []) {
  const fields = variant === 'thumb'
    ? ['thumbUrl', 'mediumUrl', 'originalUrl', 'url']
    : ['mediumUrl', 'thumbUrl', 'originalUrl', 'url']
  const values = typeof image === 'string' ? [image] : fields.map((field) => image?.[field])
  return [...new Set([...values, ...fallbacks].map((value) => String(value || '').trim()).filter(Boolean))]
}

function getNextImageUrl(candidates = [], current = '') {
  const index = candidates.indexOf(current)
  return index >= 0 ? candidates[index + 1] || '' : ''
}

function prepareDisplayImage(image = {}, variant = 'medium') {
  const displayCandidates = getImageCandidates(image, variant)
  return { ...image, displayCandidates, displayUrl: displayCandidates[0] || '' }
}

function probeDisplayCandidate(source, api, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(''), timeoutMs)
    try {
      api.getImageInfo({
        src: source,
        success: (info) => finish(source.startsWith('/assets/') ? source : info.path || source),
        fail: () => finish(''),
      })
    } catch (_error) {
      finish('')
    }
  })
}

async function resolveDisplayImage(image = {}, options = {}) {
  const api = options.wx || wx
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 2500)
  const candidates = Array.isArray(options.candidates)
    ? options.candidates
    : getImageCandidates(image, options.variant || 'medium')
  for (const candidate of candidates) {
    const available = await probeDisplayCandidate(candidate, api, timeoutMs)
    if (available) return available
  }
  return ''
}

module.exports = { getImageCandidates, getNextImageUrl, prepareDisplayImage, resolveDisplayImage }
