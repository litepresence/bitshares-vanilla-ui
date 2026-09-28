#!/usr/bin/env python3
"""Batch-2e i18n converter: mechanical t() swaps with byte-verbatim defaults.

Converts static display literals in the 21 batch-2e view files to
t("ns.slug", "verbatim literal") per slice-17 precedent (local t() helper
with I18n guard + vars passthrough). New keys accumulate in
vanilla/locales/frag-batch2e.json (nested sections); en.json and all other
dicts are NOT touched.

Scope rules (recorded):
  CONVERT: whole-string static display literals in allowlisted syntactic
    positions (el 3rd arg, textContent assign, field labels, placeholders
    unless skipped, routeReady titles, showStatus/showError literal args,
    String(e||...) fallbacks, setFieldError/empty/formError args, row()
    terms, title:/fail:/okText: props, ok: returns, allowlisted
    return/throw sentences, createTextNode sentences, pair-array labels,
    deskTable headers, allowlisted both-quoted ternaries + single-branch
    display words, m=/msg= display sentences).
  SKIP: amounts/dates/numbers, console strings, dynamic compositions (any
    literal adjacent to +), concat fragments, input values, inputmodes,
    types, classes, ids, hrefs, chain ids/URLs/symbols, op params, backend
    name arrays, serializer field names, token-valued placeholders/options,
    plural machinery, code-matched throws (any literal containing a
    message-code from indexOf/===/!== matchers in the batch), new Error
    codes, module-level data tables (TOPICS/ERRMAP/OP_NAMES/INNER_DEFS/
    KINDS -> use-site conversion by hand, dynamic keys).
  Param renames (ticket updateBox t->tk, vesting claimBox t->vr, help
  paintTopic t->topic + paintIndexList forEach t->e + renderHelp var t->hit)
  so inserted t() calls never hit a shadowed local. Renames run FIRST.

Pass order per file: renames -> deskTable headers -> pair arrays ->
line patterns -> helper injection.

Usage: python3 tooling/batch2e_convert.py [--apply]
  Default (no flag): dry run, prints per-file t() counts only.
  --apply: rewrites the 21 files + writes frag-batch2e.json.
"""
import json
import os
import re
import sys

VANILLA = "/workspace/vanilla/js"
FRAG = "/workspace/vanilla/locales/frag-batch2e.json"

NS_OF = {
    "credit-ui.js": "credit",
    "credit-detail-ui.js": "credit",
    "samet-ui.js": "samet",
    "borrow-ui.js": "borrow",
    "barter-ui.js": "barter",
    "proposal-ui.js": "proposal",
    "ticket-ui.js": "ticket",
    "misc-ui.js": "misc",
    "vesting-ui.js": "vesting",
    "accounts-ui.js": "accounts",
    "auth-ui.js": "auth",
    "news-ui.js": "news",
    "help-ui.js": "help",
    "fees-ui.js": "fees",
    "referrals-ui.js": "referrals",
    "favourites-ui.js": "favourites",
    "password-ui.js": "password",
    "prediction-ui.js": "prediction",
    "instant-trade-ui.js": "instant",
    "create-account-ui.js": "createaccount",
    "create-worker-ui.js": "createworker",
}

FILES = [f for f in NS_OF if f != "accounts-ui.js"]  # accounts-ui.js owned by
# batch-2a (already converted under account.*/transfer.* — see deviation log).
DQ = r'"((?:\\.|[^"\\])*)"'
TABLE_RE = re.compile(r"\b(INNER_DEFS|KINDS|TOPICS|ERRMAP)\b")

