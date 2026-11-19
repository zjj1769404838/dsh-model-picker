# dsh-model-picker 0.1.8 重试链路根治设计（评审稿）

> 文档状态：**待用户审核**（base-memory 铁律二：先文档后执行）
> 规模定性：中型（改造集中在错误链 + 选择链 1–2 模块，新增可配字段，不新增模块/接口/数据表）
> 依据：RCA 只读取证（rca-facts 4 事实 + rca-event 5 事实）+ 用户 Q1–Q4 拍板 + 参考插件 `@jayyuen66/dsh-session-rescue@0.1.16` 调研

---

## 0. 一句话结论

**不是"机制没写"，是"机制被宿主重试链挡在门外，从未收到事件"。** 现有 `decideOnError` 的重试→切模型逻辑本身正确，但插件注册在 `agent/request-error` waterfall 链尾，宿主内置 `llm-retry` 在同一条链上、未耗尽前不调用 `next()`，插件前 1–5 次收不到事件；等事件终于传到，失败码又被顶层 `failure.code` 单一取法误判，导致分类错乱。0.1.8 要做的是**把插件从"链尾被屏蔽"改为"先问下游再自决"，并补齐失败码剥壳与永久/瞬时分类**，把 n 次重试与退避阶梯做成可配。

---

## 1. 背景与用户诉求

用户原话（m07950，逐字）：
> 继续优化这个插件，模型调用错误重试 参考一下 '@jayyuen66/dsh-session-rescue' 这个插件机制，重试n次错误再切换下一个模型继续，可用推翻一些之前的机制，保证插件真实可用性。

真实现象：模型调用失败后，期望的"重试 n 次再切下一个模型"没有发生，会话出现重试风暴或直接中断。

Q1 访谈用户答「都可能」= A 失败不切 / B 重试风暴 / C 切了横跳 / D 没生效 **全部纳入范围** → 做全链路根治，非单点补丁。

---

## 2. RCA 证据链（已取证，逐条可复核）

### 2.1 P0 根因：插件监听被宿主 llm-retry 屏蔽

| 层 | 事实 | 来源 |
| --- | --- | --- |
| 宿主 emit | 每次模型调用失败即 waterfall 派发 `agent/request-error`，payload = `{turn,step,provider,failure,retryPolicy,signal}`；仅 listener 返回 `{kind:'retry'}` 才同回合重发 | `dsh-agent-loop/src/agent.ts:555-565` |
| 注入 | `agent` 字段由 `dispatch.ts:114-119` 的 `fused()` 用 `({...payload, agent})` 自动注入 | 同上 |
| waterfall | 按注册先后、无优先级；上游不调 `next()` → 下游全跳过；register 默认 push（链尾） | `cordis/lib/index.js:904-919` |
| 宿主重试 | `llm-retry` 是同链 listener，`normal` 未耗尽时不调 `next()` → 插件（push 链尾）前 1–5 次收不到事件 | `dsh-llm-retry/src/index.ts:241-250` |
| 让路条件 | policy undefined / 码表外 / 次数耗尽 / Retry-After 超 maxDelay | 同文件 `:195/:213-215/:221/:229` |
| profile 配置 | `retryableCodes` = 6 类（EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT/MALFORMED_RESPONSE），默认 maxRetries=5 | `C:/Users/17694/.dsh/profiles/desktop/cordis.patch.yml:305-317` |
| 实测日志 | session-dd95057e 中 `llm/retry×5`+`retry-started×5`（递增退避 498/938/1939/3707/8710ms），**`agent/request-error` 0 次**、无 giveup/switch/cooldown | `.dsh-ops/panel/` ndjson |

**判定**：错误发生时宿主走自身 llm 层重试、未派发到插件监听的终态链；插件整条重试/切模型链路从未触发。

### 2.2 次因：失败码剥壳缺失（代码级确定）

- 当前 `src/index.ts:1079` 用 `const code = String(failure?.code ?? 'UNKNOWN')` 只取顶层。
- 参考插件 `host.js:1345/1355` 深度 3 递归剥 `AggregateError` / `cause` / `errors[]`；其 `:1349-1353` 注释实锤宿主 agent-loop 在工具结果写盘失败时会把原失败裹进 `AggregateError`，真正的 `.failure` 只在 `cause` 上。
- 后果：即便事件传到，非顶层包裹的失败一律被记为 `UNKNOWN`，`switchOnCodes` 白名单匹配的码也拿不到 → 误分类、误 giveup。

### 2.3 已证伪的假设

- **D（live 宿主没重载旧 lib）**：live 目录是 symlink → 项目目录；`package.json:3` version=0.1.7；`lib/index.js` mtime 12:08:11 晚于 `src/index.ts` 12:06:31；`var PLUGIN_VERSION="0.1.0"` 是硬编码常量而非构建落后。**排除**。

