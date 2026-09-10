#!/usr/bin/env node
/**
 * Post-build hook for `pnpm build`.
 *
 *   1. sync the freshly built Chrome extension (extension/) into the Xcode
 *      Safari Web Extension project: bookmark-sync/Shared (Extension)/Resources
 *   2. on macOS, compile the Xcode project with xcodebuild
 *
 * Every branch prints a log line:
 *   - not macOS               -> skip Xcode build
 *   - Xcode not installed     -> skip Xcode build
 *   - xcodebuild failed       -> error log, non-zero exit
 *   - xcodebuild succeeded    -> success log
 *
 * Run standalone with:  node scripts/post-build-safari.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SYNC = resolve(ROOT, "bookmark-sync/sync-extension.sh");
const PROJ = resolve(ROOT, "bookmark-sync/bookmark-sync.xcodeproj");
const TARGET = "bookmark-sync (macOS)";
const CONFIG = "Debug";

const paint = (code, tag) => `\x1b[${code}m${tag}\x1b[0m`;
const log = (m) => console.log(`${paint(36, "[safari]")} ${m}`);
const ok = (m) => console.log(`${paint(32, "[safari]")} ${m}`);
const err = (m) => console.error(`${paint(31, "[safari]")} ${m}`);

// ── 1. sync extension/ -> Xcode project ──────────────────────────────────
if (!existsSync(SYNC)) {
  err(`sync script not found: ${SYNC}`);
  process.exit(1);
}
log("syncing extension/ into the Xcode Safari project ...");
try {
  execFileSync("bash", [SYNC], { stdio: "inherit" });
  ok("synced: extension/ -> Shared (Extension)/Resources/");
} catch {
  err("sync failed; aborting Xcode build.");
  process.exit(1);
}

// ── 2. platform gate ─────────────────────────────────────────────────────
if (process.platform !== "darwin") {
  log(`platform is '${process.platform}', not macOS -> skip Xcode build.`);
  process.exit(0);
}

// ── 3. Xcode availability ────────────────────────────────────────────────
let hasXcode = false;
try {
  const v = execFileSync("xcodebuild", ["-version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  hasXcode = /\bXcode\b/.test(v);
} catch {
  hasXcode = false;
}
if (!hasXcode) {
  log("Xcode not installed (xcodebuild unavailable) -> skip Xcode build.");
  process.exit(0);
}

// ── 4. compile with xcodebuild ───────────────────────────────────────────
log(`building Xcode target "${TARGET}" (${CONFIG}) ...`);
try {
  execFileSync(
    "xcodebuild",
    [
      "-project", PROJ,
      "-target", TARGET,
      "-configuration", CONFIG,
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ],
    { stdio: "inherit" }
  );
  ok(`Xcode build succeeded: "${TARGET}" (${CONFIG})`);
} catch {
  err(`Xcode build FAILED: "${TARGET}" (${CONFIG}). See output above.`);
  process.exit(1);
}
