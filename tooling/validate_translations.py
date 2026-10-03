#!/usr/bin/env python3
"""Validate one translated locale dict against the English master.

Pre-merge gate: proves vanilla/locales/<code>.json is an honest, complete
translation of vanilla/locales/en.json before it may merge.

Usage:
  python3 tooling/validate_translations.py <code>             # e.g. ru
  python3 tooling/validate_translations.py --fix-meta <code>  # rewrite _meta only

Exit 0 = valid. Exit 1 = invalid (problems listed) or unreadable input.
Exit 2 = bad invocation.

Checks, in order (all must pass):
  1. Files parse: en.json loads as master, <code>.json parses.
  2. Key-completeness: flattened key set of <code>.json EQUALS en.json's
     set (same flatten rule as tooling/check_i18n.py: skip _meta, recurse
     dicts with "parent." prefixes, leaves are prefix+key).
  3. Placeholder preservation: for every key whose en value holds
     %(name)s-style placeholders, the translated value holds EXACTLY the
     same multiset of placeholders.
  4. Identifier preservation: any en value matching
     ^(1\.\d+\.\d+|#[#/][\w\-.?=&%/]*|https?://\S+|wss?://\S+)$ as a whole
     must be byte-verbatim equal in the translation; the same holds for
     the full keys settings.network_mainnet, settings.network_testnet,
     settings.custom_placeholder, settings.pending, settings.dash,
     settings.theme_original_blue, settings.theme_light,
     settings.theme_dark, shell.brand. (%(name)s-adjacent glue is
     covered by check 3, not here.)
  5. No-empty: every translated value is a string, and none is
     empty/whitespace-only unless en is.
  6. _meta: version == 1, untranslated is false,
     sorted(translated) == sorted(en master key set).

--fix-meta rewrites only _meta to
  {"version": 1, "untranslated": false, "translated": sorted(keys)}
and writes the file back with json.dumps(indent=2, ensure_ascii=False)
plus a trailing newline. Round-trip fidelity was verified read-only
first: dumping an untouched en/de/es dict with those settings reproduces
the file byte-identically, so the rewrite touches _meta and nothing else.

Stdlib only. Never edits the reference checkouts.
"""
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

PLACEHOLDER_RE = re.compile(r"%\([^)]+\)s")
IDENTIFIER_RE = re.compile(r"^(1\.\d+\.\d+|#[#/][\w\-.?=&%/]*|https?://\S+|wss?://\S+)$")
CODE_RE = re.compile(r"[A-Za-z][\w-]*")

# Values identical in every language by design (network/theme ids,
# punctuation placeholders, brand). Same set as tooling/check_i18n.py.
VERBATIM_KEYS = {
    "settings.network_mainnet",
    "settings.network_testnet",
    "settings.custom_placeholder",
    "settings.pending",
    "settings.dash",
    "settings.theme_original_blue",
    "settings.theme_light",
    "settings.theme_dark",
    "shell.brand",
}

SHOW_MAX = 20

