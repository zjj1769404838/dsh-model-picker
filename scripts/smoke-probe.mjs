#!/usr/bin/env node
// /test-model 连通性测试端点冒烟：真实 http 服务 + 真实 lib/index.js handler，
// 用宿主替身 llm.prepareCall 驱动 5 条路径（成功/失败/流中断/404/跨源403），不依赖桌面端重启。
import http from 'node:http'
import assert from 'node:assert/strict'
import { apply, __test } from '../lib/index.js'
import { modelKey } from '../lib/core.js'
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

// 清理测试产生的持久化文件与 data 目录，避免污染仓库（仓库根无 gitignore/data）。
// 必须在任何 process.exit() 之前注册：exit 钩子在任何退出路径都执行（含 process.exit 跳过 finally 的情况）。
process.on('exit', () => {
  try {
    rmSync(dirname(__test.probeFile), { recursive: true, force: true })
  } catch {
    // 清理失败不影响测试结论
  }
})

const PORT = Number(process.env.SMOKE_PORT ?? 34319)
const ROUTE = __test.ROUTE_PREFIX
const ORIGIN = `http://127.0.0.1:${PORT}`

function makeHost() {
  const providers = [
    { id: 'alpha', name: 'Alpha 官方', displayName: 'Alpha', settingsNs: 'llm-alpha' },
    { id: 'beta', name: 'Beta', settingsNs: 'llm-beta' },
  ]
  const models = {
    alpha: [
      { id: 'text-a', name: 'Text A', inputModalities: ['text'] },
      { id: 'mm-a', name: 'MM A', inputModalities: ['text', 'image'] },
      { id: 'a-hide-1', name: 'A-Hide-1', inputModalities: ['text'] },
    ],
    beta: [{ id: 'text-b', name: 'Text B' }],
  }
  const probes = []
  let failMmA = true
  const services = {
    llm: {
      listProviders: () => providers,
      listModels: async (pid) => models[pid] ?? [],
      resolveModelInfo: async (pid, mid) => ({ provider: pid, id: mid, name: mid, inputModalities: undefined }),
      // 与宿主 dsh-llm:2225 同形：返回 {config, stream}；stream 只接受与 config 相容的 options
      async prepareCall(config, signal) {
        probes.push({ provider: config.provider, model: config.model, maxTokens: config.maxTokens })
        return {
          config: { ...config, temperature: 0.7 },
          async *stream(options) {
            assert.equal(options.provider, config.provider)
            assert.equal(options.model, config.model)
            assert.equal(options.maxTokens, config.maxTokens, 'stream options 必须携带与 config 相同的 maxTokens（callConfigEquals 校验面）')
            assert.ok(Array.isArray(options.messages) && options.messages.length === 2, '必须带 messages（system + user 两条，真机 m01436：workbuddy 网关要求首条为 system）')
            assert.equal(options.messages[0]?.role, 'system', '首条消息必须是 system（网关格式要求，对齐宿主真实调用）')
            // 真机 m02715 回归：宿主 contentHasFile/Image 会对 content 调 .some()/遍历，
            // content 必须是结构化块数组而非裸字符串，否则抛 "content.some is not a function"。
            const content = options.messages[1]?.content
            assert.ok(Array.isArray(content) && content[0]?.type === 'text' && typeof content[0]?.text === 'string', 'message.content 必须是 [{type:"text",text}] 结构化块数组（宿主契约）')
            if (config.model === 'mm-a' && failMmA) {
              yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM_401', message: '上游 401：api key 无效' } } }
              return
            }
            if (config.model === 'text-b') {
              yield { delta: { text: 'partial' } }
              return // 流中断，没有 finish chunk
            }
            yield { delta: { text: 'pong' } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      },
    },
    agents: { list: () => [] },
    sessionController: { agents: {} },
    sessionProjections: { stateOf: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'alpha', model: 'text-a' }) },
  }
  let handler = null
  return {
    probes,
    setFailMmA: (v) => { failMmA = v },
    get handler() {
      return handler
    },
    ctx: {
      get: (name) => services[name],
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

const host = makeHost()

// ④ fail-closed 持久化测试：apply 前预置一份上次的暂不可用记录，
// 用以验证「重启后沿用上次结果」的回填路径，以及探测后写回刷新。
const presetKey = 'preset/preset-1'
mkdirSync(dirname(__test.probeFile), { recursive: true })
writeFileSync(__test.probeFile, JSON.stringify({ savedAt: 1, keys: [presetKey] }), 'utf8')

apply(host.ctx, { maxRetries: 1, retryDelayMs: 0, hiddenModels: ['alpha/a-hide-1'] })

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
  return { status: res.status, text, json }
}

const post = (body, extra = {}) => call(`${ROUTE}/test-model`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN, referer: `${ORIGIN}/`, ...(extra.headers ?? {}) },
  body: JSON.stringify(body),
})

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
try {
  await call(`${ROUTE}/catalog?refresh=1`) // 先把目录建起来

  // ④ fail-closed 持久化：apply 前的预置记录应被回填进暂不可用集合
  {
    const keys = __test.probeUnavailableKeys()
    check('④ 预置持久化记录被回填进暂不可用集合', keys.includes(presetKey), JSON.stringify(keys))
  }

  // ④ fail-closed 持久化：runScheduledProbe 之后应把当前集合写回磁盘并刷新时间戳
  {
    const before = JSON.parse(readFileSync(__test.probeFile, 'utf8'))
    await __test.runScheduledProbe()
    const after = JSON.parse(readFileSync(__test.probeFile, 'utf8'))
    check('④ 探测后持久化文件已刷新（savedAt 被更新）', typeof after.savedAt === 'number' && after.savedAt !== before.savedAt, JSON.stringify(after))
    check('④ 探测后持久化文件含当前暂不可用键', Array.isArray(after.keys) && after.keys.includes(presetKey), JSON.stringify(after))
  }

  // 0) 隐藏模型（hidden）不应进定时探测队列，也不应进暂不可用集合
  {
    await __test.runScheduledProbe()
    check('隐藏模型不应进探测队列', !host.probes.some((p) => p.model === 'a-hide-1'), JSON.stringify(host.probes))
    check('隐藏模型不应进暂不可用集合', !__test.probeUnavailableKeys().includes(modelKey('alpha', 'a-hide-1')), JSON.stringify(__test.probeUnavailableKeys()))
  }

  // 1) 成功路径：text-a 返回 ok:true + ms + sample
  {
    const r = await post({ provider: 'alpha', model: 'text-a' })
    check('成功路径 200 ok:true 且 ms>0', r.status === 200 && r.json?.ok === true && typeof r.json?.ms === 'number' && r.json.ms >= 0, JSON.stringify(r.json))
    check('成功路径带 sample 片段', r.json?.sample === 'pong', JSON.stringify(r.json))
    check('成功路径已真实调用 prepareCall（maxTokens=32）', host.probes.at(-1)?.maxTokens === 32 && host.probes.at(-1)?.model === 'text-a', JSON.stringify(host.probes.at(-1)))
    check('成功探测不加入暂不可用集合', !__test.probeUnavailableKeys().includes(modelKey('alpha', 'text-a')), JSON.stringify(__test.probeUnavailableKeys()))
  }

  // 2) 失败路径：mm-a 上游 401 → ok:false + error 原文
  {
    const r = await post({ provider: 'alpha', model: 'mm-a' })
    check('失败路径 200 ok:false 且带上游错误原文', r.status === 200 && r.json?.ok === false && String(r.json?.error ?? '').includes('401'), JSON.stringify(r.json))
    check('失败探测加入暂不可用集合', __test.probeUnavailableKeys().includes(modelKey('alpha', 'mm-a')), JSON.stringify(__test.probeUnavailableKeys()))
    host.setFailMmA(false)
    {
      const r2 = await post({ provider: 'alpha', model: 'mm-a' })
      check('重测通过自动移出暂不可用集合', r2.status === 200 && r2.json?.ok === true && !__test.probeUnavailableKeys().includes(modelKey('alpha', 'mm-a')), JSON.stringify(r2.json))
    }
  }

  // 3) 流中断：text-b 只有内容片没有 finish → 判定可用（模型确实响应了）
  {
    const r = await post({ provider: 'beta', model: 'text-b' })
    check('流中断但有内容片 → ok:true（模型真实响应过）', r.status === 200 && r.json?.ok === true && r.json?.sample === 'partial', JSON.stringify(r.json))
  }

  // 4) 目录外模型 404
  {
    const r = await post({ provider: 'alpha', model: 'ghost' })
    check('目录外模型 404', r.status === 404 && r.json?.error === 'model not in catalog', `${r.status} ${r.text.slice(0, 120)}`)
  }

  // 5) 跨源 403
  {
    const r = await post({ provider: 'alpha', model: 'text-a' }, { headers: { origin: 'http://evil.example', referer: 'http://evil.example/' } })
    check('跨源请求 403', r.status === 403, `${r.status} ${r.text.slice(0, 120)}`)
  }

  // 6) 缺参数 400
  {
    const r = await post({ provider: 'alpha' })
    check('缺 model 参数 400', r.status === 400, `${r.status} ${r.text.slice(0, 120)}`)
  }

  console.log(failures.length === 0 ? `\n全部通过：${passed} 项` : `\n失败 ${failures.length} 项`)
  process.exit(failures.length === 0 ? 0 : 1)
} finally {
  server.close()
}
