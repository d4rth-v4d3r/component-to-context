/**
 * Runs in the **page** JavaScript realm (via injected <script src="...">).
 * Chrome content scripts are isolated — they cannot read `__reactFiber$` on DOM nodes.
 * This bundle shares the page's realm and reuses fiber resolution from `./fiber`.
 */
import { getFiberFromNode, getFiberFromHostInstance, resolvePickFromFiber } from "./fiber";

const MSG_GET = "__rcp__get_fiber";
const MSG_RESULT = "__rcp__fiber_result";

function evalXPath(xp: string): Node | null {
  try {
    return document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue;
  } catch {
    return null;
  }
}

function handleMessage(ev: MessageEvent): void {
  if (ev.source !== window || ev.data?.type !== MSG_GET) return;
  const { requestId, xpaths } = ev.data as { requestId?: string; xpaths?: string[] };
  if (!requestId || !Array.isArray(xpaths)) return;

  let fiber = null;
  for (const xp of xpaths) {
    const node = evalXPath(xp);
    if (!node || !(node instanceof Element || node instanceof Text)) continue;
    fiber = getFiberFromHostInstance(node);
    if (fiber) break;
  }

  if (!fiber && xpaths.length > 0) {
    const node = evalXPath(xpaths[0]);
    if (node) {
      fiber = getFiberFromNode(node);
    }
  }

  const resolved = resolvePickFromFiber(fiber);
  window.postMessage({ type: MSG_RESULT, requestId, resolved }, "*");
}

if (!(document.documentElement as HTMLElement).dataset.rcpPageWorld) {
  (document.documentElement as HTMLElement).dataset.rcpPageWorld = "1";
  window.addEventListener("message", handleMessage, false);
}
