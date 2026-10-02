#!/usr/bin/env python3
"""i18n_add_keys.py — one-shot batch key inserter (Phase 3 precedent, reusable).

Adds NEW settings-namespace keys with English values to all 10
vanilla/locales/*.json (non-en dicts keep English = honest stubs, never
machine-translated) + en.json _meta.translated inventory (kept sorted, as
check_i18n expects). Stdlib only. Usage: python3 tooling/i18n_add_keys.py.
Fails non-zero if any dict lacks the anchor or check_i18n would go red.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh"]
ANCHOR = "network_testnet"  # insert new settings keys after this one

NEW_KEYS = {
    "settings.hist_yes": "History",
    "settings.hist_no": "No history",
    "settings.es_title": "Community history index",
    "settings.es_toggle": "Enable community history (ElasticSearch)",
    "settings.es_note": "Run by the community, not by this wallet — questions: t.me/bitsharesDEV. Turn off to use chain history only.",
    "settings.testnet_hist": "Testnet: node history works here, but the community index covers mainnet only — index-powered features are unavailable.",
}

NS, _, _ = "settings", None, None


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        settings = data.get("settings")
        if not isinstance(settings, dict) or ANCHOR not in settings:
            print("ANCHOR MISSING in %s" % path)
            return 1
        rebuilt = {}
        for key, val in settings.items():
            # Existing keys keep position but take the script value (script
            # mirrors the t() defaults byte-for-byte; reruns self-heal).
            if key in [f.split(".", 1)[1] for f in NEW_KEYS]:
                for full, v in NEW_KEYS.items():
                    if full.split(".", 1)[1] == key:
                        rebuilt[key] = v
                        break
            else:
                rebuilt[key] = val
            if key == ANCHOR:
                for full, v in NEW_KEYS.items():
                    if full.split(".", 1)[1] not in settings:
                        rebuilt[full.split(".", 1)[1]] = v
        data["settings"] = rebuilt
        if code == "en":
            inv = data["_meta"]["translated"]
            for full in NEW_KEYS:
                if full not in inv:
                    inv.append(full)
            inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
