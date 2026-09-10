#!/usr/bin/env bash
# Sync the Chrome MV3 extension (../extension) into the Xcode Safari Web Extension
# resource folder. Idempotent: safe to re-run after every source change.
set -euo pipefail
cd "$(dirname "$0")"

SRC="../extension"
DST="Shared (Extension)/Resources"

if [ ! -d "$SRC" ]; then echo "ERROR: source dir not found: $SRC" >&2; exit 1; fi
if [ ! -d "$DST" ]; then echo "ERROR: destination dir not found: $DST" >&2; exit 1; fi

echo ">> copying web sources"
cp -f "$SRC/background.js" "$DST/background.js"
cp -f "$SRC/popup.html"    "$DST/popup.html"
cp -f "$SRC/options.html"  "$DST/options.html"

echo ">> refreshing assets/"
rm -rf "$DST/assets"
cp -R "$SRC/assets" "$DST/assets"

echo ">> generating manifest.json (inject icons, drop default_locale)"
python3 - "$SRC/manifest.json" "$DST/manifest.json" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
m = json.load(open(src, encoding="utf-8"))
m["icons"] = {
    "48":  "images/icon-48.png",
    "96":  "images/icon-96.png",
    "128": "images/icon-128.png",
    "256": "images/icon-256.png",
    "512": "images/icon-512.png",
}
m.pop("default_locale", None)
json.dump(m, open(dst, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("   manifest:", m.get("name"), m.get("version"))
PY

echo ">> removing unused template demo files"
rm -f "$DST/content.js" "$DST/popup.css" "$DST/popup.js"
rm -rf "$DST/_locales"

echo "done: synced extension -> $DST"
