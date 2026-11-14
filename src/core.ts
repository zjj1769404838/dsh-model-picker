/**
 * @zjjlivingfree/dsh-model-picker — 纯判定层
 *
 * 这一层不 import 任何宿主包、不碰 fs / http / cordis，
 * 所有函数都是「输入状态 → 输出决策」，因此可以被测试脚本直接驱动。
 *
 * 判定规则全部落成枚举与数字，不存在「尽可能」「暂时」这类模糊表述：
 *   - 模型类型：inputModalities 含 image/audio/video ⇒ multimodal，否则 text
 *   - 候选顺序：sortKey 四元组整数比较，完全可复现
 *   - 重试额度：attempts <= maxRetries 时重试（attempts 从 1 起算）
 *   - 切换条件：重试额度耗尽 ⇒ 把当前模型加入 excluded，再在同 kind 里取下一个
 *   - 冷却条件：同 kind 候选全部被 excluded 或处于冷却 ⇒ 全局冷却 cooldownMs
 */

export const PLUGIN_NAME = '@zjjlivingfree/dsh-model-picker'
export const PLUGIN_VERSION = '0.1.0'

// ─────────────────────────────── 配置 ───────────────────────────────

export interface AutoSelectConfig {
  /** 用户默认模型；null = 沿用宿主 agentDefaultModel.currentSelection() */
  defaultModel: { provider: string; model: string; reasoningEffort?: string } | null
  /**
   * 按模型预配置的推理等级：[{ key: 'provider/model', effort: 等级 id }]。
   * 选中该模型时（手动下拉选与自动切换重试）都按此附带；配置的 id 已不被该模型
   * 声明时视为失效，回落宿主默认，不报错。
   */
  modelEfforts: Array<{ key: string; effort: string }>
  /** 同一模型最多重试几次（不含首次尝试）。默认 2 ⇒ 单模型最多 3 次尝试。 */
  maxRetries: number
  /** 每次重试 / 切换前的等待毫秒，避免瞬间打满上游。 */
  retryDelayMs: number
  /** provider 优先顺序；未列出的按宿主 listProviders() 顺序排在后面。 */
  providerOrder: string[]
  /** 单模型优先顺序，写成 'provider/model'；未列出的排在后面。 */
  modelOrder: string[]
  /** 自动切换时优先选未被会话使用的模型。 */
  preferIdle: boolean
  /** 全部不可用后的冷却时长（毫秒）。 */
  cooldownMs: number
  /** 冷却期内抑制模型目录刷新（不高频重试）。 */
  cooldownRefreshBlocked: boolean
  /** 模型目录缓存 TTL。 */
  catalogTtlMs: number
  /** 占用状态兜底刷新间隔；事件驱动的即时刷新不受此限制。 */
  occupancyRefreshMs: number
  /** 只在命中这些错误码时切换；空数组 = 除 ABORTED 外全部可切换。 */
  switchOnCodes: string[]
  /** 同类型耗尽后是否允许跨类型兜底。 */
  crossClassFallback: boolean
  /** 总开关；false 时插件只观测不接管。 */
  enabled: boolean
  /**
   * 用户关掉的模型，写成 'provider/model'。命中即视为不可用：
   * 不参与首选、不参与自动切换、也不进入跨类型兜底。
   */
  disabledModels: string[]
  /** 分组级「不参与自动选择」：命中这些分组 id 的模型全部视为不可用。 */
  disabledGroups: string[]
  /**
   * 不在模型下拉里展示的模型，写成 'provider/model'。
   * 落地方式只到「隐藏渲染」——宿主菜单的数据由宿主自己组装，插件改不了它的候选集，
   * 所以这里隐藏的是菜单行（客户端 `display:none`），不影响宿主侧的真实可选性。
   */
  hiddenModels: string[]
  /** 分组级「不在模型下拉里展示」：命中这些分组 id 的模型整组隐藏。 */
  hiddenGroups: string[]
  /** 限免徽标文案；空字符串表示不标。 */
  freeBadgeLabel: string
  /** 面板是否按「多模态 / 纯文本」跨来源分组（false = 按 provider 分组）；customGroups 非空时被它接管。 */
  groupByKind: boolean
  /**
   * 用户自定义分组（按数组顺序优先匹配，先命中先归组）。
   * 非空时完全接管面板分组；留空则回落到 groupByKind 的内置分组。
   */
  customGroups: CustomGroup[]
  /** 分组模式：manual=沿用 customGroups 手工分组；auto=按免费/积分/未知自动分三组（忽略 customGroups 但不清空它，切回 manual 原样恢复）。默认 manual，零改动现有配置。 */
  groupMode: GroupMode
  /** 自动连通性探测间隔（分钟）；0 = 关闭（默认）。设了才按间隔对全部模型跑探测，会真实消耗上游积分。 */
  probeIntervalMin: number
  /**
   * 自动切换的作用域：
   * - `all`：在整个同类型池子里换（旧行为）
   * - `group`：只在当前模型所在分组内换，组内耗尽就进冷却（严格不出组）
   * - `group-cross`：优先组内换，组内耗尽才跨组兜底
   * 当前模型不属于任何分组（或没有任何分组）时三种取值等价，都按全量走。
   */
  switchScope: SwitchScope
}

export type SwitchScope = 'all' | 'group' | 'group-cross'

export const SWITCH_SCOPE_VALUES: SwitchScope[] = ['all', 'group', 'group-cross']

export function normalizeSwitchScope(value: unknown): SwitchScope {
  return typeof value === 'string' && (SWITCH_SCOPE_VALUES as string[]).includes(value) ? (value as SwitchScope) : DEFAULT_CONFIG.switchScope
}

/** 面板分组模式：manual=手工 customGroups；auto=按价格类别自动分三组。 */
export type GroupMode = 'manual' | 'auto'

export const GROUP_MODE_VALUES: GroupMode[] = ['manual', 'auto']

export function normalizeGroupMode(value: unknown): GroupMode {
  return typeof value === 'string' && (GROUP_MODE_VALUES as string[]).includes(value) ? (value as GroupMode) : 'manual'
}

/** 价格类别三态：free / paid / unknown（名字里读不出价格绝不猜）。 */
export type PriceClass = 'free' | 'paid' | 'unknown'

/** 用户自定义分组的一条规则：命中条件全部满足即归入该组。 */
export interface CustomGroup {
  /** 稳定 id，界面排序 / 删除用 */
  id: string
  /** 组标题，空则自动生成 */
  label: string
  /** 类型过滤；null / 缺省 = 不限 */
  kind: ModelKind | null
  /** 来源 provider 白名单；空 = 不限 */
  providers: string[]
  /** 模型名或 provider/model 白名单；空 = 不限 */
  models: string[]
  /** 只收限免模型 */
  freeOnly: boolean
  /**
   * 显式成员模式：只按 `models` 里的名单归组，名单为空就**不命中任何模型**。
   * 设置页里「先建空分组、再逐个勾选模型」需要这个模式 —— 否则一条条件全空的规则
   * 等于「不限」，会把全部模型吞进这一组（`isEmptyGroup` 也会把它当无效条目丢掉）。
   */
  explicit: boolean
}

