import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

/**
 * Chrome match patterns allow at most one `*` in the host (`*.localhost` is OK;
 * `*.*.localhost` is invalid → "Invalid host wildcard").
 *
 * A single host wildcard with no port matches **any host and any port** for http/https:
 * @see https://developer.chrome.com/docs/extensions/mv3/match_patterns
 *
 * Dev-only unpacked extension: broad patterns so nested hosts like
 * `a.b.web-ui.localhost:1355` work without listing every depth.
 */
const matches = ["http://*/*", "https://*/*"];

const manifest = {
  manifest_version: 3,
  name: "React Context Picker",
  version: "1.0.0",
  description:
    "Dev-only: Shift+Alt+click React components on local URLs to build AI context (file, name, route). Chrome only.",
  minimum_chrome_version: "114",
  permissions: ["sidePanel", "storage", "clipboardWrite"],
  host_permissions: [...matches],
  web_accessible_resources: [
    {
      resources: ["content/page-world.js"],
      matches: [...matches],
    },
  ],
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

console.log("Wrote dist/manifest.json with", matches.length, "match patterns (http/* + https/*).");
