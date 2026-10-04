# Footer Build-Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Footer-left shows `BITSHARES VANILLA UI {short7} · {relation} Master` (Master linked, live ahead/behind via GitHub compare) and footer-right shows `MAINNET - {host}` / `TESTNET - {host}` (green/yellow).

**Architecture:** Pure string/parse helpers in `app.js` (unit-tested under node, no DOM); one optional stdlib generator writes git data to `vanilla/version.json`; impure fetch wiring fails open at every step; one-shot string-surgery script adds 11 locale keys to all 12 dicts.

**Tech Stack:** Vanilla JS (ES5-style `var`, JSDoc), Python 3 stdlib only, CSS custom properties. No new dependencies.

## Global Constraints

- Zero runtime dependencies: stdlib only, no npm, no CDN, no build step required to serve.
- Every `t("key", "default")` call is single-line, double-quoted, and its default byte-equals the `en.json` value (`tooling/check_i18n.py` call-site drift gate).
- New locale keys land in ALL 12 `vanilla/locales/*.json` dicts AND all 12 `_meta.translated` lists (every locale is currently fully-translated mode: `untranslated=false`, `translated` = full key set).
- Every new JS function carries JSDoc `@param`/`@returns` (`bash tooling/check_types.sh` gate, tsc checkJs).
- New files open with a module-header block comment (principle #8).
- `tooling/check_rot.py` stays green: the runtime `fetch()` to `api.github.com` is data, not a source include (precedent: `vanilla/js/api/node-discover.js:74` already fetches it).
- The word `Master` is a branch-name identifier: byte-verbatim, never translated, never in a locale dict.
- Footer is never blank and never false at any step (degradation ladder in the spec).

**Spec:** `docs/superpowers/specs/2026-10-04-footer-build-info-design.md`

---

### Task 1: Pure footer helpers + node test (TDD)

**Files:**
- Create: `tooling/footer-build-test.js`
- Modify: `vanilla/js/app.js` (insert helper block before `function paintVersion(status) {`; extend `_test` export)

**Interfaces:**
- Consumes: existing `t(key, dflt, vars)` inside `app.js` (unchanged).
- Produces (exported via `App._test` for Task 4 wiring + tests):
  - `parseBuildInfo(json)` → `{repo: string, branch: string, commit: string, short: string} | null`
  - `parseCompare(json)` → `{ahead: number, behind: number, status: string} | null`
  - `compareUrl(repo, branch, commit)` → `string`
  - `relationText(cmp)` → `string` (`cmp` = `{ahead: number, behind: number}`; English via `t()` defaults under node)
  - `netHostText(network, host)` → `string`
  - `currentNetwork()` → `string` (`"mainnet"` or `"testnet"`; reads `Store.loadSettings`, guarded)

- [ ] **Step 1: Write the failing test** — create `tooling/footer-build-test.js` with exactly:

```js
/* footer-build-test.js — unit vectors for footer build-info pure helpers (app.js).
 * Stdlib only: `node tooling/footer-build-test.js` (exit 0 = green). Covers
 * parseBuildInfo/parseCompare/compareUrl/relationText/netHostText. No DOM,
 * no network, no deps (I18n absent under node, so t() uses English defaults).
 */
"use strict";
var assert = require("assert");
var App = require("../vanilla/js/app.js");
var T = App._test;
["parseBuildInfo", "parseCompare", "compareUrl", "relationText", "netHostText", "currentNetwork"].forEach(function (k) {
  assert.ok(T && typeof T[k] === "function", "_test." + k + " exported");
});

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var SHA40 = "0123456789abcdef0123456789abcdef01234567";
deq(T.parseBuildInfo({ repo: "litepresence/bitshares-vanilla-ui", branch: "master", commit: SHA40, short: "0123456", generated_at: "2026-10-04T00:00:00Z" }),
  { repo: "litepresence/bitshares-vanilla-ui", branch: "master", commit: SHA40, short: "0123456" }, "valid build info");
eq(T.parseBuildInfo(null), null, "null build info");
eq(T.parseBuildInfo({}), null, "empty build info");
eq(T.parseBuildInfo({ repo: "a/b", branch: "master", commit: "xyz" }), null, "short commit rejected");
eq(T.parseBuildInfo({ repo: "no-slash", branch: "master", commit: SHA40 }), null, "bad repo rejected");
eq(T.parseBuildInfo({ repo: "a/b", branch: "", commit: SHA40 }), null, "empty branch rejected");

deq(T.parseCompare({ ahead_by: 0, behind_by: 0, status: "identical" }), { ahead: 0, behind: 0, status: "identical" }, "identical");
deq(T.parseCompare({ ahead_by: 2, behind_by: 0, status: "ahead" }), { ahead: 2, behind: 0, status: "ahead" }, "ahead");
deq(T.parseCompare({ ahead_by: 0, behind_by: 3, status: "behind" }), { ahead: 0, behind: 3, status: "behind" }, "behind");
deq(T.parseCompare({ ahead_by: 1, behind_by: 1, status: "diverged" }), { ahead: 1, behind: 1, status: "diverged" }, "diverged");
eq(T.parseCompare(null), null, "null compare");
eq(T.parseCompare({ ahead_by: "2", behind_by: 0 }), null, "string count rejected");
eq(T.parseCompare({ ahead_by: -1, behind_by: 0 }), null, "negative rejected");

eq(T.compareUrl("litepresence/bitshares-vanilla-ui", "master", SHA40),
  "https://api.github.com/repos/litepresence/bitshares-vanilla-ui/compare/master..." + SHA40, "compare URL shape");

eq(T.relationText({ ahead: 0, behind: 0 }), "in sync with", "sync");
eq(T.relationText({ ahead: 1, behind: 0 }), "1 commit ahead of", "ahead singular");
eq(T.relationText({ ahead: 3, behind: 0 }), "3 commits ahead of", "ahead plural");
eq(T.relationText({ ahead: 0, behind: 1 }), "1 commit behind", "behind singular");
eq(T.relationText({ ahead: 0, behind: 4 }), "4 commits behind", "behind plural");
eq(T.relationText({ ahead: 2, behind: 1 }), "diverged from (2 ahead, 1 behind)", "diverged");

eq(T.netHostText("mainnet", "dex.iobanker.com"), "mainnet - dex.iobanker.com", "mainnet prefix");
eq(T.netHostText("testnet", "h"), "testnet - h", "testnet prefix");
eq(T.netHostText("bogus", "h"), "mainnet - h", "unknown network defaults mainnet");
eq(T.currentNetwork(), "mainnet", "no Store under node defaults mainnet");

console.log("footer-build-test: " + passed + " passed, 0 failed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/footer-build-test.js`
Expected: FAIL with `_test.parseBuildInfo exported` (helpers not exported yet).

- [ ] **Step 3: Write minimal implementation** — insert the block below immediately before the line `  function paintVersion(status) {` in `vanilla/js/app.js` (that line is unique; verified 2026-10-04):

```js
  /* Footer build-info pure helpers (spec 2026-10-04-footer-build-info-design:
   * no DOM, no fetch — the impure wiring below consumes these. Unit-tested
   * via _test; under node I18n is absent so t() falls back to the English
   * defaults, which check_i18n.py pins byte-equal to en.json). */
  var COMPARE_TTL_MS = 10 * 60 * 1000;
  var COMPARE_CACHE_KEY = "footerBuildCompare.v1";

  /**
   * version.json -> strict record or null (never throws, never partial).
   * @param {*} json parsed version.json
   * @returns {{repo: string, branch: string, commit: string, short: string} | null} */
  function parseBuildInfo(json) {
    try {
      if (!json || typeof json !== "object") return null;
      var commit = String(json.commit || "");
      if (!/^[0-9a-f]{40}$/i.test(commit)) return null;
      var repo = String(json.repo || "");
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
      var branch = String(json.branch || "");
      if (!branch) return null;
      var low = commit.toLowerCase();
      return { repo: repo, branch: branch, commit: low, short: low.slice(0, 7) };
    } catch (e) { return null; }
  }

  /**
   * GitHub compare payload -> counts or null (never throws).
   * @param {*} json parsed compare response
   * @returns {{ahead: number, behind: number, status: string} | null} */
  function parseCompare(json) {
    try {
      if (!json || typeof json !== "object") return null;
      var a = json.ahead_by, b = json.behind_by;
      if (typeof a !== "number" || typeof b !== "number" || !isFinite(a) || !isFinite(b)) return null;
      if (Math.floor(a) !== a || Math.floor(b) !== b || a < 0 || b < 0) return null;
      var st = String(json.status || "");
      if (st !== "identical" && st !== "ahead" && st !== "behind" && st !== "diverged") st = "";
      return { ahead: a, behind: b, status: st };
    } catch (e) { return null; }
  }

  /**
   * Compare endpoint for own commit vs branch tip (base...head with
   * base=branch, head=own SHA — verified 2026-10-04 to accept pushed SHAs).
   * @param {string} repo "owner/name"
   * @param {string} branch branch name
   * @param {string} commit 40-hex SHA
   * @returns {string} */
  function compareUrl(repo, branch, commit) {
    return "https://api.github.com/repos/" + repo + "/compare/" + branch + "..." + commit;
  }

  /**
   * Relation fragment for footer-left (Master link appended by caller).
   * @param {{ahead: number, behind: number}} cmp counts
   * @returns {string} */
  function relationText(cmp) {
    var c = cmp || {};
    var a = (typeof c.ahead === "number" && c.ahead > 0) ? Math.floor(c.ahead) : 0;
    var b = (typeof c.behind === "number" && c.behind > 0) ? Math.floor(c.behind) : 0;
    if (a > 0 && b > 0) {
      return t("shell.footer_diverged", "diverged from") + " (" + t("shell.footer_dahead", "%(n)s ahead", { n: String(a) }) + ", " + t("shell.footer_dbehind", "%(n)s behind", { n: String(b) }) + ")";
    }
    if (a > 0) {
      if (a === 1) return t("shell.footer_ahead_one", "1 commit ahead of");
      return t("shell.footer_ahead", "%(n)s commits ahead of", { n: String(a) });
    }
    if (b > 0) {
      if (b === 1) return t("shell.footer_behind_one", "1 commit behind");
      return t("shell.footer_behind", "%(n)s commits behind", { n: String(b) });
    }
    return t("shell.footer_sync", "in sync with");
  }

  /**
   * Active network, sole source Store settings (guarded mainnet default).
   * @returns {string} "mainnet" or "testnet" */
  function currentNetwork() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* mainnet below */ }
    return "mainnet";
  }

  /**
   * Footer-right line-1 text with network prefix (caps come from CSS).
   * @param {string} network "mainnet"|"testnet"
   * @param {string} host bare host or status word
   * @returns {string} */
  function netHostText(network, host) {
    var label = (network === "testnet") ? t("settings.network_testnet", "testnet") : t("settings.network_mainnet", "mainnet");
    return t("shell.footer_net_host", "%(net)s - %(host)s", { net: label, host: String(host) });
  }
```

Then extend the `_test` export. Old (exact, `vanilla/js/app.js` tail):

```js
  return { boot: boot, localizeShell: localizeShell, setPoolMarket: setPoolMarket,
    _test: { validPoolMarket: validPoolMarket } };
```

New:

```js
  return { boot: boot, localizeShell: localizeShell, setPoolMarket: setPoolMarket,
    _test: { validPoolMarket: validPoolMarket, parseBuildInfo: parseBuildInfo, parseCompare: parseCompare, compareUrl: compareUrl, relationText: relationText, netHostText: netHostText, currentNetwork: currentNetwork } };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/footer-build-test.js`
Expected: `footer-build-test: 24 passed, 0 failed` (exit 0).

- [ ] **Step 5: Run type gate**

Run: `bash tooling/check_types.sh`
Expected: `check_types: PASS`. If typescript is not installed in `tooling/typecheck/`, that is a dev-only env gap (never shipped): install per the script's own message, re-run, still expect PASS.

- [ ] **Step 6: Commit**

```bash
git add tooling/footer-build-test.js vanilla/js/app.js
git commit -m "Footer build-info: pure helpers + node vectors"
```

---

### Task 2: Build-info generator + gitignore + local version.json

**Files:**
- Create: `tooling/generate_version.py`
- Modify: `.gitignore` (append entry, idempotent one-liner — no anchor needed)
- Generate (untracked, never committed): `vanilla/version.json`

**Interfaces:**
- Consumes: local git (`rev-parse --show-toplevel`, `rev-parse HEAD`, `rev-parse --abbrev-ref HEAD`).
- Produces: `vanilla/version.json` = `{repo, branch, commit, short, generated_at}` consumed by Task 4 `loadBuildInfo()` via `parseBuildInfo()` (Task 1).

- [ ] **Step 1: Write the generator** — create `tooling/generate_version.py` with exactly:

```python
#!/usr/bin/env python3
"""Generate vanilla/version.json from local git (footer build-info).

Writes {repo, branch, commit, short, generated_at} for the footer-left
"commit + ahead/behind Master" display (spec
docs/superpowers/specs/2026-10-04-footer-build-info-design.md).
Optional dev/deploy tooling: the app runs without version.json (the static
skeleton stays). Safe to re-run. Verify with: git rev-parse HEAD.
Usage: python3 tooling/generate_version.py [--repo owner/name]
"""
import datetime
import json
import os
import subprocess
import sys

DEFAULT_REPO = "litepresence/bitshares-vanilla-ui"


def sh(args, cwd):
    """Run git and return stripped stdout (failures raise, caught in main)."""
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.DEVNULL).decode().strip()


def main():
    repo = DEFAULT_REPO
    args = sys.argv[1:]
    if len(args) == 0:
        pass
    elif len(args) == 2 and args[0] == "--repo" and "/" in args[1]:
        repo = args[1]
    else:
        print("usage: generate_version.py [--repo owner/name]", file=sys.stderr)
        return 2
    try:
        top = sh(["git", "rev-parse", "--show-toplevel"], os.getcwd())
        commit = sh(["git", "rev-parse", "HEAD"], top)
        branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], top)
    except (subprocess.CalledProcessError, OSError) as e:
        print("generate_version: not a git checkout (%s)" % e, file=sys.stderr)
        return 1
    if len(commit) != 40:
        print("generate_version: unexpected HEAD %r" % commit, file=sys.stderr)
        return 1
    info = {"repo": repo, "branch": branch or "master", "commit": commit.lower(),
            "short": commit.lower()[:7],
            "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    out = os.path.join(top, "vanilla", "version.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
        f.write("\n")
    print("generate_version: wrote " + out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Ignore the generated file** — append only if absent (idempotent):

Run: `python3 -c "p='.gitignore';s=open(p).read();open(p,'a').write('\n# Footer build-info (generated, optional - app falls back without it).\nvanilla/version.json\n' if 'vanilla/version.json' not in s else '')"`
Expected: no output; `tail -3 .gitignore` shows the `vanilla/version.json` line.

- [ ] **Step 3: Generate and verify**

Run: `python3 tooling/generate_version.py && cat vanilla/version.json`
Expected: `generate_version: wrote .../vanilla/version.json` plus JSON with `repo: litepresence/bitshares-vanilla-ui`, `branch: master`, 40-hex `commit`, 7-char `short`.

Run: `test "$(python3 -c "import json;print(json.load(open('vanilla/version.json'))['commit'])")" = "$(git rev-parse HEAD)" && echo COMMIT-MATCH`
Expected: `COMMIT-MATCH`.

Run: `git status --short vanilla/version.json`
Expected: `?? vanilla/version.json` (untracked — never `git add` it).

- [ ] **Step 4: Commit (generator + gitignore only, NOT version.json)**

```bash
git add tooling/generate_version.py .gitignore
git commit -m "Footer build-info: version.json generator (gitignored output)"
```

---

### Task 3: Locale keys (one-shot, all 12 dicts)

**Files:**
- Create: `tooling/add_footer_build_i18n.py`
- Modify: `vanilla/locales/*.json` (12 files, string surgery only — no JSON round-trip)

**Interfaces:**
- Consumes: nothing from other tasks (key names/values must match Task 1 `t()` defaults byte-for-byte — they are listed here verbatim; Task 4 pays out if they drift via `check_i18n.py`).
- Produces: 11 keys × 12 files as honest English stubs: `footer_brand_vanilla, footer_ahead, footer_ahead_one, footer_behind, footer_behind_one, footer_dahead, footer_dbehind, footer_diverged, footer_net_host, footer_offbranch, footer_sync` under `shell.*`, each also in every `_meta.translated` list.

- [ ] **Step 1: Write the one-shot** — create `tooling/add_footer_build_i18n.py` with exactly (anchors verified byte-identical in en/de/es 2026-10-04; the runner aborts any file on unexpected hit counts):

```python
#!/usr/bin/env python3
"""One-shot: footer build-info + network-prefix keys (2026-10-04).

Adds 11 shell.* keys (footer_brand_vanilla, footer_ahead/_one,
footer_behind/_one, footer_dahead, footer_dbehind, footer_diverged,
footer_net_host, footer_offbranch, footer_sync) to all 12
vanilla/locales/*.json as honest English stubs (principle #10 -
translators verify later). "Master" needs no key: it is the branch-name
identifier and stays byte-verbatim everywhere.

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run: finished files match no pattern and are left untouched.
Aborts a file on an unexpected hit count. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

DICT_BLOCK = ('    "footer_brand": "BITSHARES",\n'
              '    "footer_brand_vanilla": "BITSHARES VANILLA UI",\n'
              '    "footer_ahead": "%(n)s commits ahead of",\n'
              '    "footer_ahead_one": "1 commit ahead of",\n'
              '    "footer_behind": "%(n)s commits behind",\n'
              '    "footer_behind_one": "1 commit behind",\n'
              '    "footer_dahead": "%(n)s ahead",\n'
              '    "footer_dbehind": "%(n)s behind",\n'
              '    "footer_diverged": "diverged from",\n'
              '    "footer_net_host": "%(net)s - %(host)s",\n'
              '    "footer_offbranch": "not on Master",\n'
              '    "footer_sync": "in sync with"\n')

BEFORE_BLOCK = ('      "shell.footer_ahead",\n'
                '      "shell.footer_ahead_one",\n'
                '      "shell.footer_behind",\n'
                '      "shell.footer_behind_one",\n'
                '      "shell.footer_brand",\n')

AFTER_BLOCK = ('      "shell.footer_brand",\n'
               '      "shell.footer_brand_vanilla",\n'
               '      "shell.footer_dahead",\n'
               '      "shell.footer_dbehind",\n'
               '      "shell.footer_diverged",\n'
               '      "shell.footer_net_host",\n'
               '      "shell.footer_offbranch",\n'
               '      "shell.footer_sync",\n')

# (pattern, replacement, done_marker); every file must hit exactly once
# unless its done_marker is already present.
STEPS = [
    (re.compile(r'^    "footer_brand": "BITSHARES"\n', re.MULTILINE),
     DICT_BLOCK, '"footer_sync": "in sync with"'),
    (re.compile(r'^      "shell\.footer_brand",\n', re.MULTILINE),
     BEFORE_BLOCK, '"shell.footer_ahead"'),
    (re.compile(r'^      "shell\.footer_brand",\n', re.MULTILINE),
     AFTER_BLOCK, '"shell.footer_sync"'),
]

# NOTE: step 2 inserts BEFORE the brand line and step 3 appends AFTER it;
# both match the surviving original line exactly once (inserted lines
# differ), so sequential application is order-safe.


def main():
    paths = sorted(glob.glob(os.path.join(LOCALES, "*.json")))
    if len(paths) != 12:
        print("ABORT: expected 12 locale files, found %d" % len(paths))
        return 1
    for path in paths:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        changed = False
        for pat, repl, marker in STEPS:
            if marker in text:
                continue
            hits = len(pat.findall(text))
            if hits != 1:
                print("ABORT %s: %d hits" % (path, hits))
                return 1
            text = pat.sub(repl, text, count=1)
            changed = True
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            print("updated " + os.path.basename(path))
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run and verify green**

Run: `python3 tooling/add_footer_build_i18n.py`
Expected: 12 `updated XX.json` lines plus `done` (or silence + `done` on re-run).

Run: `python3 tooling/check_i18n.py`
Expected: exit 0, no problems.

- [ ] **Step 3: Commit**

```bash
git add tooling/add_footer_build_i18n.py vanilla/locales/
git commit -m "Footer build-info: 11 shell keys x12 locales (English stubs)"
```

---

### Task 4: app.js wiring + CSS + gates + manual matrix

**Files:**
- Modify: `vanilla/js/app.js` (`paintVersion` full replace; `paintFooter` three line-1 spans; add impure wiring block after the Task 1 helpers)
- Modify: `vanilla/css/app.css` (testnet glow rule; reduced-motion extension)
- Test: `tooling/footer-build-test.js` (re-run), `tooling/app-shell-test.js` (regression: `_test` export touched)

**Interfaces:**
- Consumes: Task 1 helpers (`parseBuildInfo`, `parseCompare`, `compareUrl`, `relationText`, `netHostText`, `currentNetwork`); Task 2 `vanilla/version.json`; Task 3 locale keys.
- Produces: working footer; verified by gates + manual matrix below.

- [ ] **Step 1: Add impure wiring** — insert the block below immediately after the Task 1 helper block (anchor: the closing `  }` of `netHostText` followed by the `/* paintVersion:` comment — place the new block between them):

```js
  /* Footer build-info wiring (impure: fetch + localStorage, all fail-open).
   * State: buildInfo (parsed version.json), buildCmp (null unknown |
   * {offbranch:true} | {ahead,behind,status}), buildCmpAt (ms stamp).
   * paintVersion renders current truth every call and kicks maybeRefreshCmp,
   * whose completion repaints — connection-event repaints never fetch
   * directly (TTL + cache, 60/hr unauthenticated GitHub budget respected). */
  var buildInfo = null, buildCmp = null, buildCmpAt = 0, buildFetching = false, buildBooted = false;

  /**
   * Fetch version.json once (same-origin; file:// failure falls to null).
   * @returns {Promise} resolves parsed record or null, never rejects */
  function loadBuildInfo() {
    if (typeof fetch === "undefined") return Promise.resolve(null);
    return fetch("version.json", { cache: "no-store" }).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().catch(function () { return null; });
    }).then(function (j) {
      return parseBuildInfo(j);
    }).then(null, function () { return null; });
  }

  /**
   * Cached compare for this commit or null (commit mismatch/TTL = null).
   * @param {string} commit 40-hex SHA
   * @returns {{ahead: number, behind: number, status: string} | {offbranch: boolean} | null} */
  function readCmpCache(commit) {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(COMPARE_CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || c.commit !== commit) return null;
      if (typeof c.at !== "number" || (Date.now() - c.at) > COMPARE_TTL_MS) return null;
      if (c.offbranch) return { offbranch: true };
      return parseCompare({ ahead_by: c.ahead, behind_by: c.behind, status: c.status });
    } catch (e) { return null; }
  }

  /**
   * Persist one compare result (best-effort, never throws).
   * @param {string} commit 40-hex SHA
   * @param {*} cmp compare record or {offbranch:true}
   * @returns {void} */
  function writeCmpCache(commit, cmp) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(COMPARE_CACHE_KEY, JSON.stringify({ commit: commit, ahead: cmp.ahead, behind: cmp.behind, status: cmp.status, offbranch: !!cmp.offbranch, at: Date.now() }));
    } catch (e) { /* cache optional */ }
  }

  /* Kick one guarded compare fetch; completion repaints. Never throws. */
  function maybeRefreshCmp() {
    if (!buildInfo || buildFetching) return;
    if (typeof fetch === "undefined") return;
    if (buildCmp && (Date.now() - buildCmpAt) <= COMPARE_TTL_MS) return;
    var cached = readCmpCache(buildInfo.commit);
    if (cached) { buildCmp = cached; buildCmpAt = Date.now(); return; }
    buildFetching = true;
    fetch(compareUrl(buildInfo.repo, buildInfo.branch, buildInfo.commit), { headers: { "Accept": "application/vnd.github+json" } }).then(function (r) {
      if (!r) return null;
      if (r.status === 404) return { offbranch: true };
      if (!r.ok) return null;
      return r.json().catch(function () { return null; });
    }).then(function (j) {
      if (!j) return;
      var next = j.offbranch ? { offbranch: true } : parseCompare(j);
      if (!next) return;
      buildCmp = next; buildCmpAt = Date.now();
      writeCmpCache(buildInfo.commit, next);
      paintVersion();
    }).then(null, function () { /* hash-only stands */ }).then(function () { buildFetching = false; });
  }

  /* One-shot boot for build info (skeleton stands until info lands). */
  function bootBuildInfo() {
    if (buildBooted) return;
    buildBooted = true;
    loadBuildInfo().then(function (info) {
      if (!info) return;
      buildInfo = info;
      paintVersion();
      maybeRefreshCmp();
    });
  }
