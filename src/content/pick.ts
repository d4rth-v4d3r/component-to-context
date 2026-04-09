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

/** Tracks Option/Alt — modifier flags on `mousedown` are unreliable on some macOS + Chrome setups. */
let altKeyPhysicallyDown = false;
window.addEventListener(
  "keydown",
  (e) => {
    if (e.code === "AltLeft" || e.code === "AltRight") altKeyPhysicallyDown = true;
  },
  true,
);
window.addEventListener(
  "keyup",
  (e) => {
    if (e.code === "AltLeft" || e.code === "AltRight") altKeyPhysicallyDown = false;
  },
  true,
);
window.addEventListener("blur", () => {
  altKeyPhysicallyDown = false;
}, true);

/** Option (macOS) / Alt (Windows). */
function wantsAltPick(ev: MouseEvent): boolean {
  if (ev.altKey) return true;
  if (altKeyPhysicallyDown) return true;
  try {
    return ev.getModifierState("Alt");
  } catch {
    return false;
  }
}

let lastPickAt = 0;

function onMouseDown(ev: MouseEvent): void {
  if (!wantsAltPick(ev)) return;
  if (ev.button !== 0) return;

  ev.preventDefault();
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
