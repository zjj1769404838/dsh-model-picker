/**
 * @zjjlivingfree/dsh-model-picker — node 半边
 *
 * 用到的 dsh 扩展点（全部已核实，行号见 README「扩展点核对」一节）：
 *   ctx.llm.listProviders() / listModels(provider) / resolveModelInfo(provider, model)
 *     → 模型列表、provider 来源、inputModalities（分类依据）
 *   ctx.get('agents').list() + agent/created / agent/disposed / agent/status
 *     → 会话占用（使用中 / 空闲）
 *   ctx.get('sessionProjections').stateOf(session, 'modelSelection')
 *     → 每个会话当前指向哪个模型（占用的判定依据）
 *   agent.model.select(selection)  → 宿主认可的切模型入口（step preparation 之前调用，
 *     内部 append 'model/selection'；下一 step 的 this.model.current() 会读到 pending）
 *     sessionController.agents.selectForNextRequest(agent, selection) 仅作旧宿主兼容的次选
 *   注意：绝不能在 agent/request 瀑布里改 provider/model —— dsh-agent-loop 在 step 已固定
 *     selection 后校验 proposedConfig，改了直接抛「use agent.model.select() before step
 *     preparation」致命错（真机事故 m01524/m01547）。
 *   ctx.on('agent/request-error', waterfall) → 返回 { kind:'retry' } 驱动 agent-loop 重试
 *   ctx.get('agentDefaultModel').currentSelection() → 用户默认模型
 *   webServer.register({ kind:'prefix' }) → 把目录 / 占用 / 冷却状态暴露给客户端
 */
/**
 * schemastery 的两种导出形态都要兼容：
 *   ESM 入口（lib/index.mjs）只有 `default` 一个导出，`import * as` 拿到的是 `{ default: fn }`；
 *   CJS 入口（lib/index.cjs）直接是命名空间对象，没有 default。
 * 所以这里先取 default，取不到再用命名空间本身 —— 两种打包方式下 z.boolean() 都能拿到。
 */
import * as zNamespace from '@deepseek-ai/schemastery'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_CONFIG,
  LogRing,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  byKind,
  classify,
  classifyFailure,
  cooldownActive,
  cooldownRemaining,
  computeOccupancy,
 decideEscalate,
 decideOnError,
 decideResume,
 failureFaceOf,
  fieldsOf,
  groupCatalog,
  groupsOf,
  indexByKey,
  isDisabled,
  isHidden,
  isUnassigned,
  modelKey,
  newSessionState,
  normalizeCustomGroups,
  normalizeGroupMode,
  normalizeModalities,
  normalizeSwitchScope,
  ordered,
  priceClassOf,
  priceFactorOf,
  prunedRosterKeys,
  resolveConfig,
  sanitizeRecord,
  scopeGroupsOf,
  selectModel,
  sortKeyOf,
} from './core.js'
import type {
  AgentFact,
  AutoSelectConfig,
  CatalogFailure,
  CatalogSnapshot,
  CooldownState,
  LogRecord,
  ModelEntry,
  ModelKind,
  OccupancyMap,
  Selection,
  SessionState,
} from './core.js'

export const name = 'model-auto-select'
export const inject = ['webServer', 'settings']

/** schemastery 命名空间：ESM 入口是 `{ default: fn }`，CJS 入口是命名空间本身，两种都摊平。 */
const z: any = (zNamespace as any)?.default ?? zNamespace

/**
 * 插件配置 schema —— dsh 设置页面入口的唯一开关。
 *
 * `@deepseek-ai/dsh-settings` 的 `describe()` 只把「导出 Config 且含 volatile 字段」的插件
 * 收进设置页（`volatileForm(schema)` 返回 undefined 时整页不出现）；写入时还会逐字段校验
 * `isVolatilePath`，非 volatile 字段直接抛 `Config field "<path>" is not volatile`。
 * 所以 17 个字段全部 `.volatile()`。嵌套对象数组（customGroups）整体 volatile 即可，
 * 子字段**不能**再标 volatile（会抛 `volatile fields require a fixed object path`）。
 */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled).volatile(),
  defaultModel: z
    .object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() })
    .default(null)
    .volatile(),
  maxRetries: z.natural().default(DEFAULT_CONFIG.maxRetries).volatile(),
  retryDelayMs: z.natural().default(DEFAULT_CONFIG.retryDelayMs).volatile(),
  requestRetryEnabled: z.boolean().default(DEFAULT_CONFIG.requestRetryEnabled!).volatile(),
  requestRetryMax: z.natural().default(DEFAULT_CONFIG.requestRetryMax!).volatile(),
  requestRetryBackoffMs: z.array(z.natural()).default(DEFAULT_CONFIG.requestRetryBackoffMs!).volatile(),
  providerOrder: z.array(z.string()).default([]).volatile(),
  modelOrder: z.array(z.string()).default([]).volatile(),
  preferIdle: z.boolean().default(DEFAULT_CONFIG.preferIdle).volatile(),
  cooldownMs: z.natural().default(DEFAULT_CONFIG.cooldownMs).volatile(),
  cooldownRefreshBlocked: z.boolean().default(DEFAULT_CONFIG.cooldownRefreshBlocked).volatile(),
  catalogTtlMs: z.natural().default(DEFAULT_CONFIG.catalogTtlMs).volatile(),
  occupancyRefreshMs: z.natural().default(DEFAULT_CONFIG.occupancyRefreshMs).volatile(),
  switchOnCodes: z.array(z.string()).default([]).volatile(),
  crossClassFallback: z.boolean().default(DEFAULT_CONFIG.crossClassFallback).volatile(),
  disabledModels: z.array(z.string()).default([]).volatile(),
  disabledGroups: z.array(z.string()).default([]).volatile(),
  hiddenModels: z.array(z.string()).default([]).volatile(),
  hiddenGroups: z.array(z.string()).default([]).volatile(),
  freeBadgeLabel: z.string().default(DEFAULT_CONFIG.freeBadgeLabel).volatile(),
  groupByKind: z.boolean().default(DEFAULT_CONFIG.groupByKind).volatile(),
  customGroups: z
    .array(
      z.object({
        id: z.string().default(''),
        label: z.string().default(''),
        kind: z.string().default(''),
        providers: z.array(z.string()).default([]),
        models: z.array(z.string()).default([]),
        freeOnly: z.boolean().default(false),
        explicit: z.boolean().default(false),
      }),
    )
    .default([])
    .volatile(),
  switchScope: z.string().default(DEFAULT_CONFIG.switchScope).volatile(),
  groupMode: z.string().default(DEFAULT_CONFIG.groupMode).volatile(),
  probeIntervalMin: z.natural().default(DEFAULT_CONFIG.probeIntervalMin).volatile(),
  modelEfforts: z.array(z.object({ key: z.string(), effort: z.string() })).default([]).volatile(),
  autoResumeEnabled: z.boolean().default(DEFAULT_CONFIG.autoResumeEnabled!).volatile(),
  autoResumeConsecutiveMax: z.natural().default(DEFAULT_CONFIG.autoResumeConsecutiveMax!).volatile(),
  autoResumeSessionMax: z.natural().default(DEFAULT_CONFIG.autoResumeSessionMax!).volatile(),
  autoResumeContinuePrompt: z.string().default(DEFAULT_CONFIG.autoResumeContinuePrompt!).volatile(),
  escalateEnabled: z.boolean().default(DEFAULT_CONFIG.escalateEnabled!).volatile(),
  escalateThresholdRatio: z.number().default(DEFAULT_CONFIG.escalateThresholdRatio!).volatile(),
  escalateMaxChainDepth: z.natural().default(DEFAULT_CONFIG.escalateMaxChainDepth!).volatile(),
  escalateContinuePrompt: z.string().default(DEFAULT_CONFIG.escalateContinuePrompt!).volatile(),
  escalateArchiveParent: z.boolean().default(DEFAULT_CONFIG.escalateArchiveParent!).volatile(),
  escalateRenameChild: z.boolean().default(DEFAULT_CONFIG.escalateRenameChild!).volatile(),
})

/**
 * 带 `Config` 后宿主用 `Config['~standard'].validate()` 的结果给 `apply`，
 * 每个字段都变成 Ref（有 `.get()`），不再是裸值。这里统一摊平，
 * 同时兼容没有 Config 时的裸对象（`__test.setContext` 与单元测试都走这条）。
 */
function readConfigRefs(raw: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (raw === null || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value !== null && typeof value === 'object' && typeof (value as any).get === 'function' ? (value as any).get() : value
  }
  return out
}

const ROUTE_PREFIX = '/dsh-model-auto-select'

/**
 * globalThis 上的路由登记位（跨模块实例共享）。
 *
 * 为什么不用模块变量：unlag / 宿主重载可能重新 import 本模块，模块作用域会被整个换掉，
 * 上一实例留在 webServer 路由表里的旧路由就成了没人认领的僵尸——它照样应答请求，
 * 但返回的是上一实例的内存状态（旧配置、旧分组）。登记位放在 globalThis 上，
 * 新实例启动时就能先把上一实例的路由拆掉，再注册自己的。
 */
const ROUTE_REGISTRY_KEY = '__dsh_model_auto_select_route__'
const MAX_BODY_BYTES = 64 * 1024
const BEACON_TEXT_LEN = 400
const MAX_BEACONS = 200
/** 客户端排障信标允许的字段白名单：白名单外的键一律丢弃，避免任意内容被写进进程内存。 */
// `step` 是跳转失败落在哪一跳（launcher-missing / nav-item-missing）——缺它就只能看到
// 「打开设置页失败」而不知道卡在哪，真机排障时白丢 31 条记录。
const BEACON_KEYS = ['phase', 'step', 'build', 'viewError', 'entryCount', 'occupied', 'cooldownActive', 'note']
const MODALITY_TIMEOUT_MS = 4_000
// 目录未就绪（启动早期 llm 尚未注册）时，非 force 拉取用更短的"重试窗口"而非 60s TTL，
// 避免空目录被锁死、列表永远拉不到真实模型。
const READY_RETRY_MS = 5_000
/**
 * llm 服务每次 provider 注册/注销/替换都会广播这个事件（dsh-llm/lib/index.js 的 emitAdaptersUpdated）。
 * 它是「目录可能已经过期」的权威信号：启动早期我们只看到先注册的几个 provider，
 * 后面陆续注册的 provider 不会主动通知我们，但会触发这个事件。
 */
const ADAPTERS_EVENT = 'llm/adapters-updated'
/**
 * provider 集合「静默」这么久，才认为目录稳定、可以据此判定无候选并进入冷却。
 * 真机日志证据：启动后依次只看到 8 个 provider（27 条）就判就绪并进冷却，
 * 而完整集合是 27 个 provider / 172 条 —— 差的那批 provider 是启动稍后注册的。
 */
const CATALOG_SETTLE_MS = 3_000
/** adapters-updated 可能连续触发（一次启动注册几十个 provider），合并成一次重建。 */
const ADAPTERS_REFRESH_DEBOUNCE_MS = 800
const MODALITY_CACHE_TTL_MS = 10 * 60 * 1000
/** 会话级状态在没有 agent 引用时最多保留这么久，避免内存无限增长。 */
const SESSION_STATE_TTL_MS = 6 * 60 * 60 * 1000

// ─────────────────────────── 运行期状态（模块级单例） ───────────────────────────

let cfg: AutoSelectConfig = DEFAULT_CONFIG
let ctxRef: any = null
const logRing = new LogRing(600)
const beacons: Record<string, unknown>[] = []

let catalog: CatalogSnapshot = { generatedAt: 0, entries: [], failures: [], providerCount: 0 }
let catalogAt = 0
let catalogReady = false // 目录是否为「llm 已就绪」的稳态结果（区别于启动早期 llm 未就绪的空目录）
/**
 * 上一次构建看到的 provider 集合指纹。启动早期 llm 只注册了一部分 provider，
 * 「listProviders 可调用」并不等于「provider 集合已完整」——真机日志里先看到 8 个，
 * 完整是 27 个。集合变化就把目录标回未就绪，让它按短窗口重建，而不是按 60s TTL 锁住旧快照。
 */
let catalogProviders: string[] = []
/** provider 集合最近一次发生变化的时刻；距现在不足 CATALOG_SETTLE_MS 就还不算稳定。 */
let catalogProvidersAt = 0
let adaptersTimer: any = null
let catalogInflight: Promise<CatalogSnapshot> | null = null
let recoveryScheduled = false // 防止 not-ready→ready 过渡期并发重复触发恢复

type ReasoningMeta = { efforts: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string }

const modalityCache = new Map<string, { modalities: string[]; source: 'listModels' | 'resolveModelInfo'; contextWindow?: number; reasoning?: ReasoningMeta; at: number }>()

const sessions = new Map<string, SessionState>()
/** 每个会话已判失败的模型键 → 到期时间戳（模型级冷却，仅会话内生效） */
const modelCooldown = new Map<string, Record<string, number>>()

let cooldown: CooldownState = { until: 0, enteredAt: 0, reason: '' }
let cooldownTimer: any = null
/**
 * 冷却期「抑制目录刷新」这条日志的节流状态。
 * 客户端每 15s 拉一次 /catalog，若每次都写一条 giveup，冷却 30 分钟会刷出上百条噪声日志
 * （真机实测一次冷却刷了 210 条）。日志是证据，不是心跳：同一段冷却里最多每 60s 记一条，
 * 并把被折叠的条数累加进 `suppressed` 字段，信息不丢。
 */
let cooldownSuppressLogAt = 0
let cooldownSuppressCount = 0
const COOLDOWN_SUPPRESS_LOG_INTERVAL_MS = 60_000
let occupancyTimer: any = null
let occupancy: OccupancyMap = {}
let lastOccupancyAt = 0

/** 最近一次连通性探测判为「模型级不可用」的模型（NUL 形 key = entry.key）：选择时跳过，界面归「不可调」组，持久化落盘。 */
const probeUnavailable = new Set<string>()
/** 基础设施/连接级故障的模型（NUL 形 key）：归「探测失败」组，同样持久化落盘、重启沿用；仅探测通过或人工移出才放出。 */
const probeInfra = new Set<string>()
/** 定时探测 timer 与防重叠标志：probeIntervalMin=0 默认不启用；配置写入触发 apply 重跑后新间隔生效。 */
let probeTimer: any = null
let probeRunning = false

// ─────────────────────── 0.1.9 双能力运行时状态 ───────────────────────

/** 续作账本：连续失败计数 / 整会话累计续作次数 / 已处理轮次水位（防旧轮重放）。宿主重启归零。 */
interface ResumeLedgerEntry {
  consecutive: number
  session: number
  lastHandledTurn: number | null
}
const resumeLedger = new Map<string, ResumeLedgerEntry>()

/** 升级账本：已升级次数 / 链深 / 已升级到的子会话 / 最后一回合是否正常完成。宿主重启归零。 */
interface EscalationLedgerEntry {
  escalations: number
  depth: number
  escalatedTo: string | null
  lastTurnCompleted: boolean
}
const escalationLedger = new Map<string, EscalationLedgerEntry>()

/** 待跳转队列：新会话建成后写入；client 半边轮询 GET /pending-navigation 取走即清空。 */
const pendingNavigation: string[] = []

/** 允许小数的配置项：占比阈值不能走 Math.floor（0.85 会被取整成 0）。 */
const DECIMAL_CONFIG_KEYS = new Set(['escalateThresholdRatio'])

/** 续作消息的固定模板前缀（不拼错误原文）。 */
const RESUME_TEXT_PREFIX = '上一次执行因错误中断，已自动恢复。'

/**
 * 暂不可用集合持久化（需求④ m05678）：两类失败集合都落盘，DSH 重启沿用上次结果。
 * 落盘到插件目录旁的 data/probe-unavailable.json，重启后回填，沿用上次结果。
 * fail-closed：读/写任何异常都吞掉，绝不阻断启动或探测流程。
 */
// 落盘到插件目录（lib 的上级，即仓库根）旁的 data/probe-unavailable.json：
// build.mjs 每次构建会 rmSync(lib) 全清，故持久化文件必须放在 lib 之外，才能跨构建/跨 DSH 重启沿用。
const PROBE_FILE = resolve(dirname(dirname(fileURLToPath(import.meta.url))), 'data', 'probe-unavailable.json')

