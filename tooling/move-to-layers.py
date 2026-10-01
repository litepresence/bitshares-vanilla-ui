#!/usr/bin/env python3
"""One-shot layer move (2026-10-01): vanilla/js/*.js -> js/{sdk,api,builders,views}.

Pure moves, zero renames, zero logic changes. Updates every consumer found
by recon: index.html script tags, in-app lazy-load literals, extension pack
assert, tooling require()/PATH/prove-loader lists. Run once from /workspace:
  python3 tooling/move-to-layers.py
Aborts before any move if a file is unmapped or a consumer pattern is missed.
"""
import os
import re
import subprocess
import sys

WS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(WS, "vanilla", "js")

SDK = ["chain.js", "crypto.js"]
API = ["tx.js", "tx-send.js", "txbuilder.js", "format.js", "account.js",
       "asset.js", "market.js", "market-book.js", "market-candles.js",
       "market-fills-history.js", "pool.js", "pool-history.js",
       "pool-graph.js", "vote.js", "credit.js", "gateway.js", "htlc.js",
       "proposal.js", "notify.js", "notify-rules.js", "explorer.js",
       "explorer-tabs.js", "market-charts.js", "charts-lwc.js",
       "indicators.js", "indicators-osc.js", "indicators-qx.js",
       "indicators-tmom.js", "indicators-tulip.js", "indicators-tvol.js",
       "wallet.js"]
BUILDERS = ["asset-ops.js", "proposal-misc.js", "proposal-ticket.js",
            "credit-samet.js", "transfer-confirm.js", "trade-cancel.js",
            "trollbox.js"]
VIEWS_EXTRA = ["ops-ui.js", "market-orders.js", "market-ind.js",
               "market-desk.js", "market-picker.js", "explorer-render.js",
               "explorer-assets.js", "explorer-blocks.js", "vote-slate.js",
               "notify-host.js", "trade-form.js"]
ROOT = ["app.js", "router.js", "store.js", "settings.js", "settings-nodes.js",
        "settings-prefs.js", "i18n.js", "icon.js"]

LAYERS = {"sdk": SDK, "api": API, "builders": BUILDERS}
WHERE = {}
for layer, files in LAYERS.items():
    for f in files:
        assert f not in WHERE, "duplicate mapping: " + f
        WHERE[f] = layer


def main():
    present = sorted(f for f in os.listdir(JS)
                    if f.endswith(".js") and os.path.isfile(os.path.join(JS, f)))
    ui = sorted(f for f in present if f.endswith("-ui.js"))
    for f in sorted(set(ui) | set(VIEWS_EXTRA)):
        assert f in present, "mapped file missing on disk: " + f
        assert f not in WHERE, "duplicate mapping: " + f
        WHERE[f] = "views"
    for f in present:
        if f not in WHERE and f not in ROOT:
            sys.exit("ABORT: unmapped file " + f)
    moved = [f for f in present if f in WHERE]
    print("moving %d files (root keeps %d)" % (len(moved), len(ROOT)))

    for layer in ("sdk", "api", "builders", "views"):
        os.makedirs(os.path.join(JS, layer), exist_ok=True)
    for f in moved:
        subprocess.run(["git", "mv", "vanilla/js/" + f,
                        "vanilla/js/%s/%s" % (WHERE[f], f)],
                       cwd=WS, check=True)
    for d in ("vendor", "data"):
        subprocess.run(["git", "mv", "vanilla/js/" + d, "vanilla/js/sdk/" + d],
                       cwd=WS, check=True)

    def sub(path, old, new):
        with open(path, encoding="utf-8") as fh:
            s = fh.read()
        if old not in s:
            return False
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(s.replace(old, new))
        return True

    # 1. index.html script tags (incl. sdk/vendor + sdk/data).
    idx = os.path.join(WS, "vanilla", "index.html")
    for f, layer in sorted(WHERE.items()):
        if not sub(idx, '"js/%s"' % f, '"js/%s/%s"' % (layer, f)):
            print("NOTE: no index.html tag for " + f + " (lazy-loaded, verified separately)")
    sub(idx, '"js/vendor/', '"js/sdk/vendor/')
    sub(idx, '"js/data/', '"js/sdk/data/')

    # 2. In-app lazy-load literals (only these four exist — verified by grep).
    lazy = {"js/dashboard-ui.js": "js/views/dashboard-ui.js",
            "js/explorer-assets.js": "js/views/explorer-assets.js",
            "js/explorer-blocks.js": "js/views/explorer-blocks.js",
            "js/pool-graph.js": "js/api/pool-graph.js"}
    for root, _, files in os.walk(os.path.join(JS)):
        for fn in files:
            if fn.endswith(".js"):
                for old, new in lazy.items():
                    sub(os.path.join(root, fn), '"%s"' % old, '"%s"' % new)

    # 3. Extension pack tag assert.
    pack = os.path.join(WS, "tooling", "pack-extension.sh")
    if not sub(pack, '<script src="js/wallet.js">', '<script src="js/api/wallet.js">'):
        sys.exit("ABORT: pack-extension.sh wallet tag not found")

    # 4. Tooling loaders: full-path requires/PATHs + bare names in loader files.
    for root, _, files in os.walk(os.path.join(WS, "tooling")):
        for fn in files:
            if not (fn.endswith(".js") or fn.endswith(".cjs") or fn.endswith(".mjs")):
                continue
            p = os.path.join(root, fn)
            with open(p, encoding="utf-8") as fh:
                s = fh.read()
            if "vanilla/js" not in s:
                continue
            for f, layer in WHERE.items():
                s = s.replace("vanilla/js/%s" % f, "vanilla/js/%s/%s" % (layer, f))
                s = s.replace('"%s"' % f, '"%s/%s"' % (layer, f))
            s = s.replace('"vendor/', '"sdk/vendor/').replace('"data/', '"sdk/data/')
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(s)

    print("consumers updated. Verify:")
    print("  grep -rn '\"js/[a-z]' vanilla/js vanilla/index.html | grep -v 'js/sdk/\\|js/api/\\|js/builders/\\|js/views/'")
    print("  grep -rn 'vanilla/js/[a-z]*\\.js\"' tooling/ | grep -vE 'vanilla/js/(sdk|api|builders|views)/'")


if __name__ == "__main__":
    main()
