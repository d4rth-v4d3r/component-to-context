import {
  getFiberFromComposedPath,
  findBestFiber,
  getMemoizedProps,
  isPickerDebugEnabled,
  logFiberLookupMiss,
  nearestLeafNamedWithFile,
  resolvePickFromFiber,
  serializePropsForContext,
} from "./fiber";
import {
  resolvePickViaPageWorld,
  type PickCandidate,
  type PickResolved,
} from "./page-world-bridge";

const LOG_PREFIX = "[React Context Picker]";

function pickUrlPath(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

function escapedOneLine(s: string): string {
  return s.replace(/\s+/g, " ").replace(/"/g, '\\"').trim();
}

function lineSuffix(line: string): string {
  return line !== "?" && Number.isFinite(Number(line)) ? `:${line}` : "";
}

function pascalFromFilePath(filePath: string): string | null {
  const segs = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  let base = (segs[segs.length - 1] ?? "").replace(/\.(tsx?|jsx?|mjs|cjs|js)$/i, "");
  if (base === "index" && segs.length > 1) base = segs[segs.length - 2] ?? base;
  if (!base || base === "unknown") return null;
  const parts = base.split(/[-_.]/).filter(Boolean);
  if (!parts.length) return null;
  return parts.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

function dropdownDisplayName(c: PickCandidate): string {
  const GENERIC = new Set([
    "Grid",
    "Box",
    "Stack",
    "Dialog",
    "DialogContent",
    "DialogTitle",
    "DialogActions",
    "FormControl",
    "TextField",
    "Button",
    "IconButton",
    "Typography",
    "Container",
    "Paper",
    "Card",
  ]);
  const current = c.resolved.name;
  const fromFile = pascalFromFilePath(c.resolved.file);
  if (!fromFile) return current;
  if (GENERIC.has(current) || current === "Anonymous") return fromFile;
  return current;
}

/**
 * Build shortest unique display paths from candidate files.
 * No hardcoded `src`: strip shared leading prefix, then bounded unique tails.
 */
function buildShortDisplayPathMap(candidates: PickCandidate[]): Map<string, string> {
  const split = (p: string): string[] =>
    p
      .replace(/\\/g, "/")
      .replace(/^file:\/\//i, "")
      .replace(/^webpack(-internal)?:\/\//i, "")
      .split("/")
      .filter(Boolean);
  const files = candidates.map((c) => c.resolved.file);
  const rawSegments = files.map(split);
  const out = new Map<string, string>();

  if (files.length === 0) return out;

  // User-requested explicit roots for display, in priority order.
  const ANCHORS = ["src", "pages", "app", "routes"];
  const FALLBACK_MAX_SEGMENTS = 4;

  for (let i = 0; i < files.length; i++) {
    const segs = rawSegments[i];
    if (segs.length === 0) {
      out.set(files[i], files[i]);
      continue;
    }

    const lower = segs.map((x) => x.toLowerCase());
    let idx = -1;
    for (const a of ANCHORS) {
      const at = lower.indexOf(a);
      if (at !== -1 && (idx === -1 || at < idx)) idx = at;
    }

    if (idx !== -1) {
      // Always show from anchor when present (e.g. src/components/Button.tsx).
      out.set(files[i], segs.slice(idx).join("/"));
      continue;
    }

    // Fallback for non-app sources: keep a short tail.
    const shown = segs.slice(-FALLBACK_MAX_SEGMENTS).join("/");
    const needsEllipsis = segs.length > FALLBACK_MAX_SEGMENTS;
    out.set(files[i], needsEllipsis ? `.../${shown}` : shown);
  }

  return out;
}

/** Quick in-page chooser for multiple named parent candidates. */
function chooseCandidate(candidates: PickCandidate[]): Promise<PickResolved | null> {
  if (!candidates.length) return Promise.resolve(null);
  if (candidates.length === 1) return Promise.resolve(candidates[0].resolved);

  return new Promise((resolve) => {
    const shortPathMap = buildShortDisplayPathMap(candidates);
    const root = document.createElement("div");
    root.id = "rcp-candidate-picker";
    root.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483647;display:flex;align-items:center;justify-content:center;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "width:min(780px,92vw);background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:12px;padding:12px;box-shadow:0 12px 28px rgba(0,0,0,.45);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;";

    const title = document.createElement("div");
    title.textContent = "React Context Picker: select component/file target";
    title.style.cssText = "font-weight:700;margin-bottom:8px;";
    panel.appendChild(title);

    const list = document.createElement("div");
    list.style.cssText = "max-height:222px;overflow:auto;padding-right:2px;";

    candidates.forEach((c, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText =
        "display:flex;align-items:flex-start;justify-content:space-between;gap:10px;width:100%;text-align:left;margin:0 0 6px;padding:8px;border-radius:8px;border:1px solid #374151;background:#1f2937;color:#f9fafb;cursor:pointer;";
      btn.onclick = () => done(c.resolved);

      const left = document.createElement("div");
      left.style.cssText = "min-width:0;";
      const name = document.createElement("div");
      name.textContent = dropdownDisplayName(c);
      name.style.cssText = "font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const file = document.createElement("div");
      const shortPath = shortPathMap.get(c.resolved.file) ?? c.resolved.file;
      file.textContent = `${shortPath}${lineSuffix(c.resolved.line)}`;
      file.style.cssText = "opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      left.appendChild(name);
      left.appendChild(file);

      const right = document.createElement("div");
      right.style.cssText = "display:flex;gap:6px;flex-shrink:0;align-items:center;";
      const keyBadge = document.createElement("span");
      keyBadge.textContent = `${idx + 1}`;
      keyBadge.style.cssText =
        "padding:2px 7px;border-radius:999px;background:#0f172a;border:1px solid #334155;opacity:.95;";
      const layerBadge = document.createElement("span");
      layerBadge.textContent = c.layer;
      layerBadge.style.cssText =
        "padding:2px 8px;border-radius:999px;background:#1e293b;border:1px solid #334155;text-transform:uppercase;font-size:10px;letter-spacing:.04em;";
      right.appendChild(keyBadge);
      right.appendChild(layerBadge);

      btn.appendChild(left);
      btn.appendChild(right);
      list.appendChild(btn);
    });
    panel.appendChild(list);

    const hint = document.createElement("div");
    hint.textContent = "Esc to cancel, 1-9 to pick quickly";
    hint.style.cssText = "opacity:.75;padding:4px 2px 0;";
    panel.appendChild(hint);

    root.appendChild(panel);
    document.documentElement.appendChild(root);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
        return;
      }
      const n = Number(e.key);
      if (Number.isFinite(n) && n >= 1 && n <= candidates.length) {
        e.preventDefault();
        done(candidates[n - 1].resolved);
      }
    };

    const onClickBackdrop = (e: MouseEvent): void => {
      if (e.target === root) done(null);
    };

    function done(value: PickResolved | null): void {
      window.removeEventListener("keydown", onKey, true);
      root.removeEventListener("mousedown", onClickBackdrop, true);
      root.remove();
      resolve(value);
    }

    window.addEventListener("keydown", onKey, true);
    root.addEventListener("mousedown", onClickBackdrop, true);
  });
}

/** Prefer clicked node text; if empty, walk up to nearest ancestor with readable text. */
function pickComponentText(fiber: ReturnType<typeof getFiberFromComposedPath>): string {
  const best = findBestFiber(fiber);
  const hostNode = (best?.stateNode as Node | null) ?? null;
  let el: Element | null = null;
  if (hostNode instanceof Element) el = hostNode;
  else if (hostNode instanceof Text) el = hostNode.parentElement;
  if (!el) return "";

  let cur: Element | null = el;
  for (let i = 0; cur && i < 5; i++) {
    const raw = cur.textContent ?? "";
    const one = escapedOneLine(raw);
    if (one) return one.length > 140 ? `${one.slice(0, 140)}…` : one;
    cur = cur.parentElement;
  }
  return "";
}

function formatBlock(
  fiber: ReturnType<typeof getFiberFromComposedPath>,
  resolvedOverride?: PickResolved,
  nameOverride?: string | null,
): string {
  const resolved = resolvedOverride ?? resolvePickFromFiber(fiber);
  const filePart = resolved.file === "unknown" ? "unknown" : resolved.file;
  const linePart =
    resolved.line !== "?" && Number.isFinite(Number(resolved.line)) ? `:${resolved.line}` : "";
  const componentText = pickComponentText(fiber);
  const copyName = nameOverride || nearestLeafNamedWithFile(fiber) || resolved.name;
  const primary = `@${filePart}${linePart} ${copyName}("${componentText}") - `;

  const best = findBestFiber(fiber);
  const props = getMemoizedProps(best);
  const json = serializePropsForContext(props);
  const urlLine = `Additional info:\n- URL: ${pickUrlPath()}`;
  if (!json) return `${primary}\n${urlLine}`;

  return `${primary}\n${urlLine}\n- Props: ${json}`;
}

/**
 * Shift+Option/Alt avoids stealing normal Option+clicks (links, browser UI) and matches
 * devtools-style chords. Modifier flags on `mousedown` are flaky on some macOS builds.
 */
let altKeyPhysicallyDown = false;
let shiftKeyPhysicallyDown = false;
window.addEventListener(
  "keydown",
  (e) => {
    if (e.code === "AltLeft" || e.code === "AltRight") altKeyPhysicallyDown = true;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") shiftKeyPhysicallyDown = true;
  },
  true,
);
window.addEventListener(
  "keyup",
  (e) => {
    if (e.code === "AltLeft" || e.code === "AltRight") altKeyPhysicallyDown = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") shiftKeyPhysicallyDown = false;
  },
  true,
);
window.addEventListener("blur", () => {
  altKeyPhysicallyDown = false;
  shiftKeyPhysicallyDown = false;
}, true);

/**
 * - Shift+Option / Shift+Alt (primary)
 * - Cmd+Shift (macOS) or Ctrl+Shift (Win/Linux) — often more reliable than Shift+Option on Safari-like stacks
 */
function wantsPickChord(ev: MouseEvent): boolean {
  let shift = ev.shiftKey || shiftKeyPhysicallyDown;
  let alt = ev.altKey || altKeyPhysicallyDown;
  try {
    if (typeof ev.getModifierState === "function") {
      shift = shift || ev.getModifierState("Shift");
      alt = alt || ev.getModifierState("Alt");
    }
  } catch {
    /* ignore */
  }
  const shiftAlt = shift && alt;
  const cmdOrCtrlShift =
    shift && (ev.metaKey || ev.ctrlKey || ev.getModifierState?.("Meta") || ev.getModifierState?.("Control"));
  return shiftAlt || Boolean(cmdOrCtrlShift);
}

let lastPickAt = 0;

function tryPick(ev: MouseEvent, source: string): void {
  if (isPickerDebugEnabled()) {
    console.info(LOG_PREFIX, source, {
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      metaKey: ev.metaKey,
      ctrlKey: ev.ctrlKey,
      button: ev.button,
      wantsPickChord: wantsPickChord(ev),
    });
  }

  if (!wantsPickChord(ev)) return;
  if (ev.button !== 0) return;

  const now = performance.now();
  if (now - lastPickAt < 550) return;
  lastPickAt = now;

  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();

  void (async () => {
    let fiber = getFiberFromComposedPath(ev);
    let resolved: PickResolved = resolvePickFromFiber(fiber);
    let leafNameForCopy: string | null = nearestLeafNamedWithFile(fiber);

    const needPageWorld =
      !fiber || (resolved.file === "unknown" && resolved.name === "Anonymous");

    if (needPageWorld) {
      if (!fiber && isPickerDebugEnabled()) {
        logFiberLookupMiss(ev);
      }
      try {
        const fromPage = await resolvePickViaPageWorld(ev);
        if (
          fromPage?.resolved &&
          (fromPage.resolved.file !== "unknown" || fromPage.resolved.name !== "Anonymous")
        ) {
          const chosen = await chooseCandidate(fromPage.candidates);
          resolved = chosen ?? fromPage.resolved;
          leafNameForCopy = fromPage.leafName ?? leafNameForCopy;
          if (isPickerDebugEnabled()) {
            console.info(LOG_PREFIX, "page_world_resolve", {
              resolved,
              candidates: fromPage.candidates.map((c) => ({
                file: `${c.resolved.file}${lineSuffix(c.resolved.line)}`,
                layer: c.layer,
              })),
              leafNameForCopy,
            });
          }
        }
      } catch (e) {
        if (isPickerDebugEnabled()) {
          console.warn(LOG_PREFIX, "page_world_resolve failed", e);
        }
      }
    }

    const block = formatBlock(fiber, resolved, leafNameForCopy);

    void chrome.runtime
      .sendMessage({ type: "APPEND_PICK", block })
      .then(() => {
        console.info(LOG_PREFIX, "pick sent (open side panel → textarea or Copy all)", {
          preview: block.slice(0, 120),
        });
      })
      .catch((err: unknown) => {
        console.error(LOG_PREFIX, "sendMessage failed — reload extension & tab", err);
      });
  })();
}

function onMouseDown(ev: MouseEvent): void {
  tryPick(ev, "mousedown");
}

/** Some trackpads / macOS builds deliver the gesture more reliably on `click`. */
window.addEventListener("mousedown", onMouseDown, { capture: true, passive: false });

console.info(
  LOG_PREFIX,
  "content script loaded. Chords: Shift+Option / Shift+Alt, or Cmd+Shift (Mac) / Ctrl+Shift (Win).",
  "Verbose logs: localStorage.setItem('REACT_CONTEXT_PICKER_DEBUG','1') then refresh (logs modifier + fiber resolution).",
  location.href,
);