PLACEHOLDER_SKIP = {
    "", "0.00", "0.0", "0.1", "1.5", "30", "180", "1", "02…", "1.15.N",
    "BTS", "BTS_CNY", "BTS…", "https://…", "2026-maintenance",
    "account-name", "your-name", "alice,10\\nbob,2.5", "coffee|1.5\\ncake|2",
    "white",
}
LITERAL_SKIP = {
    "decimal", "numeric", "text", "url", "password", "button", "checkbox",
    "radio", "search", "submit", "white", "testnet", "mainnet", "BTS",
}
TERNARY_OK = {
    ("yes", "no"), ("enabled", "disabled"), ("yes (veto)", "no"),
    ("Removed", "Added"), ("Settled", "Open"),
    ("Settled (global settlement executed)", "Open (not settled)"),
    ("Register account", "Register account (testnet only)"),
}
SINGLE_OK = {"none", "none yet", "empty", "unchanged"}
RETURN_ALLOW_LOWER = {
    "instant (fully vested)", "missing condition/description",
    "description too short", "bad expiry date", "market fee ≥ 10%",
}

HELPER = (
    "\n"
    "  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the\n"
    "   * pre-conversion literal kept verbatim as enDefault (English-identical on any\n"
    "   * transport, incl. file:// where dict fetch fails). Falls back to the default\n"
    "   * when i18n.js failed to load: never blank, never throws. vars supports\n"
    "   * %(name)s templates at a few asset/named-count labels. */\n"
    "  function t(key, dflt, vars) {\n"
    "    try {\n"
    "      if (typeof I18n !== \"undefined\" && I18n && typeof I18n.t === \"function\") return I18n.t(key, dflt, vars);\n"
    "    } catch (e) { /* default below */ }\n"
    "    if (vars && typeof dflt === \"string\") return dflt.replace(/%\\(([^)]+)\\)s/g, function (m, name) {\n"
    "      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;\n"
    "    });\n"
    "    return dflt;\n"
    "  }\n"
)


def unescape(v):
    return v.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")


def escape(v):
    return v.replace("\\", "\\\\").replace('"', '\\"')


def slugify(lit):
    s = re.sub(r"[^a-z0-9]+", "_", lit.strip().lower()).strip("_")
    return s[:45].strip("_")


class Keyer:
    def __init__(self):
        self.frag = {}

    def key(self, ns, literal):
        slug = slugify(literal) or "s"
        sec = self.frag.setdefault(ns, {})
        for k, v in sec.items():
            if v == literal:
                return k
        cand, i = slug, 2
        while cand in sec:
            cand = "%s_%d" % (slug, i)
            i += 1
        sec[cand] = literal
        return cand


def message_codes(srcs):
    """Message matchers split by semantics:
    - substr: indexOf("X") — translation of any literal CONTAINING X would
      break the match, so containing literals stay unconverted.
    - exact: === / !== "X" — comparisons are exact (and tokens stay
      untranslated), so only IDENTICAL literals are blocked; display words
      merely containing a token ("Auto-repay" contains === token "repay")
      are safe to convert."""
    substr, exact = set(), set()
    for src in srcs:
        for m in re.finditer(r"\.indexOf\(\s*" + DQ + r"\s*\)", src):
            substr.add(unescape(m.group(1)))
        for m in re.finditer(r"(?:===|!==)\s*" + DQ, src):
            exact.add(unescape(m.group(1)))
    return substr, exact


def has_letter(s):
    return re.search(r"[A-Za-z]", s) is not None


