const SKELETON_DELAY = 350

function startInitialLoad(page, hasContent) {
  if (hasContent) {
    page.setData({ loading: false, showSkeleton: false })
    return
  }
  page.skeletonTimer = setTimeout(() => {
    if (page.data.loading) page.setData({ showSkeleton: true })
  }, SKELETON_DELAY)
}

function finishInitialLoad(page) {
  clearTimeout(page.skeletonTimer)
  page.setData({ loading: false, showSkeleton: false })
}

module.exports = {
  finishInitialLoad,
  startInitialLoad,
}