```

- [ ] **Step 2: Replace paintVersion** — old block is the comment starting `  /* paintVersion: bottom-LEFT version string "BITSHARES <chainid8> • v1.0.0 •` through the closing `  }` just before `  /* shortHost:`. Replace the whole block with:

```js
  /* paintVersion: bottom-LEFT build string "BITSHARES VANILLA UI <short7>
   * · <relation> Master" (Master = branch-name identifier, hyperlinked to
   * the repo root from version.json; chain prefix retired per spec).
   * Ladder: full relation | offbranch "not on Master" | hash-only |
   * skeleton (no version.json — bootBuildInfo fails open, skeleton stands).
   * Called from paintFooter so every connection event refreshes it. */
  function paintVersion() {
    if (typeof document === "undefined") return;
    var left = document.getElementById("appfoot-version");
    if (!left) return;
    try {
      if (!buildInfo) { bootBuildInfo(); return; }
      maybeRefreshCmp();
      while (left.firstChild) left.removeChild(left.firstChild);
      var doc = left.ownerDocument || document;
      left.appendChild(doc.createTextNode(t("shell.footer_brand_vanilla", "BITSHARES VANILLA UI") + " " + buildInfo.short + " · "));
      if (buildCmp && buildCmp.offbranch) {
        left.appendChild(doc.createTextNode(t("shell.footer_offbranch", "not on Master") + " "));
      } else if (buildCmp) {
        left.appendChild(doc.createTextNode(relationText(buildCmp) + " "));
      }
      var a = doc.createElement("a");
      a.setAttribute("href", "https://github.com/" + buildInfo.repo);
      a.setAttribute("rel", "noopener");
      a.textContent = "Master";
      left.appendChild(a);
    } catch (e) { /* static skeleton stands */ }
  }
