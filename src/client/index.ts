/**
 * @zjjlivingfree/dsh-model-picker — 客户端半边
 *
 * 职责：
 *   1. 从本插件的 node 接口拉「模型目录 + 分类 + 来源 + 限免 + 会话占用 + 冷却 + 配置」
 *   2. 在模型选择按钮右侧加一个设置图标按钮，点击进入 dsh 设置页面的「模型自动选择」
 *   3. 在 dsh 设置页面里渲染唯一的完整视图：**所有来源的多模态一组、纯文本一组**（跨 provider）、
 *      每个模型的启用开关、以及 17 项插件配置项
 *   4. 宿主自己的模型菜单只补**宿主没显示的信息**：宿主没标免费时的 `免`，
 *      以及已保存的分组名；不插分类标题、不重排
 *   5. 模型选择按钮旁只在冷却时显示「冷 mm:ss」
 *
 * 标识一律单字缩写：`图` / `文` / `免` / `冷 mm:ss`；长文案只放 `title`。
 * 精简原则：宿主或同级插件已经表达过的信息一律不重复画，默认态一律不画。
 * 占用（`用` / `占`）徽标已撤 —— 口径是「某会话把选择器停在该模型」，被用户判定为不准，
 * 详见文件内 `occupancyLabel` 原位置附近的说明注释。
 *
 * 为什么分组视图放在设置页而不是输入框浮层：
 *   输入框旁浮层要自己抢位置、遮输入框、与宿主菜单打架，且用户要求去掉「模型面板」按钮。
 *   分组视图与 17 项配置项本来就属于「设置」，搬进 dsh 设置页面后入口只有一个，
 *   视觉与交互跟随宿主设置页，不再需要自建浮层的样式与层级。
 *
 * 为什么仍用 DOM 追加而不是抢槽位：
 *   宿主把 conversation.input.model.label 这类 single 槽对动态包强制 priority=-1，
 *   重复注册会抛 `single slot "..." already has a registration at priority -1`。
 *   所以只在按钮**兄弟位置**追加一个自有节点，不改宿主节点、不重排宿主菜单
 *   （宿主键盘导航按渲染索引定位：model-selection/lib/client.js:1252/1407/1700）。
 */
// `modelDirectories.directoryFor()` 内部要读 `remote.session`，动态门面按 inject 声明做服务门禁，
// 不声明就会抛 `cannot get property "remote.session" without inject`（真机实测）。
export const inject: string[] = ['slots', 'modelDirectories', 'sessions', 'remote']

const BUILD = 'mas-v11'
const ROUTE = 'dsh-model-auto-select'
const BADGE_ATTR = 'data-mas-badge'
const OWN_ATTR = 'data-mas-own'
const SETTINGS_BTN_ATTR = 'data-mas-settings-toggle'
/** 被补成 flex 行的宿主模型选择器根节点（标记只为测试与排障可锚） */
const SETTINGS_ROW_ATTR = 'data-mas-settings-row'
/**
 * 宿主设置面板的两跳锚点（宿主没有给第三方「打开某个 section」的公开 API，只能走 DOM）。
 * 第一跳：侧栏设置入口 `button[aria-haspopup="dialog"]`；
 * 第二跳：面板里 `div[data-shortcut-modal="settings"]` 内、`span` 文本等于本插件 label 的导航按钮。
 */
/**
 * 第一跳的锚点。**不能**用 `button[aria-haspopup="dialog"]` 泛匹配：全 checkout 里带这个属性的
 * 按钮有 11 个（chat / conversation / schedule / session-inspector / agent-team / 文档预览 /
 * 插件管理器 / 设置页自己），`querySelector` 只取文档顺序第一个，很可能点到别的对话框，
 * 于是面板根本没打开、第二跳必然 `nav-item-missing`（真机 beacon 里 31 次失败就是这么来的）。
 * 稳定判据是宿主设置入口的 `aria-label`：中文 `设置`、英文 `Settings`（`t('trigger')`）。
 */
const SETTINGS_LAUNCHER_LABELS = ['设置', 'Settings']
/** 账号菜单的 aria-label（`AccountMenu` 的 `t('menu')`）——真机上 launcher 槽被它占走，
 * 只能先点它、再点菜单项里的「设置」（宿主该菜单项回调里就是 `openSettings()`）。 */
const ACCOUNT_MENU_LABELS = ['账号菜单', 'Account menu']
const SETTINGS_MENU_LABELS = ['设置', 'Settings']
const SETTINGS_PANEL_SEL = 'div[data-shortcut-modal="settings"]'
const SETTINGS_BTN_LABEL = '打开设置页面（模型自动选择）'
const COOLDOWN_ATTR = 'data-mas-cooldown'
/** 未入组模型行的标记（宿主下拉里整行降透明度，便于一眼区分）。 */
const UNASSIGNED_ROW_ATTR = 'data-mas-unassigned-row'
/** 已隐藏/未入组模型行的标记：宿主下拉里整行 display:none，真正不出现。 */
const HIDDEN_ROW_ATTR = 'data-mas-hidden-row'
const POLL_MS = 15_000
/** 宿主菜单里出现这些词就说明「免费」这件事宿主已经标过了，本插件不再补 `免`。 */
const HOST_FREE_HINT = /免费|限免|免单|夜间折|折扣|订阅优先/

interface CatalogEntry {
  key: string
  provider: string
  providerName: string
  providerSettingsNs: string
  model: string
  name: string
  kind: 'text' | 'multimodal'
  modalities: string[]
  modalitySource: string
  sortKey: number[]
  priceFactor?: number
  priceClass?: string
  free: boolean
  disabled: boolean
  /** 用户把它从模型下拉里隐藏了（只影响展示，不影响自动选择） */
  hidden: boolean
  /** 上下文窗口：宿主披露的 combined request+response 上限（tokens），未披露则缺省 */
  contextWindow?: number
}

interface CatalogGroup {
  id: string
  label: string
  kind: 'text' | 'multimodal' | null
  /** 由用户自定义规则产生（界面显示「自定义」并可删除该规则） */
  custom: boolean
  keys: string[]
}

interface OccupancyEntry {
  key: string
  owners: string[]
  inUse: boolean
  running: boolean
}

interface SessionRow {
  sessionId: string
  kind: string
  current: string | null
  reasonCode: string | null
  attempts: number
  retriesUsed: number
  switches: number
  excluded: string[]
}

interface CatalogView {
  version: string
  generatedAt: number
  providerCount: number
  entries: CatalogEntry[]
  groups: CatalogGroup[]
  unavailableModels?: string[]
  failures: Array<{ provider: string; name: string; message: string }>
  occupancy: Record<string, OccupancyEntry>
  cooldown: { active: boolean; until: number; remainingMs: number; reason: string }
  sessions: SessionRow[]
  config: {
    enabled: boolean
    maxRetries: number
    retryDelayMs: number
    cooldownMs: number
    preferIdle: boolean
    groupByKind: boolean
    customGroups: CustomGroup[]
    groupMode?: string
    probeIntervalMin?: number
    crossClassFallback: boolean
    cooldownRefreshBlocked: boolean
    disabledModels: string[]
    freeBadgeLabel: string
    defaultModel: any
    switchScope?: SwitchScope
  }
}

type SwitchScope = 'all' | 'group' | 'group-cross'

interface CustomGroup {
  id: string
  label: string
  kind: 'text' | 'multimodal' | null
  providers: string[]
  models: string[]
  freeOnly: boolean
  /** 显式成员模式：只认 `models` 名单（空名单 = 空分组，不吞模型） */
  explicit: boolean
}

interface ConfigField {
  key: string
  /** list = 逗号分隔的字符串数组；text = 单行文本；models = 只读计数；scope = 三选一枚举 */
  type: 'boolean' | 'number' | 'model' | 'models' | 'groups' | 'groups-list' | 'list' | 'text' | 'scope' | 'groupmode'
  label: string
  hint: string
}

interface ConfigView {
  version: string
  config: Record<string, any>
  defaults: Record<string, any>
  fields: ConfigField[]
  writable: boolean
  documentPath: string | null
}

// ─────────────────────────────── 状态 ───────────────────────────────

let view: CatalogView | null = null
let viewError: string | null = null
let inflight: Promise<void> | null = null
let observer: MutationObserver | null = null
let pollTimer: any = null
let rafPending = false
let started = false

const listeners = new Set<() => void>()
/** 目录快照的订阅者：view 更新后必须一起唤醒，否则槽里的「当前模型」永远停在挂载那一刻。 */
const directoryWatchers = new Set<() => void>()

/** 连通性测试的一次结果。 */
interface ProbeResult {
  ok: boolean
  ms: number
  error?: string
  sample?: string
  /**
   * 失败归因（0.1.2 起服务端回传）：'model' = 真实模型级故障（该模型已从下拉移除，标「不可调」）；
   * 'infra' = 传输/环境故障（fail-open，模型仍留在下拉，标「探测失败」）；缺省视为 infra。
   */
  kind?: 'infra' | 'model'
}

/**
 * 连通性测试结果表：key = `${provider}/${model}`。
 * 结果必须放在模块级表而不是按钮 DOM 上——mountSettingsForm 的 lastSignature 防重绘会挡掉 notify，
 * 折叠/切筛选/重渲染后按钮会被重建，只有从这份表里回填才能让结果留在每一行。
 */
const probeResults = new Map<string, ProbeResult>()

/**
 * 分组一键测试的汇总：key = 分组 id（与按钮 data-mas-group-test 一致）。
 * 汇总同样必须放在模块级表——loadCatalog 强制刷新会重建整目录（含组测试按钮回默认文案），
 * 只有从这份表回填，组汇总「✓2 ✗1」才不会在重渲染后被冲掉。
 */
const groupProbeSummaries = new Map<string, { ok: number; fail: number; total: number }>()

function probeKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** 把一份测试结果渲染到「测试」按钮上（单点与分组批量共用）。 */
function applyProbeResult(button: HTMLButtonElement, result: ProbeResult): void {
  if (result.ok) {
    button.textContent = `✓ ${(result.ms / 1000).toFixed(1)}s`
    button.title = `连通性测试通过（${result.ms}ms）${result.sample ? `\n响应片段：${result.sample}` : ''}`
    button.style.color = '#4a9d5b'
  } else {
    const isModelLevel = result.kind === 'model'
    if (isModelLevel) {
      button.textContent = '✗ 不可调'
      button.title = `连通性测试失败：${result.error ?? '未知错误'}（模型级故障，已从下拉移除）`
      button.style.color = '#d9534f'
    } else {
      button.textContent = '✗ 探测失败'
      button.title = `探测失败（传输/环境故障，模型仍留在下拉可正常选择）：${result.error ?? '未知错误'}`
      button.style.color = '#c9a227'
    }
  }
}

/** 把所有匹配当前结果表的「测试」按钮一起回填（含折叠未展开 / 被筛选隐藏的行）。 */
function repaintProbeButtons(): void {
  for (const node of Array.from(document.querySelectorAll('[data-mas-probe]')) as HTMLButtonElement[]) {
    const result = probeResults.get(node.getAttribute('data-mas-probe') ?? '')
    if (result !== undefined) applyProbeResult(node, result)
  }
}

function notify() {
  for (const fn of directoryWatchers) {
    try {
      fn()
    } catch {
      /* 订阅者异常不影响其他通知 */
    }
  }
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* 单个订阅者异常不影响其它 */
    }
  }
}

// ─────────────────────────────── 接口 ───────────────────────────────

