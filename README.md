# @zjjlivingfree/dsh-model-picker

替换 dsh 默认模型选择逻辑的 bundle 插件。四件事：**模型列表分类 + 来源标注**、**用户默认模型 + 可配置重试**、**会话占用规避的同类型切换**、**全部不可用后的 30 分钟冷却恢复**。

- 插件名：`@zjjlivingfree/dsh-model-picker`（原名 `@zjj/dsh-model-auto-select`）
- 版本：0.1.0
- 运行侧：node 半边（`lib/index.js`）+ 客户端半边（`lib/client.js`）
- 验证：`npm run test:all` → 71 项回归 + 53 项客户端 DOM + 31 项 HTTP 冒烟 + 10 项 plugin record 冒烟，四套全绿

---

## 1. 实现思路

### 1.1 用到的 dsh 扩展点（全部已核实，非臆造）

| 需求点 | 扩展点 | 位置 / 形态 |
| --- | --- | --- |
| 可用模型列表 | `ctx.get('llm').listProviders()` → `listModels(provider)` | `@deepseek-ai/dsh-llm/lib/index.js:1908` / `:2086` |
| 多模态判定字段 | `listModels` 条目上的 `inputModalities`，缺省再 `resolveModelInfo(provider, model)` | `:2111`（`normalizeModelInfo` `:2114-2136`） |
| 模型来源标注 | `provider.id` / `provider.name`（或 `displayName`）/ `provider.settingsNs` | `listProviders()` 返回的 provider 对象 |
| 用户默认模型 | `ctx.get('agentDefaultModel').currentSelection()`；插件自己的 `defaultModel` 覆盖它 | `@deepseek-ai/dsh-agent-default-model/lib/index.js` |
| 会话占用（当前指向哪个模型） | `ctx.get('sessionProjections').stateOf(session, 'modelSelection')` 的 `pending ?? lastUsed`；兜底 `session.requestHeader().config` | projection key `modelSelection`，stateVersion 2 |
| 会话占用（活着/在跑） | `ctx.get('agents').list()` + `agent.status`（`'idle' \| 'running'`）+ 事件 `agent/created` / `agent/disposed` / `agent/status` | `@deepseek-ai/dsh-agent/lib/index.js:614`；事件目录 `:3956` / `:3964` / `:4699` |
| 运行期切换模型 | `ctx.get('sessionController').agents.selectForNextRequest(agent, {provider, model, reasoningEffort?})` | `@deepseek-ai/dsh-api-session-controller/lib/index.js:312-315`，内部 `append('model/selection')` |
| 兜底改写本次请求 | `ctx.on('agent/request', waterfall)` 返回改过的 `LlmCallConfig` | `dsh-agent-loop/lib/index.js:1188-1227` |
| 失败重试 | `ctx.on('agent/request-error', waterfall)` 返回 `{ kind: 'retry' }` | `dsh-agent-loop/lib/index.js:1150-1158`；`RequestErrorAction` 只有 `{kind:'retry'} \| undefined` |
| 日志落盘 | `appendPluginRecord(session, 'plugin:model-auto-select/<event>', data)` | `@deepseek-ai/dsh-session`；type 必须匹配 `^plugin:[a-z0-9]...` |
| 客户端接口 | `ctx.webServer.register({ kind:'prefix', path:'/dsh-model-auto-select', handler })`，**返回的 disposer 必须接住并在 `ctx.effect` 里注销** | 裸 node http handler；宿主路由表是组合级契约，重复注册直接抛 `webserver: duplicate prefix route`（`dsh-host-webserver/lib/index.js:326-334`） |

**路由注册：必须注销，且要能自愈（线上踩过的坑）**

`webServer.register()` 返回 disposer，宿主的路由表是**组合级契约**：同一 `(kind, path)` 第二次注册直接抛 `webserver: duplicate prefix route "<path>"`。丢掉 disposer 的后果是一条完整的故障链：

1. 插件重载时旧路由仍在表里 → 新实例 `apply()` 抛错 → 插件卡在 stopped（`unlag-reload.log` 里的 `a plugin was already not running and still is not`）；
2. fiber 不在 `state 2` → `dsh-config-editor` 拒绝一切写入（`Configuration plugin is no longer active`）；
3. 而写配置本身又会触发插件重启 → 永久卡死。**外部表现是「设置页点什么都没反应」，很容易误判成前端 bug。**
4. 更隐蔽的一层：僵尸路由**继续应答**，但它的 handler 闭包指向上一实例的内存，所以 `/config` 返回 200 却是旧配置、`/catalog.groups` 还是旧分组——「接口 200 但数据永远是旧的」先怀疑这条。

现在的写法（`src/index.ts` 路由段）：

- `globalThis[ROUTE_REGISTRY_KEY]` 登记本实例的 disposer，新实例启动先把上一实例的路由拆掉（用 `globalThis` 而不是模块变量：unlag 重载会换掉模块作用域）；
- 再扫一遍宿主的 `webServer.prefixes` / `webServer.exact`（实例上的普通 `Map`，非 `#private`），发现本插件前缀被占就删掉——历史版本丢 disposer 留下的僵尸不在登记位上，只能从表里清；
- 每一步都写 `config` 日志（`已清理路由表里的僵尸路由` / `路由已注册`），不静默；
- `register()` 仍然包 try/catch：真被别人占了就记清「需重启 dsh 进程清理路由表」再抛出，不假装成功。

回归覆盖两条路径（`scripts/test-auto-select.mjs`）：`apply → 跑 disposer → 再 apply` 不撞错；**以及「路由表里先手放一条无 disposer 的僵尸」→ 新 `apply` 能接管并留日志**。假 webServer 照抄宿主的 `exact`/`prefixes` 两张 Map 与同款报错文案。

**与宿主 `@deepseek-ai/dsh-llm-retry` 的边界（明确分工，不抢）**

- `llm-retry` 管**同一 provider 内**的指数退避（`retryPolicy` 属于每个 provider 配置，`mode: 'normal' | 'always'`）。
- 本插件管**跨模型切换**：`maxRetries` 额度用尽后换同类型下一个模型。
- 顺序上，本插件在 `agent/request-error` 瀑布里**先判定**：要重试就自己返回 `{kind:'retry'}`（不调 `next()`，按 cordis 语义否决后续链）；不该管就 `next()` 交给 `llm-retry`。`switchOnCodes` 非空且错误码不在白名单时，直接 `giveup(non-switchable)` 交回 `llm-retry`。

### 1.2 数据流

```
              ┌──────────────── node 半边（lib/index.js） ────────────────┐
llm.listProviders/listModels/resolveModelInfo ──► buildCatalog()
        │                                             │  TTL 缓存 + 单飞 + 冷却期抑制刷新
        │                                             ▼
        │                                       CatalogSnapshot
        │                        （entries[key/provider/providerName/settingsNs/model/
        │                          kind/modalities/modalitySource/sortKey] + failures）
        │                                             │
agents.list() + agent/status ──► refreshOccupancy() ──► OccupancyMap（owners/inUse/running）
sessionProjections.stateOf ───┘                             │
                                                            ▼
agent/created ──► applySelection() ──► selectModel() ──► Selection ──► commitSelection()
                                                            │            ├─ sessionController.agents.selectForNextRequest  ← 官方入口
                                                            │            └─ pendingOverride（兜底，由 agent/request 改写）
agent/request-error ──► decideOnError() ──► retry / switch / cooldown / giveup
                                                            │
                                   LogRing（内存 500 条）+ appendPluginRecord（会话内永久）
                                                            │
webServer /dsh-model-auto-select/{health,catalog,logs,occupancy,cooldown/clear,beacon}
                                                            │
              └─────────────────────────────────────────────┼──────────┘
                                                            ▼
                       客户端半边（lib/client.js）：拉 /catalog，DOM 追加徽标
```

### 1.3 状态机

**选择态（进入会话 / 冷却结束 / 切换后重选）**

```
        ┌────────────── preferred（首选可用，占用不影响首选）
        │
start ──┼────────────── preferred-busy（首选被占用，但用户显式选择优先）
        │
        ├────────────── fallback-idle（同类型空闲候选中排序最靠前）
        │
        ├────────────── fallback-order（同类型全被占用，按既定顺序取第一个，记 owners）
        │
        └──── 无候选（no-candidate）
                 ├─ catalogReady 为 false ──────────► catalog-not-ready（不进冷却，等目录就绪补选）
                 ├─ provider 集合未稳定（<3s）──────► catalog-settling（不进冷却，排一次目录重建）
                 └─ 目录已就绪且稳定 ───────────────► enterCooldown(30min)
```

**失败态（`agent/request-error`）**

```
failure
  ├─ signal.aborted 或 code==='ABORTED'            → giveup(aborted)     不消耗额度
  ├─ enabled=false                                 → giveup(disabled)
  ├─ 全局冷却中                                     → giveup(cooldown-active)
  ├─ switchOnCodes 非空且不含该 code                → giveup(non-switchable)  交回 llm-retry
  ├─ retriesUsed < maxRetries                      → retry（retriesUsed+1，等 retryDelayMs）
  ├─ 同类型还有未 excluded 且不在模型级冷却的候选     → switch（switch-idle / switch-order）
  ├─ crossClassFallback 且另一类型有候选            → switch(switch-cross-class)
  └─ 其余                                          → cooldown（cooldownMs，默认 30 分钟）
```

**冷却态**

```
enterCooldown(reason) → cooldown.until = now + cooldownMs
   期间：decideOnError 一律 giveup(cooldown-active)；getCatalog 非强制刷新被抑制（cooldownRefreshBlocked）
   scheduleCooldownEnd() 定时器（unref，不阻塞进程退出）
        └─► wakeFromCooldown()：清全局冷却 + 清所有模型级冷却 + 清各会话 excluded
                               → getCatalog(true) 重新拉目录
                               → 给当前无模型的 live 会话重新 applySelection(trigger='cooldown-end')
```

### 1.4 关键判定规则（把"尽可能避免""暂时无法使用"落成条件）

| 原表述 | 落地的可判定条件 | 日志证据 |
| --- | --- | --- |
| 「优先选未被会话使用的模型」 | `preferIdle=true` 时，在 `byKind(kind) → 过滤 excluded/模型级冷却 → 排序` 后的候选里 `find(occupancy[key].inUse !== true)`；找到即 `reasonCode='fallback-idle'` | `select` 事件带 `reasonCode` / `idleCandidates` / `orderIndex` |
| 「同类型模型均被使用」 | 上述 `find` 返回 `undefined`，取 `candidates[0]`，`reasonCode='fallback-order'`，日志写 `owners` | `select` 事件 `owners: ["session-a","session-b"]` |
| 「模型暂时无法使用」 | `excluded.includes(key)`（本会话已判失败）**或** `modelCooldown[key] > now`（模型级冷却未到） | `switch` 事件 `from` + `excluded` 累积；`catalogView.sessions[].excluded` |
| 「所有模型都暂时无法使用」 | `selectModel` 返回 `null`，**且** `catalogReady === true`、**且** `catalogSettled() === true`（距上次 provider 集合变化 ≥3s）→ `enterCooldown`；前两条件任一不满足只记 `select(catalog-not-ready)` / `select(catalog-settling)`，不进冷却 | `cooldown` 事件 `cooldownUntil` / `cooldownRemainingMs` / `reason`；未就绪时 `select` 事件 `reasonCode` |
| 「冷却期间不进行高频重试」 | ① `decideOnError` 冷却中一律 `giveup(cooldown-active)`；② `getCatalog(force=false)` 在冷却期直接返回上一份快照；③ 该抑制日志**每 60s 最多一条**，被折叠的次数累加进 `suppressed`（真机实测不节流时一段冷却刷了 210 条）；④ 无任何定时轮询去探模型 | `giveup` 事件 `reasonCode='cooldown-active'` + `cooldownRemainingMs` + `suppressed` |
| 「冷却结束后重新尝试获取或选择」 | `wakeFromCooldown()`：`getCatalog(true)` + 对 `state.current === null` 的 live 会话重新 `applySelection` | `cooldown-end` 事件带 `catalogSize` |
| 「每次失败消耗一次重试机会」 | `state.retriesUsed` 只在 `retry` 分支 +1；`switch` 分支归零；`giveup` 不消耗 | `retry` 事件 `retriesUsed` / `maxRetries` |
| 「切换顺序明确、可复现」 | `sortKey = [pRank, mRank, providerIndex, modelIndex]`，`pRank` 来自 `providerOrder`（未列出 = `providerOrder.length + providerIndex`），`mRank` 来自 `modelOrder`（`'provider/model'`，未列出 = `modelOrder.length + modelIndex`），末位以 `key` 字典序兜底 | `select`/`switch` 事件带 `orderIndex`；`/catalog` 每行带 `sortKey` |

