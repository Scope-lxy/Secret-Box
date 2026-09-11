const imagePolicy = {
  maxFileSizeMb: 5,
  variants: {
    thumb: {
      longestSidePx: 480,
      quality: 72,
      usage: '列表、小卡片、缩略位',
    },
    medium: {
      longestSidePx: 1280,
      quality: 82,
      usage: '文章封面、手记图册默认浏览、普通详情展示',
    },
    original: {
      longestSidePx: null,
      quality: null,
      usage: '原图留存、长图与动画正文、展示图失败时兜底',
    },
  },
}

const DISPLAY_IMAGE_PROFILE = 'display-v1'

function getImageProcessingProfile(usage) {
  return usage === 'share-background' ? 'share-background-v2' : DISPLAY_IMAGE_PROFILE
}

function findReusableImage(images = [], processingProfile = DISPLAY_IMAGE_PROFILE) {
  return images.find((image) => image.status === 'ready'
    && image.processingProfile === processingProfile
    && image.mediumUrl && image.thumbUrl)
}

// Both variants use the uploaded image as their source, preserving the same
// complete composition. Keep the verified COS operation syntax in one place.
function makePicOperations({ mediumKey, thumbKey, usage, bucket }) {
  const shareBackground = usage === 'share-background'
  const rules = [
    [mediumKey, shareBackground ? 'rcrop/500x400' : 'thumbnail/1280x1280>', 82],
    [thumbKey, shareBackground ? 'rcrop/250x200' : 'thumbnail/480x480>', 72],
  ]
  return {
    is_pic_info: 1,
    rules: rules.map(([key, transform, quality]) => ({
      bucket: String(bucket || '').trim(),
      fileid: encodeURIComponent(`/${String(key || '').replace(/^\/+/, '')}`),
      rule: `imageMogr2/${transform}/format/jpg/quality/${quality}`,
    })),
  }
}

function getImageDisplayUrls(image = {}) {
  // Older article variants were cropped squares. Recover the retained source
  // for display without rewriting historical assets or changing their IDs.
  const legacyCover = !image.processingProfile && image.usage === 'article'
  const original = legacyCover ? String(image.originalUrl || '').trim() : ''
  return {
    mediumUrl: original || image.mediumUrl || image.thumbUrl || '',
    thumbUrl: original || image.thumbUrl || image.mediumUrl || '',
  }
}

module.exports = {
  imagePolicy,
  DISPLAY_IMAGE_PROFILE,
  getImageProcessingProfile,
  findReusableImage,
  makePicOperations,
  getImageDisplayUrls,
}
