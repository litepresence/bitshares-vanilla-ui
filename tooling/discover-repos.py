#!/usr/bin/env python3
"""discover-repos.py — GitHub repo discovery for BitShares node lists.

Pipeline: repo search -> candidate config paths -> wss:// extraction.
Stdlib + requests only. Respects rate limits (token-aware).

Usage:
  GITHUB_TOKEN=ghp_... python3 tooling/discover-repos.py [--pages 6] [--out /tmp/repo-nodes.json]

  Token: optional. Without it: 10 search req/min + 60 raw/hr (slow but works
  for small runs). With it: 30 search req/min + 5000 raw/hr.
  Candidate config paths tried per repo (raw.githubusercontent.com):
    app/api/apiConfig.js, src/config/chains.ts, src/config/nodes.ts,
    src/config/config.ts, src/stores/nodes.js, config.js,
    vuex-bitshares/config.js, app/api/ApiInstances.js,
    src/bts/ws/ApiInstances.ts, lib/dexConfig.js
  Output JSON: {repo_full_name: {branch, paths_hit, nodes[]}, ...}
  plus _meta {scanned, with_nodes, token_used}.

Discovery, not curation: every candidate MUST still pass latencyTEST.py
(chain-id + head-age + participation) before joining any shipped list.
"""
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("requests required: pip install requests")

API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"
TOKEN = os.environ.get("GITHUB_TOKEN", "")
HEADERS = {"Accept": "application/vnd.github+json"}
if TOKEN:
    HEADERS["Authorization"] = "Bearer " + TOKEN

PATHS = ["app/api/apiConfig.js", "src/config/chains.ts",
         "src/config/nodes.ts", "src/config/config.ts",
         "src/stores/nodes.js", "config.js",
         "vuex-bitshares/config.js", "app/api/ApiInstances.js",
         "src/bts/ws/ApiInstances.ts", "lib/dexConfig.js"]

WANT = ("wallet", "ui", "dex", "exchange", "config", "api", "node",
        "bot", "bitshares", "trade", "gateway", "bridge")


def api_get(url, params=None):
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, params=params, timeout=(6, 30))
            if r.status_code == 403 and "rate limit" in r.text.lower():
                reset = int(r.headers.get("X-RateLimit-Reset", time.time() + 60))
                wait = max(reset - time.time() + 5, 10)
                print("rate limited, sleeping %.0fs" % wait, flush=True)
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print("api fail %s: %s" % (url, e), flush=True)
            time.sleep(5)
    return None


def repo_priority(full, pushed):
    name = full.lower()
    score = sum(1 for w in WANT if w in name)
    return score


def extract_wss(text):
    out = set()
    for tok in text.replace('"', " ").replace("'", " ").replace(",", " ").split():
        if tok.startswith("wss://") and "." in tok and len(tok) < 120:
            out.add(tok.rstrip("/"))
    return sorted(out)


def main():
    pages = 6
    max_repos = 80
    out_path = "/tmp/repo-nodes.json"
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--pages" and i + 1 < len(argv):
            pages = int(argv[i + 1])
        if a == "--max-repos" and i + 1 < len(argv):
            max_repos = int(argv[i + 1])
        if a == "--out" and i + 1 < len(argv):
            out_path = argv[i + 1]
    print("token: %s" % ("yes" if TOKEN else "no (slow limits)"), flush=True)
    repos = []
    for p in range(1, pages + 1):
        d = api_get(API + "/search/repositories",
                    {"q": "bitshares", "sort": "updated", "order": "desc",
                     "per_page": 100, "page": p})
        if not d or not d.get("items"):
            break
        repos.extend(d["items"])
        if not TOKEN:
            time.sleep(7)  # unauth search budget: 10/min
    print("repos found: %d" % len(repos), flush=True)
    repos.sort(key=lambda r: repo_priority(r["full_name"], r.get("pushed_at", "")), reverse=True)
    repos = repos[:max_repos]
    print("scanning %d repos (top by name-score, recently updated first)" % len(repos), flush=True)
    found = {}
    for r in repos:
        full = r["full_name"]
        branch = r.get("default_branch") or "master"
        hits = {}
        for path in PATHS:
            url = "%s/%s/%s/%s" % (RAW, full, branch, path)
            try:
                resp = requests.get(url, timeout=(6, 30))
                if resp.status_code != 200 or len(resp.text) > 2000000:
                    continue
                nodes = extract_wss(resp.text)
                if nodes:
                    hits[path] = nodes
            except Exception:
                continue
            if not TOKEN:
                time.sleep(1)
        if hits:
            found[full] = {"branch": branch, "paths_hit": hits,
                           "nodes": sorted({n for v in hits.values() for n in v})}
            print("HIT %s: %d nodes" % (full, len(found[full]["nodes"])), flush=True)
    found["_meta"] = {"scanned": len(repos), "with_nodes": len([k for k in found if not k.startswith("_")]),
                      "token_used": bool(TOKEN)}
    with open(out_path, "w") as fh:
        json.dump(found, fh, indent=1)
    print("wrote %s (%d repos with nodes)" % (out_path, found["_meta"]["with_nodes"]), flush=True)


if __name__ == "__main__":
    main()