**为什么首选模型被占用也优先**：`preferred` / `preferred-busy` 在占用筛选**之前**判定 —— 用户显式选择的优先级高于"空闲规避"，否则用户选的模型永远抢不过一个空会话。占用规避只作用于**自动切换**路径。

---

## 2. 插件目录结构与核心代码

```
D:\my-projects\plugins\dsh-model-picker\
├── package.json              # dsh.bundle.patch / dsh.client.{inject,platform} / exports
├── cordis.patch.yml          # - insert: id: model-auto-select, name: '@zjjlivingfree/dsh-model-picker'
├── README.md
├── src/
│   ├── core.ts               # 纯判定层：分类、限免、排序、占用、选择、失败状态机、分组、日志环
│   ├── index.ts              # node 半边：目录构建、占用刷新、接管、冷却、配置读写、HTTP 路由
│   └── client/
│       └── index.ts          # 客户端半边（BUILD mas-v11）：宿主菜单补标 + 同行的设置图标（→ dsh 设置页面）
├── scripts/
│   ├── build.mjs             # esbuild 双产物（node ESM + browser CJS banner/footer）
│   ├── test-auto-select.mjs  # 回归 71 项（纯函数 + node 半边夹具 + 分组/徽标/显式成员组 + 自动切换作用域 + dsh 设置页 Config + 路由注销/自愈）
│   ├── test-client-dom.mjs   # 客户端 DOM 行为 53 项（playwright-core + 本机 Edge）
│   ├── smoke-http.mjs        # HTTP 八端点冒烟 31 项（真实 node:http 承载 handler）
│   ├── smoke-plugin-record.mjs # plugin record 落盘冒烟 10 项（用宿主真实 Session）
│   ├── host-resolve.mjs      # ESM loader 垫片：把 @deepseek-ai/* 指到宿主 checkout
│   └── host-resolve-hooks.mjs
└── lib/                      # 构建产物：index.js / core.js / client.js
```

### 2.1 `package.json` 契约要点

```json
{
  "name": "@zjjlivingfree/dsh-model-picker",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./core": "./lib/core.js",
    "./package.json": "./package.json",
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["@deepseek-ai/dsh-client-ui-slots"], "platform": "web" },
    "manifestVersion": 1
  },
  "engines": { "node": ">=20", "dsh": ">=0.2.0-rc.1 <0.3.0-0" }
}
```

### 2.2 `cordis.patch.yml`

```yaml
- insert:
    - id: model-auto-select
      name: '@zjjlivingfree/dsh-model-picker'
```

（scoped 包名必须加引号，否则 YAML 把 `@` 当非法标量。）

### 2.3 分类与来源（`src/core.ts`）

```ts
const MULTIMODAL_MODALITIES = new Set(['image', 'audio', 'video'])

/** 分类判定：只有 image/audio/video 才算多模态；缺省或仅 text 都归 text。 */
export function classify(modalities: string[]): ModelKind {
  for (const id of modalities) if (MULTIMODAL_MODALITIES.has(id)) return 'multimodal'
  return 'text'
}

/** 排序键：provider 优先表 → 模型优先表 → 宿主 provider 序 → 宿主模型序。 */
export function sortKeyOf(provider, model, providerIndex, modelIndex, cfg): [number, number, number, number] {
  const pAt = cfg.providerOrder.indexOf(provider)
  const mAt = cfg.modelOrder.indexOf(`${provider}/${model}`)
  const pRank = pAt >= 0 ? pAt : cfg.providerOrder.length + providerIndex
  const mRank = mAt >= 0 ? mAt : cfg.modelOrder.length + modelIndex
  return [pRank, mRank, providerIndex, modelIndex]
}
```

模态字段三级来源（node 半边 `modalitiesOf`），`modalitySource` 逐条标注：

1. `listModels` 返回的 `inputModalities`（有值即用，`source='listModels'`）
2. 缺省时 `resolveModelInfo(provider, model).inputModalities`（`source='resolveModelInfo'`，4s 超时，单模型失败不影响整表）
3. 都拿不到 → `modalities: []`，`classify` 判为 `text`（`source='fallback'` 归一为 `'listModels'` 语义：宿主明确表示"无该能力"）

来源标注用 provider 三元组：`provider`（id）、`providerName`（`name ?? displayName ?? id`）、`providerSettingsNs`（`settingsNs`）。

### 2.4 选择（`src/core.ts:selectModel`）

```ts
export function selectModel(request: SelectRequest): Selection | null {
  const { catalog, kind, preferredKey, occupancy, excluded, modelCooldown, now, cfg } = request
  const pool = ordered(byKind(catalog.entries, kind))
  const byKeyMap = indexByKey(pool)

  // 1) 首选可用 ⇒ preferred / preferred-busy（占用不影响首选）
  if (preferredKey !== null) {
    const preferred = byKeyMap.get(preferredKey)
    if (preferred !== undefined && !unavailable(preferred, excluded, modelCooldown, now)) {
      const index = pool.indexOf(preferred)
      const occ = occupancyOf(occupancy, preferred.key)
      return selectionOf(preferred, occ.inUse ? 'preferred-busy' : 'preferred', /* reason */ ..., index, occupancy)
    }
  }

  // 2) 同 kind 筛掉 excluded / 模型级冷却
  const candidates = pool.filter((entry) => !unavailable(entry, excluded, modelCooldown, now))
  if (candidates.length === 0) return null

  // 3) preferIdle 且有空闲 ⇒ fallback-idle
  if (cfg.preferIdle) {
    const idle = candidates.find((entry) => !occupancyOf(occupancy, entry.key).inUse)
    if (idle !== undefined) return selectionOf(idle, 'fallback-idle', ..., pool.indexOf(idle), occupancy)
  }

  // 4) 全部在用 ⇒ fallback-order（日志写 owners）
  const first = candidates[0]
  return selectionOf(first, 'fallback-order', ..., pool.indexOf(first), occupancy)
}
```

### 2.5 失败状态机（`src/core.ts:decideOnError`）

```ts
export function decideOnError(request: ErrorRequest): ErrorAction {
  if (aborted || failureCode === 'ABORTED') return { action: 'giveup', reasonCode: 'aborted', ... }
  if (!cfg.enabled)                        return { action: 'giveup', reasonCode: 'disabled', ... }
  if (cooldownActive(cooldown, now))       return { action: 'giveup', reasonCode: 'cooldown-active', ... }
  if (cfg.switchOnCodes.length > 0 && !cfg.switchOnCodes.includes(failureCode))
    return { action: 'giveup', reasonCode: 'non-switchable', ... }

  if (state.retriesUsed < cfg.maxRetries) {
    const retriesUsed = state.retriesUsed + 1
    return { action: 'retry', delayMs: cfg.retryDelayMs, reasonCode: 'retry',
             reason: `同一模型重试 ${retriesUsed}/${cfg.maxRetries}（失败码 ${failureCode}）`,
             attempts: state.attempts + 1, retriesUsed }
  }

  const excluded = state.current === null ? state.excluded : [...state.excluded, state.current.key]
  const base = { catalog, kind: state.kind, preferredKey: null, occupancy, excluded, modelCooldown, now, cfg }
  const next = selectModel(base)
  if (next !== null) return { action: 'switch', delayMs: cfg.retryDelayMs, next,
      reasonCode: next.reasonCode === 'fallback-idle' || next.reasonCode === 'preferred' ? 'switch-idle' : 'switch-order',
      reason: `重试额度已用尽（maxRetries=${cfg.maxRetries}），切换到同类型模型 ${next.provider}/${next.model}：${next.reason}` }
  if (cfg.crossClassFallback) { const cross = selectCrossClass(base); if (cross !== null) return { action: 'switch', ..., next: cross, reasonCode: 'switch-cross-class' } }
  return { action: 'cooldown', reasonCode: 'cooldown',
           reason: `同类型（${state.kind}）候选全部不可用（已排除 ${excluded.length} 个），进入冷却 ${cfg.cooldownMs}ms`,
           cooldownUntil: now + cfg.cooldownMs }
}
```

### 2.6 接管与切换落点（`src/index.ts:commitSelection`）

```ts
function commitSelection(agent, selection, source): boolean {
  const payload = { provider: selection.provider, model: selection.model, /* reasoningEffort? */ }
  let viaHost = false
  try {
    const agentsApi = ctxRef?.get?.('sessionController')?.agents
    if (agentsApi !== undefined && typeof agentsApi.selectForNextRequest === 'function') {
      agentsApi.selectForNextRequest(agent, payload)   // 官方入口：append('model/selection')
      viaHost = true
    }
  } catch (err) { /* 记 config 日志，走兜底 */ }
  if (!viaHost) pendingOverride.set(sessionId, payload)  // 由 agent/request 瀑布改写本次请求
  return viaHost
}
```

`agent/request-error` 的挂载（顺序关键：**先换模型，再返回 retry**）：

```ts
ctx.on('agent/request-error', (payload, next) => {
  if (!cfg.enabled) return next()
  return (async () => {
    let decision
    try { decision = await handleRequestError(payload) }
    catch (err) { /* 记 giveup(internal-error) */ return next() }
    if (decision?.kind === 'retry') return decision   // 不调 next()，否决后续链
    return next()                                      // 交回宿主 / llm-retry
  })()
})
```

`handleRequestError` 在 `switch` 分支里**先** `commitSelection(agent, decision.next, 'switch')`（内部 `selectForNextRequest` 写 `model/selection`）**再**返回 `{kind:'retry'}` —— 否则下一轮 `prepareRequest` 仍读旧 model。

### 2.7 冷却（`src/index.ts`）

```ts
function enterCooldown(reason, session) {
  if (cooldownActive(cooldown, Date.now())) return
  cooldown = { until: now + cfg.cooldownMs, enteredAt: now, reason }
  recordToSession(session, log({ event: 'cooldown', reason, cooldownUntil: cooldown.until, cooldownRemainingMs: cfg.cooldownMs }))
  scheduleCooldownEnd()
}

async function wakeFromCooldown() {
  if (cooldownActive(cooldown, Date.now())) { scheduleCooldownEnd(); return }
  if (cooldown.until === 0) return
  cooldown = { until: 0, enteredAt: 0, reason: '' }
  modelCooldown.clear()
  for (const state of sessions.values()) state.excluded = []
  const snapshot = await getCatalog(true)          // 重新获取
  log({ event: 'cooldown-end', reason: `冷却结束（持续 ${cfg.cooldownMs}ms），已重新获取目录：${snapshot.entries.length} 个模型` })
  for (const agent of liveAgents()) {              // 继续执行选择逻辑
    const state = sessions.get(sessionId(agent))
    if (state === undefined || state.current !== null) continue
    void applySelection(agent, state.kind, 'cooldown-end', { allowPreferred: true })
  }
}
```

`getCatalog` 的冷却抑制（"不高频重试"的机械落地）：

```ts
async function getCatalog(force = false) {
  const now = Date.now()
  // 只有「已就绪 且 provider 集合已稳定」才用 60s TTL；否则退回 5s 短窗口（见 2.7.1）
  const ttl = catalogReady && catalogSettled(now) ? cfg.catalogTtlMs : READY_RETRY_MS
  if (!force && catalogAt > 0 && now - catalogAt < ttl) return catalog
  if (!force && catalogInflight !== null) return catalogInflight
  if (!force && cooldownActive(cooldown, now) && cfg.cooldownRefreshBlocked && catalogReady && catalogSettled(now)) {
    log({ event: 'giveup', reasonCode: 'cooldown-active', reason: '冷却中抑制目录刷新，返回上一份快照' })
    return catalog
  }
  ...
}
```

### 2.7.1 「目录就绪」≠「目录完整」（真机事故修复）

真机日志（2026-11-06）留下一条完整的锁死证据链：

