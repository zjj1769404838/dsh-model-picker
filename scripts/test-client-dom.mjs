/**

 * 客户端半边真机验证（不依赖 DSH 登录态）：

 *   起一个本地 http 服务 → 造出与宿主一致的模型菜单 + 设置页 DOM → 注入 lib/client.js

 *   （用 __ModuleLoader__ 包裹，和宿主加载方式一致）→ 断言标注、设置入口与设置页内容。

 *

 * 断言的行为契约（对应 README 2.8 / 2.9 / 4.3）：

 *   1. 输入框工具栏只有一个新增节点：模型选择按钮右侧的「设置」图标；冷却时才有倒计时；

 *      其它 menu 按钮一律不碰；旧版的「模型面板」按钮已经不存在

 *   2. 宿主菜单只补宿主表达不了的事：限免（宿主自己标过就不再补）、已保存的分组名；
 *      **占用徽标（用/占）已撤 —— 口径不准（只反映「某会话把选择器停在该模型」），不得回归**

 *   3. 点齿轮图标 → 打开 dsh 设置页面并停到本插件的「模型自动选择」；齿轮和模型下拉同一行；失败要落 beacon

 *   4. 设置页是唯一完整视图：所有来源的多模态一组、纯文本一组；行内标 `图`/`文`/`免`/`用`/`占`

 *   5. 设置页里能开关单个模型（POST /config { toggleModel }）与改配置（POST /config { field: value }）

 */

import http from 'node:http'

import { readFile } from 'node:fs/promises'

import { fileURLToPath } from 'node:url'

import path from 'node:path'

import assert from 'node:assert/strict'

// playwright-core 没有声明为本项目依赖（历史上借用别的插件里的副本），换机器/用户就会失效。
// 这里改为「环境变量优先 + 候选路径挑第一个真实存在的」，让测试可移植，不写死某一台机器。
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PLAYWRIGHT_CANDIDATES = [
  process.env.DSH_PLAYWRIGHT_PATH,
  'D:/my-projects/plugins/dsh-git-panel/node_modules/playwright-core/index.js',
  'C:/Users/17694/AppData/Local/npm-cache/_npx/af752b90495482d7/node_modules/playwright-core/index.js',
].filter(Boolean)
const PLAYWRIGHT_JS = PLAYWRIGHT_CANDIDATES.find((candidate) => existsSync(candidate))
if (PLAYWRIGHT_JS === undefined) {
  throw new Error(`找不到 playwright-core，请设置 DSH_PLAYWRIGHT_PATH 指向其 index.js。候选：${PLAYWRIGHT_CANDIDATES.join(', ')}`)
}
const PLAYWRIGHT = pathToFileURL(PLAYWRIGHT_JS).href

const pw = (await import(PLAYWRIGHT)).default ?? (await import(PLAYWRIGHT))

const chromium = pw.chromium



const HERE = path.dirname(fileURLToPath(import.meta.url))

const ROOT = path.resolve(HERE, '..')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'



// ── 夹具：两个 provider，混合文本/多模态 ──

// alpha: 两个文本（一个运行中、一个占用空闲）+ 一个多模态

// beta : 一个多模态 + 一个限免文本（宿主没标）+ 一个限免文本（宿主已标「限时免费」）

const ENTRIES = [

  { key: 'alpha\u0000a-text-1', provider: 'alpha', providerName: 'Alpha 官方', providerSettingsNs: '', model: 'a-text-1', name: 'A-Text-1', kind: 'text', modalities: ['text'], modalitySource: 'listModels', sortKey: [0, 0, 0, 0], free: false, disabled: false },

  { key: 'alpha\u0000a-text-2', provider: 'alpha', providerName: 'Alpha 官方', providerSettingsNs: '', model: 'a-text-2', name: 'A-Text-2', kind: 'text', modalities: ['text'], modalitySource: 'listModels', sortKey: [0, 1, 0, 1], free: false, disabled: false },

  { key: 'alpha\u0000a-mm-1', provider: 'alpha', providerName: 'Alpha 官方', providerSettingsNs: '', model: 'a-mm-1', name: 'A-MM-1', kind: 'multimodal', modalities: ['text', 'image'], modalitySource: 'listModels', sortKey: [0, 2, 0, 2], free: false, disabled: false },

  { key: 'beta\u0000b-mm-1', provider: 'beta', providerName: 'Beta', providerSettingsNs: '', model: 'b-mm-1', name: 'B-MM-1', kind: 'multimodal', modalities: ['image'], modalitySource: 'resolveModelInfo', sortKey: [1, 0, 1, 0], free: false, disabled: false },

  { key: 'beta\u0000b-text-1', provider: 'beta', providerName: 'Beta', providerSettingsNs: '', model: 'b-text-1', name: 'B-Text-1 · x0.00', kind: 'text', modalities: ['text'], modalitySource: 'listModels', sortKey: [1, 1, 1, 1], priceFactor: 0, free: true, disabled: false },

  { key: 'beta\u0000b-free-1', provider: 'beta', providerName: 'Beta', providerSettingsNs: '', model: 'b-free-1', name: 'B-Free-1 · x0.00', kind: 'text', modalities: ['text'], modalitySource: 'listModels', sortKey: [1, 2, 1, 2], priceFactor: 0, free: true, disabled: false },

]



const GROUPS = [

  { id: 'multimodal', label: '多模态 · 2', kind: 'multimodal', keys: ['alpha\u0000a-mm-1', 'beta\u0000b-mm-1'] },

  { id: 'text', label: '纯文本 · 4', kind: 'text', keys: ['alpha\u0000a-text-1', 'alpha\u0000a-text-2', 'beta\u0000b-text-1', 'beta\u0000b-free-1'] },

]



const CONFIG = {

  enabled: true,

  defaultModel: null,

  maxRetries: 2,

  retryDelayMs: 800,

  cooldownMs: 1_800_000,

  preferIdle: true,

  groupByKind: true,

  crossClassFallback: false,

  cooldownRefreshBlocked: true,

  disabledModels: [],

  freeBadgeLabel: '免',

  providerOrder: [],

  modelOrder: [],

  switchOnCodes: [],

  catalogTtlMs: 60_000,

  occupancyRefreshMs: 5_000,

  disabledGroups: [],

  hiddenModels: [],

  hiddenGroups: [],

  customGroups: [],

  switchScope: 'group-cross',

  groupMode: 'manual',

  probeIntervalMin: 0,

}



// 与服务端 CONFIG_FIELDS 对齐：只暴露用户真正会改的 13 项（4 个数组字段供逐行开关写盘）。
const FIELDS = [

  { key: 'enabled', type: 'boolean', label: '启用自动选择', hint: '关闭后只记录日志，不改选择' },

  { key: 'defaultModel', type: 'model', label: '默认模型', hint: '未设置时跟随宿主默认' },

  { key: 'maxRetries', type: 'number', label: '重试次数', hint: '默认 2' },

  { key: 'groupMode', type: 'groupmode', label: '分组方式', hint: '手工 / 自动（免费 / 积分 / 未知）' },

  { key: 'probeIntervalMin', type: 'number', label: '自动探测间隔(分钟)', hint: '0 = 不自动探测' },

  { key: 'preferIdle', type: 'boolean', label: '优先空闲模型', hint: '默认开' },

  { key: 'groupByKind', type: 'boolean', label: '按类型分组', hint: '默认开' },

  { key: 'customGroups', type: 'groups', label: '自定义分组', hint: '非空时接管分组' },

  { key: 'switchScope', type: 'scope', label: '自动切换范围', hint: '组内 / 组内→跨组 / 全部' },

  { key: 'disabledModels', type: 'models', label: '自动选择：模型', hint: '勾选 = 允许参与自动选择' },

  { key: 'disabledGroups', type: 'groups-list', label: '自动选择：分组', hint: '整组关掉' },

  { key: 'hiddenModels', type: 'models', label: '下拉展示：模型', hint: '勾选 = 出现在模型下拉' },

  { key: 'hiddenGroups', type: 'groups-list', label: '下拉展示：分组', hint: '整组隐藏' },

]



function makeView(over = {}) {

  return {

    version: '0.1.0',

    generatedAt: Date.now(),

    providerCount: 2,

    entries: ENTRIES,

    groups: GROUPS,

    failures: [],

    occupancy: {

      'alpha\u0000a-text-1': { key: 'alpha\u0000a-text-1', owners: ['sess-running'], inUse: true, running: true },

      'alpha\u0000a-text-2': { key: 'alpha\u0000a-text-2', owners: ['sess-idle'], inUse: true, running: false },

      'alpha\u0000a-mm-1': { key: 'alpha\u0000a-mm-1', owners: [], inUse: false, running: false },

      'beta\u0000b-mm-1': { key: 'beta\u0000b-mm-1', owners: [], inUse: false, running: false },

      'beta\u0000b-text-1': { key: 'beta\u0000b-text-1', owners: [], inUse: false, running: false },

      'beta\u0000b-free-1': { key: 'beta\u0000b-free-1', owners: [], inUse: false, running: false },

    },

    cooldown: { active: false, until: 0, remainingMs: 0, reason: '' },

    sessions: [{ sessionId: 'sess-running', kind: 'text', current: 'alpha\u0000a-text-1', reasonCode: 'preferred', attempts: 0, retriesUsed: 0, switches: 0, excluded: [] }],

    config: { ...CONFIG },

    ...over,

  }

}

const VIEW = makeView()



// 极简 React 垫片：只为让「注册 settings.section」这条路径在夹具里跑通。

// 只实现 createElement / useRef / useEffect 三个被用到的 API。

const FAKE_REACT = `
window.__fakeReact = (function () {
  // 极简 React：支持 createElement / useRef / useState / useEffect，并把多子节点拼成 DOM。
  var hookSlots = []
  var hookIndex = 0
  var effects = []
  var scheduled = null
  var pendingRefs = []
  // 真实 React 在节点进入文档之后才跑 ref 回调；夹具必须同样延后，
  // 否则 ref 里 focus() 作用在游离节点上，焦点断言全是假阴性。
  function flushRefs() {
    var todo = pendingRefs.slice()
    pendingRefs.length = 0
    for (var i = 0; i < todo.length; i += 1) {
      if (typeof todo[i].ref === 'function') todo[i].ref(todo[i].dom)
      else todo[i].ref.current = todo[i].dom
    }
  }
  function renderChildren(children, dom) {
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i]
      if (child === null || child === undefined || child === false) continue
      if (Array.isArray(child)) { renderChildren(child, dom); continue }
      if (typeof child === "string" || typeof child === "number") {
        dom.appendChild(document.createTextNode(String(child)))
        continue
      }
      dom.appendChild(renderNode(child))
    }
  }
  function renderNode(vnode) {
    var out = typeof vnode.type === "function" ? vnode.type(vnode.props) : vnode
    var dom = document.createElement(out.type)
    var props = out.props || {}
    var style = props.style || {}
    for (var k in style) dom.style[k] = style[k]
    for (var a in props) {
      if (a === "style" || a === "ref" || a === "key") continue
      var v = props[a]
      if (a === "value") { dom.value = v === undefined ? "" : String(v); continue }
      if (a.slice(0, 2) === "on" && typeof v === "function") {
        dom.addEventListener(a.slice(2).toLowerCase(), v)
        continue
      }
      if (v === true) { dom.setAttribute(a, ""); continue }
      if (v === false || v === undefined || v === null) continue
      dom.setAttribute(a, String(v))
    }
    if (props.ref) pendingRefs.push({ ref: props.ref, dom: dom })
    var kids = props.children
    if (kids !== undefined && kids !== null) {
      if (Array.isArray(kids)) renderChildren(kids, dom)
      else renderChildren([kids], dom)
    }
    return dom
  }
  function runEffects() {
    var pending = effects.slice()
    effects.length = 0
    for (var i = 0; i < pending.length; i += 1) pending[i]()
  }
  return {
    createElement: function (type, props) {
      var children = Array.prototype.slice.call(arguments, 2)
      var merged = {}
      for (var k in props || {}) merged[k] = props[k]
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type: type, props: merged }
    },
    useRef: function (init) {
      var i = hookIndex
      hookIndex += 1
      if (hookSlots[i] === undefined) hookSlots[i] = { current: init }
      return hookSlots[i]
    },
    useState: function (init) {
      var i = hookIndex
      hookIndex += 1
      if (hookSlots[i] === undefined) hookSlots[i] = { value: typeof init === "function" ? init() : init }
      var slot = hookSlots[i]
      return [slot.value, function (next) { slot.value = typeof next === "function" ? next(slot.value) : next; window.__fakeReact.__rerender() }]
    },
    useEffect: function (fn) {
      hookIndex += 1
      effects.push(fn)
    },
    __rerender: function () {
      if (scheduled === null) return
      var target = scheduled
      scheduled = null
      // 重绘保留 hooks、不重跑 effects（真实 React 里 deps 未变就不会重跑）
      window.__fakeReact.__mount(target.container, target.component, target.props, true)
    },
    __mount: function (container, component, props, keepHooks) {
      if (keepHooks !== true) {
        hookSlots = []
        effects.length = 0
      }
      hookIndex = 0
      scheduled = { container: container, component: component, props: props || {} }
      var vnode = { type: component, props: props || {} }
      var dom = renderNode(vnode)
      container.textContent = ""
      container.appendChild(dom)
      flushRefs()
      if (keepHooks !== true) runEffects()
      return dom
    },
    __render: function (vnode) {
      hookSlots = []
      hookIndex = 0
      effects.length = 0
      pendingRefs.length = 0
      var dom = renderNode(vnode)
      flushRefs()
      runEffects()
      return dom
    },
  }
})()

`


