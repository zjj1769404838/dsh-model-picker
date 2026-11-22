# dsh-model-picker 0.1.9 设计文档：能力 1「错误自动继续」+ 能力 2「上下文阈值升级会话」

> 需求来源（用户 m08644 逐字）：「深度研究插件开源@jayyuen66/dsh-session-rescue及我本地的dsh-session-escalation插件，在我当前的插件中加入 1.错误自动继续 2.上下文达到阈值先创建新会话继续任务且归档旧会话」
> 追加需求（用户 m08959 逐字）：「1.需要将设置页面重新设计布局才行，模型列表改为小卡片展示，不同设置改为tab显示；2.注入侧边栏入口」
> 事实依据：见 `docs/research-0.1.9-双能力.md`（全部为本人实读/亲验）。
> 决策依据：四轮 grilling 访谈 + 两轮追加需求访谈全部拍板（见 §2 决策表、§9、§10）。
> 状态：**待用户审核** —— 审核通过后才落码。

---

## 1. 一句话结论

在 0.1.8「重试 n 次 → 切模型」之上，叠加两层兜底：**回合级错误 → 固定模板续作（能力 1）**、**上下文占比达阈值 → 建干净新会话 + 交接摘要 + 归档父会话（能力 2）**；两个能力默认关闭，配置进本插件既有设置页。

---

## 2. 决策表（用户逐条拍板）

| # | 决策点 | 拍板结果 |
|---|---|---|
| Q1 | 与已装 rescue/escalation 的关系 | **本插件接管**；改 profile 禁用另两个 |
| Q2 | 能力 1 触发层 | **请求级 + 回合级结合**：请求级先让宿主重试（0.1.8 现有），耗尽后由回合级 `agent/error` 续作 |
| Q3 | 续作前是否切模型 | **仅在模型/端点不可用时切** |
| Q4 | 续作配额 | **连续 3 次 + 整会话 10 次** 双上限（均可配） |
| Q5 | 能力 2 阈值档位 | **只做升级档，阈值可配默认 0.85** |
| Q6 | 新会话继承模式 | **summary：干净会话 + 交接摘要** |
| Q7 | 归档副作用 | **带 `stopActivity` 强制归档** |
| R2-1 | 旧插件处理 | **改 profile 禁用** rescue + escalation |
| R2-2 | 交接内容 | **标准交接头 + 可配续作指令**（不拼父会话正文） |
| R2-3 | 归档与运行中 | **带 stopActivity 强制归档**（父会话正在跑也中断） |
| R2-4 | 能力 1 续作内容 | **固定模板，不拼错误原文** |
| R2-5 | 能力 2 配额 | **整会话 1 次 + 链深 3 层** |
| R2-6 | 新会话模型 | **沿用父会话当前模型**（provider/model/reasoningEffort） |
| R3-1 | 跳转新会话 | **HTTP 拉取**：node 半边写待跳转队列 → client 半边拉取后 `ctx.uiWorkspace.openSession(id)` |
| R3-2 | 能力 2 触发时机 | **回合完成时（turn/end + reason.kind==='completed'）+ 会话空闲时** |
| R3-3 | 占用度量 | **`projectedTokens` 优先，回退 `pressureTokens`**；分母 `contextWindow` |
| R3-4 | 配置面 | **全进现有设置页「失败重试」区块** |
| R3-5 | 默认开关 | **两个能力默认关** |
| R4-1 | 跳转实现路径 | **HTTP 拉取** |
| R4-2 | 能力 2 执行序 | **对齐 escalation**：建新会话 → 投交接 → 归档父会话 → 跳转 |
| R4-3 | 能力 1 参数 | **连续 3 次 + 整会话 10 次** |
| R4-4 | 不重试判定 | **复用 0.1.8 现有分类器**（permanent/unknown 不续作） |
| R4-5 | 切模型条件 | **探测判定不可用才切** |
| U1 | 侧边栏入口形态 | **面板图标列新增图标 → 点开占主区域整页**（宿主 `sidebar.panellist` + `main` keyed 槽，与宿主「插件」图标同机制） |
| U2 | 面板内容 | **完整设置页（tab 化）搬进侧边栏面板** |
| U3 | 设置页 tab 数 | **三个 tab：模型 / 策略 / 双能力** |
| U4 | 分组编辑位置 | **模型 tab 顶部工具条**（新建分组 / 分组模式切换 / 分组名单），分组名写在卡片上 |
| U5 | 宿主旧「模型自动选择」区块 | **保留完整视图 + 增加入口**：旧区块继续渲染完整三 tab 配置视图（同 `mountSettingsForm`），另加「在侧边栏面板中打开」按钮直达侧边栏面板（详见 §10.3；口径于 2026-11-23 由用户拍板追认） |

