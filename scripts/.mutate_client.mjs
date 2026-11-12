// Mutation self-check helper for the contextWindow client guard.
// Reads lib/client.js, flips `if (row.contextWindow !== void 0)` -> `if (false)`,
// writes UTF-8, and verifies the guard is now dead. Backup handled by caller shell.
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'D:/my-projects/plugins/dsh-model-auto-select/lib/client.js'
const s = readFileSync(p, 'utf8')
if (!s.includes('if (row.contextWindow !== void 0)')) { console.error('GUARD_NOT_FOUND'); process.exit(1) }
const mutated = s.replace('if (row.contextWindow !== void 0) {', 'if (false) {')
if (mutated === s) { console.error('NO_CHANGE'); process.exit(1) }
writeFileSync(p, mutated, 'utf8')
console.log('MUTATED')
