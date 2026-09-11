function readApiBase() {
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin
  }
  return 'http://127.0.0.1:3000'
}

const API_BASE = readApiBase()

const nativeAdPlacementOptions = [
  { value: 'dailyContent', label: '手记模块下方' },
  { value: 'checkIn', label: '打卡模块下方' },
  { value: 'stats', label: '统计模块下方' },
]

const adPageKeys = {
  home: ['homeDailyContentRewarded', 'homeCheckInRewarded', 'homeNative', 'homeInterstitial'],
  articles: ['articlesNative', 'articlesInterstitial', 'articleExpandRewarded', 'articleInterstitial', 'articlesStartNative', 'articlesEndNative'],
  letters: ['lettersNative', 'lettersInterstitial'],
  mine: ['mineNative', 'mineInterstitial'],
}

// Keep newly introduced article placements visible while an older Admin response is still in use.
const articleAdEditorDefaults = {
  articlesNative: { enabled: true, adUnitId: '', label: '文章原生模板广告', adType: 'native', firstAfter: 3, interval: 10 },
  articlesInterstitial: { enabled: false, adUnitId: '', label: '文章插屏广告', adType: 'interstitial', delaySeconds: 3, repeatSeconds: 90 },
  articleExpandRewarded: { enabled: true, adUnitId: '', label: '文章详情激励视频', adType: 'rewarded', freeCount: 0, confirmPopupEnabled: true, allowOnUnavailable: true },
  articleInterstitial: { enabled: false, adUnitId: '', label: '文章详情插屏广告', adType: 'interstitial', delaySeconds: 3, repeatSeconds: 90 },
  articlesStartNative: { enabled: true, adUnitId: '', label: '文章详情开头广告', adType: 'native' },
  articlesEndNative: { enabled: true, adUnitId: '', label: '文章详情正文广告', adType: 'native' },
}

function mergeArticleAdEditorItems(items = {}) {
  const merged = { ...(items && typeof items === 'object' ? items : {}) }
  Object.entries(articleAdEditorDefaults).forEach(([key, fallback]) => {
    merged[key] = { ...fallback, ...(merged[key] && typeof merged[key] === 'object' ? merged[key] : {}), label: fallback.label }
  })
  return merged
}

const nodes = {
  appSecretInput: document.querySelector('#miniProgramAppSecretInput'),
  articleDisplaySettingsSave: document.querySelector('#articleDisplaySettingsSaveBtn'),
  articleHideFullArticle: document.querySelector('#articleHideFullArticle'),
  articleExpandPosition: document.querySelector('#articleExpandPosition'),
  articleExpandText: document.querySelector('#articleExpandText'),
  articleListLayout: document.querySelector('#articleListLayout'),
  accountList: document.querySelector('#accountList'),
  accountStatus: document.querySelector('#accountStatus'),
  addMpModal: document.querySelector('#addMpModal'),
  addPoolModal: document.querySelector('#addPoolModal'),
  adsConfigEditor: document.querySelector('#adsConfigEditor'),
  adminLayout: document.querySelector('#adminLayout'),
  adminToast: document.querySelector('#adminToast'),
  contentAlbumEditor: document.querySelector('#contentAlbumEditor'),
  contentAlbumsPagination: document.querySelector('#contentAlbumsPagination'),
  contentAudioEditor: document.querySelector('#contentAudioEditor'),
  contentAudiosPagination: document.querySelector('#contentAudiosPagination'),
  adminAudioPlayer: document.querySelector('#adminAudioPlayer'),
  adminAudioTitle: document.querySelector('#adminAudioTitle'),
  adminAudioStatus: document.querySelector('#adminAudioStatus'),
  adminAudioProgress: document.querySelector('#adminAudioProgress'),
  adminAudioCurrent: document.querySelector('#adminAudioCurrent'),
  adminAudioRemaining: document.querySelector('#adminAudioRemaining'),
  adminAudioDuration: document.querySelector('#adminAudioDuration'),
  adminAudioToggle: document.querySelector('#adminAudioToggle'),
  adminAudioRestart: document.querySelector('#adminAudioRestart'),
  contentTextEditor: document.querySelector('#contentTextEditor'),
  contentTextsPagination: document.querySelector('#contentTextsPagination'),
  breadcrumbLabel: document.querySelector('#breadcrumbLabel'),
  loginAccountInput: document.querySelector('#loginAccountInput'),
  loginPasswordInput: document.querySelector('#loginPasswordInput'),
  loginStatus: document.querySelector('#loginStatus'),
  confirmMessage: document.querySelector('#confirmMessage'),
  confirmModal: document.querySelector('#confirmModal'),
  confirmOk: document.querySelector('#confirmOk'),
  confirmTitle: document.querySelector('#confirmTitle'),
  contentPoolBody: document.querySelector('#contentPoolBody'),
  createMpBtn: document.querySelector('#createMpBtn'),
  dashboardCards: document.querySelector('#dashboardCards'),
  dashboardGroupFilter: document.querySelector('#dashboardGroupFilter'),
  manageGroupsBtn: document.querySelector('#manageGroupsBtn'),
  groupManagerModal: document.querySelector('#groupManagerModal'),
  groupManagerList: document.querySelector('#groupManagerList'),
  groupManagerNewName: document.querySelector('#groupManagerNewName'),
  groupManagerAdd: document.querySelector('#groupManagerAdd'),
  groupManagerCancel: document.querySelector('#groupManagerCancel'),
  groupManagerSave: document.querySelector('#groupManagerSave'),
  groupManagerStatus: document.querySelector('#groupManagerStatus'),
  groupAssignModal: document.querySelector('#groupAssignModal'),
  groupAssignSelect: document.querySelector('#groupAssignSelect'),
  groupAssignCancel: document.querySelector('#groupAssignCancel'),
  groupAssignSave: document.querySelector('#groupAssignSave'),
  groupAssignStatus: document.querySelector('#groupAssignStatus'),
  dashboardOperationLogBody: document.querySelector('#dashboardOperationLogBody'),
  editableSections: document.querySelector('#editableSections'),
  imageEditor: document.querySelector('#imageEditor'),
  adminAccountInput: document.querySelector('#adminAccountInput'),
  adminAccountLabel: document.querySelector('#adminAccountLabel'),
  adminCurrentPasswordInput: document.querySelector('#adminCurrentPasswordInput'),
  adminPasswordInput: document.querySelector('#adminPasswordInput'),
  adminPasswordConfirmInput: document.querySelector('#adminPasswordConfirmInput'),
  letterEditor: document.querySelector('#letterEditor'),
  lettersPagination: document.querySelector('#lettersPagination'),
  limitConfigEditor: document.querySelector('#limitConfigEditor'),
  miniProgramDataMode: document.querySelector('#miniProgramDataMode'),
  miniProgramMode: document.querySelector('#miniProgramMode'),
  saveMiniProgramMode: document.querySelector('#saveMiniProgramMode'),
  loginPage: document.querySelector('#loginPage'),
  messageList: document.querySelector('#messageList'),
  messageMiniProgramFilter: document.querySelector('#messageMiniProgramFilter'),
  messageSearchInput: document.querySelector('#messageSearchInput'),
  messageSourceFilter: document.querySelector('#messageSourceFilter'),
  messageStatusFilter: document.querySelector('#messageStatusFilter'),
  moduleList: document.querySelector('#moduleList'),
  miniProgramBody: document.querySelector('#miniProgramBody'),
  mpSelect: document.querySelector('#mpSelect'),
  newMpAppId: document.querySelector('#newMpAppId'),
  newMpAppSecret: document.querySelector('#newMpAppSecret'),
  newMpDeveloperEmail: document.querySelector('#newMpDeveloperEmail'),
  newMpContentPool: document.querySelector('#newMpContentPool'),
  newMpName: document.querySelector('#newMpName'),
  newMpRemark: document.querySelector('#newMpRemark'),
  newPoolName: document.querySelector('#newPoolName'),
  uploadMiniProgramDescription: document.querySelector('#uploadMiniProgramDescription'),
  uploadMiniProgramHint: document.querySelector('#uploadMiniProgramHint'),
  uploadMiniProgramModal: document.querySelector('#uploadMiniProgramModal'),
  uploadMiniProgramPrivateKey: document.querySelector('#uploadMiniProgramPrivateKey'),
  uploadMiniProgramPrivateKeyHint: document.querySelector('#uploadMiniProgramPrivateKeyHint'),
  uploadMiniProgramVersion: document.querySelector('#uploadMiniProgramVersion'),
  newPoolRemark: document.querySelector('#newPoolRemark'),
  editPoolModal: document.querySelector('#editPoolModal'),
  editPoolName: document.querySelector('#editPoolName'),
  editPoolRemark: document.querySelector('#editPoolRemark'),
  saveMiniProgramInfo: document.querySelector('#saveMiniProgramInfo'),
  saveAdminAuthBtn: document.querySelector('#saveAdminAuthBtn'),
  saveStorageSettings: document.querySelector('#saveStorageSettings'),
  saveSystemSettings: document.querySelector('#saveSystemSettings'),
  securityStats: document.querySelector('#securityStats'),
  shareCardCatalog: document.querySelector('#shareCardCatalog'),
  shareCardCatalogHint: document.querySelector('#shareCardCatalogHint'),
  refreshShareCardPreview: document.querySelector('#refreshShareCardPreview'),
  shareContentTypeTabs: document.querySelector('#shareContentTypeTabs'),
  shareCoverCopyEnabled: document.querySelector('#shareCoverCopyEnabled'),
  shareCopyFontSize: document.querySelector('#shareCopyFontSize'),
  shareDividerGap: document.querySelector('#shareDividerGap'),
  shareCenteredLayoutEnabled: document.querySelector('#shareCenteredLayoutEnabled'),
  shareCenteredLayoutOffsetY: document.querySelector('#shareCenteredLayoutOffsetY'),
  shareCopyColor: document.querySelector('#shareCopyColor'),
  shareDateFontSize: document.querySelector('#shareDateFontSize'),
  shareDividerLength: document.querySelector('#shareDividerLength'),
  shareCoverGrid: document.querySelector('#shareCoverGrid'),
  shareCoverCopyPoolCount: document.querySelector('#shareCoverCopyPoolCount'),
  shareCoverCopyPoolInput: document.querySelector('#shareCoverCopyPoolInput'),
  shareCoverUploadFile: document.querySelector('#shareCoverUploadFile'),
  shareCoverUploadBtn: document.querySelector('#shareCoverUploadBtn'),
  shareGlobalWashOpacity: document.querySelector('#shareGlobalWashOpacity'),
  shareLeftLayoutEnabled: document.querySelector('#shareLeftLayoutEnabled'),
  shareLeftLayoutOffsetY: document.querySelector('#shareLeftLayoutOffsetY'),
  shareDateColor: document.querySelector('#shareDateColor'),
  shareDividerColor: document.querySelector('#shareDividerColor'),
  shareReadingZoneOpacity: document.querySelector('#shareReadingZoneOpacity'),
  shareReadingZoneColor: document.querySelector('#shareReadingZoneColor'),
  resetShareCoverStyle: document.querySelector('#resetShareCoverStyle'),
  shareStyleTemplateSummary: document.querySelector('#shareStyleTemplateSummary'),
  shareTitlePoolCount: document.querySelector('#shareTitlePoolCount'),
  shareTitlePoolInput: document.querySelector('#shareTitlePoolInput'),
  saveShareSettings: document.querySelector('#saveShareSettings'),
  serverStatus: document.querySelector('#serverStatus'),
  singleContentCancel: document.querySelector('#singleContentCancel'),
  singleContentAudioCount: document.querySelector('#singleContentAudioCount'),
  singleContentAudioField: document.querySelector('#singleContentAudioField'),
  singleContentAudioInput: document.querySelector('#singleContentAudioInput'),
  singleContentAudioPreview: document.querySelector('#singleContentAudioPreview'),
  singleContentFields: document.querySelector('#singleContentFields'),
  singleContentImageCount: document.querySelector('#singleContentImageCount'),
  singleContentImageField: document.querySelector('#singleContentImageField'),
  singleContentImageInput: document.querySelector('#singleContentImageInput'),
  singleContentImageLabel: document.querySelector('#singleContentImageLabel'),
  singleContentImagePreview: document.querySelector('#singleContentImagePreview'),
  singleContentModal: document.querySelector('#singleContentModal'),
  singleContentSave: document.querySelector('#singleContentSave'),
  singleContentSelectAudio: document.querySelector('#singleContentSelectAudio'),
  singleContentSelectImages: document.querySelector('#singleContentSelectImages'),
  singleContentTitle: document.querySelector('#singleContentTitle'),
  storageConnectionStatus: document.querySelector('#storageConnectionStatus'),
  testStorageSettings: document.querySelector('#testStorageSettings'),
  preflightList: document.querySelector('#preflightList'),
  runPreflightBtn: document.querySelector('#runPreflightBtn'),
  uploadImageBtn: document.querySelector('#uploadImageBtn'),
  uploadImageFile: document.querySelector('#uploadImageFile'),
  visitTrendChart: document.querySelector('#visitTrendChart'),
  visitTrendCanvas: document.querySelector('#visitTrendCanvas'),
  visitTrendLegend: document.querySelector('#visitTrendLegend'),
  visitTrendTooltip: document.querySelector('#visitTrendTooltip'),
}

const sectionNames = {
  dashboard: '状态面板',
  content: '内容管理',
  import: '导入内容',
  'daily-content-share': '分享模板',
  ads: '广告设置',
  messages: '留言管理',
  accounts: '用户管理',
  security: '内容安全',
  storage: '图片素材',
  system: '小程序设置',
  miniprograms: '小程序管理',
  'admin-account': '管理员账号',
}

let accountPolicy = null
let adminAuthState = {
  account: 'admin',
  passwordConfigured: false,
  passwordResetHint: '',
  session: { createdAt: '', expiresAt: '' },
}
let adminSettingsState = {
  contentPools: [],
  currentMiniProgramId: '',
  miniPrograms: [],
  operationLogs: [],
  security: {},
  storage: {},
}
let contentState = {
  ads: {},
  contentAlbums: [],
  contentAudios: [],
  contentTexts: [],
  articles: [],
  imageAssets: [],
  letters: [],
  system: {},
  poolSummaries: [],
}
const CONTENT_TYPES = ['contentAlbums', 'contentAudios', 'contentTexts', 'letters']
const CONTENT_EDITOR_TYPES = ['contentTexts', 'contentAudios', 'contentAlbums', 'articles', 'letters']
let activeContentEditorType = 'contentTexts'
let adminAudio = null
let activeAdminAudioId = ''
let adminAudioLoading = false
let adminAudioError = false
const PAGE_SIZES = [10, 20, 50, 100]
const adminPaginationHandlers = new Map()

function createPaginationState() {
  return { page: 1, pageSize: PAGE_SIZES[0], total: 0, totalPages: 1 }
}

function createContentPaginationState() {
  return Object.fromEntries(CONTENT_TYPES.map((type) => [type, createPaginationState()]))
}

function createContentSelectionState() {
  return Object.fromEntries(CONTENT_TYPES.map((type) => [type, new Set()]))
}

let contentPagination = createContentPaginationState()
let contentSelection = createContentSelectionState()
let contentFormSnapshots = {}
let uploadingMiniProgramId = ''
let shareSettingsState = { version: 1, private: { pools: {}, backgrounds: [] } }
let activeShareContentType = 'text'
let sharePreviewBackgrounds = []
let sharePreviewSamples = []
let sharePreviewTypeOffset = 0
let editingContentPoolId = ''
let editingPoolMetaId = ''
let imagePolicyState = null
let imageState = []
let imagePagination = createPaginationState()
let messageState = []
let messagePagination = createPaginationState()
let accountPagination = createPaginationState()
let visitTrendState = {
  hoverPoints: [],
  items: [],
}
let pendingConfirm = null
let preflightLoadPromise = null
let singleContentFiles = []
let singleContentAudioDuration = 0
let singleContentAudioFile = null
let singleContentItemId = ''
let singleContentPreviewUrls = []
let singleContentSaving = false
let singleContentType = ''
let singleContentUploadedImages = []
let singleContentUploadedAudio = null
let groupManagerDraft = []
let groupManagerBaseGroups = []
let groupManagerSaving = false
let groupAssignSaving = false
let adminSettingsRequestId = 0
let adminOverviewRequestId = 0

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

async function apiRequest(path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const { headers: optionHeaders = {}, ...requestOptions } = options
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'content-type': 'application/json' }),
      ...optionHeaders,
    },
    ...requestOptions,
  })
  const data = await response.json()
  if (response.status === 401 && path !== '/api/admin/login') {
    adminAuthState = {
      account: 'admin',
      passwordConfigured: false,
      passwordResetHint: '',
      session: { createdAt: '', expiresAt: '' },
    }
    renderAdminAuth()
    showLogin('登录已失效，请重新登录')
    throw new Error('登录已失效，请重新登录')
  }
  if (!response.ok) {
    const error = new Error(data.message || '请求失败')
    error.status = response.status
    throw error
  }
  return data
}

function showToast(message) {
  if (!nodes.adminToast) return
  nodes.adminToast.textContent = message
  nodes.adminToast.classList.remove('hidden')
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => nodes.adminToast.classList.add('hidden'), 1800)
}

function showLogin(message = '') {
  nodes.adminLayout?.classList.add('hidden')
  nodes.loginPage?.classList.remove('hidden')
  if (nodes.loginStatus && message) nodes.loginStatus.textContent = message
}

function showAdmin() {
  nodes.loginPage?.classList.add('hidden')
  nodes.adminLayout?.classList.remove('hidden')
}

function renderAdminAuth() {
  if (nodes.adminAccountLabel) nodes.adminAccountLabel.textContent = adminAuthState.account || 'admin'
  if (nodes.adminAccountInput) nodes.adminAccountInput.value = adminAuthState.account || ''
  if (nodes.loginAccountInput && !nodes.loginAccountInput.value) nodes.loginAccountInput.value = adminAuthState.account || 'admin'
  if (nodes.loginPasswordInput) nodes.loginPasswordInput.value = ''
  if (nodes.adminCurrentPasswordInput) nodes.adminCurrentPasswordInput.value = ''
  if (nodes.adminPasswordInput) nodes.adminPasswordInput.value = ''
  if (nodes.adminPasswordConfirmInput) nodes.adminPasswordConfirmInput.value = ''
  ;['loginPasswordInput', 'adminCurrentPasswordInput', 'adminPasswordInput', 'adminPasswordConfirmInput'].forEach((inputId) => setSecretVisibilityById(inputId, false))
}

function openModal(modal) {
  modal?.classList.remove('hidden')
}

function closeModal(modal) {
  modal?.classList.add('hidden')
}

function openConfirm({ title = '确认操作', message = '操作后将立即生效。', confirmLabel = '确认', danger = false, onConfirm }) {
  if (!nodes.confirmModal) return
  nodes.confirmTitle.textContent = title
  nodes.confirmMessage.textContent = message
  if (nodes.confirmOk) {
    nodes.confirmOk.textContent = confirmLabel
    nodes.confirmOk.classList.toggle('btn-danger', danger)
  }
  pendingConfirm = onConfirm
  openModal(nodes.confirmModal)
}

function closeConfirm() {
  pendingConfirm = null
  if (nodes.confirmOk) {
    nodes.confirmOk.textContent = '确认'
    nodes.confirmOk.classList.remove('btn-danger')
  }
  closeModal(nodes.confirmModal)
}

