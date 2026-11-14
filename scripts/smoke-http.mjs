#!/usr/bin/env node
// 真机 HTTP 冒烟：用真实 node http 服务承载 webServer.register 的 handler，
// 逐条打真实路由（不依赖桌面端进程重启），验证 6 个端点 + 同源校验 + 请求体上限。
import http from 'node:http'
import { apply, __test } from '../lib/index.js'

const PORT = Number(process.env.SMOKE_PORT ?? 34217)
const ROUTE = __test.ROUTE_PREFIX
const ORIGIN = `http://127.0.0.1:${PORT}`

// ── 宿主替身：只实现本插件真正用到的 API，形状与宿主一致 ──
function makeHost() {
  const providers = [
    { id: 'alpha', name: 'Alpha 官方', displayName: 'Alpha', settingsNs: 'llm-alpha' },
    { id: 'beta', name: 'Beta', settingsNs: 'llm-beta' },
  ]
  const models = {
    alpha: [
      { id: 'text-a', name: 'Text A', inputModalities: ['text'] },
      { id: 'mm-a', name: 'MM A', inputModalities: ['text', 'image'] },
    ],
    beta: [{ id: 'text-b', name: 'Text B' }], // 故意不给 inputModalities → 走 resolveModelInfo
  }
  const selectionCalls = []
  const liveAgents = [
    {
      id: 'session-1',
      status: 'running',
      session: { id: 'session-1', requestHeader: () => ({ config: { provider: 'alpha', model: 'text-a' } }) },
    },
    { id: 'session-2', status: 'idle', session: { id: 'session-2', requestHeader: () => undefined } },
  ]
  const listeners = new Map()
  const services = {
    llm: {
      listProviders: () => providers,
      listModels: async (pid) => models[pid] ?? [],
      resolveModelInfo: async (pid, mid) => ({
        provider: pid,
        id: mid,
        name: mid,
        inputModalities: mid === 'text-b' ? ['text'] : undefined,
        ...(mid === 'text-a'
          ? { reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'high' } }
          : {}),
      }),
    },
    agents: { list: () => liveAgents },
    sessionController: {
      agents: {
        selectForNextRequest: (agent, selection) => selectionCalls.push({ id: agent.id, ...selection }),
      },
    },
    sessionProjections: { stateOf: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'alpha', model: 'text-a' }) },
  }
  let handler = null
  return {
    selectionCalls,
    get handler() {
      return handler
    },
    ctx: {
      get: (name) => services[name],
      on: (name, fn) => {
        if (!listeners.has(name)) listeners.set(name, [])
        listeners.get(name).push(fn)
      },
      effect: () => () => {},
      webServer: {
        register: (options) => {
          handler = options.handler
          return () => {
            handler = null
          }
        },
      },
    },
    emit: (name, payload) => Promise.all((listeners.get(name) ?? []).map((fn) => fn(payload, () => Promise.resolve(undefined)))),
  }
}

const host = makeHost()
apply(host.ctx, { maxRetries: 1, retryDelayMs: 0, occupancyRefreshMs: 60_000 })

const server = http.createServer((req, res) => {
  if (typeof host.handler === 'function') host.handler(req, res)
  else {
    res.statusCode = 503
    res.end('no handler')
  }
})

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok ' : '  FAIL'} ${name}${ok ? '' : ` → ${detail}`}`)
}