```
13:16:12  catalog 目录构建完成：text=8  multimodal=19 providers=8    failures=0
13:16:18  select  no-candidate 没有可用的 text 模型（catalog=27）
13:16:18  cooldown 会话 session-… 无可用 text 模型
13:17→13:46 giveup cooldown-active 冷却中抑制目录刷新（每 60s 一条）
13:46:31  catalog 目录构建完成：text=31 multimodal=141 providers=27   ← 冷却自然结束后才拿到真实目录
```

根因不是「`llm` 还没注册」（那样 `ctx.get('llm')` 直接 undefined），而是 **`llm` 已经可用、但 provider 还在陆续注册**：启动早期只看到 8 个 provider / 27 条，真实是 27 个 / 172 条。此时

1. `listProviders()` 能调用 ⇒ 误判 `catalogReady = true`；
2. 用户分组里的模型（`buddy/hy3` 等）还没出现在目录里 ⇒ `isUnassigned` 把全部 text 判为不可用 ⇒ 无候选；
3. 无候选 ⇒ `enterCooldown(30min)`；
4. 冷却抑制目录刷新 ⇒ 后续 provider 注册进来也刷不到 ⇒ **锁死 30 分钟**。

三层修复，缺一不可：

| 层 | 机制 | 作用 |
| --- | --- | --- |
| 订阅 | `ctx.on('llm/adapters-updated', …)` | 宿主每次注册/注销/替换 provider 都广播此事件（`dsh-llm` 的 `emitAdaptersUpdated`），是"目录已过期"的权威信号，不用靠轮询猜 |
| 判据 | `catalogSettled(now)` = 距上次 provider 集合变化 ≥ `CATALOG_SETTLE_MS`(3s) | 集合未稳定时「没有候选」不可信 ⇒ 记 `catalog-settling`，**不进冷却**，并排一次目录重建 |
| 缓存 | 未稳定时 TTL 用 `READY_RETRY_MS`(5s) 而非 `catalogTtlMs`(60s) | 不完整目录既不会被 TTL 供出去，也不会被冷却抑制拦住 |

`scheduleCatalogRefresh()` 做 800ms 起、3.2s 封顶的退避合并，最多连追 20 轮，避免 provider 反复注册时把宿主拖进重建风暴。
`/health` 新增 `catalogReady` / `catalogSettled` / `catalogProviders` / `catalogProvidersAgeMs` 四个字段，可直接判断「目录是不是还在长」。

### 2.8 客户端标注与自建模型下拉（`src/client/index.ts`，`BUILD = 'mas-v11'`）

不抢宿主槽位（single 槽对动态包强制 `priority=-1`，重复注册会抛 `single slot "..." already has a registration at priority -1`），全部用 DOM 兄弟节点追加 + MutationObserver 去重。

**标注原则：宿主或同级插件已经表达过的信息一律不重复，且默认态不画。** 早期版本每行无条件挂「类型 + 来源 + 占用」三枚 pill，导致整屏「文本·占用中」噪音与逐行重复；占用那一枚后来整体撤除（口径不准，见下表）。现在宿主菜单里**只补两件宿主表达不了的事**：

| 信息 | 在宿主菜单里画不画 | 判定 |
| --- | --- | --- |
| **限免** | **宿主没标时才画**（`免` pill） | 两个条件同时成立：①该模型 `free === true`（模型名后缀 `· x0.00`）；②宿主自己没标免费。宿主第三方 provider 会自带「免费 / 夜间免费 / 限时免费 / 夜间折 / 订阅优先」等标签，此时再补一枚 `免` 就是三重重复，所以 `hostSaysFree()` 先在整行里扫一遍（跳过自有节点，纯文本 ≤12 字且命中 `/免费\|限免\|免单\|夜间折\|折扣\|订阅优先/`）才决定画不画 |
| ~~占用~~ | **已整体撤除，不再画 `用`/`占`** | 曾按 `running → 用`、`inUse && !running → 占` 标注，还加过「多会话计数 `占×2`」与「打开下拉即时拉 `/occupancy`」。用户实测判定**口径不准**：`inUse` 只表示「某个还活着的会话把选择器停在这个模型上」，不代表它正在消耗配额；会话停止 ≠ 关闭，停着的会话会一直挂着「占」。**数据链路保留** —— 服务端 `refreshOccupancy()` 照算、`/catalog` 照带、`preferIdle` 照用（自动切换时躲开占用模型仍然有效），只是客户端不再画。撤除理由写在 `src/client/index.ts` 注释里，回归用例「占用徽标已撤除」防止它悄悄长回来。 |
| **类型（文/图）** | **不画** | 宿主自己有多模态徽标；完整分组视图在 dsh 设置页面的「模型自动选择」里表达（见 2.9），宿主菜单只承担「一眼看出能不能用」 |
| **来源（provider 名）** | **不画** | 宿主菜单的分组标题就是 provider 名，重复画一遍没有信息量 |
| **自定义分组名** | **画**（`data-mas-badge` 里就是组名） | 只在**真正的下拉行**（`closest('button[role="menuitemradio"]')` 非空）画，且只在**已保存**配置里建过组时画；组名取 `savedGroupLabel()` |
| **未入组** | **画 + 整行降透明度** | 建过组但该模型不在任何组里 → 挂 `未入组` pill（warning 色）+ 行打 `data-mas-unassigned-row="1"` + `opacity 0.55` |
| **冷却倒计时** | 只挂在**真正的模型选择按钮**旁 | **只认** `aria-label` 匹配 `/选择模型\|Select model/i`，且 `cooldown.active === true`。其它 `button[aria-haspopup="menu"]`（顶栏「标准模式」「通知」等）一律不碰 |

**标识一律用单字缩写**（`免` / `冷 mm:ss` / `图` / `文`；`用` / `占` 已随占用徽标撤除），把工具栏宽度压到最小；长文案只留在 `title` 悬停提示里（「计价系数 x0.00（0 = 限时免费）」）。`freeBadgeLabel` 可配置，用户填长词仍然生效。

**为什么冷却倒计时只用 `aria-label` 一个判据**：早期版本还有第二分支「`aria-controls` 以 `-menu` 结尾且含 `模型\|model`」，但宿主工具栏里一排普通下拉（标准模式 / 通知 / 各类选择器）同样带 `aria-controls="xxx-menu"`，`decorate` 又对每个命中按钮各自 append，结果冷却期在工具栏刷出十多个「冷却 mm:ss」。现在只剩 `aria-label` 一个强判据，且倒计时节点用独立的 `data-mas-cooldown` 属性定位（不用 `data-mas-own`，否则会把旁边的设置图标按钮当成已存在的倒计时）。

**为什么不重排宿主菜单**：宿主的键盘导航用 `itemRefs.current[index]` 按渲染索引定位（`dsh-client-ui-model-selection/lib/client.js:1252`、`:1407`），`index = modelIndex++` 在 `:1700` 按渲染顺序分配；搜索态下方向键还按 `visibleModels` 数组下标走。重排行会让方向键跳到视觉上不相邻的行，所以宿主菜单**行顺序完全不动**，跨来源分组改由 dsh 设置页面承担（`scripts/test-client-dom.mjs` 的「宿主菜单行顺序完全不变」用例锁死这条）。

**去重实现**：`data-mas-own` 标记自有节点，`data-mas-badge` 存签名（`限免|分组名`，空位留空串；占用撤除后签名字段同步变少），签名不变直接 return。因此 15s 轮询与 MutationObserver 反复触发不会叠加节点。

**分组标注为什么只能在宿主下拉里「追加」**：宿主下拉的分组与条目由服务端 `buildModelCatalog()` 直出 —— `dsh-api-session-controller/lib/index.js:563-611` 读 `llm.listProviders()` → `llm.listModels()` → 组装 `{group:{id:provider.id,name:provider.name}}`，**没有任何 filter/hook 参数**；`llm` 是宿主 fiber 里 `provide` 的服务，跨 fiber `ctx.set('llm', …)` 必抛 `cannot set property "llm" in multiple fibers`（`cordis/lib/index.js:774-785`），客户端动态插件又拿不到 `ctx.remote`（未在 `inject` 里声明即抛 `service "…" is not declared by your plugin`）。所以分组名与条目集合插件改不了，能做的只有「在既有行上追加组名 pill + 标灰未入组行」。真机探针 `scripts/probe-model-menu.mjs` 实测：54 行里 21 行挂上「免费模型 / 积分模型」，33 行挂「未入组」并降透明度，**行顺序与 `rowCount` 不变**。

**分组标注只读已保存配置**：设置页里的改动先进草稿、点「保存」才写回。若下拉标注读草稿，用户会看到「没保存也生效」，与「手动保存才生效」自相矛盾。因此 `savedGroupLabel()` 走 `savedRules()`（读 `config.config.customGroups`），**不用 `draftOf()`**；`loadConfig()` 拿到配置后必须补一次 `scheduleDecorate()`，否则首次装饰常跑在配置到达之前，pill 会一直缺失。

**数据**：`fetch(routeUrl('dsh-model-auto-select/catalog'))`，`routeUrl` 基于 `document.baseURI` 目录化，**不硬编码 host:port**；15s 轮询 + `window focus` 刷新。

### 2.8.1 自建模型下拉：抢 `conversation.input.model` single 槽（`BUILD = 'mas-v11'`）

宿主 composer 里的模型下拉由 `buildModelCatalog()` 按 **provider** 直出、无过滤钩子（详见上表与 2.8 的两段说明），
所以「按用户分组展示、未入组不出现」只能由本插件自己渲染。做法是**同槽 shadow**：

| 环节 | 实现 | 关键点 |
| --- | --- | --- |
| 注册 | `ctx.slots.inject('conversation.input.model', () => ctx.slots.register({ name: MODEL_SLOT, priority: -1, inject: (sessionId) => ({...}) }, ModelAutoSelectTrigger))` | **必须显式 `priority: -1`**：动态门面 `guardedSlots` 会把未指定 priority 的注册强制改成 `--nextPriority`（首个 0），与宿主撞 0 直接抛 `already has a registration at priority 0`，连带把宿主 entry 撤掉（composer 模型控件整体消失） |
| 不声明 children | 注册对象里**没有** `children` | 宿主已声明 `conversation.input.model.label`，再声明会抛 `slot "…" is already declared` |
| 数据 | `sessionDirectory(sessionId)` 自带轻量 store（`subscribe`/`getSnapshot`），快照的 `current` 来自 `/catalog` 的 `sessions[]` | **不要用宿主 `modelDirectories.directoryFor()`**：它内部读 `remote.session`，动态门面按 `inject` 声明做门禁，会抛 `cannot get property "remote.session" without inject` |
| 分组 | `menuGroups()` = 已保存 `customGroups` 的投影 | 只读**已保存**配置（`savedRules()`），不读设置页草稿；`hiddenModels` 任何模式都不出现 |
| 点选 | `selectViaRoute(sessionId, {provider, model})` → `POST /select` | 服务端用官方 `selectForNextRequest` 落选择，并对 `disabled/hidden` 的模型回 **409**（未入组的第二道保险） |
| 开合 | 模块级 `slotOpen`/`slotQuery` + `applySlotOpen()`/`applySlotFilter()` 直接操作 DOM | 宿主渲染器会重建 slot 组件、丢掉 hooks 状态（实测 `setState` 后不重渲染），所以开合与搜索不靠 React 状态 |
| 当前模型文案 | `directoryWatchers` 与 `listeners` 一起被 `notify()` 唤醒 | 只把订阅者塞进 `watchers` 而不调用，会让触发按钮永远停在挂载那一刻的快照（显示占位「选择模型」） |

**服务端补的两处**（`src/index.ts`）：

1. `trackedSessions(now)`：遍历 `liveAgents()`，对「活跃但插件没记过 state」的会话用 `agentSelectionKey()` 建 state，
   并用 `hostSelection(key)` 把宿主当前选择（`sessionProjections.stateOf(session, 'modelSelection')` 的 `pending ?? lastUsed`）回填成完整 `Selection`（`reasonCode: 'host-current'`）。
   `/catalog.sessions[]` 因此对**插件加载前就存在**的会话也有 `current`。
2. `applySelection()` 的 `changed` 判定：`const backfilled = state.current?.reasonCode === 'host-current'; const changed = backfilled || state.current?.key !== selection.key`
   —— 宿主回填后再做一次真正的选择，否则 `changed` 恒 false，决策不会留下 `select` 日志。


### 2.8.2 自建下拉的交互与样式重做（来源标识 + 键盘导航 + 边界自适应）