function makeId(prefix) {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${suffix}`
}

function openContentImport(type) {
  window.dispatchEvent(new CustomEvent('open-content-import', {
    detail: {
      miniProgramId: getCurrentMiniProgram()?.id || '',
      type,
    },
  }))
}

function setStatus(node, message, type = '') {
  if (!node) return
  node.textContent = message
  node.className = type ? `status ${type}` : 'status'
  node.classList.toggle('hidden', !message)
}

function setStorageConnectionStatus(message, type = '') {
  if (!nodes.storageConnectionStatus) return
  nodes.storageConnectionStatus.textContent = message
  nodes.storageConnectionStatus.className = type ? `status status-inline ${type}` : 'status status-inline'
  nodes.storageConnectionStatus.classList.toggle('hidden', !message)
}

function setButtonsLoading(buttons, label) {
  const targets = [...buttons].filter(Boolean)
  const labels = targets.map((button) => button.textContent)
  targets.forEach((button) => {
    button.disabled = true
    button.textContent = label
  })
  return () => {
    targets.forEach((button, index) => {
      button.disabled = false
      button.textContent = labels[index]
    })
  }
}

function getBadgeClass(value) {
  return ['danger', 'draft', 'info', 'success', 'warning'].includes(value) ? value : 'info'
}

function renderTags(items) {
  nodes.moduleList.innerHTML = (items || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('')
}

function renderDashboardCards(items) {
  nodes.dashboardCards.innerHTML = (items || []).map((item) => `
    <article class="stat-card" title="${escapeAttr(item.hint || '')}">
      <span class="stat-value">${escapeHtml(item.value)}</span>
      <span class="stat-label">${escapeHtml(item.label)}</span>
    </article>
  `).join('')
}

function renderEditableSections(items) {
  nodes.editableSections.innerHTML = (items || []).map((item) => `
    <article class="stat-card" title="${escapeAttr(item.hint || '')}">
      <span class="stat-value">${escapeHtml(String(item.value ?? item.status ?? '--').split('·')[0].trim() || '--')}</span>
      <span class="stat-label">${escapeHtml(item.label)}</span>
    </article>
  `).join('')
}

function renderMetricCards(node, items = []) {
  if (!node) return
  node.innerHTML = (items || []).map((item) => `
    <article class="stat-card">
      <span class="stat-value">${escapeHtml(item.value)}</span>
      <span class="stat-label">${escapeHtml(item.label)}</span>
    </article>
  `).join('')
}

function renderPreflight(data = {}) {
  if (!nodes.preflightList) return
  const statusOrder = { fail: 0, warn: 1, pass: 2 }
  const checks = [...(data.checks || [])].sort((a, b) => (
    (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3)
  ))
  if (!checks.length) {
    nodes.preflightList.innerHTML = '<div class="empty-panel">暂无检查结果</div>'
    return
  }
  const statusMap = {
    fail: ['badge-danger', '失败'],
    pass: ['badge-success', '通过'],
    warn: ['badge-warning', '注意'],
  }
  nodes.preflightList.innerHTML = checks.map((item) => {
    const [badgeClass, label] = statusMap[item.status] || statusMap.warn
    return `
      <div class="preflight-row">
        <span class="badge ${badgeClass}">${label}</span>
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.message)}</span>
      </div>
    `
  }).join('')
}

function loadPreflight() {
  if (!nodes.preflightList) return null
  if (preflightLoadPromise) return preflightLoadPromise
  const restoreButton = setButtonsLoading([nodes.runPreflightBtn], '检查中…')
  preflightLoadPromise = (async () => {
    try {
      const data = await apiRequest('/api/admin/preflight')
      renderPreflight(data)
      return data
    } catch (error) {
      nodes.preflightList.innerHTML = `<div class="empty-panel">${escapeHtml(error.message || '服务配置检查失败')}</div>`
      return null
    } finally {
      restoreButton()
      preflightLoadPromise = null
    }
  })()
  return preflightLoadPromise
}

function normalizeTrendValue(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function getNiceTrendStep(value) {
  const max = Math.max(1, Number(value) || 1)
  const exponent = Math.floor(Math.log10(max))
  const base = Math.pow(10, exponent)
  const scaled = max / base
  const niceScaled = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return niceScaled * base
}

function getNiceTrendMax(value, steps = 4) {
  const max = Math.max(1, normalizeTrendValue(value))
  const step = getNiceTrendStep(max / steps)
  return step * steps
}

function formatTrendDate(value, fallback = '') {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match) return `${Number(match[2])}/${Number(match[3])}`
  return String(fallback || text || '-')
}

function getTrendCanvasColors() {
  const style = getComputedStyle(document.documentElement)
  return {
    accent: style.getPropertyValue('--accent').trim() || '#2563eb',
    amber: '#d97706',
    green: '#16a34a',
    line: style.getPropertyValue('--line').trim() || '#e5e7eb',
    muted: style.getPropertyValue('--muted').trim() || '#64748b',
    rose: '#e11d48',
    surface: '#f9fafb',
    text: style.getPropertyValue('--text').trim() || '#0f172a',
  }
}

function getTrendSeries(colors) {
  return [
    { key: 'visits', label: '访问人次', color: colors.accent },
    { key: 'visitors', label: '访问人数', color: colors.green },
    { key: 'checkins', label: '成功打卡', color: colors.amber },
    { key: 'dailyContentOpens', label: '打开手记', color: colors.rose },
    { key: 'articleOpens', label: '打开文章', color: '#7c3aed' },
  ]
}

function renderVisitTrendLegend(series) {
  if (!nodes.visitTrendLegend) return
  nodes.visitTrendLegend.innerHTML = ''
  nodes.visitTrendLegend.hidden = true
}

function hideVisitTrendTooltip() {
  if (!nodes.visitTrendTooltip) return
  nodes.visitTrendTooltip.hidden = true
  nodes.visitTrendTooltip.innerHTML = ''
}

function renderVisitTrendTooltip(event) {
  const tooltip = nodes.visitTrendTooltip
  const canvas = nodes.visitTrendCanvas
  const points = visitTrendState.hoverPoints || []
  if (!tooltip || !canvas || !points.length) return hideVisitTrendTooltip()
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const nearest = points.reduce((best, point) => {
    const distance = Math.abs(point.x - x)
    return !best || distance < best.distance ? { point, distance } : best
  }, null)
  if (!nearest || nearest.distance > 32) return hideVisitTrendTooltip()
  const rows = (nearest.point.values || []).map((item) => (
    `<div class="trend-tooltip-row"><i style="background:${escapeAttr(item.color)}"></i><span>${escapeHtml(item.label)}</span><b>${Number(item.value || 0)}</b></div>`
  )).join('')
  tooltip.innerHTML = `<strong class="trend-tooltip-date">${escapeHtml(nearest.point.date)}</strong><div class="trend-tooltip-list">${rows}</div>`
  tooltip.hidden = false
  const tooltipWidth = tooltip.offsetWidth || 132
  const tooltipHeight = tooltip.offsetHeight || 72
  let left = nearest.point.x - tooltipWidth / 2
  left = Math.max(8, Math.min(rect.width - tooltipWidth - 8, left))
  let top = nearest.point.y - tooltipHeight - 12
  if (top < 8) top = nearest.point.y + 12
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

function renderVisitTrend(items = []) {
  const canvas = nodes.visitTrendCanvas
  const chart = nodes.visitTrendChart
  if (!canvas || !canvas.getContext || !chart) return
  const data = (items || []).slice(-15).map((item) => ({
    date: formatTrendDate(item.date, item.label),
    label: String(item.label || '').trim(),
    dailyContentOpens: normalizeTrendValue(item.dailyContentOpens),
    checkins: normalizeTrendValue(item.checkins),
    visits: normalizeTrendValue(item.visits),
    visitors: normalizeTrendValue(item.visitors),
    articleOpens: normalizeTrendValue(item.articleOpens),
  }))
  visitTrendState.items = data
  visitTrendState.hoverPoints = []
  hideVisitTrendTooltip()
  const colors = getTrendCanvasColors()
  const series = getTrendSeries(colors)
  renderVisitTrendLegend(series)
  const hasData = data.some((item) => series.some((line) => item[line.key] > 0))
  chart.classList.toggle('is-empty', !hasData)

  const rect = canvas.getBoundingClientRect()
  const width = Math.max(360, Math.floor(rect.width || canvas.clientWidth || 960))
  const height = Math.max(240, Math.floor(rect.height || canvas.clientHeight || 280))
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const pad = { left: 52, right: 20, top: 22, bottom: 42 }
  const plotW = Math.max(1, width - pad.left - pad.right)
  const plotH = Math.max(1, height - pad.top - pad.bottom)
  const maxValue = getNiceTrendMax(Math.max(...data.flatMap((item) => series.map((line) => item[line.key])), 1))
  const ySteps = 4

  ctx.font = '12px Arial, sans-serif'
  ctx.textBaseline = 'middle'
  for (let step = 0; step <= ySteps; step += 1) {
    const ratio = step / ySteps
    const y = pad.top + plotH * ratio
    const value = Math.round(maxValue * (1 - ratio))
    ctx.strokeStyle = colors.line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(width - pad.right, y)
    ctx.stroke()
    ctx.fillStyle = colors.muted
    ctx.textAlign = 'right'
    ctx.fillText(String(value), pad.left - 12, y)
  }

  const count = Math.max(1, data.length - 1)
  data.forEach((item, index) => {
    const x = pad.left + plotW * (data.length <= 1 ? 0 : index / count)
    const values = series.map((line) => ({
      color: line.color,
      key: line.key,
      label: line.label,
      value: item[line.key],
      y: pad.top + plotH * (1 - (item[line.key] / maxValue)),
    }))
    const y = Math.min(...values.map((line) => line.y))
    visitTrendState.hoverPoints.push({ ...item, values, x, y })
    const shouldLabel = index === 0 || index === data.length - 1 || index % 3 === 0
    if (!shouldLabel) return
    ctx.fillStyle = colors.muted
    ctx.textAlign = index === 0 ? 'left' : (index === data.length - 1 ? 'right' : 'center')
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(item.date, x, height - 16)
  })

  if (!data.length) return
  series.forEach((line) => {
    ctx.beginPath()
    data.forEach((item, index) => {
      const point = visitTrendState.hoverPoints[index]
      const valuePoint = point.values.find((value) => value.key === line.key)
      if (index === 0) ctx.moveTo(point.x, valuePoint.y)
      else ctx.lineTo(point.x, valuePoint.y)
    })
    ctx.strokeStyle = line.color
    ctx.lineWidth = line.key === 'visits' ? 2.6 : 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    visitTrendState.hoverPoints.forEach((point) => {
      const valuePoint = point.values.find((value) => value.key === line.key)
      ctx.beginPath()
      ctx.arc(point.x, valuePoint.y, line.key === 'visits' ? 3 : 2.6, 0, Math.PI * 2)
      ctx.fillStyle = colors.surface
      ctx.fill()
      ctx.lineWidth = 1.8
      ctx.strokeStyle = line.color
      ctx.stroke()
    })
  })
}

function renderGroupOptions(select, groups, emptyLabel, selected = select?.value || '') {
  if (!select) return
  const names = ['', ...(groups || [])]
  const options = [...select.options]
  if (options.length !== names.length || names.some((name, index) => options[index]?.value !== name || options[index]?.textContent !== (name || emptyLabel))) {
    select.innerHTML = `<option value="">${emptyLabel}</option>` + names.slice(1).map((group) => `<option value="${escapeAttr(group)}">${escapeHtml(group)}</option>`).join('')
  }
  select.value = names.includes(selected) ? selected : ''
}

function unavailableActivityMetrics() {
  return ['总用户数', '周活用户', '今日访问人数', '今日访问人次', '成功打卡', '打开手记', '打开文章', '新增留言']
    .map((label) => ({ label, value: '--', hint: '数据未能刷新，请重试' }))
}

function renderAdminOverview(admin) {
  renderGroupOptions(nodes.dashboardGroupFilter, admin.groups, '全部', admin.selectedGroup || '')
  renderDashboardCards(admin.dashboardCards || [])
  renderEditableSections(admin.editableSections || [])
  renderVisitTrend(admin.currentVisitTrend || [])
  renderDashboardOperationLogs(admin.recentOperationLogs || [])
}

async function loadAdminOverview() {
  const requestId = ++adminOverviewRequestId
  const groupId = nodes.dashboardGroupFilter?.value || ''
  try {
    const admin = await apiRequest(`/api/admin/bootstrap${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`)
    if (requestId !== adminOverviewRequestId || groupId !== (nodes.dashboardGroupFilter?.value || '')) return null
    renderAdminOverview(admin)
    return admin
  } catch (error) {
    if (requestId !== adminOverviewRequestId) return null
    renderDashboardCards(unavailableActivityMetrics())
    renderEditableSections(unavailableActivityMetrics())
    renderVisitTrend([])
    throw error
  }
}

async function refreshAdminOverview({ reloadPreflight = true } = {}) {
  try {
    const admin = await loadAdminOverview()
    if (admin && reloadPreflight) await loadPreflight()
  } catch (error) {
    showToast('运营概览刷新失败')
  }
}

function getActiveMiniPrograms() {
  return (adminSettingsState.miniPrograms || []).filter((item) => item.status !== 'archived')
}

function getCurrentMiniProgram() {
  return (adminSettingsState.miniPrograms || []).find((item) => item.id === adminSettingsState.currentMiniProgramId)
    || getActiveMiniPrograms()[0]
    || adminSettingsState.miniPrograms?.[0]
}

function getMiniProgramConfig(item = getCurrentMiniProgram()) {
  return item?.config || {}
}

function getMiniProgramContentPoolId(item = getCurrentMiniProgram()) {
  return getMiniProgramConfig(item).contentPoolId || ''
}

function getMiniProgramDataMode(item = getCurrentMiniProgram()) {
  return getMiniProgramConfig(item).dataMode === 'independent' ? 'independent' : 'shared'
}

function getContentPoolName(id) {
  return (adminSettingsState.contentPools || []).find((item) => item.id === id)?.name || '未绑定'
}

function getEditingContentPoolId() {
  const pools = adminSettingsState.contentPools || []
  if (pools.some((item) => item.id === editingContentPoolId)) return editingContentPoolId
  editingContentPoolId = getMiniProgramContentPoolId() || pools[0]?.id || ''
  return editingContentPoolId
}

function syncEditingContentPoolToCurrentMiniProgram() {
  const pools = adminSettingsState.contentPools || []
  const boundPoolId = getMiniProgramContentPoolId()
  editingContentPoolId = pools.some((item) => item.id === boundPoolId) ? boundPoolId : pools[0]?.id || ''
  contentPagination = createContentPaginationState()
}

function getAdminContentImportContext() {
  const miniProgram = getCurrentMiniProgram()
  return {
    boundPoolId: getMiniProgramContentPoolId(miniProgram),
    contentPools: (adminSettingsState.contentPools || []).map(({ id, name }) => ({ id, name })),
    miniProgramId: miniProgram?.id || '',
  }
}

function getContentEditorPath(poolId = getEditingContentPoolId()) {
  const miniProgramId = getCurrentMiniProgram()?.id || ''
  const query = new URLSearchParams()
  if (poolId) query.set('poolId', poolId)
  if (miniProgramId) query.set('miniProgramId', miniProgramId)
  CONTENT_TYPES.forEach((type) => {
    const pagination = contentPagination[type] || createPaginationState()
    query.set(`${type}Page`, String(pagination.page || 1))
    query.set(`${type}PageSize`, String(pagination.pageSize || PAGE_SIZES[0]))
  })
  const text = query.toString()
  return text ? `/api/admin/content?${text}` : '/api/admin/content'
}

function withEditingContentPool(payload, auditAction = '') {
  return {
    ...payload,
    poolId: getEditingContentPoolId(),
    miniProgramId: getCurrentMiniProgram()?.id || '',
    ...(auditAction ? { auditAction } : {}),
  }
}

function getContentSaveAuditAction() {
  const sectionId = document.querySelector('.section.active')?.id
  return {
    content: 'content',
    'daily-content-share': 'share',
    ads: 'ads',
  }[sectionId] || 'content'
}

function renderMiniProgramSwitcher() {
  if (!nodes.mpSelect) return
  const items = getActiveMiniPrograms()
  nodes.mpSelect.innerHTML = items.map((item) => (
    `<option value="${escapeAttr(item.id)}" ${item.id === adminSettingsState.currentMiniProgramId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`
  )).join('')
}

function renderContentPoolOptions(select, selectedId = '') {
  if (!select) return
  select.innerHTML = (adminSettingsState.contentPools || []).map((item) => (
    `<option value="${escapeAttr(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`
  )).join('')
}

function renderContentPools() {
  const editingPoolId = getEditingContentPoolId()
  renderContentPoolOptions(document.querySelector('#contentPoolSelect'), editingPoolId)
  renderContentPoolOptions(nodes.newMpContentPool, adminSettingsState.contentPools?.[0]?.id)
  const fallbackCounts = {
    contentAlbums: contentState.contentAlbums.length,
    contentAudios: contentState.contentAudios.length,
    contentTexts: contentState.contentTexts.length,
    articles: contentState.articles.length,
    letters: contentState.letters.length,
  }
  const summaryByPool = Object.fromEntries((contentState.poolSummaries || []).map((item) => [item.id, item]))
  if (!nodes.contentPoolBody) return
  nodes.contentPoolBody.innerHTML = (adminSettingsState.contentPools || []).map((pool, index) => {
    const usage = (adminSettingsState.miniPrograms || []).filter((item) => item.status !== 'archived' && getMiniProgramContentPoolId(item) === pool.id).length
    const isActive = pool.id === editingPoolId
    const counts = summaryByPool[pool.id] || (isActive ? fallbackCounts : {})
    return `
      <tr class="pool-row ${isActive ? 'active' : ''}" data-pool-id="${escapeAttr(pool.id)}" data-pool="${escapeAttr(pool.name)}">
        <td data-label="ID">${rowNumber(index)}</td>
        <td data-label="名称"><strong>${escapeHtml(pool.name)}</strong></td>
        <td data-label="备注">${escapeHtml(pool.remark || '-')}</td>
        <td data-label="文案">${Number(counts.contentTexts || 0)}</td>
        <td data-label="音频">${Number(counts.contentAudios || 0)}</td>
        <td data-label="图片">${Number(counts.contentAlbums || 0)}</td>
        <td data-label="文章">${Number(counts.articles || 0)}</td>
        <td data-label="心笺">${Number(counts.letters || 0)}</td>
        <td data-label="已关联">${usage} 个小程序</td>
        <td data-label="操作">
          <button class="btn-text" type="button" data-pool-edit="${escapeAttr(pool.id)}">编辑</button>
          <button class="btn-text btn-danger" type="button" data-pool-delete="${escapeAttr(pool.id)}" ${usage > 0 ? 'disabled title="使用中的内容池不能删除"' : ''}>删除</button>
        </td>
      </tr>
    `
  }).join('')
}

function renderDashboardOperationLogs(items = []) {
  if (!nodes.dashboardOperationLogBody) return
  nodes.dashboardOperationLogBody.innerHTML = (Array.isArray(items) ? items : []).slice(0, 6).map((item, index) => `
    <tr>
      <td data-label="ID">${rowNumber(index)}</td>
      <td data-label="时间">${escapeHtml(item.time)}</td>
      <td data-label="操作者">${escapeHtml(item.actor)}</td>
      <td data-label="操作类型"><span class="badge badge-${escapeAttr(getBadgeClass(item.badge || 'info'))}">${escapeHtml(item.type)}</span></td>
      <td data-label="对象">${escapeHtml(item.target)}</td>
      <td data-label="描述">${escapeHtml(item.description)}</td>
    </tr>
  `).join('') || '<tr><td colspan="6">暂无操作记录</td></tr>'
}

function renderStorageSettings() {
  const storage = adminSettingsState.storage || {}
  document.querySelectorAll('[data-storage-field]').forEach((field) => {
    const key = field.dataset.storageField
    field.value = storage[key] || ''
    if (key === 'secretKey') {
      renderManagedSecretInput('storageSecretKeyInput', storage.secretKeyMasked)
      field.placeholder = '输入 SecretKEY'
    }
  })
  const configured = Boolean(storage.secretId && storage.secretKeyConfigured && storage.bucket && storage.region)
  setStorageConnectionStatus(configured ? '' : '尚未配置 COS', configured ? '' : 'error')
}

function renderSystemSettings() {
  const system = contentState.system || {}
  document.querySelector('[data-system-field="homeHero"]').value = system.homeHero || ''
  document.querySelector('[data-system-field="lettersHero"]').value = system.lettersHero || ''
  document.querySelector('[data-system-field="articlesHero"]').value = system.articlesHero || ''
  document.querySelector('[data-system-field="checkinButtonText"]').value = system.checkinButtonText || ''
  document.querySelector('[data-system-field="checkinBeforeTexts"]').value = (system.checkinBeforeTexts || []).join('\n')
  document.querySelector('[data-system-field="checkinAfterTexts"]').value = (system.checkinAfterTexts || []).join('\n')
  document.querySelector('[data-system-field="checkinAdIncompleteText"]').value = system.checkinAdIncompleteText || ''
  document.querySelector('[data-system-field="dailyContentButtonText"]').value = system.dailyContentButtonText || ''
  document.querySelector('[data-system-field="dailyContentPromptTexts"]').value = (system.dailyContentPromptTexts || []).join('\n')
  document.querySelector('[data-system-field="dailyContentAdIncompleteText"]').value = system.dailyContentAdIncompleteText || ''
  document.querySelector('[data-system-field="articleAdIncompleteText"]').value = system.articleAdIncompleteText || ''
  const lettersSortMode = document.querySelector('[data-system-field="lettersSortMode"]')
  if (lettersSortMode) lettersSortMode.value = system.lettersSortMode === 'sequence' ? 'sequence' : 'random'
  const articlesSortMode = document.querySelector('[data-system-field="articlesSortMode"]')
  if (articlesSortMode) articlesSortMode.value = system.articlesSortMode === 'sequence' ? 'sequence' : 'random'
  Object.entries(system.homeStats || {}).forEach(([key, item]) => {
    const labelInput = document.querySelector(`[data-home-stat-label="${key}"]`)
    const visibleInput = document.querySelector(`[data-home-stat-visible="${key}"]`)
    if (labelInput) labelInput.value = item.label || ''
    if (visibleInput) visibleInput.checked = item.visible !== false
  })
  Object.entries(system.tabs || {}).forEach(([key, item]) => {
    const labelInput = document.querySelector(`[data-tab-field="${key}"]`)
    const visibleInput = document.querySelector(`[data-tab-visible="${key}"]`)
    if (labelInput) labelInput.value = item.label || ''
    if (visibleInput) visibleInput.checked = item.visible !== false
  })
}

function renderSecuritySettings() {
  const security = adminSettingsState.security || {}
  document.querySelector('[data-security-field="textCheck"]').checked = security.textCheck !== false
  document.querySelector('[data-security-field="imageCheck"]').checked = security.imageCheck !== false
  renderKeywordEditor('blockedWords', security.blockedWords || [])
  renderSecurityStats()
}

function renderKeywordEditor(field, words) {
  const list = document.querySelector(`[data-keyword-list="${field}"]`)
  if (!list) return
  list.innerHTML = ''
  if (Array.isArray(words) && words.length) {
    appendKeywordBatch(field, words.join('；'))
  }
}

function appendKeywordBatch(field, value = '') {
  const list = document.querySelector(`[data-keyword-list="${field}"]`)
  if (!list) return
  list.insertAdjacentHTML('beforeend', `
    <div class="keyword-row">
      <textarea data-keyword-field="${escapeAttr(field)}" rows="3" placeholder="输入关键词，多个关键词用中文分号「；」隔开">${escapeHtml(value)}</textarea>
      <button class="btn-text btn-danger" type="button" data-remove-keyword="${escapeAttr(field)}">删除</button>
    </div>
  `)
}

function collectKeywordList(field) {
  const words = [...document.querySelectorAll(`[data-keyword-field="${field}"]`)]
    .flatMap((item) => item.value.split(/[；;\r\n]+/))
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(words)]
}

function getMessageCounts() {
  return messageState.reduce((counts, item) => {
    const status = item.status || 'saved'
    counts[status] = (counts[status] || 0) + 1
    const securityStatus = item.security?.status || 'passed'
    counts[`security:${securityStatus}`] = (counts[`security:${securityStatus}`] || 0) + 1
    return counts
  }, {})
}

function renderSecurityStats() {
  if (!nodes.securityStats) return
  const counts = getMessageCounts()
  const cards = [
    ['已通过', counts.saved || 0],
    ['已拦截', counts.blocked || 0],
    ['未检测', counts['security:unchecked'] || 0],
  ]
  nodes.securityStats.innerHTML = cards.map(([label, value]) => `
    <article class="stat-card">
      <span class="stat-value">${value}</span>
      <span class="stat-label">${escapeHtml(label)}</span>
    </article>
  `).join('')
}

function renderMiniProgramInfo() {
  const item = getCurrentMiniProgram()
  if (!item) return
  document.querySelector('[data-mp-field="name"]').value = item.name || ''
  document.querySelector('[data-mp-field="appId"]').value = item.appId || ''
  document.querySelector('[data-mp-field="developerEmail"]').value = item.developerEmail || ''
  const appSecretInput = nodes.appSecretInput
  if (appSecretInput) {
    renderManagedSecretInput('miniProgramAppSecretInput', item.appSecretMasked)
    appSecretInput.dataset.secretOwnerId = item.id
    appSecretInput.placeholder = '输入 AppSecret'
  }
  document.querySelector('[data-mp-field="remark"]').value = item.remark || ''
  renderContentPoolOptions(document.querySelector('[data-mp-field="contentPoolId"]'), getMiniProgramContentPoolId(item))
  const dailyContentTypes = getMiniProgramConfig(item).dailyContentTypes || {}
  const messagesEnabled = document.querySelector('[data-feature-field="messagesEnabled"]')
  const imageEnabled = document.querySelector('[data-daily-content-type-field="imageEnabled"]')
  const audioEnabled = document.querySelector('[data-daily-content-type-field="audioEnabled"]')
  imageEnabled.value = dailyContentTypes.imageEnabled !== false ? 'enabled' : 'disabled'
  audioEnabled.value = dailyContentTypes.audioEnabled === true ? 'enabled' : 'disabled'
  if (messagesEnabled) messagesEnabled.value = getMiniProgramConfig(item).messagesEnabled === false ? 'disabled' : 'enabled'
  renderLimitConfigEditor(getMiniProgramConfig(item).limits)
  if (nodes.miniProgramDataMode) nodes.miniProgramDataMode.value = getMiniProgramDataMode(item)
  if (nodes.miniProgramMode) nodes.miniProgramMode.value = getMiniProgramConfig(item).mode === 'audit' ? 'audit' : 'default'
  const lettersSortMode = document.querySelector('[data-system-field="lettersSortMode"]')
  if (lettersSortMode) {
    lettersSortMode.value = getMiniProgramConfig(item).system?.lettersSortMode === 'sequence' ? 'sequence' : 'random'
  }
  const articlesSortMode = document.querySelector('[data-system-field="articlesSortMode"]')
  if (articlesSortMode) {
    articlesSortMode.value = getMiniProgramConfig(item).system?.articlesSortMode === 'sequence' ? 'sequence' : 'random'
  }
  renderArticleDisplaySettings(getMiniProgramConfig(item).articleDisplay)
}

function renderArticleDisplaySettings(articleDisplay = {}) {
  if (!nodes.articleListLayout) return
  nodes.articleListLayout.value = ['title-left', 'stacked', 'mixed'].includes(articleDisplay.layout) ? articleDisplay.layout : 'mixed'
  nodes.articleExpandPosition.value = ['earliest', 'early', 'medium', 'late', 'latest'].includes(articleDisplay.previewPreset) ? articleDisplay.previewPreset : 'early'
  nodes.articleExpandText.value = articleDisplay.expandButtonText || '展开全文'
  nodes.articleHideFullArticle.value = articleDisplay.hideFullArticle === false ? 'visible' : 'hidden'
}

async function saveArticleDisplaySettings() {
  const current = getCurrentMiniProgram()
  if (!current) return
  const currentConfig = getMiniProgramConfig(current)
  const config = {
    ...currentConfig,
    articleDisplay: {
      ...(currentConfig.articleDisplay || {}),
      expandButtonText: nodes.articleExpandText?.value.trim() || '展开全文',
      previewPreset: ['earliest', 'early', 'medium', 'late', 'latest'].includes(nodes.articleExpandPosition?.value) ? nodes.articleExpandPosition.value : 'early',
      hideFullArticle: nodes.articleHideFullArticle?.value !== 'visible',
    },
  }
  const restore = setButtonsLoading([nodes.articleDisplaySettingsSave], '保存中…')
  try {
    await saveMiniProgramRequest('/api/admin/miniprogram/config', {
      id: current.id,
      config,
      meta: { type: '小程序配置', target: current.name, description: '文章设置已保存' },
    })
    await apiRequest('/api/admin/content', {
      method: 'POST',
      body: JSON.stringify(withEditingContentPool(
        { system: collectSystemSettings() },
        'display',
      )),
    })
    await loadContentEditor()
    await refreshAdminOverview()
    renderArticleDisplaySettings(config.articleDisplay)
    showToast('文章设置已保存')
  } catch (error) {
    showToast(error.message || '文章设置保存失败')
  } finally {
    restore()
  }
}

function setSecretVisibilityById(inputId, visible) {
  const input = document.querySelector(`#${inputId}`)
  const toggle = document.querySelector(`[data-secret-toggle="${inputId}"]`)
  if (!input || !toggle) return
  input.type = visible ? 'text' : 'password'
  toggle.textContent = visible ? '隐藏' : '显示'
  toggle.setAttribute('aria-pressed', String(visible))
}

function renderManagedSecretInput(inputId, maskedValue = '') {
  const input = document.querySelector(`#${inputId}`)
  const toggle = document.querySelector(`[data-secret-toggle="${inputId}"]`)
  if (!input || !toggle) return
  const masked = String(maskedValue || '')
  input.value = masked
  input.type = masked ? 'text' : 'password'
  input.dataset.secretDirty = 'false'
  input.dataset.secretMasked = masked
  input.dataset.secretRevealed = 'false'
  delete input.dataset.secretRequestId
  toggle.textContent = '显示'
  toggle.disabled = !masked
  toggle.setAttribute('aria-pressed', 'false')
}

function collectManagedSecret(input) {
  return input?.dataset.secretDirty === 'true' ? input.value.trim() : ''
}