```

Note: `paintFooter` calls `paintVersion(status)` — an extra arg to a zero-param function is harmless in JS; leave the call site untouched.

- [ ] **Step 3: Prefix the three line-1 spans** — three exact edits in `paintFooter`:

(a) Mismatch branch. Old: `      if (mhost) ml1.appendChild(span(mhost, "appfoot-host", "closed"));`
New: `      if (mhost) ml1.appendChild(span(netHostText(currentNetwork(), mhost), "appfoot-host", "closed"));`

(b) Open branch. Old:
```js
      if (host) l1.appendChild(span(host, "appfoot-host", "open"));
      else l1.appendChild(span("—", "appfoot-host", "open"));
```
New:
```js
      var net = currentNetwork();
      if (host) l1.appendChild(span(netHostText(net, host), "appfoot-host", net === "testnet" ? "open-testnet" : "open"));
      else l1.appendChild(span(netHostText(net, "—"), "appfoot-host", net === "testnet" ? "open-testnet" : "open"));
```

(c) Closed branch. Old:
```js
      var host = shortHost(s.node);
      var l1 = line("appfoot-line1");
      if (host) l1.appendChild(span(host, "appfoot-host", "closed"));
      else if (state && state !== "unknown") l1.appendChild(span(state, "appfoot-host", "closed"));