export const DEFAULT_CONFIG: AutoSelectConfig = Object.freeze({
  defaultModel: null,
  maxRetries: 2,
  retryDelayMs: 800,
  providerOrder: [],
  modelOrder: [],
  preferIdle: true,
  cooldownMs: 30 * 60 * 1000,
  cooldownRefreshBlocked: true,
  catalogTtlMs: 60_000,
  occupancyRefreshMs: 5_000,
  switchOnCodes: [],
  crossClassFallback: false,
  enabled: true,
  disabledModels: [],
  disabledGroups: [],
  hiddenModels: [],
  hiddenGroups: [],
  freeBadgeLabel: '免',
  groupByKind: true,
  customGroups: [],
  groupMode: 'manual',
  probeIntervalMin: 0,
  // 组内优先、组内耗尽才跨组兜底：既不会一上来就在全量池子里乱跳，也不会因为组太小而卡死。
  switchScope: 'group-cross',
  modelEfforts: [],
}) as AutoSelectConfig

function nonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return Math.floor(value)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) if (typeof item === 'string' && item.length > 0) out.push(item)
  return out
}

/**
 * 四类条件（类型 / 来源 / 指定模型 / 仅限免）全空 = 「不限」，会把全部模型吞进同一组。
 * 这种规则没有任何分组意义，一律视为无效条目整条丢弃 —— 否则面板的分组会被一条空规则压成一组。
 */
export function isEmptyGroup(group: {
  kind: ModelKind | null
  providers: string[]
  models: string[]
  freeOnly: boolean
  explicit?: boolean
}): boolean {
  // 显式成员模式的空分组是合法的（用户先建组、再往里加模型），不能当无效条目丢掉
  if (group.explicit === true) return false
  return group.kind === null && group.providers.length === 0 && group.models.length === 0 && !group.freeOnly
}

/** 自定义分组容错：非法条目整条丢弃，字段缺失按「不限」处理，id 去重。 */
export function normalizeCustomGroups(value: unknown): CustomGroup[] {
  if (!Array.isArray(value)) return []
  const out: CustomGroup[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as any
    const id = typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim() : ''
    if (id === '' || seen.has(id)) continue
    const kind = raw.kind === 'text' || raw.kind === 'multimodal' ? raw.kind : null
    const normalized: CustomGroup = {
      id,
      label: typeof raw.label === 'string' ? raw.label.trim() : '',
      kind,
      providers: stringList(raw.providers),
      models: stringList(raw.models),
      freeOnly: raw.freeOnly === true,
      explicit: raw.explicit === true,
    }
    // 空规则先判掉再登记 id，避免一条无效条目把同 id 的有效条目挤掉。
    if (isEmptyGroup(normalized)) continue
    seen.add(id)
    out.push(normalized)
  }
    return out
  }

  /** 按模型预配置推理等级容错：只收 key/effort 均为非空字符串的项，id 去重，非法整条丢。 */
  export function normalizeModelEfforts(value: unknown): Array<{ key: string; effort: string }> {
    if (!Array.isArray(value)) return []
    const out: Array<{ key: string; effort: string }> = []
    const seen = new Set<string>()
    for (const item of value) {
      if (item === null || typeof item !== 'object') continue
      const raw = item as any
      if (typeof raw.key !== 'string' || typeof raw.effort !== 'string') continue
      const key = raw.key.trim()
      if (key.length === 0 || raw.effort.trim().length === 0) continue
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, effort: raw.effort.trim() })
    }
    return out
  }

  /** 把 patch 里可能写错的字段收敛成合法配置；非法值一律回落到默认值。 */
  export function resolveConfig(raw: any): AutoSelectConfig {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const dm = input.defaultModel
  const defaultModel =
    dm !== null && typeof dm === 'object' && typeof dm.provider === 'string' && typeof dm.model === 'string' && dm.provider.length > 0 && dm.model.length > 0
      ? {
          provider: dm.provider,
          model: dm.model,
          ...(typeof dm.reasoningEffort === 'string' && dm.reasoningEffort.length > 0 ? { reasoningEffort: dm.reasoningEffort } : {}),
        }
      : null
  return {
    defaultModel,
    maxRetries: nonNegativeInt(input.maxRetries, DEFAULT_CONFIG.maxRetries),
    retryDelayMs: nonNegativeInt(input.retryDelayMs, DEFAULT_CONFIG.retryDelayMs),
    providerOrder: stringList(input.providerOrder),
    modelOrder: stringList(input.modelOrder),
    preferIdle: input.preferIdle === undefined ? DEFAULT_CONFIG.preferIdle : input.preferIdle !== false,
    cooldownMs: nonNegativeInt(input.cooldownMs, DEFAULT_CONFIG.cooldownMs) || DEFAULT_CONFIG.cooldownMs,
    cooldownRefreshBlocked: input.cooldownRefreshBlocked === undefined ? DEFAULT_CONFIG.cooldownRefreshBlocked : input.cooldownRefreshBlocked !== false,
    catalogTtlMs: nonNegativeInt(input.catalogTtlMs, DEFAULT_CONFIG.catalogTtlMs) || DEFAULT_CONFIG.catalogTtlMs,
    occupancyRefreshMs: nonNegativeInt(input.occupancyRefreshMs, DEFAULT_CONFIG.occupancyRefreshMs) || DEFAULT_CONFIG.occupancyRefreshMs,
    switchOnCodes: stringList(input.switchOnCodes),
    crossClassFallback: input.crossClassFallback === true,
    enabled: input.enabled === undefined ? DEFAULT_CONFIG.enabled : input.enabled !== false,
    disabledModels: stringList(input.disabledModels),
    disabledGroups: stringList(input.disabledGroups),
    hiddenModels: stringList(input.hiddenModels),
    hiddenGroups: stringList(input.hiddenGroups),
    freeBadgeLabel:
      typeof input.freeBadgeLabel === 'string' && input.freeBadgeLabel.trim().length > 0
        ? input.freeBadgeLabel.trim()
        : DEFAULT_CONFIG.freeBadgeLabel,
    groupByKind: input.groupByKind === undefined ? DEFAULT_CONFIG.groupByKind : input.groupByKind !== false,
    customGroups: normalizeCustomGroups(input.customGroups),
    groupMode: normalizeGroupMode(input.groupMode),
    probeIntervalMin: nonNegativeInt(input.probeIntervalMin, DEFAULT_CONFIG.probeIntervalMin),
    switchScope: input.switchScope === undefined ? DEFAULT_CONFIG.switchScope : normalizeSwitchScope(input.switchScope),
    modelEfforts: normalizeModelEfforts(input.modelEfforts),
  }
}

// ─────────────────────────── 模型目录与分类 ───────────────────────────

export type ModelKind = 'text' | 'multimodal'
export type ModalitySource = 'listModels' | 'resolveModelInfo' | 'fallback'

