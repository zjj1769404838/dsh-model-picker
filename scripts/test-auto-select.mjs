/**
 * 回归测试：node scripts/test-auto-select.mjs（先跑 node scripts/build.mjs）
 *
 * 覆盖用户要求的四块功能判定 + 配置默认值 + 日志字段完整性：
 *   1 模型分类与来源标注
 *   2 默认模型 / 重试额度 / 同类型切换顺序
 *   3 会话占用标注 / 空闲优先 / 全占用回落既定顺序
 *   4 全部不可用 → 冷却 → 冷却结束恢复
 *   5 日志字段（每次选择/重试/切换/冷却都可追踪）
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_CONFIG,
  LogRing,
  badgeOf,
  classify,
  computeOccupancy,
  decideOnError,
  groupCatalog,
  isEmptyGroup,
  groupsOf,
  isDisabled,
  isHidden,
  isUnassigned,
  modelKey,
  newSessionState,
  normalizeModalities,
  prunedRosterKeys,
  resolveConfig,
  scopeGroupsOf,
  selectModel,
  sortKeyOf,
  normalizeSwitchScope,
  SWITCH_SCOPE_VALUES,
  priceClassOf,
  normalizeGroupMode,
  GROUP_MODE_VALUES,
} from '../lib/core.js'
import { apply as applyPlugin, __test as nodeSide } from '../lib/index.js'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.then(
        () => {
          passed += 1
          console.log(`  ok  ${name}`)
        },
        (err) => {
          failures.push([name, err])
          console.log(`  FAIL ${name}: ${err?.message ?? err}`)
        },
      )
    }
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push([name, err])
    console.log(`  FAIL ${name}: ${err?.message ?? err}`)
  }
}

// ─────────────────────────── 测试夹具 ───────────────────────────

const CFG = resolveConfig({ maxRetries: 2, retryDelayMs: 0, cooldownMs: 30 * 60 * 1000 })

function entry(provider, model, kind, providerIndex = 0, modelIndex = 0, modalities = []) {
  return {
    key: modelKey(provider, model),
    provider,
    providerName: provider.toUpperCase(),
    providerSettingsNs: `llm-${provider}`,
    model,
    name: model,
    kind,
    modalities,
    modalitySource: modalities.length > 0 ? 'listModels' : 'fallback',
    sortKey: sortKeyOf(provider, model, providerIndex, modelIndex, CFG),
  }
}

const TEXT_A = entry('alpha', 'text-a', 'text', 0, 0)
const TEXT_B = entry('alpha', 'text-b', 'text', 0, 1)
const TEXT_C = entry('beta', 'text-c', 'text', 1, 0)
const MM_A = entry('alpha', 'mm-a', 'multimodal', 0, 2, ['text', 'image'])
const MM_B = entry('beta', 'mm-b', 'multimodal', 1, 1, ['image', 'audio'])

function catalogOf(entries, failures = []) {
  return { generatedAt: Date.now(), entries, failures, providerCount: 2 }
}

const CATALOG = catalogOf([TEXT_A, TEXT_B, TEXT_C, MM_A, MM_B])

function baseRequest(over = {}) {
  return {
    catalog: CATALOG,
    kind: 'text',
    preferredKey: null,
    occupancy: {},
    excluded: [],
    modelCooldown: {},
    now: Date.now(),
    cfg: CFG,
    ...over,
  }
}

function errorRequest(over = {}) {
  const state = over.state ?? newSessionState('s1', 'text', { ...TEXT_A, reasonCode: 'preferred', reason: 'x', orderIndex: 0, idle: true, owners: [] }, Date.now())
  return {
    state,
    failureCode: 'UPSTREAM_500',
    failureMessage: 'boom',
    aborted: false,
    catalog: CATALOG,
    occupancy: {},
    modelCooldown: {},
    cooldown: { until: 0, enteredAt: 0, reason: '' },
    now: Date.now(),
    cfg: CFG,
    ...over,
  }
}

// ─────────────────────────── 1 分类与来源 ───────────────────────────

await test('分类：含 image/audio/video ⇒ multimodal', () => {
  assert.equal(classify(['text', 'image']), 'multimodal')
  assert.equal(classify(['audio']), 'multimodal')
  assert.equal(classify(['video']), 'multimodal')
})

await test('分类：空数组或仅 text ⇒ text（inputModalities 缺省也是 text）', () => {
  assert.equal(classify([]), 'text')
  assert.equal(classify(['text']), 'text')
  assert.equal(classify(normalizeModalities(undefined)), 'text')
})

await test('模态归一化：去重、小写、丢非字符串', () => {
  assert.deepEqual(normalizeModalities(['TEXT', 'text', 'Image', 3, null]), ['text', 'image'])
})

await test('来源标注：provider 名与 settingsNs 都进条目', () => {
  assert.equal(TEXT_A.providerName, 'ALPHA')
  assert.equal(TEXT_A.providerSettingsNs, 'llm-alpha')
  assert.equal(TEXT_A.key, 'alpha\u0000text-a')
})

await test('排序键可复现：providerOrder / modelOrder 优先，其余按宿主顺序', () => {
  const cfg = resolveConfig({ providerOrder: ['beta'], modelOrder: ['alpha/text-b'] })
  const a = sortKeyOf('alpha', 'text-a', 0, 0, cfg)
  const b = sortKeyOf('alpha', 'text-b', 0, 1, cfg)
  const c = sortKeyOf('beta', 'text-c', 1, 0, cfg)
  assert.deepEqual(c, [0, 1, 1, 0]) // provider 优先表命中 → 0；model 未命中 → modelOrder.length(1) + modelIndex(0)
  assert.deepEqual(b, [1, 0, 0, 1]) // provider 未命中 → 1 + 0；model 命中 → 0
  assert.deepEqual(a, [1, 1, 0, 0]) // 都未命中 → 落回宿主索引
})

// ─────────────────────────── 2 默认模型与重试 ───────────────────────────

await test('首选模型可用 ⇒ preferred', () => {
  const picked = selectModel(baseRequest({ preferredKey: TEXT_B.key }))
  assert.equal(picked.key, TEXT_B.key)
  assert.equal(picked.reasonCode, 'preferred')
})

await test('首选模型被占用仍优先（用户显式选择 > 空闲规避），reasonCode=preferred-busy', () => {
  const occupancy = computeOccupancy([{ sessionId: 'other', key: TEXT_B.key, status: 'running' }])
  const picked = selectModel(baseRequest({ preferredKey: TEXT_B.key, occupancy }))
  assert.equal(picked.key, TEXT_B.key)
  assert.equal(picked.reasonCode, 'preferred-busy')
  assert.deepEqual(picked.owners, ['other'])
})

await test('重试额度：maxRetries=2 ⇒ 前两次 retry，第三次切换', () => {
  const state = newSessionState('s1', 'text', { ...TEXT_A, reasonCode: 'preferred', reason: 'x', orderIndex: 0, idle: true, owners: [] }, Date.now())
  const r1 = decideOnError(errorRequest({ state }))
  assert.equal(r1.action, 'retry')
  assert.equal(r1.retriesUsed, 1)
  state.retriesUsed = 1
  state.attempts = 1
  const r2 = decideOnError(errorRequest({ state }))
  assert.equal(r2.action, 'retry')
  assert.equal(r2.retriesUsed, 2)
  state.retriesUsed = 2
  state.attempts = 2
  const r3 = decideOnError(errorRequest({ state }))
  assert.equal(r3.action, 'switch')
  assert.equal(r3.next.key, TEXT_B.key)
})

await test('maxRetries=0 ⇒ 直接切换，不重试', () => {
  const cfg = resolveConfig({ maxRetries: 0, retryDelayMs: 0 })
  const decision = decideOnError(errorRequest({ cfg }))
  assert.equal(decision.action, 'switch')
})

await test('aborted / ABORTED ⇒ giveup，不消耗额度', () => {
  const d1 = decideOnError(errorRequest({ aborted: true }))
  const d2 = decideOnError(errorRequest({ failureCode: 'ABORTED' }))
  assert.equal(d1.action, 'giveup')
  assert.equal(d1.reasonCode, 'aborted')
  assert.equal(d2.action, 'giveup')
})

await test('switchOnCodes 白名单不含该码 ⇒ giveup(non-switchable)，交回宿主 llm-retry', () => {
  const cfg = resolveConfig({ switchOnCodes: ['RATE_LIMIT'] })
  const d = decideOnError(errorRequest({ cfg, failureCode: 'UPSTREAM_500' }))
  assert.equal(d.action, 'giveup')
  assert.equal(d.reasonCode, 'non-switchable')
})

await test('切换顺序可复现：excluded 累积后取同类型下一个', () => {
  const state = newSessionState('s1', 'text', { ...TEXT_A, reasonCode: 'preferred', reason: 'x', orderIndex: 0, idle: true, owners: [] }, Date.now())
  state.retriesUsed = 2
  const first = decideOnError(errorRequest({ state }))
  assert.equal(first.next.key, TEXT_B.key)
  state.excluded = [TEXT_A.key, TEXT_B.key]
  state.current = { ...TEXT_B, reasonCode: 'switch-idle', reason: 'x', orderIndex: 1, idle: true, owners: [] }
  const second = decideOnError(errorRequest({ state }))
  assert.equal(second.next.key, TEXT_C.key)
})

// ─────────────────────────── 3 会话占用 ───────────────────────────

await test('占用判定：inUse / running 分别可判定', () => {
  const occ = computeOccupancy([
    { sessionId: 'a', key: TEXT_A.key, status: 'running' },
    { sessionId: 'b', key: TEXT_A.key, status: 'idle' },
    { sessionId: 'c', key: TEXT_B.key, status: 'idle' },
    { sessionId: 'd', key: null, status: 'running' },
  ])
  assert.equal(occ[TEXT_A.key].inUse, true)
  assert.equal(occ[TEXT_A.key].running, true)
  assert.deepEqual(occ[TEXT_A.key].owners, ['a', 'b'])
  assert.equal(occ[TEXT_B.key].inUse, true)
  assert.equal(occ[TEXT_B.key].running, false)
  assert.equal(Object.keys(occ).length, 2) // 未选定模型的会话不计入
})

await test('自动切换优先选空闲模型（跳过被占用的靠前候选）', () => {
  const occupancy = computeOccupancy([{ sessionId: 'other', key: TEXT_B.key, status: 'running' }])
  const picked = selectModel(baseRequest({ occupancy }))
  assert.equal(picked.key, TEXT_A.key)
  assert.equal(picked.reasonCode, 'fallback-idle')
  assert.equal(picked.idle, true)
})

await test('同类型全部被占用 ⇒ 按既定顺序取第一个，并记录 owners', () => {
  const occupancy = computeOccupancy([
    { sessionId: 'x', key: TEXT_A.key, status: 'running' },
    { sessionId: 'y', key: TEXT_B.key, status: 'idle' },
    { sessionId: 'z', key: TEXT_C.key, status: 'idle' },
  ])
  const picked = selectModel(baseRequest({ occupancy }))
  assert.equal(picked.key, TEXT_A.key)
  assert.equal(picked.reasonCode, 'fallback-order')
  assert.deepEqual(picked.owners, ['x'])
})

await test('preferIdle=false ⇒ 一律按既定顺序', () => {
  const cfg = resolveConfig({ preferIdle: false })
  const occupancy = computeOccupancy([{ sessionId: 'x', key: TEXT_A.key, status: 'running' }])
  const picked = selectModel(baseRequest({ cfg, occupancy }))
  assert.equal(picked.reasonCode, 'fallback-order')
})

await test('同类型筛选：text 类型不会选到多模态模型', () => {
  const picked = selectModel(baseRequest({ catalog: catalogOf([MM_A, MM_B]), kind: 'text' }))
  assert.equal(picked, null)
})

// ─────────────────────────── 4 冷却与恢复 ───────────────────────────

await test('同类型候选全部 excluded ⇒ cooldown，时长 = cooldownMs', () => {
  const state = newSessionState('s1', 'text', { ...TEXT_C, reasonCode: 'switch-order', reason: 'x', orderIndex: 2, idle: true, owners: [] }, Date.now())
  state.retriesUsed = 2
  state.excluded = [TEXT_A.key, TEXT_B.key, TEXT_C.key]
  const now = Date.now()
  const d = decideOnError(errorRequest({ state, now }))
  assert.equal(d.action, 'cooldown')
  assert.equal(d.cooldownUntil, now + CFG.cooldownMs)
  assert.equal(CFG.cooldownMs, 30 * 60 * 1000)
})

await test('crossClassFallback=true ⇒ 同类型耗尽后跨类型，而不是冷却', () => {
  const cfg = resolveConfig({ crossClassFallback: true, maxRetries: 0 })
  const state = newSessionState('s1', 'text', { ...TEXT_C, reasonCode: 'switch-order', reason: 'x', orderIndex: 2, idle: true, owners: [] }, Date.now())
  state.excluded = [TEXT_A.key, TEXT_B.key, TEXT_C.key]
  const d = decideOnError(errorRequest({ state, cfg }))
  assert.equal(d.action, 'switch')
  assert.equal(d.reasonCode, 'switch-cross-class')
  assert.equal(d.next.kind, 'multimodal')
})

await test('冷却中再出错 ⇒ giveup(cooldown-active)，不重试', () => {
  const now = Date.now()
  const d = decideOnError(errorRequest({ now, cooldown: { until: now + 60_000, enteredAt: now, reason: 'test' } }))
  assert.equal(d.action, 'giveup')
  assert.equal(d.reasonCode, 'cooldown-active')
})

await test('模型级冷却期内不选该模型', () => {
  const now = Date.now()
  const picked = selectModel(baseRequest({ modelCooldown: { [TEXT_A.key]: now + 10_000 }, now }))
  assert.equal(picked.key, TEXT_B.key)
})

await test('冷却结束后 wakeFromCooldown 清空排除表并重新获取目录', async () => {
  nodeSide.reset()
  nodeSide.setContext(fakeCtx(), { maxRetries: 1, cooldownMs: 30 * 60 * 1000 })
  await nodeSide.enterCooldown('test', null)
  const before = nodeSide.state().cooldown
  assert.ok(before.until > Date.now())
  // 手动把到期时间拨到过去，模拟 30 分钟过去
  nodeSide.state().cooldown.until = Date.now() - 1
  await nodeSide.wakeFromCooldown()
  assert.equal(nodeSide.state().cooldown.until, 0)
  const records = nodeSide.state().logRing.recent(50)
  assert.ok(records.some((r) => r.event === 'cooldown-end'), '应记录 cooldown-end')
})

await test('冷却期抑制日志节流：连续拉目录不会刷满日志，但会累计抑制次数', async () => {
  nodeSide.reset()
  nodeSide.setContext(fakeCtx(), { maxRetries: 1, cooldownMs: 30 * 60 * 1000 })
  await nodeSide.enterCooldown('throttle', null)
  // 先建一份「已就绪」目录（模拟 llm 已可用），再把生成时间往回拨使 TTL 过期——
  // 这样后续 getCatalog(false) 越过 TTL、落到冷却抑制分支，与真实冷却期一致。
  // （目录未就绪时本就不会进入冷却，也就没有抑制日志可节流，故必须先就绪。）
  await nodeSide.getCatalog(true)
  // provider 集合刚变过时目录不算稳定，冷却抑制分支会被跳过；先标记集合已稳定再测节流。
  nodeSide.state().settleCatalog()
  nodeSide.state().rewindCatalogAt(61_000)
  const before = nodeSide.state().logRing.recent(600).filter((r) => r.reasonCode === 'cooldown-active').length
  // 模拟客户端 15s 轮询：连拉 40 次目录（真实场景 30 分钟冷却 ≈ 120 次）
  for (let i = 0; i < 40; i += 1) await nodeSide.getCatalog(false)
  let rows = nodeSide.state().logRing.recent(600).filter((r) => r.reasonCode === 'cooldown-active')
  assert.equal(rows.length - before, 1, `同一分钟内应只记 1 条，实际 ${rows.length - before}`)
  assert.equal(rows[rows.length - 1].suppressed, 0, '首次记录时还没有被折叠的次数')
  // 再拉 5 次（仍在同一分钟内，不记日志），然后把「上次记录时间」往回拨 61s 模拟过了一分钟
  for (let i = 0; i < 5; i += 1) await nodeSide.getCatalog(false)
  nodeSide.state().rewindCooldownSuppressLog(61_000)
  await nodeSide.getCatalog(false)
  rows = nodeSide.state().logRing.recent(600).filter((r) => r.reasonCode === 'cooldown-active')
  assert.equal(rows.length - before, 2, '过了节流窗口才再记 1 条')
  // 39 次（第一次窗口内）+ 5 次（第二次窗口前）= 44 次被折叠，累计不丢
  assert.equal(rows[rows.length - 1].suppressed, 44, '应把两个窗口累计被折叠的 44 次写进 suppressed')
  assert.equal(nodeSide.state().cooldown.until > Date.now(), true)
})

// ─────────────────────────── 5 日志字段 ───────────────────────────

await test('日志：选择 / 重试 / 切换 / 冷却四类事件字段齐全', () => {
  const ring = new LogRing(20)
  const base = { ts: Date.now(), sessionId: 's1', kind: 'text', maxRetries: 2 }
  ring.push({ ...base, event: 'select', to: TEXT_A.key, reasonCode: 'preferred', reason: '用户默认模型', orderIndex: 0 })
  ring.push({ ...base, event: 'retry', from: TEXT_A.key, attempts: 1, retriesUsed: 1, delayMs: 800, failureCode: 'UPSTREAM_500', reasonCode: 'retry' })
  ring.push({ ...base, event: 'switch', from: TEXT_A.key, to: TEXT_B.key, reasonCode: 'switch-idle', switches: 1 })
  ring.push({ ...base, event: 'cooldown', reasonCode: 'cooldown', cooldownUntil: Date.now() + 1000, cooldownRemainingMs: 1000 })
  const events = ring.recent(10).map((r) => r.event)
  assert.deepEqual(events, ['select', 'retry', 'switch', 'cooldown'])
  for (const record of ring.recent(10)) {
    assert.ok(typeof record.ts === 'number', `${record.event} 缺 ts`)
    assert.ok(typeof record.event === 'string')
    assert.ok(record.reasonCode !== undefined || record.event === 'occupancy', `${record.event} 缺 reasonCode`)
  }
})

await test('日志：超长文本被截断，数组被限长', () => {
  const ring = new LogRing(5)
  const safe = ring.push({ ts: Date.now(), event: 'giveup', reason: 'x'.repeat(1000), owners: Array.from({ length: 100 }, (_, i) => `s${i}`) })
  assert.ok(safe.reason.length <= 241)
  assert.equal(safe.owners.length, 32)
})

await test('日志：环形缓冲只保留最近 capacity 条', () => {
  const ring = new LogRing(16)
  for (let i = 0; i < 50; i += 1) ring.push({ ts: i, event: 'select' })
  assert.equal(ring.size, 16)
  assert.equal(ring.recent(1)[0].ts, 49)
})

// ─────────────────────────── 配置默认值 ───────────────────────────

await test('默认配置：maxRetries=2 / cooldownMs=30min / preferIdle=true / 开关开', () => {
  assert.equal(DEFAULT_CONFIG.maxRetries, 2)
  assert.equal(DEFAULT_CONFIG.cooldownMs, 1_800_000)
  assert.equal(DEFAULT_CONFIG.preferIdle, true)
  assert.equal(DEFAULT_CONFIG.enabled, true)
  assert.equal(DEFAULT_CONFIG.crossClassFallback, false)
})

await test('配置容错：非法值回落默认，合法值保留', () => {
  const cfg = resolveConfig({ maxRetries: -3, cooldownMs: 'x', preferIdle: 'yes', defaultModel: { provider: '', model: '' }, providerOrder: ['p1', 3, ''] })
  assert.equal(cfg.maxRetries, DEFAULT_CONFIG.maxRetries)
  assert.equal(cfg.cooldownMs, DEFAULT_CONFIG.cooldownMs)
  assert.equal(cfg.preferIdle, true)
  assert.equal(cfg.defaultModel, null)
  assert.deepEqual(cfg.providerOrder, ['p1'])
})

await test('enabled=false ⇒ decideOnError 直接 giveup(disabled)', () => {
  const cfg = resolveConfig({ enabled: false })
  const d = decideOnError(errorRequest({ cfg }))
  assert.equal(d.action, 'giveup')
  assert.equal(d.reasonCode, 'disabled')
})

// ─────────────────────────── node 半边（假 ctx） ───────────────────────────

function fakeCtx() {
  const providers = [
    { id: 'alpha', name: 'Alpha', settingsNs: 'llm-alpha' },
    { id: 'beta', name: 'Beta', settingsNs: 'llm-beta' },
  ]
  const models = {
    alpha: [
      { id: 'text-a', name: 'text-a', inputModalities: ['text'] },
      { id: 'mm-a', name: 'mm-a', inputModalities: ['text', 'image'] },
    ],
    beta: [{ id: 'text-b', name: 'text-b' }],
  }
  const llm = {
    listProviders: () => providers,
    listModels: async (pid) => models[pid] ?? [],
    resolveModelInfo: async (pid, mid) => ({ provider: pid, id: mid, name: mid, inputModalities: mid === 'text-b' ? ['text'] : undefined }),
  }
  const agents = [
    { id: 'session-1', status: 'running', session: { id: 'session-1', requestHeader: () => ({ config: { provider: 'alpha', model: 'text-a' } }) } },
    { id: 'session-2', status: 'idle', session: { id: 'session-2', requestHeader: () => undefined } },
  ]
  const selectionCalls = []
  const sessionController = {
    agents: {
      selectForNextRequest: (agent, selection) => {
        selectionCalls.push({ id: agent.id, ...selection })
      },
    },
  }
  const services = {
    llm,
    agents: { list: () => agents },
    sessionController,
    sessionProjections: { stateOf: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'alpha', model: 'text-a' }) },
  }
  return {
    get: (name) => services[name],
    on: () => {},
    effect: () => {},
    logger: { info: () => {} },
    __services: services,
    __selectionCalls: selectionCalls,
    __agents: agents,
  }
}

await test('node 半边：目录构建带上分类、来源与 fallback 标注', async () => {
  const ctx = fakeCtx()
  nodeSide.reset()
  nodeSide.setContext(ctx, { maxRetries: 1 })
  const snapshot = await nodeSide.getCatalog(true)
  assert.equal(snapshot.entries.length, 3)
  const byId = Object.fromEntries(snapshot.entries.map((e) => [e.model, e]))
  assert.equal(byId['mm-a'].kind, 'multimodal')
  assert.deepEqual(byId['mm-a'].modalities, ['text', 'image'])
  assert.equal(byId['mm-a'].modalitySource, 'listModels')
  assert.equal(byId['text-b'].kind, 'text')
  assert.equal(byId['text-b'].modalitySource, 'resolveModelInfo') // listModels 缺省 → resolveModelInfo 补齐
  assert.equal(byId['text-b'].providerName, 'Beta')
  assert.equal(byId['text-b'].providerSettingsNs, 'llm-beta')
  assert.equal(snapshot.failures.length, 0)
})

await test('node 半边：占用刷新读 requestHeader 判定使用中/空闲', async () => {
  const ctx = fakeCtx()
  nodeSide.reset()
  nodeSide.setContext(ctx, {})
  await nodeSide.getCatalog(true)
  const occ = nodeSide.refreshOccupancy('test')
  assert.equal(occ['alpha\u0000text-a'].inUse, true)
  assert.deepEqual(occ['alpha\u0000text-a'].owners, ['session-1'])
  assert.equal(occ['alpha\u0000text-a'].running, true)
})

await test('node 半边：applySelection 走 selectForNextRequest 官方入口', async () => {
  const ctx = fakeCtx()
  nodeSide.reset()
  nodeSide.setContext(ctx, { preferIdle: true })
  await nodeSide.getCatalog(true)
  const selection = await nodeSide.applySelection(ctx.__agents[1], 'text', 'test', { allowPreferred: false })
  assert.ok(selection !== null)
  assert.equal(ctx.__selectionCalls.length, 1)
  assert.equal(ctx.__selectionCalls[0].id, 'session-2')
  assert.equal(ctx.__selectionCalls[0].provider, selection.provider)
  assert.equal(ctx.__selectionCalls[0].model, selection.model)
  // 优先选空闲：text-a 被 session-1 占用 ⇒ 应落到 text-b
  assert.equal(selection.model, 'text-b')
  assert.equal(selection.reasonCode, 'fallback-idle')
})

await test('node 半边：handleRequestError 返回 retry 并记录 retry 日志', async () => {
  const ctx = fakeCtx()
  nodeSide.reset()
  nodeSide.setContext(ctx, { maxRetries: 1, retryDelayMs: 0 })
  await nodeSide.getCatalog(true)
  await nodeSide.applySelection(ctx.__agents[1], 'text', 'test', { allowPreferred: false })
  const action = await nodeSide.handleRequestError({
    agent: ctx.__agents[1],
    turn: 1,
    step: 1,
    failure: { code: 'UPSTREAM_500', message: 'boom' },
    signal: { aborted: false },
  })
  assert.deepEqual(action, { kind: 'retry' })
  const records = nodeSide.state().logRing.recent(20)
  const retry = records.find((r) => r.event === 'retry')
  assert.ok(retry !== undefined, '应写 retry 记录')
  assert.equal(retry.sessionId, 'session-2')
  assert.equal(retry.failureCode, 'UPSTREAM_500')
  assert.equal(retry.maxRetries, 1)
})

await test('node 半边：重试耗尽后切换并写 switch 记录（from/to/reasonCode 齐全）', async () => {
  const ctx = fakeCtx()
  nodeSide.reset()
  nodeSide.setContext(ctx, { maxRetries: 0, retryDelayMs: 0 })
  await nodeSide.getCatalog(true)
  await nodeSide.applySelection(ctx.__agents[1], 'text', 'test', { allowPreferred: false })
  const before = ctx.__selectionCalls.length
  await nodeSide.handleRequestError({
    agent: ctx.__agents[1],
    turn: 1,
    step: 1,
    failure: { code: 'UPSTREAM_500', message: 'boom' },
    signal: { aborted: false },
  })
  const records = nodeSide.state().logRing.recent(20)
  const sw = records.find((r) => r.event === 'switch')
  assert.ok(sw !== undefined, '应写 switch 记录')
  assert.ok(typeof sw.from === 'string' && typeof sw.to === 'string' && sw.from !== sw.to)
  assert.ok(sw.reasonCode.startsWith('switch-'))
  assert.equal(ctx.__selectionCalls.length, before + 1)
})

await test('node 半边：catalogView 暴露 entries/occupancy/cooldown/sessions/config', async () => {
  const ctx = fakeCtx()
  nodeSide.reset()
  nodeSide.setContext(ctx, {})
  const snapshot = await nodeSide.getCatalog(true)
  const view = nodeSide.catalogView(snapshot)
  for (const key of ['version', 'entries', 'occupancy', 'cooldown', 'sessions', 'config']) assert.ok(key in view, `缺字段 ${key}`)
  assert.equal(view.cooldown.active, false)
  assert.equal(view.config.maxRetries, DEFAULT_CONFIG.maxRetries)
})

// 
// Context window: host discloses it only via resolveModelInfo result (.context.contextWindow);
// listModels LlmModelInfo carries no such field. Fail-closed: buildCatalog -> catalogView must
// forward it, and must never fabricate a value when the host does not disclose one.
function fakeCtxWithContextWindow() {
  const ctx = fakeCtx()
  const llm = ctx.__services.llm
  // text-a discloses a context window; text-b / mm-a do not (no context field)
  llm.resolveModelInfo = async (pid, mid) => {
    if (mid === 'text-a') return { provider: pid, id: mid, name: mid, inputModalities: ['text'], context: { contextWindow: 200000 } }
    return { provider: pid, id: mid, name: mid, inputModalities: mid === 'text-b' ? ['text'] : undefined }
  }
  return ctx
}

await test('node side: context window forwarded from resolveModelInfo into snapshot and catalogView', async () => {
  const ctx = fakeCtxWithContextWindow()
  nodeSide.reset()
  nodeSide.setContext(ctx, {})
  const snapshot = await nodeSide.getCatalog(true)
  const snapById = Object.fromEntries(snapshot.entries.map((e) => [e.model, e]))
  assert.equal(snapById['text-a'].contextWindow, 200000, 'snapshot should carry text-a contextWindow')
  assert.equal(snapById['text-a'].modalitySource, 'listModels', 'multimodal still prefers listModels, not resolveModelInfo')
  assert.equal(snapById['text-b'].contextWindow, undefined, 'undisclosed model must not carry contextWindow')

  const view = nodeSide.catalogView(snapshot)
  const viewById = Object.fromEntries(view.entries.map((e) => [e.model, e]))
  assert.equal(viewById['text-a'].contextWindow, 200000, 'catalogView must forward contextWindow to client (this was the bug that hid it)')
  assert.equal(viewById['text-b'].contextWindow, undefined, 'catalogView must not fabricate contextWindow')
})
// ──面板分组：用户自定义优先，其次按类型 ─────────────────────

await test('分组：未设置自定义规则时，所有来源的多模态一组、纯文本一组', async () => {
  const groups = groupCatalog(CATALOG.entries, CFG)
  assert.deepEqual(groups.map((g) => g.id), ['multimodal', 'text'])
  assert.deepEqual(groups[0].entries.map((e) => e.key).sort(), [MM_A.key, MM_B.key].sort())
  assert.deepEqual(groups[1].entries.map((e) => e.key).sort(), [TEXT_A.key, TEXT_B.key, TEXT_C.key].sort())
  assert.equal(groups[0].custom, false)
  assert.equal(groups[0].label, '多模态 · 2')
})

await test('分组：groupByKind=false 时退回按来源分组', async () => {
  const groups = groupCatalog(CATALOG.entries, resolveConfig({ ...CFG, groupByKind: false }))
  assert.deepEqual(groups.map((g) => g.id), ['alpha', 'beta'])
  assert.equal(groups[0].entries.length, 3)
})

await test('分组：自定义规则接管，按顺序先命中先归组', async () => {
  const cfg = resolveConfig({
    customGroups: [
      { id: 'a', label: '免费多模态', kind: 'multimodal', freeOnly: true },
      { id: 'b', label: 'Beta 全部', providers: ['beta'] },
    ],
  })
  const withFree = CATALOG.entries.map((e) => (e.key === MM_B.key ? { ...e, free: true, priceFactor: 0 } : e))
  const groups = groupCatalog(withFree, cfg)
  assert.deepEqual(groups.map((g) => g.id), ['a', 'b', '__rest__'])
  assert.deepEqual(groups[0].entries.map((e) => e.key), [MM_B.key])
  assert.deepEqual(groups[1].entries.map((e) => e.key).sort(), [TEXT_C.key].sort())
  assert.equal(groups[2].label, '其他 · 3')
  assert.ok(groups.every((g, i) => (i < 2 ? g.custom === true : g.custom === false)))
})

await test('分组：规则没命中任何模型时该组不出现，模型不会被吞掉', async () => {
  const cfg = resolveConfig({ customGroups: [{ id: 'x', label: '空的', providers: ['nope'] }] })
  const groups = groupCatalog(CATALOG.entries, cfg)
  assert.deepEqual(groups.map((g) => g.id), ['__rest__'])
  assert.equal(groups[0].entries.length, CATALOG.entries.length)
})

await test('分组：自定义规则里 kind / providers / models / freeOnly 是「且」关系', async () => {
  const cfg = resolveConfig({
    customGroups: [{ id: 'x', label: '多模态且alpha', kind: 'multimodal', providers: ['alpha'] }],
  })
  const groups = groupCatalog(CATALOG.entries, cfg)
  assert.deepEqual(groups[0].entries.map((e) => e.key), [MM_A.key])
})

await test('配置：customGroups 非法条目被整条丢弃，合法条目保留', async () => {
  const cfg = resolveConfig({
    customGroups: [
      { id: 'ok', label: '保留', kind: 'text', providers: ['alpha'], models: ['alpha/text-a'], freeOnly: false },
      { id: 'ok', label: '重复 id' },
      { label: '没有 id' },
      null,
      'not-an-object',
    ],
  })
  assert.equal(cfg.customGroups.length, 1)
  assert.deepEqual(cfg.customGroups[0], { id: 'ok', label: '保留', kind: 'text', providers: ['alpha'], models: ['alpha/text-a'], freeOnly: false, explicit: false })
})

await test('配置：默认 customGroups 为空数组（默认按类型分组）', async () => {
  assert.deepEqual(DEFAULT_CONFIG.customGroups, [])
  assert.equal(DEFAULT_CONFIG.groupByKind, true)
})

await test('配置：四类条件全空的规则被丢弃（否则它会吞掉全部模型）', async () => {
  // 真机踩过：profile 的 cordis.patch.yml 里留了一条 id 非空但条件全空的规则，
  // matchesGroup 把「空条件」当「不限」，结果 50 个模型全落进同一组「自定义 · 50」。
  const cfg = resolveConfig({
    customGroups: [
      { id: 'gmvvwi9qt', label: '', kind: null, providers: [], models: [], freeOnly: false },
      { id: 'keep', label: '只要 alpha 的多模态', kind: 'multimodal', providers: ['alpha'], models: [], freeOnly: false },
    ],
  })
  assert.equal(cfg.customGroups.length, 1, `全空规则应被丢弃，实际 ${JSON.stringify(cfg.customGroups)}`)
  assert.equal(cfg.customGroups[0].id, 'keep')
})

await test('配置：全空规则不会挤掉同 id 的有效规则', async () => {
  const cfg = resolveConfig({
    customGroups: [
      { id: 'dup', label: '', kind: null, providers: [], models: [], freeOnly: false },
      { id: 'dup', label: '有效', kind: 'text', providers: ['beta'], models: [], freeOnly: false },
    ],
  })
  assert.equal(cfg.customGroups.length, 1)
  assert.equal(cfg.customGroups[0].label, '有效')
})

await test('配置：isEmptyGroup 判定四类条件（且关系，任一非空即有效）', async () => {
  assert.equal(isEmptyGroup({ kind: null, providers: [], models: [], freeOnly: false }), true)
  assert.equal(isEmptyGroup({ kind: 'text', providers: [], models: [], freeOnly: false }), false)
  assert.equal(isEmptyGroup({ kind: null, providers: ['alpha'], models: [], freeOnly: false }), false)
  assert.equal(isEmptyGroup({ kind: null, providers: [], models: ['alpha/a'], freeOnly: false }), false)
  assert.equal(isEmptyGroup({ kind: null, providers: [], models: [], freeOnly: true }), false)
})

await test('行内徽标：多模态=图、纯文本=文，限免用配置里的短词', async () => {
  const free = { ...MM_A, free: true, priceFactor: 0 }
  assert.deepEqual(badgeOf(free, CFG), { kindGlyph: '图', free: '免' })
  assert.deepEqual(badgeOf(TEXT_A, CFG), { kindGlyph: '文', free: null })
  assert.deepEqual(badgeOf(free, resolveConfig({ freeBadgeLabel: '免费' })), { kindGlyph: '图', free: '免费' })
})

await test('dsh 设置页面：插件导出 Config 且 17 项全部 volatile', async () => {
  const mod = await import('../lib/index.js')
  assert.ok(mod.Config !== undefined, '缺少 Config 导出 ⇒ settings.describe() 不会出现本插件')
  const json = mod.Config.toJSON()
  const meta = JSON.stringify(json)
  assert.ok(meta.includes('"volatile"'), 'schema 里没有 volatile 标记')
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(meta.includes(key), `Config 缺少配置项 ${key}`)
  }
  const form = mod.Config['~standard'].validate({})
  assert.equal(form.issues, undefined, `空配置校验失败：${JSON.stringify(form.issues)}`)
  // 每个字段都是 Ref（宿主注入形态），readConfigRefs 必须摊平
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.equal(typeof form.value[key]?.get, 'function', `${key} 不是 Ref`)
  }
})

await test('dsh 设置页面：Config 校验结果能摊平成 resolveConfig 可用的裸对象', async () => {
  const mod = await import('../lib/index.js')
  const form = mod.Config['~standard'].validate({ maxRetries: 5, freeBadgeLabel: '免费' })
  assert.equal(form.issues, undefined)
  const flat = nodeSide.readConfigRefs(form.value)
  const cfg = resolveConfig(flat)
  assert.equal(cfg.maxRetries, 5)
  assert.equal(cfg.freeBadgeLabel, '免费')
  assert.equal(cfg.cooldownMs, 1_800_000)
})

await test('dsh 设置页面：client 半边声明 slots 注入并注册 settings.section 与 conversation.input.model', async () => {
  const src = await readFile(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const injectLine = src.split(String.fromCharCode(10)).filter((line) => line.startsWith('export const inject'))[0]
  assert.ok(injectLine !== undefined, 'client 没有声明 inject')
  for (const name of ['slots', 'modelDirectories', 'sessions', 'remote']) {
    assert.ok(injectLine.includes("'" + name + "'"), `inject 缺 ${name}：${injectLine}`)
  }
  assert.ok(src.includes("SETTINGS_SLOT = 'settings.section'"), '没有注册 settings.section')
  assert.ok(src.includes("SETTINGS_ID = 'model-auto-select'"), 'settings.section 的 id 不对')
  // 自建模型下拉：必须显式 priority，否则动态门面分配 0 与宿主撞车（single slot 已注册）
  assert.ok(src.includes("priority: -1"), 'conversation.input.model 注册缺显式 priority: -1')
  assert.ok(src.includes("MODEL_SLOT = 'conversation.input.model'"), '没有注册 conversation.input.model')
})

await test('node 半边：路由随插件卸载注销，重启不再撞 duplicate prefix route', async () => {
  const mod = await import('../lib/index.js')
  // 宿主语义：同一 (kind, path) 重复注册直接抛错（dsh-host-webserver/lib/index.js:326-334），
  // 所以插件重启时必须先注销旧路由，否则新实例启动即失败（线上表现：插件卡在 stopped）。
  const makeWebServer = () => {
    // 照抄宿主形状（dsh-host-webserver/lib/index.js:267-268）：exact / prefixes 两张按 path 索引的 Map。
    const exact = new Map()
    const prefixes = new Map()
    const tableOf = (kind) => (kind === 'exact' ? exact : prefixes)
    return {
      exact,
      prefixes,
      get routes() {
        return prefixes
      },
      register: (route) => {
        const table = tableOf(route.kind)
        if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        table.set(route.path, route)
        return () => {
          table.delete(route.path)
        }
      },
    }
  }
  const makeCtx = (webServer) => {
    const cleanups = []
    const services = {
      llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => undefined },
      agents: { list: () => [] },
      sessionProjections: { stateOf: () => undefined },
      agentDefaultModel: { currentSelection: () => ({ provider: '', model: '' }) },
    }
    return {
      get: (name) => services[name],
      on: () => {},
      effect: (fn) => {
        const dispose = fn()
        if (typeof dispose === 'function') cleanups.push(dispose)
      },
      webServer,
      __cleanups: cleanups,
    }
  }
  const runCleanups = (ctx) => {
    while (ctx.__cleanups.length > 0) ctx.__cleanups.pop()()
  }

  // 正解路径：apply → 跑掉 disposer（等价于插件卸载）→ 再 apply 不撞重复
  const webServer = makeWebServer()
  const ctx1 = makeCtx(webServer)
  mod.apply(ctx1, {})
  assert.equal(webServer.routes.size, 1, '首次 apply 应注册一条前缀路由')
  runCleanups(ctx1)
  assert.equal(webServer.routes.size, 0, '卸载后路由必须被注销（register 的 disposer 要接住）')
  const ctx2 = makeCtx(webServer)
  mod.apply(ctx2, {})
  assert.equal(webServer.routes.size, 1, '重启后应能重新注册同一条路由')
  runCleanups(ctx2)
  assert.equal(webServer.routes.size, 0, '第二次卸载同样要清干净')

  // 反证：假 webServer 与宿主行为一致（重复注册确实抛错），上面的绿不是因为它不校验
  const probe = makeWebServer()
  probe.register({ kind: 'prefix', path: '/dsh-model-auto-select', handler: () => {} })
  assert.throws(() => probe.register({ kind: 'prefix', path: '/dsh-model-auto-select', handler: () => {} }), /duplicate prefix route/)
})

await test('node 半边：路由表里残留僵尸路由时，新实例能自愈接管', async () => {
  const mod = await import('../lib/index.js')
  // 现场：历史版本把 register 的 disposer 丢了，旧路由永久留在进程路由表里。
  // 之后每次重载都撞 `duplicate prefix route`，插件卡在 stopped，写配置全被拒。
  // 新实例必须自己把那条僵尸拆掉，不能要求用户重启 dsh。
  const exact = new Map()
  const prefixes = new Map()
  const webServer = {
    exact,
    prefixes,
    register: (route) => {
      const table = route.kind === 'exact' ? exact : prefixes
      if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      table.set(route.path, route)
      return () => {
        table.delete(route.path)
      }
    },
  }
  // 先手放一条「上一实例遗留」的路由（没有 disposer、也没登记到 globalThis）
  prefixes.set('/dsh-model-auto-select', { kind: 'prefix', path: '/dsh-model-auto-select', handler: () => {} })

  const services = {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => undefined },
    agents: { list: () => [] },
    sessionProjections: { stateOf: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: '', model: '' }) },
  }
  const cleanups = []
  const ctx = {
    get: (name) => services[name],
    on: () => {},
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
    webServer,
  }
  mod.apply(ctx, {})
  assert.equal(prefixes.size, 1, '新实例应接管该前缀（僵尸被拆、自己的路由注册成功）')
  const route = prefixes.get('/dsh-model-auto-select')
  assert.equal(typeof route.handler, 'function', '接管后路由的 handler 必须是新实例的')
  const reason = mod.__test.state().logRing.recent(500).some((row) => /僵尸路由/.test(row.reason ?? ''))
  assert.ok(reason, '自愈必须留下日志（可追踪），不能静默')
  while (cleanups.length > 0) cleanups.pop()()
  assert.equal(prefixes.size, 0, '卸载后同样要清干净')
})

await test('分组：显式成员模式的空分组是合法的（不会被当成空规则丢掉）', async () => {
  const cfg = resolveConfig({ customGroups: [{ id: 'g1', label: '我的组', explicit: true, kind: null, providers: [], models: [], freeOnly: false }] })
  assert.equal(cfg.customGroups.length, 1, '显式空分组必须保留，否则用户建不出「先建组再勾成员」')
  assert.equal(cfg.customGroups[0].explicit, true)
  assert.equal(isEmptyGroup({ kind: null, providers: [], models: [], freeOnly: false, explicit: true }), false, 'explicit 分组不算空')
  assert.equal(isEmptyGroup({ kind: null, providers: [], models: [], freeOnly: false }), true, '非 explicit 的全空规则仍要丢')
})

await test('分组：显式成员只认名单，空名单不吞任何模型', async () => {
  const cfg = resolveConfig({ customGroups: [{ id: 'g1', label: '空组', explicit: true, kind: null, providers: [], models: [], freeOnly: false }] })
  const groups = groupCatalog(CATALOG.entries, cfg)
  // 空组不进「模型列表」的渲染（否则会画一个空标题）；它由分组编辑器单独展示，仍可勾成员
  assert.equal(groups.find((g) => g.id === 'g1'), undefined, '空组不该出现在模型列表分组里')
  const rest = groups.find((g) => g.id === '__rest__')
  assert.ok(rest !== undefined && rest.entries.length === CATALOG.entries.length, '未被命中的模型要落到「其他」，不能丢')
})

await test('分组：显式成员按 provider/model 全名或裸 model 名命中', async () => {
  const cfg = resolveConfig({
    customGroups: [{ id: 'g1', label: '我的组', explicit: true, kind: null, providers: [], models: ['alpha/text-a', 'text-c'], freeOnly: false }],
  })
  const groups = groupCatalog(CATALOG.entries, cfg)
  const g1 = groups.find((g) => g.id === 'g1')
  const keys = g1.entries.map((e) => e.key).sort()
  assert.deepEqual(keys, ['alpha text-a', 'beta text-c'].sort(), `显式成员应命中两个，实际 ${JSON.stringify(keys)}`)
})

await test('分组：groupsOf 给出「模型 key → 所属分组 id」映射', async () => {
  const cfg = resolveConfig({
    customGroups: [{ id: 'g1', label: '我的组', explicit: true, kind: null, providers: [], models: ['alpha/text-a'], freeOnly: false }],
  })
  const map = groupsOf(CATALOG.entries, cfg)
  assert.deepEqual(map.get('alpha text-a'), ['g1'])
  assert.deepEqual(map.get('beta text-c'), ['__rest__'])
  assert.equal(map.size, CATALOG.entries.length, '每个模型都要有归属（含「其他」组）')
})

await test('自动选择：分组级关闭等价于整组模型不可用', async () => {
  const cfg = resolveConfig({
    customGroups: [{ id: 'g1', label: '我的组', explicit: true, kind: null, providers: [], models: ['alpha/text-a'], freeOnly: false }],
    disabledGroups: ['g1'],
  })
  assert.equal(isDisabled('alpha', 'text-a', cfg, ['g1']), true, '整组关掉后组内模型不参与自动选择')
  assert.equal(isDisabled('alpha', 'text-a', cfg, ['__rest__']), false, '不在被关组里的模型不受影响')
  assert.equal(isDisabled('alpha', 'text-a', resolveConfig({ disabledGroups: [] }), []), false, '默认不关')
})

await test('下拉展示：hiddenGroups / hiddenModels 只影响展示，不影响自动选择', async () => {
  const cfg = resolveConfig({
    customGroups: [{ id: 'g1', label: '我的组', explicit: true, kind: null, providers: [], models: ['alpha/text-a'], freeOnly: false }],
    hiddenGroups: ['g1'],
    hiddenModels: ['beta/text-c'],
  })
  assert.equal(isHidden('alpha', 'text-a', cfg, ['g1']), true, '整组隐藏生效')
  assert.equal(isHidden('beta', 'text-c', cfg, ['__rest__']), true, '单个模型隐藏生效')
  assert.equal(isHidden('alpha', 'mm-a', cfg, ['__rest__']), false, '没设隐藏的模型照常展示')
  assert.equal(isDisabled('alpha', 'text-a', cfg, ['g1']), false, '隐藏不等于关掉自动选择')
})

await test('未入组：没建自定义分组时恒为 false（不改变 dsh 原生全量可用）', async () => {
  const cfg = resolveConfig({ customGroups: [] })
  assert.equal(isUnassigned({ provider: 'alpha', model: 'text-a' }, cfg), false, '没建组时不该判为未入组')
})

await test('未入组：建过组后，没被任何组收的模型即为未入组（默认不可用 + 不进下拉）', async () => {
  const cfg = resolveConfig({
    customGroups: [{ id: 'g1', label: '我的组', explicit: true, kind: null, providers: [], models: ['alpha/text-a'], freeOnly: false }],
  })
  assert.equal(isUnassigned({ provider: 'alpha', model: 'text-a' }, cfg), false, '在组名单里的模型不算未入组')
  assert.equal(isUnassigned({ provider: 'beta', model: 'text-c' }, cfg), true, '没入组的模型必须判为未入组')
})

await test('未入组：裸模型名与 provider/model 全名都算命中（不被误判）', async () => {
  const cfg = resolveConfig({
    customGroups: [{ id: 'g1', label: '我的组', explicit: true, kind: null, providers: [], models: ['text-a'], freeOnly: false }],
  })
  assert.equal(isUnassigned({ provider: 'alpha', model: 'text-a' }, cfg), false, '裸名命中时不该判为未入组')
})
// ─────────────────────────── 8 自动切换作用域（switchScope） ───────────────────────────

const SCOPED_CFG = resolveConfig({
  maxRetries: 2,
  retryDelayMs: 0,
  customGroups: [
    { id: 'g1', label: '甲组', explicit: true, kind: null, providers: [], models: ['alpha/text-a', 'alpha/text-b'], freeOnly: false },
    { id: 'g2', label: '乙组', explicit: true, kind: null, providers: [], models: ['beta/text-c'], freeOnly: false },
  ],
})

await test('switchScope：默认 group-cross，非法值回落默认', () => {
  assert.equal(DEFAULT_CONFIG.switchScope, 'group-cross')
  assert.deepEqual(SWITCH_SCOPE_VALUES, ['all', 'group', 'group-cross'])
  assert.equal(normalizeSwitchScope('group'), 'group')
  assert.equal(normalizeSwitchScope('all'), 'all')
  assert.equal(normalizeSwitchScope('group-cross'), 'group-cross')
  assert.equal(normalizeSwitchScope('nope'), 'group-cross', '非法值必须回落默认')
  assert.equal(normalizeSwitchScope(undefined), 'group-cross')
  assert.equal(resolveConfig({ switchScope: 'group' }).switchScope, 'group')
})

await test('scopeGroupsOf：能反查模型所属分组，未知/空 key 返回空数组', () => {
  assert.deepEqual(scopeGroupsOf(CATALOG.entries, TEXT_A.key, SCOPED_CFG), ['g1'])
  assert.deepEqual(scopeGroupsOf(CATALOG.entries, TEXT_C.key, SCOPED_CFG), ['g2'])
  assert.deepEqual(scopeGroupsOf(CATALOG.entries, null, SCOPED_CFG), [])
  assert.deepEqual(scopeGroupsOf(CATALOG.entries, 'nope/x', SCOPED_CFG), [])
})

await test('组内作用域：只在当前模型所在分组里换，不跨到别组', () => {
  const picked = selectModel(baseRequest({ catalog: CATALOG, cfg: SCOPED_CFG, scopeGroups: ['g1'] }))
  assert.equal(picked.key, TEXT_A.key, '甲组里按序第一个')
  assert.equal(picked.reasonCode, 'fallback-idle')
  assert.ok(picked.reason.includes('组内'), picked.reason)
})

await test('组内作用域：组内候选耗尽 + switchScope=group ⇒ 无候选（不乱跨组）', () => {
  const picked = selectModel(
    baseRequest({
      catalog: CATALOG,
      cfg: resolveConfig({ ...SCOPED_CFG, switchScope: 'group' }),
      scopeGroups: ['g1'],
      excluded: [TEXT_A.key, TEXT_B.key],
    }),
  )
  assert.equal(picked, null)
})

await test('组内作用域：组内候选耗尽 + switchScope=group-cross ⇒ 跨组兜底并标 cross-group', () => {
  const picked = selectModel(baseRequest({ catalog: CATALOG, cfg: SCOPED_CFG, scopeGroups: ['g1'], excluded: [TEXT_A.key, TEXT_B.key] }))
  assert.equal(picked.key, TEXT_C.key, '只能跨到乙组')
  assert.equal(picked.reasonCode, 'cross-group')
  assert.ok(picked.reason.includes('跨组'), picked.reason)
})

await test('switchScope=all ⇒ 忽略分组作用域，全类型池子按序取', () => {
  const picked = selectModel(
    baseRequest({
      catalog: CATALOG,
      cfg: resolveConfig({ ...SCOPED_CFG, switchScope: 'all' }),
      scopeGroups: ['g1'],
      excluded: [TEXT_A.key, TEXT_B.key],
    }),
  )
  assert.equal(picked.key, TEXT_C.key)
  assert.equal(picked.reasonCode, 'fallback-idle', 'all 模式不该标 cross-group')
})

await test('首选不受分组作用域限制：显式选的模型落在别组也照用', () => {
  const picked = selectModel(baseRequest({ catalog: CATALOG, cfg: SCOPED_CFG, preferredKey: TEXT_C.key, scopeGroups: ['g1'] }))
  assert.equal(picked.key, TEXT_C.key)
  assert.equal(picked.reasonCode, 'preferred')
})

await test('未建自定义分组时作用域为空 ⇒ 行为与 all 一致（旧配置不受影响）', () => {
  const picked = selectModel(baseRequest({ catalog: CATALOG, cfg: CFG, scopeGroups: [] }))
  assert.equal(picked.key, TEXT_A.key)
  assert.equal(picked.reasonCode, 'fallback-idle')
  assert.ok(!picked.reason.includes('组内'), picked.reason)
})

await test('decideOnError：组内耗尽 ⇒ switch-cross-group（而不是直接冷却）', () => {
  const state = newSessionState('s1', 'text', { ...TEXT_B, reasonCode: 'switch-order', reason: 'x', orderIndex: 1, idle: true, owners: [] }, Date.now())
  state.retriesUsed = 2
  state.excluded = [TEXT_A.key]
  const d = decideOnError(errorRequest({ state, cfg: SCOPED_CFG, scopeGroups: ['g1'] }))
  assert.equal(d.action, 'switch')
  assert.equal(d.reasonCode, 'switch-cross-group')
  assert.equal(d.next.key, TEXT_C.key)
})

await test('decideOnError：switchScope=group 且组内耗尽 ⇒ 不进跨组，走冷却', () => {
  const state = newSessionState('s1', 'text', { ...TEXT_B, reasonCode: 'switch-order', reason: 'x', orderIndex: 1, idle: true, owners: [] }, Date.now())
  state.retriesUsed = 2
  state.excluded = [TEXT_A.key]
  const now = Date.now()
  const d = decideOnError(errorRequest({ state, now, cfg: resolveConfig({ ...SCOPED_CFG, switchScope: 'group' }), scopeGroups: ['g1'] }))
  assert.equal(d.action, 'cooldown')
  assert.equal(d.cooldownUntil, now + CFG.cooldownMs)
})

await test('decideOnError：组内还有候选 ⇒ 组内切换（switch-idle / switch-order）', () => {
  const state = newSessionState('s1', 'text', { ...TEXT_A, reasonCode: 'switch-order', reason: 'x', orderIndex: 0, idle: true, owners: [] }, Date.now())
  state.retriesUsed = 2
  const d = decideOnError(errorRequest({ state, cfg: SCOPED_CFG, scopeGroups: ['g1'] }))
  assert.equal(d.action, 'switch')
  assert.equal(d.next.key, TEXT_B.key, '甲组内下一个')
  assert.equal(d.reasonCode, 'switch-idle')
})


// ─────────────────────────── 死锁修复回归（m00002） ───────────────────────────

// llm 未就绪时的假 ctx：get('llm') 返回 undefined，buildCatalog 早退、catalogReady=false
function fakeCtxNoLlm() {
  const ctx = fakeCtx()
  const origGet = ctx.get
  ctx.get = (name) => (name === 'llm' ? undefined : origGet(name))
  return ctx
}

await test('node 半边：目录未就绪时 applySelection 不进冷却（防死锁）', async () => {
  nodeSide.reset()
  const ctx = fakeCtxNoLlm()
  nodeSide.setContext(ctx, { cooldownMs: 30 * 60 * 1000 })
  const selection = await nodeSide.applySelection(ctx.__agents[1], 'text', 'test', { allowPreferred: false })
  assert.equal(selection, null, '未就绪时无候选应返回 null')
  assert.equal(nodeSide.state().catalogReady, false, 'llm 不可用 → catalogReady 应仍为 false')
  assert.equal(nodeSide.state().cooldown.until > Date.now(), false, '未就绪绝不该进入 30 分钟冷却（否则锁死）')
  const records = nodeSide.state().logRing.recent(20)
  assert.ok(
    records.some((r) => r.event === 'select' && r.reasonCode === 'catalog-not-ready'),
    '应记一条 catalog-not-ready，提示待目录就绪后恢复',
  )
})

await test('node 半边：目录就绪后自动补选此前未选择的会话', async () => {
  nodeSide.reset()
  const ctxNoLlm = fakeCtxNoLlm()
  nodeSide.setContext(ctxNoLlm, { preferIdle: true })
  // 启动早期 llm 未就绪：会话被登记为 current=null，但不进冷却
  const selection0 = await nodeSide.applySelection(ctxNoLlm.__agents[1], 'text', 'test', { allowPreferred: false })
  assert.equal(selection0, null)
  assert.equal(nodeSide.state().cooldown.until > Date.now(), false, '未就绪阶段不应误进冷却')
  // llm 现在就绪：切到真实 fakeCtx 并触发一次目录构建
  const ctx = fakeCtx()
  nodeSide.setContext(ctx, { preferIdle: true })
  await nodeSide.getCatalog(true)
  // recoverSelections 应对 session-2 补选，并真正交给宿主 selectForNextRequest
  const recs = nodeSide.state().logRing.recent(40)
  assert.ok(
    recs.some((r) => r.event === 'select' && r.sessionId === 'session-2' && r.reasonCode !== 'catalog-not-ready'),
    '目录就绪后应给此前未选择的会话真正选一次',
  )
  assert.equal(ctx.__selectionCalls.some((c) => c.id === 'session-2'), true, '应调用宿主 selectForNextRequest 把模型交给会话')
  assert.equal(nodeSide.state().cooldown.until > Date.now(), false, '整个过程不应误进冷却')
})


// provider 集合不完整 ≠ 目录就绪（活宿主 m01113 证据：先 8 个 provider/27 条 → 完整 27 个/172 条）
function fakeCtxGrowing() {
  const alpha = { id: 'alpha', name: 'Alpha', settingsNs: 'llm-alpha' }
  const beta = { id: 'beta', name: 'Beta', settingsNs: 'llm-beta' }
  let providers = [alpha]
  const models = { alpha: [{ id: 'text-a', name: 'text-a', inputModalities: ['text'] }], beta: [{ id: 'text-b', name: 'text-b', inputModalities: ['text'] }] }
  const llm = {
    listProviders: () => providers,
    listModels: async (pid) => models[pid] ?? [],
    resolveModelInfo: async (pid, mid) => ({ provider: pid, id: mid, name: mid, inputModalities: ['text'] }),
  }
  const agents = [{ id: 'session-1', status: 'idle', session: { id: 'session-1', requestHeader: () => undefined } }]
  const selectionCalls = []
  const handlers = new Map()
  const sessionController = { agents: { selectForNextRequest: (agent, sel) => { selectionCalls.push({ id: agent.id, ...sel }) } } }
  const services = {
    llm,
    agents: { list: () => agents },
    sessionController,
    sessionProjections: { stateOf: () => undefined },
    agentDefaultModel: { currentSelection: () => undefined },
  }
  return {
    get: (name) => services[name],
    on: (name, fn) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    effect: () => {},
    logger: { info: () => {} },
    __services: services,
    __selectionCalls: selectionCalls,
    __agents: agents,
    __handlers: handlers,
    __grow: () => { providers = [alpha, beta] },
  }
}

await test('node 半边：provider 集合未稳定时不下无候选结论、不进冷却', async () => {
  nodeSide.reset()
  const ctx = fakeCtxGrowing()
  // 只把 beta/text-b 收进分组：此时 beta 还没注册 → 唯一 text 模型 text-a 属未入组 → 无候选
  nodeSide.setContext(ctx, { cooldownMs: 30 * 60 * 1000, customGroups: [{ id: 'g1', name: 'G1', models: ['beta/text-b'], explicit: true }] })
  const first = await nodeSide.applySelection(ctx.__agents[0], 'text', 'test', { allowPreferred: false })
  assert.equal(first, null, '集合未稳定时应拿不到候选')
  assert.equal(nodeSide.state().catalogReady, true, 'llm 可调用即 catalogReady')
  assert.equal(nodeSide.state().catalogSettled(), false, '首次建目录刚发现集合 → 尚未稳定')
  assert.equal(nodeSide.state().cooldown.until > Date.now(), false, '集合未稳定绝不该进冷却（否则锁死 30 分钟）')
  const recs = nodeSide.state().logRing.recent(20)
  assert.ok(recs.some((r) => r.reasonCode === 'catalog-settling'), '应记 catalog-settling，说明是「还没稳」而非「真没有」')
})

await test('node 半边：provider 补齐后目录重建即可选到新模型', async () => {
  nodeSide.reset()
  const ctx = fakeCtxGrowing()
  nodeSide.setContext(ctx, { cooldownMs: 30 * 60 * 1000, customGroups: [{ id: 'g1', name: 'G1', models: ['beta/text-b'], explicit: true }] })
  await nodeSide.applySelection(ctx.__agents[0], 'text', 'test', { allowPreferred: false })
  assert.equal(nodeSide.state().cooldown.until > Date.now(), false, '未稳定阶段不进冷却')
  // provider 陆续注册完成：beta/text-b 出现，重建后应能选到
  ctx.__grow()
  await nodeSide.getCatalog(true)
  assert.equal(nodeSide.state().catalogProviders.length, 2, '应观察到 2 个 provider')
  nodeSide.state().settleCatalog()
  const sel = await nodeSide.applySelection(ctx.__agents[0], 'text', 'test', { allowPreferred: false })
  assert.ok(sel !== null, '集合补齐后应能选到 beta/text-b')
  assert.equal(sel.model, 'text-b')
  assert.equal(ctx.__selectionCalls.some((c) => c.model === 'text-b'), true, '应把新模型交给宿主')
  assert.equal(nodeSide.state().cooldown.until > Date.now(), false, '全程不应进冷却')
})

await test('node 半边：订阅 llm/adapters-updated 并触发目录重建', async () => {
  nodeSide.reset()
  const ctx = fakeCtxGrowing()
  nodeSide.setContext(ctx, {})
  applyPlugin(ctx, {})
  const list = ctx.__handlers.get('llm/adapters-updated') ?? []
  assert.equal(list.length > 0, true, '必须订阅 llm/adapters-updated：启动期 provider 是陆续注册的')
  nodeSide.state().settleCatalog()
  list[0]()
  assert.equal(nodeSide.state().catalogProvidersAt > 0, true, '收到事件后应把集合标记为「刚变化」')
  assert.equal(nodeSide.state().catalogSettled(), false, '刚收到集合变化事件 → 未稳定')
})

// ───────────── 源头裁剪：动态白名单（用户 m01049 / m01216） ─────────────
function fakeCtxPool() {
  const providers = [
    { id: 'raw', name: 'Raw' },
    { id: 'chan', name: 'Chan' },
    { id: 'poolA', name: 'PoolA' },
    { id: 'poolB', name: 'PoolB' },
  ]
  let opened = { poolA: ['m1', 'm2'], poolB: ['m3', 'm4'] }
  const rosters = {
    raw: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
    chan: ['m5', 'm9'],
  }
  const model = (id) => ({ id, name: id, inputModalities: ['text'] })
  const llm = {
    listProviders: () => providers,
    listModels: async (pid) => (pid === 'poolA' ? opened.poolA : pid === 'poolB' ? opened.poolB : (rosters[pid] ?? [])).map(model),
    resolveModelInfo: async (pid, mid) => model(mid),
    listConfigurableProviders: () => [
      { provider: 'poolA', settingsNs: 'pool' },
      { provider: 'poolB', settingsNs: 'pool' },
      { provider: 'chan', settingsNs: 'chan-ns' },
    ],
  }
  const services = {
    llm,
    agents: { list: () => [] },
    sessionController: { agents: { selectForNextRequest: () => {} } },
    sessionProjections: { stateOf: () => undefined },
    agentDefaultModel: { currentSelection: () => undefined },
  }
  return {
    get: (name) => services[name],
    on: () => {},
    effect: () => {},
    logger: { info: () => {} },
    __setOpened: (next) => { opened = next },
  }
}

await test('core：prunedRosterKeys 按运行时集合裁剪全量 roster（零硬编码）', () => {
  const rosters = [
    { provider: 'raw', models: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'] },
    { provider: 'chan', models: ['m5', 'm9'] },
    { provider: 'poolA', models: ['m1', 'm2'] },
    { provider: 'poolB', models: ['m3', 'm4'] },
  ]
  const configurable = [
    { provider: 'poolA', settingsNs: 'pool' },
    { provider: 'poolB', settingsNs: 'pool' },
    { provider: 'chan', settingsNs: 'chan-ns' },
  ]
  const r = prunedRosterKeys(rosters, configurable, ['raw/m7'])
  assert.equal(r.reason, 'applied')
  assert.deepEqual([...r.laneIds].sort(), ['poolA', 'poolB'])
  assert.deepEqual([...r.opened].sort(), ['m1', 'm2', 'm3', 'm4'])
  assert.deepEqual(r.sources, ['raw'], '只有全量源被判为 source，渠道卡/池 lane 不误伤')
  assert.deepEqual([...r.pruned].sort(), ['raw/m5', 'raw/m6', 'raw/m8'].sort())
  assert.equal(r.pruned.has('raw/m7'), false, '默认模型必须保留')
})

await test('core：prunedRosterKeys 随 opened 集合变化（动态，非配置快照）', () => {
  const configurable = [
    { provider: 'poolA', settingsNs: 'pool' },
    { provider: 'poolB', settingsNs: 'pool' },
  ]
  const base = (a, b) => [
    { provider: 'raw', models: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'] },
    { provider: 'chan', models: ['m5', 'm9'] },
    { provider: 'poolA', models: a },
    { provider: 'poolB', models: b },
  ]
  const r1 = prunedRosterKeys(base(['m1', 'm2'], ['m3', 'm4']), configurable, ['raw/m7'])
  const r2 = prunedRosterKeys(base(['m1'], ['m3']), configurable, ['raw/m7'])
  assert.equal(r2.reason, 'applied')
  assert.ok(r2.pruned.size > r1.pruned.size, '关闭开放项后应裁掉更多（动态）')
  assert.equal(r2.pruned.has('raw/m2'), true, '取消开放 m2 后应被裁掉')
  assert.equal(r2.pruned.has('raw/m4'), true, '取消开放 m4 后应被裁掉')
  assert.equal(r2.pruned.has('raw/m7'), false, '默认模型始终保留')
})

await test('core：prunedRosterKeys 安全阀（读不到家族/空集合/无源都不裁剪）', () => {
  const noFamily = prunedRosterKeys([{ provider: 'raw', models: ['a', 'b'] }], [{ provider: 'raw', settingsNs: 'x' }], [])
  assert.equal(noFamily.reason, 'no-family')
  assert.equal(noFamily.pruned.size, 0)
  const noRosters = prunedRosterKeys([], [{ provider: 'p1', settingsNs: 'n' }], [])
  assert.equal(noRosters.reason, 'no-rosters')
  assert.equal(noRosters.pruned.size, 0)
  const noOpened = prunedRosterKeys(
    [{ provider: 'p1', models: [] }, { provider: 'p2', models: [] }, { provider: 'raw', models: ['a', 'b'] }],
    [{ provider: 'p1', settingsNs: 'n' }, { provider: 'p2', settingsNs: 'n' }], [],
  )
  assert.equal(noOpened.reason, 'no-opened')
  assert.equal(noOpened.pruned.size, 0)
  const noSources = prunedRosterKeys(
    [{ provider: 'p1', models: ['a'] }, { provider: 'p2', models: ['b'] }, { provider: 'c', models: ['c1', 'c2'] }],
    [{ provider: 'p1', settingsNs: 'n' }, { provider: 'p2', settingsNs: 'n' }], [],
  )
  assert.equal(noSources.reason, 'no-sources')
  assert.equal(noSources.pruned.size, 0)
})

await test('node 半边：buildCatalog 源头裁剪未开放 roster，且随设置动态变化', async () => {
  nodeSide.reset()
  const ctx = fakeCtxPool()
  nodeSide.setContext(ctx, { defaultModel: { provider: 'raw', model: 'm7' } })
  const snap1 = await nodeSide.getCatalog(true)
  const keys1 = snap1.entries.map((e) => `${e.provider}/${e.model}`)
  assert.equal(keys1.includes('raw/m5'), false, '未开放模型不入目录')
  assert.equal(keys1.includes('raw/m6'), false)
  assert.equal(keys1.includes('raw/m8'), false)
  assert.equal(keys1.includes('raw/m7'), true, '默认模型必须保留')
  assert.equal(keys1.includes('raw/m1'), true, '已开放模型保留')
  assert.equal(keys1.includes('chan/m9'), true, '渠道卡不被误伤')
  assert.equal(keys1.includes('poolA/m1'), true, '池 lane 本身保留')
  assert.equal(keys1.length, 11, `第一次应 11 条，实际 ${keys1.length}`)
  const recs = nodeSide.state().logRing.recent(20)
  assert.ok(recs.some((r) => r.reasonCode === 'unopened-roster-pruned'), '应记录源头裁剪日志')
  // 用户取消开放 m2/m4（模拟 XD Pool 设置动态变化），不重启、直接重建目录
  ctx.__setOpened({ poolA: ['m1'], poolB: ['m3'] })
  const snap2 = await nodeSide.getCatalog(true)
  const keys2 = snap2.entries.map((e) => `${e.provider}/${e.model}`)
  assert.equal(keys2.includes('raw/m2'), false, '取消开放后 m2 应被裁掉（动态）')
  assert.equal(keys2.includes('raw/m4'), false, '取消开放后 m4 应被裁掉（动态）')
  assert.equal(keys2.includes('raw/m7'), true, '默认模型仍保留')
  assert.equal(keys2.includes('chan/m9'), true, '渠道卡始终不被误伤')
  assert.ok(keys2.length < keys1.length, '动态收紧后条目应更少')
})

await test('core：多家族共存时只认空 settingsPath 的池 lane 家族（真机事故 m01524 回归）', () => {
  // 真机形状：XD Pool 池 lane 家族 ns='xdpool'、settingsPath=[]；
  // 宿主 pi-ai 大家族 ns='pi-ai'、每个成员 settingsPath=['providers', id]。
  // 旧版把所有多成员家族 union 进 laneIds，把已开放渠道 chan 误判为「全量源」裁掉。
  const rosters = [
    { provider: 'raw', models: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'] },
    { provider: 'chan', models: ['m5', 'm9'] },
    { provider: 'poolA', models: ['m1', 'm2'] },
    { provider: 'poolB', models: ['m3', 'm4'] },
    { provider: 'otherA', models: ['m5'] },
    { provider: 'otherB', models: ['m6'] },
  ]
  const configurable = [
    { provider: 'poolA', settingsNs: 'xdpool', settingsPath: [] },
    { provider: 'poolB', settingsNs: 'xdpool', settingsPath: [] },
    { provider: 'otherA', settingsNs: 'pi-ai', settingsPath: ['providers', 'otherA'] },
    { provider: 'otherB', settingsNs: 'pi-ai', settingsPath: ['providers', 'otherB'] },
  ]
  const r = prunedRosterKeys(rosters, configurable, ['raw/m7'])
  assert.equal(r.reason, 'applied')
  assert.deepEqual([...r.laneIds].sort(), ['poolA', 'poolB'], 'pi-ai 大家族必须整族排除')
  assert.deepEqual(r.sources, ['raw'], '已开放渠道 chan 不得被判为全量源')
  assert.deepEqual([...r.pruned].filter((k) => k.startsWith('chan/')), [], 'chan 一个模型都不能裁')
  assert.deepEqual([...r.pruned].sort(), ['raw/m5', 'raw/m6', 'raw/m8'].sort())
  assert.equal(r.pruned.has('raw/m7'), false, '默认模型必须保留')
  // 单成员家族（settingsPath 空）不能被误认成池 lane
  const single = prunedRosterKeys(rosters, [{ provider: 'poolA', settingsNs: 'solo', settingsPath: [] }], [])
  assert.equal(single.reason, 'no-family')
  assert.equal(single.pruned.size, 0)
})

await test('node 半边：切模型只走 agent.model.select()，绝不注册 agent/request 改写（m01547 回归）', async () => {
  const handlers = new Map()
  const selectCalls = []
  const fallbackCalls = []
  const agent = {
    id: 'session-x',
    status: 'running',
    session: { id: 'session-x', requestHeader: () => undefined },
    model: { select: (sel) => selectCalls.push({ ...sel }) },
  }
  const services = {
    llm: {
      listProviders: () => [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
      listModels: async (pid) => (pid === 'alpha'
        ? [{ id: 'text-a', inputModalities: ['text'] }, { id: 'mm-a', inputModalities: ['text', 'image'] }]
        : [{ id: 'text-b', inputModalities: ['text'] }]),
      resolveModelInfo: async (pid, mid) => ({ id: mid, inputModalities: ['text'] }),
    },
    agents: { list: () => [agent] },
    sessionController: { agents: { selectForNextRequest: (a, sel) => fallbackCalls.push({ ...sel }) } },
    sessionProjections: { stateOf: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'alpha', model: 'text-a' }) },
  }
  const ctx = {
    get: (name) => services[name],
    on: (name, fn) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    effect: () => {},
    logger: { info: () => {} },
  }
  nodeSide.reset()
  applyPlugin(ctx, {})
  assert.equal(handlers.has('agent/request'), false, '致命错来源：不得再注册 agent/request 瀑布改写')
  assert.equal(handlers.has('agent/request-error'), true, '重试瀑布仍要保留')
  await nodeSide.getCatalog(true)
  const selection = await nodeSide.applySelection(agent, 'text', 'test', { allowPreferred: false })
  assert.ok(selection !== null)
  assert.equal(selectCalls.length, 1, '宿主认可的入口 agent.model.select 被优先调用')
  assert.equal(selectCalls[0].provider, selection.provider)
  assert.equal(selectCalls[0].model, selection.model)
  assert.equal(fallbackCalls.length, 0, '新入口可用时不得再退回 selectForNextRequest')
  const logs = nodeSide.state().logRing.recent(30).filter((r) => r.event === 'select')
  assert.ok(logs.some((r) => r.via === 'agent.model.select'), '日志应记录真实通道')
  assert.ok(!logs.some((r) => r.via === 'agent/request-override'), '不得再出现 override 通道')
})

await test('免费判定：认 x0.00 / 免费 / 限时免费 / Free now，判不出进未知', () => {
  assert.equal(priceClassOf('B-Text-1 · x0.00', 0), 'free')
  assert.equal(priceClassOf('限时免费', undefined), 'free')
  assert.equal(priceClassOf('Model · Free now', undefined), 'free')
  assert.equal(priceClassOf('A → 免费', undefined), 'free')
  assert.equal(priceClassOf('A · x0.12→x0.06', undefined), 'paid')
  assert.equal(priceClassOf('A · x1.5', 1.5), 'paid')
  assert.equal(priceClassOf('A-Text-1', undefined), 'unknown')
  assert.deepEqual(GROUP_MODE_VALUES, ['manual', 'auto'])
  assert.equal(normalizeGroupMode('auto'), 'auto')
  assert.equal(normalizeGroupMode('bogus'), 'manual')
  assert.equal(normalizeGroupMode(undefined), 'manual')
})

await test('自动分组：按价格类别生成 免费 / 积分 / 未知 三组，空组不生成', () => {
  const cfg = resolveConfig({
    groupMode: 'auto',
    customGroups: [{ id: 'g1', label: '我的组', kind: null, providers: [], models: [], freeOnly: false, explicit: true }],
  })
  const eFree = { ...TEXT_A, name: 'B · x0.00', priceClass: 'free' }
  const ePaid = { ...TEXT_B, name: 'C · x1.2', priceClass: 'paid' }
  const eUnknown = { ...TEXT_C, name: 'D-Text' }
  const groups = groupCatalog([eFree, ePaid, eUnknown], cfg)
  assert.deepEqual(groups.map((g) => g.id), ['auto-free', 'auto-paid', 'auto-unknown'])
  assert.deepEqual(groups.map((g) => g.label), ['免费 · 1', '积分 · 1', '未知 · 1'])
  assert.deepEqual(groups[0].entries.map((e) => e.key), [eFree.key])
  assert.equal(groups[0].custom, false)
  assert.equal(groups[0].kind, null)
  assert.equal(groupCatalog([eFree], cfg).length, 1, '空价格类别不应生成空段')
  assert.ok(!groups.some((g) => g.custom === true), 'auto 分支应完全忽略 customGroups')
})

await test('自动分组：isUnassigned 恒 false，未入组模型不再被判不可用', () => {
  const rule = { id: 'g1', label: '只收 beta', kind: null, providers: [], models: ['beta/text-c'], freeOnly: false, explicit: true }
  const autoCfg = resolveConfig({ groupMode: 'auto', customGroups: [rule] })
  assert.equal(isUnassigned(TEXT_A, autoCfg), false)
  assert.equal(isUnassigned(TEXT_B, autoCfg), false)
  const manual = resolveConfig({ groupMode: 'manual', customGroups: [rule] })
  assert.equal(isUnassigned(TEXT_A, manual), true, '手工模式未命中规则仍为未入组')
})

await test('暂不可用：探测判不可用的模型不参与首选与自动选择', () => {
  const allKeys = CATALOG.entries.map((e) => e.key)
  assert.equal(selectModel(baseRequest({ probeUnavailable: allKeys })), null)
  assert.equal(selectModel(baseRequest({ preferredKey: TEXT_A.key, probeUnavailable: allKeys })), null)
  const picked = selectModel(baseRequest({ preferredKey: TEXT_A.key, probeUnavailable: [TEXT_A.key] }))
  assert.ok(picked !== null && picked.key !== TEXT_A.key, '首选被判不可用应跳过')
})

await test('暂不可用：全部候选被探测判不可用时 giveup(all-disabled) 而非进冷却', () => {
  const state = newSessionState('s1', 'text', { ...TEXT_A, reasonCode: 'preferred', reason: 'x', orderIndex: 0, idle: true, owners: [] }, Date.now())
  state.retriesUsed = 2
  const allKeys = CATALOG.entries.map((e) => e.key)
  const action = decideOnError(errorRequest({ state, probeUnavailable: allKeys }))
  assert.equal(action.action, 'giveup')
  assert.equal(action.reasonCode, 'all-disabled')
})

await test('不展示：隐藏（hidden）的模型不进候选池、不做首选', () => {
  const hiddenA = { ...TEXT_A, hidden: true }
  const visibleB = { ...TEXT_B, hidden: false }
  // 首选是隐藏模型 ⇒ 跳过，落到首个可见候选
  const picked = selectModel(baseRequest({ catalog: catalogOf([hiddenA, visibleB, TEXT_C]), preferredKey: hiddenA.key }))
  assert.ok(picked !== null && picked.key !== hiddenA.key, '隐藏模型不应被选为首选')
  // 全部候选都隐藏 ⇒ 无可用选择
  const allHidden = catalogOf([hiddenA, { ...TEXT_B, hidden: true }, { ...TEXT_C, hidden: true }])
  assert.equal(selectModel(baseRequest({ catalog: allHidden })), null)
  // 不展示但可见候选存在 ⇒ 选到可见候选
  const ok = selectModel(baseRequest({ catalog: catalogOf([hiddenA, visibleB]) }))
  assert.equal(ok.key, visibleB.key)
})


// ─────────────────────────── 汇总 ───────────────────────────
console.log('')
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项`)
  process.exit(0)
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`)
  for (const [name, err] of failures) console.log(`  - ${name}\n    ${err?.stack ?? err}`)
  process.exit(1)
}
