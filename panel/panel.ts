import "./panel.css";

const STORAGE_KEY = "contextBuffer";

const buf = document.getElementById("buf") as HTMLTextAreaElement;
const copyBtn = document.getElementById("copy") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;

async function refreshFromStorage(): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  buf.value = String(data[STORAGE_KEY] ?? "");
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[STORAGE_KEY]) {
    buf.value = String(changes[STORAGE_KEY].newValue ?? "");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshFromStorage();
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buf.value);
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy all";
    }, 1500);
  } catch {
    copyBtn.textContent = "Copy failed";
    setTimeout(() => {
      copyBtn.textContent = "Copy all";
    }, 2000);
  }
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: "" });
  buf.value = "";
});

void refreshFromStorage();
