// 宿主包解析垫片：把 @deepseek-ai/* 指到本机 dsh 运行时的 node_modules，
// 让脱离宿主进程运行的冒烟脚本能像真实宿主一样解析 appendPluginRecord / schemastery 等 API。
// 仅在测试脚本里用 --import 加载，不进入插件产物。
//
// 解析顺序（逐个试，命中即用）：
//   1) 显式子路径（specifier 里带了 /lib/xxx）
//   2) 包自己的 package.json exports["."]（import / require 两种条件）
//   3) 兜底 lib/index.js → lib/index.mjs → lib/index.cjs
// schemastery 只有 lib/index.mjs 与 lib/index.cjs，没有 lib/index.js，所以第 3 步必须全试。
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

// 解析顺序：显式 DSH_HOST_ROOT → 宿主安装目录 → 项目内重建的最小 host root。
// 后两者是「临时解压目录被系统清理」后的回退（真机 m02756 实证）：
// `node scripts/build-host-root.cjs` 可从 app.asar 重建 tmp/host-root。
const PROJECT_HOST_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp', 'host-root')
const HOST_ROOT =
  [process.env.DSH_HOST_ROOT, 'D:/apps/dsh-desktop/resources/app/dsh', PROJECT_HOST_ROOT]
    .filter(Boolean)
    .find((root) => existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-session')))
  ?? process.env.DSH_HOST_ROOT
  ?? 'D:/apps/dsh-desktop/resources/app/dsh'
const FALLBACK_ENTRIES = ['/lib/index.js', '/lib/index.mjs', '/lib/index.cjs', '/index.js']

function pickExport(exportsField, condition) {
  if (typeof exportsField === 'string') return exportsField
  if (exportsField === null || typeof exportsField !== 'object') return null
  const root = exportsField['.'] ?? exportsField
  if (typeof root === 'string') return root
  if (root === null || typeof root !== 'object') return null
  const value = root[condition] ?? root.import ?? root.require ?? root.default
  return typeof value === 'string' ? value : null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/')) {
    const parts = specifier.split('/')
    const pkg = parts.slice(0, 2).join('/')
    const rest = specifier.slice(pkg.length)
    const pkgDir = join(HOST_ROOT, 'node_modules', pkg)
    if (existsSync(pkgDir)) {
      const candidates = []
      if (rest.length > 0) candidates.push(rest)
      else {
        const manifestPath = join(pkgDir, 'package.json')
        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
            const entry = pickExport(manifest.exports, 'import') ?? pickExport(manifest.exports, 'require') ?? manifest.module ?? manifest.main
            if (typeof entry === 'string') candidates.push(entry)
          } catch {
            /* 包清单坏了就走兜底 */
          }
        }
        candidates.push(...FALLBACK_ENTRIES)
      }
      for (const candidate of candidates) {
        const target = join(pkgDir, candidate)
        if (existsSync(target)) return { url: pathToFileURL(target).href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}
