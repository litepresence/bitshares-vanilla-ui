#!/usr/bin/env python3
"""Apply the menu-sitemap i18n batch (menu section + account follow keys +
12 new help topics + 2 amended bodies).

Single source = the JS: menu-ui.js SECTIONS + inline t() defaults, help-ui.js
TOPICS + BODY_DEFAULTS (via _test.topicBody), account-ui.js follow keys.
The script dumps key->default pairs with node, merges them into all 10
vanilla/locales/*.json (stubs get English-identical values per the slice-17
stub precedent), and writes back with the files' existing style
(indent=2, raw UTF-8, trailing newline).

Usage: python3 tooling/apply_i18n_menu_batch.py  (then run check_i18n.py)
"""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")
JS = os.path.join(HERE, "..", "vanilla", "js")

DUMP_JS = r"""
global.Icon = undefined;
global.I18n = { t: function (k, d) { return d; } };
var fs = require("fs");
var MenuUI = require(%s);
var HelpUI = require(%s);
var out = { menu: {}, help: {}, account: {} };
MenuUI.SECTIONS.forEach(function (s) {
  out.menu[s.titleKey.replace(/^menu\./, "")] = s.titleDefault;
  out.menu[s.blurbKey.replace(/^menu\./, "")] = s.blurbDefault;
  s.links.forEach(function (l) {
    out.menu[l.titleKey.replace(/^menu\./, "")] = l.titleDefault;
    out.menu[l.blurbKey.replace(/^menu\./, "")] = l.blurbDefault;
  });
});
function inline(file, prefix) {
  var src = fs.readFileSync(file, "utf8");
  var re = /t\(\s*"((?:menu|account|help)\.[a-z_0-9]+)"\s*,\s*"((?:[^"\\\n]|\\.)*)"\s*[,)]/g;
  var m;
  while ((m = re.exec(src)) !== null) {
    var key = m[1], val = m[2];
    var dot = key.indexOf(".");
    var sec = key.slice(0, dot), sub = key.slice(dot + 1);
    if (prefix && sec !== prefix) continue;
    try { val = JSON.parse('"' + val + '"'); } catch (e) { continue; }
    out[sec][sub] = val;
  }
}
inline(%s, "menu");
inline(%s, "menu");
inline(%s, "menu");
inline(%s, "help");
inline(%s, "account");
HelpUI.TOPICS.forEach(function (row) {
  out.help["topic_" + row[0] + "_title"] = row[1];
  out.help["topic_" + row[0] + "_text"] = row[2];
  out.help["topic_" + row[0] + "_body"] = HelpUI._test.topicBody(row[0]);
});
console.log(JSON.stringify(out));
""" % (
    json.dumps(os.path.join(JS, "views", "menu-ui.js")),
    json.dumps(os.path.join(JS, "views", "help-ui.js")),
    json.dumps(os.path.join(JS, "views", "menu-ui.js")),
    json.dumps(os.path.join(JS, "app.js")),
    json.dumps(os.path.join(JS, "views", "help-ui.js")),
    json.dumps(os.path.join(JS, "views", "help-ui.js")),
    json.dumps(os.path.join(JS, "views", "account-ui.js")),
)

# Only these account.* keys belong to this batch (account-ui.js holds hundreds
# of pre-existing keys the regex would otherwise sweep up). Same for help.*:
# only the community_* split keys — topic_* come from the TOPICS dump above.
ACCOUNT_ALLOW = {"follow", "unfollow"}


def main():
    raw = subprocess.run(
        ["node", "-e", DUMP_JS], capture_output=True, text=True, check=True
    ).stdout
    batch = json.loads(raw)
    batch["account"] = {
        k: v for k, v in batch["account"].items() if k in ACCOUNT_ALLOW
    }
    batch["help"] = {
        k: v for k, v in batch["help"].items()
        if k.startswith("topic_") or k.startswith("community_")
    }
    print("batch keys: menu=%d help=%d account=%d" % (
        len(batch["menu"]), len(batch["help"]), len(batch["account"])))
    assert len(batch["menu"]) > 100, "menu dump too small — regex broke?"
    assert len(batch["help"]) == 61 * 3 + 3, "help dump must cover 61 topics x3 + 3 community keys"

    for code in sorted(os.listdir(LOCALES)):
        if not code.endswith(".json"):
            continue
        path = os.path.join(LOCALES, code)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        changed = 0
        menu = data.setdefault("menu", {})
        for k, v in batch["menu"].items():
            if menu.get(k) != v:
                menu[k] = v
                changed += 1
        helpd = data.setdefault("help", {})
        for k, v in batch["help"].items():
            if helpd.get(k) != v:
                helpd[k] = v
                changed += 1
        acc = data.setdefault("account", {})
        for k, v in batch["account"].items():
            if acc.get(k) != v:
                acc[k] = v
                changed += 1
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("%s: %d keys updated" % (code, changed))
    # en _meta.translated must list every flat key (check_i18n rule 2); the
    # list stays sorted (HEAD precedent). Stubs/es keep their allowlists.
    en_path = os.path.join(LOCALES, "en.json")
    with open(en_path, encoding="utf-8") as f:
        en = json.load(f)

    def flat(d, prefix=""):
        out = {}
        for k, v in d.items():
            if k == "_meta":
                continue
            if isinstance(v, dict):
                out.update(flat(v, prefix + k + "."))
            else:
                out[prefix + k] = v
        return out

    en["_meta"]["translated"] = sorted(flat(en))
    with open(en_path, "w", encoding="utf-8") as f:
        json.dump(en, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("en.json translated list synced")


if __name__ == "__main__":
    main()