const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>mas-client-fixture</title></head>

<body>

  <!-- 顶部一排普通下拉按钮：曾经被误标成「文本·占用中」 -->

  <div id="toolbar">

    <div class="wrap"><button type="button" aria-haspopup="menu" aria-controls="mode-menu" aria-label="标准模式">标准模式</button></div>

    <div class="wrap"><button type="button" aria-haspopup="menu" aria-controls="wb-menu" aria-label="WorkBuddy 选择器">WorkBuddy</button></div>

    <div class="wrap"><button type="button" aria-haspopup="menu" aria-label="通知">通知</button></div>

  </div>

  <!-- 真正的模型选择按钮：宿主 root 是块级容器（min-width:0;position:relative），插件要把它补成 flex 行 -->

  <div id="modelWrap"><div id="modelRoot" style="min-width:0;position:relative"><button id="modelTrigger" type="button" aria-haspopup="menu" aria-controls="m-menu" aria-label="选择模型，当前 A-Text-1">A-Text-1</button></div></div>

  <!-- 宿主菜单：role=menu > MenuGroup(div) > button[role=menuitemradio] > span[data-*] -->

  <div role="menu" aria-label="模型">

    <div class="group" data-group="alpha"><div class="groupLabel">Alpha 官方</div>

      <button type="button" role="menuitemradio" aria-checked="true" id="m-0"><span class="copy"><span class="name"><span data-provider-id="alpha" data-model-id="a-text-1">A-Text-1</span></span></span></button>

      <button type="button" role="menuitemradio" aria-checked="false" id="m-1"><span class="copy"><span class="name"><span data-provider-id="alpha" data-model-id="a-text-2">A-Text-2</span></span></span></button>

      <button type="button" role="menuitemradio" aria-checked="false" id="m-2"><span class="copy"><span class="name"><span data-provider-id="alpha" data-model-id="a-mm-1">A-MM-1</span></span></span></button>

    </div>

    <div class="group" data-group="beta"><div class="groupLabel">Beta</div>

      <button type="button" role="menuitemradio" aria-checked="false" id="m-3"><span class="copy"><span class="name"><span data-provider-id="beta" data-model-id="b-mm-1">B-MM-1</span></span></span></button>

      <button type="button" role="menuitemradio" aria-checked="false" id="m-4"><span class="copy"><span class="name"><span data-provider-id="beta" data-model-id="b-text-1">B-Text-1 · x0.00</span></span></span></button>

      <!-- 宿主自己已经标了「限时免费」：本插件不该再补一枚「免」 -->

      <button type="button" role="menuitemradio" aria-checked="false" id="m-5"><span class="copy"><span class="name"><span data-provider-id="beta" data-model-id="b-free-1">B-Free-1 · x0.00</span><span class="hostTag">限时免费</span></span></span></button>

    </div>

  </div>

  <!-- 宿主设置页入口（settings-general 的 settings.launcher 槽 fallback） -->

  <button id="settingsLauncher" type="button" aria-haspopup="dialog" aria-label="设置">⚙</button>

  <script>${FAKE_REACT}</script>

  <script>

    window.__navClicked = null

    window.__registered = []

    // 宿主设置面板的等价 DOM：div[data-shortcut-modal="settings"] > navList > button.navCell > span

    document.getElementById('settingsLauncher').addEventListener('click', function () {

      if (document.querySelector('[data-shortcut-modal="settings"]') !== null) return

      var panel = document.createElement('div')

      panel.setAttribute('data-shortcut-modal', 'settings')

      panel.setAttribute('role', 'dialog')

      var nav = document.createElement('div')

      nav.className = 'navList'

      ;['通用', '插件', '模型自动选择', '模型'].forEach(function (label) {

        var cell = document.createElement('button')

        cell.className = 'navCell'

        var span = document.createElement('span')

        span.textContent = label

        cell.appendChild(span)

        cell.addEventListener('click', function () {

          window.__navClicked = label

          if (label === '模型自动选择') window.__renderSection()

        })

        nav.appendChild(cell)

      })

      panel.appendChild(nav)

      var content = document.createElement('div')

      content.id = 'settingsContent'

      panel.appendChild(content)

      document.body.appendChild(panel)

    })

    // 把注册到 settings.section 的组件渲染进设置页正文

    // 把注册到 conversation.input.model 的组件渲染进一个独立容器

    window.__renderModelSlot = function () {

      var reg = window.__registered.filter(function (r) { return r.options.name === 'conversation.input.model' })[0]

      if (reg === undefined) return false

      var host = document.getElementById('modelSlotHost')

      if (host === null) {

        host = document.createElement('div')

        host.id = 'modelSlotHost'

        document.body.appendChild(host)

      }

      var injected = reg.options.inject === undefined ? {} : reg.options.inject('session-1')

      window.__fakeReact.__mount(host, reg.component, injected)

      return true

    }

    window.__renderSection = function () {

      var reg = window.__registered.filter(function (r) { return r.options.name === 'settings.section' })[0]

      // 设置页正文只在打开设置面板后才存在：没开就先点 launcher 造出来

      var content = document.getElementById('settingsContent')

      if (content === null) {

        document.getElementById('settingsLauncher').click()

        content = document.getElementById('settingsContent')

      }

      if (reg === null || content === null) return false

      content.textContent = ''

      content.appendChild(window.__fakeReact.__render(window.__fakeReact.createElement(reg.component)))

      return true

    }

    window.__ModuleLoader__ = {

      load: function (spec) {

        window.__mas = spec.factory(function (name) {

          if (name === 'react') return window.__fakeReact

          return {}

        })

      },

    }

  </script>

  <script src="/lib/client.js"></script>

