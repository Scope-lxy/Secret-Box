const MARKETING_RULES = [
  { category: '尾部栏目', score: 6, pattern: /^(?:本号导读|导读|推荐阅读|相关推荐|相关阅读|延伸阅读|往期精选|近期精选|往期回顾|更多精彩|精选推荐|热门文章|其他热文|热文推荐|相关文章|猜你喜欢|你可能还喜欢|阅读推荐|查看往期精选(?:内容)?|投稿指南|征稿启事|商务合作|联系我们|关注我们)[：:]?$/u },
  { category: '互动引导', score: 6, pattern: /(?:点赞.{0,12}(?:在看|转发|分享)|点(?:个|一下)?赞.{0,12}(?:在看|转发|分享)|(?:在看|转发).{0,12}(?:点赞|点个赞|分享)|(?:点亮|戳|点击).{0,12}(?:在看|爱心|大拇指)|一键三连|随手.{0,8}(?:点赞|点个赞|在看|转发)|(?:每个|每一个)赞和在看.{0,12}(?:喜欢|感谢|支持))/u },
  { category: '关注引导', score: 6, pattern: /(?:(?:扫码|长按).{0,16}(?:二维码|识别|关注|添加|进群)|点击.{0,8}蓝字.{0,8}关注|搜索.{0,8}关注.{0,8}公众号|(?:关注|星标|置顶)(?:我们|本号|公众号)?)/u },
  { category: '留言引导', score: 6, pattern: /^(?:(?:欢迎|请|记得|快来).{0,8}(?:留言|评论)|去留言|写留言|留言区见)[。！!]?$/u },
  { category: '投稿合作', score: 5, pattern: /(?:投稿(?:邮箱|方式|须知)?|商务合作|品牌合作|广告合作|转载合作|合作(?:微信|联系)|联系我们|客服微信|加入.{0,6}(?:社群|读者群)|读者群|交流群|添加微信|加微信|欢迎爆料|(?:预定|预订|报名|购买|咨询).{0,12}(?:微信|电话|联系|二维码))/u },
  { category: '结束标记', score: 6, pattern: /^[\s"“”'‘’—–*\-]*(?:全文完|完|the\s+end|end)[\s"“”'‘’—–*\-]*[。.!！]?$/iu },
  { category: '阅读引导', score: 3, pattern: /^(?:点击|查看)?阅读原文[。！!]?$/u },
]

const PROTECTED_PREFIX = /^(?:作者(?:简介|介绍|长期|系|为|是|[：:])|关于作者|本文作者|来源[：:]|编辑[：:]|责编[：:]|排版[：:]|校对[：:]|供稿[：:]|免责声明|风险提示|版权声明|版权归属|未经授权|侵权联系|声明[：:]|仅供参考|不构成.{0,20}建议)/u
const CONTACT = /(?:投稿邮箱|投稿方式|商务合作|品牌合作|广告合作|合作微信|联系邮箱|添加微信|客服微信|微信号[：:]|进群|入群|社群)/u

function splitMarkdownBlocks(value) {
  const lines = String(value || '').replace(/\r\n?/gu, '\n').trim().split('\n')
  const blocks = []
  let current = []
  let fenced = false
  const push = () => {
    const text = current.join('\n').trim()
    if (text) blocks.push(text)
    current = []
  }
  lines.forEach((line) => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/u.test(line)
    if (!fenced && !line.trim()) push()
    else current.push(line)
    if (fence) fenced = !fenced
  })
  push()
  return blocks
}

function normalizeBlockText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, '$1')
    .replace(/[`*_#>-]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function stripFencedMarkdown(value) {
  const lines = String(value || '').split('\n')
  const visible = []
  let fenced = false
  lines.forEach((line) => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/u.test(line)
    if (fence) {
      fenced = !fenced
      return
    }
    if (!fenced) visible.push(line)
  })
  return visible.join('\n')
}

function stripMarkdownImages(value) {
  return String(value || '').replace(/!\[[^\]]*\]\([^)]*\)/gu, '').trim()
}

function classifyBlock(block) {
  const raw = String(block || '').trim()
  const visible = stripFencedMarkdown(raw)
  const lines = visible.split('\n').map((line) => line.trim()).filter(Boolean)
  const table = lines.length >= 2 && lines[0].includes('|') && lines[1].replace(/[|:\-\s]/gu, '') === ''
  if (table) return { text: normalizeBlockText(visible), categories: new Set(), score: 0, links: 0, images: 0, imageOnly: false }
  const text = normalizeBlockText(visible)
  const links = (visible.match(/\[[^\]]+\]\([^)]*https?:\/\/[^)]*\)/gu) || []).length
  const images = (visible.match(/!\[[^\]]*\]\([^)]*\)/gu) || []).length
  const categories = new Set()
  let score = 0
  MARKETING_RULES.forEach((rule) => {
    if (rule.pattern.test(text)) {
      categories.add(rule.category)
      score += rule.score
    }
  })
  if (links >= 2 && text.length <= 400) {
    categories.add('链接列表')
    score += links >= 4 ? 4 : 3
  }
  if (images && text.length <= 20) score += 3
  if (CONTACT.test(text)) score += 2
  return { text, categories, score, links, images, imageOnly: images > 0 && text.length <= 12 }
}

function safeBodyText(blocks) {
  return blocks.map(normalizeBlockText).join('').replace(/\s+/gu, '').trim()
}

function cleanArticleMarkdown(value) {
  const source = String(value || '').replace(/\r\n?/gu, '\n').trim()
  const blocks = splitMarkdownBlocks(source)
  if (blocks.length < 2) return { bodyMarkdown: source, removedTailMarkdown: '', restoredBodyMarkdown: source, tailCleanup: { applied: false, categories: [], removedBlocks: 0 } }
  const classified = blocks.map(classifyBlock)
  const remove = new Set()

  // Remove only a short, high-confidence marketing preamble. Markdown code
  // fences remain one block, so examples inside code are not inspected.
  for (let index = 0; index < Math.min(4, blocks.length - 1); index += 1) {
    const item = classified[index]
    if (!item.score || item.text.length > 180 || PROTECTED_PREFIX.test(item.text)) break
    if (item.score >= 6 || (item.score >= 4 && (item.imageOnly || item.links > 0))) {
      remove.add(index)
      continue
    }
    break
  }

  const windowStart = Math.max(1, Math.min(Math.floor(blocks.length * 0.6), blocks.length - 8))
  let tailStart = -1
  for (let index = windowStart; index < blocks.length; index += 1) {
    const seed = classified[index]
    if (seed.score < 4 || PROTECTED_PREFIX.test(seed.text)) continue
    const suffix = classified.slice(index)
    const resumes = suffix.slice(1).some((item) => item.score <= 0 && item.text.length >= 40 && !item.imageOnly)
    if (resumes) continue
    tailStart = index
    break
  }
  if (tailStart >= 0) {
    for (let index = tailStart; index < blocks.length; index += 1) {
      const item = classified[index]
      if (PROTECTED_PREFIX.test(item.text) && !CONTACT.test(item.text)) break
      if (item.score > 0 || item.imageOnly || item.links > 0 || !item.text) remove.add(index)
      else break
    }
  }

  if (!remove.size) return { bodyMarkdown: source, removedTailMarkdown: '', restoredBodyMarkdown: source, tailCleanup: { applied: false, categories: [], removedBlocks: 0 } }
  const kept = blocks.filter((_block, index) => !remove.has(index))
  if (kept.length < 2 || safeBodyText(kept).length < 80) return { bodyMarkdown: source, removedTailMarkdown: '', restoredBodyMarkdown: source, tailCleanup: { applied: false, categories: [], removedBlocks: 0 } }
  const removedBlocks = [...remove].sort((a, b) => a - b).map((index) => blocks[index])
  const removedTailMarkdown = removedBlocks.join('\n\n')
  const restored = blocks.map((block, index) => remove.has(index) ? stripMarkdownImages(block) : block).filter(Boolean).join('\n\n')
  const categories = [...new Set([...remove].flatMap((index) => [...classified[index].categories]))]
  return {
    bodyMarkdown: kept.join('\n\n'),
    removedTailMarkdown,
    restoredBodyMarkdown: restored,
    tailCleanup: {
      applied: true,
      categories,
      removedBlocks: removedBlocks.length,
      summary: `已自动移除 ${removedBlocks.length} 个段落${categories.length ? `（${categories.join('、')}）` : ''}`,
    },
  }
}

module.exports = { cleanArticleMarkdown, splitMarkdownBlocks, normalizeBlockText }
