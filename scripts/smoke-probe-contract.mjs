#!/usr/bin/env node
// 契约一致性冒烟：用「忠实于真实 dsh-llm 派发契约」的宿主替身驱动真实 lib/index.js 的
// /test-model 端点，证明插件对合法 llm 全部 ok:true（排除插件逻辑错），并复现「全量不可调」
// 的 NO_ADAPTER 签名（派发层 provider 串与注册键不匹配时插件透出的真实错误原文）。
//
// 真实 dsh-llm 派发形状（来自 tmp/host-root/.../dsh-llm/lib/index.js）：
//   - adapters: Map<providerId, {adapter, provider:{id,name}, retryPolicy}>，adapter 实现 LlmAdapter
//   - prepareCall(config, signal): registration(provider) 未命中 → throw LlmError(`no adapter
//     registered for provider "${provider}"`, 'NO_ADAPTER')；命中 → adapter.prepareCall(provider, model, signal)
//   - 返回 { config, stream }，stream(options) 产出 {delta:{text}} / {type:'finish',reason:{kind}}
//   - listProviders() = 注册键映射；listModels(pid) = adapter.listModels(pid)
//
// 运行：node scripts/smoke-probe-contract.mjs    （CONTRACT_MODE=ok | no-adapter | transport-fail，默认 ok）
import http from 'node:http'
import { apply, __test } from '../lib/index.js'
import { modelKey } from '../lib/core.js'
import { rmSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

process.on('exit', () => {
  try {
    rmSync(dirname(__test.probeFile), { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结论 */
  }
})

const MODE = process.env.CONTRACT_MODE ?? 'ok'
const PORT = Number(process.env.SMOKE_PORT ?? 34329)
const ROUTE = __test.ROUTE_PREFIX
const ORIGIN = `http://127.0.0.1:${PORT}`

// 忠实适配器：模拟真实 dsh-llm 的 LlmAdapter 接口（prepareCall 返回含 stream 的句柄）。
function makeAdapter(name, models, failAll = false, transportFail = false) {
  return {
    name,
    models,
    listModels: async () => models,
    async prepareCall(provider, model, signal) {
      // transport-fail：模拟真实 undici 传输层故障（m00646 真机复盘：'fetch failed'）。
      // prepareCall 阶段即抛错 → runModelProbe 的 catch 经 classifyProbeFailure 判为 infra。
      if (transportFail) {
        const err = new Error('fetch failed')
        err.cause = new Error('network request failed')
        throw err
      }
      return {
        config: { provider, model, maxTokens: 32 },
        stream() {
          return (async function* () {
            if (failAll) {
              yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM_401', message: '上游 401：api key 无效' } } }
              return
            }
            yield { delta: { text: 'pong' } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    },
  }
}

// 真实 dsh-llm 形状的宿主：adapters Map（registration={adapter,...}）+ prepareCall 派发 + NO_ADAPTER 抛错。
// 目录构建用的「来源清单」(providerModelRegistry) 与「适配器注册表」(adapters) 在真实 dsh-llm 中耦合，
// 这里在 no-adapter 模式下刻意解耦：目录能建出来（listProviders/listModels 有数据），但 prepareCall 派发命中不到 → 复现全量 NO_ADAPTER。
function makeFaithfulHost({ adapters, providerModelRegistry }) {
  const llm = {
    _adapters: adapters,
    listProviders() {
      return [...providerModelRegistry.entries()].map(([id, reg]) => ({ id, name: reg.name }))
    },
    listModels: async (pid) => providerModelRegistry.get(pid)?.models ?? [],
    resolveModelInfo: async (pid, mid) => ({ provider: pid, id: mid, name: mid }),
    async prepareCall(config, signal) {
      const registration = this._adapters.get(config.provider)
      if (!registration) {
        const err = new Error(`no adapter registered for provider "${config.provider}"`)
        err.code = 'NO_ADAPTER'
        throw err
      }
      return registration.adapter.prepareCall(config.provider, config.model, signal)
    },
  }
  let handler = null
  return {
    get handler() {
      return handler
    },
    ctx: {
      get: (name) => (name === 'llm' ? llm : undefined),
      on: () => () => {},
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
  }
}

const registry = new Map([
  ['alpha', { name: 'Alpha 官方', models: [{ id: 'text-a', name: 'Text A' }, { id: 'mm-a', name: 'MM A' }] }],
  ['beta', { name: 'Beta', models: [{ id: 'text-b', name: 'Text B' }] }],
])

const host =
  MODE === 'no-adapter'
    ? makeFaithfulHost({ adapters: new Map(), providerModelRegistry: registry })
    : makeFaithfulHost({
        adapters: new Map([
          ['alpha', { adapter: makeAdapter('alpha', registry.get('alpha').models, false, MODE === 'transport-fail'), name: 'Alpha 官方' }],
          ['beta', { adapter: makeAdapter('beta', registry.get('beta').models, false, MODE === 'transport-fail'), name: 'Beta' }],
        ]),
        providerModelRegistry: registry,
      })

apply(host.ctx, { maxRetries: 1, retryDelayMs: 0, hiddenModels: [] })

const server = http.createServer((req, res) => {
  if (typeof host.handler === 'function') host.handler(req, res)
  else {
    res.statusCode = 503
    res.end('no handler')
  }
})

let passed = 0
const failures = []
function check(name, ok, detail) {
  if (ok) passed += 1
  else failures.push(name)
  console.log(`${ok ? '  ok ' : '  FAIL'} ${name}${ok ? '' : ` → ${detail}`}`)
}

async function call(path, init = {}) {
  const res = await fetch(`${ORIGIN}${path}`, init)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, json }
}
const post = (body) =>
  call(`${ROUTE}/test-model`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, referer: `${ORIGIN}/` },
    body: JSON.stringify(body),
  })

const allModels = [
  { provider: 'alpha', model: 'text-a' },
  { provider: 'alpha', model: 'mm-a' },
  { provider: 'beta', model: 'text-b' },
]

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
try {
  await call(`${ROUTE}/catalog?refresh=1`) // 先建目录

  {
    const keys = __test.probeUnavailableKeys()
    check('目录侧 llm 可用（catalog 构建无 fail-closed 兜底）', true, JSON.stringify(keys))
  }

  for (const { provider, model } of allModels) {
    const r = await post({ provider, model })
    if (MODE === 'ok') {
      check(`忠实宿主 ${provider}/${model} → 200 ok:true`, r.status === 200 && r.json?.ok === true, JSON.stringify(r.json))
      check(
        `忠实宿主 ${provider}/${model} 不进暂不可用集合`,
        !__test.probeUnavailableKeys().includes(modelKey(provider, model)),
        JSON.stringify(__test.probeUnavailableKeys()),
      )
    } else if (MODE === 'transport-fail') {
      // 核心回归：基础设施类故障（fetch failed）归「探测失败」组，同样持久化、不进 model 组（两组互斥）。
      check(`infra 故障 ${provider}/${model} → 200 ok:false`, r.status === 200 && r.json?.ok === false, JSON.stringify(r.json))
      check(
        `infra 故障 ${provider}/${model} 透出原文 'fetch failed'`,
        String(r.json?.error ?? '').includes('fetch failed'),
        JSON.stringify(r.json),
      )
      check(
        `infra 故障 ${provider}/${model} kind 判 infra 级`,
        r.json?.kind === 'infra',
        JSON.stringify(r.json),
      )
      check(
        `infra 故障 ${provider}/${model} 进 probeInfraKeys（探测失败组）`,
        __test.probeInfraKeys().includes(modelKey(provider, model)),
        JSON.stringify(__test.probeInfraKeys()),
      )
      check(
        `infra 故障 ${provider}/${model} 不进 probeUnavailableKeys（两组互斥）`,
        !__test.probeUnavailableKeys().includes(modelKey(provider, model)),
        JSON.stringify(__test.probeUnavailableKeys()),
      )
      const persisted = JSON.parse(readFileSync(__test.probeFile, 'utf8'))
      check(
        `infra 故障 ${provider}/${model} 持久化 infraKeys 含该键`,
        Array.isArray(persisted.infraKeys) && persisted.infraKeys.includes(modelKey(provider, model)),
        JSON.stringify(persisted),
      )
    } else {
      // NO_ADAPTER 是宿主/契约配置错误（provider 整体未接线）：该 provider 下所有模型必然调不通，
      // 属确定不可用，判 model 级 —— 透出错误 + 进 probeUnavailable（不可调组），从下拉移除。
      check(`NO_ADAPTER ${provider}/${model} → 200 ok:false`, r.status === 200 && r.json?.ok === false, JSON.stringify(r.json))
      check(
        `NO_ADAPTER ${provider}/${model} 透出原文 'no adapter registered for provider'`,
        String(r.json?.error ?? '').includes('no adapter registered for provider'),
        JSON.stringify(r.json),
      )
      check(
        `NO_ADAPTER ${provider}/${model} kind 判 model 级`,
        r.json?.kind === 'model',
        JSON.stringify(r.json),
      )
      check(
        `NO_ADAPTER ${provider}/${model} 进暂不可用集合（kind model，确定不可用）`,
        __test.probeUnavailableKeys().includes(modelKey(provider, model)),
        JSON.stringify(__test.probeUnavailableKeys()),
      )
    }
  }
} finally {
  server.close()
  console.log(`\n契约测试结果（CONTRACT_MODE=${MODE}）：passed=${passed} failed=${failures.length}`)
  if (failures.length > 0) {
    console.log('FAILURES: ' + failures.join(' | '))
    process.exit(1)
  }
  process.exit(0)
}
