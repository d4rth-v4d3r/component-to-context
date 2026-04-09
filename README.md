# React Context Picker (Chrome extension)

**Google Chrome only.** Dev-only helper: **Alt+click** (macOS: **Option+click**) a DOM node on a local React/Next dev server to append component context (`@file:line`, name, current path + query) to a side panel. Use **Copy all** to paste into an AI agent.

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
4. Hold **Alt** (Windows/Linux) or **Option** (macOS) and **left-click** a visible UI element that belongs to your React tree. Each click **appends** a block to the textarea.
5. Click **Copy all** at the bottom and paste into your agent. Use **Clear** to reset the buffer.

**What to expect**

- In **development** builds, you should usually see a real source path (and often a line) from React’s dev info. If you see `@unknown:?` or `Anonymous`, try the [Troubleshooting](#troubleshooting) section.
- **Server Components** may not resolve to a useful fiber on the node you click; client components and normal DOM are the reliable cases.

## Allowed URLs

The generated `manifest.json` matches:

- `http://localhost/*`, `https://localhost/*`, and the same for **`*.localhost`** (nested subdomains) and **`127.0.0.1`**, with **default ports** (80 / 443) and these **explicit ports**:  
  `3000`, `3001`, `3500`, `4000`, `4173`, `5000`, `5173`, `5174`, `8080`, `8081`, `8888`, `9000`, `1355`, `9323`.

If your dev server uses **another port**, add it to the `DEV_PORTS` array in [`scripts/write-manifest.mjs`](scripts/write-manifest.mjs), run **`npm run build`** again, and use **Reload** on the extension in `chrome://extensions`.

## Updating after code changes

1. Run **`npm run build`** (or let **`npm run watch`** rebuild).
2. On **`chrome://extensions`**, click **Reload** (circular arrow) on **React Context Picker**.
3. **Refresh** the tab for your app so the content script reloads.

## Troubleshooting

- **Nothing happens on Alt+click**  
  - Confirm the page URL matches an [allowed pattern](#allowed-urls) (scheme, host, **port**).  
  - Reload the extension and refresh the tab.

- **No file/line or lots of `Anonymous`**  
  - Use a **development** build (`next dev`, Vite dev, etc.), not production.  
  - Optionally install the official [React Developer Tools](https://react.dev/learn/react-developer-tools) Chrome extension, reload the page, and try again.

- **Side panel does not open**  
  - Use Chrome **114+**. Click the puzzle icon → pin **React Context Picker**, then click its icon again.

## Privacy / scope

Intended for **local development** only. This repo does not target non-Chrome browsers.
