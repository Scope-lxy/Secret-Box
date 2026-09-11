// 全小程序唯一的默认文案包。
// 规则：随机/轮换位放 2 条，其余 1 条；admin 配置了自定义文案时整体覆盖，绝不与默认合并。
// 文案内容由用户逐条确认定稿（2026-09-07），后续调整以用户给出为准。
const DEFAULT_COPY_PACK = {
  // 随机位：打开手记前的提示语（需含全角逗号，拆成上下两行展示）
  dailyContentPrompt: [
    '想说的，都悄悄放这里了',
    '打开前，猜猜里面是什么',
  ],
  // 轮换位：打卡前文案（按天轮换）
  checkinBefore: [
    '今天也等到你了',
    '每天都来打卡吧',
  ],
  // 轮换位：打卡后文案（按天轮换）
  checkinAfter: [
    '今日已点亮，明天再来打卡吧！',
    '感谢你的支持，明天我等你哦！',
  ],
  // 固定位：1 条
  dailyContentAdIncomplete: ['完整观看广告后，即可打开手记'],
  checkinAdIncomplete: ['完整观看广告后，即可完成打卡'],
  articleAdIncomplete: ['完整观看广告后，即可展开全文'],
  articleExpandButton: ['展开全文'],
  articleShareTitle: ['分享一篇文章'],
  publicShareTitleFallback: ['分享一段文案'],
  // 结构性单条文案（随启动配置 system 下发，默认值唯一来源在这里）
  homeHero: ['给你的专属秘密'],
  dailyContentButtonText: ['打开今日手记'],
  checkinButtonText: ['立即打卡'],
  articlesHero: ['走心的精选文章'],
  lettersHero: ['暖心的文案短句'],
  // 广告确认弹窗（与“广告未完成”提示是两个语义，分开建键）
  openDailyContentConfirm: ['完整观看广告 即可打开手记'],
  changeDailyContentConfirm: ['完整观看广告 即可更换手记'],
  checkinAdConfirm: ['完整观看广告 即可完成打卡'],
  adUnavailable: ['激励广告暂不可用，请稍后重试'],
  networkFailure: ['网络不稳定，请检查网络'],
  serviceFailure: ['服务不可用，请稍后重试'],
  // 分享卡兜底文案（结构与 utils/share-card.js 的文案池一致）
  sharePools: {
    text: {
      titles: ['发了一篇手记，打开看看吧'],
      coverCopies: ['今日手记'],
    },
    image: {
      titles: ['发了一组图片，打开看看吧'],
      coverCopies: ['今日图册'],
    },
    audio: {
      titles: ['发了一条音频，打开听听吧'],
      coverCopies: ['今日音频'],
    },
  },
  shareBackgrounds: [
    { id: 'fallback-background-1', imageUrl: '/assets/images/share-1.jpg' },
    { id: 'fallback-background-2', imageUrl: '/assets/images/share-2.jpg' },
    { id: 'fallback-background-3', imageUrl: '/assets/images/share-3.jpg' },
  ],
}

function normalizePool(values) {
  const list = Array.isArray(values) ? values : [values]
  return list.map((item) => String(item || '').trim()).filter(Boolean)
}

// 独立文案包（L3）运行时源：copy-pack 服务启动后台加载成功后注册。
// resolveCopy 的取值顺序：调用方传入的非空列表 → 运行时文案包 → 代码内置默认包。
// 运行时包列表为空（后台显式清空）时回落默认包，绝不与默认合并。
let runtimeCopySource = null

function setRuntimeCopySource(source) {
  runtimeCopySource = typeof source === 'function' ? source : null
}

// 覆盖语义：admin 提供了非空文案 → 整体采用；否则整体使用默认。绝不合并。
function resolveCopy(values, key) {
  const incoming = normalizePool(values)
  if (incoming.length) return incoming
  if (runtimeCopySource) {
    const runtime = normalizePool(runtimeCopySource(key))
    if (runtime.length) return runtime
  }
  const defaults = DEFAULT_COPY_PACK[key]
  return Array.isArray(defaults) ? defaults.slice() : normalizePool(defaults)
}

// 固定位：取覆盖后的第一条
function resolveCopyText(values, key) {
  return resolveCopy(values, key)[0]
}

function hasPromptComma(value) {
  const commaIndex = value.indexOf('，')
  return commaIndex > 0 && commaIndex < value.length - 1
}

// 提示语按全角逗号拆成上下两行；非法输入一律回落到默认包
function splitDailyContentPrompt(value = '') {
  const text = String(value || '').trim()
  if (!hasPromptComma(text)) {
    return splitDailyContentPrompt(DEFAULT_COPY_PACK.dailyContentPrompt[0])
  }
  const commaIndex = text.indexOf('，')
  return {
    text,
    firstLine: text.slice(0, commaIndex + 1),
    secondLine: text.slice(commaIndex + 1),
  }
}

// 提示语随机挑选：避开上一条；admin 文案全部非法时回落默认包
function pickDailyContentPrompt(values, previousText = '') {
  const pool = resolveCopy(values, 'dailyContentPrompt')
  const valid = pool.filter(hasPromptComma)
  const usable = valid.length ? valid : resolveCopy(null, 'dailyContentPrompt')
  const candidates = usable.filter((value) => value !== previousText)
  const finalPool = candidates.length ? candidates : usable
  return splitDailyContentPrompt(finalPool[Math.floor(Math.random() * finalPool.length)])
}

module.exports = {
  DEFAULT_COPY_PACK,
  pickDailyContentPrompt,
  resolveCopy,
  resolveCopyText,
  setRuntimeCopySource,
  splitDailyContentPrompt,
}