---

## 3. 能力 1：错误自动继续

### 3.1 触发链

```
模型调用失败
  └─ 请求级 agent/request-error（0.1.8 已有，prepend）
       ├─ 下游宿主 retry → 原样采纳（不重复）
       └─ 下游耗尽 → 插件自决：
            ├─ 分类 transient 且未超 0.1.8 重试预算 → retry（重试 n 次）
            ├─ 超预算 → 切模型 → 仍失败
            └─ 切模型后仍失败 → 回合级 agent/error 触发本能力
                 └─ agent/error（payload {turn, step, error}）
                      ├─ aborted/interrupted → 不续作
                      ├─ 分类 permanent / unknown → 不续作（复用现有分类器）
                      ├─ transient 但 hostOwns（宿主码表内已耗尽）→ 不续作
                      └─ transient 且码表外 + 配额未超 → 续作
```

### 3.2 续作动作

1. **判定不可用才切模型**：仅当错误指向模型/端点不可用（`NO_ADAPTER` / `UPSTREAM_4xx` / 连接类错误）时，调用现有选型逻辑切到下一个健康模型；否则沿用当前模型。
2. **投递固定模板续作消息**（不拼错误原文）：
   ```
   上一次执行因错误中断，已自动恢复。请继续未完成的任务。
   ```
   经 `agent.followup({ id, role:'user', content:[{type:'text',text}], source:{kind:'plugin:dsh-model-picker'} })`。
   - `source.kind` 用 producer-owned 形式 —— 本人已亲验当前宿主 V4 格式包**无 source.kind 白名单**，`rewriteV3MessageSource` 只改写 `kind==='plugin'` 的旧包装，其它 kind 原样透传（详见研究报告 §3.4）。
3. **配额**：连续计数（同类型错误连炸 3 次才放弃）+ 整会话累计上限 10 次，任一触顶即停止续作。**成功一次即清零连续计数**（连续语义，抄 rescue 的 `onSuccess` 只清 resume/continue 计数）。

### 3.3 关键判据与 fail-closed

- `aborted` / `interrupted` / 用户主动 abort → **绝不续作**
- 错误分类复用 0.1.8 已有 `classifyFailure`（permanent/transient/unknown）+ `hostOwns` 判定，不另造分类器
- 每次续作前校验：会话仍存在、agent 仍活着、该会话本轮未被处理过（防旧轮重放 —— 抄 rescue 的 `noteTurnHandled` 水位思路）

---

## 4. 能力 2：上下文阈值升级会话

### 4.1 判定

- **度量**：`ctx.sessionProjections.snapshot(session, ['contextPressure'])` → `projectedTokens ?? pressureTokens`，分母 `contextWindow`
- **fail-closed**：`occupancy` 或 `contextWindow` 缺失/0 → **不动作**（不猜、不用历史值兜底）
- **阈值**：默认 `0.85`（可配）
- **触发时机**：① `session/event` 且 `event.type === 'turn/end'` 且 `reason.kind === 'completed'`；② 会话转空闲时
  - **error / aborted 的回合一律不评估** —— escalation 踩过的坑：2026-11-18 事故中 provider transport error 与用户 abort 都触发了升级评估，是连环升级的放大器
- **链深**：整条升级链最多 3 层；每会话只升级 1 次（新会话获完整额度但 `depth = parent.depth + 1`）

### 4.2 执行序（对齐 escalation 已验证的顺序）

