#!/usr/bin/env node
/**
 * 只读探针：真实打开 DSH GUI，dump 侧边栏「设置入口」相关 DOM，找出跳转失败的真因。
 *
 * 不做任何修改，只采集：
 *   1) 本插件齿轮按钮是否在页面上；
 *   2) 宿主 settings.launcher 槽当前渲染的是什么（data-slot / triggerRow / aria-label）；
 *   3) 全部 button 的 aria-label / aria-haspopup 清单；
 *   4) 点「账号菜单」后弹出的菜单项文本与 role；
 *   5) 点齿轮后 beacon 里落的是哪个 step。
 *
 * 用法：node scripts/probe-settings-dom.mjs [--url http://127.0.0.1:PORT] [--keep-open]
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
const ROUTE_PREFIX = 'dsh-model-auto-select'
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
const hasFlag = (name) => process.argv.includes(`--${name}`)
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

const out = {}
const { chromium } = loadPlaywright()
mkdirSync(WORK_DIR, { recursive: true })
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--disable-gpu'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })

try {
  await context.addCookies([{ ...makeCookie(readSecret()), domain: '127.0.0.1', path: '/', httpOnly: true }])
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[console.error] ${msg.text().slice(0, 200)}`) })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  out.title = await page.title()
  await dismissOverlays(page)
  await page.waitForTimeout(1500)

  // ── 1) 本插件齿轮按钮
  out.gear = await page.evaluate(() => {
    const btn = document.querySelector('[data-mas-settings-toggle]')
    if (btn === null) return { present: false }
    const rect = btn.getBoundingClientRect()
    return {
      present: true,
      aria: btn.getAttribute('aria-label'),
      parentCls: btn.parentElement?.className ?? '',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    }
  })

  // ── 2) settings.launcher 槽渲染了什么
  out.launcherSlot = await page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll('[data-slot="settings.launcher"]'))
    const rows = Array.from(document.querySelectorAll('[class*="triggerRow"]'))
    return {
      slotCount: slots.length,
      slotDesc: slots.map((s) => ({
        cls: s.className,
        childTags: Array.from(s.children).map((c) => `${c.tagName}.${c.className}`.slice(0, 120)),
        childAria: Array.from(s.querySelectorAll('button')).map((b) => ({
          aria: b.getAttribute('aria-label'),
          haspopup: b.getAttribute('aria-haspopup'),
          cls: (b.className ?? '').slice(0, 80),
        })),
      })),
      triggerRowCount: rows.length,
      triggerRowDesc: rows.map((r) => ({
        cls: r.className.slice(0, 120),
        buttons: Array.from(r.querySelectorAll('button')).map((b) => ({
          aria: b.getAttribute('aria-label'),
          haspopup: b.getAttribute('aria-haspopup'),
          cls: (b.className ?? '').slice(0, 60),
        })),
      })),
    }
  })

  // ── 3) 全页 button 清单（截断）
  out.buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .filter((b) => b.offsetParent !== null)
    .slice(0, 60)
    .map((b) => ({
      aria: (b.getAttribute('aria-label') ?? '').slice(0, 40),
      haspopup: b.getAttribute('aria-haspopup'),
      text: (b.textContent ?? '').trim().slice(0, 20),
      cls: (b.className ?? '').slice(0, 50),
      own: b.hasAttribute('data-mas-own') || b.hasAttribute('data-mas-settings-toggle'),
    })))

  // ── 4) 点「账号菜单」看弹出什么
  out.accountMenu = await page.evaluate(() => {
    const want = ['账号菜单', 'Account menu']
    const trigger = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
      .find((b) => want.includes((b.getAttribute('aria-label') ?? '').trim()))
    if (trigger === undefined) return { found: false }
    trigger.click()
    return { found: true, aria: trigger.getAttribute('aria-label') }
  })
  await page.waitForTimeout(1200)
  out.menuItems = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], [role="menu"] button'))
    return {
      count: items.length,
      list: items.slice(0, 20).map((i) => ({
        role: i.getAttribute('role'),
        text: (i.textContent ?? '').trim().slice(0, 24),
        tag: i.tagName,
      })),
    }
  })

  // 关掉菜单（再点一次 trigger）
  await page.evaluate(() => {
    const want = ['账号菜单', 'Account menu']
    const trigger = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
      .find((b) => want.includes((b.getAttribute('aria-label') ?? '').trim()))
    trigger?.click()
  })
  await page.waitForTimeout(800)

  // ── 5) 点齿轮，看是否进设置页 + beacon
  out.gearClick = await page.evaluate(() => {
    const btn = document.querySelector('[data-mas-settings-toggle]')
    if (btn === null) return { clicked: false }
    btn.click()
    return { clicked: true }
  })
  await page.waitForTimeout(3000)
  out.panel = await page.evaluate(() => {
    const panel = document.querySelector('div[data-shortcut-modal="settings"]')
    if (panel === null) return { open: false }
    const navCells = Array.from(panel.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter((t) => t !== '')
    return {
      open: true,
      navCells: navCells.slice(0, 30),
      optionsHead: (panel.querySelector('[class*="options"]')?.textContent ?? '').trim().slice(0, 200),
    }
  })

  await page.screenshot({ path: join(WORK_DIR, 'probe-settings.png'), fullPage: false })

  // ── 6) beacon
  try {
    const res = await fetch(`${BASE}/${ROUTE_PREFIX}/beacon`, { cache: 'no-store' })
    out.beacon = (await res.json())?.beacons?.slice(-8) ?? []
  } catch (err) { out.beaconError = err.message }

  writeFileSync(join(WORK_DIR, 'probe-settings.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log(JSON.stringify(out, null, 2))

  if (hasFlag('keep-open')) {
    console.log('[keep-open] 浏览器保持打开，Ctrl+C 退出')
    await new Promise((resolve) => setTimeout(resolve, 600000))
  }
} finally {
  if (!hasFlag('keep-open')) {
    await browser.close()
  }
}
