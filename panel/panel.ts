import "./panel.css";

const STORAGE_KEY = "contextItems";
const list = document.getElementById("list") as HTMLDivElement;
const copyBtn = document.getElementById("copy") as HTMLButtonElement;
const copyClearBtn = document.getElementById("copyClear") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;

type PickItem = {
  id: string;
  file: string;
  line: string;
  componentName: string;
  textContent: string;
  url: string;
  prompt: string;
  selectionKind: "leaf" | "parent";
};

let items: PickItem[] = [];

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function lineSuffix(line: string): string {
  return line !== "?" && Number.isFinite(Number(line)) ? `:${line}` : "";
}

function toClipboardBlock(item: PickItem): string {
  const fileLine = `${item.file}${lineSuffix(item.line)}`;
  const text = truncate(item.textContent ?? "", 180).replace(/\s+/g, " ").trim();
  const prompt = (item.prompt ?? "").trim();
  const promptPart = prompt ? ` ${prompt}` : "";

  const lead =
    item.selectionKind === "leaf"
      ? `In @${fileLine} ${item.componentName}("${text}") -${promptPart}`
      : `Inside @${fileLine} there is a "${item.componentName}" ${item.componentName}("${text}") -${promptPart}`;
  return `${lead}\nAdditional info:\n- URL: ${item.url}`;
}

function buildClipboardText(all: PickItem[]): string {
  const legend = "Please review the following items and fix them if necessary or ask for clarification";
  const blocks = all.map(toClipboardBlock);
  return [legend, ...blocks].join("\n\n\n");
}

async function refreshFromStorage(): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  items = ((data[STORAGE_KEY] as PickItem[] | undefined) ?? []).filter(Boolean);
  render();
}

function render(): void {
  if (!items.length) {
    list.innerHTML = `<div class="empty">No items yet. Pick components to start building context.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="row">
        <strong>${escapeHtml(item.componentName)}</strong>
        <button class="icon" data-action="delete" data-id="${escapeHtml(item.id)}" title="Delete">✕</button>
      </div>
      <div class="badges">
        <span class="badge">${escapeHtml(`${item.file}${lineSuffix(item.line)}`)}</span>
        <span class="badge">${escapeHtml(truncate(item.textContent || "", 80) || "(no text)")}</span>
      </div>
      <div class="url">${escapeHtml(item.url)}</div>
      <textarea class="prompt" data-id="${escapeHtml(item.id)}" placeholder="Add prompt for this item...">${escapeHtml(item.prompt || "")}</textarea>
    `;
    list.appendChild(card);
  }
}

list.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest("button[data-action='delete']") as HTMLButtonElement | null;
  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;
  void chrome.runtime.sendMessage({ type: "DELETE_PICK_ITEM", id });
});

list.addEventListener("input", (e) => {
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLTextAreaElement)) return;
  const id = t.dataset.id;
  if (!id) return;
  void chrome.runtime.sendMessage({ type: "UPDATE_PICK_PROMPT", id, prompt: t.value });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) return;
  items = ((changes[STORAGE_KEY].newValue as PickItem[] | undefined) ?? []).filter(Boolean);
  render();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshFromStorage();
});

async function copyNow(clearAfter: boolean): Promise<void> {
  const text = buildClipboardText(items);
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    if (clearAfter) {
      await chrome.runtime.sendMessage({ type: "CLEAR_ITEMS" });
    }
  } catch {
    // ignore, button labels indicate failure minimally
  }
}

copyBtn.addEventListener("click", async () => {
  await copyNow(false);
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
});

copyClearBtn.addEventListener("click", async () => {
  await copyNow(true);
  copyClearBtn.textContent = "Copied & Cleared!";
  setTimeout(() => (copyClearBtn.textContent = "Copy & Clear"), 1200);
});

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_ITEMS" });
});

void refreshFromStorage();