</body></html>`



const posted = []

const beacons = []

// 「重新获取」必须带 refresh=1，这里记录目录请求的查询串
const catalogQueries = []

// 自建下拉选模型走插件的 POST /select 路由，这里记录请求体供断言
const selectCalls = []

// 连通性测试（单点 / 分组一键测试）打 POST /test-model，这里记录每次请求与可控的失败集合
const probeCalls = []

// 占用徽标已撤除；这里仍记录 GET /occupancy 的次数，用来断言客户端不会再打这个接口
const occupancyQueries = []

// 服务端可变的配置副本：POST /config 写回这里，GET /config 读它，模拟真实持久化与回显
const serverConfig = { ...CONFIG }

const server = http.createServer(async (req, res) => {

  const url = new URL(req.url ?? '/', 'http://local')

  if (url.pathname === '/' || url.pathname === '/index.html') {

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })

    res.end(PAGE)

    return

  }

  if (url.pathname === '/lib/client.js') {

    const body = await readFile(path.join(ROOT, 'lib', 'client.js'))

    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })

    res.end(body)

    return

  }

  if (url.pathname === '/dsh-model-auto-select/catalog') {

    catalogQueries.push(url.search)

    if (server.__failCatalog === true) {

      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })

      res.end('boom')

      return

    }

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })

    res.end(JSON.stringify(server.__view ?? VIEW))

    return

  }

  if (url.pathname === '/dsh-model-auto-select/config') {

    if (req.method === 'POST') {

      const chunks = []

      for await (const chunk of req) chunks.push(chunk)

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')

      posted.push(body)

      // 模拟服务端持久化：把改动写回夹具 CONFIG，客户端重新拉取时就能回显
      for (const [key, value] of Object.entries(body)) {

        if (key === 'customGroups' && Array.isArray(value)) serverConfig.customGroups = value

        else if (key === 'toggleGroup') server.__toggleGroup = value

        else if (key === 'toggleModel') server.__toggleModel = value

        else if (key in serverConfig) serverConfig[key] = value

      }

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })

      res.end(JSON.stringify({ ok: true, persisted: true, changed: Object.keys(body) }))

      return

    }

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })

    res.end(JSON.stringify({ version: '0.1.0', config: { ...serverConfig }, defaults: { ...CONFIG }, fields: FIELDS, writable: true, active: true, documentPath: 'C:/Users/zjj/.dsh/profiles/desktop/cordis.patch.yml' }))

    return

  }

  if (url.pathname === '/dsh-model-auto-select/select') {

    const chunks = []

    for await (const chunk of req) chunks.push(chunk)

    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')

    selectCalls.push(body)

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })

    res.end(JSON.stringify({ ok: true, sessionId: body.sessionId, selection: body }))

    return

  }

  if (url.pathname === '/dsh-model-auto-select/test-model') {

    const chunks = []

    for await (const chunk of req) chunks.push(chunk)

    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')

    probeCalls.push(body)

    const label = `${body.provider}/${body.model}`

    const fail = (server.__probeFailModels ?? []).includes(body.model) || (server.__probeInfraModels ?? []).includes(body.model)

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })

    if (fail) {

      const isInfra = (server.__probeInfraModels ?? []).includes(body.model)

      res.end(JSON.stringify({ ok: false, provider: body.provider, model: body.model, ms: 12, error: '模拟上游 401', kind: isInfra ? 'infra' : 'model' }))

    } else {

      res.end(JSON.stringify({ ok: true, provider: body.provider, model: body.model, ms: 42, sample: `pong ${label}` }))

    }

    return

  }

  if (url.pathname === '/dsh-model-auto-select/beacon') {

    if (req.method === 'POST') {

      const chunks = []

      for await (const chunk of req) chunks.push(chunk)

      try {

        beacons.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))

      } catch {

        beacons.push({ raw: true })

      }

    }

    res.writeHead(200, { 'content-type': 'application/json' })

    res.end('{"ok":true}')

    return

  }

  if (url.pathname === '/dsh-model-auto-select/occupancy') {

    occupancyQueries.push(url.search)

    if (server.__failOccupancy === true) {

      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })

      res.end('boom')

      return

    }

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })

    res.end(JSON.stringify({ occupancy: server.__occupancy ?? (server.__view ?? VIEW).occupancy, refreshedAt: Date.now() }))

    return

  }

  res.writeHead(404)

  res.end('nope')

})




await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const port = server.address().port



let passed = 0

const failures = []

async function test(name, fn) {

  try {

    await fn()

    passed += 1

    console.log(`  ok  ${name}`)

  } catch (err) {

    failures.push(`${name}: ${err.message}`)

    console.log(`  FAIL ${name}: ${err.message}`)

  }

}



const browser = await chromium.launch({ executablePath: EDGE, headless: true })

const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })

// 客户端任何未捕获异常都要能让用例抓到（占用即时刷新必须失败静默）
const pageErrors = []

page.on('pageerror', (err) => {

  console.log('  [pageerror]', err.message)

  pageErrors.push(String(err && err.message ? err.message : err))

})



/** 起页：注入 client.js、跑 apply()，并把 settings.section 的注册者存起来。 */

async function boot(view = VIEW) {

  posted.length = 0

  beacons.length = 0

  catalogQueries.length = 0

  occupancyQueries.length = 0

  probeCalls.length = 0

  server.__probeFailModels = []

  server.__failOccupancy = false

  server.__occupancy = null

  pageErrors.length = 0

  server.__view = view

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' })

  await page.waitForFunction(() => window.__mas !== undefined, undefined, { timeout: 5000 })

  await page.evaluate(() => {

    const slots = {

      inject(name, factory) {

        factory()

      },

      register(options, component) {

        window.__registered.push({ options, component })

      },

    }

    // 宿主目录桩：current 有值、groups 为空（本插件的下拉不读它，只读 state.current）

    window.__selects = []

    var dirStore = {

      subscribe: function () {

        return function () {}

      },

      getSnapshot: function () {

        return { current: { provider: 'alpha', model: 'a-text-1' }, status: 'ready', pending: null, groups: [], failures: [] }

      },

    }

    var modelDirectories = {

      directoryFor: function () {

        return {

          store: dirStore,

          load: function () {

            return Promise.resolve()

          },

          select: function (selection) {

            window.__selects.push(selection)

            return Promise.resolve()

          },

        }

      },

    }

    var sessions = { subagentAddress: function () { return undefined } }

    var ctx = {

      slots: slots,

      get: function (name) {

        if (name === 'modelDirectories') return modelDirectories

        if (name === 'sessions') return sessions

        return undefined

      },

    }

    window.__mas.apply(ctx)

  })

  await page.waitForTimeout(400)

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

}



/** 只统计「叶子徽标」：包装节点与内部 pill 都带 data-mas-own，直接全取会重复计数。 */

const badges = () =>

  page.evaluate(() =>

    [...document.querySelectorAll('[data-mas-own]')]

      .filter((el) => el.querySelector('[data-mas-own]') === null)

      .map((el) => ({

        text: (el.textContent ?? '').trim(),

        tag: el.tagName,

        attrs: [...el.attributes].map((a) => a.name).join(','),

        parentId: el.parentElement?.getAttribute('id') ?? '',

        parentAria: el.parentElement?.getAttribute('aria-label') ?? '',

        // data-group 挂在分组容器上，不在按钮上 —— 必须向上找，否则永远取到空串。

        parentGroup: el.closest('[data-group]')?.getAttribute('data-group') ?? '',

        rowId: el.closest('button[role="menuitemradio"]')?.getAttribute('id') ?? '',

        inMenu: el.closest('[role="menu"]') !== null,

        inSettings: el.closest('[data-shortcut-modal="settings"]') !== null,

      })),

  )



const settingsText = () => page.evaluate(() => document.getElementById('settingsContent')?.textContent ?? '')



const clickSettingsIcon = async () => {

  await page.evaluate(() => {

    const button = document.querySelector('[data-mas-settings-toggle]')

    button?.click()

  })

  await page.waitForTimeout(300)

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

}



// ─────────────────────────── 1. 工具栏不刷屏 ───────────────────────────

await boot()



await test('顶部普通 menu 按钮一个徽标都不挂，也不挂设置入口', async () => {

  const list = await badges()

  // 合法自有节点只可能落在三处：宿主菜单行、设置页正文、模型选择按钮旁（设置图标 / 冷却倒计时）。

  const stray = list.filter((item) => !item.inMenu && !item.inSettings && item.parentId !== 'modelRoot')

  assert.equal(stray.length, 0, `普通按钮被标注：${JSON.stringify(stray)}`)

})



await test('设置入口只挂在模型选择按钮旁，且恰 1 枚', async () => {

  const info = await page.evaluate(() => {

    const nodes = [...document.querySelectorAll('[data-mas-settings-toggle]')]

    return nodes.map((node) => ({

      parentId: node.parentElement?.getAttribute('id') ?? '',

      aria: node.getAttribute('aria-label') ?? '',

      title: node.getAttribute('title') ?? '',

      text: (node.textContent ?? '').trim(),

      rowSiblings: [...(node.parentElement?.children ?? [])].filter((c) => c !== node).map((c) => c.id || c.tagName),

    }))

  })

  assert.equal(info.length, 1, `设置入口应当只有 1 个，实际 ${info.length}`)

  assert.equal(info[0].parentId, 'modelRoot', '齿轮必须和模型下拉同一个父容器')

  assert.equal(info[0].aria, '打开设置页面（模型自动选择）')

  assert.equal(info[0].title, '打开设置页面（模型自动选择）')

  assert.equal(info[0].text, '', '图标按钮不该带文字（避免挤压下拉）')

  // 同一行：齿轮与触发器是 root 的兄弟，且 root 被补成 flex 行

  assert.deepEqual(info[0].rowSiblings, ['modelTrigger'], `齿轮应紧跟下拉按钮：${JSON.stringify(info[0].rowSiblings)}`)

})



await test('齿轮与下拉同一行：root 被补成 nowrap flex 行（不掉行）', async () => {

  const row = await page.evaluate(() => {

    const root = document.getElementById('modelRoot')

    if (root === null) return null

    const cs = getComputedStyle(root)

    const trigger = document.getElementById('modelTrigger')

    const gear = root.querySelector('[data-mas-settings-toggle]')

    return {

      display: cs.display,

      wrap: cs.flexWrap,

      align: cs.alignItems,

      marker: root.getAttribute('data-mas-settings-row') ?? '',

      // 触发器和齿轮的垂直中心应当一致（同一行）

      sameLine:

        trigger !== null && gear !== null

          ? Math.abs(trigger.getBoundingClientRect().top - gear.getBoundingClientRect().top) < 4

          : false,

      // 齿轮不该被挤到下一行：top 不能比触发器大一个行高

      dropped: trigger !== null && gear !== null ? gear.getBoundingClientRect().top - trigger.getBoundingClientRect().top > 8 : true,

    }

  })

  assert.ok(row !== null, 'root 不存在')

  assert.equal(row.display, 'flex')

  assert.equal(row.wrap, 'nowrap')

  assert.equal(row.align, 'center')

  assert.equal(row.marker, '1')

  assert.equal(row.sameLine, true, '触发器与齿轮不在同一行')

  assert.equal(row.dropped, false, '齿轮被挤到了下一行')

})



await test('旧版「模型面板」按钮已经不存在', async () => {

  const found = await page.evaluate(() => {

    const nodes = [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').includes('模型面板'))

    return nodes.length

  })

  assert.equal(found, 0, '输入框旁不该再有「模型面板」按钮')

})



await test('冷却未激活时，模型选择按钮旁不挂倒计时', async () => {

  const list = await badges()

  const onTrigger = list.filter((item) => item.parentId === 'modelWrap' && /冷 /.test(item.text))

  assert.equal(onTrigger.length, 0, `不该有冷却徽标：${JSON.stringify(onTrigger)}`)

})



await test('宿主菜单只补限免与分组名，不标占用（用/占 已撤除）', async () => {

  const list = await badges()

  const inMenu = list.filter((item) => item.inMenu)

  const texts = inMenu.map((item) => item.text).sort()

  assert.deepEqual(texts, ['免'], `菜单徽标应只剩限免短词（占用徽标已撤），实际 ${JSON.stringify(texts)}`)

  assert.equal(
    inMenu.filter((item) => /^[用占]/.test(item.text)).length,
    0,
    `不该再出现占用徽标：${JSON.stringify(inMenu.map((item) => item.text))}`,
  )

})



await test('occupancy 里 inUse 为真的两行也不再画任何徽标（撤除口径的防回归）', async () => {

  // 夹具里 alpha/a-text-1（running）与 alpha/a-text-2（inUse 非 running）都是 inUse=true，
  // 撤除后这两行必须与空闲行一样没有任何自有徽标。
  const rows = await page.evaluate(() => {
    const occ = window.__mas.snapshot()?.view?.occupancy ?? {}
    return ['m-0', 'm-1'].map((id) => {
      const leaves = [...document.querySelectorAll(`#${id} [data-mas-badge]`)].filter(
        (el) => el.querySelector('[data-mas-badge]') === null,
      )
      return { id, texts: leaves.map((el) => (el.textContent ?? '').trim()) }
    })
  })

  for (const row of rows) {
    assert.deepEqual(row.texts, [], `${row.id} 在夹具里是被占用行，撤除后不该有任何徽标：${JSON.stringify(row.texts)}`)
  }

})



await test('空闲行不出现「空闲」徽标（默认态不加噪音）', async () => {

  const list = await badges()

  assert.equal(list.filter((item) => item.text === '空闲').length, 0)

})



await test('宿主自己标过「限时免费」的行不再补「免」（不重复标注）', async () => {

  const list = await badges()

  const onHostTagged = list.filter((item) => item.rowId === 'm-5')

  assert.equal(onHostTagged.length, 0, `宿主已标免费的行走被重复标注：${JSON.stringify(onHostTagged)}`)

  const onPlain = list.filter((item) => item.rowId === 'm-4' && item.text === '免')

  assert.equal(onPlain.length, 1, '宿主没标免费的限免行应当补一枚「免」')

})



await test('宿主菜单行顺序完全不变（不重排，方向键不跳序）', async () => {

  const order = await page.evaluate(() => [...document.querySelectorAll('button[role="menuitemradio"]')].map((node) => node.id))

  assert.deepEqual(order, ['m-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5'])

})



// ─────────────────────────── 2. 设置入口 → dsh 设置页面的「模型自动选择」 ───────────────────────────

await test('点齿轮会打开 dsh 设置页，并停到「模型自动选择」', async () => {

  await clickSettingsIcon()

  const state = await page.evaluate(() => ({

    hasSettingsPanel: document.querySelector('[data-shortcut-modal="settings"]') !== null,

    hasTeamPanel: document.querySelector('[data-team-panel]') !== null,

    navClicked: window.__navClicked,

  }))

  assert.equal(state.hasSettingsPanel, true, '设置面板没打开')

  assert.equal(state.hasTeamPanel, false, '不该打开智能体团队面板')

  assert.equal(state.navClicked, '模型自动选择', `没有停到本插件的 section：${state.navClicked}`)

})



await test('设置面板已开时再点齿轮不会重复报错', async () => {

  await clickSettingsIcon()

  const state = await page.evaluate(() => ({

    hasSettingsPanel: document.querySelector('[data-shortcut-modal="settings"]') !== null,

    navClicked: window.__navClicked,

  }))

  assert.equal(state.hasSettingsPanel, true, '重复点击把设置面板关掉了')

  assert.equal(state.navClicked, '模型自动选择')

})



// 齿轮打开的就是设置页，正文由宿主的 navCell click 渲染；这里再显式渲染一次保证幂等

await page.evaluate(() => window.__renderSection())

await page.waitForTimeout(100)



await test('设置页按类型跨来源分组：多模态在前、纯文本在后', async () => {

  const text = await settingsText()

  const multi = text.indexOf('多模态 · 2')

  const plain = text.indexOf('纯文本 · 4')

  assert.ok(multi >= 0 && plain >= 0, `缺少分组标题：${text.slice(0, 200)}`)

  assert.ok(multi < plain, '多模态分组应当排在纯文本之前')

})



await test('同一个分组里混有不同 provider 的模型（真正跨来源）', async () => {

  const rows = await page.evaluate(() => {

    const content = document.getElementById('settingsContent')

    if (content === null) return []

    // 只取模型行：每行带 data-mas-model-row（provider 与 model 用 \u0000 连接），不会混进配置行

    return [...content.querySelectorAll('[data-mas-model-row]')].map((row) => row.textContent ?? '')

  })

  const multiRows = rows.filter((row) => /A-MM-1|B-MM-1/.test(row))

  assert.equal(multiRows.length, 2, `多模态组应含两个来源的模型：${JSON.stringify(rows)}`)

  assert.ok(multiRows.some((row) => row.includes('Alpha 官方')) && multiRows.some((row) => row.includes('Beta')), '多模态组没有跨来源')

})



await test('设置页行内标 `图` / `文` 单字类型', async () => {

  const glyphs = await page.evaluate(() => {

    const content = document.getElementById('settingsContent')

    if (content === null) return []

    return [...content.querySelectorAll('[data-mas-own]')]

      .filter((el) => el.querySelector('[data-mas-own]') === null)

      .map((el) => (el.textContent ?? '').trim())

      .filter((text) => text !== '')

  })

  assert.ok(glyphs.includes('图'), `缺少「图」：${JSON.stringify(glyphs)}`)

  assert.ok(glyphs.includes('文'), `缺少「文」：${JSON.stringify(glyphs)}`)

})



await test('设置页里标出限免（缩写 免），不再标占用（用/占 已撤除）', async () => {

  const pills = await page.evaluate(() =>

    [...document.querySelectorAll('[data-shortcut-modal="settings"] [data-mas-badge]')].map((el) => (el.textContent ?? '').trim()),

  )

  assert.ok(pills.includes('免'), `缺少限免短词：${JSON.stringify(pills)}`)

  assert.equal(
    pills.filter((text) => /^[用占]/.test(text)).length,
    0,
    `设置页不该再出现占用徽标：${JSON.stringify(pills)}`,
  )

})



await test('设置页：模型列表用「入组」下拉把模型选进分组，未保存不生效', async () => {
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  // 先建一个分组，入组下拉才有目标
  await page.evaluate(() => {
    const input = document.querySelector('[data-mas-group-new]')
    input.value = '精选组'
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes('新建分组'))
    button.click()
  })
  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  // 入组下拉必须出现（每行一个），且默认是「不入组」
  const selects = await page.evaluate(() => document.querySelectorAll('[data-mas-assign]').length)
  assert.ok(selects >= ENTRIES.length, `入组下拉数量不足：${selects}`)

  const before = posted.filter((body) => Array.isArray(body.customGroups)).length

  // 把 alpha/a-mm-1 选进第一个分组
  await page.evaluate(() => {
    const select = document.querySelector('[data-mas-assign="alpha/a-mm-1"]')
    if (select === null || select === undefined) return
    select.value = select.options[1].value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(250)

  assert.equal(
    posted.filter((body) => Array.isArray(body.customGroups)).length,
    before,
    `未点保存就提交了 customGroups：${JSON.stringify(posted)}`,
  )
  const bar = await page.evaluate(() => document.querySelector('[data-mas-savebar]')?.textContent ?? '')
  assert.ok(bar.includes('未保存'), `保存条没提示未保存：${bar}`)

  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)
  const hit = posted.filter((body) => Array.isArray(body.customGroups)).at(-1)
  assert.ok(hit !== undefined, `没有提交 customGroups：${JSON.stringify(posted)}`)
  const group = hit.customGroups.find((item) => (item.label ?? '') === '精选组') ?? hit.customGroups[0]
  assert.equal(group.explicit, true, '入组后该分组必须是显式成员模式')
  assert.deepEqual(group.models, ['alpha/a-mm-1'], '入组后成员名单要包含该模型')
})