async function toggleManagedSecret(inputId) {
  const input = document.querySelector(`#${inputId}`)
  const toggle = document.querySelector(`[data-secret-toggle="${inputId}"]`)
  if (!input || !toggle) return

  if (input.dataset.secretDirty === 'true') {
    setSecretVisibilityById(inputId, input.type === 'password')
    return
  }
  if (input.dataset.secretRevealed === 'true') {
    renderManagedSecretInput(inputId, input.dataset.secretMasked)
    return
  }

  const secret = input.dataset.secretReveal
  const miniProgramId = getCurrentMiniProgram()?.id || ''
  if (secret === 'appSecret' && input.dataset.secretOwnerId !== miniProgramId) return
  const requestId = makeId('secret-reveal')
  input.dataset.secretRequestId = requestId
  const restoreButton = setButtonsLoading([toggle], '读取中…')
  try {
    const body = { secret }
    if (body.secret === 'appSecret') body.miniProgramId = miniProgramId
    const data = await apiRequest('/api/admin/secrets/reveal', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (input.dataset.secretRequestId !== requestId) return
    if (secret === 'appSecret'
      && (getCurrentMiniProgram()?.id !== miniProgramId || input.dataset.secretOwnerId !== miniProgramId)) return
    input.value = String(data.value || '')
    input.type = 'text'
    input.dataset.secretRevealed = 'true'
    toggle.textContent = '隐藏'
    toggle.setAttribute('aria-pressed', 'true')
  } catch (error) {
    if (input.dataset.secretRequestId === requestId
      && (secret !== 'appSecret' || getCurrentMiniProgram()?.id === miniProgramId)) {
      showToast(error.message || '密钥读取失败')
    }
  } finally {
    if (input.dataset.secretRequestId !== requestId) return
    delete input.dataset.secretRequestId
    restoreButton()
    if (input.dataset.secretRevealed === 'true') {
      toggle.textContent = '隐藏'
      toggle.setAttribute('aria-pressed', 'true')
    }
  }
}

function renderMiniPrograms() {
  if (!nodes.miniProgramBody) return
  const items = getActiveMiniPrograms()
  nodes.miniProgramBody.innerHTML = items.map((item, index) => `
    <tr>
      <td data-label="名称"><strong>${escapeHtml(item.name)}</strong></td>
      <td data-label="绑定内容池">${escapeHtml(getContentPoolName(getMiniProgramContentPoolId(item)))}</td>
      <td data-label="AppID">${escapeHtml(item.appId)}</td>
      <td data-label="最近上传版本">${escapeHtml(item.lastUpload?.version || '未上传')}</td>
      <td data-label="分组"><span>${escapeHtml(item.group || '未分组')}</span> <button class="btn-text" type="button" data-mp-group="${escapeAttr(item.id)}" aria-label="修改分组">改</button></td>
      <td data-label="备注">${escapeHtml(item.remark || '-')}</td>
      <td data-label="排序">
        <div class="mini-program-order-actions">
          <button class="btn-text btn-order" type="button" data-mp-reorder="${escapeAttr(item.id)}" data-mp-direction="up" title="上移「${escapeAttr(item.name)}」" aria-label="上移「${escapeAttr(item.name)}」" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-text btn-order" type="button" data-mp-reorder="${escapeAttr(item.id)}" data-mp-direction="down" title="下移「${escapeAttr(item.name)}」" aria-label="下移「${escapeAttr(item.name)}」" ${index === items.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
      </td>
      <td data-label="操作">
        <div class="mini-program-row-actions">
          <button class="btn-text" type="button" data-mp-edit="${escapeAttr(item.id)}">编辑</button>
          <button class="btn-text" type="button" data-mp-upload="${escapeAttr(item.id)}">上传</button>
          <button class="btn-text btn-danger" type="button" data-mp-delete="${escapeAttr(item.id)}" ${items.length <= 1 ? `disabled title="至少保留一个小程序" aria-label="无法删除「${escapeAttr(item.name)}」：至少保留一个小程序"` : `aria-label="删除「${escapeAttr(item.name)}」"`}>删除</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8">暂无已接入的小程序</td></tr>'
}

async function editMiniProgramGroup(id) {
  if (groupAssignSaving) return
  const item = adminSettingsState.miniPrograms.find((program) => program.id === id)
  if (!item) return
  nodes.groupAssignModal.dataset.miniProgramId = id
  renderGroupOptions(nodes.groupAssignSelect, adminSettingsState.groups, '未分组', item.group || '')
  setStatus(nodes.groupAssignStatus, '')
  openModal(nodes.groupAssignModal)
}

function renderGroupManager() {
  const groups = groupManagerDraft
  nodes.groupManagerList.innerHTML = groups.length ? groups.map((group, index) => `
    <div class="group-manager-row"><input type="text" maxlength="30" value="${escapeAttr(group.name)}" data-group-index="${index}" data-group-original="${escapeAttr(group.original)}" aria-label="分组名称" /><button class="btn-text btn-danger" type="button" data-group-remove="${index}">删除</button></div>
  `).join('') : '<p class="modal-hint">暂无分组</p>'
}

function openGroupManager() {
  if (groupManagerSaving) return
  groupManagerBaseGroups = [...(adminSettingsState.groups || [])]
  groupManagerDraft = groupManagerBaseGroups.map((name) => ({ name, original: name }))
  renderGroupManager()
  nodes.groupManagerNewName.value = ''
  setStatus(nodes.groupManagerStatus, '')
  openModal(nodes.groupManagerModal)
}

function readGroupManagerDraft() {
  return [...nodes.groupManagerList.querySelectorAll('[data-group-index]')]
    .map((input) => ({ original: input.dataset.groupOriginal || '', name: input.value.trim() }))
}

function validateGroupDraft(groups) {
  if (groups.length > 50) throw new Error('最多可设置 50 个分组')
  if (groups.some((group) => !group.name)) throw new Error('分组名称不能为空；如需移除，请点击删除')
  if (groups.some((group) => [...group.name].length > 30)) throw new Error('分组名称不能超过 30 个字')
  if (new Set(groups.map((group) => group.name)).size !== groups.length) throw new Error('分组名称不能重复')
}

function addGroupManagerDraft() {
  if (groupManagerSaving) return
  const name = nodes.groupManagerNewName.value.trim()
  if (!name) return
  try {
    const groups = [...readGroupManagerDraft(), { original: '', name }]
    validateGroupDraft(groups)
    groupManagerDraft = groups
    renderGroupManager()
    nodes.groupManagerNewName.value = ''
    setStatus(nodes.groupManagerStatus, '')
  } catch (error) {
    setStatus(nodes.groupManagerStatus, error.message, 'error')
  }
}

function setGroupModalSaving(modal, saving) {
  modal.querySelectorAll('button, input, select').forEach((control) => { control.disabled = saving })
  modal.setAttribute('aria-busy', String(saving))
}

async function saveGroupManager() {
  if (groupManagerSaving) return
  const groups = readGroupManagerDraft()
  const pendingName = nodes.groupManagerNewName.value.trim()
  if (pendingName) groups.push({ original: '', name: pendingName })
  try {
    validateGroupDraft(groups)
  } catch (error) {
    setStatus(nodes.groupManagerStatus, error.message, 'error')
    return
  }
  groupManagerSaving = true
  setGroupModalSaving(nodes.groupManagerModal, true)
  setStatus(nodes.groupManagerStatus, '')
  try {
    const selected = nodes.dashboardGroupFilter?.value || ''
    const data = await apiRequest('/api/admin/groups', {
      method: 'POST',
      body: JSON.stringify({ groups, expectedGroups: groupManagerBaseGroups }),
    })
    renderAdminSettings(data)
    renderGroupOptions(nodes.dashboardGroupFilter, data.groups, '全部', selected ? groups.find((group) => group.original === selected)?.name || '' : '')
    closeModal(nodes.groupManagerModal)
    showToast('分组已保存')
    void refreshAdminOverview({ reloadPreflight: false })
  } catch (error) {
    setStatus(nodes.groupManagerStatus, error.message || '保存分组失败，请重试', 'error')
    if ([400, 409].includes(error.status)) await loadAdminSettings().catch(() => {})
  } finally {
    groupManagerSaving = false
    setGroupModalSaving(nodes.groupManagerModal, false)
  }
}

async function saveMiniProgramGroup() {
  if (groupAssignSaving) return
  const id = nodes.groupAssignModal.dataset.miniProgramId || ''
  const group = nodes.groupAssignSelect.value || ''
  groupAssignSaving = true
  setGroupModalSaving(nodes.groupAssignModal, true)
  setStatus(nodes.groupAssignStatus, '')
  try {
    const data = await apiRequest('/api/admin/miniprogram/update', { method: 'POST', body: JSON.stringify({ id, miniProgram: { group } }) })
    renderAdminSettings(data)
    closeModal(nodes.groupAssignModal)
    showToast('小程序分组已保存')
    void refreshAdminOverview({ reloadPreflight: false })
  } catch (error) {
    setStatus(nodes.groupAssignStatus, error.message || '保存小程序分组失败，请重试', 'error')
    if ([400, 409].includes(error.status)) await loadAdminSettings().catch(() => {})
  } finally {
    groupAssignSaving = false
    setGroupModalSaving(nodes.groupAssignModal, false)
  }
}

function applyAdminSettings(data) {
  // A successful mutation is authoritative; earlier reads must not restore old groups.
  adminSettingsRequestId += 1
  adminOverviewRequestId += 1
  adminSettingsState = data || adminSettingsState
  renderGroupOptions(nodes.dashboardGroupFilter, adminSettingsState.groups, '全部')
  renderGroupOptions(nodes.groupAssignSelect, adminSettingsState.groups, '未分组')
}

function renderAdminSettings(data) {
  applyAdminSettings(data)
  renderShareCardCatalog(adminSettingsState.shareSettings || {})
  renderMiniProgramSwitcher()
  renderContentPools()
  renderStorageSettings()
  renderSecuritySettings()
  renderMiniProgramInfo()
  renderMiniPrograms()
  updateCurrentMiniProgramName()
}

async function loadAdminAuth() {
  const data = await apiRequest('/api/admin/session')
  adminAuthState = {
    account: data.account || 'admin',
    passwordConfigured: Boolean(data.passwordConfigured),
    passwordResetHint: data.passwordResetHint || '',
    session: data.session || { createdAt: '', expiresAt: '' },
  }
  renderAdminAuth()
  return data
}

async function loadAdminSettings() {
  const requestId = ++adminSettingsRequestId
  const data = await apiRequest('/api/admin/settings')
  if (requestId === adminSettingsRequestId) renderAdminSettings(data)
  return data
}

async function saveAdminSettings(settings, meta) {
  const data = await apiRequest('/api/admin/settings', {
    method: 'POST',
    body: JSON.stringify({ settings, meta }),
  })
  renderAdminSettings(data)
  await refreshAdminOverview()
  return data
}

async function saveMiniProgramRequest(path, body) {
  const data = await apiRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  renderAdminSettings(data)
  await refreshAdminOverview()
  return data
}

function updateCurrentMiniProgramName() {
  const name = getCurrentMiniProgram()?.name || nodes.mpSelect?.options[nodes.mpSelect.selectedIndex]?.text || '默认小程序'
  document.querySelectorAll('[data-mp-hint]').forEach((item) => { item.textContent = `当前小程序：${name}` })
  document.querySelectorAll('[data-current-mp-name]').forEach((item) => { item.textContent = name })
}

function showSection(target) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.section === target)
  })
  document.querySelectorAll('.section').forEach((item) => {
    item.classList.toggle('active', item.id === target)
  })
  if (nodes.breadcrumbLabel) nodes.breadcrumbLabel.textContent = sectionNames[target] || target
  window.scrollTo({ top: 0, behavior: 'auto' })
  requestAnimationFrame(() => resizeAllTextareas(document.querySelector(`#${target}`) || document))
}

async function refreshMiniProgramTable(message) {
  const requestId = ++adminSettingsRequestId
  try {
    const data = await apiRequest('/api/admin/settings')
    if (requestId !== adminSettingsRequestId) return
    applyAdminSettings(data)
    renderMiniProgramSwitcher()
    renderMiniPrograms()
    updateCurrentMiniProgramName()
    if (message) showToast(message)
  } catch (error) {
    showToast(`${message || '小程序列表'}已更新，但列表刷新失败，请手动重试`)
  }
}

window.showSection = showSection

function syncContentPoolCounts() {
  const counts = {
    contentAlbums: contentState.contentAlbums.length,
    contentAudios: contentState.contentAudios.length,
    contentTexts: contentState.contentTexts.length,
    articles: contentState.articles.length,
    letters: contentState.letters.length,
  }
  Object.entries(counts).forEach(([key, value]) => {
    document.querySelectorAll(`[data-count="${key}"]`).forEach((item) => { item.textContent = String(value) })
  })
}

function compactPreview(value, max = 34) {
  const text = String(value || '').trim()
  if (text.length <= max) return text || '-'
  return `${text.slice(0, max)}...`
}

function rowNumber(index) {
  return `<span class="row-number">${Number(index) + 1}</span>`
}

function getPaginationPages(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, 'ellipsis-end', totalPages]
  if (page >= totalPages - 3) return [1, 'ellipsis-start', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, 'ellipsis-start', page - 1, page, page + 1, 'ellipsis-end', totalPages]
}

function renderPagination(scope, pagination = {}) {
  const page = Math.max(1, Number(pagination.page || 1))
  const totalPages = Math.max(1, Number(pagination.totalPages || 1))
  const total = Number(pagination.total || 0)
  const pageButtons = getPaginationPages(page, totalPages).map((entry) => (
    typeof entry === 'number'
      ? `<button class="btn-page ${entry === page ? 'is-active' : ''}" type="button" data-page-scope="${escapeAttr(scope)}" data-page="${entry}" ${entry === page ? 'disabled aria-current="page"' : ''}>${entry}</button>`
      : '<span class="pagination-ellipsis" aria-hidden="true">...</span>'
  )).join('')
  return `
    <div class="table-pagination">
      <label class="table-page-size">每页
        <select data-page-size-scope="${escapeAttr(scope)}" aria-label="每页条数">
          ${PAGE_SIZES.map((size) => `<option value="${size}" ${size === Number(pagination.pageSize || PAGE_SIZES[0]) ? 'selected' : ''}>${size}</option>`).join('')}
        </select>
        条
      </label>
      <button class="btn-page-nav" type="button" data-page-scope="${escapeAttr(scope)}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <div class="table-pagination-pages" aria-label="页码">${pageButtons}</div>
      <span class="table-pagination-total">共 ${total} 条</span>
      <button class="btn-page-nav" type="button" data-page-scope="${escapeAttr(scope)}" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
    </div>
  `
}

window.AdminPagination = {
  register(scope, handler) {
    if (scope && typeof handler === 'function') adminPaginationHandlers.set(scope, handler)
  },
  render: renderPagination,
}
window.getAdminContentImportContext = getAdminContentImportContext

function renderThumbStrip(images = []) {
  const items = Array.isArray(images) ? images : []
  if (!items.length) return '0 张'
  return `<div class="thumb-strip">${items.slice(0, 9).map((image, index) => {
    const label = escapeHtml(image.id || image.label || String(index + 1).padStart(2, '0'))
    const href = escapeAttr(image.mediumUrl || image.thumbUrl || '#')
    const src = escapeAttr(image.thumbUrl || image.mediumUrl || '')
    return `<a class="thumb-link ${src ? 'has-image' : `thumb-${['a', 'b', 'c', 'd', 'e', 'f'][index % 6]}`}" href="${href}" target="_blank">${src ? `<img src="${src}" alt="">` : ''}<span>${label}</span></a>`
  }).join('')}</div>`
}

function getContentTypeLabel(type) {
  return {
    contentTexts: '文案手记',
    contentAudios: '音频手记',
    contentAlbums: '图册手记',
    letters: '心笺',
  }[type] || '内容'
}

function setActiveContentEditorType(type) {
  if (!CONTENT_EDITOR_TYPES.includes(type)) return
  activeContentEditorType = type
  document.querySelectorAll('[data-content-type]').forEach((tab) => {
    const active = tab.dataset.contentType === type
    tab.classList.toggle('active', active)
    tab.setAttribute('aria-selected', String(active))
  })
  document.querySelectorAll('[data-content-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.contentPanel !== type
  })
}

function clearContentSelection() {
  contentSelection = createContentSelectionState()
}

function renderContentSelectionCell(type, item) {
  const selected = contentSelection[type]?.has(item.id)
  return `<td class="content-select-cell" data-label="选择"><input type="checkbox" data-content-select="${type}" data-content-id="${escapeAttr(item.id)}" aria-label="选择${getContentTypeLabel(type)}" ${selected ? 'checked' : ''}></td>`
}

function syncContentSelection(type) {
  const selected = contentSelection[type] || new Set()
  const items = contentState[type] || []
  const selectedCount = [...selected].filter((id) => items.some((item) => item.id === id)).length
  const batchButton = document.querySelector(`[data-content-batch-delete="${type}"]`)
  if (batchButton) {
    batchButton.disabled = selectedCount === 0
    batchButton.textContent = '批量删除'
  }
  const selectAll = document.querySelector(`[data-content-select-all="${type}"]`)
  if (selectAll) {
    selectAll.checked = Boolean(items.length) && selectedCount === items.length
    selectAll.indeterminate = selectedCount > 0 && selectedCount < items.length
  }
}

function hasUnsavedContentEdits(type) {
  return JSON.stringify(collectContentEditor({ includeConfig: false })[type] || []) !== JSON.stringify(contentFormSnapshots[type] || [])
}

function renderContentRowActions(type, index) {
  return `<div class="content-row-actions"><button class="btn-text" type="button" data-save-content-item="${type}" data-index="${index}">保存</button><button class="btn-text btn-danger" type="button" data-remove-content="${type}" data-index="${index}">删除</button></div>`
}

function renderDailyContentNoteEditor(items) {
  nodes.contentTextEditor.innerHTML = (items || []).map((item, index) => `
    <tr>
      ${renderContentSelectionCell('contentTexts', item)}
      <td data-label="ID">${rowNumber(index)}</td>
      <td data-label="标签"><input data-content-text-field="label" class="content-label-input" data-index="${index}" value="${escapeAttr(item.label || '默认')}" placeholder="标签"></td>
      <td data-label="文案"><textarea data-content-text-field="text" data-index="${index}" rows="1" placeholder="输入文案手记">${escapeHtml(item.text || '')}</textarea></td>
      <td data-label="字数">${String(item.text || '').trim().length}</td>
      <td data-label="操作">${renderContentRowActions('contentTexts', index)}</td>
    </tr>
  `).join('')
}

function getAudioDisplayName(item = {}) {
  return String(item.title || '').trim()
    || String(item.originalFilename || '').replace(/\.[^.]+$/, '').trim()
    || '轻读音频'
}

function formatAudioDuration(seconds) {
  const duration = Number(seconds || 0)
  if (!Number.isFinite(duration) || duration <= 0) return '-'
  const total = Math.round(duration)
  const minutes = Math.floor(total / 60)
  const remainingSeconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${remainingSeconds}`
}

function formatAudioPlaybackTime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function getAdminAudioItem() {
  return (contentState.contentAudios || []).find((item) => String(item.id) === String(activeAdminAudioId)) || null
}

function syncAdminAudioPlayer() {
  if (!nodes.adminAudioPlayer) return
  const item = getAdminAudioItem()
  const audio = adminAudio
  const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : Number(item?.durationSeconds || 0)
  const current = audio ? Math.max(0, Number(audio.currentTime) || 0) : 0
  const playing = Boolean(audio && !audio.paused && !audio.ended && activeAdminAudioId)
  const buffering = adminAudioLoading || Boolean(audio && activeAdminAudioId && audio.readyState < 3 && !audio.paused)
  const hasError = adminAudioError
  nodes.adminAudioPlayer.classList.toggle('hidden', !item)
  if (nodes.adminAudioTitle) nodes.adminAudioTitle.textContent = item ? getAudioDisplayName(item) : '未选择音频'
  if (nodes.adminAudioCurrent) nodes.adminAudioCurrent.textContent = formatAudioPlaybackTime(current)
  if (nodes.adminAudioRemaining) nodes.adminAudioRemaining.textContent = `剩余 ${formatAudioPlaybackTime(Math.max(0, duration - current))}`
  if (nodes.adminAudioDuration) nodes.adminAudioDuration.textContent = formatAudioPlaybackTime(duration)
  if (nodes.adminAudioProgress) {
    nodes.adminAudioProgress.max = String(Math.max(0, duration))
    nodes.adminAudioProgress.value = String(Math.min(current, duration || current))
    nodes.adminAudioProgress.disabled = !item || !duration || buffering
  }
  if (nodes.adminAudioToggle) {
    nodes.adminAudioToggle.disabled = !item || buffering
    nodes.adminAudioToggle.setAttribute('aria-label', playing ? '暂停音频' : '播放音频')
    nodes.adminAudioToggle.setAttribute('title', playing ? '暂停音频' : '播放音频')
    nodes.adminAudioToggle.querySelector('[data-audio-icon-play]')?.classList.toggle('hidden', playing)
    nodes.adminAudioToggle.querySelector('[data-audio-icon-pause]')?.classList.toggle('hidden', !playing)
  }
  if (nodes.adminAudioRestart) nodes.adminAudioRestart.disabled = !item || buffering
  if (nodes.adminAudioStatus) nodes.adminAudioStatus.textContent = hasError ? '音频暂时无法播放' : buffering ? '正在加载音频…' : playing ? '正在播放' : audio?.ended ? '播放结束' : '已暂停'
  document.querySelectorAll('[data-audio-play]').forEach((button) => {
    const isActive = String(button.dataset.audioPlay) === String(activeAdminAudioId)
    const isPlaying = isActive && playing
    button.textContent = isPlaying ? '暂停' : '试听'
    button.setAttribute('aria-label', `${isPlaying ? '暂停' : '试听'} ${button.dataset.audioTitle || '音频'}`)
    button.classList.toggle('is-playing', isPlaying)
  })
}

function ensureAdminAudio() {
  if (adminAudio) return adminAudio
  adminAudio = new Audio()
  adminAudio.preload = 'none'
  ;['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended', 'canplay'].forEach((eventName) => {
    adminAudio.addEventListener(eventName, () => {
      if (eventName === 'canplay') adminAudioLoading = false
      if (eventName === 'ended') adminAudioLoading = false
      syncAdminAudioPlayer()
    })
  })
  ;['waiting', 'loadstart'].forEach((eventName) => adminAudio.addEventListener(eventName, () => {
    adminAudioLoading = true
    syncAdminAudioPlayer()
  }))
  adminAudio.addEventListener('error', () => {
    adminAudioLoading = false
    adminAudioError = true
    syncAdminAudioPlayer()
  })
  return adminAudio
}

async function playAdminAudio(item) {
  if (!item?.audioUrl) {
    if (nodes.adminAudioStatus) nodes.adminAudioStatus.textContent = '音频地址暂不可用'
    return
  }
  const audio = ensureAdminAudio()
  if (String(activeAdminAudioId) === String(item.id)) {
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0
      adminAudioError = false
      await audio.play().catch(() => {
        adminAudioError = true
        syncAdminAudioPlayer()
      })
    } else {
      audio.pause()
    }
    syncAdminAudioPlayer()
    return
  }
  audio.pause()
  audio.src = item.audioUrl
  audio.currentTime = 0
  activeAdminAudioId = String(item.id)
  adminAudioLoading = true
  adminAudioError = false
  syncAdminAudioPlayer()
  await audio.play().catch(() => {
    adminAudioLoading = false
    adminAudioError = true
    syncAdminAudioPlayer()
  })
}

function stopAdminAudio() {
  if (!adminAudio) return
  adminAudio.pause()
  adminAudio.currentTime = 0
  adminAudioLoading = false
  adminAudioError = false
  syncAdminAudioPlayer()
}

function handleAdminAudioKeydown(event) {
  const target = event.target
  const isEditable = target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable
  const isAudioControl = target?.closest?.('#adminAudioPlayer, [data-audio-play]')
  const isOtherInteractive = target?.closest?.('button, a, input, textarea, select, [contenteditable="true"]')

  // Keep native text editing behavior. The range input uses pointer dragging;
  // keyboard seeking remains intentionally out of scope for this lightweight player.
  if (isEditable) return
  if (isOtherInteractive && !isAudioControl) return

  // Audio controls have one keyboard action only: Space toggles playback.
  // Suppress native Enter activation so the restart button cannot accidentally
  // become a second keyboard command.
  if (event.key === 'Enter' && isAudioControl) {
    event.preventDefault()
    return
  }
  if (event.code !== 'Space' && event.key !== ' ' && event.key !== 'Spacebar') return
  const item = getAdminAudioItem()
  if (!item) return
  event.preventDefault()
  void playAdminAudio(item)
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`
}

function renderDailyContentAudioEditor(items) {
  if (!nodes.contentAudioEditor) return
  if (activeAdminAudioId && !(items || []).some((item) => String(item.id) === String(activeAdminAudioId))) {
    adminAudio?.pause()
    if (adminAudio) adminAudio.currentTime = 0
    activeAdminAudioId = ''
    adminAudioLoading = false
    adminAudioError = false
  }
  nodes.contentAudioEditor.innerHTML = (items || []).map((item, index) => {
    return `
      <tr>
        ${renderContentSelectionCell('contentAudios', item)}
        <td data-label="ID">${rowNumber(index)}</td>
        <td data-label="标签"><input data-audio-field="label" class="content-label-input" data-index="${index}" value="${escapeAttr(item.label || '默认')}" placeholder="标签"></td>
        <td data-label="标题"><textarea data-audio-field="title" data-index="${index}" rows="1" placeholder="输入标题">${escapeHtml(getAudioDisplayName(item))}</textarea></td>
        <td data-label="原始文件名"><span class="cell-note audio-original-filename" title="${escapeAttr(item.originalFilename || '')}">${escapeHtml(item.originalFilename || '')}</span></td>
        <td data-label="试听"><button class="btn-text audio-preview-button" type="button" data-audio-play="${escapeAttr(item.id)}" data-audio-title="${escapeAttr(getAudioDisplayName(item))}" aria-label="试听 ${escapeAttr(getAudioDisplayName(item))}">试听</button></td>
        <td data-label="时长">${formatAudioDuration(item.durationSeconds)}</td>
        <td data-label="大小">${formatFileSize(item.sizeBytes)}</td>
        <td data-label="操作">${renderContentRowActions('contentAudios', index)}</td>
      </tr>
    `
  }).join('')
  syncAdminAudioPlayer()
}

function renderDailyContentAlbumEditor(items) {
  nodes.contentAlbumEditor.innerHTML = (items || []).map((item, index) => {
    const images = Array.isArray(item.images) ? item.images : []
    const hasError = !images.length || images.some((image) => !image.thumbUrl || !image.mediumUrl)
    return `
    <tr data-album-error="${hasError ? '1' : '0'}">
      ${renderContentSelectionCell('contentAlbums', item)}
      <td data-label="ID">${rowNumber(index)}
        <input type="hidden" data-album-field="likeCount" data-index="${index}" value="${Number(item.likeCount || 0)}">
        <input type="hidden" data-album-field="favoriteCount" data-index="${index}" value="${Number(item.favoriteCount || 0)}">
      </td>
      <td data-label="标签"><input data-album-field="label" class="content-label-input" data-index="${index}" value="${escapeAttr(item.label || '默认')}" placeholder="标签"></td>
      <td data-label="图片预览">${renderThumbStrip(item.images)}</td>
      <td data-label="操作">${renderContentRowActions('contentAlbums', index)}</td>
    </tr>
  `}).join('')
}

function renderLetterEditor(items) {
  nodes.letterEditor.innerHTML = (items || []).map((item, index) => `
    <tr>
      ${renderContentSelectionCell('letters', item)}
      <td data-label="ID">${rowNumber(index)}</td>
      <td data-label="标签"><input data-letter-field="label" class="content-label-input" data-index="${index}" value="${escapeAttr(item.label || '默认')}" placeholder="标签"></td>
      <td data-label="内容">
        <textarea data-letter-field="content" data-index="${index}" rows="1" placeholder="心笺文案">${escapeHtml(item.content || '')}</textarea>
        <input type="hidden" data-letter-field="likeCount" data-index="${index}" value="${Number(item.likeCount || 0)}">
        <input type="hidden" data-letter-field="favoriteCount" data-index="${index}" value="${Number(item.favoriteCount || 0)}">
      </td>
      <td data-label="操作">${renderContentRowActions('letters', index)}</td>
    </tr>
  `).join('')
}

