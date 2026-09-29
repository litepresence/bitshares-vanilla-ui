#!/usr/bin/env bash
# Pack the extension wrapper (reproducible, python3+unzip only — no zip binary).
# Builds extension-wrapper/dist/chromium.zip (MV3) + firefox.zip (MV2):
#   vanilla/* copied verbatim + adapter injected into index.html +
#   manifest/background/adapter/content/icons. The web build never needs this.
# Usage: bash tooling/pack-extension.sh  (prints sha256 + file list)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/extension-wrapper"
VANILLA="$ROOT/vanilla"
DIST="$SRC/dist"
rm -rf "$DIST"
mkdir -p "$DIST/chromium" "$DIST/firefox"

for target in chromium firefox; do
  D="$DIST/$target"
  cp -r "$VANILLA"/. "$D"/
  mkdir -p "$D/adapter" "$D/background" "$D/content" "$D/icons"
  cp "$SRC/adapter/storage.js" "$SRC/adapter/bridge.js" "$D/adapter/"
  cp "$SRC/content/inject.js" "$D/content/"
  cp "$SRC/background/sw.js" "$D/background/"
  cp "$SRC/icons/"*.png "$D/icons/"
  if [ "$target" = "chromium" ]; then
    cp "$SRC/manifest.json" "$D/manifest.json"
  else
    cp "$SRC/manifest.firefox.json" "$D/manifest.json"
    cp "$SRC/background/firefox.html" "$D/background/"
  fi
  # Inject the storage adapter ahead of wallet.js consumers (source of truth
  # stays vanilla/index.html — this generated copy is never committed).
  python3 - "$D/index.html" <<'EOF'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
tag = '<script src="js/wallet.js"></script>'
assert tag in s, "wallet.js tag moved — update pack-extension.sh"
s = s.replace(tag, '<script src="adapter/storage.js"></script>\n' + tag, 1)
open(p, "w", encoding="utf-8").write(s)
print("adapter injected")
EOF
  # No remote code in the zip: fail on http(s) script/src/href.
  if grep -rEn '<script[^>]+src="https?://|<link[^>]+href="https?://|from .https?://|import\(.https?://' "$D" --include="*.html" --include="*.js" | grep -v "es\.bitshares\.dev\|api\.bitshares\|xbts\|wss://" ; then
    echo "FAIL: remote code reference in $target build" >&2
    exit 1
  fi
  (cd "$D" && python3 - "$DIST/$target.zip" <<'EOF'
import sys, os, zipfile
out, root = sys.argv[1], os.getcwd()
# Fixed timestamp + sorted order + unix perms = byte-stable output.
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, _dirs, files in os.walk("."):
        for f in sorted(files):
            p = os.path.join(dirpath, f)
            zi = zipfile.ZipInfo(os.path.relpath(p, "."), date_time=(2020, 1, 1, 0, 0, 0))
            zi.external_attr = 0o644 << 16
            with open(p, "rb") as fh:
                z.writestr(zi, fh.read())
print("zipped")
EOF
  )
  echo "== $target =="
  sha256sum "$DIST/$target.zip"
  python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(len(z.namelist()), 'files'); assert z.testzip() is None; print('zip OK')" "$DIST/$target.zip"
done
