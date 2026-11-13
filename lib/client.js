window.__ModuleLoader__.load({ id: "@zjjlivingfree/dsh-model-picker", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  snapshot: () => snapshot
});
module.exports = __toCommonJS(index_exports);
var inject = ["slots", "modelDirectories", "sessions", "remote"];
var BUILD = "mas-v11";
var ROUTE = "dsh-model-auto-select";
var BADGE_ATTR = "data-mas-badge";
var OWN_ATTR = "data-mas-own";
var SETTINGS_BTN_ATTR = "data-mas-settings-toggle";
var SETTINGS_ROW_ATTR = "data-mas-settings-row";
var SETTINGS_LAUNCHER_LABELS = ["\u8BBE\u7F6E", "Settings"];
var ACCOUNT_MENU_LABELS = ["\u8D26\u53F7\u83DC\u5355", "Account menu"];
var SETTINGS_MENU_LABELS = ["\u8BBE\u7F6E", "Settings"];
var SETTINGS_PANEL_SEL = 'div[data-shortcut-modal="settings"]';
var SETTINGS_BTN_LABEL = "\u6253\u5F00\u8BBE\u7F6E\u9875\u9762\uFF08\u6A21\u578B\u81EA\u52A8\u9009\u62E9\uFF09";
var COOLDOWN_ATTR = "data-mas-cooldown";
var UNASSIGNED_ROW_ATTR = "data-mas-unassigned-row";
var HIDDEN_ROW_ATTR = "data-mas-hidden-row";
var POLL_MS = 15e3;
var HOST_FREE_HINT = /免费|限免|免单|夜间折|折扣|订阅优先/;
var view = null;
var viewError = null;
var inflight = null;
var observer = null;
var pollTimer = null;
var rafPending = false;
var started = false;
var listeners = /* @__PURE__ */ new Set();
var directoryWatchers = /* @__PURE__ */ new Set();
var probeResults = /* @__PURE__ */ new Map();
function probeKey(provider, model) {
  return `${provider}/${model}`;
}
function applyProbeResult(button, result) {
  if (result.ok) {
    button.textContent = `\u2713 ${(result.ms / 1e3).toFixed(1)}s`;
    button.title = `\u8FDE\u901A\u6027\u6D4B\u8BD5\u901A\u8FC7\uFF08${result.ms}ms\uFF09${result.sample ? `
\u54CD\u5E94\u7247\u6BB5\uFF1A${result.sample}` : ""}`;
    button.style.color = "#4a9d5b";
  } else {
    const isModelLevel = result.kind === "model";
    if (isModelLevel) {
      button.textContent = "\u2717 \u4E0D\u53EF\u8C03";
      button.title = `\u8FDE\u901A\u6027\u6D4B\u8BD5\u5931\u8D25\uFF1A${result.error ?? "\u672A\u77E5\u9519\u8BEF"}\uFF08\u6A21\u578B\u7EA7\u6545\u969C\uFF0C\u5DF2\u4ECE\u4E0B\u62C9\u79FB\u9664\uFF09`;
      button.style.color = "#d9534f";
    } else {
      button.textContent = "\u2717 \u63A2\u6D4B\u5931\u8D25";
      button.title = `\u63A2\u6D4B\u5931\u8D25\uFF08\u4F20\u8F93/\u73AF\u5883\u6545\u969C\uFF0C\u6A21\u578B\u4ECD\u7559\u5728\u4E0B\u62C9\u53EF\u6B63\u5E38\u9009\u62E9\uFF09\uFF1A${result.error ?? "\u672A\u77E5\u9519\u8BEF"}`;
      button.style.color = "#c9a227";
    }
  }
}
function repaintProbeButtons() {
  for (const node of Array.from(document.querySelectorAll("[data-mas-probe]"))) {
    const result = probeResults.get(node.getAttribute("data-mas-probe") ?? "");
    if (result !== void 0) applyProbeResult(node, result);
  }
}
function notify() {
  for (const fn of directoryWatchers) {
    try {
      fn();
    } catch {
    }
  }
  for (const fn of listeners) {
    try {
      fn();
    } catch {
    }
  }
}
function directoryBase(value) {
  const url = new URL(value, window.location.href);
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname.replace(/[^/]*$/, "")}`;
  return url.href;
}
function routeUrl(path) {
  const base = directoryBase(document.baseURI || window.location.href);
  return new URL(path.replace(/^\/+/, ""), base).href;
}
function apiUrl(suffix) {
  return routeUrl(`${ROUTE}/${suffix.replace(/^\/+/, "")}`);
}
var catalogSeq = 0;
async function loadCatalog(options = {}) {
  const force = options.force === true;
  if (!force && inflight !== null) return inflight;
  const seq = catalogSeq += 1;
  const task = (async () => {
    try {
      const url = apiUrl(force ? "catalog?refresh=1" : "catalog");
      const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      if (seq !== catalogSeq) return;
      view = next;
      viewError = null;
      if (slotOpen) reapplySlotPanel();
      if (force) {
        const entryCount = next.entries?.length ?? 0;
        const groupCount = next.groups?.length ?? 0;
        statusKind = "ok";
        statusText = entryCount === 0 ? "\u5DF2\u5237\u65B0\u6A21\u578B\u5217\u8868\uFF1A\u6CA1\u53D6\u5230\u4EFB\u4F55\u6A21\u578B\uFF0C\u8BF7\u5148\u5728 dsh \u8BBE\u7F6E\u9875\u914D\u7F6E provider \u4E0E API Key" : `\u5DF2\u5237\u65B0\u6A21\u578B\u5217\u8868\uFF1A${entryCount} \u4E2A\u6A21\u578B \xB7 ${groupCount} \u4E2A\u5206\u7EC4`;
      }
    } catch (err) {
      if (seq !== catalogSeq) return;
      const message = String(err?.message ?? err);
      viewError = message;
      if (force) {
        statusKind = "error";
        statusText = `\u6A21\u578B\u5217\u8868\u5237\u65B0\u5931\u8D25\uFF1A${explainSaveError(message)}`;
      }
    } finally {
      if (seq === catalogSeq) {
        inflight = null;
        scheduleDecorate();
        notify();
      }
    }
  })();
  if (!force) inflight = task;
  return task;
}
function beacon(payload) {
  try {
    void fetch(apiUrl("beacon"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ build: BUILD, ...payload }),
      keepalive: true
    }).catch(() => {
    });
  } catch {
  }
}
var KIND_TEXT = { text: "\u6587\u672C", multimodal: "\u591A\u6A21\u6001" };
var KIND_GLYPH = { text: "\u6587", multimodal: "\u56FE" };
function entryOf(provider, model) {
  if (view === null) return void 0;
  const key = `${provider}\0${model}`;
  return view.entries.find((entry) => entry.key === key);
}
function stylePill(el2, tone) {
  el2.style.display = "inline-flex";
  el2.style.alignItems = "center";
  el2.style.gap = "2px";
  el2.style.marginLeft = "6px";
  el2.style.padding = "0 6px";
  el2.style.height = "18px";
  el2.style.borderRadius = "9px";
  el2.style.fontSize = "11px";
  el2.style.lineHeight = "18px";
  el2.style.fontWeight = "500";
  el2.style.whiteSpace = "nowrap";
  el2.style.border = "1px solid transparent";
  if (tone === "idle") {
    el2.style.color = "var(--dsh-color-text-secondary, #8a8f98)";
    el2.style.background = "var(--dsh-color-fill-quaternary, rgba(127,127,127,0.10))";
    el2.style.borderColor = "var(--dsh-color-border-secondary, rgba(127,127,127,0.22))";
  } else if (tone === "busy") {
    el2.style.color = "var(--dsh-color-warning-text, #a86800)";
    el2.style.background = "var(--dsh-color-warning-bg, rgba(255,184,0,0.14))";
    el2.style.borderColor = "var(--dsh-color-warning-border, rgba(255,184,0,0.36))";
  } else if (tone === "running") {
    el2.style.color = "var(--dsh-color-success-text, #16794c)";
    el2.style.background = "var(--dsh-color-success-bg, rgba(0,180,120,0.14))";
    el2.style.borderColor = "var(--dsh-color-success-border, rgba(0,180,120,0.36))";
  } else {
    el2.style.color = "var(--dsh-color-text-tertiary, #9aa0a6)";
    el2.style.background = "transparent";
    el2.style.borderColor = "var(--dsh-color-border-secondary, rgba(127,127,127,0.22))";
  }
}
function makePill(text, title, tone) {
  const el2 = document.createElement("span");
  el2.setAttribute(OWN_ATTR, "1");
  el2.setAttribute(BADGE_ATTR, text);
  el2.textContent = text;
  el2.title = title;
  stylePill(el2, tone);
  return el2;
}
function hostSaysFree(span) {
  const row = span.closest('button, li, [role="menuitemradio"]') ?? span.parentElement;
  if (row === null) return false;
  for (const node of Array.from(row.querySelectorAll("*"))) {
    const el2 = node;
    if (el2.hasAttribute(OWN_ATTR)) continue;
    const text = (el2.textContent ?? "").trim();
    if (text.length > 0 && text.length <= 12 && HOST_FREE_HINT.test(text)) return true;
  }
  return false;
}
function savedRules() {
  const raw = config?.config?.["customGroups"];
  return Array.isArray(raw) ? raw : [];
}
function savedGroupLabel(entry) {
  const rules = savedRules();
  if (rules.length === 0) return "";
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) {
        return rule.label || rule.id;
      }
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.label || rule.id;
    }
  }
  return "\u672A\u5165\u7EC4";
}
function decorateRow(span) {
  const provider = span.getAttribute("data-provider-id") ?? "";
  const model = span.getAttribute("data-model-id") ?? "";
  if (provider === "" || model === "") return false;
  const entry = entryOf(provider, model);
  if (entry === void 0) return false;
  const row = span.closest('button[role="menuitemradio"]');
  const groupLabel = row === null ? "" : savedGroupLabel(entry);
  const unassigned = groupLabel === "\u672A\u5165\u7EC4";
  if (row !== null) {
    if (entry.hidden === true || unassigned) {
      row.setAttribute(HIDDEN_ROW_ATTR, "1");
      row.style.display = "none";
    } else if (row.hasAttribute(HIDDEN_ROW_ATTR)) {
      row.removeAttribute(HIDDEN_ROW_ATTR);
      row.style.display = "";
    }
  }
  const free = entry.free && !hostSaysFree(span) ? view?.config?.freeBadgeLabel ?? "\u514D" : "";
  const signature = [free, groupLabel].join("|");
  const existing = span.querySelector(`:scope > [${OWN_ATTR}]`);
  if (existing !== null && existing.getAttribute(BADGE_ATTR) === signature) return false;
  if (existing !== null) existing.remove();
  if (signature === "|") return existing !== null;
  const wrap = document.createElement("span");
  wrap.setAttribute(OWN_ATTR, "1");
  wrap.setAttribute(BADGE_ATTR, signature);
  wrap.style.display = "inline-flex";
  wrap.style.alignItems = "center";
  if (free !== "") {
    wrap.appendChild(
      makePill(free, `\u8BA1\u4EF7\u7CFB\u6570 x${(entry.priceFactor ?? 0).toFixed(2)}\uFF080 = \u9650\u65F6\u514D\u8D39\uFF09\uFF1B\u6765\u6E90\uFF1A\u6A21\u578B\u540D\u540E\u7F00\uFF0C\u975E llm \u670D\u52A1\u5B57\u6BB5`, "running")
    );
  }
  if (groupLabel !== "") {
    wrap.appendChild(
      makePill(
        groupLabel,
        unassigned ? `\u672A\u52A0\u5165\u4EFB\u4F55\u5206\u7EC4\uFF1A\u63D2\u4EF6\u4E0D\u4F1A\u81EA\u52A8\u9009\u4E2D\u5B83\uFF0C\u4E5F\u4E0D\u4F1A\u5728\u81EA\u52A8\u5207\u6362\u65F6\u6311\u5B83\uFF08\u5206\u7EC4\u53EF\u5728\u300C\u6A21\u578B\u81EA\u52A8\u9009\u62E9\u300D\u8BBE\u7F6E\u9875\u91CC\u914D\u7F6E\uFF09` : `\u5DF2\u4FDD\u5B58\u7684\u5206\u7EC4\uFF1A${groupLabel}`,
        unassigned ? "busy" : "meta"
      )
    );
  }
  span.appendChild(wrap);
  if (row !== null) {
    if (unassigned) {
      row.setAttribute(UNASSIGNED_ROW_ATTR, "1");
      row.style.opacity = "0.55";
    } else if (row.hasAttribute(UNASSIGNED_ROW_ATTR)) {
      row.removeAttribute(UNASSIGNED_ROW_ATTR);
      row.style.opacity = "";
    }
  }
  return true;
}
var config = null;
var configInflight = null;
var statusText = "";
var statusKind = "idle";
function loadConfig() {
  if (configInflight !== null) return configInflight;
  configInflight = (async () => {
    try {
      const res = await fetch(apiUrl("config"), { headers: { accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      config = await res.json();
    } catch (err) {
      statusKind = "error";
      statusText = `\u914D\u7F6E\u8BFB\u53D6\u5931\u8D25\uFF1A${explainSaveError(String(err?.message ?? err))}`;
    } finally {
      configInflight = null;
      scheduleDecorate();
      notify();
    }
  })();
  return configInflight;
}
function explainSaveError(raw) {
  if (/no longer active/i.test(raw)) return "\u63D2\u4EF6\u6B63\u5728\u91CD\u542F\uFF08\u914D\u7F6E\u521A\u88AB\u5199\u5165\u4F1A\u89E6\u53D1\u91CD\u8F7D\uFF09\uFF0C\u8BF7 2 \u79D2\u540E\u91CD\u8BD5\uFF1B\u672C\u6B21\u6539\u52A8\u672A\u4FDD\u5B58";
  if (/no longer available/i.test(raw)) return "\u914D\u7F6E\u6761\u76EE\u5DF2\u5931\u6548\uFF08\u63D2\u4EF6\u53EF\u80FD\u88AB\u5378\u8F7D\u6216\u91CD\u8F7D\uFF09\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5";
  if (/changed during reload/i.test(raw)) return "\u914D\u7F6E\u5728\u91CD\u8F7D\u8FC7\u7A0B\u4E2D\u88AB\u6539\u52A8\uFF0C\u8BF7\u91CD\u8BD5";
  if (/no valid field/i.test(raw)) return "\u6CA1\u6709\u8BC6\u522B\u5230\u53EF\u4FDD\u5B58\u7684\u5B57\u6BB5";
  if (/HTTP 5\d\d/i.test(raw)) return `\u670D\u52A1\u7AEF\u9519\u8BEF\uFF1A${raw}`;
  return raw;
}
async function postConfig(patch) {
  statusText = "\u4FDD\u5B58\u4E2D\u2026";
  statusKind = "pending";
  notify();
  try {
    const res = await fetch(apiUrl("config"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const body = await res.json().catch(() => null);
    if (body?.ok === true) {
      statusKind = "ok";
      statusText = body.persisted === true ? "\u5DF2\u4FDD\u5B58\u5230\u63D2\u4EF6\u914D\u7F6E" : `\u5DF2\u751F\u6548\uFF08${body.error ?? "\u672A\u6301\u4E45\u5316"}\uFF09`;
      await loadConfig();
      await loadCatalog();
    } else {
      statusKind = "error";
      statusText = `\u4FDD\u5B58\u5931\u8D25\uFF1A${explainSaveError(body?.error ?? `HTTP ${res.status}`)}`;
    }
  } catch (err) {
    statusKind = "error";
    statusText = `\u4FDD\u5B58\u5931\u8D25\uFF1A${explainSaveError(String(err?.message ?? err))}`;
  }
  notify();
}
function el(tag, style = {}, text) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== void 0) node.textContent = text;
  node.setAttribute(OWN_ATTR, "1");
  return node;
}
var TOK = {
  primary: "var(--dsw-alias-label-primary, var(--dsh-color-text-primary, #1f2329))",
  secondary: "var(--dsw-alias-label-secondary, var(--dsh-color-text-secondary, #4e5560))",
  tertiary: "var(--dsw-alias-label-tertiary, var(--dsh-color-text-tertiary, #8a8f98))",
  border: "var(--dsw-alias-border-l2, rgba(127,127,127,0.18))",
  module: "var(--dsw-alias-bg-module-platform, rgba(127,127,127,0.08))",
  hover: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.10))",
  layer: "var(--dsw-alias-bg-layer-2, var(--dsh-color-bg-layer-2, #ffffff))",
  radius: "var(--dsw-radius-md, 8px)",
  error: "var(--dsh-color-state-error-primary, #d64545)",
  ok: "var(--dsh-color-state-success-primary, #16794c)",
  warn: "var(--dsh-color-state-warning-primary, #a86800)"
};
var BTN_STYLE = `height:32px;padding:0 14px;border-radius:${TOK.radius};border:1px solid ${TOK.border};background:transparent;color:${TOK.primary};font:inherit;font-size:13px;cursor:pointer;white-space:nowrap`;
function titleText(text) {
  return el("span", { fontSize: "14px", lineHeight: "22px", fontWeight: "400", color: TOK.primary }, text);
}
function descText(text) {
  return el("span", { fontSize: "12px", lineHeight: "18px", color: TOK.tertiary }, text);
}
function settingRow(title, desc, control, extra = []) {
  const row = el("div", {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px 0",
    borderBottom: `0.5px solid ${TOK.border}`
  });
  row.title = desc;
  const text = el("div", { display: "flex", flexDirection: "column", gap: "4px", flex: "1", minWidth: "0" });
  text.appendChild(titleText(title));
  if (desc !== "") text.appendChild(descText(desc));
  row.appendChild(text);
  if (control !== null) row.appendChild(control);
  for (const node of extra) row.appendChild(node);
  return row;
}
function checkControl(label, checked, attrs, onChange) {
  const wrap = el("label", {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "13px",
    color: TOK.secondary,
    cursor: "pointer",
    whiteSpace: "nowrap"
  });
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.style.cssText = "margin:0;width:15px;height:15px;cursor:pointer;flex:0 0 auto";
  box.setAttribute(OWN_ATTR, "1");
  for (const [key, value] of Object.entries(attrs)) box.setAttribute(key, value);
  box.addEventListener("change", () => onChange(box.checked === true));
  wrap.appendChild(box);
  wrap.appendChild(document.createTextNode(label));
  return wrap;
}
function actionButton(text, title, onClick, attrs = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.style.cssText = BTN_STYLE;
  button.setAttribute(OWN_ATTR, "1");
  for (const [key, value] of Object.entries(attrs)) button.setAttribute(key, value);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}
function textInput(value, placeholder, width, attrs = {}) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.style.cssText = `width:${width};height:30px;padding:0 8px;box-sizing:border-box;border-radius:${TOK.radius};border:1px solid ${TOK.border};background:transparent;color:${TOK.primary};font:inherit;font-size:13px`;
  input.setAttribute(OWN_ATTR, "1");
  for (const [key, v] of Object.entries(attrs)) input.setAttribute(key, v);
  return input;
}
function blockTitle(text, desc) {
  const box = el("div", { display: "flex", flexDirection: "column", gap: "4px", padding: "20px 0 6px" });
  box.appendChild(el("span", { fontSize: "14px", lineHeight: "22px", fontWeight: "600", color: TOK.primary }, text));
  if (desc !== "") box.appendChild(descText(desc));
  return box;
}
function groupCardBox() {
  return el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px 14px",
    marginBottom: "10px",
    borderRadius: TOK.radius,
    background: TOK.module
  });
}
var draft = null;
function draftKeys() {
  return draft === null ? [] : Object.keys(draft);
}
function draftOf(key, fallback) {
  if (draft !== null && Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
  const value = config?.config?.[key];
  if (value === void 0 || value === null) return fallback;
  return value;
}
function groupingAuto() {
  return draftOf("groupMode", "manual") === "auto";
}
function valueKey(value) {
  if (value === void 0) return "\0undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
function stage(key, value, note) {
  const saved = config?.config?.[key];
  const same = valueKey(value) === valueKey(saved);
  const next = { ...draft ?? {} };
  if (same) delete next[key];
  else next[key] = value;
  const keys = Object.keys(next);
  draft = keys.length === 0 ? null : next;
  if (keys.length === 0) {
    statusKind = "idle";
    statusText = "\u6CA1\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8";
  } else {
    statusKind = "pending";
    statusText = same ? `\u5DF2\u6062\u590D\u4E3A\u5DF2\u4FDD\u5B58\u503C\uFF08\u8FD8\u5269 ${keys.length} \u9879\u6539\u52A8\uFF09` : `\u672A\u4FDD\u5B58\uFF1A${note}`;
  }
  notify();
}
function discardDraft() {
  draft = null;
  statusKind = "idle";
  statusText = "\u5DF2\u653E\u5F03\u672A\u4FDD\u5B58\u7684\u6539\u52A8";
  notify();
}
async function saveDraft() {
  if (draft === null) return;
  const patch = draft;
  draft = null;
  await postConfig(patch);
}
function assignToGroup(entry, groupId, note) {
  const full = `${entry.provider}/${entry.model}`;
  const rules = draftOf("customGroups", []);
  const next = rules.map((rule) => {
    const models = rule.models.filter((item) => item !== full);
    if (rule.id !== groupId) return { ...rule, models };
    return { ...rule, explicit: true, models: [...models, full] };
  });
  stage("customGroups", next, note);
}
function modelRow(entry) {
  const full = `${entry.provider}/${entry.model}`;
  const rules = draftOf("customGroups", []);
  const hiddenList = draftOf("hiddenModels", []);
  const showOn = !hiddenList.includes(full);
  const groupName = groupNameOf(entry);
  const groupId = groupIdOf(entry);
  const autoMode = groupingAuto();
  const unassigned = !autoMode && rules.length > 0 && groupId === "";
  const row = el("div", {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 0",
    borderBottom: `0.5px solid ${TOK.border}`,
    opacity: unassigned || !showOn ? "0.5" : "1"
  });
  row.setAttribute("data-mas-model-row", entry.key);
  row.title = `${entry.providerName} / ${entry.model}
