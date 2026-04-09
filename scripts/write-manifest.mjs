import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

const DEV_PORTS = [
  3000, 3001, 3500, 4000, 4173, 5000, 5173, 5174, 8080, 8081, 8888, 9000, 1355, 9323,
];

const schemes = ["http", "https"];

/**
 * Chrome `*.localhost` matches only **one** label (`foo.localhost`), not
 * `a.b.localhost`. Dev URLs like `x.y.web-ui.localhost` need `*.*.localhost`, etc.
 */
const LOCALHOST_LABEL_DEPTH = 6;

/** @type {Set<string>} */
const matches = new Set();

function add(p) {
  matches.add(p);
}

for (const scheme of schemes) {
  add(`${scheme}://localhost/*`);
  add(`${scheme}://127.0.0.1/*`);
}

for (let depth = 1; depth <= LOCALHOST_LABEL_DEPTH; depth++) {
  const host = `${Array(depth).fill("*").join(".")}.localhost`;
  for (const scheme of schemes) {
    add(`${scheme}://${host}/*`);
  }
}

for (const port of DEV_PORTS) {
  for (const scheme of schemes) {
    add(`${scheme}://localhost:${port}/*`);
    add(`${scheme}://127.0.0.1:${port}/*`);
    for (let depth = 1; depth <= LOCALHOST_LABEL_DEPTH; depth++) {
      const host = `${Array(depth).fill("*").join(".")}.localhost`;
      add(`${scheme}://${host}:${port}/*`);
    }
  }
}

const manifest = {
  manifest_version: 3,
  name: "React Context Picker",
  version: "1.0.0",
  description:
    "Dev-only: Shift+Alt+click React components on local URLs to build AI context (file, name, route). Chrome only.",
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
      all_frames: true,
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