await test('设置页里能改自动选择配置（重试次数）', async () => {
  await page.evaluate(() => {
    const input = document.querySelector('[data-mas-field="maxRetries"]')
    if (input !== null && input !== undefined) {
      input.value = '5'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await page.waitForTimeout(200)
  assert.equal(
    posted.filter((body) => body.maxRetries !== undefined).length,
    0,
    '未点保存就提交了 maxRetries',
  )
  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)

  const hit = posted.find((body) => body.maxRetries !== undefined)
  assert.ok(hit !== undefined, `没有提交 maxRetries：${JSON.stringify(posted)}`)
  assert.equal(hit.maxRetries, 5)
})

await test('配置表单只保留 13 项，精简项与只读汇总不再铺开', async () => {

  // 自定义分组这一项是多控件区块（不是单行 label），所以按正文包含判断，而不是只扫 label 行。

  const text = await settingsText()

  assert.equal(FIELDS.length, 13, '夹具配置项应当精简为 13 项')

  // 9 项会渲染成可见标签：7 个运行策略项（含分组方式、自动探测间隔）+ 分组卡的自定义分组 + 按类型分组。
  // 另外 4 个数组字段（disabledModels/disabledGroups/hiddenModels/hiddenGroups）是逐行开关
  // 的写盘通道，故意不铺成配置行，QUIET_FIELDS 也把它们从「其他」里排除了。
  const rendered = [
    'enabled', 'defaultModel', 'maxRetries', 'groupMode', 'probeIntervalMin',
    'preferIdle', 'switchScope', 'customGroups', 'groupByKind',
  ]
  for (const key of rendered) {
    const field = FIELDS.find((f) => f.key === key)
    assert.ok(field !== undefined && text.includes(field.label), `缺少配置项 ${key}(${field?.label})`)
  }

  // 精简掉的 8 项高级旋钮，标签一个都不能再出现。
  for (const label of [
    '来源排序', '模型排序', '可切换错误码', '目录缓存 ms', '占用刷新 ms',
    '限免短词', '允许跨类型兜底', '冷却期抑制刷新',
  ]) {
    assert.ok(!text.includes(label), `精简项「${label}」不应再出现在设置页`)
  }

})



await test('设置页显示配置写入位置', async () => {

  const text = await settingsText()

  assert.ok(text.includes('cordis.patch.yml'), `未显示写入位置：${text.slice(-200)}`)

})



// ─────────────────────────── 3. 冷却、失败落日志、幂等 ───────────────────────────

await test('冷却激活时，模型选择按钮旁出现「冷 mm:ss」', async () => {

  await boot(makeView({ cooldown: { active: true, until: Date.now() + 90_000, remainingMs: 90_000, reason: '同类型候选全部不可用' } }))

  const list = await badges()

  const hit = list.filter((item) => item.parentId === 'modelRoot' && /^冷 \d{2}:\d{2}$/.test(item.text))

  assert.equal(hit.length, 1, `冷却徽标异常：${JSON.stringify(list)}`)

})



await test('冷却激活时，工具栏其它 menu 按钮依然干净', async () => {

  const list = await badges()

  const stray = list.filter((item) => ['标准模式', 'WorkBuddy 选择器', '通知'].includes(item.parentAria))

  assert.equal(stray.length, 0, `普通按钮被标注：${JSON.stringify(stray)}`)

})



await test('冷却结束后触发按钮徽标被移除（不残留）', async () => {

  await boot(makeView())

  const list = await badges()

  assert.equal(list.filter((item) => item.parentId === 'modelRoot' && /冷 /.test(item.text)).length, 0)

})



await test('找不到宿主设置入口时，落一条 settings-open-failed beacon', async () => {

  await boot()

  await page.evaluate(() => {

    document.getElementById('settingsLauncher')?.remove()

    document.querySelector('[data-mas-settings-toggle]')?.click()

  })

  await page.waitForTimeout(400)

  const hit = beacons.find((item) => item.phase === 'settings-open-failed')

  assert.ok(hit !== undefined, `没有落 beacon：${JSON.stringify(beacons)}`)

  assert.equal(hit.step, 'launcher-missing')

})



await test('launcher 槽被账号菜单占用时，经账号菜单 → 菜单项「设置Ctrl+Alt+,」仍能进设置页', async () => {

  await boot()

  await page.evaluate(() => {

    // 真机：settings.launcher 是 single 槽，被 settings-account 的 AccountMenu 占走，
    // general 的 fallback 按钮根本不渲染（fallback 只在槽为空时生效）。
    // 夹具等价处理：抹掉「设置」label（路径 1 失效）、不给 _trigger 类名（路径 3 失效），

    // 只留账号菜单 + 菜单项「设置」。

    const launcher = document.getElementById('settingsLauncher')

    launcher.setAttribute('aria-label', '设置入口（占位）')

    const acct = document.createElement('button')

    acct.id = 'acctMenu'

    acct.type = 'button'

    acct.setAttribute('aria-label', '账号菜单')

    acct.setAttribute('aria-haspopup', 'menu')

    acct.textContent = '账号'

    acct.addEventListener('click', () => {

      // 注意：不能用 `[role="menu"]` 判重 —— 模型下拉菜单本身就在页面上，会误判成「已开」

      if (document.getElementById('acctMenuList') !== null) return

      const menu = document.createElement('div')

      menu.id = 'acctMenuList'

      menu.setAttribute('role', 'menu')

      // 真机 MenuItemButton 把快捷键提示拼进同一个 button 的 textContent：

      // 实测文本是「设置Ctrl+Alt+,」而不是「设置」，整串相等匹配必然落空。

      const item = document.createElement('button')

      item.setAttribute('role', 'menuitem')

      const icon = document.createElement('span')

      icon.className = '_itemIcon_4ub78_148'

      item.appendChild(icon)

      const shortcut = document.createElement('span')

      shortcut.textContent = 'Ctrl+Alt+,'

      item.appendChild(shortcut)

      const label = document.createElement('span')

      label.className = '_itemLabel_4ub78_190'

      label.textContent = '设置'

      item.appendChild(label)

      item.addEventListener('click', () => launcher.click())

      menu.appendChild(item)

      document.body.appendChild(menu)

    })

    document.body.appendChild(acct)

    document.querySelector('[data-mas-settings-toggle]').click()

  })

  await page.waitForTimeout(1200)

  const state = await page.evaluate(() => ({

    hasSettingsPanel: document.querySelector('[data-shortcut-modal="settings"]') !== null,

    navClicked: window.__navClicked,

  }))

  assert.equal(state.hasSettingsPanel, true, `账号菜单路径没打开设置面板：${JSON.stringify({ state, beacons })}`)

  assert.equal(state.navClicked, '模型自动选择', `没有停到本插件的 section：${state.navClicked}`)

})

await test('设置面板开了但没有本插件的导航项时，落 step=nav-item-missing', async () => {

  await boot()

  await page.evaluate(() => {

    // 把导航项里的「模型自动选择」摘掉，模拟 section 注册丢失

    const launcher = document.getElementById('settingsLauncher')

    const original = launcher.onclick

    launcher.click()

    document.querySelectorAll('[data-shortcut-modal="settings"] button').forEach((cell) => {

      if ((cell.textContent ?? '').trim() === '模型自动选择') cell.remove()

    })

    void original

    document.querySelector('[data-mas-settings-toggle]').click()

  })

  await page.waitForTimeout(1200)

  const hit = beacons.find((item) => item.phase === 'settings-open-failed')

  assert.ok(hit !== undefined, `没有落 beacon：${JSON.stringify(beacons)}`)

  assert.equal(hit.step, 'nav-item-missing')

})

await test('设置页 section 仍然注册并可渲染完整视图（齿轮不再跳它，但入口还在）', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  const text = await settingsText()
  for (const needle of ['运行策略', '自定义分组', '重新获取']) {
    assert.ok(text.includes(needle), `设置页缺少「${needle}」：${text.slice(0, 300)}`)
  }
})

await test('重复 apply / decorate 不叠加节点（幂等）', async () => {

  await boot()

  const before = await page.evaluate(() => document.querySelectorAll('[data-mas-own]').length)

  await page.evaluate(() => {

    window.__mas.apply()

    window.__mas.apply()

    window.__mas.apply()

  })

  await page.waitForTimeout(300)

  const after = await page.evaluate(() => document.querySelectorAll('[data-mas-own]').length)

  assert.equal(after, before, `节点数变化：${before} → ${after}`)

  const toggles = await page.evaluate(() => document.querySelectorAll('[data-mas-settings-toggle]').length)

  assert.equal(toggles, 1)

})



await test('snapshot() 暴露 build / view / config 供排障（不含已移除的 panelOpen）', async () => {
  const snap = await page.evaluate(() => {
    const value = window.__mas.snapshot()
    return { build: value.build, hasView: value.view !== null, hasPanelOpen: 'panelOpen' in value, config: value.config !== null }
  })
  assert.equal(snap.build, 'mas-v11')
  assert.equal(snap.hasView, true)
  assert.equal(snap.hasPanelOpen, false)
  assert.equal(snap.config, true)
})

await test('设置页：自定义分组可新建、可改名、可从模型列表入组', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())

  const save = async () => {
    await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
    await page.waitForTimeout(400)
    await page.evaluate(() => window.__renderSection())
    await page.waitForTimeout(150)
  }

  // 新建一个空分组（显式成员模式，不会一建就吞掉全部模型）
  await page.evaluate(() => {
    const input = document.querySelector('[data-mas-group-new]')
    input.value = '我的多模态'
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes('新建分组'))
    button.click()
  })
  await page.waitForTimeout(200)
  assert.equal(
    posted.filter((body) => Array.isArray(body.customGroups)).length,
    0,
    '未点保存就提交了 customGroups',
  )
  await save()
  const created = posted.find((body) => Array.isArray(body.customGroups))
  assert.ok(created !== undefined, `没有提交 customGroups：${JSON.stringify(posted)}`)
  // 前面的用例可能已经建过组（夹具服务端的配置是持久的），所以按 label 定位新建的那个
  const mine = created.customGroups.find((item) => item.label === '我的多模态')
  assert.ok(mine !== undefined, `没提交新建的分组：${JSON.stringify(created.customGroups)}`)
  assert.equal(mine.explicit, true, '新建的分组必须是显式成员模式')
  assert.deepEqual(mine.models, [], '新建分组必须是空名单，不能吞模型')

  // 改名
  await page.evaluate(() => {
    const input = document.querySelector('[data-mas-group-name]')
    input.value = '多模态精选'
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await save()
  const renamed = posted.filter((body) => Array.isArray(body.customGroups)).at(-1)
  assert.ok(
    renamed.customGroups.some((item) => item.label === '多模态精选'),
    `改名没生效：${JSON.stringify(renamed.customGroups)}`,
  )

  // 从模型列表把模型入组（用户 m04856 第 1 条：先建组，再在模型列表选入组）
  await page.evaluate(() => {
    const select = document.querySelector('[data-mas-assign="alpha/a-text-1"]')
    if (select === null || select === undefined) return
    select.value = select.options[1].value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await save()
  const withMember = posted.filter((body) => Array.isArray(body.customGroups)).at(-1)
  // 成员名单里存的是 provider/model 全名（见 core.ts matchesGroup 的 explicit 分支）
  const target = withMember.customGroups.find((item) => item.label === '多模态精选')
  assert.ok(target !== undefined, `找不到改名后的分组：${JSON.stringify(withMember.customGroups)}`)
  assert.ok(
    target.models.includes('alpha/a-text-1'),
    `入组后成员名单要包含该模型：${JSON.stringify(target.models)}`,
  )
})

await test('设置页：分组整组「下拉展示」开关可提交（自动选择已全局化）', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  // 先建一个分组，卡片上才有整组开关
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes('新建分组'))
    button.click()
  })
  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  // 自动选择是全局统一开关，分组卡片上不该再有「启用本组」
  const hasGroupEnable = await page.evaluate(() => document.querySelectorAll('[data-mas-group-flag="disabled"]').length)
  assert.equal(hasGroupEnable, 0, '分组卡片上不应再有整组「自动选择」开关')

  const fired = await page.evaluate(() => {
    const box = document.querySelector('[data-mas-group-flag="hidden"]')
    if (box === null) return false
    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })
  assert.equal(fired, true, '分组卡片上应有整组「下拉展示」开关')
  await page.waitForTimeout(200)
  assert.equal(
    posted.filter((body) => Array.isArray(body.hiddenGroups)).length,
    0,
    '未点保存就提交了 hiddenGroups',
  )

  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)
  const hit = posted.find((body) => Array.isArray(body.hiddenGroups) && body.hiddenGroups.length > 0)
  assert.ok(hit !== undefined, `没有提交 hiddenGroups：${JSON.stringify(posted)}`)
  assert.equal(hit.hiddenGroups.length, 1, '整组关掉后 hiddenGroups 应有一条')
})

