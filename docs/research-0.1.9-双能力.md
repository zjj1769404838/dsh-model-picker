# dsh-model-picker 0.1.9 研究报告：能力 1「错误自动继续」+ 能力 2「上下文阈值升级会话」

> 需求来源（用户 m08644 逐字）：「深度研究插件开源@jayyuen66/dsh-session-rescue及我本地的dsh-session-escalation插件，在我当前的插件中加入 1.错误自动继续 2.上下文达到阈值先创建新会话继续任务且归档旧会话」
> 本文档只记录**已实读/已亲验的事实**，不含设计决策。设计决策见后续设计文档。
> 产出时间：2026-11-22

---

## 0. 当前插件现状（本人实读）

| 项 | 实读结论 |
|---|---|
| 源码规模 | src/core.ts 1393 行 / src/index.ts 2516 行 / src/client/index.ts 3544 行（共 7453 行） |
| 监听事件 | 仅 5 个：`agent/created`(:2243)、`agent/disposed`(:2251)、`agent/status`(:2261)、`llm/adapters-updated`(:2270)、`agent/request-error`(:2279, prepend:true) |
| 会话相关 API | 仅 `sessionProjections.stateOf` + `appendPluginRecord` —— **无 create / archive / followup** |
| Config schema | src/index.ts:96-134，含 0.1.8 三字段 `requestRetryEnabled` / `requestRetryMax` / `requestRetryBackoffMs` |
| 依赖 | profile 无独立 `@deepseek-ai/dsh-session` 包（若需要须 try-import 降级） |
| apply() 全景 | src/index.ts:2236-2434 |
| 当前版本 | package.json version=0.1.8（本地已 commit `167a671`，**未推送未发布**；npm latest=0.1.7） |

---

## 1. 参考插件 A：@jayyuen66/dsh-session-rescue@0.1.16

研究包位置：`D:/tmp/srescue/package/`，主文件 `host.js` 2767 行。

### 1.1 三条自动注入路径（共用 `scheduleInjection()`，host.js:1931-2010）

| 路径 | 触发事件 | 判定条件 | 延迟 | 冷却 | 上限 |
|---|---|---|---|---|---|
| resume | `agent/error` (:2082-2128) | 错误属瞬时 | 10000ms | 120000ms | 3 |
| continue | `agent/status`→idle (:2175-2208) | 上回合终态=max-tokens | 3000ms | 60000ms | 3 |
| unfinished | 回合 completed 但待办未闭合 (:2146-2174) | — | 5000ms | 120000ms | 2 |

- `aborted` / `interrupted` **不注入**（:2187）
- 默认值集中在 configSchema（host.js:2644-2662），README:143-155 一致

### 1.2 ResumeScheduler（host.js:276-575）关键机制

- `onFailure()`(:346-386) 纯决策，闸门序：**会话非法 → 容量200 → 已有pending → 配额满 → 冷却 → 放行**
- **链式旁路**：`chainDelayMs>0` 时冷却不拦截，按 `max(delayMs, chainDelayMs)` 重调度(:372-378)
- `settle()`(:427-439)：**fired 才计数，skipped 不计数**
- `onSuccess()`(:457-462)：**只清 resume/continue 计数**（连续语义，整会话累计不失效）
- `onTodosClosed()`(:467-471)：单独恢复 unfinished 配额
- `quotaMemo`(:281, :324-331)：记录淘汰配额，防 daemon 重启静默清零
- `noteTurnHandled()`(:532-538)：「已处理轮次水位」挡宿主磁盘写失败导致的旧轮重放

### 1.3 注入动作与 source kind（★关键）

```js
agent.followup({
  id, role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'plugin:session-rescue' }
})
```
- host.js:1989-1997；steer 模式改用 `agent.steer` 同形状(:2262-2270)
- `RESCUE_SOURCE_KIND = 'plugin:session-rescue'`(:1267)
- **0.1.7 起因宿主 V4 准入拒收旧 `{kind:'plugin', plugin}` 包装，改用 producer-owned kind**(:1262-1264)
- 该 kind 同时是**链式判定判据**（`openerKindOf` :2121, :1452-1456）
- 文案固定模板，**刻意不拼错误原文**(:1220-1231)

