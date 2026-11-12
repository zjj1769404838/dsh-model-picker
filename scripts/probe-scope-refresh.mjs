#!/usr/bin/env node
/**
 * 真机验证探针（只读 + 一次「重新获取」点击）：
 *   1) 打开 DSH GUI，进本插件设置页；
 *   2) 断言「自动切换范围」是 SELECT、三档 options、默认回显 group-cross；
 *   3) 点「重新获取」，等状态行落定，断言不再停在「正在重新获取模型列表…」；
 *   4) 记录点击时实际发出的 /catalog 请求 URL（是否带 refresh=1）。
 *
 * 用法：node scripts/probe-scope-refresh.mjs [--url http://127.0.0.1:PORT]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, createHmac } from 'node:crypto'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(HERE)
const WORK_DIR = join(PLUGIN_ROOT, '.work')

const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]

const PLAYWRIGHT_CANDIDATES = [
  join(PLUGIN_ROOT, 'node_modules', 'playwright-core'),
  'D:/my-projects/plugins/dsh-git-panel/node_modules/playwright-core',
  'D:/my-projects/plugins/dsh-prompt-optimizer/node_modules/playwright-core',
]

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  return fallback
}

const BASE = arg('url', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:62984')
const authority = new URL(BASE).host

function b64u(value) {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function readSecret() {
  const file = join(homedir(), '.dsh', '.credentials.yaml')
  if (!existsSync(file)) throw new Error(`找不到凭据文件：${file}`)
  const text = readFileSync(file, 'utf8')
  const match = text.match(/client-connection\/browser-session:[\s\S]{0,200}?secret:\s*(\S+)/)
  if (match === null) throw new Error('凭据文件里没有 client-connection/browser-session.secret')
  return Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
}

function makeCookie(secret) {
  const now = Date.now()
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 7 * 86400000 }
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = b64u(createHmac('sha256', secret).update(body).digest())
  return {
    name: 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest()),
    value: `v1.${body}.${signature}`,
  }
}

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('找不到可用的 Edge/Chrome')
}

function loadPlaywright() {
  const require_ = createRequire(join(PLUGIN_ROOT, 'noop.js'))
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try {
      const resolved = require_.resolve(join(candidate, 'index.js'))
      const mod = require_(resolved)
      if (mod?.chromium) return mod
    } catch { /* 试下一个 */ }
  }
  const mod = require_('playwright-core')
  if (!mod?.chromium) throw new Error('playwright-core 里没有 chromium 导出')
  return mod
}

async function dismissOverlays(page) {
  for (let round = 0; round < 6; round += 1) {
    const acted = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
        .filter((d) => d.offsetParent !== null || getComputedStyle(d).position === 'fixed')
      if (dialogs.length === 0) return ''
      const boxes = dialogs.flatMap((d) => Array.from(d.querySelectorAll('input[type="checkbox"]')))
        .filter((c) => c.checked !== true)
      if (boxes.length > 0) { boxes.forEach((c) => c.click()); return `tick(${boxes.length})` }
      const want = /^(我已知晓并继续|我已知晓|同意|我知道了|跳过向导|跳过|关闭|Close|Skip|Got it|OK)$/i
      const hit = Array.from(document.querySelectorAll('button'))
        .filter((b) => b.offsetParent !== null)
        .find((b) => want.test((b.textContent ?? '').trim()))
      if (hit !== undefined) { hit.click(); return `click:${(hit.textContent ?? '').trim()}` }
      dialogs.forEach((d) => d.remove())
      return 'remove-dialog'
    })
    if (acted === '') break
    await page.waitForTimeout(900)
  }
}

