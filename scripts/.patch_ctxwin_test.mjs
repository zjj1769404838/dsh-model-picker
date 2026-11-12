// fail-closed patch: insert server-side contextWindow test between the catalogView
// test's closing `})` and the following panel-grouping comment.
// The file is binary (4 NUL bytes + CRLF), so edit tool refuses it; we patch via Node
// with a unique anchor and write back in latin1 to preserve every NUL/CR/LF byte.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'D:/my-projects/plugins/dsh-model-auto-select/scripts/test-auto-select.mjs'
const buf = readFileSync(path)
const text = buf.toString('latin1')

// unique anchor: end of catalogView test + blank line + start of next comment line
const anchor =
  "  assert.equal(view.config.maxRetries, DEFAULT_CONFIG.maxRetries)\r\n})\r\n\r\n// "

if (!text.includes(anchor)) {
  console.error('ANCHOR_NOT_FOUND')
  process.exit(1)
}

const inject =
  "\n" +
  "// 上下文窗口：宿主只在 resolveModelInfo 结果里披露（context.contextWindow），\n" +
  "// listModels 的 LlmModelInfo 无此字段。fail-closed 验证：buildCatalog→catalogView\n" +
  "// 透传链把该字段送到客户端；且未披露时绝不为 undefined 捏造数据。\n" +
  "function fakeCtxWithContextWindow() {\n" +
  "  const ctx = fakeCtx()\n" +
  "  const llm = ctx.__services.llm\n" +
  "  // text-a 披露上下文窗口；text-b / mm-a 不披露（无 context 字段）\n" +
  "  llm.resolveModelInfo = async (pid, mid) => {\n" +
  "    if (mid === 'text-a') return { provider: pid, id: mid, name: mid, inputModalities: ['text'], context: { contextWindow: 200000 } }\n" +
  "    return { provider: pid, id: mid, name: mid, inputModalities: mid === 'text-b' ? ['text'] : undefined }\n" +
  "  }\n" +
  "  return ctx\n" +
  "}\n" +
  "\n" +
  "await test('node 半边：上下文窗口经 resolveModelInfo 透传至 snapshot 与 catalogView', async () => {\n" +
  "  const ctx = fakeCtxWithContextWindow()\n" +
  "  nodeSide.reset()\n" +
  "  nodeSide.setContext(ctx, {})\n" +
  "  const snapshot = await nodeSide.getCatalog(true)\n" +
  "  const snapById = Object.fromEntries(snapshot.entries.map((e) => [e.model, e]))\n" +
  "  assert.equal(snapById['text-a'].contextWindow, 200000, 'snapshot 应携带 text-a 的 contextWindow')\n" +
  "  assert.equal(snapById['text-a'].modalitySource, 'listModels', '多模态仍优先用 listModels，不受 resolveModelInfo 补位影响')\n" +
  "  assert.equal(snapById['text-b'].contextWindow, undefined, '未披露 context 的模型不得出现 contextWindow 字段')\n" +
  "\n" +
  "  const view = nodeSide.catalogView(snapshot)\n" +
  "  const viewById = Object.fromEntries(view.entries.map((e) => [e.model, e]))\n" +
  "  assert.equal(viewById['text-a'].contextWindow, 200000, 'catalogView 必须把 contextWindow 转发给客户端（此前漏字段导致下拉不可见）')\n" +
  "  assert.equal(viewById['text-b'].contextWindow, undefined, 'catalogView 未披露模型同样不得捏造 contextWindow')\n" +
  "})\n"

const replaced = text.replace(anchor, anchor + inject)
if (replaced === text) {
  console.error('REPLACE_FAILED')
  process.exit(1)
}

// brace balance sanity on injected segment
let depth = 0
for (const ch of inject) { if (ch === '{') depth++; else if (ch === '}') depth-- }
if (depth !== 0) {
  console.error('BRACE_IMBALANCE', depth)
  process.exit(1)
}

writeFileSync(path, Buffer.from(replaced, 'latin1'))
console.log('PATCHED_OK')