```
① 建新会话
   ctx.agents.create({
     sessionId: `session-${crypto.randomUUID()}`,
     meta: { cwd?, agentPreset? },        // 不设 parentSession（同级独立）
     agentOptions: { provider, model, reasoningEffort? },  // 沿用父会话当前模型
     setup: presets.mount(...)            // preset mount 配方
   })
② 投递交接消息（标准交接头 + 可配续作指令）
   childAgent.followup(createUserMessage({
     content: [{ type:'text', text }],
     source: { kind:'plugin:dsh-model-picker', parentSessionId, boundarySeq: null }
   }))
③ 归档父会话（stopActivity:true）
   ctx.workspaceRegistry.archiveSession(parentId, { stopActivity:true })
④ 写入待跳转队列 → client 半边拉取后 ctx.uiWorkspace.openSession(childId)
```

**交接文本模板**（不拼父会话正文，不含错误原文）：
```
[交接] 你是第 {n} 次升级接棒会话。父会话：「{parentTitle}」({parentId})，交接时间 {date} {time}。
父会话历史未随本会话继承，细节可回查父会话（session {parentId}）。
{continuePrompt}
```

### 4.3 fail-closed 与副作用披露

- `agents.create` 不可用 → 不动作
- `sessionProjections` 不可用 → 全能力停用
- 归档失败（`WorkspaceArchiveError`）→ **只 warn，不回滚已建的新会话**（增强项不阻断主流程）
- `archiveSession(id, {stopActivity:true})` 会**无条件中断父会话正在跑的 turn**（等价用户手动停止）—— 用户已知并接受（与 escalation 同款权衡）
- 归档是宿主原生**可逆**能力（`unarchiveSession` 可恢复）

---

## 5. 逐文件改动

### 5.1 `src/core.ts`

| 改动 | 内容 |
|---|---|
| `PLUGIN_VERSION` | `'0.1.8'` → `'0.1.9'` |
| `AutoSelectConfig` | 新增：`autoResumeEnabled?`、`autoResumeConsecutiveMax?`、`autoResumeSessionMax?`、`autoResumeContinuePrompt?`、`escalateEnabled?`、`escalateThresholdRatio?`、`escalateMaxChainDepth?`、`escalateContinuePrompt?`、`escalateArchiveParent?`、`escalateRenameChild?` |
| `DEFAULT_CONFIG` | 全部新增字段给默认：`false` / `3` / `10` / `'继续未完成的任务'` / `false` / `0.85` / `3` / `继续未完成的任务'` / `true` / `true` |
| 新增纯函数 | `decideResume(request)` —— 续作决策（纯函数，可测）；`decideEscalate(input)` —— 升级决策（纯函数，可测） |
| `resolveConfig` | 显式透传全部新字段（**0.1.8 已踩过这个坑：忘了透传会在配置加载后丢失**） |

### 5.2 `src/index.ts`

| 改动 | 内容 |
|---|---|
| import | 新增 core 的两个纯函数 |
| 监听 | 新增 `agent/error`（回合级续作）、`session/event`（turn/end 升级判定） |
| 会话服务解析 | 新增 `resolveSessionServices(ctx)`：动态解析 `agents` / `workspaceRegistry` / `sessionProjections` / `sessionTitle` / `agentPresets` / `agentDefaultModel`，**全部 try/catch + 缺失即降级**（抄本插件 `resolveSessionApi` 的既有模式） |
| `handleAgentError` | 新函数：回合级续作判定 + 投递 |
| `evaluateEscalation` | 新函数：占用读取 + 阈值判定 + 建会话 + 交接 + 归档 |
| 账本 | 新增 `resumeLedger` / `escalationLedger`（进程内 Map，抄 escalation 的 Ledger 模式；**宿主重启归零**，须在文档披露） |
| HTTP 服务 | 新增 `GET /pending-navigation` → 返回待跳转的 sessionId 队列（client 半边拉取） |
| `Config` schema | 新增字段（**全部 `.volatile()`** —— 漏标会导致设置页静默失效，抄 rescue 的教训） |
| `CONFIG_FIELDS` | 新增对应项（boolean/number/text），归入现有「失败重试」区块 |
| `coercePatch` | 新增 text 分支对逗号分隔数字/布尔串的解析 |
| `configView` | 下发新字段 |

### 5.3 `src/client/index.ts`

