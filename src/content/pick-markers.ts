/**
 * Panel → page highlight: light blue overlay on the anchored node (no host DOM mutation).
 * Persists until CLEAR_MARKERS (panel clears when focus leaves the card).
 */

const OVERLAY_ROOT_ID = "rcp-pick-overlay-root";
const STYLE_ID = "rcp-pick-highlight-animations";

let highlightCleanup: (() => void) | null = null;

function removeOverlayRoot(): void {
  document.getElementById(OVERLAY_ROOT_ID)?.remove();
}

function ensureHighlightStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes rcp-pulse-highlight {
      0%, 100% {
        opacity: 0.3;
        box-shadow:
          inset 0 0 0 1px rgba(59, 130, 246, 0.4),
          0 0 0 0 rgba(96, 165, 250, 0.28);
      }
      50% {
        opacity: 0.52;
        box-shadow:
          inset 0 0 0 1px rgba(59, 130, 246, 0.65),
          0 0 0 14px rgba(96, 165, 250, 0.14);
      }
    }
    [data-rcp="highlight"] {
      animation: rcp-pulse-highlight 2s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

function ensureOverlayRoot(): HTMLDivElement {
  let root = document.getElementById(OVERLAY_ROOT_ID) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement("div");
    root.id = OVERLAY_ROOT_ID;
    root.setAttribute("data-rcp", "1");
    root.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483640;overflow:visible;";
    document.documentElement.appendChild(root);
  }
  return root;
}

function nodeToElement(n: Node | null): Element | null {
  if (!n) return null;
  if (n.nodeType === Node.ELEMENT_NODE) return n as Element;
  return n.parentElement;
}

export function clearHighlight(): void {
  highlightCleanup?.();
  highlightCleanup = null;
  removeOverlayRoot();
}

/** Skip scrolling when the node is inside a modal — scrollIntoView often causes dialog flicker. */
function isInsideDialog(el: Element): boolean {
  return (
    el.closest('[role="dialog"]') != null ||
    el.closest('[aria-modal="true"]') != null ||
    el.closest("[data-radix-dialog-content]") != null ||
    el.closest('[data-slot="dialog-content"]') != null
  );
}

export function highlightByXPath(xpath: string): boolean {
  clearHighlight();
  let el: Element | null = null;
  try {
    const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue;
    el = nodeToElement(node);
    if (!el) return false;
  } catch {
    return false;
  }

  const inDialog = isInsideDialog(el);
  if (!inDialog) {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    } catch {
      /* ignore */
    }
  }

  ensureHighlightStyles();
  const root = ensureOverlayRoot();
  const sheet = document.createElement("div");
  sheet.setAttribute("data-rcp", "highlight");
  sheet.style.cssText =
    "pointer-events:none;position:fixed;z-index:2147483641;" +
    "background:rgba(147,197,253,0.32);border-radius:6px;";

  root.appendChild(sheet);

  const position = (): void => {
    if (!el?.isConnected) {
      clearHighlight();
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 && r.height < 0.5) {
      sheet.style.visibility = "hidden";
      return;
    }
    sheet.style.visibility = "visible";
    sheet.style.left = `${Math.max(0, r.left)}px`;
    sheet.style.top = `${Math.max(0, r.top)}px`;
    sheet.style.width = `${r.width}px`;
    sheet.style.height = `${r.height}px`;
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(position);
  });

  const onScrollOrResize = (): void => {
    position();
  };
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);

  highlightCleanup = () => {
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    sheet.remove();
    if (!root.childNodes.length) root.remove();
  };

  return true;
}

export function initPickMessaging(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "HIGHLIGHT_ANCHOR" && typeof msg.xpath === "string") {
      const ok = highlightByXPath(msg.xpath);
      sendResponse({ ok });
      return true;
    }
    if (msg?.type === "SYNC_MARKERS") {
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "CLEAR_MARKERS") {
      clearHighlight();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
}