上一版自建下拉只有「分组 + 名字 + 三枚 pill」，行内名字直接沿用模型名后缀（`Qwen3.8-Flash · x0.00`），
既看不出模型来自哪个 provider，也只能用鼠标点，浮层还固定朝上展开。这一版按 `frontend-design` + UX 规范清单重做，
**配色仍然只用宿主语义 token（`--dsw-alias-*`），不自造色值**，所以亮/暗主题自动跟随。

| 改动 | 实现 | 关键点 |
| --- | --- | --- |
| **每行标来源** | `sourceChip(React, row)` → `span[data-mas-provider=<provider id>]` | 文案取 `providerName`，为空则退回 `provider`（`buildCatalog()` 里 `providerName = provider.name ?? displayName ?? pid`，**数据通道现成，不加字段**）；`maxWidth 84px` + ellipsis，`title` 写「来源：X（provider id：Y）」把两个标识都给全 |
| **计价不再糊在名字里** | `splitModelName(name)`，正则 `^(.*?)\s*·\s*(x\s*[0-9]+(?:\.[0-9]+)?)$` | 名字列只显示干净模型名；系数单独成 pill —— `free` → `freeBadgeLabel`（默认 `免`，tone `free`），否则 `priceFactor !== undefined` → `x0.10`（tone `price`），再否则用拆出来的后缀兜底 |
| **搜索面扩到来源** | `rowHaystack(row)` = `name + providerName + provider + model` 全小写；渲染与 `applySlotFilter()` 都读它（行上 `data-mas-name` 存的就是 haystack） | 输入 `beta` 或 provider id 就能筛出该来源的模型；placeholder 改「搜索模型名 / 来源」 |
| **键盘可完成全流程** | 模块级 `slotActive` + `applySlotNav()` / `moveSlotActive(delta)` / `activeSlotRow()`；常驻 `keydown`（capture）里 `ArrowDown/ArrowUp/Home/End` 移动、`Enter` 选中、`Escape` 关闭 | 高亮只改 `style.background` / `outline` 并 `scrollIntoView({block:'nearest'})`，**不重绘**，所以不会像 React 状态那样被宿主重建 slot 时丢掉 |
| **焦点有去处** | `closeSlot(restoreFocus)` + `slotFocusPending` 一次性标记 + 触发按钮的函数式 ref | 选完会 `notify()` 重绘、触发按钮被换成**新节点**，直接 `focus()` 旧节点无效 ⇒ 由新节点在 `!slotOpen && slotFocusPending` 时自己 `focus()`，`slotFocusTimer`（500ms）收口防泄漏 |
| **语义改到 listbox 一侧** | 面板内 `div#mas-slot-listbox[role=listbox]`、行 `button[role=option][aria-selected]`、搜索框 `input[type=search][role=combobox][aria-autocomplete=list][aria-controls=mas-slot-listbox]`，高亮项经 `aria-activedescendant` 暴露 | 原来的 `role="menu"` 已去掉 —— 选项不是菜单项，`menu/menuitem` 会让读屏按菜单语义播报，且与宿主菜单撞 `role` |
| **无命中不空屏** | `empty` 改成**常驻节点**（`display` 切换，不销毁），文案由 `slotEmptyText(needle, total)` 给 | 搜索无命中时提示「可以搜模型名、来源名或 provider id」，而不是留一块空白（UX 规范：Search No Results） |
| **数量可见** | 分组标题右侧 `[data-mas-group-count]`；页脚 `[data-mas-slot-foot]` 左列快捷键提示、右列 `[data-mas-slot-count]` | 过滤时页脚从 `N 个模型` 变成 `命中 / 总数 个模型`，用户知道是自己筛窄了而不是模型丢了 |
| **面板自动识别边界** | `fitSlotPanel()`，常量 `SLOT_PANEL_WIDTH 340` / `SLOT_PANEL_MAX 380` / `SLOT_PANEL_MIN 150` / `SLOT_VIEWPORT_MARGIN 8` / `SLOT_GAP 6` | ①宽度先夹进视口（`max(200, min(340, vw - 16))`）；②`wanted = min(MAX, 列表 scrollHeight + 搜索框 + 页脚 + 12)`；③比较触发按钮上下各自的可用空间，`up = above >= min(wanted, MIN) || above >= below` 决定朝上（`bottom: calc(100% + 6px)`）还是朝下（`top: calc(100% + 6px)`），`maxHeight` 夹在 `MIN..MAX`；④水平先 `left:0`，量 `getBoundingClientRect()` 后按右溢出左移、再按左溢出右推。**整体包在 `try/catch {}` 里** —— 量不到就保持原位，绝不让异常冒到宿主（宿主 napi_throw 会直接退出进程） |
| **不再撑出页面滚动条** | 面板 `overflow: hidden` + `boxSizing: border-box`，滚动交给内层 `list`（`flex 1 / minHeight 0 / overflowY auto`）；搜索框与页脚固定 | 上一版是面板自身 `overflowY: auto` 且固定 `bottom: calc(100% + 6px)` + `maxHeight 360px`，输入框在 composer 底部时向上顶出视口 ⇒ 页面被撑出滚动条（用户反馈 m00780） |
| **重贴合的四个时机** | `applySlotOpen()` 末尾、`applySlotFilter()` 末尾、面板函数式 ref 里、`window resize` + `document scroll`（capture） | 搜索把列表筛短、窗口被缩小、外层容器滚动，都会让面板重新贴合 |

**一处测试夹具的教训**：`scripts/test-client-dom.mjs` 的假 React 原先只支持对象式 ref（`props.ref.current = dom`），
而面板用的是**函数式 ref** ⇒ `slotPanelRef` 恒为 `null`，`applySlotFilter/applySlotNav/fitSlotPanel` 全部提前 return，
搜索与键盘用例三条一起 FAIL，看着像功能没做。修法是让假 React 支持函数 ref，并**延迟到节点进入文档之后再调用**，
与真实 React 的 commit 时序一致；否则 ref 里量到的尺寸全是 0，边界用例会假绿。

**反模式（都踩过）**：不要用 `role="menu"` 装可搜索的选项列表；不要用 `setTimeout` 包住可能抛错的宿主 API（异常脱离 `try/catch` 会变成 uncaught）；不要把计价后缀留在模型名里当标识 —— 它既挡住 ellipsis 又让「来源」无处可放。

### 2.9 设置页面：单页三步流程（分组 → 入组 → 运行策略，手动保存生效）

宿主菜单的分组维度是 provider，而需求要的是「**所有来源的多模态一组、纯文本一组**」，还要能改配置、能关掉单个模型。这三件事都不能靠改宿主菜单做，所以完整视图放在 **dsh 设置页面**里（见 2.10）。输入框这一侧只保留一枚**齿轮图标按钮**（`button[data-mas-settings-toggle]`，22×22、纯图标无文字），点击打开 **dsh 设置页面**并直接停到本插件的「模型自动选择」，与模型下拉**同一行**、不换行、不挤压下拉。**输入框旁不再有「模型面板」浮层**——早期那版 `button[data-mas-panel-toggle]` + `position:fixed` 浮层已整段删除。

**页面结构（`BUILD = 'mas-v11'`，单页顺读，不引入页签）**：

| 位置 | 内容 | 锚点 |
| --- | --- | --- |
| 顶部（sticky） | 标题 + 摘要（自动选择/默认模型/模型数/冷却）+「重新获取」+ 有草稿时出现「放弃」「保存」+ 保存条 + 状态行 | `data-mas-topbar`、`data-mas-status`、`data-mas-retry`、`data-mas-savebar`、`data-mas-save` |
| ① 分组 | 按类型分组开关 + 自定义分组卡片（改名/上移下移/删除/整组「下拉展示」/成员只读清单）+ 新建分组 | `data-mas-step="1"`、`data-mas-groupby="kind"`、`data-mas-group-card`、`data-mas-group-name`、`data-mas-group-flag="hidden"`、`data-mas-group-new` |
| ② 模型入组 | 搜索 + 分组筛选 chips + 逐组列模型，每行一个「入组」下拉 + 一个「展示」开关 | `data-mas-step="2"`、`data-mas-search`、`data-mas-filter`、`data-mas-group-head`、`data-mas-model-row`、`data-mas-assign`、`data-mas-flag="hidden"`、`data-mas-unassigned`、`data-mas-expand` |
| ③ 运行策略 | 六个语义块（默认模型与总开关 / 失败重试 / 自动切换 / 冷却恢复 / 模型与分组开关 / 高级），高级块默认折叠 | `data-mas-step="3"`、`data-mas-field`、`data-mas-advanced-toggle`、`data-mas-advanced-body` |

**为什么把保存条钉在顶部（sticky）**：模型清单最多 50 行，用户滚到下面改完入组后，页首的保存按钮已经看不见，只能滚回去找——这是「操作流程不顺」最直接的来源。`stickyBar()` 用 `position:sticky; top:0`（背景用 `--dsw-alias-bg-layer-2` 不透明层色，否则滚动时下面内容会透上来），所以任何滚动位置都能保存、也都能看到「有 N 项改动未保存」。

**改回原值会自动摘掉草稿**：`stage(key, value, note)` 写入前先和已保存值比对（`valueKey()` 对 `undefined` 用哨兵串、其余走 `JSON.stringify`），一致就从草稿里删掉该键；草稿清空后 `draft = null`、`statusKind` 回落 `idle`、`statusText = '没有未保存的改动'`，「保存」按钮随之消失。否则用户把下拉改错又改回来，保存条还挂着「有 1 项改动未保存」——既误导，点保存还会白写一次配置（写盘会触发插件重载）。未清空时文案区分两种：仍是原值 ⇒ `已恢复为已保存值（还剩 N 项改动）`，否则 `未保存：<note>`。

**三步顺序就是操作顺序**：`stepTitle('1','分组',…)` → `stepTitle('2','模型入组',…)` → `stepTitle('3','运行策略',…)`，每步带一句「先做什么」的指引，用户不用猜从哪开始。

**降低清单密度（`modelsSection()`）**：建过自定义分组后，筛选 chips 变成 `全部 N` / `未入组 N` / 每个分组一项（`data-mas-filter`，默认停在「全部」，点一下只显示该组）；单个分组超过 `MODEL_PAGE = 12` 行时先折叠，尾部给「显示全部 N 个（还有 M 个未展开）」（`data-mas-expand`）。筛选与折叠只改模块级 `modelFilter` / `modelsExpanded` 后 `notify()`，**不重排宿主 DOM**；这两个状态与 `advancedOpen` 都已进防重绘签名，否则点了会「没反应」。

**分组优先级（`core.ts:groupCatalog`，可判定、可复现）**

1. `customGroups` 非空 ⇒ **按数组顺序先命中先归组**（`claimed` 集合去重）；一条都没命中的模型落到末尾 `{ id:'__rest__', label:'其他 · N', custom:false }`，**绝不丢模型**。
2. 否则 `groupByKind === true`（默认）⇒ `['multimodal','text']` 两组，**多模态在前**，label 为 `多模态 · N` / `纯文本 · N`。
3. 否则按 provider 分组，label 用 provider 名。

单条自定义规则的条件是**且**关系，空条件 = 不限：

```ts
interface CustomGroup {
  id: string                 // 非空且不重复，重复 id 整条丢弃
  label: string              // 留空则按条件自动拼（多模态 / 来源a/b / 限免 / 指定模型 · N）+ ` · N`
  kind: 'text' | 'multimodal' | null
  providers: string[]        // provider id
  models: string[]           // 接受 `provider/model` 全名或裸 model 名
  freeOnly: boolean          // 只要限免
  explicit: boolean          // 显式成员模式：只认 models 名单，空名单不命中任何模型
}
```

**四类条件全空的规则会被整条丢弃**（`core.ts:isEmptyGroup`）：`kind===null && providers.length===0 && models.length===0 && !freeOnly` 的规则语义上等于「不限」，一旦留着就会命中全部模型、把「多模态 / 纯文本」两组吞成一组「自定义 · N」。判定放在 `seen.add(id)` **之前**，所以一条无效规则也不会把同 id 的有效规则挤掉。