function renderSwitchEditor(group, items) {
  const idField = group === 'ads' ? 'adUnitId' : 'templateId'
  const headers = group === 'ads'
    ? ['广告位名称', '广告单元 adUnitId', '状态']
    : ['模板名称', '模板 ID', '状态']
  const rows = Object.entries(items || {}).map(([key, item], index) => `
    <tr>
      <td>${rowNumber(index)}</td>
      <td><strong>${escapeHtml(item.label || key)}</strong></td>
      <td><input data-config-group="${group}" data-config-key="${key}" data-config-field="${idField}" value="${escapeAttr(item[idField] || '')}" placeholder="${idField}"></td>
      ${group === 'ads' ? `
        <td>
          ${item.adType === 'rewarded' ? `<input data-config-group="${group}" data-config-key="${key}" data-config-field="freeCount" type="number" min="0" max="9" value="${Number(item.freeCount || 0)}" placeholder="免广告次数">` : ''}
          ${item.adType === 'interstitial' ? `<input data-config-group="${group}" data-config-key="${key}" data-config-field="delaySeconds" type="number" min="0" max="300" value="${Number(item.delaySeconds ?? 3)}" placeholder="延迟秒数">` : ''}
        </td>
      ` : ''}
      <td>
        <label class="toggle compact-toggle">
          <input data-config-group="${group}" data-config-key="${key}" data-config-field="enabled" type="checkbox" ${item.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>开启
        </label>
      </td>
    </tr>
  `).join('')
  return `
    <table class="data-table config-table">
      <colgroup><col class="col-id"></colgroup>
      <thead><tr>${['ID', ...headers.slice(0, 2), ...(group === 'ads' ? ['额外规则'] : []), ...headers.slice(2)].map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${headers.length + 1 + (group === 'ads' ? 1 : 0)}">暂无配置</td></tr>`}</tbody>
    </table>
  `
}

function renderAdsEditor(items = {}) {
  const descriptions = {
    homeDailyContentRewarded: '用户打开手记前触发；可设置每日免广告次数。',
    homeCheckInRewarded: '用户打卡前触发；可设置每日免广告次数。',
    homeInterstitial: '进入首页后延迟展示，不中断正常跳转。',
    lettersInterstitial: '进入心笺页后延迟展示。',
    articlesNative: '展示在文章列表内容流里。',
    articlesInterstitial: '进入文章列表页后延迟展示。',
    articleInterstitial: '进入文章详情后延迟展示。',
    articleExpandRewarded: '用户展开文章正文前触发。',
    mineInterstitial: '进入我的页后延迟展示。',
    homeNative: '可选择展示在手记、打卡或统计模块下方。',
    lettersNative: '按设置的位置和间隔展示在心笺内容流里。',
    articlesStartNative: '展示在文章详情开头。',
    articlesEndNative: '展示在文章正文中段与末尾。',
    mineNative: '按设置的位置和间隔展示在我的相关内容列表里。',
  }
  const pages = [
    {
      id: 'home',
      title: '首页',
      note: '统一管理首页内容流、手记和打卡流程中的广告。',
      keys: ['homeDailyContentRewarded', 'homeCheckInRewarded', 'homeNative', 'homeInterstitial'],
    },
    {
      id: 'articles',
      title: '文章',
      note: '前两项控制文章列表页广告，后四项控制文章详情页广告。',
      keys: ['articlesNative', 'articlesInterstitial', 'articleExpandRewarded', 'articleInterstitial', 'articlesStartNative', 'articlesEndNative'],
    },
    {
      id: 'letters',
      title: '心笺',
      note: '心笺页只管理内容流里的原生广告，以及进入页面后的插屏广告。',
      keys: ['lettersNative', 'lettersInterstitial'],
    },
    {
      id: 'mine',
      title: '我的',
      note: '我的页只管理页面内原生广告，以及进入页面后的插屏广告。',
      keys: ['mineNative', 'mineInterstitial'],
    },
  ]
  const listNativeAdKeys = new Set(['lettersNative', 'articlesNative', 'mineNative'])
  const renderAdCard = ([key, item]) => {
    const isListNative = listNativeAdKeys.has(key)
    const isHomeNative = key === 'homeNative' && item.adType === 'native'
    const placement = item.placement
    const layoutClass = item.adType === 'rewarded' ? 'ad-config-card-balanced' : 'ad-config-card-stacked'
    return `
      <article class="config-card ad-config-card ${layoutClass}">
      <div class="config-card-head ad-config-head">
        <div class="config-card-copy">
          <strong>${escapeHtml(item.label || key)}</strong>
          <span>${escapeHtml(descriptions[key] || '按小程序广告位规则展示。')}</span>
        </div>
        <label class="toggle compact-toggle">
          <input data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="enabled" type="checkbox" ${item.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>开启
        </label>
      </div>
      <div class="form-grid">
        <div class="form-field ad-config-id-field">
          <label>广告单元 ID</label>
          <input data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="adUnitId" value="${escapeAttr(item.adUnitId || '')}" placeholder="填写微信广告后台的 adUnitId">
        </div>
        ${isHomeNative ? `
          <div class="form-field">
            <label>广告展示位置</label>
            <select data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="placement">
              ${nativeAdPlacementOptions.map((option) => `<option value="${option.value}" ${placement === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        ${isListNative ? `
          <div class="form-field">
            <label>首次展示在第几条后</label>
            <input data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="firstAfter" type="number" min="1" max="100" step="1" value="${Number(item.firstAfter || 3)}">
          </div>
          <div class="form-field">
            <label>之后每隔几条展示</label>
            <input data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="interval" type="number" min="1" max="100" step="1" value="${Number(item.interval || 10)}">
          </div>
        ` : ''}
        ${item.adType === 'rewarded' ? `
          <div class="form-field">
            <label>每日免广告次数</label>
            <input data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="freeCount" type="number" min="0" max="9" value="${Number(item.freeCount || 0)}">
          </div>
          <div class="form-field">
            <label>激励广告弹窗提醒</label>
            <select data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="confirmPopupEnabled">
              <option value="true" ${item.confirmPopupEnabled !== false ? 'selected' : ''}>开启</option>
              <option value="false" ${item.confirmPopupEnabled === false ? 'selected' : ''}>关闭</option>
            </select>
          </div>
          <div class="form-field">
            <label>无广告时视为看完</label>
            <select data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="allowOnUnavailable">
              <option value="true" ${item.allowOnUnavailable !== false ? 'selected' : ''}>开启</option>
              <option value="false" ${item.allowOnUnavailable === false ? 'selected' : ''}>关闭</option>
            </select>
          </div>
        ` : ''}
        ${item.adType === 'interstitial' ? `
          <div class="form-field">
            <label>插屏延迟（秒）</label>
            <input data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="delaySeconds" type="number" min="0" max="300" value="${Number(item.delaySeconds ?? 3)}">
          </div>
          <div class="form-field">
            <label>插屏循环（秒）</label>
            <input data-config-group="ads" data-config-key="${escapeAttr(key)}" data-config-field="repeatSeconds" type="number" min="0" max="300" step="1" value="${Number(item.repeatSeconds ?? 90)}" placeholder="设为 0 时只展示一次">
          </div>
        ` : ''}
      </div>
      </article>
    `
  }
  const editorItems = mergeArticleAdEditorItems(items)
  const pageCards = pages.map((page) => {
    const rows = page.keys
      .filter((key) => editorItems[key])
      .map((key) => renderAdCard([key, editorItems[key]]))
      .join('')
    return `
      <article class="panel ad-page-card" data-ad-page="${escapeAttr(page.id)}">
        <div class="panel-header ad-page-card-title">
          <div>
            <h3>${escapeHtml(page.title)}</h3>
            <p>${escapeHtml(page.note)}</p>
          </div>
          <button class="btn-primary" type="button" data-save-ad-page="${escapeAttr(page.id)}">保存</button>
        </div>
        ${rows || '<div class="empty-panel">暂无广告配置</div>'}
      </article>
    `
  }).join('')
  return `<div class="ads-page-grid">${pageCards}</div>`
}

function renderOpsConfigEditor(data) {
  nodes.adsConfigEditor.innerHTML = renderAdsEditor(data.ads)
}

function normalizeDailyContentDailyLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 3
  return Math.min(9, Math.max(0, Math.floor(number)))
}

function renderLimitConfigEditor(limits = {}) {
  if (!nodes.limitConfigEditor) return
  const dailyContentLimit = normalizeDailyContentDailyLimit(limits.dailyContentLimit)
  nodes.limitConfigEditor.innerHTML = `
    <div class="form-field">
      <label>单用户每日手记上限</label>
      <p class="field-hint">每位用户每天最多打开多少篇，填 0 表示不限制。</p>
      <input data-limit-field="dailyContentLimit" type="number" min="0" max="9" step="1" value="${dailyContentLimit}">
    </div>
  `
}

function getShareCardPreviewUrl(imageUrl) {
  const fileName = String(imageUrl || '').split('/').pop()
  return fileName ? `${API_BASE}/admin/share-covers/${encodeURIComponent(fileName)}` : ''
}

function getShareCoverPreviewUrl(cover = {}) {
  const imageUrl = String(cover.imageUrl || '').trim()
  if (imageUrl.startsWith('/assets/images/')) return getShareCardPreviewUrl(imageUrl)
  if (imageUrl) return imageUrl
  const assets = [...(contentState.imageAssets || []), ...imageState]
  const image = assets.find((item) => item.id === cover.imageId)
  return image?.mediumUrl || image?.thumbUrl || ''
}

const shareContentTypes = ['text', 'audio', 'image']
const shareCoverCopyMinLength = 4
const shareCoverCopyMaxLength = 20
const shareCoverCopyCharsPerLine = 10
const shareColorPalette = [
  '#1F1F1F', '#4A4A4A', '#7A7A7A', '#FFFFFF', '#F0D9A8',
  '#4A3328', '#8F5937', '#C7833E', '#D6A15E', '#FFD36A',
  '#8B2E2E', '#C84B4B', '#E88B8B', '#B04B78', '#E7A1BC',
  '#2F6B4F', '#4E9B6D', '#9BD6AA', '#2B7680', '#6FC6CC',
  '#2F5F9B', '#5A91D1', '#B8D8F5', '#4F5E9F', '#8EA7DD',
  '#5F4B8B', '#8B6FB8', '#D6C3EC', '#B25A9C', '#E5A9D2',
]
const defaultShareCoverStyle = {
  globalWashOpacity: 0.2,
  readingZoneOpacity: 0.1,
  copyFontSize: 60,
  dateFontSize: 60,
  dividerGap: 60,
  dividerLength: 60,
  text: {
    copyColor: '#FFFFFF',
    dateColor: '#F0D9A8',
    dividerColor: '#F0D9A8',
    readingZoneColor: '#1C1813',
  },
  layouts: {
    centered: { enabled: true, offsetY: 0 },
    leftTitle: { enabled: true, offsetY: 0 },
  },
}

function normalizeShareStyleNumber(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback
}

function normalizeShareStyleColor(value, fallback) {
  const color = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback
}

function normalizeShareCoverStyle(style = {}) {
  const source = style && typeof style === 'object' ? style : {}
  const text = source.text || {}
  const layouts = source.layouts || {}
  const copyFontSize = normalizeShareStyleNumber(source.copyFontSize, defaultShareCoverStyle.copyFontSize, 20, 100)
  const normalized = {
    globalWashOpacity: normalizeShareStyleNumber(source.globalWashOpacity, defaultShareCoverStyle.globalWashOpacity, 0, 0.4),
    readingZoneOpacity: normalizeShareStyleNumber(source.readingZoneOpacity, defaultShareCoverStyle.readingZoneOpacity, 0, 0.65),
    copyFontSize,
    dateFontSize: normalizeShareStyleNumber(source.dateFontSize, defaultShareCoverStyle.dateFontSize, 20, 100),
    dividerGap: normalizeShareStyleNumber(source.dividerGap, defaultShareCoverStyle.dividerGap, 20, 100),
    dividerLength: normalizeShareStyleNumber(source.dividerLength, defaultShareCoverStyle.dividerLength, 20, 100),
    text: {
      copyColor: normalizeShareStyleColor(text.copyColor, defaultShareCoverStyle.text.copyColor),
      dateColor: normalizeShareStyleColor(text.dateColor, defaultShareCoverStyle.text.dateColor),
      dividerColor: normalizeShareStyleColor(text.dividerColor, defaultShareCoverStyle.text.dividerColor),
      readingZoneColor: normalizeShareStyleColor(text.readingZoneColor, defaultShareCoverStyle.text.readingZoneColor),
    },
    layouts: {
      centered: {
        enabled: layouts.centered?.enabled !== false,
        offsetY: normalizeShareStyleNumber(layouts.centered?.offsetY, 0, -72, 72),
      },
      leftTitle: {
        enabled: layouts.leftTitle?.enabled !== false,
        offsetY: normalizeShareStyleNumber(layouts.leftTitle?.offsetY, 0, -72, 72),
      },
    },
  }
  if (!normalized.layouts.centered.enabled && !normalized.layouts.leftTitle.enabled) normalized.layouts.centered.enabled = true
  return normalized
}

function getSharePool(type = activeShareContentType) {
  const privateSettings = shareSettingsState.private || { pools: {}, backgrounds: [] }
  if (!shareSettingsState.private) shareSettingsState.private = privateSettings
  if (!privateSettings.pools) privateSettings.pools = {}
  const current = privateSettings.pools[type] || {}
  const pool = {
    titles: Array.isArray(current.titles) ? current.titles : [],
    coverCopies: Array.isArray(current.coverCopies) ? current.coverCopies : [],
  }
  privateSettings.pools[type] = pool
  return pool
}

function normalizeShareSettingsForEditor(settings = {}) {
  const incomingPools = settings.private?.pools || {}
  return {
    version: Number(settings.version) || 1,
    private: {
      coverCopyEnabled: settings.private?.coverCopyEnabled !== false,
      pools: Object.fromEntries(shareContentTypes.map((type) => {
        const pool = incomingPools[type] || {}
        return [type, {
          titles: Array.isArray(pool.titles) ? pool.titles : [],
          coverCopies: Array.isArray(pool.coverCopies) ? pool.coverCopies : [],
        }]
      })),
      backgrounds: Array.isArray(settings.private?.backgrounds) ? settings.private.backgrounds : [],
      coverStyle: normalizeShareCoverStyle(settings.private?.coverStyle),
    },
  }
}

function getShareTextItems(value, items, field, prefix, limit) {
  const existing = new Map((items || []).map((item) => [item[field], item]))
  const known = new Set()
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item && !known.has(item) && (known.add(item) || true))
    .slice(0, limit)
    .map((item) => ({ id: existing.get(item)?.id || makeId(prefix), [field]: item, enabled: true }))
}

function getShareCoverCopyLength(value) {
  return Array.from(String(value || '').replace(/\s+/g, ' ').trim()).length
}

function isValidShareCoverCopy(value) {
  const length = getShareCoverCopyLength(value)
  return length >= shareCoverCopyMinLength && length <= shareCoverCopyMaxLength
}

function formatShareCoverCopy(value) {
  const characters = Array.from(String(value || '').replace(/\s+/g, ' ').trim())
  return Array.from({ length: Math.ceil(characters.length / shareCoverCopyCharsPerLine) }, (_, index) => (
    escapeHtml(characters.slice(index * shareCoverCopyCharsPerLine, (index + 1) * shareCoverCopyCharsPerLine).join(''))
  )).join('<br>')
}

function commitActiveSharePoolEditors() {
  const pool = getSharePool()
  pool.titles = getShareTextItems(nodes.shareTitlePoolInput?.value, pool.titles, 'title', 'private-title', 120)
  pool.coverCopies = getShareTextItems(nodes.shareCoverCopyPoolInput?.value, pool.coverCopies, 'text', 'private-cover-copy', 80)
}

function updateSharePoolCounts() {
  const titleCount = String(nodes.shareTitlePoolInput?.value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).length
  const copyCount = String(nodes.shareCoverCopyPoolInput?.value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).length
  if (nodes.shareTitlePoolCount) nodes.shareTitlePoolCount.textContent = `${titleCount} 条`
  if (nodes.shareCoverCopyPoolCount) nodes.shareCoverCopyPoolCount.textContent = `${copyCount} 条`
}

function renderShareContentTypeTabs() {
  nodes.shareContentTypeTabs?.querySelectorAll('[data-share-content-type]').forEach((button) => {
    const active = button.dataset.shareContentType === activeShareContentType
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
  })
}

function renderSharePoolEditors() {
  const pool = getSharePool()
  const coverCopyEnabled = shareSettingsState.private?.coverCopyEnabled !== false
  if (nodes.shareTitlePoolInput) nodes.shareTitlePoolInput.value = pool.titles.filter((item) => item.enabled !== false).map((item) => item.title).join('\n')
  if (nodes.shareCoverCopyPoolInput) {
    nodes.shareCoverCopyPoolInput.value = pool.coverCopies.filter((item) => item.enabled !== false).map((item) => item.text).join('\n')
  }
  if (nodes.shareCoverCopyEnabled) nodes.shareCoverCopyEnabled.checked = coverCopyEnabled
  updateSharePoolCounts()
}

function renderShareCoverStyleEditor() {
  const style = normalizeShareCoverStyle(shareSettingsState.private?.coverStyle)
  shareSettingsState.private.coverStyle = style
  if (nodes.shareGlobalWashOpacity) nodes.shareGlobalWashOpacity.value = style.globalWashOpacity
  if (nodes.shareReadingZoneOpacity) nodes.shareReadingZoneOpacity.value = style.readingZoneOpacity
  if (nodes.shareCopyFontSize) nodes.shareCopyFontSize.value = style.copyFontSize
  if (nodes.shareDateFontSize) nodes.shareDateFontSize.value = style.dateFontSize
  if (nodes.shareDividerGap) nodes.shareDividerGap.value = style.dividerGap
  if (nodes.shareDividerLength) nodes.shareDividerLength.value = style.dividerLength
  if (nodes.shareCopyColor) nodes.shareCopyColor.value = style.text.copyColor
  if (nodes.shareDateColor) nodes.shareDateColor.value = style.text.dateColor
  if (nodes.shareDividerColor) nodes.shareDividerColor.value = style.text.dividerColor
  if (nodes.shareReadingZoneColor) nodes.shareReadingZoneColor.value = style.text.readingZoneColor
  if (nodes.shareCenteredLayoutEnabled) nodes.shareCenteredLayoutEnabled.checked = style.layouts.centered.enabled
  if (nodes.shareCenteredLayoutOffsetY) nodes.shareCenteredLayoutOffsetY.value = style.layouts.centered.offsetY
  if (nodes.shareLeftLayoutEnabled) nodes.shareLeftLayoutEnabled.checked = style.layouts.leftTitle.enabled
  if (nodes.shareLeftLayoutOffsetY) nodes.shareLeftLayoutOffsetY.value = style.layouts.leftTitle.offsetY
  if (nodes.shareStyleTemplateSummary) {
    const enabledCount = Number(style.layouts.centered.enabled) + Number(style.layouts.leftTitle.enabled)
    nodes.shareStyleTemplateSummary.textContent = `已选 ${enabledCount} 项`
  }
  renderShareColorPalettes()
}

function renderShareColorPalettes() {
  document.querySelectorAll('[data-share-color-palette]').forEach((palette) => {
    const input = palette.closest('.share-hex-control')?.querySelector('.share-hex-color')
    const value = normalizeShareStyleColor(input?.value, '#1F1F1F')
    const swatch = palette.querySelector('[data-share-color-swatch]')
    const options = palette.querySelector('[data-share-color-options]')
    if (swatch) swatch.style.setProperty('--share-color-value', value)
    if (!options) return
    options.innerHTML = shareColorPalette.map((color) => `
      <button class="share-color-option${color === value ? ' active' : ''}" type="button" data-share-color-value="${color}" title="${color}" aria-label="使用 ${color}" aria-pressed="${color === value}" style="--share-color-value:${color}"></button>
    `).join('')
  })
}

function getShareCoverStyleFromEditor() {
  return normalizeShareCoverStyle({
    globalWashOpacity: nodes.shareGlobalWashOpacity?.value,
    readingZoneOpacity: nodes.shareReadingZoneOpacity?.value,
    copyFontSize: nodes.shareCopyFontSize?.value,
    dateFontSize: nodes.shareDateFontSize?.value,
    dividerGap: nodes.shareDividerGap?.value,
    dividerLength: nodes.shareDividerLength?.value,
    text: {
      copyColor: nodes.shareCopyColor?.value,
      dateColor: nodes.shareDateColor?.value,
      dividerColor: nodes.shareDividerColor?.value,
      readingZoneColor: nodes.shareReadingZoneColor?.value,
    },
    layouts: {
      centered: {
        enabled: nodes.shareCenteredLayoutEnabled?.checked,
        offsetY: nodes.shareCenteredLayoutOffsetY?.value,
      },
      leftTitle: {
        enabled: nodes.shareLeftLayoutEnabled?.checked,
        offsetY: nodes.shareLeftLayoutOffsetY?.value,
      },
    },
  })
}

function resetShareCoverStyle() {
  commitActiveSharePoolEditors()
  shareSettingsState.private.coverStyle = normalizeShareCoverStyle(defaultShareCoverStyle)
  renderShareCardCatalog(shareSettingsState)
  showToast('封面样式已恢复为默认值，请保存后生效')
}

function updateShareCoverStylePreview() {
  commitActiveSharePoolEditors()
  shareSettingsState.private.coverStyle = getShareCoverStyleFromEditor()
  renderShareCardCatalog(shareSettingsState)
}

function getShareSettingsFromEditor() {
  commitActiveSharePoolEditors()
  return {
    version: shareSettingsState.version,
    private: {
      coverCopyEnabled: shareSettingsState.private?.coverCopyEnabled !== false,
      pools: Object.fromEntries(shareContentTypes.map((type) => {
        const pool = getSharePool(type)
        return [type, {
          titles: pool.titles.filter((item) => item.enabled !== false),
          coverCopies: pool.coverCopies.filter((item) => item.enabled !== false),
        }]
      })),
      backgrounds: (shareSettingsState.private?.backgrounds || []).filter((item) => item.enabled !== false),
      coverStyle: getShareCoverStyleFromEditor(),
    },
  }
}

function renderShareBackgroundGrid() {
  if (!nodes.shareCoverGrid) return
  const backgrounds = (shareSettingsState.private?.backgrounds || []).filter((item) => item.enabled !== false && (item.imageId || item.imageUrl))
  nodes.shareCoverGrid.innerHTML = backgrounds.map((background, index) => {
    const previewUrl = getShareCoverPreviewUrl(background)
    const asset = [...(contentState.imageAssets || []), ...imageState].find((item) => item.id === background.imageId)
    const legacy = asset && asset.processingProfile !== 'share-background-v2'
    return `
      <article class="share-cover-item">
        ${previewUrl ? `<img src="${escapeAttr(previewUrl)}" alt="通用封面底图 ${index + 1}">` : '<div class="share-cover-empty">图片暂不可预览</div>'}
        ${legacy ? '<small class="share-cover-warning">旧版底图，请重新上传以生成 500×400 版本</small>' : ''}
        <button class="btn-icon btn-danger" type="button" data-remove-share-background="${escapeAttr(background.id)}" title="移除底图" aria-label="移除底图">×</button>
      </article>
    `
  }).join('') || '<div class="empty-panel">尚未上传真实底图；预览和小程序会暂时使用内置测试图。</div>'
}

function formatSharePreviewDate() {
  const now = new Date()
  return `${now.getMonth() + 1}月${now.getDate()}日`
}

function getSharePreviewStyleVariables(style) {
  const previewCoordinateWidth = 7.5
  const readingZoneColor = style.text.readingZoneColor.slice(1)
  const readingZoneRgb = `${parseInt(readingZoneColor.slice(0, 2), 16)}, ${parseInt(readingZoneColor.slice(2, 4), 16)}, ${parseInt(readingZoneColor.slice(4, 6), 16)}`
  return [
    `--share-wash-opacity:${style.globalWashOpacity}`,
    `--share-reading-opacity:${style.readingZoneOpacity}`,
    `--share-copy:${style.text.copyColor}`,
    `--share-date:${style.text.dateColor}`,
    `--share-divider:${style.text.dividerColor}`,
    `--share-reading-rgb:${readingZoneRgb}`,
    `--share-copy-font-size:${style.copyFontSize / previewCoordinateWidth}cqi`,
    `--share-date-font-size:${style.dateFontSize / previewCoordinateWidth}cqi`,
    `--share-divider-gap:${style.dividerGap / previewCoordinateWidth}cqi`,
    `--share-copy-line-height:${(style.copyFontSize + Math.round(style.dividerGap * 0.25)) / previewCoordinateWidth}cqi`,
    `--share-divider-length:${style.dividerLength / previewCoordinateWidth}cqi`,
    `--share-centered-offset-y:${style.layouts.centered.offsetY / previewCoordinateWidth}cqi`,
    `--share-left-offset-y:${style.layouts.leftTitle.offsetY / previewCoordinateWidth}cqi`,
  ].join(';')
}

const sharePreviewFallbackBackgrounds = [
  { id: 'fallback-1', imageUrl: '/assets/images/share-1.jpg' },
  { id: 'fallback-2', imageUrl: '/assets/images/share-2.jpg' },
  { id: 'fallback-3', imageUrl: '/assets/images/share-3.jpg' },
]

const shareContentTypeLabels = {
  text: '文案手记',
  image: '图册手记',
  audio: '音频手记',
}

const sharePreviewFallbackSamples = {
  text: { title: '今天选了一篇手记，慢慢读完吧', text: '今日手记' },
  image: { title: '今天选了一组图片，一起看看吧', text: '今日图册' },
  audio: { title: '今天选了一段音频，慢慢听完吧', text: '今日音频' },
}

const sharePreviewLayouts = [
  { id: 'centered', index: 0 },
  { id: 'left-title', index: 1 },
]

function shuffleSharePreviewItems(items) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function getSharePreviewItems(items, count = 3) {
  const source = items.filter(Boolean)
  if (!source.length) return []
  const result = []
  while (result.length < count) result.push(...shuffleSharePreviewItems(source))
  return result.slice(0, count)
}

function getSharePreviewCases(coverStyle) {
  const enabledLayouts = []
  ;[
    { id: 'centered', enabled: coverStyle.layouts.centered.enabled },
    { id: 'left-title', enabled: coverStyle.layouts.leftTitle.enabled },
  ].forEach((layoutConfig) => {
    if (!layoutConfig.enabled) return
    const layout = sharePreviewLayouts.find((item) => item.id === layoutConfig.id)
    if (layout) enabledLayouts.push({ layout })
  })
  if (!enabledLayouts.length) enabledLayouts.push({ layout: sharePreviewLayouts[0] })
  return Array.from({ length: 3 }, (_, index) => enabledLayouts[index % enabledLayouts.length])
}

function getSharePreviewFallback() {
  const fallback = getSharePreviewItems(sharePreviewFallbackBackgrounds, 1)[0] || sharePreviewFallbackBackgrounds[0]
  return {
    ...fallback,
    previewUrl: getShareCoverPreviewUrl(fallback),
  }
}

function getSharePreviewBackgrounds(count) {
  const configured = (shareSettingsState.private?.backgrounds || [])
    .filter((background) => background?.enabled !== false && (background.imageId || background.imageUrl))
    .map((background) => ({ ...background, previewUrl: getShareCoverPreviewUrl(background) }))
  const pool = configured.length ? configured : sharePreviewFallbackBackgrounds
  if (sharePreviewBackgrounds.length !== count || sharePreviewBackgrounds.some((item) => !pool.some((candidate) => candidate.id === item.id))) {
    sharePreviewBackgrounds = getSharePreviewItems(pool, count)
      .map((background) => ({ ...background, previewUrl: getShareCoverPreviewUrl(background) }))
  }
  return sharePreviewBackgrounds
}

function getSharePreviewSamples(count) {
  if (sharePreviewSamples.length !== count) {
    const privateType = shareContentTypes[sharePreviewTypeOffset % shareContentTypes.length]
    const privatePool = getSharePool(privateType)
    const privateFallback = sharePreviewFallbackSamples[privateType]
    const textPool = getSharePool('text')
    const configuredCopies = textPool.coverCopies.filter((item) => item.enabled !== false && isValidShareCoverCopy(item.text))
    const publicCopy = configuredCopies[sharePreviewTypeOffset % Math.max(1, configuredCopies.length)]
      || { text: sharePreviewFallbackSamples.text.text }
    const privateCopy = privatePool.coverCopies.find((item) => item.enabled !== false && isValidShareCoverCopy(item.text))
      || { text: privateFallback.text }
    const privateTitle = privatePool.titles.find((item) => item.enabled !== false && item.title)
    sharePreviewSamples = [
      { label: shareContentTypeLabels[privateType], title: privateTitle?.title || privateFallback.title, copy: privateCopy.text },
      { label: '公开文章', title: '一篇关于慢慢生活的文章', copy: publicCopy.text },
      { label: '公开心笺', title: '愿你今天也被温柔以待', copy: publicCopy.text },
    ].slice(0, count)
  }
  return sharePreviewSamples
}

function refreshSharePreviewBackgrounds() {
  sharePreviewBackgrounds = []
  sharePreviewTypeOffset = (sharePreviewTypeOffset + 1) % shareContentTypes.length
  sharePreviewSamples = []
  renderShareCardCatalog(shareSettingsState)
}

function renderSharePreviewCards({ previewCases, previewBackgrounds, previewSamples, coverCopyEnabled, previewStyle, date }) {
  nodes.shareCardCatalog.innerHTML = previewCases.map((previewCase, index) => {
    const background = previewBackgrounds[index] || getSharePreviewFallback()
    const sample = previewSamples[index] || sharePreviewFallbackSamples.text
    const copy = coverCopyEnabled ? sample.copy : ''
    const title = sample.title
    const twoLines = getShareCoverCopyLength(copy) > shareCoverCopyCharsPerLine
    return `
      <article class="share-card-preview">
        <div class="share-card-preview-head">
          <strong class="share-card-title">${escapeHtml(title)}</strong>
        </div>
        <div class="share-card-cover share-card-template${coverCopyEnabled ? ` template-${previewCase.layout.id}${twoLines ? ' has-two-lines' : ''}` : ' is-plain'}" style="${escapeAttr(previewStyle)}">
          <img src="${escapeAttr(background.previewUrl)}" alt="${escapeAttr(`私密分享封面排版 ${index + 1}`)}">
          ${coverCopyEnabled ? `<div class="share-card-copy">
            <span class="share-card-date">${escapeHtml(date)}</span>
            <span class="share-card-divider" aria-hidden="true"></span>
            <span class="share-card-phrase">${formatShareCoverCopy(copy)}</span>
          </div>` : ''}
        </div>
        <span class="share-card-case">${escapeHtml(sample.label || shareContentTypeLabels.text)}</span>
      </article>
    `
  }).join('')
}

function renderShareCardCatalog(settings = {}) {
  shareSettingsState = normalizeShareSettingsForEditor(settings)
  renderShareContentTypeTabs()
  renderSharePoolEditors()
  renderShareCoverStyleEditor()
  renderShareBackgroundGrid()
  if (!nodes.shareCardCatalog) return
  const coverStyle = shareSettingsState.private.coverStyle
  const coverCopyEnabled = shareSettingsState.private?.coverCopyEnabled !== false
  const previewCases = getSharePreviewCases(coverStyle)
  const previewCount = previewCases.length
  const previewBackgrounds = getSharePreviewBackgrounds(previewCount)
  const previewSamples = getSharePreviewSamples(previewCount)
  const previewStyle = getSharePreviewStyleVariables(coverStyle)
  const date = formatSharePreviewDate()
  if (nodes.shareCardCatalogHint) {
    nodes.shareCardCatalogHint.textContent = '展示 3 张分享效果：手记、公开文章和公开心笺。优先使用已上传的通用底图，并套用当前封面样式、日期和封面文案；点击刷新可轮换样本。'
  }
  renderSharePreviewCards({ previewCases, previewSamples, coverCopyEnabled, previewStyle, date, previewBackgrounds })
}

async function saveShareSettings() {
  const shareSettings = getShareSettingsFromEditor()
  const coverCopyEnabled = shareSettings.private.coverCopyEnabled !== false
  const missingPool = ['text', 'image'].find((type) => {
    const pool = shareSettings.private.pools[type]
    return !pool.titles.length || (coverCopyEnabled && !pool.coverCopies.length)
  })
  if (missingPool) {
    showToast(`${missingPool === 'text' ? '文案' : '图片'}手记至少保留一条标题${coverCopyEnabled ? '和一条封面文案' : ''}`)
    return false
  }
  const invalidCopyType = shareContentTypes.find((type) => (
    shareSettings.private.pools[type].coverCopies.some((item) => !isValidShareCoverCopy(item.text))
  ))
  if (invalidCopyType) {
    showToast('封面文案限 4 至 20 个字；超过 10 个字会自动分成两行')
    return false
  }
  const restoreButton = setButtonsLoading([nodes.saveShareSettings], '保存中…')
  try {
    const data = await apiRequest('/api/admin/share-settings', {
      method: 'POST',
      body: JSON.stringify({ shareSettings }),
    })
    sharePreviewSamples = []
    renderShareCardCatalog(data.shareSettings || shareSettings)
    showToast('全局分享模板已保存，所有小程序已同步')
    return true
  } catch (error) {
    showToast(error.message || '分享设置保存失败')
    return false
  } finally {
    restoreButton()
  }
}

async function uploadShareCovers(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) return
  const invalidFile = files.find((file) => !isImageFile(file))
  if (invalidFile) {
    showToast(`${invalidFile.name} 不是支持的图片格式`)
    return
  }
  const oversizedFile = files.find((file) => file.size > 5 * 1024 * 1024)
  if (oversizedFile) {
    showToast(`${oversizedFile.name} 超过 5MB`)
    return
  }
  const restoreButton = setButtonsLoading([nodes.shareCoverUploadBtn], '上传中…')
  try {
    commitActiveSharePoolEditors()
    const uploadedItems = []
    let uploadError = null
    for (let index = 0; index < files.length; index += 1) {
      nodes.shareCoverUploadBtn.textContent = `上传中 ${index + 1}/${files.length}`
      const file = files[index]
      try {
        const data = await uploadImageFileToCos(file, {
          label: file.name.replace(/\.[^.]+$/, ''),
          usage: 'share-background',
        })
        uploadedItems.push(data.item)
      } catch (error) {
        uploadError = error
        break
      }
    }
    if (!uploadedItems.length) throw uploadError
    const uploadedImageIds = new Set(uploadedItems.map((item) => item.id))
    shareSettingsState.private.backgrounds = [
      ...(shareSettingsState.private.backgrounds || []),
      ...uploadedItems.map((item) => ({
        id: makeId('private-background'),
        imageId: item.id,
        imageUrl: item.mediumUrl || item.thumbUrl || '',
        originalUrl: item.originalUrl || '',
        enabled: true,
      })),
    ]
    imageState = [...uploadedItems, ...imageState.filter((item) => !uploadedImageIds.has(item.id))]
    renderShareCardCatalog(shareSettingsState)
    if (!await saveShareSettings()) return
    showToast(uploadError
      ? `已上传 ${uploadedItems.length}/${files.length} 张；${uploadError.message || '其余图片上传失败'}`
      : `已上传 ${uploadedItems.length} 张底图`)
  } catch (error) {
    showToast(error.message || '底图上传失败')
  } finally {
    restoreButton()
    if (nodes.shareCoverUploadFile) nodes.shareCoverUploadFile.value = ''
  }
}

function renderContentEditor(data) {
  clearContentSelection()
  editingContentPoolId = data.poolId || getEditingContentPoolId()
  contentPagination = { ...createContentPaginationState(), ...(data.pagination || contentPagination) }
  contentState = {
    ads: data.ads || {},
    contentAlbums: data.contentAlbums || [],
    contentAudios: data.contentAudios || [],
    contentTexts: data.contentTexts || [],
    articles: data.articles || [],
    imageAssets: data.imageAssets || [],
    letters: data.letters || [],
    limits: data.limits || { dailyContentLimit: 5 },
    poolId: data.poolId || '',
    poolSummaries: data.poolSummaries || contentState.poolSummaries || [],
    system: data.system || {},
  }
  renderDailyContentNoteEditor(contentState.contentTexts)
  renderDailyContentAudioEditor(contentState.contentAudios)
  renderDailyContentAlbumEditor(contentState.contentAlbums)
  renderLetterEditor(contentState.letters)
  const renderedContent = collectContentEditor({ includeConfig: false })
  contentFormSnapshots = Object.fromEntries(CONTENT_TYPES.map((type) => [type, renderedContent[type] || []]))
  ;[
    ['contentTexts', nodes.contentTextsPagination],
    ['contentAudios', nodes.contentAudiosPagination],
    ['contentAlbums', nodes.contentAlbumsPagination],
    ['letters', nodes.lettersPagination],
  ].forEach(([type, node]) => {
    if (node) node.innerHTML = renderPagination(`content:${type}`, contentPagination[type])
    syncContentSelection(type)
  })
  renderLimitConfigEditor(contentState.limits)
  renderOpsConfigEditor(contentState)
  renderSystemSettings()
  syncContentPoolCounts()
  renderContentPools()
  setActiveContentEditorType(activeContentEditorType)
  window.dispatchEvent(new CustomEvent('article-manager-refresh'))
}

async function loadContentEditor(poolId = getEditingContentPoolId()) {
  try {
    if (poolId !== editingContentPoolId) contentPagination = createContentPaginationState()
    renderContentEditor(await apiRequest(getContentEditorPath(poolId)))
    return true
  } catch (error) {
    showToast('内容加载失败，请稍后重试。')
    return false
  }
}

async function refreshContentEditor(button) {
  const restore = setButtonsLoading(button ? [button] : [], '刷新中…')
  try {
    const loaded = await loadContentEditor()
    if (loaded) {
      await refreshAdminOverview()
      showToast('内容已刷新')
    }
  } finally {
    restore()
  }
}

function collectNumber(root, selector, fallback) {
  return Number(root.querySelector(selector)?.value || fallback || 0)
}

function normalizeContentText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim()
}

function collectContentEditor({ includeConfig = true } = {}) {
  const contentTexts = contentState.contentTexts.map((item, index) => {
    const { remark, ...rest } = item
    return {
      ...rest,
      label: nodes.contentTextEditor.querySelector(`[data-content-text-field="label"][data-index="${index}"]`)?.value.trim() || '默认',
      text: normalizeContentText(nodes.contentTextEditor.querySelector(`[data-content-text-field="text"][data-index="${index}"]`)?.value),
    }
  })
  const letters = contentState.letters.map((item, index) => ({
    ...item,
    label: nodes.letterEditor.querySelector(`[data-letter-field="label"][data-index="${index}"]`)?.value.trim() || '默认',
    content: normalizeContentText(nodes.letterEditor.querySelector(`[data-letter-field="content"][data-index="${index}"]`)?.value),
    likeCount: collectNumber(nodes.letterEditor, `[data-letter-field="likeCount"][data-index="${index}"]`, item.likeCount),
    favoriteCount: collectNumber(nodes.letterEditor, `[data-letter-field="favoriteCount"][data-index="${index}"]`, item.favoriteCount),
  }))
  const contentAlbums = contentState.contentAlbums.map((item, index) => {
    const { remark, ...rest } = item
    return {
      ...rest,
      label: nodes.contentAlbumEditor.querySelector(`[data-album-field="label"][data-index="${index}"]`)?.value.trim() || '默认',
      images: item.images,
      likeCount: collectNumber(nodes.contentAlbumEditor, `[data-album-field="likeCount"][data-index="${index}"]`, item.likeCount),
      favoriteCount: collectNumber(nodes.contentAlbumEditor, `[data-album-field="favoriteCount"][data-index="${index}"]`, item.favoriteCount),
    }
  })
  const contentAudios = contentState.contentAudios.map((item, index) => ({
    ...item,
    label: nodes.contentAudioEditor.querySelector(`[data-audio-field="label"][data-index="${index}"]`)?.value.trim() || '默认',
    title: nodes.contentAudioEditor.querySelector(`[data-audio-field="title"][data-index="${index}"]`)?.value.trim() || getAudioDisplayName(item),
  }))
  const content = {
    contentAlbums,
    contentAudios,
    contentTexts,
    letters,
  }
  if (!includeConfig) return content
  return {
    ...content,
    ads: collectSwitchConfig('ads', contentState.ads),
    limits: collectLimitConfig(),
    system: collectSystemSettings(),
  }
}

let albumErrorFilterEnabled = false

function toggleAlbumErrorFilter(button) {
  albumErrorFilterEnabled = !albumErrorFilterEnabled
  const rows = [...nodes.contentAlbumEditor.querySelectorAll('tr')]
  rows.forEach((row) => {
    row.classList.toggle('hidden', albumErrorFilterEnabled && row.dataset.albumError !== '1')
  })
  if (button) button.textContent = albumErrorFilterEnabled ? '查看全部图片组' : '仅看压缩失败'
  const failedCount = rows.filter((row) => row.dataset.albumError === '1').length
  showToast(albumErrorFilterEnabled ? `已筛出 ${failedCount} 个压缩失败图片组` : '已显示全部图片组')
}

function collectLimitConfig() {
  const dailyContentLimit = normalizeDailyContentDailyLimit(nodes.limitConfigEditor?.querySelector('[data-limit-field="dailyContentLimit"]')?.value)
  return {
    dailyContentLimit,
  }
}

function collectSwitchConfig(group, source, root = nodes.adsConfigEditor, { mergeArticleDefaults = true } = {}) {
  const idField = 'adUnitId'
  const editorSource = group === 'ads' && mergeArticleDefaults ? mergeArticleAdEditorItems(source) : (source || {})
  return Object.fromEntries(Object.entries(editorSource).map(([key, item]) => {
    const isListNative = ['lettersNative', 'articlesNative', 'mineNative'].includes(key)
    const isHomeNative = key === 'homeNative' && item.adType === 'native'
    return [key, {
      enabled: Boolean(root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="enabled"]`)?.checked),
      label: item.label || '',
      adType: item.adType || '',
      adUnitId: root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="${idField}"]`)?.value.trim() || '',
      ...(isHomeNative ? {
        placement: root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="placement"]`).value,
      } : {}),
      ...(isListNative ? {
        firstAfter: Number(root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="firstAfter"]`)?.value || item.firstAfter || 3),
        interval: Number(root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="interval"]`)?.value || item.interval || 10),
      } : {}),
      freeCount: Number(root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="freeCount"]`)?.value || item.freeCount || 0),
      confirmPopupEnabled: (root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="confirmPopupEnabled"]`)?.value || String(item.confirmPopupEnabled !== false)) !== 'false',
      allowOnUnavailable: (root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="allowOnUnavailable"]`)?.value || String(item.allowOnUnavailable !== false)) !== 'false',
      delaySeconds: Number(root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="delaySeconds"]`)?.value || item.delaySeconds || 3),
      repeatSeconds: Number(root.querySelector(`[data-config-group="${group}"][data-config-key="${key}"][data-config-field="repeatSeconds"]`)?.value || item.repeatSeconds || 90),
    }]
  }))
}