---

## 3. 用户拍板决策

| 问题 | 选项 | 用户决定 |
| --- | --- | --- |
| Q1 范围 | A 失败不切/B 重试风暴/C 切了横跳/D 没生效 | **全选**（"都可能"）→ 全链路根治 |
| Q2 重试次数与退避 | A 写死 B 可配 | **用户配置**：n 与退避阶梯做成可配，不写死 |
| Q3 错误分类 | A 引入永久/瞬时阶梯 B 维持现状 | **A**：完整分类 + 剥壳 |
| Q4 分工 | A 插件先自查 B 先问下游 | **B**：先问下游（waterfall 尾注册 + `await next()`，下游接了就原样采纳） |

---

## 4. 设计原则（来自参考插件实证，非臆想）

1. **waterfall 前置注册（prepend）+ 先问下游**（P0 真修复，两步缺一不可）：这里有一个必须厘清的关键——"先问下游"只有在自己位于链前时才有意义。当前插件用默认 push（链尾），实测 `agent/request-error` 0 次触发，证明宿主 llm-retry 在链前、未耗尽时不调 `next()`，事件根本到不了链尾；此时即便把 handler 改成"先 next()"，`next()` 也指向空链，无效。**因此 P0 真修复 =**：①插件 listener 改用 `ctx.on('agent/request-error', handler, { prepend: true })` 抢在 llm-retry 之前拿到事件（`prepend` 支持由 dsh-compaction-basic 的 `prepend:true` 实证，cordis `register` unshift 语义坐实）；②handler 进来先 `await next()`，让下游 llm-retry 先表达意愿——下游返回 `{kind:'retry'}` 则原样采纳、不叠加，下游无结果（耗尽/码表外）时插件才按自己的 n 次阶梯自决。只做②不做①= 空谈；只做①不做②= 与宿主重试打架。
2. **永久/瞬时分类阶梯**（`classifyFailure`）：永久码一票否决（`CONTEXT_WINDOW_EXCEEDED`/`AUTH`/`INVALID_CREDENTIAL`/`MISSING_CREDENTIAL`/`INVALID_REQUEST`/`INVALID_ARGS`/`NO_ADAPTER`/`INVALID_MODEL_CONTEXT`/`INVALID_PREPARED_CALL`）→ QUOTA 按证据分（429/Retry-After/限流措辞=瞬时，余额耗尽=永久）→ 401/403/402 永久 → 显式瞬时码（`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`EMPTY_RESPONSE`）+ HTTP 408/425/429/5xx 瞬时 → 未知保守判永久。
3. **剥壳取失败面**（`failureFaceOf`）：沿 `cause` + `errors[]` 递归深度 3，逐位守卫 `code/message/status/text/retryAfterMs`。
4. **Retry-After 优先**：退避先取 `retryAfterMs`，否则按可配阶梯 `backoffMs[attempt]`。
5. **hostOwnsRetry 避免等待叠加**：宿主显式码表内且已重试耗尽的错误，插件直接切模型（不再按 n 次等待）；码表外才按 n 次阶梯重试。→ 解决 Q4×Q2 张力（宿主已重试 5 次，插件再等 n 次会造成长延迟/风暴）。

---

## 5. hostOwnsRetry 判据（已由 rca-event 二轮逐字坐实，定稿）

rca-event 二轮把 4 个硬依赖全部闭环（证据源均为 asar 静态逐字，与注册顺序无关）：

- **`payload.retryPolicy` 恒有值**：emit 端 `agent-loop/src/agent.ts:561` 传 `retryPolicy: preparedCall?.retryPolicy`；`dsh-llm/lib/index.js:1983` 注册时 `providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, ...)` 无条件补默认，`:2355` prepare 时透传 → 插件 listener 读到的 policy 恒非 undefined。`resolveRetryPolicy(undefined)`（`retry-policy.js:89-96`）返回完整字段：`mode/maxRetries/retryableCodes/backoff{initialDelayMs,maxDelayMs,jitterRatio}`。
- **默认码表**：`DEFAULT_RETRYABLE_CODES` = `[EMPTY_RESPONSE_CODE,'RATE_LIMIT','SERVER','TIMEOUT','TRANSPORT']`（`:16-22`），`DEFAULT_MAX_RETRIES=5`（`:12`）。用户 profile 配的额外含 `MALFORMED_RESPONSE`（`cordis.patch.yml:307-317`）。
- **session 投影可读已重试次数**：宿主每次重试 `agent.session.append('llm/retry', {provider,mode,policyKey,retry,maxRetries,delayMs,failure})`（`llm-retry/src/index.ts:166-185`）；读取用 `llmRetryProjectionHandle.stateOf(agent.session)[JSON.stringify([provider,policyKey])].retry`（`:217-221`）；松耦合替代：遍历 `agent.session` 事件过滤 `type==='llm/retry'` 且 provider/policyKey 匹配取最大 `retry`。
- **无死结**：宿主耗尽放行时（`:221 return next()`）payload.retryPolicy 仍完整携带，插件同时拿得到码表 + 耗尽状态。

**定稿判据**（保守加 `mode==='normal'` 守卫，防 always 模式无 `retryableCodes/maxRetries` 时 `.includes` 崩溃）：

```
policy = payload.retryPolicy
code   = failureFaceOf(payload.failure) 的 code
hostOwns =
  policy?.mode === 'normal'
  && policy.retryableCodes?.includes(code)
  && hostRetryCount < policy.maxRetries
