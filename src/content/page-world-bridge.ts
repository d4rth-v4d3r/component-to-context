import type { resolvePickFromFiber } from "./fiber";
import { getXPathForNode } from "./xpath";

const MSG_GET = "__rcp__get_fiber";
const MSG_RESULT = "__rcp__fiber_result";

export type PickResolved = ReturnType<typeof resolvePickFromFiber>;
export type PickCandidate = {
  resolved: PickResolved;
  layer: "page" | "dialog" | "form" | "none";
  pathIndex: number;
  score: number;
};
export type PageWorldPickResult = {
  resolved: PickResolved;
  candidates: PickCandidate[];
  leafName: string | null;
};

let loadPromise: Promise<void> | null = null;

/** Injects page-world bundle once; must be web_accessible. */
export function loadPageWorldBridge(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if ((document.documentElement as HTMLElement).dataset.rcpPageWorldLoaded === "1") {
      resolve();
      return;
    }
    const existing = document.getElementById("rcp-page-world-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("page-world script failed")), {
        once: true,
      });
      return;
    }
    const s = document.createElement("script");
    s.id = "rcp-page-world-script";
    s.src = chrome.runtime.getURL("content/page-world.js");
    s.async = true;
    s.onload = () => {
      (document.documentElement as HTMLElement).dataset.rcpPageWorldLoaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("page-world script load error"));
    (document.head || document.documentElement).appendChild(s);
  });
  return loadPromise;
}

function collectXpathsFromEvent(ev: MouseEvent): string[] {
  const out: string[] = [];
  for (const n of ev.composedPath()) {
    if (n instanceof Element || n instanceof Text) {
      try {
        out.push(getXPathForNode(n));
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/**
 * Resolve pick metadata in the page JS realm (reads `__reactFiber$` on hosts).
 * Falls back when the isolated content script sees no fiber (prod React).
 */
export async function resolvePickViaPageWorld(ev: MouseEvent): Promise<PageWorldPickResult | null> {
  const xpaths = collectXpathsFromEvent(ev);
  if (!xpaths.length) return null;

  await loadPageWorldBridge();

  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(null);
    }, 800);

    const onMsg = (e: MessageEvent): void => {
      if (e.source !== window || e.data?.type !== MSG_RESULT) return;
      if (e.data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMsg);
      resolve({
        resolved: e.data.resolved as PickResolved,
        candidates: Array.isArray(e.data.candidates) ? (e.data.candidates as PickCandidate[]) : [],
        leafName: typeof e.data.leafName === "string" ? e.data.leafName : null,
      });
    };

    window.addEventListener("message", onMsg, false);
    window.postMessage({ type: MSG_GET, requestId, xpaths }, "*");
  });
}
