#!/usr/bin/env node
/**
 * 只读探针：验证 mas-v11 的自建模型下拉是否真的接管了宿主 composer 的模型入口。
 *
 * 检查项：
 *   1) 页面里是否存在本插件注册的触发按钮 `[data-mas-slot-trigger]`；
 *   2) 点开后面板的分组标题是否等于用户自定义分组名（而不是 provider 名）；
 *   3) 行数是否只等于「已入组」的模型数；
 *   4) beacon 里是否出现 `slot-register-skipped`。
 *
 * 用法：node scripts/probe-slot-menu.mjs [--url http://127.0.0.1:PORT] [--keep-open]
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
  const errors = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err?.message ?? err}`))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text().slice(0, 300)}`) })
  out.errors = errors
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  await dismissOverlays(page)
  await page.waitForTimeout(1500)

  // ── 0) beacon 与插件 catalog 真值
  try {
    const res = await fetch(`${BASE}/${ROUTE_PREFIX}/beacon`, { cache: 'no-store' })
    const j = await res.json()
    out.beacons = (j.beacons ?? []).slice(-6)
    out.slotSkipped = (j.beacons ?? []).filter((b) => b.phase === 'slot-register-skipped').length
  } catch (err) { out.beaconError = err.message }

  try {
    const res = await fetch(`${BASE}/${ROUTE_PREFIX}/catalog?refresh=1`, { cache: 'no-store' })
    const j = await res.json()
    const cfg = await (await fetch(`${BASE}/${ROUTE_PREFIX}/config`, { cache: 'no-store' })).json()
    out.catalog = {
      entries: (j.entries ?? []).length,
      disabled: (j.entries ?? []).filter((e) => e.disabled).length,
      groups: (j.groups ?? []).map((g) => ({ id: g.id, label: g.label, n: (g.keys ?? []).length })),
    }
    out.customGroups = (cfg.config?.customGroups ?? []).map((g) => ({ id: g.id, label: g.label, n: (g.models ?? []).length }))
  } catch (err) { out.catalogError = err.message }

  // ── 0.5) 确保处于一个会话里（composer 的模型控件 scope=session，空会话不渲染）
  out.session = await page.evaluate(() => {
    const before = {
      slot: document.querySelectorAll('[data-mas-slot-trigger]').length,
      host: document.querySelectorAll('button[aria-label*="选择模型"]').length,
      composer: document.querySelectorAll('textarea, [contenteditable="true"]').length,
    }
    return before
  })
  // 先试「进一个已有会话」：首页点新建会话在本机可能被宿主 agent-preset 拦住
  out.enter = await page.evaluate(async () => {
    const log = []
    const visible = (el) => el.offsetParent !== null
    // a) 侧栏里点一个工作区（本工程），让宿主进到该工作区
    const ws = Array.from(document.querySelectorAll('button, a, [role="button"], [role="treeitem"], [role="listitem"]'))
      .filter(visible)
      .find((el) => /dsh-model-auto-select/.test((el.textContent ?? '').trim()))
    if (ws !== undefined) {
      ws.click()
      log.push('click-workspace')
      await new Promise((r) => setTimeout(r, 1500))
    }
    // b) 找一条历史会话并点进去
    const cand = Array.from(document.querySelectorAll('a[href*="session"], [data-session-id], [role="treeitem"], [role="option"], li'))
      .filter((el) => visible(el) && (el.getAttribute('href') ?? '').includes('session'))
    log.push('session-links:' + cand.length)
    const first = cand.find((el) => /\d/.test((el.textContent ?? '')) || (el.getAttribute('href') ?? '').includes('session'))
    if (first !== undefined) {
      first.click()
      log.push('click-session:' + ((first.getAttribute('href') ?? first.textContent ?? '') + '').trim().slice(0, 60))
      await new Promise((r) => setTimeout(r, 1800))
    }
    return {
      log,
      composer: document.querySelectorAll('textarea, [contenteditable="true"]').length,
      slot: document.querySelectorAll('[data-mas-slot-trigger]').length,
      toast: Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
        .map((n) => (n.textContent ?? '').trim().slice(0, 120))
        .filter((t) => t !== '')
        .slice(0, 5),
      href: location.href,
    }
  })
  await page.waitForTimeout(2500)

  const opened = await page.evaluate(() => {
    const want = /新建(会话|对话)|新对话|New (chat|session)|开始新/i
    const hit = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .find((b) => want.test((b.getAttribute('aria-label') ?? '') + ' ' + (b.textContent ?? '')))
    if (hit === undefined) return ''
    hit.click()
    return (hit.getAttribute('aria-label') ?? hit.textContent ?? '').trim().slice(0, 40)
  })
  out.newChat = opened
  await page.waitForTimeout(2500)
  await dismissOverlays(page)
  await page.waitForTimeout(1200)

  // ── 0.6) 诊断：新建会话后输入框附近到底渲染了什么（定位「槽没出现」）
  out.diag = await page.evaluate(() => {
    const pick = (el) => {
      const a = el.getAttribute('aria-label') ?? ''
      const t = (el.textContent ?? '').trim().slice(0, 40)
      return { aria: a.slice(0, 60), text: t, tag: el.tagName.toLowerCase(), cls: (el.className ?? '').toString().slice(0, 40) }
    }
    const all = Array.from(document.querySelectorAll('button, [role="button"], [role="combobox"]')).filter(
      (b) => b.offsetParent !== null,
    )
    const nearComposer = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).map((c) => {
      let p = c.parentElement
      for (let i = 0; i < 4 && p !== null; i += 1) p = p.parentElement
      return {
        buttons: p === null ? [] : Array.from(p.querySelectorAll('button, [role="button"]')).map(pick).slice(0, 20),
      }
    })
    return {
      totalButtons: all.length,
      modelish: all.filter((b) => /模型|model/i.test((b.getAttribute('aria-label') ?? '') + ' ' + (b.textContent ?? ''))).map(pick),
      nearComposer,
      sidebarSessions: Array.from(document.querySelectorAll('a[href*="session"], [data-session-id], [role="listitem"]'))
        .filter((n) => n.offsetParent !== null)
        .map((n) => ({ tag: n.tagName.toLowerCase(), text: (n.textContent ?? '').trim().slice(0, 40), href: n.getAttribute('href') ?? '', sid: n.getAttribute('data-session-id') ?? '' }))
        .slice(0, 12),
    }
  })

  // ── 1) 本插件是否注册了 conversation.input.model 槽
  out.slot = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-mas-slot-trigger]'))
    return {
      count: nodes.length,
      aria: nodes.map((n) => n.getAttribute('aria-label')),
      text: nodes.map((n) => (n.textContent ?? '').trim()),
      hostTriggers: Array.from(document.querySelectorAll('button[aria-label*="选择模型"]'))
        .map((n) => ({ aria: n.getAttribute('aria-label'), own: n.hasAttribute('data-mas-slot-trigger') })),
    }
  })

  // ── 2) 点开自建下拉，dump 分组与行
  const clicked = await page.evaluate(() => {
    const node = document.querySelector('[data-mas-slot-trigger]')
    if (node === null) return false
    node.click()
    return true
  })
  out.clicked = clicked
  await page.waitForTimeout(600)
  out.menu = await page.evaluate(() => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    if (menu === null) return { open: false }
    const groups = Array.from(menu.querySelectorAll('[data-mas-slot-group]')).map((g) => ({
      id: g.getAttribute('data-mas-slot-group'),
      head: (g.firstElementChild?.textContent ?? '').trim(),
      rows: Array.from(g.querySelectorAll('[data-mas-slot-row]')).map((r) => r.getAttribute('data-mas-slot-row')),
    }))
    return {
      open: true,
      groups,
      rows: Array.from(menu.querySelectorAll('[data-mas-slot-row]')).map((r) => r.getAttribute('data-mas-slot-row')),
      empty: menu.querySelector('[data-mas-slot-empty]')?.textContent?.trim() ?? '',
      search: menu.querySelectorAll('[data-mas-slot-search]').length,
    }
  })

  // ── 2.5) 来源标识 / 搜索 / 键盘导航（自建下拉重做时新增的能力，真机验收）
  out.sources = await page.evaluate(() => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    if (menu === null) return { rows: 0, chips: [] }
    const rows = Array.from(menu.querySelectorAll('[data-mas-slot-row]'))
    return {
      rows: rows.length,
      chips: rows.map((r) => ({
        key: r.getAttribute('data-mas-slot-row'),
        providerAttr: r.getAttribute('data-mas-provider'),
        chip: (r.querySelector('[data-mas-provider]')?.textContent ?? '').trim(),
        chipTitle: r.querySelector('[data-mas-provider]')?.getAttribute('title') ?? '',
      })),
      missing: rows.filter((r) => r.querySelector('[data-mas-provider]') === null).length,
      searchRole: menu.querySelector('[data-mas-slot-search]')?.getAttribute('role') ?? '',
      searchLabel: menu.querySelector('[data-mas-slot-search]')?.getAttribute('aria-label') ?? '',
      listbox: menu.querySelector('#mas-slot-listbox')?.getAttribute('role') ?? '',
      foot: (menu.querySelector('[data-mas-slot-foot]')?.textContent ?? '').trim(),
      count: (menu.querySelector('[data-mas-slot-count]')?.textContent ?? '').trim(),
    }
  })

  out.search = await page.evaluate(() => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    const input = menu?.querySelector('[data-mas-slot-search]')
    if (!menu || !input) return { ok: false }
    const before = Array.from(menu.querySelectorAll('[data-mas-slot-row]')).filter((r) => r.style.display !== 'none')
      .map((r) => r.getAttribute('data-mas-slot-row'))
    // 用第一行的来源名当搜索词，验证「能按来源搜」
    const firstProvider = (menu.querySelector('[data-mas-slot-row] [data-mas-provider]')?.textContent ?? '').trim()
    input.value = firstProvider
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const after = Array.from(menu.querySelectorAll('[data-mas-slot-row]')).filter((r) => r.style.display !== 'none')
      .map((r) => r.getAttribute('data-mas-slot-row'))
    const count = (menu.querySelector('[data-mas-slot-count]')?.textContent ?? '').trim()
    // 再搜一个肯定不存在的词，验证空态
    input.value = 'zzz-no-such-model'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const empty = menu.querySelector('[data-mas-slot-empty]')
    const emptyState = {
      shown: empty === null ? '' : empty.style.display,
      text: (empty?.textContent ?? '').trim(),
      visibleRows: Array.from(menu.querySelectorAll('[data-mas-slot-row]')).filter((r) => r.style.display !== 'none').length,
    }
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true, firstProvider, before, after, count, emptyState }
  })

  out.keyboard = await page.evaluate(() => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    const input = menu?.querySelector('[data-mas-slot-search]')
    if (!menu || !input) return { ok: false }
    input.focus()
    const opened = {
      focused: document.activeElement === input,
      active: input.getAttribute('aria-activedescendant') ?? '',
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const down1 = input.getAttribute('aria-activedescendant') ?? ''
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const down2 = input.getAttribute('aria-activedescendant') ?? ''
    const highlighted = Array.from(menu.querySelectorAll('[data-mas-slot-row]')).filter(
      (r) => r.style.background !== '' && r.style.background !== 'transparent',
    ).length
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const afterEsc = {
      open: menu.style.display !== 'none',
      focusOnTrigger: document.querySelector('[data-mas-slot-trigger]') === document.activeElement,
    }
    return { ok: true, opened, down1, down2, highlighted, afterEsc }
  })

  // Esc 之后下拉是关的，重新打开供后面的「点一行」用例使用
  out.reopened = await page.evaluate(() => {
    const node = document.querySelector('[data-mas-slot-trigger]')
    if (node === null) return false
    if (document.querySelector('[data-mas-slot-menu]')?.style.display !== 'none') return true
    node.click()
    return true
  })
  await page.waitForTimeout(500)

  // ── 3) 宿主原下拉是否还在（应该被 single 槽遮住 = 不渲染）
  out.hostMenu = await page.evaluate(() => {
    const host = document.querySelector('div[role="menu"][aria-label="模型"]')
    return { present: host !== null, rows: host === null ? 0 : host.querySelectorAll('button[role="menuitemradio"]').length }
  })

  // ── 4) 点一行，验证真的走了 /select 并切了模型
  out.pick = await page.evaluate(async () => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    if (menu === null) return { clicked: false }
    const rows = Array.from(menu.querySelectorAll('[data-mas-slot-row]'))
    const target = rows.find((r) => r.getAttribute('data-mas-slot-row') === 'qoder/qfmodel') ?? rows[0]
    if (target === undefined) return { clicked: false }
    const key = target.getAttribute('data-mas-slot-row')
    target.click()
    await new Promise((r) => setTimeout(r, 900))
    const res = await fetch('/dsh-model-auto-select/health').then((r) => r.json()).catch(() => null)
    return { clicked: true, key, catalogSize: res?.catalogSize ?? null }
  })
  out.afterPick = await page.evaluate(() => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    const trigger = document.querySelector('[data-mas-slot-trigger]')
    return {
      open: menu !== null && menu.style.display !== 'none',
      aria: trigger?.getAttribute('aria-label') ?? '',
    }
  })
  await page.screenshot({ path: join(WORK_DIR, 'probe-slot-menu.png') })

  out.verdict = {
    '每行都有来源标识': (out.sources?.missing ?? -1) === 0 && (out.sources?.chips ?? []).every((c) => c.chip !== ''),
    '搜索框是 combobox 且说明可搜来源': out.sources?.searchRole === 'combobox' && (out.sources?.searchLabel ?? '').includes('来源'),
    '列表有 listbox 语义': out.sources?.listbox === 'listbox',
    '能按来源名搜到行': (out.search?.after ?? []).length > 0 && (out.search?.after ?? []).length <= (out.search?.before ?? []).length,
    '搜不到时给空态而不是空白': (out.search?.emptyState?.shown ?? '') === 'block' && (out.search?.emptyState?.text ?? '').includes('没有匹配'),
    '打开即聚焦搜索框并标出首个候选': out.keyboard?.opened?.focused === true && (out.keyboard?.opened?.active ?? '').startsWith('mas-slot-opt-'),
    '↑↓ 能移动高亮': (out.keyboard?.down1 ?? '') !== (out.keyboard?.down2 ?? '') && (out.keyboard?.highlighted ?? 0) >= 1,
    'Esc 关闭且焦点回到触发按钮': out.keyboard?.afterEsc?.open === false && out.keyboard?.afterEsc?.focusOnTrigger === true,
  }
} catch (err) {
  out.error = `${err?.message ?? err}`
} finally {
  await browser.close()
}

writeFileSync(join(WORK_DIR, 'probe-slot-menu.json'), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