async function saveAdConfigPage(button) {
  const pageId = button?.dataset.saveAdPage || ''
  const card = button?.closest('[data-ad-page]')
  const pageKeys = adPageKeys[pageId] || []
  const source = mergeArticleAdEditorItems(contentState.ads)
  const items = Object.fromEntries(pageKeys.filter((key) => source[key]).map((key) => [key, source[key]]))
  if (!pageId || !card || !Object.keys(items).length) return

  const restoreButton = setButtonsLoading([button], '保存中…')
  try {
    const ads = collectSwitchConfig('ads', items, card, { mergeArticleDefaults: false })
    await apiRequest('/api/admin/content/page', {
      method: 'POST',
      body: JSON.stringify(withEditingContentPool({
        ads,
      }, 'ads')),
    })
    contentState.ads = { ...(contentState.ads || {}), ...ads }
    await refreshAdminOverview()
    showToast('广告设置已保存')
  } catch (error) {
    showToast(error.message || '广告设置保存失败')
  } finally {
    restoreButton()
  }
}

async function saveContentEditor(event) {
  const content = event?.currentTarget?.closest('#ads')
    ? { ads: collectSwitchConfig('ads', contentState.ads) }
    : collectContentEditor()
  const saveButtons = [...document.querySelectorAll('[data-save-content]')]
  const restoreButtons = setButtonsLoading(saveButtons, '保存中…')
  try {
    await apiRequest('/api/admin/content/page', {
      method: 'POST',
      body: JSON.stringify(withEditingContentPool(content, getContentSaveAuditAction())),
    })
    await loadContentEditor()
    await refreshAdminOverview()
    showToast('保存成功')
  } catch (error) {
    showToast(error.message || '保存失败')
  } finally {
    restoreButtons()
  }
}

async function saveContentItem(type, index, button) {
  if (!['contentTexts', 'contentAudios', 'contentAlbums', 'letters'].includes(type)) return
  const items = collectContentEditor()[type]
  const item = items[index]
  if (!item) return
  const restoreButton = setButtonsLoading([button], '保存中…')
  try {
    await apiRequest('/api/admin/content/item', {
      method: 'POST',
      body: JSON.stringify(withEditingContentPool({ type, item }, 'content')),
    })
    await loadContentEditor()
    await refreshAdminOverview()
    showToast('本条内容已保存')
  } catch (error) {
    showToast(error.message || '本条内容保存失败')
  } finally {
    restoreButton()
  }
}

function formatKb(value) {
  const number = Number(value || 0)
  return number ? `${Math.ceil(number / 1024)}KB` : '--'
}

function getImageStatusLabel(status) {
  const labels = {
    failed: '处理失败',
    processing: '处理中',
    ready: '可使用',
  }
  return labels[status] || status || '可使用'
}

function normalizeImageUsage(value) {
  const usage = String(value || '').trim()
  return usage === 'article,daily_content' ? 'daily_content,article' : usage
}

function renderImageUsageOptions(value) {
  const current = normalizeImageUsage(value) || 'daily_content,article'
  const options = [
    ['daily_content,article', '手记 + 文章'],
    ['daily_content', '仅手记'],
    ['article', '仅文章'],
  ]
  if (current && !options.some(([optionValue]) => optionValue === current)) {
    options.push([current, current])
  }
  return options.map(([optionValue, label]) => (
    `<option value="${escapeAttr(optionValue)}" ${optionValue === current ? 'selected' : ''}>${escapeHtml(label)}</option>`
  )).join('')
}