/** document.baseURI 的目录化 base —— 宿主可能挂在任意前缀下，禁止硬编码 host:port。 */
function directoryBase(value: string): string {
  const url = new URL(value, window.location.href)
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname.replace(/[^/]*$/, '')}`
  return url.href
}

function routeUrl(path: string): string {
  const base = directoryBase(document.baseURI || window.location.href)
  return new URL(path.replace(/^\/+/, ''), base).href
}

function apiUrl(suffix: string): string {
  return routeUrl(`${ROUTE}/${suffix.replace(/^\/+/, '')}`)
}

/**
 * 拉取模型目录。
 *
 * - 默认（非 force）：复用在途请求，不写状态行 —— 首次加载 / 保存后的自动刷新都不该动用户正在看的提示。
 * - `force: true`（点「重新获取」）：不复用旧请求、带 `refresh=1` 让服务端跳过 TTL 缓存，
 *   并在收尾时把状态行落定成成功/失败，否则按钮点了只会永久停在「正在重新获取…」。
 *
 * 用自增序号挡「旧响应覆盖新响应」：force 与普通请求可能同时在途。
 */
let catalogSeq = 0

async function loadCatalog(options: { force?: boolean } = {}): Promise<void> {
  const force = options.force === true
  if (!force && inflight !== null) return inflight
  const seq = (catalogSeq += 1)
  const task = (async () => {
    try {
      const url = apiUrl(force ? 'catalog?refresh=1' : 'catalog')
      const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const next = (await res.json()) as CatalogView
      if (seq !== catalogSeq) return
      view = next
      viewError = null
      // 整目录刷新（含 15s 轮询）也会换掉 view 触发重渲染，下拉开着时要把高亮/焦点补回来。
      if (slotOpen) reapplySlotPanel()
      if (force) {
        const entryCount = next.entries?.length ?? 0
        const groupCount = next.groups?.length ?? 0
        statusKind = 'ok'
        statusText =
          entryCount === 0
            ? '已刷新模型列表：没取到任何模型，请先在 dsh 设置页配置 provider 与 API Key'
            : `已刷新模型列表：${entryCount} 个模型 · ${groupCount} 个分组`
      }
    } catch (err) {
      if (seq !== catalogSeq) return
      const message = String((err as Error)?.message ?? err)
      viewError = message
      if (force) {
        statusKind = 'error'
        statusText = `模型列表刷新失败：${explainSaveError(message)}`
      }
    } finally {
      if (seq === catalogSeq) {
        inflight = null
        scheduleDecorate()
        notify()
      }
    }
  })()
  if (!force) inflight = task
  return task
}

/*
 * 占用（`用` / `占`）徽标已整条撤掉（用户 2026-11-01：「我看着计算的不准」）。
 *
 * 口径本身站不住：`inUse` 只表示「某会话当前把选择器停在这个模型上」，不表示它真的在
 * 消耗配额；会话停止≠关闭，停着的会话会一直挂着「占」。曾经加的点开下拉即时拉
 * `/occupancy` 只是让一个不准的口径变得更实时，没有意义，连带删掉。
 *
 * 数据链路保留：`view.occupancy` 仍在 `/catalog` 响应里，服务端自动选择照旧用它做
 * `preferIdle`（那是同一次 `refreshOccupancy` 现算的，不需要客户端再拉一次）。
 */

function beacon(payload: Record<string, unknown>) {
  try {
    void fetch(apiUrl('beacon'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ build: BUILD, ...payload }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 排障通道失败不影响主流程 */
  }
}

// ─────────────────────────────── 徽标 ───────────────────────────────

const KIND_TEXT: Record<string, string> = { text: '文本', multimodal: '多模态' }
/** 面板行内的类型标记：只用一个字（多模态=图，纯文本=文）。 */
const KIND_GLYPH: Record<string, string> = { text: '文', multimodal: '图' }

function entryOf(provider: string, model: string): CatalogEntry | undefined {
  if (view === null) return undefined
  const key = `${provider}\u0000${model}`
  return view.entries.find((entry) => entry.key === key)
}

/*
 * `occupancyLabel` / `occupancyDetail` / `busyText` 随占用徽标一起删除，
 * 理由见文件上方「占用徽标已撤掉」的注释块。
 */

function stylePill(el: HTMLElement, tone: 'idle' | 'busy' | 'running' | 'meta') {
  el.style.display = 'inline-flex'
  el.style.alignItems = 'center'
  el.style.gap = '2px'
  el.style.marginLeft = '6px'
  el.style.padding = '0 6px'
  el.style.height = '18px'
  el.style.borderRadius = '9px'
  el.style.fontSize = '11px'
  el.style.lineHeight = '18px'
  el.style.fontWeight = '500'
  el.style.whiteSpace = 'nowrap'
  el.style.border = '1px solid transparent'
  if (tone === 'idle') {
    el.style.color = 'var(--dsh-color-text-secondary, #8a8f98)'
    el.style.background = 'var(--dsh-color-fill-quaternary, rgba(127,127,127,0.10))'
    el.style.borderColor = 'var(--dsh-color-border-secondary, rgba(127,127,127,0.22))'
  } else if (tone === 'busy') {
    el.style.color = 'var(--dsh-color-warning-text, #a86800)'
    el.style.background = 'var(--dsh-color-warning-bg, rgba(255,184,0,0.14))'
    el.style.borderColor = 'var(--dsh-color-warning-border, rgba(255,184,0,0.36))'
  } else if (tone === 'running') {
    el.style.color = 'var(--dsh-color-success-text, #16794c)'
    el.style.background = 'var(--dsh-color-success-bg, rgba(0,180,120,0.14))'
    el.style.borderColor = 'var(--dsh-color-success-border, rgba(0,180,120,0.36))'
  } else {
    el.style.color = 'var(--dsh-color-text-tertiary, #9aa0a6)'
    el.style.background = 'transparent'
    el.style.borderColor = 'var(--dsh-color-border-secondary, rgba(127,127,127,0.22))'
  }
}

function makePill(text: string, title: string, tone: 'idle' | 'busy' | 'running' | 'meta'): HTMLElement {
  const el = document.createElement('span')
  el.setAttribute(OWN_ATTR, '1')
  el.setAttribute(BADGE_ATTR, text)
  el.textContent = text
  el.title = title
  stylePill(el, tone)
  return el
}

/**
 * 宿主这一行是否已经自己标过「免费」类信息。
 * 宿主会画「免费 / 夜间免费 / 限时免费 / 夜间折 / 订阅优先」等标签，此时再补一枚 `免`
 * 就是同一件事标两遍（截图里一行挤三个徽标）。所以只在宿主完全没提时本插件才补。
 */
function hostSaysFree(span: HTMLElement): boolean {
  const row = span.closest('button, li, [role="menuitemradio"]') ?? span.parentElement
  if (row === null) return false
  for (const node of Array.from(row.querySelectorAll('*'))) {
    const el = node as HTMLElement
    if (el.hasAttribute(OWN_ATTR)) continue
    const text = (el.textContent ?? '').trim()
    if (text.length > 0 && text.length <= 12 && HOST_FREE_HINT.test(text)) return true
  }
  return false
}

/**
 * 宿主下拉标注用的分组 —— **只读已保存配置**。
 *
 * 设置页里的改动先进草稿、点保存才写回；如果下拉标注读草稿，用户会看到「没保存也生效」，
 * 与「手动保存才生效」的语义自相矛盾。所以这里刻意不用 draftOf()。
 */
function savedRules(): CustomGroup[] {
  const raw = config?.config?.['customGroups']
  return Array.isArray(raw) ? (raw as CustomGroup[]) : []
}

/** 该模型在**已保存**配置里属于哪个分组；'' = 没建过组，'未入组' = 建了组但没收它。 */
function savedGroupLabel(entry: CatalogEntry): string {
  const rules = savedRules()
  if (rules.length === 0) return ''
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) {
        return rule.label || rule.id
      }
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.label || rule.id
    }
  }
  return '未入组'
}

/**
 * 单行装饰（宿主菜单）：只补宿主**表达不了**的两件事。
 *   - 限免：宿主拿不到价格字段（llm 服务不暴露），且宿主自己没标过免费时才补 `免`
 *   - 分组名：宿主按 provider 分组，看不见用户的自定义分组
 * 占用不再标：口径不准（见 `occupancyLabel` 原位置附近的说明注释）。
 * 类型不在这里标：宿主自己有多模态徽标，完整的分组视图在 dsh 设置页面里。
 */
function decorateRow(span: HTMLElement): boolean {
  const provider = span.getAttribute('data-provider-id') ?? ''
  const model = span.getAttribute('data-model-id') ?? ''
  if (provider === '' || model === '') return false
  const entry = entryOf(provider, model)
  if (entry === undefined) return false

  // 分组标注只在真正的下拉行里画。composer 上的模型名按钮也带 data-model-id，
  // 在那里挂「免费模型」会变成输入框旁的多余噪音。
  const row = span.closest('button[role="menuitemradio"]') as HTMLElement | null
  const groupLabel = row === null ? '' : savedGroupLabel(entry)
  const unassigned = groupLabel === '未入组'

  // 真正把「未入组 / 已隐藏」的模型从宿主原生下拉里摘掉，而不是只降透明度。
  // 宿主候选集由 llm.listModels 直出、插件改不了（见 README 2.8.1），但可以在 DOM 层
  // 用 display:none 让整行不出现；display 不重排 DOM，54 模型时方向键走 React 搜索路径，
  // 不破坏宿主键盘导航（README 420 的警告只针对重排行顺序）。这段必须放在签名去重之前：
  // 目录刷新后 entry.hidden 可能翻转而分组签名不变，放在后面会漏更新。
  // 未建分组时 savedGroupLabel 返回 ''、unassigned 为 false，全量照常展示（向后兼容）。
  if (row !== null) {
    if (entry.hidden === true || unassigned) {
      row.setAttribute(HIDDEN_ROW_ATTR, '1')
      row.style.display = 'none'
    } else if (row.hasAttribute(HIDDEN_ROW_ATTR)) {
      row.removeAttribute(HIDDEN_ROW_ATTR)
      row.style.display = ''
    }
  }

  const free = entry.free && !hostSaysFree(span) ? (view?.config?.freeBadgeLabel ?? '免') : ''
  const signature = [free, groupLabel].join('|')
  const existing = span.querySelector(`:scope > [${OWN_ATTR}]`) as HTMLElement | null
  if (existing !== null && existing.getAttribute(BADGE_ATTR) === signature) return false
  if (existing !== null) existing.remove()
  // 两样都不需要标（不限免、不在下拉里）：不建空 wrap，避免留下空节点。
  if (signature === '|') return existing !== null

  const wrap = document.createElement('span')
  wrap.setAttribute(OWN_ATTR, '1')
  wrap.setAttribute(BADGE_ATTR, signature)
  wrap.style.display = 'inline-flex'
  wrap.style.alignItems = 'center'
  if (free !== '') {
    wrap.appendChild(
      makePill(free, `计价系数 x${(entry.priceFactor ?? 0).toFixed(2)}（0 = 限时免费）；来源：模型名后缀，非 llm 服务字段`, 'running'),
    )
  }
  if (groupLabel !== '') {
    wrap.appendChild(
      makePill(
        groupLabel,
        unassigned
          ? `未加入任何分组：插件不会自动选中它，也不会在自动切换时挑它（分组可在「模型自动选择」设置页里配置）`
          : `已保存的分组：${groupLabel}`,
        unassigned ? 'busy' : 'meta',
      ),
    )
  }
  span.appendChild(wrap)

  // 未入组的行整行降透明度：宿主的下拉条目集合插件改不了（由 llm.listModels 直出），
  // 但可以让用户一眼看出「这些不在我的分组里」。
  if (row !== null) {
    if (unassigned) {
      row.setAttribute(UNASSIGNED_ROW_ATTR, '1')
      row.style.opacity = '0.55'
    } else if (row.hasAttribute(UNASSIGNED_ROW_ATTR)) {
      row.removeAttribute(UNASSIGNED_ROW_ATTR)
      row.style.opacity = ''
    }
  }
  return true
}

// ──────────────────── 完整视图（渲染在 dsh 设置页面里） ────────────────────
//
// 需求要的是「所有来源的多模态一组、纯文本一组」。宿主菜单的分组维度是 provider，
// 且它的键盘导航按渲染索引定位（itemRefs / visibleModels 下标），重排宿主 DOM 会让
// 方向键跳序 —— 所以这份分组视图由本插件自己渲染，但渲染位置在 dsh 设置页面，
// 不再占用输入框旁的位置。

let config: ConfigView | null = null
let configInflight: Promise<void> | null = null
let statusText = ''
/** 状态行语气：pending=进行中、ok=成功、error=失败。用来给反馈上色，避免「点了没反应」。 */
let statusKind: 'idle' | 'pending' | 'ok' | 'error' = 'idle'

function loadConfig(): Promise<void> {
  if (configInflight !== null) return configInflight
  configInflight = (async () => {
    try {
      const res = await fetch(apiUrl('config'), { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      config = (await res.json()) as ConfigView
    } catch (err) {
      statusKind = 'error'
      statusText = `配置读取失败：${explainSaveError(String((err as Error)?.message ?? err))}`
    } finally {
      configInflight = null
      // 分组标注读的是**已保存**配置：配置比首次 decorate 晚到，不重画就会一直缺 pill。
      scheduleDecorate()
      notify()
    }
  })()
  return configInflight
}

/** 把 node 半边 / 宿主抛出来的内部英文错误翻成用户能照着做的提示。 */
function explainSaveError(raw: string): string {
  if (/no longer active/i.test(raw)) return '插件正在重启（配置刚被写入会触发重载），请 2 秒后重试；本次改动未保存'
  if (/no longer available/i.test(raw)) return '配置条目已失效（插件可能被卸载或重载），请刷新页面后重试'
  if (/changed during reload/i.test(raw)) return '配置在重载过程中被改动，请重试'
  if (/no valid field/i.test(raw)) return '没有识别到可保存的字段'
  if (/HTTP 5\d\d/i.test(raw)) return `服务端错误：${raw}`
  return raw
}

async function postConfig(patch: Record<string, unknown>): Promise<void> {
  statusText = '保存中…'
  statusKind = 'pending'
  notify()
  try {
    const res = await fetch(apiUrl('config'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; persisted?: boolean; error?: string } | null
    if (body?.ok === true) {
      statusKind = 'ok'
      statusText = body.persisted === true ? '已保存到插件配置' : `已生效（${body.error ?? '未持久化'}）`
      await loadConfig()
      await loadCatalog()
    } else {
      statusKind = 'error'
      statusText = `保存失败：${explainSaveError(body?.error ?? `HTTP ${res.status}`)}`
    }
  } catch (err) {
    statusKind = 'error'
    statusText = `保存失败：${explainSaveError(String((err as Error)?.message ?? err))}`
  }
  notify()
}

function el(tag: string, style: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag)
  Object.assign(node.style, style)
  if (text !== undefined) node.textContent = text
  node.setAttribute(OWN_ATTR, '1')
  return node
}


// ──────────────────── 设置页 UI：基础件 + 草稿 + 模型行 + 分组编辑 ────────────────────

// ──────────────────── 设置页 UI 基础件（对齐宿主设置行规范） ────────────────────
//
// 宿主设置页的行结构（`dsh-client-ui-conversation` / `dsh-client-ui-theme` 的 css$ 实测）：
//   row  = border-bottom .5px + padding 16px 0 + flex + gap 8px
//   title= 14px/22px label-primary；desc = 12px/18px label-tertiary
//   control = 36px 高、radius-md、bg-module-platform
// 这里全部照抄语义 token（`--dsw-alias-*`），不自造配色，于是亮/暗主题自动跟随。

const TOK = {
  primary: 'var(--dsw-alias-label-primary, var(--dsh-color-text-primary, #1f2329))',
  secondary: 'var(--dsw-alias-label-secondary, var(--dsh-color-text-secondary, #4e5560))',
  tertiary: 'var(--dsw-alias-label-tertiary, var(--dsh-color-text-tertiary, #8a8f98))',
  border: 'var(--dsw-alias-border-l2, rgba(127,127,127,0.18))',
  module: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,0.08))',
  hover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.10))',
  layer: 'var(--dsw-alias-bg-layer-2, var(--dsh-color-bg-layer-2, #ffffff))',
  radius: 'var(--dsw-radius-md, 8px)',
  error: 'var(--dsh-color-state-error-primary, #d64545)',
  ok: 'var(--dsh-color-state-success-primary, #16794c)',
  warn: 'var(--dsh-color-state-warning-primary, #a86800)',
} as const

const BTN_STYLE =
  `height:32px;padding:0 14px;border-radius:${TOK.radius};border:1px solid ${TOK.border};` +
  `background:transparent;color:${TOK.primary};font:inherit;font-size:13px;cursor:pointer;white-space:nowrap`

function titleText(text: string): HTMLElement {
  return el('span', { fontSize: '14px', lineHeight: '22px', fontWeight: '400', color: TOK.primary }, text)
}

function descText(text: string): HTMLElement {
  return el('span', { fontSize: '12px', lineHeight: '18px', color: TOK.tertiary }, text)
}

/** 一行设置：左侧标题 + 说明，右侧控件（宿主 row / rowText 同构）。 */
function settingRow(title: string, desc: string, control: HTMLElement | null, extra: HTMLElement[] = []): HTMLElement {
  const row = el('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 0',
    borderBottom: `0.5px solid ${TOK.border}`,
  })
  row.title = desc
  const text = el('div', { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1', minWidth: '0' })
  text.appendChild(titleText(title))
  if (desc !== '') text.appendChild(descText(desc))
  row.appendChild(text)
  if (control !== null) row.appendChild(control)
  for (const node of extra) row.appendChild(node)
  return row
}

/** 勾选框 + 文字标签（不用单字缩写，用户一眼知道这一栏是什么）。 */
function checkControl(
  label: string,
  checked: boolean,
  attrs: Record<string, string>,
  onChange: (next: boolean) => void,
): HTMLElement {
  const wrap = el('label', {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: TOK.secondary,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.checked = checked
  box.style.cssText = 'margin:0;width:15px;height:15px;cursor:pointer;flex:0 0 auto'
  box.setAttribute(OWN_ATTR, '1')
  for (const [key, value] of Object.entries(attrs)) box.setAttribute(key, value)
  box.addEventListener('change', () => onChange(box.checked === true))
  wrap.appendChild(box)
  wrap.appendChild(document.createTextNode(label))
  return wrap
}

function actionButton(text: string, title: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  button.title = title
  button.style.cssText = BTN_STYLE
  button.setAttribute(OWN_ATTR, '1')
  for (const [key, value] of Object.entries(attrs)) button.setAttribute(key, value)
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return button
}

function textInput(value: string, placeholder: string, width: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value
  input.placeholder = placeholder
  input.style.cssText =
    `width:${width};height:30px;padding:0 8px;box-sizing:border-box;border-radius:${TOK.radius};` +
    `border:1px solid ${TOK.border};background:transparent;color:${TOK.primary};font:inherit;font-size:13px`
  input.setAttribute(OWN_ATTR, '1')
  for (const [key, v] of Object.entries(attrs)) input.setAttribute(key, v)
  return input
}

function blockTitle(text: string, desc: string): HTMLElement {
  const box = el('div', { display: 'flex', flexDirection: 'column', gap: '4px', padding: '20px 0 6px' })
  box.appendChild(el('span', { fontSize: '14px', lineHeight: '22px', fontWeight: '600', color: TOK.primary }, text))
  if (desc !== '') box.appendChild(descText(desc))
  return box
}

function groupCardBox(): HTMLElement {
  return el('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 14px',
    marginBottom: '10px',
    borderRadius: TOK.radius,
    background: TOK.module,
  })
}

// ──────────────────── 草稿：改完点「保存」才生效 ────────────────────
//
// 需求（用户 m04660）：需要手动保存后才生效。所以所有控件只写 draft，不直接 POST；
// 顶部固定一条保存条（未保存改动数 + 放弃 + 保存），保存时把 draft 一次性提交。

let draft: Record<string, unknown> | null = null

function draftKeys(): string[] {
  return draft === null ? [] : Object.keys(draft)
}

function draftOf<T>(key: string, fallback: T): T {
  if (draft !== null && Object.prototype.hasOwnProperty.call(draft, key)) return draft[key] as T
  const value = config?.config?.[key]
  if (value === undefined || value === null) return fallback
  return value as T
}

/** 自动分组模式：按模型是否免费实时分三组；手工模式沿用 customGroups（切回原样恢复）。 */
function groupingAuto(): boolean {
  return draftOf<string>('groupMode', 'manual') === 'auto'
}

/** 深比较用：把值序列化成稳定字符串（数组 / 对象 / 基本类型都能比）。 */
function valueKey(value: unknown): string {
  if (value === undefined) return '\u0000undefined'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * 把一次改动写进草稿（不提交）。`note` 会显示在保存条上，告诉用户刚改了什么。
 *
 * 改回原值时必须把这一项从草稿里摘掉：否则用户把下拉改回原值后，保存条仍挂着
 * 「有 1 项改动未保存」，既误导又白写一次配置（写盘会触发插件重载）。
 * 所以这里跟已保存值做深比较，相等就删键。
 */
function stage(key: string, value: unknown, note: string): void {
  const saved = config?.config?.[key]
  const same = valueKey(value) === valueKey(saved)
  const next = { ...(draft ?? {}) }
  if (same) delete next[key]
  else next[key] = value
  const keys = Object.keys(next)
  draft = keys.length === 0 ? null : next
  if (keys.length === 0) {
    statusKind = 'idle'
    statusText = '没有未保存的改动'
  } else {
    statusKind = 'pending'
    statusText = same ? `已恢复为已保存值（还剩 ${keys.length} 项改动）` : `未保存：${note}`
  }
  notify()
}

function discardDraft(): void {
  draft = null
  statusKind = 'idle'
  statusText = '已放弃未保存的改动'
  notify()
}

async function saveDraft(): Promise<void> {
  if (draft === null) return
  const patch = draft
  draft = null
  await postConfig(patch)
}

// ──────────────────── 模型行（模型清单区） ────────────────────

/**
 * 把某个模型从所有分组里摘掉，再（可选地）挂到目标分组。
 *
 * 用户口径（m04856）：先建组，再到模型列表里把模型选进组。所以入组动作发生在模型行上，
 * 分组卡片不再罗列全部模型。挂入时把该组切成 `explicit`（按名单匹配）——否则条件模式下的
 * 空名单等于「不限」，会把全部模型吞进这一组。
 */
function assignToGroup(entry: CatalogEntry, groupId: string, note: string): void {
  const full = `${entry.provider}/${entry.model}`
  const rules = draftOf<CustomGroup[]>('customGroups', [])
  const next = rules.map((rule) => {
    const models = rule.models.filter((item) => item !== full)
    if (rule.id !== groupId) return { ...rule, models }
    return { ...rule, explicit: true, models: [...models, full] }
  })
  stage('customGroups', next, note)
}

function modelRow(entry: CatalogEntry): HTMLElement {
  const full = `${entry.provider}/${entry.model}`
  const rules = draftOf<CustomGroup[]>('customGroups', [])
  const hiddenList = draftOf<string[]>('hiddenModels', [])
  const showOn = !hiddenList.includes(full)
  const groupName = groupNameOf(entry)
  const groupId = groupIdOf(entry)
  const autoMode = groupingAuto()
  const unassigned = !autoMode && rules.length > 0 && groupId === ''

  const row = el('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 0',
    borderBottom: `0.5px solid ${TOK.border}`,
    opacity: unassigned || !showOn ? '0.5' : '1',
  })
  row.setAttribute('data-mas-model-row', entry.key)
  row.title = `${entry.providerName} / ${entry.model}
