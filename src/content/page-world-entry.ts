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

type Candidate = {
  fiber: ReturnType<typeof getFiberFromHostInstance>;
  score: number;
  layer: "page" | "dialog" | "form" | "none";
  pathIndex: number;
};

type PickCandidate = {
  resolved: ReturnType<typeof resolvePickFromFiber>;
  layer: Candidate["layer"];
  pathIndex: number;
  score: number;
};

function classifyLayer(node: Node): "page" | "dialog" | "form" | "none" {
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return "none";

  if (el.closest("main, [role='main'], article, [data-nextjs-scroll-focus-boundary], #__next")) {
    return "page";
  }

  if (
    el.closest(
      "[role='dialog'], [aria-modal='true'], dialog, [role='alertdialog'], [data-state='open'][data-radix-collection-item], [data-radix-dialog-content], [data-dialog-content]",
    )
  ) {
    return "dialog";
  }

  if (el.closest("form, [role='form'], [aria-labelledby*='form' i], [data-form], [data-testid*='form' i]")) {
    return "form";
  }

  return "none";
}

function layerScore(layer: "page" | "dialog" | "form" | "none"): number {
  // Intent-first ranking: nearest form, else nearest dialog, else nearest page.
  if (layer === "form") return 300;
  if (layer === "dialog") return 200;
  if (layer === "page") return 100;
  return 0;
}

function pickRankedFiber(xpaths: string[]): ReturnType<typeof getFiberFromHostInstance> {
  const candidates: Candidate[] = [];

  for (let i = 0; i < xpaths.length; i++) {
    const xp = xpaths[i];
    const node = evalXPath(xp);
    if (!node || !(node instanceof Element || node instanceof Text)) continue;
    const fiber = getFiberFromHostInstance(node);
    if (!fiber) continue;

    const layer = classifyLayer(node);
    // Smaller i means closer to click target; prefer nearest within each layer.
    const score = layerScore(layer) - i;
    candidates.push({ fiber, score, layer, pathIndex: i });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].fiber;
}

function buildPickCandidates(xpaths: string[]): PickCandidate[] {
  const out: PickCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < xpaths.length; i++) {
    const xp = xpaths[i];
    const node = evalXPath(xp);
    if (!node || !(node instanceof Element || node instanceof Text)) continue;
    const fiber = getFiberFromHostInstance(node);
    if (!fiber) continue;

    const layer = classifyLayer(node);
    const score = layerScore(layer) - i;
    const resolved = resolvePickFromFiber(fiber);
    if (resolved.file === "unknown" && resolved.name === "Anonymous") continue;

    const key = `${resolved.file}|${resolved.line}|${resolved.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ resolved, layer, pathIndex: i, score });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 10);
}

function handleMessage(ev: MessageEvent): void {
  if (ev.source !== window || ev.data?.type !== MSG_GET) return;
  const { requestId, xpaths } = ev.data as { requestId?: string; xpaths?: string[] };
  if (!requestId || !Array.isArray(xpaths)) return;

  let fiber = pickRankedFiber(xpaths);
  const candidates = buildPickCandidates(xpaths);

  if (!fiber && xpaths.length > 0) {
    const node = evalXPath(xpaths[0]);
    if (node) {
      fiber = getFiberFromNode(node);
    }
  }

  const resolved = resolvePickFromFiber(fiber);
  window.postMessage({ type: MSG_RESULT, requestId, resolved, candidates }, "*");
}

if (!(document.documentElement as HTMLElement).dataset.rcpPageWorld) {
  (document.documentElement as HTMLElement).dataset.rcpPageWorld = "1";
  window.addEventListener("message", handleMessage, false);
}