```
New:
```js
      var host = shortHost(s.node);
      var l1 = line("appfoot-line1");
      var net2 = currentNetwork();
      if (host) l1.appendChild(span(netHostText(net2, host), "appfoot-host", "closed"));
      else if (state && state !== "unknown") l1.appendChild(span(netHostText(net2, state), "appfoot-host", "closed"));
```

(`var net` in (b) vs `var net2` in (c): both branches are separate `if/else` blocks in one function scope — `var` hoists, so distinct names avoid confusion; both are function-scoped and safe.)

- [ ] **Step 4: CSS testnet glow** — in `vanilla/css/app.css`, after:

```css
.appfoot-host[data-state="open"] {
  text-shadow: 0 0 8px var(--live);
  animation: candy-glow 3s ease-in-out infinite;
}
```

insert:

```css
/* Testnet twin of the open glow: --warn-text text (small-text contrast
 * contract, cf. node-table warn) + --warn halo, same candy-glow pulse. */
.appfoot-host[data-state="open-testnet"] {
  color: var(--warn-text);
  font-weight: 700;
  text-shadow: 0 0 8px var(--warn);
  animation: candy-glow 3s ease-in-out infinite;
}
```

And extend the reduced-motion stilling selector. Old:

```css
  p.muted[aria-live="polite"], .mkt-statstrip > span.muted:only-child,
  .appfoot-host[data-state="open"], .mkt-stat, #view.view-enter {
