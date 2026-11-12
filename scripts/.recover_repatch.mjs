// Recovery + clean repatch for scripts/test-auto-select.mjs.
// The earlier .patch_ctxwin_test.mjs used Buffer.from(replaced,'latin1'), which truncated
// Chinese chars (>0xFF) to their low byte and injected stray control/LF bytes, corrupting
// the file. Original bytes outside my injected block are intact (NUL count preserved at 4).
//
// Recovery: the original panel comment `// ──面板分组...` is untouched UTF-8 in the file
// (only my injected Chinese was corrupted). We find its UTF-8 byte offset in the raw Buffer,
// then rebuild the EXACT original as prefix (ending at anchorEnd) + intact tail, and finally
// re-insert an ASCII-only test. Writing back latin1 preserves every original byte.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'D:/my-projects/plugins/dsh-model-auto-select/scripts/test-auto-select.mjs'
const buf = readFileSync(path)
const cur = buf.toString('latin1')

const anchor = "  assert.equal(view.config.maxRetries, DEFAULT_CONFIG.maxRetries)\r\n})\r\n\r\n// "
const L = cur.indexOf(anchor)
if (L < 0) { console.error('ANCHOR_NOT_FOUND'); process.exit(1) }
const anchorEnd = L + anchor.length // right after the panel comment's "// "

const idxFake = cur.indexOf('fakeCtxWithContextWindow')
if (idxFake < 0) { console.error('INJECT_NOT_FOUND'); process.exit(1) }

// locate the intact original panel comment via its UTF-8 byte sequence in the raw buffer
// (search for the Chinese part only; the exact count of preceding box-drawing dashes varies)
const tailBytes = Buffer.from('面板分组', 'utf8')
const idxTail = buf.indexOf(tailBytes, idxFake)
if (idxTail < 0) { console.error('PANEL_TAIL_NOT_FOUND'); process.exit(1) }

// reconstruct the pristine original (everything outside my injected block)
const original = cur.slice(0, anchorEnd) + cur.slice(idxTail)
if (original.indexOf('fakeCtxWithContextWindow') !== -1) { console.error('RECOVERY_FAILED_STILL_PRESENT'); process.exit(1) }

// byte sanity: original must keep the 4 NULs and must NOT contain my block
let nul = 0
for (const b of Buffer.from(original, 'latin1')) if (b === 0) nul++
if (nul !== 4) { console.error('NUL_COUNT_WRONG', nul); process.exit(1) }

const cleanInject =
  "\n" +
  "// Context window: host discloses it only via resolveModelInfo result (.context.contextWindow);\n" +
  "// listModels LlmModelInfo carries no such field. Fail-closed: buildCatalog -> catalogView must\n" +
  "// forward it, and must never fabricate a value when the host does not disclose one.\n" +
  "function fakeCtxWithContextWindow() {\n" +
  "  const ctx = fakeCtx()\n" +
  "  const llm = ctx.__services.llm\n" +
  "  // text-a discloses a context window; text-b / mm-a do not (no context field)\n" +
  "  llm.resolveModelInfo = async (pid, mid) => {\n" +
  "    if (mid === 'text-a') return { provider: pid, id: mid, name: mid, inputModalities: ['text'], context: { contextWindow: 200000 } }\n" +
  "    return { provider: pid, id: mid, name: mid, inputModalities: mid === 'text-b' ? ['text'] : undefined }\n" +
  "  }\n" +
  "  return ctx\n" +
  "}\n" +
  "\n" +
  "await test('node side: context window forwarded from resolveModelInfo into snapshot and catalogView', async () => {\n" +
  "  const ctx = fakeCtxWithContextWindow()\n" +
  "  nodeSide.reset()\n" +
  "  nodeSide.setContext(ctx, {})\n" +
  "  const snapshot = await nodeSide.getCatalog(true)\n" +
  "  const snapById = Object.fromEntries(snapshot.entries.map((e) => [e.model, e]))\n" +
  "  assert.equal(snapById['text-a'].contextWindow, 200000, 'snapshot should carry text-a contextWindow')\n" +
  "  assert.equal(snapById['text-a'].modalitySource, 'listModels', 'multimodal still prefers listModels, not resolveModelInfo')\n" +
  "  assert.equal(snapById['text-b'].contextWindow, undefined, 'undisclosed model must not carry contextWindow')\n" +
  "\n" +
  "  const view = nodeSide.catalogView(snapshot)\n" +
  "  const viewById = Object.fromEntries(view.entries.map((e) => [e.model, e]))\n" +
  "  assert.equal(viewById['text-a'].contextWindow, 200000, 'catalogView must forward contextWindow to client (this was the bug that hid it)')\n" +
  "  assert.equal(viewById['text-b'].contextWindow, undefined, 'catalogView must not fabricate contextWindow')\n" +
  "})\n"

const result = original.replace(anchor, anchor + cleanInject)
if (result.indexOf('fakeCtxWithContextWindow') < 0) { console.error('REPATCH_FAILED'); process.exit(1) }

// final NUL check
let nul2 = 0
for (const b of Buffer.from(result, 'latin1')) if (b === 0) nul2++
if (nul2 !== 4) { console.error('FINAL_NUL_WRONG', nul2); process.exit(1) }

writeFileSync(path, Buffer.from(result, 'latin1'))
console.log('RECOVERED_AND_REPATCHED_OK nul=' + nul2)