模态：${entry.modalities.join(', ') || '无'}（来源 ${entry.modalitySource}）
计价系数：${entry.priceFactor === undefined ? '未知' : `x${entry.priceFactor.toFixed(2)}`}
入组：${unassigned ? '未入组（默认不可用、不进下拉）' : groupName}`

  const text = el('div', { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1', minWidth: '0' })
  const nameLine = el('div', { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0' })
  const glyph = makePill(KIND_GLYPH[entry.kind] ?? '?', KIND_TEXT[entry.kind] ?? entry.kind, 'meta')
  glyph.style.marginLeft = '0'
  nameLine.appendChild(glyph)
  nameLine.appendChild(
    el('span', { fontSize: '13px', lineHeight: '20px', color: TOK.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, entry.name || entry.model),
  )
  if (entry.free) {
    const free = makePill(view?.config?.freeBadgeLabel ?? '免', '计价系数 x0.00（0 = 限时免费）', 'running')
    free.style.marginLeft = '0'
    nameLine.appendChild(free)
  }
  if (unassigned) {
    const tag = makePill('未入组', '没进任何分组的模型默认不可用，也不在模型下拉里展示', 'busy')
    tag.style.marginLeft = '0'
    tag.setAttribute('data-mas-unassigned', '1')
    nameLine.appendChild(tag)
  }
  if (!showOn) {
    const tag = makePill('已隐藏', '用户手动隐藏，不在模型下拉里展示', 'busy')
    tag.style.marginLeft = '0'
    tag.setAttribute('data-mas-hidden', '1')
    nameLine.appendChild(tag)
  }
  // 可用状态标识：显示模型本身是否可用
  if (entry.disabled) {
    const tag = makePill('不可用', '该模型被停用，不参与自动选择', 'busy')
    tag.style.marginLeft = '0'
    nameLine.appendChild(tag)
  } else if (!unassigned && showOn) {
    const tag = makePill('可用', '该模型可用，参与自动选择', 'running')
    tag.style.marginLeft = '0'
    nameLine.appendChild(tag)
  }
  text.appendChild(nameLine)
  text.appendChild(descText(`${entry.providerName} · ${groupName}`))
  row.appendChild(text)

  const controls = el('div', { display: 'flex', alignItems: 'center', gap: '12px', flex: '0 0 auto' })

  // 入组下拉：唯一的分组归属入口。没建组时禁用并提示先建组。
  const select = document.createElement('select')
  select.style.cssText = `height:32px;border-radius:${TOK.radius};border:none;background:${TOK.module};color:${TOK.primary};font:inherit;font-size:13px;padding:0 10px;cursor:pointer;max-width:190px`
  select.setAttribute(OWN_ATTR, '1')
  select.setAttribute('data-mas-assign', full)
  select.disabled = rules.length === 0
  const blank = document.createElement('option')
  blank.value = ''
  blank.textContent = rules.length === 0 ? '先新建分组' : '不入组（不可用）'
  select.appendChild(blank)
  for (const rule of rules) {
    const option = document.createElement('option')
    option.value = rule.id
    option.textContent = rule.label || rule.id
    select.appendChild(option)
  }
  select.value = groupId
  select.addEventListener('change', () => {
    const target = rules.find((rule) => rule.id === select.value)
    assignToGroup(
      entry,
      select.value,
      select.value === ''
        ? `「${entry.name || entry.model}」已移出分组（不再可用、不进下拉）`
        : `「${entry.name || entry.model}」已加入分组「${target?.label || select.value}」`,
    )
  })
  // 自动分组模式下分组由「是否免费」决定，手工入组下拉不再出现。
  if (!autoMode) controls.appendChild(select)

  // 下拉展示：组内仍可单独把某个模型藏起来（自动选择是全局统一的，这里不再给每模型开关）
  controls.appendChild(
    checkControl('展示', showOn, { 'data-mas-flag': 'hidden' }, (next) => {
      const list = draftOf<string[]>('hiddenModels', [])
      stage('hiddenModels', next ? list.filter((item) => item !== full) : [...list.filter((item) => item !== full), full], `${next ? '显示' : '隐藏'}「${entry.name || entry.model}」在模型下拉`)
    }),
  )

  // 连通性测试：真实发一次极小请求，回答「这个模型现在能不能调通」（与入组/展示状态正交）。
  const probe = document.createElement('button')
  probe.type = 'button'
  probe.textContent = '测试'
  probe.title = '真实发一次极小请求，验证该模型当前能否调通'
  probe.style.cssText = `height:28px;padding:0 10px;border-radius:${TOK.radius};border:none;background:${TOK.module};color:${TOK.primary};font:inherit;font-size:12px;cursor:pointer`
  probe.setAttribute(OWN_ATTR, '1')
  probe.setAttribute('data-mas-probe', full)
  probe.addEventListener('click', () => { void testModelViaRoute(entry.provider, entry.model, probe) })
  controls.appendChild(probe)
  // 结果表回填：折叠/切筛选/重渲染后按钮被重建，也能立刻显示上一次测试结论。
  const cached = probeResults.get(full)
  if (cached !== undefined) applyProbeResult(probe, cached)

  row.appendChild(controls)
  return row
}

/** 某个模型当前所属的自定义分组 id；'' = 未入组（或还没建组）。 */
function groupIdOf(entry: CatalogEntry): string {
  const rules = draftOf<CustomGroup[]>('customGroups', [])
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) return rule.id
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.id
    }
  }
  return ''
}

/** 某个模型当前归到哪个分组（自定义分组优先，其次按类型/来源的内置分组）。 */
function groupNameOf(entry: CatalogEntry): string {
  const rules = draftOf<CustomGroup[]>('customGroups', [])
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) return rule.label || rule.id
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.label || rule.id
    }
  }
  if (rules.length > 0) return '未入组'
  const byKind = draftOf<boolean>('groupByKind', true)
  if (!byKind) return entry.providerName
  return KIND_TEXT[entry.kind] ?? entry.kind
}

// ──────────────────── 分组编辑器 ────────────────────

/** 自定义分组的可编辑摘要：条件都写成短词，一眼能看出这条规则收哪些模型。 */
function groupSummary(rule: CustomGroup): string {
  const parts: string[] = []
  parts.push(rule.kind === null ? '不限类型' : rule.kind === 'multimodal' ? '多模态' : '纯文本')
  if (rule.providers.length > 0) parts.push(`来源 ${rule.providers.join('/')}`)
  if (rule.freeOnly) parts.push('仅限免')
  if (rule.explicit) parts.push(`已勾选 ${rule.models.length} 个模型`)
  else if (rule.models.length > 0) parts.push(`指定 ${rule.models.length} 个模型`)
  return parts.join(' · ')
}

function newGroupId(): string {
  return `g${Date.now().toString(36)}`
}

function rewriteGroups(next: CustomGroup[], note: string): void {
  stage('customGroups', next, note)
}

function groupCard(rule: CustomGroup, index: number, rules: CustomGroup[]): HTMLElement {
  const card = groupCardBox()
  card.setAttribute('data-mas-group-card', rule.id)

  // 第一行：名称 + 摘要 + 排序 + 删除
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '8px' })
  const name = textInput(rule.label, '分组名称', '150px', { 'data-mas-group-name': rule.id })
  name.addEventListener('change', () => {
    rewriteGroups(
      rules.map((item) => (item.id === rule.id ? { ...item, label: name.value.trim() } : item)),
      `分组改名为「${name.value.trim() || rule.id}」`,
    )
  })
  head.appendChild(name)
  head.appendChild(descText(`${groupSummary(rule)} · ${rule.models.length} 个模型`))
  head.appendChild(el('div', { flex: '1' }))

  const move = (delta: number) => {
    const at = index + delta
    if (at < 0 || at >= rules.length) return
    const next = [...rules]
    const [item] = next.splice(index, 1)
    next.splice(at, 0, item)
    rewriteGroups(next, '分组顺序已调整')
  }
  head.appendChild(actionButton('↑', '上移（越靠前的分组越先匹配）', () => move(-1)))
  head.appendChild(actionButton('↓', '下移', () => move(1)))
  head.appendChild(
    actionButton('删除', '删除该分组，其成员回到「未入组」', () => {
      rewriteGroups(rules.filter((item) => item.id !== rule.id), `已删除分组「${rule.label || rule.id}」`)
    }),
  )
  card.appendChild(head)

  // 第二行：整组开关（整组停用 / 整组不展示）+ 成员只读清单。
  // 「自动选择」本身是全局统一开关（运行策略里的 enabled），组级这里只管「这一批模型要不要用」。
  const switches = el('div', { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' })
  const hiddenGroups = draftOf<string[]>('hiddenGroups', [])
  switches.appendChild(
    checkControl('下拉展示', !hiddenGroups.includes(rule.id), { 'data-mas-group-flag': 'hidden' }, (next) => {
      const list = draftOf<string[]>('hiddenGroups', [])
      stage('hiddenGroups', next ? list.filter((item) => item !== rule.id) : [...list.filter((item) => item !== rule.id), rule.id], `整组「${rule.label || rule.id}」${next ? '显示' : '隐藏'}在下拉`)
    }),
  )
  card.appendChild(switches)

  // 第三行：成员只读清单（入组在下面的模型列表里改，避免两处勾选互相打架）
  const memberNames = rule.explicit
    ? rule.models
        .map((item) => {
          const entry = view?.entries.find((one) => `${one.provider}/${one.model}` === item || one.model === item)
          return entry?.name || item
        })
        .join('、')
    : ''
  card.appendChild(
    descText(
      memberNames === ''
        ? '还没有成员。到下面的模型列表，用「入组」下拉把模型选进来。'
        : `成员：${memberNames}`,
    ),
  )
  return card
}

function groupsEditor(field: ConfigField): HTMLElement {
  const rules = draftOf<CustomGroup[]>('customGroups', [])
  const box = el('div', { display: 'flex', flexDirection: 'column', gap: '8px' })
  box.title = field.hint
  box.appendChild(
    descText(
      rules.length === 0
        ? '当前按 dsh 内置规则分组（按来源 / 按类型）。新建分组后，模型下拉就按你建的分组显示。'
        : '先在这里建组，再到下面的模型列表用「入组」下拉把模型选进来。没入组的模型默认不可用、也不在模型下拉里出现。',
    ),
  )
  rules.forEach((rule, index) => box.appendChild(groupCard(rule, index, rules)))

  const form = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' })
  const newName = textInput('', '新分组名称（可留空，之后改名）', '220px', { 'data-mas-group-new': '1' })
  form.appendChild(newName)
  form.appendChild(
    actionButton('新建分组', '新建一个空分组，随后到模型列表里把模型选进来', () => {
      const rule: CustomGroup = {
        id: newGroupId(),
        label: newName.value.trim(),
        kind: null,
        providers: [],
        models: [],
        freeOnly: false,
        explicit: true,
      }
      rewriteGroups([...rules, rule], `新建分组「${rule.label || rule.id}」，请到模型列表选入组`)
    }),
  )
  box.appendChild(form)
  return box
}

// ──────────────────── 逐项配置行 ────────────────────

/**
 * 数值项的合法范围与界面单位。判定规则写死在这里，非法值不写进草稿并给出可操作提示
 * （服务端 `coercePatch` 还会再夹一次，双保险）。
 */
const NUMBER_RULES: Record<string, { min: number; max: number; unit: string; step?: number }> = {
  maxRetries: { min: 0, max: 10, unit: '次', step: 1 },
  retryDelayMs: { min: 0, max: 60_000, unit: 'ms', step: 100 },
  cooldownMs: { min: 0, max: 86_400_000, unit: 'ms（1 分钟 = 60000）', step: 60_000 },
  catalogTtlMs: { min: 1_000, max: 3_600_000, unit: 'ms', step: 1_000 },
  occupancyRefreshMs: { min: 1_000, max: 600_000, unit: 'ms', step: 1_000 },
  probeIntervalMin: { min: 0, max: 1440, unit: '分钟（0 = 不自动探测）', step: 1 },
}

function configRow(field: ConfigField): HTMLElement {
  if (field.type === 'groups') return groupsEditor(field)
  if (field.type === 'groups-list') return groupListRow(field)
  const value = draftOf<unknown>(field.key, config?.config?.[field.key])

  if (field.type === 'boolean') {
    const box = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' })
    box.appendChild(
      checkControl('', value === true, { 'data-mas-field': field.key }, (next) =>
        stage(field.key, next, `${field.label} → ${next ? '开' : '关'}`),
      ),
    )
    return settingRow(field.label, field.hint, box)
  }

  if (field.type === 'number') {
    const rule = NUMBER_RULES[field.key]
    const wrap = el('label', { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'text' })
    const input = document.createElement('input')
    input.type = 'number'
    input.min = String(rule?.min ?? 0)
    input.max = String(rule?.max ?? Number.MAX_SAFE_INTEGER)
    if (rule?.step !== undefined) input.step = String(rule.step)
    input.value = value === null || value === undefined ? '' : String(value)
    input.style.cssText =
      `width:120px;height:32px;padding:0 8px;box-sizing:border-box;border-radius:${TOK.radius};` +
      `border:1px solid ${TOK.border};background:transparent;color:${TOK.primary};font:inherit;font-size:13px;font-variant-numeric:tabular-nums`
    input.setAttribute(OWN_ATTR, '1')
    input.setAttribute('data-mas-field', field.key)
    // 非法值：标红、给出范围提示、**不写进草稿**，避免用户以为已经改掉了
    input.addEventListener('change', () => {
      const raw = Number(input.value)
      if (!Number.isFinite(raw) || raw < 0) {
        statusKind = 'error'
        statusText = `${field.label}：请输入大于等于 0 的数字`
        input.style.borderColor = TOK.error
        notify()
        return
      }
      if (rule !== undefined && (raw < rule.min || raw > rule.max)) {
        statusKind = 'error'
        statusText = `${field.label}：取值必须在 ${rule.min} – ${rule.max} ${rule.unit} 之间（本次未保存）`
        input.style.borderColor = TOK.error
        notify()
        return
      }
      input.style.borderColor = ''
      stage(field.key, Math.floor(raw), `${field.label} → ${Math.floor(raw)}`)
    })
    wrap.appendChild(input)
    wrap.appendChild(descText(rule === undefined ? '' : `${rule.min} – ${rule.max} ${rule.unit}`))
    return settingRow(field.label, field.hint, wrap)
  }

  if (field.type === 'model') {
    const select = document.createElement('select')
    select.setAttribute(OWN_ATTR, '1')
    select.setAttribute('data-mas-field', field.key)
    select.style.cssText =
      `height:32px;padding:0 8px;border-radius:${TOK.radius};border:1px solid ${TOK.border};` +
      `background:transparent;color:${TOK.primary};font:inherit;font-size:13px;max-width:260px`
    const none = document.createElement('option')
    none.value = ''
    none.textContent = '（未设置，跟随宿主）'
    select.appendChild(none)
    const current = value as { provider?: string; model?: string } | null
    for (const entry of view?.entries ?? []) {
      const option = document.createElement('option')
      option.value = entry.key
      option.textContent = `${entry.providerName} / ${entry.name || entry.model}`
      if (current !== null && current !== undefined && current.provider === entry.provider && current.model === entry.model) option.selected = true
      select.appendChild(option)
    }
    select.addEventListener('change', () => {
      const entry = (view?.entries ?? []).find((item) => item.key === select.value)
      stage(field.key, entry === undefined ? null : { provider: entry.provider, model: entry.model }, `默认模型 → ${entry?.name ?? '未设置'}`)
    })
    return settingRow(field.label, field.hint, select)
  }

  if (field.type === 'scope') {
    // 三选一：组内 / 组内→跨组 / 全部。用下拉而不是三个开关，避免「同时开两个」的非法状态。
    const choices: Array<{ value: SwitchScope; label: string }> = [
      { value: 'group', label: '组内' },
      { value: 'group-cross', label: '组内 → 跨组' },
      { value: 'all', label: '全部' },
    ]
    const current = typeof value === 'string' && choices.some((item) => item.value === value) ? (value as SwitchScope) : 'group-cross'
    const select = document.createElement('select')
    Object.assign(select.style, {
      height: '30px',
      minWidth: '150px',
      padding: '0 8px',
      fontSize: '13px',
      color: TOK.primary,
      background: TOK.layer,
      border: `0.5px solid ${TOK.border}`,
      borderRadius: '6px',
      cursor: 'pointer',
    })
    select.setAttribute(OWN_ATTR, '1')
    select.setAttribute('data-mas-field', field.key)
    for (const item of choices) {
      const option = document.createElement('option')
      option.value = item.value
      option.textContent = item.label
      option.selected = item.value === current
      select.appendChild(option)
    }
    select.addEventListener('change', () => {
      const next = choices.find((item) => item.value === select.value)
      stage(field.key, select.value, `${field.label} → ${next?.label ?? select.value}`)
    })
    return settingRow(field.label, field.hint, select)
  }

  if (field.type === 'groupmode') {
    // 二选一：手工分组（沿用 customGroups）/ 自动分组（按免费·积分·未知实时分三组）。
    const choices: Array<{ value: string; label: string }> = [
      { value: 'manual', label: '手工分组' },
      { value: 'auto', label: '自动分组（免费 / 积分 / 未知）' },
    ]
    const current = value === 'auto' ? 'auto' : 'manual'
    const select = document.createElement('select')
    Object.assign(select.style, {
      height: '30px',
      minWidth: '210px',
      padding: '0 8px',
      fontSize: '13px',
      color: TOK.primary,
      background: TOK.layer,
      border: `0.5px solid ${TOK.border}`,
      borderRadius: '6px',
      cursor: 'pointer',
    })
    select.setAttribute(OWN_ATTR, '1')
    select.setAttribute('data-mas-field', field.key)
    for (const item of choices) {
      const option = document.createElement('option')
      option.value = item.value
      option.textContent = item.label
      option.selected = item.value === current
      select.appendChild(option)
    }
    select.addEventListener('change', () => {
      const next = choices.find((item) => item.value === select.value)
      stage(field.key, select.value, `${field.label} → ${next?.label ?? select.value}`)
    })
    return settingRow(field.label, field.hint, select)
  }

  if (field.type === 'list') {
    const wrap = el('div', { display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 260px' })
    const input = textInput(Array.isArray(value) ? (value as string[]).join(',') : '', '逗号分隔，留空 = 不限', '100%', {
      'data-mas-field': field.key,
    })
    input.addEventListener('change', () => stage(field.key, input.value, `${field.label} 已修改`))
    wrap.appendChild(input)
    return settingRow(field.label, field.hint, wrap)
  }

  if (field.type === 'text') {
    const input = textInput(typeof value === 'string' ? value : '', '', '110px', { 'data-mas-field': field.key })
    input.addEventListener('change', () => stage(field.key, input.value, `${field.label} 已修改`))
    return settingRow(field.label, field.hint, input)
  }

  // models 型：真正的手都在别处，这里只报汇总，避免同一件事两个入口。
  // - disabledModels：可用性现在由「有没有入组」决定（见 core.ts isUnassigned），逐模型开关已下线
  // - hiddenModels：在「模型」区逐行用「展示」开关
  const count = Array.isArray(value) ? value.length : 0
  if (field.key === 'disabledModels') {
    return settingRow(
      field.label,
      field.hint,
      descText(count === 0 ? '由分组决定：没入组的模型默认不可用' : `另有 ${count} 个模型被单独停用`),
    )
  }
  return settingRow(
    field.label,
    field.hint,
    descText(count === 0 ? '全部展示（在「模型」区逐行用「展示」开关）' : `已隐藏 ${count} 个（在「模型」区逐行用「展示」开关）`),
  )
}

/**
 * `groups-list` 型：分组级的整组开关。
 * 「自动选择」是全局统一开关（运行策略里的 enabled），组级只剩「下拉展示」，
 * 真正的开关在「分组」区的每张分组卡上，这里只列当前状态。
 */
function groupListRow(field: ConfigField): HTMLElement {
  const rules = draftOf<CustomGroup[]>('customGroups', [])
  const off = draftOf<string[]>(field.key, [])
  if (rules.length === 0) return settingRow(field.label, field.hint, descText('还没有自定义分组'))
  const line = el('div', { display: 'flex', flexWrap: 'wrap', gap: '4px 10px', justifyContent: 'flex-end' })
  for (const rule of rules) {
    line.appendChild(descText(`${rule.label || rule.id}：${off.includes(rule.id) ? '不展示' : '展示'}`))
  }
  return settingRow(field.label, field.hint, line)
}

// ──────────────────── 设置页 UI：单页布局 ────────────────────

// ──────────────────── 单页布局（不引入页签，按用户读的顺序自上而下） ────────────────────
//
// 结构：标题与重新获取 → 保存条 → 状态摘要 → 分组 → 模型清单 → 运行策略 → 状态行。
// 用户 m04660 的要求是「不要想复杂」：分组就是可改名的来源分组，模型往组里配，
// 剩下的是自动选择 / 重试 / 冷却，全部改完点「保存」才生效。

// 页面级视图状态：筛选与折叠。进签名（见 mountSettingsForm），否则点了没反应。
const FILTER_ALL = ''
const FILTER_LOOSE = '__loose__'
let modelFilter: string = FILTER_ALL
let modelsExpanded = false
let advancedOpen = false
const MODEL_PAGE = 12

/**
 * 顶部操作条（sticky）：标题 + 摘要 + 重新获取 + 保存/放弃 + 状态行。
 *
 * 为什么钉住：模型清单可能有几十行，用户滚到下面改完入组，保存按钮若留在页首就看不见，
 * 只能滚回去找——这是「操作流程不顺」最直接的来源。把保存与反馈钉在顶部，任何位置都能保存。
 */
function stickyBar(): HTMLElement {
  const keys = draftKeys()
  const pending = keys.length > 0
  const cfg = config?.config ?? {}
  const entries = view?.entries ?? []
  const cooldown = view?.cooldown
  const def = cfg.defaultModel as { provider?: string; model?: string } | null | undefined
  const summary = [
    cfg.enabled === false ? '自动选择：已关闭' : '自动选择：已启用',
    def === null || def === undefined ? '默认模型：跟随宿主' : `默认模型：${def.model ?? ''}`,
    `${entries.length} 个模型`,
    cooldown?.active === true ? `冷却中 ${Math.ceil(cooldown.remainingMs / 60000)} 分钟` : '无冷却',
  ].join(' · ')

  const bar = el('div', {
    position: 'sticky',
    top: '0',
    zIndex: '2',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 0 8px',
    background: TOK.layer,
    borderBottom: `0.5px solid ${TOK.border}`,
  })
  bar.setAttribute('data-mas-topbar', '1')

  const top = el('div', { display: 'flex', alignItems: 'center', gap: '10px' })
  const head = el('div', { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1', minWidth: '0' })
  head.appendChild(el('span', { fontSize: '15px', lineHeight: '24px', fontWeight: '600', color: TOK.primary }, '模型自动选择'))
  const summaryLine = descText(summary)
  summaryLine.setAttribute('data-mas-status', '1')
  head.appendChild(summaryLine)
  top.appendChild(head)
  top.appendChild(
    actionButton(
      '重新获取',
      '重新拉取模型目录（来源：llm.listProviders / llm.listModels / resolveModelInfo）',
      () => {
        statusKind = 'pending'
        statusText = '正在重新获取模型列表…'
        notify()
        void loadCatalog({ force: true })
      },
      { 'data-mas-retry': '1' },
    ),
  )
  if (pending) {
    top.appendChild(actionButton('放弃', '丢弃全部未保存改动，恢复成已保存的配置', discardDraft))
    top.appendChild(
      actionButton('保存', '把草稿写入插件配置（profile 的 cordis.patch.yml）', () => void saveDraft(), {
        'data-mas-save': '1',
      }),
    )
  }
  bar.appendChild(top)

  const line = el('div', { display: 'flex', alignItems: 'center', gap: '10px' })
  const barText = el(
    'span',
    { fontSize: '12px', lineHeight: '18px', flex: '1', color: pending ? TOK.warn : TOK.tertiary },
    pending ? `有 ${keys.length} 项改动未保存：${keys.join('、')}` : '没有未保存的改动',
  )
  barText.setAttribute('data-mas-savebar', '1')
  line.appendChild(barText)
  bar.appendChild(line)

  const status = statusLine()
  if (status !== null) bar.appendChild(status)
  return bar
}

/** 分区标题：序号圆点 + 标题 + 一句操作指引。让「先做什么」不用猜。 */
function stepTitle(step: string, title: string, desc: string): HTMLElement {
  const box = el('div', { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '18px 0 6px' })
  box.setAttribute('data-mas-step', step)
  box.appendChild(
    el(
      'span',
      {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        flex: '0 0 auto',
        background: TOK.module,
        color: TOK.secondary,
        fontSize: '12px',
        fontWeight: '600',
      },
      step,
    ),
  )
  const text = el('div', { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1', minWidth: '0' })
  text.appendChild(el('span', { fontSize: '14px', lineHeight: '22px', fontWeight: '600', color: TOK.primary }, title))
  if (desc !== '') text.appendChild(descText(desc))
  box.appendChild(text)
  return box
}

/** 模型清单里的一段分组标题。 */
function groupHead(label: string, note: string, id: string, list: CatalogEntry[]): HTMLElement {
  const head = el('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 0 4px',
    borderBottom: `0.5px solid ${TOK.border}`,
  })
  head.setAttribute('data-mas-group-head', id)
  head.appendChild(el('span', { fontSize: '13px', fontWeight: '600', color: TOK.primary }, label))
  head.appendChild(descText(note))
  // 分组一键测试：批量探测该组全部模型，结果回填到每一行的「测试」按钮。
  const test = actionButton(
    '测试全组',
    '真实逐个测试本组 ' + list.length + ' 个模型当前能否调通',
    () => {},
    { 'data-mas-group-test': id },
  ) as HTMLButtonElement
  test.disabled = list.length === 0
  test.addEventListener('click', () => { void testGroupViaRoute(list, test) })
  // 目录重渲染会重建该按钮，从模块级表回填既有汇总，避免「测试全组」把上次结果冲掉。
  applyGroupProbeSummary(test)
  head.appendChild(test)
  return head
}

/**
 * 模型区：搜索 + 分组筛选 chips + 逐组列模型，每行一个「入组」下拉 + 一个「展示」开关。
 *
 * 流程改造（mas-v7）：建组后默认停在「未入组」，让用户一眼看到还剩多少模型没进组；
 * 超过 MODEL_PAGE 行先折叠，避免 50 行铺满整页。筛选 chips 只改本模块状态 + notify，不重排宿主 DOM。
 */
function modelsSection(): HTMLElement {
  const section = el('div', { display: 'flex', flexDirection: 'column', gap: '0' })
  section.setAttribute('data-mas-section', 'models')

  if (view === null) {
    const hint = el(
      'div',
      { padding: '12px 0', fontSize: '13px', color: viewError === null ? TOK.tertiary : TOK.error },
      viewError === null ? '模型目录加载中…' : `模型目录加载失败：${viewError}`,
    )
    hint.setAttribute('role', 'status')
    hint.setAttribute('aria-live', 'polite')
    section.appendChild(hint)
    return section
  }

  const entries = view.entries ?? []
  if (entries.length === 0) {
    section.appendChild(
      el(
        'div',
        { padding: '12px 0', fontSize: '13px', color: TOK.tertiary },
        '没有取到任何模型：请先在 dsh 设置页配置 provider 与 API Key，再点上方「重新获取」。',
      ),
    )
    return section
  }

  const rules = draftOf<CustomGroup[]>('customGroups', [])
  const autoMode = groupingAuto()
  // 自动分组模式忽略手工规则，强制走 view.groups（服务端已按免费/积分/未知分好三组）。
  const hasRules = !autoMode && rules.length > 0
  // 筛选指向已被删除的分组时回退到「全部」，避免停在空白视图
  if (modelFilter !== FILTER_ALL && modelFilter !== FILTER_LOOSE && !rules.some((rule) => rule.id === modelFilter)) {
    modelFilter = FILTER_ALL
  }
  if (!hasRules) modelFilter = FILTER_ALL
  const loose = entries.filter((entry) => groupIdOf(entry) === '')

  const tools = el('div', { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '2px 0 8px' })
  const search = textInput('', '搜索模型名或来源…', '200px', { 'data-mas-search': '1' })
  search.addEventListener('input', () => {
    const needle = search.value.trim().toLowerCase()
    for (const node of Array.from(section.querySelectorAll('[data-mas-model-row]')) as HTMLElement[]) {
      const hit = needle === '' || (node.textContent ?? '').toLowerCase().includes(needle)
      node.style.display = hit ? 'flex' : 'none'
    }
    for (const node of Array.from(section.querySelectorAll('[data-mas-group-head]')) as HTMLElement[]) {
      node.style.display = needle === '' ? 'flex' : 'none'
    }
  })
  tools.appendChild(search)

  if (hasRules) {
    const chips = [
      { id: FILTER_ALL, label: `全部 ${entries.length}` },
      { id: FILTER_LOOSE, label: `未入组 ${loose.length}` },
      ...rules.map((rule) => ({
        id: rule.id,
        label: `${rule.label || rule.id} ${entries.filter((entry) => groupIdOf(entry) === rule.id).length}`,
      })),
    ]
    for (const chip of chips) {
      const active = modelFilter === chip.id
      const button = actionButton(
        chip.label,
        active ? '当前筛选' : '只看这一组',
        () => {
          modelFilter = chip.id
          modelsExpanded = false
          notify()
        },
        { 'data-mas-filter': chip.id },
      )
      button.style.height = '28px'
      button.style.padding = '0 10px'
      button.style.background = active ? TOK.hover : 'transparent'
      button.style.borderColor = active ? TOK.primary : TOK.border
      tools.appendChild(button)
    }
  } else {
    tools.appendChild(descText(autoMode
      ? '自动分组：按「免费 / 积分 / 未知」实时分三组；手工分组已暂存，切回「手工」原样恢复。'
      : '还没有自定义分组：先在上面「1 分组」建一个组，再回来把模型选进去。'))
  }

  // 「显示全部模型」开关：能看到所有模型（包括未入组的）
  const showAll = draftOf<boolean>('showAllModels', false)
  const showAllLabel = el('label', { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginLeft: 'auto', fontSize: '13px', color: TOK.secondary })
  const showAllBox = document.createElement('input')
  showAllBox.type = 'checkbox'
  showAllBox.checked = showAll
  showAllBox.style.cssText = 'margin:0;width:15px;height:15px;cursor:pointer'
  showAllBox.setAttribute(OWN_ATTR, '1')
  showAllBox.addEventListener('change', () => {
    stage('showAllModels', showAllBox.checked, showAllBox.checked ? '显示全部模型' : '只显示已入组模型')
  })
  showAllLabel.appendChild(showAllBox)
  showAllLabel.appendChild(document.createTextNode('显示全部模型'))
  if (!autoMode) tools.appendChild(showAllLabel)
  section.appendChild(tools)

  // 组装要渲染的分段：没建组时按 dsh 内置分组；建过组按筛选条件
  const segments: Array<{ id: string; label: string; note: string; list: CatalogEntry[] }> = []
  if (!hasRules) {
    for (const group of view.groups ?? []) {
      const list = group.keys
        .map((key) => entries.find((item) => item.key === key))
        .filter((item): item is CatalogEntry => item !== undefined)
      segments.push({
        id: group.id,
        label: group.label,
        note: group.custom === true ? '自定义分组' : group.kind === 'multimodal' ? '多模态' : group.kind === 'text' ? '纯文本' : '按来源',
        list,
      })
    }
  } else if (showAll) {
    // 显示全部模型：按可用状态分三段
    const available = entries.filter((e) => !e.disabled && !e.hidden)
    const disabled = entries.filter((e) => e.disabled && !e.hidden)
    const hidden = entries.filter((e) => e.hidden)
    if (available.length > 0) segments.push({ id: 'available', label: '可用', note: `${available.length} 个模型`, list: available })
    if (disabled.length > 0) segments.push({ id: 'disabled', label: '不可用', note: `${disabled.length} 个模型 · 未入组或已停用`, list: disabled })
    if (hidden.length > 0) segments.push({ id: 'hidden', label: '已隐藏', note: `${hidden.length} 个模型 · 不在下拉展示`, list: hidden })
  } else if (modelFilter === FILTER_LOOSE) {
    segments.push({ id: FILTER_LOOSE, label: '未入组', note: `${loose.length} 个模型 · 默认不可用、不进下拉`, list: loose })
  } else if (modelFilter === FILTER_ALL) {
    for (const rule of rules) {
      const list = entries.filter((entry) => groupIdOf(entry) === rule.id)
      segments.push({ id: rule.id, label: rule.label || rule.id, note: `自定义分组 · ${list.length} 个模型`, list })
    }
    if (loose.length > 0) {
      segments.push({ id: FILTER_LOOSE, label: '未入组', note: `${loose.length} 个模型 · 默认不可用、不进下拉`, list: loose })
    }
  } else {
    const rule = rules.find((item) => item.id === modelFilter)
    if (rule !== undefined) {
      const list = entries.filter((entry) => groupIdOf(entry) === rule.id)
      segments.push({ id: rule.id, label: rule.label || rule.id, note: `自定义分组 · ${list.length} 个模型`, list })
    }
  }

  // 探测判「暂不可用」的模型从各正常分组里挪出来，单独归到末尾虚拟组；重测通过后自动移出。
  const unavailableKeys = new Set(view.unavailableModels ?? [])
  for (const segment of segments) {
    segment.list = segment.list.filter((entry) => !unavailableKeys.has(entry.key))
  }
  if (unavailableKeys.size > 0) {
    const list = entries.filter((entry) => unavailableKeys.has(entry.key))
    if (list.length > 0) {
      segments.push({
        id: '__unavailable__',
        label: `暂不可用 · ${list.length}`,
        note: '最近一次连通性探测调不通；不参与自动选择，点「测试全组」重测通过后自动移出',
        list,
      })
    }
  }

  for (const segment of segments) {
    section.appendChild(groupHead(segment.label, segment.note, segment.id, segment.list))
    if (segment.list.length === 0) {
      section.appendChild(descText(autoMode
        ? '这一组目前没有模型。'
        : '这个组还没有成员：用下面任意一行模型的「入组」下拉把模型选进来。'))
      continue
    }
    const shown = modelsExpanded ? segment.list : segment.list.slice(0, MODEL_PAGE)
    for (const entry of shown) section.appendChild(modelRow(entry))
    const hiddenCount = segment.list.length - shown.length
    if (hiddenCount > 0) {
      section.appendChild(
        actionButton(
          `显示全部 ${segment.list.length} 个（还有 ${hiddenCount} 个未展开）`,
          '展开这个分组的全部模型（搜索只作用于已显示的行）',
          () => {
            modelsExpanded = true
            notify()
          },
          { 'data-mas-expand': segment.id },
        ),
      )
    }
  }

  const failed = view.failures ?? []
  if (failed.length > 0) {
    section.appendChild(
      el(
        'div',
        { marginTop: '8px', fontSize: '12px', color: TOK.warn },
        `有 ${failed.length} 个来源拉取失败：${failed.map((item) => `${item.name}（${item.message}）`).join('；')}`,
      ),
    )
  }
  return section
}


/** 分组区：分组方式（按来源 / 按类型）+ 自定义分组（新建、改名、勾成员、整组开关）。 */
function groupsSection(): HTMLElement {
  const section = el('div', { display: 'flex', flexDirection: 'column', gap: '0' })
  section.setAttribute('data-mas-section', 'groups')

  if (groupingAuto()) {
    section.appendChild(descText('当前是「自动分组」：按模型是否免费实时分成 免费 / 积分 / 未知 三组。原有自定义分组已暂存，切回「手工」（运行策略 → 分组方式）原样恢复。'))
    return section
  }

  const byKind = draftOf<boolean>('groupByKind', true)
  section.appendChild(
    settingRow(
      '按类型分组',
      '开 = 所有来源的多模态一组、纯文本一组；关 = 按来源（provider）分组。这就是 dsh 内置的两种分组方式。',
      checkControl('按类型分组', byKind, { 'data-mas-groupby': 'kind' }, (next) => {
        stage('groupByKind', next, next ? '分组方式 → 按类型' : '分组方式 → 按来源')
      }),
    ),
  )

  const field = (config?.fields ?? []).find((item) => item.key === 'customGroups')
  section.appendChild(groupsEditor(field ?? { key: 'customGroups', type: 'groups', label: '自定义分组', hint: '' }))
  return section
}

/** 运行策略的语义分块：只留用户真正会改的项，缓存/排序/徽标/错误码等高级旋钮不再露面。 */
const FIELD_BLOCKS: Array<{ id: string; title: string; desc: string; keys: string[] }> = [
  { id: 'basic', title: '默认模型与总开关', desc: '起手用哪个模型，以及插件是否接管选择', keys: ['enabled', 'defaultModel'] },
  { id: 'grouping', title: '分组与自动探测', desc: '分组方式：手工（自定义分组）或自动（按免费 / 积分 / 未知）；定时探测间隔 0 = 不自动', keys: ['groupMode', 'probeIntervalMin'] },
  { id: 'retry', title: '失败重试', desc: '同一个模型报错时先重试；机会用完才换模型', keys: ['maxRetries'] },
  {
    id: 'switch',
    title: '自动切换',
    desc: '重试机会用完后换哪个模型：默认先在你自己的分组里换，组内耗尽再跨组兜底',
    keys: ['switchScope', 'preferIdle'],
  },
]

/** 这些字段不进「运行策略」也不进「其他」：要么在分组/模型/分组卡片里逐行操作，要么是只读汇总。 */
const QUIET_FIELDS = new Set([
  'customGroups', 'groupByKind',
  'disabledModels', 'disabledGroups', 'hiddenModels', 'hiddenGroups',
])

function policySection(): HTMLElement {
  const section = el('div', { display: 'flex', flexDirection: 'column', gap: '0' })
  section.setAttribute('data-mas-section', 'policy')
  if (config === null) {
    section.appendChild(el('div', { padding: '12px 0', fontSize: '13px', color: TOK.tertiary }, '配置加载中…'))
    return section
  }
  const known = new Set(FIELD_BLOCKS.flatMap((block) => block.keys))
  section.appendChild(
    blockTitle('运行策略', '自动选择、失败重试、同类型切换与冷却恢复，都在这里配。'),
  )
  for (const block of FIELD_BLOCKS) {
    const fields = config.fields.filter((field) => block.keys.includes(field.key))
    if (fields.length === 0) continue
    section.appendChild(blockTitle(block.title, block.desc))
    for (const field of fields) section.appendChild(configRow(field))
  }
  // 未来新增的配置字段自动落到「其他」，不会被界面吞掉；QUIET_FIELDS 是刻意不在本区展示的项。
  const rest = config.fields.filter(
    (field) => !known.has(field.key) && !QUIET_FIELDS.has(field.key),
  )
  if (rest.length > 0) {
    section.appendChild(blockTitle('其他', '新增配置项'))
    for (const field of rest) section.appendChild(configRow(field))
  }
  section.appendChild(
    el('div', { marginTop: '10px', fontSize: '12px', lineHeight: '18px', color: TOK.tertiary },
      config.writable
        ? `改动保存后写入 ${config.documentPath ?? 'cordis.patch.yml'}`
        : '配置文档不可写：改动只作用于本进程内存，重启后失效'),
  )
  return section
}

function statusLine(): HTMLElement | null {
  if (statusText === '') return null
  const tone =
    statusKind === 'error' ? TOK.error : statusKind === 'ok' ? TOK.ok : statusKind === 'pending' ? TOK.warn : TOK.tertiary
  const line = el('div', { fontSize: '12px', lineHeight: '18px', color: tone }, statusText)
  line.setAttribute('role', 'status')
  line.setAttribute('aria-live', 'polite')
  return line
}

/**
 * 设置页唯一完整视图：sticky 操作条 → ① 分组 → ② 模型入组 → ③ 运行策略。
 *
 * 顺序就是用户的操作顺序（用户 m04660 / m04856）：先建组、再把模型选进组、最后定运行策略，
 * 全部改完点顶部「保存」才生效。不引入页签，保持单页顺读。
 */
function buildSettingsForm(): HTMLElement {
  const wrap = el('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    width: '100%',
    maxWidth: '760px',
    fontSize: '13px',
  })

  wrap.appendChild(stickyBar())

  const autoMode = groupingAuto()
  const groups = el('div', { display: 'flex', flexDirection: 'column', gap: '0' })
  groups.appendChild(stepTitle('1', '分组', autoMode
    ? '自动分组：按模型是否免费实时分三组，切回「手工」可恢复原有自定义分组。'
    : '先建组：dsh 默认按来源或类型分组，这里的组名就是模型下拉里的分组标题。'))
  groups.appendChild(groupsSection())
  wrap.appendChild(groups)

  const models = el('div', { display: 'flex', flexDirection: 'column', gap: '0' })
  models.appendChild(stepTitle('2', autoMode ? '模型' : '模型入组', autoMode
    ? '逐行「测试」可验证模型能否调通；调不通的自动归到末尾「暂不可用」组。'
    : '再把模型选进组：没入组的模型默认不可用，也不出现在模型下拉里。'))
  models.appendChild(modelsSection())
  wrap.appendChild(models)

  const policy = el('div', { display: 'flex', flexDirection: 'column', gap: '0' })
  policy.appendChild(stepTitle('3', '运行策略', '分组方式、自动探测间隔、失败重试与自动切换。改完点顶部「保存」才生效。'))
  policy.appendChild(policySection())
  wrap.appendChild(policy)

  return wrap
}

// ──────────────────── 模型下拉旁的状态徽标（宿主 DOM 追加，不抢槽） ────────────────────

/**
 * 模型选择按钮的精确判定：宿主 aria-label 形如「选择模型，当前 X，推理等级 Y」。
 *
 * 只认 aria-label 这一个证据。早先还留了「aria-controls 以 -menu 结尾且含 model」的第二分支，
 * 结果工具栏里一排普通下拉按钮（同样带 aria-controls=xxx-menu）全被误判成模型按钮，
 * 冷却倒计时于是被挂到十多个按钮上。宁可漏标一个改了名的模型按钮，也不批量误标。
 */
function isModelTrigger(button: HTMLElement): boolean {
  const aria = button.getAttribute('aria-label') ?? ''
  return /选择模型|Select model/i.test(aria)
}

/** 选择按钮旁**只**在冷却时挂倒计时；平时不挂（宿主的模型名已经够了）。 */
function decorateTrigger(button: HTMLElement): boolean {
  if (!isModelTrigger(button)) return false
  const cooldown = view?.cooldown
  const parent = button.parentElement
  if (parent === null) return false
  // 只认自己挂的那一个（COOLDOWN_ATTR 专属标记）：工具栏容器里还有别的自有节点，
  // 用通用的 OWN_ATTR 会把它当成倒计时，于是每轮刷新都 remove 一次再 append 一次。
  const existing = parent.querySelector(`:scope > [${COOLDOWN_ATTR}]`) as HTMLElement | null

  if (cooldown?.active !== true) {
    if (existing !== null) {
      existing.remove()
      return true
    }
    return false
  }

  const total = Math.max(0, Math.ceil(cooldown.remainingMs / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  const text = `冷 ${mm}:${ss}`
  if (existing !== null && existing.getAttribute(BADGE_ATTR) === text) return false
  if (existing !== null) existing.remove()
  const pill = makePill(text, `全部模型不可用，冷却中（${cooldown.reason || '无原因记录'}）`, 'busy')
  pill.setAttribute(COOLDOWN_ATTR, '1')
  parent.appendChild(pill)
  return true
}

function decorate(root: ParentNode): number {
  if (view === null) return 0
  let changed = 0
  for (const node of Array.from(root.querySelectorAll('span[data-model-id][data-provider-id]'))) {
    if (decorateRow(node as HTMLElement)) changed += 1
  }
  for (const node of Array.from(root.querySelectorAll('button[aria-haspopup="menu"]'))) {
    const button = node as HTMLElement
    if (decorateTrigger(button)) changed += 1
    if (isModelTrigger(button)) ensureSettingsButton(button)
  }
  return changed
}

function scheduleDecorate() {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    decorate(document)
  })
}

function startObserver() {
  if (observer !== null) return
  observer = new MutationObserver((records) => {
    let relevant = false
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const el = node as HTMLElement
        if (el.hasAttribute?.(OWN_ATTR) === true) continue
        relevant = true
        break
      }
      if (relevant) break
    }
    if (relevant) scheduleDecorate()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

// ──────────────────── 齿轮按钮 → 打开本插件设置页 ────────────────────

/**
 * 打开 dsh 设置页并停到「模型自动选择」。
 *
 * 宿主没有给第三方插件的跳转 API（`SettingsSectionOwnerProps` 只有 `close`，`ctx.shortcuts`
 * 也没有 invoke），只能走 DOM。第一跳有三条候选，真机顺序：
 *   1. `settings.launcher` 槽为空时的 general fallback 按钮（`aria-label` = 设置 / Settings）
 *   2. 同款按钮按 CSS 类名后缀 `_trigger` + 父容器 `triggerRow`（不受语言切换影响）
 *   3. **账号菜单 → 菜单项「设置」**：真机上 launcher 是 single 槽，被
 *      `dsh-client-ui-settings-account` 的 AccountMenu 占走，fallback 根本不渲染，
 *      而 AccountMenu 的菜单项回调里就是宿主自己的 `openSettings()`。
 * 第二跳在面板里按 `span` 文本点中本插件的导航项。两条失败路径分别落 beacon，便于真机排障。
 */
function openSettingsSection(): void {
  const panelOpen = (): boolean => document.querySelector(SETTINGS_PANEL_SEL) !== null
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms)
    })
  const ariaOf = (node: Element): string => (node.getAttribute('aria-label') ?? '').trim()
  /** 排除自家节点：齿轮按钮自己也带 aria-label，泛匹配会点回自己。 */
  const own = (node: Element): boolean => node.hasAttribute(OWN_ATTR) || node.hasAttribute(SETTINGS_BTN_ATTR)

  // React 渲染是异步的：点完立刻查面板会假阴性，必须轮询。
  const clickAndWait = async (nodes: HTMLElement[]): Promise<boolean> => {
    for (const node of nodes) {
      node.click()
      for (let i = 0; i < 6; i += 1) {
        await wait(50)
        if (panelOpen()) return true
      }
    }
    return false
  }

  const directButtons = (): HTMLElement[] =>
    (Array.from(document.querySelectorAll('button[aria-label]')) as HTMLElement[]).filter(
      (button) => !own(button) && SETTINGS_LAUNCHER_LABELS.includes(ariaOf(button)),
    )

  const classButtons = (): HTMLElement[] =>
    (Array.from(document.querySelectorAll('button')) as HTMLElement[]).filter(
      (button) =>
        !own(button) &&
        /_trigger$/u.test(button.className) &&
        /triggerRow/u.test(button.parentElement?.className ?? ''),
    )

  // 路径 3：账号菜单 → 菜单项「设置」
  const viaAccountMenu = async (): Promise<boolean> => {
    if (panelOpen()) return true
    const triggers = (Array.from(document.querySelectorAll('button[aria-label]')) as HTMLElement[]).filter(
      (button) => !own(button) && ACCOUNT_MENU_LABELS.includes(ariaOf(button)),
    )
    if (triggers.length === 0) return false
    triggers[0].click()
    for (let i = 0; i < 8; i += 1) {
      await wait(60)
      if (panelOpen()) return true
      // 宿主 MenuItemButton 把快捷键提示拼进同一个 button 的 textContent（真机是「设置Ctrl+Alt+,」），
      // 整串相等匹配必然落空 —— 必须按前缀匹配，并优先取 label span 的文本（快捷键 span 在它前面）。
      const items = (
        Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')) as HTMLElement[]
      ).filter((item) => {
        if (own(item)) return false
        const labelNode = item.querySelector('[class*="_itemLabel"], span:last-of-type')
        const text = ((labelNode?.textContent ?? item.textContent) ?? '').trim()
        return SETTINGS_MENU_LABELS.some((label) => text.startsWith(label))
      })
      if (items.length === 0) continue
      items[0].click()
      for (let j = 0; j < 6; j += 1) {
        await wait(50)
        if (panelOpen()) return true
      }
      return false
    }
    return false
  }

  const selectNavItem = (): boolean => {
    const panel = document.querySelector(SETTINGS_PANEL_SEL)
    if (panel === null) return false
    for (const row of Array.from(panel.querySelectorAll('button')) as HTMLElement[]) {
      const label = row.querySelector('span')
      const text = ((label?.textContent ?? row.textContent) ?? '').trim()
      if (text !== SETTINGS_LABEL) continue
      row.click()
      return true
    }
    return false
  }

  const selectNavWithRetry = async (): Promise<boolean> => {
    if (selectNavItem()) return true
    for (let i = 0; i < 10; i += 1) {
      await wait(60)
      if (selectNavItem()) return true
    }
    return false
  }

  const attempt = async (): Promise<void> => {
    if (!panelOpen()) {
      const opened =
        (await clickAndWait(directButtons())) ||
        (await clickAndWait(classButtons())) ||
        (await viaAccountMenu())
      if (!opened) {
        beacon({ phase: 'settings-open-failed', step: 'launcher-missing' })
        return
      }
    }
    if (await selectNavWithRetry()) return
    beacon({ phase: 'settings-open-failed', step: 'nav-item-missing' })
  }

  void attempt()
}

/**
 * 在模型下拉按钮所在行插入齿轮。
 * 宿主模型选择器根容器只有 `min-width:0;position:relative`（块级），直接追加第二个节点会换行，
 * 所以先把父容器补成 flex 行（nowrap + 按钮 `flex:0 0 auto`）。
 */
function ensureSettingsButton(trigger: HTMLElement): void {
  const parent = trigger.parentElement
  if (parent === null) return
  if (parent.querySelector(`:scope > button[${SETTINGS_BTN_ATTR}]`) !== null) return
  parent.setAttribute(SETTINGS_ROW_ATTR, '1')
  parent.style.display = 'flex'
  parent.style.alignItems = 'center'
  parent.style.flexWrap = 'nowrap'
  parent.style.minWidth = '0'

  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute(OWN_ATTR, '1')
  button.setAttribute(SETTINGS_BTN_ATTR, '1')
  button.setAttribute('aria-label', SETTINGS_BTN_LABEL)
  button.title = SETTINGS_BTN_LABEL
  button.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;margin-left:4px;padding:0;' +
    'width:22px;height:22px;border:0;border-radius:6px;background:transparent;' +
    'color:var(--dsh-color-text-tertiary, #9aa0a6);cursor:pointer;flex:0 0 auto;white-space:nowrap;line-height:0'

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('width', '14')
  icon.setAttribute('height', '14')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '1.3')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('aria-hidden', 'true')
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  ring.setAttribute('cx', '8')
  ring.setAttribute('cy', '8')
  ring.setAttribute('r', '2.1')
  icon.appendChild(ring)
  const spokes = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  spokes.setAttribute('d', 'M8 1.7v1.4M8 12.9v1.4M1.7 8h1.4M12.9 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1')
  icon.appendChild(spokes)
  button.appendChild(icon)

  const hover = (on: boolean) => {
    button.style.background = on ? 'var(--dsh-color-fill-quaternary, rgba(127,127,127,0.12))' : 'transparent'
    button.style.color = on
      ? 'var(--dsh-color-text-primary, #1b1d21)'
      : 'var(--dsh-color-text-tertiary, #9aa0a6)'
  }
  button.addEventListener('mouseenter', () => hover(true))
  button.addEventListener('mouseleave', () => hover(false))
  button.addEventListener('focus', () => hover(true))
  button.addEventListener('blur', () => hover(false))
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openSettingsSection()
  })

  parent.insertBefore(button, trigger.nextSibling)
}

// ──────────────────── settings.section 注册 ────────────────────

const SETTINGS_SLOT = 'settings.section'
const SETTINGS_ID = 'model-auto-select'
const SETTINGS_ORDER = 30
const SETTINGS_LABEL = '模型自动选择'

/** 从宿主 `require('react')` 取 React（客户端半边是 CJS，宿主注入 require）。 */
function loadReact(): any {
  const req = typeof require === 'function' ? require : null
  if (req === null) return null
  try {
    const mod = req('react')
    const React = mod && typeof mod.createElement === 'function' ? mod : mod?.default
    if (React === null || React === undefined) return null
    if (
      typeof React.createElement !== 'function' ||
      typeof React.useRef !== 'function' ||
      typeof React.useEffect !== 'function'
    ) {
      return null
    }
    return React
  } catch {
    return null
  }
}


// ──────────────────── 自建模型下拉（抢 conversation.input.model single 槽） ────────────────────
//
// 为什么必须自建：
//   宿主下拉的分组维度是 provider（`buildModelCatalog()` 直出 `group.name = provider.name`），
//   条目是 `llm.listModels()` 全量，客户端 `filteredGroups.map(...)` 渲染、行点击直接
//   `choose({provider, model})`，**中间没有任何过滤钩子**；`llm` 服务跨 fiber 不可覆盖、
//   `listModels` 没有 waterfall、动态插件也拿不到 `ctx.remote`。
//   所以要让「下拉按用户分组展示 + 未入组不出现」，唯一干净的入口是自己注册这个槽。
//
// 为什么能抢到：`conversation.input.model` 是 single 槽，`register` 只在**同 priority** 时抛
//   `already has a registration at priority N`；动态包的 slots 门面会给每次注册分配
//   `priority = --nextPriority`（从 0 递减），后注册者更低 ⇒ `entriesOfSlot[0]` 就是本插件，
//   宿主自带的 ModelSelect 退到后台但仍可被我们自己主动放弃（返回 false 时不注册）。
//
// 不能带 children：宿主已经用同名 entry 声明了 `conversation.input.model.label`，
//   `register` 里 `slot "..." is already declared (by ...)` 会直接抛错。

const MODEL_SLOT = 'conversation.input.model'

type SlotDirectory = {
  subscribe: (fn: () => void) => () => void
  getSnapshot: () => any
}

/** 该模型在**已保存**配置里属于哪个分组 id；'' = 未入组。 */
function savedGroupIdOf(entry: CatalogEntry): string {
  const rules = savedRules()
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) return rule.id
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.id
    }
  }
  return ''
}

/**
 * 下拉要展示的分段。
 * - 没建自定义分组：沿用 dsh 内置分组（按类型/按来源），只保留 `disabled !== true` 的模型。
 * - 建过自定义分组：**只出已入组的模型**，按分组顺序；未入组一律不出现（也就不可能被点选）。
 * 单独隐藏（`hiddenModels`）的模型在任何模式下都不出现。
 */
function menuGroups(): Array<{ id: string; label: string; rows: CatalogEntry[] }> {
  const entries = view?.entries ?? []
  const hiddenList = Array.isArray(config?.config?.['hiddenModels'])
    ? (config?.config?.['hiddenModels'] as string[])
    : []
  // 三类条目一律不进下拉：单独隐藏（hidden）、用户关掉（disabled）、真实探测判暂不可用（unavailableModels）。
  // 这样「不展示 / 不可用 / 暂不可用」在自建下拉里统一不可见、也就不可能被点选。
  const unavailableKeys = new Set(view?.unavailableModels ?? [])
  const listed = entries.filter((entry) => !hiddenList.includes(`${entry.provider}/${entry.model}`)
    && entry.hidden !== true && entry.disabled !== true && !unavailableKeys.has(entry.key))
  const rules = savedRules()
  if (rules.length === 0) {
    const usable = listed.filter((entry) => entry.disabled !== true)
    const groups: Array<{ id: string; label: string; rows: CatalogEntry[] }> = []
    for (const group of view?.groups ?? []) {
      const rows = group.keys
        .map((key) => usable.find((entry) => entry.key === key))
        .filter((entry): entry is CatalogEntry => entry !== undefined)
      if (rows.length > 0) groups.push({ id: group.id, label: group.label, rows })
    }
    return groups
  }
  const groups: Array<{ id: string; label: string; rows: CatalogEntry[] }> = []
  for (const rule of rules) {
    const rows = listed.filter((entry) => savedGroupIdOf(entry) === rule.id)
    if (rows.length > 0) groups.push({ id: rule.id, label: rule.label || rule.id, rows })
  }
  return groups
}

/** 当前会话选中的模型在插件目录里的名字（拿不到就退回宿主给的原名）。 */
/** 每个会话一个极简 store：只提供「当前选中模型」，供自建下拉的触发按钮显示。 */
// 自建下拉的开关与搜索词：放模块级，配合直接操作 DOM（不依赖 React 状态）
let slotOpen = false
let slotQuery = ''
/** 键盘高亮落在「可见行」里的第几个（-1 = 没有高亮）。 */
let slotActive = -1
let slotPanelRef: HTMLElement | null = null
/** 组件每次渲染时把「选中某个模型」的回调挂上来，供键盘 Enter 复用。 */
let slotSelectRef: ((provider: string, model: string) => void) | null = null
/** 视口/缩放监听只挂一次，避免 apply/重渲染重复叠加。 */
let slotListenersAttached = false

/** 打开 / 关闭下拉：直接改 DOM，保证点了就有反应。 */
function applySlotOpen(): void {
  const panel = slotPanelRef as HTMLElement | null
  if (panel === null) return
  panel.style.display = slotOpen ? 'flex' : 'none'
  if (slotOpen) fitSlotPanel()
}

/** 面板的理想尺寸与边界余量（px）。 */
const SLOT_PANEL_MAX = 380
const SLOT_PANEL_MIN = 150
const SLOT_PANEL_WIDTH = 340
const SLOT_VIEWPORT_MARGIN = 8
const SLOT_GAP = 6

/** 找面板真正的「容器」：绝对定位面板一旦超出它就会把容器撑出滚动条。 */
function nearestContainer(trigger: HTMLElement): { el: HTMLElement; rect: DOMRect } {
  let n: HTMLElement | null = trigger.parentElement
  while (n !== null) {
    const s = getComputedStyle(n)
    const oy = s.overflowY
    const o = s.overflow
    if (oy === 'auto' || oy === 'scroll' || o === 'auto' || o === 'scroll') {
      return { el: n, rect: n.getBoundingClientRect() }
    }
    if (oy === 'hidden' || o === 'hidden') return { el: n, rect: n.getBoundingClientRect() }
    n = n.parentElement
  }
  const doc = document.documentElement
  return { el: doc, rect: doc.getBoundingClientRect() }
}

/**
 * 让面板自己识别边界：按触发按钮上下可用空间决定朝上还是朝下，
 * 按剩余空间收窄 maxHeight，水平方向夹进「容器」而非整屏视口。
 *
 * 之前是硬编码 `bottom: calc(100% + 6px)` + `width: 340px` + `maxHeight: 380px`：
 * 触发按钮靠右时面板伸出视口右侧、靠上时朝上顶出屏幕，两者都会把页面撑出滚动条。
 * 这里在打开、搜索过滤、尺寸变化、滚动、缩放时都重新算一次，任何异常都不许外抛。
 */
function fitSlotPanel(): void {
  try {
    const panel = slotPanelRef as HTMLElement | null
    if (panel === null) return
    const trigger = document.querySelector('[data-mas-slot-trigger]') as HTMLElement | null
    if (trigger === null) return
    const vw = window.innerWidth || document.documentElement.clientWidth || 0
    if (vw <= 0) return

    const tRect = trigger.getBoundingClientRect()
    // 用面板真正的容器算余量：绝对定位面板一旦超出滚动容器就会撑出滚动条
    // （打开右侧栏后输入框所在列变窄，按整屏视口夹紧仍会超出容器）。
    const { rect: crect } = nearestContainer(trigger)
    const above = Math.max(0, tRect.top - crect.top - SLOT_VIEWPORT_MARGIN - SLOT_GAP)
    const below = Math.max(0, crect.bottom - tRect.bottom - SLOT_VIEWPORT_MARGIN - SLOT_GAP)

    // 1) 宽度夹进容器可用空间（而非整屏），右侧栏打开时也不会横着撑出滚动条
    const availRight = Math.max(0, crect.right - tRect.left - SLOT_VIEWPORT_MARGIN)
    const width = Math.max(200, Math.min(SLOT_PANEL_WIDTH, availRight, vw - SLOT_VIEWPORT_MARGIN * 2))
    panel.style.width = `${Math.round(width)}px`

    // 2) 估「内容想要多高」：列表 + 搜索条 + 页脚 + 内边距
    const list = panel.querySelector('[data-mas-slot-list]') as HTMLElement | null
    const searchBox = panel.querySelector('[data-mas-slot-searchbox]') as HTMLElement | null
    const foot = panel.querySelector('[data-mas-slot-foot]') as HTMLElement | null
    const wanted = Math.min(
      SLOT_PANEL_MAX,
      (list === null ? 0 : list.scrollHeight) +
        (searchBox === null ? 0 : searchBox.offsetHeight) +
        (foot === null ? 0 : foot.offsetHeight) +
        12,
    )

    // 上面放得下「够用的高度」就朝上（贴着输入框更符合直觉），否则看哪边更宽裕
    const up = above >= Math.min(wanted, SLOT_PANEL_MIN) || above >= below
    const room = Math.max(0, up ? above : below)
    // 高度也按容器余量收窄，保证面板不超出滚动容器顶部/底部
    panel.style.maxHeight = `${Math.round(Math.max(SLOT_PANEL_MIN, Math.min(SLOT_PANEL_MAX, room)))}px`
    if (up) {
      panel.style.top = 'auto'
      panel.style.bottom = `calc(100% + ${SLOT_GAP}px)`
    } else {
      panel.style.bottom = 'auto'
      panel.style.top = `calc(100% + ${SLOT_GAP}px)`
    }

    // 3) 水平：先摆到 left 0，再按容器实测溢出整体平移
    panel.style.left = '0'
    const pRect = panel.getBoundingClientRect()
    let shift = 0
    const overflowRight = pRect.right - (crect.right - SLOT_VIEWPORT_MARGIN)
    if (overflowRight > 0) shift -= overflowRight
    const leftAfter = pRect.left + shift
    if (leftAfter < crect.left + SLOT_VIEWPORT_MARGIN) shift += (crect.left + SLOT_VIEWPORT_MARGIN) - leftAfter
    panel.style.left = `${Math.round(shift)}px`
  } catch {
    // 边界计算失败时退回默认样式，绝不让异常冒到宿主渲染里
  }
}

/**
 * 关下拉后把焦点还给触发按钮。
 *
 * 难点：选完模型会触发 `notify()` 重绘，React 会把触发按钮整个换掉，
 * 直接 `focus()` 拿到的是即将被丢弃的旧节点，焦点会掉到 body 上。
 * 所以这里留一个一次性标记，让新节点在 ref 回调里自己接管焦点。
 */
let slotFocusPending = false
let slotFocusTimer: any = null

function focusSlotTrigger(): void {
  slotFocusPending = true
  const trigger = document.querySelector('[data-mas-slot-trigger]') as HTMLElement | null
  if (trigger !== null && typeof trigger.focus === 'function') trigger.focus()
  if (typeof setTimeout !== 'function') {
    slotFocusPending = false
    return
  }
  if (slotFocusTimer !== null) clearTimeout(slotFocusTimer)
  slotFocusTimer = setTimeout(() => {
    slotFocusTimer = null
    slotFocusPending = false
  }, 500)
}

/** 关下拉：Esc / 点外面 / 选完都走这里，可选把焦点还给触发按钮。 */
function closeSlot(restoreFocus: boolean): void {
  if (!slotOpen) return
  slotOpen = false
  slotQuery = ''
  slotActive = -1
  applySlotOpen()
  if (restoreFocus) focusSlotTrigger()
}

/** 面板里当前「可见」的行（搜索过滤后按渲染顺序）。 */
function slotVisibleRows(): HTMLElement[] {
  const panel = slotPanelRef as HTMLElement | null
  if (panel === null) return []
  const out: HTMLElement[] = []
  for (const node of Array.from(panel.querySelectorAll('[data-mas-slot-row]')) as HTMLElement[]) {
    if (node.style.display !== 'none') out.push(node)
  }
  return out
}

/** 键盘高亮：只改背景/描边与 aria-activedescendant，不重绘、不丢焦点。 */
function applySlotNav(): void {
  const panel = slotPanelRef as HTMLElement | null
  if (panel === null) return
  const visible = slotVisibleRows()
  for (const node of Array.from(panel.querySelectorAll('[data-mas-slot-row]')) as HTMLElement[]) {
    const idx = visible.indexOf(node)
    const on = idx >= 0 && idx === slotActive
    const selected = node.getAttribute('data-mas-selected') === '1'
    node.style.background = on ? TOK.hover : selected ? TOK.module : 'transparent'
    node.style.outline = on ? `1px solid ${TOK.border}` : 'none'
    node.style.outlineOffset = '-1px'
  }
  const search = panel.querySelector('[data-mas-slot-search]') as HTMLElement | null
  const active = slotActive >= 0 && slotActive < visible.length ? visible[slotActive] : null
  if (search !== null) {
    if (active !== null && active.id !== '') search.setAttribute('aria-activedescendant', active.id)
    else search.removeAttribute('aria-activedescendant')
  }
  if (active !== null && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' })
}

/** 空态文案：区分「还没目录 / 没入组」与「搜索没命中」两种情况。 */
function slotEmptyText(needle: string, total: number): string {
  if (needle !== '') {
    return total === 0
      ? '还没有可选的模型：先到「模型自动选择」设置页取回模型列表，并把模型放进分组。'
      : `没有匹配「${needle}」的模型。可以搜模型名、来源名或 provider id，也可以清空搜索框看全部。`
  }
  return savedRules().length === 0
    ? '还没有模型目录或全部模型都不可用：先到「模型自动选择」设置页取回模型列表。'
    : '没有任何已入组的模型：先到「模型自动选择」设置页，把模型用「入组」下拉放进分组。'
}

/** 搜索：按「模型名 + 来源名 + provider id」过滤，命中之外的整行 display:none。 */
function applySlotFilter(): void {
  const panel = slotPanelRef as HTMLElement | null
  if (panel === null) return
  const needle = slotQuery.trim().toLowerCase()
  const rows = Array.from(panel.querySelectorAll('[data-mas-slot-row]')) as HTMLElement[]
  let matches = 0
  for (const row of rows) {
    const hay = (row.getAttribute('data-mas-name') ?? '').toLowerCase()
    const hit = needle === '' || hay.includes(needle)
    row.style.display = hit ? 'flex' : 'none'
    if (hit) matches += 1
  }
  // 组内一个可见行都没有就把整组收起，避免留下空标题
  for (const group of Array.from(panel.querySelectorAll('[data-mas-slot-group]')) as HTMLElement[]) {
    const any = Array.from(group.querySelectorAll('[data-mas-slot-row]')).some(
      (node) => (node as HTMLElement).style.display !== 'none',
    )
    group.style.display = any ? 'flex' : 'none'
  }
  slotActive = matches === 0 ? -1 : slotActive < 0 || slotActive >= matches ? 0 : slotActive
  const count = panel.querySelector('[data-mas-slot-count]')
  if (count !== null) count.textContent = needle === '' ? `${matches} 个模型` : `${matches} / ${rows.length} 个模型`
  const empty = panel.querySelector('[data-mas-slot-empty]') as HTMLElement | null
  if (empty !== null) {
    empty.style.display = matches === 0 ? 'block' : 'none'
    if (matches === 0) empty.textContent = slotEmptyText(needle, rows.length)
  }
  applySlotNav()
  fitSlotPanel()
}

/** 打开后要等 React 把行渲染出来，再过滤 + 聚焦搜索框。 */
function refreshSlotPanel(): void {
  slotQuery = ''
  slotActive = -1
  const panel = slotPanelRef as HTMLElement | null
  if (panel !== null) {
    const search = panel.querySelector('[data-mas-slot-search]') as HTMLInputElement | null
    if (search !== null) {
      search.value = ''
      search.focus()
    }
  }
  applySlotFilter()
}

function scheduleSlotRefresh(): void {
  if (typeof setTimeout !== 'function') return
  setTimeout(() => {
    if (slotOpen) refreshSlotPanel()
  }, 0)
}

/**
 * 占用变化会 notify → 面板整棵重渲染，行上**命令式**写入的键盘高亮、aria 与搜索框
 * 焦点随旧节点一起消失。这里等重渲染落地后把过滤与高亮重新套一遍，并把搜索词补回去。
 * setTimeout 里只碰自家 DOM，且整段 try/catch（宿主 API 异常不能逃出）。
 */
function reapplySlotPanel(): void {
  if (typeof setTimeout !== 'function') return
  setTimeout(() => {
    try {
      if (!slotOpen) return
      applySlotFilter()
      const panel = slotPanelRef as HTMLElement | null
      const search = panel?.querySelector('[data-mas-slot-search]') as HTMLInputElement | null
      if (search !== null) {
        search.value = slotQuery
        if (document.activeElement !== search) search.focus()
      }
    } catch {
      /* 补高亮/焦点失败就算了，不影响任何状态 */
    }
  }, 0)
}

/** 上下键移动高亮（不跨过首尾）。 */
function moveSlotActive(delta: number): void {
  const visible = slotVisibleRows()
  if (visible.length === 0) {
    slotActive = -1
    applySlotNav()
    return
  }
  const next = slotActive < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, slotActive + delta))
  slotActive = next
  applySlotNav()
}

function activeSlotRow(): HTMLElement | null {
  const visible = slotVisibleRows()
  return slotActive >= 0 && slotActive < visible.length ? visible[slotActive] : null
}

const KEY_SEP = String.fromCharCode(0)

const sessionStores = new Map<string, { subscribe: (fn: () => void) => () => void; getSnapshot: () => any }>()

function sessionDirectory(sessionId: string): { subscribe: (fn: () => void) => () => void; getSnapshot: () => any } {
  const existing = sessionStores.get(sessionId)
  if (existing !== undefined) return existing
  const watchers = new Set<() => void>()
  const store = {
    subscribe: (fn: () => void) => {
      watchers.add(fn)
      directoryWatchers.add(fn)
      return () => {
        watchers.delete(fn)
        directoryWatchers.delete(fn)
      }
    },
    getSnapshot: () => {
      const state = (view?.sessions ?? []).find((row) => row.sessionId === sessionId)
      return { current: currentSelectionOf(state?.current ?? null), status: 'ready', pending: null, groups: [], failures: [] }
    },
  }
  sessionStores.set(sessionId, store)
  return store
}

/** 把 `provider` + KEY_SEP + `model` 还原成宿主认识的 `{provider, model}`。 */
function currentSelectionOf(key: string | null): { provider: string; model: string } | null {
  if (key === null || key === '') return null
  const at = key.indexOf(KEY_SEP)
  if (at < 0) return null
  return { provider: key.slice(0, at), model: key.slice(at + 1) }
}

/** 选模型落到插件自己的路由：服务端用官方入口 selectForNextRequest，客户端不必碰宿主服务。 */
async function selectViaRoute(sessionId: string, selection: any): Promise<void> {
  const provider = String(selection?.provider ?? '')
  const model = String(selection?.model ?? '')
  if (provider === '' || model === '') return
  try {
    const response = await fetch(apiUrl('select'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, provider, model }),
    })
    if (!response.ok) {
      const detail = await response.text()
      statusKind = 'error'
      statusText = `切换模型失败：HTTP ${response.status} ${detail.slice(0, 120)}`
      notify()
      return
    }
    statusKind = 'ok'
    statusText = `已切换到 ${provider}/${model}`
    notify()
    void loadCatalog()
  } catch (err) {
    statusKind = 'error'
    statusText = `切换模型失败：${String((err as Error)?.message ?? err)}`
    notify()
  }
}

/**
 * 发一次真实极小请求，返回结构化结果；不碰任何 DOM、不写配置。
 * 单点测试与分组一键测试共用同一个请求口径，避免两套行为漂移。
 */
async function runProbe(provider: string, model: string): Promise<ProbeResult> {
  try {
    const response = await fetch(apiUrl('test-model'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model }),
    })
    const payload: any = await response.json().catch(() => ({}))
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        ms: Number(payload?.ms) || 0,
        error: String(payload?.error ?? ('HTTP ' + response.status)),
        ...(payload?.kind === 'model' || payload?.kind === 'infra' ? { kind: payload.kind } : {}),
      }
    }
    return {
      ok: true,
      ms: Number(payload.ms) || 0,
      ...(payload.sample === undefined ? {} : { sample: String(payload.sample) }),
    }
  } catch (err) {
    return { ok: false, ms: 0, error: String((err as Error)?.message ?? err) }
  }
}

/** 连通性测试：问服务端「这个模型现在能不能调通」，结果写进结果表并渲染到按钮，不写任何配置。 */
async function testModelViaRoute(provider: string, model: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true
  button.textContent = '测试中…'
  const result = await runProbe(provider, model)
  probeResults.set(probeKey(provider, model), result)
  applyProbeResult(button, result)
  button.disabled = false
  // 同一个模型可能同时出现在别的分组段里，一并回填。
  repaintProbeButtons()
  // 探测会改变服务端 probeUnavailable 集合：不可调的模型应立即从下拉移除，而不是等 TTL 过期。
  // 探测后强制刷新目录快照，让下拉立即反映最新 unavailableModels（否则按钮已标「不可调」、下拉却还留着它）。
  void loadCatalog({ force: true })
}

/** 分组一键测试的并发上限：避免一次点开把上游打满。 */
const GROUP_PROBE_CONCURRENCY = 4

/**
 * 批量测试一个分组下的所有模型。
 * 注意用 segment.list 全量，不受 MODEL_PAGE 折叠影响；结果写进 probeResults 后统一回填 DOM，
 * 因此折叠未展开的行在「显示全部」后也能看到结论（mountSettingsForm 的签名防重绘不拦这条路）。
 */
async function testGroupViaRoute(list: CatalogEntry[], button: HTMLButtonElement): Promise<void> {
  if (list.length === 0) return
  button.disabled = true
  const total = list.length
  let done = 0
  let okCount = 0
  const queue = list.slice()
  button.textContent = '测试中 0/' + total
  const worker = async (): Promise<void> => {
    for (;;) {
      const entry = queue.shift()
      if (entry === undefined) return
      const result = await runProbe(entry.provider, entry.model)
      probeResults.set(probeKey(entry.provider, entry.model), result)
      if (result.ok) okCount += 1
      done += 1
      button.textContent = '测试中 ' + done + '/' + total
      repaintProbeButtons()
    }
  }
  await Promise.all(Array.from({ length: Math.min(GROUP_PROBE_CONCURRENCY, total) }, () => worker()))
  const failCount = total - okCount
  button.textContent = '✓' + okCount + ' ✗' + failCount
  button.title = '本组 ' + total + ' 个模型测试完成：通过 ' + okCount + '，失败 ' + failCount + '（探测失败=传输/环境故障，模型仍在下拉可正常选择；不可调=模型级故障，已从下拉移除）'
  button.style.color = failCount === 0 ? '#4a9d5b' : (okCount === 0 ? '#d9534f' : TOK.warn)
  button.disabled = false
  // 汇总写进模块级表，loadCatalog 强制刷新重建按钮后还能从表里回填（否则汇总被默认文案冲掉）。
  const groupId = button.getAttribute('data-mas-group-test') ?? ''
  if (groupId !== '') groupProbeSummaries.set(groupId, { ok: okCount, fail: failCount, total })
  repaintProbeButtons()
  // 批量探测同样会改变服务端 probeUnavailable 集合：不可调模型应立即从下拉移除。
  // 整组测完强制刷新目录快照，让下拉立即反映最新 unavailableModels。
  void loadCatalog({ force: true })
}

/** 把分组一键测试的汇总渲染到组测试按钮上（从 groupProbeSummaries 表回填）。 */
function applyGroupProbeSummary(button: HTMLButtonElement): void {
  const groupId = button.getAttribute('data-mas-group-test') ?? ''
  const summary = groupProbeSummaries.get(groupId)
  if (summary === undefined) return
  button.textContent = '✓' + summary.ok + ' ✗' + summary.fail
  button.title = '本组 ' + summary.total + ' 个模型测试完成：通过 ' + summary.ok + '，失败 ' + summary.fail + '（探测失败=传输/环境故障，模型仍在下拉可正常选择；不可调=模型级故障，已从下拉移除）'
  button.style.color = summary.fail === 0 ? '#4a9d5b' : (summary.ok === 0 ? '#d9534f' : TOK.warn)
  button.disabled = false
}

function currentLabel(current: any): string {
  if (current === null || current === undefined) return '选择模型'
  const entry = entryOf(String(current.provider ?? ''), String(current.model ?? ''))
  return entry?.name ?? String(current.model ?? '选择模型')
}

function pillNode(React: any, text: string, title: string, tone: 'meta' | 'busy' | 'running' | 'price' | 'free'): any {
  const color = tone === 'running' || tone === 'free' ? TOK.ok : tone === 'busy' ? TOK.warn : TOK.tertiary
  return React.createElement(
    'span',
    {
      key: `p-${text}`,
      title,
      style: {
        flex: '0 0 auto',
        fontSize: '11px',
        lineHeight: '16px',
        padding: '0 4px',
        borderRadius: '4px',
        color,
        background: TOK.module,
      },
    },
    text,
  )
}

/** 来源标识：每行必带，显示 provider 的展示名（拿不到就退回 provider id）。 */
function sourceChip(React: any, row: CatalogEntry): any {
  const label = row.providerName !== '' ? row.providerName : row.provider
  return React.createElement(
    'span',
    {
      key: `s-${row.key}`,
      'data-mas-provider': row.provider,
      title: `来源：${label}（provider id：${row.provider}）`,
      style: {
        flex: '0 0 auto',
        maxWidth: '84px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11px',
        lineHeight: '16px',
        padding: '0 5px',
        borderRadius: '4px',
        color: TOK.secondary,
        background: TOK.module,
        border: `0.5px solid ${TOK.border}`,
      },
    },
    label,
  )
}

/** 模型名里的计价后缀（`· x0.06`）单独拿出来当徽标，名字本身保持干净。 */
function splitModelName(name: string): { base: string; price: string | null } {
  const hit = /^(.*?)\s*·\s*(x\s*[0-9]+(?:\.[0-9]+)?)$/.exec(name)
  if (hit === null) return { base: name, price: null }
  return { base: hit[1], price: hit[2].replace(/\s+/g, '') }
}

/** 搜索命中面：模型名 + 来源名 + provider id + 模型 id 都算。 */
function rowHaystack(row: CatalogEntry): string {
  return `${row.name} ${row.providerName} ${row.provider} ${row.model}`.toLowerCase()
}

/** 上下文窗口的展示格式：>=1000 用 K 单位（整除去小数，否则保留 1 位），否则原样。 */
function formatContext(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`
  }
  return String(n)
}


