let pendingTarget = null
let targetSequence = 0

function setSharedArticleReturnTarget(article = {}) {
  const contentId = String(article.id || '').trim()
  if (!contentId) return false
  targetSequence += 1
  pendingTarget = {
    contentId,
    article: { ...article },
    token: `article-return-${targetSequence}`,
  }
  return true
}

function getSharedArticleReturnTarget() {
  return pendingTarget ? { ...pendingTarget, article: { ...pendingTarget.article } } : null
}

function consumeSharedArticleReturnTarget(contentId = '', token = '') {
  if (
    !pendingTarget
    || (contentId && pendingTarget.contentId !== contentId)
    || (token && pendingTarget.token !== token)
  ) return null
  const target = getSharedArticleReturnTarget()
  pendingTarget = null
  return target
}

module.exports = {
  consumeSharedArticleReturnTarget,
  getSharedArticleReturnTarget,
  setSharedArticleReturnTarget,
}