```

New:

```css
  p.muted[aria-live="polite"], .mkt-statstrip > span.muted:only-child,
  .appfoot-host[data-state="open"], .appfoot-host[data-state="open-testnet"], .mkt-stat, #view.view-enter {
```

- [ ] **Step 5: Run automated gates**

Run: `node tooling/footer-build-test.js && node tooling/app-shell-test.js`
Expected: both print `N passed, 0 failed`, exit 0.

Run: `bash tooling/check_types.sh`
Expected: `check_types: PASS`.

Run: `python3 tooling/check_rot.py`
Expected: exit 0 (the `api.github.com` URL appears only inside a `fetch()` string — same as the shipped `node-discover.js` precedent — not a source include).

Run: `python3 tooling/check_i18n.py`
Expected: exit 0 (Task 1 defaults byte-match the Task 3 en values; all 12 translated lists cover the 11 keys).

- [ ] **Step 6: Manual matrix** (serve + observe; `version.json` from Task 2 must exist):

Run: `python3 -m http.server 8080 --directory /workspace/vanilla`
Expected observations (record in the commit message body or a parity note):
1. Online mainnet: left `BITSHARES VANILLA UI {short7} · … Master` (Master links to `https://github.com/litepresence/bitshares-vanilla-ui`); right `MAINNET - {host}` green glow.
2. Settings → network testnet: right flips to `TESTNET - {host}` yellow; left unchanged.
3. Offline (devtools offline, reload): left hash + Master link, no relation (hash-only, honest).
4. `mv vanilla/version.json /tmp/version.json.bak`, reload: left shows the untouched skeleton `BITSHARES · v1.0.0 · Disclaimer`; restore the file after.
5. `file://` open of `vanilla/index.html`: skeleton or hash-only (browser-dependent fetch behavior) — either acceptable, never blank or throwing (check console).
6. Viewports 360px and 1440px + all three themes: left truncates with ellipsis on narrow, no layout break.

