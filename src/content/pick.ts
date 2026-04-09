import {
  getFiberFromComposedPath,
  findBestFiber,
  getMemoizedProps,
  isPickerDebugEnabled,
  logFiberLookupMiss,
  resolvePickFromFiber,
  serializePropsForContext,
} from "./fiber";
import { resolvePickViaPageWorld, type PickResolved } from "./page-world-bridge";

const LOG_PREFIX = "[React Context Picker]";

function formatBlock(
  route: string,
  fiber: ReturnType<typeof getFiberFromComposedPath>,
  resolvedOverride?: PickResolved,
): string {
  const resolved = resolvedOverride ?? resolvePickFromFiber(fiber);
  const filePart = resolved.file === "unknown" ? "unknown" : resolved.file;
  const primary = resolved.omitLine
    ? `@${filePart} ${resolved.name} (${route}) - `
    : `@${filePart}:${resolved.line} ${resolved.name} (${route}) - `;

  const best = findBestFiber(fiber);
  const props = getMemoizedProps(best);
  const json = serializePropsForContext(props);
  if (!json) return primary;

  return `${primary}\n\nAdditional context:\n- Props: ${json}`;
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

  const route =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "";

  void (async () => {
    let fiber = getFiberFromComposedPath(ev);
    let resolved: PickResolved = resolvePickFromFiber(fiber);

    const needPageWorld =
      !fiber || (resolved.file === "unknown" && resolved.name === "Anonymous");

    if (needPageWorld) {
      if (!fiber && isPickerDebugEnabled()) {
        logFiberLookupMiss(ev);
      }
      try {
        const fromPage = await resolvePickViaPageWorld(ev);
        if (fromPage && (fromPage.file !== "unknown" || fromPage.name !== "Anonymous")) {
          resolved = fromPage;
          if (isPickerDebugEnabled()) {
            console.info(LOG_PREFIX, "page_world_resolve", { resolved });
          }
        }
      } catch (e) {
        if (isPickerDebugEnabled()) {
          console.warn(LOG_PREFIX, "page_world_resolve failed", e);
        }
      }
    }

    const block = formatBlock(route, fiber, resolved);

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
