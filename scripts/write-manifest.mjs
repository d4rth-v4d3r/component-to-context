import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

const DEV_PORTS = [
  3000, 3001, 3500, 4000, 4173, 5000, 5173, 5174, 8080, 8081, 8888, 9000, 1355, 9323,
];

const hosts = ["localhost", "*.localhost", "127.0.0.1"];
const schemes = ["http", "https"];

/** @type {string[]} */
const matches = new Set();

for (const scheme of schemes) {
  for (const host of hosts) {
    matches.add(`${scheme}://${host}/*`);
  }
}

for (const port of DEV_PORTS) {
  for (const scheme of schemes) {
    for (const host of hosts) {
      matches.add(`${scheme}://${host}:${port}/*`);
    }
  }
}

const manifest = {
  manifest_version: 3,
  name: "React Context Picker",
  version: "1.0.0",
  description:
    "Dev-only: Alt+click React components on local URLs to build AI context (file, name, route). Chrome only.",
  minimum_chrome_version: "114",
  permissions: ["sidePanel", "storage", "clipboardWrite"],
  host_permissions: [...matches],
  background: {
    service_worker: "background.js",
    type: "module",
  },
  content_scripts: [
    {
      matches: [...matches],
      js: ["content/pick.js"],
      run_at: "document_idle",
    },
  ],
  side_panel: {
    default_path: "panel/panel.html",
  },
  action: {
    default_title: "Open React Context Picker",
  },
};

writeFileSync(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log("Wrote dist/manifest.json with", matches.size, "match patterns.");
