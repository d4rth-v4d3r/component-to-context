/** Dev-only helpers: read React internal fibers from DOM nodes. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fiber = any;

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

function getReactFiberKey(el: Element): string | undefined {
  return Object.keys(el).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
}

export function getFiberFromNode(start: Node | null): Fiber | null {
  let el: Element | null =
    start instanceof Element ? start : start?.parentElement ?? null;
  let hops = 0;
  while (el && hops < 80) {
    const key = getReactFiberKey(el);
    if (key) return (el as unknown as Record<string, Fiber>)[key] ?? null;
    el = el.parentElement;
    hops++;
  }
  return null;
}

function getDisplayNameForType(type: unknown): string | null {
  if (type == null) return null;
  if (typeof type === "string") return null;
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || null;
  }
  if (typeof type === "object") {
    const o = type as {
      $$typeof?: symbol;
      render?: unknown;
      type?: unknown;
      displayName?: string;
    };
    if (typeof o.render === "function") {
      const r = o.render as { displayName?: string; name?: string };
      return o.displayName || r.displayName || r.name || null;
    }
    if (o.type) return getDisplayNameForType(o.type);
    if (o.displayName) return o.displayName;
  }
  return null;
}

function getNameFromFiber(fiber: Fiber): string | null {
  const type = fiber?.elementType ?? fiber?.type;
  return getDisplayNameForType(type);
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
  while (f && depth < 60) {
    const name = getNameFromFiber(f);
    const src = getDebugSource(f);
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

export function resolvePickFromFiber(fiber: Fiber | null): {
  file: string;
  line: string;
  name: string;
} {
  const best = findBestFiber(fiber);
  if (!best) {
    return { file: "unknown", line: "?", name: "Anonymous" };
  }

  let file = "unknown";
  let line: string = "?";
  let name = getNameFromFiber(best) || "Anonymous";

  const walkForSource = (startFiber: Fiber | null): ReturnType<typeof getDebugSource> => {
    let f: Fiber | null = startFiber;
    let d = 0;
    while (f && d < 60) {
      const s = getDebugSource(f);
      if (s?.fileName) return s;
      f = f.return;
      d++;
    }
    return null;
  };

  const src = getDebugSource(best) || walkForSource(best.return) || walkForSource(best);
  if (src?.fileName) {
    file = normalizeDevPath(src.fileName);
    if (typeof src.lineNumber === "number" && Number.isFinite(src.lineNumber)) {
      line = String(src.lineNumber);
    }
  }

  if (file === "unknown") {
    const onlySrc = walkForSource(best);
    if (onlySrc?.fileName) {
      file = normalizeDevPath(onlySrc.fileName);
      if (typeof onlySrc.lineNumber === "number" && Number.isFinite(onlySrc.lineNumber)) {
        line = String(onlySrc.lineNumber);
      }
    }
  }

  return { file, line, name };
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
