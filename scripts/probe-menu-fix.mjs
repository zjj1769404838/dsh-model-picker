#!/usr/bin/env node
/**
 * 只读验证：确认「账号菜单 → 菜单项『设置』」这条路径在真机上能否打开设置面板，
 * 以及修正后的菜单项匹配规则（前缀匹配，而不是整串相等）是否命中。
 *
 * 背景：MenuItemButton 会把快捷键提示拼进同一个 button 的 textContent，
 * 真机读到的是 `设置Ctrl+Alt+,`，所以 `textContent.trim() === '设置'` 永远不成立。
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
const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:62984'
const authority = new URL(BASE).host

const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
const PLAYWRIGHT_CANDIDATES = [
  join(PLUGIN_ROOT, 'node_modules', 'playwright-core'),
  'D:/my-projects/plugins/dsh-git-panel/node_modules/playwright-core',
]

const b64u = (v) => Buffer.from(v).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

function readSecret() {
  const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
  const m = text.match(/client-connection\/browser-session:[\s\S]{0,200}?secret:\s*(\S+)/)
  if (m === null) throw new Error('no secret')
  return Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
}

function makeCookie(secret) {
  const now = Date.now()
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 7 * 86400000 }
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64u(createHmac('sha256', secret).update(body).digest())
  return { name: 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest()), value: `v1.${body}.${sig}` }
}

function findBrowser() {
  for (const c of BROWSER_CANDIDATES) if (existsSync(c)) return c
  throw new Error('no browser')
}
function loadPlaywright() {
  const req = createRequire(join(PLUGIN_ROOT, 'noop.js'))
  for (const c of PLAYWRIGHT_CANDIDATES) {
    try { const r = req.resolve(join(c, 'index.js')); const m = req(r); if (m?.chromium) return m } catch { /* next */ }
  }
  return req('playwright-core')
}

async function dismissOverlays(page) {
  for (let i = 0; i < 6; i += 1) {
    const acted = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
        .filter((d) => d.offsetParent !== null || getComputedStyle(d).position === 'fixed')
      if (dialogs.length === 0) return ''
      const boxes = dialogs.flatMap((d) => Array.from(d.querySelectorAll('input[type="checkbox"]'))).filter((c) => c.checked !== true)
      if (boxes.length > 0) { boxes.forEach((c) => c.click()); return 'tick' }
      const want = /^(我已知晓并继续|我已知晓|同意|我知道了|跳过向导|跳过|关闭|Close|Skip|Got it|OK)$/i
      const hit = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null).find((b) => want.test((b.textContent ?? '').trim()))
      if (hit !== undefined) { hit.click(); return 'click' }
      dialogs.forEach((d) => d.remove()); return 'remove'
    })
    if (acted === '') break
    await page.waitForTimeout(900)
  }
}

const result = {}
mkdirSync(WORK_DIR, { recursive: true })
const { chromium } = loadPlaywright()
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--disable-gpu'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
try {
  await context.addCookies([{ ...makeCookie(readSecret()), domain: '127.0.0.1', path: '/', httpOnly: true }])
  const page = await context.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  await dismissOverlays(page)
  await page.waitForTimeout(1200)

  // 1) 点账号菜单
  result.openMenu = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
      .find((b) => ['账号菜单', 'Account menu'].includes((b.getAttribute('aria-label') ?? '').trim()))
    if (t === undefined) return false
    t.click(); return true
  })
  await page.waitForTimeout(1000)

  // 2) 列出菜单项及其子结构（看清楚 label 与快捷键怎么拼的）
  result.items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map((i) => ({
    text: (i.textContent ?? '').trim(),
    spans: Array.from(i.querySelectorAll('span')).map((s) => ({ cls: s.className.slice(0, 40), text: (s.textContent ?? '').trim() })),
    tag: i.tagName,
  })))

  // 3) 用「前缀匹配」点设置项
  result.clicked = await page.evaluate(() => {
    const labels = ['设置', 'Settings']
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
    const target = items.find((i) => {
      const t = (i.textContent ?? '').trim()
      return labels.some((l) => t.startsWith(l))
    })
    if (target === undefined) return { hit: false, texts: items.map((i) => (i.textContent ?? '').trim()) }
    target.click()
    return { hit: true, text: (target.textContent ?? '').trim() }
  })
  await page.waitForTimeout(2500)

  // 4) 面板是否打开 + 导航项
  result.panel = await page.evaluate(() => {
    const p = document.querySelector('div[data-shortcut-modal="settings"]')
    if (p === null) return { open: false }
    const cells = Array.from(p.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter((t) => t !== '')
    return { open: true, cells: cells.slice(0, 40) }
  })

  // 5) 若有「模型自动选择」导航项，点它并截屏
  if (result.panel.open === true) {
    result.nav = await page.evaluate(() => {
      const p = document.querySelector('div[data-shortcut-modal="settings"]')
      const rows = Array.from(p.querySelectorAll('button'))
      const target = rows.find((r) => (r.querySelector('span')?.textContent ?? r.textContent ?? '').trim() === '模型自动选择')
      if (target === undefined) return { hit: false, labels: rows.map((r) => (r.querySelector('span')?.textContent ?? r.textContent ?? '').trim()) }
      target.click(); return { hit: true }
    })
    await page.waitForTimeout(1500)
    result.sectionHead = await page.evaluate(() => {
      const p = document.querySelector('div[data-shortcut-modal="settings"]')
      const opt = p?.querySelector('[class*="options"]')
      return (opt?.textContent ?? '').trim().slice(0, 400)
    })
    await page.screenshot({ path: join(WORK_DIR, 'probe-settings-open.png') })
  }

  writeFileSync(join(WORK_DIR, 'probe-menu.json'), JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
