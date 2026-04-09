/**
 * Runs in the **page** JavaScript realm (via injected <script src="...">).
 * Chrome content scripts are isolated — they cannot read `__reactFiber$` on DOM nodes.
 * This bundle shares the page's realm and reuses fiber resolution from `./fiber`.
 */
import {
  getFiberFromNode,
  getFiberFromHostInstance,
  nearestLeafFiberWithFile,
  nearestLeafNamedWithFile,
  resolveOutermostFiberForSourceFile,
  resolvePickFromFiber,
  snapshotPropsStateForPick,
} from "./fiber";

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
  kind: "leaf" | "parent";
  propsText: string | null;
  stateText: string | null;
};

type RawPick = {
  fiber: NonNullable<ReturnType<typeof getFiberFromHostInstance>>;
  resolved: ReturnType<typeof resolvePickFromFiber>;
  layer: Candidate["layer"];
  pathIndex: number;
  score: number;
};

function isLocalProjectFile(file: string): boolean {
  if (!file || file === "unknown") return false;
  const p = file.replace(/\\/g, "/");
  // Exclude obvious external/library sources.
  if (
    p.includes("/node_modules/") ||
    p.startsWith("node_modules/") ||
    p.includes("../node_modules/") ||
    p.includes("../../node_modules/") ||
    p.startsWith("http://") ||
    p.startsWith("https://")
  ) {
    return false;
  }
  const lower = p.toLowerCase();
  return (
    lower.includes("/src/") ||
    lower.startsWith("src/") ||
    lower.includes("/pages/") ||
    lower.startsWith("pages/") ||
    lower.includes("/app/") ||
    lower.startsWith("app/") ||
    lower.includes("/routes/") ||
    lower.startsWith("routes/")
  );
}

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

function normPathKey(file: string): string {
  return file.replace(/\\/g, "/");
}

function pickCandidateFromFiber(
  fiber: RawPick["fiber"],
  kind: PickCandidate["kind"],
  pathIndex: number,
  layer: Candidate["layer"],
  score: number,
): PickCandidate | null {
  const resolved = resolvePickFromFiber(fiber);
  if (resolved.name === "Anonymous" || resolved.file === "unknown" || !isLocalProjectFile(resolved.file)) {
    return null;
  }
  const { propsText, stateText } = snapshotPropsStateForPick(fiber);
  return { resolved, layer, pathIndex, score, kind, propsText, stateText };
}

function buildPickCandidates(xpaths: string[]): PickCandidate[] {
  const raw: RawPick[] = [];
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
    if (resolved.name === "Anonymous" || resolved.file === "unknown" || !isLocalProjectFile(resolved.file)) {
      continue;
    }

    const key = `${resolved.file}|${resolved.line}|${resolved.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    raw.push({ fiber, resolved, layer, pathIndex: i, score });
  }

  let anchorFiber = pickRankedFiber(xpaths);
  if (!anchorFiber && xpaths.length > 0) {
    const n = evalXPath(xpaths[0]);
    if (n) anchorFiber = getFiberFromNode(n);
  }

  const anchorNode = xpaths.length ? evalXPath(xpaths[0]) : null;
  const baseLayer = anchorNode ? classifyLayer(anchorNode) : "page";
  const baseScore = layerScore(baseLayer);

  const keyOfResolved = (r: PickCandidate["resolved"]): string =>
    `${r.file}|${r.line}|${r.name}`;

  const semanticLeafFiber = anchorFiber ? nearestLeafFiberWithFile(anchorFiber) : null;
  const semanticKey = semanticLeafFiber ? keyOfResolved(resolvePickFromFiber(semanticLeafFiber)) : null;
  const leafFileNorm = semanticLeafFiber
    ? normPathKey(resolvePickFromFiber(semanticLeafFiber).file)
    : null;

  const grouped = new Map<string, RawPick[]>();
  for (const r of raw) {
    const arr = grouped.get(r.resolved.file) ?? [];
    arr.push(r);
    grouped.set(r.resolved.file, arr);
  }

  const globalMinPathIndex = raw.length ? Math.min(...raw.map((r) => r.pathIndex)) : 0;

  const kept: PickCandidate[] = [];
  const dedup = new Set<string>();

  const push = (c: PickCandidate | null): void => {
    if (!c) return;
    const k = keyOfResolved(c.resolved);
    if (dedup.has(k)) return;
    dedup.add(k);
    kept.push(c);
  };

  if (semanticLeafFiber) {
    push(
      pickCandidateFromFiber(semanticLeafFiber, "leaf", -2, baseLayer, baseScore + 2),
    );
  }

  for (const [, arr] of grouped) {
    arr.sort((a, b) => a.pathIndex - b.pathIndex);
    const leaf = arr[0];
    const parent = arr[arr.length - 1];
    const file = leaf.resolved.file;

    if (keyOfResolved(leaf.resolved) === keyOfResolved(parent.resolved)) {
      const k = keyOfResolved(leaf.resolved);
      if (semanticKey && k === semanticKey) continue;
      const kind: PickCandidate["kind"] = leaf.pathIndex === globalMinPathIndex ? "leaf" : "parent";
      push(pickCandidateFromFiber(leaf.fiber, kind, leaf.pathIndex, leaf.layer, leaf.score));
      continue;
    }

    // Same file as the semantic leaf: outermost meaningful parent (e.g. EditCustomerForm vs FormProvider).
    // Different file: use path-nearest parent for that file so we don't repeat the same component name twice.
    const sameFileAsLeaf = leafFileNorm !== null && normPathKey(file) === leafFileNorm;
    const parentFib =
      sameFileAsLeaf && anchorFiber != null
        ? resolveOutermostFiberForSourceFile(anchorFiber, file) ?? parent.fiber
        : parent.fiber;
    push(
      pickCandidateFromFiber(parentFib, "parent", parent.pathIndex, parent.layer, parent.score),
    );
  }

  kept.sort((a, b) => a.pathIndex - b.pathIndex);
  return kept.slice(0, 10);
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
  const leafName = nearestLeafNamedWithFile(fiber);
  const { propsText, stateText } = snapshotPropsStateForPick(fiber);
  window.postMessage(
    { type: MSG_RESULT, requestId, resolved, candidates, leafName, propsText, stateText },
    "*",
  );
}

if (!(document.documentElement as HTMLElement).dataset.rcpPageWorld) {
  (document.documentElement as HTMLElement).dataset.rcpPageWorld = "1";
  window.addEventListener("message", handleMessage, false);
}