| 改动 | 内容 |
|---|---|
| 轮询 | 启动后每 1s 拉 `GET /pending-navigation`，有目标则 `ctx.get('uiWorkspace').openSession(id)` 并清队列（**幂等**：同 id 只跳一次） |
| 设置页 | **整体重构为三个 tab**（模型 / 策略 / 双能力）+ 模型列表改小卡片；详见 §9 |
| 侧边栏面板 | **注册 `sidebar.panellist` 图标 + `main` keyed 面板**（点开占主区域整页）；详见 §10 |
| 旧区块 | 宿主「模型自动选择」区块**保留完整视图 + 增加侧边栏入口**（「在侧边栏面板中打开」按钮）；详见 §10.3 |
| 跳转 | 旧齿轮入口（`data-mas-settings-toggle`）与旧区块入口都改为跳转到侧边栏面板的对应 tab |

### 5.4 测试

- `scripts/test-auto-select.mjs`：新增 `decideResume` / `decideEscalate` 纯函数用例（正常/边界/fail-closed）
- `scripts/test-client-dom.mjs`：
  - 设置页新字段渲染断言
  - **三个 tab 断言**：`data-mas-tab` 恰好 3 个、切换后对应面板内容出现、初始态为「模型」tab
  - **小卡片断言**：模型项渲染为 `data-mas-model-card`（且仍带 `data-mas-model-row` 以兼容既有断言）、卡片内含入组下拉 `data-mas-assign` 与 `data-mas-field` 系列输入
  - **侧边栏面板断言**：注册了 `sidebar.panellist`（id 唯一）+ `main`（key 与 panellist id 相同）
- `scripts/smoke-*.mjs`：确认既有夹具不受影响（`apply(ctx,{maxRetries:1,retryDelayMs:0})` 兼容）

---

## 6. 配置项（全部进「策略」tab 与「双能力」tab）

| key | 类型 | 默认 | 所在 tab | 说明 |
|---|---|---|---|---|
| `autoResumeEnabled` | boolean | `false` | 双能力 | 能力 1 总开关 |
| `autoResumeConsecutiveMax` | number | `3` | 双能力 | 同类型错误连续续作上限 |
| `autoResumeSessionMax` | number | `10` | 双能力 | 整会话累计续作上限 |
| `autoResumeContinuePrompt` | text | `继续未完成的任务` | 双能力 | 续作指令（接在固定模板后） |
| `escalateEnabled` | boolean | `false` | 双能力 | 能力 2 总开关 |
| `escalateThresholdRatio` | number | `0.85` | 双能力 | 上下文占比阈值 |
| `escalateMaxChainDepth` | number | `3` | 双能力 | 升级链最大层数 |
| `escalateContinuePrompt` | text | `继续未完成的任务` | 双能力 | 交接续作指令 |
| `escalateArchiveParent` | boolean | `true` | 双能力 | 是否归档父会话 |
| `escalateRenameChild` | boolean | `true` | 双能力 | 是否给新会话命名 |

> 0.1.8 已有的 `maxRetries` / `requestRetryEnabled` / `requestRetryMax` / `requestRetryBackoffMs` 留在「策略」tab 的「失败重试」区块；`enabled` / `defaultModel` 留在「策略」tab 顶部；`groupMode` / `probeIntervalMin` / `groupByKind` / `customGroups` 移到「模型」tab（分组编辑见 §9.2）。

---

## 7. 验收标准

1. `npm run test:all` 全绿（含新增用例）
2. 契约三模式（ok / no-adapter / transport-fail）全绿
3. rebuild exit0，产物 banner `0.1.9`，版本四处锁步
4. **行为契约**：
   - 能力 1：transient 码表外错误 → 连续续作，连续 3 次触顶停止；permanent / unknown / aborted → 零续作
   - 能力 1：单次成功即清零连续计数
   - 能力 2：`projectedTokens ?? pressureTokens` 占比 ≥ 阈值 → 建新会话 + 交接 + 归档
   - 能力 2：占用数据缺失 → 零动作（fail-closed）
   - 能力 2：error/aborted 回合 → 零升级
   - 能力 2：链深 3 层触顶 → 零升级
   - 能力 2：只归档本插件自己发起的升级
