const STORAGE_KEY = "contextItems";

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
    },
    _sender,
    sendResponse,
  ) => {
    if (message?.type === "APPEND_PICK_ITEM" && message.item) {
      void appendItem(message.item)
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) => {
          console.error("[React Context Picker] appendItem failed", e);
          sendResponse({ ok: false, error: String(e) });
        });
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
