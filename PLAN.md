# 需求进度计划 — dsh-model-picker 0.1.8 错误重试机制根治

## 当前需求
用户（m07950）：「继续优化这个插件，模型调用错误重试 参考一下 '@jayyuen66/dsh-session-rescue' 这个插件机制，重试n次错误再切换下一个模型继续，可用推翻一些之前的机制，保证插件真实可用性」。
用户 Q1 答复（m08020）："都可能" → A/B/C/D 四类失效全进范围，做全链路根治而非单点补丁。

## 规模核对（reference.md「三」硬指标，留痕）
- 大型：①非新系统 ②模块数未超3 ③非>5接口 ④无数据表变更 → 不满足
- 中型：①新增/改造机制在 1-2 模块内（错误链+选择链）②接口数待侦查 ③改已有接口待侦查 → **满足 → 定性中型**
- 小型：非修bug/样式/单文件<100行/不涉接口 → 不满足
- 结论：**中型**，走针对性文档 + 访谈（grilling）+ 每步审核（docs/review/ 独立报告）。

## 任务清单
- [x] 加载 base-memory + 规模核对留痕
- [x] 调研参考插件 @jayyuen66/dsh-session-rescue@0.1.16 机制（下载+实读 host.js/README）
- [x] RCA 侦查第一路 rca-facts：live 实况 + 配置 + 日志 + 失败码取法
- [x] RCA 侦查第二路 rca-event：宿主 agent/request-error 派发契约 + waterfall 语义（两轮回报，5+4 条事实全闭环）
- [x] grilling 访谈收敛设计树（Q1 全选 / Q2 用户配置 / Q3 完整分类+剥壳 / Q4 先问下游，全部拍板）
- [x] 建立针对性文档 docs/design-0.1.8.md（评审稿，用户 m08145「通过，改」审核通过）
- [~] 落码 + rebuild + 全量门禁 + 契约测试（进行中）
- [ ] 每步审核报告 docs/review/
- [ ] commit + Git 面板推送 + npm 发布 + packument/tarball 终验（需当次独立授权）

## 进度记录
- [2026-11-19] 加载 base-memory（v2.3.2）与 reference.md:1-181；定性中型。
- [2026-11-19] 下载参考包（sha1 cd2262440e…）解到 D:/tmp/srescue/package；吃透机制：失败分类 classifyFailure 阶梯（host.js:232）、请求级限流重试（固定阶梯 2/5/10/20/30s，先问下游再自己来）、ResumeScheduler 连续语义（host.js:346）、failureFaceOf 剥 AggregateError/cause（host.js:1355）。
- [2026-11-19] 实读当前插件错误链：core.ts:968 decideOnError（重试额度用尽→switch）、index.ts:1074 handleRequestError、index.ts:2238 waterfall 监听。确证"重试 n 次再切模型"机制已存在 → 命题是 RCA「为何不生效」而非新增功能。
- [2026-11-19] rca-facts 回报（证据链闭合）：
  - 事实1 live=dsh-model-picker symlink→工作目录，lib mtime 晚于 src → **排除"lib 未重建/旧包"**（证伪我先前 D 假设）。
  - 事实2 本插件 cordis.patch.yml 配置全注释走默认（maxRetries=2/retryDelayMs=800/switchOnCodes=[]）；宿主 cordis.patch.yml:307-317 有 llm-deepseek retryPolicy mode=normal + 6 码 retryableCodes。
  - 事实3 最近活跃会话 dd95057e：llm/retry×5 + retry-started×5（递增退避 498→8710ms，宿主 llm 层重试在生效），**agent/request-error 0 次**、无 giveup/switch/cooldown 事件；retry 爆发窗口内 model/selection 0 次，切换在 retry 结束后 2.8s 才开始。
  - 事实4 index.ts:1079 `code=String(failure?.code ?? 'UNKNOWN')` 只取顶层，无 cause/errors 剥壳；对比参考插件 failureFaceOf（深度3递归 cause+errors[]），确证代码级缺陷。
  - 判断：主因=宿主走自身 llm 层重试、未派发插件监听的 agent/request-error（受"会话是否启用插件""panel 是否记录该事件"限制待坐实）；次因=失败码剥壳缺失，即便触发也会误分类。

- [2026-11-19] rca-event 回报（5 条事实逐字取证，零修改零重启零全局配置）：
  - 事实1 emit 点 `dsh-agent-loop/src/agent.ts:555-565`：每次模型调用失败即 waterfall 派发 `agent/request-error`，仅 listener 返回 `{kind:'retry'}` 才同回合重发；`'agent'` 字段由 `dispatch.ts:114-119` 的 `fused()` 用 `({...payload, agent})` 自动注入（矛盾闭环）。
  - 事实2 waterfall 语义 `cordis/lib/index.js:904-919`：按注册先后执行、无优先级；上游不调 `next()` 则下游全跳过（含内置行为）。
  - 事实3【P0 根因坐实】宿主 llm-retry 就是本链 listener（`dsh-llm-retry/src/index.ts:241-250`），normal 模式未耗尽时**不调 next()** → 插件在前 1-5 次完全收不到事件。profile cordis.patch.yml:305-317 配 6 类码（EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT/MALFORMED_RESPONSE）+ 默认 maxRetries=5 → 这 6 类错误宿主连重试 5 次，插件全程收不到，只有第 6 次耗尽或码表外错误才轮到插件。**当前插件 :2238-2257 是"先自查后 next"，与宿主同链且宿主先注册 → 结构性被屏蔽**。
  - 事实4 payload 无 attempt/retryCount；计数旁路有宿主 session 投影（llm-retry append 'llm/retry'）与插件自维护 `state.attempts`（:1079，giveup/switch 即归零）。
  - 事实5 参考插件解法：`:1906-1913` 先 `await next()` 探下游（宿主接手就让路、耗尽才自己来）；`hostOwnsRetry`(:1887) 只认用户**显式配置**的 retryableCodes 让路，避免按"有没有 retryPolicy"划线（那恒真）。退避蓝本 5 次 [2/5/10/20/30]s、封顶 30s。
  - 判断：可行性成立，挂点正确；三个结构缺陷 P0=竞态被宿主屏蔽、无"先问下游"、计数/分类缺陷（不剥壳、无 transient/permanent、无退避阶梯）。