const out = { base: BASE, checks: [] }
function check(name, ok, detail) {
  out.checks.push({ name, ok, detail: String(detail ?? '') })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` → ${detail}`}`)
}

const { chromium } = loadPlaywright()
mkdirSync(WORK_DIR, { recursive: true })
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--disable-gpu'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const catalogHits = []

try {
  await context.addCookies([{ ...makeCookie(readSecret()), domain: '127.0.0.1', path: '/', httpOnly: true }])
  const page = await context.newPage()
  page.on('request', (req) => {
    if (req.url().includes('/catalog')) catalogHits.push(req.url().replace(BASE, ''))
  })
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[console.error] ${msg.text().slice(0, 200)}`) })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await dismissOverlays(page)
  await page.waitForTimeout(1200)

  // 打开设置页
  out.gear = await page.evaluate(() => document.querySelector('[data-mas-settings-toggle]') !== null)
  check('本插件齿轮按钮存在', out.gear === true)
  if (out.gear === true) {
    await page.click('[data-mas-settings-toggle]')
    // 点完齿轮**不能再 dismissOverlays**：设置面板本身就是 role=dialog，会被当成遮罩删掉。
    await page.waitForTimeout(3000)
  }

  // 设置页正文出现
  const bodyText = await page.evaluate(() => document.body.innerText)
  check('设置页出现「模型自动选择」', bodyText.includes('模型自动选择'))
  check('设置页出现「自动切换范围」', bodyText.includes('自动切换范围'))

  // 自动切换范围下拉
  const scope = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'))
    const hit = selects.find((s) => Array.from(s.options).some((o) => o.value === 'group-cross'))
    if (hit === undefined) return { found: false, selects: selects.length }
    return {
      found: true,
      value: hit.value,
      options: Array.from(hit.options).map((o) => o.value),
      labels: Array.from(hit.options).map((o) => o.textContent.trim()),
      rect: hit.getBoundingClientRect().height,
    }
  })
  check('「自动切换范围」是 SELECT 且含 group-cross', scope.found === true, JSON.stringify(scope.options ?? scope.selects))
  check('三档选项齐备', Array.isArray(scope.options) && scope.options.length === 3
    && scope.options.join(',') === 'group,group-cross,all', (scope.options ?? []).join(','))
  check('默认回显 group-cross', scope.value === 'group-cross', scope.value)

  // 改一下再改回来，确认可交互且进草稿
  if (scope.found === true) {
    await page.evaluate(() => {
      const hit = Array.from(document.querySelectorAll('select'))
        .find((s) => Array.from(s.options).some((o) => o.value === 'group-cross'))
      hit.value = 'group'
      hit.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForTimeout(600)
    const after = await page.evaluate(() => document.body.innerText)
    check('改动后出现未保存提示', /未保存/.test(after))
    await page.evaluate(() => {
      const hit = Array.from(document.querySelectorAll('select'))
        .find((s) => Array.from(s.options).some((o) => o.value === 'group-cross'))
      hit.value = 'group-cross'
      hit.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForTimeout(600)
  }

  // 点「重新获取」
  const before = await page.evaluate(() => {
    const bar = document.querySelector('[data-mas-topbar]')
    return bar === null ? '' : bar.innerText
  })
  out.statusBefore = before
  await page.evaluate(() => {
    const btn = document.querySelector('[data-mas-retry]')
    if (btn !== null) btn.click()
  })
  await page.waitForTimeout(4000)
  const afterStatus = await page.evaluate(() => {
    const bar = document.querySelector('[data-mas-topbar]')
    return bar === null ? '' : bar.innerText
  })
  out.statusAfter = afterStatus
  out.catalogHits = catalogHits
  check('点击后状态行不再停在「正在重新获取模型列表…」', !afterStatus.includes('正在重新获取模型列表'))
  check('状态行落定为「已刷新模型列表」或「模型列表刷新失败」',
    /已刷新模型列表|模型列表刷新失败/.test(afterStatus), afterStatus.split('\n').slice(-2).join(' | '))
  check('强制刷新请求带 ?refresh=1', catalogHits.some((u) => u.includes('refresh=1')), catalogHits.join(' ; '))
} catch (err) {
  check('探针整体执行', false, String(err?.message ?? err))
} finally {
  writeFileSync(join(WORK_DIR, 'probe-scope-refresh.json'), JSON.stringify(out, null, 2), 'utf8')
  await context.close()
  await browser.close()
}

const failed = out.checks.filter((c) => c.ok !== true)
console.log(failed.length === 0 ? `\n全部通过：${out.checks.length} 项` : `\n失败 ${failed.length} 项`)
process.exit(failed.length === 0 ? 0 : 1)