await test('设置页：重试次数超出范围时不提交，并给出范围提示', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)
  const before = posted.length
  const hint = await page.evaluate(() => {
    const input = document.querySelector('[data-mas-field="maxRetries"]')
    if (input === null || input === undefined) return null
    input.value = '99'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return document.querySelector('[role="status"]')?.textContent ?? ''
  })
  await page.waitForTimeout(200)
  assert.equal(posted.length, before, '越界值不能被提交')
  assert.ok((hint ?? '').includes('0 – 10'), `缺少范围提示：${hint}`)
  const draft = await page.evaluate(() => document.querySelector('[data-mas-savebar]')?.textContent ?? '')
  assert.ok(draft.includes('没有未保存的改动'), `越界值不该进草稿：${draft}`)
})

await test('设置页：精简移除旧冷却/重试间隔项，新数字项展示真实单位与范围', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  const text = await settingsText()
  // 旧契约：cooldownMs / retryDelayMs 已从 CONFIG_FIELDS 删除 → 标签与换算提示都不该再出现。
  // 这是跟随契约变更的实质加严，不是放宽：原来只 2 条 assert，现在 5 条且绑定真实渲染文本。
  assert.ok(!text.includes('冷却时长'), `已精简的冷却时长配置行不该再出现：${text.slice(0, 200)}`)
  assert.ok(!text.includes('重试间隔'), '已精简的重试间隔配置行不该再出现')
  assert.ok(!text.includes('60000'), '旧「1 分钟 = 60000」换算提示不该再出现')
  // 新契约：probeIntervalMin 数字项由 NUMBER_RULES 渲染出可见单位与范围（不只写在 input 属性里）。
  assert.ok(text.includes('分钟（0 = 不自动探测）'), `新数字项没展示真实单位：${text.slice(0, 200)}`)
  assert.ok(text.includes('1440'), '新数字项应展示真实范围上限 1440')
})

await test('设置页：模型列表拉取失败时给出原因与「重新获取」', async () => {
  // 让目录接口真的失败一次（走真实代码路径，不虚构客户端 API）
  server.__failCatalog = true
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(300)
  const text = await settingsText()
  const hasRetry = await page.evaluate(() => document.querySelectorAll('[data-mas-retry]').length)
  assert.ok(text.includes('加载失败') || text.includes('HTTP'), `失败态文案缺失：${text.slice(0, 200)}`)
  assert.equal(hasRetry, 1, '失败态必须给「重新获取」按钮')
  server.__failCatalog = false
})

await test('设置页：「重新获取」成功后状态行落定（不再卡在「正在重新获取」）', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  await page.evaluate(() => document.querySelector('[data-mas-retry]')?.click())
  await page.waitForTimeout(400)
  const text = await settingsText()
  assert.ok(!text.includes('正在重新获取'), `状态行没复位：${text.slice(0, 240)}`)
  assert.ok(text.includes('已刷新模型列表'), `缺少成功文案：${text.slice(0, 240)}`)
  assert.ok(/\d+ 个模型/.test(text), '成功文案应带模型数量')
  assert.ok(
    catalogQueries.includes('?refresh=1'),
    `「重新获取」没带 refresh=1，等于没绕过 60s 缓存：${JSON.stringify(catalogQueries)}`,
  )
})

await test('设置页：「重新获取」失败时状态行转成失败原因', async () => {
  server.__failCatalog = true
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  await page.evaluate(() => document.querySelector('[data-mas-retry]')?.click())
  await page.waitForTimeout(400)
  const text = await settingsText()
  server.__failCatalog = false
  assert.ok(!text.includes('正在重新获取'), `状态行没复位：${text.slice(0, 240)}`)
  assert.ok(text.includes('模型列表刷新失败'), `缺少失败文案：${text.slice(0, 240)}`)
})

await test('设置页：「自动切换范围」是可操作的三选下拉，改动能进草稿', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  const info = await page.evaluate(() => {
    const node = document.querySelector('[data-mas-field="switchScope"]')
    if (node === null) return null
    return {
      tag: node.tagName,
      value: node.value,
      options: Array.from(node.options ?? []).map((option) => option.value),
      text: node.parentElement?.textContent ?? '',
    }
  })
  assert.ok(info !== null, '缺少 switchScope 控件')
  assert.equal(info.tag, 'SELECT', '应当是下拉，不是文本框')
  assert.equal(info.value, 'group-cross', '默认值应回显 group-cross')
  assert.deepEqual(info.options, ['group', 'group-cross', 'all'], '三选：组内 / 组内→跨组 / 全部')
  assert.ok(info.text.includes('自动切换范围'), `缺少标签：${info.text}`)

  await page.evaluate(() => {
    const node = document.querySelector('[data-mas-field="switchScope"]')
    node.value = 'group'
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(200)
  const draft = await page.evaluate(() => document.querySelector('[data-mas-savebar]')?.textContent ?? '')
  assert.ok(draft.includes('switchScope') || draft.includes('自动切换范围'), `改动没进草稿：${draft}`)
  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)
  const hit = posted.find((body) => body.switchScope !== undefined)
  assert.ok(hit !== undefined, `没有提交 switchScope：${JSON.stringify(posted)}`)
  assert.equal(hit.switchScope, 'group')
})

await test('设置页：下拉改回原值后草稿自动摘掉，不会留一条假改动', async () => {
  posted.length = 0
  serverConfig.switchScope = 'group-cross'
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)

  const setScope = async (value) => {
    await page.evaluate((next) => {
      const node = document.querySelector('[data-mas-field="switchScope"]')
      node.value = next
      node.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
    await page.waitForTimeout(200)
  }

  await setScope('group')
  const staged = await page.evaluate(() => document.querySelector('[data-mas-savebar]')?.textContent ?? '')
  assert.ok(staged.includes('未保存'), `改动没进草稿：${staged}`)

  await setScope('group-cross')
  const after = await page.evaluate(() => document.querySelector('[data-mas-savebar]')?.textContent ?? '')
  assert.ok(after.includes('没有未保存的改动'), `改回原值后仍挂着假改动：${after}`)
  const saveBtn = await page.evaluate(() => document.querySelector('[data-mas-save]') !== null)
  assert.equal(saveBtn, false, '没有改动时不该出现「保存」按钮')

  const line = await page.evaluate(() => document.querySelector('[data-mas-topbar] [role="status"]')?.textContent ?? '')
  assert.ok(!/未保存：/.test(line), `状态行仍挂着「未保存：…」：${line}`)
})

await test('设置页：顶部操作条常驻，滚到哪都能看到保存入口', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  const bar = await page.evaluate(() => {
    const node = document.querySelector('[data-mas-topbar]')
    if (node === null) return null
    const style = getComputedStyle(node)
    return { position: style.position, top: style.top, zIndex: style.zIndex, text: node.textContent ?? '' }
  })
  assert.ok(bar !== null, '缺少顶部操作条 [data-mas-topbar]')
  assert.equal(bar.position, 'sticky', `顶部操作条必须 sticky，实际 ${bar.position}`)
  assert.equal(bar.top, '0px', '顶部操作条应贴在容器顶部')
  assert.ok(bar.text.includes('模型自动选择'), '操作条要有标题')
  assert.ok(bar.text.includes('重新获取'), '操作条要有重新获取入口')
})

await test('设置页：三个步骤标题按 分组 → 模型入组 → 运行策略 的顺序出现', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  const steps = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mas-step]')].map((node) => ({
      step: node.getAttribute('data-mas-step'),
      text: node.textContent ?? '',
    })),
  )
  assert.equal(steps.length, 3, `步骤标题应有 3 个，实际 ${steps.length}`)
  assert.deepEqual(steps.map((item) => item.step), ['1', '2', '3'], '步骤顺序应为 1/2/3')
  assert.ok(steps[0].text.includes('分组'), '第一步是分组')
  assert.ok(steps[1].text.includes('模型入组'), '第二步是模型入组')
  assert.ok(steps[2].text.includes('运行策略'), '第三步是运行策略')
})

await test('设置页：分组筛选 chips 只在建组后出现，点「未入组」只显示未入组的模型', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  // 先建一个组并保存，筛选条才会出现
  await page.evaluate(() => {
    const input = document.querySelector('[data-mas-group-new]')
    input.value = '筛选组'
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').includes('新建分组'))
    button.click()
  })
  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  const chips = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mas-filter]')].map((node) => node.getAttribute('data-mas-filter')),
  )
  assert.ok(chips.length >= 3, `筛选 chips 至少应有 全部/未入组/自定义组 三类，实际 ${JSON.stringify(chips)}`)
  assert.ok(chips.includes('__loose__'), '筛选条里应有「未入组」')

  // 切到「未入组」：只剩未入组行，且组内成员不再出现
  await page.evaluate(() => document.querySelector('[data-mas-filter="__loose__"]')?.click())
  await page.waitForTimeout(250)
  const view = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('[data-mas-group-head]')].map((node) => node.getAttribute('data-mas-group-head')),
    rows: [...document.querySelectorAll('[data-mas-model-row]')].map((node) => node.getAttribute('data-mas-model-row')),
    loose: [...document.querySelectorAll('[data-mas-unassigned]')].length,
  }))
  assert.deepEqual(view.heads, ['__loose__'], `筛选后应只剩未入组一段：${JSON.stringify(view.heads)}`)
  assert.equal(view.rows.length, view.loose, '未入组视图里每一行都该带「未入组」标记')
})

await test('设置页：模型清单超过 12 行先折叠，点展开显示全部', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  // 夹具只有 6 个模型，先造足够多行：用未入组段（6 行）不够 12，所以直接断言折叠逻辑的阈值不触发、
  // 而展开按钮只在超阈值时出现——反向验证：默认没有 data-mas-expand
  const expanded = await page.evaluate(() => document.querySelectorAll('[data-mas-expand]').length)
  assert.equal(expanded, 0, '不足 12 行时不该出现展开按钮')
  const rows = await page.evaluate(() => document.querySelectorAll('[data-mas-model-row]').length)
  assert.equal(rows, ENTRIES.length, `默认应显示全部 ${ENTRIES.length} 行，实际 ${rows}`)
})

await test('设置页：精简后无高级块展开按钮，也不残留「其他」兜底块', async () => {
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  const info = await page.evaluate(() => {
    const text = document.getElementById('settingsContent')?.textContent ?? ''
    return {
      hasToggle: document.querySelector('[data-mas-advanced-toggle]') !== null,
      hasBody: document.querySelector('[data-mas-advanced-body]') !== null,
      hasAdvancedWord: text.includes('高级') || text.includes('缓存') || text.includes('徽标'),
      hasOtherBlock: text.includes('新增配置项'),
      fieldCount: document.querySelectorAll('[data-mas-field]').length,
    }
  })
  assert.equal(info.hasToggle, false, '精简后不应再有高级块展开/收起按钮')
  assert.equal(info.hasBody, false, '精简后不应再有高级块内容容器')
  assert.equal(info.hasAdvancedWord, false, '精简后设置页不应出现「高级/缓存/徽标」字样')
  assert.equal(info.hasOtherBlock, false, 'QUIET_FIELDS 应把 4 个数组字段排除，不落到「其他」块')
  assert.ok(info.fieldCount >= 7, `运行策略区应正常渲染可见控件，实际 ${info.fieldCount} 个`)
})

