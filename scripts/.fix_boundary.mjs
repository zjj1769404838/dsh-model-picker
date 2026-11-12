// Minimal targeted repair: the injected ASCII test block parses fine, but the original
// panel-grouping comment lost its "// " (and box-drawing) prefix, so it now reads a bare
// "面板分组..." line that Node treats as code -> SyntaxError. Fix: ensure the "面板分组"
// occurrence is prefixed by "// ──". Keep test block intact.
// READ and WRITE as UTF-8 (file is UTF-8; latin1 round-trip corrupts CJK). NUL check counts
// actual 0x00 bytes in the raw buffer, not latin1-low-byte of code points.
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'D:/my-projects/plugins/dsh-model-auto-select/scripts/test-auto-select.mjs'
const buf = readFileSync(path)
let nulBefore = 0
for (const b of buf) if (b === 0) nulBefore++
const s = buf.toString('utf8')

const panelIdx = s.indexOf('面板分组')
if (panelIdx < 0) { console.error('PANEL_NOT_FOUND'); process.exit(1) }

const before = s.slice(0, panelIdx)
if (before.endsWith('// ──') || before.endsWith('//─') || before.endsWith('// ')) {
  console.error('PANEL_ALREADY_PREFIXED'); process.exit(1)
}

const repaired = s.slice(0, panelIdx) + '// ──' + s.slice(panelIdx)

if (repaired.indexOf('Context window: host discloses') === -1) { console.error('BLOCK_LOST'); process.exit(1) }

const out = Buffer.from(repaired, 'utf8')
let nulAfter = 0
for (const b of out) if (b === 0) nulAfter++
if (nulAfter !== nulBefore) { console.error('NUL_COUNT_WRONG', nulBefore, nulAfter); process.exit(1) }

writeFileSync(path, out)
console.log('PANEL_PREFIX_FIXED nulBefore=' + nulBefore + ' nulAfter=' + nulAfter)
