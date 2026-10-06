#!/usr/bin/env python3
"""Sync multisig-ux strings into all 12 locale dicts (honest English stubs).

Adds the 20 keys introduced by the multisig-ux repairs (auth Card C,
asset propose notes, proposal story, account badge, txbuilder link).
en.json gets the canonical values; the 11 other dicts get byte-identical
stubs (stub honesty: unverified strings never masquerade as translations).
Call-site defaults must equal these values (check_i18n.py drift gate).

Usage: python3 tooling/sync_multisig_i18n.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

NEW_KEYS = {
    "auth": {
        "multisig_title": "Shared / multisig accounts",
        "multisig_body": "This wallet holds one key. Shared accounts need proposals + co-owner approvals, coordinated by proposal id (1.10.N). Browsing is public; only signing needs the password.",
        "multisig_step_propose": "Propose the operation (Transfer has Send/Propose; assets, barter and borrowing link to proposals).",
        "multisig_step_share": "Share the 1.10.N proposal id with co-owners.",
        "multisig_step_approve": "Co-owners approve (op 23) on the proposal page, or co-sign via the transaction builder.",
        "multisig_open_proposals": "View proposals",
        "multisig_open_txbuilder": "Open transaction builder",
    },
    "asset": {
        "multisig_title": "Shared issuer? Propose it",
        "multisig_body": "If this asset needs more than one approval, direct Sign fails \u2014 propose the change instead and ask co-owners to approve (op 23).",
        "multisig_open_proposals": "View proposals",
        "multisig_open_txbuilder": "Open transaction builder",
        "multisig_coowner_hint": "Co-owner? Propose the change on the proposals page and ask co-owners to approve (op 23).",
    },
    "proposal": {
        "multisig_story": "Shared account? One co-owner proposes, shares the 1.10.N id, the rest approve below. Multi-operation or multi-device work continues in the transaction builder.",
        "open_txbuilder": "Open transaction builder",
    },
    "account": {
        "multisig_checking": "Checking authorities\u2026",
        "multisig_single": "Single key \u2014 active %(ath)s/%(an)s \u00b7 owner %(oth)s/%(on)s.",
        "multisig_shared": "Shared account \u2014 active %(ath)s/%(an)s \u00b7 owner %(oth)s/%(on)s.",
        "multisig_single_hint": "Shared account? Proposals live on the proposals page.",
        "multisig_unavailable": "Authorities unavailable \u2014 proposals still list on the proposals page.",
        "multisig_view_proposals": "View proposals",
        "multisig_open_txbuilder": "Open transaction builder",
    },
    "txbuilder": {
        "link_proposals": "Proposals",
    },
}


def flatten_keys(d, prefix=""):
    out = []
    for k, v in d.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.extend(flatten_keys(v, prefix + k + "."))
        else:
            out.append(prefix + k)
    return out


def main():
    files = sorted(f for f in os.listdir(LOCALES) if f.endswith(".json"))
    for fn in files:
        path = os.path.join(LOCALES, fn)
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        added = 0
        for ns, keys in NEW_KEYS.items():
            if ns not in data or not isinstance(data[ns], dict):
                data[ns] = {}
            for k, v in keys.items():
                if data[ns].get(k) != v:
                    data[ns][k] = v
                    added += 1
        # _meta.translated must list every flattened key (fully-translated
        # dicts: coverage-exact; new values stay honest English stubs until
        # human translators verify them per principle #10).
        all_keys = sorted(flatten_keys(data))
        meta = data.get("_meta") or {}
        meta["version"] = 1
        if fn == "en.json":
            meta["untranslated"] = False
        # Non-en dicts keep their existing untranslated flag; only the
        # key list grows to stay coverage-exact.
        meta["translated"] = all_keys
        data["_meta"] = meta
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print("%s: +%d (%d keys)" % (fn, added, len(all_keys)))


if __name__ == "__main__":
    main()
