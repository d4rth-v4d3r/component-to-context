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
  s = s.replace(/\\/g, "/");
  // Webpack/Next often append ?cacheKey (e.g. `.../_app.tsx?f9d6`); without this,
  // `.tsx` is not at end-of-string and we skip the file for tsx matching + guessing.
  const q = s.indexOf("?");
  if (q !== -1) s = s.slice(0, q);
  const h = s.indexOf("#");
  if (h !== -1) s = s.slice(0, h);
  // Next.js dev bundles use namespace `webpack://_N_E/...` (often `_N_E/./src/...`)
  s = s.replace(/^_N_E\//, "");
  // Webpack emits `./src/...` after stripping the namespace; drop leading `./`
  s = s.replace(/^\.\//, "");
  // Collapse `/./` segments (e.g. `src/./components` → `src/components`)
  s = s.replace(/\/\.\//g, "/");
  // DevTools sometimes shows `file.tsx:line:column` in one string (no `?` before line/col)
  s = s.replace(/(\.(?:tsx|jsx|ts|js|mjs|cjs)):\d+(?::\d+)?$/i, "$1");
  return s;
}

const LS_DEBUG_KEY = "REACT_CONTEXT_PICKER_DEBUG";

/** Same flag as content script: `localStorage.setItem('REACT_CONTEXT_PICKER_DEBUG','1')` + refresh. */
export function isPickerDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(LS_DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * React stores `__reactFiber$…` on DOM nodes. Those keys are often **non-enumerable**,
 * so `Object.keys` misses them — use `Reflect.ownKeys`.
 * React 19 may expose `element._reactInternals` (same fiber reference).
 */
function getFiberFromDevToolsRenderers(host: Element | Text): Fiber | null {
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
        const f = fn(host);
        if (looksLikeFiber(f)) return f as Fiber;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fiberFromReactKeys(host: Element | Text): Fiber | null {
  const anyHost = host as Record<string | symbol, unknown>;
  for (const key of Reflect.ownKeys(host)) {
    if (typeof key === "string") {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
        const f = anyHost[key];
        if (looksLikeFiber(f)) return f as Fiber;
      }
    } else {
      const v = anyHost[key as symbol];
      if (looksLikeFiber(v)) return v as Fiber;
    }
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

  const fromKeys = fiberFromReactKeys(el);
  if (fromKeys) return fromKeys;

  return getFiberFromDevToolsRenderers(el);
}

/**
 * React attaches `__reactFiber$…` to **Text** as well as **Element** host instances.
 * We previously only checked parents of Text — clicks on labels often hit Text nodes first.
 */
export function getFiberFromHostInstance(host: Element | Text): Fiber | null {
  if (host instanceof Text) {
    const k = fiberFromReactKeys(host);
    if (k) return k;
    return getFiberFromDevToolsRenderers(host);
  }
  return getFiberFromElement(host);
}

/** Walk DOM ancestors (including Text nodes) and try shadow/composed paths. */
export function getFiberFromNode(start: Node | null): Fiber | null {
  let n: Node | null = start;
  for (let hops = 0; n && hops < 200; hops++) {
    if (n instanceof Element || n instanceof Text) {
      const fiber = getFiberFromHostInstance(n);
      if (fiber) return fiber;
    }
    n = n.parentNode;
  }
  return null;
}

/** Prefer the event path (shadow DOM, portals) over `target` alone. */
export function getFiberFromComposedPath(ev: Event): Fiber | null {
  const path = ev.composedPath();
  for (const n of path) {
    if (n instanceof Element || n instanceof Text) {
      const fiber = getFiberFromHostInstance(n);
      if (fiber) return fiber;
    }
  }
  return getFiberFromNode(ev.target instanceof Node ? ev.target : null);
}

/** DevTools renderer count (0 often means prod build or non-React page). */
export function getReactDevtoolsRendererCount(): number {
  try {
    const hook = (
      globalThis as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<unknown, unknown> };
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    return hook?.renderers?.size ?? 0;
  } catch {
    return 0;
  }
}

/** When no fiber is found — log actionable context if debug is on. */
export function logFiberLookupMiss(ev: MouseEvent): void {
  if (!isPickerDebugEnabled()) return;
  const path = ev.composedPath();
  const summary = path.slice(0, 14).map((n) => {
    if (n instanceof Window) return "Window";
    if (n instanceof Document) return "Document";
    if (n instanceof Element) return `<${n.tagName.toLowerCase()}>`;
    if (n instanceof Text) return `#text`;
    return n?.constructor?.name ?? String(n);
  });
  console.info("[React Context Picker][fiber]", "fiber_lookup_miss", {
    target: ev.target instanceof Node ? ev.target.nodeName : typeof ev.target,
    pathHead: summary,
    reactDevtoolsRenderers: getReactDevtoolsRendererCount(),
    hint:
      "Isolated content script cannot read __reactFiber$ on DOM (Chrome); page-world bridge runs next. If still miss: closed shadow DOM, iframe without all_frames, or non-React DOM.",
  });
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

/** Nearest named non-anonymous component from clicked leaf that has a debug file. */
export function nearestLeafNamedWithFile(start: Fiber | null): string | null {
  const lf = nearestLeafFiberWithFile(start);
  return lf ? getNameFromFiber(lf) : null;
}

/** Fiber for {@link nearestLeafNamedWithFile} (e.g. Typography under a form). */
export function nearestLeafFiberWithFile(start: Fiber | null): Fiber | null {
  let f: Fiber | null = start;
  for (let d = 0; f && d < 180; d++) {
    if (typeof f.type === "string") {
      f = f.return;
      continue;
    }
    const n = getNameFromFiber(f);
    const s = getDebugSourceExtended(f);
    if (n && n !== "Anonymous" && s?.fileName) return f;
    f = f.return;
  }
  let o: Fiber | null = start;
  for (let d = 0; o && d < 80; d++) {
    if (typeof o.type !== "string") {
      const n = getNameFromFiber(o);
      const s = getDebugSourceExtended(o);
      if (n && n !== "Anonymous" && s?.fileName) return o;
    }
    o = (o._debugOwner as Fiber | null) ?? null;
  }
  return null;
}

/** Shared with {@link resolveOutermostNamedInSameFile} / {@link resolveOutermostFiberInSameFile}. */
const OUTERMOST_GENERIC_RUNTIME_NAMES = new Set([
  "Provider",
  "FormProvider",
  "Box",
  "Grid",
  "Stack",
  "Dialog",
  "DialogContent",
  "DialogTitle",
  "DialogActions",
  "TextField",
  "Button",
  "IconButton",
  "Typography",
  "Container",
  "Paper",
  "Card",
  "Fragment",
  /** react-hook-form — prefer the real page/form component */
  "Controller",
]);

/**
 * Walk upward and return the outermost named component that still maps to the same source file.
 * Useful when nested JSX in one file should collapse to the top-level parent component.
 */
export function resolveOutermostNamedInSameFile(start: Fiber | null): {
  name: string;
  file: string;
  line: string;
} | null {
  const fib = resolveOutermostFiberInSameFile(start);
  if (!fib) return null;
  const s = getDebugSourceExtended(fib);
  const n = getNameFromFiber(fib);
  if (!n || !s?.fileName) return null;
  return {
    name: n,
    file: normalizeDevPath(s.fileName),
    line: typeof s.lineNumber === "number" && Number.isFinite(s.lineNumber) ? String(s.lineNumber) : "?",
  };
}

/**
 * Outermost named fiber in the same source file as the anchor (prefers non-generic names like MyForm over FormProvider).
 */
export function resolveOutermostFiberInSameFile(start: Fiber | null): Fiber | null {
  if (!start) return null;

  const best = findBestFiber(start);
  const baseSrc =
    nearestTsxJsxSourceFromFiber(start) ||
    nearestTsxJsxSourceFromFiber(best) ||
    getDebugSourceExtended(start) ||
    walkReturnForSourceExtended(start);
  if (!baseSrc?.fileName) return null;
  const baseFile = normalizeDevPath(baseSrc.fileName);

  const preferred: Array<{ fiber: Fiber; depth: number }> = [];
  const generic: Array<{ fiber: Fiber; depth: number }> = [];
  let f: Fiber | null = start;
  for (let d = 0; f && d < 220; d++) {
    if (typeof f.type === "string") {
      f = f.return;
      continue;
    }
    const n = getNameFromFiber(f);
    const s = getDebugSourceExtended(f);
    if (!n || n === "Anonymous" || !s?.fileName) {
      f = f.return;
      continue;
    }
    const currentFile = normalizeDevPath(s.fileName);
    if (currentFile === baseFile) {
      const entry = { fiber: f, depth: d };
      if (OUTERMOST_GENERIC_RUNTIME_NAMES.has(n)) {
        generic.push(entry);
      } else {
        preferred.push(entry);
      }
    }
    f = f.return;
  }
  const pool = preferred.length ? preferred : generic;
  if (!pool.length) return null;
  pool.sort((a, b) => b.depth - a.depth);
  return pool[0].fiber;
}

/**
 * Outermost non-generic fiber whose **debug source file** equals `targetFile` (walk `return` from `start`).
 * Used so the parent row shows EditCustomerForm instead of FormProvider when both map to the same file.
 */
export function resolveOutermostFiberForSourceFile(start: Fiber | null, targetFile: string): Fiber | null {
  if (!start) return null;
  const target = normalizeDevPath(targetFile);
  const preferred: Array<{ fiber: Fiber; depth: number; name: string }> = [];
  const generic: Array<{ fiber: Fiber; depth: number; name: string }> = [];
  let f: Fiber | null = start;
  for (let d = 0; f && d < 220; d++) {
    if (typeof f.type === "string") {
      f = f.return;
      continue;
    }
    const n = getNameFromFiber(f);
    const s = getDebugSourceExtended(f);
    if (!n || n === "Anonymous" || !s?.fileName) {
      f = f.return;
      continue;
    }
    const currentFile = normalizeDevPath(s.fileName);
    if (currentFile !== target) {
      f = f.return;
      continue;
    }
    const entry = { fiber: f, depth: d, name: n };
    if (OUTERMOST_GENERIC_RUNTIME_NAMES.has(n)) {
      generic.push(entry);
    } else {
      preferred.push(entry);
    }
    f = f.return;
  }
  const pool = preferred.length ? preferred : generic;
  if (!pool.length) return null;
  pool.sort((a, b) => b.depth - a.depth);
  return pool[0].fiber;
}

function isTsxOrJsxPath(filePath: string): boolean {
  return /\.(tsx|jsx)$/i.test(filePath);
}

function shortTypeDesc(type: unknown): string {
  if (type == null) return "null";
  if (typeof type === "string") return type.length > 48 ? `${type.slice(0, 48)}…` : type;
  if (typeof type === "function") {
    const fn = type as { name?: string; displayName?: string };
    return fn.displayName || fn.name || "function";
  }
  if (typeof type === "object") {
    const o = type as { displayName?: string; $$typeof?: symbol };
    if (o.displayName) return o.displayName;
    return "[object]";
  }
  return String(type);
}

function snapshotReturnChain(start: Fiber | null, max: number): unknown[] {
  const out: unknown[] = [];
  let f: Fiber | null = start;
  for (let d = 0; f && d < max; d++) {
    const typ = f.elementType ?? f.type;
    const s = getDebugSourceExtended(f);
    const raw = s?.fileName ?? null;
    const norm = raw ? normalizeDevPath(raw) : null;
    out.push({
      d,
      tag: f.tag,
      isHost: typeof typ === "string",
      type: typeof typ === "string" ? typ : shortTypeDesc(typ),
      name: getNameFromFiber(f),
      rawFile: raw,
      normFile: norm,
      isTsxOrJsx: Boolean(norm && isTsxOrJsxPath(norm)),
    });
    f = f.return;
  }
  return out;
}

function snapshotOwnerChain(start: Fiber | null, max: number): unknown[] {
  const out: unknown[] = [];
  let f: Fiber | null = start;
  for (let d = 0; f && d < max; d++) {
    if (typeof f.type !== "string") {
      const s = getDebugSourceExtended(f);
      const raw = s?.fileName ?? null;
      const norm = raw ? normalizeDevPath(raw) : null;
      out.push({
        d,
        tag: f.tag,
        type: shortTypeDesc(f.elementType ?? f.type),
        name: getNameFromFiber(f),
        rawFile: raw,
        normFile: norm,
        isTsxOrJsx: Boolean(norm && isTsxOrJsxPath(norm)),
      });
    }
    f = (f._debugOwner as Fiber | null) ?? null;
  }
  return out;
}

/**
 * Innermost fiber (walking `return`, then `_debugOwner`) whose debug path ends in
 * `.tsx`/`.jsx` — same anchor we use for the picked **file**; **name** should align
 * with this fiber (walk up for first non-Anonymous component).
 */
function findNearestTsxFiber(start: Fiber | null): Fiber | null {
  const tryChain = (f: Fiber | null): Fiber | null => {
    let x: Fiber | null = f;
    for (let d = 0; x && d < 150; d++) {
      if (typeof x.type === "string") {
        x = x.return;
        continue;
      }
      const s = getDebugSourceExtended(x);
      if (s?.fileName) {
        const norm = normalizeDevPath(s.fileName);
        if (isTsxOrJsxPath(norm)) return x;
      }
      x = x.return;
    }
    let o: Fiber | null = f;
    for (let d = 0; o && d < 80; d++) {
      if (typeof o.type !== "string") {
        const s = getDebugSourceExtended(o);
        if (s?.fileName) {
          const norm = normalizeDevPath(s.fileName);
          if (isTsxOrJsxPath(norm)) return o;
        }
      }
      o = (o._debugOwner as Fiber | null) ?? null;
    }
    return null;
  };
  return tryChain(start);
}

function nearestTsxJsxSourceFromFiber(
  start: Fiber | null,
): ReturnType<typeof getDebugSource> | null {
  const f = findNearestTsxFiber(start);
  return f ? getDebugSourceExtended(f) : null;
}

/** From this fiber, walk `return` for the first non-host component with a real display name. */
function nameAlignedToFileFiber(tsxFiber: Fiber | null): string | null {
  if (!tsxFiber) return null;
  let f: Fiber | null = tsxFiber;
  for (let d = 0; f && d < 150; d++) {
    if (typeof f.type === "string") {
      f = f.return;
      continue;
    }
    const n = getNameFromFiber(f);
    if (n && n !== "Anonymous") return n;
    f = f.return;
  }
  return null;
}

/** `edit-customer-form.tsx` → `EditCustomerForm` when React names are anonymous wrappers. */
function guessNameFromPath(filePath: string): string | null {
  const segments = filePath.split("/").filter(Boolean);
  const fileSeg = segments.pop() ?? "";
  let base = fileSeg.replace(/\.(tsx?|jsx?|mjs|cjs|js)$/, "");
  if (base === "index" && segments.length > 0) {
    const parent = segments[segments.length - 1];
    if (parent && parent !== "node_modules" && !parent.startsWith("@")) {
      base = parent;
    }
  }
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
  /** When true, format as `@file Name (location)` — no `:line` (guessed name from path). */
  omitLine: boolean;
} {
  if (!fiber) {
    return { file: "unknown", line: "?", name: "Anonymous", omitLine: true };
  }

  const start = fiber;
  const best = findBestFiber(fiber);

  /** Fiber that owns the `.tsx`/`.jsx` path we show — name should match this parent, not the leaf. */
  const tsxFiber = findNearestTsxFiber(start) || findNearestTsxFiber(best);

  let src: ReturnType<typeof getDebugSource> | null =
    getDebugSourceExtended(start) ||
    walkDebugOwnersForSourceExtended(start) ||
    walkReturnForSourceExtended(start) ||
    (best ? walkReturnForSourceExtended(best) : null);

  if (tsxFiber) {
    const s = getDebugSourceExtended(tsxFiber);
    if (s?.fileName) {
      const norm = normalizeDevPath(s.fileName);
      if (isTsxOrJsxPath(norm)) {
        src = s;
      }
    }
  } else {
    const tsxSrc = nearestTsxJsxSourceFromFiber(start) || nearestTsxJsxSourceFromFiber(best);
    if (tsxSrc?.fileName) {
      src = tsxSrc;
    }
  }

  let file = "unknown";
  let line: string = "?";
  if (src?.fileName) {
    file = normalizeDevPath(src.fileName);
    if (typeof src.lineNumber === "number" && Number.isFinite(src.lineNumber)) {
      line = String(src.lineNumber);
    }
  }

  let name: string;
  let omitLine = false;

  if (tsxFiber) {
    const guessed = file !== "unknown" ? guessNameFromPath(file) : null;
    const aligned = nameAlignedToFileFiber(tsxFiber);
    const fromOwner = walkDebugOwnersForName(tsxFiber);
    if (aligned) {
      name = aligned;
    } else if (fromOwner) {
      name = fromOwner;
    } else if (guessed) {
      name = guessed;
      omitLine = true;
    } else {
      name = "Anonymous";
    }
  } else {
    let n: string | null = nearestNonAnonymousNameOnly(start) || walkDebugOwnersForName(start);
    if (!n) {
      const rw = resolveNameWalkingUp(start);
      n = rw !== "Anonymous" ? rw : "Anonymous";
    }
    name = n;
    if (name === "Anonymous" && file !== "unknown") {
      const guessed = guessNameFromPath(file);
      if (guessed) {
        name = guessed;
        omitLine = true;
      }
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

  if (isPickerDebugEnabled()) {
    const srcBeforeTsx =
      getDebugSourceExtended(start) ||
      walkDebugOwnersForSourceExtended(start) ||
      walkReturnForSourceExtended(start) ||
      (best ? walkReturnForSourceExtended(best) : null);
    const tsxA = nearestTsxJsxSourceFromFiber(start);
    const tsxB = best ? nearestTsxJsxSourceFromFiber(best) : null;
    const hook = (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
    console.info("[React Context Picker][fiber]", "resolvePickFromFiber", {
      page: globalThis.location?.href,
      reactDevToolsHook: Boolean(hook),
      final: { file, line, name, omitLine },
      guessNameFromPath_finalFile: guessNameFromPath(file),
      names: {
        nearestNonAnonymousNameOnly: nearestNonAnonymousNameOnly(start),
        walkDebugOwnersForName: walkDebugOwnersForName(start),
        resolveNameWalkingUp: resolveNameWalkingUp(start),
      },
      sources: {
        srcWalkBeforeTsxNearest: srcBeforeTsx,
        tsxNearest_fromStart: tsxA,
        tsxNearest_fromBest: tsxB,
        tsxNearest_used: tsxA ?? tsxB,
      },
      returnChain: snapshotReturnChain(start, 32),
      ownerChain: snapshotOwnerChain(start, 16),
    });
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

/** Props/state snapshot for side-panel copy (same fiber walk as `buildPickItem` in pick.ts). */
export function snapshotPropsStateForPick(fiber: Fiber | null): {
  propsText: string | null;
  stateText: string | null;
} {
  const best = findBestFiber(fiber);
  const propsText = serializePropsForContext(getMemoizedProps(best));
  const stateRaw = best?.memoizedState ?? null;
  const stateText =
    stateRaw == null
      ? null
      : typeof stateRaw === "object"
        ? serializePropsForContext(stateRaw)
        : String(stateRaw);
  return { propsText, stateText };
}