export interface ModelEntry {
  /** 'provider\u0000model'，作为所有映射的稳定键 */
  key: string
  provider: string
  providerName: string
  /** 来源标注：provider 在宿主里的注册信息 */
  providerSettingsNs: string
  model: string
  name: string
  kind: ModelKind
  modalities: string[]
  /** 模态字段来自哪一步查询（可追踪） */
  modalitySource: ModalitySource
  /** 可复现的排序键四元组 */
  sortKey: [number, number, number, number]
  /**
   * 计价系数，来自模型名后缀 `· x0.06`（宿主 llm 服务不暴露价格字段）。
   * undefined = 名字里没有该后缀，不等于免费。
   */
  priceFactor?: number
  /** 价格类别：free=免费/限免，paid=需要积分，unknown=名字里读不出价格（绝不猜测）。 */
  priceClass: PriceClass
  /** 限免判定：仅当 priceClass 明确为 free 时为 true。 */
  free: boolean
  /** 用户是否关掉了这个模型（来自 disabledModels / disabledGroups）。 */
  disabled: boolean
  /** 用户是否把它从模型下拉里隐藏（来自 hiddenModels / hiddenGroups）。 */
  hidden: boolean
  /**
   * 上下文窗口：宿主 llm 服务在模型目录里披露的 combined request+response 上限，
   * 单位 = tokens。仅当宿主披露（when disclosed）才有值；否则为 undefined，绝不猜测。
   */
  contextWindow?: number
  /** 推理等级元数据：仅当宿主 resolveModelInfo 披露（reasoning）才有值；未披露绝不猜测。 */
  reasoning?: { efforts: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string }
}

export interface CatalogFailure {
  provider: string
  name: string
  message: string
}

export interface CatalogSnapshot {
  generatedAt: number
  entries: ModelEntry[]
  failures: CatalogFailure[]
  providerCount: number
}

export function modelKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

export function splitKey(key: string): { provider: string; model: string } {
  const at = key.indexOf('\u0000')
  if (at < 0) return { provider: key, model: '' }
  return { provider: key.slice(0, at), model: key.slice(at + 1) }
}

const MULTIMODAL_MODALITIES = new Set(['image', 'audio', 'video'])

export function normalizeModalities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim().toLowerCase()
    if (id.length === 0 || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * 分类判定：只有 image/audio/video 才算多模态。
 * text-only 模型在宿主里 inputModalities 缺省或只含 'text' —— 两者都归 text。
 */
export function classify(modalities: string[]): ModelKind {
  for (const id of modalities) if (MULTIMODAL_MODALITIES.has(id)) return 'multimodal'
  return 'text'
}

/**
 * 从模型名里读计价系数。
 *
 * 宿主 llm 服务只透传 provider/id/name/description/inputModalities，
 * 不暴露价格字段；第三方 provider（trae / qoder / workbuddy）把
 * creditMultiplier 拼进模型名，形如 `DeepSeek-V4.1-Flash · x0.06`。
 * 因此这里只认「名字里明确的 `x数字` 后缀」，读不到就是 undefined，
 * 绝不把「读不到」当成免费 —— 与 qoder 插件 host 侧
 * `"Free" means creditMultiplier === 0 EXACTLY` 的口径一致。
 */
export function priceFactorOf(name: string): number | undefined {
  const match = /[·・\s]\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(name)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** 限免判定：只有明确的 0 才算限免。 */
export function isFreeName(name: string): boolean {
  return priceFactorOf(name) === 0
}

/**
 * 价格类别归一（零硬编码模型名，只认名字里的价格信号）：
 *   free    —— 明确 x0.00 / 「免费」「限时免费」/「Free now」/「→免费」
 *   paid    —— 明确正系数，或名字里出现 `· x数字`（含降价写法 `· x0.12→x0.06`）
 *   unknown —— 读不出价格。绝不把「读不到」当成免费，也不当成积分。
 */
export function priceClassOf(name: string, priceFactor?: number): PriceClass {
  if (priceFactor === 0 || /免费|free\s*now/i.test(name)) return 'free'
  if ((typeof priceFactor === 'number' && priceFactor > 0) || /[·・\s]\s*x\s*\d/i.test(name)) return 'paid'
  return 'unknown'
}

/** 是否被用户关掉（模型级 `disabledModels`，或所在分组的 `disabledGroups`）。 */
export function isDisabled(provider: string, model: string, cfg: AutoSelectConfig, groups: string[] = []): boolean {
  const key = `${provider}/${model}`
  if (cfg.disabledModels.includes(key)) return true
  if (cfg.disabledGroups.length === 0 || groups.length === 0) return false
  return groups.some((id) => cfg.disabledGroups.includes(id))
}

/**
 * 是否被用户隐藏（模型级 `hiddenModels`，或所在分组的 `hiddenGroups`）。
 * 只影响「下拉里画不画」，不影响自动选择（那条由 `isDisabled` 决定）。
 */
export function isHidden(provider: string, model: string, cfg: AutoSelectConfig, groups: string[] = []): boolean {
  const key = `${provider}/${model}`
  if (cfg.hiddenModels.includes(key)) return true
  if (cfg.hiddenGroups.length === 0 || groups.length === 0) return false
  return groups.some((id) => cfg.hiddenGroups.includes(id))
}

/**
 * 是否「没入组」。
 *
 * 用户口径（m04856）：先新建分组，再到模型列表里把模型选进组；**没入组的模型默认不可用、
 * 也不在模型下拉里展示**。所以只要用户建过分组（`customGroups` 非空），任何一条规则都没命中的
 * 模型就同时算 disabled 与 hidden。
 *
 * 反向兼容：`customGroups` 为空时一律视为「已入组」——用户没建组就还是 dsh 原生的全量可用，
 * 否则升级到本版本会让所有人一进来就没模型可用。
 */
export function isUnassigned(entry: ModelEntry, cfg: AutoSelectConfig): boolean {
  // auto 分组模式下 customGroups 不生效，所有模型都已归入自动三组，绝不判为「未入组」。
  if (cfg.groupMode === 'auto') return false
  if (cfg.customGroups.length === 0) return false
  return !cfg.customGroups.some((rule) => matchesGroup(entry, rule))
}

/** 某个模型归属的分组 id 列表（分组 → 模型的落点，供 `disabledGroups` / `hiddenGroups` 反查）。 */
export function groupsOf(entries: ModelEntry[], cfg: AutoSelectConfig): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const group of groupCatalog(entries, cfg)) {
    for (const entry of group.entries) {
      const list = out.get(entry.key)
      if (list === undefined) out.set(entry.key, [group.id])
      else list.push(group.id)
    }
  }
  return out
}