/**
 * 注册自建模型下拉。返回 false 表示槽不可用（调用方保留 DOM 追加层作为兜底）。
 * 注意：只用 `ctx.get(name)` 读服务（动态门面对 `get` 不要求 inject 声明），
 * 组件只消费 `directory.store` 的快照与 `select()`，不触碰宿主内部。
 */
function registerModelSelectSlot(ctx: any): boolean {
  const slots = ctx?.slots
  if (slots === undefined || slots === null) return false
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return false
  const React = loadReact()
  if (React === null) return false
  if (typeof React.useState !== 'function') return false
  const { useState, useEffect, useRef, createElement } = React

  /** 订阅插件自身的目录/配置（`notify()` 是唯一信号）。 */
  function usePluginTick(): number {
    const [tick, setTick] = useState(0)
    useEffect(() => {
      const bump = () => setTick((n: number) => n + 1)
      listeners.add(bump)
      if (view === null) void loadCatalog()
      if (config === null) void loadConfig()
      return () => {
        listeners.delete(bump)
      }
    }, [])
    return tick
  }

  /** 订阅宿主目录快照（当前模型、待切换、失败原因都由它给）。 */
  function useDirectory(directory: SlotDirectory | undefined): any {
    const [state, setState] = useState<any>(() => (directory === undefined ? null : directory.getSnapshot?.() ?? null))
    useEffect(() => {
      if (directory === undefined) {
        setState(null)
        return undefined
      }
      const read = () => setState(directory.getSnapshot?.() ?? null)
      read()
      return directory.subscribe(read)
    }, [directory])
    return state
  }

  function ModelAutoSelectTrigger(props: any) {
    usePluginTick()
    const directory = props?.directory as SlotDirectory | undefined
    const state = useDirectory(directory)
    const locked = props?.locked === true
    const available = props?.available !== false

    // 下拉的开关与搜索词放在模块级变量里，并直接操作 DOM：
    // 宿主渲染器重建 slot 组件时 React 会丢掉 hooks 状态（实测 setState 后组件不重渲染），
    // 所以这里不靠 React 状态来开合下拉，保证「点了就有反应」。
    const groups = slotOpen ? menuGroups() : []
    const needle = slotQuery.trim().toLowerCase()
    const shown = groups
      .map((group) => ({
        ...group,
        rows: needle === '' ? group.rows : group.rows.filter((row) => rowHaystack(row).includes(needle)),
      }))
      .filter((group) => group.rows.length > 0)
    const totalRows = shown.reduce((sum, group) => sum + group.rows.length, 0)

    // 选模型：走插件自己的 /select 路由。键盘 Enter 与鼠标点击共用这一条。
    slotSelectRef = (provider: string, model: string) => {
      if (typeof props?.select === 'function') {
        const result = props.select({ provider, model })
        if (result !== undefined && typeof result.catch === 'function') result.catch(() => undefined)
      }
      slotOpen = false
      slotQuery = ''
      slotActive = -1
      applySlotOpen()
      notify()
      focusSlotTrigger()
    }

    const choose = (entry: CatalogEntry) => {
      if (slotSelectRef !== null) slotSelectRef(entry.provider, entry.model)
    }

    const current = state?.current
    const currentEntry =
      current === null || current === undefined
        ? undefined
        : entryOf(String(current.provider ?? ''), String(current.model ?? ''))

    const button = createElement(
      'button',
      {
        type: 'button',
        // 重绘后若还欠一次「焦点还给触发按钮」，由新节点自己补上
        ref: (node: any) => {
          // 选完模型会触发多次重绘（/select 返回后还会再刷一次目录），
          // 每次都是新节点，所以窗口期内每个新节点都自己接管一次焦点，
          // 由 focusSlotTrigger 的定时器统一收口（不清标记，避免中途丢焦点）。
          if (node === null || node === undefined) return
          if (!slotFocusPending || slotOpen) return
          if (typeof node.focus === 'function') node.focus()
        },
        'data-mas-slot-trigger': '1',
        'data-mas-session': props?.sessionId ?? '',
        'aria-label': `选择模型，当前 ${currentLabel(current)}${
          currentEntry === undefined ? '' : `，来源 ${currentEntry.providerName}`
        }`,
        'aria-haspopup': 'listbox',
        'aria-expanded': slotOpen,
        title: currentEntry === undefined ? '选择模型' : `${currentEntry.name} · 来源 ${currentEntry.providerName}`,
        disabled: locked || !available,
        onClick: () => {
          slotOpen = !slotOpen
          if (!slotOpen) {
            slotQuery = ''
            slotActive = -1
          }
          applySlotOpen()
          notify()
          if (slotOpen) scheduleSlotRefresh()
        },
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          maxWidth: '240px',
          height: '28px',
          padding: '0 8px',
          border: 'none',
          borderRadius: TOK.radius,
          background: TOK.module,
          color: TOK.primary,
          font: 'inherit',
          fontSize: '13px',
          cursor: locked || !available ? 'not-allowed' : 'pointer',
          opacity: locked || !available ? 0.5 : 1,
        },
      },
      createElement(
        'span',
        { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' } },
        currentLabel(current),
      ),
      createElement('span', { style: { color: TOK.tertiary, fontSize: '11px' }, 'aria-hidden': 'true' }, '▾'),
    )

    const rows = shown.map((group) =>
      createElement(
        'div',
        {
          key: `g-${group.id}`,
          'data-mas-slot-group': group.id,
          style: { display: 'flex', flexDirection: 'column' },
        },
        createElement(
          'div',
          {
            style: {
              position: 'sticky',
              top: '0',
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 8px 4px',
              fontSize: '11px',
              color: TOK.tertiary,
              background: TOK.layer,
              borderBottom: `0.5px solid ${TOK.border}`,
            },
          },
          group.label,
          createElement(
            'span',
            { 'data-mas-group-count': '1', style: { marginLeft: 'auto', fontSize: '11px', color: TOK.tertiary } },
            `${group.rows.length}`,
          ),
        ),
        group.rows.map((row) => {
          const selected = current?.provider === row.provider && current?.model === row.model
          const parts = splitModelName(row.name)
          const pills: any[] = []
          if (row.free) {
            pills.push(
              pillNode(React, view?.config?.freeBadgeLabel ?? '免', '限免模型：计价系数 x0.00（0 = 限时免费）', 'free'),
            )
          } else if (row.priceFactor !== undefined) {
            pills.push(
              pillNode(
                React,
                `x${row.priceFactor.toFixed(2)}`,
                `计价系数 x${row.priceFactor.toFixed(2)}（来自模型名后缀，非 llm 服务字段）`,
                'price',
              ),
            )
          } else if (parts.price !== null) {
            pills.push(pillNode(React, parts.price, '计价系数（来自模型名后缀）', 'price'))
          }
          if (row.contextWindow !== undefined) {
            pills.push(
              pillNode(
                React,
                formatContext(row.contextWindow),
                `上下文窗口：${row.contextWindow.toLocaleString('en-US')} tokens（宿主 llm 服务披露，combined request+response 上限，未披露则不显示）`,
                'meta',
              ),
            )
          }
          return createElement(
            'button',
            {
              key: row.key,
              id: `mas-slot-opt-${row.key.replace(/[^a-zA-Z0-9]+/g, '-')}`,
              type: 'button',
              role: 'option',
              'data-mas-slot-row': `${row.provider}/${row.model}`,
              'data-mas-slot-key': row.key,
              'data-mas-name': rowHaystack(row),
              'data-mas-provider': row.provider,
              'data-mas-selected': selected ? '1' : '0',
              'aria-selected': selected,
              'aria-checked': selected,
              title: `${parts.base} · 来源 ${row.providerName}${parts.price === null ? '' : ` · 计价 ${parts.price}`}`,
              onClick: () => choose(row),
              onMouseEnter: (event: any) => {
                const visible = slotVisibleRows()
                const idx = visible.indexOf(event.currentTarget)
                if (idx >= 0 && idx !== slotActive) {
                  slotActive = idx
                  applySlotNav()
                }
              },
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                width: '100%',
                height: '30px',
                padding: '0 6px 0 4px',
                border: 'none',
                borderRadius: '6px',
                background: selected ? TOK.module : 'transparent',
                boxShadow: selected ? `inset 2px 0 0 ${TOK.primary}` : 'none',
                color: TOK.primary,
                font: 'inherit',
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'left',
              },
            },
            createElement(
              'span',
              {
                'aria-hidden': 'true',
                title: row.modalities.join('、'),
                style: {
                  flex: '0 0 auto',
                  width: '14px',
                  textAlign: 'center',
                  fontSize: '10px',
                  color: TOK.tertiary,
                },
              },
              row.kind === 'multimodal' ? '图' : '文',
            ),
            createElement(
              'span',
              {
                style: {
                  flex: '1 1 auto',
                  minWidth: '0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              parts.base,
            ),
            sourceChip(React, row),
            ...pills,
          )
        }),
      ),
    )

    const empty = createElement(
      'div',
      {
        'data-mas-slot-empty': '1',
        style: {
          display: shown.length === 0 ? 'block' : 'none',
          padding: '14px 10px',
          fontSize: '12px',
          lineHeight: '18px',
          color: TOK.tertiary,
        },
      },
      savedRules().length === 0
        ? '还没有模型目录或全部模型都不可用：先到「模型自动选择」设置页取回模型列表。'
        : '没有任何已入组的模型：先到「模型自动选择」设置页，把模型用「入组」下拉放进分组。',
    )

    const searchBox = createElement(
      'div',
      {
        'data-mas-slot-searchbox': '1',
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          margin: '4px',
          padding: '0 8px',
          height: '30px',
          border: `0.5px solid ${TOK.border}`,
          borderRadius: '6px',
          background: TOK.module,
        },
      },
      createElement('span', {
        'aria-hidden': 'true',
        style: {
          flex: '0 0 auto',
          width: '9px',
          height: '9px',
          border: `1.5px solid ${TOK.tertiary}`,
          borderRadius: '50%',
        },
      }),
      createElement('span', {
        'aria-hidden': 'true',
        style: {
          flex: '0 0 auto',
          width: '5px',
          height: '1.5px',
          background: TOK.tertiary,
          transform: 'rotate(45deg)',
          marginLeft: '-3px',
        },
      }),
      createElement('input', {
        type: 'search',
        'data-mas-slot-search': '1',
        role: 'combobox',
        'aria-label': '搜索模型名、来源或 provider id',
        'aria-autocomplete': 'list',
        'aria-expanded': slotOpen,
        'aria-controls': 'mas-slot-listbox',
        value: slotQuery,
        placeholder: '搜索模型名 / 来源',
        onInput: (event: any) => {
          slotQuery = String(event.target.value ?? '')
          applySlotFilter()
        },
        style: {
          flex: '1 1 auto',
          minWidth: '0',
          height: '26px',
          padding: '0',
          border: 'none',
          background: 'transparent',
          color: TOK.primary,
          font: 'inherit',
          fontSize: '12px',
          outline: 'none',
        },
      }),
    )

    const list = createElement(
      'div',
      {
        id: 'mas-slot-listbox',
        'data-mas-slot-list': '1',
        role: 'listbox',
        'aria-label': '模型列表',
        style: {
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          minHeight: '0',
          overflowY: 'auto',
          padding: '0 2px',
        },
      },
      empty,
      ...rows,
    )

    const foot = createElement(
      'div',
      {
        'data-mas-slot-foot': '1',
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 8px 2px',
          marginTop: '4px',
          borderTop: `0.5px solid ${TOK.border}`,
        },
      },
      createElement(
        'span',
        {
          style: {
            flex: '1 1 auto',
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '11px',
            color: TOK.tertiary,
          },
        },
        '↑↓ 选择 · ↵ 确认 · Esc 关闭',
      ),
      createElement(
        'span',
        {
          'data-mas-slot-count': '1',
          style: { flex: '0 0 auto', fontSize: '11px', color: TOK.tertiary },
        },
        `${totalRows} 个模型`,
      ),
    )

    const panel = createElement(
      'div',
      {
        ref: (node: any) => {
          slotPanelRef = node ?? null
          if (node !== null && node !== undefined) {
            node.style.display = slotOpen ? 'flex' : 'none'
            if (slotOpen) fitSlotPanel()
          }
        },
        'data-mas-slot-menu': '1',
        style: {
          position: 'absolute',
          // 不在这里写死宽高/上下/左右：每次重渲染 React 会把它们重置回去，
          // 与 fitSlotPanel 的容器感知计算打架。尺寸与定位完全交给 fitSlotPanel。
          zIndex: 3,
          display: slotOpen ? 'flex' : 'none',
          flexDirection: 'column',
          maxWidth: '100vw',
          boxSizing: 'border-box',
          padding: '4px',
          overflow: 'hidden',
          borderRadius: TOK.radius,
          border: `0.5px solid ${TOK.border}`,
          background: TOK.layer,
          boxShadow: '0 12px 28px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
        },
      },
      searchBox,
      list,
      foot,
    )

    return createElement('div', { style: { position: 'relative', display: 'inline-flex' } }, button, panel)
  }

  // 视口/布局/缩放变化都重新贴合边界：窗口缩小、开右侧栏、浏览器缩放后，
  // 面板都要重新算，否则会顶出容器、撑出滚动条。只挂一次，避免重复叠加。
  if (!slotListenersAttached) {
    slotListenersAttached = true
    const onViewportChange = () => {
      if (slotOpen) fitSlotPanel()
    }
    window.addEventListener('resize', onViewportChange)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportChange)
      window.visualViewport.addEventListener('scroll', onViewportChange)
    }
    document.addEventListener('scroll', onViewportChange, true)
  }

  // 常驻监听：点外面关、Esc 关、↑↓ / Home / End / Enter 键盘导航。
  document.addEventListener(
    'mousedown',
    (event: any) => {
      if (!slotOpen) return
      const panel = slotPanelRef as any
      if (panel !== null && panel !== undefined && typeof panel.contains === 'function' && panel.contains(event.target)) return
      const trigger = document.querySelector('[data-mas-slot-trigger]')
      if (trigger !== null && trigger.contains(event.target)) return
      closeSlot(false)
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event: any) => {
      if (!slotOpen) return
      const key = String(event.key ?? '')
      if (key === 'Escape') {
        event.preventDefault()
        closeSlot(true)
        return
      }
      const panel = slotPanelRef as any
      const inside =
        panel !== null && panel !== undefined && typeof panel.contains === 'function' && panel.contains(event.target)
      if (!inside) return
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
        event.preventDefault()
        if (key === 'ArrowDown') moveSlotActive(1)
        else if (key === 'ArrowUp') moveSlotActive(-1)
        else {
          const visible = slotVisibleRows()
          slotActive = key === 'Home' ? (visible.length === 0 ? -1 : 0) : visible.length - 1
          applySlotNav()
        }
        return
      }
      if (key === 'Enter') {
        const row = activeSlotRow()
        if (row === null) return
        event.preventDefault()
        const composite = row.getAttribute('data-mas-slot-key') ?? ''
        const at = composite.indexOf(KEY_SEP)
        if (at < 0 || slotSelectRef === null) return
        slotSelectRef(composite.slice(0, at), composite.slice(at + 1))
      }
    },
    true,
  )

  slots.inject(MODEL_SLOT, () =>
    slots.register(
      {
        name: MODEL_SLOT,
        // 宿主在 priority 0 注册；single 槽同 priority 会直接抛错，必须给更小的值才能 shadow
        // （宿主文档原文：register at a different priority to shadow it, lowest renders）。
        priority: -1,
        // 不用宿主 `modelDirectories`：动态门面按 inject 声明做服务门禁，而 `directoryFor()`
        // 内部还要读 `remote.session`，实测会抛 `cannot get property "remote.session" without inject`。
        // 所以这里自带一个轻量 store（当前模型来自插件自己的会话状态），选模型走插件 /select 路由。
        inject: (sessionId: string) => ({
          available: true,
          sessionId,
          directory: sessionDirectory(sessionId),
          load: () => {
            void loadCatalog()
          },
          select: (selection: any) => selectViaRoute(sessionId, selection),
        }),
      },
      ModelAutoSelectTrigger,
    ),
  )
  return true
}


