const STORAGE_KEY = "contextItems";
/** Persisted so marker sync / locate work after the service worker restarts. */
const LAST_PICK_TAB_KEY = "rcpLastPickTabId";

/** Last tab that sent a pick (content script). Mirrors storage when possible. */
let lastPickTabId: number | undefined;

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
  /** Tab that created this pick (set by background from sender.tab). */
  sourceTabId?: number;
};

async function resolveTargetTabId(messageTabId: number | undefined): Promise<number | undefined> {
  if (typeof messageTabId === "number") return messageTabId;
  if (typeof lastPickTabId === "number") return lastPickTabId;
  const data = await chrome.storage.local.get(LAST_PICK_TAB_KEY);
  const stored = data[LAST_PICK_TAB_KEY];
  if (typeof stored === "number") return stored;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener(
  (
    message: {
      type?: string;
      block?: string;
      item?: PickItem;
      id?: string;
      prompt?: string;
      xpath?: string;
      tabId?: number;
    },
    sender,
    sendResponse,
  ) => {
    if (message?.type === "APPEND_PICK_ITEM" && message.item) {
      if (typeof sender.tab?.id === "number") {
        lastPickTabId = sender.tab.id;
        void chrome.storage.local.set({ [LAST_PICK_TAB_KEY]: sender.tab.id });
      }
      const item: PickItem = {
        ...message.item,
        ...(typeof sender.tab?.id === "number" ? { sourceTabId: sender.tab.id } : {}),
      };
      void appendItem(item)
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) => {
          console.error("[React Context Picker] appendItem failed", e);
          sendResponse({ ok: false, error: String(e) });
        });
      return true;
    }
    if (message?.type === "LOCATE_ON_PAGE" && typeof message.xpath === "string") {
      void (async () => {
        try {
          const tabId = await resolveTargetTabId(message.tabId);
          if (tabId == null) {
            sendResponse({ ok: false, error: "no_tab" });
            return;
          }
          chrome.tabs.sendMessage(tabId, { type: "HIGHLIGHT_ANCHOR", xpath: message.xpath }, (response) => {
            const err = chrome.runtime.lastError;
            if (err) sendResponse({ ok: false, error: err.message });
            else sendResponse(response ?? { ok: true });
          });
        } catch (e: unknown) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    if (message?.type === "SYNC_MARKERS") {
      /* No-op: page markers removed; highlight is panel-triggered only. */
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === "CLEAR_MARKERS") {
      void (async () => {
        try {
          const tabId = await resolveTargetTabId(message.tabId);
          if (tabId == null) {
            sendResponse({ ok: true });
            return;
          }
          chrome.tabs.sendMessage(tabId, { type: "CLEAR_MARKERS" }, (response) => {
            const err = chrome.runtime.lastError;
            if (err) sendResponse({ ok: false, error: err.message });
            else sendResponse(response ?? { ok: true });
          });
        } catch (e: unknown) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    // Backward compatibility with old sender.
    if (message?.type === "APPEND_PICK" && typeof message.block === "string") {
      const legacy: PickItem = {
        id: crypto.randomUUID(),
        file: "unknown",
        line: "?",
        componentName: "Anonymous",
        textContent: "",
        url: "",
        prompt: "",
        selectionKind: "leaf",
      };
      void appendItem(legacy).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "GET_ITEMS") {
      void chrome.storage.local.get(STORAGE_KEY).then((data) => {
        sendResponse({ items: (data[STORAGE_KEY] as PickItem[] | undefined) ?? [] });
      });
      return true;
    }
    if (message?.type === "UPDATE_PICK_PROMPT" && typeof message.id === "string") {
      void updatePrompt(message.id, typeof message.prompt === "string" ? message.prompt : "").then(() =>
        sendResponse({ ok: true }),
      );
      return true;
    }
    if (message?.type === "DELETE_PICK_ITEM" && typeof message.id === "string") {
      void deleteItem(message.id).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "CLEAR_ITEMS") {
      void chrome.storage.local.set({ [STORAGE_KEY]: [] }).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  },
);

async function appendItem(item: PickItem): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const prev = (data[STORAGE_KEY] as PickItem[] | undefined) ?? [];
  const normalized = { ...item, status: item.status ?? "pending" };
  const next = [normalized, ...prev];
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

async function updatePrompt(id: string, prompt: string): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const prev = (data[STORAGE_KEY] as PickItem[] | undefined) ?? [];
  const next = prev.map((x) => (x.id === id ? { ...x, prompt } : x));
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

async function deleteItem(id: string): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const prev = (data[STORAGE_KEY] as PickItem[] | undefined) ?? [];
  await chrome.storage.local.set({ [STORAGE_KEY]: prev.filter((x) => x.id !== id) });
}
