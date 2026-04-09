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

function onPointerDown(ev: PointerEvent): void {
  if (!ev.altKey) return;
  if (ev.button !== 0) return;

  ev.preventDefault();
  ev.stopPropagation();

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

window.addEventListener("pointerdown", onPointerDown, true);