\u6A21\u6001\uFF1A${entry.modalities.join(", ") || "\u65E0"}\uFF08\u6765\u6E90 ${entry.modalitySource}\uFF09
\u8BA1\u4EF7\u7CFB\u6570\uFF1A${entry.priceFactor === void 0 ? "\u672A\u77E5" : `x${entry.priceFactor.toFixed(2)}`}
\u5165\u7EC4\uFF1A${unassigned ? "\u672A\u5165\u7EC4\uFF08\u9ED8\u8BA4\u4E0D\u53EF\u7528\u3001\u4E0D\u8FDB\u4E0B\u62C9\uFF09" : groupName}`;
  const text = el("div", { display: "flex", flexDirection: "column", gap: "2px", flex: "1", minWidth: "0" });
  const nameLine = el("div", { display: "flex", alignItems: "center", gap: "6px", minWidth: "0" });
  const glyph = makePill(KIND_GLYPH[entry.kind] ?? "?", KIND_TEXT[entry.kind] ?? entry.kind, "meta");
  glyph.style.marginLeft = "0";
  nameLine.appendChild(glyph);
  nameLine.appendChild(
    el("span", { fontSize: "13px", lineHeight: "20px", color: TOK.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, entry.name || entry.model)
  );
  if (entry.free) {
    const free = makePill(view?.config?.freeBadgeLabel ?? "\u514D", "\u8BA1\u4EF7\u7CFB\u6570 x0.00\uFF080 = \u9650\u65F6\u514D\u8D39\uFF09", "running");
    free.style.marginLeft = "0";
    nameLine.appendChild(free);
  }
  if (unassigned) {
    const tag = makePill("\u672A\u5165\u7EC4", "\u6CA1\u8FDB\u4EFB\u4F55\u5206\u7EC4\u7684\u6A21\u578B\u9ED8\u8BA4\u4E0D\u53EF\u7528\uFF0C\u4E5F\u4E0D\u5728\u6A21\u578B\u4E0B\u62C9\u91CC\u5C55\u793A", "busy");
    tag.style.marginLeft = "0";
    tag.setAttribute("data-mas-unassigned", "1");
    nameLine.appendChild(tag);
  }
  if (!showOn) {
    const tag = makePill("\u5DF2\u9690\u85CF", "\u7528\u6237\u624B\u52A8\u9690\u85CF\uFF0C\u4E0D\u5728\u6A21\u578B\u4E0B\u62C9\u91CC\u5C55\u793A", "busy");
    tag.style.marginLeft = "0";
    tag.setAttribute("data-mas-hidden", "1");
    nameLine.appendChild(tag);
  }
  if (entry.disabled) {
    const tag = makePill("\u4E0D\u53EF\u7528", "\u8BE5\u6A21\u578B\u88AB\u505C\u7528\uFF0C\u4E0D\u53C2\u4E0E\u81EA\u52A8\u9009\u62E9", "busy");
    tag.style.marginLeft = "0";
    nameLine.appendChild(tag);
  } else if (!unassigned && showOn) {
    const tag = makePill("\u53EF\u7528", "\u8BE5\u6A21\u578B\u53EF\u7528\uFF0C\u53C2\u4E0E\u81EA\u52A8\u9009\u62E9", "running");
    tag.style.marginLeft = "0";
    nameLine.appendChild(tag);
  }
  text.appendChild(nameLine);
  text.appendChild(descText(`${entry.providerName} \xB7 ${groupName}`));
  row.appendChild(text);
  const controls = el("div", { display: "flex", alignItems: "center", gap: "12px", flex: "0 0 auto" });
  const select = document.createElement("select");
  select.style.cssText = `height:32px;border-radius:${TOK.radius};border:none;background:${TOK.module};color:${TOK.primary};font:inherit;font-size:13px;padding:0 10px;cursor:pointer;max-width:190px`;
  select.setAttribute(OWN_ATTR, "1");
  select.setAttribute("data-mas-assign", full);
  select.disabled = rules.length === 0;
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = rules.length === 0 ? "\u5148\u65B0\u5EFA\u5206\u7EC4" : "\u4E0D\u5165\u7EC4\uFF08\u4E0D\u53EF\u7528\uFF09";
  select.appendChild(blank);
  for (const rule of rules) {
    const option = document.createElement("option");
    option.value = rule.id;
    option.textContent = rule.label || rule.id;
    select.appendChild(option);
  }
  select.value = groupId;
  select.addEventListener("change", () => {
    const target = rules.find((rule) => rule.id === select.value);
    assignToGroup(
      entry,
      select.value,
      select.value === "" ? `\u300C${entry.name || entry.model}\u300D\u5DF2\u79FB\u51FA\u5206\u7EC4\uFF08\u4E0D\u518D\u53EF\u7528\u3001\u4E0D\u8FDB\u4E0B\u62C9\uFF09` : `\u300C${entry.name || entry.model}\u300D\u5DF2\u52A0\u5165\u5206\u7EC4\u300C${target?.label || select.value}\u300D`
    );
  });
  if (!autoMode) controls.appendChild(select);
  controls.appendChild(
    checkControl("\u5C55\u793A", showOn, { "data-mas-flag": "hidden" }, (next) => {
      const list = draftOf("hiddenModels", []);
      stage("hiddenModels", next ? list.filter((item) => item !== full) : [...list.filter((item) => item !== full), full], `${next ? "\u663E\u793A" : "\u9690\u85CF"}\u300C${entry.name || entry.model}\u300D\u5728\u6A21\u578B\u4E0B\u62C9`);
    })
  );
  const probe = document.createElement("button");
  probe.type = "button";
  probe.textContent = "\u6D4B\u8BD5";
  probe.title = "\u771F\u5B9E\u53D1\u4E00\u6B21\u6781\u5C0F\u8BF7\u6C42\uFF0C\u9A8C\u8BC1\u8BE5\u6A21\u578B\u5F53\u524D\u80FD\u5426\u8C03\u901A";
  probe.style.cssText = `height:28px;padding:0 10px;border-radius:${TOK.radius};border:none;background:${TOK.module};color:${TOK.primary};font:inherit;font-size:12px;cursor:pointer`;
  probe.setAttribute(OWN_ATTR, "1");
  probe.setAttribute("data-mas-probe", full);
  probe.addEventListener("click", () => {
    void testModelViaRoute(entry.provider, entry.model, probe);
  });
  controls.appendChild(probe);
  const cached = probeResults.get(full);
  if (cached !== void 0) applyProbeResult(probe, cached);
  row.appendChild(controls);
  return row;
}
function groupIdOf(entry) {
  const rules = draftOf("customGroups", []);
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) return rule.id;
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.id;
    }
  }
  return "";
}
function groupNameOf(entry) {
  const rules = draftOf("customGroups", []);
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) return rule.label || rule.id;
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.label || rule.id;
    }
  }
  if (rules.length > 0) return "\u672A\u5165\u7EC4";
  const byKind = draftOf("groupByKind", true);
  if (!byKind) return entry.providerName;
  return KIND_TEXT[entry.kind] ?? entry.kind;
}
function groupSummary(rule) {
  const parts = [];
  parts.push(rule.kind === null ? "\u4E0D\u9650\u7C7B\u578B" : rule.kind === "multimodal" ? "\u591A\u6A21\u6001" : "\u7EAF\u6587\u672C");
  if (rule.providers.length > 0) parts.push(`\u6765\u6E90 ${rule.providers.join("/")}`);
  if (rule.freeOnly) parts.push("\u4EC5\u9650\u514D");
  if (rule.explicit) parts.push(`\u5DF2\u52FE\u9009 ${rule.models.length} \u4E2A\u6A21\u578B`);
  else if (rule.models.length > 0) parts.push(`\u6307\u5B9A ${rule.models.length} \u4E2A\u6A21\u578B`);
  return parts.join(" \xB7 ");
}
function newGroupId() {
  return `g${Date.now().toString(36)}`;
}
function rewriteGroups(next, note) {
  stage("customGroups", next, note);
}
function groupCard(rule, index, rules) {
  const card = groupCardBox();
  card.setAttribute("data-mas-group-card", rule.id);
  const head = el("div", { display: "flex", alignItems: "center", gap: "8px" });
  const name = textInput(rule.label, "\u5206\u7EC4\u540D\u79F0", "150px", { "data-mas-group-name": rule.id });
  name.addEventListener("change", () => {
    rewriteGroups(
      rules.map((item) => item.id === rule.id ? { ...item, label: name.value.trim() } : item),
      `\u5206\u7EC4\u6539\u540D\u4E3A\u300C${name.value.trim() || rule.id}\u300D`
    );
  });
  head.appendChild(name);
  head.appendChild(descText(`${groupSummary(rule)} \xB7 ${rule.models.length} \u4E2A\u6A21\u578B`));
  head.appendChild(el("div", { flex: "1" }));
  const move = (delta) => {
    const at = index + delta;
    if (at < 0 || at >= rules.length) return;
    const next = [...rules];
    const [item] = next.splice(index, 1);
    next.splice(at, 0, item);
    rewriteGroups(next, "\u5206\u7EC4\u987A\u5E8F\u5DF2\u8C03\u6574");
  };
  head.appendChild(actionButton("\u2191", "\u4E0A\u79FB\uFF08\u8D8A\u9760\u524D\u7684\u5206\u7EC4\u8D8A\u5148\u5339\u914D\uFF09", () => move(-1)));
  head.appendChild(actionButton("\u2193", "\u4E0B\u79FB", () => move(1)));
  head.appendChild(
    actionButton("\u5220\u9664", "\u5220\u9664\u8BE5\u5206\u7EC4\uFF0C\u5176\u6210\u5458\u56DE\u5230\u300C\u672A\u5165\u7EC4\u300D", () => {
      rewriteGroups(rules.filter((item) => item.id !== rule.id), `\u5DF2\u5220\u9664\u5206\u7EC4\u300C${rule.label || rule.id}\u300D`);
    })
  );
  card.appendChild(head);
  const switches = el("div", { display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" });
  const hiddenGroups = draftOf("hiddenGroups", []);
  switches.appendChild(
    checkControl("\u4E0B\u62C9\u5C55\u793A", !hiddenGroups.includes(rule.id), { "data-mas-group-flag": "hidden" }, (next) => {
      const list = draftOf("hiddenGroups", []);
      stage("hiddenGroups", next ? list.filter((item) => item !== rule.id) : [...list.filter((item) => item !== rule.id), rule.id], `\u6574\u7EC4\u300C${rule.label || rule.id}\u300D${next ? "\u663E\u793A" : "\u9690\u85CF"}\u5728\u4E0B\u62C9`);
    })
  );
  card.appendChild(switches);
  const memberNames = rule.explicit ? rule.models.map((item) => {
    const entry = view?.entries.find((one) => `${one.provider}/${one.model}` === item || one.model === item);
    return entry?.name || item;
  }).join("\u3001") : "";
  card.appendChild(
    descText(
      memberNames === "" ? "\u8FD8\u6CA1\u6709\u6210\u5458\u3002\u5230\u4E0B\u9762\u7684\u6A21\u578B\u5217\u8868\uFF0C\u7528\u300C\u5165\u7EC4\u300D\u4E0B\u62C9\u628A\u6A21\u578B\u9009\u8FDB\u6765\u3002" : `\u6210\u5458\uFF1A${memberNames}`
    )
  );
  return card;
}
function groupsEditor(field) {
  const rules = draftOf("customGroups", []);
  const box = el("div", { display: "flex", flexDirection: "column", gap: "8px" });
  box.title = field.hint;
  box.appendChild(
    descText(
      rules.length === 0 ? "\u5F53\u524D\u6309 dsh \u5185\u7F6E\u89C4\u5219\u5206\u7EC4\uFF08\u6309\u6765\u6E90 / \u6309\u7C7B\u578B\uFF09\u3002\u65B0\u5EFA\u5206\u7EC4\u540E\uFF0C\u6A21\u578B\u4E0B\u62C9\u5C31\u6309\u4F60\u5EFA\u7684\u5206\u7EC4\u663E\u793A\u3002" : "\u5148\u5728\u8FD9\u91CC\u5EFA\u7EC4\uFF0C\u518D\u5230\u4E0B\u9762\u7684\u6A21\u578B\u5217\u8868\u7528\u300C\u5165\u7EC4\u300D\u4E0B\u62C9\u628A\u6A21\u578B\u9009\u8FDB\u6765\u3002\u6CA1\u5165\u7EC4\u7684\u6A21\u578B\u9ED8\u8BA4\u4E0D\u53EF\u7528\u3001\u4E5F\u4E0D\u5728\u6A21\u578B\u4E0B\u62C9\u91CC\u51FA\u73B0\u3002"
    )
  );
  rules.forEach((rule, index) => box.appendChild(groupCard(rule, index, rules)));
  const form = el("div", { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" });
  const newName = textInput("", "\u65B0\u5206\u7EC4\u540D\u79F0\uFF08\u53EF\u7559\u7A7A\uFF0C\u4E4B\u540E\u6539\u540D\uFF09", "220px", { "data-mas-group-new": "1" });
  form.appendChild(newName);
  form.appendChild(
    actionButton("\u65B0\u5EFA\u5206\u7EC4", "\u65B0\u5EFA\u4E00\u4E2A\u7A7A\u5206\u7EC4\uFF0C\u968F\u540E\u5230\u6A21\u578B\u5217\u8868\u91CC\u628A\u6A21\u578B\u9009\u8FDB\u6765", () => {
      const rule = {
        id: newGroupId(),
        label: newName.value.trim(),
        kind: null,
        providers: [],
        models: [],
        freeOnly: false,
        explicit: true
      };
      rewriteGroups([...rules, rule], `\u65B0\u5EFA\u5206\u7EC4\u300C${rule.label || rule.id}\u300D\uFF0C\u8BF7\u5230\u6A21\u578B\u5217\u8868\u9009\u5165\u7EC4`);
    })
  );
  box.appendChild(form);
  return box;
}
var NUMBER_RULES = {
  maxRetries: { min: 0, max: 10, unit: "\u6B21", step: 1 },
  retryDelayMs: { min: 0, max: 6e4, unit: "ms", step: 100 },
  cooldownMs: { min: 0, max: 864e5, unit: "ms\uFF081 \u5206\u949F = 60000\uFF09", step: 6e4 },
  catalogTtlMs: { min: 1e3, max: 36e5, unit: "ms", step: 1e3 },
  occupancyRefreshMs: { min: 1e3, max: 6e5, unit: "ms", step: 1e3 },
  probeIntervalMin: { min: 0, max: 1440, unit: "\u5206\u949F\uFF080 = \u4E0D\u81EA\u52A8\u63A2\u6D4B\uFF09", step: 1 }
};
function configRow(field) {
  if (field.type === "groups") return groupsEditor(field);
  if (field.type === "groups-list") return groupListRow(field);
  const value = draftOf(field.key, config?.config?.[field.key]);
  if (field.type === "boolean") {
    const box = el("label", { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" });
    box.appendChild(
      checkControl(
        "",
        value === true,
        { "data-mas-field": field.key },
        (next) => stage(field.key, next, `${field.label} \u2192 ${next ? "\u5F00" : "\u5173"}`)
      )
    );
    return settingRow(field.label, field.hint, box);
  }
  if (field.type === "number") {
    const rule = NUMBER_RULES[field.key];
    const wrap = el("label", { display: "inline-flex", alignItems: "center", gap: "8px", cursor: "text" });
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(rule?.min ?? 0);
    input.max = String(rule?.max ?? Number.MAX_SAFE_INTEGER);
    if (rule?.step !== void 0) input.step = String(rule.step);
    input.value = value === null || value === void 0 ? "" : String(value);
    input.style.cssText = `width:120px;height:32px;padding:0 8px;box-sizing:border-box;border-radius:${TOK.radius};border:1px solid ${TOK.border};background:transparent;color:${TOK.primary};font:inherit;font-size:13px;font-variant-numeric:tabular-nums`;
    input.setAttribute(OWN_ATTR, "1");
    input.setAttribute("data-mas-field", field.key);
    input.addEventListener("change", () => {
      const raw = Number(input.value);
      if (!Number.isFinite(raw) || raw < 0) {
        statusKind = "error";
        statusText = `${field.label}\uFF1A\u8BF7\u8F93\u5165\u5927\u4E8E\u7B49\u4E8E 0 \u7684\u6570\u5B57`;
        input.style.borderColor = TOK.error;
        notify();
        return;
      }
      if (rule !== void 0 && (raw < rule.min || raw > rule.max)) {
        statusKind = "error";
        statusText = `${field.label}\uFF1A\u53D6\u503C\u5FC5\u987B\u5728 ${rule.min} \u2013 ${rule.max} ${rule.unit} \u4E4B\u95F4\uFF08\u672C\u6B21\u672A\u4FDD\u5B58\uFF09`;
        input.style.borderColor = TOK.error;
        notify();
        return;
      }
      input.style.borderColor = "";
      stage(field.key, Math.floor(raw), `${field.label} \u2192 ${Math.floor(raw)}`);
    });
    wrap.appendChild(input);
    wrap.appendChild(descText(rule === void 0 ? "" : `${rule.min} \u2013 ${rule.max} ${rule.unit}`));
    return settingRow(field.label, field.hint, wrap);
  }
  if (field.type === "model") {
    const select = document.createElement("select");
    select.setAttribute(OWN_ATTR, "1");
    select.setAttribute("data-mas-field", field.key);
    select.style.cssText = `height:32px;padding:0 8px;border-radius:${TOK.radius};border:1px solid ${TOK.border};background:transparent;color:${TOK.primary};font:inherit;font-size:13px;max-width:260px`;
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "\uFF08\u672A\u8BBE\u7F6E\uFF0C\u8DDF\u968F\u5BBF\u4E3B\uFF09";
    select.appendChild(none);
    const current = value;
    for (const entry of view?.entries ?? []) {
      const option = document.createElement("option");
      option.value = entry.key;
      option.textContent = `${entry.providerName} / ${entry.name || entry.model}`;
      if (current !== null && current !== void 0 && current.provider === entry.provider && current.model === entry.model) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      const entry = (view?.entries ?? []).find((item) => item.key === select.value);
      stage(field.key, entry === void 0 ? null : { provider: entry.provider, model: entry.model }, `\u9ED8\u8BA4\u6A21\u578B \u2192 ${entry?.name ?? "\u672A\u8BBE\u7F6E"}`);
    });
    return settingRow(field.label, field.hint, select);
  }
  if (field.type === "scope") {
    const choices = [
      { value: "group", label: "\u7EC4\u5185" },
      { value: "group-cross", label: "\u7EC4\u5185 \u2192 \u8DE8\u7EC4" },
      { value: "all", label: "\u5168\u90E8" }
    ];
    const current = typeof value === "string" && choices.some((item) => item.value === value) ? value : "group-cross";
    const select = document.createElement("select");
    Object.assign(select.style, {
      height: "30px",
      minWidth: "150px",
      padding: "0 8px",
      fontSize: "13px",
      color: TOK.primary,
      background: TOK.layer,
      border: `0.5px solid ${TOK.border}`,
      borderRadius: "6px",
      cursor: "pointer"
    });
    select.setAttribute(OWN_ATTR, "1");
    select.setAttribute("data-mas-field", field.key);
    for (const item of choices) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      option.selected = item.value === current;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      const next = choices.find((item) => item.value === select.value);
      stage(field.key, select.value, `${field.label} \u2192 ${next?.label ?? select.value}`);
    });
    return settingRow(field.label, field.hint, select);
  }
  if (field.type === "groupmode") {
    const choices = [
      { value: "manual", label: "\u624B\u5DE5\u5206\u7EC4" },
      { value: "auto", label: "\u81EA\u52A8\u5206\u7EC4\uFF08\u514D\u8D39 / \u79EF\u5206 / \u672A\u77E5\uFF09" }
    ];
    const current = value === "auto" ? "auto" : "manual";
    const select = document.createElement("select");
    Object.assign(select.style, {
      height: "30px",
      minWidth: "210px",
      padding: "0 8px",
      fontSize: "13px",
      color: TOK.primary,
      background: TOK.layer,
      border: `0.5px solid ${TOK.border}`,
      borderRadius: "6px",
      cursor: "pointer"
    });
    select.setAttribute(OWN_ATTR, "1");
    select.setAttribute("data-mas-field", field.key);
    for (const item of choices) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      option.selected = item.value === current;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      const next = choices.find((item) => item.value === select.value);
      stage(field.key, select.value, `${field.label} \u2192 ${next?.label ?? select.value}`);
    });
    return settingRow(field.label, field.hint, select);
  }
  if (field.type === "list") {
    const wrap = el("div", { display: "flex", flexDirection: "column", gap: "4px", flex: "0 0 260px" });
    const input = textInput(Array.isArray(value) ? value.join(",") : "", "\u9017\u53F7\u5206\u9694\uFF0C\u7559\u7A7A = \u4E0D\u9650", "100%", {
      "data-mas-field": field.key
    });
    input.addEventListener("change", () => stage(field.key, input.value, `${field.label} \u5DF2\u4FEE\u6539`));
    wrap.appendChild(input);
    return settingRow(field.label, field.hint, wrap);
  }
  if (field.type === "text") {
    const input = textInput(typeof value === "string" ? value : "", "", "110px", { "data-mas-field": field.key });
    input.addEventListener("change", () => stage(field.key, input.value, `${field.label} \u5DF2\u4FEE\u6539`));
    return settingRow(field.label, field.hint, input);
  }
  const count = Array.isArray(value) ? value.length : 0;
  if (field.key === "disabledModels") {
    return settingRow(
      field.label,
      field.hint,
      descText(count === 0 ? "\u7531\u5206\u7EC4\u51B3\u5B9A\uFF1A\u6CA1\u5165\u7EC4\u7684\u6A21\u578B\u9ED8\u8BA4\u4E0D\u53EF\u7528" : `\u53E6\u6709 ${count} \u4E2A\u6A21\u578B\u88AB\u5355\u72EC\u505C\u7528`)
    );
  }
  return settingRow(
    field.label,
    field.hint,
    descText(count === 0 ? "\u5168\u90E8\u5C55\u793A\uFF08\u5728\u300C\u6A21\u578B\u300D\u533A\u9010\u884C\u7528\u300C\u5C55\u793A\u300D\u5F00\u5173\uFF09" : `\u5DF2\u9690\u85CF ${count} \u4E2A\uFF08\u5728\u300C\u6A21\u578B\u300D\u533A\u9010\u884C\u7528\u300C\u5C55\u793A\u300D\u5F00\u5173\uFF09`)
  );
}
function groupListRow(field) {
  const rules = draftOf("customGroups", []);
  const off = draftOf(field.key, []);
  if (rules.length === 0) return settingRow(field.label, field.hint, descText("\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u5206\u7EC4"));
  const line = el("div", { display: "flex", flexWrap: "wrap", gap: "4px 10px", justifyContent: "flex-end" });
  for (const rule of rules) {
    line.appendChild(descText(`${rule.label || rule.id}\uFF1A${off.includes(rule.id) ? "\u4E0D\u5C55\u793A" : "\u5C55\u793A"}`));
  }
  return settingRow(field.label, field.hint, line);
}
var FILTER_ALL = "";
var FILTER_LOOSE = "__loose__";
var modelFilter = FILTER_ALL;
var modelsExpanded = false;
var advancedOpen = false;
var MODEL_PAGE = 12;
function stickyBar() {
  const keys = draftKeys();
  const pending = keys.length > 0;
  const cfg = config?.config ?? {};
  const entries = view?.entries ?? [];
  const cooldown = view?.cooldown;
  const def = cfg.defaultModel;
  const summary = [
    cfg.enabled === false ? "\u81EA\u52A8\u9009\u62E9\uFF1A\u5DF2\u5173\u95ED" : "\u81EA\u52A8\u9009\u62E9\uFF1A\u5DF2\u542F\u7528",
    def === null || def === void 0 ? "\u9ED8\u8BA4\u6A21\u578B\uFF1A\u8DDF\u968F\u5BBF\u4E3B" : `\u9ED8\u8BA4\u6A21\u578B\uFF1A${def.model ?? ""}`,
    `${entries.length} \u4E2A\u6A21\u578B`,
    cooldown?.active === true ? `\u51B7\u5374\u4E2D ${Math.ceil(cooldown.remainingMs / 6e4)} \u5206\u949F` : "\u65E0\u51B7\u5374"
  ].join(" \xB7 ");
  const bar = el("div", {
    position: "sticky",
    top: "0",
    zIndex: "2",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 0 8px",
    background: TOK.layer,
    borderBottom: `0.5px solid ${TOK.border}`
  });
  bar.setAttribute("data-mas-topbar", "1");
  const top = el("div", { display: "flex", alignItems: "center", gap: "10px" });
  const head = el("div", { display: "flex", flexDirection: "column", gap: "2px", flex: "1", minWidth: "0" });
  head.appendChild(el("span", { fontSize: "15px", lineHeight: "24px", fontWeight: "600", color: TOK.primary }, "\u6A21\u578B\u81EA\u52A8\u9009\u62E9"));
  const summaryLine = descText(summary);
  summaryLine.setAttribute("data-mas-status", "1");
  head.appendChild(summaryLine);
  top.appendChild(head);
  top.appendChild(
    actionButton(
      "\u91CD\u65B0\u83B7\u53D6",
      "\u91CD\u65B0\u62C9\u53D6\u6A21\u578B\u76EE\u5F55\uFF08\u6765\u6E90\uFF1Allm.listProviders / llm.listModels / resolveModelInfo\uFF09",
      () => {
        statusKind = "pending";
        statusText = "\u6B63\u5728\u91CD\u65B0\u83B7\u53D6\u6A21\u578B\u5217\u8868\u2026";
        notify();
        void loadCatalog({ force: true });
      },
      { "data-mas-retry": "1" }
    )
  );
  if (pending) {
    top.appendChild(actionButton("\u653E\u5F03", "\u4E22\u5F03\u5168\u90E8\u672A\u4FDD\u5B58\u6539\u52A8\uFF0C\u6062\u590D\u6210\u5DF2\u4FDD\u5B58\u7684\u914D\u7F6E", discardDraft));
    top.appendChild(
      actionButton("\u4FDD\u5B58", "\u628A\u8349\u7A3F\u5199\u5165\u63D2\u4EF6\u914D\u7F6E\uFF08profile \u7684 cordis.patch.yml\uFF09", () => void saveDraft(), {
        "data-mas-save": "1"
      })
    );
  }
  bar.appendChild(top);
  const line = el("div", { display: "flex", alignItems: "center", gap: "10px" });
  const barText = el(
    "span",
    { fontSize: "12px", lineHeight: "18px", flex: "1", color: pending ? TOK.warn : TOK.tertiary },
    pending ? `\u6709 ${keys.length} \u9879\u6539\u52A8\u672A\u4FDD\u5B58\uFF1A${keys.join("\u3001")}` : "\u6CA1\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8"
  );
  barText.setAttribute("data-mas-savebar", "1");
  line.appendChild(barText);
  bar.appendChild(line);
  const status = statusLine();
  if (status !== null) bar.appendChild(status);
  return bar;
}
function stepTitle(step, title, desc) {
  const box = el("div", { display: "flex", alignItems: "flex-start", gap: "10px", padding: "18px 0 6px" });
  box.setAttribute("data-mas-step", step);
  box.appendChild(
    el(
      "span",
      {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        flex: "0 0 auto",
        background: TOK.module,
        color: TOK.secondary,
        fontSize: "12px",
        fontWeight: "600"
      },
      step
    )
  );
  const text = el("div", { display: "flex", flexDirection: "column", gap: "2px", flex: "1", minWidth: "0" });
  text.appendChild(el("span", { fontSize: "14px", lineHeight: "22px", fontWeight: "600", color: TOK.primary }, title));
  if (desc !== "") text.appendChild(descText(desc));
  box.appendChild(text);
  return box;
}
function groupHead(label, note, id, list) {
  const head = el("div", {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "14px 0 4px",
    borderBottom: `0.5px solid ${TOK.border}`
  });
  head.setAttribute("data-mas-group-head", id);
  head.appendChild(el("span", { fontSize: "13px", fontWeight: "600", color: TOK.primary }, label));
  head.appendChild(descText(note));
  const test = actionButton(
    "\u6D4B\u8BD5\u5168\u7EC4",
    "\u771F\u5B9E\u9010\u4E2A\u6D4B\u8BD5\u672C\u7EC4 " + list.length + " \u4E2A\u6A21\u578B\u5F53\u524D\u80FD\u5426\u8C03\u901A",
    () => {
    },
    { "data-mas-group-test": id }
  );
  test.disabled = list.length === 0;
  test.addEventListener("click", () => {
    void testGroupViaRoute(list, test);
  });
  head.appendChild(test);
  return head;
}
function modelsSection() {
  const section = el("div", { display: "flex", flexDirection: "column", gap: "0" });
  section.setAttribute("data-mas-section", "models");
  if (view === null) {
    const hint = el(
      "div",
      { padding: "12px 0", fontSize: "13px", color: viewError === null ? TOK.tertiary : TOK.error },
      viewError === null ? "\u6A21\u578B\u76EE\u5F55\u52A0\u8F7D\u4E2D\u2026" : `\u6A21\u578B\u76EE\u5F55\u52A0\u8F7D\u5931\u8D25\uFF1A${viewError}`
    );
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");
    section.appendChild(hint);
    return section;
  }
  const entries = view.entries ?? [];
  if (entries.length === 0) {
    section.appendChild(
      el(
        "div",
        { padding: "12px 0", fontSize: "13px", color: TOK.tertiary },
        "\u6CA1\u6709\u53D6\u5230\u4EFB\u4F55\u6A21\u578B\uFF1A\u8BF7\u5148\u5728 dsh \u8BBE\u7F6E\u9875\u914D\u7F6E provider \u4E0E API Key\uFF0C\u518D\u70B9\u4E0A\u65B9\u300C\u91CD\u65B0\u83B7\u53D6\u300D\u3002"
      )
    );
    return section;
  }
  const rules = draftOf("customGroups", []);
  const autoMode = groupingAuto();
  const hasRules = !autoMode && rules.length > 0;
  if (modelFilter !== FILTER_ALL && modelFilter !== FILTER_LOOSE && !rules.some((rule) => rule.id === modelFilter)) {
    modelFilter = FILTER_ALL;
  }
  if (!hasRules) modelFilter = FILTER_ALL;
  const loose = entries.filter((entry) => groupIdOf(entry) === "");
  const tools = el("div", { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "2px 0 8px" });
  const search = textInput("", "\u641C\u7D22\u6A21\u578B\u540D\u6216\u6765\u6E90\u2026", "200px", { "data-mas-search": "1" });
  search.addEventListener("input", () => {
    const needle = search.value.trim().toLowerCase();
    for (const node of Array.from(section.querySelectorAll("[data-mas-model-row]"))) {
      const hit = needle === "" || (node.textContent ?? "").toLowerCase().includes(needle);
      node.style.display = hit ? "flex" : "none";
    }
    for (const node of Array.from(section.querySelectorAll("[data-mas-group-head]"))) {
      node.style.display = needle === "" ? "flex" : "none";
    }
  });
  tools.appendChild(search);
  if (hasRules) {
    const chips = [
      { id: FILTER_ALL, label: `\u5168\u90E8 ${entries.length}` },
      { id: FILTER_LOOSE, label: `\u672A\u5165\u7EC4 ${loose.length}` },
      ...rules.map((rule) => ({
        id: rule.id,
        label: `${rule.label || rule.id} ${entries.filter((entry) => groupIdOf(entry) === rule.id).length}`
      }))
    ];
    for (const chip of chips) {
      const active = modelFilter === chip.id;
      const button = actionButton(
        chip.label,
        active ? "\u5F53\u524D\u7B5B\u9009" : "\u53EA\u770B\u8FD9\u4E00\u7EC4",
        () => {
          modelFilter = chip.id;
          modelsExpanded = false;
          notify();
        },
        { "data-mas-filter": chip.id }
      );
      button.style.height = "28px";
      button.style.padding = "0 10px";
      button.style.background = active ? TOK.hover : "transparent";
      button.style.borderColor = active ? TOK.primary : TOK.border;
      tools.appendChild(button);
    }
  } else {
    tools.appendChild(descText(autoMode ? "\u81EA\u52A8\u5206\u7EC4\uFF1A\u6309\u300C\u514D\u8D39 / \u79EF\u5206 / \u672A\u77E5\u300D\u5B9E\u65F6\u5206\u4E09\u7EC4\uFF1B\u624B\u5DE5\u5206\u7EC4\u5DF2\u6682\u5B58\uFF0C\u5207\u56DE\u300C\u624B\u5DE5\u300D\u539F\u6837\u6062\u590D\u3002" : "\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u5206\u7EC4\uFF1A\u5148\u5728\u4E0A\u9762\u300C1 \u5206\u7EC4\u300D\u5EFA\u4E00\u4E2A\u7EC4\uFF0C\u518D\u56DE\u6765\u628A\u6A21\u578B\u9009\u8FDB\u53BB\u3002"));
  }
  const showAll = draftOf("showAllModels", false);
  const showAllLabel = el("label", { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", marginLeft: "auto", fontSize: "13px", color: TOK.secondary });
  const showAllBox = document.createElement("input");
  showAllBox.type = "checkbox";
  showAllBox.checked = showAll;
  showAllBox.style.cssText = "margin:0;width:15px;height:15px;cursor:pointer";
  showAllBox.setAttribute(OWN_ATTR, "1");
  showAllBox.addEventListener("change", () => {
    stage("showAllModels", showAllBox.checked, showAllBox.checked ? "\u663E\u793A\u5168\u90E8\u6A21\u578B" : "\u53EA\u663E\u793A\u5DF2\u5165\u7EC4\u6A21\u578B");
  });
  showAllLabel.appendChild(showAllBox);
  showAllLabel.appendChild(document.createTextNode("\u663E\u793A\u5168\u90E8\u6A21\u578B"));
  if (!autoMode) tools.appendChild(showAllLabel);
  section.appendChild(tools);
  const segments = [];
  if (!hasRules) {
    for (const group of view.groups ?? []) {
      const list = group.keys.map((key) => entries.find((item) => item.key === key)).filter((item) => item !== void 0);
      segments.push({
        id: group.id,
        label: group.label,
        note: group.custom === true ? "\u81EA\u5B9A\u4E49\u5206\u7EC4" : group.kind === "multimodal" ? "\u591A\u6A21\u6001" : group.kind === "text" ? "\u7EAF\u6587\u672C" : "\u6309\u6765\u6E90",
        list
      });
    }
  } else if (showAll) {
    const available = entries.filter((e) => !e.disabled && !e.hidden);
    const disabled = entries.filter((e) => e.disabled && !e.hidden);
    const hidden = entries.filter((e) => e.hidden);
    if (available.length > 0) segments.push({ id: "available", label: "\u53EF\u7528", note: `${available.length} \u4E2A\u6A21\u578B`, list: available });
    if (disabled.length > 0) segments.push({ id: "disabled", label: "\u4E0D\u53EF\u7528", note: `${disabled.length} \u4E2A\u6A21\u578B \xB7 \u672A\u5165\u7EC4\u6216\u5DF2\u505C\u7528`, list: disabled });
    if (hidden.length > 0) segments.push({ id: "hidden", label: "\u5DF2\u9690\u85CF", note: `${hidden.length} \u4E2A\u6A21\u578B \xB7 \u4E0D\u5728\u4E0B\u62C9\u5C55\u793A`, list: hidden });
  } else if (modelFilter === FILTER_LOOSE) {
    segments.push({ id: FILTER_LOOSE, label: "\u672A\u5165\u7EC4", note: `${loose.length} \u4E2A\u6A21\u578B \xB7 \u9ED8\u8BA4\u4E0D\u53EF\u7528\u3001\u4E0D\u8FDB\u4E0B\u62C9`, list: loose });
  } else if (modelFilter === FILTER_ALL) {
    for (const rule of rules) {
      const list = entries.filter((entry) => groupIdOf(entry) === rule.id);
      segments.push({ id: rule.id, label: rule.label || rule.id, note: `\u81EA\u5B9A\u4E49\u5206\u7EC4 \xB7 ${list.length} \u4E2A\u6A21\u578B`, list });
    }
    if (loose.length > 0) {
      segments.push({ id: FILTER_LOOSE, label: "\u672A\u5165\u7EC4", note: `${loose.length} \u4E2A\u6A21\u578B \xB7 \u9ED8\u8BA4\u4E0D\u53EF\u7528\u3001\u4E0D\u8FDB\u4E0B\u62C9`, list: loose });
    }
  } else {
    const rule = rules.find((item) => item.id === modelFilter);
    if (rule !== void 0) {
      const list = entries.filter((entry) => groupIdOf(entry) === rule.id);
      segments.push({ id: rule.id, label: rule.label || rule.id, note: `\u81EA\u5B9A\u4E49\u5206\u7EC4 \xB7 ${list.length} \u4E2A\u6A21\u578B`, list });
    }
  }
  const unavailableKeys = new Set(view.unavailableModels ?? []);
  for (const segment of segments) {
    segment.list = segment.list.filter((entry) => !unavailableKeys.has(entry.key));
  }
  if (unavailableKeys.size > 0) {
    const list = entries.filter((entry) => unavailableKeys.has(entry.key));
    if (list.length > 0) {
      segments.push({
        id: "__unavailable__",
        label: `\u6682\u4E0D\u53EF\u7528 \xB7 ${list.length}`,
        note: "\u6700\u8FD1\u4E00\u6B21\u8FDE\u901A\u6027\u63A2\u6D4B\u8C03\u4E0D\u901A\uFF1B\u4E0D\u53C2\u4E0E\u81EA\u52A8\u9009\u62E9\uFF0C\u70B9\u300C\u6D4B\u8BD5\u5168\u7EC4\u300D\u91CD\u6D4B\u901A\u8FC7\u540E\u81EA\u52A8\u79FB\u51FA",
        list
      });
    }
  }
  for (const segment of segments) {
    section.appendChild(groupHead(segment.label, segment.note, segment.id, segment.list));
    if (segment.list.length === 0) {
      section.appendChild(descText(autoMode ? "\u8FD9\u4E00\u7EC4\u76EE\u524D\u6CA1\u6709\u6A21\u578B\u3002" : "\u8FD9\u4E2A\u7EC4\u8FD8\u6CA1\u6709\u6210\u5458\uFF1A\u7528\u4E0B\u9762\u4EFB\u610F\u4E00\u884C\u6A21\u578B\u7684\u300C\u5165\u7EC4\u300D\u4E0B\u62C9\u628A\u6A21\u578B\u9009\u8FDB\u6765\u3002"));
      continue;
    }
    const shown = modelsExpanded ? segment.list : segment.list.slice(0, MODEL_PAGE);
    for (const entry of shown) section.appendChild(modelRow(entry));
    const hiddenCount = segment.list.length - shown.length;
    if (hiddenCount > 0) {
      section.appendChild(
        actionButton(
          `\u663E\u793A\u5168\u90E8 ${segment.list.length} \u4E2A\uFF08\u8FD8\u6709 ${hiddenCount} \u4E2A\u672A\u5C55\u5F00\uFF09`,
          "\u5C55\u5F00\u8FD9\u4E2A\u5206\u7EC4\u7684\u5168\u90E8\u6A21\u578B\uFF08\u641C\u7D22\u53EA\u4F5C\u7528\u4E8E\u5DF2\u663E\u793A\u7684\u884C\uFF09",
          () => {
            modelsExpanded = true;
            notify();
          },
          { "data-mas-expand": segment.id }
        )
      );
    }
  }
  const failed = view.failures ?? [];
  if (failed.length > 0) {
    section.appendChild(
      el(
        "div",
        { marginTop: "8px", fontSize: "12px", color: TOK.warn },
        `\u6709 ${failed.length} \u4E2A\u6765\u6E90\u62C9\u53D6\u5931\u8D25\uFF1A${failed.map((item) => `${item.name}\uFF08${item.message}\uFF09`).join("\uFF1B")}`
      )
    );
  }
  return section;
}
function groupsSection() {
  const section = el("div", { display: "flex", flexDirection: "column", gap: "0" });
  section.setAttribute("data-mas-section", "groups");
  if (groupingAuto()) {
    section.appendChild(descText("\u5F53\u524D\u662F\u300C\u81EA\u52A8\u5206\u7EC4\u300D\uFF1A\u6309\u6A21\u578B\u662F\u5426\u514D\u8D39\u5B9E\u65F6\u5206\u6210 \u514D\u8D39 / \u79EF\u5206 / \u672A\u77E5 \u4E09\u7EC4\u3002\u539F\u6709\u81EA\u5B9A\u4E49\u5206\u7EC4\u5DF2\u6682\u5B58\uFF0C\u5207\u56DE\u300C\u624B\u5DE5\u300D\uFF08\u8FD0\u884C\u7B56\u7565 \u2192 \u5206\u7EC4\u65B9\u5F0F\uFF09\u539F\u6837\u6062\u590D\u3002"));
    return section;
  }
  const byKind = draftOf("groupByKind", true);
  section.appendChild(
    settingRow(
      "\u6309\u7C7B\u578B\u5206\u7EC4",
      "\u5F00 = \u6240\u6709\u6765\u6E90\u7684\u591A\u6A21\u6001\u4E00\u7EC4\u3001\u7EAF\u6587\u672C\u4E00\u7EC4\uFF1B\u5173 = \u6309\u6765\u6E90\uFF08provider\uFF09\u5206\u7EC4\u3002\u8FD9\u5C31\u662F dsh \u5185\u7F6E\u7684\u4E24\u79CD\u5206\u7EC4\u65B9\u5F0F\u3002",
      checkControl("\u6309\u7C7B\u578B\u5206\u7EC4", byKind, { "data-mas-groupby": "kind" }, (next) => {
        stage("groupByKind", next, next ? "\u5206\u7EC4\u65B9\u5F0F \u2192 \u6309\u7C7B\u578B" : "\u5206\u7EC4\u65B9\u5F0F \u2192 \u6309\u6765\u6E90");
      })
    )
  );
  const field = (config?.fields ?? []).find((item) => item.key === "customGroups");
  section.appendChild(groupsEditor(field ?? { key: "customGroups", type: "groups", label: "\u81EA\u5B9A\u4E49\u5206\u7EC4", hint: "" }));
  return section;
}
var FIELD_BLOCKS = [
  { id: "basic", title: "\u9ED8\u8BA4\u6A21\u578B\u4E0E\u603B\u5F00\u5173", desc: "\u8D77\u624B\u7528\u54EA\u4E2A\u6A21\u578B\uFF0C\u4EE5\u53CA\u63D2\u4EF6\u662F\u5426\u63A5\u7BA1\u9009\u62E9", keys: ["enabled", "defaultModel"] },
  { id: "grouping", title: "\u5206\u7EC4\u4E0E\u81EA\u52A8\u63A2\u6D4B", desc: "\u5206\u7EC4\u65B9\u5F0F\uFF1A\u624B\u5DE5\uFF08\u81EA\u5B9A\u4E49\u5206\u7EC4\uFF09\u6216\u81EA\u52A8\uFF08\u6309\u514D\u8D39 / \u79EF\u5206 / \u672A\u77E5\uFF09\uFF1B\u5B9A\u65F6\u63A2\u6D4B\u95F4\u9694 0 = \u4E0D\u81EA\u52A8", keys: ["groupMode", "probeIntervalMin"] },
  { id: "retry", title: "\u5931\u8D25\u91CD\u8BD5", desc: "\u540C\u4E00\u4E2A\u6A21\u578B\u62A5\u9519\u65F6\u5148\u91CD\u8BD5\uFF1B\u673A\u4F1A\u7528\u5B8C\u624D\u6362\u6A21\u578B", keys: ["maxRetries"] },
  {
    id: "switch",
    title: "\u81EA\u52A8\u5207\u6362",
    desc: "\u91CD\u8BD5\u673A\u4F1A\u7528\u5B8C\u540E\u6362\u54EA\u4E2A\u6A21\u578B\uFF1A\u9ED8\u8BA4\u5148\u5728\u4F60\u81EA\u5DF1\u7684\u5206\u7EC4\u91CC\u6362\uFF0C\u7EC4\u5185\u8017\u5C3D\u518D\u8DE8\u7EC4\u515C\u5E95",
    keys: ["switchScope", "preferIdle"]
  }
];
var QUIET_FIELDS = /* @__PURE__ */ new Set([
  "customGroups",
  "groupByKind",
  "disabledModels",
  "disabledGroups",
  "hiddenModels",
  "hiddenGroups"
]);
function policySection() {
  const section = el("div", { display: "flex", flexDirection: "column", gap: "0" });
  section.setAttribute("data-mas-section", "policy");
  if (config === null) {
    section.appendChild(el("div", { padding: "12px 0", fontSize: "13px", color: TOK.tertiary }, "\u914D\u7F6E\u52A0\u8F7D\u4E2D\u2026"));
    return section;
  }
  const known = new Set(FIELD_BLOCKS.flatMap((block) => block.keys));
  section.appendChild(
    blockTitle("\u8FD0\u884C\u7B56\u7565", "\u81EA\u52A8\u9009\u62E9\u3001\u5931\u8D25\u91CD\u8BD5\u3001\u540C\u7C7B\u578B\u5207\u6362\u4E0E\u51B7\u5374\u6062\u590D\uFF0C\u90FD\u5728\u8FD9\u91CC\u914D\u3002")
  );
  for (const block of FIELD_BLOCKS) {
    const fields = config.fields.filter((field) => block.keys.includes(field.key));
    if (fields.length === 0) continue;
    section.appendChild(blockTitle(block.title, block.desc));
    for (const field of fields) section.appendChild(configRow(field));
  }
  const rest = config.fields.filter(
    (field) => !known.has(field.key) && !QUIET_FIELDS.has(field.key)
  );
  if (rest.length > 0) {
    section.appendChild(blockTitle("\u5176\u4ED6", "\u65B0\u589E\u914D\u7F6E\u9879"));
    for (const field of rest) section.appendChild(configRow(field));
  }
  section.appendChild(
    el(
      "div",
      { marginTop: "10px", fontSize: "12px", lineHeight: "18px", color: TOK.tertiary },
      config.writable ? `\u6539\u52A8\u4FDD\u5B58\u540E\u5199\u5165 ${config.documentPath ?? "cordis.patch.yml"}` : "\u914D\u7F6E\u6587\u6863\u4E0D\u53EF\u5199\uFF1A\u6539\u52A8\u53EA\u4F5C\u7528\u4E8E\u672C\u8FDB\u7A0B\u5185\u5B58\uFF0C\u91CD\u542F\u540E\u5931\u6548"
    )
  );
  return section;
}
function statusLine() {
  if (statusText === "") return null;
  const tone = statusKind === "error" ? TOK.error : statusKind === "ok" ? TOK.ok : statusKind === "pending" ? TOK.warn : TOK.tertiary;
  const line = el("div", { fontSize: "12px", lineHeight: "18px", color: tone }, statusText);
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  return line;
}
function buildSettingsForm() {
  const wrap = el("div", {
    display: "flex",
    flexDirection: "column",
    gap: "0",
    width: "100%",
    maxWidth: "760px",
    fontSize: "13px"
  });
  wrap.appendChild(stickyBar());
  const autoMode = groupingAuto();
  const groups = el("div", { display: "flex", flexDirection: "column", gap: "0" });
  groups.appendChild(stepTitle("1", "\u5206\u7EC4", autoMode ? "\u81EA\u52A8\u5206\u7EC4\uFF1A\u6309\u6A21\u578B\u662F\u5426\u514D\u8D39\u5B9E\u65F6\u5206\u4E09\u7EC4\uFF0C\u5207\u56DE\u300C\u624B\u5DE5\u300D\u53EF\u6062\u590D\u539F\u6709\u81EA\u5B9A\u4E49\u5206\u7EC4\u3002" : "\u5148\u5EFA\u7EC4\uFF1Adsh \u9ED8\u8BA4\u6309\u6765\u6E90\u6216\u7C7B\u578B\u5206\u7EC4\uFF0C\u8FD9\u91CC\u7684\u7EC4\u540D\u5C31\u662F\u6A21\u578B\u4E0B\u62C9\u91CC\u7684\u5206\u7EC4\u6807\u9898\u3002"));
  groups.appendChild(groupsSection());
  wrap.appendChild(groups);
  const models = el("div", { display: "flex", flexDirection: "column", gap: "0" });
  models.appendChild(stepTitle("2", autoMode ? "\u6A21\u578B" : "\u6A21\u578B\u5165\u7EC4", autoMode ? "\u9010\u884C\u300C\u6D4B\u8BD5\u300D\u53EF\u9A8C\u8BC1\u6A21\u578B\u80FD\u5426\u8C03\u901A\uFF1B\u8C03\u4E0D\u901A\u7684\u81EA\u52A8\u5F52\u5230\u672B\u5C3E\u300C\u6682\u4E0D\u53EF\u7528\u300D\u7EC4\u3002" : "\u518D\u628A\u6A21\u578B\u9009\u8FDB\u7EC4\uFF1A\u6CA1\u5165\u7EC4\u7684\u6A21\u578B\u9ED8\u8BA4\u4E0D\u53EF\u7528\uFF0C\u4E5F\u4E0D\u51FA\u73B0\u5728\u6A21\u578B\u4E0B\u62C9\u91CC\u3002"));
  models.appendChild(modelsSection());
  wrap.appendChild(models);
  const policy = el("div", { display: "flex", flexDirection: "column", gap: "0" });
  policy.appendChild(stepTitle("3", "\u8FD0\u884C\u7B56\u7565", "\u5206\u7EC4\u65B9\u5F0F\u3001\u81EA\u52A8\u63A2\u6D4B\u95F4\u9694\u3001\u5931\u8D25\u91CD\u8BD5\u4E0E\u81EA\u52A8\u5207\u6362\u3002\u6539\u5B8C\u70B9\u9876\u90E8\u300C\u4FDD\u5B58\u300D\u624D\u751F\u6548\u3002"));
  policy.appendChild(policySection());
  wrap.appendChild(policy);
  return wrap;
}
function isModelTrigger(button) {
  const aria = button.getAttribute("aria-label") ?? "";
  return /选择模型|Select model/i.test(aria);
}
function decorateTrigger(button) {
  if (!isModelTrigger(button)) return false;
  const cooldown = view?.cooldown;
  const parent = button.parentElement;
  if (parent === null) return false;
  const existing = parent.querySelector(`:scope > [${COOLDOWN_ATTR}]`);
  if (cooldown?.active !== true) {
    if (existing !== null) {
      existing.remove();
      return true;
    }
    return false;
  }
  const total = Math.max(0, Math.ceil(cooldown.remainingMs / 1e3));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  const text = `\u51B7 ${mm}:${ss}`;
  if (existing !== null && existing.getAttribute(BADGE_ATTR) === text) return false;
  if (existing !== null) existing.remove();
  const pill = makePill(text, `\u5168\u90E8\u6A21\u578B\u4E0D\u53EF\u7528\uFF0C\u51B7\u5374\u4E2D\uFF08${cooldown.reason || "\u65E0\u539F\u56E0\u8BB0\u5F55"}\uFF09`, "busy");
  pill.setAttribute(COOLDOWN_ATTR, "1");
  parent.appendChild(pill);
  return true;
}
function decorate(root) {
  if (view === null) return 0;
  let changed = 0;
  for (const node of Array.from(root.querySelectorAll("span[data-model-id][data-provider-id]"))) {
    if (decorateRow(node)) changed += 1;
  }
  for (const node of Array.from(root.querySelectorAll('button[aria-haspopup="menu"]'))) {
    const button = node;
    if (decorateTrigger(button)) changed += 1;
    if (isModelTrigger(button)) ensureSettingsButton(button);
  }
  return changed;
}
function scheduleDecorate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    decorate(document);
  });
}
function startObserver() {
  if (observer !== null) return;
  observer = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el2 = node;
        if (el2.hasAttribute?.(OWN_ATTR) === true) continue;
        relevant = true;
        break;
      }
      if (relevant) break;
    }
    if (relevant) scheduleDecorate();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
function openSettingsSection() {
  const panelOpen = () => document.querySelector(SETTINGS_PANEL_SEL) !== null;
  const wait = (ms) => new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
  const ariaOf = (node) => (node.getAttribute("aria-label") ?? "").trim();
  const own = (node) => node.hasAttribute(OWN_ATTR) || node.hasAttribute(SETTINGS_BTN_ATTR);
  const clickAndWait = async (nodes) => {
    for (const node of nodes) {
      node.click();
      for (let i = 0; i < 6; i += 1) {
        await wait(50);
        if (panelOpen()) return true;
      }
    }
    return false;
  };
  const directButtons = () => Array.from(document.querySelectorAll("button[aria-label]")).filter(
    (button) => !own(button) && SETTINGS_LAUNCHER_LABELS.includes(ariaOf(button))
  );
  const classButtons = () => Array.from(document.querySelectorAll("button")).filter(
    (button) => !own(button) && /_trigger$/u.test(button.className) && /triggerRow/u.test(button.parentElement?.className ?? "")
  );
  const viaAccountMenu = async () => {
    if (panelOpen()) return true;
    const triggers = Array.from(document.querySelectorAll("button[aria-label]")).filter(
      (button) => !own(button) && ACCOUNT_MENU_LABELS.includes(ariaOf(button))
    );
    if (triggers.length === 0) return false;
    triggers[0].click();
    for (let i = 0; i < 8; i += 1) {
      await wait(60);
      if (panelOpen()) return true;
      const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).filter((item) => {
        if (own(item)) return false;
        const labelNode = item.querySelector('[class*="_itemLabel"], span:last-of-type');
        const text = (labelNode?.textContent ?? item.textContent ?? "").trim();
        return SETTINGS_MENU_LABELS.some((label) => text.startsWith(label));
      });
      if (items.length === 0) continue;
      items[0].click();
      for (let j = 0; j < 6; j += 1) {
        await wait(50);
        if (panelOpen()) return true;
      }
      return false;
    }
    return false;
  };
  const selectNavItem = () => {
    const panel = document.querySelector(SETTINGS_PANEL_SEL);
    if (panel === null) return false;
    for (const row of Array.from(panel.querySelectorAll("button"))) {
      const label = row.querySelector("span");
      const text = (label?.textContent ?? row.textContent ?? "").trim();
      if (text !== SETTINGS_LABEL) continue;
      row.click();
      return true;
    }
    return false;
  };
  const selectNavWithRetry = async () => {
    if (selectNavItem()) return true;
    for (let i = 0; i < 10; i += 1) {
      await wait(60);
      if (selectNavItem()) return true;
    }
    return false;
  };
  const attempt = async () => {
    if (!panelOpen()) {
      const opened = await clickAndWait(directButtons()) || await clickAndWait(classButtons()) || await viaAccountMenu();
      if (!opened) {
        beacon({ phase: "settings-open-failed", step: "launcher-missing" });
        return;
      }
    }
    if (await selectNavWithRetry()) return;
    beacon({ phase: "settings-open-failed", step: "nav-item-missing" });
  };
  void attempt();
}
function ensureSettingsButton(trigger) {
  const parent = trigger.parentElement;
  if (parent === null) return;
  if (parent.querySelector(`:scope > button[${SETTINGS_BTN_ATTR}]`) !== null) return;
  parent.setAttribute(SETTINGS_ROW_ATTR, "1");
  parent.style.display = "flex";
  parent.style.alignItems = "center";
  parent.style.flexWrap = "nowrap";
  parent.style.minWidth = "0";
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(OWN_ATTR, "1");
  button.setAttribute(SETTINGS_BTN_ATTR, "1");
  button.setAttribute("aria-label", SETTINGS_BTN_LABEL);
  button.title = SETTINGS_BTN_LABEL;
  button.style.cssText = "display:inline-flex;align-items:center;justify-content:center;margin-left:4px;padding:0;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--dsh-color-text-tertiary, #9aa0a6);cursor:pointer;flex:0 0 auto;white-space:nowrap;line-height:0";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.3");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("aria-hidden", "true");
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("cx", "8");
  ring.setAttribute("cy", "8");
  ring.setAttribute("r", "2.1");
  icon.appendChild(ring);
  const spokes = document.createElementNS("http://www.w3.org/2000/svg", "path");
  spokes.setAttribute("d", "M8 1.7v1.4M8 12.9v1.4M1.7 8h1.4M12.9 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1");
  icon.appendChild(spokes);
  button.appendChild(icon);
  const hover = (on) => {
    button.style.background = on ? "var(--dsh-color-fill-quaternary, rgba(127,127,127,0.12))" : "transparent";
    button.style.color = on ? "var(--dsh-color-text-primary, #1b1d21)" : "var(--dsh-color-text-tertiary, #9aa0a6)";
  };
  button.addEventListener("mouseenter", () => hover(true));
  button.addEventListener("mouseleave", () => hover(false));
  button.addEventListener("focus", () => hover(true));
  button.addEventListener("blur", () => hover(false));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSettingsSection();
  });
  parent.insertBefore(button, trigger.nextSibling);
}
var SETTINGS_SLOT = "settings.section";
var SETTINGS_ID = "model-auto-select";
var SETTINGS_ORDER = 30;
var SETTINGS_LABEL = "\u6A21\u578B\u81EA\u52A8\u9009\u62E9";
function loadReact() {
  const req = typeof require === "function" ? require : null;
  if (req === null) return null;
  try {
    const mod = req("react");
    const React = mod && typeof mod.createElement === "function" ? mod : mod?.default;
    if (React === null || React === void 0) return null;
    if (typeof React.createElement !== "function" || typeof React.useRef !== "function" || typeof React.useEffect !== "function") {
      return null;
    }
    return React;
  } catch {
    return null;
  }
}
var MODEL_SLOT = "conversation.input.model";
function savedGroupIdOf(entry) {
  const rules = savedRules();
  for (const rule of rules) {
    if (rule.explicit) {
      if (rule.models.includes(`${entry.provider}/${entry.model}`) || rule.models.includes(entry.model)) return rule.id;
    } else if (rule.providers.length === 0 || rule.providers.includes(entry.provider)) {
      return rule.id;
    }
  }
  return "";
}
function menuGroups() {
  const entries = view?.entries ?? [];
  const hiddenList = Array.isArray(config?.config?.["hiddenModels"]) ? config?.config?.["hiddenModels"] : [];
  const unavailableKeys = new Set(view?.unavailableModels ?? []);
  const listed = entries.filter((entry) => !hiddenList.includes(`${entry.provider}/${entry.model}`) && entry.hidden !== true && entry.disabled !== true && !unavailableKeys.has(entry.key));
  const rules = savedRules();
  if (rules.length === 0) {
    const usable = listed.filter((entry) => entry.disabled !== true);
    const groups2 = [];
    for (const group of view?.groups ?? []) {
      const rows = group.keys.map((key) => usable.find((entry) => entry.key === key)).filter((entry) => entry !== void 0);
      if (rows.length > 0) groups2.push({ id: group.id, label: group.label, rows });
    }
    return groups2;
  }
  const groups = [];
  for (const rule of rules) {
    const rows = listed.filter((entry) => savedGroupIdOf(entry) === rule.id);
    if (rows.length > 0) groups.push({ id: rule.id, label: rule.label || rule.id, rows });
  }
  return groups;
}
var slotOpen = false;
var slotQuery = "";
var slotActive = -1;
var slotPanelRef = null;
var slotSelectRef = null;
var slotListenersAttached = false;
function applySlotOpen() {
  const panel = slotPanelRef;
  if (panel === null) return;
  panel.style.display = slotOpen ? "flex" : "none";
  if (slotOpen) fitSlotPanel();
}
var SLOT_PANEL_MAX = 380;
var SLOT_PANEL_MIN = 150;
var SLOT_PANEL_WIDTH = 340;
var SLOT_VIEWPORT_MARGIN = 8;
var SLOT_GAP = 6;
function nearestContainer(trigger) {
  let n = trigger.parentElement;
  while (n !== null) {
    const s = getComputedStyle(n);
    const oy = s.overflowY;
    const o = s.overflow;
    if (oy === "auto" || oy === "scroll" || o === "auto" || o === "scroll") {
      return { el: n, rect: n.getBoundingClientRect() };
    }
    if (oy === "hidden" || o === "hidden") return { el: n, rect: n.getBoundingClientRect() };
    n = n.parentElement;
  }
  const doc = document.documentElement;
  return { el: doc, rect: doc.getBoundingClientRect() };
}
function fitSlotPanel() {
  try {
    const panel = slotPanelRef;
    if (panel === null) return;
    const trigger = document.querySelector("[data-mas-slot-trigger]");
    if (trigger === null) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    if (vw <= 0) return;
    const tRect = trigger.getBoundingClientRect();
    const { rect: crect } = nearestContainer(trigger);
    const above = Math.max(0, tRect.top - crect.top - SLOT_VIEWPORT_MARGIN - SLOT_GAP);
    const below = Math.max(0, crect.bottom - tRect.bottom - SLOT_VIEWPORT_MARGIN - SLOT_GAP);
    const availRight = Math.max(0, crect.right - tRect.left - SLOT_VIEWPORT_MARGIN);
    const width = Math.max(200, Math.min(SLOT_PANEL_WIDTH, availRight, vw - SLOT_VIEWPORT_MARGIN * 2));
    panel.style.width = `${Math.round(width)}px`;
    const list = panel.querySelector("[data-mas-slot-list]");
    const searchBox = panel.querySelector("[data-mas-slot-searchbox]");
    const foot = panel.querySelector("[data-mas-slot-foot]");
    const wanted = Math.min(
      SLOT_PANEL_MAX,
      (list === null ? 0 : list.scrollHeight) + (searchBox === null ? 0 : searchBox.offsetHeight) + (foot === null ? 0 : foot.offsetHeight) + 12
    );
    const up = above >= Math.min(wanted, SLOT_PANEL_MIN) || above >= below;
    const room = Math.max(0, up ? above : below);
    panel.style.maxHeight = `${Math.round(Math.max(SLOT_PANEL_MIN, Math.min(SLOT_PANEL_MAX, room)))}px`;
    if (up) {
      panel.style.top = "auto";
      panel.style.bottom = `calc(100% + ${SLOT_GAP}px)`;
    } else {
      panel.style.bottom = "auto";
      panel.style.top = `calc(100% + ${SLOT_GAP}px)`;
    }
    panel.style.left = "0";
    const pRect = panel.getBoundingClientRect();
    let shift = 0;
    const overflowRight = pRect.right - (crect.right - SLOT_VIEWPORT_MARGIN);
    if (overflowRight > 0) shift -= overflowRight;
    const leftAfter = pRect.left + shift;
    if (leftAfter < crect.left + SLOT_VIEWPORT_MARGIN) shift += crect.left + SLOT_VIEWPORT_MARGIN - leftAfter;
    panel.style.left = `${Math.round(shift)}px`;
  } catch {
  }
}
var slotFocusPending = false;
var slotFocusTimer = null;
function focusSlotTrigger() {
  slotFocusPending = true;
  const trigger = document.querySelector("[data-mas-slot-trigger]");
  if (trigger !== null && typeof trigger.focus === "function") trigger.focus();
  if (typeof setTimeout !== "function") {
    slotFocusPending = false;
    return;
  }
  if (slotFocusTimer !== null) clearTimeout(slotFocusTimer);
  slotFocusTimer = setTimeout(() => {
    slotFocusTimer = null;
    slotFocusPending = false;
  }, 500);
}
function closeSlot(restoreFocus) {
  if (!slotOpen) return;
  slotOpen = false;
  slotQuery = "";
  slotActive = -1;
  applySlotOpen();
  if (restoreFocus) focusSlotTrigger();
}
function slotVisibleRows() {
  const panel = slotPanelRef;
  if (panel === null) return [];
  const out = [];
  for (const node of Array.from(panel.querySelectorAll("[data-mas-slot-row]"))) {
    if (node.style.display !== "none") out.push(node);
  }
  return out;
}
function applySlotNav() {
  const panel = slotPanelRef;
  if (panel === null) return;
  const visible = slotVisibleRows();
  for (const node of Array.from(panel.querySelectorAll("[data-mas-slot-row]"))) {
    const idx = visible.indexOf(node);
    const on = idx >= 0 && idx === slotActive;
    const selected = node.getAttribute("data-mas-selected") === "1";
    node.style.background = on ? TOK.hover : selected ? TOK.module : "transparent";
    node.style.outline = on ? `1px solid ${TOK.border}` : "none";
    node.style.outlineOffset = "-1px";
  }
  const search = panel.querySelector("[data-mas-slot-search]");
  const active = slotActive >= 0 && slotActive < visible.length ? visible[slotActive] : null;
  if (search !== null) {
    if (active !== null && active.id !== "") search.setAttribute("aria-activedescendant", active.id);
    else search.removeAttribute("aria-activedescendant");
  }
  if (active !== null && typeof active.scrollIntoView === "function") active.scrollIntoView({ block: "nearest" });
}
function slotEmptyText(needle, total) {
  if (needle !== "") {
    return total === 0 ? "\u8FD8\u6CA1\u6709\u53EF\u9009\u7684\u6A21\u578B\uFF1A\u5148\u5230\u300C\u6A21\u578B\u81EA\u52A8\u9009\u62E9\u300D\u8BBE\u7F6E\u9875\u53D6\u56DE\u6A21\u578B\u5217\u8868\uFF0C\u5E76\u628A\u6A21\u578B\u653E\u8FDB\u5206\u7EC4\u3002" : `\u6CA1\u6709\u5339\u914D\u300C${needle}\u300D\u7684\u6A21\u578B\u3002\u53EF\u4EE5\u641C\u6A21\u578B\u540D\u3001\u6765\u6E90\u540D\u6216 provider id\uFF0C\u4E5F\u53EF\u4EE5\u6E05\u7A7A\u641C\u7D22\u6846\u770B\u5168\u90E8\u3002`;
  }
  return savedRules().length === 0 ? "\u8FD8\u6CA1\u6709\u6A21\u578B\u76EE\u5F55\u6216\u5168\u90E8\u6A21\u578B\u90FD\u4E0D\u53EF\u7528\uFF1A\u5148\u5230\u300C\u6A21\u578B\u81EA\u52A8\u9009\u62E9\u300D\u8BBE\u7F6E\u9875\u53D6\u56DE\u6A21\u578B\u5217\u8868\u3002" : "\u6CA1\u6709\u4EFB\u4F55\u5DF2\u5165\u7EC4\u7684\u6A21\u578B\uFF1A\u5148\u5230\u300C\u6A21\u578B\u81EA\u52A8\u9009\u62E9\u300D\u8BBE\u7F6E\u9875\uFF0C\u628A\u6A21\u578B\u7528\u300C\u5165\u7EC4\u300D\u4E0B\u62C9\u653E\u8FDB\u5206\u7EC4\u3002";
}
function applySlotFilter() {
  const panel = slotPanelRef;
  if (panel === null) return;
  const needle = slotQuery.trim().toLowerCase();
  const rows = Array.from(panel.querySelectorAll("[data-mas-slot-row]"));
  let matches = 0;
  for (const row of rows) {
    const hay = (row.getAttribute("data-mas-name") ?? "").toLowerCase();
    const hit = needle === "" || hay.includes(needle);
    row.style.display = hit ? "flex" : "none";
    if (hit) matches += 1;
  }
  for (const group of Array.from(panel.querySelectorAll("[data-mas-slot-group]"))) {
    const any = Array.from(group.querySelectorAll("[data-mas-slot-row]")).some(
      (node) => node.style.display !== "none"
    );
    group.style.display = any ? "flex" : "none";
  }
  slotActive = matches === 0 ? -1 : slotActive < 0 || slotActive >= matches ? 0 : slotActive;
  const count = panel.querySelector("[data-mas-slot-count]");
  if (count !== null) count.textContent = needle === "" ? `${matches} \u4E2A\u6A21\u578B` : `${matches} / ${rows.length} \u4E2A\u6A21\u578B`;
  const empty = panel.querySelector("[data-mas-slot-empty]");
  if (empty !== null) {
    empty.style.display = matches === 0 ? "block" : "none";
    if (matches === 0) empty.textContent = slotEmptyText(needle, rows.length);
  }
  applySlotNav();
  fitSlotPanel();
}
function refreshSlotPanel() {
  slotQuery = "";
  slotActive = -1;
  const panel = slotPanelRef;
  if (panel !== null) {
    const search = panel.querySelector("[data-mas-slot-search]");
    if (search !== null) {
      search.value = "";
      search.focus();
    }
  }
  applySlotFilter();
}
function scheduleSlotRefresh() {
  if (typeof setTimeout !== "function") return;
  setTimeout(() => {
    if (slotOpen) refreshSlotPanel();
  }, 0);
}
function reapplySlotPanel() {
  if (typeof setTimeout !== "function") return;
  setTimeout(() => {
    try {
      if (!slotOpen) return;
      applySlotFilter();
      const panel = slotPanelRef;
      const search = panel?.querySelector("[data-mas-slot-search]");
      if (search !== null) {
        search.value = slotQuery;
        if (document.activeElement !== search) search.focus();
      }
    } catch {
    }
  }, 0);
}
function moveSlotActive(delta) {
  const visible = slotVisibleRows();
  if (visible.length === 0) {
    slotActive = -1;
    applySlotNav();
    return;
  }
  const next = slotActive < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, slotActive + delta));
  slotActive = next;
  applySlotNav();
}
function activeSlotRow() {
  const visible = slotVisibleRows();
  return slotActive >= 0 && slotActive < visible.length ? visible[slotActive] : null;
}
var KEY_SEP = String.fromCharCode(0);
var sessionStores = /* @__PURE__ */ new Map();
function sessionDirectory(sessionId) {
  const existing = sessionStores.get(sessionId);
  if (existing !== void 0) return existing;
  const watchers = /* @__PURE__ */ new Set();
  const store = {
    subscribe: (fn) => {
      watchers.add(fn);
      directoryWatchers.add(fn);
      return () => {
        watchers.delete(fn);
        directoryWatchers.delete(fn);
      };
    },
    getSnapshot: () => {
      const state = (view?.sessions ?? []).find((row) => row.sessionId === sessionId);
      return { current: currentSelectionOf(state?.current ?? null), status: "ready", pending: null, groups: [], failures: [] };
    }
  };
  sessionStores.set(sessionId, store);
  return store;
}
function currentSelectionOf(key) {
  if (key === null || key === "") return null;
  const at = key.indexOf(KEY_SEP);
  if (at < 0) return null;
  return { provider: key.slice(0, at), model: key.slice(at + 1) };
}
async function selectViaRoute(sessionId, selection) {
  const provider = String(selection?.provider ?? "");
  const model = String(selection?.model ?? "");
  if (provider === "" || model === "") return;
  try {
    const response = await fetch(apiUrl("select"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, provider, model })
    });
    if (!response.ok) {
      const detail = await response.text();
      statusKind = "error";
      statusText = `\u5207\u6362\u6A21\u578B\u5931\u8D25\uFF1AHTTP ${response.status} ${detail.slice(0, 120)}`;
      notify();
      return;
    }
    statusKind = "ok";
    statusText = `\u5DF2\u5207\u6362\u5230 ${provider}/${model}`;
    notify();
    void loadCatalog();
  } catch (err) {
    statusKind = "error";
    statusText = `\u5207\u6362\u6A21\u578B\u5931\u8D25\uFF1A${String(err?.message ?? err)}`;
    notify();
  }
}
async function runProbe(provider, model) {
  try {
    const response = await fetch(apiUrl("test-model"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        ms: Number(payload?.ms) || 0,
        error: String(payload?.error ?? "HTTP " + response.status),
        ...payload?.kind === "model" || payload?.kind === "infra" ? { kind: payload.kind } : {}
      };
    }
    return {
      ok: true,
      ms: Number(payload.ms) || 0,
      ...payload.sample === void 0 ? {} : { sample: String(payload.sample) }
    };
  } catch (err) {
    return { ok: false, ms: 0, error: String(err?.message ?? err) };
  }
}
async function testModelViaRoute(provider, model, button) {
  button.disabled = true;
  button.textContent = "\u6D4B\u8BD5\u4E2D\u2026";
  const result = await runProbe(provider, model);
  probeResults.set(probeKey(provider, model), result);
  applyProbeResult(button, result);
  button.disabled = false;
  repaintProbeButtons();
}
var GROUP_PROBE_CONCURRENCY = 4;
async function testGroupViaRoute(list, button) {
  if (list.length === 0) return;
  button.disabled = true;
  const total = list.length;
  let done = 0;
  let okCount = 0;
  const queue = list.slice();
  button.textContent = "\u6D4B\u8BD5\u4E2D 0/" + total;
  const worker = async () => {
    for (; ; ) {
      const entry = queue.shift();
      if (entry === void 0) return;
      const result = await runProbe(entry.provider, entry.model);
      probeResults.set(probeKey(entry.provider, entry.model), result);
      if (result.ok) okCount += 1;
      done += 1;
      button.textContent = "\u6D4B\u8BD5\u4E2D " + done + "/" + total;
      repaintProbeButtons();
    }
  };
  await Promise.all(Array.from({ length: Math.min(GROUP_PROBE_CONCURRENCY, total) }, () => worker()));
  const failCount = total - okCount;
  button.textContent = "\u2713" + okCount + " \u2717" + failCount;
  button.title = "\u672C\u7EC4 " + total + " \u4E2A\u6A21\u578B\u6D4B\u8BD5\u5B8C\u6210\uFF1A\u901A\u8FC7 " + okCount + "\uFF0C\u5931\u8D25 " + failCount + "\uFF08\u63A2\u6D4B\u5931\u8D25=\u4F20\u8F93/\u73AF\u5883\u6545\u969C\uFF0C\u6A21\u578B\u4ECD\u5728\u4E0B\u62C9\u53EF\u6B63\u5E38\u9009\u62E9\uFF1B\u4E0D\u53EF\u8C03=\u6A21\u578B\u7EA7\u6545\u969C\uFF0C\u5DF2\u4ECE\u4E0B\u62C9\u79FB\u9664\uFF09";
  button.style.color = failCount === 0 ? "#4a9d5b" : okCount === 0 ? "#d9534f" : TOK.warn;
  button.disabled = false;
  repaintProbeButtons();
}
function currentLabel(current) {
  if (current === null || current === void 0) return "\u9009\u62E9\u6A21\u578B";
  const entry = entryOf(String(current.provider ?? ""), String(current.model ?? ""));
  return entry?.name ?? String(current.model ?? "\u9009\u62E9\u6A21\u578B");
}
function pillNode(React, text, title, tone) {
  const color = tone === "running" || tone === "free" ? TOK.ok : tone === "busy" ? TOK.warn : TOK.tertiary;
  return React.createElement(
    "span",
    {
      key: `p-${text}`,
      title,
      style: {
        flex: "0 0 auto",
        fontSize: "11px",
        lineHeight: "16px",
        padding: "0 4px",
        borderRadius: "4px",
        color,
        background: TOK.module
      }
    },
    text
  );
}
function sourceChip(React, row) {
  const label = row.providerName !== "" ? row.providerName : row.provider;
  return React.createElement(
    "span",
    {
      key: `s-${row.key}`,
      "data-mas-provider": row.provider,
      title: `\u6765\u6E90\uFF1A${label}\uFF08provider id\uFF1A${row.provider}\uFF09`,
      style: {
        flex: "0 0 auto",
        maxWidth: "84px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: "11px",
        lineHeight: "16px",
        padding: "0 5px",
        borderRadius: "4px",
        color: TOK.secondary,
        background: TOK.module,
        border: `0.5px solid ${TOK.border}`
      }
    },
    label
  );
}
function splitModelName(name) {
  const hit = /^(.*?)\s*·\s*(x\s*[0-9]+(?:\.[0-9]+)?)$/.exec(name);
  if (hit === null) return { base: name, price: null };
  return { base: hit[1], price: hit[2].replace(/\s+/g, "") };
}
function rowHaystack(row) {
  return `${row.name} ${row.providerName} ${row.provider} ${row.model}`.toLowerCase();
}
function formatContext(n) {
  if (n >= 1e3) {
    const k = n / 1e3;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(n);
}
function registerModelSelectSlot(ctx) {
  const slots = ctx?.slots;
  if (slots === void 0 || slots === null) return false;
  if (typeof slots.inject !== "function" || typeof slots.register !== "function") return false;
  const React = loadReact();
  if (React === null) return false;
  if (typeof React.useState !== "function") return false;
  const { useState, useEffect, useRef, createElement } = React;
  function usePluginTick() {
    const [tick, setTick] = useState(0);
    useEffect(() => {
      const bump = () => setTick((n) => n + 1);
      listeners.add(bump);
      if (view === null) void loadCatalog();
      if (config === null) void loadConfig();
      return () => {
        listeners.delete(bump);
      };
    }, []);
    return tick;
  }
  function useDirectory(directory) {
    const [state, setState] = useState(() => directory === void 0 ? null : directory.getSnapshot?.() ?? null);
    useEffect(() => {
      if (directory === void 0) {
        setState(null);
        return void 0;
      }
      const read = () => setState(directory.getSnapshot?.() ?? null);
      read();
      return directory.subscribe(read);
    }, [directory]);
    return state;
  }
  function ModelAutoSelectTrigger(props) {
    usePluginTick();
    const directory = props?.directory;
    const state = useDirectory(directory);
    const locked = props?.locked === true;
    const available = props?.available !== false;
    const groups = slotOpen ? menuGroups() : [];
    const needle = slotQuery.trim().toLowerCase();
    const shown = groups.map((group) => ({
      ...group,
      rows: needle === "" ? group.rows : group.rows.filter((row) => rowHaystack(row).includes(needle))
    })).filter((group) => group.rows.length > 0);
    const totalRows = shown.reduce((sum, group) => sum + group.rows.length, 0);
    slotSelectRef = (provider, model) => {
      if (typeof props?.select === "function") {
        const result = props.select({ provider, model });
        if (result !== void 0 && typeof result.catch === "function") result.catch(() => void 0);
      }
      slotOpen = false;
      slotQuery = "";
      slotActive = -1;
      applySlotOpen();
      notify();
      focusSlotTrigger();
    };
    const choose = (entry) => {
      if (slotSelectRef !== null) slotSelectRef(entry.provider, entry.model);
    };
    const current = state?.current;
    const currentEntry = current === null || current === void 0 ? void 0 : entryOf(String(current.provider ?? ""), String(current.model ?? ""));
    const button = createElement(
      "button",
      {
        type: "button",
        // 重绘后若还欠一次「焦点还给触发按钮」，由新节点自己补上
        ref: (node) => {
          if (node === null || node === void 0) return;
          if (!slotFocusPending || slotOpen) return;
          if (typeof node.focus === "function") node.focus();
        },
        "data-mas-slot-trigger": "1",
        "data-mas-session": props?.sessionId ?? "",
        "aria-label": `\u9009\u62E9\u6A21\u578B\uFF0C\u5F53\u524D ${currentLabel(current)}${currentEntry === void 0 ? "" : `\uFF0C\u6765\u6E90 ${currentEntry.providerName}`}`,
        "aria-haspopup": "listbox",
        "aria-expanded": slotOpen,
        title: currentEntry === void 0 ? "\u9009\u62E9\u6A21\u578B" : `${currentEntry.name} \xB7 \u6765\u6E90 ${currentEntry.providerName}`,
        disabled: locked || !available,
        onClick: () => {
          slotOpen = !slotOpen;
          if (!slotOpen) {
            slotQuery = "";
            slotActive = -1;
          }
          applySlotOpen();
          notify();
          if (slotOpen) scheduleSlotRefresh();
        },
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          maxWidth: "240px",
          height: "28px",
          padding: "0 8px",
          border: "none",
          borderRadius: TOK.radius,
          background: TOK.module,
          color: TOK.primary,
          font: "inherit",
          fontSize: "13px",
          cursor: locked || !available ? "not-allowed" : "pointer",
          opacity: locked || !available ? 0.5 : 1
        }
      },
      createElement(
        "span",
        { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: "0" } },
        currentLabel(current)
      ),
      createElement("span", { style: { color: TOK.tertiary, fontSize: "11px" }, "aria-hidden": "true" }, "\u25BE")
    );
    const rows = shown.map(
      (group) => createElement(
        "div",
        {
          key: `g-${group.id}`,
          "data-mas-slot-group": group.id,
          style: { display: "flex", flexDirection: "column" }
        },
        createElement(
          "div",
          {
            style: {
              position: "sticky",
              top: "0",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 8px 4px",
              fontSize: "11px",
              color: TOK.tertiary,
              background: TOK.layer,
              borderBottom: `0.5px solid ${TOK.border}`
            }
          },
          group.label,
          createElement(
            "span",
            { "data-mas-group-count": "1", style: { marginLeft: "auto", fontSize: "11px", color: TOK.tertiary } },
            `${group.rows.length}`
          )
        ),
        group.rows.map((row) => {
          const selected = current?.provider === row.provider && current?.model === row.model;
          const parts = splitModelName(row.name);
          const pills = [];
          if (row.free) {
            pills.push(
              pillNode(React, view?.config?.freeBadgeLabel ?? "\u514D", "\u9650\u514D\u6A21\u578B\uFF1A\u8BA1\u4EF7\u7CFB\u6570 x0.00\uFF080 = \u9650\u65F6\u514D\u8D39\uFF09", "free")
            );
          } else if (row.priceFactor !== void 0) {
            pills.push(
              pillNode(
                React,
                `x${row.priceFactor.toFixed(2)}`,
                `\u8BA1\u4EF7\u7CFB\u6570 x${row.priceFactor.toFixed(2)}\uFF08\u6765\u81EA\u6A21\u578B\u540D\u540E\u7F00\uFF0C\u975E llm \u670D\u52A1\u5B57\u6BB5\uFF09`,
                "price"
              )
            );
          } else if (parts.price !== null) {
            pills.push(pillNode(React, parts.price, "\u8BA1\u4EF7\u7CFB\u6570\uFF08\u6765\u81EA\u6A21\u578B\u540D\u540E\u7F00\uFF09", "price"));
          }
          if (row.contextWindow !== void 0) {
            pills.push(
              pillNode(
                React,
                formatContext(row.contextWindow),
                `\u4E0A\u4E0B\u6587\u7A97\u53E3\uFF1A${row.contextWindow.toLocaleString("en-US")} tokens\uFF08\u5BBF\u4E3B llm \u670D\u52A1\u62AB\u9732\uFF0Ccombined request+response \u4E0A\u9650\uFF0C\u672A\u62AB\u9732\u5219\u4E0D\u663E\u793A\uFF09`,
                "meta"
              )
            );
          }
          return createElement(
            "button",
            {
              key: row.key,
              id: `mas-slot-opt-${row.key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
              type: "button",
              role: "option",
              "data-mas-slot-row": `${row.provider}/${row.model}`,
              "data-mas-slot-key": row.key,
              "data-mas-name": rowHaystack(row),
              "data-mas-provider": row.provider,
              "data-mas-selected": selected ? "1" : "0",
              "aria-selected": selected,
              "aria-checked": selected,
              title: `${parts.base} \xB7 \u6765\u6E90 ${row.providerName}${parts.price === null ? "" : ` \xB7 \u8BA1\u4EF7 ${parts.price}`}`,
              onClick: () => choose(row),
              onMouseEnter: (event) => {
                const visible = slotVisibleRows();
                const idx = visible.indexOf(event.currentTarget);
                if (idx >= 0 && idx !== slotActive) {
                  slotActive = idx;
                  applySlotNav();
                }
              },
              style: {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                width: "100%",
                height: "30px",
                padding: "0 6px 0 4px",
                border: "none",
                borderRadius: "6px",
                background: selected ? TOK.module : "transparent",
                boxShadow: selected ? `inset 2px 0 0 ${TOK.primary}` : "none",
                color: TOK.primary,
                font: "inherit",
                fontSize: "13px",
                cursor: "pointer",
                textAlign: "left"
              }
            },
            createElement(
              "span",
              {
                "aria-hidden": "true",
                title: row.modalities.join("\u3001"),
                style: {
                  flex: "0 0 auto",
                  width: "14px",
                  textAlign: "center",
                  fontSize: "10px",
                  color: TOK.tertiary
                }
              },
              row.kind === "multimodal" ? "\u56FE" : "\u6587"
            ),
            createElement(
              "span",
              {
                style: {
                  flex: "1 1 auto",
                  minWidth: "0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }
              },
              parts.base
            ),
            sourceChip(React, row),
            ...pills
          );
        })
      )
    );
    const empty = createElement(
      "div",
      {
        "data-mas-slot-empty": "1",
        style: {
          display: shown.length === 0 ? "block" : "none",
          padding: "14px 10px",
          fontSize: "12px",
          lineHeight: "18px",
          color: TOK.tertiary
        }
      },
      savedRules().length === 0 ? "\u8FD8\u6CA1\u6709\u6A21\u578B\u76EE\u5F55\u6216\u5168\u90E8\u6A21\u578B\u90FD\u4E0D\u53EF\u7528\uFF1A\u5148\u5230\u300C\u6A21\u578B\u81EA\u52A8\u9009\u62E9\u300D\u8BBE\u7F6E\u9875\u53D6\u56DE\u6A21\u578B\u5217\u8868\u3002" : "\u6CA1\u6709\u4EFB\u4F55\u5DF2\u5165\u7EC4\u7684\u6A21\u578B\uFF1A\u5148\u5230\u300C\u6A21\u578B\u81EA\u52A8\u9009\u62E9\u300D\u8BBE\u7F6E\u9875\uFF0C\u628A\u6A21\u578B\u7528\u300C\u5165\u7EC4\u300D\u4E0B\u62C9\u653E\u8FDB\u5206\u7EC4\u3002"
    );
    const searchBox = createElement(
      "div",
      {
        "data-mas-slot-searchbox": "1",
        style: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          margin: "4px",
          padding: "0 8px",
          height: "30px",
          border: `0.5px solid ${TOK.border}`,
          borderRadius: "6px",
          background: TOK.module
        }
      },
      createElement("span", {
        "aria-hidden": "true",
        style: {
          flex: "0 0 auto",
          width: "9px",
          height: "9px",
          border: `1.5px solid ${TOK.tertiary}`,
          borderRadius: "50%"
        }
      }),
      createElement("span", {
        "aria-hidden": "true",
        style: {
          flex: "0 0 auto",
          width: "5px",
          height: "1.5px",
          background: TOK.tertiary,
          transform: "rotate(45deg)",
          marginLeft: "-3px"
        }
      }),
      createElement("input", {
        type: "search",
        "data-mas-slot-search": "1",
        role: "combobox",
        "aria-label": "\u641C\u7D22\u6A21\u578B\u540D\u3001\u6765\u6E90\u6216 provider id",
        "aria-autocomplete": "list",
        "aria-expanded": slotOpen,
        "aria-controls": "mas-slot-listbox",
        value: slotQuery,
        placeholder: "\u641C\u7D22\u6A21\u578B\u540D / \u6765\u6E90",
        onInput: (event) => {
          slotQuery = String(event.target.value ?? "");
          applySlotFilter();
        },
        style: {
          flex: "1 1 auto",
          minWidth: "0",
          height: "26px",
          padding: "0",
          border: "none",
          background: "transparent",
          color: TOK.primary,
          font: "inherit",
          fontSize: "12px",
          outline: "none"
        }
      })
    );
    const list = createElement(
      "div",
      {
        id: "mas-slot-listbox",
        "data-mas-slot-list": "1",
        role: "listbox",
        "aria-label": "\u6A21\u578B\u5217\u8868",
        style: {
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          minHeight: "0",
          overflowY: "auto",
          padding: "0 2px"
        }
      },
      empty,
      ...rows
    );
    const foot = createElement(
      "div",
      {
        "data-mas-slot-foot": "1",
        style: {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 8px 2px",
          marginTop: "4px",
          borderTop: `0.5px solid ${TOK.border}`
        }
      },
      createElement(
        "span",
        {
          style: {
            flex: "1 1 auto",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "11px",
            color: TOK.tertiary
          }
        },
        "\u2191\u2193 \u9009\u62E9 \xB7 \u21B5 \u786E\u8BA4 \xB7 Esc \u5173\u95ED"
      ),
      createElement(
        "span",
        {
          "data-mas-slot-count": "1",
          style: { flex: "0 0 auto", fontSize: "11px", color: TOK.tertiary }
        },
        `${totalRows} \u4E2A\u6A21\u578B`
      )
    );
    const panel = createElement(
      "div",
      {
        ref: (node) => {
          slotPanelRef = node ?? null;
          if (node !== null && node !== void 0) {
            node.style.display = slotOpen ? "flex" : "none";
            if (slotOpen) fitSlotPanel();
          }
        },
        "data-mas-slot-menu": "1",
        style: {
          position: "absolute",
          // 不在这里写死宽高/上下/左右：每次重渲染 React 会把它们重置回去，
          // 与 fitSlotPanel 的容器感知计算打架。尺寸与定位完全交给 fitSlotPanel。
          zIndex: 3,
          display: slotOpen ? "flex" : "none",
          flexDirection: "column",
          maxWidth: "100vw",
          boxSizing: "border-box",
          padding: "4px",
          overflow: "hidden",
          borderRadius: TOK.radius,
          border: `0.5px solid ${TOK.border}`,
          background: TOK.layer,
          boxShadow: "0 12px 28px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)"
        }
      },
      searchBox,
      list,
      foot
    );
    return createElement("div", { style: { position: "relative", display: "inline-flex" } }, button, panel);
  }
  if (!slotListenersAttached) {
    slotListenersAttached = true;
    const onViewportChange = () => {
      if (slotOpen) fitSlotPanel();
    };
    window.addEventListener("resize", onViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onViewportChange);
      window.visualViewport.addEventListener("scroll", onViewportChange);
    }
    document.addEventListener("scroll", onViewportChange, true);
  }
  document.addEventListener(
    "mousedown",
    (event) => {
      if (!slotOpen) return;
      const panel = slotPanelRef;
      if (panel !== null && panel !== void 0 && typeof panel.contains === "function" && panel.contains(event.target)) return;
      const trigger = document.querySelector("[data-mas-slot-trigger]");
      if (trigger !== null && trigger.contains(event.target)) return;
      closeSlot(false);
    },
    true
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!slotOpen) return;
      const key = String(event.key ?? "");
      if (key === "Escape") {
        event.preventDefault();
        closeSlot(true);
        return;
      }
      const panel = slotPanelRef;
      const inside = panel !== null && panel !== void 0 && typeof panel.contains === "function" && panel.contains(event.target);
      if (!inside) return;
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
        event.preventDefault();
        if (key === "ArrowDown") moveSlotActive(1);
        else if (key === "ArrowUp") moveSlotActive(-1);
        else {
          const visible = slotVisibleRows();
          slotActive = key === "Home" ? visible.length === 0 ? -1 : 0 : visible.length - 1;
          applySlotNav();
        }
        return;
      }
      if (key === "Enter") {
        const row = activeSlotRow();
        if (row === null) return;
        event.preventDefault();
        const composite = row.getAttribute("data-mas-slot-key") ?? "";
        const at = composite.indexOf(KEY_SEP);
        if (at < 0 || slotSelectRef === null) return;
        slotSelectRef(composite.slice(0, at), composite.slice(at + 1));
      }
    },
    true
  );
  slots.inject(
    MODEL_SLOT,
    () => slots.register(
      {
        name: MODEL_SLOT,
        // 宿主在 priority 0 注册；single 槽同 priority 会直接抛错，必须给更小的值才能 shadow
        // （宿主文档原文：register at a different priority to shadow it, lowest renders）。
        priority: -1,
        // 不用宿主 `modelDirectories`：动态门面按 inject 声明做服务门禁，而 `directoryFor()`
        // 内部还要读 `remote.session`，实测会抛 `cannot get property "remote.session" without inject`。
        // 所以这里自带一个轻量 store（当前模型来自插件自己的会话状态），选模型走插件 /select 路由。
        inject: (sessionId) => ({
          available: true,
          sessionId,
          directory: sessionDirectory(sessionId),
          load: () => {
            void loadCatalog();
          },
          select: (selection) => selectViaRoute(sessionId, selection)
        })
      },
      ModelAutoSelectTrigger
    )
  );
  return true;
}
function mountSettingsForm(host) {
  let lastSignature = null;
  const render = () => {
    const signature = `${config === null ? "\u2205" : JSON.stringify(config.config)}#${view === null ? "\u2205" : `${view.entries.length}:${(view.groups ?? []).map((g) => g.id).join(",")}`}#${draft === null ? "\u2205" : JSON.stringify(draft)}#${modelFilter}:${modelsExpanded}:${advancedOpen}#${statusKind}:${statusText}`;
    if (signature === lastSignature && host.childElementCount > 0) return;
    lastSignature = signature;
    host.textContent = "";
    host.appendChild(buildSettingsForm());
  };
  listeners.add(render);
  render();
  if (config === null) void loadConfig();
  if (view === null) void loadCatalog();
  return () => {
    listeners.delete(render);
  };
}
function registerSettingsSection(ctx) {
  const slots = ctx?.slots;
  if (slots === void 0 || slots === null) return false;
  if (typeof slots.inject !== "function" || typeof slots.register !== "function") return false;
  const React = loadReact();
  if (React === null) return false;
  slots.inject(
    SETTINGS_SLOT,
    () => slots.register(
      {
        name: SETTINGS_SLOT,
        id: SETTINGS_ID,
        order: SETTINGS_ORDER,
        label: () => SETTINGS_LABEL
      },
      function ModelAutoSelectSection() {
        const ref = React.useRef(null);
        React.useEffect(() => {
          const host = ref.current;
          if (host === null || host === void 0) return void 0;
          const unmount = mountSettingsForm(host);
          return () => {
            unmount();
            host.textContent = "";
          };
        }, []);
        return React.createElement("div", { ref, style: { padding: "16px 20px 24px" } });
      }
    )
  );
  return true;
}
function apply(ctx) {
  if (started) return;
  started = true;
  void loadCatalog();
  void loadConfig();
  startObserver();
  scheduleDecorate();
  registerSettingsSection(ctx);
  try {
    if (!registerModelSelectSlot(ctx)) beacon({ phase: "slot-register-skipped", step: "model-select" });
  } catch (err) {
    beacon({ phase: "slot-register-failed", step: "model-select", note: String(err?.message ?? err).slice(0, 300) });
  }
  pollTimer = setInterval(() => {
    void loadCatalog();
  }, POLL_MS);
  window.addEventListener("focus", () => {
    void loadCatalog();
  }, { passive: true });
  beacon({ phase: "mounted", build: BUILD });
}
function snapshot() {
  return { build: BUILD, view, viewError, config, statusText };
}
return module.exports; } });
