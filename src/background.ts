const STORAGE_KEY = "contextBuffer";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener(
  (message: { type?: string; block?: string }, _sender, sendResponse) => {
    if (message?.type === "APPEND_PICK" && typeof message.block === "string") {
      void appendBlock(message.block)
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) => {
          console.error("[React Context Picker] appendBlock failed", e);
          sendResponse({ ok: false, error: String(e) });
        });
      return true;
    }
    if (message?.type === "GET_BUFFER") {
      void chrome.storage.local.get(STORAGE_KEY).then((data) => {
        sendResponse({ text: String(data[STORAGE_KEY] ?? "") });
      });
      return true;
    }
    if (message?.type === "CLEAR_BUFFER") {
      void chrome.storage.local.set({ [STORAGE_KEY]: "" }).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  },
);

async function appendBlock(block: string): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const prev = String(data[STORAGE_KEY] ?? "");
  const next = prev ? `${prev}\n\n${block}` : block;
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}
