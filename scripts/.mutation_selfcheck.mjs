// Mutation self-check for the contextWindow client guard.
// Phase 1: mutate lib/client.js guard -> run test-client-dom.mjs -> expect RED (new assertion fails)
// Phase 2: restore lib/ -> run test-client-dom.mjs -> expect GREEN
// All via child_process so we capture exit codes and never leave lib mutated.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'

const root = 'D:/my-projects/plugins/dsh-model-auto-select'
const libPath = root + '/lib/client.js'
const backup = root + '/.lib_backup_client'

function run(cmd, args) {
  const r = spawnSync('node', [cmd, ...args], { cwd: root, encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// ---- Phase 1: mutate ----
console.log('--- Phase 1: mutate guard -> expect 61/62 (RED) ---')
const orig = readFileSync(libPath, 'utf8')
if (!orig.includes('if (row.contextWindow !== void 0)')) { console.error('GUARD_NOT_FOUND'); process.exit(1) }
const mutated = orig.replace('if (row.contextWindow !== void 0) {', 'if (false) {')
if (mutated === orig) { console.error('NO_CHANGE'); process.exit(1) }
mkdirSync(backup, { recursive: true })
cpSync(root + '/lib', backup, { recursive: true })
writeFileSync(libPath, mutated, 'utf8')

const r1 = run('scripts/test-client-dom.mjs', [])
const redCount = (r1.out.match(/^  ok  /gm) || []).length
const failCount = (r1.out.match(/^  (not ok|fail) /gm) || []).length
console.log('Phase1 exit', r1.code, 'ok=' + redCount, 'fail=' + failCount)
console.log(r1.out.split('\n').filter(l => /context|上下文|fail|not ok|全部|通过/.test(l)).slice(-6).join('\n'))

// ---- Phase 2: restore ----
console.log('\n--- Phase 2: restore lib -> expect 62/62 (GREEN) ---')
rmSync(root + '/lib', { recursive: true, force: true })
cpSync(backup, root + '/lib', { recursive: true })
rmSync(backup, { recursive: true, force: true })

const r2 = run('scripts/test-client-dom.mjs', [])
const greenCount = (r2.out.match(/^  ok  /gm) || []).length
console.log('Phase2 exit', r2.code, 'ok=' + greenCount)
console.log(r2.out.split('\n').filter(l => /context|上下文|全部|通过/.test(l)).slice(-4).join('\n'))

// verdict
const pass = r1.code !== 0 && redCount === 61 && r2.code === 0 && greenCount === 62
console.log('\nMUTATION_SELFCHECK', pass ? 'PASS' : 'FAIL', '(red=' + redCount + '/61, green=' + greenCount + '/62)')
process.exit(pass ? 0 : 1)