```

- `hostOwns === true` → 宿主会接手，插件 `await next()` 后原样采纳其 `{kind:'retry'}`，不叠加。
- `hostOwns === false`（码表外 / 宿主已耗尽 / always 模式）→ 插件接手，按第 7 节 n 次阶梯自决。
- 判据排序：① `policy.retryableCodes.includes(code)`（最稳，反映当前 provider 实际生效策略）→ ② session 投影 `retry >= maxRetries`（区分耗尽放行）→ ③ 无法判定时保守按码表外处理（插件自行 n 次，但受总量上限约束）。
- 备注：本宿主 payload 已带实际生效策略，无需像 session-rescue 走 describe namespace 投影（那条路只为识别"用户显式配置"）；若将来要区分显式/默认配置，再对比码表是否等于 `DEFAULT_RETRYABLE_CODES`。

> **【0.1.8 实现澄清 · 蓝军复核后补】** 上述定稿判据是 rca-event 二轮的**理论完整式**（含第 3 项 `hostRetryCount < policy.maxRetries`）。最终落码采用更简单的两步地基：listener `prepend` + `await next()`，`next()` 的返回值本身就是"宿主是否接手"的精确信号——下游返回 `{kind:'retry'}` 即宿主已接手（含"码表内且未耗尽"的情形），插件原样采纳；下游无结果即宿主耗尽/码表外放行，插件才自决。因此实现里 `src/index.ts` 的 `hostOwns` 只保留前两项（`mode==='normal' && retryableCodes.includes(code)`），**第 3 项耗尽判据的语义已由 `await next()` 承担**，不再在插件里重算 session 投影的 retry 次数。这是"判据藏进 next() 语义"的收敛，行为与定稿判据等价，且避免重复读取宿主 session。若将来移除"先问下游"地基或改为外部直调 handler，必须补回第 3 项耗尽判据，否则会在宿主仍重试时误切模型。

---

## 6. 逐文件改动方案

### 6.1 `src/core.ts`

| 位置 | 改动 |
| --- | --- |
| `:16` | `PLUGIN_VERSION` 历史遗留 `'0.1.0'` → **待审核**：是否锁步改 `'0.1.8'`（无测试依赖；改则不改功能，仅消除版本漂移） |
| `:20-30` `AutoSelectConfig` | 新增 3 个可选字段：`requestRetryEnabled?: boolean`、`requestRetryMax?: number`、`requestRetryBackoffMs?: number[]`（退避阶梯） |
| `:132-155` `DEFAULT_CONFIG` | 补默认：`requestRetryEnabled=true`、`requestRetryMax=3`、`requestRetryBackoffMs=[2000,5000,10000]`；retention 现有 `maxRetries/retryDelayMs/switchOnCodes` 保持兼容 |
| 新增函数 | `failureFaceOf(failure)` 剥壳；`fieldsOf(face)` 取 `{code,status,retryAfterMs,text}`；`classifyFailure(face)` → `'permanent'|'transient'|'unknown'`；`requestBackoffMs(attempt, face, cfg)` Retry-After 优先 |
| `:968-1040+` `decideOnError` | 新版：永久 → 直接 switch（不 retry）；瞬时 + hostOwnsRetry → 直接 switch（不叠加）；瞬时 + !hostOwnsRetry → retry（attempt<requestRetryMax）后 switch；unknown → switch（保守）；保留现有 aborted/disabled/cooldown/switchOnCodes 白名单 giveup 语义（向后兼容） |

### 6.2 `src/index.ts`

| 位置 | 改动 |
| --- | --- |
| `:1079` | `code` 取法由顶层 `failure.code` 改为 `failureFaceOf` + `fieldsOf`；把 `face`/`classification`/`retryAfterMs` 传进 `decideOnError` |
| `:1074-1205` `handleRequestError` | 接入新分类与 hostOwnsRetry 判据；retry 分支用 `requestBackoffMs` 代替固定 `retryDelayMs`；保留 `state.attempts` 计数（giveup/switch 归零） |
| `:2237-2257` listener | **P0 修复（两步缺一不可）**：①注册改 `ctx.on('agent/request-error', handler, { prepend: true })` 抢在 llm-retry 前拿事件；②handler 先 `await next()` 让下游优先 → 下游返回 retry 则原样采纳 → 下游无结果（耗尽/码表外/异常）时按第 5 节 hostOwnsRetry + 第 7 节 n 次阶梯自决。`prepend` 支持由 dsh-compaction-basic 实证、cordis `register` unshift 语义坐实 |
| `:93-133` Config schema | 新增 3 字段（全 `volatile`） |
| `:1364-1383` `CONFIG_FIELDS` | 新增可配项（number 类型 n；text 类型退避阶梯逗号分隔） |
| `:1434-1444` `configView` / `:1452-1570` `coercePatch` | 新增字段的读取与 coerce 分支 |

### 6.3 `src/client/index.ts`

| 位置 | 改动 |
| --- | --- |
| 设置页字段区 | 新增 `requestRetryEnabled`（布尔）、`requestRetryMax`（number）、`requestRetryBackoffMs`（text，逗号分隔）的渲染与保存；复用现有 `:1343-1347` text 渲染与 `draftOf/stage` |
| `:1795-1800` `QUIET_FIELDS` | 确认新字段不被错误渲染到"其他"区 |

### 6.4 测试

- 新增契约/单测覆盖：**剥壳**（AggregateError/cause 深度 3）、**分类**（永久/瞬时/QUOTA/unknown 各档）、**waterfall 先问下游**（下游 retry 时插件不叠加）、**hostOwnsRetry**（码表内直接切/码表外按 n 次）、**退避 Retry-After 优先**。
- 保持现有 `apply(ctx,{maxRetries:1,retryDelayMs:0,...})` 夹具兼容（不破坏 4 个 smoke）。
- 版本锁步：若采纳 6.1 的 `PLUGIN_VERSION` 改动，产物 banner 需同步。

---

## 7. 用户可配字段

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `requestRetryEnabled` | boolean | true | 是否启用插件级请求重试 |
| `requestRetryMax` | number | 3 | n 次：插件自行重试上限（码表外错误） |
| `requestRetryBackoffMs` | number[] | [2000,5000,10000] | 退避阶梯，超出长度取末值；Retry-After 优先 |

- 现有 `maxRetries/retryDelayMs/switchOnCodes` 保留向后兼容，优先级：新字段存在时以新字段为准。

---

## 8. 验收标准

1. **门禁**：`test:all` 全绿；契约三模式（ok/no-adapter/transport-fail）全绿；`rebuild` exit 0，产物与 src 锁步。
2. **行为契约**（新增测试逐条通过）：
   - 构造 `AggregateError(cause=failure.code='RATE_LIMIT')` → 插件识别为瞬时码而非 `UNKNOWN`。
   - 下游 listener 返回 retry → 插件原样采纳、自身 retry 计数不增加。
   - 宿主码表内瞬时码 → 插件直接 switch，不进入 n 次等待。
   - 码表外瞬时码 → 插件按 n 次阶梯 retry，第 n+1 次 switch。
   - 永久码（如 `AUTH`）→ 直接 switch，0 次 retry。
   - Retry-After 存在 → 退避取该值而非阶梯。
3. **真实路径**：用可复现的失败夹具驱动 `agent/request-error`，确认插件 listener 实际被调用（P0 修复验证），不再出现"0 次触发"。
4. **审核分离**：每步产 `docs/review/<环节>-<时间>.md`，审查者只读、修复独立。

---

## 9. 风险与披露

- **与宿主 llm-retry 的叠加**：head-to-head 由"先问下游"消解；极端情况下宿主与插件都判 retry 会叠加等待，用总量上限兜底。
- **判据不确定性**：若 rca-event 二轮确认 `retryPolicy` 恒有值且含码表，`hostOwnsRetry` 用 `payload.retryPolicy.retryableCodes` 精确判定；若否，fallback 到 session 投影或保守策略（见第 5 节定稿）。
- **不改全局配置**：profile `cordis.patch.yml` 的宿主 retryPolicy 不动；本次仅改插件自身逻辑，避免越权。
- **发布需当次独立授权**：push/publish 属不可逆操作，落码门禁通过后单独向用户请示，不沿用旧授权。
- **live 重载**：插件改动须用户重载 live 宿主才生效（symlink 已确认，无需重装，仅重启/Reload）。

---

## 10. 下一步

1. rca-event 二轮回报 → 定稿第 5 节 hostOwnsRetry 判据。
2. 本文交用户审核（base-memory 每步审核）；审核通过后进入落码。
3. 落码 → rebuild → 门禁全绿 → 产审核报告 → **请示用户授权** → git 面板 push + npm publish 0.1.8 → packument 轮询 + tarball 逐字节终验。
