"""Scan vanilla/css/app.css selectors against vanilla/ usage.

Module header: owns dead-rule detection for the style-repair batch; consumes
app.css + all files under vanilla/ (html/js/css); no side effects (read-only,
prints a report). Created for the CSS-only repair batch (inputs-square /
favicon-404 / dead-rules), per AGENTS.md rule 3 (no inline throwaway scripts).

Usage: python3 tooling/scan_dead_css.py
Exits 0 always; human decides deletions (a zero-hit selector is a CANDIDATE —
verify with a targeted grep before deleting, since JS may build class names
dynamically via string concatenation).
"""
import re
import sys
from pathlib import Path

VANILLA = Path("/workspace/vanilla")
CSS = VANILLA / "css" / "app.css"

text = CSS.read_text()
# Strip comments so commented-out selectors are not counted as live rules.
stripped = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
rules = re.findall(r"([^{}]+)\{", stripped)

# All searchable source: html + js + css (css itself counts: a selector only
# referenced inside another comment was already stripped).
corpus_files = list(VANILLA.rglob("*.html")) + list(VANILLA.rglob("*.js")) \
    + list(VANILLA.rglob("*.css"))
corpus = {}
for f in corpus_files:
    try:
        corpus[str(f)] = f.read_text(errors="replace")
    except OSError:
        pass

selectors = []
for rule in rules:
    for part in rule.split(","):
        s = part.strip()
        if s and s not in selectors:
            selectors.append(s)

print(f"selectors: {len(selectors)}, corpus files: {len(corpus_files)}")
print("=" * 70)
for sel in selectors:
    # Extract class (.foo) and id (#bar) atoms; bare elements (button, input)
    # always match something — skip them (never dead by this method).
    atoms = re.findall(r"[.#][A-Za-z0-9_-]+", sel)
    # Attribute selectors like [data-state="open"] / [aria-current]: check the
    # attribute name presence as a fallback signal.
    attrs = re.findall(r"\[([A-Za-z-]+)", sel)
    if not atoms and not attrs:
        print(f"SKIP (bare element/universal): {sel!r}")
        continue
    hits = []
    for fname, body in corpus_files and corpus.items():
        ok = True
        for atom in atoms:
            name = atom[1:]
            # Class atom matches if the name appears as a class in HTML/JS
            # (class="... name ..." or 'name' in JS strings / classList).
            if atom.startswith("."):
                if not re.search(r"[\"'`\s.]" + re.escape(name) + r"(?=[\"'`\s])", body):
                    ok = False
                    break
            else:  # #id
                if name not in body:
                    ok = False
                    break
        if ok and attrs:
            for a in attrs:
                if a not in body:
                    ok = False
                    break
        if ok:
            hits.append(fname)
    # A selector defined only in app.css itself is NOT a hit (definition site).
    ext = [h for h in hits if not h.endswith("css/app.css")]
    status = "LIVE " if ext else "DEAD?"
    print(f"{status} {sel!r}  (hits: {len(ext)})")
    if not ext:
        print(f"       defined-hits only in: {hits}")
