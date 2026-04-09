import {
  getFiberFromNode,
  findBestFiber,
  getMemoizedProps,
  resolvePickFromFiber,
  serializePropsForContext,
} from "./fiber";

function formatBlock(route: string, fiber: ReturnType<typeof getFiberFromNode>): string {
  const resolved = resolvePickFromFiber(fiber);
  const filePart = resolved.file === "unknown" ? "unknown" : resolved.file;
  const primary = `@${filePart}:${resolved.line} ${resolved.name} (${route}) - `;

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
  return shift && alt;
}

let lastPickAt = 0;

function onMouseDown(ev: MouseEvent): void {
  if (!wantsPickChord(ev)) return;
  if (ev.button !== 0) return;

  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();

  const now = performance.now();
  if (now - lastPickAt < 350) return;
  lastPickAt = now;

  const target = ev.target;
  if (!(target instanceof Node)) return;

  const fiber = getFiberFromNode(target);
  const route =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "";

  const block = formatBlock(route, fiber);

  void chrome.runtime.sendMessage({ type: "APPEND_PICK", block }).catch(() => {
    /* ignore if extension context invalidated */
  });
}

window.addEventListener("mousedown", onMouseDown, { capture: true, passive: false });