/** 读盘：返回上次记录的两类失败键；文件缺失/损坏/不可读一律返回空分组。旧文件缺 infraKeys 时向后兼容（infra 视为空）。 */
function loadProbeFile(): { model: string[]; infra: string[] } {
  try {
    const raw = readFileSync(PROBE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const model = parsed && Array.isArray(parsed.keys) ? parsed.keys.filter((k: unknown): k is string => typeof k === 'string') : []
    const infra = parsed && Array.isArray(parsed.infraKeys) ? parsed.infraKeys.filter((k: unknown): k is string => typeof k === 'string') : []
    return { model, infra }
  } catch {
    return { model: [], infra: [] }
  }
}

/** 写盘：把当前两类失败集合连同时间戳落盘；任何异常吞掉（不得影响探测主流程）。 */
function saveProbeFile(): void {
  try {
    mkdirSync(dirname(PROBE_FILE), { recursive: true })
    const payload = { savedAt: Date.now(), keys: [...probeUnavailable], infraKeys: [...probeInfra] }
    writeFileSync(PROBE_FILE, JSON.stringify(payload), 'utf8')
  } catch {
    // 持久化是尽力而为的增强；写入失败绝不抛错
  }
}

/** appendPluginRecord 的动态解析结果（宿主不暴露时静默降级为内存日志）。 */
let sessionApi: { appendPluginRecord?: (session: any, type: string, data: any) => number; pluginRecordOf?: (event: any) => any } | null = null
let sessionApiProbed = false

// ─────────────────────────────── 日志 ───────────────────────────────

function log(record: LogRecord) {
  const safe = logRing.push(record)
  try {
    ctxRef?.logger?.info?.(`[${PLUGIN_NAME}] ${safe.event}`, JSON.stringify(safe))
  } catch {
    /* logger 不可用不影响主流程 */
  }
  return safe
}

async function resolveSessionApi() {
  if (sessionApiProbed) return sessionApi
  sessionApiProbed = true
  const attempts: Array<[string, () => Promise<any>]> = [
    ['bare-import', () => import('@deepseek-ai/dsh-session')],
  ]
  for (const [label, run] of attempts) {
    try {
      const mod = await run()
      if (mod && typeof mod.appendPluginRecord === 'function') {
        sessionApi = { appendPluginRecord: mod.appendPluginRecord, pluginRecordOf: mod.pluginRecordOf }
        log({ ts: Date.now(), event: 'config', reason: `plugin record 通道可用（${label}）`, version: PLUGIN_VERSION })
        return sessionApi
      }
    } catch (err) {
      log({
        ts: Date.now(),
        event: 'config',
        reason: `plugin record 通道不可用（${label}），仅写内存日志`,
        failureMessage: String((err as Error)?.message ?? err),
      })
    }
  }
  sessionApi = null
  return sessionApi
}

/**
 * 把一条日志同时写进 Session 的 plugin record（宿主支持时）。
 * type 固定 `plugin:model-auto-select/<event>`，符合宿主 plugin record 语法。
 */
function recordToSession(session: any, record: LogRecord) {
  if (!sessionApi?.appendPluginRecord || session === undefined || session === null) return
  const type = `plugin:model-auto-select/${record.event}`
  try {
    sessionApi.appendPluginRecord(session, type, sanitizeRecord(record))
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'config',
      reason: 'plugin record 写入失败，已降级为内存日志',
      failureMessage: String((err as Error)?.message ?? err),
    })
    sessionApi = null
  }
}

// ─────────────────────────── 模型目录（分类 + 来源） ───────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** 取一个模型的多模态字段：先 listModels，缺省再 resolveModelInfo，都拿不到就记 fallback。 */
async function modalitiesOf(llm: any, provider: string, model: any): Promise<{ modalities: string[]; source: 'listModels' | 'resolveModelInfo' | 'fallback'; contextWindow?: number; reasoning?: ReasoningMeta }> {
  const key = modelKey(provider, model.id)
  const cached = modalityCache.get(key)
  if (cached !== undefined && Date.now() - cached.at < MODALITY_CACHE_TTL_MS) {
    return { modalities: cached.modalities, source: cached.source, contextWindow: cached.contextWindow, reasoning: cached.reasoning }
  }
  let modalities = normalizeModalities(model?.inputModalities)
  let source: 'listModels' | 'resolveModelInfo' | 'fallback' = modalities.length > 0 ? 'listModels' : 'fallback'
  let contextWindow: number | undefined
  let reasoning: ReasoningMeta | undefined
  // 上下文窗口与推理等级只能从 resolveModelInfo 拿到（listModels 的 LlmModelInfo 不含），
  // 而多模态字段优先用 listModels 给的。故每次缓存未命中都尝试一次 resolveModelInfo：
  // 仅当 listModels 没给多模态时才用它的 inputModalities 补位，contextWindow/reasoning 则无条件顺取。
  if (typeof llm.resolveModelInfo === 'function') {
    try {
      const info = await withTimeout(Promise.resolve(llm.resolveModelInfo(provider, model.id)), MODALITY_TIMEOUT_MS, `resolveModelInfo(${provider}/${model.id})`)
      const resolved = normalizeModalities((info as any)?.inputModalities)
      if (resolved.length > 0 && modalities.length === 0) {
        modalities = resolved
        source = 'resolveModelInfo'
      }
      const cw = (info as any)?.context?.contextWindow
      if (typeof cw === 'number' && Number.isFinite(cw)) contextWindow = cw
      const raw = (info as any)?.reasoning
      if (raw !== undefined && raw !== null && Array.isArray(raw.efforts)) {
        const efforts = raw.efforts
          .filter((level: any) => level !== undefined && level !== null && typeof level.id === 'string' && typeof level.name === 'string')
          .map((level: any) => ({ id: String(level.id), name: String(level.name), ...(typeof level.description === 'string' ? { description: level.description } : {}) }))
        reasoning = { efforts, ...(typeof raw.defaultEffort === 'string' ? { defaultEffort: raw.defaultEffort } : {}) }
      }
    } catch {
      /* 单模型探测失败不影响整表，保持 fallback；上下文窗口/推理等级缺省即不显示 */
    }
  }
  modalityCache.set(key, { modalities, source: source === 'fallback' ? 'listModels' : source, contextWindow, reasoning, at: Date.now() })
  return { modalities, source, contextWindow, reasoning }
}

async function buildCatalog(): Promise<CatalogSnapshot> {
  const llm = ctxRef?.get?.('llm')
  if (llm === undefined || llm === null || typeof llm.listProviders !== 'function') {
    catalogReady = false
    catalogProviders = []
    catalogProvidersAt = Date.now()
    return { generatedAt: Date.now(), entries: [], failures: [{ provider: '*', name: '*', message: 'llm 服务不可用' }], providerCount: 0 }
  }
  const providers = llm.listProviders() as any[]
  const entries: ModelEntry[] = []
  const failures: CatalogFailure[] = []
  for (let pIndex = 0; pIndex < providers.length; pIndex += 1) {
    const provider = providers[pIndex]
    const pid = String(provider?.id ?? '')
    if (pid.length === 0) continue
    try {
      const models = (await llm.listModels(pid)) as any[]
      for (let mIndex = 0; mIndex < models.length; mIndex += 1) {
        const model = models[mIndex]
        const mid = String(model?.id ?? '')
        if (mid.length === 0) continue
        const { modalities, source, contextWindow, reasoning } = await modalitiesOf(llm, pid, model)
        const name = String(model?.name ?? mid)
        const priceFactor = priceFactorOf(name)
        const priceClass = priceClassOf(name, priceFactor)
        entries.push({
          key: modelKey(pid, mid),
          provider: pid,
          providerName: String(provider?.name ?? provider?.displayName ?? pid),
          providerSettingsNs: String(provider?.settingsNs ?? ''),
          model: mid,
          name,
          kind: classify(modalities),
          modalities,
          modalitySource: source,
          sortKey: sortKeyOf(pid, mid, pIndex, mIndex, cfg),
          ...(priceFactor === undefined ? {} : { priceFactor }),
          priceClass,
          free: priceClass === 'free',
          // 上下文窗口：宿主 llm 服务仅在 resolveModelInfo 结果里披露（context.contextWindow，
          // combined request+response 上限）；listModels 的 LlmModelInfo 不含该字段，故此处
          // 取 modalitiesOf 顺带探到的 contextWindow。未披露绝不猜测，故用 optional 透传。
          ...(contextWindow === undefined ? {} : { contextWindow: Number(contextWindow) }),
          // 推理等级：宿主 resolveModelInfo 披露（reasoning）才有值；未披露绝不猜测，用 optional 透传。
          ...(reasoning === undefined ? {} : { reasoning }),
          // 分组归属要等全部条目建完才能算，先占位，下面统一回填
          disabled: false,
          hidden: false,
        })
      }
    } catch (err) {
      failures.push({
        provider: pid,
        name: String(provider?.name ?? pid),
        message: String((err as Error)?.message ?? err).slice(0, 200),
      })
    }
  }
  // 源头裁剪：把「用户没开放」的全量 fallback roster 在入目录前就删掉，而不是等
  // 客户端靠 CSS 隐藏（宿主候选集插件改不了，那样治标不治本）。白名单完全来自本次
  // 构建现场读到的运行时数据，零硬编码 provider/模型/插件名：
  //   - rosters      = 本次 listModels() 的真实结果（每次重建都重读）
  //   - configurable = llm.listConfigurableProviders()（含 settingsNs，用于认池 lane 家族）
  //   - opened       = 池 lane 当前返回的「已开放」集合
  // 用户改开放项 → 宿主广播 adapters-updated → 重建目录 → opened 跟着变（动态，非快照）。
  // 任一环节读不到数据 → 完全不裁剪（安全阀，绝不误伤）。
  const rosters = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (!rosters.has(entry.provider)) rosters.set(entry.provider, new Set())
    rosters.get(entry.provider)!.add(entry.model)
  }
  const pruneKeep: string[] = []
  if (cfg.defaultModel !== null && cfg.defaultModel !== undefined) {
    pruneKeep.push(`${cfg.defaultModel.provider}/${cfg.defaultModel.model}`)
  }
  for (const rule of cfg.customGroups) for (const m of rule.models) pruneKeep.push(m)
  let configurable: Array<{ provider: string; settingsNs?: string; settingsPath?: string[] }> = []
  if (typeof (llm as any).listConfigurableProviders === 'function') {
    try {
      const raw = await withTimeout(
        Promise.resolve().then(() => (llm as any).listConfigurableProviders()),
        MODALITY_TIMEOUT_MS,
        'listConfigurableProviders',
      )
      if (Array.isArray(raw)) {
        configurable = raw
          .filter((row: any) => row !== null && typeof row === 'object')
          .map((row: any) => ({
            provider: String(row?.provider ?? ''),
            settingsNs: String(row?.settingsNs ?? ''),
            settingsPath: Array.isArray(row?.settingsPath) ? row.settingsPath.map((p: any) => String(p)) : [],
          }))
      }
    } catch {
      // 读不到目录声明不阻塞目录构建：走安全阀，保持全量
      configurable = []
    }
  }
  const prune = prunedRosterKeys(
    [...rosters].map(([provider, models]) => ({ provider, models: [...models] })),
    configurable,
    pruneKeep,
  )
  if (prune.pruned.size > 0) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i]
      if (prune.pruned.has(`${e.provider}/${e.model}`)) entries.splice(i, 1)
    }
    log({
      ts: Date.now(),
      event: 'catalog',
      reasonCode: 'unopened-roster-pruned',
      catalogSize: entries.length,
      reason: `源头裁剪：池 lane 家族(${[...prune.laneIds].join(',')}) 已开放 ${prune.opened.size} 项，从全量源(${prune.sources.join(',')}) 裁掉 ${prune.pruned.size} 个未开放模型；keep=${pruneKeep.length}`,
      version: PLUGIN_VERSION,
    })
  }
  // 分组归属回填：`disabledGroups` / `hiddenGroups` 是按分组 id 生效的，得先知道每个模型落在哪些组。
  // 分组只依赖 provider/kind/名单，不看 disabled，所以这里用「未被关掉」的临时配置算一遍即可。
  const groupMap = groupsOf(entries, cfg)
  for (const entry of entries) {
    const groups = groupMap.get(entry.key) ?? []
    // 没入组 = 不可用 + 不展示（用户口径 m04856：先建组，再把模型选进组）。
    // 建过分组后，任何一条规则都没命中的模型就落到这里；没建过分组时 isUnassigned 恒 false，行为与旧版一致。
    const unassigned = isUnassigned(entry, cfg)
    entry.disabled = unassigned || isDisabled(entry.provider, entry.model, cfg, groups)
    entry.hidden = unassigned || isHidden(entry.provider, entry.model, cfg, groups)
  }
  const snapshot: CatalogSnapshot = { generatedAt: Date.now(), entries, failures, providerCount: providers.length }
  // provider 集合指纹：启动早期 llm 只注册了一部分 provider，「listProviders 可调用」不等于「集合已完整」。
  // 真机日志证据：先看到 8 个 provider / 27 条就判就绪并进冷却，完整是 27 个 / 172 条。
  // 集合一变就标记「还没稳定」，让后续判定别急着下「无可用模型」的结论。
  const providerIds = providers.map((provider) => String(provider?.id ?? '')).filter((id) => id.length > 0)
  // 真正「一个 provider 都没有」是用户配置问题，属稳定空目录，不该每 5s 重拉一次。
  // 只有已看到 provider、且集合在变，才算「还在陆续注册」。
  const firstBuild = catalogProviders.length === 0 && providerIds.length > 0
  const changed =
    catalogProviders.length > 0 &&
    (providerIds.length !== catalogProviders.length || providerIds.some((id) => !catalogProviders.includes(id)))
  // 首次建目录同样从「刚发现」起算：真机证据显示第一次只看到 8 个 provider，
  // 若把首次当成稳定态，就会立刻把「没有候选」当结论、进 30 分钟冷却。
  if (changed || firstBuild) catalogProvidersAt = Date.now()
  catalogProviders = providerIds
  catalogReady = true // llm 已就绪并成功构建：无论结果是否为空都是稳态，可按 TTL 缓存
  if (changed) {
    log({
      ts: snapshot.generatedAt,
      event: 'catalog',
      catalogSize: entries.length,
      reason: `provider 集合变化：${providerIds.length} 个（目录重建后视为未稳定，${CATALOG_SETTLE_MS}ms 内不下「无可用模型」结论）`,
      version: PLUGIN_VERSION,
    })
  }
  const text = byKind(entries, 'text').length
  const multi = byKind(entries, 'multimodal').length
  log({
    ts: snapshot.generatedAt,
    event: 'catalog',
    catalogSize: entries.length,
    kind: multi > 0 ? 'multimodal' : 'text',
    reason: `目录构建完成：text=${text} multimodal=${multi} providers=${providers.length} failures=${failures.length}`,
    version: PLUGIN_VERSION,
  })
  return snapshot
}

async function getCatalog(force = false): Promise<CatalogSnapshot> {
  const now = Date.now()
  // 未就绪时用更短的重试窗口：否则启动早期 llm 没好 → 空目录被 60s TTL 锁死，永远拉不到真实目录。
  // provider 集合还在变化时同理：这份目录注定不完整，不能按 60s TTL 供出去。
  const ttl = catalogReady && catalogSettled(now) ? cfg.catalogTtlMs : READY_RETRY_MS
  if (!force && catalogAt > 0 && now - catalogAt < ttl) return catalog
  if (!force && catalogInflight !== null) return catalogInflight
  // 冷却期内抑制刷新（「不高频重试」的落地判定），返回上一份快照。
  // 但目录未就绪 / provider 集合未稳定时不抑制：否则启动早期 llm 没好 → 空目录被冷却锁死，
  // 列表与自动选择永远起不来（真机就是这样锁了 30 分钟）。
  if (!force && cooldownActive(cooldown, now) && cfg.cooldownRefreshBlocked && catalogReady && catalogSettled(now)) {
    cooldownSuppressCount += 1
    if (now - cooldownSuppressLogAt >= COOLDOWN_SUPPRESS_LOG_INTERVAL_MS) {
      const suppressed = cooldownSuppressCount - 1
      cooldownSuppressLogAt = now
      cooldownSuppressCount = 0
      log({
        ts: now,
        event: 'giveup',
        reasonCode: 'cooldown-active',
        reason:
          `冷却中抑制目录刷新，剩余 ${cooldownRemaining(cooldown, now)}ms` +
          (suppressed > 0 ? `（距上次记录又抑制 ${suppressed} 次）` : ''),
        cooldownRemainingMs: cooldownRemaining(cooldown, now),
        suppressed,
      })
    }
    return catalog
  }
  const wasReady = catalogReady
  catalogInflight = buildCatalog()
    .then((snapshot) => {
      catalog = snapshot
      catalogAt = Date.now()
      // 从「未就绪」翻转为「已就绪」的瞬间：补一次对未选择会话的自动选择，
      // 修复「启动早期会话永远没被选模型 / 自动选择没尝试调用」的问题。
      if (!wasReady && catalogReady && !recoveryScheduled) {
        recoveryScheduled = true
        void recoverSelections('catalog-ready').finally(() => {
          recoveryScheduled = false
        })
      }
      return snapshot
    })
    .catch((err) => {
      log({ ts: Date.now(), event: 'catalog', reason: '目录构建失败', failureMessage: String((err as Error)?.message ?? err) })
      return catalog
    })
    .finally(() => {
      catalogInflight = null
    })
  return catalogInflight
}