5. **界面契约**（新增）：
   - 设置页恰好 3 个 tab（`data-mas-tab`），默认选中「模型」
   - 模型项渲染为小卡片（`data-mas-model-card`），且仍带 `data-mas-model-row` / `data-mas-assign` / `data-mas-field`
   - 切换 tab 只改可见性，三份 DOM 常驻（`[data-mas-field="maxRetries"]` 始终可取）
   - 侧边栏注册了 `sidebar.panellist`（id 唯一）+ `main`（key 相同）；宿主未声明这两个槽时静默降级
   - 齿轮入口仍唯一（`data-mas-settings-toggle`），点击跳到侧边栏面板「策略」tab
6. **真机验证**（用户重载插件后）：错误续作真实触发、新会话真实建立并跳转、侧边栏图标可见且点开显示三 tab

---

## 8. 风险与残留缺口

| # | 风险 | 缓解 |
|---|---|---|
| R1 | **真机 prepend/新链路未验证**：本插件已在 0.1.8 验证过 prepend，但 `agent/error` + `session/event` 两条新链路未经真机 | 落码后由用户重载实测；静态实证已坐实事件与 API 存在 |
| R2 | **账本进程内、宿主重启归零** | 抄 escalation 同款权衡；重启后计数清零 = 保守方向（不会因旧计数误停） |
| R3 | **`stopActivity:true` 会中断父会话运行中的 turn** | 用户已知并接受；仅本插件自己发起的升级才归档 |
| R4 | **能力 2 会自动建会话 + 归档，用户可能不适应** | 默认关闭；设置页有开关与说明 |
| R5 | **HTTP 拉取跳转有 ~1s 延迟** | 用户已接受 |
| R6 | 客户端 `openSession` 是 client 半边 API，node 半边不能直接调 | 用 HTTP 队列跨半边；已在设计上确认 |
| R7 | 与 rescue/escalation 的双驱动 | 改 profile 禁用另两个（R2-1 已拍板），根治 |
| R8 | 0.1.8 已提交未推送的 commit `167a671` 仍在本地 | 0.1.9 会叠在其上；发布时一次性推 0.1.8+0.1.9 |
| R9 | **三 tab 同时渲染 → DOM 体积翻倍**（模型卡片多时更明显） | 卡片网格按需分批渲染（先渲染首屏 N 张，滚动到底再补）；hidden 用 `hidden` 属性而非 `display:none` 重建 |
| R10 | **`main` keyed 槽占用风险**：`key` 撞宿主已占用键会**替换对方占位者**（契约 replaceRisk: shadows-shipped-ui） | 用自有的 `model-picker` 键（实测 `conversation` 被宿主占用，其余开）；落码前再查一次 `main` 槽 occupants |
| R11 | **面板图标依赖 `dsh-client-ui-primitives` 图标包**：该包在本插件的 client 依赖里不一定可用 | 拿不到就退化内联 SVG 字形；注册失败不抛错（保持插件其余功能可用） |
| R12 | **旧区块降级后，用户若只在宿主设置页里找配置会觉得「配置不见了」** | 旧区块保留启用总开关 + 明确的「在侧边栏面板中打开」按钮 + 一行说明；不做静默删除 |

---

## 9. 设置页重构：小卡片 + 三个 tab

> 需求来源（用户 m08959 逐字）：「需要将设置页面重新设计布局才行，模型列表改为小卡片展示，不同设置改为tab显示」
> 触发原因：现状是**单页顺读三步**（分组 → 模型 → 运行策略），且模型行内挤着两个下拉 + 一个勾选 + 一个按钮，行过密、纵向过长。

### 9.1 布局骨架

```
┌─ sticky 操作条（重新获取 / 放弃 / 保存 / 状态行）─────────────────┐
├─ tab 栏： [模型] [策略] [双能力]                                │
├────────────────────────────────────────────────────────────────┤
│  三个 tab 的内容区同时挂载；未选中的用 hidden 隐藏（见 §9.5）      │
└────────────────────────────────────────────────────────────────┘
```

