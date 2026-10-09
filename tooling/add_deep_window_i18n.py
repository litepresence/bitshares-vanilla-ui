#!/usr/bin/env python3
"""Add the deep-window i18n keys to all 12 vanilla locales.

Follows the add_market_hops_i18n.py precedent: all dicts are
fully-translated (untranslated=false), so new keys land allowlisted with
honest English values — translators refine wording, never keys. The
_meta.translated inventory is kept sorted in every dict, as check_i18n
expects (a fully-translated dict's allowlist must cover every key).

Formatting matches the committed files exactly (indent=2, raw UTF-8,
trailing newline) so the diff stays minimal.

Keys:
  pool_detail.candle_capped — suffix on the pool desk's count note when the
  community-index walk ended on its page/event/wall-clock budget instead of
  covering the requested span. Without it a truncated window is
  indistinguishable from "this pool never traded further back".

Idempotent: re-running reports existing keys and changes nothing.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t defaults from the call sites (check_i18n.py enforces
# byte-equality; any transcription slip here fails that gate).
NEW_KEYS = {
    # pool-detail-view.js rebucket() count note suffix
    "pool_detail.candle_capped": "window truncated",
    # market-candles.js / market desk — the same walk, same disclosure
    "market_ind.count_capped": "window truncated",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        changed = False
        for full, value in NEW_KEYS.items():
            section, _, key = full.partition(".")
            bucket = data.setdefault(section, {})
            if key not in bucket:
                bucket[key] = value
                changed = True
            elif bucket[key] != value:
                print("MISMATCH %s %s: %r != %r" % (path, full, bucket[key], value))
                return 1
            inv = data["_meta"]["translated"]
            if full not in inv:
                inv.append(full)
                changed = True
        data["_meta"]["translated"] = sorted(data["_meta"]["translated"])
        if changed:
            with io.open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
        print(("updated " if changed else "unchanged ") + path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