- [ ] **Step 7: Commit**

```bash
git add vanilla/js/app.js vanilla/css/app.css
git commit -m "Footer build-info + network prefix wiring (gates green, manual matrix done)"
```

---

## Self-Review

**1. Spec coverage:** build hash (§Display/ladder-1,3,4 → Tasks 2+4); live compare + 404-offbranch (ladder-2 → Task 4 `maybeRefreshCmp`); Master hyperlink from repo field (§Display, §Future migration → Task 4 `paintVersion`); MAINNET/TESTNET prefix + yellow (§Network prefix → Task 4 steps 3–4); i18n keys + verbatim Master (§3.9 → Task 3 + Global Constraints); TTL caching (§Data flow → `COMPARE_TTL_MS` + cache fns); gates (§Verification → Task 4 step 5); anti-rot (optional generator, fail-open fetch → Tasks 2+4). No gaps.

**2. Placeholder scan:** no TBD/TODO; all code blocks complete; exact commands with expected outputs; no "similar to" references (geo-script pattern is described but every line is spelled out).

**3. Type consistency:** `parseBuildInfo`/`parseCompare` JSDoc shapes match test `deepStrictEqual` targets and wiring consumers (`buildInfo.repo/.branch/.commit/.short`, `buildCmp.ahead/.behind/.offbranch`); `relationText`/`netHostText`/`currentNetwork` signatures identical in test, implementation, and call sites; `paintVersion()` zero-param change is call-compatible with the existing `paintVersion(status)` call site.
