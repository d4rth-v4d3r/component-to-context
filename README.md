# React Context Picker (Chrome extension)

**Google Chrome only.** Dev-only helper: hold **Shift+Alt** (Windows/Linux) or **Shift+Option** (macOS), then **left-click** a DOM node on a local React/Next dev server to append component context (`@file:line`, name, current path + query) to a side panel. Use **Copy all** to paste into an AI agent.

## Prerequisites

- [Google Chrome](https://www.google.com/chrome/) (desktop), **114+** (Side Panel API).
- **Node.js** 18+ and npm (or pnpm/yarn).

## Build

From the repo root:

```bash
npm install
npm run build
```

This produces a loadable extension folder: **`dist/`** (contains `manifest.json`, `background.js`, `content/pick.js`, `panel/`, etc.).

For active development you can run:

```bash
npm run watch
```

Then reload the extension in Chrome after each rebuild (see below).

## Install in Chrome (unpacked)

1. Open **`chrome://extensions`**.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the **`dist`** folder inside this project (the directory that contains **`manifest.json`**).
5. Optional: click **Details** on the extension and **Pin** it to the toolbar.

## How to test

1. Start your **local** Next.js or React app (e.g. `npm run dev`) so it is served on an allowed URL (see [Allowed URLs](#allowed-urls)).
2. Open that app in Chrome (e.g. `http://localhost:3000` or `http://something.web-ui.localhost:1355/...`).
3. Click the extension’s **toolbar icon** to open the **side panel** (the extension is configured to open the side panel when you click the icon).
4. Hold **Shift+Alt** (Windows/Linux) or **Shift+Option** (macOS) and **left-click** a visible UI element that belongs to your React tree. Each click **appends** a block to the textarea.
5. Click **Copy all** at the bottom and paste into your agent. Use **Clear** to reset the buffer.

**What to expect**

- In **development** builds, you should usually see a real source path (and often a line) from React’s dev info. If you see `@unknown:?` or `Anonymous`, try the [Troubleshooting](#troubleshooting) section.
- **Server Components** may not resolve to a useful fiber on the node you click; client components and normal DOM are the reliable cases.

## Allowed URLs

The generated `manifest.json` uses **`http://*/*`** and **`https://*/*`**. Chrome does not allow patterns like `*.*.localhost` (invalid host wildcard), and a single `*.localhost` only matches one subdomain label. Broad `http(s)://*/*` matches **any host and port** (including nested `*.web-ui.localhost` and custom ports) so local dev URLs work without maintaining a giant port list.

This is intentionally **dev-only**; do not ship this pattern to the Web Store without narrowing.

If you want to restrict origins later, replace those entries in [`scripts/write-manifest.mjs`](scripts/write-manifest.mjs) with explicit host patterns Chrome accepts, then **`npm run build`** and **Reload** the extension.

## Updating after code changes

1. Run **`npm run build`** (or let **`npm run watch`** rebuild).
2. On **`chrome://extensions`**, click **Reload** (circular arrow) on **React Context Picker**.
3. **Refresh** the tab for your app so the content script reloads.

## Troubleshooting

- **Nothing happens when using the chord**  
  - Confirm the page URL matches an [allowed pattern](#allowed-urls) (scheme, host, **port**). Multi-segment hosts like `x.y.localhost` require the rebuilt manifest (see [Allowed URLs](#allowed-urls)).  
  - **Reload** the extension on `chrome://extensions` and **refresh** the tab.  
  - Use **Shift+Option** (mac) or **Shift+Alt** (Win/Linux), then click; the handler uses `mousedown` on `window` capture and stops propagation so app click handlers should not run.

- **No file/line or lots of `Anonymous`**  
  - Use a **development** build (`next dev`, Vite dev, etc.), not production.  
  - Optionally install the official [React Developer Tools](https://react.dev/learn/react-developer-tools) Chrome extension, reload the page, and try again.

- **Side panel does not open**  
  - Use Chrome **114+**. Click the puzzle icon → pin **React Context Picker**, then click its icon again.

## Privacy / scope

Intended for **local development** only. This repo does not target non-Chrome browsers.
