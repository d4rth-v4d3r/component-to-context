import "./panel.css";

const STORAGE_KEY = "contextItems";
const CLIPBOARD_LEAD_KEY = "rcpClipboardLead";

const DEFAULT_CLIPBOARD_LEAD =
  "Please review the following items and fix them if necessary or ask for clarification. If any change is needed make sure to ALWAYS update related tests or add new ones";

const clipboardLeadTextarea = document.getElementById("clipboard-lead") as HTMLTextAreaElement;
const clipboardLeadResetBtn = document.getElementById("clipboard-lead-reset") as HTMLButtonElement;

let clipboardLead = DEFAULT_CLIPBOARD_LEAD;
let clipboardLeadSaveTimer: ReturnType<typeof setTimeout> | null = null;

const panelPending = document.getElementById("panel-pending") as HTMLDivElement;
const panelDone = document.getElementById("panel-done") as HTMLDivElement;
const tabPending = document.getElementById("tab-pending") as HTMLButtonElement;
const tabDone = document.getElementById("tab-done") as HTMLButtonElement;
const countPending = document.getElementById("count-pending") as HTMLSpanElement;
const countDone = document.getElementById("count-done") as HTMLSpanElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const undoBtn = document.getElementById("undo") as HTMLButtonElement;
const listsWrap = document.querySelector(".lists-wrap") as HTMLDivElement;

type PickItem = {
  id: string;
  file: string;
  line: string;
  componentName: string;
  textContent: string;
  url: string;
  prompt: string;
  selectionKind: "leaf" | "parent";
  status?: "pending" | "done";
  includeProps?: boolean;
  includeState?: boolean;
  propsText?: string | null;
  stateText?: string | null;
  anchorXPath?: string;
  /** Tab that created this pick (set by background). */
  sourceTabId?: number;
};

let items: PickItem[] = [];
let lastSentBatchIds: string[] = [];
/** Tracks ids to detect newly appended picks (focus Pending tab). */
let prevItemIds = new Set<string>();
let activeTab: "pending" | "done" = "pending";

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function lineSuffix(line: string): string {
  return line !== "?" && Number.isFinite(Number(line)) ? `:${line}` : "";
}

function fileBase(file: string): string {
  const norm = (file || "").replace(/\\/g, "/");
  const last = norm.split("/").filter(Boolean).pop() ?? "unknown";
  return `@${last}`;
}

function stateLineWorthIncluding(item: PickItem): boolean {
  if (!item.includeState) return false;
  const st = item.stateText;
  if (st == null) return false;
  const t = String(st).trim();
  return t.length > 0 && t !== "(unavailable)";
}

function toClipboardBlock(item: PickItem): string {
  const fileLine = `${item.file}${lineSuffix(item.line)}`;
  const text = truncate(item.textContent ?? "", 180).replace(/\s+/g, " ").trim();
  const prompt = (item.prompt ?? "").trim();
  const promptPart = prompt ? ` ${prompt}` : "";

  const lead =
    item.selectionKind === "leaf"
      ? `In @${fileLine} ${item.componentName}("${text}") -${promptPart}`
      : `Inside @${fileLine} there is a "${item.componentName}" ("${text}") -${promptPart}`;
  const extra: string[] = [`- URL: ${item.url}`];
  if (item.includeProps) extra.push(`- Props: ${item.propsText ?? "(unavailable)"}`);
  if (stateLineWorthIncluding(item)) extra.push(`- State: ${item.stateText}`);
  return `${lead}\nAdditional info:\n${extra.join("\n")}`;
}

function buildClipboardText(all: PickItem[]): string {
  const legend = clipboardLead.trim() || DEFAULT_CLIPBOARD_LEAD;
  const blocks = all.map(toClipboardBlock);
  return [legend, ...blocks].join("\n\n\n");
}

function setActiveTab(tab: "pending" | "done"): void {
  activeTab = tab;
  const pendingSel = tab === "pending";
  tabPending.setAttribute("aria-selected", pendingSel ? "true" : "false");
  tabDone.setAttribute("aria-selected", pendingSel ? "false" : "true");
  panelPending.classList.toggle("hidden", !pendingSel);
  panelPending.toggleAttribute("hidden", !pendingSel);
  panelDone.classList.toggle("hidden", pendingSel);
  panelDone.toggleAttribute("hidden", pendingSel);
}