def func_span(lines, fname):
    """(start, end) line indexes (0-based, end exclusive) of `function F(`."""
    start = end = None
    for i, l in enumerate(lines):
        if re.search(r"\bfunction\s+" + fname + r"\s*\(", l):
            start = i
            break
    if start is None:
        return None
    depth = 0
    for i in range(start, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if i > start and depth <= 0:
            end = i + 1
            break
    return (start, end or len(lines))


def rename_in_span(src, fname, old, new, index_only=False):
    """Rename whole-word `old` -> `new` (or old[N] -> new[N]) inside one
    function span. Returns (src, count)."""
    lines = src.split("\n")
    span = func_span(lines, fname)
    if span is None:
        return src, 0
    pat = re.compile(r"\b" + old + r"\[(\d+)\]") if index_only else re.compile(r"\b" + old + r"\b")
    n = 0
    for i in range(span[0], span[1]):
        if index_only:
            lines[i], c = pat.subn(new + r"[\1]", lines[i])
        else:
            lines[i], c = pat.subn(new, lines[i])
        n += c
    return "\n".join(lines), n


def split_call_args(rest):
    """Split rest (text after 'showError(') into top-level comma args;
    returns list of arg strings (without the final close paren) + suffix."""
    args, depth, cur = [], 0, ""
    in_str, esc = False, False
    i = 0
    while i < len(rest):
        ch = rest[i]
        if in_str:
            cur += ch
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            cur += ch
        elif ch in "([":
            depth += 1
            cur += ch
        elif ch in ")]":
            if depth == 0 and ch == ")":
                args.append(cur)
                return args, rest[i:]
            depth -= 1
            cur += ch
        elif ch == "," and depth == 0:
            args.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    args.append(cur)
    return args, ""


def is_lit(t):
    t = t.strip()
    m = re.match(r'^"((?:\\.|[^"\\])*)"$', t)
    return unescape(m.group(1)) if m else None


class Ctx:
    def __init__(self, ns, keyer, codes):
        self.ns = ns
        self.keyer = keyer
        self.substr, self.exact = codes

    def T(self, literal):
        return 't("%s.%s", "%s")' % (self.ns, self.keyer.key(self.ns, literal), escape(literal))

    def ok(self, lit):
        if not has_letter(lit) or lit in LITERAL_SKIP:
            return False
        if lit in self.exact:
            return False
        for c in self.substr:
            if c and c in lit:
                return False
        return True

    def sent(self, lit):
        return self.ok(lit) and " " in lit


def convert_lines(fname, src, ctx):
    out = []
    for line in src.split("\n"):
        s = line.strip()
        if (not s or s.startswith("//") or s.startswith("/*")
                or s.startswith("*") or "console." in s):
            out.append(line)
            continue
        line = p_attr(line, ctx)
        line = p_placeholder(line, ctx)
        line = p_el(line, ctx)
        line = p_textcontent(line, ctx)
        line = p_field(line, ctx)
        line = p_routeready(line, ctx)
        line = p_showstatus(line, ctx)
        line = p_showerror(line, ctx)
        line = p_or_fallback(line, ctx)
        line = p_2arg(line, ctx)
        line = p_row(line, ctx)
        line = p_cell(line, ctx)
        line = p_createtext(line, ctx)
        line = p_kv(line, ctx)
        line = p_msgassign(line, ctx)
        line = p_throw(line, ctx)
        line = p_return(line, ctx)
        line = p_ternary(line, ctx)
        line = p_single(line, ctx)
        out.append(line)
    return "\n".join(out)


def p_attr(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.ok(lit) else m.group(0)
    line = re.sub(r'(\.setAttribute\("aria-label",\s*)' + DQ + r'(\s*\))', r, line)
    line = re.sub(r'(\.title\s*=\s*)' + DQ + r'(\s*;)', r, line)
    line = re.sub(r'(\.placeholder\s*=\s*)' + DQ + r'(\s*;)', r, line)
    return line


def p_placeholder(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        if not ctx.ok(lit) or lit in PLACEHOLDER_SKIP:
            return m.group(0)
        return m.group(1) + ctx.T(lit)
    return re.sub(r'(placeholder\s*:\s*|setAttribute\("placeholder",\s*)' + DQ, r, line)


def p_el(line, ctx):
    # Groups: 1=prefix incl. tag, 2=tag-inner, 3=text-inner, 4=trailing
    # comma/paren. The TEXT is group 3 (never the tag in group 2).
    def r(m):
        lit = unescape(m.group(3))
        return m.group(1) + ctx.T(lit) + m.group(4) if ctx.ok(lit) else m.group(0)
    return re.sub(r'(\bel\(\s*doc\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*)' + DQ + r'(\s*[,)])', r, line)


def p_textcontent(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.ok(lit) else m.group(0)
    return re.sub(r'(\.textContent\s*=\s*)' + DQ + r'(\s*;)', r, line)


def p_field(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.ok(lit) else m.group(0)
    return re.sub(r'(\b(?:ui\.)?(?:field|fieldRow|pwRow)\(\s*doc\s*,\s*)' + DQ + r'(\s*,)', r, line)


def p_routeready(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.ok(lit) else m.group(0)
    return re.sub(r'(\b(?:ui\.)?routeReady\(\s*root\s*,\s*)' + DQ + r'(\s*,)', r, line)


def p_showstatus(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.ok(lit) else m.group(0)
    return re.sub(r'(\b(?:ui\.)?showStatus\(\s*doc\s*,\s*[A-Za-z0-9_.]+\s*,\s*)' + DQ + r'(\s*\))', r, line)


def p_showerror(line, ctx):
    m = re.search(r'\b(?:ui\.)?showError\(', line)
    if not m:
        return line
    args, suffix = split_call_args(line[m.end():])
    if len(args) < 3:
        return line
    doc, box, third = args[0].strip(), args[1].strip(), args[2].strip()
    fourth = args[3].strip() if len(args) > 3 else None
    lit3, lit4 = is_lit(third), is_lit(fourth) if fourth is not None else None
    prefix = line[:m.end()] + args[0] + "," + args[1] + ","
    # Rebuild conservatively: keep original separators by re-slicing is
    # overkill; single-line calls use ", " so rebuild with ", ".
    pre = line[:m.end()] + doc + ", " + box + ", "
    if fourth is None:
        if lit3 is not None and ctx.sent(lit3):
            return pre + ctx.T(lit3) + suffix
        return line
    if third.strip().startswith("new Error"):
        if lit4 is not None and ctx.sent(lit4):
            return pre + third.strip() + ", " + ctx.T(lit4) + suffix
        return line
    if lit3 is not None:
        # (code, fallback): code stays, wrap a literal fallback only.
        if lit4 is not None and ctx.sent(lit4):
            return pre + third.strip() + ", " + ctx.T(lit4) + suffix
        return line
    if lit4 is not None and ctx.sent(lit4):
        return pre + third.strip() + ", " + ctx.T(lit4) + suffix
    return line


def p_or_fallback(line, ctx):
    # || "LIT" fallbacks (String(e||...) shapes). Single-word "none" is the
    # only bare-word display fallback converted (value defaults like "BTS"
    # stay: LITERAL_SKIP + letter rules guard the rest).
    def r(m):
        lit = unescape(m.group(1))
        if lit == "none":
            return "|| " + ctx.T(lit) if ctx.ok(lit) else m.group(0)
        return "|| " + ctx.T(lit) if ctx.sent(lit) else m.group(0)
    return re.sub(r'\|\|\s*' + DQ, r, line)


def p_2arg(line, ctx):
    # setFieldError / formError / empty / lockSel / addForm-btn handled
    # separately; this covers the (obj, "LIT") two-arg shapes.
    def r(m):
        lit = unescape(m.group(3))
        return m.group(1) + m.group(2) + ctx.T(lit) + m.group(4) if ctx.ok(lit) else m.group(0)
    line = re.sub(r'(\b(?:setFieldError|formError)\(\s*[A-Za-z0-9_.]+\s*,\s*)(' + DQ + r')(\s*\))',
                  lambda m: m.group(1) + (ctx.T(unescape(m.group(3))) if ctx.ok(unescape(m.group(3))) else m.group(2)) + m.group(4),
                  line)
    line = re.sub(r'(\bempty\(\s*doc\s*,\s*[A-Za-z0-9_.]+\s*,\s*)' + DQ + r'(\s*\))',
                  lambda m: m.group(1) + ctx.T(unescape(m.group(2))) + m.group(3)
                  if ctx.ok(unescape(m.group(2))) else m.group(0), line)
    line = re.sub(r'(\blockSel\(\s*ui\s*,\s*doc\s*,\s*[A-Za-z0-9_.]+\s*,\s*)' + DQ + r'(\s*\))',
                  lambda m: m.group(1) + ctx.T(unescape(m.group(2))) + m.group(3)
                  if ctx.ok(unescape(m.group(2))) else m.group(0), line)
    line = re.sub(r'(\b(?:ui\.)?reviewSection\(\s*doc\s*,\s*[A-Za-z0-9_.]+\s*,\s*(?:myGen|uiGen)\s*,\s*)' + DQ + r'(\s*,)',
                  lambda m: m.group(1) + ctx.T(unescape(m.group(2))) + m.group(3)
                  if ctx.ok(unescape(m.group(2))) else m.group(0), line)
    return line


def p_row(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.ok(lit) else m.group(0)
    return re.sub(r'(\brow\(\s*)' + DQ + r'(\s*,)', r, line)


def p_cell(line, ctx):
    def r(m):
        lit = unescape(m.group(1))
        if not re.match(r"[A-Z]", lit) or not ctx.ok(lit):
            return m.group(0)
        return '{ text: ' + ctx.T(lit) + ' }'
    return re.sub(r'\{\s*text:\s*' + DQ + r'\s*\}', r, line)


def p_createtext(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.sent(lit) else m.group(0)
    return re.sub(r'(\bcreateTextNode\(\s*)' + DQ + r'(\s*\))', r, line)


def p_kv(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) if ctx.ok(lit) else m.group(0)
    # Trailing lookahead: complete prop values only (dynamic "A" + ... never).
    return re.sub(r'(\b(?:title|fail|okText)\s*:\s*)' + DQ + r'(?=\s*[,}])', r, line)


def p_msgassign(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.sent(lit) else m.group(0)
    return re.sub(r'(\b(?:m|msg)\s*=\s*(?:fallback\s*\|\|\s*)?)' + DQ + r'(\s*;)', r, line)


def p_throw(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if ctx.sent(lit) else m.group(0)
    return re.sub(r'(\bthrow\s+new\s+Error\(\s*)' + DQ + r'(\s*\))', r, line)


def p_return(line, ctx):
    def r(m):
        lit = unescape(m.group(1))
        if lit in SINGLE_OK or lit in RETURN_ALLOW_LOWER:
            return "return " + ctx.T(lit) + ";"
        if (re.match(r"[A-Z]", lit) and ctx.ok(lit)
                and not re.search(r"[#:./]{2}|wss|1\.[0-9]", lit)):
            return "return " + ctx.T(lit) + ";"
        return m.group(0)
    return re.sub(r'\breturn\s*' + DQ + r'\s*;', r, line)


def p_ternary(line, ctx):
    def r(m):
        a, b = unescape(m.group(1)), unescape(m.group(2))
        if (a, b) in TERNARY_OK and m.group(3) in (",", ")", ";", "]"):
            return "? " + ctx.T(a) + " : " + ctx.T(b) + m.group(3)
        return m.group(0)
    return re.sub(r'\?\s*' + DQ + r'\s*:\s*' + DQ + r'(\s*[,)\];}])', r, line)


def p_single(line, ctx):
    # Single display branch (? "LIT" : expr / ? expr : "LIT"): SINGLE_OK
    # words only (none/empty/unchanged). Anything else is a value, a
    # fragment, or a state token.
    def r(m):
        lit = unescape(m.group(2))
        return m.group(1) + ctx.T(lit) + m.group(3) if lit in SINGLE_OK else m.group(0)
    line = re.sub(r'(\?\s*)' + DQ + r'(\s*:)', r, line)
    line = re.sub(r'(:\s*)' + DQ + r'(\s*[,)\];}])', r, line)
    return line


def p_addform(line, ctx):
    m = re.search(r'\baddForm\(\s*doc\s*,\s*[A-Za-z0-9_.]+\s*,\s*("[^"]*")\s*,\s*("[^"]*")\s*,\s*("[^"]*")\s*,\s*("[^"]*")\s*\)', line)
    if not m:
        return line
    btn = unescape(m.group(3)[1:-1])
    ph = unescape(m.group(4)[1:-1])

    def good(lit):
        return ctx.ok(lit)

    if not good(btn):
        return line
    new_ph = ctx.T(ph) if (good(ph) and ph not in PLACEHOLDER_SKIP) else m.group(4)
    return (line[:m.start(3)] + m.group(1) + ", " + m.group(2) + ", "
            + ctx.T(btn) + ", " + new_ph + line[m.end(4):])


def convert_headers(fname, src, ctx):
    """deskTable(doc, ["H1", ...]) header spans: wrap every lettered literal."""
    if TABLE_RE.search(src.split("\n")[0]):
        pass
    out = []
    for line in src.split("\n"):
        if TABLE_RE.search(line) or 't("' in line:
            out.append(line)
            continue
        m = re.search(r'deskTable\(\s*doc\s*,\s*\[(.*?)\]', line)
        if not m:
            out.append(line)
            continue

        def h(mm):
            lit = unescape(mm.group(1))
            return ctx.T(lit) if ctx.ok(lit) else mm.group(0)

        span = m.group(1)
        # Guard: header spans are pure string lists (no parens/calls).
        if re.search(r"[()]", span):
            out.append(line)
            continue
        out.append(line[:m.start(1)] + re.sub(DQ, h, span) + line[m.end(1):])
    return "\n".join(out)


PAIR_SKIP_RE = re.compile(r"globalThis|routeReady\(|var (need|miss)\b|\(need \|\||forEach\(function \((g|)\)")
# Backend-module identifiers: a line whose quoted literals are ALL in this
# set is a backend-need list (often a routeReady continuation line), never
# display text — translating one breaks the globalThis presence check.
BACKEND_IDS = {"Proposal", "ProposalTicket", "ProposalMisc", "Tx", "Account",
               "Wallet", "Format", "Asset", "AssetOps", "Chain", "Store",
               "Explorer", "Credit", "CreditSamet", "Market"}


def convert_pairs(fname, src, ctx):
    out = []
    in_table = False  # module-level data table (TOPICS/ERRMAP/INNER_DEFS/
    # KINDS): element lines never convert here (use-site conversion owns
    # them, so locale switches re-render instead of reading stale load-time
    # strings).
    for line in src.split("\n"):
        if re.search(r"\b(var TOPICS|var ERRMAP|var KINDS|INNER_DEFS)\b.*[=\:]\s*[\[{]", line):
            in_table = True
        if in_table:
            out.append(line)
            if re.search(r"[\]}];\s*$", line):
                in_table = False
            continue
        s = line.strip()
        if (not s or s.startswith("//") or s.startswith("/*")
                or s.startswith("*") or "console." in s or 't("' in line
                or TABLE_RE.search(line) or PAIR_SKIP_RE.search(line)):
            out.append(line)
            continue
        lits = [unescape(m.group(1)) for m in re.finditer(DQ, line)]
        if lits and all(l in BACKEND_IDS for l in lits):
            out.append(line)
            continue
        line = re.sub(r'\[\s*\[?"((?:\\.|[^"\\])*)",\s*"((?:\\.|[^"\\])*)"',
                      lambda m: r_pair2(m, ctx), line)
        line = re.sub(r'\[\s*"((?:\\.|[^"\\])*)",\s*(?=[A-Za-z_$(\[\d])',
                      lambda m: r_first(m, ctx), line)
        out.append(line)
    return "\n".join(out)


def codey(ctx, lit):
    """A literal is untranslatable when it IS an exact-match token or
    CONTAINS a substring-matched message code."""
    if lit in ctx.exact:
        return True
    for c in ctx.substr:
        if c and c in lit:
            return True
    return False


def r_pair2(m, ctx):
    a = unescape(m.group(1))
    b = unescape(m.group(2))

    def valueish(x):
        return (x == "" or x.startswith("#/") or re.match(r"^[\d.]+$", x)
                or re.match(r"^[a-z][a-z0-9+_./-]*$", x) or x in LITERAL_SKIP)

    new_a = ctx.T(a) if (re.match(r"[A-Z]", a) and ctx.ok(a) and not codey(ctx, a)) else None
    # B converts iff it carries language: multi-word; anything under an
    # empty/numeric/href A (option labels, link texts); or a capitalized
    # token under a word-token A (["open","Open"]). Bare lowercase tokens
    # under a label A (["Borrow+Repay","borrow"]) and both-token value
    # arrays (["active","owner"]) stay.
    new_b = None
    if has_letter(b) and b not in LITERAL_SKIP and not codey(ctx, b):
        a_empty_num_href = (a == "" or a.startswith("#/") or re.match(r"^[\d.]+$", a))
        a_word_token = bool(re.match(r"^[a-z][a-z0-9+_./-]*$", a)) or a in LITERAL_SKIP
        if " " in b or a_empty_num_href or (a_word_token and re.match(r"[A-Z]", b)):
            new_b = ctx.T(b)
    A = new_a if new_a is not None else '"%s"' % escape(a)
    B = new_b if new_b is not None else '"%s"' % escape(b)
    return m.group(0)[:m.group(0).index('"' + m.group(1) + '"')] + A + ", " + B


def r_first(m, ctx):
    a = unescape(m.group(1))
    if not re.match(r"[A-Z]", a):
        return m.group(0)

    if not ctx.ok(a) or codey(ctx, a):
        return m.group(0)
    return m.group(0)[:m.group(0).index('"' + m.group(1) + '"')] + ctx.T(a) + ", "


def inject_helper(src):
    if "\n  function t(key, dflt, vars) {" in src:
        return src
    marker = '  "use strict";\n'
    if marker not in src:
        sys.stderr.write("WARN: no use-strict marker\n")
        return src
    return src.replace(marker, marker + HELPER, 1)


def main():
    apply = "--apply" in sys.argv
    srcs = {f: open(os.path.join(VANILLA, f), encoding="utf-8").read() for f in FILES}
    codes = message_codes(srcs.values())
    keyer = Keyer()
    ctxs = {f: Ctx(NS_OF[f], keyer, codes) for f in FILES}
    outs = {}
    for f in FILES:
        # Idempotence guard: never re-process a file that already carries
        # the batch-2e helper (renames would otherwise rewrite t() calls).
        if "\n  function t(key, dflt, vars) {" in srcs[f]:
            print("%-22s already converted, skipping" % f)
            outs[f] = srcs[f]
            continue
        # 1. renames first (inserted t() must never be renamed).
        s = srcs[f]
        if f == "ticket-ui.js":
            s, _ = rename_in_span(s, "updateBox", "t", "tk")
        elif f == "vesting-ui.js":
            s, _ = rename_in_span(s, "claimBox", "t", "vr")
        elif f == "help-ui.js":
            s, _ = rename_in_span(s, "paintTopic", "t", "topic")
            lines = s.split("\n")
            span = func_span(lines, "paintIndexList")
            if span:
                for i in range(span[0], span[1]):
                    lines[i] = re.sub(r"\bfunction \(t\)", "function (e)", lines[i])
                    lines[i] = re.sub(r"\bt\[0\]", "e[0]", lines[i])
                    lines[i] = re.sub(r"\bt\[1\]", "e[1]", lines[i])
            s = "\n".join(lines)
            s, _ = rename_in_span(s, "renderHelp", "t", "hit")
        # 2. headers, 3. pairs, 4. line patterns, 5. helper.
        s = convert_headers(f, s, ctxs[f])
        s = convert_pairs(f, s, ctxs[f])
        s = convert_lines(f, s, ctxs[f])
        s = inject_helper(s)
        outs[f] = s
    if apply:
        for f in FILES:
            open(os.path.join(VANILLA, f), "w", encoding="utf-8").write(outs[f])
        frag = {ns: dict(sorted(sec.items())) for ns, sec in sorted(keyer.frag.items())}
        with open(FRAG, "w", encoding="utf-8") as fh:
            json.dump(frag, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        total = sum(len(v) for v in frag.values())
        print("fragment keys: %d across %d sections -> %s" % (total, len(frag), FRAG))
    for f in FILES:
        n0 = len(re.findall(r"\bt\(\s*\"", srcs[f]))
        n1 = len(re.findall(r"\bt\(\s*\"", outs[f]))
        print("%-22s t() %3d -> %3d" % (f, n0, n1))


if __name__ == "__main__":
    main()