# Deliberate empties (see tooling/merge_translations.py EXCEPT_EMPTY): the
# translation is complete without this fragment; the sibling fragment carries
# the whole meaning. Exempt from check 5 only — all other checks still apply.
EXCEPT_EMPTY = {"gateway.coins_failed_prefix"}


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.update(flatten(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out


def _short(value, width=64):
    text = value if isinstance(value, str) else repr(value)
    return text if len(text) <= width else text[: width - 1] + "\u2026"


def _capped(items):
    shown = list(items[:SHOW_MAX])
    if len(items) > SHOW_MAX:
        shown.append("(+%d more)" % (len(items) - SHOW_MAX))
    return ", ".join(shown)


def validate(code):
    problems = []

    # --- Check 1: files parse; en.json loads as master. ---
    try:
        with open(os.path.join(LOCALES, "en.json"), encoding="utf-8") as fh:
            en = json.load(fh)
    except (OSError, ValueError) as exc:
        print("FAIL: en.json unreadable: %s" % exc)
        return 1
    if not isinstance(en, dict):
        print("FAIL: en.json master is not an object")
        return 1
    try:
        with open(os.path.join(LOCALES, code + ".json"), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        print("FAIL: %s.json unreadable: %s" % (code, exc))
        return 1
    if not isinstance(data, dict):
        print("FAIL: %s.json is not an object" % code)
        return 1

    en_flat = flatten(en)
    en_keys = set(en_flat)
    flat = flatten(data)
    keys = set(flat)
    common = en_keys & keys

    # --- Check 2: key-completeness against the en master set. ---
    missing = sorted(en_keys - keys)
    extra = sorted(keys - en_keys)
    if missing:
        problems.append(
            "[2 key-completeness] missing %d key(s): %s"
            % (len(missing), _capped(missing))
        )
    if extra:
        problems.append(
            "[2 key-completeness] extra %d key(s): %s" % (len(extra), _capped(extra))
        )

    # --- Check 3: placeholder preservation (exact multiset match). ---
    ph_bad = []
    for key in sorted(common):
        en_val = en_flat[key]
        if not isinstance(en_val, str):
            continue
        want = PLACEHOLDER_RE.findall(en_val)
        if not want:
            continue
        got_val = flat[key]
        if not isinstance(got_val, str):
            continue  # non-string values are reported once, under check 5
        got = PLACEHOLDER_RE.findall(got_val)
        if collections.Counter(got) != collections.Counter(want):
            ph_bad.append(
                "%s: en placeholders %s, %s has %s"
                % (key, sorted(want), code, sorted(got))
            )
    for line in ph_bad[:SHOW_MAX]:
        problems.append("[3 placeholders] " + line)
    if len(ph_bad) > SHOW_MAX:
        problems.append("[3 placeholders] (+%d more)" % (len(ph_bad) - SHOW_MAX))

    # --- Check 4: identifier preservation (byte-verbatim). ---
    id_bad = []
    for key in sorted(common):
        en_val = en_flat[key]
        if not isinstance(en_val, str):
            continue
        if key not in VERBATIM_KEYS and not IDENTIFIER_RE.match(en_val):
            continue
        got_val = flat[key]
        if not isinstance(got_val, str):
            continue  # reported once, under check 5
        if got_val != en_val:
            id_bad.append(
                "%s: must stay verbatim %r, %s has %r"
                % (key, en_val, code, _short(got_val))
            )
    for line in id_bad[:SHOW_MAX]:
        problems.append("[4 identifiers] " + line)
    if len(id_bad) > SHOW_MAX:
        problems.append("[4 identifiers] (+%d more)" % (len(id_bad) - SHOW_MAX))

    # --- Check 5: values are strings; no-empty unless en is. ---
    empty_bad = []
    for key in sorted(common):
        got_val = flat[key]
        if not isinstance(got_val, str):
            empty_bad.append(
                "%s: expected string value in %s, got %s"
                % (key, code, type(got_val).__name__)
            )
            continue
        if got_val.strip() == "":
            en_val = en_flat[key]
            en_empty = isinstance(en_val, str) and en_val.strip() == ""
            if not en_empty and key not in EXCEPT_EMPTY:
                empty_bad.append(
                    "%s: empty/whitespace-only in %s but en is %r"
                    % (key, code, _short(en_val))
                )
    for line in empty_bad[:SHOW_MAX]:
        problems.append("[5 no-empty] " + line)
    if len(empty_bad) > SHOW_MAX:
        problems.append("[5 no-empty] (+%d more)" % (len(empty_bad) - SHOW_MAX))

    # --- Check 6: _meta shape against the en master key set. ---
    meta = data.get("_meta")
    if not isinstance(meta, dict):
        problems.append("[6 _meta] _meta missing or not an object")
    else:
        ver = meta.get("version")
        if type(ver) is not int or ver != 1:
            problems.append("[6 _meta] version must be 1, got %r" % (ver,))
        if meta.get("untranslated") is not False:
            problems.append(
                "[6 _meta] untranslated must be false, got %r"
                % (meta.get("untranslated"),)
            )
        translated = meta.get("translated")
        if not isinstance(translated, list) or any(
            not isinstance(t, str) for t in translated
        ):
            problems.append("[6 _meta] translated must be a list of strings")
        elif sorted(translated) != sorted(en_keys):
            miss = sorted(en_keys - set(translated))
            over = sorted(set(translated) - en_keys)
            if miss or over:
                problems.append(
                    "[6 _meta] translated lists %d key(s), en has %d "
                    "(missing %d: %s; extra %d: %s)"
                    % (
                        len(translated),
                        len(en_keys),
                        len(miss),
                        _capped(miss),
                        len(over),
                        _capped(over),
                    )
                )
            else:
                problems.append(
                    "[6 _meta] translated has the right key set but wrong "
                    "multiplicity (duplicates?), %d entries for %d keys"
                    % (len(translated), len(en_keys))
                )

    if problems:
        noun = "problem" if len(problems) == 1 else "problems"
        print("FAIL: %s.json invalid (%d %s):" % (code, len(problems), noun))
        for line in problems:
            print(line)
        return 1
    print(
        "OK: %s.json valid "
        "(%d keys; placeholders, identifiers, non-empty values, _meta green)."
        % (code, len(en_keys))
    )
    return 0


def fix_meta(code):
    path = os.path.join(LOCALES, code + ".json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        print("FAIL: %s.json unreadable: %s" % (code, exc))
        return 1
    if not isinstance(data, dict):
        print("FAIL: %s.json is not an object" % code)
        return 1
    flat = flatten(data)
    data["_meta"] = {
        "version": 1,
        "untranslated": False,
        "translated": sorted(flat),
    }
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    json.loads(text)  # sanity: output must stay parseable
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(
        "FIXED: %s.json _meta rewritten "
        "(version=1, untranslated=false, translated=%d keys)." % (code, len(flat))
    )
    return 0


def main(argv):
    fix = "--fix-meta" in argv
    rest = [a for a in argv if a != "--fix-meta"]
    if len(rest) != 1 or rest[0].startswith("-"):
        print(
            "usage: python3 tooling/validate_translations.py [--fix-meta] <code>",
            file=sys.stderr,
        )
        return 2
    code = rest[0]
    if CODE_RE.fullmatch(code) is None:
        print("invalid locale code: %r" % code, file=sys.stderr)
        return 2
    if fix:
        return fix_meta(code)
    return validate(code)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