function renderImageEditor(items, policy) {
  imageState = items || []
  imagePolicyState = policy || imagePolicyState
  nodes.imageEditor.innerHTML = `
    <table class="data-table image-table">
      <colgroup>
        <col class="col-id">
        <col>
        <col>
        <col class="col-label">
      </colgroup>
      <thead><tr><th>ID</th><th>图片 ID</th><th>预览</th><th>标签</th><th>状态</th><th>缩略图地址</th><th>展示图地址</th><th>操作</th></tr></thead>
      <tbody>
        ${imageState.map((item, index) => `
          <tr>
            <td data-label="ID">${rowNumber(index)}</td>
            <td data-label="图片 ID"><input data-image-field="id" data-index="${index}" value="${escapeAttr(item.id || '')}" readonly></td>
            <td data-label="预览"><a class="thumb-link ${item.thumbUrl || item.mediumUrl ? 'has-image' : ''}" href="${escapeAttr(item.mediumUrl || item.thumbUrl || '#')}" target="_blank">${item.thumbUrl || item.mediumUrl ? `<img src="${escapeAttr(item.thumbUrl || item.mediumUrl)}" alt="">` : ''}<span>${escapeHtml(item.label || item.id || '-')}</span></a></td>
            <td data-label="标签"><input data-image-field="label" data-index="${index}" value="${escapeAttr(item.label || '')}"></td>
            <td data-label="状态">
              <select data-image-field="status" data-index="${index}">
                <option value="ready" ${item.status === 'ready' ? 'selected' : ''}>${getImageStatusLabel('ready')}</option>
                <option value="processing" ${item.status === 'processing' ? 'selected' : ''}>${getImageStatusLabel('processing')}</option>
                <option value="failed" ${item.status === 'failed' ? 'selected' : ''}>${getImageStatusLabel('failed')}</option>
              </select>
            </td>
            <td data-label="缩略图地址"><input class="image-url-input" data-image-field="thumbUrl" data-index="${index}" value="${escapeAttr(item.thumbUrl || '')}" placeholder="缩略图地址"></td>
            <td data-label="展示图地址"><input class="image-url-input" data-image-field="mediumUrl" data-index="${index}" value="${escapeAttr(item.mediumUrl || '')}" placeholder="展示图地址"></td>
            <td data-label="操作"><button class="btn-text btn-danger" type="button" data-remove-image data-index="${index}">删除</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${renderPagination('images', imagePagination)}
  `
}

async function loadImages(page = imagePagination.page || 1) {
  try {
    const pageSize = imagePagination.pageSize || PAGE_SIZES[0]
    const data = await apiRequest(`/api/admin/images?page=${page}&pageSize=${pageSize}`)
    imagePagination = data.pagination || createPaginationState()
    renderImageEditor(data.items || [], data.policy)
  } catch (error) {
    showToast('图片素材加载失败，请稍后重试。')
  }
}

function collectImageEditor() {
  return imageState.map((item, index) => {
    const { remark, ...rest } = item
    return {
      ...rest,
      id: nodes.imageEditor.querySelector(`[data-image-field="id"][data-index="${index}"]`)?.value.trim() || '',
      label: nodes.imageEditor.querySelector(`[data-image-field="label"][data-index="${index}"]`)?.value.trim() || '',
      usage: item.usage || 'daily_content,article',
      status: nodes.imageEditor.querySelector(`[data-image-field="status"][data-index="${index}"]`)?.value || 'ready',
      thumbUrl: nodes.imageEditor.querySelector(`[data-image-field="thumbUrl"][data-index="${index}"]`)?.value.trim() || '',
      mediumUrl: nodes.imageEditor.querySelector(`[data-image-field="mediumUrl"][data-index="${index}"]`)?.value.trim() || '',
    }
  })
}

async function saveImageEditor() {
  const restoreButton = setButtonsLoading([document.querySelector('#saveImages')], '保存中…')
  try {
    const data = await apiRequest('/api/admin/images', {
      method: 'POST',
      body: JSON.stringify({ items: collectImageEditor() }),
    })
    await loadImages()
    await loadContentEditor()
    await refreshAdminOverview()
    showToast('图片素材已保存')
  } catch (error) {
    showToast(error.message || '保存失败')
  } finally {
    restoreButton()
  }
}

async function uploadSelectedImage(file) {
  if (!file) return
  if (!isImageFile(file)) {
    showToast('请选择图片文件')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('单张图片不能超过 5MB')
    return
  }
  const restoreButton = setButtonsLoading([nodes.uploadImageBtn], '上传中…')
  try {
    const data = await uploadImageFileToCos(file, {
      label: file.name.replace(/\.[^.]+$/, ''),
      usage: 'daily_content,article',
    })
    imageState = [data.item, ...imageState.filter((item) => item.id !== data.item.id)]
    renderImageEditor(imageState, data.policy || imagePolicyState)
    await loadContentEditor()
    await refreshAdminOverview()
    showToast('图片已直传 COS')
  } catch (error) {
    showToast(error.message || '图片上传失败')
  } finally {
    restoreButton()
    if (nodes.uploadImageFile) nodes.uploadImageFile.value = ''
  }
}

function normalizeCosResultKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const pathname = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? new URL(raw).pathname : raw
    return decodeURIComponent(pathname).replace(/^\/+/, '')
  } catch (error) {
    return raw.replace(/^\/+/, '')
  }
}

function isTemporaryCosProcessingCode(code) {
  return /^(InternalError|RequestTimeout|ServiceUnavailable|SlowDown|CIInternalError)$/i.test(String(code || '').trim())
}

async function assertCosImageProcessingSucceeded(response, expectedUrls = []) {
  const responseText = await response.text()
  let documentNode = null
  if (responseText.trim()) {
    documentNode = new DOMParser().parseFromString(responseText, 'application/xml')
    if (documentNode.getElementsByTagName('parsererror').length) {
      const error = new Error(`COS 返回了无法识别的处理结果：HTTP ${response.status}`)
      error.status = response.ok ? 502 : response.status
      throw error
    }
  }

  const root = documentNode?.documentElement
  const rootName = String(root?.localName || root?.nodeName || '')
  const errorNode = rootName === 'Error' ? root : root?.getElementsByTagName('Error')?.[0]
  const failedObject = Array.from(root?.getElementsByTagName('Object') || []).find((node) => {
    const code = node.getElementsByTagName('Code')?.[0]?.textContent?.trim()
    return code && !/^success$/i.test(code)
  })
  const failureNode = errorNode || failedObject
  if (failureNode) {
    const code = failureNode.getElementsByTagName('Code')?.[0]?.textContent?.trim() || ''
    const detail = failureNode.getElementsByTagName('Message')?.[0]?.textContent?.trim() || ''
    const error = new Error(`COS 图片处理失败${code ? `（${code}）` : ''}${detail ? `：${detail}` : ''}`)
    error.status = response.ok ? (isTemporaryCosProcessingCode(code) ? 503 : 422) : response.status
    error.cosCode = code
    throw error
  }

  if (!response.ok) {
    const error = new Error(`COS 直传失败：HTTP ${response.status}`)
    error.status = response.status
    throw error
  }

  if (!root || rootName !== 'UploadResult') return
  const actualKeys = new Set(Array.from(root.getElementsByTagName('Object'))
    .map((node) => normalizeCosResultKey(node.getElementsByTagName('Key')?.[0]?.textContent)))
  const missingKeys = expectedUrls
    .map(normalizeCosResultKey)
    .filter((key) => key && !actualKeys.has(key))
  if (missingKeys.length) {
    const error = new Error('COS 图片处理结果不完整，已自动重试')
    error.status = 502
    throw error
  }
}

async function uploadImageFileToCos(file, options = {}) {
  let uploadBody = file?.blob || file
  const name = String(file?.name || file?.fileName || 'image.jpg').trim()
  let type = String(file?.type || uploadBody?.type || getMimeTypeByName(name) || 'image/jpeg').trim()
  let size = Number(file?.size || uploadBody?.size || 0)
  const label = String(options.label || name.replace(/\.[^.]+$/, '') || '图片素材').trim()
  const usage = String(options.usage || 'daily_content,article').trim()
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}

  if (!uploadBody) throw new Error('图片文件不存在')
  if (!isImageFile({ name, type })) throw new Error('请选择图片文件')
  if (!size || size > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5MB')

  // Preserve the source composition. COS creates display-sized variants;
  // fixed-ratio previews and cards crop visually without changing the source.

  onProgress('正在创建 COS 直传任务')
  const prepared = await apiRequest('/api/admin/images/upload/prepare', {
    method: 'POST',
    body: JSON.stringify({
      label,
      name,
      size,
      type,
      usage,
    }),
  })

  onProgress('正在直传 COS，图片不会经过云服务器')
  const uploadHeaders = {
    ...(prepared.upload?.headers || {}),
    authorization: prepared.upload?.authorization || '',
  }
  const uploadResponse = await fetch(prepared.upload.uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: uploadBody,
  })
  await assertCosImageProcessingSucceeded(uploadResponse, [prepared.urls.mediumUrl, prepared.urls.thumbUrl])

  return apiRequest('/api/admin/images/upload/complete', {
    method: 'POST',
    body: JSON.stringify({
      imageId: prepared.task.imageId,
      label: prepared.task.label,
      mediumUrl: prepared.urls.mediumUrl,
      originalName: prepared.task.originalName,
      originalSize: prepared.task.originalSize,
      originalUrl: prepared.urls.originalUrl,
      thumbUrl: prepared.urls.thumbUrl,
      taskId: prepared.task.id,
      token: prepared.task.token,
      usage: prepared.task.usage,
    }),
  })
}

async function uploadAudioFileToCos(file, options = {}) {
  const name = String(file?.name || '').trim()
  const size = Number(file?.size || 0)
  const durationSeconds = Number(options.durationSeconds || 0)
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}

  if (!isAudioFile(file)) throw new Error('请选择 mp3 或 m4a 音频')
  if (!size || size > 50 * 1024 * 1024) throw new Error('单个音频不能超过 50MB')

  onProgress('正在上传音频到服务器')
  const formData = new FormData()
  formData.append('audio', file, name)
  formData.append('durationSeconds', String(durationSeconds))
  formData.append('label', String(options.label || '默认'))
  formData.append('title', String(options.title || ''))
  return apiRequest('/api/admin/audios/upload', {
    method: 'POST',
    body: formData,
  })
}

const singleContentConfig = {
  contentAlbums: { imageLimit: 9, imageRequired: true, title: '新增图册手记' },
  contentAudios: { audioRequired: true, title: '新增音频手记' },
  contentTexts: { imageLimit: 0, title: '新增文案手记' },
  letters: { imageLimit: 0, title: '新增心笺' },
}

function singleContentFields(type) {
  const fields = {
    contentAlbums: `
      <div class="form-field">
        <label for="singleContentAlbumLabel">标签</label>
        <input id="singleContentAlbumLabel" data-single-content-field="label" value="默认" placeholder="仅供后台分类">
      </div>
    `,
    contentAudios: '',
    contentTexts: `
      <div class="form-field">
        <label for="singleContentDailyContentLabel">标签</label>
        <input id="singleContentDailyContentLabel" data-single-content-field="label" value="默认" placeholder="仅供后台分类">
      </div>
      <div class="form-field">
        <label for="singleContentDailyContentText">文案</label>
        <textarea id="singleContentDailyContentText" data-single-content-field="content" rows="4" placeholder="输入文案手记"></textarea>
      </div>
    `,
    letters: `
      <div class="form-field">
        <label for="singleContentLetterLabel">标签</label>
        <input id="singleContentLetterLabel" data-single-content-field="label" value="默认" placeholder="仅供后台分类">
      </div>
      <div class="form-field">
        <label for="singleContentLetterText">内容</label>
        <textarea id="singleContentLetterText" data-single-content-field="content" rows="4" placeholder="输入心笺内容"></textarea>
      </div>
    `,
  }
  return fields[type] || ''
}

function readAudioDuration(file) {
  if (!file) return Promise.resolve(0)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const finish = (value) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(audio.duration)
    audio.onerror = () => finish(0)
    audio.src = url
  })
}

function renderSingleContentAudio() {
  if (!nodes.singleContentAudioPreview || !nodes.singleContentAudioCount) return
  if (!singleContentAudioFile) {
    nodes.singleContentAudioCount.textContent = ''
    nodes.singleContentAudioPreview.innerHTML = ''
    return
  }
  const duration = formatAudioDuration(singleContentAudioDuration)
  nodes.singleContentAudioCount.textContent = `${formatFileSize(singleContentAudioFile.size)}${duration === '-' ? '' : ` · ${duration}`}`
  nodes.singleContentAudioPreview.innerHTML = `
    <div class="single-content-audio-item">
      <span title="${escapeAttr(singleContentAudioFile.name)}">${escapeHtml(singleContentAudioFile.name)}</span>
      <button class="btn-text btn-danger" data-single-content-audio-remove type="button">移除</button>
    </div>
  `
}

function revokeSingleContentPreviews() {
  singleContentPreviewUrls.forEach((url) => URL.revokeObjectURL(url))
  singleContentPreviewUrls = []
}

function renderSingleContentImages() {
  const config = singleContentConfig[singleContentType]
  if (!config || !nodes.singleContentImagePreview) return
  revokeSingleContentPreviews()
  nodes.singleContentImageCount.textContent = `${singleContentFiles.length}/${config.imageLimit} 张`
  nodes.singleContentImagePreview.innerHTML = singleContentFiles.map((file, index) => {
    const url = URL.createObjectURL(file)
    singleContentPreviewUrls.push(url)
    return `
      <div class="single-content-image-item">
        <img src="${escapeAttr(url)}" alt="${escapeAttr(file.name)}">
        <button data-single-content-image-remove="${index}" type="button" title="移除图片" aria-label="移除 ${escapeAttr(file.name)}">×</button>
      </div>
    `
  }).join('')
}

function closeSingleContentModal() {
  if (singleContentSaving) return
  revokeSingleContentPreviews()
  singleContentFiles = []
  singleContentAudioDuration = 0
  singleContentAudioFile = null
  singleContentItemId = ''
  singleContentType = ''
  singleContentUploadedImages = []
  singleContentUploadedAudio = null
  if (nodes.singleContentImageInput) nodes.singleContentImageInput.value = ''
  if (nodes.singleContentAudioInput) nodes.singleContentAudioInput.value = ''
  closeModal(nodes.singleContentModal)
}

function openSingleContentModal(type) {
  const config = singleContentConfig[type]
  if (!config) return
  revokeSingleContentPreviews()
  singleContentFiles = []
  singleContentItemId = makeId({
    contentAlbums: 'content-album',
    contentAudios: 'content-audio',
    contentTexts: 'content-text',
    letters: 'letter',
  }[type])
  singleContentType = type
  singleContentUploadedImages = []
  singleContentUploadedAudio = null
  singleContentAudioFile = null
  singleContentAudioDuration = 0
  nodes.singleContentTitle.textContent = config.title
  nodes.singleContentFields.innerHTML = singleContentFields(type)
  nodes.singleContentImageField.classList.toggle('hidden', !config.imageLimit)
  nodes.singleContentAudioField.classList.toggle('hidden', !config.audioRequired)
  nodes.singleContentImageLabel.textContent = type === 'contentAlbums' ? '图片' : '图片（可选）'
  nodes.singleContentImagePreview.innerHTML = ''
  nodes.singleContentImageCount.textContent = config.imageLimit ? `0/${config.imageLimit} 张` : ''
  if (nodes.singleContentImageInput) nodes.singleContentImageInput.value = ''
  if (nodes.singleContentAudioInput) nodes.singleContentAudioInput.value = ''
  renderSingleContentAudio()
  openModal(nodes.singleContentModal)
  requestAnimationFrame(() => (nodes.singleContentFields.querySelector('input, textarea') || nodes.singleContentSelectAudio)?.focus())
}

async function selectSingleContentAudio(file) {
  if (!file) return
  if (!isAudioFile(file) || file.size > 50 * 1024 * 1024) {
    showToast('请选择不超过 50MB 的 mp3 或 m4a 音频')
    return
  }
  singleContentAudioFile = file
  singleContentAudioDuration = await readAudioDuration(file)
  singleContentUploadedAudio = null
  if (nodes.singleContentAudioInput) nodes.singleContentAudioInput.value = ''
  renderSingleContentAudio()
}

function selectSingleContentImages(files) {
  const limit = singleContentConfig[singleContentType]?.imageLimit || 0
  const sourceFiles = Array.from(files || [])
  const invalidCount = sourceFiles.filter((file) => !isImageFile(file) || file.size > 5 * 1024 * 1024).length
  singleContentFiles = sourceFiles
    .filter((file) => isImageFile(file) && file.size <= 5 * 1024 * 1024)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))
    .slice(0, limit)
  singleContentUploadedImages = []
  if (nodes.singleContentImageInput) nodes.singleContentImageInput.value = ''
  renderSingleContentImages()
  if (invalidCount) showToast('已忽略非图片或超过 5MB 的文件')
}

function getSingleContentValue(field) {
  return nodes.singleContentFields.querySelector(`[data-single-content-field="${field}"]`)?.value.trim() || ''
}

function getSingleContentText() {
  return normalizeContentText(nodes.singleContentFields.querySelector('[data-single-content-field="content"]')?.value)
}

function validateSingleContent() {
  const content = getSingleContentText()
  if ((singleContentType === 'contentTexts' || singleContentType === 'letters') && !content) return '请输入内容'
  if (singleContentConfig[singleContentType]?.imageRequired && !singleContentFiles.length) return '请至少选择一张图片'
  if (singleContentConfig[singleContentType]?.audioRequired && !singleContentAudioFile) return '请选择音频文件'
  return ''
}

async function uploadSingleContentImages() {
  const images = []
  for (let index = 0; index < singleContentFiles.length; index += 1) {
    const file = singleContentFiles[index]
    const cached = singleContentUploadedImages[index]
    if (cached?.id) {
      images.push(cached)
      continue
    }
    if (nodes.singleContentSave) nodes.singleContentSave.textContent = `上传中 ${index + 1}/${singleContentFiles.length}`
    const uploaded = await uploadImageFileToCos(file, {
      label: file.name.replace(/\.[^.]+$/, ''),
      usage: 'daily_content',
    })
    const image = { id: uploaded.item.id }
    singleContentUploadedImages[index] = image
    images.push(image)
  }
  return images
}

async function uploadSingleContentAudio() {
  if (singleContentUploadedAudio?.id) return singleContentUploadedAudio
  if (!singleContentAudioFile) throw new Error('音频文件不存在')
  if (nodes.singleContentSave) nodes.singleContentSave.textContent = '正在上传音频'
  const uploaded = await uploadAudioFileToCos(singleContentAudioFile, {
    durationSeconds: singleContentAudioDuration,
  })
  singleContentUploadedAudio = uploaded.item
  return singleContentUploadedAudio
}

function buildSingleContentItem(images, audio = null) {
  if (!singleContentItemId) {
    singleContentItemId = makeId({
      contentAlbums: 'content-album',
      contentAudios: 'content-audio',
      contentTexts: 'content-text',
      letters: 'letter',
    }[singleContentType])
  }
  if (singleContentType === 'contentTexts') {
    return { id: singleContentItemId, label: getSingleContentValue('label') || '默认', text: getSingleContentText(), likeCount: 0, favoriteCount: 0 }
  }
  if (singleContentType === 'contentAlbums') {
    return { id: singleContentItemId, label: getSingleContentValue('label') || '默认', images, likeCount: 0, favoriteCount: 0 }
  }
  if (singleContentType === 'contentAudios') {
    return { ...audio, id: singleContentItemId }
  }
  if (singleContentType === 'letters') {
    return {
      id: singleContentItemId,
      label: getSingleContentValue('label') || '默认',
      content: getSingleContentText(),
      likeCount: 0,
      favoriteCount: 0,
    }
  }
  throw new Error('不支持的内容类型')
}

async function saveSingleContent() {
  if (singleContentSaving || !singleContentConfig[singleContentType]) return
  const validationError = validateSingleContent()
  if (validationError) {
    showToast(validationError)
    return
  }
  singleContentSaving = true
  const type = singleContentType
  const restoreButton = setButtonsLoading([nodes.singleContentSave], '保存中…')
  try {
    const images = await uploadSingleContentImages()
    const audio = singleContentType === 'contentAudios' ? await uploadSingleContentAudio() : null
    const data = await apiRequest('/api/admin/content/items', {
      method: 'POST',
      body: JSON.stringify({
        poolId: getEditingContentPoolId(),
        miniProgramId: getCurrentMiniProgram()?.id || '',
        type,
        items: [buildSingleContentItem(images, audio)],
      }),
    })
    await loadContentEditor()
    await refreshAdminOverview()
    singleContentSaving = false
    closeSingleContentModal()
    showToast(data.importedCount ? '内容已新增' : '内容已存在，未重复新增')
  } catch (error) {
    showToast(error.message || '新增失败')
  } finally {
    singleContentSaving = false
    restoreButton()
  }
}

function removeContentItem(type, index) {
  const item = contentState[type]?.[index]
  if (!item?.id) return
  openConfirm({
    title: '删除内容',
    message: '删除后这条内容将不可恢复。',
    onConfirm: async () => {
      try {
        await apiRequest('/api/admin/content/delete', {
          method: 'POST',
          body: JSON.stringify(withEditingContentPool({ type, itemId: item.id }, 'content')),
        })
        await loadContentEditor()
        await refreshAdminOverview()
        showToast('内容已删除')
      } catch (error) {
        showToast(error.message || '内容删除失败')
      }
    },
  })
}

function removeSelectedContent(type, button) {
  const itemIds = [...(contentSelection[type] || [])]
  if (!itemIds.length) return
  if (hasUnsavedContentEdits(type)) {
    showToast(`请先保存${getContentTypeLabel(type)}的编辑，再批量删除`)
    return
  }
  const poolName = getContentPoolName(getEditingContentPoolId())
  openConfirm({
    title: `删除 ${itemIds.length} 条${getContentTypeLabel(type)}？`,
    message: `将从内容池「${poolName}」永久删除，删除后不可恢复。`,
    onConfirm: async () => {
      const restoreButton = setButtonsLoading([button], '删除中…')
      try {
        const data = await apiRequest('/api/admin/content/batch-delete', {
          method: 'POST',
          body: JSON.stringify(withEditingContentPool({ type, itemIds }, 'content')),
        })
        const pagination = contentPagination[type] || createPaginationState()
        const remainingTotal = Math.max(0, Number(pagination.total || 0) - Number(data.ids?.length || 0))
        const totalPages = Math.max(1, Math.ceil(remainingTotal / Number(pagination.pageSize || PAGE_SIZES[0])))
        if (pagination.page > totalPages) contentPagination[type] = { ...pagination, page: totalPages }
        await loadContentEditor()
        await refreshAdminOverview()
        showToast(`已删除 ${data.ids?.length || 0} 条${getContentTypeLabel(type)}${data.cleanupWarning ? '，图片素材清理待重试' : ''}`)
      } catch (error) {
        showToast(error.message || '批量删除失败')
      } finally {
        restoreButton()
      }
    },
  })
}

function removeImageItem(index) {
  const item = imageState[index]
  if (!item?.id) return
  openConfirm({
    title: '删除图片素材',
    message: '仅删除素材登记，不会删除 COS 中的原始文件。',
    onConfirm: async () => {
      try {
        await apiRequest('/api/admin/images/delete', {
          method: 'POST',
          body: JSON.stringify({ id: item.id }),
        })
        await loadImages()
        showToast('图片素材已删除')
      } catch (error) {
        showToast(error.message || '图片删除失败')
      }
    },
  })
}

function getSourceLabel(source) {
  const labels = {
    daily_content: '手记',
    article: '文章',
    articles: '文章',
    letter: '心笺',
    letters: '心笺',
  }
  return labels[source] || source || '未知来源'
}

function getSecurityStatusLabel(status) {
  const labels = {
    blocked: '已拦截',
    failed: '检测失败',
    passed: '已通过',
    safe: '已通过',
  }
  return labels[status] || status || '已通过'
}

function getSecurityBadge(status) {
  const badges = {
    blocked: 'danger',
    failed: 'danger',
    passed: 'success',
    safe: 'success',
  }
  return badges[status] || 'success'
}

function getMiniProgramName(id) {
  if (!id) return '未记录小程序'
  return (adminSettingsState.miniPrograms || []).find((item) => item.id === id)?.name || '未匹配小程序'
}

function getMiniProgramMeta(item = {}) {
  const matched = (adminSettingsState.miniPrograms || []).some((program) => program.id === item.miniProgramId)
  const parts = []
  if (item.miniProgramId && !matched) parts.push(`原 ID: ${item.miniProgramId}`)
  if (item.visitorId) parts.push(`访客: ${item.visitorId}`)
  return parts.join(' · ')
}

function getStatusLabel(status) {
  const labels = {
    blocked: '已拦截',
    saved: '已通过',
  }
  return labels[status] || status || '已通过'
}

function getMessageBadge(status) {
  const badges = {
    blocked: 'danger',
    saved: 'info',
  }
  return badges[status || 'saved'] || 'info'
}

function renderMessageMiniProgramFilter() {
  if (!nodes.messageMiniProgramFilter) return
  const current = nodes.messageMiniProgramFilter.value || 'all'
  nodes.messageMiniProgramFilter.innerHTML = '<option value="all">全部小程序</option>' + (adminSettingsState.miniPrograms || [])
    .filter((item) => item.status !== 'archived')
    .map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('')
  nodes.messageMiniProgramFilter.value = current === 'all' || (adminSettingsState.miniPrograms || []).some((item) => item.id === current)
    ? current
    : 'all'
}

function renderMessages(items, options = {}) {
  if (!options.filtered) messageState = items || []
  renderMessageMiniProgramFilter()
  const visibleItems = items || []
  if (!visibleItems.length) {
    nodes.messageList.innerHTML = `<div class="empty-panel">暂无符合筛选条件的留言</div>${renderPagination('messages', messagePagination)}`
    renderSecurityStats()
    return
  }
  nodes.messageList.innerHTML = `
    <table class="data-table">
      <colgroup><col class="col-id"></colgroup>
      <thead><tr><th>ID</th><th>留言内容</th><th>小程序</th><th>来源</th><th>时间</th><th>安全检测</th><th>审核状态</th><th>操作</th></tr></thead>
      <tbody>
        ${visibleItems.map((item, index) => `
          <tr>
            <td data-label="ID">${rowNumber(index)}</td>
            <td data-label="留言内容">
              ${escapeHtml(compactPreview(item.content, 42))}
              <span class="cell-note">${item.sourceId ? `来源 ID: ${escapeHtml(item.sourceId)} · ` : ''}${escapeHtml(item.security?.reason || '')}</span>
            </td>
            <td class="message-source-cell" data-label="小程序">
              <strong>${escapeHtml(getMiniProgramName(item.miniProgramId))}</strong>
              <span class="cell-note">${escapeHtml(getMiniProgramMeta(item) || '访客: anonymous')}</span>
            </td>
            <td data-label="来源">${escapeHtml(getSourceLabel(item.source))}</td>
            <td data-label="时间">${new Date(item.createdAt).toLocaleString('zh-CN')}</td>
            <td data-label="安全检测"><span class="badge badge-${escapeAttr(getSecurityBadge(item.security?.status || 'passed'))}">${escapeHtml(getSecurityStatusLabel(item.security?.status || 'passed'))}</span></td>
            <td data-label="审核状态"><span class="badge badge-${escapeAttr(getMessageBadge(item.status || 'saved'))}">${escapeHtml(getStatusLabel(item.status || 'saved'))}</span></td>
            <td class="row-actions" data-label="操作">
              <button class="btn-text btn-success" type="button" data-message-status="saved" data-message-id="${escapeAttr(item.id)}">通过</button>
              <button class="btn-text" type="button" data-message-status="blocked" data-message-id="${escapeAttr(item.id)}">拦截</button>
              <button class="btn-text btn-danger" type="button" data-message-delete="${escapeAttr(item.id)}">删除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${renderPagination('messages', messagePagination)}
  `
  renderSecurityStats()
}

function applyMessageFilters() {
  loadMessages(1)
}

async function loadMessages(page = messagePagination.page || 1) {
  try {
    const query = new URLSearchParams({ page, pageSize: messagePagination.pageSize || PAGE_SIZES[0] })
    const miniProgramId = nodes.messageMiniProgramFilter?.value || 'all'
    const source = nodes.messageSourceFilter?.value || 'all'
    const status = nodes.messageStatusFilter?.value || 'all'
    const keyword = nodes.messageSearchInput?.value.trim() || ''
    if (miniProgramId !== 'all') query.set('miniProgramId', miniProgramId)
    if (source !== 'all') query.set('source', source)
    if (status !== 'all') query.set('status', status)
    if (keyword) query.set('keyword', keyword)
    const data = await apiRequest(`/api/admin/messages?${query}`)
    messagePagination = data.pagination || createPaginationState()
    renderMessages(data.items || [])
    await refreshAdminOverview()
  } catch (error) {
    showToast('留言加载失败，请稍后重试。')
  }
}

async function updateMessageStatus(id, status) {
  try {
    const data = await apiRequest('/api/admin/messages/status', {
      method: 'POST',
      body: JSON.stringify({ id, status }),
    })
    messageState = messageState.map((item) => (item.id === data.id ? data : item))
    applyMessageFilters()
    await refreshAdminOverview()
    await loadAdminSettings()
    showToast('留言状态已更新')
  } catch (error) {
    showToast(error.message || '状态更新失败')
  }
}

function deleteMessage(id) {
  openConfirm({
    title: '删除私密留言',
    message: '删除后这条留言记录将不可恢复。',
    onConfirm: async () => {
      try {
        const data = await apiRequest('/api/admin/messages/delete', {
          method: 'POST',
          body: JSON.stringify({ id }),
        })
        messageState = messageState.filter((item) => item.id !== data.id)
        applyMessageFilters()
        await refreshAdminOverview()
        await loadAdminSettings()
        showToast('留言已删除')
      } catch (error) {
        showToast(error.message || '留言删除失败')
      }
    },
  })
}

function addKeyword(field) {
  appendKeywordBatch(field)
}

function removeKeyword(button) {
  button.closest('.keyword-row')?.remove()
}

function renderAccounts(items, policy) {
  accountPolicy = policy
  if (!nodes.accountList) return
  if (!items?.length) {
    nodes.accountList.innerHTML = `<div class="empty-panel">暂无账号</div>${renderPagination('accounts', accountPagination)}`
    return
  }
  nodes.accountList.innerHTML = `
    <table class="data-table">
      <colgroup><col class="col-id"></colgroup>
      <thead><tr><th>ID</th><th>账号</th><th>昵称</th><th>手机号</th><th>同步状态</th><th>更新时间</th><th>操作</th></tr></thead>
      <tbody>
        ${items.map((item, index) => `
          <tr>
            <td data-label="ID">${rowNumber(index)}</td>
            <td data-label="账号"><strong>${escapeHtml(item.accountId)}</strong><span class="cell-note">${escapeHtml(item.unionid || '未返回 unionid')}</span></td>
            <td data-label="昵称">${escapeHtml(item.nickname || '-')}</td>
            <td data-label="手机号">${escapeHtml(item.phone || '未授权')}</td>
            <td data-label="同步状态"><span class="badge badge-${item.loginSynced ? 'success' : 'draft'}">${item.loginSynced ? '已登录同步' : '未登录同步'}</span></td>
            <td data-label="更新时间">${new Date(item.updatedAt).toLocaleString('zh-CN')}</td>
            <td data-label="操作"><button class="btn-text btn-danger" data-account-delete="${escapeAttr(item.accountId)}" type="button">注销</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${renderPagination('accounts', accountPagination)}
    <p class="setting-note">同步策略：${escapeHtml(policy?.mergeStrategy || 'unionid-first-phone-fallback')}</p>
  `
}

async function loadAccounts(page = accountPagination.page || 1) {
  if (!nodes.accountList && !nodes.accountStatus) return
  try {
    const miniProgramId = getCurrentMiniProgram()?.id || ''
    const pageSize = accountPagination.pageSize || PAGE_SIZES[0]
    const data = await apiRequest(`/api/admin/accounts?miniProgramId=${encodeURIComponent(miniProgramId)}&page=${page}&pageSize=${pageSize}`)
    accountPagination = data.pagination || createPaginationState()
    renderAccounts(data.items || [], data.policy)
    await refreshAdminOverview()
    setStatus(nodes.accountStatus, '')
  } catch (error) {
    showToast('账号加载失败，请稍后重试。')
  }
}

function deleteAccount(accountId) {
  const miniProgram = getCurrentMiniProgram()
  if (!miniProgram || !accountId) return
  openConfirm({
    title: '确认注销当前小程序账号',
    message: `将删除该用户在“${miniProgram.name}”中的账号、登录会话和使用数据；其他小程序中的账号不受影响。此操作无法撤销。`,
    onConfirm: async () => {
      try {
        await apiRequest('/api/admin/accounts/delete', {
          method: 'POST',
          body: JSON.stringify({ accountId, miniProgramId: miniProgram.id }),
        })
        await loadAccounts()
        showToast('当前小程序账号已注销')
      } catch (error) {
        showToast(error.message || '账号注销失败')
      }
    },
  })
}

function fileExt(name) {
  const match = String(name || '').match(/\.([^.]+)$/)
  return (match?.[1] || '').toLowerCase()
}

function isImageFile(file) {
  if (!file || !['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExt(file.name))) return false
  const type = String(file.type || '').toLowerCase()
  return !type || ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(type)
}

function isArticleCoverFile(file) {
  if (!file || !['png', 'jpg', 'jpeg', 'webp'].includes(fileExt(file.name))) return false
  const type = String(file.type || '').toLowerCase()
  return !type || ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(type)
}

function isAudioFile(file) {
  if (!file || !['mp3', 'm4a'].includes(fileExt(file.name))) return false
  const type = String(file.type || '').toLowerCase().split(';')[0]
  return !type || type === 'application/octet-stream' || (
    fileExt(file.name) === 'mp3'
      ? ['audio/mpeg', 'audio/mp3', 'audio/mpeg3'].includes(type)
      : ['audio/mp4', 'audio/x-m4a', 'audio/m4a'].includes(type)
  )
}

function makeEntityId(prefix, name) {
  const normalized = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${prefix}-${normalized || Date.now().toString(36)}`
}

function makeMiniProgramId(name) {
  const baseId = makeEntityId('mp', name)
  const ids = new Set((adminSettingsState.miniPrograms || []).map((item) => item.id))
  if (!ids.has(baseId)) return baseId
  let suffix = 2
  while (ids.has(`${baseId}-${suffix}`)) suffix += 1
  return `${baseId}-${suffix}`
}

async function createContentPool() {
  const name = nodes.newPoolName?.value.trim()
  if (!name) {
    showToast('请输入内容池名称')
    return
  }
  const exists = adminSettingsState.contentPools.some((item) => item.name === name)
  if (exists) {
    showToast('内容池名称已存在')
    return
  }
  const contentPools = [
    ...adminSettingsState.contentPools,
    {
      id: makeEntityId('pool', name),
      name,
      remark: nodes.newPoolRemark?.value.trim() || '',
      createdAt: new Date().toISOString(),
    },
  ]
  try {
    await saveAdminSettings(
      { contentPools },
      { type: '内容池管理', target: name, description: `已创建内容池「${name}」` },
    )
    nodes.newPoolName.value = ''
    if (nodes.newPoolRemark) nodes.newPoolRemark.value = ''
    closeModal(nodes.addPoolModal)
    showToast('内容池已创建')
  } catch (error) {
    showToast(error.message || '内容池创建失败')
  }
}

function openEditContentPool(id) {
  const pool = (adminSettingsState.contentPools || []).find((item) => item.id === id)
  if (!pool || !nodes.editPoolModal) return
  editingPoolMetaId = id
  if (nodes.editPoolName) nodes.editPoolName.value = pool.name || ''
  if (nodes.editPoolRemark) nodes.editPoolRemark.value = pool.remark || ''
  openModal(nodes.editPoolModal)
  nodes.editPoolName?.focus()
}

async function saveEditedContentPool() {
  const id = editingPoolMetaId
  const pool = (adminSettingsState.contentPools || []).find((item) => item.id === id)
  const name = nodes.editPoolName?.value.trim() || ''
  const remark = nodes.editPoolRemark?.value.trim() || ''
  if (!pool) return
  if (!name) {
    showToast('请输入内容池名称')
    return
  }
  if ((adminSettingsState.contentPools || []).some((item) => item.id !== id && item.name === name)) {
    showToast('内容池名称已存在')
    return
  }
  try {
    await saveAdminSettings(
      { contentPools: adminSettingsState.contentPools.map((item) => item.id === id ? { ...item, name, remark } : item) },
      { type: '内容池管理', target: name, description: `已编辑内容池「${name}」` },
    )
    editingPoolMetaId = ''
    closeModal(nodes.editPoolModal)
    showToast('内容池已保存')
  } catch (error) {
    showToast(error.message || '内容池保存失败')
  }
}

async function deleteContentPool(id) {
  const pool = adminSettingsState.contentPools.find((item) => item.id === id)
  if (!pool) return
  const usage = adminSettingsState.miniPrograms.filter((item) => item.status !== 'archived' && getMiniProgramContentPoolId(item) === id).length
  if (usage > 0) {
    showToast('该内容池正被小程序使用，无法删除')
    return
  }
  openConfirm({
    title: '删除内容池',
    message: '删除后池内所有内容将一并删除，且不可恢复。',
    onConfirm: async () => {
      try {
        renderAdminSettings(await apiRequest('/api/admin/content-pools/delete', {
          method: 'POST',
          body: JSON.stringify({ id }),
        }))
        await loadContentEditor()
        await refreshAdminOverview()
        showToast('内容池已删除')
      } catch (error) {
        showToast(error.message || '内容池删除失败')
      }
    },
  })
}

async function setActivePool(id) {
  if (!id || id === getEditingContentPoolId()) {
    renderContentPools()
    return
  }
  if (!(adminSettingsState.contentPools || []).some((item) => item.id === id)) return
  const previousPoolId = editingContentPoolId
  editingContentPoolId = id
  renderContentPools()
  if (await loadContentEditor(id)) {
    showToast(`正在编辑「${getContentPoolName(id)}」`)
    return
  }
  editingContentPoolId = previousPoolId
  renderContentPools()
}

async function setActiveMiniProgram(id) {
  if (!id || id === adminSettingsState.currentMiniProgramId) {
    updateCurrentMiniProgramName()
    return Boolean(id)
  }
  try {
    await saveMiniProgramRequest('/api/admin/miniprogram/select', { id })
    syncEditingContentPoolToCurrentMiniProgram()
    renderContentPools()
    await loadContentEditor()
    await loadAccounts()
    showToast('当前小程序已切换')
    return true
  } catch (error) {
    renderMiniProgramSwitcher()
    showToast(error.message || '小程序切换失败')
    return false
  }
}

function collectStorageSettings() {
  const storage = {}
  document.querySelectorAll('[data-storage-field]').forEach((field) => {
    storage[field.dataset.storageField] = field.dataset.secretReveal
      ? collectManagedSecret(field)
      : field.value.trim()
  })
  return storage
}

function parseTextLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

async function saveStorageSettings() {
  const restoreButton = setButtonsLoading([nodes.saveStorageSettings], '保存中…')
  setStorageConnectionStatus('')
  try {
    const data = await saveAdminSettings(
      { storage: collectStorageSettings() },
      { type: '安全与存储', target: '图片素材', description: 'COS 配置已保存，密钥仅保留在服务端' },
    )
    if (!data.storageCors?.ok) throw new Error(data.storageCors?.message || 'COS 直传跨域规则配置失败')
    await testStorageSettings()
    showToast('COS 配置与直传规则已保存')
  } catch (error) {
    setStorageConnectionStatus(error.message || 'COS 配置保存失败', 'error')
  } finally {
    restoreButton()
  }
}

async function testStorageSettings() {
  const restoreButton = setButtonsLoading([nodes.testStorageSettings], '测试中…')
  setStorageConnectionStatus('')
  try {
    const data = await apiRequest('/api/admin/storage/test', { method: 'POST' })
    if (data.ok) {
      setStorageConnectionStatus('当前配置可用', 'ok')
      showToast(data.message || 'COS 连接正常')
    } else {
      setStorageConnectionStatus(data.message || 'COS 连接测试失败', 'error')
    }
    return data
  } catch (error) {
    setStorageConnectionStatus(error.message || 'COS 连接测试失败', 'error')
    return null
  } finally {
    restoreButton()
  }
}

function collectSystemSettings() {
  const dailyContentPromptTexts = parseTextLines(document.querySelector('[data-system-field="dailyContentPromptTexts"]')?.value)
  // 空列表 = 显式清空，保存空数组由客户端回落内置默认文案（与服务端校验一致）
  const invalidDailyContentPrompt = dailyContentPromptTexts.find((text) => {
    const commaIndex = text.indexOf('，')
    return commaIndex <= 0 || commaIndex >= text.length - 1
  })
  if (invalidDailyContentPrompt) {
    throw new Error('打开前引导文案每行必须包含中文逗号“，”，且逗号前后都要有文字')
  }

  const settings = {
    homeHero: document.querySelector('[data-system-field="homeHero"]')?.value.trim() || '',
    articlesHero: document.querySelector('[data-system-field="articlesHero"]')?.value.trim() || '',
    lettersHero: document.querySelector('[data-system-field="lettersHero"]')?.value.trim() || '',
    articlesSortMode: document.querySelector('[data-system-field="articlesSortMode"]')?.value === 'sequence' ? 'sequence' : 'random',
    lettersSortMode: document.querySelector('[data-system-field="lettersSortMode"]')?.value === 'sequence' ? 'sequence' : 'random',
    checkinButtonText: document.querySelector('[data-system-field="checkinButtonText"]')?.value.trim() || '',
    checkinBeforeTexts: parseTextLines(document.querySelector('[data-system-field="checkinBeforeTexts"]')?.value),
    checkinAfterTexts: parseTextLines(document.querySelector('[data-system-field="checkinAfterTexts"]')?.value),
    checkinAdIncompleteText: document.querySelector('[data-system-field="checkinAdIncompleteText"]')?.value.trim() || '',
    dailyContentButtonText: document.querySelector('[data-system-field="dailyContentButtonText"]')?.value.trim() || '',
    dailyContentPromptTexts,
    dailyContentAdIncompleteText: document.querySelector('[data-system-field="dailyContentAdIncompleteText"]')?.value.trim() || '',
    articleAdIncompleteText: document.querySelector('[data-system-field="articleAdIncompleteText"]')?.value.trim() || '',
    homeStats: {
      rankToday: {
        label: document.querySelector('[data-home-stat-label="rankToday"]')?.value.trim() || '今天第几位',
        visible: Boolean(document.querySelector('[data-home-stat-visible="rankToday"]')?.checked),
      },
      checkInDays: {
        label: document.querySelector('[data-home-stat-label="checkInDays"]')?.value.trim() || '已连续打卡',
        visible: Boolean(document.querySelector('[data-home-stat-visible="checkInDays"]')?.checked),
      },
      companionValue: {
        label: document.querySelector('[data-home-stat-label="companionValue"]')?.value.trim() || '累计阅读值',
        visible: Boolean(document.querySelector('[data-home-stat-visible="companionValue"]')?.checked),
      },
    },
    tabs: {
      home: {
        label: '首页',
        visible: Boolean(document.querySelector('[data-tab-visible="home"]')?.checked),
        locked: true,
      },
      articles: {
        label: document.querySelector('[data-tab-field="articles"]')?.value.trim() || '文章',
        visible: Boolean(document.querySelector('[data-tab-visible="articles"]')?.checked),
      },
      letters: {
        label: document.querySelector('[data-tab-field="letters"]')?.value.trim() || '心笺',
        visible: Boolean(document.querySelector('[data-tab-visible="letters"]')?.checked),
      },
      mine: { label: '我的', visible: true, locked: true },
    },
  }
  return settings
}

async function saveSystemSettings(event) {
  const saveButtons = [...document.querySelectorAll('[data-save-system]')]
  const restoreButtons = setButtonsLoading(saveButtons, '保存中…')
  try {
    const payload = { system: collectSystemSettings() }
    if (event?.currentTarget?.id === 'saveSystemSettings') payload.limits = collectLimitConfig()
    await apiRequest('/api/admin/content', {
      method: 'POST',
      body: JSON.stringify(withEditingContentPool(
        payload,
        event?.currentTarget?.id === 'saveSystemSettings' ? 'copy' : 'display',
      )),
    })
    await loadContentEditor()
    await refreshAdminOverview()
    showToast('前台显示设置已保存')
  } catch (error) {
    showToast(error.message || '前台显示设置保存失败')
  } finally {
    restoreButtons()
  }
}

function collectSecuritySettings() {
  return {
    blockedWords: collectKeywordList('blockedWords'),
    textCheck: Boolean(document.querySelector('[data-security-field="textCheck"]')?.checked),
    imageCheck: Boolean(document.querySelector('[data-security-field="imageCheck"]')?.checked),
    mode: 'auto-block',
  }
}

async function saveSecuritySettings() {
  const saveButtons = [...document.querySelectorAll('[data-save-security]')]
  const restoreButtons = setButtonsLoading(saveButtons, '保存中…')
  try {
    await saveAdminSettings(
      { security: collectSecuritySettings() },
      { type: '安全与存储', target: '安全检测配置', description: '内容安全设置已保存' },
    )
    showToast('内容安全设置已保存')
  } catch (error) {
    showToast(error.message || '内容安全设置保存失败')
  } finally {
    restoreButtons()
  }
}

function collectMiniProgramInfo() {
  const current = getCurrentMiniProgram()
  const config = getMiniProgramConfig(current)
  return {
    ...current,
    name: document.querySelector('[data-mp-field="name"]')?.value.trim() || current.name,
    appId: document.querySelector('[data-mp-field="appId"]')?.value.trim() || '',
    appSecret: collectManagedSecret(document.querySelector('[data-mp-field="appSecret"]')),
    developerEmail: document.querySelector('[data-mp-field="developerEmail"]')?.value.trim() || '',
    remark: document.querySelector('[data-mp-field="remark"]')?.value.trim() || '',
    config: {
      ...config,
      contentPoolId: document.querySelector('[data-mp-field="contentPoolId"]')?.value || config.contentPoolId,
    },
  }
}

async function saveMiniProgramInfo() {
  const current = getCurrentMiniProgram()
  if (!current) return
  const restoreButton = setButtonsLoading([nodes.saveMiniProgramInfo], '保存中…')
  const next = collectMiniProgramInfo()
  if (!next.appId) {
    showToast('AppID 不能为空')
    restoreButton()
    return
  }
  try {
    const contentPoolChanged = getMiniProgramContentPoolId(current) !== next.config.contentPoolId
    await saveMiniProgramRequest(
      '/api/admin/miniprogram/update',
      {
        id: current.id,
        miniProgram: next,
        meta: contentPoolChanged
        ? { type: '内容池管理', target: next.name, description: `小程序「${next.name}」已改用「${getContentPoolName(next.config.contentPoolId)}」` }
        : { type: '小程序配置', target: next.name, description: `小程序「${next.name}」配置已保存` },
      },
    )
    if (contentPoolChanged) {
      syncEditingContentPoolToCurrentMiniProgram()
      renderContentPools()
    }
    await loadContentEditor()
    await refreshAdminOverview()
    showToast('小程序信息已保存')
  } catch (error) {
    showToast(error.message || '小程序信息保存失败')
  } finally {
    restoreButton()
  }
}

function collectDailyContentTypes() {
  const current = getMiniProgramConfig(getCurrentMiniProgram()).dailyContentTypes || {}
  const imageEnabled = document.querySelector('[data-daily-content-type-field="imageEnabled"]')
  const audioEnabled = document.querySelector('[data-daily-content-type-field="audioEnabled"]')
  return {
    ...current,
    imageEnabled: imageEnabled.value === 'enabled',
    audioEnabled: audioEnabled.value === 'enabled',
  }
}

function collectMessagesEnabled() {
  return document.querySelector('[data-feature-field="messagesEnabled"]')?.value !== 'disabled'
}

function collectGlobalFeatureRules() {
  const config = getMiniProgramConfig(getCurrentMiniProgram())
  const configWithoutLimits = { ...config }
  delete configWithoutLimits.limits
  return {
    ...configWithoutLimits,
    mode: config.mode === 'audit' ? 'audit' : 'default',
    dailyContentTypes: collectDailyContentTypes(),
    messagesEnabled: collectMessagesEnabled(),
    articleDisplay: {
      ...(config.articleDisplay || {}),
      layout: ['title-left', 'stacked', 'mixed'].includes(nodes.articleListLayout?.value) ? nodes.articleListLayout.value : 'mixed',
    },
    system: {
      ...config.system,
      articlesSortMode: document.querySelector('[data-system-field="articlesSortMode"]')?.value === 'sequence' ? 'sequence' : 'random',
      lettersSortMode: document.querySelector('[data-system-field="lettersSortMode"]')?.value === 'sequence' ? 'sequence' : 'random',
    },
  }
}

async function saveGlobalFeatureRules() {
  const current = getCurrentMiniProgram()
  if (!current) return
  const buttons = [...document.querySelectorAll('[data-save-global-feature-rules]')]
  const restoreButtons = setButtonsLoading(buttons, '保存中…')
  try {
    await saveMiniProgramRequest('/api/admin/miniprogram/config', {
      id: current.id,
      config: collectGlobalFeatureRules(),
      meta: { type: '小程序配置', target: current.name, description: '全局功能规则已保存' },
    })
    showToast('全局功能规则已保存')
  } catch (error) {
    showToast(error.message || '全局功能规则保存失败')
  } finally {
    restoreButtons()
  }
}

function applyModePreset(mode) {
  const isAudit = mode === 'audit'
  const messagesEnabled = document.querySelector('[data-feature-field="messagesEnabled"]')
  if (messagesEnabled) messagesEnabled.value = isAudit ? 'disabled' : 'enabled'

  const ads = getMiniProgramConfig(getCurrentMiniProgram()).ads || {}
  Object.entries(ads).forEach(([key, item]) => {
    const enabled = document.querySelector(`[data-config-group="ads"][data-config-key="${key}"][data-config-field="enabled"]`)
    if (item.adType === 'rewarded') {
      const freeCount = document.querySelector(`[data-config-group="ads"][data-config-key="${key}"][data-config-field="freeCount"]`)
      if (freeCount) freeCount.value = isAudit ? '3' : '0'
    }
    if (item.adType === 'interstitial') {
      if (enabled) enabled.checked = !isAudit
    }
    if (!isAudit && enabled) enabled.checked = true
  })

  const homeVisible = document.querySelector('[data-tab-visible="home"]')
  if (homeVisible) homeVisible.checked = !isAudit
  const dailyContentLimit = document.querySelector('[data-limit-field="dailyContentLimit"]')
  if (dailyContentLimit) dailyContentLimit.value = isAudit ? '0' : '5'
}

function collectModeConfig(mode, dataMode) {
  const current = getMiniProgramConfig(getCurrentMiniProgram())
  const system = current.system || {}
  const tabs = system.tabs || {}
  const home = tabs.home || { label: '首页', locked: true }
  const articles = tabs.articles || { label: '文章' }
  return {
    ...current,
    dataMode: dataMode === 'independent' ? 'independent' : 'shared',
    mode: mode === 'audit' ? 'audit' : 'default',
    ads: collectSwitchConfig('ads', contentState.ads),
    dailyContentTypes: collectDailyContentTypes(),
    messagesEnabled: collectMessagesEnabled(),
    limits: collectLimitConfig(),
    system: {
      ...system,
      tabs: {
        ...tabs,
        home: { ...home, visible: Boolean(document.querySelector('[data-tab-visible="home"]')?.checked) },
        articles: { ...articles, visible: Boolean(document.querySelector('[data-tab-visible="articles"]')?.checked) },
      },
    },
  }
}

function restoreSavedModeConfig() {
  renderMiniProgramInfo()
  renderLimitConfigEditor(contentState.limits)
  renderOpsConfigEditor(contentState)
  renderSystemSettings()
}

async function saveModePreset() {
  const current = getCurrentMiniProgram()
  if (!current) return
  const mode = nodes.miniProgramMode?.value === 'audit' ? 'audit' : 'default'
  const previousDataMode = getMiniProgramDataMode(current)
  const dataMode = nodes.miniProgramDataMode?.value === 'independent' ? 'independent' : 'shared'
  const dataModeChanged = dataMode !== previousDataMode
  if (nodes.miniProgramDataMode) nodes.miniProgramDataMode.disabled = true
  if (nodes.miniProgramMode) nodes.miniProgramMode.disabled = true
  const restoreButton = setButtonsLoading([nodes.saveMiniProgramMode], dataModeChanged ? '迁移中…' : '保存中…')
  try {
    await saveMiniProgramRequest('/api/admin/miniprogram/config', {
      id: current.id,
      config: collectModeConfig(mode, dataMode),
      meta: {
        type: '小程序配置',
        target: current.name,
        description: dataModeChanged
          ? `已切换为${dataMode === 'shared' ? '共享数据' : '独立数据'}并完成数据迁移`
          : `${mode === 'audit' ? '审核' : '默认'}模式配置已应用`,
      },
    })
    if (getMiniProgramDataMode() !== dataMode) throw new Error('服务端未确认新的数据模式')
    await loadContentEditor()
    showToast(dataModeChanged
      ? `已切换为${dataMode === 'shared' ? '共享数据' : '独立数据'}，数据迁移完成`
      : `${mode === 'audit' ? '审核' : '默认'}模式已应用`)
  } catch (error) {
    restoreSavedModeConfig()
    showToast(dataModeChanged
      ? `数据模式切换失败：${error.message || '数据迁移未完成'}`
      : (error.message || '模式配置保存失败'))
  } finally {
    if (nodes.miniProgramDataMode) nodes.miniProgramDataMode.disabled = false
    if (nodes.miniProgramMode) nodes.miniProgramMode.disabled = false
    restoreButton()
  }
}

async function createMiniProgram() {
  const name = nodes.newMpName?.value.trim()
  const appId = nodes.newMpAppId?.value.trim()
  const appSecret = nodes.newMpAppSecret?.value.trim() || ''
  const developerEmail = nodes.newMpDeveloperEmail?.value.trim() || ''
  if (!name || !appId || !appSecret || !developerEmail) {
    showToast('请填写名称、AppID、AppSecret 和开发者邮箱')
    return
  }
  if (!/^wx[a-zA-Z0-9]{16}$/.test(appId)) {
    showToast('AppID 格式不正确')
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(developerEmail)) {
    showToast('开发者邮箱格式不正确')
    return
  }
  if (adminSettingsState.miniPrograms.some((item) => item.appId === appId)) {
    showToast('AppID 已存在')
    return
  }
  const next = {
    id: makeMiniProgramId(name),
    name,
    appId,
    appSecret,
    developerEmail,
    remark: nodes.newMpRemark?.value.trim() || '',
    status: 'active',
    config: {
      contentPoolId: nodes.newMpContentPool?.value || adminSettingsState.contentPools?.[0]?.id,
    },
    createdAt: new Date().toISOString(),
  }
  nodes.createMpBtn.disabled = true
  try {
    await saveMiniProgramRequest('/api/admin/miniprogram/create', {
      miniProgram: next,
      meta: { type: '小程序管理', target: name, description: `已接入小程序「${name}」` },
    })
    ;[nodes.newMpName, nodes.newMpAppId, nodes.newMpAppSecret, nodes.newMpDeveloperEmail, nodes.newMpRemark].forEach((field) => {
      if (field) field.value = ''
    })
    setSecretVisibilityById('newMpAppSecret', false)
    closeModal(nodes.addMpModal)
    showToast('小程序已创建')
  } catch (error) {
    showToast(error.message || '小程序创建失败')
  } finally {
    nodes.createMpBtn.disabled = false
  }
}

async function reorderMiniProgram(id, direction) {
  if (!['up', 'down'].includes(direction)) return
  try {
    await apiRequest('/api/admin/miniprogram/reorder', {
      method: 'POST',
      body: JSON.stringify({ id, direction }),
    })
    await refreshMiniProgramTable(direction === 'up' ? '小程序已上移' : '小程序已下移')
  } catch (error) {
    showToast(error.message || '小程序排序失败')
  }
}

async function deleteMiniProgram(id) {
  const item = adminSettingsState.miniPrograms.find((program) => program.id === id)
  if (!item) return
  if (getActiveMiniPrograms().length <= 1) {
    showToast('至少保留一个已接入的小程序')
    return
  }
  openConfirm({
    title: `永久删除「${item.name}」`,
    message: '删除后无法恢复。该小程序将立即停止访问服务，其专属配置、业务记录、代码上传密钥和上传记录会被永久删除；绑定的内容池及池内全部内容会保留，不受影响。',
    confirmLabel: '永久删除',
    danger: true,
    onConfirm: async () => {
      try {
        const data = await apiRequest('/api/admin/miniprogram/delete', {
          method: 'POST',
          body: JSON.stringify({
            id,
            meta: { type: '小程序管理', target: item.name, description: `小程序「${item.name}」已永久删除`, badge: 'danger' },
          }),
        })
        const message = data.deletion?.cleanupError
          ? '小程序记录已删除，但上传密钥/记录清理失败，请检查'
          : '小程序已永久删除'
        await refreshMiniProgramTable(message)
      } catch (error) {
        showToast(error.message || '小程序删除失败')
      }
    },
  })
}

function openMiniProgramUpload(id) {
  const item = getActiveMiniPrograms().find((program) => program.id === id)
  if (!item) return
  uploadingMiniProgramId = item.id
  if (nodes.uploadMiniProgramHint) nodes.uploadMiniProgramHint.textContent = `将当前小程序源码上传为「${item.name}」的微信开发版。`
  if (nodes.uploadMiniProgramPrivateKey) {
    nodes.uploadMiniProgramPrivateKey.value = ''
    nodes.uploadMiniProgramPrivateKey.required = !item.uploadKeyConfigured
    nodes.uploadMiniProgramPrivateKey.placeholder = item.uploadKeyConfigured
      ? '密钥已安全加载；留空继续使用，粘贴新密钥可直接替换'
      : '粘贴微信公众平台生成的完整密钥'
  }
  if (nodes.uploadMiniProgramPrivateKeyHint) {
    nodes.uploadMiniProgramPrivateKeyHint.textContent = item.uploadKeyConfigured
      ? '已加载该小程序的密钥，留空即可直接上传。'
      : '首次上传需要填写，保存后同一小程序会自动加载。'
  }
  if (nodes.uploadMiniProgramVersion) nodes.uploadMiniProgramVersion.value = ''
  if (nodes.uploadMiniProgramDescription) nodes.uploadMiniProgramDescription.value = ''
  openModal(nodes.uploadMiniProgramModal)
  apiRequest('/api/admin/miniprogram/version-preview', {
    method: 'POST',
    body: JSON.stringify({ miniProgramId: item.id }),
  }).then((data) => {
    if (nodes.uploadMiniProgramVersion && !nodes.uploadMiniProgramVersion.value.trim()) {
      nodes.uploadMiniProgramVersion.value = data.version || ''
    }
  }).catch(() => {})
  ;(item.uploadKeyConfigured ? nodes.uploadMiniProgramVersion : nodes.uploadMiniProgramPrivateKey)?.focus()
}

function closeMiniProgramUpload() {
  if (nodes.uploadMiniProgramPrivateKey) nodes.uploadMiniProgramPrivateKey.value = ''
  uploadingMiniProgramId = ''
  closeModal(nodes.uploadMiniProgramModal)
}

async function uploadMiniProgramCode() {
  if (!uploadingMiniProgramId) return
  const privateKey = nodes.uploadMiniProgramPrivateKey?.value.trim() || ''
  const version = nodes.uploadMiniProgramVersion?.value.trim() || ''
  const description = nodes.uploadMiniProgramDescription?.value.trim() || ''
  const miniProgram = getActiveMiniPrograms().find((item) => item.id === uploadingMiniProgramId)
  if (!miniProgram?.uploadKeyConfigured && !privateKey) {
    showToast('请填写代码上传密钥')
    nodes.uploadMiniProgramPrivateKey?.focus()
    return
  }
  if (!description) {
    showToast('请填写更新说明')
    nodes.uploadMiniProgramDescription?.focus()
    return
  }
  const cancelButton = document.querySelector('#cancelUploadMiniProgram')
  const restoreButton = setButtonsLoading([
    document.querySelector('#confirmUploadMiniProgram'),
  ], '上传中…')
  if (cancelButton) cancelButton.disabled = true
  try {
    await apiRequest('/api/admin/miniprogram/upload', {
      method: 'POST',
      body: JSON.stringify({ miniProgramId: uploadingMiniProgramId, privateKey, version, description }),
    })
    miniProgram.uploadKeyConfigured = true
    closeMiniProgramUpload()
    await refreshMiniProgramTable('代码已上传至微信公众平台开发版')
  } catch (error) {
    await loadAdminSettings().catch(() => {})
    showToast(error.message || '代码上传失败')
  } finally {
    restoreButton()
    if (cancelButton) cancelButton.disabled = false
  }
}

function initShellInteractions() {
  document.querySelector('#loginBtn')?.addEventListener('click', async () => {
    const account = nodes.loginAccountInput?.value.trim() || ''
    const password = nodes.loginPasswordInput?.value || ''
    if (!account || !password) {
      if (nodes.loginStatus) nodes.loginStatus.textContent = '请输入管理员账号和密码'
      return
    }
    try {
      const data = await apiRequest('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      })
      adminAuthState = {
        account: data.admin?.account || account,
        passwordConfigured: Boolean(data.admin?.passwordConfigured),
        passwordResetHint: data.admin?.passwordResetHint || '',
        session: data.admin?.session || { createdAt: '', expiresAt: '' },
      }
      renderAdminAuth()
      if (nodes.loginStatus) nodes.loginStatus.textContent = '登录成功'
      await bootstrap()
    } catch (error) {
      if (nodes.loginStatus) nodes.loginStatus.textContent = error.message || '登录失败'
    }
  })
  document.querySelector('#logoutBtn')?.addEventListener('click', async () => {
    try {
      await apiRequest('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) })
    } catch (error) {
      // ignore
    }
    showLogin('已退出登录')
    renderAdminAuth()
  })
  document.querySelector('#saveAdminAuthBtn')?.addEventListener('click', async () => {
    const account = nodes.adminAccountInput?.value.trim() || ''
    const currentPassword = nodes.adminCurrentPasswordInput?.value || ''
    const password = nodes.adminPasswordInput?.value || ''
    const confirmPassword = nodes.adminPasswordConfirmInput?.value || ''
    const nextAccount = account || adminAuthState.account || ''
    if (!account) {
      showToast('管理员账号不能为空')
      return
    }
    if (!currentPassword) {
      showToast('请输入当前密码')
      return
    }
    if (!password && nextAccount === adminAuthState.account) {
      showToast('请先修改账号或输入新密码')
      return
    }
    if (password && password !== confirmPassword) {
      showToast('两次输入的新密码不一致')
      return
    }
    try {
      const data = await apiRequest('/api/admin/auth', {
        method: 'POST',
        body: JSON.stringify({ account: nextAccount, currentPassword, password, confirmPassword }),
      })
      if (!data.changed) {
        showToast('账号或密码未发生有效变更')
        return
      }
      adminAuthState = {
        account: data.admin?.account || nextAccount,
        passwordConfigured: Boolean(data.admin?.passwordConfigured),
        passwordResetHint: data.admin?.passwordResetHint || '',
        session: data.admin?.session || { createdAt: '', expiresAt: '' },
      }
      renderAdminAuth()
      if (nodes.loginAccountInput) nodes.loginAccountInput.value = adminAuthState.account || ''
      showLogin('管理员账号已更新，请重新登录')
      showToast('管理员账号已更新')
    } catch (error) {
      showToast(error.message || '保存管理员账号失败')
    }
  })
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => showSection(item.dataset.section))
  })
  nodes.mpSelect?.addEventListener('change', (event) => setActiveMiniProgram(event.target.value))
  nodes.dashboardGroupFilter?.addEventListener('change', () => { void refreshAdminOverview({ reloadPreflight: false }) })
  nodes.manageGroupsBtn?.addEventListener('click', openGroupManager)
  nodes.groupManagerAdd?.addEventListener('click', addGroupManagerDraft)
  nodes.groupManagerCancel?.addEventListener('click', () => { if (!groupManagerSaving) closeModal(nodes.groupManagerModal) })
  nodes.groupManagerSave?.addEventListener('click', saveGroupManager)
  nodes.groupAssignCancel?.addEventListener('click', () => { if (!groupAssignSaving) closeModal(nodes.groupAssignModal) })
  nodes.groupAssignSave?.addEventListener('click', saveMiniProgramGroup)
  nodes.groupManagerModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => { if (!groupManagerSaving) closeModal(nodes.groupManagerModal) })
  nodes.groupAssignModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => { if (!groupAssignSaving) closeModal(nodes.groupAssignModal) })
  nodes.miniProgramMode?.addEventListener('change', (event) => applyModePreset(event.target.value))
  nodes.saveMiniProgramMode?.addEventListener('click', saveModePreset)

  nodes.singleContentCancel?.addEventListener('click', closeSingleContentModal)
  nodes.singleContentSave?.addEventListener('click', saveSingleContent)
  nodes.singleContentSelectImages?.addEventListener('click', () => nodes.singleContentImageInput?.click())
  nodes.singleContentImageInput?.addEventListener('change', () => selectSingleContentImages(nodes.singleContentImageInput.files))
  nodes.singleContentSelectAudio?.addEventListener('click', () => nodes.singleContentAudioInput?.click())
  nodes.singleContentAudioInput?.addEventListener('change', () => selectSingleContentAudio(nodes.singleContentAudioInput.files?.[0]))
  nodes.singleContentImagePreview?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-single-content-image-remove]')
    if (!button) return
    const index = Number(button.dataset.singleContentImageRemove)
    if (!Number.isInteger(index) || !singleContentFiles[index]) return
    singleContentFiles.splice(index, 1)
    singleContentUploadedImages.splice(index, 1)
    renderSingleContentImages()
  })
  nodes.singleContentAudioPreview?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-single-content-audio-remove]')) return
    singleContentAudioFile = null
    singleContentAudioDuration = 0
    singleContentUploadedAudio = null
    renderSingleContentAudio()
  })
  nodes.singleContentModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSingleContentModal)

  document.querySelector('#addMpBtn')?.addEventListener('click', () => {
    if (nodes.newMpAppSecret) nodes.newMpAppSecret.value = ''
    setSecretVisibilityById('newMpAppSecret', false)
    openModal(nodes.addMpModal)
  })
  document.querySelector('#cancelMpBtn')?.addEventListener('click', () => closeModal(nodes.addMpModal))
  document.querySelector('#createMpBtn')?.addEventListener('click', createMiniProgram)
  nodes.addMpModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeModal(nodes.addMpModal))

  document.querySelector('#cancelUploadMiniProgram')?.addEventListener('click', closeMiniProgramUpload)
  document.querySelector('#confirmUploadMiniProgram')?.addEventListener('click', uploadMiniProgramCode)
  nodes.uploadMiniProgramModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeMiniProgramUpload)

  document.querySelector('#addPoolBtn')?.addEventListener('click', () => openModal(nodes.addPoolModal))
  document.querySelector('#cancelPoolBtn')?.addEventListener('click', () => closeModal(nodes.addPoolModal))
  document.querySelector('#createPoolBtn')?.addEventListener('click', createContentPool)
  nodes.addPoolModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeModal(nodes.addPoolModal))
  document.querySelector('#cancelEditPoolBtn')?.addEventListener('click', () => closeModal(nodes.editPoolModal))
  document.querySelector('#saveEditPoolBtn')?.addEventListener('click', saveEditedContentPool)
  nodes.editPoolModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => closeModal(nodes.editPoolModal))

  document.querySelector('#confirmCancel')?.addEventListener('click', closeConfirm)
  document.querySelector('#confirmOk')?.addEventListener('click', () => {
    const action = pendingConfirm
    closeConfirm()
    if (action) action()
  })
  nodes.confirmModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeConfirm)

  document.querySelectorAll('[data-batch-import]').forEach((button) => {
    button.addEventListener('click', () => openContentImport(button.dataset.batchImport))
  })
  document.querySelector('#contentPoolSelect')?.addEventListener('change', (event) => {
    setActivePool(event.target.value)
  })
  document.querySelector('#contentTypeTabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-content-type]')
    if (tab) setActiveContentEditorType(tab.dataset.contentType)
  })
  document.querySelector('#saveStorageSettings')?.addEventListener('click', saveStorageSettings)
  document.querySelector('#testStorageSettings')?.addEventListener('click', testStorageSettings)
  nodes.runPreflightBtn?.addEventListener('click', () => {
    loadPreflight().then((data) => {
      if (data) showToast(data.summary?.ready ? '服务配置检查通过' : '服务配置仍有待处理项')
    })
  })
  nodes.uploadImageBtn?.addEventListener('click', () => nodes.uploadImageFile?.click())
  nodes.uploadImageFile?.addEventListener('change', () => {
    uploadSelectedImage(nodes.uploadImageFile?.files?.[0])
  })
  document.querySelectorAll('[data-save-system]').forEach((button) => {
    button.addEventListener('click', saveSystemSettings)
  })
  document.querySelector('#saveMiniProgramInfo')?.addEventListener('click', saveMiniProgramInfo)
  document.querySelectorAll('[data-secret-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const inputId = toggle.dataset.secretToggle || ''
      const input = document.querySelector(`#${inputId}`)
      if (input?.dataset.secretReveal) {
        toggleManagedSecret(inputId)
        return
      }
      setSecretVisibilityById(inputId, input?.type === 'password')
    })
  })
  document.querySelectorAll('[data-secret-reveal]').forEach((input) => {
    input.addEventListener('focus', () => {
      if (input.dataset.secretDirty !== 'true' && input.dataset.secretRevealed !== 'true' && input.value) input.select()
    })
    input.addEventListener('beforeinput', () => {
      if (input.dataset.secretDirty !== 'true' && input.dataset.secretRevealed !== 'true' && input.dataset.secretMasked) {
        input.value = ''
        input.type = 'password'
      }
    })
    input.addEventListener('input', () => {
      input.dataset.secretDirty = 'true'
      input.dataset.secretRevealed = 'false'
      const toggle = document.querySelector(`[data-secret-toggle="${input.id}"]`)
      if (toggle) toggle.disabled = false
    })
  })
  document.querySelectorAll('[data-save-global-feature-rules]').forEach((button) => {
    button.addEventListener('click', saveGlobalFeatureRules)
  })
  nodes.articleDisplaySettingsSave?.addEventListener('click', saveArticleDisplaySettings)
  document.querySelectorAll('[data-save-security]').forEach((button) => {
    button.addEventListener('click', saveSecuritySettings)
  })
}

