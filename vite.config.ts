import { defineConfig, type Plugin } from "vite";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/** `vite build --watch` clears `dist/` and never ran `write-manifest.mjs`; emit manifest after every build. */
function writeChromeManifestPlugin(): Plugin {
  return {
    name: "write-chrome-manifest",
    closeBundle() {
      execSync("node scripts/write-manifest.mjs", {
        cwd: root,
        stdio: "inherit",
      });
    },
  };
}

export default defineConfig({
  root,
  plugins: [writeChromeManifestPlugin()],
  /** Relative asset URLs for `chrome-extension://` side panel pages. */
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        background: resolve(root, "src/background.ts"),
        pick: resolve(root, "src/content/pick.ts"),
        panel: resolve(root, "panel/panel.html"),
      },
      output: {
        entryFileNames(chunkInfo) {
          if (chunkInfo.name === "background") return "background.js";
          if (chunkInfo.name === "pick") return "content/pick.js";
          if (chunkInfo.name === "panel") return "panel/panel.js";
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames(info) {
          if (info.names?.[0]?.endsWith(".html")) return "panel/panel.html";
          return "assets/[name][extname]";
        },
      },
    },
  },
});
