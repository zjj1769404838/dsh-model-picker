import { readFileSync } from 'node:fs'
const t = readFileSync('D:/my-projects/plugins/dsh-model-auto-select/scripts/test-auto-select.mjs')
const s = t.toString('latin1')
let nul = 0
for (const b of t) if (b === 0) nul++
console.log('nulCount', nul)
const i = s.indexOf('fakeCtxWithContextWindow')
console.log('foundInjection', i)
console.log(JSON.stringify(s.slice(i - 20, i + 260)))
// confirm anchor comment still present right after the injected block closes
const j = s.indexOf("// ───────────────────── 面板分组")
console.log('panelCommentAt', j)
console.log('commentSnippet', JSON.stringify(s.slice(j, j + 60)))
