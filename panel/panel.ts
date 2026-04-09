import "./panel.css";

const STORAGE_KEY = "contextItems";
const list = document.getElementById("list") as HTMLDivElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const undoBtn = document.getElementById("undo") as HTMLButtonElement;

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
};

let items: PickItem[] = [];
let lastSentBatchIds: string[] = [];

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

function toClipboardBlock(item: PickItem): string {
  const fileLine = `${item.file}${lineSuffix(item.line)}`;
  const text = truncate(item.textContent ?? "", 180).replace(/\s+/g, " ").trim();
  const prompt = (item.prompt ?? "").trim();
  const promptPart = prompt ? ` ${prompt}` : "";

  const lead =
    item.selectionKind === "leaf"
      ? `In @${fileLine} ${item.componentName}("${text}") -${promptPart}`
      : `Inside @${fileLine} there is a "${item.componentName}" ("${text}") -${promptPart}`;
  return `${lead}\nAdditional info:\n- URL: ${item.url}`;
}

function buildClipboardText(all: PickItem[]): string {
  const legend = "Please review the following items and fix them if necessary or ask for clarification";
  const blocks = all.map(toClipboardBlock);
  return [legend, ...blocks].join("\n\n\n");
}

async function refreshFromStorage(): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  items = ((data[STORAGE_KEY] as PickItem[] | undefined) ?? [])
    .filter(Boolean)
    .map((x) => ({ ...x, status: x.status ?? "pending" }));
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

  if (!items.length) {
    list.innerHTML = `<div class="empty">No items yet. Pick components to start building context.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("article");
    const status = item.status ?? "pending";
    card.className = `card ${status === "done" ? "done" : ""}`;
    card.innerHTML = `
      <div class="row">
        <strong>${escapeHtml(item.componentName)}</strong>
        <div style="display:flex;gap:6px;align-items:center;">
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
        <span class="badge status ${status}">${status}</span>
      </div>
      <textarea class="prompt" data-id="${escapeHtml(item.id)}" placeholder="Add prompt for this item..." ${
        status === "done" ? "disabled" : ""
      }>${escapeHtml(item.prompt || "")}</textarea>
    `;
    list.appendChild(card);
  }

  undoBtn.classList.toggle("hidden", lastSentBatchIds.length === 0);

  if (activeId) {
    const next = list.querySelector(`textarea.prompt[data-id="${CSS.escape(activeId)}"]`) as
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

list.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
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

list.addEventListener("input", (e) => {
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLTextAreaElement)) return;
  if (t.disabled) return;
  const id = t.dataset.id;
  if (!id) return;
  void chrome.runtime.sendMessage({ type: "UPDATE_PICK_PROMPT", id, prompt: t.value });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) return;
  items = ((changes[STORAGE_KEY].newValue as PickItem[] | undefined) ?? []).filter(Boolean);
  items = items.map((x) => ({ ...x, status: x.status ?? "pending" }));
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshFromStorage();
});

async function sendForReview(): Promise<void> {
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
    await writeItems(next);
  } catch {
    // ignore, button labels indicate failure minimally
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

void refreshFromStorage();
