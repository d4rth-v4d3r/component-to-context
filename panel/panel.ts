import "./panel.css";

const STORAGE_KEY = "contextBuffer";

const buf = document.getElementById("buf") as HTMLTextAreaElement;
const copyBtn = document.getElementById("copy") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;

async function refreshFromStorage(): Promise<void> {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  buf.value = String(data[STORAGE_KEY] ?? "");
}

chrome.storage.session.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (changes[STORAGE_KEY]) {
    buf.value = String(changes[STORAGE_KEY].newValue ?? "");
  }
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
  await chrome.storage.session.set({ [STORAGE_KEY]: "" });
  buf.value = "";
});

void refreshFromStorage();
