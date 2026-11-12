#!/usr/bin/env node
/**
 * 只读探针：打开宿主「模型」下拉，dump 它实际渲染的分组标题与模型行。
 *
 * 目的：确认用户说的「配置了分组，但下拉框没有生效」到底指哪一层 ——
 *   1) 宿主 composer 的模型下拉（数据源是宿主 buildModelCatalog，插件改不到）；
 *   2) 本插件设置页里的「入组」下拉。
 * 同时采集插件 /catalog 的 groups 与 disabled/hidden 统计，用于对照。
 *
 * 用法：node scripts/probe-model-menu.mjs [--url http://127.0.0.1:PORT] [--keep-open]
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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
  await dismissOverlays(page)
  await page.waitForTimeout(1500)

  // ── 0) 插件 /catalog 真值（用于对照）
  try {
    const res = await fetch(`${BASE}/${ROUTE_PREFIX}/catalog?refresh=1`, { cache: 'no-store' })
    const j = await res.json()
    out.catalog = {
      entries: (j.entries ?? []).length,
      disabled: (j.entries ?? []).filter((e) => e.disabled).length,
      hidden: (j.entries ?? []).filter((e) => e.hidden).length,
      groups: (j.groups ?? []).map((g) => ({ id: g.id, label: g.label, n: (g.keys ?? []).length })),
    }
  } catch (err) { out.catalogError = err.message }

  // ── 1) 找到模型 trigger（aria-label 含「选择模型」）
  out.trigger = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"], button[aria-haspopup]'))
      .find((b) => /选择模型|Select model/i.test(b.getAttribute('aria-label') ?? ''))
    if (btn === undefined) return { found: false }
    const rect = btn.getBoundingClientRect()
    return {
      found: true,
      aria: btn.getAttribute('aria-label'),
      text: (btn.textContent ?? '').trim().slice(0, 60),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    }
  })

  if (out.trigger?.found !== true) {
    console.log('未找到模型 trigger，后续步骤跳过')
  } else {
    // 点开 root pane
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"], button[aria-haspopup]'))
        .find((b) => /选择模型|Select model/i.test(b.getAttribute('aria-label') ?? ''))
      btn?.click()
    })
    await page.waitForTimeout(1200)

    out.rootPane = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menu"] button, [class*="_cell"]'))
        .filter((b) => b.offsetParent !== null)
      return {
        count: cells.length,
        list: cells.slice(0, 12).map((c) => ({ text: (c.textContent ?? '').trim().slice(0, 40), cls: typeof c.className === 'string' ? c.className.slice(0, 60) : '' })),
      }
    })

    // 钻取到「模型」pane（root 行数 < 10 时点第一行）
    if ((out.rootPane?.count ?? 0) < 10) {
      await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[role="menu"] button, [class*="_cell"]'))
          .filter((b) => b.offsetParent !== null)
        cells[0]?.click()
      })
      await page.waitForTimeout(1200)
    }

    // ── 2) dump 模型 pane：分组标题 + 每组的行
    out.modelPane = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"][aria-label]') ?? document.querySelector('[role="menu"]')
      if (menu === null) return { found: false }
      const groups = Array.from(menu.querySelectorAll('[class*="_group"], [data-menu-group]'))
      const rows = Array.from(menu.querySelectorAll('button[role="menuitemradio"]'))
      // 分组标题：MenuGroup 的 label 节点（结构 = 一个文本节点/span 在行之前）
      const labels = Array.from(menu.querySelectorAll('*'))
        .filter((n) => n.children.length === 0 && (n.textContent ?? '').trim() !== '')
        .map((n) => ({ text: (n.textContent ?? '').trim().slice(0, 40), tag: n.tagName, cls: typeof n.className === 'string' ? n.className.slice(0, 60) : '' }))
        .slice(0, 40)
      return {
        found: true,
        menuAria: menu.getAttribute('aria-label'),
        groupNodes: groups.length,
        rowCount: rows.length,
        rows: rows.slice(0, 60).map((r) => ({
          text: (r.textContent ?? '').trim().slice(0, 40),
          modelId: r.querySelector('[data-model-id]')?.getAttribute('data-model-id') ?? null,
          providerId: r.querySelector('[data-provider-id]')?.getAttribute('data-provider-id') ?? null,
          // 本插件画的标注（叶子 pill，不含包装节点）
          masPills: Array.from(r.querySelectorAll('[data-mas-badge]'))
            .filter((el) => el.querySelector('[data-mas-badge]') === null)
            .map((el) => (el.textContent ?? '').trim()),
          masUnassigned: r.getAttribute('data-mas-unassigned-row') === '1',
          masHidden: r.getAttribute('data-mas-hidden-row') === '1',
          masOpacity: r.style.opacity,
          masDisplay: r.style.display,
        })),
        labels,
      }
    })
    out.modelPane.groupTitles = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"][aria-label]') ?? document.querySelector('[role="menu"]')
      if (menu === null) return []
      // MenuGroup 标题通常是 aria-hidden 的小字标签；按「既不是 menuitemradio、又有独立文本」收集
      return Array.from(menu.children).map((child) => ({
        tag: child.tagName,
        cls: typeof child.className === 'string' ? child.className.slice(0, 80) : '',
        head: (child.firstElementChild?.textContent ?? '').trim().slice(0, 30),
        rows: child.querySelectorAll('button[role="menuitemradio"]').length,
      })).slice(0, 20)
    })
  }

  await page.screenshot({ path: join(WORK_DIR, 'probe-model-menu.png'), fullPage: false })
  writeFileSync(join(WORK_DIR, 'probe-model-menu.json'), JSON.stringify(out, null, 2), 'utf8')
  const rows = out.modelPane?.rows ?? []
  out.masSummary = {
    rows: rows.length,
    withGroupPill: rows.filter((r) => r.masPills.some((t) => t !== '免' && t !== '用' && t !== '占')).length,
    unassigned: rows.filter((r) => r.masUnassigned).length,
    samplePills: rows.slice(0, 8).map((r) => ({ model: r.modelId, pills: r.masPills, unassigned: r.masUnassigned })),
  }
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