/** 排序键：provider 优先表 → 模型优先表 → 宿主 provider 序 → 宿主模型序。 */export function sortKeyOf(
  provider: string,
  model: string,
  providerIndex: number,
  modelIndex: number,
  cfg: AutoSelectConfig,
): [number, number, number, number] {
  const pAt = cfg.providerOrder.indexOf(provider)
  const mAt = cfg.modelOrder.indexOf(`${provider}/${model}`)
  const pRank = pAt >= 0 ? pAt : cfg.providerOrder.length + providerIndex
  const mRank = mAt >= 0 ? mAt : cfg.modelOrder.length + modelIndex
  return [pRank, mRank, providerIndex, modelIndex]
}

export function compareSortKey(a: ModelEntry, b: ModelEntry): number {
  for (let i = 0; i < 4; i += 1) {
    const delta = a.sortKey[i] - b.sortKey[i]
    if (delta !== 0) return delta
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** 按 sortKey 排序后的副本（不原地改输入）。 */
export function ordered(entries: ModelEntry[]): ModelEntry[] {
  return [...entries].sort(compareSortKey)
}

export function byKind(entries: ModelEntry[], kind: ModelKind): ModelEntry[] {
  return entries.filter((entry) => entry.kind === kind)
}

export function indexByKey(entries: ModelEntry[]): Map<string, ModelEntry> {
  const map = new Map<string, ModelEntry>()
  for (const entry of entries) map.set(entry.key, entry)
  return map
}

// ───────────────────────────── 会话占用 ─────────────────────────────

export interface AgentFact {
  sessionId: string
  /** 该会话当前选中的模型键；null = 尚未选定 */
  key: string | null
  status: 'idle' | 'running'
}

export interface OccupancyEntry {
  key: string
  /** 正在使用该模型的会话 id（升序，便于日志复现） */
  owners: string[]
  inUse: boolean
  running: boolean
}

export type OccupancyMap = Record<string, OccupancyEntry>

/**
 * 占用判定（可判定的定义）：
 *   inUse = 存在 live 会话的当前选择指向该模型。
 *   running = 上述会话中至少一个 status === 'running'。
 * 「空闲」= inUse === false。
 */
export function computeOccupancy(agents: AgentFact[]): OccupancyMap {
  const owners = new Map<string, string[]>()
  const running = new Set<string>()
  for (const agent of agents) {
    if (agent.key === null) continue
    const list = owners.get(agent.key) ?? []
    if (!list.includes(agent.sessionId)) list.push(agent.sessionId)
    owners.set(agent.key, list)
    if (agent.status === 'running') running.add(agent.key)
  }
  const map: OccupancyMap = {}
  for (const [key, list] of owners) {
    map[key] = { key, owners: [...list].sort(), inUse: true, running: running.has(key) }
  }
  return map
}

export function occupancyOf(map: OccupancyMap, key: string): OccupancyEntry {
  return map[key] ?? { key, owners: [], inUse: false, running: false }
}

// ───────────────────────────── 冷却状态 ─────────────────────────────

export interface CooldownState {
  /** 全局冷却到期时间戳；0 = 未冷却 */
  until: number
  reason: string
  enteredAt: number
}

export function cooldownActive(state: CooldownState, now: number): boolean {
  return state.until > now
}

export function cooldownRemaining(state: CooldownState, now: number): number {
  return Math.max(0, state.until - now)
}

// ─────────────────────────────── 选择 ───────────────────────────────

export type ReasonCode =
  | 'preferred'
  | 'preferred-busy'
  | 'fallback-idle'
  | 'fallback-order'
  | 'cross-group'
  | 'cross-class'
  | 'no-candidate'
  | 'cooldown'

export interface SelectRequest {
  catalog: CatalogSnapshot
  kind: ModelKind
  /** 用户默认 / 当前选中的模型键；null = 没有偏好 */
  preferredKey: string | null
  occupancy: OccupancyMap
  /** 本会话已判失败、不再选的模型键 */
  excluded: string[]
  /** 正在冷却中的模型键 → 到期时间戳 */
  modelCooldown: Record<string, number>
  now: number
  cfg: AutoSelectConfig
  /**
   * 切换作用域的分组 id 集合：调用方用「当前模型 / 首选模型所属分组」反查得到。
   * 空数组或缺省 = 没有作用域（等价于全量），此时 `switchScope` 不生效。
   */
  scopeGroups?: string[]
  /** 最近一次连通性探测判为不可用的模型键（NUL 形）。选择/切换时跳过，重测通过自动移出。 */
  probeUnavailable?: string[]
}

export interface Selection {
  key: string
  provider: string
  model: string
  name: string
  kind: ModelKind
  reasonCode: ReasonCode
  /** 人类可读的判定说明，进日志 */
  reason: string
  orderIndex: number
  idle: boolean
  owners: string[]
  /** 手动选择时指定的推理等级 id（须为该模型声明过的 effort）；仅本次选择生效。 */
  reasoningEffort?: string
}

function selectionOf(entry: ModelEntry, reasonCode: ReasonCode, reason: string, orderIndex: number, occupancy: OccupancyMap): Selection {
  const occ = occupancyOf(occupancy, entry.key)
  return {
    key: entry.key,
    provider: entry.provider,
    model: entry.model,
    name: entry.name,
    kind: entry.kind,
    reasonCode,
    reason,
    orderIndex,
    idle: !occ.inUse,
    owners: occ.owners,
  }
}

function unavailable(entry: ModelEntry, excluded: string[], modelCooldown: Record<string, number>, now: number, probeUnavailable: string[] = []): boolean {
  // 用户关掉的模型等同于不可用：不参与首选、不参与自动切换、不参与跨类型兜底
  if (entry.disabled) return true
  // 单独隐藏（hiddenModels/hiddenGroups）只影响展示，但用户明确要求「不展示的也不可自动被选中」，
  // 所以这里一并挡掉：隐藏的模型不进候选池、不做首选、不做跨组兜底。
  if (entry.hidden) return true
  // 最近一次真实探测判为不可调：等价于暂时不可用，重测通过（set 里删掉）自动恢复。
  if (probeUnavailable.includes(entry.key)) return true
  if (excluded.includes(entry.key)) return true
  const until = modelCooldown[entry.key]
  return typeof until === 'number' && until > now
}

/**
 * 反查某个模型所属的分组 id（面板分组口径：`groupCatalog` 先命中先归组）。
 * 拿不到 key 或目录里没这个模型时返回空数组 ⇒ 调用方按全量作用域走。
 */
export function scopeGroupsOf(entries: ModelEntry[], key: string | null, cfg: AutoSelectConfig): string[] {
  if (key === null || key.length === 0) return []
  const map = groupsOf(entries, cfg)
  return map.get(key) ?? []
}

/**
 * 按 `switchScope` 把候选条目收窄到「当前分组」。
 * 返回 `applied=false` 表示没有真正收窄（作用域=all / 没有作用域 / 分组里一个模型都没有），
 * 此时调用方按全量池子走，行为与旧版本一致。
 */
function scopedEntries(
  entries: ModelEntry[],
  cfg: AutoSelectConfig,
  scopeGroups: string[] | undefined,
): { entries: ModelEntry[]; applied: boolean; scopeKeys: Set<string> } {
  if (cfg.switchScope === 'all' || scopeGroups === undefined || scopeGroups.length === 0) {
    return { entries, applied: false, scopeKeys: new Set() }
  }
  const wanted = new Set(scopeGroups)
  const groups = groupCatalog(entries, cfg)
  const picked: ModelEntry[] = []
  for (const group of groups) {
    if (!wanted.has(group.id)) continue
    for (const entry of group.entries) picked.push(entry)
  }
  if (picked.length === 0) return { entries, applied: false, scopeKeys: new Set() }
  return { entries: picked, applied: true, scopeKeys: new Set(picked.map((entry) => entry.key)) }
}

/**
 * 选择规则（顺序固定，先命中先返回）：
 *  1. 首选模型可用 ⇒ preferred（占用不影响首选：用户显式选择的优先级最高；也不受分组作用域限制）
 *  2. 同 kind 候选中筛掉 excluded / 冷却中；switchScope 非 all 时候选池先收窄到当前分组
 *  3. preferIdle 且存在空闲候选 ⇒ 取排序最靠前的空闲（fallback-idle）
 *  4. 全部在用 ⇒ 取排序最靠前的（fallback-order），并记录 owners
 *  5. 组内耗尽且 switchScope=group-cross ⇒ 跨组兜底（cross-group）；否则无选择（调用方进入冷却）
 */
export function selectModel(request: SelectRequest): Selection | null {
  const { catalog, kind, preferredKey, occupancy, excluded, modelCooldown, now, cfg, probeUnavailable } = request
  const all = ordered(byKind(catalog.entries, kind))
  const scoped = scopedEntries(catalog.entries, cfg, request.scopeGroups)
  const pool = scoped.applied ? ordered(byKind(scoped.entries, kind)) : all
  const poolMap = indexByKey(pool)
  const allMap = indexByKey(all)

  if (preferredKey !== null) {
    // 首选在「全量」里查：用户显式选定的模型不因为落在别的分组里就被丢掉。
    const preferred = allMap.get(preferredKey) ?? poolMap.get(preferredKey)
    if (preferred !== undefined && !unavailable(preferred, excluded, modelCooldown, now, probeUnavailable)) {
      const index = all.indexOf(preferred)
      const occ = occupancyOf(occupancy, preferred.key)
      return selectionOf(
        preferred,
        occ.inUse ? 'preferred-busy' : 'preferred',
        occ.inUse ? `首选模型被会话 ${occ.owners.join(',')} 占用，但用户显式选择优先` : '用户默认模型',
        index,
        occupancy,
      )
    }
  }

  const candidates = pool.filter((entry) => !unavailable(entry, excluded, modelCooldown, now, probeUnavailable))
  if (candidates.length > 0) {
    const scopeNote = scoped.applied ? `组内（${(request.scopeGroups ?? []).join(',')}）` : '同类型'
    if (cfg.preferIdle) {
      const idle = candidates.find((entry) => !occupancyOf(occupancy, entry.key).inUse)
      if (idle !== undefined) {
        return selectionOf(
          idle,
          'fallback-idle',
          `${scopeNote}空闲候选按序取第 ${pool.indexOf(idle) + 1} 个`,
          all.indexOf(idle),
          occupancy,
        )
      }
    }
    const first = candidates[0]
    const occ = occupancyOf(occupancy, first.key)
    return selectionOf(
      first,
      'fallback-order',
      cfg.preferIdle
        ? `${scopeNote}候选全部被占用（${occ.owners.join(',')}），按既定顺序取第 ${pool.indexOf(first) + 1} 个`
        : `${scopeNote}按既定顺序取第 ${pool.indexOf(first) + 1} 个`,
      all.indexOf(first),
      occupancy,
    )
  }

  // 组内耗尽：只有 group-cross 才允许跨组兜底，group（严格不出组）在这里返回 null 进冷却。
  if (scoped.applied && cfg.switchScope === 'group-cross') {
    const rest = all.filter((entry) => !scoped.scopeKeys.has(entry.key))
    const restCandidates = rest.filter((entry) => !unavailable(entry, excluded, modelCooldown, now, probeUnavailable))
    const pick = cfg.preferIdle
      ? restCandidates.find((entry) => !occupancyOf(occupancy, entry.key).inUse) ?? restCandidates[0]
      : restCandidates[0]
    if (pick !== undefined) {
      return selectionOf(
        pick,
        'cross-group',
        `组内（${(request.scopeGroups ?? []).join(',')}）候选耗尽，跨组兜底取 ${pick.provider}/${pick.model}`,
        all.indexOf(pick),
        occupancy,
      )
    }
  }

  return null
}

/** 跨类型兜底：另一类型里是否存在可用候选（仅在 crossClassFallback 打开时用）。 */
export function selectCrossClass(request: SelectRequest): Selection | null {
  const other: ModelKind = request.kind === 'text' ? 'multimodal' : 'text'
  // 跨类型是「另一套池子」，分组作用域对它不成立（分组 id 与 kind 并非一一对应），显式清空。
  const picked = selectModel({ ...request, kind: other, preferredKey: null, scopeGroups: [] })
  if (picked === null) return null
  return { ...picked, reasonCode: 'cross-class', reason: `同类型已耗尽，跨类型兜底（${other}）：${picked.reason}` }
}

/**
 * 某一类型的池子统计，用来区分「候选被用户关光了」与「候选真的都失败了」。
 * 前者是配置问题（不该进冷却），后者才是故障（该进冷却）。
 */
export function poolStats(
  catalog: CatalogSnapshot,
  kind: ModelKind,
  excluded: string[],
  modelCooldown: Record<string, number>,
  now: number,
  probeUnavailable: string[] = [],
): { total: number; disabled: number; excluded: number; cooling: number; usable: number } {
  const pool = byKind(catalog.entries, kind)
  let disabled = 0
  let excludedCount = 0
  let cooling = 0
  let usable = 0
  for (const entry of pool) {
    if (entry.disabled || probeUnavailable.includes(entry.key)) {
      disabled += 1
      continue
    }
    if (excluded.includes(entry.key)) {
      excludedCount += 1
      continue
    }
    const until = modelCooldown[entry.key]
    if (typeof until === 'number' && until > now) {
      cooling += 1
      continue
    }
    usable += 1
  }
  return { total: pool.length, disabled, excluded: excludedCount, cooling, usable }
}

// ─────────────────────── 面板分组（跨来源按类型） ───────────────────────

export interface CatalogGroup {
  /** 分组键：自定义分组用规则 id；内置分组用 'text' / 'multimodal' / provider id */
  id: string
  label: string
  kind: ModelKind | null
  /** 是否由用户自定义规则产生（界面据此显示「自定义」并可删改） */
  custom: boolean
  entries: ModelEntry[]
}

const KIND_LABEL: Record<ModelKind, string> = { text: '纯文本', multimodal: '多模态' }

/** 一条自定义规则是否命中某个模型：全部条件都必须满足（空条件 = 不限）。 */
export function matchesGroup(entry: ModelEntry, group: CustomGroup): boolean {
  // 显式成员模式：只认名单，名单为空则谁都不命中（空组先建、后填成员）
  if (group.explicit) {
    const full = `${entry.provider}/${entry.model}`
    return group.models.includes(full) || group.models.includes(entry.model)
  }
  if (group.kind !== null && entry.kind !== group.kind) return false
  if (group.providers.length > 0 && !group.providers.includes(entry.provider)) return false
  if (group.freeOnly && !entry.free) return false
  if (group.models.length > 0) {
    const full = `${entry.provider}/${entry.model}`
    if (!group.models.includes(full) && !group.models.includes(entry.model)) return false
  }
  return true
}

/** 规则没写标题时自动拼一个，便于界面直接显示。 */
function autoLabel(group: CustomGroup, count: number): string {
  if (group.label.length > 0) return `${group.label} · ${count}`
  if (group.explicit) return `指定模型 · ${count}`
  const parts: string[] = []
  if (group.kind !== null) parts.push(KIND_LABEL[group.kind])
  if (group.providers.length > 0) parts.push(group.providers.join('/'))
  if (group.freeOnly) parts.push('限免')
  if (group.models.length > 0) parts.push(`${group.models.length} 个指定模型`)
  return `${parts.length > 0 ? parts.join(' · ') : '自定义'} · ${count}`
}

/**
 * 把目录分成「界面直接可渲染」的分组。优先级：
 *   1. customGroups 非空 ⇒ 用户自定义规则接管：按数组顺序先命中先归组，
 *      没被任何规则命中的落到末尾「其他」组（不丢模型）
 *   2. groupByKind=true（默认）⇒ 所有来源的多模态一组、纯文本一组
 *   3. 否则按 provider 分组
 * 组内一律按 sortKey 排，因此跨来源但顺序可复现。
 */
export function groupCatalog(entries: ModelEntry[], cfg: AutoSelectConfig): CatalogGroup[] {
  const sorted = ordered(entries)

  // auto 模式：按价格类别自动生成三组，完全忽略 customGroups（但不清空它，切回 manual 原样恢复）。
  // 价格读不出的进「未知」组，绝不猜测成免费或积分。
  if (cfg.groupMode === 'auto') {
    const groups: CatalogGroup[] = []
    for (const [id, label, cls] of [
      ['auto-free', '免费', 'free'],
      ['auto-paid', '积分', 'paid'],
      ['auto-unknown', '未知', 'unknown'],
    ] as Array<[string, string, PriceClass]>) {
      const bucket = sorted.filter((entry) => (entry.priceClass ?? priceClassOf(entry.name, entry.priceFactor)) === cls)
      if (bucket.length === 0) continue
      groups.push({ id, label: `${label} · ${bucket.length}`, kind: null, custom: false, entries: bucket })
    }
    return groups
  }

  if (cfg.customGroups.length > 0) {
    const claimed = new Set<string>()
    const groups: CatalogGroup[] = []
    for (const rule of cfg.customGroups) {
      const bucket = sorted.filter((entry) => !claimed.has(entry.key) && matchesGroup(entry, rule))
      if (bucket.length === 0) continue
      for (const entry of bucket) claimed.add(entry.key)
      groups.push({ id: rule.id, label: autoLabel(rule, bucket.length), kind: rule.kind, custom: true, entries: bucket })
    }
    const rest = sorted.filter((entry) => !claimed.has(entry.key))
    if (rest.length > 0) groups.push({ id: '__rest__', label: `其他 · ${rest.length}`, kind: null, custom: false, entries: rest })
    return groups
  }

  if (cfg.groupByKind) {
    const groups: CatalogGroup[] = []
    for (const kind of ['multimodal', 'text'] as ModelKind[]) {
      const bucket = sorted.filter((entry) => entry.kind === kind)
      if (bucket.length === 0) continue
      groups.push({ id: kind, label: `${KIND_LABEL[kind]} · ${bucket.length}`, kind, custom: false, entries: bucket })
    }
    return groups
  }
  const byProvider = new Map<string, ModelEntry[]>()
  for (const entry of sorted) {
    const bucket = byProvider.get(entry.provider)
    if (bucket === undefined) byProvider.set(entry.provider, [entry])
    else bucket.push(entry)
  }
  return [...byProvider.entries()].map(([provider, bucket]) => ({
    id: provider,
    label: bucket[0]?.providerName ?? provider,
    kind: null,
    custom: false,
    entries: bucket,
  }))
}

/** 行内徽标：类型单字 + 限免短词。UI 与测试共用同一套判定。 */
export function badgeOf(entry: ModelEntry, cfg: AutoSelectConfig): { kindGlyph: string; free: string | null } {
  return {
    kindGlyph: entry.kind === 'multimodal' ? '图' : '文',
    free: entry.free ? cfg.freeBadgeLabel : null,
  }
}

// ───────────────────────── 会话内的重试 / 切换状态 ─────────────────────────

export interface SessionState {
  sessionId: string
  /** 进入会话时按规则选定的类型与模型 */
  kind: ModelKind
  current: Selection | null
  /** 当前模型已尝试次数，首次尝试后为 1 */
  attempts: number
  /** 当前模型已消耗的重试次数 */
  retriesUsed: number
  /** 本会话累计切换次数 */
  switches: number
  /** 本会话内已判失败、不再选的模型键 */
  excluded: string[]
  createdAt: number
  updatedAt: number
}

export function newSessionState(sessionId: string, kind: ModelKind, current: Selection | null, now: number): SessionState {
  return {
    sessionId,
    kind,
    current,
    attempts: 0,
    retriesUsed: 0,
    switches: 0,
    excluded: [],
    createdAt: now,
    updatedAt: now,
  }
}

export type ErrorAction =
  | { action: 'retry'; delayMs: number; reasonCode: 'retry'; reason: string; attempts: number; retriesUsed: number }
  | { action: 'switch'; delayMs: number; next: Selection; reasonCode: 'switch-idle' | 'switch-order' | 'switch-cross-group' | 'switch-cross-class'; reason: string }
  | { action: 'cooldown'; reasonCode: 'cooldown'; reason: string; cooldownUntil: number }
  | { action: 'giveup'; reasonCode: 'aborted' | 'disabled' | 'cooldown-active' | 'non-switchable' | 'no-candidate'; reason: string }

export interface ErrorRequest {
  state: SessionState
  failureCode: string
  failureMessage: string
  aborted: boolean
  catalog: CatalogSnapshot
  occupancy: OccupancyMap
  modelCooldown: Record<string, number>
  cooldown: CooldownState
  now: number
  cfg: AutoSelectConfig
  /** 当前模型所属分组 id（切换作用域）；缺省 = 全量，行为与旧版一致。 */
  scopeGroups?: string[]
  /** 最近一次连通性探测判为不可用的模型键（与 SelectRequest 同形）。 */
  probeUnavailable?: string[]
}

/**
 * 出错后的状态机（顺序固定）：
 *  1. 已 abort / 插件关闭 ⇒ giveup
 *  2. 全局冷却中 ⇒ giveup（冷却期内不高频重试）
 *  3. 错误码不在 switchOnCodes（且列表非空）⇒ giveup（交给宿主 llm-retry）
 *  4. attempts <= maxRetries ⇒ retry（消耗一次额度，等 retryDelayMs）
 *  5. 否则把当前模型加入 excluded，在同 kind 里选下一个 ⇒ switch
 *  6. 同 kind 无候选 ⇒ 打开 crossClassFallback 时跨类型；否则 cooldown
 */
export function decideOnError(request: ErrorRequest): ErrorAction {
  const { state, failureCode, aborted, catalog, occupancy, modelCooldown, cooldown, now, cfg } = request

  if (aborted || failureCode === 'ABORTED') {
    return { action: 'giveup', reasonCode: 'aborted', reason: `请求被中止（${failureCode}），不计入重试也不切换` }
  }
  if (!cfg.enabled) {
    return { action: 'giveup', reasonCode: 'disabled', reason: '插件已关闭（enabled=false），交回宿主默认逻辑' }
  }
  if (cooldownActive(cooldown, now)) {
    return {
      action: 'giveup',
      reasonCode: 'cooldown-active',
      reason: `全局冷却中，剩余 ${cooldownRemaining(cooldown, now)}ms，不重试不切换`,
    }
  }
  if (cfg.switchOnCodes.length > 0 && !cfg.switchOnCodes.includes(failureCode)) {
    return {
      action: 'giveup',
      reasonCode: 'non-switchable',
      reason: `错误码 ${failureCode} 不在 switchOnCodes 白名单内，交回宿主 llm-retry`,
    }
  }

  // 重试额度按「已消耗的重试次数」算：retriesUsed < maxRetries 才能再重试。
  // maxRetries=2 ⇒ 单模型最多 3 次尝试（1 次首发 + 2 次重试）。
  if (state.retriesUsed < cfg.maxRetries) {
    const retriesUsed = state.retriesUsed + 1
    return {
      action: 'retry',
      delayMs: cfg.retryDelayMs,
      reasonCode: 'retry',
      reason: `同一模型重试 ${retriesUsed}/${cfg.maxRetries}（失败码 ${failureCode}）`,
      attempts: state.attempts + 1,
      retriesUsed,
    }
  }

  const excluded = state.current === null ? state.excluded : [...state.excluded, state.current.key]
  const base: SelectRequest = {
    catalog,
    kind: state.kind,
    preferredKey: null,
    occupancy,
    excluded,
    modelCooldown,
    now,
    cfg,
    scopeGroups: request.scopeGroups,
    probeUnavailable: request.probeUnavailable,
  }
  const next = selectModel(base)
  if (next !== null) {
    const code =
      next.reasonCode === 'cross-group'
        ? 'switch-cross-group'
        : next.reasonCode === 'fallback-idle' || next.reasonCode === 'preferred'
          ? 'switch-idle'
          : 'switch-order'
    return {
      action: 'switch',
      delayMs: cfg.retryDelayMs,
      next,
      reasonCode: code,
      reason: `重试额度已用尽（maxRetries=${cfg.maxRetries}），切换到模型 ${next.provider}/${next.model}：${next.reason}`,
    }
  }
  if (cfg.crossClassFallback) {
    const cross = selectCrossClass(base)
    if (cross !== null) {
      return {
        action: 'switch',
        delayMs: cfg.retryDelayMs,
        next: cross,
        reasonCode: 'switch-cross-class',
        reason: cross.reason,
      }
    }
  }
  // 区分两种「没候选」：全被用户关掉 = 配置问题，不该进冷却（冷却也等不到候选）；
  // 否则才是故障，按需求进入冷却。
  const stats = poolStats(catalog, state.kind, excluded, modelCooldown, now, request.probeUnavailable)
  if (stats.total > 0 && stats.disabled === stats.total) {
    return {
      action: 'giveup',
      reasonCode: 'all-disabled',
      reason: `同类型（${state.kind}）${stats.total} 个模型全部不可用（disabledModels / 探测判不可用），不进冷却（冷却等不到候选），交回宿主`,
    }
  }
  return {
    action: 'cooldown',
    reasonCode: 'cooldown',
    reason:
      `同类型（${state.kind}）候选全部不可用：total=${stats.total} disabled=${stats.disabled} ` +
      `excluded=${stats.excluded} cooling=${stats.cooling}，进入冷却 ${cfg.cooldownMs}ms`,
    cooldownUntil: now + cfg.cooldownMs,
  }
}

// ─────────────────────────────── 日志 ───────────────────────────────

export type LogEvent =
  | 'catalog'
  | 'select'
  | 'retry'
  | 'switch'
  | 'cooldown'
  | 'cooldown-end'
  | 'giveup'
  | 'occupancy'
  | 'config'

export interface LogRecord {
  ts: number
  event: LogEvent
  sessionId?: string
  turn?: number
  step?: number
  kind?: ModelKind
  from?: string
  to?: string
  reasonCode?: string
  reason?: string
  attempts?: number
  retriesUsed?: number
  maxRetries?: number
  switches?: number
  delayMs?: number
  failureCode?: string
  failureMessage?: string
  cooldownUntil?: number
  cooldownRemainingMs?: number
  catalogSize?: number
  idleCandidates?: number
  orderIndex?: number
  owners?: string[]
  version?: string
  [extra: string]: unknown
}

const LOG_TEXT_LIMIT = 240

/** 截断所有字符串字段，保证单条日志可控（也避免把整段上游报错塞进日志）。 */
export function sanitizeRecord(record: LogRecord): LogRecord {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') out[key] = value.length > LOG_TEXT_LIMIT ? `${value.slice(0, LOG_TEXT_LIMIT)}…` : value
    else if (Array.isArray(value)) out[key] = value.slice(0, 32).map((item) => (typeof item === 'string' ? item.slice(0, 96) : item))
    else out[key] = value
  }
  return out as LogRecord
}

/** 环形缓冲：内存里永远只留最近 capacity 条，落盘由 node 侧负责。 */
export class LogRing {
  private readonly capacity: number
  private items: LogRecord[] = []

  constructor(capacity = 500) {
    this.capacity = Math.max(16, capacity)
  }

  push(record: LogRecord): LogRecord {
    const safe = sanitizeRecord(record)
    this.items.push(safe)
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity)
    return safe
  }

  recent(limit = 100): LogRecord[] {
    const size = Math.max(0, Math.min(limit, this.items.length))
    return this.items.slice(this.items.length - size)
  }

  get size(): number {
    return this.items.length
  }
}