### 1.4 请求级 vs 回合级：两套独立有序互补

- 请求级：挂 `agent/request-error` waterfall，**先 `await next()`**(:1908)，下游 retry 原样采纳(:1913)，无人接才自阶梯限速(:1920-1929)，优先 Retry-After，超 30s 封顶按终态(:1811-1816)
- 回合级：挂 `agent/error`(:2082) 与 `agent/status`(:2175)
- 源码注释：「请求级先重试，耗尽仍失败才续跑」(:1837)
- **两者计数互不相干**

### 1.5 宿主依赖与常量

- 监听：`agent/disposed`(:2744)、`agent/turn-stopping`(:2747)、`agent/request-error`(:2748)、`agent/error`(:2749)、`agent/status`(:2750)、`settings/document-updated`(:2686) —— **全部普通注册，未用 prepend**
- API：`agent.followup` / `agent.steer` / `agent.cancel`、`sessionProjections` 增量折叠（缺失回退 `session.snapshotEvents()`）、`svc.settings.describe/mutate`、`ctx.reflect.provide` 注册 Remote
- 常量：`REQUEST_RETRY_MAX=5`(:1310)、阶梯 `[2s,5s,10s,20s,30s]`(:1311-1317)、封顶 30000(:1320)、`CHAIN_RESUME_DELAY_MS_DEFAULT=60000`(:1307)

### 1.6 可迁移 / 必须裁剪

**可迁移**：配额按 kind 独立 + 成功即复位（连续语义）、quotaMemo 淘汰记忆、旧轮重放水位、链式冷却旁路、preFire 校验 + skipped 不计数、固定模板不拼错误原文

**必须裁剪**：`suspend`/`restorePending` 重连补发(:2000-2067)、Remote 七方法服务面(:2617-2623)、schedule/goal 让路判据、classifyFailure 宽匹配器（本插件已有自己的分类）、**14 项全 volatile 投影契约**（漏标 `.volatile()` 设置表单静默失效）

---

## 2. 参考插件 B：@zjjlivingfree/dsh-session-escalation@0.5.0（本地）

位置：`D:/my-projects/plugins/dsh-session-escalation/`

### 2.1 阈值度量

- `readOccupancy()` lib/index.js:243-257：取 `projectedTokens ?? pressureTokens` + `contextWindow`
- 来源：`ctx.sessionProjections.snapshot(session, ['contextPressure'])`(:247)
- 判定纯函数 `decide()` lib/policy.js:113-132，`ratio = occupancy / contextWindow`(:119)
- 默认 DEFAULTS policy.js:30-33：`thresholdRatio1=0.70`（L1 压缩）/ `thresholdRatio2=0.90`（L2 升级）

### 2.2 体积闸门（仅 full 模式）

index.js:363-368：`seedBytes = Σ(JSON.stringify(e).length+1)`、`estTokens = bytes/4`；`≥ thresholdRatio2 * contextWindow` 则**拒绝升级**但 `rec.escalations += 1`（消耗额度防刷屏）

### 2.3 fail-closed

- `occupancy`/`contextWindow` 为 null/0 → 不动作（policy.js:117 unknown-occupancy）
- agent 不空闲 → 不动作(:118)

### 2.4 换会话流程

- `ctx.agents.create(...)`（index.js:344, 402-411）
- `childId = \`session-${crypto.randomUUID()}\``(:371)
- **不传 parentAgent**（同级独立，:408-410）
- `workspace.attachSession(childId)`(:415-418)
- `continue = childAgent.followup(createUserMessage({ content:[{type:'text',text}], source:{ kind:'session-escalation', parentSessionId, boundarySeq } }))`(:450-453)

### 2.5 继承模式

| 模式 | 行为 |
|---|---|
| `summary`（默认，:350） | 不传 seed / inheritedEventCount，meta 不写 isSeeded(:377-381, :404) → **干净会话** |
| `full` | `seed = buildCompletedTurnSeed(events, boundary)`(:198-208, :359) + `meta.isSeeded=true`(:379) + `inheritedEventCount`(:404) |