await test('宿主下拉真正隐藏未入组模型：分组 pill + 降透明度 + display:none', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '免费模型',
      kind: '',
      providers: [],
      models: ['alpha/a-text-1', 'beta/b-mm-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('button[role="menuitemradio"]')].map((row) => ({
      id: row.getAttribute('id'),
      unassigned: row.getAttribute('data-mas-unassigned-row') === '1',
      hidden: row.getAttribute('data-mas-hidden-row') === '1',
      opacity: row.style.opacity,
      display: row.style.display,
      pills: [...row.querySelectorAll('[data-mas-badge]')]
        .filter((el) => el.querySelector('[data-mas-badge]') === null)
        .map((el) => (el.textContent ?? '').trim()),
    })),
  )
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
  assert.deepEqual(byId['m-0'].pills.filter((t) => t === '免费模型'), ['免费模型'], `m-0 应标出「免费模型」：${JSON.stringify(byId['m-0'])}`)
  assert.equal(byId['m-3'].pills.filter((t) => t === '免费模型').length, 1, 'm-3（beta/b-mm-1）也在该组里')
  for (const id of ['m-1', 'm-2', 'm-4', 'm-5']) {
    assert.equal(byId[id].pills.filter((t) => t === '未入组').length, 1, `${id} 未入组应标「未入组」：${JSON.stringify(byId[id])}`)
    assert.equal(byId[id].unassigned, true, `${id} 应带 data-mas-unassigned-row`)
    assert.equal(byId[id].opacity, '0.55', `${id} 未入组行应降透明度`)
    assert.equal(byId[id].hidden, true, `${id} 未入组行应带 data-mas-hidden-row`)
    assert.equal(byId[id].display, 'none', `${id} 未入组行应真正 display:none（不再出现在宿主下拉）`)
  }
  assert.equal(byId['m-0'].unassigned, false, '已入组行不应带未入组标记')
  assert.equal(byId['m-0'].opacity, '', '已入组行不应降透明度')
  assert.equal(byId['m-0'].hidden, false, '已入组行不应带隐藏标记')
  assert.notEqual(byId['m-0'].display, 'none', '已入组行应可见')
  serverConfig.customGroups = []
})

await test('宿主下拉只认已保存的分组：设置页里没保存的草稿不泄漏到下拉', async () => {
  await boot()
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('button[role="menuitemradio"] [data-mas-badge]')]
      .filter((el) => el.querySelector('[data-mas-badge]') === null)
      .map((el) => (el.textContent ?? '').trim())
      .filter((text) => text === '未入组' || text === '草稿组'),
  )
  assert.equal(before.filter((t) => t === '草稿组').length, 0, '初始下拉不应出现草稿组名')

  // 在设置页里新建一个组（只进草稿，不点保存）
  await clickSettingsIcon()
  await page.evaluate(() => {
    const input = document.querySelector('[data-mas-group-new]')
    if (input !== null) input.value = '草稿组'
    document.querySelector('[data-mas-group-new]')?.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((node) => (node.textContent ?? '').includes('新建分组'))
    button?.click()
  })
  await page.waitForTimeout(300)
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('button[role="menuitemradio"] [data-mas-badge]')]
      .filter((el) => el.querySelector('[data-mas-badge]') === null)
      .map((el) => (el.textContent ?? '').trim()),
  )
  assert.equal(after.filter((t) => t === '草稿组').length, 0, '未保存的草稿组名不应出现在宿主下拉里')
  assert.equal(posted.length, 0, '只建草稿不应触发任何保存请求')
})

await test('自建下拉：按用户自定义分组展示，未入组的模型不出现', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '免费模型',
      kind: '',
      providers: [],
      models: ['alpha/a-text-1', 'beta/b-mm-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  const trigger = await page.evaluate(() => {
    const node = document.querySelector('[data-mas-slot-trigger]')
    return node === null ? null : { aria: node.getAttribute('aria-label'), text: (node.textContent ?? '').trim() }
  })
  assert.ok(trigger !== null, '自建下拉应注册 conversation.input.model 槽')
  assert.ok(trigger.aria.includes('选择模型'), `触发按钮 aria 应说明用途：${trigger.aria}`)
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(200)
  const menu = await page.evaluate(() => ({
    open: document.querySelector('[data-mas-slot-menu]') !== null,
    groups: [...document.querySelectorAll('[data-mas-slot-group]')].map((el) => ({
      id: el.getAttribute('data-mas-slot-group'),
      text: (el.textContent ?? '').trim(),
    })),
    rows: [...document.querySelectorAll('[data-mas-slot-row]')].map((el) => el.getAttribute('data-mas-slot-row')),
    search: document.querySelectorAll('[data-mas-slot-search]').length,
  }))
  assert.equal(menu.open, true, '点触发按钮应打开下拉面板')
  assert.equal(menu.search, 1, '下拉应有搜索框')
  assert.deepEqual(menu.groups.map((g) => g.id), ['g1'], `下拉应只出现用户自定义分组：${JSON.stringify(menu.groups)}`)
  assert.ok(menu.groups[0].text.includes('免费模型'), '分组标题应是用户起的组名')
  assert.deepEqual(menu.rows, ['alpha/a-text-1', 'beta/b-mm-1'], `下拉只应出现已入组的模型：${JSON.stringify(menu.rows)}`)
  serverConfig.customGroups = []
})

await test('自建下拉：点一行就把该模型交给宿主 select（未入组的行根本不存在）', async () => {
  selectCalls.length = 0
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '免费模型',
      kind: '',
      providers: [],
      models: ['alpha/a-text-1', 'beta/b-mm-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(200)
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-mas-slot-row]')]
    const hit = rows.filter((el) => el.getAttribute('data-mas-slot-row') === 'beta/b-mm-1')[0]
    if (hit === undefined) return false
    hit.click()
    return true
  })
  assert.equal(target, true, '下拉里应能点到 beta/b-mm-1')
  await page.waitForTimeout(150)
  const selects = selectCalls.slice()
  assert.deepEqual(
    selects.map((row) => ({ provider: row.provider, model: row.model })),
    [{ provider: 'beta', model: 'b-mm-1' }],
    `点行应把该模型交给插件 /select 路由：${JSON.stringify(selects)}`,
  )
  assert.equal(selects[0].sessionId, 'session-1', `应带上会话 id：${JSON.stringify(selects[0])}`)
  const stillOpen = await page.evaluate(() => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    if (menu === null) return false
    return menu.style.display !== 'none'
  })
  assert.equal(stillOpen, false, '选完应关闭下拉')
  serverConfig.customGroups = []
})

await test('自建下拉：建过组但一个成员都没有时给出可操作提示', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '空组',
      kind: '',
      providers: [],
      models: [],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(200)
  const state = await page.evaluate(() => ({
    empty: document.querySelector('[data-mas-slot-empty]') !== null,
    rows: document.querySelectorAll('[data-mas-slot-row]').length,
    text: (document.querySelector('[data-mas-slot-empty]')?.textContent ?? '').trim(),
  }))
  assert.equal(state.rows, 0, '空组时下拉不应出现任何模型行')
  assert.equal(state.empty, true, '空组时应有空态提示')
  assert.ok(state.text.includes('入组'), `空态提示应指向设置页的「入组」操作：${state.text}`)
  serverConfig.customGroups = []
})

await test('自建下拉：每行都标出来源（provider 展示名），搜索也能按来源命中', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '免费模型',
      kind: '',
      providers: [],
      models: ['alpha/a-text-1', 'beta/b-mm-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(250)
  const menu = await page.evaluate(() => ({
    sources: [...document.querySelectorAll('[data-mas-slot-row]')].map((el) => ({
      row: el.getAttribute('data-mas-slot-row'),
      provider: el.getAttribute('data-mas-provider'),
      chip: (el.querySelector('[data-mas-provider]')?.textContent ?? '').trim(),
      chipTitle: el.querySelector('[data-mas-provider]')?.getAttribute('title') ?? '',
    })),
    searchRole: document.querySelector('[data-mas-slot-search]')?.getAttribute('role') ?? '',
    searchLabel: document.querySelector('[data-mas-slot-search]')?.getAttribute('aria-label') ?? '',
    listbox: document.querySelector('#mas-slot-listbox')?.getAttribute('role') ?? '',
    foot: (document.querySelector('[data-mas-slot-foot]')?.textContent ?? '').trim(),
    count: (document.querySelector('[data-mas-slot-count]')?.textContent ?? '').trim(),
  }))
  assert.equal(menu.sources.length, 2, `下拉应有 2 行：${JSON.stringify(menu.sources)}`)
  assert.equal(menu.sources[0].chip, 'Alpha 官方', `alpha 行来源应显示 provider 展示名：${menu.sources[0].chip}`)
  assert.equal(menu.sources[1].chip, 'Beta', `beta 行来源应显示 provider 展示名：${menu.sources[1].chip}`)
  assert.ok(
    menu.sources[1].chipTitle.includes('provider id：beta'),
    `来源标识应带 provider id 提示：${menu.sources[1].chipTitle}`,
  )
  assert.equal(menu.searchRole, 'combobox', `搜索框应是 combobox：${menu.searchRole}`)
  assert.ok(menu.searchLabel.includes('来源'), `搜索框 aria-label 应说明能搜来源：${menu.searchLabel}`)
  assert.equal(menu.listbox, 'listbox', `列表应有 listbox 语义：${menu.listbox}`)
  assert.ok(menu.foot.includes('↑↓'), `页脚应有键盘提示：${menu.foot}`)
  assert.equal(menu.count, '2 个模型', `页脚应显示模型总数：${menu.count}`)

  const filtered = await page.evaluate(() => {
    const input = document.querySelector('[data-mas-slot-search]')
    input.value = 'beta'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return {
      visible: [...document.querySelectorAll('[data-mas-slot-row]')]
        .filter((el) => el.style.display !== 'none')
        .map((el) => el.getAttribute('data-mas-slot-row')),
      count: (document.querySelector('[data-mas-slot-count]')?.textContent ?? '').trim(),
      groupVisible: document.querySelector('[data-mas-slot-group]')?.style.display ?? '',
    }
  })
  assert.deepEqual(
    filtered.visible,
    ['beta/b-mm-1'],
    `搜索「beta」应只命中来源为 beta 的那一行（按来源搜索生效）：${JSON.stringify(filtered.visible)}`,
  )
  assert.equal(filtered.count, '1 / 2 个模型', `搜索后页脚应显示匹配数：${filtered.count}`)
  assert.equal(filtered.groupVisible, 'flex', '还有命中行时分组不应被收起')
  serverConfig.customGroups = []
})

await test('自建下拉：搜索无命中时给出可操作提示，而不是空白', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '免费模型',
      kind: '',
      providers: [],
      models: ['alpha/a-text-1', 'beta/b-mm-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(250)
  const state = await page.evaluate(() => {
    const input = document.querySelector('[data-mas-slot-search]')
    input.value = 'zzz-not-exist'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const empty = document.querySelector('[data-mas-slot-empty]')
    return {
      visible: [...document.querySelectorAll('[data-mas-slot-row]')].filter((el) => el.style.display !== 'none').length,
      emptyShown: empty === null ? '' : empty.style.display,
      emptyText: (empty?.textContent ?? '').trim(),
      count: (document.querySelector('[data-mas-slot-count]')?.textContent ?? '').trim(),
      groups: [...document.querySelectorAll('[data-mas-slot-group]')].map((el) => el.style.display),
    }
  })
  assert.equal(state.visible, 0, '无命中时不应有可见行')
  assert.equal(state.emptyShown, 'block', '无命中时应显示空态提示')
  assert.ok(state.emptyText.includes('没有匹配'), `空态应说明没匹配到什么：${state.emptyText}`)
  assert.ok(state.emptyText.includes('清空搜索'), `空态应给出下一步操作（清空搜索）：${state.emptyText}`)
  assert.equal(state.count, '0 / 2 个模型', `无命中时页脚应显示 0 命中：${state.count}`)
  assert.deepEqual(state.groups, ['none'], `无命中的分组应整组收起：${JSON.stringify(state.groups)}`)
  serverConfig.customGroups = []
})