**`explicit` 显式成员模式**（设置页「新建空分组」默认就带它）：`explicit === true` 的规则只按 `models` 名单归组（`matchesGroup` 首行直接返回名单命中结果），**空名单不命中任何模型**，因此合法不被丢弃。设置页的成员勾选第一次点下去就会把该组切成 `explicit: true`（`const base = rule.explicit ? rule.models : []`）——否则条件模式下 `models: []` 等于「不限」，勾一个成员会连带把 50 个模型全吞进这一组。

**行内徽标**：`core.ts:badgeOf` → `{ kindGlyph: '图' | '文', free: cfg.freeBadgeLabel | null }`（默认 `免`）。多模态=**图**、纯文本=**文**、占用=`用`/`占`、冷却=`冷 mm:ss`，全部单字缩写。

**限免判定（零依赖，可判定）**：宿主 `llm.listProviders/listModels/resolveModelInfo` 都不返回价格字段，第三方 provider（trae/qoder/workbuddy）把计价系数拼进模型名后缀 `· x0.06`。`core.ts:priceFactorOf` 用 `/[·・\s]\s*x\s*(\d+(?:\.\d+)?)\s*$/i` 取尾数，**只有明确等于 0 才判限免**（对齐 qoder 插件 host 侧 `"Free" means creditMultiplier === 0 EXACTLY`）；读不到 = `priceFactor: undefined`，**不得当免费**。

**入组是唯一的可用性入口（`data-mas-assign`）**：模型行上只有一个「入组」下拉（`<option value="">不入组（不可用）</option>` + 每个自定义分组一项；还没建组时 `disabled` 且首项文案「先新建分组」）+ 一个「展示」勾选框：

| 控件 | 锚点 | 写入字段 | 语义 |
| --- | --- | --- | --- |
| 入组下拉 | `data-mas-assign="provider/model"` | `customGroups[*].models` | 选中某组 = 该模型可用且只出现在这一组；选「不入组」= 从所有组摘掉 ⇒ **不可用、不进下拉** |
| 展示勾选框 | `data-mas-flag="hidden"` | `hiddenModels` | 组内仍可单独把某个模型藏起来（只影响展示） |
| 整组展示开关 | `data-mas-group-flag="hidden"` | `hiddenGroups` | 整组不进下拉 |

**「自动选择」是全局统一开关，不再逐模型/逐组设置**（用户 m04856 第 2 条）：模型级 `disabledModels` 与组级 `disabledGroups` 的界面开关已下线，可用性完全由「有没有入组」决定；这两项在「运行策略 → 模型与分组开关」里只做**汇总展示**（「由分组决定：没入组的模型默认不可用」/「另有 N 个模型被单独停用」），手改仍可通过 `POST /config` 直接写。

**未入组即不可用（`core.ts:isUnassigned`，用户 m04856 第 3 条）**：

```ts
export function isUnassigned(entry: ModelEntry, cfg: AutoSelectConfig): boolean {
  if (cfg.customGroups.length === 0) return false          // 没建组 ⇒ 沿用 dsh 原生全量可用
  return !cfg.customGroups.some((rule) => matchesGroup(entry, rule))
}
```

`buildCatalog()` 回填时 `entry.disabled = unassigned || isDisabled(...)`、`entry.hidden = unassigned || isHidden(...)` ⇒ 未入组的模型既进不了自动选择（`core.ts:unavailable` 首行判 `entry.disabled`），也不出现在模型下拉里。**`customGroups` 为空时恒为 `false`**，保证没建组的用户行为不变（向后兼容）。

**入组时强制切 `explicit`**（`assignToGroup()`）：把该模型从所有组 `models` 摘掉，再挂到目标组并置 `explicit: true`——条件模式下 `models: []` 等于「不限」，不切显式会把 50 个模型全吞进这一组。

**配置表单**：设置页底部按服务端 `GET /dsh-model-auto-select/config` 返回的 `fields` 渲染（服务端是唯一事实源，客户端不硬编码字段）。表单提交后按 `{ok, persisted}` 回显：`persisted:true` 表示已写进 `cordis.patch.yml`；`persisted:false` 表示 `configEditor` 不可用、只改了本进程内存（设置页底部同时显示目标文档路径）。

**数值项范围校验（客户端拦 + 服务端夹两道）**：`NUMBER_RULES` 给每个数值项定死 `{min, max, unit, step}`，界面右侧直接显示 `${min} – ${max} ${unit}`：

| 配置项 | 范围 | 单位 |
| --- | --- | --- |
| `maxRetries` | 0 – 10 | 次 |
| `retryDelayMs` | 0 – 60000 | ms |
| `cooldownMs` | 0 – 86400000 | ms（1 分钟 = 60000） |
| `catalogTtlMs` | 1000 – 3600000 | ms |
| `occupancyRefreshMs` | 1000 – 600000 | ms |

非数字 / 负数 ⇒ `statusKind='error'`、`statusText='<字段>：请输入大于等于 0 的数字'`、边框标红、**不提交**；超上界 ⇒ `'<字段>：取值必须在 <min> – <max> <unit> 之间（本次未保存）'`、**不提交**。服务端 `coercePatch` 再夹一次（有限数才收、`Math.floor`、非法整条丢弃），所以绕过界面直接 POST 也进不了非法值。

**三态 + 重试**（可判定，逐条对应代码分支，都在 `buildSettingsForm()` 里）：

| 状态 | 判定条件 | 界面 |
| --- | --- | --- |
| 加载中 | `view === null && viewError === ''` | 「模型目录加载中…」 |
| 拉取失败 | `viewError !== ''` | 「模型目录加载失败：{viewError}」 |
| 空列表 | `view !== null && view.entries.length === 0` | 「没有取到任何模型：请确认已在 dsh 设置页配置好 provider 与 API Key，然后点顶部「重新获取」。」 |
| 部分来源失败 | `view.failures.length > 0` | 黄色提示「有 N 个来源拉取失败：名称（原因）；…」 |

顶部固定有「重新获取」按钮（`data-mas-retry`，点它 → `statusKind='pending'`、`statusText='正在重新获取模型列表…'`、`void loadCatalog({ force: true })`）。**强制刷新必须带 `?refresh=1` 并自带收尾**：`force` 路径不复用在途请求（用 `catalogSeq` 序号挡掉旧响应覆盖），成功后写 `statusKind='ok'` + 「已刷新模型列表：N 个模型 · M 个分组」（`N===0` 时写「没取到任何模型，请先在 dsh 设置页配置 provider 与 API Key」），失败写 `statusKind='error'` + 「模型列表刷新失败：…」（经 `explainSaveError` 翻中文）。非 force 路径（首次加载、保存配置后重建）**不写状态行**，避免把保存提示覆盖掉。配置区 `config === null` → 「配置加载中…」；`postConfig` 失败 → `statusText = '保存失败：…'`，成功 → 「已保存到插件配置」或「已生效（未持久化）」。

> **防重绘签名必须含状态行与视图状态**：`mountSettingsForm()` 的签名是 `config JSON # entries 数 : 分组 id 串 # draft # modelFilter:modelsExpanded:advancedOpen # statusKind:statusText`。只比对数据的话，「保存成功 / 范围校验失败」这类**只改文案不改数据**的反馈会被签名判定为「没变」而挡住重绘，用户看到的就是「点了没反应」。

**图标的位置与不误触（同一行、不换行）**：宿主模型选择器的根容器 `div.<ModelSelect>.root` 的 CSS 只有 `min-width:0;position:relative`，是**块级容器**——早期把图标 `insertBefore(trigger.nextSibling)` 直接插进去，它就成了第二个块级子节点，必然掉到下一行（现场见用户截图）。现在 `ensureSettingsButton()` 先把根容器补成一行 flex（`display:flex`、`alignItems:center`、`flexWrap:nowrap`、`minWidth:0`，并打 `data-mas-settings-row="1"` 便于排障与测试锚定），图标再以 `flex:0 0 auto` + `white-space:nowrap` 落在模型按钮右侧；模型按钮本身 `min-width:0` 可继续省略号收缩，所以窗口变窄也不会换行或错位。`click` 里 `preventDefault()` + `stopPropagation()`，不会连带触发下拉。`aria-label` 与 `title` 都是「打开设置页面（模型自动选择）」，键盘 `Tab` 可达、`focus` 有背景色变化。

**打开设置页并定位到本插件 section 的链路（宿主没给第三方「打开某个 section」的公开 API，所以走 DOM 多跳）**：`SettingsSectionOwnerProps` 只给 `close`，`openSection` 只发给 `settings.onboarding`；`ctx.slots` 拿不到面板 store（`entry.store` 只是 handle），`ctx.shortcuts` 也没有 `invoke`。因此 `openSettingsSection()` 分两跳：

- **第一跳（开面板）** 三条候选按序尝试，每条点完都轮询 `div[data-shortcut-modal="settings"]` 是否真的出现（React 渲染异步，点完立刻查会假阴性）：
  1. `directButtons()`：`button[aria-label]` 里 `aria-label` ∈ `['设置','Settings']`（宿主 `settings-general` 的 `t("trigger")` 文案）；
  2. `classButtons()`：`button` 的类名以 `_trigger` 结尾且父节点类名含 `triggerRow`（宿主 CSS Module 的 `wCInkW_triggerRow > wCInkW_trigger`，按后缀匹配，不受语言切换影响）；
  3. `viaAccountMenu()`：点 `aria-label` ∈ `['账号菜单','Account menu']` 的账号按钮 → 在 `[role="menuitem"]`/`[role="option"]` 里找文本 ∈ `['设置','Settings']` 的菜单项 → 点它（宿主该菜单项回调里就是 `openSettings()`）。
- **第二跳（选导航项）** 在 `div[data-shortcut-modal="settings"]` 里遍历 `button`，取首个 `span` 文本（无 `span` 时退回整行文本）等于本插件 label「模型自动选择」的那个并 `click()`；最多 10 次 × 60ms 重试（面板是 portal 后挂上去的）。
- 任一跳失败都 `POST /beacon` 记 `{phase:'settings-open-failed', step:'launcher-missing' | 'nav-item-missing'}`（可追踪，不静默；`BEACON_KEYS` 白名单已含 `step`）。

> **为什么必须有第 3 条候选**：`settings.launcher` 是 **single 槽**（`dsh-cordis-client-runner/lib/client.js:5056`），真机上被 `dsh-client-ui-settings-account` 的 `AccountMenu` 占走，而 `renderSlot` 的 `fallback` **只在槽为空时生效** ⇒ 宿主 general 的 `button[aria-label="设置"]` 根本不渲染。真机 beacon 曾连续记 31 条 `step:'launcher-missing'`，就是这个原因（不是选择器写错）。

### 2.10 dsh 设置页面入口（插件配置项的第二处入口）

面板是本插件自带的浮层；**dsh 设置页面**里另有一个同名入口，两条入口读写同一份配置（同一 `cordis.patch.yml` 条目），互不覆盖。分两半落地：

**node 半边（`src/index.ts`）——让插件进 `settings.describe()`**

```ts
import * as zNamespace from '@deepseek-ai/schemastery'
const z: any = (zNamespace as any)?.default ?? zNamespace   // ESM 入口只有 default，CJS 入口是命名空间本身

export const inject = ['webServer', 'settings']

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  defaultModel: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() }).default(null).volatile(),
  maxRetries: z.natural().default(2).volatile(),
  // …21 项逐条，全部 .volatile()
  customGroups: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string(),
    providers: z.array(z.string()), models: z.array(z.string()), freeOnly: z.boolean(),
    explicit: z.boolean().default(false) })).default([]).volatile(),
})
```

三条硬规则（宿主 `dsh-settings` 实测）：

1. **必须有 `volatile`**：`describe()` 只对 `volatileForm(schema)` 非 `undefined` 的条目出页面，而 `volatileForm` 对「非 object 且非 volatile」的 schema 直接返回 `undefined` ⇒ 不 volatile 的插件在设置页面里根本不出现。
2. **嵌套对象数组整体 volatile，子字段不再加 volatile**：给子字段加会抛 `volatile fields require a fixed object path without an enclosing volatile field`。
3. **`apply(ctx, config)` 收到的是 Ref 图，不是裸值**：cordis 用 `Config['~standard'].validate()` 的结果作为配置，每个字段带 `.get()`。所以统一走 `readConfigRefs()` 摊平再 `resolveConfig()`，两种形态（宿主注入的 Ref / 单测传的裸对象）都能跑。

**client 半边（`src/client/index.ts`）——注册设置页导航项**

