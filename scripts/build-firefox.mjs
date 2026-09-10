#!/usr/bin/env node
/**
 * Post-build hook for `pnpm build:firefox`.
 *
 *  1. copy the freshly built Chromium extension (extension/) -> extension-firefox/
 *  2. swap in the Firefox manifest (public/manifest.firefox.json):
 *     - background.scripts + type:module  (Firefox 不支持 service_worker)
 *     - browser_specific_settings.gecko.id
 *     - options_ui (Firefox 忽略 options_page)
 *
 * Run standalone with:  node scripts/build-firefox.mjs
 */
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "extension");
const DST = resolve(ROOT, "extension-firefox");
const MANIFEST_SRC = resolve(ROOT, "public/manifest.firefox.json");

if (!existsSync(SRC)) {
  console.error("[build-firefox] ERROR: source dir not found: extension/ (run `vite build` first)");
  process.exit(1);
}

await rm(DST, { recursive: true, force: true });
await cp(SRC, DST, { recursive: true });

const manifest = await readFile(MANIFEST_SRC, "utf8");
await writeFile(resolve(DST, "manifest.json"), manifest);
console.log(`[build-firefox] extension-firefox/ 已生成 (manifest 已替换为 Firefox 版)`);