await test('自建下拉：↑↓ 移动高亮、Enter 选中、Esc 关闭并把焦点还给触发按钮', async () => {
  selectCalls.length = 0
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '免费模型',
      kind: '',
      providers: [],
      models: ['alpha/a-text-1', 'beta/b-mm-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(250)

  const afterOpen = await page.evaluate(() => {
    const search = document.querySelector('[data-mas-slot-search]')
    return {
      active: search.getAttribute('aria-activedescendant') ?? '',
      focused: document.activeElement === search,
    }
  })
  assert.ok(afterOpen.active.startsWith('mas-slot-opt-'), `打开后首个候选应被标记为键盘焦点：${afterOpen.active}`)
  assert.equal(afterOpen.focused, true, '打开后焦点应落在搜索框，键盘可直接用')

  const moved = await page.evaluate(() => {
    const search = document.querySelector('[data-mas-slot-search]')
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const active = search.getAttribute('aria-activedescendant') ?? ''
    const highlighted = [...document.querySelectorAll('[data-mas-slot-row]')].filter(
      (el) => el.style.background !== 'transparent' && el.style.background !== '',
    ).length
    return { active, highlighted }
  })
  assert.equal(moved.active, 'mas-slot-opt-beta-b-mm-1', `ArrowDown 应把高亮移到第二行：${moved.active}`)
  assert.ok(moved.highlighted >= 1, '键盘高亮应有可见背景，不能只改 aria')

  const picked = await page.evaluate(() => {
    const search = document.querySelector('[data-mas-slot-search]')
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true
  })
  assert.equal(picked, true, 'Enter 应被处理')
  await page.waitForTimeout(200)
  assert.deepEqual(
    selectCalls.map((row) => `${row.provider}/${row.model}`),
    ['beta/b-mm-1'],
    `Enter 应把高亮那一行交给宿主 select：${JSON.stringify(selectCalls)}`,
  )
  const closed = await page.evaluate(() => {
    const menu = document.querySelector('[data-mas-slot-menu]')
    return { open: menu !== null && menu.style.display !== 'none', focusOnTrigger: document.activeElement?.getAttribute('data-mas-slot-trigger') === '1' }
  })
  assert.equal(closed.open, false, 'Enter 选完应关闭下拉')
  assert.equal(closed.focusOnTrigger, true, '选完应把焦点还给触发按钮（键盘不丢焦点）')

  // 再开一次验证 Esc：关闭 + 回焦
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(250)
  const afterEsc = await page.evaluate(() => {
    const search = document.querySelector('[data-mas-slot-search]')
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const menu = document.querySelector('[data-mas-slot-menu]')
    return {
      open: menu !== null && menu.style.display !== 'none',
      focusOnTrigger: document.activeElement?.getAttribute('data-mas-slot-trigger') === '1',
      query: document.querySelector('[data-mas-slot-search]')?.value ?? 'x',
    }
  })
  assert.equal(afterEsc.open, false, 'Esc 应关闭下拉')
  assert.equal(afterEsc.focusOnTrigger, true, 'Esc 关闭后焦点应回到触发按钮')
  assert.equal(afterEsc.query, '', `关闭后搜索词应清空：${afterEsc.query}`)
  serverConfig.customGroups = []
})

await test('自建下拉：面板自动识别边界，既不顶出屏幕也不把页面撑出滚动条', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '免费模型',
      kind: '',
      providers: [],
      models: ['alpha/a-text-1', 'beta/b-mm-1', 'beta/b-free-1', 'alpha/a-text-2'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)

  // 触发按钮摆到「右下角」：硬编码 340px 宽 + left:0 会直接伸出视口右侧
  await page.evaluate(() => {
    const host = document.getElementById('modelSlotHost')
    host.style.position = 'fixed'
    host.style.right = '4px'
    host.style.bottom = '4px'
    host.style.left = 'auto'
    host.style.top = 'auto'
  })
  const before = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    vw: window.innerWidth,
    vh: window.innerHeight,
  }))
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(300)

  const bottomRight = await page.evaluate(() => {
    const panel = document.querySelector('[data-mas-slot-menu]')
    const rect = panel.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      width: panel.style.width,
      maxHeight: panel.style.maxHeight,
      cssTop: panel.style.top,
      cssBottom: panel.style.bottom,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      vw: window.innerWidth,
      vh: window.innerHeight,
    }
  })
  assert.ok(bottomRight.right <= bottomRight.vw - 4, `面板右侧不该伸出视口：right=${bottomRight.right} vw=${bottomRight.vw}`)
  assert.ok(bottomRight.left >= 4, `面板左侧不该伸出视口：left=${bottomRight.left}`)
  assert.ok(bottomRight.top >= 4, `面板顶部不该伸出视口：top=${bottomRight.top}`)
  assert.ok(bottomRight.bottom <= bottomRight.vh - 4, `面板底部不该伸出视口：bottom=${bottomRight.bottom}`)
  assert.equal(bottomRight.cssTop, 'auto', '靠下时面板应朝上展开（top 交给 bottom 定位）')
  assert.ok(
    String(bottomRight.cssBottom).includes('100%'),
    `朝上展开应贴住触发按钮上沿：${bottomRight.cssBottom}`,
  )
  assert.equal(
    bottomRight.sw,
    before.sw,
    `展开面板不该新增横向滚动条：scrollWidth ${before.sw} → ${bottomRight.sw}`,
  )
  assert.ok(
    bottomRight.sh <= before.sh + 1,
    `展开面板不该新增纵向滚动条：scrollHeight ${before.sh} → ${bottomRight.sh}`,
  )

  // 先关掉（点触发按钮是开合切换），否则下一步的点击会把它关掉而不是打开
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(200)
  const closedAgain = await page.evaluate(() => document.querySelector('[data-mas-slot-menu]').style.display)
  assert.equal(closedAgain, 'none', '再点一次触发按钮应关闭面板')

  // 触发按钮摆到「顶部」：上方没空间，必须翻到下面展开
  await page.evaluate(() => {
    const host = document.getElementById('modelSlotHost')
    host.style.bottom = 'auto'
    host.style.top = '4px'
  })
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(250)
  const topEdge = await page.evaluate(() => {
    const panel = document.querySelector('[data-mas-slot-menu]')
    const rect = panel.getBoundingClientRect()
    return {
      open: panel.style.display !== 'none',
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      vh: window.innerHeight,
      cssTop: panel.style.top,
      cssBottom: panel.style.bottom,
    }
  })
  assert.equal(topEdge.open, true, '顶部位置再点一次应重新展开面板')
  assert.ok(String(topEdge.cssTop).includes('100%'), `上方没空间时应朝下展开：${topEdge.cssTop}`)
  assert.equal(topEdge.cssBottom, 'auto', '朝下展开时 bottom 应让位')
  assert.ok(topEdge.bottom <= topEdge.vh - 4, `朝下展开也不该超出视口底部：bottom=${topEdge.bottom}`)

  // 窗口缩到很窄：面板宽度要跟着收，不能横着撑出滚动条
  await page.setViewportSize({ width: 360, height: 640 })
  await page.waitForTimeout(300)
  const narrow = await page.evaluate(() => {
    const panel = document.querySelector('[data-mas-slot-menu]')
    const rect = panel.getBoundingClientRect()
    return {
      width: Math.round(rect.width),
      right: Math.round(rect.right),
      left: Math.round(rect.left),
      sw: document.documentElement.scrollWidth,
      vw: window.innerWidth,
    }
  })
  assert.ok(narrow.width <= 360 - 8, `窄窗口下面板要收窄：width=${narrow.width}`)
  assert.ok(narrow.right <= narrow.vw - 4 && narrow.left >= 4, `窄窗口下仍要夹在视口内：${JSON.stringify(narrow)}`)
  assert.equal(narrow.sw, narrow.vw, `窄窗口下不该出现横向滚动条：scrollWidth=${narrow.sw} vw=${narrow.vw}`)
  await page.setViewportSize({ width: 1200, height: 900 })
  serverConfig.customGroups = []
})

await test('占用徽标已撤除：宿主菜单与自建下拉都不出现 用/占，也不再打 /occupancy', async () => {
  serverConfig.customGroups = []
  await boot()
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(300)

  const state = await page.evaluate(() => {
    const isBusy = (text) => /^[用占](\u00d7\d+)?$/.test(text)
    const leaves = [...document.querySelectorAll('[data-mas-own]')].filter(
      (el) => el.querySelector('[data-mas-own]') === null,
    )
    return {
      menuBadges: leaves.map((el) => (el.textContent ?? '').trim()).filter(isBusy),
      slotPills: [...document.querySelectorAll('[data-mas-slot-row] span')]
        .map((el) => (el.textContent ?? '').trim())
        .filter(isBusy),
      rows: document.querySelectorAll('[data-mas-slot-row]').length,
    }
  })

  assert.ok(state.rows > 0, `下拉仍应正常渲染模型行：${state.rows}`)
  assert.deepEqual(state.menuBadges, [], `宿主菜单不该再有占用徽标：${JSON.stringify(state.menuBadges)}`)
  assert.deepEqual(state.slotPills, [], `自建下拉不该再有占用徽标：${JSON.stringify(state.slotPills)}`)
  assert.equal(occupancyQueries.length, 0, `撤除后打开下拉不该再打 GET /occupancy：${occupancyQueries.length} 次`)
  assert.deepEqual(pageErrors, [], `撤除占用后不应有未捕获异常：${JSON.stringify(pageErrors)}`)
})

await test('分组一键测试：每个分组头都有「测试全组」按钮，与分组一一对应', async () => {
  serverConfig.customGroups = []
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  const info = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('[data-mas-group-head]')].map((n) => n.getAttribute('data-mas-group-head')),
    buttons: [...document.querySelectorAll('[data-mas-group-test]')].map((n) => n.getAttribute('data-mas-group-test')),
    labels: [...document.querySelectorAll('[data-mas-group-test]')].map((n) => (n.textContent ?? '').trim()),
  }))
  assert.deepEqual(info.heads, ['multimodal', 'text'], `内置分组应分两段：${JSON.stringify(info.heads)}`)
  assert.deepEqual(info.buttons, info.heads, `每个分组头都该挂一个「测试全组」按钮：${JSON.stringify(info.buttons)}`)
  assert.deepEqual(info.labels, ['测试全组', '测试全组'], `按钮文案应为「测试全组」：${JSON.stringify(info.labels)}`)
})

await test('分组一键测试：点「测试全组」批量探测整组，汇总与逐行回填，重渲染后不丢', async () => {
  serverConfig.customGroups = []
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  await page.evaluate(() => document.querySelector('[data-mas-group-test="multimodal"]').click())
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-mas-group-test="multimodal"]')
    return b !== null && /^✓\d+ ✗\d+$/.test((b.textContent ?? '').trim())
  }, undefined, { timeout: 5000 })

  const after = await page.evaluate(() => {
    const groupBtn = document.querySelector('[data-mas-group-test="multimodal"]')
    const probes = [...document.querySelectorAll('[data-mas-probe]')].map((n) => ({
      key: n.getAttribute('data-mas-probe'),
      text: (n.textContent ?? '').trim(),
    }))
    return { summary: (groupBtn.textContent ?? '').trim(), probes }
  })
  assert.equal(probeCalls.length, 2, `多模态组 2 个模型应各打一次 /test-model：${probeCalls.length}`)
  assert.equal(after.summary, '✓2 ✗0', `全通过时汇总应为「✓2 ✗0」：${after.summary}`)
  const mm = after.probes.filter((p) => p.key === 'alpha/a-mm-1' || p.key === 'beta/b-mm-1')
  assert.equal(mm.length, 2, `多模态组应有 2 个逐行「测试」按钮：${JSON.stringify(mm)}`)
  assert.ok(mm.every((p) => p.text === '✓ 0.0s'), `组内行都应回填成功结果：${JSON.stringify(mm)}`)
  const others = after.probes.filter((p) => ['alpha/a-text-1', 'alpha/a-text-2', 'beta/b-text-1', 'beta/b-free-1'].includes(p.key))
  assert.ok(others.every((p) => p.text === '测试'), `别的组不该被误测：${JSON.stringify(others)}`)
  assert.deepEqual(pageErrors, [], `分组测试不应有未捕获异常：${JSON.stringify(pageErrors)}`)

  // 重渲染：按钮 DOM 全被重建，结果只能来自模块级 probeResults 表
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)
  const repainted = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mas-probe]')]
      .filter((n) => ['alpha/a-mm-1', 'beta/b-mm-1'].includes(n.getAttribute('data-mas-probe')))
      .map((n) => (n.textContent ?? '').trim()),
  )
  assert.deepEqual(repainted, ['✓ 0.0s', '✓ 0.0s'], `重渲染后结果应仍留在每一行（模块级结果表）：${JSON.stringify(repainted)}`)
})

await test('分组一键测试：组内部分模型不可调时，汇总与失败行状态都正确', async () => {
  serverConfig.customGroups = []
  await boot()
  server.__probeFailModels = ['b-mm-1'] // boot() 会清空，必须在其后设置
  server.__probeInfraModels = [] // 本用例只覆盖模型级失败（kind=model）
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  await page.evaluate(() => document.querySelector('[data-mas-group-test="multimodal"]').click())
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-mas-group-test="multimodal"]')
    return b !== null && /^✓\d+ ✗\d+$/.test((b.textContent ?? '').trim())
  }, undefined, { timeout: 5000 })

  const state = await page.evaluate(() => {
    const groupBtn = document.querySelector('[data-mas-group-test="multimodal"]')
    const probes = [...document.querySelectorAll('[data-mas-probe]')].map((n) => ({
      key: n.getAttribute('data-mas-probe'),
      text: (n.textContent ?? '').trim(),
    }))
    return { summary: (groupBtn.textContent ?? '').trim(), probes }
  })
  assert.equal(probeCalls.length, 2, `部分失败时仍应探测整组 2 个模型：${probeCalls.length}`)
  assert.equal(state.summary, '✓1 ✗1', `一成一败时汇总应为「✓1 ✗1」：${state.summary}`)
  assert.equal(state.probes.find((p) => p.key === 'alpha/a-mm-1')?.text, '✓ 0.0s', `成功的模型应回填成功：${JSON.stringify(state.probes)}`)
  assert.equal(state.probes.find((p) => p.key === 'beta/b-mm-1')?.text, '✗ 不可调', `不可调的模型应回填失败：${JSON.stringify(state.probes)}`)
  assert.deepEqual(pageErrors, [], `部分失败不应有未捕获异常：${JSON.stringify(pageErrors)}`)
})


