var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// C:/Users/17694/.dsh/profiles/desktop/node_modules/@deepseek-ai/schemastery/lib/index.mjs
var lib_exports = {};
__export(lib_exports, {
  default: () => Schema
});

// C:/Users/17694/.dsh/profiles/desktop/node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
var write = /* @__PURE__ */ Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value2) => {
      current = value2;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set();
  function compare(a2, b2) {
    if (a2 === b2) return true;
    if (isVolatile(a2) || isVolatile(b2)) return isVolatile(a2) && isVolatile(b2);
    if (!strict && isNullable(a2) && isNullable(b2)) return true;
    if (typeof a2 !== typeof b2 || typeof a2 !== "object" || !a2 || !b2) return false;
    if (ancestors.has(a2)) return false;
    function check(test, then) {
      return test(a2) ? test(b2) ? then(a2, b2) : false : test(b2) ? false : void 0;
    }
    ancestors.add(a2);
    try {
      return check(Array.isArray, (a3, b3) => {
        if (a3.length !== b3.length) return false;
        for (let index = 0; index < a3.length; index++) if (!compare(a3[index], b3[index])) return false;
        return true;
      }) ?? check(is("Date"), (a3, b3) => a3.valueOf() === b3.valueOf()) ?? check(is("URL"), (a3, b3) => a3.href === b3.href) ?? check(is("RegExp"), (a3, b3) => a3.source === b3.source && a3.flags === b3.flags) ?? check(isArrayBufferLike, (a3, b3) => {
        if (a3.byteLength !== b3.byteLength) return false;
        const viewA = new Uint8Array(a3);
        const viewB = new Uint8Array(b3);
        for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
        return true;
      }) ?? ((!strict || [a2, b2].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a2,
        ...b2
      }).every((key) => compare(a2[key], b2[key])));
    } finally {
      ancestors.delete(a2);
    }
  }
  return compare(a, b);
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// C:/Users/17694/.dsh/profiles/desktop/node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value)) value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = /* @__PURE__ */ Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
  if (states.has(blocked)) return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve3) {
  resolvers[type] = resolve3;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/index.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/core.ts
var PLUGIN_NAME = "@zjjlivingfree/dsh-model-picker";
var PLUGIN_VERSION = "0.1.0";
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
  switchScope: "group-cross"
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
    switchScope: input.switchScope === void 0 ? DEFAULT_CONFIG.switchScope : normalizeSwitchScope(input.switchScope)
  };
}
function modelKey(provider, model) {
  return `${provider}\0${model}`;
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
function priceFactorOf(name2) {
  const match = /[·・\s]\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(name2);
  if (match === null) return void 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : void 0;
}
function priceClassOf(name2, priceFactor) {
  if (priceFactor === 0 || /免费|free\s*now/i.test(name2)) return "free";
  if (typeof priceFactor === "number" && priceFactor > 0 || /[·・\s]\s*x\s*\d/i.test(name2)) return "paid";
  return "unknown";
}
function isDisabled(provider, model, cfg2, groups = []) {
  const key = `${provider}/${model}`;
  if (cfg2.disabledModels.includes(key)) return true;
  if (cfg2.disabledGroups.length === 0 || groups.length === 0) return false;
  return groups.some((id) => cfg2.disabledGroups.includes(id));
}
function isHidden(provider, model, cfg2, groups = []) {
  const key = `${provider}/${model}`;
  if (cfg2.hiddenModels.includes(key)) return true;
  if (cfg2.hiddenGroups.length === 0 || groups.length === 0) return false;
  return groups.some((id) => cfg2.hiddenGroups.includes(id));
}
function isUnassigned(entry, cfg2) {
  if (cfg2.groupMode === "auto") return false;
  if (cfg2.customGroups.length === 0) return false;
  return !cfg2.customGroups.some((rule) => matchesGroup(entry, rule));
}
function groupsOf(entries, cfg2) {
  const out = /* @__PURE__ */ new Map();
  for (const group of groupCatalog(entries, cfg2)) {
    for (const entry of group.entries) {
      const list = out.get(entry.key);
      if (list === void 0) out.set(entry.key, [group.id]);
      else list.push(group.id);
    }
  }
  return out;
}
function sortKeyOf(provider, model, providerIndex, modelIndex, cfg2) {
  const pAt = cfg2.providerOrder.indexOf(provider);
  const mAt = cfg2.modelOrder.indexOf(`${provider}/${model}`);
  const pRank = pAt >= 0 ? pAt : cfg2.providerOrder.length + providerIndex;
  const mRank = mAt >= 0 ? mAt : cfg2.modelOrder.length + modelIndex;
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
function selectionOf(entry, reasonCode, reason, orderIndex, occupancy2) {
  const occ = occupancyOf(occupancy2, entry.key);
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
function unavailable(entry, excluded, modelCooldown2, now, probeUnavailable2 = []) {
  if (entry.disabled) return true;
  if (entry.hidden) return true;
  if (probeUnavailable2.includes(entry.key)) return true;
  if (excluded.includes(entry.key)) return true;
  const until = modelCooldown2[entry.key];
  return typeof until === "number" && until > now;
}
function scopeGroupsOf(entries, key, cfg2) {
  if (key === null || key.length === 0) return [];
  const map = groupsOf(entries, cfg2);
  return map.get(key) ?? [];
}
function scopedEntries(entries, cfg2, scopeGroups) {
  if (cfg2.switchScope === "all" || scopeGroups === void 0 || scopeGroups.length === 0) {
    return { entries, applied: false, scopeKeys: /* @__PURE__ */ new Set() };
  }
  const wanted = new Set(scopeGroups);
  const groups = groupCatalog(entries, cfg2);
  const picked = [];
  for (const group of groups) {
    if (!wanted.has(group.id)) continue;
    for (const entry of group.entries) picked.push(entry);
  }
  if (picked.length === 0) return { entries, applied: false, scopeKeys: /* @__PURE__ */ new Set() };
  return { entries: picked, applied: true, scopeKeys: new Set(picked.map((entry) => entry.key)) };
}
function selectModel(request) {
  const { catalog: catalog2, kind, preferredKey, occupancy: occupancy2, excluded, modelCooldown: modelCooldown2, now, cfg: cfg2, probeUnavailable: probeUnavailable2 } = request;
  const all = ordered(byKind(catalog2.entries, kind));
  const scoped = scopedEntries(catalog2.entries, cfg2, request.scopeGroups);
  const pool = scoped.applied ? ordered(byKind(scoped.entries, kind)) : all;
  const poolMap = indexByKey(pool);
  const allMap = indexByKey(all);
  if (preferredKey !== null) {
    const preferred = allMap.get(preferredKey) ?? poolMap.get(preferredKey);
    if (preferred !== void 0 && !unavailable(preferred, excluded, modelCooldown2, now, probeUnavailable2)) {
      const index = all.indexOf(preferred);
      const occ = occupancyOf(occupancy2, preferred.key);
      return selectionOf(
        preferred,
        occ.inUse ? "preferred-busy" : "preferred",
        occ.inUse ? `\u9996\u9009\u6A21\u578B\u88AB\u4F1A\u8BDD ${occ.owners.join(",")} \u5360\u7528\uFF0C\u4F46\u7528\u6237\u663E\u5F0F\u9009\u62E9\u4F18\u5148` : "\u7528\u6237\u9ED8\u8BA4\u6A21\u578B",
        index,
        occupancy2
      );
    }
  }
  const candidates = pool.filter((entry) => !unavailable(entry, excluded, modelCooldown2, now, probeUnavailable2));
  if (candidates.length > 0) {
    const scopeNote = scoped.applied ? `\u7EC4\u5185\uFF08${(request.scopeGroups ?? []).join(",")}\uFF09` : "\u540C\u7C7B\u578B";
    if (cfg2.preferIdle) {
      const idle = candidates.find((entry) => !occupancyOf(occupancy2, entry.key).inUse);
      if (idle !== void 0) {
        return selectionOf(
          idle,
          "fallback-idle",
          `${scopeNote}\u7A7A\u95F2\u5019\u9009\u6309\u5E8F\u53D6\u7B2C ${pool.indexOf(idle) + 1} \u4E2A`,
          all.indexOf(idle),
          occupancy2
        );
      }
    }
    const first = candidates[0];
    const occ = occupancyOf(occupancy2, first.key);
    return selectionOf(
      first,
      "fallback-order",
      cfg2.preferIdle ? `${scopeNote}\u5019\u9009\u5168\u90E8\u88AB\u5360\u7528\uFF08${occ.owners.join(",")}\uFF09\uFF0C\u6309\u65E2\u5B9A\u987A\u5E8F\u53D6\u7B2C ${pool.indexOf(first) + 1} \u4E2A` : `${scopeNote}\u6309\u65E2\u5B9A\u987A\u5E8F\u53D6\u7B2C ${pool.indexOf(first) + 1} \u4E2A`,
      all.indexOf(first),
      occupancy2
    );
  }
  if (scoped.applied && cfg2.switchScope === "group-cross") {
    const rest = all.filter((entry) => !scoped.scopeKeys.has(entry.key));
    const restCandidates = rest.filter((entry) => !unavailable(entry, excluded, modelCooldown2, now, probeUnavailable2));
    const pick2 = cfg2.preferIdle ? restCandidates.find((entry) => !occupancyOf(occupancy2, entry.key).inUse) ?? restCandidates[0] : restCandidates[0];
    if (pick2 !== void 0) {
      return selectionOf(
        pick2,
        "cross-group",
        `\u7EC4\u5185\uFF08${(request.scopeGroups ?? []).join(",")}\uFF09\u5019\u9009\u8017\u5C3D\uFF0C\u8DE8\u7EC4\u515C\u5E95\u53D6 ${pick2.provider}/${pick2.model}`,
        all.indexOf(pick2),
        occupancy2
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
function poolStats(catalog2, kind, excluded, modelCooldown2, now, probeUnavailable2 = []) {
  const pool = byKind(catalog2.entries, kind);
  let disabled = 0;
  let excludedCount = 0;
  let cooling = 0;
  let usable = 0;
  for (const entry of pool) {
    if (entry.disabled || probeUnavailable2.includes(entry.key)) {
      disabled += 1;
      continue;
    }
    if (excluded.includes(entry.key)) {
      excludedCount += 1;
      continue;
    }
    const until = modelCooldown2[entry.key];
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
function groupCatalog(entries, cfg2) {
  const sorted = ordered(entries);
  if (cfg2.groupMode === "auto") {
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
  if (cfg2.customGroups.length > 0) {
    const claimed = /* @__PURE__ */ new Set();
    const groups = [];
    for (const rule of cfg2.customGroups) {
      const bucket = sorted.filter((entry) => !claimed.has(entry.key) && matchesGroup(entry, rule));
      if (bucket.length === 0) continue;
      for (const entry of bucket) claimed.add(entry.key);
      groups.push({ id: rule.id, label: autoLabel(rule, bucket.length), kind: rule.kind, custom: true, entries: bucket });
    }
    const rest = sorted.filter((entry) => !claimed.has(entry.key));
    if (rest.length > 0) groups.push({ id: "__rest__", label: `\u5176\u4ED6 \xB7 ${rest.length}`, kind: null, custom: false, entries: rest });
    return groups;
  }
  if (cfg2.groupByKind) {
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
function decideOnError(request) {
  const { state, failureCode, aborted, catalog: catalog2, occupancy: occupancy2, modelCooldown: modelCooldown2, cooldown: cooldown2, now, cfg: cfg2 } = request;
  if (aborted || failureCode === "ABORTED") {
    return { action: "giveup", reasonCode: "aborted", reason: `\u8BF7\u6C42\u88AB\u4E2D\u6B62\uFF08${failureCode}\uFF09\uFF0C\u4E0D\u8BA1\u5165\u91CD\u8BD5\u4E5F\u4E0D\u5207\u6362` };
  }
  if (!cfg2.enabled) {
    return { action: "giveup", reasonCode: "disabled", reason: "\u63D2\u4EF6\u5DF2\u5173\u95ED\uFF08enabled=false\uFF09\uFF0C\u4EA4\u56DE\u5BBF\u4E3B\u9ED8\u8BA4\u903B\u8F91" };
  }
  if (cooldownActive(cooldown2, now)) {
    return {
      action: "giveup",
      reasonCode: "cooldown-active",
      reason: `\u5168\u5C40\u51B7\u5374\u4E2D\uFF0C\u5269\u4F59 ${cooldownRemaining(cooldown2, now)}ms\uFF0C\u4E0D\u91CD\u8BD5\u4E0D\u5207\u6362`
    };
  }
  if (cfg2.switchOnCodes.length > 0 && !cfg2.switchOnCodes.includes(failureCode)) {
    return {
      action: "giveup",
      reasonCode: "non-switchable",
      reason: `\u9519\u8BEF\u7801 ${failureCode} \u4E0D\u5728 switchOnCodes \u767D\u540D\u5355\u5185\uFF0C\u4EA4\u56DE\u5BBF\u4E3B llm-retry`
    };
  }
  if (state.retriesUsed < cfg2.maxRetries) {
    const retriesUsed = state.retriesUsed + 1;
    return {
      action: "retry",
      delayMs: cfg2.retryDelayMs,
      reasonCode: "retry",
      reason: `\u540C\u4E00\u6A21\u578B\u91CD\u8BD5 ${retriesUsed}/${cfg2.maxRetries}\uFF08\u5931\u8D25\u7801 ${failureCode}\uFF09`,
      attempts: state.attempts + 1,
      retriesUsed
    };
  }
  const excluded = state.current === null ? state.excluded : [...state.excluded, state.current.key];
  const base = {
    catalog: catalog2,
    kind: state.kind,
    preferredKey: null,
    occupancy: occupancy2,
    excluded,
    modelCooldown: modelCooldown2,
    now,
    cfg: cfg2,
    scopeGroups: request.scopeGroups,
    probeUnavailable: request.probeUnavailable
  };
  const next = selectModel(base);
  if (next !== null) {
    const code = next.reasonCode === "cross-group" ? "switch-cross-group" : next.reasonCode === "fallback-idle" || next.reasonCode === "preferred" ? "switch-idle" : "switch-order";
    return {
      action: "switch",
      delayMs: cfg2.retryDelayMs,
      next,
      reasonCode: code,
      reason: `\u91CD\u8BD5\u989D\u5EA6\u5DF2\u7528\u5C3D\uFF08maxRetries=${cfg2.maxRetries}\uFF09\uFF0C\u5207\u6362\u5230\u6A21\u578B ${next.provider}/${next.model}\uFF1A${next.reason}`
    };
  }
  if (cfg2.crossClassFallback) {
    const cross = selectCrossClass(base);
    if (cross !== null) {
      return {
        action: "switch",
        delayMs: cfg2.retryDelayMs,
        next: cross,
        reasonCode: "switch-cross-class",
        reason: cross.reason
      };
    }
  }
  const stats = poolStats(catalog2, state.kind, excluded, modelCooldown2, now, request.probeUnavailable);
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
    reason: `\u540C\u7C7B\u578B\uFF08${state.kind}\uFF09\u5019\u9009\u5168\u90E8\u4E0D\u53EF\u7528\uFF1Atotal=${stats.total} disabled=${stats.disabled} excluded=${stats.excluded} cooling=${stats.cooling}\uFF0C\u8FDB\u5165\u51B7\u5374 ${cfg2.cooldownMs}ms`,
    cooldownUntil: now + cfg2.cooldownMs
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
    const set2 = /* @__PURE__ */ new Set();
    if (Array.isArray(roster.models)) {
      for (const m of roster.models) if (typeof m === "string" && m.length > 0) set2.add(m);
    }
    byId.set(id, set2);
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
  for (const [id, set2] of byId) {
    if (laneIds.has(id)) continue;
    const hit = laneSets.some((L) => set2.size >= L.size * 2 && [...L].every((m) => set2.has(m)));
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
    const set2 = byId.get(id);
    if (set2 === void 0) continue;
    for (const m of set2) {
      const full = `${id}/${m}`;
      if (!opened.has(m) && !keepFull.has(full) && !keepBare.has(m)) pruned.add(full);
    }
  }
  return { pruned, laneIds, opened, sources, reason: "applied" };
}

// src/index.ts
var name = "model-auto-select";
var inject = ["webServer", "settings"];
var z = lib_exports?.default ?? lib_exports;
var Config = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled).volatile(),
  defaultModel: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() }).default(null).volatile(),
  maxRetries: z.natural().default(DEFAULT_CONFIG.maxRetries).volatile(),
  retryDelayMs: z.natural().default(DEFAULT_CONFIG.retryDelayMs).volatile(),
  providerOrder: z.array(z.string()).default([]).volatile(),
  modelOrder: z.array(z.string()).default([]).volatile(),
  preferIdle: z.boolean().default(DEFAULT_CONFIG.preferIdle).volatile(),
  cooldownMs: z.natural().default(DEFAULT_CONFIG.cooldownMs).volatile(),
  cooldownRefreshBlocked: z.boolean().default(DEFAULT_CONFIG.cooldownRefreshBlocked).volatile(),
  catalogTtlMs: z.natural().default(DEFAULT_CONFIG.catalogTtlMs).volatile(),
  occupancyRefreshMs: z.natural().default(DEFAULT_CONFIG.occupancyRefreshMs).volatile(),
  switchOnCodes: z.array(z.string()).default([]).volatile(),
  crossClassFallback: z.boolean().default(DEFAULT_CONFIG.crossClassFallback).volatile(),
  disabledModels: z.array(z.string()).default([]).volatile(),
  disabledGroups: z.array(z.string()).default([]).volatile(),
  hiddenModels: z.array(z.string()).default([]).volatile(),
  hiddenGroups: z.array(z.string()).default([]).volatile(),
  freeBadgeLabel: z.string().default(DEFAULT_CONFIG.freeBadgeLabel).volatile(),
  groupByKind: z.boolean().default(DEFAULT_CONFIG.groupByKind).volatile(),
  customGroups: z.array(
    z.object({
      id: z.string().default(""),
      label: z.string().default(""),
      kind: z.string().default(""),
      providers: z.array(z.string()).default([]),
      models: z.array(z.string()).default([]),
      freeOnly: z.boolean().default(false),
      explicit: z.boolean().default(false)
    })
  ).default([]).volatile(),
  switchScope: z.string().default(DEFAULT_CONFIG.switchScope).volatile(),
  groupMode: z.string().default(DEFAULT_CONFIG.groupMode).volatile(),
  probeIntervalMin: z.natural().default(DEFAULT_CONFIG.probeIntervalMin).volatile()
});
function readConfigRefs(raw) {
  const out = {};
  if (raw === null || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  }
  return out;
}
var ROUTE_PREFIX = "/dsh-model-auto-select";
var ROUTE_REGISTRY_KEY = "__dsh_model_auto_select_route__";
var MAX_BODY_BYTES = 64 * 1024;
var BEACON_TEXT_LEN = 400;
var MAX_BEACONS = 200;
var BEACON_KEYS = ["phase", "step", "build", "viewError", "entryCount", "occupied", "cooldownActive", "note"];
var MODALITY_TIMEOUT_MS = 4e3;
var READY_RETRY_MS = 5e3;
var ADAPTERS_EVENT = "llm/adapters-updated";
var CATALOG_SETTLE_MS = 3e3;
var ADAPTERS_REFRESH_DEBOUNCE_MS = 800;
var MODALITY_CACHE_TTL_MS = 10 * 60 * 1e3;
var SESSION_STATE_TTL_MS = 6 * 60 * 60 * 1e3;
var cfg = DEFAULT_CONFIG;
var ctxRef = null;
var logRing = new LogRing(600);
var beacons = [];
var catalog = { generatedAt: 0, entries: [], failures: [], providerCount: 0 };
var catalogAt = 0;
var catalogReady = false;
var catalogProviders = [];
var catalogProvidersAt = 0;
var adaptersTimer = null;
var catalogInflight = null;
var recoveryScheduled = false;
var modalityCache = /* @__PURE__ */ new Map();
var sessions = /* @__PURE__ */ new Map();
var modelCooldown = /* @__PURE__ */ new Map();
var cooldown = { until: 0, enteredAt: 0, reason: "" };
var cooldownTimer = null;
var cooldownSuppressLogAt = 0;
var cooldownSuppressCount = 0;
var COOLDOWN_SUPPRESS_LOG_INTERVAL_MS = 6e4;
var occupancyTimer = null;
var occupancy = {};
var lastOccupancyAt = 0;
var probeUnavailable = /* @__PURE__ */ new Set();
var probeTimer = null;
var probeRunning = false;
var PROBE_FILE = resolve2(dirname(dirname(fileURLToPath(import.meta.url))), "data", "probe-unavailable.json");
function loadProbeFile() {
  try {
    const raw = readFileSync(PROBE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.keys)) {
      return parsed.keys.filter((k) => typeof k === "string");
    }
    return [];
  } catch {
    return [];
  }
}
function saveProbeFile() {
  try {
    mkdirSync(dirname(PROBE_FILE), { recursive: true });
    const payload = { savedAt: Date.now(), keys: [...probeUnavailable] };
    writeFileSync(PROBE_FILE, JSON.stringify(payload), "utf8");
  } catch {
  }
}
var sessionApi = null;
var sessionApiProbed = false;
function log(record) {
  const safe = logRing.push(record);
  try {
    ctxRef?.logger?.info?.(`[${PLUGIN_NAME}] ${safe.event}`, JSON.stringify(safe));
  } catch {
  }
  return safe;
}
async function resolveSessionApi() {
  if (sessionApiProbed) return sessionApi;
  sessionApiProbed = true;
  const attempts = [
    ["bare-import", () => import("@deepseek-ai/dsh-session")]
  ];
  for (const [label, run] of attempts) {
    try {
      const mod = await run();
      if (mod && typeof mod.appendPluginRecord === "function") {
        sessionApi = { appendPluginRecord: mod.appendPluginRecord, pluginRecordOf: mod.pluginRecordOf };
        log({ ts: Date.now(), event: "config", reason: `plugin record \u901A\u9053\u53EF\u7528\uFF08${label}\uFF09`, version: PLUGIN_VERSION });
        return sessionApi;
      }
    } catch (err) {
      log({
        ts: Date.now(),
        event: "config",
        reason: `plugin record \u901A\u9053\u4E0D\u53EF\u7528\uFF08${label}\uFF09\uFF0C\u4EC5\u5199\u5185\u5B58\u65E5\u5FD7`,
        failureMessage: String(err?.message ?? err)
      });
    }
  }
  sessionApi = null;
  return sessionApi;
}
function recordToSession(session, record) {
  if (!sessionApi?.appendPluginRecord || session === void 0 || session === null) return;
  const type = `plugin:model-auto-select/${record.event}`;
  try {
    sessionApi.appendPluginRecord(session, type, sanitizeRecord(record));
  } catch (err) {
    log({
      ts: Date.now(),
      event: "config",
      reason: "plugin record \u5199\u5165\u5931\u8D25\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u5185\u5B58\u65E5\u5FD7",
      failureMessage: String(err?.message ?? err)
    });
    sessionApi = null;
  }
}
function withTimeout(promise, ms, label) {
  return new Promise((resolve3, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve3(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
async function modalitiesOf(llm, provider, model) {
  const key = modelKey(provider, model.id);
  const cached = modalityCache.get(key);
  if (cached !== void 0 && Date.now() - cached.at < MODALITY_CACHE_TTL_MS) {
    return { modalities: cached.modalities, source: cached.source, contextWindow: cached.contextWindow };
  }
  let modalities = normalizeModalities(model?.inputModalities);
  let source = modalities.length > 0 ? "listModels" : "fallback";
  let contextWindow;
  if (typeof llm.resolveModelInfo === "function") {
    try {
      const info = await withTimeout(Promise.resolve(llm.resolveModelInfo(provider, model.id)), MODALITY_TIMEOUT_MS, `resolveModelInfo(${provider}/${model.id})`);
      const resolved = normalizeModalities(info?.inputModalities);
      if (resolved.length > 0 && modalities.length === 0) {
        modalities = resolved;
        source = "resolveModelInfo";
      }
      const cw = info?.context?.contextWindow;
      if (typeof cw === "number" && Number.isFinite(cw)) contextWindow = cw;
    } catch {
    }
  }
  modalityCache.set(key, { modalities, source: source === "fallback" ? "listModels" : source, contextWindow, at: Date.now() });
  return { modalities, source, contextWindow };
}
async function buildCatalog() {
  const llm = ctxRef?.get?.("llm");
  if (llm === void 0 || llm === null || typeof llm.listProviders !== "function") {
    catalogReady = false;
    catalogProviders = [];
    catalogProvidersAt = Date.now();
    return { generatedAt: Date.now(), entries: [], failures: [{ provider: "*", name: "*", message: "llm \u670D\u52A1\u4E0D\u53EF\u7528" }], providerCount: 0 };
  }
  const providers = llm.listProviders();
  const entries = [];
  const failures = [];
  for (let pIndex = 0; pIndex < providers.length; pIndex += 1) {
    const provider = providers[pIndex];
    const pid = String(provider?.id ?? "");
    if (pid.length === 0) continue;
    try {
      const models = await llm.listModels(pid);
      for (let mIndex = 0; mIndex < models.length; mIndex += 1) {
        const model = models[mIndex];
        const mid = String(model?.id ?? "");
        if (mid.length === 0) continue;
        const { modalities, source, contextWindow } = await modalitiesOf(llm, pid, model);
        const name2 = String(model?.name ?? mid);
        const priceFactor = priceFactorOf(name2);
        const priceClass = priceClassOf(name2, priceFactor);
        entries.push({
          key: modelKey(pid, mid),
          provider: pid,
          providerName: String(provider?.name ?? provider?.displayName ?? pid),
          providerSettingsNs: String(provider?.settingsNs ?? ""),
          model: mid,
          name: name2,
          kind: classify(modalities),
          modalities,
          modalitySource: source,
          sortKey: sortKeyOf(pid, mid, pIndex, mIndex, cfg),
          ...priceFactor === void 0 ? {} : { priceFactor },
          priceClass,
          free: priceClass === "free",
          // 上下文窗口：宿主 llm 服务仅在 resolveModelInfo 结果里披露（context.contextWindow，
          // combined request+response 上限）；listModels 的 LlmModelInfo 不含该字段，故此处
          // 取 modalitiesOf 顺带探到的 contextWindow。未披露绝不猜测，故用 optional 透传。
          ...contextWindow === void 0 ? {} : { contextWindow: Number(contextWindow) },
          // 分组归属要等全部条目建完才能算，先占位，下面统一回填
          disabled: false,
          hidden: false
        });
      }
    } catch (err) {
      failures.push({
        provider: pid,
        name: String(provider?.name ?? pid),
        message: String(err?.message ?? err).slice(0, 200)
      });
    }
  }
  const rosters = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (!rosters.has(entry.provider)) rosters.set(entry.provider, /* @__PURE__ */ new Set());
    rosters.get(entry.provider).add(entry.model);
  }
  const pruneKeep = [];
  if (cfg.defaultModel !== null && cfg.defaultModel !== void 0) {
    pruneKeep.push(`${cfg.defaultModel.provider}/${cfg.defaultModel.model}`);
  }
  for (const rule of cfg.customGroups) for (const m of rule.models) pruneKeep.push(m);
  let configurable = [];
  if (typeof llm.listConfigurableProviders === "function") {
    try {
      const raw = await withTimeout(
        Promise.resolve().then(() => llm.listConfigurableProviders()),
        MODALITY_TIMEOUT_MS,
        "listConfigurableProviders"
      );
      if (Array.isArray(raw)) {
        configurable = raw.filter((row) => row !== null && typeof row === "object").map((row) => ({
          provider: String(row?.provider ?? ""),
          settingsNs: String(row?.settingsNs ?? ""),
          settingsPath: Array.isArray(row?.settingsPath) ? row.settingsPath.map((p) => String(p)) : []
        }));
      }
    } catch {
      configurable = [];
    }
  }
  const prune = prunedRosterKeys(
    [...rosters].map(([provider, models]) => ({ provider, models: [...models] })),
    configurable,
    pruneKeep
  );
  if (prune.pruned.size > 0) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i];
      if (prune.pruned.has(`${e.provider}/${e.model}`)) entries.splice(i, 1);
    }
    log({
      ts: Date.now(),
      event: "catalog",
      reasonCode: "unopened-roster-pruned",
      catalogSize: entries.length,
      reason: `\u6E90\u5934\u88C1\u526A\uFF1A\u6C60 lane \u5BB6\u65CF(${[...prune.laneIds].join(",")}) \u5DF2\u5F00\u653E ${prune.opened.size} \u9879\uFF0C\u4ECE\u5168\u91CF\u6E90(${prune.sources.join(",")}) \u88C1\u6389 ${prune.pruned.size} \u4E2A\u672A\u5F00\u653E\u6A21\u578B\uFF1Bkeep=${pruneKeep.length}`,
      version: PLUGIN_VERSION
    });
  }
  const groupMap = groupsOf(entries, cfg);
  for (const entry of entries) {
    const groups = groupMap.get(entry.key) ?? [];
    const unassigned = isUnassigned(entry, cfg);
    entry.disabled = unassigned || isDisabled(entry.provider, entry.model, cfg, groups);
    entry.hidden = unassigned || isHidden(entry.provider, entry.model, cfg, groups);
  }
  const snapshot2 = { generatedAt: Date.now(), entries, failures, providerCount: providers.length };
  const providerIds = providers.map((provider) => String(provider?.id ?? "")).filter((id) => id.length > 0);
  const firstBuild = catalogProviders.length === 0 && providerIds.length > 0;
  const changed = catalogProviders.length > 0 && (providerIds.length !== catalogProviders.length || providerIds.some((id) => !catalogProviders.includes(id)));
  if (changed || firstBuild) catalogProvidersAt = Date.now();
  catalogProviders = providerIds;
  catalogReady = true;
  if (changed) {
    log({
      ts: snapshot2.generatedAt,
      event: "catalog",
      catalogSize: entries.length,
      reason: `provider \u96C6\u5408\u53D8\u5316\uFF1A${providerIds.length} \u4E2A\uFF08\u76EE\u5F55\u91CD\u5EFA\u540E\u89C6\u4E3A\u672A\u7A33\u5B9A\uFF0C${CATALOG_SETTLE_MS}ms \u5185\u4E0D\u4E0B\u300C\u65E0\u53EF\u7528\u6A21\u578B\u300D\u7ED3\u8BBA\uFF09`,
      version: PLUGIN_VERSION
    });
  }
  const text = byKind(entries, "text").length;
  const multi = byKind(entries, "multimodal").length;
  log({
    ts: snapshot2.generatedAt,
    event: "catalog",
    catalogSize: entries.length,
    kind: multi > 0 ? "multimodal" : "text",
    reason: `\u76EE\u5F55\u6784\u5EFA\u5B8C\u6210\uFF1Atext=${text} multimodal=${multi} providers=${providers.length} failures=${failures.length}`,
    version: PLUGIN_VERSION
  });
  return snapshot2;
}
async function getCatalog(force = false) {
  const now = Date.now();
  const ttl = catalogReady && catalogSettled(now) ? cfg.catalogTtlMs : READY_RETRY_MS;
  if (!force && catalogAt > 0 && now - catalogAt < ttl) return catalog;
  if (!force && catalogInflight !== null) return catalogInflight;
  if (!force && cooldownActive(cooldown, now) && cfg.cooldownRefreshBlocked && catalogReady && catalogSettled(now)) {
    cooldownSuppressCount += 1;
    if (now - cooldownSuppressLogAt >= COOLDOWN_SUPPRESS_LOG_INTERVAL_MS) {
      const suppressed = cooldownSuppressCount - 1;
      cooldownSuppressLogAt = now;
      cooldownSuppressCount = 0;
      log({
        ts: now,
        event: "giveup",
        reasonCode: "cooldown-active",
        reason: `\u51B7\u5374\u4E2D\u6291\u5236\u76EE\u5F55\u5237\u65B0\uFF0C\u5269\u4F59 ${cooldownRemaining(cooldown, now)}ms` + (suppressed > 0 ? `\uFF08\u8DDD\u4E0A\u6B21\u8BB0\u5F55\u53C8\u6291\u5236 ${suppressed} \u6B21\uFF09` : ""),
        cooldownRemainingMs: cooldownRemaining(cooldown, now),
        suppressed
      });
    }
    return catalog;
  }
  const wasReady = catalogReady;
  catalogInflight = buildCatalog().then((snapshot2) => {
    catalog = snapshot2;
    catalogAt = Date.now();
    if (!wasReady && catalogReady && !recoveryScheduled) {
      recoveryScheduled = true;
      void recoverSelections("catalog-ready").finally(() => {
        recoveryScheduled = false;
      });
    }
    return snapshot2;
  }).catch((err) => {
    log({ ts: Date.now(), event: "catalog", reason: "\u76EE\u5F55\u6784\u5EFA\u5931\u8D25", failureMessage: String(err?.message ?? err) });
    return catalog;
  }).finally(() => {
    catalogInflight = null;
  });
  return catalogInflight;
}
function agentSelectionKey(agent) {
  try {
    const sp = ctxRef?.get?.("sessionProjections");
    if (sp !== void 0 && sp !== null && typeof sp.stateOf === "function") {
      const state = sp.stateOf(agent.session, "modelSelection");
      const picked = state?.pending ?? state?.lastUsed;
      if (picked !== void 0 && picked !== null && typeof picked.provider === "string" && typeof picked.model === "string") {
        return modelKey(picked.provider, picked.model);
      }
    }
  } catch {
  }
  try {
    const header = agent?.session?.requestHeader?.();
    const config = header?.config;
    if (config !== void 0 && typeof config.provider === "string" && typeof config.model === "string") {
      return modelKey(config.provider, config.model);
    }
  } catch {
  }
  return null;
}
function trackedSessions(now) {
  for (const agent of liveAgents()) {
    const sessionId = String(agent?.id ?? agent?.session?.id ?? "");
    if (sessionId.length === 0) continue;
    const key = agentSelectionKey(agent);
    const known = sessions.get(sessionId);
    const state = known ?? sessionState(sessionId, key, now);
    if (state.current === null && key !== null) state.current = hostSelection(key, now);
  }
  return sessions;
}
function liveAgents() {
  const registry = ctxRef?.get?.("agents");
  if (registry === void 0 || registry === null) return [];
  try {
    const list = typeof registry.list === "function" ? registry.list() : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function refreshOccupancy(reason) {
  const facts = [];
  for (const agent of liveAgents()) {
    const sessionId = String(agent?.id ?? agent?.session?.id ?? "");
    if (sessionId.length === 0) continue;
    facts.push({ sessionId, key: agentSelectionKey(agent), status: agent?.status === "running" ? "running" : "idle" });
  }
  const previous = occupancy;
  occupancy = computeOccupancy(facts);
  lastOccupancyAt = Date.now();
  const inUse = Object.keys(occupancy).length;
  const changed = Object.keys(previous).length !== inUse || Object.keys(occupancy).some((key) => (previous[key]?.owners ?? []).join(",") !== occupancy[key].owners.join(","));
  if (changed) {
    log({
      ts: lastOccupancyAt,
      event: "occupancy",
      reason: `\u5360\u7528\u5237\u65B0\uFF08${reason}\uFF09\uFF1Asessions=${facts.length} inUseModels=${inUse}`,
      owners: Object.keys(occupancy).map((key) => `${key.replace("\0", "/")}<-${occupancy[key].owners.join("|")}`).slice(0, 32)
    });
  }
  return occupancy;
}
function enterCooldown(reason, session) {
  const now = Date.now();
  if (cooldownActive(cooldown, now)) return;
  cooldown = { until: now + cfg.cooldownMs, enteredAt: now, reason };
  cooldownSuppressLogAt = 0;
  cooldownSuppressCount = 0;
  const record = log({
    ts: now,
    event: "cooldown",
    reasonCode: "cooldown",
    reason,
    cooldownUntil: cooldown.until,
    cooldownRemainingMs: cfg.cooldownMs,
    version: PLUGIN_VERSION
  });
  recordToSession(session, record);
  scheduleCooldownEnd();
}
function scheduleCooldownEnd() {
  if (cooldownTimer !== null) clearTimeout(cooldownTimer);
  const remaining = cooldownRemaining(cooldown, Date.now());
  if (remaining <= 0) return;
  cooldownTimer = setTimeout(() => {
    cooldownTimer = null;
    void wakeFromCooldown();
  }, Math.min(remaining, 2147483e3));
  if (typeof cooldownTimer?.unref === "function") cooldownTimer.unref();
}
async function wakeFromCooldown() {
  const now = Date.now();
  if (cooldownActive(cooldown, now)) {
    scheduleCooldownEnd();
    return;
  }
  const wasUntil = cooldown.until;
  if (wasUntil === 0) return;
  cooldown = { until: 0, enteredAt: 0, reason: "" };
  cooldownSuppressLogAt = 0;
  cooldownSuppressCount = 0;
  modelCooldown.clear();
  for (const state of sessions.values()) state.excluded = [];
  const snapshot2 = await getCatalog(true);
  log({
    ts: Date.now(),
    event: "cooldown-end",
    reason: `\u51B7\u5374\u7ED3\u675F\uFF08\u6301\u7EED ${cfg.cooldownMs}ms\uFF09\uFF0C\u5DF2\u91CD\u65B0\u83B7\u53D6\u76EE\u5F55\uFF1A${snapshot2.entries.length} \u4E2A\u6A21\u578B`,
    catalogSize: snapshot2.entries.length
  });
  for (const agent of liveAgents()) {
    const sessionId = String(agent?.id ?? agent?.session?.id ?? "");
    const state = sessions.get(sessionId);
    if (state === void 0 || state.current !== null) continue;
    void applySelection(agent, state.kind, "cooldown-end", { allowPreferred: true });
  }
}
function catalogSettled(now = Date.now()) {
  if (!catalogReady) return false;
  if (catalogProvidersAt === 0) return true;
  return now - catalogProvidersAt >= CATALOG_SETTLE_MS;
}
async function recoverSelections(trigger = "catalog-ready") {
  for (const [sessionId, state] of sessions) {
    if (state.current !== null) continue;
    const agent = liveAgents().find((a) => String(a?.id ?? a?.session?.id ?? "") === sessionId);
    if (agent === void 0) continue;
    void applySelection(agent, state.kind, trigger, { allowPreferred: true });
  }
}
var MAX_CATALOG_REFRESH_ATTEMPTS = 20;
var catalogRefreshAttempts = 0;
function scheduleCatalogRefresh() {
  if (adaptersTimer !== null) return;
  const delay2 = ADAPTERS_REFRESH_DEBOUNCE_MS * Math.min(Math.max(catalogRefreshAttempts, 1), 4);
  adaptersTimer = setTimeout(() => {
    adaptersTimer = null;
    catalogRefreshAttempts += 1;
    void getCatalog(true).then(() => {
      if (!catalogSettled() && catalogRefreshAttempts < MAX_CATALOG_REFRESH_ATTEMPTS) {
        scheduleCatalogRefresh();
        return;
      }
      catalogRefreshAttempts = 0;
      void recoverSelections("catalog-settled");
    });
  }, delay2);
  if (typeof adaptersTimer?.unref === "function") adaptersTimer.unref();
}
function currentKind(key) {
  if (key === null) return "text";
  const entry = indexByKey(catalog.entries).get(key);
  return entry?.kind ?? "text";
}
function hostSelection(key, now) {
  const entry = indexByKey(catalog.entries).get(key);
  if (entry === void 0) {
    const at = key.indexOf("/");
    if (at <= 0 || at === key.length - 1) return null;
    const provider = key.slice(0, at);
    const model = key.slice(at + 1);
    return {
      key,
      provider,
      model,
      name: model,
      kind: "text",
      reasonCode: "host-current",
      reason: "\u5BBF\u4E3B\u7684\u5F53\u524D\u9009\u62E9\uFF08\u76EE\u5F55\u91CC\u6682\u65E0\u8BE5\u6A21\u578B\uFF09",
      orderIndex: -1,
      idle: occupancy[key]?.inUse !== true,
      owners: occupancy[key]?.owners ?? []
    };
  }
  return {
    key,
    provider: entry.provider,
    model: entry.model,
    name: entry.name,
    kind: entry.kind,
    reasonCode: "host-current",
    reason: "\u5BBF\u4E3B\u7684\u5F53\u524D\u9009\u62E9",
    orderIndex: -1,
    idle: occupancy[key]?.inUse !== true,
    owners: occupancy[key]?.owners ?? []
  };
}
function sessionState(sessionId, preferredKey, now) {
  const existing = sessions.get(sessionId);
  if (existing !== void 0) return existing;
  const kind = currentKind(preferredKey);
  const state = newSessionState(sessionId, kind, null, now);
  sessions.set(sessionId, state);
  return state;
}
function preferredKeyFor(agent) {
  if (cfg.defaultModel !== null) return modelKey(cfg.defaultModel.provider, cfg.defaultModel.model);
  const host = agentSelectionKey(agent);
  if (host !== null) return host;
  try {
    const dflt = ctxRef?.get?.("agentDefaultModel")?.currentSelection?.();
    if (dflt !== void 0 && dflt !== null) return modelKey(dflt.provider, dflt.model);
  } catch {
  }
  return null;
}
function reasonText(selection) {
  return `${selection.reasonCode}: ${selection.reason}`;
}
function commitSelection(agent, selection, source) {
  const payload = {
    provider: selection.provider,
    model: selection.model,
    ...cfg.defaultModel !== null && cfg.defaultModel.provider === selection.provider && cfg.defaultModel.model === selection.model && cfg.defaultModel.reasoningEffort !== void 0 ? { reasoningEffort: cfg.defaultModel.reasoningEffort } : {}
  };
  try {
    if (typeof agent?.model?.select === "function") {
      agent.model.select(payload);
      return "agent.model.select";
    }
  } catch (err) {
    log({
      ts: Date.now(),
      event: "config",
      reason: `agent.model.select \u4E0D\u53EF\u7528\uFF08${source}\uFF09\uFF0C\u5C1D\u8BD5 selectForNextRequest`,
      failureMessage: String(err?.message ?? err)
    });
  }
  try {
    const controller = ctxRef?.get?.("sessionController");
    const agentsApi = controller?.agents;
    if (agentsApi !== void 0 && typeof agentsApi.selectForNextRequest === "function") {
      agentsApi.selectForNextRequest(agent, payload);
      return "selectForNextRequest";
    }
  } catch (err) {
    log({
      ts: Date.now(),
      event: "config",
      reason: `selectForNextRequest \u4E0D\u53EF\u7528\uFF08${source}\uFF09\uFF0C\u672C\u6B21\u9009\u62E9\u672A\u843D\u5730`,
      failureMessage: String(err?.message ?? err)
    });
  }
  log({
    ts: Date.now(),
    event: "config",
    reason: `\u65E0\u53EF\u7528\u5207\u6A21\u578B\u5165\u53E3\uFF08${source}\uFF09\uFF0C\u672C\u6B21\u9009\u62E9\u4EC5\u66F4\u65B0\u63D2\u4EF6\u5185\u90E8\u72B6\u6001\uFF0C\u672A\u5199\u5165\u5BBF\u4E3B`
  });
  return "unavailable";
}
async function applySelection(agent, kind, trigger, options) {
  const now = Date.now();
  const snapshot2 = await getCatalog(false);
  refreshOccupancy(trigger);
  const sessionId = String(agent?.id ?? agent?.session?.id ?? "");
  const preferred = options.allowPreferred ? preferredKeyFor(agent) : null;
  const state = sessionState(sessionId, preferred, now);
  state.kind = kind;
  const scopeGroups = scopeGroupsOf(snapshot2.entries, preferred ?? state.current?.key ?? null, cfg);
  const selection = selectModel({
    catalog: snapshot2,
    kind,
    preferredKey: preferred,
    occupancy,
    excluded: state.excluded,
    modelCooldown: modelCooldown.get(sessionId) ?? {},
    now,
    cfg,
    scopeGroups,
    probeUnavailable: [...probeUnavailable]
  });
  if (selection === null) {
    if (!catalogReady) {
      const record2 = log({
        ts: now,
        event: "select",
        sessionId,
        kind,
        reasonCode: "catalog-not-ready",
        reason: `\u76EE\u5F55\u5C1A\u672A\u5C31\u7EEA\uFF08catalog=${snapshot2.entries.length}\uFF09\uFF0C\u8DF3\u8FC7\u9009\u62E9\uFF0C\u5F85\u5C31\u7EEA\u540E\u6062\u590D`,
        catalogSize: snapshot2.entries.length
      });
      recordToSession(agent?.session, record2);
      return null;
    }
    if (!catalogSettled(now)) {
      const record2 = log({
        ts: now,
        event: "select",
        sessionId,
        kind,
        reasonCode: "catalog-settling",
        reason: `provider \u96C6\u5408\u4ECD\u5728\u53D8\u5316\uFF08${catalogProviders.length} \u4E2A\uFF0C${now - catalogProvidersAt}ms \u524D\u521A\u53D8\u8FC7\uFF09\uFF0C\u6682\u7F13\u5224\u5B9A\u65E0\u5019\u9009\uFF0C\u7A0D\u540E\u91CD\u8BD5\uFF08catalog=${snapshot2.entries.length}\uFF09`,
        catalogSize: snapshot2.entries.length
      });
      recordToSession(agent?.session, record2);
      scheduleCatalogRefresh();
      return null;
    }
    const record = log({
      ts: now,
      event: "select",
      sessionId,
      kind,
      reasonCode: "no-candidate",
      reason: `\u6CA1\u6709\u53EF\u7528\u7684 ${kind} \u6A21\u578B\uFF08catalog=${snapshot2.entries.length}\uFF09`,
      catalogSize: snapshot2.entries.length
    });
    recordToSession(agent?.session, record);
    enterCooldown(`\u4F1A\u8BDD ${sessionId} \u65E0\u53EF\u7528 ${kind} \u6A21\u578B`, agent?.session);
    return null;
  }
  const backfilled = state.current?.reasonCode === "host-current";
  const changed = backfilled || state.current?.key !== selection.key;
  state.current = selection;
  state.updatedAt = now;
  const via = commitSelection(agent, selection, trigger);
  if (changed) {
    const record = log({
      ts: now,
      event: "select",
      sessionId,
      kind,
      to: selection.key,
      reasonCode: selection.reasonCode,
      reason: `${trigger} \u2192 ${reasonText(selection)}`,
      orderIndex: selection.orderIndex,
      owners: selection.owners,
      catalogSize: snapshot2.entries.length,
      idleCandidates: byKind(snapshot2.entries, kind).filter((entry) => occupancy[entry.key]?.inUse !== true).length,
      via
    });
    recordToSession(agent?.session, record);
  }
  return selection;
}
async function handleRequestError(payload) {
  const agent = payload?.agent;
  if (agent === void 0 || agent === null) return void 0;
  const sessionId = String(agent?.id ?? agent?.session?.id ?? "");
  const failure = payload?.failure ?? {};
  const code = String(failure?.code ?? "UNKNOWN");
  const message = String(failure?.message ?? "");
  const now = Date.now();
  const state = sessions.get(sessionId) ?? sessionState(sessionId, preferredKeyFor(agent), now);
  state.attempts += 1;
  state.updatedAt = now;
  const snapshot2 = await getCatalog(false);
  refreshOccupancy("request-error");
  const scopeGroups = scopeGroupsOf(snapshot2.entries, state.current?.key ?? preferredKeyFor(agent), cfg);
  const decision = decideOnError({
    state,
    failureCode: code,
    failureMessage: message,
    aborted: payload?.signal?.aborted === true,
    catalog: snapshot2,
    occupancy,
    modelCooldown: modelCooldown.get(sessionId) ?? {},
    cooldown,
    now,
    cfg,
    scopeGroups,
    probeUnavailable: [...probeUnavailable]
  });
  if (decision.action === "giveup") {
    const record2 = log({
      ts: now,
      event: "giveup",
      sessionId,
      turn: payload?.turn,
      step: payload?.step,
      from: state.current?.key,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      failureCode: code,
      failureMessage: message,
      attempts: state.attempts,
      retriesUsed: state.retriesUsed,
      maxRetries: cfg.maxRetries
    });
    recordToSession(agent?.session, record2);
    return void 0;
  }
  if (decision.action === "retry") {
    state.retriesUsed = decision.retriesUsed;
    state.attempts = decision.attempts;
    const record2 = log({
      ts: now,
      event: "retry",
      sessionId,
      turn: payload?.turn,
      step: payload?.step,
      from: state.current?.key,
      reasonCode: "retry",
      reason: decision.reason,
      attempts: decision.attempts,
      retriesUsed: decision.retriesUsed,
      maxRetries: cfg.maxRetries,
      delayMs: decision.delayMs,
      failureCode: code,
      failureMessage: message
    });
    recordToSession(agent?.session, record2);
    if (decision.delayMs > 0) await delay(decision.delayMs, payload?.signal);
    return { kind: "retry" };
  }
  if (decision.action === "switch") {
    const previous = state.current;
    state.current = decision.next;
    state.switches += 1;
    state.retriesUsed = 0;
    state.attempts = 0;
    if (previous !== null && !state.excluded.includes(previous.key)) state.excluded.push(previous.key);
    const via = commitSelection(agent, decision.next, "switch");
    const record2 = log({
      ts: now,
      event: "switch",
      sessionId,
      turn: payload?.turn,
      step: payload?.step,
      kind: state.kind,
      from: previous?.key,
      to: decision.next.key,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      orderIndex: decision.next.orderIndex,
      owners: decision.next.owners,
      switches: state.switches,
      attempts: state.attempts,
      retriesUsed: 0,
      maxRetries: cfg.maxRetries,
      delayMs: decision.delayMs,
      failureCode: code,
      failureMessage: message,
      via
    });
    recordToSession(agent?.session, record2);
    if (decision.delayMs > 0) await delay(decision.delayMs, payload?.signal);
    return { kind: "retry" };
  }
  enterCooldown(decision.reason, agent?.session);
  const record = log({
    ts: now,
    event: "cooldown",
    sessionId,
    turn: payload?.turn,
    step: payload?.step,
    kind: state.kind,
    from: state.current?.key,
    reasonCode: "cooldown",
    reason: decision.reason,
    cooldownUntil: decision.cooldownUntil,
    cooldownRemainingMs: Math.max(0, decision.cooldownUntil - now),
    failureCode: code
  });
  recordToSession(agent?.session, record);
  return void 0;
}
function delay(ms, signal) {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve3) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve3();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve3();
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}
var BODY_TOO_LARGE = /* @__PURE__ */ Symbol("body-too-large");
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(body.length));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve3, reject) => {
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.removeListener("data", onData);
        req.resume?.();
        reject(BODY_TOO_LARGE);
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve3(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (err) => reject(err));
  });
}
function isSameOrigin(req) {
  const site = req.headers?.["sec-fetch-site"];
  if (typeof site === "string" && site.toLowerCase() === "cross-site") return false;
  const origin = req.headers?.origin;
  if (typeof origin !== "string" || origin === "") return true;
  const host = req.headers?.host;
  if (typeof host !== "string" || host === "") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function sanitizeBeacon(input) {
  const out = {};
  if (input === null || typeof input !== "object") return { ts: Date.now() };
  for (const [key, value] of Object.entries(input)) {
    if (!BEACON_KEYS.includes(key)) continue;
    if (value === void 0 || value === null) continue;
    if (typeof value === "string") out[key] = value.slice(0, BEACON_TEXT_LEN);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else {
      try {
        out[key] = JSON.stringify(value).slice(0, BEACON_TEXT_LEN);
      } catch {
        out[key] = "[unserializable]";
      }
    }
  }
  out.ts = Date.now();
  return out;
}
function catalogView(snapshot2) {
  const now = Date.now();
  return {
    version: PLUGIN_VERSION,
    generatedAt: snapshot2.generatedAt,
    providerCount: snapshot2.providerCount,
    entries: snapshot2.entries.map((entry) => ({
      key: entry.key,
      provider: entry.provider,
      providerName: entry.providerName,
      providerSettingsNs: entry.providerSettingsNs,
      model: entry.model,
      name: entry.name,
      kind: entry.kind,
      modalities: entry.modalities,
      modalitySource: entry.modalitySource,
      sortKey: entry.sortKey,
      ...entry.priceFactor === void 0 ? {} : { priceFactor: entry.priceFactor },
      priceClass: entry.priceClass ?? priceClassOf(entry.name, entry.priceFactor),
      free: entry.free,
      disabled: entry.disabled,
      hidden: entry.hidden,
      ...entry.contextWindow === void 0 ? {} : { contextWindow: entry.contextWindow }
    })),
    // 界面直接可渲染的分组：用户自定义规则优先，其次「所有来源的多模态一组 / 纯文本一组」
    groups: groupCatalog(snapshot2.entries, cfg).map((group) => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      custom: group.custom,
      keys: group.entries.map((entry) => entry.key)
    })),
    failures: snapshot2.failures,
    unavailableModels: [...probeUnavailable],
    occupancy,
    cooldown: { active: cooldownActive(cooldown, now), until: cooldown.until, remainingMs: cooldownRemaining(cooldown, now), reason: cooldown.reason },
    // 每个活跃会话都要有一行：插件加载前就存在的会话没有 state，
    // 这里按宿主的当前选择补一条，否则下拉的「当前模型」会退化成占位文案。
    sessions: [...trackedSessions(Date.now()).values()].map((state) => ({
      sessionId: state.sessionId,
      kind: state.kind,
      current: state.current?.key ?? null,
      reasonCode: state.current?.reasonCode ?? null,
      attempts: state.attempts,
      retriesUsed: state.retriesUsed,
      switches: state.switches,
      excluded: state.excluded
    })),
    config: {
      defaultModel: cfg.defaultModel,
      maxRetries: cfg.maxRetries,
      retryDelayMs: cfg.retryDelayMs,
      providerOrder: cfg.providerOrder,
      modelOrder: cfg.modelOrder,
      preferIdle: cfg.preferIdle,
      cooldownMs: cfg.cooldownMs,
      cooldownRefreshBlocked: cfg.cooldownRefreshBlocked,
      catalogTtlMs: cfg.catalogTtlMs,
      occupancyRefreshMs: cfg.occupancyRefreshMs,
      switchOnCodes: cfg.switchOnCodes,
      crossClassFallback: cfg.crossClassFallback,
      enabled: cfg.enabled,
      disabledModels: cfg.disabledModels,
      disabledGroups: cfg.disabledGroups,
      hiddenModels: cfg.hiddenModels,
      hiddenGroups: cfg.hiddenGroups,
      freeBadgeLabel: cfg.freeBadgeLabel,
      groupByKind: cfg.groupByKind,
      customGroups: cfg.customGroups,
      switchScope: cfg.switchScope,
      groupMode: cfg.groupMode,
      probeIntervalMin: cfg.probeIntervalMin
    }
  };
}
var CONFIG_FIELDS = [
  { key: "enabled", type: "boolean", label: "\u542F\u7528\u81EA\u52A8\u9009\u62E9", hint: "\u5173\u95ED\u540E\u63D2\u4EF6\u53EA\u89C2\u6D4B\u4E0D\u63A5\u7BA1\uFF0C\u5168\u90E8\u4EA4\u56DE\u5BBF\u4E3B\u9ED8\u8BA4\u903B\u8F91" },
  { key: "defaultModel", type: "model", label: "\u9ED8\u8BA4\u6A21\u578B", hint: "\u7559\u7A7A\u5219\u6CBF\u7528\u5BBF\u4E3B agentDefaultModel \u7684\u5F53\u524D\u9009\u62E9" },
  { key: "maxRetries", type: "number", label: "\u540C\u4E00\u6A21\u578B\u91CD\u8BD5\u6B21\u6570", hint: "\u9ED8\u8BA4 2\uFF08\u5355\u6A21\u578B\u6700\u591A 3 \u6B21\u5C1D\u8BD5\uFF09\uFF1B\u7528\u5B8C\u540E\u5207\u4E0B\u4E00\u4E2A\u540C\u7C7B\u578B\u6A21\u578B" },
  { key: "preferIdle", type: "boolean", label: "\u5207\u6362\u4F18\u5148\u9009\u7A7A\u95F2\u6A21\u578B", hint: "\u5173\u95ED\u5219\u53EA\u6309\u65E2\u5B9A\u987A\u5E8F\uFF0C\u4E0D\u770B\u4F1A\u8BDD\u5360\u7528" },
  { key: "groupMode", type: "groupmode", label: "\u5206\u7EC4\u65B9\u5F0F", hint: "\u624B\u5DE5=\u6CBF\u7528\u81EA\u5B9A\u4E49\u5206\u7EC4\uFF1B\u81EA\u52A8=\u6309\u514D\u8D39/\u79EF\u5206/\u672A\u77E5\u81EA\u52A8\u5206\u4E09\u7EC4\uFF08\u5207\u56DE\u624B\u5DE5\u539F\u6837\u6062\u590D\uFF09" },
  { key: "probeIntervalMin", type: "number", label: "\u81EA\u52A8\u63A2\u6D4B\u95F4\u9694(\u5206\u949F)", hint: "0/\u7559\u7A7A=\u4E0D\u81EA\u52A8\uFF1B\u8BBE\u4E86\u95F4\u9694\u624D\u5B9A\u65F6\u6D4B\u5168\u90E8\u6A21\u578B\uFF08\u4F1A\u771F\u5B9E\u6D88\u8017\u4E0A\u6E38\u79EF\u5206\uFF09" },
  { key: "groupByKind", type: "boolean", label: "\u6309\u7C7B\u578B\u5206\u7EC4", hint: "\u5F00=\u6240\u6709\u6765\u6E90\u7684\u591A\u6A21\u6001\u4E00\u7EC4\u3001\u7EAF\u6587\u672C\u4E00\u7EC4\uFF1B\u5173=\u6309\u6765\u6E90\u5206\u7EC4" },
  { key: "customGroups", type: "groups", label: "\u81EA\u5B9A\u4E49\u5206\u7EC4", hint: "\u975E\u7A7A\u65F6\u63A5\u7BA1\u9762\u677F\u5206\u7EC4\uFF1A\u6309\u987A\u5E8F\u5148\u547D\u4E2D\u5148\u5F52\u7EC4\uFF0C\u672A\u547D\u4E2D\u7684\u843D\u5230\u300C\u5176\u4ED6\u300D" },
  {
    key: "switchScope",
    type: "scope",
    label: "\u81EA\u52A8\u5207\u6362\u8303\u56F4",
    hint: "\u7EC4\u5185 = \u53EA\u5728\u5F53\u524D\u6A21\u578B\u6240\u5728\u5206\u7EC4\u91CC\u6362\uFF1B\u7EC4\u5185\u2192\u8DE8\u7EC4 = \u7EC4\u5185\u8017\u5C3D\u518D\u8DE8\u7EC4\u515C\u5E95\uFF1B\u5168\u90E8 = \u5728\u6574\u4E2A\u540C\u7C7B\u578B\u6C60\u5B50\u91CC\u6362"
  },
  { key: "disabledModels", type: "models", label: "\u81EA\u52A8\u9009\u62E9\uFF1A\u6A21\u578B", hint: "\u52FE\u9009 = \u5141\u8BB8\u53C2\u4E0E\u81EA\u52A8\u9009\u62E9\uFF1B\u53D6\u6D88\u52FE\u9009\u5199\u8FDB disabledModels" },
  { key: "disabledGroups", type: "groups-list", label: "\u81EA\u52A8\u9009\u62E9\uFF1A\u5206\u7EC4", hint: "\u6574\u7EC4\u5173\u6389 = \u8BE5\u7EC4\u6240\u6709\u6A21\u578B\u90FD\u4E0D\u53C2\u4E0E\u81EA\u52A8\u9009\u62E9" },
  { key: "hiddenModels", type: "models", label: "\u4E0B\u62C9\u5C55\u793A\uFF1A\u6A21\u578B", hint: "\u52FE\u9009 = \u51FA\u73B0\u5728\u6A21\u578B\u4E0B\u62C9\uFF1B\u53D6\u6D88\u52FE\u9009\u5199\u8FDB hiddenModels\uFF08\u53EA\u5F71\u54CD\u5C55\u793A\uFF09" },
  { key: "hiddenGroups", type: "groups-list", label: "\u4E0B\u62C9\u5C55\u793A\uFF1A\u5206\u7EC4", hint: "\u6574\u7EC4\u9690\u85CF = \u8BE5\u7EC4\u6240\u6709\u6A21\u578B\u90FD\u4E0D\u5728\u6A21\u578B\u4E0B\u62C9\u91CC\u51FA\u73B0" }
];
function ownEntry() {
  const editor = ctxRef?.get?.("configEditor");
  if (editor === void 0 || editor === null || typeof editor.entries !== "function") return null;
  try {
    const entries = editor.entries();
    return entries.find((entry) => entry?.options?.name === PLUGIN_NAME) ?? null;
  } catch {
    return null;
  }
}
function entryActive(entry) {
  return entry !== null && entry !== void 0 && entry.fiber !== void 0 && entry.fiber !== null && entry.fiber.state === 2;
}
var sleep = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
async function waitForActive(waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (entryActive(ownEntry())) return true;
    await sleep(60);
  }
  return entryActive(ownEntry());
}
function configView() {
  const entry = ownEntry();
  return {
    version: PLUGIN_VERSION,
    config: cfg,
    defaults: DEFAULT_CONFIG,
    fields: CONFIG_FIELDS,
    /** 能否把改动写回 profile（没有 configEditor 时只作用于本进程内存） */
    writable: entry !== null,
    /** 插件是否处于 active：false 时写入会被宿主拒绝，界面据此提示「稍后重试」 */
    active: entryActive(entry),
    documentPath: ctxRef?.get?.("configEditor")?.documentPath ?? null
  };
}
function coercePatch(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  const next = {};
  const changed = [];
  const assign = (key, value) => {
    next[key] = value;
    changed.push(key);
  };
  for (const field of CONFIG_FIELDS) {
    const key = field.key;
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (field.type === "boolean") {
      if (typeof value !== "boolean") continue;
      assign(key, value);
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      const floored = Math.floor(value);
      assign(key, key === "probeIntervalMin" ? Math.min(floored, 1440) : floored);
      continue;
    }
    if (field.type === "list") {
      const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
      if (items === null) continue;
      const list = items.map((item) => typeof item === "string" ? item.trim() : "").filter((item) => item.length > 0);
      assign(key, list);
      continue;
    }
    if (field.type === "text") {
      if (typeof value !== "string") continue;
      assign(key, value.trim());
      continue;
    }
    if (field.type === "scope") {
      if (typeof value !== "string") continue;
      const scope = normalizeSwitchScope(value);
      if (scope !== value) continue;
      assign(key, scope);
      continue;
    }
    if (field.type === "groupmode") {
      if (typeof value !== "string") continue;
      const mode = normalizeGroupMode(value);
      if (mode !== value) continue;
      assign(key, mode);
      continue;
    }
    if (field.type === "groups-list") {
      const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
      if (items === null) continue;
      assign(
        key,
        items.map((item) => typeof item === "string" ? item.trim() : "").filter((item) => item.length > 0)
      );
      continue;
    }
    if (key === "defaultModel") {
      if (value === null) {
        assign(key, null);
        continue;
      }
      if (typeof value === "object" && typeof value.provider === "string" && typeof value.model === "string" && value.provider.length > 0 && value.model.length > 0) {
        assign(key, {
          provider: value.provider,
          model: value.model,
          ...typeof value.reasoningEffort === "string" && value.reasoningEffort.length > 0 ? { reasoningEffort: value.reasoningEffort } : {}
        });
      }
      continue;
    }
    if (key === "disabledModels" || key === "hiddenModels") {
      if (Array.isArray(value)) assign(key, value.filter((item) => typeof item === "string" && item.includes("/")));
      continue;
    }
    if (key === "customGroups") {
      if (Array.isArray(value)) assign(key, normalizeCustomGroups(value));
      continue;
    }
  }
  for (const [flag, key] of [
    ["disabled", "disabledModels"],
    ["hidden", "hiddenModels"]
  ]) {
    const toggle = source.toggleModel;
    if (toggle === null || typeof toggle !== "object") continue;
    if (typeof toggle.provider !== "string" || typeof toggle.model !== "string") continue;
    if (!Object.hasOwn(toggle, flag)) continue;
    const id = `${toggle.provider}/${toggle.model}`;
    const set2 = new Set(cfg[key]);
    if (toggle[flag] === true) set2.add(id);
    else set2.delete(id);
    assign(key, [...set2]);
  }
  for (const [flag, key] of [
    ["disabled", "disabledGroups"],
    ["hidden", "hiddenGroups"]
  ]) {
    const toggle = source.toggleGroup;
    if (toggle === null || typeof toggle !== "object") continue;
    if (typeof toggle.group !== "string" || toggle.group.length === 0) continue;
    if (!Object.hasOwn(toggle, flag)) continue;
    const set2 = new Set(cfg[key]);
    if (toggle[flag] === true) set2.add(toggle.group);
    else set2.delete(toggle.group);
    assign(key, [...set2]);
  }
  return { next, changed };
}
var RETRYABLE_SAVE = /no longer active|no longer available|changed during reload/i;
async function saveConfig(patch) {
  const { next, changed } = coercePatch(patch);
  if (changed.length === 0) {
    return { ok: false, persisted: false, config: cfg, changed, error: "no valid field in patch" };
  }
  const merged = { ...cfg, ...next };
  const resolved = resolveConfig(merged);
  const editor = ctxRef?.get?.("configEditor");
  if (editor === void 0 || typeof editor.edit !== "function") {
    cfg = resolved;
    afterConfigChange(changed);
    return { ok: true, persisted: false, config: cfg, changed, error: "configEditor \u4E0D\u53EF\u7528\uFF0C\u6539\u52A8\u53EA\u4F5C\u7528\u4E8E\u672C\u8FDB\u7A0B\u5185\u5B58" };
  }
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 0 && !entryActive(ownEntry())) await waitForActive(1500);
    const entry = ownEntry();
    if (entry === null) {
      lastError = "Configuration entry is no longer available";
    } else {
      try {
        await editor.edit(entry, (current) => ({ ...current ?? {}, ...next }));
        cfg = resolved;
        afterConfigChange(changed);
        return { ok: true, persisted: true, config: cfg, changed };
      } catch (err) {
        lastError = String(err?.message ?? err).slice(0, 300);
      }
    }
    if (attempt === 1 || !RETRYABLE_SAVE.test(lastError)) break;
    await waitForActive(1500);
  }
  log({
    ts: Date.now(),
    event: "config",
    reason: `\u914D\u7F6E\u5199\u5165\u5931\u8D25\uFF1A${lastError.slice(0, 120)}`,
    maxRetries: cfg.maxRetries,
    cooldownMs: cfg.cooldownMs,
    preferIdle: cfg.preferIdle,
    version: PLUGIN_VERSION
  });
  const friendly = RETRYABLE_SAVE.test(lastError) ? "\u63D2\u4EF6\u6B63\u5728\u91CD\u542F\uFF08\u5199\u5165\u914D\u7F6E\u4F1A\u89E6\u53D1\u91CD\u8F7D\uFF09\uFF0C\u8BF7 2 \u79D2\u540E\u91CD\u8BD5\uFF1B\u672C\u6B21\u6539\u52A8\u672A\u4FDD\u5B58" : lastError;
  return { ok: false, persisted: false, config: cfg, changed, error: friendly };
}
function afterConfigChange(changed) {
  log({
    ts: Date.now(),
    event: "config",
    reason: `\u914D\u7F6E\u5DF2\u66F4\u65B0\uFF1A${changed.join(",")}`,
    maxRetries: cfg.maxRetries,
    cooldownMs: cfg.cooldownMs,
    preferIdle: cfg.preferIdle,
    version: PLUGIN_VERSION
  });
  catalogAt = 0;
  void getCatalog(true);
}
function classifyProbeFailure(error, code) {
  if (typeof code === "string" && code.startsWith("UPSTREAM_")) return "model";
  if (code === "NO_ADAPTER") return "infra";
  const e = error.toLowerCase();
  if (e.includes("no adapter registered") || e.includes("fetch failed") || e.includes("abort") || // 超时（AbortController 触发 The operation was aborted）
  e.includes("timeout") || e.includes("enotfound") || // DNS 解析失败
  e.includes("econnrefused") || // 连接被拒
  e.includes("econnreset") || // 连接重置
  e.includes("und_err") || // undici 传输错误
  e.includes("getaddrinfo") || // 域名解析失败
  e.includes("network") || e.includes("socket")) {
    return "infra";
  }
  return "infra";
}
async function runModelProbe(provider, model) {
  const llm = ctxRef?.get?.("llm");
  if (llm === void 0 || llm === null || typeof llm.prepareCall !== "function") {
    return { ok: false, ms: 0, kind: "infra", error: "\u5BBF\u4E3B llm \u670D\u52A1\u4E0D\u53EF\u7528\u6216\u7F3A\u5C11 prepareCall \u5165\u53E3" };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2e4);
  try {
    const call = await llm.prepareCall({ provider, model, maxTokens: 32 }, controller.signal);
    const stream = call.stream({
      ...call.config,
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      signal: controller.signal
    });
    let sample = "";
    for await (const chunk of stream) {
      if (chunk?.type === "finish") {
        const kind = String(chunk?.reason?.kind ?? "stop");
        if (kind === "error") {
          const failure = chunk?.reason?.failure;
          const failureCode = failure?.code !== void 0 ? String(failure.code) : void 0;
          const failureMsg = String(failure?.message ?? failureCode ?? "\u8C03\u7528\u5931\u8D25");
          return { ok: false, ms: Date.now() - started, kind: classifyProbeFailure(failureMsg, failureCode), error: failureMsg.slice(0, 300) };
        }
        return { ok: true, ms: Date.now() - started, sample: sample.slice(0, 80) };
      }
      const piece = chunk?.delta?.text ?? chunk?.delta ?? chunk?.text;
      const text = typeof piece === "string" ? piece : typeof piece?.text === "string" ? piece.text : "";
      if (text.length > 0) {
        return { ok: true, ms: Date.now() - started, sample: (sample + text).slice(0, 80) };
      }
    }
    return { ok: false, ms: Date.now() - started, kind: "infra", error: "\u6D41\u5DF2\u7ED3\u675F\u4F46\u672A\u6536\u5230\u4EFB\u4F55\u6A21\u578B\u54CD\u5E94" };
  } catch (err) {
    const e = err;
    const code = e?.code !== void 0 ? String(e.code) : void 0;
    const message = String(e?.message ?? err);
    return { ok: false, ms: Date.now() - started, kind: classifyProbeFailure(message, code), error: message.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}
async function runScheduledProbe() {
  if (probeRunning) return;
  probeRunning = true;
  try {
    const snapshot2 = await getCatalog(false);
    const queue = snapshot2.entries.filter((entry) => entry.hidden !== true);
    const CONCURRENCY = 4;
    const worker = async () => {
      for (; ; ) {
        const entry = queue.shift();
        if (entry === void 0) return;
        const result = await runModelProbe(entry.provider, entry.model);
        if (result.kind === "model" && !result.ok) {
          probeUnavailable.add(entry.key);
        } else {
          probeUnavailable.delete(entry.key);
        }
        log({
          ts: Date.now(),
          event: "probe",
          provider: entry.provider,
          model: entry.model,
          ok: result.ok,
          ms: result.ms,
          reasonCode: result.ok ? "probe-ok" : result.kind === "model" ? "probe-fail" : "probe-infra",
          reason: result.ok ? `\u5B9A\u65F6\u63A2\u6D4B\u901A\u8FC7\uFF08${result.ms}ms\uFF09` : `\u63A2\u6D4B\u5931\u8D25\uFF08${result.kind ?? "infra"}\uFF09\uFF1A${result.error ?? ""}`.slice(0, 200),
          version: PLUGIN_VERSION
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
  } catch (err) {
    log({ ts: Date.now(), event: "probe", reasonCode: "probe-schedule-error", reason: String(err?.message ?? err).slice(0, 200), version: PLUGIN_VERSION });
  } finally {
    probeRunning = false;
  }
  saveProbeFile();
}
function createHandler() {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://dsh.internal");
      const path = url.pathname;
      if (!path.startsWith(ROUTE_PREFIX)) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const route = path.slice(ROUTE_PREFIX.length) || "/";
      const method = req.method ?? "GET";
      if (method === "GET" && route === "/health") {
        sendJson(res, 200, {
          status: "ok",
          plugin: PLUGIN_NAME,
          version: PLUGIN_VERSION,
          uptime: process.uptime(),
          catalogSize: catalog.entries.length,
          catalogAgeMs: catalogAt > 0 ? Date.now() - catalogAt : null,
          // 排障关键：就绪 ≠ 完整。活宿主曾出现「就绪但只有 8 个 provider」，
          // 这两个字段能直接在 /health 上看出目录是不是还在长。
          catalogReady,
          catalogSettled: catalogSettled(),
          catalogProviders: catalogProviders.length,
          catalogProvidersAgeMs: catalogProvidersAt > 0 ? Date.now() - catalogProvidersAt : null,
          cooldownActive: cooldownActive(cooldown, Date.now()),
          sessionRecords: sessions.size,
          logRecords: logRing.size,
          pluginRecordChannel: sessionApi !== null
        });
        return;
      }
      if (method === "GET" && route === "/catalog") {
        const force = url.searchParams.get("refresh") === "1";
        const snapshot2 = await getCatalog(force);
        refreshOccupancy("catalog");
        sendJson(res, 200, catalogView(snapshot2));
        return;
      }
      if (method === "GET" && route === "/logs") {
        const limit = Math.max(1, Math.min(600, Number(url.searchParams.get("limit") ?? 100) || 100));
        sendJson(res, 200, { version: PLUGIN_VERSION, count: logRing.size, records: logRing.recent(limit) });
        return;
      }
      if (method === "GET" && route === "/occupancy") {
        refreshOccupancy("http");
        sendJson(res, 200, { occupancy, refreshedAt: lastOccupancyAt });
        return;
      }
      if (method === "GET" && route === "/config") {
        sendJson(res, 200, configView());
        return;
      }
      if (method === "POST" && route === "/config") {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: "forbidden", detail: "cross-origin request rejected" });
          return;
        }
        let bodyText;
        try {
          bodyText = await readBody(req);
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            sendJson(res, 413, { error: "payload too large", limit: MAX_BODY_BYTES });
            return;
          }
          sendJson(res, 400, { error: "bad request" });
          return;
        }
        let parsed = {};
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          sendJson(res, 400, { error: "invalid json" });
          return;
        }
        const result = await saveConfig(parsed);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }
      if (method === "POST" && route === "/select") {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        let bodyText;
        try {
          bodyText = await readBody(req);
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            sendJson(res, 413, { error: "payload too large", limit: MAX_BODY_BYTES });
            return;
          }
          sendJson(res, 400, { error: "bad request" });
          return;
        }
        let parsed = {};
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          sendJson(res, 400, { error: "invalid json" });
          return;
        }
        const sessionId = String(parsed?.sessionId ?? "");
        const provider = String(parsed?.provider ?? "");
        const model = String(parsed?.model ?? "");
        if (sessionId === "" || provider === "" || model === "") {
          sendJson(res, 400, { error: "sessionId / provider / model are required" });
          return;
        }
        const target = liveAgents().find((agent) => String(agent?.id ?? agent?.session?.id ?? "") === sessionId);
        if (target === void 0) {
          sendJson(res, 404, { error: "session not found", sessionId });
          return;
        }
        const snapshot2 = await getCatalog(false);
        const key = modelKey(provider, model);
        const entry = snapshot2.entries.find((candidate) => candidate.key === key);
        if (entry === void 0) {
          sendJson(res, 404, { error: "model not in catalog", provider, model });
          return;
        }
        if (entry.disabled === true || entry.hidden === true) {
          sendJson(res, 409, { error: "model is disabled or hidden", provider, model, reason: "\u672A\u5165\u7EC4\u6216\u5DF2\u505C\u7528" });
          return;
        }
        const selection = {
          key,
          provider,
          model,
          name: entry.name,
          kind: entry.kind,
          reasonCode: "manual",
          reason: "\u5728\u6A21\u578B\u4E0B\u62C9\u91CC\u624B\u52A8\u9009\u62E9",
          orderIndex: -1,
          idle: occupancy[key]?.inUse !== true,
          owners: occupancy[key]?.owners ?? []
        };
        const via = commitSelection(target, selection, "dropdown");
        const state = sessionState(sessionId, null, Date.now());
        state.current = selection;
        state.updatedAt = Date.now();
        refreshOccupancy("dropdown-select");
        log({
          ts: Date.now(),
          event: "select",
          sessionId,
          to: selection.key,
          reasonCode: "manual",
          reason: `\u4E0B\u62C9\u624B\u52A8\u9009\u62E9 \u2192 ${selection.key}`,
          via
        });
        sendJson(res, 200, { ok: true, sessionId, selection: { provider, model }, via });
        return;
      }
      if (method === "POST" && route === "/test-model") {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        let bodyText;
        try {
          bodyText = await readBody(req);
        } catch (err) {
          if (err === BODY_TOO_LARGE) {
            sendJson(res, 413, { error: "payload too large", limit: MAX_BODY_BYTES });
            return;
          }
          sendJson(res, 400, { error: "bad request" });
          return;
        }
        let parsed = {};
        try {
          parsed = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          sendJson(res, 400, { error: "invalid json" });
          return;
        }
        const provider = String(parsed?.provider ?? "");
        const model = String(parsed?.model ?? "");
        if (provider === "" || model === "") {
          sendJson(res, 400, { error: "provider / model are required" });
          return;
        }
        const snapshot2 = await getCatalog(false);
        const target = snapshot2.entries.find((candidate) => candidate.key === modelKey(provider, model));
        if (target === void 0) {
          sendJson(res, 404, { error: "model not in catalog", provider, model });
          return;
        }
        if (target.hidden === true) {
          sendJson(res, 409, { error: "model is hidden", provider, model, reason: "\u4E0D\u5C55\u793A\u7684\u6A21\u578B\u4E0D\u53C2\u4E0E\u8FDE\u901A\u6027\u6D4B\u8BD5" });
          return;
        }
        const result = await runModelProbe(provider, model);
        const entryKey = modelKey(provider, model);
        if (result.kind === "model" && !result.ok) {
          probeUnavailable.add(entryKey);
        } else {
          probeUnavailable.delete(entryKey);
        }
        saveProbeFile();
        log({
          ts: Date.now(),
          event: "probe",
          provider,
          model,
          ok: result.ok,
          ms: result.ms,
          reasonCode: result.ok ? "probe-ok" : result.kind === "model" ? "probe-fail" : "probe-infra",
          reason: result.ok ? `\u8FDE\u901A\u6027\u6D4B\u8BD5\u901A\u8FC7\uFF08${result.ms}ms\uFF09` : `\u8FDE\u901A\u6027\u6D4B\u8BD5\u5931\u8D25\uFF08${result.kind ?? "infra"}\uFF09\uFF1A${result.error ?? ""}`.slice(0, 200),
          version: PLUGIN_VERSION
        });
        sendJson(res, 200, {
          ok: result.ok,
          provider,
          model,
          ms: result.ms,
          ...result.sample === void 0 ? {} : { sample: result.sample },
          ...result.error === void 0 ? {} : { error: result.error }
        });
        return;
      }
      if (method === "POST" && route === "/cooldown/clear") {
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        const was = cooldown;
        cooldown = { until: 0, enteredAt: 0, reason: "" };
        modelCooldown.clear();
        for (const state of sessions.values()) state.excluded = [];
        if (cooldownTimer !== null) {
          clearTimeout(cooldownTimer);
          cooldownTimer = null;
        }
        log({ ts: Date.now(), event: "cooldown-end", reason: `\u4EBA\u5DE5\u6E05\u9664\u51B7\u5374\uFF08\u539F reason=${was.reason || "-"}\uFF09` });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (route === "/beacon") {
        if (method === "GET") {
          sendJson(res, 200, { count: beacons.length, beacons });
          return;
        }
        if (method === "POST") {
          if (!isSameOrigin(req)) {
            sendJson(res, 403, { error: "forbidden", detail: "cross-origin request rejected" });
            return;
          }
          let bodyText;
          try {
            bodyText = await readBody(req);
          } catch (err) {
            if (err === BODY_TOO_LARGE) {
              sendJson(res, 413, { error: "payload too large", limit: MAX_BODY_BYTES });
              return;
            }
            sendJson(res, 400, { error: "bad request" });
            return;
          }
          let parsed = {};
          try {
            parsed = bodyText ? JSON.parse(bodyText) : {};
          } catch {
            parsed = {};
          }
          beacons.push(sanitizeBeacon(parsed));
          if (beacons.length > MAX_BEACONS) beacons.splice(0, beacons.length - MAX_BEACONS);
          sendJson(res, 200, { ok: true });
          return;
        }
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: "internal error", detail: String(err) });
    }
  };
}
function apply(ctx, config = {}) {
  ctxRef = ctx;
  cfg = resolveConfig(readConfigRefs(config));
  log({ ts: Date.now(), event: "config", reason: "\u63D2\u4EF6\u542F\u52A8", version: PLUGIN_VERSION, maxRetries: cfg.maxRetries, cooldownMs: cfg.cooldownMs, preferIdle: cfg.preferIdle });
  void resolveSessionApi();
  ctx.on("agent/created", (payload) => {
    const agent = payload?.agent;
    const sessionId = String(agent?.id ?? agent?.session?.id ?? "");
    refreshOccupancy("agent-created");
    if (!cfg.enabled || sessionId.length === 0) return;
    void applySelection(agent, currentKind(preferredKeyFor(agent)), "agent-created", { allowPreferred: true });
  });
  ctx.on("agent/disposed", (payload) => {
    const agent = payload?.agent;
    const sessionId = String(agent?.id ?? agent?.session?.id ?? "");
    if (sessionId.length > 0) {
      sessions.delete(sessionId);
      modelCooldown.delete(sessionId);
    }
    refreshOccupancy("agent-disposed");
  });
  ctx.on("agent/status", () => {
    refreshOccupancy("agent-status");
  });
  ctx.on(ADAPTERS_EVENT, () => {
    catalogProvidersAt = Date.now();
    scheduleCatalogRefresh();
  });
  ctx.on("agent/request-error", (payload, next) => {
    if (!cfg.enabled) return next();
    return (async () => {
      let decision;
      try {
        decision = await handleRequestError(payload);
      } catch (err) {
        log({
          ts: Date.now(),
          event: "giveup",
          reasonCode: "internal-error",
          reason: "\u5207\u6362\u903B\u8F91\u5185\u90E8\u5F02\u5E38\uFF0C\u4EA4\u56DE\u5BBF\u4E3B",
          failureMessage: String(err?.message ?? err)
        });
        return next();
      }
      if (decision?.kind === "retry") return decision;
      return next();
    })();
  });
  occupancyTimer = setInterval(() => refreshOccupancy("timer"), Math.max(1e3, cfg.occupancyRefreshMs));
  if (typeof occupancyTimer?.unref === "function") occupancyTimer.unref();
  if (cfg.probeIntervalMin > 0) {
    probeTimer = setInterval(() => {
      void runScheduledProbe();
    }, Math.max(6e4, cfg.probeIntervalMin * 6e4));
    if (typeof probeTimer?.unref === "function") probeTimer.unref();
  }
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, state] of sessions) {
      const live = liveAgents().some((agent) => String(agent?.id ?? agent?.session?.id ?? "") === sessionId);
      if (!live && now - state.updatedAt > SESSION_STATE_TTL_MS) {
        sessions.delete(sessionId);
        modelCooldown.delete(sessionId);
      }
    }
  }, 10 * 60 * 1e3);
  if (typeof sweeper?.unref === "function") sweeper.unref();
  ctx.effect(() => () => {
    if (cooldownTimer !== null) clearTimeout(cooldownTimer);
    if (adaptersTimer !== null) clearTimeout(adaptersTimer);
    if (occupancyTimer !== null) clearInterval(occupancyTimer);
    clearInterval(sweeper);
    if (probeTimer !== null) clearInterval(probeTimer);
    cooldownTimer = null;
    adaptersTimer = null;
    occupancyTimer = null;
    probeTimer = null;
  }, "model-auto-select: timers");
  const webServer = ctx?.webServer;
  if (webServer === void 0 || webServer === null || typeof webServer.register !== "function") {
    log({ ts: Date.now(), event: "config", reason: "webServer \u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u8DEF\u7531\u6CE8\u518C\uFF08\u5BA2\u6237\u7AEF\u5C06\u53EA\u663E\u793A\u9759\u6001\u6807\u6CE8\uFF09" });
    return;
  }
  const g = globalThis;
  const stale = g[ROUTE_REGISTRY_KEY];
  if (typeof stale === "function") {
    try {
      stale();
      log({ ts: Date.now(), event: "config", reason: "\u5DF2\u62C6\u9664\u4E0A\u4E00\u5B9E\u4F8B\u9057\u7559\u7684\u8DEF\u7531\uFF08\u907F\u514D duplicate prefix route\uFF09" });
    } catch (err) {
      log({ ts: Date.now(), event: "config", reason: `\u62C6\u9664\u9057\u7559\u8DEF\u7531\u5931\u8D25\uFF1A${String(err?.message ?? err).slice(0, 200)}` });
    }
    delete g[ROUTE_REGISTRY_KEY];
  }
  try {
    const tables = [webServer?.prefixes, webServer?.exact];
    for (const table of tables) {
      if (table instanceof Map && table.has(ROUTE_PREFIX)) {
        table.delete(ROUTE_PREFIX);
        log({
          ts: Date.now(),
          event: "config",
          reason: "\u5DF2\u6E05\u7406\u8DEF\u7531\u8868\u91CC\u7684\u50F5\u5C38\u8DEF\u7531\uFF08\u4E0A\u4E00\u5B9E\u4F8B\u672A\u6CE8\u9500\uFF09\uFF0C\u65B0\u5B9E\u4F8B\u63A5\u7BA1\u8BE5\u524D\u7F00"
        });
      }
    }
  } catch (err) {
    log({ ts: Date.now(), event: "config", reason: `\u6E05\u7406\u50F5\u5C38\u8DEF\u7531\u5931\u8D25\uFF1A${String(err?.message ?? err).slice(0, 200)}` });
  }
  let disposeRoute;
  try {
    disposeRoute = webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: createHandler() });
  } catch (err) {
    log({
      ts: Date.now(),
      event: "config",
      reason: `\u8DEF\u7531\u6CE8\u518C\u5931\u8D25\uFF1A${String(err?.message ?? err).slice(0, 200)}\uFF08\u82E5\u63D0\u793A duplicate prefix route\uFF0C\u9700\u91CD\u542F dsh \u8FDB\u7A0B\u6E05\u7406\u8DEF\u7531\u8868\uFF09`
    });
    throw err;
  }
  if (typeof disposeRoute === "function") {
    g[ROUTE_REGISTRY_KEY] = disposeRoute;
    ctx.effect(() => () => {
      try {
        disposeRoute();
      } catch (err) {
        log({ ts: Date.now(), event: "config", reason: `\u8DEF\u7531\u6CE8\u9500\u5931\u8D25\uFF1A${String(err?.message ?? err).slice(0, 200)}` });
      }
      if (g[ROUTE_REGISTRY_KEY] === disposeRoute) delete g[ROUTE_REGISTRY_KEY];
    }, "model-auto-select: route");
  } else {
    log({ ts: Date.now(), event: "config", reason: "webServer.register \u672A\u8FD4\u56DE disposer\uFF0C\u91CD\u542F\u65F6\u53EF\u80FD\u649E\u91CD\u590D\u524D\u7F00\u8DEF\u7531" });
  }
  log({ ts: Date.now(), event: "config", reason: `\u8DEF\u7531\u5DF2\u6CE8\u518C\uFF1AGET ${ROUTE_PREFIX}/catalog`, version: PLUGIN_VERSION });
  if (typeof ctx?.inject === "function") {
    try {
      ctx.inject(["settings"], (child) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
      });
    } catch (err) {
      log({ ts: Date.now(), event: "config", reason: `settings.configure \u63A5\u7EBF\u5931\u8D25\uFF1A${String(err?.message ?? err).slice(0, 200)}` });
    }
  }
  void getCatalog(true);
  try {
    for (const k of loadProbeFile()) {
      if (typeof k === "string" && k.length > 0) probeUnavailable.add(k);
    }
  } catch {
  }
}
var __test = {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  ROUTE_PREFIX,
  resolveConfig,
  readConfigRefs,
  Config,
  getCatalog,
  applySelection,
  handleRequestError,
  refreshOccupancy,
  enterCooldown,
  wakeFromCooldown,
  catalogView,
  configView,
  saveConfig,
  coercePatch,
  CONFIG_FIELDS,
  state: () => ({
    cfg,
    catalog,
    catalogAt,
    catalogReady,
    catalogProviders,
    catalogProvidersAt,
    catalogSettled,
    cooldown,
    occupancy,
    sessions,
    logRing,
    // 冷却期抑制日志的节流状态（测试用来把「上一次记录时间」往回拨，模拟分钟级间隔）
    cooldownSuppressLogAt: () => cooldownSuppressLogAt,
    rewindCooldownSuppressLog: (ms) => {
      cooldownSuppressLogAt -= ms;
    },
    // 仅供测试：把目录生成时间往回拨，模拟「目录已就绪但 TTL 已过期」，
    // 让 getCatalog(false) 越过 TTL 短绕、落到冷却抑制分支，验证节流日志逻辑。
    rewindCatalogAt: (ms) => {
      catalogAt -= ms;
    },
    // 仅供测试：把「provider 集合刚变过」的时间戳清零 = 视为集合早已稳定，
    // 否则所有在 getCatalog(true) 之后立刻断言冷却/无候选的用例都会落进 settling 分支。
    settleCatalog: () => {
      catalogProvidersAt = 0;
    }
  }),
  runScheduledProbe,
  probeUnavailableKeys: () => [...probeUnavailable],
  reset: () => {
    catalog = { generatedAt: 0, entries: [], failures: [], providerCount: 0 };
    catalogAt = 0;
    catalogReady = false;
    catalogProviders = [];
    catalogProvidersAt = 0;
    catalogRefreshAttempts = 0;
    if (adaptersTimer !== null) clearTimeout(adaptersTimer);
    adaptersTimer = null;
    cooldown = { until: 0, enteredAt: 0, reason: "" };
    cooldownSuppressLogAt = 0;
    cooldownSuppressCount = 0;
    occupancy = {};
    sessions.clear();
    modelCooldown.clear();
    modalityCache.clear();
    probeUnavailable.clear();
    probeRunning = false;
    if (probeTimer !== null) clearInterval(probeTimer);
    probeTimer = null;
  },
  setContext: (ctx, config = {}) => {
    ctxRef = ctx;
    cfg = resolveConfig(readConfigRefs(config));
  },
  // 仅供测试：暴露持久化文件路径与强制落盘，便于 fail-closed 测试注入预置文件并断言写回。
  probeFile: PROBE_FILE,
  saveProbeFile
};
export {
  Config,
  __test,
  apply,
  inject,
  name
};