// ───────────────────── 源头裁剪：动态白名单 ─────────────────────

export interface RosterSnapshot {
  /** provider id */
  provider: string
  /** 该 provider 当前 listModels() 返回的全部模型 id（活数据，每次构建重读） */
  models: string[]
}

export interface ConfigurableProviderRef {
  /** 已注册 / 已声明的 provider id */
  provider: string
  /** 该 provider 声明的 settings 命名空间；同一命名空间下 >= 2 个成员视为候选「池 lane 家族」 */
  settingsNs?: string
  /** 该成员在 settings 里的路径；池 lane 家族整族为空 []，目录型家族（如 pi-ai）为 ['providers', id] */
  settingsPath?: string[]
}

export interface RosterPruneResult {
  /** 需要裁掉的 'provider/model' 键 */
  pruned: Set<string>
  /** 识别出的池 lane provider id */
  laneIds: Set<string>
  /** 池 lane 当前返回的「已开放」模型 id 集合（动态，非快照） */
  opened: Set<string>
  /** 被判定为「未过滤全量 roster 源」的 provider id */
  sources: string[]
  /** 'applied' 表示判定链路走完；其余为安全阀命中，调用方应保持原样 */
  reason: 'no-rosters' | 'no-family' | 'no-opened' | 'no-sources' | 'applied'
}