/**
 * 挂载并返回卸载函数。
 * 只在「目录或配置真的变了」时重绘：15s 轮询也会 notify，若无条件重绘会把正在输入的表单冲掉。
 */
function mountSettingsForm(host: HTMLElement): () => void {
  let lastSignature: string | null = null
  const render = () => {
    // 签名必须带上状态行：否则保存成功/失败、范围校验这些「只改文案不改数据」的反馈会被防重绘挡掉，
    // 用户看到的就是「点了没反应」。
    const signature = `${config === null ? '∅' : JSON.stringify(config.config)}#${view === null ? '∅' : `${view.entries.length}:${(view.groups ?? []).map((g) => g.id).join(',')}`}#${draft === null ? '∅' : JSON.stringify(draft)}#${modelFilter}:${modelsExpanded}:${advancedOpen}#${statusKind}:${statusText}`
    if (signature === lastSignature && host.childElementCount > 0) return
    lastSignature = signature
    host.textContent = ''
    host.appendChild(buildSettingsForm())
  }
  listeners.add(render)
  render()
  if (config === null) void loadConfig()
  if (view === null) void loadCatalog()
  return () => {
    listeners.delete(render)
  }
}

function registerSettingsSection(ctx: any): boolean {
  const slots = ctx?.slots
  if (slots === undefined || slots === null) return false
  if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return false
  const React = loadReact()
  if (React === null) return false
  slots.inject(SETTINGS_SLOT, () =>
    slots.register(
      {
        name: SETTINGS_SLOT,
        id: SETTINGS_ID,
        order: SETTINGS_ORDER,
        label: () => SETTINGS_LABEL,
      },
      function ModelAutoSelectSection() {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const host = ref.current
          if (host === null || host === undefined) return undefined
          const unmount = mountSettingsForm(host)
          return () => {
            unmount()
            host.textContent = ''
          }
        }, [])
        return React.createElement('div', { ref, style: { padding: '16px 20px 24px' } })
      },
    ),
  )
  return true
}