- tab 栏用宿主设置页视觉规范（14px 标签、选中态主色下划线），不用胶囊按钮，避免与宿主其它 section 风格打架
- **三个 tab 同时渲染、切换只改 `hidden` 与选中态**（§9.5 (a)：既有断言零改动是红线）
- 保留 sticky 操作条在 tab 栏之上 —— 改完任意 tab 都能直接保存
- 折叠态（面板窄）tab 栏横向可滚动，不换行

### 9.2 「模型」tab

| 区域 | 内容 |
|---|---|
| 顶部工具条 | 新建分组 / 分组方式切换（手工 ↔ 自动）/ 分组名单下拉 / 搜索框 / 「显示全部 N 个」 |
| 分组小节 | 每个分组一个小标题 + 该组的卡片网格；`__unavailable__`（不可调）与 `__infra__`（探测失败）两个虚拟分组同此结构 |
| 卡片网格 | 自适应列（`repeat(auto-fill, minmax(220px, 1fr))`），窄栏降为单列 |

**模型卡片内容**（每张卡）：

| 位置 | 内容 |
|---|---|
| 标题行 | 模型名 + 类型徽标（多模态/纯文本）+ 免费徽标 + 不可用/已隐藏状态徽标 |
| 副标题 | 来源 · 上下文大小（沿用现有 `metaChip` 口径） |
| 底部控件行 | 分组下拉（`data-mas-assign`，卡上直接选组）+ 推理等级下拉（`data-mas-effort-config`）+ 展示勾选（`data-mas-flag='hidden'`）+ 测试按钮（`data-mas-probe`） |

- 卡片控件保持**四件套全在卡内**（不再需要横向滚动），这是改卡片的直接收益
- 卡片上保留 `data-mas-model-row` 属性（既有测试断言依赖），另加 `data-mas-model-card` 供新断言
- 「测试全组」按钮从分组标题移到分组小节右上角（卡片网格里没有位置放它）

### 9.3 「策略」tab

现有 `FIELD_BLOCKS` 四块（默认模型与总开关 / 分组与自动探测 / 失败重试 / 自动切换）搬进本 tab，但：

- 「分组与自动探测」整块**移走**：分组相关全归「模型」tab（U4），策略 tab 只留 `groupMode`（分组方式切换）作为一行
- 「失败重试」块**保留并扩为双能力入口**：见 §9.4
- 「自动切换」块原样保留

### 9.4 「双能力」tab

两个子区块，各自一个标题 + 说明 + 字段：

1. **错误自动继续**（能力 1）：`autoResumeEnabled` / `autoResumeConsecutiveMax` / `autoResumeSessionMax` / `autoResumeContinuePrompt` + 副作用说明（会自动投递续作消息、消耗上游额度）
2. **上下文升级会话**（能力 2）：`escalateEnabled` / `escalateThresholdRatio` / `escalateMaxChainDepth` / `escalateContinuePrompt` / `escalateArchiveParent` / `escalateRenameChild` + 副作用说明（会新建会话并**归档父会话**、中断父会话正在跑的 turn）

### 9.5 兼容性约束（既有测试依赖，不可破坏）

| 既有断言 | 依赖 | 处置 |
|---|---|---|
| `[data-mas-model-row]` 取模型行 | 逐行选择器 | **保留在卡片上**（卡片同时带 `data-mas-model-row` 与 `data-mas-model-card`） |
| `[data-mas-assign]` 数量 ≥ 入口数 | 入组下拉 | 保留，卡片内仍是 `<select data-mas-assign>` |
| `[data-mas-field="maxRetries"]` 输入并提交 | 字段输入 | 保留（策略 tab 渲染，但**默认 tab 必须是「模型」→ 该字段不在首屏**，见下） |
| `FIELDS.length === 14` | 夹具字段数 | 字段表不变（新配置项由服务端 `CONFIG_FIELDS` 下发，夹具另加） |
| 设置 section 标签 = 「模型自动选择」 | 宿主 section 名 | 保留（宿主旧区块仍在，只是内容降级） |
| 齿轮入口唯一（`data-mas-settings-toggle`） | 唯一性 | 保留齿轮按钮（改为跳转侧边栏面板），仍唯一 |

