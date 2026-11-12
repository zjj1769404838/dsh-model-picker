/**
 * 构建脚本：node 半边（ESM，platform=node）+ 客户端半边（CJS 包裹在 __ModuleLoader__ 里）。
 * 用法：node scripts/build.mjs [--watch]
 */
import { readFileSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const outdir = resolve(root, 'lib')

const watch = process.argv.includes('--watch')

/**
 * 定位 @deepseek-ai/schemastery 的 ESM 入口，供 esbuild 内联进产物。
 * 为什么必须内联：插件在 profile 里是 link: 依赖 + junction，Node 解析 bare specifier
 * 时以「插件自身目录」为基座，穿透不到 profile 的 node_modules，留成 external 会让
 * 宿主加载时抛 Cannot find package '@deepseek-ai/schemastery'。
 * 为什么不能直接 `external: ['@deepseek-ai/*']`：那会把 schemastery 也留成外部依赖。
 */
const SCHEMASTER_CANDIDATES = [
  process.env.DSH_SCHEMASTER_PATH,
  'C:/Users/zjj/.dsh/profiles/desktop/node_modules/@deepseek-ai/schemastery',
  'D:/apps/dsh-desktop/resources/app/dsh/node_modules/@deepseek-ai/schemastery',
]
function locateSchemastery() {
  for (const dir of SCHEMASTER_CANDIDATES) {
    if (!dir) continue
    for (const entry of ['lib/index.mjs', 'lib/index.cjs']) {
      try {
        const abs = resolve(dir, entry)
        readFileSync(abs)
        return abs
      } catch {
        /* 试下一个入口 */
      }
    }
  }
  throw new Error(
    '找不到 @deepseek-ai/schemastery，请设置 DSH_SCHEMASTER_PATH 指向其目录（含 lib/index.mjs）',
  )
}
const schemasteryEntry = locateSchemastery()

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

/** node 半边：宿主用 ESM import，core.js 作为独立模块一起产出。 */
const nodeConfig = {
  entryPoints: [resolve(root, 'src/index.ts'), resolve(root, 'src/core.ts')],
  outdir,
  platform: 'node',
  format: 'esm',
  target: ['es2022'],
  bundle: true,
  // 宿主服务包（@deepseek-ai/dsh-*）由 profile 的 node_modules 在运行期提供，不打进产物。
  // 注意：@deepseek-ai/schemastery 必须打进产物 —— 插件目录是 link: 依赖 + junction，
  // Node 按插件自身目录为基座解析 bare specifier，穿透不到 profile 的 node_modules，
  // 留成 external 会在宿主加载时抛 `Cannot find package '@deepseek-ai/schemastery'`。
  external: ['@deepseek-ai/dsh-*'],
  // schemastery 走 alias 内联（见 locateSchemastery 注释）
  alias: { '@deepseek-ai/schemastery': schemasteryEntry },
  sourcemap: false,
  logLevel: 'info',
}

/** 客户端半边：宿主以 CJS 工厂函数装载，react 必须 external。 */
const clientConfig = {
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile: resolve(outdir, 'client.js'),
  platform: 'browser',
  format: 'cjs',
  target: ['es2020'],
  bundle: true,
  external: ['react'],
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
}

if (watch) {
  const nodeCtx = await esbuild.context(nodeConfig)
  const clientCtx = await esbuild.context(clientConfig)
  await nodeCtx.watch()
  await clientCtx.watch()
  console.log('[build] watching…')
} else {
  await esbuild.build(nodeConfig)
  await esbuild.build(clientConfig)
  console.log(`[build] ${pkg.name}@${pkg.version} → lib/index.js, lib/core.js, lib/client.js`)
}
