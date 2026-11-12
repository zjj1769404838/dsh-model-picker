// 让「脱离宿主进程」运行的冒烟脚本也能解析 @deepseek-ai/*（模拟 profile 的宿主包路由）。
// 用法：node --import ./scripts/host-resolve.mjs scripts/smoke-http.mjs
import { register } from 'node:module'

register('./host-resolve-hooks.mjs', import.meta.url)