/**
 * 在目录构建的最源头裁掉「用户根本没开放」的模型。
 *
 * 背景：部分 provider（如聚合池）把全量 fallback roster 也注册进 listModels()，
 * 宿主 buildModelCatalog 与本插件都照单全收，于是未开放的模型也被识别进来。
 * 同一插件通常会另外注册几条「池 lane」，它们的 listModels() 只返回用户
 * 已开放的模型（运行时按 enabledModelIds 过滤），且共享同一个 settingsNs。
 *
 * 动态性：调用方每次构建都把「当前」listModels() 结果传进来，不缓存、不写死
 * 任何 provider / 模型 / 插件名；用户改开放项后，宿主广播 adapters-updated，
 * 插件重建目录 → 这里的 opened 集合随之变化。
 *
 * 判定（零硬编码）：
 *  1. 家族 = configurable 里共享非空 settingsNs、成员 >= 2、都已注册，
 *     且整族每个成员 settingsPath 为空 [] 的集合。
 *     目录型家族（宿主 pi-ai 让多个 profile 共用一个 settingsNs，但每个成员
 *     路径是 ['providers', id]）必须整族排除 —— 真机事故 m01524：旧版把所有
 *     多成员家族 union 进 laneIds，pi-ai 的 strata(1 模型) 被当成 lane，
 *     导致已开放的渠道 lobsterai(4 模型且含该模型) 被判为全量源，4 裁到 2。
 *  2. laneIds = 家族成员；opened = 各 lane 的运行时模型集合并集。
 *  3. 全量源 = 非 lane 成员、完整包含某条 lane 集合、且规模 >= 该 lane 2 倍的 provider。
 *  4. 每个全量源裁到 (自身 ∩ opened) ∪ keep，keep = 默认模型 + 显式入组模型。
 * 任一环节读不到数据 → 返回空 pruned（安全阀，绝不误伤）。
 */