async function call(path, init) {
  const res = await fetch(`${ORIGIN}${path}`, init)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, text, json, headers: res.headers }
}

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
try {
  // 1) health
  {
    const r = await call(`${ROUTE}/health`)
    check('GET /health 200 且带 plugin/version/catalogSize', r.status === 200 && r.json?.plugin === '@zjjlivingfree/dsh-model-picker' && typeof r.json?.catalogSize === 'number', `${r.status} ${r.text.slice(0, 200)}`)
    check('GET /health 暴露 pluginRecordChannel（布尔）', typeof r.json?.pluginRecordChannel === 'boolean', String(r.json?.pluginRecordChannel))
    if (process.env.EXPECT_PLUGIN_RECORD === '1') {
      check('plugin record 通道在宿主包可解析时为 true', r.json?.pluginRecordChannel === true, String(r.json?.pluginRecordChannel))
    }
  }

  // 2) catalog：分类 + 来源 + 模态来源 + 排序键 + 占用
  {
    const r = await call(`${ROUTE}/catalog?refresh=1`)
    const entries = r.json?.entries ?? []
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]))
    check('GET /catalog 200 且 providerCount=2', r.status === 200 && r.json?.providerCount === 2, `${r.status} ${r.text.slice(0, 200)}`)
    check('catalog 共 3 个模型', entries.length === 3, String(entries.length))
    check('mm-a 判为 multimodal', byKey['alpha\u0000mm-a']?.kind === 'multimodal', JSON.stringify(byKey['alpha\u0000mm-a']))
    check('text-a 判为 text', byKey['alpha\u0000text-a']?.kind === 'text', JSON.stringify(byKey['alpha\u0000text-a']))
    check('来源标注：providerName / settingsNs 齐全', byKey['alpha\u0000text-a']?.providerName === 'Alpha 官方' && byKey['alpha\u0000text-a']?.providerSettingsNs === 'llm-alpha', JSON.stringify(byKey['alpha\u0000text-a']))
    check('模态来源：mm-a 来自 listModels', byKey['alpha\u0000mm-a']?.modalitySource === 'listModels', String(byKey['alpha\u0000mm-a']?.modalitySource))
    check('模态来源：text-b 来自 resolveModelInfo', byKey['beta\u0000text-b']?.modalitySource === 'resolveModelInfo', String(byKey['beta\u0000text-b']?.modalitySource))
    check('排序键四元组', Array.isArray(byKey['beta\u0000text-b']?.sortKey) && byKey['beta\u0000text-b'].sortKey.length === 4, JSON.stringify(byKey['beta\u0000text-b']?.sortKey))
    check('占用标注：text-a 使用中（running）', r.json?.occupancy?.['alpha\u0000text-a']?.inUse === true && r.json?.occupancy?.['alpha\u0000text-a']?.running === true, JSON.stringify(r.json?.occupancy?.['alpha\u0000text-a']))
    check('占用标注：空会话不计入 owners', JSON.stringify(r.json?.occupancy?.['alpha\u0000text-a']?.owners) === '["session-1"]', JSON.stringify(r.json?.occupancy?.['alpha\u0000text-a']?.owners))
    const cfgKeys = Object.keys(r.json?.config ?? {})
    check('catalog 暴露 21 项配置（含 switchScope）', cfgKeys.length >= 21 && cfgKeys.includes('switchScope'), String(cfgKeys.length))
    check('switchScope 默认 group-cross', r.json?.config?.switchScope === 'group-cross', String(r.json?.config?.switchScope))
    check('catalog 暴露 groups（跨来源按类型分组）', Array.isArray(r.json?.groups) && r.json.groups.length === 2 && r.json.groups[0].kind === 'multimodal', JSON.stringify(r.json?.groups?.map((g) => [g.id, g.keys.length])))
    check('catalog 暴露 cooldown 快照', typeof r.json?.cooldown?.active === 'boolean', JSON.stringify(r.json?.cooldown))
  }

  // 3) occupancy
  {
    const r = await call(`${ROUTE}/occupancy`)
    check('GET /occupancy 200 且带 refreshedAt', r.status === 200 && typeof r.json?.refreshedAt === 'number', `${r.status} ${r.text.slice(0, 200)}`)
  }

  // 4) 故障演练：进入会话 → 重试 → 切换
  {
    const [agent] = host.ctx.get('agents').list()
    await host.emit('agent/created', { agent })
    check('agent/created 触发选择并走 selectForNextRequest', host.selectionCalls.length === 1 && host.selectionCalls[0].provider === 'alpha', JSON.stringify(host.selectionCalls))

    const errorPayload = { agent, turn: 1, step: 1, provider: 'alpha', failure: { code: 'RATE_LIMIT', message: '429 too many requests' }, retryPolicy: undefined, signal: undefined }
    const first = await host.emit('agent/request-error', errorPayload)
    const second = await host.emit('agent/request-error', errorPayload)
    check('第 1 次失败 ⇒ retry', first[0]?.kind === 'retry', JSON.stringify(first))
    check('第 2 次失败（额度 1 用尽）⇒ 仍返回 retry 但已换模型', second[0]?.kind === 'retry' && host.selectionCalls.length === 2, JSON.stringify({ second, calls: host.selectionCalls }))
    check('切换目标 = beta/text-b（同类型下一个）', host.selectionCalls.at(-1)?.provider === 'beta' && host.selectionCalls.at(-1)?.model === 'text-b', JSON.stringify(host.selectionCalls.at(-1)))

    const logs = (await call(`${ROUTE}/logs?limit=50`)).json
    const events = (logs?.records ?? []).map((x) => x.event)
    check('/logs 含 config/catalog/select/retry/switch', ['config', 'catalog', 'select', 'retry', 'switch'].every((e) => events.includes(e)), JSON.stringify(events))
    const sw = (logs?.records ?? []).find((x) => x.event === 'switch')
    check('switch 记录 from/to/reasonCode/orderIndex 齐全', sw?.from === 'alpha\u0000text-a' && sw?.to === 'beta\u0000text-b' && sw?.reasonCode === 'switch-idle' && typeof sw?.orderIndex === 'number', JSON.stringify(sw))
  }

  // 5) 冷却：清掉同类型全部候选 → cooldown → 冷却中 giveup → 人工清除
  {
    const [agent] = host.ctx.get('agents').list()
    // 切换后新模型会重新拿到 maxRetries 额度，所以要连续打到同类型候选耗尽
    for (let i = 0; i < 6 && __test.state().cooldown.until === 0; i += 1) {
      await host.emit('agent/request-error', { agent, turn: 1, step: 2 + i, provider: 'beta', failure: { code: 'AUTH', message: 'bad key' }, retryPolicy: undefined, signal: undefined })
    }
    const state = __test.state()
    check('同类型耗尽 ⇒ 进入 30 分钟冷却', state.cooldown.until > Date.now() + 29 * 60 * 1000, JSON.stringify(state.cooldown))
    const after = await host.emit('agent/request-error', { agent, turn: 1, step: 9, provider: 'beta', failure: { code: 'AUTH', message: 'bad key' }, retryPolicy: undefined, signal: undefined })
    check('冷却中再出错 ⇒ giveup（不返回 retry）', after[0] === undefined, JSON.stringify(after))

    const clear = await call(`${ROUTE}/cooldown/clear`, { method: 'POST', headers: { Origin: ORIGIN } })
    check('POST /cooldown/clear 同源通过并清冷却', clear.status === 200 && __test.state().cooldown.until === 0, `${clear.status} ${clear.text.slice(0, 200)}`)
    const cross = await call(`${ROUTE}/cooldown/clear`, { method: 'POST', headers: { Origin: 'http://evil.example' } })
    check('POST /cooldown/clear 跨站被拒（403）', cross.status === 403, `${cross.status} ${cross.text.slice(0, 120)}`)
  }

  // 6) beacon + 请求体上限
  {
    const ok = await call(`${ROUTE}/beacon`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'mounted', build: 'mas-v1', viewError: '', extra: 'drop-me' }),
    })
    check('POST /beacon 同源 200', ok.status === 200, `${ok.status} ${ok.text.slice(0, 120)}`)
    const big = await call(`${ROUTE}/beacon`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: 'x', build: 'y', viewError: 'z'.repeat(200_000) }),
    })
    check('POST /beacon 超 64KB ⇒ 413', big.status === 413, `${big.status} ${big.text.slice(0, 120)}`)
    const list = await call(`${ROUTE}/beacon`)
    check('GET /beacon 回读且白名单外字段被丢弃', list.status === 200 && (list.json?.beacons ?? []).every((b) => b.extra === undefined), JSON.stringify(list.json).slice(0, 300))
  }

  // 7) 推理等级：目录披露 reasoning、/select 透传合法 effort、非法 effort 400
  {
    const catalog = await call(`${ROUTE}/catalog?refresh=1`)
    const textA = (catalog.json?.entries ?? []).find((e) => e.provider === 'alpha' && e.model === 'text-a')
    check('catalog 暴露 text-a 的 reasoning.efforts（宿主 resolveModelInfo 披露）', Array.isArray(textA?.reasoning?.efforts) && textA.reasoning.efforts.length === 2, JSON.stringify(textA?.reasoning))
    check('catalog 的 reasoning 带 defaultEffort', textA?.reasoning?.defaultEffort === 'high', JSON.stringify(textA?.reasoning))
    const noReason = (catalog.json?.entries ?? []).find((e) => e.provider === 'alpha' && e.model === 'mm-a')
    check('未披露 reasoning 的模型 catalog 里不带该字段（fail-closed）', noReason?.reasoning === undefined, JSON.stringify(noReason?.reasoning))
    host.selectionCalls.length = 0
    const okSel = await call(`${ROUTE}/select`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', provider: 'alpha', model: 'text-a', reasoningEffort: 'high' }),
    })
    check('POST /select 带合法 reasoningEffort → 200', okSel.status === 200, `${okSel.status} ${okSel.text.slice(0, 160)}`)
    check('响应回带 reasoningEffort', okSel.json?.selection?.reasoningEffort === 'high', JSON.stringify(okSel.json?.selection))
    check('切模型入口收到 reasoningEffort', host.selectionCalls.some((c) => c.reasoningEffort === 'high'), JSON.stringify(host.selectionCalls))
    const badSel = await call(`${ROUTE}/select`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', provider: 'alpha', model: 'text-a', reasoningEffort: 'bogus' }),
    })
    check('POST /select 带未声明的 reasoningEffort → 400', badSel.status === 400, `${badSel.status} ${badSel.text.slice(0, 160)}`)
    check('非法 effort 不落地切模型入口', !host.selectionCalls.some((c) => c.reasoningEffort === 'bogus'), JSON.stringify(host.selectionCalls))
  }

  // 8) 未知路由
  {
    const r = await call(`${ROUTE}/nope`)
    check('未知路由 404', r.status === 404, String(r.status))
  }
} finally {
  server.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '全部通过' : `失败 ${failed.length} 项`}：${results.length} 项`)
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exitCode = 1
}
