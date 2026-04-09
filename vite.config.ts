import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
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