// ─────────────────────────── 会话占用（使用中 / 空闲） ───────────────────────────

/**
 * 判定某个会话「当前指向哪个模型」——只认会话自身的显式选择：
 *   1. projection `modelSelection` 的 pending（待生效）或 lastUsed（已生效）
 *   2. session.requestHeader() 里最近一次请求的 provider/model
 * 不用 agentDefaultModel 兜底：那是全局默认值，不代表该会话正在使用，
 * 拿它算占用会把「还没选过模型的空会话」全部算成占用同一个模型。
 */
function agentSelectionKey(agent: any): string | null {
  try {
    const sp = ctxRef?.get?.('sessionProjections')
    if (sp !== undefined && sp !== null && typeof sp.stateOf === 'function') {
      const state = sp.stateOf(agent.session, 'modelSelection')
      const picked = state?.pending ?? state?.lastUsed
      if (picked !== undefined && picked !== null && typeof picked.provider === 'string' && typeof picked.model === 'string') {
        return modelKey(picked.provider, picked.model)
      }
    }
  } catch {
    /* projection 未注册等情况：继续往下兜底 */
  }
  try {
    const header = agent?.session?.requestHeader?.()
    const config = header?.config
    if (config !== undefined && typeof config.provider === 'string' && typeof config.model === 'string') {
      return modelKey(config.provider, config.model)
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * 把「插件记过 state 的会话」与「宿主里活跃但插件还没记过的会话」合并。
 * 后者用宿主的当前选择（投影 pending/lastUsed 或 requestHeader）作为 current，
 * 保证模型下拉总能显示真实当前模型，而不是占位文案。
 */
/**
 * 把「插件记过 state 的会话」与「宿主里活跃但还没记过的会话」合并，并给缺 current 的会话补上宿主的当前选择。
 * 只补 current（展示用），不改 attempts/excluded 等运行时状态。
 */
function trackedSessions(now: number): Map<string, SessionState> {
  for (const agent of liveAgents()) {
    const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
    if (sessionId.length === 0) continue
    const key = agentSelectionKey(agent)
    const known = sessions.get(sessionId)
    const state = known ?? sessionState(sessionId, key, now)
    if (state.current === null && key !== null) state.current = hostSelection(key, now)
  }
  return sessions
}

function liveAgents(): any[] {
  const registry = ctxRef?.get?.('agents')
  if (registry === undefined || registry === null) return []
  try {
    const list = typeof registry.list === 'function' ? registry.list() : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function refreshOccupancy(reason: string): OccupancyMap {
  const facts: AgentFact[] = []
  for (const agent of liveAgents()) {
    const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
    if (sessionId.length === 0) continue
    facts.push({ sessionId, key: agentSelectionKey(agent), status: agent?.status === 'running' ? 'running' : 'idle' })
  }
  const previous = occupancy
  occupancy = computeOccupancy(facts)
  lastOccupancyAt = Date.now()
  const inUse = Object.keys(occupancy).length
  const changed =
    Object.keys(previous).length !== inUse ||
    Object.keys(occupancy).some((key) => (previous[key]?.owners ?? []).join(',') !== occupancy[key].owners.join(','))
  if (changed) {
    log({
      ts: lastOccupancyAt,
      event: 'occupancy',
      reason: `占用刷新（${reason}）：sessions=${facts.length} inUseModels=${inUse}`,
      owners: Object.keys(occupancy).map((key) => `${key.replace('\u0000', '/')}<-${occupancy[key].owners.join('|')}`).slice(0, 32),
    })
  }
  return occupancy
}

// ─────────────────────────── 冷却（全部不可用后 30 分钟） ───────────────────────────

function enterCooldown(reason: string, session: any) {
  const now = Date.now()
  if (cooldownActive(cooldown, now)) return
  cooldown = { until: now + cfg.cooldownMs, enteredAt: now, reason }
  // 新一段冷却：抑制日志重新从「立刻记一条」开始
  cooldownSuppressLogAt = 0
  cooldownSuppressCount = 0
  const record = log({
    ts: now,
    event: 'cooldown',
    reasonCode: 'cooldown',
    reason,
    cooldownUntil: cooldown.until,
    cooldownRemainingMs: cfg.cooldownMs,
    version: PLUGIN_VERSION,
  })
  recordToSession(session, record)
  scheduleCooldownEnd()
}

function scheduleCooldownEnd() {
  if (cooldownTimer !== null) clearTimeout(cooldownTimer)
  const remaining = cooldownRemaining(cooldown, Date.now())
  if (remaining <= 0) return
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null
    void wakeFromCooldown()
  }, Math.min(remaining, 2_147_483_000))
  if (typeof cooldownTimer?.unref === 'function') cooldownTimer.unref()
}

/** 冷却结束：清空模型级冷却与会话排除表，重新拉一次目录，继续走选择逻辑。 */
async function wakeFromCooldown() {
  const now = Date.now()
  if (cooldownActive(cooldown, now)) {
    scheduleCooldownEnd()
    return
  }
  const wasUntil = cooldown.until
  if (wasUntil === 0) return
  cooldown = { until: 0, enteredAt: 0, reason: '' }
  cooldownSuppressLogAt = 0
  cooldownSuppressCount = 0
  modelCooldown.clear()
  for (const state of sessions.values()) state.excluded = []
  const snapshot = await getCatalog(true)
  log({
    ts: Date.now(),
    event: 'cooldown-end',
    reason: `冷却结束（持续 ${cfg.cooldownMs}ms），已重新获取目录：${snapshot.entries.length} 个模型`,
    catalogSize: snapshot.entries.length,
  })
  // 冷却结束后立刻给正在等待的会话重新选一个模型（不主动触发请求，只更新选择）
  for (const agent of liveAgents()) {
    const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
    const state = sessions.get(sessionId)
    if (state === undefined || state.current !== null) continue
    void applySelection(agent, state.kind, 'cooldown-end', { allowPreferred: true })
  }
}

// ─────────────────────────── 目录就绪后的恢复选择 ───────────────────────────

/**
 * provider 集合是否已经「稳定」：距最近一次集合变化已超过 CATALOG_SETTLE_MS。
 * 启动早期 llm 的 provider 是陆续注册的，集合不稳时「没有候选」不代表模型真不可用，
 * 因此这段时间内既不下无候选结论、也不进冷却——真机日志里正是这里锁死了 30 分钟。
 */
function catalogSettled(now = Date.now()): boolean {
  if (!catalogReady) return false
  if (catalogProvidersAt === 0) return true // 从未观察到集合变化（测试/单 provider 场景）
  return now - catalogProvidersAt >= CATALOG_SETTLE_MS
}

/**
 * 目录从「未就绪」翻转为「已就绪」后，给那些在空窗口里创建、尚未选定模型的会话补一次自动选择。
 * 只处理已登记（sessions 里有状态）且 current===null 的会话，避免对无关会话越俎代庖。
 */
async function recoverSelections(trigger = 'catalog-ready') {
  for (const [sessionId, state] of sessions) {
    if (state.current !== null) continue
    const agent = liveAgents().find((a) => String(a?.id ?? a?.session?.id ?? '') === sessionId)
    if (agent === undefined) continue
    void applySelection(agent, state.kind, trigger, { allowPreferred: true })
  }
}

/**
 * 合并短时间内的多次目录过期信号，避免一次启动注册几十个 provider 就重建几十次目录。
 * 最多连续追 MAX_CATALOG_REFRESH_ATTEMPTS 轮：provider 集合如果一直在变（插件热装/卸载循环），
 * 不能无限自激重建——超过上限就交给 15s 轮询与 TTL 兜底，绝不进冷却。
 */
const MAX_CATALOG_REFRESH_ATTEMPTS = 20
let catalogRefreshAttempts = 0

function scheduleCatalogRefresh() {
  if (adaptersTimer !== null) return
  // 轻微退避：追得越久间隔越长（800ms → 3.2s 封顶），避免 provider 注册持续很久时把宿主拖进重建风暴。
  const delay = ADAPTERS_REFRESH_DEBOUNCE_MS * Math.min(Math.max(catalogRefreshAttempts, 1), 4)
  adaptersTimer = setTimeout(() => {
    adaptersTimer = null
    catalogRefreshAttempts += 1
    void getCatalog(true).then(() => {
      if (!catalogSettled() && catalogRefreshAttempts < MAX_CATALOG_REFRESH_ATTEMPTS) {
        // 还没稳定：继续等下一轮，别急着下结论。
        scheduleCatalogRefresh()
        return
      }
      catalogRefreshAttempts = 0
      // 稳定了（或追够上限了）：把此前因为「集合还在变」而跳过选择的会话补回来。
      void recoverSelections('catalog-settled')
    })
  }, delay)
  if (typeof adaptersTimer?.unref === 'function') adaptersTimer.unref()
}

// ─────────────────────────── 选择与接管 ───────────────────────────

function currentKind(key: string | null): ModelKind {
  if (key === null) return 'text'
  const entry = indexByKey(catalog.entries).get(key)
  return entry?.kind ?? 'text'
}

/** 用目录条目把宿主的当前模型 key 还原成一条 Selection（仅供展示与「是否已切换」比对）。 */
function hostSelection(key: string, now: number): Selection | null {
  const entry = indexByKey(catalog.entries).get(key)
  if (entry === undefined) {
    // 目录里没有这个 key（模型已下线或 provider 未注册）：仍用 key 自身拼一条，保证下拉能显示模型名。
    const at = key.indexOf('/')
    if (at <= 0 || at === key.length - 1) return null
    const provider = key.slice(0, at)
    const model = key.slice(at + 1)
    return {
      key,
      provider,
      model,
      name: model,
      kind: 'text',
      reasonCode: 'host-current',
      reason: '宿主的当前选择（目录里暂无该模型）',
      orderIndex: -1,
      idle: occupancy[key]?.inUse !== true,
      owners: occupancy[key]?.owners ?? [],
    }
  }
  return {
    key,
    provider: entry.provider,
    model: entry.model,
    name: entry.name,
    kind: entry.kind,
    reasonCode: 'host-current',
    reason: '宿主的当前选择',
    orderIndex: -1,
    idle: occupancy[key]?.inUse !== true,
    owners: occupancy[key]?.owners ?? [],
  }
}

function sessionState(sessionId: string, preferredKey: string | null, now: number): SessionState {
  const existing = sessions.get(sessionId)
  if (existing !== undefined) return existing
  const kind = currentKind(preferredKey)
  const state = newSessionState(sessionId, kind, null, now)
  sessions.set(sessionId, state)
  return state
}

function preferredKeyFor(agent: any): string | null {
  if (cfg.defaultModel !== null) return modelKey(cfg.defaultModel.provider, cfg.defaultModel.model)
  const host = agentSelectionKey(agent)
  if (host !== null) return host
  try {
    const dflt = ctxRef?.get?.('agentDefaultModel')?.currentSelection?.()
    if (dflt !== undefined && dflt !== null) return modelKey(dflt.provider, dflt.model)
  } catch {
    /* ignore */
  }
  return null
}

function reasonText(selection: Selection): string {
  return `${selection.reasonCode}: ${selection.reason}`
}

/**
 * 把选择真正写进宿主。
 * 宿主 dsh-agent-loop 在 step preparation 时已用 this.model.current() 固定 selection，
 * 之后 agent/request 瀑布里改 provider/model 会直接抛致命错（m01524/m01547）。
 * 因此只走宿主认可的「step 之前」入口：优先 agent.model.select()，次选旧宿主
 * sessionController.agents.selectForNextRequest()。两者都拿不到时只记日志、不改写请求。
 * 返回本次落地用的通道名（日志/响应里透传，客户端不读它）。
 */
function commitSelection(agent: any, selection: Selection, source: string): string {
  // 按模型预配置的推理等级：键 'provider/model'；仅当该模型当前目录仍声明该 id 时才采用，
  // 配置失效时回落默认（不报错、不猜测）。
  const configuredEffort = (() => {
    const key = `${selection.provider}/${selection.model}`
    const item = cfg.modelEfforts.find((entry) => entry.key === key)
    if (item === undefined) return undefined
    const modelEntry = catalog.entries.find((entry) => entry.key === selection.key)
    return modelEntry?.reasoning?.efforts?.some((level: any) => level.id === item.effort) === true
      ? item.effort
      : undefined
  })()
  const payload = {
    provider: selection.provider,
    model: selection.model,
    // 推理等级优先级：手动选择带的显式 effort > 按模型预配置 > 默认模型旧规则。
    ...(selection.reasoningEffort !== undefined
      ? { reasoningEffort: selection.reasoningEffort }
      : configuredEffort !== undefined
        ? { reasoningEffort: configuredEffort }
        : cfg.defaultModel !== null &&
          cfg.defaultModel.provider === selection.provider &&
          cfg.defaultModel.model === selection.model &&
          cfg.defaultModel.reasoningEffort !== undefined
          ? { reasoningEffort: cfg.defaultModel.reasoningEffort }
          : {}),
  }
  // 1) 宿主认可的入口：AgentModel.select()，与 dsh-api-session-controller 的 selectModel 一致
  try {
    if (typeof agent?.model?.select === 'function') {
      agent.model.select(payload)
      return 'agent.model.select'
    }
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'config',
      reason: `agent.model.select 不可用（${source}），尝试 selectForNextRequest`,
      failureMessage: String((err as Error)?.message ?? err),
    })
  }
  // 2) 旧宿主兼容入口
  try {
    const controller = ctxRef?.get?.('sessionController')
    const agentsApi = controller?.agents
    if (agentsApi !== undefined && typeof agentsApi.selectForNextRequest === 'function') {
      agentsApi.selectForNextRequest(agent, payload)
      return 'selectForNextRequest'
    }
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'config',
      reason: `selectForNextRequest 不可用（${source}），本次选择未落地`,
      failureMessage: String((err as Error)?.message ?? err),
    })
  }
  // 3) 两个入口都不可用：绝不退回 agent/request 瀑布改写（会致命），仅记录并降级
  log({
    ts: Date.now(),
    event: 'config',
    reason: `无可用切模型入口（${source}），本次选择仅更新插件内部状态，未写入宿主`,
  })
  return 'unavailable'
}

