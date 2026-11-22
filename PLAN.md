# 需求进度计划 — 错误自动继续 + 上下文阈值换会话归档 + 设置页重构 + 侧边栏面板

## 当前需求
用户（m08644，2026-11-22，逐字）：「深度研究插件开源@jayyuen66/dsh-session-rescue及我本地的dsh-session-escalation插件，在我当前的插件中加入 1.错误自动继续 2.上下文达到阈值先创建新会话继续任务且归档旧会话」。

追加需求（m08959，逐字）：「1.需要将设置页面重新设计布局才行，模型列表改为小卡片展示，不同设置改为tab显示；2.注入侧边栏入口」
- 澄清（m09051）：「是跟【新会话】那里的侧边栏」
- 拍板（m09071）：侧边栏入口形态 = **面板图标列新增图标 → 点开占主区域整页**（宿主 `sidebar.panellist` + `main` keyed 槽）
- 拍板（m09043）：面板内容 = **完整设置页（tab 化）搬进侧边栏面板**；设置页 = **三个 tab：模型 / 策略 / 双能力**
- 拍板（m09051）：分组编辑 = **模型 tab 顶部工具条**
- 拍板（m09074）：宿主旧「模型自动选择」区块 = **降级为入口**（启用总开关 + 「在侧边栏面板中打开」按钮）

目标插件：当前工作区 `D:/my-projects/plugins/dsh-model-picker`（已发布 0.1.7，0.1.8 本地 commit `167a671` 未发布、用户选择"先不发保留本地"）。

## 规模核对（reference.md「三」硬指标，留痕）
- 大型：①非新系统（在已有插件加能力）②跨模块重构>3模块（**已满足**：core 纯函数 / index 服务端编排 / client UI 三处 + 宿主 UI 契约）③新增接口>5个（**已满足**：`/pending-navigation` + `decideResume` + `decideEscalate` + `sidebar.panellist` 注册 + `main` 注册 + `ctx.uiWorkspace.openSession` 跨半边队列）④涉及数据表变更（**否**，仅进程内 Map 账本）→ **升为大型**
- 中型：满足 → 取更高一级 = **大型**
- 小型：①非修bug ②非样式 ③非单文件<100行 ④涉及接口变更 → **明确不满足**
- 结论：**大型**（调研/访谈/每步审核全部不豁免，流程不缩短）。

## 三铁律执行状态
- 铁律一（先调研大厂做法）：以两个开源参考插件（用户指定）为调研对象，2 个只读研究子代理 + 本人亲读宿主 asar 源码。
- 铁律二（先文档后执行）：`docs/research-0.1.9-双能力.md`（调研）+ `docs/design-0.1.9-双能力.md`（设计，396 行）已落盘，交用户审核后才落码。
- 铁律三（文档与进度随时同步）：本文件随进展即时回写。

## 任务清单
- [x] 加载 base-memory + 规模核对留痕
- [x] 归档旧 PLAN.md（0.1.8 已完成）到 docs/archive/
- [x] 深度研究 @jayyuen66/dsh-session-rescue「错误自动继续」机制（rescue-researcher 完成）
- [x] 深度研究 dsh-session-escalation「阈值换会话+归档」机制（esc-researcher2 完成）
- [x] 实读当前 dsh-model-picker 核心挂点（错误链/会话链/上下文/事件/设置页）
- [x] 宿主 asar 亲验：6 关键 API + 5 事件 + V4 source.kind 准入 + 侧边栏 5 区/8 槽位 + main/sidebar.panellist 契约
- [x] grilling 访谈 4 轮（双能力 27 项决策全拍板）
- [x] 追加需求访谈 2 轮（设置页重构 + 侧边栏入口 5 项拍板）
- [x] 写设计文档 docs/design-0.1.9-双能力.md（含 §9 设置页重构 / §10 侧边栏面板）
- [x] **用户审核设计文档**（m09926 弹窗拍板：①宿主旧区块保留完整视图 + 加「在侧边栏面板中打开」按钮 ②groupMode 只放「模型」tab 顶部工具条；与设计 §10.3 字面「降级为纯入口」有偏差，已在审核报告披露）
- [x] 落码 core.ts（PLUGIN_VERSION 0.1.9 + 10 配置字段 + decideResume/decideEscalate 纯函数）— patch_019_core.txt 6 edits
- [x] 落码 index.ts（agent/error + session/event 监听、会话服务解析、账本、/pending-navigation、Config/CONFIG_FIELDS/coercePatch）— patch_019_index.txt 10 edits
- [x] 落码 client/index.ts（三个 tab + 小卡片 + sidebar.panellist/main 面板）— patch_019_client.txt 29 edits
- [x] 落码测试（patch_019_test_auto.txt 2 edits + patch_019_test_dom.txt 8 edits）
- [x] 补审核中发现的真实功能缺口（对照已批准设计文档逐条核）：缺口 A = client 半边从不轮询 /pending-navigation（升级后不跳转）→ 新增 loadPendingNavigation + NAV_POLL_MS=1s + **顺序守卫**（uiWorkspace 不在位就不 fetch，防服务端「取走即清空」永久丢目标）；缺口 B = 子会话未 attachSession（侧边栏看不到）→ 按宿主 controller fork 配方 workspace.attachSession(childId)，失败只记日志不阻断升级
- [x] rebuild + 全量门禁：BUILD_EXIT=0；test:all **116/76/39/41/10** 全绿；契约三模式 7/13/19 全绿
- [x] 执行自评报告 docs/review/0.1.9-执行自评-20261123.md（含三次真实红灯归因：apiUrl 误删 / DOM setup 顺序错 / 未 rebuild+回合完成未预置）
- [x] 独立蓝军复核：docs/review/0.1.9-蓝军复核-20261123.md（114 行）→ **无 P0，P1 三项**：P1-1 自评误标三个既有纯函数为「新增」（已更正，依据 git show HEAD 对照）｜P1-2 U5 旧区块形态与设计 §10.3 分歧 → **用户 2026-11-23 拍板：以实现为准，改设计文档追认**（§10.3/U5/§5.3 已改写为「保留完整视图 + 增加侧边栏入口」并附追认记录；实现代码零改动，门禁无需重跑）｜P1-3 宿主 agent/error + session/event 两条新事件链与 uiWorkspace/workspaceRegistry/attachSession/selectPanel 未真机验证（风险形态=「开启后不触发」而非误动作，默认关闭+fail-closed 严重度受控）
- [~] 请示授权后：改 profile 禁用 rescue/escalation（**未授权，未执行**）+ npm publish 0.1.9（**未授权，未执行**）
- [x] commit + push main（用户 2026-11-23 当次授权）