function initDataInteractions() {
  document.addEventListener('keydown', handleAdminAudioKeydown)
  document.querySelectorAll('[data-save-content]').forEach((button) => {
    button.addEventListener('click', saveContentEditor)
  })
  nodes.adminAudioToggle?.addEventListener('click', () => {
    const item = getAdminAudioItem()
    if (item) void playAdminAudio(item)
  })
  nodes.adminAudioRestart?.addEventListener('click', stopAdminAudio)
  nodes.adminAudioProgress?.addEventListener('input', () => {
    if (!adminAudio || !activeAdminAudioId) return
    const nextTime = Number(nodes.adminAudioProgress.value)
    if (Number.isFinite(nextTime)) {
      adminAudio.currentTime = nextTime
      syncAdminAudioPlayer()
    }
  })
  nodes.saveShareSettings?.addEventListener('click', saveShareSettings)
  nodes.resetShareCoverStyle?.addEventListener('click', resetShareCoverStyle)
  nodes.refreshShareCardPreview?.addEventListener('click', refreshSharePreviewBackgrounds)
  nodes.shareCoverUploadBtn?.addEventListener('click', () => nodes.shareCoverUploadFile?.click())
  nodes.shareCoverUploadFile?.addEventListener('change', () => uploadShareCovers(nodes.shareCoverUploadFile?.files))
  nodes.shareContentTypeTabs?.addEventListener('click', (event) => {
    const nextType = event.target.closest('[data-share-content-type]')?.dataset.shareContentType
    if (!shareContentTypes.includes(nextType) || nextType === activeShareContentType) return
    commitActiveSharePoolEditors()
    activeShareContentType = nextType
    sharePreviewTypeOffset = shareContentTypes.indexOf(nextType)
    sharePreviewSamples = []
    renderShareCardCatalog(shareSettingsState)
  })
  nodes.shareTitlePoolInput?.addEventListener('input', updateSharePoolCounts)
  nodes.shareCoverCopyPoolInput?.addEventListener('input', updateSharePoolCounts)
  nodes.shareCoverCopyEnabled?.addEventListener('change', () => {
    commitActiveSharePoolEditors()
    shareSettingsState.private.coverCopyEnabled = nodes.shareCoverCopyEnabled.checked
    renderShareCardCatalog(shareSettingsState)
  })
  ;[
    nodes.shareGlobalWashOpacity,
    nodes.shareReadingZoneOpacity,
    nodes.shareCopyFontSize,
    nodes.shareDateFontSize,
    nodes.shareDividerGap,
    nodes.shareDividerLength,
    nodes.shareCenteredLayoutOffsetY,
    nodes.shareLeftLayoutOffsetY,
  ].forEach((input) => input?.addEventListener('input', updateShareCoverStylePreview))
  const updateShareColorPreview = (event) => {
    if (/^#[0-9a-fA-F]{6}$/.test(event.currentTarget.value.trim())) updateShareCoverStylePreview()
  }
  ;[
    nodes.shareCopyColor,
    nodes.shareDateColor,
    nodes.shareDividerColor,
    nodes.shareReadingZoneColor,
  ].forEach((input) => input?.addEventListener('input', updateShareColorPreview))
  ;[nodes.shareCenteredLayoutEnabled, nodes.shareLeftLayoutEnabled].forEach((input) => input?.addEventListener('change', () => {
    if (!nodes.shareCenteredLayoutEnabled?.checked && !nodes.shareLeftLayoutEnabled?.checked) {
      input.checked = true
      showToast('至少启用一种样式模板')
      return
    }
    updateShareCoverStylePreview()
  }))
  document.querySelector('[data-filter-album-errors]')?.addEventListener('click', (event) => {
    toggleAlbumErrorFilter(event.currentTarget)
  })
  document.querySelector('#saveImages')?.addEventListener('click', saveImageEditor)
  document.querySelector('#refreshAccounts')?.addEventListener('click', loadAccounts)
  document.querySelector('#refreshMessages')?.addEventListener('click', loadMessages)
  document.querySelectorAll('[data-content-refresh]').forEach((button) => {
    button.addEventListener('click', () => refreshContentEditor(button))
  })
  nodes.messageMiniProgramFilter?.addEventListener('change', applyMessageFilters)
  nodes.messageSourceFilter?.addEventListener('change', applyMessageFilters)
  nodes.messageStatusFilter?.addEventListener('change', applyMessageFilters)
  nodes.messageSearchInput?.addEventListener('input', applyMessageFilters)
  nodes.messageList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-message-status]')
    if (button) {
      updateMessageStatus(button.dataset.messageId, button.dataset.messageStatus)
      return
    }
    const deleteButton = event.target.closest('[data-message-delete]')
    if (deleteButton) deleteMessage(deleteButton.dataset.messageDelete)
  })
  nodes.accountList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-account-delete]')
    if (button) deleteAccount(button.dataset.accountDelete)
  })
  document.addEventListener('click', async (event) => {
    if (event.target.closest('[data-group-remove]')) {
      if (groupManagerSaving) return
      const removeButton = event.target.closest('[data-group-remove]')
      removeButton.closest('.group-manager-row')?.remove()
      return
    }
    const pageButton = event.target.closest('[data-page-scope]')
    if (pageButton && !pageButton.disabled) {
      const scope = pageButton.dataset.pageScope || ''
      const page = Math.max(1, Number(pageButton.dataset.page) || 1)
      if (adminPaginationHandlers.has(scope)) {
        await adminPaginationHandlers.get(scope)({ page })
      } else if (scope.startsWith('content:')) {
        const type = scope.slice('content:'.length)
        contentPagination[type] = { ...(contentPagination[type] || {}), page }
        await loadContentEditor()
      } else if (scope === 'images') await loadImages(page)
      else if (scope === 'messages') await loadMessages(page)
      else if (scope === 'accounts') await loadAccounts(page)
      return
    }
    const shareColorOption = event.target.closest('[data-share-color-value]')
    if (shareColorOption) {
      const palette = shareColorOption.closest('[data-share-color-palette]')
      const input = palette?.closest('.share-hex-control')?.querySelector('.share-hex-color')
      if (!input) return
      input.value = shareColorOption.dataset.shareColorValue
      palette.removeAttribute('open')
      updateShareCoverStylePreview()
      return
    }

    const removeShareBackgroundButton = event.target.closest('[data-remove-share-background]')
    if (removeShareBackgroundButton) {
      const id = removeShareBackgroundButton.dataset.removeShareBackground
      commitActiveSharePoolEditors()
      shareSettingsState.private.backgrounds = (shareSettingsState.private?.backgrounds || []).filter((item) => item.id !== id)
      renderShareCardCatalog(shareSettingsState)
      void saveShareSettings()
      return
    }

    const addButton = event.target.closest('[data-add-content]')
    if (addButton) {
      openSingleContentModal(addButton.dataset.addContent)
      return
    }

    const audioPlayButton = event.target.closest('[data-audio-play]')
    if (audioPlayButton) {
      const item = (contentState.contentAudios || []).find((entry) => String(entry.id) === String(audioPlayButton.dataset.audioPlay))
      if (item) void playAdminAudio(item)
      return
    }

    const removeButton = event.target.closest('[data-remove-content]')
    if (removeButton) {
      removeContentItem(removeButton.dataset.removeContent, Number(removeButton.dataset.index))
      return
    }

    const batchDeleteButton = event.target.closest('[data-content-batch-delete]')
    if (batchDeleteButton) {
      removeSelectedContent(batchDeleteButton.dataset.contentBatchDelete, batchDeleteButton)
      return
    }

    const saveContentItemButton = event.target.closest('[data-save-content-item]')
    if (saveContentItemButton) {
      saveContentItem(
        saveContentItemButton.dataset.saveContentItem,
        Number(saveContentItemButton.dataset.index),
        saveContentItemButton,
      )
      return
    }

    const saveAdConfigPageButton = event.target.closest('[data-save-ad-page]')
    if (saveAdConfigPageButton) {
      void saveAdConfigPage(saveAdConfigPageButton)
      return
    }

    const removeImageButton = event.target.closest('[data-remove-image]')
    if (removeImageButton) {
      removeImageItem(Number(removeImageButton.dataset.index))
      return
    }

    const addKeywordButton = event.target.closest('[data-add-keyword]')
    if (addKeywordButton) {
      addKeyword(addKeywordButton.dataset.addKeyword)
      return
    }

    const removeKeywordButton = event.target.closest('[data-remove-keyword]')
    if (removeKeywordButton) {
      removeKeyword(removeKeywordButton)
      return
    }

    const poolDeleteButton = event.target.closest('[data-pool-delete]')
    if (poolDeleteButton) {
      deleteContentPool(poolDeleteButton.dataset.poolDelete)
      return
    }

    const poolEditButton = event.target.closest('[data-pool-edit]')
    if (poolEditButton) {
      openEditContentPool(poolEditButton.dataset.poolEdit)
      return
    }

    const poolRow = event.target.closest('.pool-row[data-pool-id]')
    if (poolRow && !event.target.closest('button')) {
      setActivePool(poolRow.dataset.poolId)
      return
    }

    const editMpButton = event.target.closest('[data-mp-edit]')
    if (editMpButton) {
      if (await setActiveMiniProgram(editMpButton.dataset.mpEdit)) showSection('system')
      return
    }

    const groupMpButton = event.target.closest('[data-mp-group]')
    if (groupMpButton) {
      await editMiniProgramGroup(groupMpButton.dataset.mpGroup)
      return
    }

    const reorderMpButton = event.target.closest('[data-mp-reorder]')
    if (reorderMpButton && !reorderMpButton.disabled) {
      reorderMiniProgram(reorderMpButton.dataset.mpReorder, reorderMpButton.dataset.mpDirection)
      return
    }

    const uploadMpButton = event.target.closest('[data-mp-upload]')
    if (uploadMpButton) {
      openMiniProgramUpload(uploadMpButton.dataset.mpUpload)
      return
    }

    const deleteMpButton = event.target.closest('[data-mp-delete]')
    if (deleteMpButton) {
      deleteMiniProgram(deleteMpButton.dataset.mpDelete)
      return
    }
  })

  document.addEventListener('change', async (event) => {
    const contentSelect = event.target.closest('[data-content-select]')
    if (contentSelect) {
      const type = contentSelect.dataset.contentSelect
      const itemId = contentSelect.dataset.contentId
      const selected = contentSelection[type] || new Set()
      if (contentSelect.checked) selected.add(itemId)
      else selected.delete(itemId)
      contentSelection[type] = selected
      syncContentSelection(type)
      return
    }
    const contentSelectAll = event.target.closest('[data-content-select-all]')
    if (contentSelectAll) {
      const type = contentSelectAll.dataset.contentSelectAll
      contentSelection[type] = new Set(contentSelectAll.checked ? (contentState[type] || []).map((item) => item.id) : [])
      document.querySelectorAll(`[data-content-select="${type}"]`).forEach((input) => { input.checked = contentSelectAll.checked })
      syncContentSelection(type)
      return
    }
    const pageSizeSelect = event.target.closest('[data-page-size-scope]')
    if (!pageSizeSelect) return
    const scope = pageSizeSelect.dataset.pageSizeScope || ''
    const pageSize = Number(pageSizeSelect.value)
    if (!PAGE_SIZES.includes(pageSize)) return
    if (adminPaginationHandlers.has(scope)) {
      await adminPaginationHandlers.get(scope)({ page: 1, pageSize })
    } else if (scope.startsWith('content:')) {
      const type = scope.slice('content:'.length)
      contentPagination[type] = { ...(contentPagination[type] || createPaginationState()), page: 1, pageSize }
      await loadContentEditor()
    } else if (scope === 'images') {
      imagePagination = { ...imagePagination, page: 1, pageSize }
      await loadImages(1)
    } else if (scope === 'messages') {
      messagePagination = { ...messagePagination, page: 1, pageSize }
      await loadMessages(1)
    } else if (scope === 'accounts') {
      accountPagination = { ...accountPagination, page: 1, pageSize }
      await loadAccounts(1)
    }
  })
}