async function applySelection(
  agent: any,
  kind: ModelKind,
  trigger: string,
  options: { allowPreferred: boolean },
): Promise<Selection | null> {
  const now = Date.now()
  const snapshot = await getCatalog(false)
  refreshOccupancy(trigger)
  const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
  const preferred = options.allowPreferred ? preferredKeyFor(agent) : null
  const state = sessionState(sessionId, preferred, now)
  state.kind = kind
  // 切换作用域按「首选模型 → 会话当前模型」反查分组：拿不到分组就是全量（旧行为）。
  const scopeGroups = scopeGroupsOf(snapshot.entries, preferred ?? state.current?.key ?? null, cfg)
  const selection = selectModel({
    catalog: snapshot,
    kind,
    preferredKey: preferred,
    occupancy,
    excluded: state.excluded,
    modelCooldown: modelCooldown.get(sessionId) ?? {},
    now,
    cfg,
    scopeGroups,
    probeUnavailable: [...probeUnavailable, ...probeInfra],
  })
  if (selection === null) {
    // 目录还没就绪（启动早期 llm 未注册）：此时没有候选是「还没好」而非「真不可用」，
    // 不能进冷却（否则会锁死 30 分钟），留待目录就绪后由 recoverSelections 补选。
    if (!catalogReady) {
      const record = log({
        ts: now,
        event: 'select',
        sessionId,
        kind,
        reasonCode: 'catalog-not-ready',
        reason: `目录尚未就绪（catalog=${snapshot.entries.length}），跳过选择，待就绪后恢复`,
        catalogSize: snapshot.entries.length,
      })
      recordToSession(agent?.session, record)
      return null
    }
    // 就绪但 provider 集合刚变过（启动期 provider 还在陆续注册）：这时「没有候选」同样不可信。
    // 真机证据：先看到 8 个 provider / 27 条 → 判无候选 → 进 30min 冷却；完整是 27 个 / 172 条。
    if (!catalogSettled(now)) {
      const record = log({
        ts: now,
        event: 'select',
        sessionId,
        kind,
        reasonCode: 'catalog-settling',
        reason:
          `provider 集合仍在变化（${catalogProviders.length} 个，${now - catalogProvidersAt}ms 前刚变过），` +
          `暂缓判定无候选，稍后重试（catalog=${snapshot.entries.length}）`,
        catalogSize: snapshot.entries.length,
      })
      recordToSession(agent?.session, record)
      // 立刻排一次强制重建：provider 注册完就把真实目录拉齐，不必等 60s TTL 或 5s 轮询。
      scheduleCatalogRefresh()
      return null
    }
    const record = log({
      ts: now,
      event: 'select',
      sessionId,
      kind,
      reasonCode: 'no-candidate',
      reason: `没有可用的 ${kind} 模型（catalog=${snapshot.entries.length}）`,
      catalogSize: snapshot.entries.length,
    })
    recordToSession(agent?.session, record)
    enterCooldown(`会话 ${sessionId} 无可用 ${kind} 模型`, agent?.session)
    return null
  }
  // trackedSessions 会用宿主当前选择回填 state.current（reasonCode='host-current'），
  // 那样 changed 恒为 false、本次真正的决策就不会留下 select 记录。
  // 因此「上一次只是宿主回填」也算需要记录。
  const backfilled = state.current?.reasonCode === 'host-current'
  const changed = backfilled || state.current?.key !== selection.key
  state.current = selection
  state.updatedAt = now
  const via = commitSelection(agent, selection, trigger)
  if (changed) {
    const record = log({
      ts: now,
      event: 'select',
      sessionId,
      kind,
      to: selection.key,
      reasonCode: selection.reasonCode,
      reason: `${trigger} → ${reasonText(selection)}`,
      orderIndex: selection.orderIndex,
      owners: selection.owners,
      catalogSize: snapshot.entries.length,
      idleCandidates: byKind(snapshot.entries, kind).filter((entry) => occupancy[entry.key]?.inUse !== true).length,
      via,
    })
    recordToSession(agent?.session, record)
  }
  return selection
}

// ─────────────────────────── 出错 → 重试 / 切换 / 冷却 ───────────────────────────

async function handleRequestError(payload: any): Promise<{ kind: 'retry' } | undefined> {
  const agent = payload?.agent
  if (agent === undefined || agent === null) return undefined
  const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
  const failure = payload?.failure ?? {}
  // 0.1.8：沿 cause / errors[] 剥壳取真实失败面，避免 AggregateError 把 code 藏在里层被当成 UNKNOWN。
  const face = failureFaceOf(failure)
  const fields = fieldsOf(face)
  const code = fields.code || String(failure?.code ?? 'UNKNOWN')
  const message = String(failure?.message ?? '')
  // 宿主是否负责这类错误（normal 模式且码表内）：是则直接切模型，不叠加插件自己的重试等待。
  const policy = payload?.retryPolicy
  const hostOwns =
    policy?.mode === 'normal' &&
    Array.isArray(policy?.retryableCodes) &&
    policy.retryableCodes.includes(code)
  const now = Date.now()
  const state = sessions.get(sessionId) ?? sessionState(sessionId, preferredKeyFor(agent), now)
  state.attempts += 1
  state.updatedAt = now

  const snapshot = await getCatalog(false)
  refreshOccupancy('request-error')
  // 切换作用域跟着「当前失败的模型」走：它属于哪一组，就优先在哪一组里换。
  const scopeGroups = scopeGroupsOf(snapshot.entries, state.current?.key ?? preferredKeyFor(agent), cfg)
  // 0.1.8：新分类只在「真实宿主事件」上启用——真实 request-error 一定带 retryPolicy
  // （dsh-llm 无条件补默认策略）；老的直接调用（无 retryPolicy）不带，保持旧逻辑兼容。
  // 这条边界由宿主契约坐实，不是为过测而加的特判。
  const coordination = policy !== undefined && policy !== null
    ? { classification: classifyFailure(face), hostOwns, retryAfterMs: fields.retryAfterMs }
    : {}
  const decision = decideOnError({
    state,
    failureCode: code,
    failureMessage: message,
    aborted: payload?.signal?.aborted === true,
    catalog: snapshot,
    occupancy,
    modelCooldown: modelCooldown.get(sessionId) ?? {},
    cooldown,
    now,
    cfg,
    scopeGroups,
    probeUnavailable: [...probeUnavailable, ...probeInfra],
    ...coordination,
  })

  if (decision.action === 'giveup') {
    const record = log({
      ts: now,
      event: 'giveup',
      sessionId,
      turn: payload?.turn,
      step: payload?.step,
      from: state.current?.key,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      failureCode: code,
      failureMessage: message,
      attempts: state.attempts,
      retriesUsed: state.retriesUsed,
      maxRetries: cfg.maxRetries,
    })
    recordToSession(agent?.session, record)
    return undefined
  }

  if (decision.action === 'retry') {
    state.retriesUsed = decision.retriesUsed
    state.attempts = decision.attempts
    const record = log({
      ts: now,
      event: 'retry',
      sessionId,
      turn: payload?.turn,
      step: payload?.step,
      from: state.current?.key,
      reasonCode: 'retry',
      reason: decision.reason,
      attempts: decision.attempts,
      retriesUsed: decision.retriesUsed,
      maxRetries: cfg.maxRetries,
      delayMs: decision.delayMs,
      failureCode: code,
      failureMessage: message,
    })
    recordToSession(agent?.session, record)
    if (decision.delayMs > 0) await delay(decision.delayMs, payload?.signal)
    return { kind: 'retry' }
  }

  if (decision.action === 'switch') {
    const previous = state.current
    state.current = decision.next
    state.switches += 1
    state.retriesUsed = 0
    state.attempts = 0
    if (previous !== null && !state.excluded.includes(previous.key)) state.excluded.push(previous.key)
    const via = commitSelection(agent, decision.next, 'switch')
    const record = log({
      ts: now,
      event: 'switch',
      sessionId,
      turn: payload?.turn,
      step: payload?.step,
      kind: state.kind,
      from: previous?.key,
      to: decision.next.key,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      orderIndex: decision.next.orderIndex,
      owners: decision.next.owners,
      switches: state.switches,
      attempts: state.attempts,
      retriesUsed: 0,
      maxRetries: cfg.maxRetries,
      delayMs: decision.delayMs,
      failureCode: code,
      failureMessage: message,
      via,
    })
    recordToSession(agent?.session, record)
    if (decision.delayMs > 0) await delay(decision.delayMs, payload?.signal)
    return { kind: 'retry' }
  }

  // cooldown
  enterCooldown(decision.reason, agent?.session)
  const record = log({
    ts: now,
    event: 'cooldown',
    sessionId,
    turn: payload?.turn,
    step: payload?.step,
    kind: state.kind,
    from: state.current?.key,
    reasonCode: 'cooldown',
    reason: decision.reason,
    cooldownUntil: decision.cooldownUntil,
    cooldownRemainingMs: Math.max(0, decision.cooldownUntil - now),
    failureCode: code,
  })
  recordToSession(agent?.session, record)
  return undefined
}

// ─────────────────────── 0.1.9 双能力：会话服务与运行时 ───────────────────────

/** 动态解析宿主服务：缺失或抛错一律降级为 undefined（fail-closed，绝不阻断插件其它能力）。 */
function svc(name: string): any {
  try {
    const ctx = ctxRef
    if (ctx === undefined || ctx === null) return undefined
    if (typeof ctx.get === 'function') {
      const found = ctx.get(name)
      if (found !== undefined && found !== null) return found
    }
    const direct = (ctx as any)[name]
    return direct === undefined || direct === null ? undefined : direct
  } catch {
    return undefined
  }
}

/** 续作/交接消息工厂：宿主在载时用真实 createUserMessage；离线门禁走逐字节镜像兜底。 */
let userMessageFactory: ((input: any) => any) | null = null
async function resolveCreateUserMessage(): Promise<(input: any) => any> {
  if (userMessageFactory !== null) return userMessageFactory
  try {
    const mod: any = await import('@deepseek-ai/dsh-llm')
    if (typeof mod?.createUserMessage === 'function') {
      userMessageFactory = mod.createUserMessage
      return userMessageFactory
    }
  } catch {
    /* 离线门禁 / 解析失败 → 镜像兜底 */
  }
  const deepFreeze = (value: any): any => {
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) deepFreeze(item)
      Object.freeze(value)
    }
    return value
  }
  userMessageFactory = (input: any) => deepFreeze(structuredClone({ ...input, role: 'user', id: crypto.randomUUID() }))
  return userMessageFactory
}

/** 失败是否指向「模型 / 端点不可用」——据此在续作前先切模型。认不准就不切（fail-closed）。 */
function isModelUnavailableFailure(code: string, status: number | undefined): boolean {
  if (code === 'NO_ADAPTER' || code === 'INVALID_MODEL_CONTEXT' || code === 'MODEL_UNSUPPORTED') return true
  if (code === 'TRANSPORT' || code === 'STREAM_CLOSED') return true
  if (typeof status === 'number' && (status === 404 || status === 502 || status === 503 || status === 504)) return true
  return false
}

/** 失败是否是「用户主动中止 / 取消」——中止绝不续作。沿 cause 链最多看 3 层。 */
function isAbortedFailure(error: unknown): boolean {
  const seen = new Set<unknown>()
  let cur: any = error
  for (let depth = 0; depth < 3 && cur !== null && typeof cur === 'object' && !seen.has(cur); depth += 1) {
    seen.add(cur)
    const name = typeof cur.name === 'string' ? cur.name : ''
    const code = typeof cur.code === 'string' ? cur.code : ''
    const message = typeof cur.message === 'string' ? cur.message : ''
    const hay = `${name} ${code} ${message}`.toLowerCase()
    if (hay.includes('abort') || hay.includes('cancel')) return true
    cur = cur.cause
  }
  return false
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * 能力 1：回合级错误处理（0.1.9）。
 * fail-closed：开关关 / 非瞬时错误 / 用户中止 / 配额触顶 / 同一回合重复 → 一律不续作。
 */
async function handleAgentError(payload: any): Promise<void> {
  try {
    if (!cfg.enabled) return
    const agent = payload?.agent
    const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
    if (sessionId.length === 0) return
    const turn = typeof payload?.turn === 'number' ? payload.turn : null
    const error = payload?.error
    const face = failureFaceOf(error)
    const fields = fieldsOf(face)
    const entry = resumeLedger.get(sessionId) ?? { consecutive: 0, session: 0, lastHandledTurn: null }
    // 旧轮重放防护：同一回合只处理一次。
    if (turn !== null && entry.lastHandledTurn === turn) return
    const decision = decideResume({
      cfg,
      classification: classifyFailure(face),
      // 回合级 = 宿主请求级重试链早已结束，此时续作是「开新回合」而非「叠加重试」，
      // 所以不按宿主码表拦截（用户 2026-11-22 拍板：回合级视为宿主已放手）。
      hostOwns: false,
      aborted: isAbortedFailure(error),
      consecutiveCount: entry.consecutive,
      sessionCount: entry.session,
      modelUnavailable: isModelUnavailableFailure(fields.code, fields.status),
    })
    if (decision.action !== 'resume') {
      const record = log({
        ts: Date.now(),
        event: 'giveup',
        sessionId,
        turn: payload?.turn,
        step: payload?.step,
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        failureCode: fields.code,
        failureMessage: typeof error?.message === 'string' ? error.message : undefined,
      })
      recordToSession(agent?.session, record)
      return
    }
    // 先切模型：仅当失败明确指向模型/端点不可用时，切到下一个健康模型。
    if (decision.switchModel) {
      try {
        const now = Date.now()
        const state = sessions.get(sessionId) ?? sessionState(sessionId, null, now)
        const currentKey = agentSelectionKey(agent)
        if (currentKey !== null && currentKey.length > 0 && !state.excluded.includes(currentKey)) {
          state.excluded.push(currentKey)
        }
        sessions.set(sessionId, state)
        await applySelection(agent, state.kind, 'resume-switch', { allowPreferred: false })
      } catch (err) {
        log({
          ts: Date.now(),
          event: 'giveup',
          sessionId,
          reasonCode: 'resume-switch-failed',
          reason: '续作前切模型失败，沿用当前模型继续',
          failureMessage: String((err as Error)?.message ?? err),
        })
      }
    }
    // 投递固定模板续作消息（不拼错误原文）。
    const text = `${RESUME_TEXT_PREFIX}${cfg.autoResumeContinuePrompt ?? ''}`
    const createUserMessage = await resolveCreateUserMessage()
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin:dsh-model-picker' },
    })
    agent?.followup?.(message)
    // 账本：连续计数 +1、整会话累计 +1、记下已处理轮次水位。
    resumeLedger.set(sessionId, {
      consecutive: entry.consecutive + 1,
      session: entry.session + 1,
      lastHandledTurn: turn,
    })
    const record = log({
      ts: Date.now(),
      event: 'resume',
      sessionId,
      turn: payload?.turn,
      step: payload?.step,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      failureCode: fields.code,
      failureMessage: typeof error?.message === 'string' ? error.message : undefined,
    })
    recordToSession(agent?.session, record)
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'giveup',
      reasonCode: 'resume-internal-error',
      reason: '自动继续内部异常，交回宿主',
      failureMessage: String((err as Error)?.message ?? err),
    })
  }
}

/** 读取上下文占用：fail-closed —— 数据缺失一律 null（后续判定为「不动作」）。 */
function readOccupancy(session: any): { occupancy: number | null; contextWindow: number | null } {
  try {
    const projections = svc('sessionProjections')
    if (projections === undefined || typeof projections.snapshot !== 'function') {
      return { occupancy: null, contextWindow: null }
    }
    const snapshot = projections.snapshot(session, ['contextPressure'])
    const view = snapshot?.values?.contextPressure
    if (view === undefined || view === null) return { occupancy: null, contextWindow: null }
    const occupancy =
      typeof view.projectedTokens === 'number'
        ? view.projectedTokens
        : typeof view.pressureTokens === 'number'
          ? view.pressureTokens
          : null
    const contextWindow = typeof view.contextWindow === 'number' ? view.contextWindow : null
    return { occupancy, contextWindow }
  } catch {
    return { occupancy: null, contextWindow: null }
  }
}

/** 读会话标题（读不到就退回 session id）。 */
function readSessionTitle(session: any): string | null {
  try {
    const titles = svc('sessionTitle')
    const snap = titles?.get?.(session)
    if (typeof snap?.title === 'string' && snap.title.trim() !== '') return snap.title
  } catch {
    /* 标题快照不可读 → 退回 session id */
  }
  return null
}

/** 交接文本模板：标准交接头 + 可配续作指令（不拼父会话正文、不含错误原文）。 */
function buildHandoffText(seqNo: number, parentTitle: string, parentSessionId: string, continuePrompt: string): string {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  return (
    `[交接] 你是第 ${seqNo} 次升级接棒会话。父会话：「${parentTitle}」(${parentSessionId})，交接时间 ${date} ${time}。\n` +
    `父会话历史未随本会话继承，细节可回查父会话（session ${parentSessionId}）。\n` +
    `${continuePrompt}`
  )
}