function renderCard(item: PickItem): string {
  const status = item.status ?? "pending";
  const locateBtn =
    item.anchorXPath && item.anchorXPath.length > 0
      ? `<button class="icon" data-action="locate" data-id="${escapeHtml(item.id)}" title="Locate on page">⌖</button>`
      : "";
  return `
    <article class="card ${status === "done" ? "done" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="row">
        <strong>${escapeHtml(item.componentName)}</strong>
        <div style="display:flex;gap:6px;align-items:center;">
          ${locateBtn}
          <button class="icon" data-action="toggle" data-id="${escapeHtml(item.id)}" title="${
            status === "done" ? "Mark as pending" : "Mark as done"
          }">${status === "done" ? "↺" : "✓"}</button>
          <button class="icon" data-action="delete" data-id="${escapeHtml(item.id)}" title="Delete">✕</button>
        </div>
      </div>
      <div class="badges">
        <span class="badge text">${escapeHtml(truncate(item.textContent || "", 42) || "(no text)")}</span>
        <span class="badge file">${escapeHtml(`${fileBase(item.file)}${lineSuffix(item.line)}`)}</span>
        <span class="badge url">${escapeHtml(truncate(item.url || "", 56) || "(no url)")}</span>
        <button class="badge toggle ${item.includeProps ? "on" : ""}" data-action="toggle-props" data-id="${escapeHtml(
          item.id,
        )}" title="Include Props in send">🧩</button>
        <button class="badge toggle ${item.includeState ? "on" : ""}" data-action="toggle-state" data-id="${escapeHtml(
          item.id,
        )}" title="Include State in send">⚛</button>
      </div>
      <textarea class="prompt" data-id="${escapeHtml(item.id)}" placeholder="Add prompt for this item...">${escapeHtml(
        item.prompt || "",
      )}</textarea>
    </article>
  `;
}

async function refreshFromStorage(): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  items = ((data[STORAGE_KEY] as PickItem[] | undefined) ?? [])
    .filter(Boolean)
    .map((x) => ({
      ...x,
      status: x.status ?? "pending",
      includeProps: x.includeProps ?? false,
      includeState: x.includeState ?? false,
    }));
  prevItemIds = new Set(items.map((x) => x.id));
  render();
}