宿主**没有**通用的 schema→表单渲染器（`configForms` 只提供 `get(entryId)` / `describe()`，各 section 都是自带 `client.js` 的独立 bundle），所以页内表单仍由本插件渲染：

```ts
slots.inject('settings.section', () => slots.register({
  name: 'settings.section',
  id: 'model-auto-select',   // 未知 id 由宿主 navIcon() 回落通用齿轮图标，无需自备图标
  order: 30,                 // 宿主 general=0、plugins=15 之后
  label: () => '模型自动选择',
}, function ModelAutoSelectSection() {
  const ref = React.useRef(null)
  React.useEffect(() => { mountSettingsForm(ref.current); return () => { ref.current && (ref.current.innerHTML = '') } }, [])
  return React.createElement('div', { ref, style: { padding: '16px 20px 24px' } })
}))
```

- 组件 props 只有 `{close}`，且 `renderSlot("settings.section", {close}, {only: active})` 保证**只有当前选中那一个注册者被渲染**。
- 客户端 `inject` 必须是 `['slots']`（要注册槽位就得声明）。
- 表单渲染复用面板那套 `configRow()`（同一份 `fields`），并加「配置签名未变不重绘」保护：`JSON.stringify(config.config)` 比对，避免 15s 轮询冲掉正在输入的表单。
- 关掉宿主自动页：`ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))`。`auto` 的官方语义是「**没有自定义页时**才自动生成」，本插件已自建页，置 `false` 避免两个入口。`ctx.inject` 只在真实 cordis 上下文存在，单测/冒烟用裸对象上下文时跳过并记一条 `config` 日志。

---

## 3. 配置项说明

写在 profile 的 `cordis.patch.yml` 里对应插件的 `config:` 下（改完重启 dsh 进程生效）。所有字段都有默认值，`resolveConfig` 对非法值一律回落默认（不抛错）。

| 配置项 | 类型 | 默认值 | 判定规则 / 说明 |
| --- | --- | --- | --- |
| `defaultModel` | `{provider, model, reasoningEffort?}` \| `null` | `null` | 用户默认模型。`null` = 沿用宿主 `agentDefaultModel.currentSelection()`；设置后**优先于**宿主默认值。provider/model 必须都非空字符串，否则回落 `null`。 |
| `maxRetries` | int ≥ 0 | **2** | **同一模型最多重试几次（不含首次尝试）** ⇒ 单模型最多 3 次尝试（1 首发 + 2 重试）。设 0 = 首次失败立即切换。默认 2 的理由：一次瞬时抖动（429/超时）用重试吸收，两次仍失败说明该模型确实不可用，继续重试只是浪费时延。 |
| `retryDelayMs` | int ≥ 0 | **800** | 每次重试 / 切换前的等待毫秒，可被 `signal` abort 打断。 |
| `providerOrder` | `string[]` | `[]` | provider 优先顺序。未列出的按宿主 `listProviders()` 顺序排在后面。 |
| `modelOrder` | `string[]`（`'provider/model'`） | `[]` | 单模型优先顺序。未列出的按宿主 `listModels()` 顺序排在后面。 |
| `preferIdle` | bool | **true** | 自动切换时优先选未被会话使用的模型。`false` = 一律按既定顺序（不做空闲规避）。 |
| `switchScope` | `'group'` \| `'group-cross'` \| `'all'` | **`'group-cross'`** | **自动切换的作用域**。`group` = 只在当前模型所在的自定义分组里换，组内耗尽直接进冷却；`group-cross` = 组内优先、组内耗尽再跨组兜底（`reasonCode === 'cross-group'`，`decideOnError` 记为 `switch-cross-group`）；`all` = 忽略分组，在整个同类型池子里换。作用域只对**自动切换**生效：用户显式选定的首选模型不受限制（落在别组也照用），跨类型兜底也不受约束（分组 id 与模态类型不一一对应，`selectCrossClass` 传 `scopeGroups: []`）。未建自定义分组时 `scopeGroups` 为空 ⇒ 三者等价于 `all`。 |
| `cooldownMs` | int > 0 | **1800000**（30 分钟） | 全部不可用后的冷却时长。0 或非法值回落默认。 |
| `cooldownRefreshBlocked` | bool | **true** | 冷却期内抑制 `getCatalog(force=false)`，避免高频探测上游。 |
| `catalogTtlMs` | int > 0 | **60000** | 模型目录缓存 TTL（默认 1 分钟；宿主 `buildModelCatalog` 每次会话都重建，本插件缓存以免抖动）。 |
| `occupancyRefreshMs` | int ≥ 1000 | **5000** | 占用状态**兜底轮询**间隔。事件驱动（`agent/created` / `disposed` / `status` / 请求前）的即时刷新不受此限制。 |
| `switchOnCodes` | `string[]` | `[]` | 只在命中这些错误码时重试/切换。**空数组 = 除 `ABORTED` 外全部可切换**。宿主未知异常统一为 `'UNKNOWN'`（`harnessErrorCode`）。 |
| `crossClassFallback` | bool | **false** | 同类型耗尽后是否允许跨类型兜底（如纯文本全挂时切多模态）。默认不允许，直接进冷却 —— 避免"文本任务被悄悄换到多模态模型"这种不可预期行为。 |
| `enabled` | bool | **true** | 总开关。`false` = 插件只观测（仍写日志、仍暴露接口），所有 `agent/request-error` 一律 `next()` 交回宿主。 |
| `disabledModels` | `string[]`（`'provider/model'`） | `[]` | **自动选择：模型级**开关（设置页每行「选」勾选框写这里）。命中的模型在 `unavailable()` 首行直接判不可用：不参与首选、不参与切换、不参与跨类型兜底。全部候选都被关掉时 `decideOnError` 返回 `giveup(all-disabled)` 而**不是**冷却（等冷却也等不到候选，属配置问题）。 |
| `disabledGroups` | `string[]`（分组 id） | `[]` | **自动选择：分组级**开关。整组关掉 ⇒ 该组所有模型都不参与自动选择（`groupsOf` 把「模型 key → 分组 id」映射交给 `isDisabled`）。与 `disabledModels` 取并集。 |
| `hiddenModels` | `string[]`（`'provider/model'`） | `[]` | **下拉展示：模型级**开关。命中的模型不出现在本插件渲染的模型视图里（`isHidden`）。**只影响展示，不改变可用性**——宿主模型菜单的候选集插件改不了。 |
| `hiddenGroups` | `string[]`（分组 id） | `[]` | **下拉展示：分组级**开关。整组隐藏 ⇒ 该组所有模型都不在模型视图里出现。 |
| `freeBadgeLabel` | string | `'免'` | 限免徽标文案（单字缩写，见 2.8）。非空字符串才采用，否则回落默认。 |
| `groupByKind` | bool | **true** | 面板分组：`true` = 所有来源的多模态一组 / 纯文本一组（多模态在前）；`false` = 按 provider 分组。被 `customGroups` 非空时覆盖。 |
| `customGroups` | `CustomGroup[]` | `[]` | 用户自定义分组（需求「让用户自由分组展示」）。非空时接管面板分组：按数组顺序先命中先归组，未命中的落到「其他」。单条条件 `kind`/`providers`/`models`/`freeOnly` 是**且**关系；`explicit:true` 表示显式成员模式（只认 `models` 名单，空名单不命中任何模型）。非法条目整条丢弃（`normalizeCustomGroups`），不猜意图。 |

**占用状态刷新时机（明确的三层）**

1. **事件驱动即时刷新**：`agent/created`、`agent/disposed`、`agent/status`、每次 `applySelection` 前、每次 `handleRequestError` 内。
2. **兜底轮询**：每 `occupancyRefreshMs`（默认 5s）。
3. **HTTP 主动刷新**：`GET /dsh-model-auto-select/occupancy` 会先 `refreshOccupancy('http')` 再返回。

**占用的可判定定义**

- `inUse = true`：存在 live 会话（`agents.list()`）其"当前模型"等于该模型键。
- "当前模型"取值顺序：`sessionProjections.stateOf(session,'modelSelection')` 的 `pending ?? lastUsed` → `session.requestHeader().config`。
- **不使用** `agentDefaultModel.currentSelection()` 兜底 —— 全局默认值会让"还没选过模型的空会话"被误判成占用。
- `running = true`：上述会话中至少一个 `agent.status === 'running'`。**该口径只用于服务端选模型（`preferIdle`）与 `/catalog`、`/occupancy` 返回值；客户端 UI 的 `用`/`占` 徽标已撤除**（`inUse` 只代表「某会话把选择器停在该模型」，被判定为不准）。

---

## 4. 测试要点

`node --import ./scripts/host-resolve.mjs scripts/test-auto-select.mjs`（先 `node scripts/build.mjs`）→ **71 项全绿**。分层列出验证目标与断言：

### 4.1 模型分类（`kind`）

| 用例 | 断言 |
| --- | --- |
| 含 `image`/`audio`/`video` | `classify(['text','image']) === 'multimodal'`；`['image','audio']`、`['video']` 同样 `multimodal` |
| 空数组 / 仅 `text` | `classify([]) === 'text'`、`classify(['text']) === 'text'`（`inputModalities` 缺省也是 text） |
| 模态归一化 | `normalizeModalities(['IMAGE',' image ','text',3,null])` → `['image','text']`（去重、小写、丢非字符串） |
| 同类型筛选 | `kind='text'` 的候选池里**不会出现**多模态模型 |

### 4.2 来源标注

| 用例 | 断言 |
| --- | --- |
| provider 名与 settingsNs 都进条目 | `entry.providerName === 'Alpha'`、`entry.providerSettingsNs === 'alpha-ns'`、`entry.key === 'alpha\u0000text-a'` |
| 三级模态来源可追踪 | node 半边夹具里 `mm-a` 的 `modalitySource === 'listModels'`（`inputModalities` 直接给了）；`text-b` 的 `modalitySource === 'resolveModelInfo'`（`listModels` 没给，靠 `resolveModelInfo` 补） |
| provider 失败隔离 | 某 provider `listModels` 抛错 → 进 `failures[]`，其它 provider 的条目照常产出（不整体 500） |

### 4.3 会话占用标注

| 用例 | 断言 |
| --- | --- |
| `inUse` / `running` 分别可判定 | `computeOccupancy([{sessionId:'s1',key:K,status:'running'},{sessionId:'s2',key:K,status:'idle'}])` → `{owners:['s1','s2'], inUse:true, running:true}`；`occupancyOf(map,'other').inUse === false` |
| 空会话不算占用 | node 半边夹具：`session-1`（running，`requestHeader→alpha/text-a`）与 `session-2`（idle，`requestHeader→undefined`）→ `occ['alpha\u0000text-a'].owners === ['session-1']`（**不含 session-2**） |
| UI 不再标占用（撤除防回归） | DOM 用例断言：宿主菜单徽标只有 `['免']`；`occupancy` 里 `inUse` 为真的两行**也不画任何徽标**；设置页徽标含 `免` 且不含 `用`/`占`；自建下拉打开后**不再打 `GET /occupancy`**（`occupancyQueries.length === 0`）。服务端仍照算 occupancy，只是客户端不画 |

### 4.3.1 面板分组与徽标（`groupCatalog` / `badgeOf` / `priceFactorOf`）

| 用例 | 断言 |
| --- | --- |
| 默认跨来源按类型分组 | 未设自定义规则时 `groupCatalog` 返回 `['multimodal','text']`，多模态组**同时含 alpha 与 beta 的模型**（真正跨来源），label 为 `多模态 · 2` |
| `groupByKind=false` | 退回按 provider 分组 `['alpha','beta']`，alpha 组 3 条 |
| 自定义规则接管 | 规则 `[{id:'a',kind:'multimodal',freeOnly:true},{id:'b',providers:['beta']}]` ⇒ `['a','b','__rest__']`，rest label `其他 · 3`，前两组 `custom===true` |
| 规则空命中不吞模型 | 规则 providers 全不匹配 ⇒ 只剩 `['__rest__']` 且 `entries.length === 全部模型数` |
| 条件是与关系 | `{kind:'multimodal', providers:['alpha']}` 只命中 `alpha/mm-a`，不命中 `beta/mm-b` |
| 非法条目整条丢弃 | 5 条输入（重复 id / 缺 id / null / 字符串 / 1 条合法）⇒ 只剩 1 条，字段被规范化 |
| 默认值 | `DEFAULT_CONFIG.customGroups === []`、`groupByKind === true` |
| 行内徽标 | `badgeOf(多模态且限免)` ⇒ `{kindGlyph:'图', free:'免'}`；`badgeOf(纯文本)` ⇒ `{kindGlyph:'文', free:null}`；`freeBadgeLabel:'免费'` 时 free 变 `免费`（缩写可被配置覆盖） |

