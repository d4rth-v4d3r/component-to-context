/** Dev-only helpers: read React internal fibers from DOM nodes. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fiber = any;

function looksLikeFiber(node: unknown): node is Fiber {
  if (node == null || typeof node !== "object") return false;
  const f = node as { tag?: unknown; return?: unknown; child?: unknown };
  return typeof f.tag === "number";
}

export function normalizeDevPath(file: string): string {
  let s = file.trim();
  s = s.replace(/^webpack-internal:\/\/(\/\/)?/i, "");
  s = s.replace(/^webpack:\/\//i, "");
  s = s.replace(/^\(app-pages-browser\)\//, "");
  s = s.replace(/^\(app-client\)\//, "");
  s = s.replace(/^\(ssr\)\//, "");
  s = s.replace(/^file:\/\/\//, "");
  s = s.replace(/^file:\/\//, "");
  return s.replace(/\\/g, "/");
}

/**
 * React stores `__reactFiber$…` on DOM nodes. Those keys are often **non-enumerable**,
 * so `Object.keys` misses them — use `Reflect.ownKeys`.
 * React 19 may expose `element._reactInternals` (same fiber reference).
 */
function getFiberFromDevToolsRenderers(el: Element): Fiber | null {
  try {
    const hook = (
      window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
          renderers?: Map<
            number,
            { findFiberByHostInstance?: (n: Element | Text) => unknown }
          >;
        };
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const renderers = hook?.renderers;
    if (!renderers?.size) return null;
    for (const [, renderer] of renderers) {
      const fn = renderer?.findFiberByHostInstance;
      if (typeof fn === "function") {
        const f = fn(el);
        if (looksLikeFiber(f)) return f as Fiber;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getFiberFromElement(el: Element): Fiber | null {
  const anyEl = el as Record<string | symbol, unknown>;

  if (anyEl._reactInternals != null) {
    const ri = anyEl._reactInternals;
    if (looksLikeFiber(ri)) return ri as Fiber;
    const root = ri as { current?: unknown };
    if (looksLikeFiber(root.current)) return root.current as Fiber;
  }

  for (const key of Reflect.ownKeys(el)) {
    if (typeof key === "string") {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
        const f = anyEl[key];
        if (looksLikeFiber(f)) return f as Fiber;
      }
    } else {
      const v = anyEl[key as symbol];
      if (looksLikeFiber(v)) return v as Fiber;
    }
  }

  return getFiberFromDevToolsRenderers(el);
}

/** Walk DOM ancestors and try shadow/composed paths. */
export function getFiberFromNode(start: Node | null): Fiber | null {
  let el: Element | null =
    start instanceof Element ? start : start?.parentElement ?? null;
  let hops = 0;
  while (el && hops < 80) {
    const fiber = getFiberFromElement(el);
    if (fiber) return fiber;
    el = el.parentElement;
    hops++;
  }
  return null;
}

/** Prefer the event path (shadow DOM, portals) over `target` alone. */
export function getFiberFromComposedPath(ev: Event): Fiber | null {
  const path = ev.composedPath();
  for (const n of path) {
    const el =
      n instanceof Element ? n : n instanceof Text ? (n.parentElement as Element | null) : null;
    if (el) {
      const fiber = getFiberFromElement(el);
      if (fiber) return fiber;
    }
  }
  return getFiberFromNode(ev.target instanceof Node ? ev.target : null);
}

const REACT_MEMO_TYPE = Symbol.for("react.memo");
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const REACT_LAZY_TYPE = Symbol.for("react.lazy");

function getDisplayNameForType(type: unknown, depth = 0): string | null {
  if (depth > 12) return null;
  if (type == null) return null;
  if (typeof type === "string") return null;
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    const n = fn.displayName || fn.name || null;
    if (n && n !== "Anonymous") return n;
    if (n) return n;
    return null;
  }
  if (typeof type === "object") {
    const o = type as {
      $$typeof?: symbol;
      render?: unknown;
      type?: unknown;
      displayName?: string;
      _payload?: { _result?: unknown };
    };
    if (o.$$typeof === REACT_MEMO_TYPE && o.type != null) {
      return getDisplayNameForType(o.type, depth + 1);
    }
    if (o.$$typeof === REACT_FORWARD_REF_TYPE) {
      if (typeof o.render === "function") {
        const r = o.render as { displayName?: string; name?: string };
        const n = o.displayName || r.displayName || r.name || null;
        if (n && n !== "Anonymous") return n;
      }
      if (o.type) return getDisplayNameForType(o.type, depth + 1);
    }
    if (o.$$typeof === REACT_LAZY_TYPE && o._payload) {
      const res = (o._payload as { _result?: unknown })._result;
      if (res != null) return getDisplayNameForType(res, depth + 1);
    }
    if (typeof o.render === "function") {
      const r = o.render as { displayName?: string; name?: string };
      const n = o.displayName || r.displayName || r.name || null;
      if (n) return n;
    }
    if (o.type != null) {
      const inner = getDisplayNameForType(o.type, depth + 1);
      if (inner) return inner;
    }
    if (o.displayName) return o.displayName;
  }
  return null;
}

function getNameFromFiber(fiber: Fiber): string | null {
  const type = fiber?.elementType ?? fiber?.type;
  return getDisplayNameForType(type);
}

/** Prefer innermost (closest to leaf) real name; skip host-only fibers. */
function resolveNameWalkingUp(start: Fiber | null): string {
  let f: Fiber | null = start;
  for (let d = 0; f && d < 120; d++) {
    if (typeof f.type === "string") {
      f = f.return;
      continue;
    }
    const name = getNameFromFiber(f);
    if (name && name !== "Anonymous") {
      return name;
    }
    f = f.return;
  }
  return "Anonymous";
}

/** React dev: walk fiber then _debugOwner chain (often escapes anonymous HOC wrappers). */
function walkDebugOwnersForName(start: Fiber | null): string | null {
  let f: Fiber | null = start;
  for (let d = 0; f && d < 40; d++) {
    if (typeof f.type !== "string") {
      const name = getNameFromFiber(f);
      if (name && name !== "Anonymous") return name;
    }
    f = (f._debugOwner as Fiber | null) ?? null;
  }
  return null;
}

function resolveDisplayName(start: Fiber | null): string {
  if (!start) return "Anonymous";
  const fromOwner = walkDebugOwnersForName(start);
  if (fromOwner) return fromOwner;
  return resolveNameWalkingUp(start);
}

function getDebugSource(fiber: Fiber): { fileName?: string; lineNumber?: number } | null {
  const src = fiber?._debugSource;
  if (src && typeof src.fileName === "string") {
    return {
      fileName: src.fileName,
      lineNumber: typeof src.lineNumber === "number" ? src.lineNumber : undefined,
    };
  }
  return null;
}

/** React 19+ may stash paths on `_debugInfo`; some bundles omit `_debugSource` on inner fibers. */
function getDebugSourceExtended(fiber: Fiber | null): ReturnType<typeof getDebugSource> | null {
  if (!fiber) return null;
  const base = getDebugSource(fiber);
  if (base?.fileName) return base;
  const di = fiber._debugInfo;
  if (di && typeof di === "object" && !Array.isArray(di)) {
    const o = di as Record<string, unknown>;
    if (typeof o.fileName === "string") {
      return {
        fileName: o.fileName,
        lineNumber: typeof o.lineNumber === "number" ? o.lineNumber : undefined,
      };
    }
  }
  return null;
}

function walkDebugOwnersForSourceExtended(
  start: Fiber | null,
): ReturnType<typeof getDebugSource> | null {
  let f: Fiber | null = start;
  for (let d = 0; f && d < 60; d++) {
    const s = getDebugSourceExtended(f);
    if (s?.fileName) return s;
    f = (f._debugOwner as Fiber | null) ?? null;
  }
  return null;
}

function walkReturnForSourceExtended(start: Fiber | null): ReturnType<typeof getDebugSource> | null {
  let f: Fiber | null = start;
  for (let d = 0; f && d < 150; d++) {
    const s = getDebugSourceExtended(f);
    if (s?.fileName) return s;
    f = f.return;
  }
  return null;
}

/** Innermost non-Anonymous name (return chain, then _debugOwner). */
function nearestNonAnonymousNameOnly(start: Fiber | null): string | null {
  let f: Fiber | null = start;
  for (let d = 0; f && d < 150; d++) {
    if (typeof f.type === "string") {
      f = f.return;
      continue;
    }
    const name = getNameFromFiber(f);
    if (name && name !== "Anonymous") return name;
    f = f.return;
  }
  let o: Fiber | null = start;
  for (let d = 0; o && d < 80; d++) {
    if (typeof o.type !== "string") {
      const name = getNameFromFiber(o);
      if (name && name !== "Anonymous") return name;
    }
    o = (o._debugOwner as Fiber | null) ?? null;
  }
  return null;
}

/** `edit-customer-form.tsx` → `EditCustomerForm` when React names are anonymous wrappers. */
function guessNameFromPath(filePath: string): string | null {
  const base = filePath.split("/").pop()?.replace(/\.(tsx?|jsx?|mjs|cjs|js)$/, "") ?? "";
  if (!base || base === "index" || base === "unknown") return null;
  const parts = base.split(/[-_.]/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join("");
}

/**
 * Walk the return chain to find the best fiber: prefer named component with _debugSource,
 * else first named component, else collect any _debugSource from ancestors for filename-first.
 */
export function findBestFiber(start: Fiber | null): Fiber | null {
  if (!start) return null;
  let f: Fiber | null = start;
  let bestWithSource: Fiber | null = null;
  let bestNamed: Fiber | null = null;
  let depth = 0;
  while (f && depth < 80) {
    const name = getNameFromFiber(f);
    const src = getDebugSourceExtended(f);
    if (name && src) {
      return f;
    }
    if (name && !bestNamed) bestNamed = f;
    if (src && !bestWithSource) bestWithSource = f;
    f = f.return;
    depth++;
  }
  return bestNamed || bestWithSource || start;
}

/**
 * Nearest ancestor (walking `return`, then `_debugOwner`) that has both a real name and
 * `_debugSource.fileName` — matches “nearest non-anonymous parent” in DevTools.
 */
function nearestNonAnonymousWithFile(start: Fiber | null): { name: string; file: string } | null {
  let f: Fiber | null = start;
  for (let d = 0; f && d < 120; d++) {
    if (typeof f.type === "string") {
      f = f.return;
      continue;
    }
    const name = getNameFromFiber(f);
    const src = getDebugSourceExtended(f);
    if (name && name !== "Anonymous" && src?.fileName) {
      return { name, file: normalizeDevPath(src.fileName) };
    }
    f = f.return;
  }
  let o: Fiber | null = start;
  for (let d = 0; o && d < 50; d++) {
    if (typeof o.type !== "string") {
      const name = getNameFromFiber(o);
      const src = getDebugSourceExtended(o);
      if (name && name !== "Anonymous" && src?.fileName) {
        return { name, file: normalizeDevPath(src.fileName) };
      }
    }
    o = (o._debugOwner as Fiber | null) ?? null;
  }
  return null;
}

export function resolvePickFromFiber(fiber: Fiber | null): {
  file: string;
  line: string;
  name: string;
  /** When true, format as `@file Name (route)` — no `:line` (parent fallback / guessed name). */
  omitLine: boolean;
} {
  if (!fiber) {
    return { file: "unknown", line: "?", name: "Anonymous", omitLine: true };
  }

  const start = fiber;
  const best = findBestFiber(fiber);

  let name: string | null =
    nearestNonAnonymousNameOnly(start) || walkDebugOwnersForName(start);

  if (!name) {
    const rw = resolveNameWalkingUp(start);
    name = rw !== "Anonymous" ? rw : "Anonymous";
  }

  let src: ReturnType<typeof getDebugSource> | null =
    getDebugSourceExtended(start) ||
    walkDebugOwnersForSourceExtended(start) ||
    walkReturnForSourceExtended(start) ||
    (best ? walkReturnForSourceExtended(best) : null);

  let file = "unknown";
  let line: string = "?";
  if (src?.fileName) {
    file = normalizeDevPath(src.fileName);
    if (typeof src.lineNumber === "number" && Number.isFinite(src.lineNumber)) {
      line = String(src.lineNumber);
    }
  }

  let omitLine = false;

  if (name === "Anonymous" && file !== "unknown") {
    const guessed = guessNameFromPath(file);
    if (guessed) {
      name = guessed;
      omitLine = true;
    }
  }

  if (name === "Anonymous") {
    const combo = nearestNonAnonymousWithFile(best);
    if (combo) {
      name = combo.name;
      file = combo.file;
      omitLine = true;
      line = "?";
    }
  }

  if (file === "unknown" && name === "Anonymous" && best) {
    const combo = nearestNonAnonymousWithFile(best);
    if (combo) {
      name = combo.name;
      file = combo.file;
      omitLine = true;
    }
  }

  if (omitLine) {
    line = "?";
  }

  return { file, line, name, omitLine };
}

const MAX_JSON_LEN = 12_000;
const MAX_DEPTH = 5;
const MAX_KEYS = 48;
const MAX_STR = 800;

export function serializePropsForContext(props: unknown): string | null {
  if (props == null || typeof props !== "object") return null;

  const seen = new WeakSet<object>();

  function sanitize(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return "[MaxDepth]";
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.length > MAX_STR ? `${value.slice(0, MAX_STR)}…` : value;
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "undefined") return "[undefined]";
    if (typeof value === "function") return `[function ${(value as Function).name || "anonymous"}]`;
    if (typeof value === "symbol") return String(value);
    if (value instanceof Node) return `[DOM ${value.nodeName}]`;
    if (typeof value === "object") {
      if (seen.has(value as object)) return "[Circular]";
      seen.add(value as object);
      if (Array.isArray(value)) {
        const out: unknown[] = [];
        const cap = Math.min(value.length, 40);
        for (let i = 0; i < cap; i++) out.push(sanitize(value[i], depth + 1));
        if (value.length > cap) out.push(`… +${value.length - cap} more`);
        return out;
      }
      const out: Record<string, unknown> = {};
      const keys = Object.keys(value as object).slice(0, MAX_KEYS);
      for (const k of keys) {
        if (k === "children" && depth === 0) {
          out[k] = "[React children]";
          continue;
        }
        try {
          out[k] = sanitize((value as Record<string, unknown>)[k], depth + 1);
        } catch {
          out[k] = "[Unreadable]";
        }
      }
      return out;
    }
    return String(value);
  }

  try {
    const raw = JSON.stringify(sanitize(props, 0), null, 2);
    if (!raw || raw === "{}") return null;
    if (raw.length > MAX_JSON_LEN) {
      return `${raw.slice(0, MAX_JSON_LEN)}\n… [truncated]`;
    }
    return raw;
  } catch {
    return null;
  }
}

export function getMemoizedProps(fiber: Fiber | null): unknown {
  const best = findBestFiber(fiber);
  return best?.memoizedProps ?? null;
}