async function writeItems(next: PickItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

function render(): void {
  const active = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
  const activeId = active?.dataset.id ?? null;
  const selStart = active?.selectionStart ?? null;
  const selEnd = active?.selectionEnd ?? null;

  const pending = items.filter((x) => (x.status ?? "pending") === "pending");
  const done = items.filter((x) => (x.status ?? "pending") === "done");

  countPending.textContent = String(pending.length);
  countDone.textContent = String(done.length);

  const emptyPending = `<div class="empty">No pending items. Picks appear here.</div>`;
  const emptyDone = `<div class="empty">No done items yet.</div>`;

  panelPending.innerHTML = pending.length ? pending.map((x) => renderCard(x)).join("") : emptyPending;
  panelDone.innerHTML = done.length ? done.map((x) => renderCard(x)).join("") : emptyDone;

  undoBtn.classList.toggle("hidden", lastSentBatchIds.length === 0);

  const panel = activeTab === "pending" ? panelPending : panelDone;
  if (activeId) {
    const next = panel.querySelector(`textarea.prompt[data-id="${CSS.escape(activeId)}"]`) as
      | HTMLTextAreaElement
      | null;
    if (next) {
      next.focus();
      if (typeof selStart === "number" && typeof selEnd === "number") {
        next.setSelectionRange(selStart, selEnd);
      }
    }
  }
}

const LAST_PICK_TAB_KEY = "rcpLastPickTabId";

async function resolveTabForPick(item: PickItem): Promise<number | undefined> {
  if (typeof item.sourceTabId === "number") return item.sourceTabId;
  const data = await chrome.storage.local.get(LAST_PICK_TAB_KEY);
  const stored = data[LAST_PICK_TAB_KEY];
  if (typeof stored === "number") return stored;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function resolveTabForOverlayClear(): Promise<number | undefined> {
  const data = await chrome.storage.local.get(LAST_PICK_TAB_KEY);
  const stored = data[LAST_PICK_TAB_KEY];
  if (typeof stored === "number") return stored;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function locateOnPage(item: PickItem): Promise<void> {
  const xp = item.anchorXPath;
  if (!xp) return;
  const tabId = await resolveTabForPick(item);
  if (tabId == null) return;
  try {
    await chrome.runtime.sendMessage({ type: "LOCATE_ON_PAGE", xpath: xp, tabId });
  } catch {
    /* content script missing or wrong tab */
  }
}

async function clearPageHighlight(): Promise<void> {
  const tabId = await resolveTabForOverlayClear();
  if (tabId == null) return;
  try {
    await chrome.runtime.sendMessage({ type: "CLEAR_MARKERS", tabId });
  } catch {
    /* */
  }
}

let locateFocusTimer: ReturnType<typeof setTimeout> | null = null;

tabPending.addEventListener("click", () => setActiveTab("pending"));
tabDone.addEventListener("click", () => setActiveTab("done"));

listsWrap.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const toggleProps = t.closest("button[data-action='toggle-props']") as HTMLButtonElement | null;
  if (toggleProps) {
    const id = toggleProps.dataset.id;
    if (!id) return;
    const next = items.map((x) => (x.id === id ? { ...x, includeProps: !(x.includeProps ?? false) } : x));
    void writeItems(next);
    return;
  }
  const toggleState = t.closest("button[data-action='toggle-state']") as HTMLButtonElement | null;
  if (toggleState) {
    const id = toggleState.dataset.id;
    if (!id) return;
    const next = items.map((x) => (x.id === id ? { ...x, includeState: !(x.includeState ?? false) } : x));
    void writeItems(next);
    return;
  }
  const locate = t.closest("button[data-action='locate']") as HTMLButtonElement | null;
  if (locate) {
    const id = locate.dataset.id;
    if (!id) return;
    const item = items.find((x) => x.id === id);
    if (!item?.anchorXPath) return;
    void locateOnPage(item);
    return;
  }
  const toggle = t.closest("button[data-action='toggle']") as HTMLButtonElement | null;
  if (toggle) {
    const id = toggle.dataset.id;
    if (!id) return;
    const next = items.map((x) =>
      x.id === id ? { ...x, status: (x.status ?? "pending") === "done" ? "pending" : "done" } : x,
    );
    void writeItems(next);
    return;
  }
  const btn = t.closest("button[data-action='delete']") as HTMLButtonElement | null;
  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;
  void chrome.runtime.sendMessage({ type: "DELETE_PICK_ITEM", id });
});

listsWrap.addEventListener("input", (e) => {
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLTextAreaElement)) return;
  if (t.disabled) return;
  const id = t.dataset.id;
  if (!id) return;
  void chrome.runtime.sendMessage({ type: "UPDATE_PICK_PROMPT", id, prompt: t.value });
});

/** Any focus inside a card (prompt, ⌖, toggles) keeps / shows the page highlight. */
listsWrap.addEventListener(
  "focusin",
  (e) => {
    const card = (e.target as HTMLElement).closest("article.card");
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;
    const item = items.find((x) => x.id === id);
    if (!item?.anchorXPath) return;
    if (locateFocusTimer != null) clearTimeout(locateFocusTimer);
    locateFocusTimer = setTimeout(() => {
      locateFocusTimer = null;
      void locateOnPage(item);
    }, 280);
  },
  true,
);

/** Remove page overlay when focus leaves the card (not when moving between controls inside it). */
listsWrap.addEventListener(
  "focusout",
  (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    const card = t instanceof Element ? t.closest("article.card") : null;
    if (!card) return;
    const next = e.relatedTarget;
    if (next instanceof Node && card.contains(next)) return;
    if (locateFocusTimer != null) {
      clearTimeout(locateFocusTimer);
      locateFocusTimer = null;
    }
    void clearPageHighlight();
  },
  true,
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[CLIPBOARD_LEAD_KEY]) {
    const v = changes[CLIPBOARD_LEAD_KEY].newValue;
    if (typeof v === "string") {
      clipboardLead = v;
      clipboardLeadTextarea.value = v;
    }
  }
  if (!changes[STORAGE_KEY]) return;
  const newVal = ((changes[STORAGE_KEY].newValue as PickItem[] | undefined) ?? []).filter(Boolean);
  const oldVal = ((changes[STORAGE_KEY].oldValue as PickItem[] | undefined) ?? []).filter(Boolean);
  const oldIds = new Set(oldVal.map((x) => x.id));
  const hasNewPick = newVal.some((x) => !oldIds.has(x.id));

  items = newVal.map((x) => ({ ...x, status: x.status ?? "pending" }));
  prevItemIds = new Set(items.map((x) => x.id));

  if (hasNewPick) {
    setActiveTab("pending");
  }
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void (async () => {
      const tabId = await resolveTabForOverlayClear();
      if (tabId == null) return;
      try {
        await chrome.runtime.sendMessage({ type: "CLEAR_MARKERS", tabId });
      } catch {
        /* */
      }
    })();
    return;
  }
  void refreshFromStorage();
});