## 用户拍板（2026-11-19，grilling Q2/Q3/Q4）
- **Q4 分工模式**：先问下游（await next() 探宿主；宿主还在重试就让路，耗尽/码表外才走插件阶梯）。顺序无关、不与宿主等待叠加。
- **Q2 次数/退避**：**用户配置**——重试次数 n 与退避阶梯做成可配置项，不写死；默认值取 session-rescue 蓝本（次数与阶梯具体默认值见设计文档，用户可在设置页改）。
- **Q3 错误分类**：完整分类 + 剥壳——引入永久/瞬时阶梯（永久码一票否决、瞬时才重试），沿 cause+errors[] 剥 3 层取真实 failure 面。

## 实读改动锚点（2026-11-19，零漂移，无实读不编辑）
- core.ts:16 `PLUGIN_VERSION='0.1.0'`（历史遗留，本轮一并校正到 0.1.8？待定）。
- core.ts:20-30 AutoSelectConfig：maxRetries:number(:30)；core.ts:132-155 DEFAULT_CONFIG（maxRetries=2、retryDelayMs=800、switchOnCodes=[]、modelEfforts=[]）。
- core.ts:936-940 ErrorAction 联合；:942-958 ErrorRequest（含 failureCode/failureMessage/state）；:968-1040+ decideOnError 阶梯（aborted/disabled/cooldown/non-switchable→retry→switch→cooldown）。
- index.ts:93-133 Config schema（maxRetries:z.natural、retryDelayMs、switchOnCodes、modelEfforts 等全 volatile）。
- index.ts:1074-1205 handleRequestError：`code=String(failure?.code ?? 'UNKNOWN')`(:1079 剥壳缺失)、state.attempts+=1(:1085)、decideOnError 调用(:1091-1105)、四分支处理；retry 分支内部 `await delay(decision.delayMs)`(:1135)。
- index.ts:1210-1217 delay(ms,signal) 可中止等待。
- index.ts:2237-2257 listener「先自查后 next」（P0 根因）：`handleRequestError`→retry 直接 return，否则 next()。
- index.ts:1364-1383 CONFIG_FIELDS（14 项，maxRetries type=number「同一模型重试次数」:1370）。
- index.ts:1434-1444 configView（config/defaults/fields/writable）。
- index.ts:1452-1570 coercePatch（number/boolean/list/text/scope/groupmode/groups-list/defaultModel/disabledModels/customGroups/modelEfforts 分支齐全；新增字段须在此加分支）。
- 参考插件蓝本：剥壳 failureFaceOf(host.js:1355,depth=3)、分类 verdictOf/isRequestRetryWorthy(host.js:214)、退避阶梯 [2/5/10/20/30]s + 封顶30s(:1311-1320)、hostOwnsRetry(:1884 只认显式码表让路)、先问下游(:1906-1913)。

## 张力 Q5 自决（不再阻塞，已写进设计文档 §4/§5）
- 张力：宿主已对 6 类瞬时错误重试 5 次才耗尽，插件此时接手——若再按 n 次阶梯重试会等待叠加。
- **自决（按 session-rescue 蓝本）**：宿主显式码表内且已耗尽的错误 → 插件直接切模型（不叠加 n 次等待）；码表外 → 插件按可配 n 次阶梯重试后切。判据 `policy?.mode==='normal' && policy.retryableCodes?.includes(code) && hostRetryCount < policy.maxRetries`。
- **实现收敛（审核报告须披露）**：由于 listener 采用 prepend + 先 `await next()`，下游 `{kind:'retry'}` = 宿主接手的精确信号，`next()` 已把 hostOwnsRetry 的答案给出——插件里**不再重算** policy.retryableCodes 判据，判据逻辑藏进 next() 语义。decideOnError 主体（retry→switch）保留以兼容现有测试，新增分类/剥壳作为可选守卫，未知码（UPSTREAM_500）走老逻辑。

## 用户拍板补充
- m08145「通过 ，改」= 设计整体通过 + PLUGIN_VERSION 锁步改 0.1.8（无测试依赖）。

## 下一步行动
1. [进行中] 落码：补丁 spec（core/index/client/test 四文件）→ --check → 应用 → bump 0.1.8。
2. rebuild → 门禁（test:all + 契约三模式）。
3. 审核报告 docs/review/ → 请示用户授权 → Git 面板 push + npm 发布 0.1.8 + packument/tarball 终验（发布/推送需当次独立授权，不沿用旧授权）。