### 2.6 归档

- `ctx.workspaceRegistry.archiveSession(session.id, { stopActivity: true })`(:329-341)
- 宿主原生**可逆**：不改 workspace 成员关系，进全局归档集可恢复（policy.js:45-47）
- **副作用**：无条件取消置顶 + `stopActivity` 发 `workspace/session-stop`（等价用户停止父会话运行中 turn，:323-327）
- 时机：**子侧落定后**才做父侧收尾(:459-460)，失败只 warn

### 2.7 交接摘要模板（index.js:448）

```
[交接] 你是第 {n} 次升级接棒会话。父会话：「{parentTitle}」({session.id})，交接时间 …
父会话历史未随本会话继承，细节可回查父会话…{continuePrompt}
```
- 父标题经 `sessionTitle.get(session)`(:440-445)
- 命名模板占位符：`{parent}{parentId}{n}{time}{date}{uuid8}`（policy.js:21-23, index.js:306-314）

### 2.8 预算与三锁

- Ledger(index.js:171-182)：`compactions / escalations / depth / lastDecision / busy / escalatedTo`（**宿主重启归零**，:171）
- 三锁：`escalateExhausted`（escalationsDone ≥ maxEscalatePerSession **或** chainDepth ≥ maxChainDepth，policy.js:121）、`rec.escalatedTo !== null` 让位(index.js:470)、`rec.busy`(:471, :474, :497)
- 耗尽 → `none('escalate-budget-exhausted')`(policy.js:125) / `none('compact-budget-exhausted')`(:130)
- 子会话获完整额度但 `depth = parent.depth + 1`(:424-425)，`maxChainDepth=16` 封顶整链(policy.js:10-11)

### 2.9 DEFAULTS 全表（在 cordis.patch.yml 注释）

`enabled / thresholdRatio1 / thresholdRatio2 / maxCompactPerSession=2 / maxEscalatePerSession=1 / maxChainDepth=16 / autoContinue / continuePrompt / renameOnEscalate / nameTemplate / archiveParentOnEscalate`

- 配置优先级：宿主 config > `DSH_ESCALATION_CONFIG` > DEFAULTS(index.js:152-169)
- `apply` 内 cfg 是**闭包常量**，改配置需重载插件(index.js:34)

### 2.10 宿主依赖

- 事件：`ctx.on('session/event')`，**仅 turn/end 且 `reason.kind==='completed'` 触发**(index.js:505-515)，**error/aborted 跳过**
- 服务：`sessionProjections.snapshot` / `compaction.compactNow`(busy 退避 :276-280) / `agents.create` / `sessions.get` / `sessionTitle.rename+get` / `workspaceRegistry.archiveSession+attachSession` / `agentDefaultModel.currentSelection` / `agentPresets.resolve+mount`

### 2.11 与本需求的冲突点

1. escalation 在 **error/aborted 跳过**(:508-509)，而能力 1「错误自动继续」恰在错误路径介入 → **若不加协调会双驱动**
2. 能力 1 若在占用超 L2 阈值时直接续跑，会**绕过 escalate-budget-exhausted 门禁**重复消耗额度
3. 两者都用 `followup` 投递，同一会话命中两条路径会收到**两条续作消息** → 需共享「已续作/已升级」标记做幂等去重

---

## 3. 宿主 API 亲验（本人实读 app.asar，★全部为本人亲验非转述）

> 解析口径：`hdrLen = b.readUInt32LE(12)`；`base = 16 + hdrLen`；叶子节点 `offset` 须 `Number()` 归一。

### 3.1 事件串存在性

| 事件 | 首次出现处 |
|---|---|
| `agent/error` | `/node_modules/@deepseek-ai/dsh-acp/lib/index.js` |
| `agent/turn-stopping` | `/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` |
| `agent/status` | `/node_modules/@agents-anywhere/dsh-bridge-next/lib/index.js` |
| `agent/disposed` | `/node_modules/@deepseek-ai/dsh-action-cards/lib/index.js` |