async function sendForReview(): Promise<void> {
  const missingComment = items.find((x) => !(x.prompt ?? "").trim());
  if (missingComment) {
    setActiveTab("pending");
    render();
    const el = panelPending.querySelector(
      `textarea.prompt[data-id="${CSS.escape(missingComment.id)}"]`,
    ) as HTMLTextAreaElement | null;
    el?.focus();
    sendBtn.textContent = "Fill all comments";
    setTimeout(() => (sendBtn.textContent = "Send For Review"), 1300);
    return;
  }

  const pending = items.filter((x) => (x.status ?? "pending") === "pending");
  const text = buildClipboardText(pending);
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    const pendingIds = pending.map((x) => x.id);
    lastSentBatchIds = pendingIds;
    const next = items.map((x) =>
      pendingIds.includes(x.id) ? { ...x, status: "done" as const } : x,
    );
    setActiveTab("done");
    await writeItems(next);
    items = next;
    prevItemIds = new Set(items.map((x) => x.id));
    render();
  } catch {
    // ignore
  }
}

sendBtn.addEventListener("click", async () => {
  await sendForReview();
  sendBtn.textContent = "Sent!";
  setTimeout(() => (sendBtn.textContent = "Send For Review"), 1200);
});

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_ITEMS" });
  lastSentBatchIds = [];
  undoBtn.classList.add("hidden");
});

undoBtn.addEventListener("click", async () => {
  if (!lastSentBatchIds.length) return;
  const ids = new Set(lastSentBatchIds);
  const next = items.map((x) =>
    ids.has(x.id) && (x.status ?? "pending") === "done" ? { ...x, status: "pending" as const } : x,
  );
  await writeItems(next);
  lastSentBatchIds = [];
  undoBtn.classList.add("hidden");
});

async function loadClipboardLead(): Promise<void> {
  const data = await chrome.storage.local.get(CLIPBOARD_LEAD_KEY);
  const raw = data[CLIPBOARD_LEAD_KEY];
  clipboardLead = typeof raw === "string" && raw.trim() ? raw : DEFAULT_CLIPBOARD_LEAD;
  clipboardLeadTextarea.value = clipboardLead;
}

function scheduleSaveClipboardLead(): void {
  if (clipboardLeadSaveTimer != null) clearTimeout(clipboardLeadSaveTimer);
  clipboardLeadSaveTimer = setTimeout(() => {
    clipboardLeadSaveTimer = null;
    clipboardLead = clipboardLeadTextarea.value;
    void chrome.storage.local.set({ [CLIPBOARD_LEAD_KEY]: clipboardLead });
  }, 350);
}

clipboardLeadTextarea.addEventListener("input", () => {
  clipboardLead = clipboardLeadTextarea.value;
  scheduleSaveClipboardLead();
});

clipboardLeadTextarea.addEventListener("blur", () => {
  if (clipboardLeadSaveTimer != null) {
    clearTimeout(clipboardLeadSaveTimer);
    clipboardLeadSaveTimer = null;
  }
  clipboardLead = clipboardLeadTextarea.value;
  void chrome.storage.local.set({ [CLIPBOARD_LEAD_KEY]: clipboardLead });
});

clipboardLeadResetBtn.addEventListener("click", () => {
  clipboardLead = DEFAULT_CLIPBOARD_LEAD;
  clipboardLeadTextarea.value = DEFAULT_CLIPBOARD_LEAD;
  void chrome.storage.local.set({ [CLIPBOARD_LEAD_KEY]: DEFAULT_CLIPBOARD_LEAD });
});

void loadClipboardLead();
void refreshFromStorage();
