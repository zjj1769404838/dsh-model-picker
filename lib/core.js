// src/core.ts
var PLUGIN_NAME = "@zjjlivingfree/dsh-model-picker";
var PLUGIN_VERSION = "0.1.8";
var SWITCH_SCOPE_VALUES = ["all", "group", "group-cross"];
function normalizeSwitchScope(value) {
  return typeof value === "string" && SWITCH_SCOPE_VALUES.includes(value) ? value : DEFAULT_CONFIG.switchScope;
}
var GROUP_MODE_VALUES = ["manual", "auto"];
function normalizeGroupMode(value) {
  return typeof value === "string" && GROUP_MODE_VALUES.includes(value) ? value : "manual";
}
var DEFAULT_CONFIG = Object.freeze({
  defaultModel: null,
  maxRetries: 2,
  retryDelayMs: 800,
  providerOrder: [],
  modelOrder: [],
  preferIdle: true,
  cooldownMs: 30 * 60 * 1e3,
  cooldownRefreshBlocked: true,
  catalogTtlMs: 6e4,
  occupancyRefreshMs: 5e3,
  switchOnCodes: [],
  requestRetryEnabled: true,
  requestRetryMax: 3,
  requestRetryBackoffMs: [2e3, 5e3, 1e4],
  crossClassFallback: false,
  enabled: true,
  disabledModels: [],
  disabledGroups: [],
  hiddenModels: [],
  hiddenGroups: [],
  freeBadgeLabel: "\u514D",
  groupByKind: true,
  customGroups: [],
  groupMode: "manual",
  probeIntervalMin: 0,
  // 组内优先、组内耗尽才跨组兜底：既不会一上来就在全量池子里乱跳，也不会因为组太小而卡死。
  switchScope: "group-cross",
  modelEfforts: []
});
function nonNegativeInt(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}
function stringList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) if (typeof item === "string" && item.length > 0) out.push(item);
  return out;
}
function isEmptyGroup(group) {
  if (group.explicit === true) return false;
  return group.kind === null && group.providers.length === 0 && group.models.length === 0 && !group.freeOnly;
}
function normalizeCustomGroups(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const raw = item;
    const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : "";
    if (id === "" || seen.has(id)) continue;
    const kind = raw.kind === "text" || raw.kind === "multimodal" ? raw.kind : null;
    const normalized = {
      id,
      label: typeof raw.label === "string" ? raw.label.trim() : "",
      kind,
      providers: stringList(raw.providers),
      models: stringList(raw.models),
      freeOnly: raw.freeOnly === true,
      explicit: raw.explicit === true
    };
    if (isEmptyGroup(normalized)) continue;
    seen.add(id);
    out.push(normalized);
  }
  return out;
}
function normalizeModelEfforts(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const raw = item;
    if (typeof raw.key !== "string" || typeof raw.effort !== "string") continue;
    const key = raw.key.trim();
    if (key.length === 0 || raw.effort.trim().length === 0) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, effort: raw.effort.trim() });
  }
  return out;
}
function resolveConfig(raw) {
  const input = raw !== null && typeof raw === "object" ? raw : {};
  const dm = input.defaultModel;
  const defaultModel = dm !== null && typeof dm === "object" && typeof dm.provider === "string" && typeof dm.model === "string" && dm.provider.length > 0 && dm.model.length > 0 ? {
    provider: dm.provider,
    model: dm.model,
    ...typeof dm.reasoningEffort === "string" && dm.reasoningEffort.length > 0 ? { reasoningEffort: dm.reasoningEffort } : {}
  } : null;
  return {
    defaultModel,
    maxRetries: nonNegativeInt(input.maxRetries, DEFAULT_CONFIG.maxRetries),
    retryDelayMs: nonNegativeInt(input.retryDelayMs, DEFAULT_CONFIG.retryDelayMs),
    providerOrder: stringList(input.providerOrder),
    modelOrder: stringList(input.modelOrder),
    preferIdle: input.preferIdle === void 0 ? DEFAULT_CONFIG.preferIdle : input.preferIdle !== false,
    cooldownMs: nonNegativeInt(input.cooldownMs, DEFAULT_CONFIG.cooldownMs) || DEFAULT_CONFIG.cooldownMs,
    cooldownRefreshBlocked: input.cooldownRefreshBlocked === void 0 ? DEFAULT_CONFIG.cooldownRefreshBlocked : input.cooldownRefreshBlocked !== false,
    catalogTtlMs: nonNegativeInt(input.catalogTtlMs, DEFAULT_CONFIG.catalogTtlMs) || DEFAULT_CONFIG.catalogTtlMs,
    occupancyRefreshMs: nonNegativeInt(input.occupancyRefreshMs, DEFAULT_CONFIG.occupancyRefreshMs) || DEFAULT_CONFIG.occupancyRefreshMs,
    switchOnCodes: stringList(input.switchOnCodes),
    crossClassFallback: input.crossClassFallback === true,
    enabled: input.enabled === void 0 ? DEFAULT_CONFIG.enabled : input.enabled !== false,
    disabledModels: stringList(input.disabledModels),
    disabledGroups: stringList(input.disabledGroups),
    hiddenModels: stringList(input.hiddenModels),
    hiddenGroups: stringList(input.hiddenGroups),
    freeBadgeLabel: typeof input.freeBadgeLabel === "string" && input.freeBadgeLabel.trim().length > 0 ? input.freeBadgeLabel.trim() : DEFAULT_CONFIG.freeBadgeLabel,
    groupByKind: input.groupByKind === void 0 ? DEFAULT_CONFIG.groupByKind : input.groupByKind !== false,
    customGroups: normalizeCustomGroups(input.customGroups),
    groupMode: normalizeGroupMode(input.groupMode),
    probeIntervalMin: nonNegativeInt(input.probeIntervalMin, DEFAULT_CONFIG.probeIntervalMin),
    switchScope: input.switchScope === void 0 ? DEFAULT_CONFIG.switchScope : normalizeSwitchScope(input.switchScope),
    modelEfforts: normalizeModelEfforts(input.modelEfforts),
    requestRetryEnabled: input.requestRetryEnabled === void 0 ? DEFAULT_CONFIG.requestRetryEnabled : input.requestRetryEnabled !== false,
    requestRetryMax: nonNegativeInt(input.requestRetryMax, DEFAULT_CONFIG.requestRetryMax),
    requestRetryBackoffMs: Array.isArray(input.requestRetryBackoffMs) ? input.requestRetryBackoffMs : DEFAULT_CONFIG.requestRetryBackoffMs
  };
}
function modelKey(provider, model) {
  return `${provider}\0${model}`;
}
function splitKey(key) {
  const at = key.indexOf("\0");
  if (at < 0) return { provider: key, model: "" };
  return { provider: key.slice(0, at), model: key.slice(at + 1) };
}
var MULTIMODAL_MODALITIES = /* @__PURE__ */ new Set(["image", "audio", "video"]);
function normalizeModalities(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (id.length === 0 || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
function classify(modalities) {
  for (const id of modalities) if (MULTIMODAL_MODALITIES.has(id)) return "multimodal";
  return "text";
}
function priceFactorOf(name) {
  const match = /[·・\s]\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(name);
  if (match === null) return void 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : void 0;
}
function isFreeName(name) {
  return priceFactorOf(name) === 0;
}
function priceClassOf(name, priceFactor) {
  if (priceFactor === 0 || /免费|free\s*now/i.test(name)) return "free";
  if (typeof priceFactor === "number" && priceFactor > 0 || /[·・\s]\s*x\s*\d/i.test(name)) return "paid";
  return "unknown";
}
function isDisabled(provider, model, cfg, groups = []) {
  const key = `${provider}/${model}`;
  if (cfg.disabledModels.includes(key)) return true;
  if (cfg.disabledGroups.length === 0 || groups.length === 0) return false;
  return groups.some((id) => cfg.disabledGroups.includes(id));
}
function isHidden(provider, model, cfg, groups = []) {
  const key = `${provider}/${model}`;
  if (cfg.hiddenModels.includes(key)) return true;
  if (cfg.hiddenGroups.length === 0 || groups.length === 0) return false;
  return groups.some((id) => cfg.hiddenGroups.includes(id));
}
function isUnassigned(entry, cfg) {
  if (cfg.groupMode === "auto") return false;
  if (cfg.customGroups.length === 0) return false;
  return !cfg.customGroups.some((rule) => matchesGroup(entry, rule));
}
function groupsOf(entries, cfg) {
  const out = /* @__PURE__ */ new Map();
  for (const group of groupCatalog(entries, cfg)) {
    for (const entry of group.entries) {
      const list = out.get(entry.key);
      if (list === void 0) out.set(entry.key, [group.id]);
      else list.push(group.id);
    }
  }
  return out;
}
function sortKeyOf(provider, model, providerIndex, modelIndex, cfg) {
  const pAt = cfg.providerOrder.indexOf(provider);
  const mAt = cfg.modelOrder.indexOf(`${provider}/${model}`);
  const pRank = pAt >= 0 ? pAt : cfg.providerOrder.length + providerIndex;
  const mRank = mAt >= 0 ? mAt : cfg.modelOrder.length + modelIndex;
  return [pRank, mRank, providerIndex, modelIndex];
}
function compareSortKey(a, b) {
  for (let i = 0; i < 4; i += 1) {
    const delta = a.sortKey[i] - b.sortKey[i];
    if (delta !== 0) return delta;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
function ordered(entries) {
  return [...entries].sort(compareSortKey);
}
function byKind(entries, kind) {
  return entries.filter((entry) => entry.kind === kind);
}
function indexByKey(entries) {
  const map = /* @__PURE__ */ new Map();
  for (const entry of entries) map.set(entry.key, entry);
  return map;
}
function computeOccupancy(agents) {
  const owners = /* @__PURE__ */ new Map();
  const running = /* @__PURE__ */ new Set();
  for (const agent of agents) {
    if (agent.key === null) continue;
    const list = owners.get(agent.key) ?? [];
    if (!list.includes(agent.sessionId)) list.push(agent.sessionId);
    owners.set(agent.key, list);
    if (agent.status === "running") running.add(agent.key);
  }
  const map = {};
  for (const [key, list] of owners) {
    map[key] = { key, owners: [...list].sort(), inUse: true, running: running.has(key) };
  }
  return map;
}
function occupancyOf(map, key) {
  return map[key] ?? { key, owners: [], inUse: false, running: false };
}
function cooldownActive(state, now) {
  return state.until > now;
}
function cooldownRemaining(state, now) {
  return Math.max(0, state.until - now);
}
function selectionOf(entry, reasonCode, reason, orderIndex, occupancy) {
  const occ = occupancyOf(occupancy, entry.key);
  return {
    key: entry.key,
    provider: entry.provider,
    model: entry.model,
    name: entry.name,
    kind: entry.kind,
    reasonCode,
    reason,
    orderIndex,
    idle: !occ.inUse,
    owners: occ.owners
  };
}
function unavailable(entry, excluded, modelCooldown, now, probeUnavailable = []) {
  if (entry.disabled) return true;
  if (entry.hidden) return true;
  if (probeUnavailable.includes(entry.key)) return true;
  if (excluded.includes(entry.key)) return true;
  const until = modelCooldown[entry.key];
  return typeof until === "number" && until > now;
}
function scopeGroupsOf(entries, key, cfg) {
  if (key === null || key.length === 0) return [];
  const map = groupsOf(entries, cfg);
  return map.get(key) ?? [];
}
function scopedEntries(entries, cfg, scopeGroups) {
  if (cfg.switchScope === "all" || scopeGroups === void 0 || scopeGroups.length === 0) {
    return { entries, applied: false, scopeKeys: /* @__PURE__ */ new Set() };
  }
  const wanted = new Set(scopeGroups);
  const groups = groupCatalog(entries, cfg);
  const picked = [];
  for (const group of groups) {
    if (!wanted.has(group.id)) continue;
    for (const entry of group.entries) picked.push(entry);
  }
  if (picked.length === 0) return { entries, applied: false, scopeKeys: /* @__PURE__ */ new Set() };
  return { entries: picked, applied: true, scopeKeys: new Set(picked.map((entry) => entry.key)) };
}
function selectModel(request) {
  const { catalog, kind, preferredKey, occupancy, excluded, modelCooldown, now, cfg, probeUnavailable } = request;
  const all = ordered(byKind(catalog.entries, kind));
  const scoped = scopedEntries(catalog.entries, cfg, request.scopeGroups);
  const pool = scoped.applied ? ordered(byKind(scoped.entries, kind)) : all;
  const poolMap = indexByKey(pool);
  const allMap = indexByKey(all);
  if (preferredKey !== null) {
    const preferred = allMap.get(preferredKey) ?? poolMap.get(preferredKey);
    if (preferred !== void 0 && !unavailable(preferred, excluded, modelCooldown, now, probeUnavailable)) {
      const index = all.indexOf(preferred);
      const occ = occupancyOf(occupancy, preferred.key);
      return selectionOf(
        preferred,
        occ.inUse ? "preferred-busy" : "preferred",
        occ.inUse ? `\u9996\u9009\u6A21\u578B\u88AB\u4F1A\u8BDD ${occ.owners.join(",")} \u5360\u7528\uFF0C\u4F46\u7528\u6237\u663E\u5F0F\u9009\u62E9\u4F18\u5148` : "\u7528\u6237\u9ED8\u8BA4\u6A21\u578B",
        index,
        occupancy
      );
    }
  }
  const candidates = pool.filter((entry) => !unavailable(entry, excluded, modelCooldown, now, probeUnavailable));
  if (candidates.length > 0) {
    const scopeNote = scoped.applied ? `\u7EC4\u5185\uFF08${(request.scopeGroups ?? []).join(",")}\uFF09` : "\u540C\u7C7B\u578B";
    if (cfg.preferIdle) {
      const idle = candidates.find((entry) => !occupancyOf(occupancy, entry.key).inUse);
      if (idle !== void 0) {
        return selectionOf(
          idle,
          "fallback-idle",
          `${scopeNote}\u7A7A\u95F2\u5019\u9009\u6309\u5E8F\u53D6\u7B2C ${pool.indexOf(idle) + 1} \u4E2A`,
          all.indexOf(idle),
          occupancy
        );
      }
    }
    const first = candidates[0];
    const occ = occupancyOf(occupancy, first.key);
    return selectionOf(
      first,
      "fallback-order",
      cfg.preferIdle ? `${scopeNote}\u5019\u9009\u5168\u90E8\u88AB\u5360\u7528\uFF08${occ.owners.join(",")}\uFF09\uFF0C\u6309\u65E2\u5B9A\u987A\u5E8F\u53D6\u7B2C ${pool.indexOf(first) + 1} \u4E2A` : `${scopeNote}\u6309\u65E2\u5B9A\u987A\u5E8F\u53D6\u7B2C ${pool.indexOf(first) + 1} \u4E2A`,
      all.indexOf(first),
      occupancy
    );
  }
  if (scoped.applied && cfg.switchScope === "group-cross") {
    const rest = all.filter((entry) => !scoped.scopeKeys.has(entry.key));
    const restCandidates = rest.filter((entry) => !unavailable(entry, excluded, modelCooldown, now, probeUnavailable));
    const pick = cfg.preferIdle ? restCandidates.find((entry) => !occupancyOf(occupancy, entry.key).inUse) ?? restCandidates[0] : restCandidates[0];
    if (pick !== void 0) {
      return selectionOf(
        pick,
        "cross-group",
        `\u7EC4\u5185\uFF08${(request.scopeGroups ?? []).join(",")}\uFF09\u5019\u9009\u8017\u5C3D\uFF0C\u8DE8\u7EC4\u515C\u5E95\u53D6 ${pick.provider}/${pick.model}`,
        all.indexOf(pick),
        occupancy
      );
    }
  }
  return null;
}
function selectCrossClass(request) {
  const other = request.kind === "text" ? "multimodal" : "text";
  const picked = selectModel({ ...request, kind: other, preferredKey: null, scopeGroups: [] });
  if (picked === null) return null;
  return { ...picked, reasonCode: "cross-class", reason: `\u540C\u7C7B\u578B\u5DF2\u8017\u5C3D\uFF0C\u8DE8\u7C7B\u578B\u515C\u5E95\uFF08${other}\uFF09\uFF1A${picked.reason}` };
}
function poolStats(catalog, kind, excluded, modelCooldown, now, probeUnavailable = []) {
  const pool = byKind(catalog.entries, kind);
  let disabled = 0;
  let excludedCount = 0;
  let cooling = 0;
  let usable = 0;
  for (const entry of pool) {
    if (entry.disabled || probeUnavailable.includes(entry.key)) {
      disabled += 1;
      continue;
    }
    if (excluded.includes(entry.key)) {
      excludedCount += 1;
      continue;
    }
    const until = modelCooldown[entry.key];
    if (typeof until === "number" && until > now) {
      cooling += 1;
      continue;
    }
    usable += 1;
  }
  return { total: pool.length, disabled, excluded: excludedCount, cooling, usable };
}
var KIND_LABEL = { text: "\u7EAF\u6587\u672C", multimodal: "\u591A\u6A21\u6001" };
function matchesGroup(entry, group) {
  if (group.explicit) {
    const full = `${entry.provider}/${entry.model}`;
    return group.models.includes(full) || group.models.includes(entry.model);
  }
  if (group.kind !== null && entry.kind !== group.kind) return false;
  if (group.providers.length > 0 && !group.providers.includes(entry.provider)) return false;
  if (group.freeOnly && !entry.free) return false;
  if (group.models.length > 0) {
    const full = `${entry.provider}/${entry.model}`;
    if (!group.models.includes(full) && !group.models.includes(entry.model)) return false;
  }
  return true;
}
function autoLabel(group, count) {
  if (group.label.length > 0) return `${group.label} \xB7 ${count}`;
  if (group.explicit) return `\u6307\u5B9A\u6A21\u578B \xB7 ${count}`;
  const parts = [];
  if (group.kind !== null) parts.push(KIND_LABEL[group.kind]);
  if (group.providers.length > 0) parts.push(group.providers.join("/"));
  if (group.freeOnly) parts.push("\u9650\u514D");
  if (group.models.length > 0) parts.push(`${group.models.length} \u4E2A\u6307\u5B9A\u6A21\u578B`);
  return `${parts.length > 0 ? parts.join(" \xB7 ") : "\u81EA\u5B9A\u4E49"} \xB7 ${count}`;
}
function groupCatalog(entries, cfg) {
  const sorted = ordered(entries);
  if (cfg.groupMode === "auto") {
    const groups = [];
    for (const [id, label, cls] of [
      ["auto-free", "\u514D\u8D39", "free"],
      ["auto-paid", "\u79EF\u5206", "paid"],
      ["auto-unknown", "\u672A\u77E5", "unknown"]
    ]) {
      const bucket = sorted.filter((entry) => (entry.priceClass ?? priceClassOf(entry.name, entry.priceFactor)) === cls);
      if (bucket.length === 0) continue;
      groups.push({ id, label: `${label} \xB7 ${bucket.length}`, kind: null, custom: false, entries: bucket });
    }
    return groups;
  }
  if (cfg.customGroups.length > 0) {
    const claimed = /* @__PURE__ */ new Set();
    const groups = [];
    for (const rule of cfg.customGroups) {
      const bucket = sorted.filter((entry) => !claimed.has(entry.key) && matchesGroup(entry, rule));
      if (bucket.length === 0) continue;
      for (const entry of bucket) claimed.add(entry.key);
      groups.push({ id: rule.id, label: autoLabel(rule, bucket.length), kind: rule.kind, custom: true, entries: bucket });
    }
    const rest = sorted.filter((entry) => !claimed.has(entry.key));
    if (rest.length > 0) groups.push({ id: "__rest__", label: `\u5176\u4ED6 \xB7 ${rest.length}`, kind: null, custom: false, entries: rest });
    return groups;
  }
  if (cfg.groupByKind) {
    const groups = [];
    for (const kind of ["multimodal", "text"]) {
      const bucket = sorted.filter((entry) => entry.kind === kind);
      if (bucket.length === 0) continue;
      groups.push({ id: kind, label: `${KIND_LABEL[kind]} \xB7 ${bucket.length}`, kind, custom: false, entries: bucket });
    }
    return groups;
  }
  const byProvider = /* @__PURE__ */ new Map();
  for (const entry of sorted) {
    const bucket = byProvider.get(entry.provider);
    if (bucket === void 0) byProvider.set(entry.provider, [entry]);
    else bucket.push(entry);
  }
  return [...byProvider.entries()].map(([provider, bucket]) => ({
    id: provider,
    label: bucket[0]?.providerName ?? provider,
    kind: null,
    custom: false,
    entries: bucket
  }));
}
function badgeOf(entry, cfg) {
  return {
    kindGlyph: entry.kind === "multimodal" ? "\u56FE" : "\u6587",
    free: entry.free ? cfg.freeBadgeLabel : null
  };
}
function newSessionState(sessionId, kind, current, now) {
  return {
    sessionId,
    kind,
    current,
    attempts: 0,
    retriesUsed: 0,
    switches: 0,
    excluded: [],
    createdAt: now,
    updatedAt: now
  };
}
function failureFaceOf(failure) {
  const seen = /* @__PURE__ */ new Set();
  let cur = failure;
  for (let depth = 0; depth < 3 && cur !== null && typeof cur === "object" && !seen.has(cur); depth += 1) {
    seen.add(cur);
    if (typeof cur.code === "string" || typeof cur.status === "number" || typeof cur.retryAfterMs === "number") return cur;
    const cause = cur.cause;
    if (cause !== null && typeof cause === "object") {
      cur = cause;
      continue;
    }
    const errors = cur.errors;
    if (Array.isArray(errors) && errors.length > 0 && errors[0] !== null && typeof errors[0] === "object") {
      cur = errors[0];
      continue;
    }
    break;
  }
  return failure !== null && typeof failure === "object" ? failure : {};
}
function fieldsOf(face) {
  const code = typeof face?.code === "string" ? face.code : "";
  const status = typeof face?.status === "number" ? face.status : void 0;
  const retryAfterMs = typeof face?.retryAfterMs === "number" ? face.retryAfterMs : void 0;
  const text = [face?.message, face?.text, face?.name].filter((v) => typeof v === "string").join(" ").toLowerCase();
  return { code, status, retryAfterMs, text };
}
var PERMANENT_CODES_018 = /* @__PURE__ */ new Set([
  "CONTEXT_WINDOW_EXCEEDED",
  "AUTH",
  "INVALID_CREDENTIAL",
  "MISSING_CREDENTIAL",
  "INVALID_REQUEST",
  "INVALID_ARGS",
  "NO_ADAPTER",
  "INVALID_MODEL_CONTEXT",
  "INVALID_PREPARED_CALL"
]);
var TRANSIENT_CODES_018 = /* @__PURE__ */ new Set(["RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE"]);
function classifyFailure(face) {
  const { code, status, text } = fieldsOf(face);
  if (PERMANENT_CODES_018.has(code)) return "permanent";
  if (code === "QUOTA" || code === "QUOTA_EXCEEDED") {
    if (status === 429 || text.includes("rate limit") || text.includes("too many requests") || text.includes("retry after")) return "transient";
    return "permanent";
  }
  if (code === "AUTH_ERROR" || code === "UNAUTHORIZED" || status === 401 || status === 403 || status === 402) return "permanent";
  if (TRANSIENT_CODES_018.has(code)) return "transient";
  if (status === 408 || status === 425 || status === 429 || typeof status === "number" && status >= 500 && status < 600) return "transient";
  return "unknown";
}
function requestBackoffMs(attempt, retryAfterMs, cfg) {
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.floor(retryAfterMs);
  const ladder = Array.isArray(cfg.requestRetryBackoffMs) && cfg.requestRetryBackoffMs.length > 0 ? cfg.requestRetryBackoffMs : [2e3, 5e3, 1e4];
  const idx = Math.min(Math.max(0, attempt), ladder.length - 1);
  const value = ladder[idx];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
function decideOnError(request) {
  const { state, failureCode, aborted, catalog, occupancy, modelCooldown, cooldown, now, cfg } = request;
  if (aborted || failureCode === "ABORTED") {
    return { action: "giveup", reasonCode: "aborted", reason: `\u8BF7\u6C42\u88AB\u4E2D\u6B62\uFF08${failureCode}\uFF09\uFF0C\u4E0D\u8BA1\u5165\u91CD\u8BD5\u4E5F\u4E0D\u5207\u6362` };
  }
  if (!cfg.enabled) {
    return { action: "giveup", reasonCode: "disabled", reason: "\u63D2\u4EF6\u5DF2\u5173\u95ED\uFF08enabled=false\uFF09\uFF0C\u4EA4\u56DE\u5BBF\u4E3B\u9ED8\u8BA4\u903B\u8F91" };
  }
  if (cooldownActive(cooldown, now)) {
    return {
      action: "giveup",
      reasonCode: "cooldown-active",
      reason: `\u5168\u5C40\u51B7\u5374\u4E2D\uFF0C\u5269\u4F59 ${cooldownRemaining(cooldown, now)}ms\uFF0C\u4E0D\u91CD\u8BD5\u4E0D\u5207\u6362`
    };
  }
  if (cfg.switchOnCodes.length > 0 && !cfg.switchOnCodes.includes(failureCode)) {
    return {
      action: "giveup",
      reasonCode: "non-switchable",
      reason: `\u9519\u8BEF\u7801 ${failureCode} \u4E0D\u5728 switchOnCodes \u767D\u540D\u5355\u5185\uFF0C\u4EA4\u56DE\u5BBF\u4E3B llm-retry`
    };
  }
  const newLogic = cfg.requestRetryEnabled !== false;
  const skipRetry = newLogic && (request.classification === "permanent" || request.classification === "unknown" || request.classification === "transient" && request.hostOwns === true);
  const useNewBudget = newLogic && request.classification === "transient" && request.hostOwns !== true;
  const retryBudget = useNewBudget ? cfg.requestRetryMax ?? cfg.maxRetries : cfg.maxRetries;
  const retryDelay = useNewBudget ? requestBackoffMs(state.retriesUsed, request.retryAfterMs, cfg) : cfg.retryDelayMs;
  if (!skipRetry && state.retriesUsed < retryBudget) {
    const retriesUsed = state.retriesUsed + 1;
    return {
      action: "retry",
      delayMs: retryDelay,
      reasonCode: "retry",
      reason: `\u540C\u4E00\u6A21\u578B\u91CD\u8BD5 ${retriesUsed}/${retryBudget}\uFF08\u5931\u8D25\u7801 ${failureCode}\uFF0C\u5206\u7C7B ${request.classification ?? "legacy"}\uFF09`,
      attempts: state.attempts + 1,
      retriesUsed
    };
  }
  const excluded = state.current === null ? state.excluded : [...state.excluded, state.current.key];
  const base = {
    catalog,
    kind: state.kind,
    preferredKey: null,
    occupancy,
    excluded,
    modelCooldown,
    now,
    cfg,
    scopeGroups: request.scopeGroups,
    probeUnavailable: request.probeUnavailable
  };
  const next = selectModel(base);
  if (next !== null) {
    const code = next.reasonCode === "cross-group" ? "switch-cross-group" : next.reasonCode === "fallback-idle" || next.reasonCode === "preferred" ? "switch-idle" : "switch-order";
    return {
      action: "switch",
      delayMs: cfg.retryDelayMs,
      next,
      reasonCode: code,
      reason: `\u91CD\u8BD5\u989D\u5EA6\u5DF2\u7528\u5C3D\uFF08maxRetries=${cfg.maxRetries}\uFF09\uFF0C\u5207\u6362\u5230\u6A21\u578B ${next.provider}/${next.model}\uFF1A${next.reason}`
    };
  }
  if (cfg.crossClassFallback) {
    const cross = selectCrossClass(base);
    if (cross !== null) {
      return {
        action: "switch",
        delayMs: cfg.retryDelayMs,
        next: cross,
        reasonCode: "switch-cross-class",
        reason: cross.reason
      };
    }
  }
  const stats = poolStats(catalog, state.kind, excluded, modelCooldown, now, request.probeUnavailable);
  if (stats.total > 0 && stats.disabled === stats.total) {
    return {
      action: "giveup",
      reasonCode: "all-disabled",
      reason: `\u540C\u7C7B\u578B\uFF08${state.kind}\uFF09${stats.total} \u4E2A\u6A21\u578B\u5168\u90E8\u4E0D\u53EF\u7528\uFF08disabledModels / \u63A2\u6D4B\u5224\u4E0D\u53EF\u7528\uFF09\uFF0C\u4E0D\u8FDB\u51B7\u5374\uFF08\u51B7\u5374\u7B49\u4E0D\u5230\u5019\u9009\uFF09\uFF0C\u4EA4\u56DE\u5BBF\u4E3B`
    };
  }
  return {
    action: "cooldown",
    reasonCode: "cooldown",
    reason: `\u540C\u7C7B\u578B\uFF08${state.kind}\uFF09\u5019\u9009\u5168\u90E8\u4E0D\u53EF\u7528\uFF1Atotal=${stats.total} disabled=${stats.disabled} excluded=${stats.excluded} cooling=${stats.cooling}\uFF0C\u8FDB\u5165\u51B7\u5374 ${cfg.cooldownMs}ms`,
    cooldownUntil: now + cfg.cooldownMs
  };
}
var LOG_TEXT_LIMIT = 240;
function sanitizeRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") out[key] = value.length > LOG_TEXT_LIMIT ? `${value.slice(0, LOG_TEXT_LIMIT)}\u2026` : value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 32).map((item) => typeof item === "string" ? item.slice(0, 96) : item);
    else out[key] = value;
  }
  return out;
}
var LogRing = class {
  capacity;
  items = [];
  constructor(capacity = 500) {
    this.capacity = Math.max(16, capacity);
  }
  push(record) {
    const safe = sanitizeRecord(record);
    this.items.push(safe);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return safe;
  }
  recent(limit = 100) {
    const size = Math.max(0, Math.min(limit, this.items.length));
    return this.items.slice(this.items.length - size);
  }
  get size() {
    return this.items.length;
  }
};
function prunedRosterKeys(rosters, configurable, keep) {
  const byId = /* @__PURE__ */ new Map();
  for (const roster of rosters) {
    if (roster === null || typeof roster !== "object") continue;
    const id = typeof roster.provider === "string" ? roster.provider : "";
    if (id.length === 0) continue;
    const set = /* @__PURE__ */ new Set();
    if (Array.isArray(roster.models)) {
      for (const m of roster.models) if (typeof m === "string" && m.length > 0) set.add(m);
    }
    byId.set(id, set);
  }
  const empty = (reason, partial = {}) => ({
    pruned: /* @__PURE__ */ new Set(),
    laneIds: partial.laneIds ?? /* @__PURE__ */ new Set(),
    opened: partial.opened ?? /* @__PURE__ */ new Set(),
    sources: partial.sources ?? [],
    reason
  });
  if (byId.size === 0) return empty("no-rosters");
  const families = /* @__PURE__ */ new Map();
  for (const c of configurable) {
    if (c === null || typeof c !== "object") continue;
    const ns = (typeof c.settingsNs === "string" ? c.settingsNs : "").trim();
    const id = typeof c.provider === "string" ? c.provider : "";
    if (ns.length === 0 || id.length === 0 || !byId.has(id)) continue;
    const path = Array.isArray(c.settingsPath) ? c.settingsPath : [];
    if (!families.has(ns)) families.set(ns, { ids: /* @__PURE__ */ new Set(), allEmpty: true });
    const family = families.get(ns);
    family.ids.add(id);
    if (path.length > 0) family.allEmpty = false;
  }
  const laneIds = /* @__PURE__ */ new Set();
  for (const [, family] of families) {
    if (family.allEmpty && family.ids.size >= 2) for (const id of family.ids) laneIds.add(id);
  }
  if (laneIds.size === 0) return empty("no-family");
  const opened = /* @__PURE__ */ new Set();
  const laneSets = [];
  for (const id of laneIds) {
    const s = byId.get(id);
    if (s === void 0 || s.size === 0) continue;
    for (const m of s) opened.add(m);
    laneSets.push(s);
  }
  if (opened.size === 0 || laneSets.length === 0) return empty("no-opened", { laneIds, opened });
  const sources = [];
  for (const [id, set] of byId) {
    if (laneIds.has(id)) continue;
    const hit = laneSets.some((L) => set.size >= L.size * 2 && [...L].every((m) => set.has(m)));
    if (hit) sources.push(id);
  }
  if (sources.length === 0) return empty("no-sources", { laneIds, opened, sources });
  const keepFull = /* @__PURE__ */ new Set();
  const keepBare = /* @__PURE__ */ new Set();
  for (const k of keep) {
    if (typeof k !== "string" || k.length === 0) continue;
    const target = k.includes("/") ? keepFull : keepBare;
    target.add(k);
  }
  const pruned = /* @__PURE__ */ new Set();
  for (const id of sources) {
    const set = byId.get(id);
    if (set === void 0) continue;
    for (const m of set) {
      const full = `${id}/${m}`;
      if (!opened.has(m) && !keepFull.has(full) && !keepBare.has(m)) pruned.add(full);
    }
  }
  return { pruned, laneIds, opened, sources, reason: "applied" };
}
export {
  DEFAULT_CONFIG,
  GROUP_MODE_VALUES,
  LogRing,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  SWITCH_SCOPE_VALUES,
  badgeOf,
  byKind,
  classify,
  classifyFailure,
  compareSortKey,
  computeOccupancy,
  cooldownActive,
  cooldownRemaining,
  decideOnError,
  failureFaceOf,
  fieldsOf,
  groupCatalog,
  groupsOf,
  indexByKey,
  isDisabled,
  isEmptyGroup,
  isFreeName,
  isHidden,
  isUnassigned,
  matchesGroup,
  modelKey,
  newSessionState,
  normalizeCustomGroups,
  normalizeGroupMode,
  normalizeModalities,
  normalizeModelEfforts,
  normalizeSwitchScope,
  occupancyOf,
  ordered,
  poolStats,
  priceClassOf,
  priceFactorOf,
  prunedRosterKeys,
  requestBackoffMs,
  resolveConfig,
  sanitizeRecord,
  scopeGroupsOf,
  selectCrossClass,
  selectModel,
  sortKeyOf,
  splitKey
};