/** 给新会话命名（可配）：按「父会话标题-日期-时间」。失败只记日志，不阻断升级。 */
function renameChildSession(childSession: any, parentSession: any): void {
  try {
    const titles = svc('sessionTitle')
    if (titles === undefined || typeof titles.rename !== 'function') return
    if (childSession === undefined || childSession === null) return
    const parentTitle = readSessionTitle(parentSession) ?? '会话'
    const now = new Date()
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`
    titles.rename(childSession, `${parentTitle}-${stamp}`)
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'escalate',
      reasonCode: 'escalate-rename-failed',
      reason: '给新会话命名失败，不影响升级结果',
      failureMessage: String((err as Error)?.message ?? err),
    })
  }
}

/** 建新会话 + 交接 + 归档父会话 + 写待跳转队列（对齐宿主 controller fork 与 escalation 已验证顺序）。 */
async function doEscalateSession(agent: any, parentSessionId: string, entry: EscalationLedgerEntry): Promise<void> {
  const agentsSvc = svc('agents')
  const create = agentsSvc?.create
  if (typeof create !== 'function') return
  const parentSession = agent?.session
  const header = parentSession?.header ?? {}
  const childId = `session-${crypto.randomUUID()}`
  const seqNo = entry.escalations + 1
  // 元数据只带 cwd / agentPreset —— 不设 parentSession：子会话与父会话同级独立。
  const meta: Record<string, unknown> = {}
  if (header.cwd !== undefined) meta.cwd = header.cwd
  if (header.agentPreset !== undefined) meta.agentPreset = header.agentPreset
  // 沿用父会话当前模型（认不准就交给宿主默认）。
  const agentOptions: Record<string, unknown> = {}
  try {
    const current = agent?.model?.current?.()
    if (current?.provider !== undefined && current?.model !== undefined) {
      agentOptions.provider = current.provider
      agentOptions.model = current.model
      if (current.reasoningEffort !== undefined) agentOptions.reasoningEffort = current.reasoningEffort
    }
  } catch {
    /* 探测失败 → 空 agentOptions，宿主默认兜底 */
  }
  let setup: any
  try {
    const presets = svc('agentPresets')
    if (presets !== undefined && typeof presets.resolve === 'function' && typeof presets.mount === 'function') {
      const resolved = await presets.resolve(header.agentPreset ?? undefined)
      setup = async (agentCtx: any) => {
        await presets.mount(agentCtx, resolved.id)
      }
    }
  } catch {
    /* preset 解析失败 → 不传 setup，宿主用默认 preset */
  }
  let handle: any
  try {
    handle = await create.call(agentsSvc, {
      sessionId: childId,
      meta,
      ...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }),
      ...(setup === undefined ? {} : { setup }),
    })
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'escalate',
      sessionId: parentSessionId,
      reasonCode: 'escalate-create-failed',
      reason: '新会话建立失败，不升级',
      failureMessage: String((err as Error)?.message ?? err),
    })
    return
  }
  const childAgent = handle?.agent ?? handle
  // 把新会话挂到父会话所在的 workspace（对齐宿主 controller fork 配方 :301-311 与
  // dsh-session-escalation :414-421）：不挂的话子会话不在会话列表里，用户在侧边栏看不到它。
  // 失败只记日志 —— 分支已经建好，回滚代价更大。
  try {
    const registry = svc('workspaceRegistry')
    const workspaces = typeof registry?.list === 'function' ? registry.list() : undefined
    const workspace = Array.isArray(workspaces)
      ? workspaces.find((candidate: any) => Array.isArray(candidate?.sessionIds) && candidate.sessionIds.includes(parentSessionId))
      : undefined
    if (workspace !== undefined && typeof workspace.attachSession === 'function') {
      await workspace.attachSession(childId)
    }
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'escalate',
      sessionId: parentSessionId,
      to: childId,
      reasonCode: 'escalate-attach-failed',
      reason: '新会话挂到 workspace 失败（不影响升级结果）',
      failureMessage: String((err as Error)?.message ?? err),
    })
  }
  // 投递交接消息。
  try {
    const parentTitle = readSessionTitle(parentSession) ?? parentSessionId
    const text = buildHandoffText(seqNo, parentTitle, parentSessionId, cfg.escalateContinuePrompt ?? '')
    const createUserMessage = await resolveCreateUserMessage()
    childAgent?.followup?.(
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin:dsh-model-picker', parentSessionId, boundarySeq: null },
      }),
    )
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'escalate',
      sessionId: parentSessionId,
      reasonCode: 'escalate-handoff-failed',
      reason: '交接消息投递失败，新会话已建立',
      failureMessage: String((err as Error)?.message ?? err),
    })
  }
  // 归档父会话：宿主原生可逆；失败只 warn，不回滚已建的新会话。
  if (cfg.escalateArchiveParent !== false) {
    try {
      const registry = svc('workspaceRegistry')
      if (registry === undefined || typeof registry.archiveSession !== 'function') {
        log({
          ts: Date.now(),
          event: 'escalate',
          sessionId: parentSessionId,
          reasonCode: 'escalate-archive-unavailable',
          reason: 'workspaceRegistry.archiveSession 缺席，旧会话不归档（保留在会话列表）',
        })
      } else {
        await registry.archiveSession(parentSessionId, { stopActivity: true })
      }
    } catch (err) {
      log({
        ts: Date.now(),
        event: 'escalate',
        sessionId: parentSessionId,
        reasonCode: 'escalate-archive-failed',
        reason: '归档旧会话被拒（升级不受影响）',
        failureMessage: String((err as Error)?.message ?? err),
      })
    }
  }
  if (cfg.escalateRenameChild !== false) renameChildSession(childAgent?.session, parentSession)
  // 账本：父会话记已升级；子会话继承链深（+1）并拿到完整额度。
  escalationLedger.set(parentSessionId, {
    escalations: entry.escalations + 1,
    depth: entry.depth,
    escalatedTo: childId,
    lastTurnCompleted: entry.lastTurnCompleted,
  })
  escalationLedger.set(childId, { escalations: 0, depth: entry.depth + 1, escalatedTo: null, lastTurnCompleted: false })
  // 待跳转：client 半边轮询取走后跳到新会话。
  pendingNavigation.push(childId)
  log({
    ts: Date.now(),
    event: 'escalate',
    sessionId: parentSessionId,
    to: childId,
    reasonCode: 'escalate-done',
    reason: `已升级到新会话 ${childId}（链深 ${entry.depth + 1}）`,
  })
}

/**
 * 能力 2：上下文阈值升级评估（0.1.9）。
 * fail-closed：服务缺失 / 占用数据缺失 / 回合未正常完成 / 会话繁忙 / 额度触顶 → 不动作。
 */
async function evaluateEscalationForSession(sessionId: string, trigger: string): Promise<void> {
  try {
    if (!cfg.enabled) return
    if (cfg.escalateEnabled !== true) return
    if (sessionId.length === 0) return
    const entry = escalationLedger.get(sessionId) ?? { escalations: 0, depth: 0, escalatedTo: null, lastTurnCompleted: false }
    // 只升级本插件自己发起的升级：一个会话已升级过就不再升级。
    if (entry.escalatedTo !== null) return
    const agentsSvc = svc('agents')
    const agent =
      agentsSvc !== undefined && typeof agentsSvc.get === 'function' ? agentsSvc.get(sessionId) : undefined
    if (agent === undefined || agent === null) return
    const { occupancy, contextWindow } = readOccupancy(agent.session)
    const decision = decideEscalate({
      cfg,
      occupancy,
      contextWindow,
      chainDepth: entry.depth,
      escalationsDone: entry.escalations,
      agentIdle: agent.status === 'idle',
      turnCompleted: entry.lastTurnCompleted,
    })
    if (decision.action !== 'escalate') return
    await doEscalateSession(agent, sessionId, entry)
    void trigger
  } catch (err) {
    log({
      ts: Date.now(),
      event: 'escalate',
      sessionId,
      reasonCode: 'escalate-internal-error',
      reason: '升级评估内部异常，不动作',
      failureMessage: String((err as Error)?.message ?? err),
    })
  }
}

function delay(ms: number, signal: any): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

// ─────────────────────────── HTTP 接口 ───────────────────────────

const BODY_TOO_LARGE = Symbol('body-too-large')

function sendJson(res: any, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(body.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(body)
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // 摘掉监听后必须 resume（而不是 pause）把剩余字节流走：
        // pause 会让对端一直等，连接残留导致后续请求 ECONNRESET。
        req.removeListener('data', onData)
        req.resume?.()
        reject(BODY_TOO_LARGE)
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (err: unknown) => reject(err))
  })
}

function isSameOrigin(req: any): boolean {
  const site = req.headers?.['sec-fetch-site']
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function sanitizeBeacon(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input === null || typeof input !== 'object') return { ts: Date.now() }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!BEACON_KEYS.includes(key)) continue
    if (value === undefined || value === null) continue
    if (typeof value === 'string') out[key] = value.slice(0, BEACON_TEXT_LEN)
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
    else {
      try {
        out[key] = JSON.stringify(value).slice(0, BEACON_TEXT_LEN)
      } catch {
        out[key] = '[unserializable]'
      }
    }
  }
  out.ts = Date.now()
  return out
}

function catalogView(snapshot: CatalogSnapshot) {
  const now = Date.now()
  return {
    version: PLUGIN_VERSION,
    generatedAt: snapshot.generatedAt,
    providerCount: snapshot.providerCount,
    entries: snapshot.entries.map((entry) => ({
      key: entry.key,
      provider: entry.provider,
      providerName: entry.providerName,
      providerSettingsNs: entry.providerSettingsNs,
      model: entry.model,
      name: entry.name,
      kind: entry.kind,
      modalities: entry.modalities,
      modalitySource: entry.modalitySource,
      sortKey: entry.sortKey,
      ...(entry.priceFactor === undefined ? {} : { priceFactor: entry.priceFactor }),
      priceClass: entry.priceClass ?? priceClassOf(entry.name, entry.priceFactor),
      free: entry.free,
      disabled: entry.disabled,
      hidden: entry.hidden,
      ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
      ...(entry.reasoning === undefined ? {} : { reasoning: entry.reasoning }),
    })),
    // 界面直接可渲染的分组：用户自定义规则优先，其次「所有来源的多模态一组 / 纯文本一组」
    groups: groupCatalog(snapshot.entries, cfg).map((group) => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      custom: group.custom,
      keys: group.entries.map((entry) => entry.key),
    })),
    failures: snapshot.failures,
    unavailableModels: [...probeUnavailable],
    unavailableInfra: [...probeInfra],
    occupancy,
    cooldown: { active: cooldownActive(cooldown, now), until: cooldown.until, remainingMs: cooldownRemaining(cooldown, now), reason: cooldown.reason },
    // 每个活跃会话都要有一行：插件加载前就存在的会话没有 state，
    // 这里按宿主的当前选择补一条，否则下拉的「当前模型」会退化成占位文案。
    sessions: [...trackedSessions(Date.now()).values()].map((state) => ({
      sessionId: state.sessionId,
      kind: state.kind,
      current: state.current?.key ?? null,
      reasonCode: state.current?.reasonCode ?? null,
      attempts: state.attempts,
      retriesUsed: state.retriesUsed,
      switches: state.switches,
      excluded: state.excluded,
    })),
    config: {
      defaultModel: cfg.defaultModel,
      maxRetries: cfg.maxRetries,
      retryDelayMs: cfg.retryDelayMs,
      providerOrder: cfg.providerOrder,
      modelOrder: cfg.modelOrder,
      preferIdle: cfg.preferIdle,
      cooldownMs: cfg.cooldownMs,
      cooldownRefreshBlocked: cfg.cooldownRefreshBlocked,
      catalogTtlMs: cfg.catalogTtlMs,
      occupancyRefreshMs: cfg.occupancyRefreshMs,
      switchOnCodes: cfg.switchOnCodes,
      crossClassFallback: cfg.crossClassFallback,
      enabled: cfg.enabled,
      disabledModels: cfg.disabledModels,
      disabledGroups: cfg.disabledGroups,
      hiddenModels: cfg.hiddenModels,
      hiddenGroups: cfg.hiddenGroups,
      freeBadgeLabel: cfg.freeBadgeLabel,
      groupByKind: cfg.groupByKind,
      customGroups: cfg.customGroups,
      switchScope: cfg.switchScope,
      groupMode: cfg.groupMode,
      probeIntervalMin: cfg.probeIntervalMin,
      modelEfforts: cfg.modelEfforts,
      requestRetryEnabled: cfg.requestRetryEnabled,
      requestRetryMax: cfg.requestRetryMax,
      requestRetryBackoffMs: cfg.requestRetryBackoffMs,
      autoResumeEnabled: cfg.autoResumeEnabled,
      autoResumeConsecutiveMax: cfg.autoResumeConsecutiveMax,
      autoResumeSessionMax: cfg.autoResumeSessionMax,
      autoResumeContinuePrompt: cfg.autoResumeContinuePrompt,
      escalateEnabled: cfg.escalateEnabled,
      escalateThresholdRatio: cfg.escalateThresholdRatio,
      escalateMaxChainDepth: cfg.escalateMaxChainDepth,
      escalateContinuePrompt: cfg.escalateContinuePrompt,
      escalateArchiveParent: cfg.escalateArchiveParent,
      escalateRenameChild: cfg.escalateRenameChild,
    },
  }
}

// ───────────────────────────── 配置读写 ─────────────────────────────

/**
 * 配置项元数据：客户端面板与 dsh 设置页面共用同一份声明，避免字段名散落在两端。
 * 只暴露用户真正会改的项；缓存/排序/徽标/错误码/跨类兜底等高级旋钮走 core 默认值，
 * 不在设置页露面（Config schema 仍保留全部字段，旧配置无需迁移）。`type` 决定渲染控件：
 *   boolean → 勾选框 · number → 数字输入 · model → 模型下拉 · scope → 三选一
 *   models → 只读计数（勾选入口在模型列表里）· groups-list → 只读 · groups → 自定义分组编辑器
 * 4 个数组字段虽不在运行策略里显示，但必须留在这里：模型/分组区逐行开关发的是整个数组
 * patch，靠 `coercePatch` 遍历本表消化，删掉就等于禁用了那几处写盘。
 */
const CONFIG_FIELDS = [
  { key: 'enabled', type: 'boolean', label: '启用自动选择', hint: '关闭后插件只观测不接管，全部交回宿主默认逻辑' },
  { key: 'defaultModel', type: 'model', label: '默认模型', hint: '留空则沿用宿主 agentDefaultModel 的当前选择' },
  { key: 'maxRetries', type: 'number', label: '同一模型重试次数', hint: '默认 2（单模型最多 3 次尝试）；用完后切下一个同类型模型' },
  { key: 'requestRetryEnabled', type: 'boolean', label: '启用失败分类重试', hint: '开=永久错误直接切、瞬时错误按下方阶梯重试；关=沿用旧的统一重试逻辑' },
  { key: 'requestRetryMax', type: 'number', label: '瞬时错误重试次数', hint: '默认 3；宿主已负责的错误（限流/服务端等）不叠加，直接切下一个模型' },
  { key: 'requestRetryBackoffMs', type: 'text', label: '重试退避阶梯(ms)', hint: '逗号分隔，如 2000,5000,10000；超出长度取末值，响应带 Retry-After 时优先' },
  { key: 'preferIdle', type: 'boolean', label: '切换优先选空闲模型', hint: '关闭则只按既定顺序，不看会话占用' },
  { key: 'groupMode', type: 'groupmode', label: '分组方式', hint: '手工=沿用自定义分组；自动=按免费/积分/未知自动分三组（切回手工原样恢复）' },
  { key: 'probeIntervalMin', type: 'number', label: '自动探测间隔(分钟)', hint: '0/留空=不自动；设了间隔才定时测全部模型（会真实消耗上游积分）' },
  { key: 'groupByKind', type: 'boolean', label: '按类型分组', hint: '开=所有来源的多模态一组、纯文本一组；关=按来源分组' },
  { key: 'customGroups', type: 'groups', label: '自定义分组', hint: '非空时接管面板分组：按顺序先命中先归组，未命中的落到「其他」' },
  {
    key: 'switchScope',
    type: 'scope',
    label: '自动切换范围',
    hint: '组内 = 只在当前模型所在分组里换；组内→跨组 = 组内耗尽再跨组兜底；全部 = 在整个同类型池子里换',
  },
  { key: 'disabledModels', type: 'models', label: '自动选择：模型', hint: '勾选 = 允许参与自动选择；取消勾选写进 disabledModels' },
  { key: 'disabledGroups', type: 'groups-list', label: '自动选择：分组', hint: '整组关掉 = 该组所有模型都不参与自动选择' },
  { key: 'hiddenModels', type: 'models', label: '下拉展示：模型', hint: '勾选 = 出现在模型下拉；取消勾选写进 hiddenModels（只影响展示）' },
  { key: 'hiddenGroups', type: 'groups-list', label: '下拉展示：分组', hint: '整组隐藏 = 该组所有模型都不在模型下拉里出现' },
  { key: 'modelEfforts', type: 'models', label: '推理等级：模型', hint: '按模型预配置推理等级；手动选与自动切换都按此附带' },
  { key: 'autoResumeEnabled', type: 'boolean', label: '错误自动继续', hint: '回合因瞬时错误失败后自动发起新一轮继续未完成的任务（默认关）' },
  { key: 'autoResumeConsecutiveMax', type: 'number', label: '连续续作上限', hint: '同类错误连续失败达到该次数后不再自动继续（默认 3）' },
  { key: 'autoResumeSessionMax', type: 'number', label: '整会话续作上限', hint: '一个会话内累计自动继续次数的上限（默认 10）' },
  { key: 'autoResumeContinuePrompt', type: 'text', label: '续作指令', hint: '自动继续时附加给模型的任务说明（接在固定模板之后）' },
  { key: 'escalateEnabled', type: 'boolean', label: '上下文升级会话', hint: '上下文占用超过阈值时新建会话继续任务并归档旧会话（默认关）' },
  { key: 'escalateThresholdRatio', type: 'number', label: '升级阈值', hint: '上下文占用比例达到该值时升级（默认 0.85）' },
  { key: 'escalateMaxChainDepth', type: 'number', label: '升级链层数上限', hint: '升级链最多多少层（默认 3）' },
  { key: 'escalateContinuePrompt', type: 'text', label: '交接续作指令', hint: '新会话收到的交接说明（接在标准交接头之后）' },
  { key: 'escalateArchiveParent', type: 'boolean', label: '升级后归档旧会话', hint: '升级成功后把旧会话归档（宿主原生可逆，默认开）' },
  { key: 'escalateRenameChild', type: 'boolean', label: '给新会话命名', hint: '按「父会话-日期-时间」给新会话命名（默认开）' },
] as const

/** 找到本插件在 profile 里的配置条目（用于把配置写回 cordis.patch.yml）。 */
function ownEntry(): any {
  const editor = ctxRef?.get?.('configEditor')
  if (editor === undefined || editor === null || typeof editor.entries !== 'function') return null
  try {
    const entries = editor.entries() as any[]
    return entries.find((entry) => entry?.options?.name === PLUGIN_NAME) ?? null
  } catch {
    return null
  }
}

/**
 * 插件 fiber 是否处于 active（`state === 2`）。
 *
 * 宿主写配置 = `configEditor.edit` → `fiber.update()` → **插件重启**（cordis/lib/index.js:1429-1440），
 * 重启窗口内 `fiber.state` 是 5（unloading）或 0，此时 `edit` 会抛
 * `Configuration plugin is no longer active`（dsh-config-editor/lib/index.js:81）。
 * 所以每次写入前都要现查这个状态，不能拿「刚才查过」当依据。
 */
function entryActive(entry: any): boolean {
  return entry !== null && entry !== undefined && entry.fiber !== undefined && entry.fiber !== null && entry.fiber.state === 2
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 等插件回到 active（最多 waitMs），返回最终能否写入。 */
async function waitForActive(waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (entryActive(ownEntry())) return true
    await sleep(60)
  }
  return entryActive(ownEntry())
}

function configView() {
  const entry = ownEntry()
  return {
    version: PLUGIN_VERSION,
    config: cfg,
    defaults: DEFAULT_CONFIG,
    fields: CONFIG_FIELDS,
    /** 能否把改动写回 profile（没有 configEditor 时只作用于本进程内存） */
    writable: entry !== null,
    /** 插件是否处于 active：false 时写入会被宿主拒绝，界面据此提示「稍后重试」 */
    active: entryActive(entry),
    documentPath: ctxRef?.get?.('configEditor')?.documentPath ?? null,
  }
}

function coercePatch(input: any): { next: Record<string, unknown>; changed: string[] } {
  const source = input !== null && typeof input === 'object' ? input : {}
  const next: Record<string, unknown> = {}
  const changed: string[] = []
  const assign = (key: string, value: unknown) => {
    next[key] = value
    changed.push(key)
  }
  for (const field of CONFIG_FIELDS) {
    const key = field.key
    if (!Object.hasOwn(source, key)) continue
    const value = (source as any)[key]
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') continue
      assign(key, value)
      continue
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
      // 小数字段（占比阈值）不能向下取整：0.85 会被取整成 0 → 按 (0,1] 夹取。
      if (DECIMAL_CONFIG_KEYS.has(key)) {
        assign(key, Math.min(1, Math.max(0.01, value)))
        continue
      }
      const floored = Math.floor(value)
      assign(key, key === 'probeIntervalMin' ? Math.min(floored, 1440) : floored)
      continue
    }
    if (field.type === 'list') {
      // 字符串数组：界面传数组或逗号分隔的字符串都收，空项丢弃
      const items = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(',')
          : null
      if (items === null) continue
      const list = items.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0)
      assign(key, list)
      continue
    }
    if (field.type === 'text') {
      if (typeof value !== 'string') continue
      // 退避阶梯：用户填逗号分隔的数字串 → 存 number[]；空项/非数字丢弃，全空则忽略。
      if (key === 'requestRetryBackoffMs') {
        const items = value
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((n) => Number.isFinite(n) && n >= 0)
        if (items.length === 0) continue
        assign(key, items.map(Math.floor))
        continue
      }
      assign(key, value.trim())
      continue
    }
    if (field.type === 'scope') {
      // 三值枚举：只认 all / group / group-cross，写错一律丢弃（不猜测用户意图）
      if (typeof value !== 'string') continue
      const scope = normalizeSwitchScope(value)
      if (scope !== value) continue
      assign(key, scope)
      continue
    }
    if (field.type === 'groupmode') {
      // 二值枚举：只认 manual / auto，写错一律丢弃（不猜测用户意图）
      if (typeof value !== 'string') continue
      const mode = normalizeGroupMode(value)
      if (mode !== value) continue
      assign(key, mode)
      continue
    }
    if (field.type === 'groups-list') {
      // 分组 id 数组：界面传数组或逗号分隔字符串都收
      const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null
      if (items === null) continue
      assign(
        key,
        items.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0),
      )
      continue
    }
    if (key === 'defaultModel') {
      if (value === null) {
        assign(key, null)
        continue
      }
      if (typeof value === 'object' && typeof value.provider === 'string' && typeof value.model === 'string' && value.provider.length > 0 && value.model.length > 0) {
        assign(key, {
          provider: value.provider,
          model: value.model,
          ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort.length > 0 ? { reasoningEffort: value.reasoningEffort } : {}),
        })
      }
      continue
    }
    // disabledModels / hiddenModels 都是 `provider/model` id 数组（含 `/`）：模型区与分组区的
    // 「展示」开关直接 stage 整个数组过来，两个字段都得消化；漏了 hiddenModels 会让逐模型
    // 展示开关的 patch 被丢弃 → changed=[] → saveConfig 报 no valid field in patch。
    if (key === 'disabledModels' || key === 'hiddenModels') {
      if (Array.isArray(value)) assign(key, value.filter((item): item is string => typeof item === 'string' && item.includes('/')))
      continue
    }
    if (key === 'customGroups') {
      // 只收结构合法的规则；整条非法直接丢，不猜测用户意图
      if (Array.isArray(value)) assign(key, normalizeCustomGroups(value))
      continue
    }
    if (key === 'modelEfforts') {
      // 按模型预配置推理等级：只收结构合法的项（key/effort 均为非空字符串）；非法整条丢
      if (Array.isArray(value)) assign(key, normalizeModelEfforts(value))
      continue
    }
  }
  // 模型开关：{ provider, model, disabled } —— 比让界面自己算整个数组更不容易写错
  // 模型开关：{ provider, model, disabled } / { provider, model, hidden }
  for (const [flag, key] of [
    ['disabled', 'disabledModels'],
    ['hidden', 'hiddenModels'],
  ] as const) {
    const toggle = source.toggleModel
    if (toggle === null || typeof toggle !== 'object') continue
    if (typeof toggle.provider !== 'string' || typeof toggle.model !== 'string') continue
    if (!Object.hasOwn(toggle, flag)) continue
    const id = `${toggle.provider}/${toggle.model}`
    const set = new Set(cfg[key])
    if ((toggle as any)[flag] === true) set.add(id)
    else set.delete(id)
    assign(key, [...set])
  }
  // 分组开关：{ group, disabled } / { group, hidden }
  for (const [flag, key] of [
    ['disabled', 'disabledGroups'],
    ['hidden', 'hiddenGroups'],
  ] as const) {
    const toggle = source.toggleGroup
    if (toggle === null || typeof toggle !== 'object') continue
    if (typeof toggle.group !== 'string' || toggle.group.length === 0) continue
    if (!Object.hasOwn(toggle, flag)) continue
    const set = new Set(cfg[key])
    if ((toggle as any)[flag] === true) set.add(toggle.group)
    else set.delete(toggle.group)
    assign(key, [...set])
  }
  return { next, changed }
}

/** 宿主重启窗口内会抛的三类错误：都可以「重取 entry 后重试」恢复。 */
const RETRYABLE_SAVE = /no longer active|no longer available|changed during reload/i

/**
 * 应用配置：先写 profile，成功后再切内存态（失败时内存态也不改，避免界面与实际不一致）。
 *
 * 写入会触发插件重启，重启窗口内再写必被宿主拒绝（见 entryActive 注释）。所以：
 *   · 写前先等 active（最多 1.5s）
 *   · 撞上可重试错误就重取 entry、等它回 active、再试一次
 *   · 仍失败返回**可操作的中文提示**，不把宿主内部英文错误甩给用户
 */
async function saveConfig(patch: any): Promise<{ ok: boolean; persisted: boolean; config: AutoSelectConfig; changed: string[]; error?: string }> {
  const { next, changed } = coercePatch(patch)
  if (changed.length === 0) {
    return { ok: false, persisted: false, config: cfg, changed, error: 'no valid field in patch' }
  }
  const merged = { ...cfg, ...next }
  const resolved = resolveConfig(merged)
  const editor = ctxRef?.get?.('configEditor')
  if (editor === undefined || typeof editor.edit !== 'function') {
    cfg = resolved
    afterConfigChange(changed)
    return { ok: true, persisted: false, config: cfg, changed, error: 'configEditor 不可用，改动只作用于本进程内存' }
  }

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 每次写入前都重新解析 entry：entry/fiber 会在插件重启后换新（不能缓存）
    if (attempt === 0 && !entryActive(ownEntry())) await waitForActive(1500)
    const entry = ownEntry()
    if (entry === null) {
      lastError = 'Configuration entry is no longer available'
    } else {
      try {
        await editor.edit(entry, (current: any) => ({ ...(current ?? {}), ...next }))
        cfg = resolved
        afterConfigChange(changed)
        return { ok: true, persisted: true, config: cfg, changed }
      } catch (err) {
        lastError = String((err as Error)?.message ?? err).slice(0, 300)
      }
    }
    if (attempt === 1 || !RETRYABLE_SAVE.test(lastError)) break
    // 重启窗口：等 fiber 回到 active 再重试
    await waitForActive(1500)
  }
  log({
    ts: Date.now(),
    event: 'config',
    reason: `配置写入失败：${lastError.slice(0, 120)}`,
    maxRetries: cfg.maxRetries,
    cooldownMs: cfg.cooldownMs,
    preferIdle: cfg.preferIdle,
    version: PLUGIN_VERSION,
  })
  const friendly = RETRYABLE_SAVE.test(lastError)
    ? '插件正在重启（写入配置会触发重载），请 2 秒后重试；本次改动未保存'
    : lastError
  return { ok: false, persisted: false, config: cfg, changed, error: friendly }
}

function afterConfigChange(changed: string[]) {
  log({
    ts: Date.now(),
    event: 'config',
    reason: `配置已更新：${changed.join(',')}`,
    maxRetries: cfg.maxRetries,
    cooldownMs: cfg.cooldownMs,
    preferIdle: cfg.preferIdle,
    version: PLUGIN_VERSION,
  })
  // disabledModels / freeBadgeLabel 参与目录构建，必须重建
  catalogAt = 0
  void getCatalog(true)
}

/** 连通性测试：真实向该模型发一次极小请求，回答「这个模型现在能不能调通」。
 * 走宿主 llm.prepareCall() → stream()，与 agent-loop 的派发路径同源（agent-loop:1005 prepareCall → :877 stream(request)），
 * 所以这里通了 = 宿主真正调用这个模型也通。流协议：终止 chunk 为
 * `{type:'finish', reason:{kind:'stop'|'error'|'aborted', failure?}}`（dsh-llm:2410-2418 adapterFailureChunk）。
 * 收到首个内容片即判定可用并提前收手（maxTokens 兜底限流），不写任何配置、只做观测。 */
/**
 * 失败分类：决定探测失败归入哪个不可用组（两组都持久化、都不进下拉）。
 * - 'model'：真实的「模型级」不可用（上游明确拒绝：密钥无效 / 模型不存在 / 限流 / 配额），
 *   写进 probeUnavailable（界面「不可调」组）。
 * - 'infra'：基础设施类故障（宿主缺 llm、provider 未注册、超时、DNS/连接/传输层失败、
 *   未知错误默认按基础设施处理），写进 probeInfra（界面「探测失败」组）。
 *   两类都持久化、重启沿用，仅下次探测通过或人工移出才放出（用户口径 m04133）。
 */
function classifyProbeFailure(error: string, code?: string): 'infra' | 'model' {
  // 确定「无法使用」的两类，判 model 级（拉黑并移除下拉）：
  //  1) 上游明确拒绝（UPSTREAM_* 错误码）；
  //  2) 宿主根本没注册该 provider 的适配器（NO_ADAPTER / 'no adapter registered'）。
  // NO_ADAPTER 是配置层确定性缺失：该 provider 下所有模型必然调不通，不是传输抖动，
  // 属于确定不可用；infra 类（fetch/DNS/超时等环境故障）归 probeInfra 组，见下。
  if (typeof code === 'string' && code.startsWith('UPSTREAM_')) return 'model'
  if (code === 'NO_ADAPTER') return 'model'
  const e = error.toLowerCase()
  if (e.includes('no adapter registered')) return 'model'
  if (
    e.includes('fetch failed') ||
    e.includes('abort') || // 超时（AbortController 触发 The operation was aborted）
    e.includes('timeout') ||
    e.includes('enotfound') || // DNS 解析失败
    e.includes('econnrefused') || // 连接被拒
    e.includes('econnreset') || // 连接重置
    e.includes('und_err') || // undici 传输错误
    e.includes('getaddrinfo') || // 域名解析失败
    e.includes('network') ||
    e.includes('socket')
  ) {
    return 'infra'
  }
  // 其它未知错误默认按基础设施处理：归 probeInfra 组（同样持久化，仅探测通过或人工移出放出）。
  return 'infra'
}

async function runModelProbe(provider: string, model: string): Promise<{ ok: boolean; ms: number; sample?: string; error?: string; kind?: 'infra' | 'model' }> {
  const llm = ctxRef?.get?.('llm') as any
  if (llm === undefined || llm === null || typeof llm.prepareCall !== 'function') {
    return { ok: false, ms: 0, kind: 'infra', error: '宿主 llm 服务不可用或缺少 prepareCall 入口' }
  }
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const call = await llm.prepareCall({ provider, model, maxTokens: 32 }, controller.signal)
    // 宿主消息契约：content 是结构化块数组（[{type:'text', text}]），不是裸字符串；
    // dsh-llm 的 contentHasFile/contentHasImage 会对每条消息 content 调 .some()/遍历（dsh-llm:593-605），
    // 裸字符串会抛 "content.some is not a function"（真机 m02715 实证）。
    // 首条消息必须是 system：真机 m01436 实证 workbuddy 网关以
    // 「请求被拦截，请重新发送 first message is not system prompt」拒收 user 开头的请求；
    // 宿主真实调用（agent-loop）本就先发 system，探测对齐同一形状，避免把网关格式要求误判成模型不可用。
    const stream = call.stream({
      ...call.config,
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'You are a connectivity probe. Reply with a short acknowledgment.' }] },
        { role: 'user', content: [{ type: 'text', text: 'ping' }] },
      ],
      signal: controller.signal,
    })
    let sample = ''
    for await (const chunk of stream as AsyncIterable<any>) {
      if (chunk?.type === 'finish') {
        const kind = String(chunk?.reason?.kind ?? 'stop')
        if (kind === 'error') {
          const failure = chunk?.reason?.failure
          const failureCode = failure?.code !== undefined ? String(failure.code) : undefined
          const failureMsg = String(failure?.message ?? failureCode ?? '调用失败')
          return { ok: false, ms: Date.now() - started, kind: classifyProbeFailure(failureMsg, failureCode), error: failureMsg.slice(0, 300) }
        }
        return { ok: true, ms: Date.now() - started, sample: sample.slice(0, 80) }
      }
      const piece = chunk?.delta?.text ?? chunk?.delta ?? chunk?.text
      const text = typeof piece === 'string' ? piece : typeof piece?.text === 'string' ? piece.text : ''
      if (text.length > 0) {
        // 收到首个内容片 = 模型真实响应了，立即收手（省 token 也省等待），不再等 finish。
        return { ok: true, ms: Date.now() - started, sample: (sample + text).slice(0, 80) }
      }
    }
    // 流正常结束但未产出任何内容、也未收到 finish 错误块（疑似传输层提前截断）→ 按基础设施处理。
    return { ok: false, ms: Date.now() - started, kind: 'infra', error: '流已结束但未收到任何模型响应' }
  } catch (err) {
    const e = err as Error
    const code = (e as any)?.code !== undefined ? String((e as any).code) : undefined
    const message = String(e?.message ?? err)
    return { ok: false, ms: Date.now() - started, kind: classifyProbeFailure(message, code), error: message.slice(0, 300) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 定时批量探测：把目录里每个模型真调一次，结果写进 probeUnavailable。
 * 默认不启用（probeIntervalMin=0）；限并发 4 + probeRunning 防重叠，避免压垮上游或叠跑扣积分。
 */
async function runScheduledProbe(): Promise<void> {
  if (probeRunning) return
  probeRunning = true
  try {
    const snapshot = await getCatalog(false)
    // 不展示（hidden）的模型不进测试：既不该出现在下拉，也没必要为其消耗探测请求。
    const queue = snapshot.entries.filter((entry) => entry.hidden !== true)
    const CONCURRENCY = 4
    const worker = async (): Promise<void> => {
      for (;;) {
        const entry = queue.shift()
        if (entry === undefined) return
        const result = await runModelProbe(entry.provider, entry.model)
        if (result.ok) {
          // 探测通过：从两组都移出（模型恢复可用 / 基础设施恢复），重新可进下拉。
          probeUnavailable.delete(entry.key)
          probeInfra.delete(entry.key)
        } else if (result.kind === 'model') {
          // 真实模型级故障（上游密钥无效 / 模型不存在 / 限流）：写进持久化「不可调」组，避免反复把坏模型选出来。
          // 两组互斥：同一 key 不能同时属于 model 与 infra。
          probeInfra.delete(entry.key)
          probeUnavailable.add(entry.key)
        } else {
          // infra 类（网络/DNS/超时/provider未注册/宿主缺失）：同样持久化进「探测失败」组、重启沿用，
          // 仅下次探测通过或人工移出才放出，不因单次网络抖动自愈回流。
          probeUnavailable.delete(entry.key)
          probeInfra.add(entry.key)
        }
        log({
          ts: Date.now(),
          event: 'probe',
          provider: entry.provider,
          model: entry.model,
          ok: result.ok,
          ms: result.ms,
          reasonCode: result.ok ? 'probe-ok' : result.kind === 'model' ? 'probe-fail' : 'probe-infra',
          reason: result.ok
            ? `定时探测通过（${result.ms}ms）`
            : `探测失败（${result.kind ?? 'infra'}）：${result.error ?? ''}`.slice(0, 200),
          version: PLUGIN_VERSION,
        })
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()))
  } catch (err) {
    log({ ts: Date.now(), event: 'probe', reasonCode: 'probe-schedule-error', reason: String((err as Error)?.message ?? err).slice(0, 200), version: PLUGIN_VERSION })
  } finally {
    probeRunning = false
  }
  // 探测收尾落盘：无论 try 正常结束还是 catch 异常退出，都尽力把当前集合写回，重启后可沿用（fail-closed）。
  saveProbeFile()
}

function createHandler() {
  return async (req: any, res: any) => {
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const path = url.pathname
      if (!path.startsWith(ROUTE_PREFIX)) {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      const route = path.slice(ROUTE_PREFIX.length) || '/'
      const method = req.method ?? 'GET'

      if (method === 'GET' && route === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          plugin: PLUGIN_NAME,
          version: PLUGIN_VERSION,
          uptime: process.uptime(),
          catalogSize: catalog.entries.length,
          catalogAgeMs: catalogAt > 0 ? Date.now() - catalogAt : null,
          // 排障关键：就绪 ≠ 完整。活宿主曾出现「就绪但只有 8 个 provider」，
          // 这两个字段能直接在 /health 上看出目录是不是还在长。
          catalogReady,
          catalogSettled: catalogSettled(),
          catalogProviders: catalogProviders.length,
          catalogProvidersAgeMs: catalogProvidersAt > 0 ? Date.now() - catalogProvidersAt : null,
          cooldownActive: cooldownActive(cooldown, Date.now()),
          sessionRecords: sessions.size,
          logRecords: logRing.size,
          pluginRecordChannel: sessionApi !== null,
        })
        return
      }

      if (method === 'GET' && route === '/catalog') {
        const force = url.searchParams.get('refresh') === '1'
        const snapshot = await getCatalog(force)
        // 目录视图必须带最新占用，否则客户端在首个 agent 事件之前会看到全空闲。
        refreshOccupancy('catalog')
        sendJson(res, 200, catalogView(snapshot))
        return
      }

      if (method === 'GET' && route === '/logs') {
        const limit = Math.max(1, Math.min(600, Number(url.searchParams.get('limit') ?? 100) || 100))
        sendJson(res, 200, { version: PLUGIN_VERSION, count: logRing.size, records: logRing.recent(limit) })
        return
      }

      if (method === 'GET' && route === '/occupancy') {
        refreshOccupancy('http')
        sendJson(res, 200, { occupancy, refreshedAt: lastOccupancyAt })
        return
      }

      if (method === 'GET' && route === '/pending-navigation') {
        // 取走即清空：client 半边拿到目标后负责跳过去；同一个 id 只推一次。
        const targets = pendingNavigation.splice(0, pendingNavigation.length)
        sendJson(res, 200, { targets })
        return
      }

      if (method === 'GET' && route === '/config') {
        sendJson(res, 200, configView())
        return
      }

      if (method === 'POST' && route === '/config') {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden', detail: 'cross-origin request rejected' })
          return
        }
        let bodyText: string
        try {
          bodyText = await readBody(req)
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            sendJson(res, 413, { error: 'payload too large', limit: MAX_BODY_BYTES })
            return
          }
          sendJson(res, 400, { error: 'bad request' })
          return
        }
        let parsed: any = {}
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {}
        } catch {
          sendJson(res, 400, { error: 'invalid json' })
          return
        }
        const result = await saveConfig(parsed)
        sendJson(res, result.ok ? 200 : 400, result)
        return
      }

      // 客户端自建模型下拉的落点：动态门面拿不到 `modelDirectories`（服务门禁按 inject 声明，
      // 且 directoryFor 内部还要读 remote.session），所以把「选模型」这一步收回到插件自己的路由里，
      // 由服务端用宿主认可的入口 agent.model.select() 落地（step preparation 之前）。
      if (method === 'POST' && route === '/select') {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden' })
          return
        }
        let bodyText: string
        try {
          bodyText = await readBody(req)
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            sendJson(res, 413, { error: 'payload too large', limit: MAX_BODY_BYTES })
            return
          }
          sendJson(res, 400, { error: 'bad request' })
          return
        }
        let parsed: any = {}
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {}
        } catch {
          sendJson(res, 400, { error: 'invalid json' })
          return
        }
        const sessionId = String(parsed?.sessionId ?? '')
        const provider = String(parsed?.provider ?? '')
        const model = String(parsed?.model ?? '')
        const reasoningEffort = typeof parsed?.reasoningEffort === 'string' && parsed.reasoningEffort.length > 0
          ? parsed.reasoningEffort
          : undefined
        if (sessionId === '' || provider === '' || model === '') {
          sendJson(res, 400, { error: 'sessionId / provider / model are required' })
          return
        }
        const target = liveAgents().find((agent) => String(agent?.id ?? agent?.session?.id ?? '') === sessionId)
        if (target === undefined) {
          sendJson(res, 404, { error: 'session not found', sessionId })
          return
        }
        const snapshot = await getCatalog(false)
        const key = modelKey(provider, model)
        const entry = snapshot.entries.find((candidate) => candidate.key === key)
        if (entry === undefined) {
          sendJson(res, 404, { error: 'model not in catalog', provider, model })
          return
        }
        // 推理等级必须是该模型声明过的 effort id，防止越权直呼任意值。
        if (reasoningEffort !== undefined) {
          const declared = entry.reasoning?.efforts?.some((level: any) => level.id === reasoningEffort) === true
          if (!declared) {
            sendJson(res, 400, { error: 'reasoningEffort not offered by this model', provider, model, reasoningEffort })
            return
          }
        }
        // 未入组 / 已停用的模型在这里就挡住：下拉里不出现，路由层也不接受越权直呼。
        if (entry.disabled === true || entry.hidden === true) {
          sendJson(res, 409, { error: 'model is disabled or hidden', provider, model, reason: '未入组或已停用' })
          return
        }
        const selection: Selection = {
          key,
          provider,
          model,
          name: entry.name,
          kind: entry.kind,
          reasonCode: 'manual',
          reason: '在模型下拉里手动选择',
          orderIndex: -1,
          idle: occupancy[key]?.inUse !== true,
          owners: occupancy[key]?.owners ?? [],
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        }
        const via = commitSelection(target, selection, 'dropdown')
        const state = sessionState(sessionId, null, Date.now())
        state.current = selection
        state.updatedAt = Date.now()
        refreshOccupancy('dropdown-select')
        log({
          ts: Date.now(),
          event: 'select',
          sessionId,
          to: selection.key,
          reasonCode: 'manual',
          reason: `下拉手动选择 → ${selection.key}`,
          via,
        })
        sendJson(res, 200, { ok: true, sessionId, selection: { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }, via })
        return
      }

      // 连通性测试：真实向该模型发一次极小请求，回答「这个模型现在能不能调通」。
      // 与 disabled/hidden（选择池归属 / 展示可见性）正交：未入组的模型也允许测。
      if (method === 'POST' && route === '/test-model') {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden' })
          return
        }
        let bodyText: string
        try {
          bodyText = await readBody(req)
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            sendJson(res, 413, { error: 'payload too large', limit: MAX_BODY_BYTES })
            return
          }
          sendJson(res, 400, { error: 'bad request' })
          return
        }
        let parsed: any = {}
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {}
        } catch {
          sendJson(res, 400, { error: 'invalid json' })
          return
        }
        const provider = String(parsed?.provider ?? '')
        const model = String(parsed?.model ?? '')
        if (provider === '' || model === '') {
          sendJson(res, 400, { error: 'provider / model are required' })
          return
        }
        const snapshot = await getCatalog(false)
        const target = snapshot.entries.find((candidate) => candidate.key === modelKey(provider, model))
        if (target === undefined) {
          sendJson(res, 404, { error: 'model not in catalog', provider, model })
          return
        }
        // 不展示（hidden）的模型不进测试：用户口径「不展示的也不进人测试」。
        if (target.hidden === true) {
          sendJson(res, 409, { error: 'model is hidden', provider, model, reason: '不展示的模型不参与连通性测试' })
          return
        }
        const result = await runModelProbe(provider, model)
        const entryKey = modelKey(provider, model)
        if (result.ok) {
          // 探测通过：从两组都移出（模型恢复可用 / 基础设施恢复），重新可进下拉，并落盘。
          probeUnavailable.delete(entryKey)
          probeInfra.delete(entryKey)
          saveProbeFile()
        } else if (result.kind === 'model') {
          // 真实模型级故障：写进持久化「不可调」组，避免把坏模型选出来（两组互斥）。
          probeInfra.delete(entryKey)
          probeUnavailable.add(entryKey)
          saveProbeFile()
        } else {
          // infra 类：同样持久化进「探测失败」组、重启沿用；仅下次探测通过或人工移出才放出。
          probeUnavailable.delete(entryKey)
          probeInfra.add(entryKey)
          saveProbeFile()
        }
        // 探测结果改变了 probeUnavailable 集合，目录快照里的 unavailableModels 会随之变化。
        // 必须失效目录缓存，否则 /catalog 继续返回探测前的旧快照，下拉会留下刚被标「不可调」的模型。
        catalogAt = 0
        void getCatalog(true)
        log({
          ts: Date.now(),
          event: 'probe',
          provider,
          model,
          ok: result.ok,
          ms: result.ms,
          reasonCode: result.ok ? 'probe-ok' : result.kind === 'model' ? 'probe-fail' : 'probe-infra',
          reason: result.ok
            ? `连通性测试通过（${result.ms}ms）`
            : `连通性测试失败（${result.kind ?? 'infra'}）：${result.error ?? ''}`.slice(0, 200),
          version: PLUGIN_VERSION,
        })
        sendJson(res, 200, {
          ok: result.ok,
          provider,
          model,
          ms: result.ms,
          ...(result.sample === undefined ? {} : { sample: result.sample }),
          ...(result.error === undefined ? {} : { error: result.error }),
          ...(result.kind === undefined ? {} : { kind: result.kind }),
        })
        return
      }

      // 手动移出「暂不可用」组：用户判定某模型其实可用时，把它从 probeUnavailable 集合移除，
      // 重新放回下拉可选。与探测正交——探测会重新加回，这里是人工兜底。
      if (method === 'POST' && route === '/probe/restore') {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden' })
          return
        }
        let bodyText: string
        try {
          bodyText = await readBody(req)
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            sendJson(res, 413, { error: 'payload too large', limit: MAX_BODY_BYTES })
            return
          }
          sendJson(res, 400, { error: 'bad request' })
          return
        }
        let parsed: any = {}
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {}
        } catch {
          sendJson(res, 400, { error: 'invalid json' })
          return
        }
        const provider = String(parsed?.provider ?? '')
        const model = String(parsed?.model ?? '')
        if (provider === '' || model === '') {
          sendJson(res, 400, { error: 'provider / model are required' })
          return
        }
        const entryKey = modelKey(provider, model)
        // 同时尝试从两组移出：model 级「不可调」与 infra 级「探测失败」都已持久化、重启沿用。
        // 任一命中即视为已移除；两组都写盘，故任一组变化都要落盘，避免重启后回滚。
        const hadModel = probeUnavailable.delete(entryKey)
        const hadInfra = probeInfra.delete(entryKey)
        const had = hadModel || hadInfra
        if (had) saveProbeFile()
        // 移出集合后目录快照里的 unavailableModels/unavailableInfra 会随之变化，必须失效缓存。
        catalogAt = 0
        void getCatalog(true)
        log({
          ts: Date.now(),
          event: 'probe',
          provider,
          model,
          ok: true,
          ms: 0,
          reasonCode: had ? 'probe-restore' : 'probe-restore-noop',
          reason: had ? `人工移出不可用组，恢复为下拉可选` : `该模型本就不在不可用组（幂等）`,
          version: PLUGIN_VERSION,
        })
        sendJson(res, 200, { ok: true, provider, model, removed: had, kind: hadInfra && !hadModel ? 'infra' : 'model' })
        return
      }

      if (method === 'POST' && route === '/cooldown/clear') {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden' })
          return
        }
        const was = cooldown
        cooldown = { until: 0, enteredAt: 0, reason: '' }
        modelCooldown.clear()
        for (const state of sessions.values()) state.excluded = []
        if (cooldownTimer !== null) {
          clearTimeout(cooldownTimer)
          cooldownTimer = null
        }
        log({ ts: Date.now(), event: 'cooldown-end', reason: `人工清除冷却（原 reason=${was.reason || '-'}）` })
        sendJson(res, 200, { ok: true })
        return
      }

      if (route === '/beacon') {
        if (method === 'GET') {
          sendJson(res, 200, { count: beacons.length, beacons })
          return
        }
        if (method === 'POST') {
          if (!isSameOrigin(req)) {
            sendJson(res, 403, { error: 'forbidden', detail: 'cross-origin request rejected' })
            return
          }
          let bodyText: string
          try {
            bodyText = await readBody(req)
          } catch (err) {
            if (err === BODY_TOO_LARGE) {
              sendJson(res, 413, { error: 'payload too large', limit: MAX_BODY_BYTES })
              return
            }
            sendJson(res, 400, { error: 'bad request' })
            return
          }
          let parsed: any = {}
          try {
            parsed = bodyText ? JSON.parse(bodyText) : {}
          } catch {
            parsed = {}
          }
          beacons.push(sanitizeBeacon(parsed))
          if (beacons.length > MAX_BEACONS) beacons.splice(0, beacons.length - MAX_BEACONS)
          sendJson(res, 200, { ok: true })
          return
        }
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (err) {
      sendJson(res, 500, { error: 'internal error', detail: String(err) })
    }
  }
}

// ─────────────────────────────── 入口 ───────────────────────────────

export function apply(ctx: any, config: any = {}) {
  ctxRef = ctx
  cfg = resolveConfig(readConfigRefs(config))
  log({ ts: Date.now(), event: 'config', reason: '插件启动', version: PLUGIN_VERSION, maxRetries: cfg.maxRetries, cooldownMs: cfg.cooldownMs, preferIdle: cfg.preferIdle })
  void resolveSessionApi()

  // 1) 会话进出 → 占用刷新 + 进入会话即按规则选模型
  ctx.on('agent/created', (payload: any) => {
    const agent = payload?.agent
    const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
    refreshOccupancy('agent-created')
    if (!cfg.enabled || sessionId.length === 0) return
    void applySelection(agent, currentKind(preferredKeyFor(agent)), 'agent-created', { allowPreferred: true })
  })

  ctx.on('agent/disposed', (payload: any) => {
    const agent = payload?.agent
    const sessionId = String(agent?.id ?? agent?.session?.id ?? '')
    if (sessionId.length > 0) {
      sessions.delete(sessionId)
      modelCooldown.delete(sessionId)
    }
    refreshOccupancy('agent-disposed')
  })

  ctx.on('agent/status', (payload: any) => {
    refreshOccupancy('agent-status')
    // 会话转空闲：若上一回合是正常完成的，再评估一次上下文阈值升级
    //（turn/end 到达时 agent 可能仍在跑，那次评估会因忙碌而放弃）。
    const idleSessionId = String(payload?.agent?.id ?? payload?.agent?.session?.id ?? '')
    if (idleSessionId.length > 0) void evaluateEscalationForSession(idleSessionId, 'agent-idle')
  })

  // 0.1.9 能力 1：回合级错误 → 瞬时且配额未超时，自动发起新一轮继续未完成的任务。
  ctx.on('agent/error', (payload: any) => {
    void handleAgentError(payload)
  })

  // 0.1.9 能力 2：回合正常结束且上下文占用过阈值 → 新建会话继续任务并归档旧会话。
  // error / aborted 的回合一律不评估（宿主 2026-11-18 事故：transport error 与用户 abort
  // 触发升级评估，是连环升级的放大器）。
  ctx.on('session/event', (session: any, event: any) => {
    if (event?.type !== 'turn/end') return
    const sessionId = String(session?.id ?? '')
    if (sessionId.length === 0) return
    const reasonKind = event?.data?.reason?.kind
    const completed = reasonKind === undefined || reasonKind === 'completed'
    const entry = escalationLedger.get(sessionId) ?? { escalations: 0, depth: 0, escalatedTo: null, lastTurnCompleted: false }
    entry.lastTurnCompleted = completed
    escalationLedger.set(sessionId, entry)
    if (!completed) return
    // 成功一次即清零「同类错误连续失败」计数（连续语义）。
    const resumeEntry = resumeLedger.get(sessionId)
    if (resumeEntry !== undefined && resumeEntry.consecutive !== 0) {
      resumeLedger.set(sessionId, { ...resumeEntry, consecutive: 0 })
    }
    void evaluateEscalationForSession(sessionId, 'turn-end')
  })

  // 2) provider 集合变化 → 目录必须重建
  // 宿主 llm 服务每次注册/注销/替换 provider 都会广播这个事件。启动早期 provider 是陆续注册的，
  // 只听 agent 事件根本等不到「目录齐全」的时刻：真机日志里先只看到 8 个 provider（27 条），
  // 完整是 27 个（172 条），差的那批在随后几秒才注册进来。没有这个订阅，
  // 就只能靠 15s 轮询 + 60s TTL 慢慢撞，而中间已经因为「没有候选」进了 30 分钟冷却。
  ctx.on(ADAPTERS_EVENT, () => {
    catalogProvidersAt = Date.now()
    scheduleCatalogRefresh()
  })

  // 3) 出错 → 重试 / 同类型切换 / 冷却
  // 【0.1.8 P0 根因修复】prepend 抢在宿主 llm-retry 之前拿到事件；先 await next() 让下游优先，
  // 下游返回 {kind:'retry'}（宿主接手）就原样采纳、绝不重复重试；下游无结果（耗尽/让路）才自决。
  // 只改内部逻辑不 prepend = 事件到不了本 listener（宿主链不调 next）；只 prepend 不先问下游 = 与宿主重试打架。
  ctx.on('agent/request-error', async (payload: any, next: () => Promise<any>) => {
    const downstream = await next().catch(() => undefined)
    if (downstream?.kind === 'retry') return downstream
    if (!cfg.enabled) return downstream
    let decision: { kind: 'retry' } | undefined
    try {
      decision = await handleRequestError(payload)
    } catch (err) {
      log({
        ts: Date.now(),
        event: 'giveup',
        reasonCode: 'internal-error',
        reason: '切换逻辑内部异常，交回宿主',
        failureMessage: String((err as Error)?.message ?? err),
      })
      return downstream
    }
    if (decision?.kind === 'retry') return decision
    return downstream
  }, { prepend: true })

  // 4) 占用状态兜底轮询（事件缺失时也能刷新；事件驱动的刷新不受此间隔限制）
  occupancyTimer = setInterval(() => refreshOccupancy('timer'), Math.max(1_000, cfg.occupancyRefreshMs))
  if (typeof occupancyTimer?.unref === 'function') occupancyTimer.unref()

  // 定时连通性探测：默认关（probeIntervalMin=0），设了间隔才建 timer。
  // 配置写入会触发 apply 重跑，新间隔即生效；手动「测试全组」走客户端，不受此开关影响。
  if (cfg.probeIntervalMin > 0) {
    probeTimer = setInterval(() => { void runScheduledProbe() }, Math.max(60_000, cfg.probeIntervalMin * 60_000))
    if (typeof probeTimer?.unref === 'function') probeTimer.unref()
  }

  // 5) 定期清理过期会话状态
  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [sessionId, state] of sessions) {
      const live = liveAgents().some((agent) => String(agent?.id ?? agent?.session?.id ?? '') === sessionId)
      if (!live && now - state.updatedAt > SESSION_STATE_TTL_MS) {
        sessions.delete(sessionId)
        modelCooldown.delete(sessionId)
      }
    }
  }, 10 * 60 * 1000)
  if (typeof sweeper?.unref === 'function') sweeper.unref()

  ctx.effect(() => () => {
    if (cooldownTimer !== null) clearTimeout(cooldownTimer)
    if (adaptersTimer !== null) clearTimeout(adaptersTimer)
    if (occupancyTimer !== null) clearInterval(occupancyTimer)
    clearInterval(sweeper)
    if (probeTimer !== null) clearInterval(probeTimer)
    cooldownTimer = null
    adaptersTimer = null
    occupancyTimer = null
    probeTimer = null
  }, 'model-auto-select: timers')

  // 6) 客户端接口
  const webServer = ctx?.webServer
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
    log({ ts: Date.now(), event: 'config', reason: 'webServer 不可用，跳过路由注册（客户端将只显示静态标注）' })
    return
  }
  // 路由必须随插件卸载注销：register() 返回 disposer，不接住它就会在插件重启时撞
  // `webserver: duplicate prefix route "..."`（宿主路由表是组合级契约，重复即抛错），
  // 插件随即启动失败 → fiber 不在 state 2 → 之后所有写配置都被 config-editor 拒绝。
  //
  // 但光「卸载时注销」不够：历史版本已经把 disposer 丢了，旧路由会永久留在进程的路由表里
  // （它的 handler 是上一个模块实例的闭包，即僵尸 handler，还会继续应答旧数据）。
  // 所以这里用 globalThis 上的登记位跨实例自愈：新实例启动前先把上一实例的路由拆掉再注册。
  // globalThis 而不是模块变量，是因为 unlag 重载可能重新 import 模块，模块作用域会被换掉。
  const g = globalThis as any
  const stale = g[ROUTE_REGISTRY_KEY]
  if (typeof stale === 'function') {
    try {
      stale()
      log({ ts: Date.now(), event: 'config', reason: '已拆除上一实例遗留的路由（避免 duplicate prefix route）' })
    } catch (err: any) {
      log({ ts: Date.now(), event: 'config', reason: `拆除遗留路由失败：${String(err?.message ?? err).slice(0, 200)}` })
    }
    delete g[ROUTE_REGISTRY_KEY]
  }
  // 历史版本把 disposer 丢了，那种僵尸路由不在登记位上（旧代码没登记），只能直接看路由表。
  // 宿主 Webserver 的 `prefixes` / `exact` 是实例上的普通 Map（非 #private），这里只做一件事：
  // 发现我们自己这条前缀已被占用就删掉它，让新实例接管——否则插件会永久停在 stopped。
  // 用 instanceof Map + has(path) 双重守卫，宿主将来改结构时这里会安静地不生效（随后照常抛错）。
  try {
    const tables = [(webServer as any)?.prefixes, (webServer as any)?.exact]
    for (const table of tables) {
      if (table instanceof Map && table.has(ROUTE_PREFIX)) {
        table.delete(ROUTE_PREFIX)
        log({
          ts: Date.now(),
          event: 'config',
          reason: '已清理路由表里的僵尸路由（上一实例未注销），新实例接管该前缀',
        })
      }
    }
  } catch (err: any) {
    log({ ts: Date.now(), event: 'config', reason: `清理僵尸路由失败：${String(err?.message ?? err).slice(0, 200)}` })
  }
  let disposeRoute: any
  try {
    disposeRoute = webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: createHandler() })
  } catch (err: any) {
    // 走到这里说明路由表里还有别人（不是我们登记的）占了同一前缀：报清楚，别静默停摆
    log({
      ts: Date.now(),
      event: 'config',
      reason: `路由注册失败：${String(err?.message ?? err).slice(0, 200)}（若提示 duplicate prefix route，需重启 dsh 进程清理路由表）`,
    })
    throw err
  }
  if (typeof disposeRoute === 'function') {
    g[ROUTE_REGISTRY_KEY] = disposeRoute
    ctx.effect(() => () => {
      try {
        disposeRoute()
      } catch (err: any) {
        log({ ts: Date.now(), event: 'config', reason: `路由注销失败：${String(err?.message ?? err).slice(0, 200)}` })
      }
      if (g[ROUTE_REGISTRY_KEY] === disposeRoute) delete g[ROUTE_REGISTRY_KEY]
    }, 'model-auto-select: route')
  } else {
    log({ ts: Date.now(), event: 'config', reason: 'webServer.register 未返回 disposer，重启时可能撞重复前缀路由' })
  }
  log({ ts: Date.now(), event: 'config', reason: `路由已注册：GET ${ROUTE_PREFIX}/catalog`, version: PLUGIN_VERSION })

  // 7) dsh 设置页面：本插件自建页（client 半边注册 settings.section），关掉宿主自动页避免两个入口
  //    ctx.inject 只在真实 cordis 上下文里存在；单测/冒烟用裸对象上下文时跳过（不影响路由与选择逻辑）
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['settings'], (child: any) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
      })
    } catch (err: any) {
      log({ ts: Date.now(), event: 'config', reason: `settings.configure 接线失败：${String(err?.message ?? err).slice(0, 200)}` })
    }
  }

  // 预热目录，进入会话前就有分类数据
  void getCatalog(true)

  // 需求④(m05678)：回填上次持久化的两类失败集合，重启后可沿用上次探测结果（fail-closed，绝不阻断启动）。
  try {
    const saved = loadProbeFile()
    for (const k of saved.model) {
      if (typeof k === 'string' && k.length > 0) probeUnavailable.add(k)
    }
    for (const k of saved.infra) {
      if (typeof k === 'string' && k.length > 0) probeInfra.add(k)
    }
  } catch {
    // 读盘失败不阻断启动
  }
}

// 供回归测试直接驱动纯函数与内部状态
export const __test = {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  ROUTE_PREFIX,
  decideResume,
  decideEscalate,
  handleAgentError,
  evaluateEscalationForSession,
  resumeLedger,
  escalationLedger,
  pendingNavigation,

  resolveConfig,
  readConfigRefs,
  Config,
  getCatalog,
  applySelection,
  handleRequestError,
  refreshOccupancy,
  enterCooldown,
  wakeFromCooldown,
  catalogView,
  configView,
  saveConfig,
  coercePatch,
  CONFIG_FIELDS,
  state: () => ({
    cfg,
    catalog,
    catalogAt,
    catalogReady,
    catalogProviders,
    catalogProvidersAt,
    catalogSettled,
    cooldown,
    occupancy,
    sessions,
    logRing,
    // 冷却期抑制日志的节流状态（测试用来把「上一次记录时间」往回拨，模拟分钟级间隔）
    cooldownSuppressLogAt: () => cooldownSuppressLogAt,
    rewindCooldownSuppressLog: (ms: number) => {
      cooldownSuppressLogAt -= ms
    },
    // 仅供测试：把目录生成时间往回拨，模拟「目录已就绪但 TTL 已过期」，
    // 让 getCatalog(false) 越过 TTL 短绕、落到冷却抑制分支，验证节流日志逻辑。
    rewindCatalogAt: (ms: number) => {
      catalogAt -= ms
    },
    // 仅供测试：把「provider 集合刚变过」的时间戳清零 = 视为集合早已稳定，
    // 否则所有在 getCatalog(true) 之后立刻断言冷却/无候选的用例都会落进 settling 分支。
    settleCatalog: () => {
      catalogProvidersAt = 0
    },
  }),
  runScheduledProbe,
  probeUnavailableKeys: () => [...probeUnavailable],
  probeInfraKeys: () => [...probeInfra],
  reset: () => {
    probeUnavailable.clear()
    probeInfra.clear()
    catalog = { generatedAt: 0, entries: [], failures: [], providerCount: 0 }
    catalogAt = 0
    catalogReady = false
    catalogProviders = []
    catalogProvidersAt = 0
    catalogRefreshAttempts = 0
    if (adaptersTimer !== null) clearTimeout(adaptersTimer)
    adaptersTimer = null
    cooldown = { until: 0, enteredAt: 0, reason: '' }
    cooldownSuppressLogAt = 0
    cooldownSuppressCount = 0
    occupancy = {}
    sessions.clear()
    modelCooldown.clear()
    modalityCache.clear()
    probeRunning = false
    if (probeTimer !== null) clearInterval(probeTimer)
    probeTimer = null
  },
  setContext: (ctx: any, config: any = {}) => {
    ctxRef = ctx
    cfg = resolveConfig(readConfigRefs(config))
  },
  // 仅供测试：暴露持久化文件路径与强制落盘，便于 fail-closed 测试注入预置文件并断言写回。
  probeFile: PROBE_FILE,
  saveProbeFile,
}
export type { AutoSelectConfig, CatalogSnapshot, ModelEntry, Selection, SessionState }