### 4.3.2 dsh 设置页面入口（插件配置项）

| 用例 | 断言 |
| --- | --- |
| 插件出现在 `settings.describe()` | `Config.toJSON()` 里含 `"volatile"` 标记，且 20 个配置键全在 schema 里（少一个就会在设置页缺失） |
| 空配置校验不炸 | `Config['~standard'].validate({})` 的 `issues === undefined`（全部字段有 `default`） |
| 字段是 Ref 图 | 校验结果里每个字段都 `typeof value.get === 'function'`（宿主注入形态，不是裸值） |
| Ref 能摊平回裸对象 | `readConfigRefs(validate({maxRetries:5, freeBadgeLabel:'免费'}).value)` → `resolveConfig` → `maxRetries===5`、`freeBadgeLabel==='免费'`、未填的 `cooldownMs===1800000`（默认值不被 Ref 摊平破坏） |
| client 半边声明 slots | `src/client/index.ts` 里 `export const inject: string[] = ['slots']`、`SETTINGS_SLOT = 'settings.section'`、`SETTINGS_ID = 'model-auto-select'` 三处字面量都在（缺一处入口就不出现） |
| 真机（需重启 dsh 进程） | 设置页左侧出现「模型自动选择」导航项（通用齿轮图标）；页内 21 项可读可写；改动落 `cordis.patch.yml` 的 `model-auto-select` 条目并触发插件重启 |

### 4.4 自动切换

| 用例 | 断言 |
| --- | --- |
| 首选模型可用 | `reasonCode === 'preferred'` |
| 首选被占用仍优先 | `reasonCode === 'preferred-busy'`，`owners` 含占用者（用户显式选择 > 空闲规避） |
| 重试额度 | `maxRetries=2` ⇒ 第 1、2 次 `action==='retry'`，第 3 次 `action==='switch'` |
| `maxRetries=0` | 首次失败直接 `switch`，`retriesUsed === 0` |
| aborted 不消耗额度 | `aborted:true` 或 `failureCode:'ABORTED'` ⇒ `giveup(aborted)` |
| 白名单 | `switchOnCodes:['RATE_LIMIT']` + 失败码 `AUTH` ⇒ `giveup(non-switchable)`（交回 `llm-retry`） |
| 切换顺序可复现 | 依次失败后 `excluded` 累积，每次取同类型下一个；同一输入两次运行结果一致（`sortKey` 四元组确定性） |
| 优先空闲 | 靠前候选被占用 ⇒ 跳到更靠后的空闲候选，`reasonCode='fallback-idle'` |
| 全部占用 | 无空闲候选 ⇒ 取排序第一个，`reasonCode='fallback-order'`，`owners` 写全 |
| `preferIdle=false` | 一律按既定顺序，不跳占用 |
| 跨类型 | `crossClassFallback=true` 且同类型耗尽 ⇒ `reasonCode==='switch-cross-class'`；默认 `false` ⇒ 直接 `cooldown` |
| 分组作用域（组内） | `switchScope='group'` + `scopeGroups=['g1']` ⇒ 只在 g1 里换；组内耗尽返回 `null`（不跨组） |
| 分组作用域（组内→跨组） | 默认 `group-cross`：组内耗尽 ⇒ 从其它组取候选，`reasonCode==='cross-group'`、`decideOnError` 返回 `switch-cross-group` |
| 分组作用域（全部） | `switchScope='all'` ⇒ 忽略 `scopeGroups`，全类型池子按序取，不标 `cross-group` |
| 首选不受作用域限制 | 首选模型落在别组仍返回 `preferred` / `preferred-busy` |
| 无自定义分组 | `customGroups=[]` ⇒ `scopeGroups` 为空，行为等同 `all`（旧配置不受影响） |

### 4.5 冷却恢复

| 用例 | 断言 |
| --- | --- |
| 全部不可用 | 同类型候选全部 excluded ⇒ `action==='cooldown'`，`cooldownUntil === now + 1800000` |
| 冷却中再出错 | `giveup(cooldown-active)`，不重试不切换 |
| 模型级冷却 | `modelCooldown[key] > now` 时该模型被跳过（`unavailable` 判定） |
| 冷却结束 | `wakeFromCooldown()` 后 `cooldown.until === 0`、`modelCooldown` 清空、各会话 `excluded === []`、写一条 `cooldown-end` 日志、`getCatalog(true)` 被调用 |
| 冷却期抑制刷新 | `getCatalog(force=false)` 在冷却期返回上一份快照并写 `giveup(cooldown-active)` 抑制日志（可用 `/catalog?refresh=1` 强制绕过）；抑制生效的前提是 `catalogReady && catalogSettled()`，未稳定时不抑制 |
| 目录未就绪不进冷却 | `catalogReady === false` 时 `applySelection` 返回 `null`、写 `select(catalog-not-ready)`、`cooldown.until` 保持 0 |
| provider 集合未稳定不进冷却 | `fakeCtxGrowing()` 只注册部分 provider 时，`applySelection` 返回 `null`、写 `select(catalog-settling)`、`cooldownActive === false` |
| provider 补齐后可选中 | 补齐 provider 后 `getCatalog(true)` + 稳定窗口，`catalogProviders.length` 增加、能选中新模型、`selectForNextRequest` 收到该模型、全程不进冷却 |
| 订阅重建信号 | `apply()` 注册 `llm/adapters-updated`；触发后 `catalogProvidersAt > 0` 且 `catalogSettled() === false` |
| 日志 | 选择 / 重试 / 切换 / 冷却四类事件字段齐全；超长文本截断到 240 字符；数组限长 32 项 / 项 96 字符；环形缓冲只留最近 capacity 条 |

### 4.6 自动化冒烟（无需启动宿主）

四个脚本，一个命令全跑：`npm run test:all`。

| 脚本 | 命令 | 覆盖 | 期望 |
| --- | --- | --- | --- |
| 纯判定层回归 | `node --import ./scripts/host-resolve.mjs scripts/test-auto-select.mjs` | 分类 / 来源 / 排序 / 选择 / 重试 / 切换 / 占用 / 冷却 / **冷却抑制日志节流** / 日志 / 配置容错 / **分组与徽标** / **全空自定义规则被丢弃** / **路由注销 + 僵尸路由自愈** / **dsh 设置页面 Config**（夹具为纯函数；`--import` 垫片用于解析 `@deepseek-ai/schemastery`） | 全部通过 71 项 |
| 客户端 DOM 行为 | `node scripts/test-client-dom.mjs` | 起本地 http 服务造出与宿主一致的菜单结构（`[role="menu"] > 分组 > button[role="menuitemradio"] > span[data-provider-id][data-model-id]`）与宿主设置入口（`button[aria-haspopup="dialog"]` + `div[data-shortcut-modal="settings"]` 导航），用 `__ModuleLoader__` 加载真实 `lib/client.js`，断言：工具栏零 stray 且**设置图标恰 1 枚**、设置图标挂 `#modelRoot`、`aria-label`/`title` 都是「打开设置页面（模型自动选择）」、图标按钮无文字不挤压下拉、**旧版「模型面板」按钮不存在**、**齿轮与下拉同一行（root 被补成 `flex-wrap:nowrap` 行、垂直差 <8px）**、非冷却期无倒计时、宿主菜单徽标只有 `['免']`、**occupancy 里 inUse 为真的两行也不画任何徽标（占用撤除的防回归）**、无「空闲」、**宿主已标「限时免费」的行不再补 `免`**、**宿主菜单行顺序 `['m-0'..'m-5']` 完全不变**、点设置图标后设置面板打开且导航项停在「模型自动选择」、设置页「多模态 · 2」在「纯文本 · 4」之前、多模态组跨两个来源、行内有 `图` 与 `文`、设置页徽标含 `免` 且**不含 `用`/`占`**、勾选框提交 `toggleModel:{provider:'alpha',model:'a-mm-1',disabled:true}`、数字输入提交 `maxRetries:5`、21 个 `fields.label` 全部出现在正文、正文显示 `cordis.patch.yml`、冷却倒计时 `冷 mm:ss` 出现/消失、**找不到宿主设置入口时落 `beacon{phase:'settings-open-failed',step:'launcher-missing'}`**、**launcher 槽被账号菜单占用时经「账号菜单 → 菜单项设置」仍能进设置页**、**面板开了但缺本插件导航项时落 `step:'nav-item-missing'`**、**分组可改名/删除/勾成员（首次勾选即切 `explicit:true`）**、**整组开关提交 `toggleGroup`**、**`maxRetries=99` 不提交并给 `0 – 10` 范围提示**、**`cooldownMs` 标出 `ms` 与 `60000`**、**`/catalog` 500 时显示失败原因 + 恰 1 个「重新获取」**、**点「重新获取」后状态行落定（成功带模型数、失败带原因，且请求带 `?refresh=1`）**、**「自动切换范围」是三选下拉且改动能进草稿并提交 `switchScope`**、**下拉改回原值后草稿自动摘掉（保存条回「没有未保存的改动」、`data-mas-save` 消失）**、**宿主下拉里标出已保存分组名、未入组行带 `data-mas-unassigned-row` 且 `opacity 0.55`**、**未保存的草稿组名不泄漏到宿主下拉**、重复 `apply()` 幂等、`snapshot()` 为 `{build:'mas-v11',view,viewError,config,statusText}` 且无 `panelOpen`、**自建下拉按用户分组渲染且未入组不出现**、**点行提交到插件 `/select`**、**空组给可操作提示**、**自建下拉每行标出来源且搜索能按来源命中**、**搜索无命中给出可操作提示而不是空白**、**↑↓ 移动高亮 + Enter 选中 + Esc 关闭并把焦点还给触发按钮**、**面板自动识别边界（朝上/朝下翻转、maxHeight 按可用空间、窄视口收窄宽度、不撑出页面滚动条）**、**占用徽标已撤除：宿主菜单与自建下拉都不出现 `用`/`占`，打开下拉也不再打 `/occupancy`** | 全部通过 53 项 |
| HTTP 六端点 | `node scripts/smoke-http.mjs` | 用真实 `node:http` 承载 `webServer.register` 的 handler，跑 `/health` `/catalog` `/occupancy` `/logs` `/cooldown/clear` `/beacon`：分类与来源字段、占用随 `agent/created` 刷新、`maxRetries:1` 时 retry→switch、同类型耗尽进 30 分钟冷却、冷却中 giveup、同源校验 200/403、413 超限、beacon 字段白名单（含 `step`）、未知路由 404、**`/catalog` 暴露 21 项配置（含 `switchScope`，默认 `group-cross`）与 `groups`** | 全部通过 31 项（无宿主 hook 时 `pluginRecordChannel=false` 属预期） |
| plugin record 落盘 | `node --import ./scripts/host-resolve.mjs scripts/smoke-plugin-record.mjs` | 用宿主真实 `Session` 建会话，验证 `plugin:model-auto-select/{select,retry,switch}` 真落进事件流、`ignorable===true`、带 `seq`/`time`、`pluginRecordOf` 能取回 `data.from/to/reasonCode` | 全部通过 10 项 |

`scripts/test-client-dom.mjs` 用 `playwright-core` 驱动本机 Edge，**不依赖 DSH 登录态**（GUI 有 launch-token 鉴权，headless 直连会被 401 拦）。它自带一个最小 http 服务同时充当页面宿主与插件接口，所以能脱离 dsh 进程验证标注行为；`playwright-core` 从 `D:/my-projects/plugins/dsh-git-panel/node_modules` 以绝对 file URL 解析，没有就跳过该脚本。

`scripts/host-resolve.mjs` + `scripts/host-resolve-hooks.mjs` 是 ESM loader 垫片，把 `@deepseek-ai/*` 指向 `D:/apps/dsh-desktop/resources/app/dsh/node_modules`（可用 `DSH_HOST_ROOT` 覆盖）。原因：宿主进程内 `import('@deepseek-ai/dsh-session')` 由宿主的 profile-resolution 拦截解析，**脱离宿主进程的 node 脚本解析不到**（profile 的 `node_modules/@deepseek-ai/` 只有 8 个包，不含 dsh-session）。加 `EXPECT_PLUGIN_RECORD=1` 时 HTTP 冒烟会把 `pluginRecordChannel` 强断言为 `true`（31 项）：