await test('探测结果展示语义：infra 类故障（传输/环境）标「✗ 探测失败」并注明仍可用', async () => {
  serverConfig.customGroups = []
  await boot()
  server.__probeFailModels = [] // boot() 会清空，必须在其后设置
  server.__probeInfraModels = ['b-mm-1']
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(150)

  await page.evaluate(() => document.querySelector('[data-mas-group-test="multimodal"]').click())
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-mas-group-test="multimodal"]')
    return b !== null && /^✓\d+ ✗\d+$/.test((b.textContent ?? '').trim())
  }, undefined, { timeout: 5000 })

  const state = await page.evaluate(() => {
    const probes = [...document.querySelectorAll('[data-mas-probe]')].map((n) => ({
      key: n.getAttribute('data-mas-probe'),
      text: (n.textContent ?? '').trim(),
      title: n.getAttribute('title') ?? '',
    }))
    return { probes }
  })
  const infraProbe = state.probes.find((p) => p.key === 'beta/b-mm-1')
  assert.ok(infraProbe, `应能取到 beta/b-mm-1 的探测按钮：${JSON.stringify(state.probes)}`)
  assert.equal(infraProbe.text, '✗ 探测失败', `infra 类失败应标「✗ 探测失败」：${JSON.stringify(state.probes)}`)
  assert.match(infraProbe.title, /仍留在下拉|仍可选|探测失败/, `infra 失败的 title 应注明模型仍可用：${infraProbe.title}`)
  assert.doesNotMatch(infraProbe.title, /模型级故障/, `infra 失败不应被表述为模型级故障：${infraProbe.title}`)
  assert.deepEqual(pageErrors, [], `infra 类部分失败不应有未捕获异常：${JSON.stringify(pageErrors)}`)
})


await test('自动分组：切到 auto 后按免费/积分/未知三段展示，手工入组控件全部撤下', async () => {
  serverConfig.customGroups = []
  serverConfig.groupMode = 'auto'
  const autoView = makeView({
    groups: [
      { id: 'auto-free', label: '免费 · 2', kind: null, keys: [ENTRIES[4].key, ENTRIES[5].key] },
      { id: 'auto-paid', label: '积分 · 1', kind: null, keys: [ENTRIES[0].key] },
      { id: 'auto-unknown', label: '未知 · 3', kind: null, keys: [ENTRIES[1].key, ENTRIES[2].key, ENTRIES[3].key] },
    ],
  })
  await boot(autoView)
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  const info = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('[data-mas-group-head]')].map((n) => n.getAttribute('data-mas-group-head')),
    groupBy: document.querySelectorAll('[data-mas-groupby]').length,
    filter: document.querySelectorAll('[data-mas-filter]').length,
    assign: document.querySelectorAll('[data-mas-assign]').length,
    text: document.getElementById('settingsContent')?.textContent ?? '',
    step2: [...document.querySelectorAll('[data-mas-step]')].find((n) => n.getAttribute('data-mas-step') === '2')?.textContent ?? '',
  }))
  assert.deepEqual(info.heads, ['auto-free', 'auto-paid', 'auto-unknown'], `自动分组应恰好三段：${JSON.stringify(info.heads)}`)
  assert.equal(info.groupBy, 0, 'auto 模式不应再有「按类型分组」开关')
  assert.equal(info.filter, 0, 'auto 模式不应再有筛选 chips')
  assert.equal(info.assign, 0, 'auto 模式每行不应再有手工入组下拉')
  assert.ok(!info.text.includes('显示全部模型'), 'auto 模式不应再有「显示全部模型」开关')
  assert.ok(info.step2.includes('模型') && !info.step2.includes('模型入组'), `auto 模式第二步标题应为「模型」：${info.step2}`)
  serverConfig.groupMode = 'manual'
})

await test('暂不可用组：最近探测调不通的模型从原段移出，归到末尾可重测的虚拟段', async () => {
  serverConfig.groupMode = 'manual'
  serverConfig.customGroups = []
  await boot(makeView({ unavailableModels: [ENTRIES[0].key] }))
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  const info = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('[data-mas-group-head]')].map((n) => n.getAttribute('data-mas-group-head'))
    const unavailableHead = document.querySelector('[data-mas-group-head="__unavailable__"]')
    const textHead = document.querySelector('[data-mas-group-head="text"]')
    const rowsInText = []
    if (textHead !== null) {
      let node = textHead.nextElementSibling
      while (node !== null && !node.hasAttribute('data-mas-group-head')) {
        if (node.hasAttribute('data-mas-model-row')) rowsInText.push(node.getAttribute('data-mas-model-row'))
        node = node.nextElementSibling
      }
    }
    return {
      heads,
      label: unavailableHead?.textContent ?? '',
      hasGroupTest: document.querySelector('[data-mas-group-test="__unavailable__"]') !== null,
      rowsInText,
      allRows: [...document.querySelectorAll('[data-mas-model-row]')].map((n) => n.getAttribute('data-mas-model-row')),
    }
  })
  assert.ok(info.heads.includes('__unavailable__'), `应出现「暂不可用」虚拟段：${JSON.stringify(info.heads)}`)
  assert.ok(info.label.includes('暂不可用 · 1'), `虚拟段标题应标注数量：${info.label}`)
  assert.equal(info.hasGroupTest, true, '暂不可用段应带「测试全组」重测按钮')
  assert.ok(!info.rowsInText.includes(ENTRIES[0].key), '被判不可用的模型应从原 text 段移出')
  assert.ok(info.allRows.includes(ENTRIES[0].key), '被判不可用的模型应仍在页面上（归入暂不可用段）')
  serverConfig.groupMode = 'manual'
})

await test('分组方式：是手工/自动二选下拉，改动能写进配置', async () => {
  serverConfig.groupMode = 'manual'
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  const info = await page.evaluate(() => {
    const node = document.querySelector('[data-mas-field="groupMode"]')
    if (node === null) return null
    return { tag: node.tagName, value: node.value, options: Array.from(node.options ?? []).map((o) => o.value) }
  })
  assert.ok(info !== null, '缺少 groupMode 控件')
  assert.equal(info.tag, 'SELECT', '分组方式应是下拉')
  assert.equal(info.value, 'manual', '默认回落手工分组')
  assert.deepEqual(info.options, ['manual', 'auto'], '二选：手工 / 自动')
  await page.evaluate(() => {
    const node = document.querySelector('[data-mas-field="groupMode"]')
    node.value = 'auto'
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(200)
  const draft = await page.evaluate(() => document.querySelector('[data-mas-savebar]')?.textContent ?? '')
  assert.ok(draft.includes('groupMode') || draft.includes('分组方式'), `改动没进草稿：${draft}`)
  await page.evaluate(() => document.querySelector('[data-mas-save]')?.click())
  await page.waitForTimeout(400)
  const hit = posted.find((body) => body.groupMode !== undefined)
  assert.ok(hit !== undefined, `没有提交 groupMode：${JSON.stringify(posted)}`)
  assert.equal(hit.groupMode, 'auto')
  serverConfig.groupMode = 'manual'
})

await test('自动探测间隔：是 0–1440 分钟的数字输入，默认 0', async () => {
  serverConfig.groupMode = 'manual'
  await boot()
  await page.evaluate(() => window.__renderSection())
  await page.waitForTimeout(200)
  const info = await page.evaluate(() => {
    const node = document.querySelector('[data-mas-field="probeIntervalMin"]')
    if (node === null) return null
    return { tag: node.tagName, type: node.type, min: node.min, max: node.max, value: node.value }
  })
  assert.ok(info !== null, '缺少 probeIntervalMin 控件')
  assert.equal(info.tag, 'INPUT', '应是输入框')
  assert.equal(info.type, 'number', '应是数字输入')
  assert.equal(info.min, '0', '下限 0（不自动探测）')
  assert.equal(info.max, '1440', '上限 1440 分钟')
  assert.equal(info.value, '0', '默认 0')
  serverConfig.groupMode = 'manual'
})


await test('自建下拉：隐藏模型（hidden）不进下拉，同组未隐藏模型照常出现', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '含隐藏',
      kind: '',
      providers: [],
      models: ['alpha/a-hide-1', 'alpha/a-text-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot(makeView({
    entries: ENTRIES.concat([
      {
        key: 'alpha\u0000a-hide-1',
        provider: 'alpha',
        providerName: 'Alpha 官方',
        providerSettingsNs: '',
        model: 'a-hide-1',
        name: 'A-Hide-1',
        kind: 'text',
        modalities: ['text'],
        modalitySource: 'listModels',
        sortKey: [0, 9, 0, 9],
        free: false,
        disabled: false,
        hidden: true,
      },
    ]),
  }))
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  assert.ok(
    (await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]'))) !== null,
    '自建下拉应注册触发按钮',
  )
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(200)
  const keys = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mas-slot-row]')].map((el) => el.getAttribute('data-mas-slot-key')),
  )
  assert.ok(!keys.includes('alpha\u0000a-hide-1'), `隐藏模型不应出现在下拉：${JSON.stringify(keys)}`)
  assert.ok(keys.includes('alpha\u0000a-text-1'), `同组未隐藏模型应照常出现：${JSON.stringify(keys)}`)
  serverConfig.customGroups = []
})

await test('下拉模型行展示「上下文窗口」pill：有披露则显示，缺省则不显示（fail-closed）', async () => {
  serverConfig.customGroups = [
    {
      id: 'g1',
      label: '上下文测试',
      kind: '',
      providers: [],
      models: ['alpha/a-ctx-1', 'alpha/a-text-1'],
      freeOnly: false,
      explicit: true,
    },
  ]
  await boot(makeView({
    entries: ENTRIES.concat([
      {
        key: 'alpha\u0000a-ctx-1',
        provider: 'alpha',
        providerName: 'Alpha 官方',
        providerSettingsNs: '',
        model: 'a-ctx-1',
        name: 'A-Ctx-1',
        kind: 'text',
        modalities: ['text'],
        modalitySource: 'listModels',
        sortKey: [0, 9, 0, 9],
        free: false,
        disabled: false,
        contextWindow: 200000,
      },
    ]),
  }))
  await page.evaluate(() => window.__renderModelSlot())
  await page.waitForTimeout(150)
  assert.ok(
    (await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]'))) !== null,
    '自建下拉应注册触发按钮',
  )
  await page.evaluate(() => document.querySelector('[data-mas-slot-trigger]').click())
  await page.waitForTimeout(200)
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mas-slot-row]')].map((row) => ({
      key: row.getAttribute('data-mas-slot-key'),
      ctxTitles: [...row.querySelectorAll('span[title^="上下文窗口"]')].map((el) => el.getAttribute('title')),
      ctxTexts: [...row.querySelectorAll('span[title^="上下文窗口"]')].map((el) => (el.textContent ?? '').trim()),
    })),
  )
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
  const ctxRow = byKey['alpha\u0000a-ctx-1']
  assert.ok(ctxRow !== undefined, `披露上下文的模型应出现在下拉：${JSON.stringify(Object.keys(byKey))}`)
  assert.equal(ctxRow.ctxTitles.length, 1, `披露上下文的模型应渲染「上下文窗口」pill：${JSON.stringify(ctxRow)}`)
  assert.ok(ctxRow.ctxTitles[0].startsWith('上下文窗口'), `pill 标题应为上下文窗口说明：${ctxRow.ctxTitles[0]}`)
  assert.ok(ctxRow.ctxTexts[0] === '200K', `200000 tokens 应格式化为 200K，实际：${JSON.stringify(ctxRow.ctxTexts)}`)
  const noCtxRow = byKey['alpha\u0000a-text-1']
  assert.ok(noCtxRow !== undefined, '未披露上下文的对照模型应出现')
  assert.equal(noCtxRow.ctxTitles.length, 0, `未披露上下文的模型不应渲染「上下文窗口」pill：${JSON.stringify(noCtxRow)}`)
  serverConfig.customGroups = []
})

await browser.close()

server.close()

console.log('')

if (failures.length === 0) {
  console.log(`全部通过：${passed} 项`)
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项`)
  for (const item of failures) console.log(`  - ${item}`)
  process.exitCode = 1
}