export function prunedRosterKeys(
  rosters: RosterSnapshot[],
  configurable: ConfigurableProviderRef[],
  keep: string[],
): RosterPruneResult {
  const byId = new Map<string, Set<string>>()
  for (const roster of rosters) {
    if (roster === null || typeof roster !== 'object') continue
    const id = typeof roster.provider === 'string' ? roster.provider : ''
    if (id.length === 0) continue
    const set = new Set<string>()
    if (Array.isArray(roster.models)) {
      for (const m of roster.models) if (typeof m === 'string' && m.length > 0) set.add(m)
    }
    byId.set(id, set)
  }
  const empty = (
    reason: RosterPruneResult['reason'],
    partial: Partial<RosterPruneResult> = {},
  ): RosterPruneResult => ({
    pruned: new Set(),
    laneIds: partial.laneIds ?? new Set(),
    opened: partial.opened ?? new Set(),
    sources: partial.sources ?? [],
    reason,
  })
  if (byId.size === 0) return empty('no-rosters')

  // 1) 家族：共享同一非空 settingsNs、成员 >= 2、都已注册，且整族 settingsPath 为空。
  //    pi-ai 让多个 profile 共用一个 settingsNs，但每成员路径是 ['providers', id]；
  //    这类「目录型家族」不是池 lane，混进 laneIds 会把已开放的渠道误判成全量源（m01524）。
  //    settingsPath 缺失（老宿主 / 测试夹具）按空处理，保持兼容。
  const families = new Map<string, { ids: Set<string>; allEmpty: boolean }>()
  for (const c of configurable) {
    if (c === null || typeof c !== 'object') continue
    const ns = (typeof c.settingsNs === 'string' ? c.settingsNs : '').trim()
    const id = typeof c.provider === 'string' ? c.provider : ''
    if (ns.length === 0 || id.length === 0 || !byId.has(id)) continue
    const path = Array.isArray(c.settingsPath) ? c.settingsPath : []
    if (!families.has(ns)) families.set(ns, { ids: new Set(), allEmpty: true })
    const family = families.get(ns)!
    family.ids.add(id)
    if (path.length > 0) family.allEmpty = false
  }
  const laneIds = new Set<string>()
  for (const [, family] of families) {
    if (family.allEmpty && family.ids.size >= 2) for (const id of family.ids) laneIds.add(id)
  }
  if (laneIds.size === 0) return empty('no-family')

  // 2) opened = 所有 lane 的运行时集合并集（动态）；laneSets = 非空 lane 集合
  const opened = new Set<string>()
  const laneSets: Set<string>[] = []
  for (const id of laneIds) {
    const s = byId.get(id)
    if (s === undefined || s.size === 0) continue
    for (const m of s) opened.add(m)
    laneSets.push(s)
  }
  if (opened.size === 0 || laneSets.length === 0) return empty('no-opened', { laneIds, opened })

  // 3) 全量源：非 lane 成员、完整包含某条 lane、且规模 >= lane*2
  const sources: string[] = []
  for (const [id, set] of byId) {
    if (laneIds.has(id)) continue
    const hit = laneSets.some((L) => set.size >= L.size * 2 && [...L].every((m) => set.has(m)))
    if (hit) sources.push(id)
  }
  if (sources.length === 0) return empty('no-sources', { laneIds, opened, sources })

  // 4) keep：默认模型 / 显式入组，既支持 'provider/model' 也支持纯 model id
  const keepFull = new Set<string>()
  const keepBare = new Set<string>()
  for (const k of keep) {
    if (typeof k !== 'string' || k.length === 0) continue
    const target = k.includes('/') ? keepFull : keepBare
    target.add(k)
  }

  // 5) 每个全量源裁到 (自身 ∩ opened) ∪ keep
  const pruned = new Set<string>()
  for (const id of sources) {
    const set = byId.get(id)
    if (set === undefined) continue
    for (const m of set) {
      const full = `${id}/${m}`
      if (!opened.has(m) && !keepFull.has(full) && !keepBare.has(m)) pruned.add(full)
    }
  }
  return { pruned, laneIds, opened, sources, reason: 'applied' }
}