// ─────────────────────────────── 入口 ───────────────────────────────

export function apply(ctx?: any) {
  if (started) return
  started = true
  void loadCatalog()
  // 配置一起预取：设置页一打开就有内容，不必等用户点开再转圈。
  void loadConfig()
  startObserver()
  scheduleDecorate()
  registerSettingsSection(ctx)
  // 自建模型下拉：宿主下拉按 provider 分组、且未入组模型照样可选，只有抢下这个 single 槽
  // 才能做到「按用户分组展示 + 未入组不出现」。失败时保留 DOM 追加层作为兜底标注。
  try {
    if (!registerModelSelectSlot(ctx)) beacon({ phase: 'slot-register-skipped', step: 'model-select' })
  } catch (err) {
    // 注册失败不能拖垮整个插件：保留 DOM 追加层作为兜底标注，并把原因留在 beacon 里。
    beacon({ phase: 'slot-register-failed', step: 'model-select', note: String((err as Error)?.message ?? err).slice(0, 300) })
  }
  pollTimer = setInterval(() => {
    void loadCatalog()
  }, POLL_MS)
  window.addEventListener('focus', () => {
    void loadCatalog()
  }, { passive: true })
  beacon({ phase: 'mounted', build: BUILD })
}

/** 供宿主或排障脚本读取当前视图（只读）。 */
export function snapshot() {
  return { build: BUILD, view, viewError, config, statusText }
}
