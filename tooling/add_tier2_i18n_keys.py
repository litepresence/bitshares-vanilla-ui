#!/usr/bin/env python3
"""add_tier2_i18n_keys.py — Tier 2 settings + approval dict entries.

Adds NEW keys with English values to all 12 vanilla/locales/*.json and to
every dict's _meta.translated inventory (kept sorted, as check_i18n
expects). Non-en dicts keep English = honest stubs pending translator
verification (parity note records the pending batch; stubs never
masquerade — check_i18n's stub-honesty rule applies to untranslated flags,
and these dicts stay fully-inventoried so the key-completeness gate holds).

New keys mirror the t() defaults byte-for-byte (ambiguity A).

Usage: python3 tooling/add_tier2_i18n_keys.py
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# (namespace, anchor-key-or-None, {full.key: english-default}). Anchor
# inserts position-preserving after the anchor; None creates/appends the
# namespace in place.
BATCHES = [
    ("settings", "locale_unavailable", {
        "settings.sign_title": "Signing",
        "settings.sign_auto": "Automatic (extension when available)",
        "settings.sign_ext": "Always use the extension",
        "settings.sign_browser": "Always sign in this page",
        "settings.sign_mode_ext_page": "Signatures stay in the extension — isolated from websites.",
        "settings.sign_mode_ext": "Signatures are approved in the extension window.",
        "settings.sign_mode_browser": "Signatures happen in this page's memory.",
        "settings.sign_warn": "Any script running on this page — including a compromised hosted copy — could read your keys while unlocked. Route signing through the extension, or run a copy you control.",
        "settings.sign_guide": "How to install the extension",
        "settings.sign_sites": "Connected sites",
        "settings.sign_sites_empty": "No sites approved yet — approvals appear here with per-site revoke.",
        "settings.sign_revoke": "Revoke",
        "settings.sign_badge": "Extension signing active — details in Settings",
    }),
    ("approval", None, {
        "approval.title": "Approve signature",
        "approval.wallet_title": "This wallet requests a signature",
        "approval.site_prefix": "Site: ",
        "approval.account": "Account: ",
        "approval.chain": "Chain: ",
        "approval.remember": "Remember this account for this site",
        "approval.locked_note": "Session is locked — enter your wallet password to approve.",
        "approval.password": "Password",
        "approval.approve": "Approve",
        "approval.deny": "Deny",
        "approval.close": "Close",
        "approval.expires_in": "Expires in ",
        "approval.no_fields": "No displayable fields.",
        "approval.approved": "Approved and broadcast.",
        "approval.denied": "Denied.",
        "approval.no_runtime": "Extension runtime missing.",
        "approval.no_reply": "No reply from the signer.",
        "approval.unknown_intent": "No approval request found.",
        "approval.loading": "Loading approval…",
        "approval.load_failed": "Could not load the approval.",
    }),
]


def apply_batch(data, ns, anchor, new_keys):
    if ns not in data or not isinstance(data.get(ns), dict):
        data[ns] = {}
    section = data[ns]
    if anchor is not None and anchor not in section:
        return False
    shorts = {}
    for full, v in new_keys.items():
        shorts[full.split(".", 1)[1]] = v
    if anchor is None:
        for short, v in shorts.items():
            section[short] = v
        return True
    rebuilt = {}
    for key, val in section.items():
        rebuilt[key] = shorts.get(key, val)
        if key == anchor:
            for short, v in shorts.items():
                if short not in section:
                    rebuilt[short] = v
    data[ns] = rebuilt
    return True


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for ns, anchor, new_keys in BATCHES:
            if not apply_batch(data, ns, anchor, new_keys):
                print("ANCHOR %s.%s MISSING in %s" % (ns, anchor, path))
                return 1
        inv = data["_meta"]["translated"]
        for _, _, new_keys in BATCHES:
            for full in new_keys:
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