## 进度记录
- [2026-11-22] 加载 base-memory v2.3.2 + reference.md 全文；规模核对=中型起步。
- [2026-11-22] 归档 0.1.8 的 PLAN.md → docs/archive/PLAN-0.1.8-已完成-20261119.md。
- [2026-11-22] 确认三方源码位置：参考包 D:/tmp/srescue/package（host.js/client.js）、本地 dsh-session-escalation、本插件工作区。profile 中两个插件均为 symlink 指向本地目录。
- [2026-11-22] 派 2 个只读研究子代理（rescue-researcher / escalation-researcher），已内联行为协议（本机无独立 PUA skill 目录，不虚构路径）。escalation-researcher 爆上下文未交付，重派 esc-researcher2 完成。
- [2026-11-22] 亲读当前插件挂点：src 三文件 7453 行；仅监听 5 事件；会话 API 无 create/archive/followup。
- [2026-11-22] escalation 研究回报（带行号）：阈值=token-meter contextPressure 投影；换会话=ctx.agents.create 不传 parent + workspace.attachSession；followup+createUserMessage source.kind='session-escalation'；summary 模式干净会话；归档=archiveSession(session.id,{stopActivity:true})（可逆）；交接摘要 [交接] 头；预算 Ledger+escalatedTo 锁。冲突点：escalation 在 error/aborted 时跳过，而错误自动继续恰在错误路径介入。
- [2026-11-22] 宿主 asar 亲验：6 关键 API 全存在（能力2 宿主前置成立）；V4 格式包**无 source.kind 白名单**（自定义 kind 安全）；token-meter 默认已启用（contextPressure 投影可用）；**宿主无 node 半边会话切换 API** → 跳转必须走 client 半边 `ctx.uiWorkspace.openSession`（HTTP 队列跨半边）。
- [2026-11-22] grilling 4 轮拍板：Q1 本插件接管/改 profile 禁用另两个、Q2 请求级+回合级结合、Q3 仅不可用才切、Q4 连续 3+整会话 10、Q5 只做升级档 0.85、Q6 summary 干净会话+交接摘要、Q7 带 stopActivity 归档、仅归档自己发起的升级；R3/R4 轮补充 HTTP 拉取跳转、对齐 escalation 执行序、复用现有分类器、两个能力默认关。
- [2026-11-22] 追加需求访谈 2 轮：侧边栏 = 面板图标列新增图标点开占主区域整页；面板内容 = 完整设置页 tab 化；三个 tab = 模型/策略/双能力；分组编辑 = 模型 tab 顶部工具条；宿主旧区块降级为入口。
- [2026-11-22] 宿主侧边栏契约亲验（SidebarRoot.tsx 479 行 + slot-catalog）：侧边栏 5 区；`sidebar.panellist` 列表槽（id/order/label）；`main` keyed 槽（key 与 panellist id 相同才可被 selectPanel 选中，当前占用者 conversation/plugins/schedule）；宿主「插件」图标 = 同款配方可抄；`ctx.get('layout')` 取服务不需 inject 声明。
- [2026-11-22] 设计文档改写完成（396 行）：新增 §9 设置页重构（骨架/模型 tab 卡片布局/策略 tab/双能力 tab/兼容性约束表）、§10 侧边栏面板（宿主契约表/注册配方/旧区块降级/齿轮跳转）、§7 加 5 条界面契约、§8 加 R9-R12 风险；决策表加 U1-U5。
- [2026-11-23] 用户弹窗拍板设计（m09926）：宿主旧区块保留完整视图 + 加「在侧边栏面板中打开」按钮（偏离设计 §10.3「降级为纯入口」，已记入审核报告）；groupMode 只放「模型」tab 顶部工具条。
- [2026-11-23] 落码完成（4 个补丁 spec 全部 ALL_MATCH→ALL_OK）：core 6 edits / index 10 edits / client 29 edits / test-auto 2 edits / test-dom 8 edits。踩坑：补丁 spec 的 OLD/NEW 必须与源文件逐字同缩进（import 成员两空格、顶层 const 零缩进）；test-dom 生成器漏写每块 `@@EDIT 1` 头导致只匹配最后一块，已补。
- [2026-11-23] 门禁全绿：BUILD_EXIT=0（lib/index.js 167.6kb / lib/core.js 37.0kb / lib/client.js 125.1kb）；test:all 全绿（test-auto-select 114 / test-client-dom 73 / smoke-http 39 / smoke-probe 41 / smoke-plugin-record 10）；契约三模式 ok=7 no-adapter=13 transport-fail=19 全绿。
- [2026-11-23] **审核发现两处真实功能缺口并已补**：A = client 不轮询 /pending-navigation（grep 零命中坐实从未生效）→ loadPendingNavigation + 1s 轮询 + 顺序守卫；B = 子会话未 attachSession → workspace.attachSession(childId)。三次真实红灯全部归因清楚：①apiUrl 被补丁 OLD 块误删（`git diff -U0 | grep "^-function "` 定位，按位插回）②DOM 测试 setup 顺序错（boot() 内部复位 server.__pendingNavigation，先 boot 后设目标）③未 rebuild 就跑测试 + 升级用例未预置 lastTurnCompleted。
- [2026-11-23] 终态门禁：BUILD_EXIT=0（lib/index.js 168.4kb / lib/core.js 37.0kb / lib/client.js 126.3kb）；**test:all 全绿（test-auto-select 116 / test-client-dom 76 / smoke-http 39 / smoke-probe 41 / smoke-plugin-record 10）**；契约三模式 ok=7 no-adapter=13 transport-fail=19 全绿；版本三处锁步 0.1.9（package.json / src/core.ts:16 / lib/core.js:3）。
- [2026-11-23] 发布前置只读核验：npm whoami=zjjlivingfree；远端 latest=0.1.7、**0.1.9 未占用**（npm view 404）；npm pack --dry-run exit 0（6 files、120.7kB、shasum ee25b7e2…）。**未 commit / 未 push / 未 publish / 未改 profile**。
- [2026-11-23] **独立蓝军复核回收**（docs/review/0.1.9-蓝军复核-20261123.md，114 行）：总体判断=与批准设计高度一致、门禁三绿、**无 P0**、可进入发布流程；P1 三项：①自评误标 failureFaceOf/classifyFailure/requestBackoffMs 为「新增」→ 已更正（git show HEAD 坐实为 0.1.8 既有，仅行号下移 49；真正新增只有 decideResume/decideEscalate）②U5 旧区块形态与设计 §10.3 分歧 → 待用户拍板改实现 or 改设计文档，未自行改代码 ③宿主两条新事件链 + 四个服务未真机验证 → 如实标「未验证」，风险形态=开启后不触发而非误动作。蓝军独立复核的门禁与静态结论与自评一致（互为佐证）。
- [2026-11-23] PLAN.md 同步完成（任务清单过期条目全部改正）。
- [2026-11-23] **用户拍板回收**（ask_user_question）：①U5 → 选「保留完整视图，改设计文档追认（推荐）」→ 已改写 docs/design-0.1.9-双能力.md §10.3（新增口径追认记录，含初稿口径、m09926 拍板冲突、用户拍板结论、已知代价=双入口形态冗余但共用同一组件与 draft 状态源故无分叉）+ U5 行 + §5.3 旧区块行；自评报告第六节第 1 条与第十节 P1-2 同步更新为「已处置」。②发布授权 → **只授权「commit + push main」**；**npm publish 0.1.9 未授权**（不执行）、**改 profile 禁用 rescue/escalation 未授权**（不执行，profile 保持原状：两个插件仍启用，双驱动风险仍在，保留在残留风险披露中）。

## 下一步行动
1. ✅ 已完成：commit + push main（用户 2026-11-23 授权）。
2. npm publish 0.1.9 **未授权** → 待用户当次独立授权后再执行（name+version 永久占用，禁重发）。
3. 改 profile 禁用 rescue/escalation **未授权** → 待用户当次授权（环境级操作；当前两插件仍启用，双驱动风险保留披露）。
4. 用户重载插件后做真机验证两条路径（瞬时错误→续作投递；占用过阈→升级建会话+跳转）。