```bash
EXPECT_PLUGIN_RECORD=1 node --import ./scripts/host-resolve.mjs scripts/smoke-http.mjs
```

### 4.7 真机冒烟清单

```bash
# 1) 构建 + 全量冒烟
node scripts/build.mjs && npm run test:all

# 2) 装到 profile（junction，改代码只需重跑 build）
#    profile: %USERPROFILE%\.dsh\profiles\desktop\package.json
#    dependencies += "@zjjlivingfree/dsh-model-picker": "link:D:/my-projects/plugins/dsh-model-picker"
#    dsh.profile.bundles += "@zjjlivingfree/dsh-model-picker"
#    node_modules/@zjj/ 下建 junction：cmd //c "mklink /J dsh-model-picker D:\my-projects\plugins\dsh-model-picker"
#    （Windows bash 的 ln -s 不可靠，必须用 mklink /J）
#    然后重启 dsh 进程（node 半边改动不重启不生效；客户端改动硬刷新即可）

# 3) 接口自检
curl http://<GUI_HOST>/dsh-model-auto-select/health
curl http://<GUI_HOST>/dsh-model-auto-select/catalog | jq '{providerCount, entries: [.entries[] | {key, kind, providerName, modalitySource, sortKey}]}'
curl http://<GUI_HOST>/dsh-model-auto-select/occupancy
curl 'http://<GUI_HOST>/dsh-model-auto-select/logs?limit=20'
curl -X POST http://<GUI_HOST>/dsh-model-auto-select/cooldown/clear    # 人工解除冷却

# 4) UI 标注：打开模型选择菜单，行上只应有 `免` 与已保存分组名（**占用 用/占 已撤除，不应出现**）；按钮旁只有冷却期才有「冷 mm:ss」
# 5) 故障演练：把某 provider 的 key 改错 → 触发失败 → /logs 应看到 retry×2 → switch → （可选）cooldown
```

---

## 5. 关键日志字段

两处落地：① 内存 `LogRing`（容量 500，`GET /logs?limit=N`，上限 600）；② `appendPluginRecord(session, 'plugin:model-auto-select/<event>', data)` 写进会话（`ignorable:true`，不进模型可见 surface，fork/resume 保留）。宿主不暴露 `appendPluginRecord` 时静默降级为纯内存日志（`/health` 的 `pluginRecordChannel` 字段显示当前通道是否可用）。

### 5.1 事件类型

| `event` | 触发点 |
| --- | --- |
| `config` | 插件启动、配置解析、路由注册、`selectForNextRequest` 不可用降级、plugin record 写入失败 |
| `catalog` | 目录构建完成、目录构建失败 |
| `select` | 进入会话 / 冷却结束 / 切换后重选（`applySelection`） |
| `retry` | `decideOnError` 返回 `retry` |
| `switch` | `decideOnError` 返回 `switch`（含跨类型） |
| `cooldown` | 进入全局冷却 |
| `cooldown-end` | 冷却到期自动结束 / 人工清除 |
| `giveup` | 交回宿主（aborted / disabled / cooldown-active / non-switchable / all-disabled）；冷却期抑制目录刷新也记这里，按 60s 节流 |
| `occupancy` | 占用集合发生变化（有变化才写，避免刷屏） |

### 5.2 字段表

| 字段 | 类型 | 出现事件 | 含义 |
| --- | --- | --- | --- |
| `ts` | number | 全部 | 毫秒时间戳 |
| `event` | string | 全部 | 见上表 |
| `sessionId` | string | select/retry/switch/cooldown/giveup | 会话 id（`agent.id ?? agent.session.id`） |
| `turn` / `step` | number | retry/switch/cooldown/giveup | 失败发生在第几轮第几步（来自 `agent/request-error` payload） |
| `kind` | `'text' \| 'multimodal'` | select/switch/cooldown/catalog | 本次选择所属类型 |
| `from` | string | retry/switch/cooldown/giveup | 切换/失败前的模型键 `provider\u0000model` |
| `to` | string | select/switch | 选中/切换到的模型键 |
| `reasonCode` | string | select/retry/switch/cooldown/giveup | **判定结论码**：`preferred` / `preferred-busy` / `fallback-idle` / `fallback-order` / `cross-class` / `no-candidate` / `retry` / `switch-idle` / `switch-order` / `switch-cross-class` / `cooldown` / `aborted` / `disabled` / `cooldown-active` / `non-switchable` / `internal-error` |
| `reason` | string | 全部 | 人类可读判定说明（含具体数字，如"重试 1/2"、"同类型候选全部被占用（s1,s2）"） |
| `attempts` | number | select/retry/switch/giveup | 当前模型累计尝试次数 |
| `retriesUsed` | number | retry/switch/giveup | 当前模型已消耗的重试次数 |
| `maxRetries` | number | retry/switch/giveup/config | 生效的 `maxRetries` 配置值 |
| `switches` | number | switch | 本会话累计切换次数 |
| `delayMs` | number | retry/switch | 本次等待时长 |
| `failureCode` | string | retry/switch/cooldown/giveup | 宿主 `LlmFailure.code`（未知异常为 `'UNKNOWN'`） |
| `failureMessage` | string | 同上 | 上游报错原文（截断 240 字符） |
| `cooldownUntil` | number | cooldown | 冷却到期时间戳 |
| `cooldownRemainingMs` | number | cooldown | 冷却剩余毫秒 |
| `catalogSize` | number | select/switch/catalog/cooldown-end | 本次判定时的目录条目数 |
| `idleCandidates` | number | select | 同类型里未被占用的候选数（"空闲规避"的直接证据） |
| `orderIndex` | number | select/switch | 选中模型在排序池中的 0 基下标（可复现性证据） |
| `owners` | string[] | select/switch/occupancy | 占用该模型的会话 id（升序） |
| `via` | `'selectForNextRequest' \| 'agent/request-override'` | select/switch | 选择落点走的是官方入口还是瀑布兜底 |
| `suppressed` | number | giveup（`cooldown-active`） | 本次记录之前被节流折叠掉的抑制次数（冷却 30 分钟最多 30 条日志，信息不丢） |
| `version` | string | config/catalog/cooldown | 插件版本 |

### 5.3 一次典型故障的日志序列

```json
{"ts":..., "event":"catalog",  "reason":"目录构建完成：text=12 multimodal=6 providers=3 failures=0", "catalogSize":18}
{"ts":..., "event":"select",   "sessionId":"s1","kind":"text","to":"alpha\u0000text-a","reasonCode":"preferred","reason":"agent-created → preferred: 用户默认模型","orderIndex":0,"idleCandidates":9,"catalogSize":18,"via":"selectForNextRequest"}
{"ts":..., "event":"retry",    "sessionId":"s1","turn":1,"step":1,"from":"alpha\u0000text-a","reasonCode":"retry","reason":"同一模型重试 1/2（失败码 RATE_LIMIT）","retriesUsed":1,"maxRetries":2,"delayMs":800,"failureCode":"RATE_LIMIT"}
{"ts":..., "event":"retry",    "sessionId":"s1","turn":1,"step":1,"from":"alpha\u0000text-a","reasonCode":"retry","reason":"同一模型重试 2/2（失败码 RATE_LIMIT）","retriesUsed":2,"maxRetries":2,"delayMs":800}
{"ts":..., "event":"switch",   "sessionId":"s1","turn":1,"step":1,"kind":"text","from":"alpha\u0000text-a","to":"beta\u0000text-b","reasonCode":"switch-idle","reason":"重试额度已用尽（maxRetries=2），切换到同类型模型 beta/text-b：同类型空闲候选按序取第 2 个","orderIndex":1,"owners":[],"switches":1,"via":"selectForNextRequest"}
{"ts":..., "event":"cooldown", "sessionId":"s1","kind":"text","from":"beta\u0000text-b","reasonCode":"cooldown","reason":"同类型（text）候选全部不可用（已排除 3 个），进入冷却 1800000ms","cooldownUntil":..., "cooldownRemainingMs":1800000}
{"ts":..., "event":"giveup",   "sessionId":"s1","reasonCode":"cooldown-active","reason":"全局冷却中，剩余 1799999ms，不重试不切换"}
{"ts":..., "event":"cooldown-end","reason":"冷却结束（持续 1800000ms），已重新获取目录：18 个模型","catalogSize":18}
{"ts":..., "event":"select",   "sessionId":"s1","reasonCode":"fallback-idle","reason":"cooldown-end → fallback-idle: 同类型空闲候选按序取第 1 个","idleCandidates":9}
```

---

## 附：接口清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-model-auto-select/health` | `status/plugin/version/uptime/catalogSize/catalogAgeMs/cooldownActive/sessionRecords/logRecords/pluginRecordChannel` |
| GET | `/dsh-model-auto-select/catalog` | 完整目录视图：`entries`（含 `kind`/`modalities`/`modalitySource`/`sortKey`/来源三元组/`priceFactor?`/`free`/`disabled`）、`groups`（跨来源分组，含 `custom` 标记）、`failures`、`occupancy`、`cooldown`、`sessions`、`config`（21 项）；`?refresh=1` 强制重建 |
| GET | `/dsh-model-auto-select/logs?limit=N` | 最近 N 条日志（1–600） |
| GET | `/dsh-model-auto-select/occupancy` | 先强制刷新占用再返回 `{occupancy, refreshedAt}` |
| POST | `/dsh-model-auto-select/cooldown/clear` | 人工解除全局冷却 + 清模型级冷却 + 清各会话 excluded（同源校验） |
| GET | `/dsh-model-auto-select/config` | 配置视图：`{version, config, defaults, fields, writable, active, documentPath}`。`active` = 本插件 fiber 是否处于 `state 2`（写配置会触发插件重启，重启窗口内为 `false`，此时写入会先等它恢复）。`fields` 是面板与 dsh 设置页面表单的唯一事实源（**21 项**，`type` 取 `boolean` / `number` / `model` / `models` / `groups` / `groups-list` / `list` / `text` / `scope`） |
| POST | `/dsh-model-auto-select/config` | 改配置并写回 `cordis.patch.yml`（同源校验 + 64KB 上限 + JSON 校验）。支持逐字段 patch 与 `{toggleModel:{provider,model,disabled}}`。返回 `{ok, persisted, changed}`：`persisted:false` 表示 `configEditor` 不可用、只改了本进程内存。**写入前会现取 `configEditor` 的 entry，遇到 `no longer active` / `no longer available` / `changed during reload` 先等插件恢复（最长 1.5s）再重试一次**，仍失败返回中文可操作提示而不是原始英文错误 |
| GET/POST | `/dsh-model-auto-select/beacon` | 客户端排障通道（POST 白名单字段 + 文本截断 400 字符，上限 200 条；同源校验；请求体上限 64KB） |

## 附：构建与安装

```bash
cd D:/my-projects/plugins/dsh-model-picker
node scripts/build.mjs        # → lib/index.js (98.1kb) / lib/core.js (17.6kb) / lib/client.js (31.8kb)
npm run test:all              # → 71 项 + 53 项 + 31 项 + 10 项，四套全绿
```

安装（profile 为 junction 链接，改代码只需重跑 build）：

1. `%USERPROFILE%\.dsh\profiles\desktop\package.json` 的 `dependencies` 加 `"@zjjlivingfree/dsh-model-picker": "link:D:/my-projects/plugins/dsh-model-picker"`；
2. 同文件 `dsh.profile.bundles` 数组加 `"@zjjlivingfree/dsh-model-picker"`；
3. 在 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\@zjj\` 下建 junction：`cmd //c "mklink /J dsh-model-picker D:\my-projects\plugins\dsh-model-picker"`（Windows bash 的 `ln -s` 不可靠）；
4. 重启 dsh 进程（node 半边改动必须重启；只改客户端则硬刷新页面即可）。

验证安装：`curl http://<GUI_HOST>/dsh-model-auto-select/health` 应返回 `{"status":"ok","plugin":"@zjjlivingfree/dsh-model-picker",...}`；404 说明进程未重启或 bundles 未登记。