> **⚠ 断言可见性冲突（须在落码时处理）**：既有断言直接取 `[data-mas-field="maxRetries"]` 并提交 —— 若「策略」tab 默认不渲染，该元素不存在会断言失败。
> 处置：**默认 tab =「模型」，但既有测试所需的字段仍需可取**。两个可选解法（落码时二选一并在审核报告披露）：
> - (a) 三个 tab **同时渲染**，未选 tab 用 `hidden` 属性隐藏（DOM 存在但不可见）→ 既有断言全部照旧可用，代价是三份 DOM 常驻；
> - (b) 默认 tab = 「策略」→ 既有断言可用，但用户首屏看到的是策略而非模型（与「先看模型」的直觉相悖）。
> **本设计取 (a)**：三个 tab 同时渲染、仅切换 `hidden` 与选中态。理由：既有断言零改动（红线：不改断言换绿）、用户点击 tab 即时可见、无异步渲染时序问题。

---

## 10. 侧边栏面板入口

> 需求来源（用户 m08959 逐字）：「注入侧边栏入口」；用户澄清：「是跟【新会话】那里的侧边栏」；最终拍板（U1）：**面板图标列新增图标 → 点开占主区域整页**。

### 10.1 宿主契约（本人已亲验 asar 源码）

| 事实 | 出处 |
|---|---|
| 侧边栏自上而下 5 区：品牌区 → **新会话行** → **面板图标列** → 会话浏览区 → 底部（footer.action + settings） | `dsh-client-ui-sidebar/src/client/SidebarRoot.tsx:279-476` |
| 面板图标列 = `sidebar.panellist` 列表槽；侧边栏把每个注册项渲染成一行（`panelList`），并按 `order` 升序排序 | `SidebarRoot.tsx:417-453`；`dsh-client-ui-sidebar/src/client/index.ts:57-72` |
| 列表槽 registerOptions：`id`（必填，**你的格子键**；新 id = 新增，已占用 id = 替换对方）、`order`（升序，默认 0）、`label`（显示文本，可 thunk） | slot-catalog `sidebar.panellist` 条目 |
| 点图标后主区域切到对应面板 = 注册 `main` keyed 槽，`key` 与 panellist 的 `id` 相同 | slot-catalog `main` 条目；`dsh-client-ui-layout/src/client/service.ts:37` `selectPanel(panelId)` |
| `main` 槽 registerOptions：`key`（必填）；keyDomain 开，除 `conversation`（宿主占用）外任意字符串 | slot-catalog `main` 条目 |
| 面板 id 需 `MainPanelId` branded 类型 | `dsh-client-ui-layout/src/client/service.ts:17` |
| `main` 槽**当前占用者**：`conversation`（宿主保留）、`client-ui-plugin-manager PluginManagerPage`、`client-ui-schedule TaskManagerPage` → `model-picker` 键**空闲** | slot-catalog `main` 条目 occupants |
| 面板能否被 `selectPanel` 选中，判据是「**`main` 槽里有没有同 key 的注册项**」（不是 panellist） | `dsh-client-ui-layout/src/client/index.ts:190` `ctx.slots.entries('main').some(entry => entry.options.key === id)` |
| `selectPanel` 对未注册的面板**抛错**（`main panel "..." is not registered`） | `dsh-client-ui-layout/src/client/service.ts:73-75` |
| 侧边栏把 panellist 的 `options.id` 当 `MainPanelId` 用；`label` 用 thunk 时每次投影重读（locale 自动跟随） | `dsh-client-ui-sidebar/src/client/index.ts:59-63` |
| **宿主自带范例**：`dsh-client-ui-plugin-manager`（插件管理页）用 `PANEL_ID = 'plugins'`，同时注册 `main`(key=PANEL_ID) + `sidebar.panellist`(id=PANEL_ID, order=0, label thunk) | `dsh-client-ui-plugin-manager/src/client/index.ts:84,130-174` |
| 面板图标组件签名 | `PluginsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>)` |
| **本插件读 `ctx.layout` 的方式**：`ctx.get('layout')` —— 动态门面对 `get` **不要求** inject 声明（本插件既有注释：src/client/index.ts:2889「只用 `ctx.get(name)` 读服务（动态门面对 `get` 不要求 inject 声明）」） | 本插件 src/client/index.ts:31, 2889 |

### 10.2 本插件的注册方式（照抄宿主插件管理页的配方）

