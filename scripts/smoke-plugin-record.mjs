#!/usr/bin/env node
// 真机 plugin record 冒烟：用宿主真实的 @deepseek-ai/dsh-session 建一个 Session，
// 驱动插件写日志，验证 `plugin:model-auto-select/<event>` 真的落进会话事件流且可回读。
// 必须带宿主包解析垫片：node --import ./scripts/host-resolve.mjs scripts/smoke-plugin-record.mjs
// 注意：宿主 0.2.1-rc.2 的 @deepseek-ai/dsh-session 并未导出 isPluginRecordType，
// 这里用类型前缀判定，与宿主 PLUGIN_RECORD_TYPE 正则等价。
import { Session, pluginRecordOf } from '@deepseek-ai/dsh-session'
const isPluginRecordType = (type) => /^plugin:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(type)
import { apply, __test } from '../lib/index.js'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok ' : '  FAIL'} ${name}${ok ? '' : ` → ${detail}`}`)
}

// 宿主替身：一个 running 会话 + 两个模型，用来制造 retry → switch
// header 省略时宿主会合成最小 header（version 4 / createdAt / isSeeded:false），
// 显式传的话必须自带 version:4 与匹配的 id，否则 validateSessionHeader 直接抛错。
const session = Session.create('smoke-session')
const agent = {
  id: 'smoke-session',
  status: 'running',
  session: Object.assign(session, { requestHeader: () => ({ config: { provider: 'alpha', model: 'text-a' } }) }),
}

const providers = [{ id: 'alpha', name: 'Alpha', settingsNs: 'llm-alpha' }]
const models = {
  alpha: [
    { id: 'text-a', name: 'text-a', inputModalities: ['text'] },
    { id: 'text-b', name: 'text-b', inputModalities: ['text'] },
  ],
}
const listeners = new Map()
const ctx = {
  get: (name) =>
    ({
      llm: {
        listProviders: () => providers,
        listModels: async (pid) => models[pid] ?? [],
        resolveModelInfo: async (pid, mid) => ({ provider: pid, id: mid, name: mid, inputModalities: ['text'] }),
      },
      agents: { list: () => [agent] },
      sessionController: { agents: { selectForNextRequest: () => {} } },
      sessionProjections: { stateOf: () => undefined },
      agentDefaultModel: { currentSelection: () => ({ provider: 'alpha', model: 'text-a' }) },
    })[name],
  on: (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push(fn)
  },
  effect: () => () => {},
  webServer: { register: () => () => {} },
}
const emit = (name, payload) => Promise.all((listeners.get(name) ?? []).map((fn) => fn(payload, () => Promise.resolve(undefined))))

apply(ctx, { maxRetries: 1, retryDelayMs: 0, occupancyRefreshMs: 60_000 })
await new Promise((resolve) => setTimeout(resolve, 200)) // 等动态 import('@deepseek-ai/dsh-session') 完成

check('plugin record 通道已接通', __test.state().logRing.recent(50).some((r) => String(r.reason).includes('plugin record 通道可用')), JSON.stringify(__test.state().logRing.recent(20).map((r) => r.reason)))

await emit('agent/created', { agent })
await emit('agent/request-error', { agent, turn: 1, step: 1, provider: 'alpha', failure: { code: 'RATE_LIMIT', message: '429' }, retryPolicy: undefined, signal: undefined })
await emit('agent/request-error', { agent, turn: 1, step: 1, provider: 'alpha', failure: { code: 'RATE_LIMIT', message: '429' }, retryPolicy: undefined, signal: undefined })

const events = session.snapshotEvents(0, session.seq)
const pluginEvents = events.filter((event) => isPluginRecordType(event.type))
const byType = new Map()
for (const event of pluginEvents) {
  const type = event.type
  byType.set(type, (byType.get(type) ?? 0) + 1)
}

check('会话里出现 plugin record 事件', pluginEvents.length > 0, String(pluginEvents.length))
check('事件类型符合 plugin:model-auto-select/<event>', pluginEvents.every((e) => /^plugin:model-auto-select\/[a-z0-9-]+$/.test(e.type)), JSON.stringify([...byType.keys()]))
check('select 记录已落盘', (byType.get('plugin:model-auto-select/select') ?? 0) >= 1, JSON.stringify([...byType.entries()]))
check('retry 记录已落盘', (byType.get('plugin:model-auto-select/retry') ?? 0) >= 1, JSON.stringify([...byType.entries()]))
check('switch 记录已落盘', (byType.get('plugin:model-auto-select/switch') ?? 0) >= 1, JSON.stringify([...byType.entries()]))

const switchEvent = pluginEvents.find((e) => e.type === 'plugin:model-auto-select/switch')
// pluginRecordOf 返回 {type, seq, time, data}，业务载荷在 .data 里。
const record = switchEvent === undefined ? undefined : pluginRecordOf(switchEvent)
const payload = record?.data
check('pluginRecordOf 能取回数据', payload !== undefined && payload !== null, String(record))
check('switch 载荷含 from/to/reasonCode', payload?.from === 'alpha\u0000text-a' && payload?.to === 'alpha\u0000text-b' && payload?.reasonCode === 'switch-idle', JSON.stringify(payload))
check('plugin record 标记 ignorable（不进模型可见 surface）', switchEvent?.ignorable === true, String(switchEvent?.ignorable))
check('plugin record 带 seq/time', typeof switchEvent?.seq === 'number' && typeof switchEvent?.time === 'number', JSON.stringify({ seq: switchEvent?.seq, time: switchEvent?.time }))

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '全部通过' : `失败 ${failed.length} 项`}：${results.length} 项`)
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exitCode = 1
}