function textareaHeightBounds(textarea) {
  const styles = getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight) || Number.parseFloat(styles.fontSize) * 1.5
  const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
  const border = Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth)
  const heightForRows = (rows) => Math.ceil(lineHeight * rows + padding + border)
  const maximumRows = textarea.classList.contains('copy-library-textarea') || textarea.classList.contains('share-title-pool') ? 10 : 2
  const maximum = Math.max(heightForRows(maximumRows), Number.parseFloat(styles.minHeight) || 0)
  const rows = Math.min(maximumRows, Math.max(1, Number(textarea.rows) || 1))
  const minimum = Math.min(maximum, Math.max(Number.parseFloat(styles.minHeight) || 0, heightForRows(rows)))
  return { maximum, minimum }
}

function resizeTextarea(textarea) {
  if (textarea.classList.contains('article-import-markdown-editor')) {
    textarea.style.removeProperty('height')
    return
  }
  const { maximum, minimum } = textareaHeightBounds(textarea)
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(maximum, Math.max(minimum, textarea.scrollHeight))}px`
}

function resizeAllTextareas(root = document) {
  root.querySelectorAll('textarea').forEach(resizeTextarea)
}

function initTextareaAutoResize() {
  let resizeScheduled = false
  const textareaWidths = new WeakMap()
  const textareaResizeObserver = new ResizeObserver((entries) => {
    entries.forEach(({ target, contentRect }) => {
      if (textareaWidths.get(target) === contentRect.width) return
      textareaWidths.set(target, contentRect.width)
      resizeTextarea(target)
    })
  })
  const scheduleTextareaResize = () => {
    if (resizeScheduled) return
    resizeScheduled = true
    requestAnimationFrame(() => {
      resizeScheduled = false
      resizeAllTextareas()
      requestAnimationFrame(() => resizeAllTextareas())
    })
  }
  const observeTextareas = (root) => {
    const observeTextarea = (textarea) => {
      textareaWidths.set(textarea, textarea.getBoundingClientRect().width)
      textareaResizeObserver.observe(textarea)
    }
    if (root instanceof HTMLTextAreaElement) observeTextarea(root)
    root.querySelectorAll?.('textarea').forEach(observeTextarea)
  }
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLTextAreaElement) resizeTextarea(event.target)
  })
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return
      observeTextareas(node)
    }))
    scheduleTextareaResize()
  }).observe(document.body, { childList: true, subtree: true })
  observeTextareas(document)
  window.addEventListener('resize', scheduleTextareaResize)
  scheduleTextareaResize()
}

async function bootstrap() {
  try {
    const health = await apiRequest('/api/health')
    setStatus(nodes.serverStatus, '服务已连接', 'ok')
    const session = await apiRequest('/api/admin/session')
    adminAuthState = {
      account: session.account || 'admin',
      passwordConfigured: Boolean(session.passwordConfigured),
      passwordResetHint: session.passwordResetHint || '',
      session: session.session || { createdAt: '', expiresAt: '' },
    }
    renderAdminAuth()
    showAdmin()
    const admin = await loadAdminOverview()
    if (admin) renderTags(admin.modules || [])
    await loadAdminSettings()
    await Promise.all([
      loadPreflight(),
      loadContentEditor(),
      loadImages(),
      loadMessages(),
      loadAccounts(),
    ])
  } catch (error) {
    if (String(error.message || '').includes('未登录') || String(error.message || '').includes('请先登录')) {
      showLogin('请先登录后台')
      setStatus(nodes.serverStatus, '当前未登录，请先完成管理员登录', 'error')
      try {
        const session = await apiRequest('/api/admin/session')
        adminAuthState = {
          account: session.account || 'admin',
          passwordConfigured: Boolean(session.passwordConfigured),
          passwordResetHint: session.passwordResetHint || '',
          session: session.session || { createdAt: '', expiresAt: '' },
        }
        renderAdminAuth()
      } catch (authError) {
        renderAdminAuth()
      }
      return
    }
    setStatus(nodes.serverStatus, '服务暂不可用，请稍后重试。', 'error')
    renderTags(['小程序管理', '内容池', '广告设置', '留言管理'])
    renderDashboardCards(unavailableActivityMetrics())
    renderEditableSections(unavailableActivityMetrics())
  }
}

initShellInteractions()
initDataInteractions()
initTextareaAutoResize()
bootstrap()

function getMimeTypeByName(name) {
  switch (fileExt(name)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

nodes.visitTrendCanvas?.addEventListener('mousemove', renderVisitTrendTooltip)
nodes.visitTrendCanvas?.addEventListener('mouseleave', hideVisitTrendTooltip)
window.addEventListener('resize', () => {
  if (!visitTrendState.items.length) return
  renderVisitTrend(visitTrendState.items)
})