```
PANEL_ID = 'model-picker'（MainPanelId）

ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: PANEL_ID, locale: NS, inject: () => face },
  ModelPickerPanel,          // 渲染三个 tab 的整页
))

ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => '模型自动选择', locale: NS },
  ModelPickerPanelIcon,      // 侧边栏图标
))
```

- `order: 10`：排在宿主「插件」（order 0）之后
- 图标：`@deepseek-ai/dsh-client-ui-primitives` 里挑一个语义合适的图标（模型/仪表类）；拿不到就退化成一个内联 SVG 字形（不能因为缺图标就不注册）
- `main` 面板组件与宿主设置页 section **共用同一个 React 组件**（`ModelPickerSettingsPanel`）→ 两处渲染永远一致，不会走偏
- 宿主未声明 `sidebar.panellist` / `main` 时（`slots.inject` 的 cb 不执行）插件必须静默降级，不报错
- **注册顺序**：`main` 先于 `sidebar.panellist` —— 侧边栏图标可点的前提是 `main` 槽里已有同 key 注册项（`layout/index.ts:190` 以此判定），否则 `selectPanel` 会抛 `main panel "model-picker" is not registered`
- **`ctx.layout` 依赖**：用 `ctx.get('layout')` 取（动态门面对 `get` 不要求 inject 声明）；取不到 → 面板图标不注册（静默降级），插件其余功能不受影响

### 10.3 宿主旧「模型自动选择」区块：保留完整视图 + 增加侧边栏入口（U5）

宿主设置页 `settings.section` 区块**保留完整配置视图**，并额外提供直达侧边栏面板的入口：

| 元素 | 内容 |
|---|---|
| 完整视图 | 与侧边栏面板**共用同一个 `mountSettingsForm`**（三 tab：模型 / 策略 / 双能力），两处渲染永远一致、不会出现配置面走偏；既有测试断言零改动 |
| 「在侧边栏面板中打开」按钮 | 点击 → 切到侧边栏面板（`ctx.get('layout').selectPanel(PANEL_ID)`），并把当前 tab 设为「模型」；取不到 `layout` → 静默降级（按钮不可用/隐藏），插件其余功能不受影响 |
| 一行说明 | 「完整配置也在侧边栏『模型自动选择』面板中，可从那里打开」 |

> **口径追认记录（2026-11-23）**：本节初稿写的是「降级为入口（只留 `enabled` 开关 + 按钮 + 一行说明）」，与用户 m09926 弹窗拍板的「保留完整视图 + 加『在侧边栏面板中打开』按钮」口径冲突；蓝军复核列为 P1-2。用户 2026-11-23 拍板：**以实现为准，追认本节口径为「保留完整视图 + 增加入口」**（保留旧区块的完整视图不丢功能，同时提供侧边栏直达入口）。本节文字据此改写，实现代码未改动。
>
> **已知代价（接受）**：同一份配置在宿主设置页与侧边栏面板各有一个全量编辑面（双入口冗余）。因两处共用同一 React 组件与同一份 `draft` 状态源，不存在状态分叉；仅是「同一配置有两个入口」的形态冗余。若后续要收敛，按用户届时拍板再改。

### 10.4 输入框旁的齿轮按钮（`data-mas-settings-toggle`）

保留（既有测试断言唯一性），但行为改为**跳转到侧边栏面板的「策略」tab**：

- `ctx.layout.selectPanel(PANEL_ID)` + 设置面板的当前 tab = 策略
- 宿主设置页旧区块里的按钮 → 跳到「模型」tab
- 两条路径都依赖 `ctx.layout`；取不到时（client 半边服务缺失）降级为「打开宿主设置页」旧行为

---

## 11. 下一步

1. 用户审核本设计文档 → 通过则落码
2. 落码：core 纯函数 → index 编排 → client 三 tab + 小卡片 + 侧边栏面板 → 测试
3. 门禁：test:all + 契约三模式 + rebuild
4. 改 profile 禁用 rescue/escalation（环境级操作，需当次授权）
5. 审核报告（执行自评 + 独立蓝军复核）
6. **单独请示**是否 push / npm publish（发布需当次独立授权，auto-continue 不构成授权）