### 3.2 `agent/error` 的 payload 与触发时机（★关键）

emit 点：`@deepseek-ai/dsh-agent-loop/src/agent.ts:10505`（lib/index.js:24275）

```ts
/** Report one failure at its live boundary, then preserve it for driver containment. */
private throwError(error: unknown): never {
  const turn = this.phase.kind === 'running' ? this.phase.turn : this.phase.lastTurn
  const step = this.phase.kind === 'running' ? this.phase.step : 0
  this.dispatch.emit('agent/error', { turn, step, error })
  throw error
}
```
- payload = `{ turn, step, error }`
- 触发点 = **回合级边界**（一次 turn 彻底失败），**不是单次请求失败**
- 消费方示例：`ctx.on('agent/error', ({ agent, error }) => {...})`（dsh-acp/lib/index.js:41675）

### 3.3 `agent.followup` / `steer`（★能力 1 的落点）

`@deepseek-ai/dsh-agent-loop/lib/index.js:21679`

```js
followup(input) { this.send(input, 'next-turn', true) }
steer(input)   { this.send(input, 'next-step', true) }
inject(input)  { this.send(input, 'next-step', false) }
```
- `next-turn` = 下一回合；`next-step` = 同回合下一步
- `true` = wakeup
- `cancel(cause, { keepInbox })` 亦可用

### 3.4 `source.kind` 准入规则（★rescue 报告警告项，本人亲验坐实）

**迁移期规则** = `@deepseek-ai/dsh-session-format-v3-to-v4/src/sources.ts`（5184 字节）

```ts
const RENAMED_PRODUCERS = Object.freeze({
  'compact': 'compact-checkpoint',
  'tools-code-mode': 'ptc-mode',
  'tools-ptc': 'ptc-mode',
  'dsh-compaction-basic': 'compact-basic',
  '@deepseek-ai/dsh-system-prompt': 'runtime-context',
})
const RELEASED_SAME_NAME_PRODUCERS = new Set([
  'agent-instructions','session-reference','team-message','goal','skill-invocation',
  'skill-catalog','coordinator','subagent-report','subagent-settled','webhook',
  'agent-message','model-selection','plan-mode','time-context','tmux-context',
  'user-approval','repeat-tool-reminder','tool-cordis','cordis-host-runner',
  'tool-goal','tool-jobs','hooks-codex','hooks-claude-code','schedule','dsh-session-title-llm',
])
function producerKind(plugin, role) {
  if (plugin === '@deepseek-ai/dsh-system-prompt' && role === 'system') return 'system-prompt'
  const renamed = Object.hasOwn(RENAMED_PRODUCERS, plugin) ? RENAMED_PRODUCERS[plugin] : undefined
  if (renamed !== undefined) return renamed
  if (RELEASED_SAME_NAME_PRODUCERS.has(plugin)) return plugin
  return `plugin:${plugin}`        // ← 未知插件自动 producer-owned
}
export function rewriteV3MessageSource(source, seq, role) {
  const kind = source['kind']
  if (typeof kind !== 'string' || kind.length === 0) throw new SessionFormatError(...)
  if (kind === 'plugin') return rewritePluginSource(source, seq, role)
  return source                     // ← 非 'plugin' 的 kind 原样透传
}
```

**结论（本人亲验）**：
1. 迁移期只改写 `kind === 'plugin'` 的**旧包装**；其它 kind 一律原样透传
2. **当前 V4 格式包 `@deepseek-ai/dsh-session-format`（lib/index.js、src/catalog.ts、src/types.ts 等 9 文件）已无 source.kind 白名单校验** —— 扫 `kind.*(allow|valid|known|accept|support)` 零命中
3. `dsh-llm` 层消息 source 是**开放透传**：`source: { kind: 'model', ...input.source }`（dsh-llm/types/message.js 与 src/message.ts），llm 层不校验 kind 值
4. → **自定义 `source.kind`（如 `plugin:dsh-model-picker`）在当前宿主被安全接受**

### 3.5 能力 2 宿主前置（★全部亲验存在）

