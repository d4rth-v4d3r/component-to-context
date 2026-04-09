/**
 * Page-world bundle must be a single IIFE (injected <script src> in the page realm).
 * Vite would split shared `fiber` into a separate chunk, which classic scripts cannot load.
 */
import * as esbuild from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

await esbuild.build({
  entryPoints: [resolve(root, "src/content/page-world-entry.ts")],
  bundle: true,
  outfile: resolve(root, "dist/content/page-world.js"),
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
});

console.log("Wrote dist/content/page-world.js (IIFE for page JS realm).");