| API | 落点 |
|---|---|
| `ctx.agents.create(...)` | dsh-api-session-controller/lib/index.js（create 流程 :29529 起） |
| `workspace.attachSession(sessionId)` | dsh-api-session-controller/lib/index.js:31012 |
| `ctx.workspaceRegistry.archiveSession(id, {stopActivity:true})` | dsh-api-remotes/lib/client.js |
| `ctx.workspaceRegistry.archivedSessionIds` | dsh-api-session-controller/lib/index.js:31012 |
| `ctx.sessionProjections.snapshot(session, ['contextPressure'])` | @agents-anywhere/dsh-bridge-next/lib/index.js:245425 |
| `sessionTitle.get / .rename` | dsh-api-session-controller/lib/index.js |
| `compaction.compactNow` | dsh-command-compact/lib/index.js |
| `createUserMessage` | `@deepseek-ai/dsh-llm` 导出，dsh-agent-instructions/lib/index.js 转出 |
| `contextPressure` 投影 | **由 `@deepseek-ai/dsh-token-meter` 注册**（dsh-token-meter/src/usage-projection.ts） |

`contextPressure` 状态 schema（dsh-token-meter/src/usage-projection.ts）：
```ts
{ contextWindow?: number, pressureTokens?: number, surfaceTokens: number,
  sampledSurfaceTokens?: number, claim?: {...} }
```
宿主 API 摘要 schema（dsh-api-session-controller/lib/typert.host.js:15000）额外含 `projectedTokens`。

### 3.6 token-meter 是否默认启用（★能力 2 数据源前置）

- `@deepseek-ai/dsh-base/cordis.patch.yml:353-354`：
  ```yaml
  - id: token-meter
    name: '@deepseek-ai/dsh-token-meter'
  ```
- `@deepseek-ai/dsh-base/package.json` dependencies **含 `@deepseek-ai/dsh-token-meter`**
- → **宿主默认 profile（desktop）已加载 contextPressure 投影** ✅

### 3.7 本机 profile 现状（`C:/Users/17694/.dsh/profiles/desktop`）

`cordis.patch.yml` 中：
```yaml
- id: model-auto-select
  name: "@zjjlivingfree/dsh-model-picker"      # :319-320
- id: session-escalation
  name: "@zjjlivingfree/dsh-session-escalation"  # :914-915
  config:
    thresholdRatio1: 0.75
    thresholdRatio2: 0.85
    maxCompactPerSession: 3
    nameTemplate: "{parent}-{date}-{time}"
- id: session-rescue
  name: "@jayyuen66/dsh-session-rescue"          # :1001-1002
  config:
    chainResumeDelayMs: 15000
    maxResumes: 20
    continueCooldownMs: 20000
    maxContinues: 20
    unfinishedSteerMode: true
    maxUnfinished: 20
```
`package.json`：`@jayyuen66/dsh-session-rescue: 0.1.16`；`@zjjlivingfree/dsh-model-picker: link:D:/my-projects/plugins/dsh-model-picker`（本地链接）

**★ 关键事实：本机 profile 同时启用了 session-escalation 与 session-rescue —— 本需求要的两项能力已有两个独立插件在实现，双驱动冲突真实存在。**

---

## 4. 待拍板的设计张力（grilling 访谈输入，非结论）

1. **共存 vs 接管**：本插件独立实现（需幂等去重防双驱动）？还是完整实现并建议禁用另两个？还是只做模型层、把续作交给它们？
2. **能力 1 触发点**：回合级 `agent/error` → followup？请求级扩展 `agent/request-error`？两者结合？
3. **能力 1 是否连带切模型**：本插件本职是模型选择，续跑前是否先换模型？
4. **能力 2 阈值度量**：ratio（occupancy/contextWindow）还是绝对 token？阈值数值？
5. **能力 2 继承模式**：summary（干净会话 + 交接摘要）还是 full（seed 历史）？
6. **配额语义**：连续失败计数（成功即复位）还是整会话累计上限？
7. **归档副作用可接受性**：`archiveSession` 会 `stopActivity` 中断父会话运行中 turn。
