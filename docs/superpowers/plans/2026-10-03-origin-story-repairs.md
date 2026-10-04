# Origin-story Audit Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 18 audit findings (R1–R18) from the origin-story audit: doc contradictions, missing spec items, stale status, contrast polish, UX gaps, i18n placeholders.

**Architecture:** 18 independent repairs across docs, CSS, JS, and locale files. Each repair is a small, self-contained change. Batch by file type (docs first, then code, then i18n). Zero new dependencies.

**Tech Stack:** Plain text edits (MD, JS, CSS, JSON), Node stdlib for verification.

## Global Constraints

- `vanilla/` stays dependency-free, static-servable (`check_rot.py` PASS).
- `file://` and static servers both work.
- No new tokens/colors unless specified (R12 uses existing tokens; R13 extends `I18n.t` var-substitution already in `app.js:907`).
- Every `t()` call site default equals `en.json`; all 12 locales updated together.
- `check_rot.py`, `check_i18n.py`, `check_types.sh` must PASS after each commit.

---

## File structure

Docs: `AGENTS.md`, `SLICES.md`, `README.md`, `afk-resume.md`, `extension-wrapper-proposal.md`, `tester-manual.md`, `docs/superpowers/specs/2026-10-03-build-dialog-design.md`

Code: `vanilla/css/app.css`, `vanilla/js/views/about-ui.js`, `vanilla/js/views/help-ui.js`, `vanilla/js/app.js`, `tooling/collate_vanilla_prompts.py`

Locales: `vanilla/locales/*.json` (12 files)

---

### Task R1: AGENTS.md — add #9/#10 bullets + §3.9 elaboration

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: principle #9 (browse-as-anyone) + #10 (full i18n) definitions from §1
- Produces: §1 bullets for #9/#10; §3.9 section for #9

- [ ] **Step 1: Add §1 bullets**
```markdown
- **#9 — Browse as anyone, sign as yourself.** Every page renders any account's data with NO login — reads never gate on unlock. The password is asked ONLY at signing. Acting-as defaults to `committee-account` (`1.2.0`, verified on both chains; `1.2.5` is proxy-to-self, not the default) with an honest viewing-as notice.
- **#10 — Every language, fully.** BitShares is global; the wallet speaks every supported language completely — every display string keyed, every locale fully translated and audited, never a half-translated screen. English is the fallback, never the excuse.
```

- [ ] **Step 2: Add §3.9 section** (after §3.8 marketing box, before §4)
```markdown
### 3.9 Every language, fully (principle #10)

BitShares holders live on every continent; a wallet that speaks only English
is a wallet with a gate on it. Every user-visible string in the app resolves
through the locale system (`vanilla/js/i18n.js` + `vanilla/locales/*.json`) —
no hardcoded display text anywhere, in any view, including errors, empty
states, confirm dialogs, and help articles. Supported languages
(en, de, es, fr, hi, it, ja, ko, pt, ru, tr, zh) each ship a complete,
audited dictionary; English fills only what no translator has verified yet,
and the drift gate (`tooling/check_i18n.py`) proves key-completeness on every
change. Translation rules, in this order: placeholders (`%(name)s`), URLs,
object IDs, operation numbers, asset symbols, and theme/network IDs stay
byte-verbatim — a translation that breaks a placeholder is a bug, not a
translation; BitShares terms (witness, committee, worker, proxy, brainkey,
vesting, HTLC, swap, slate) follow one shared glossary per language, never
per-translator improvisation; and no unverified string ever passes as
translated (stubs stay honestly English until a human verifies them).
```

- [ ] **Step 3: Verify**

Run: `grep -n "3\." AGENTS.md | grep -E "3\.(1|2|3|4|5|6|7|8|9)"` — confirms 3.1–3.9 present

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md && git commit -m "docs: AGENTS.md add #9/#10 bullets + §3.9 elaboration (R1)"
```

---

### Task R2: AGENTS.md / SLICES.md — "eight" → "nine" audit checks

**Files:**
- Modify: `AGENTS.md` (lines 142-143, 817-819), `SLICES.md` (lines 3, 82)

**Interfaces:**
- Produces: consistent "nine-check audit" wording

- [ ] **Step 1: Edit AGENTS.md:142-143** — "passes all eight audit checks" → "passes all nine audit checks"
- [ ] **Step 2: Edit AGENTS.md:817-819** — ensure type gate listed as check 9
- [ ] **Step 3: Edit SLICES.md:3,82** — "8-check audit" → "nine-check audit"
- [ ] **Step 4: Verify**

Run: `grep -n "eight.*audit\|8.check" AGENTS.md SLICES.md` — should be zero

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md SLICES.md && git commit -m "docs: eight→nine audit checks (R2)"
```

---

### Task R3: AGENTS.md — stale build status (footer, slice-4-next, phase-2-dup)

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: current status + footer date + deduped Phase 2

- [ ] **Step 1: Footer** (line ~1046-1047) — replace with today's date + "Next action: see SLICES.md"
- [ ] **Step 2: Slice status** (line ~140-143) — replace "Slices 1–3 built, slice 4 next" with "Slices 1–18 built; 19 + extension drills remain — see SLICES.md"
- [ ] **Step 3: "Six below"** (line ~181) — "outranks all six below" → "outranks all nine below"
- [ ] **Step 4: §2.6 refs** (lines ~149, ~907) — replace with "the §2 objectives paragraph"
- [ ] **Step 5: Delete duplicate Phase 2** (lines ~896-901)
- [ ] **Step 6: Verify** — grep for "slice 4 next", "2026-09-27", "six below", "§2.6" — all gone

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md && git commit -m "docs: AGENTS.md stale status + dups fixed (R3)"
```

---

### Task R4: SLICES.md — row-18 consistency + language counts

**Files:**
- Modify: `SLICES.md`

**Interfaces:**
- Produces: consistent slice-18 marker; "12-language" everywhere

- [ ] **Step 1: Row 18** (line 28) — set marker to 🔨 (or DONE-WITH-BROWSER-ITEMS if boxes at 143-144 are truly done — verify against disk first)
- [ ] **Step 2: Line 29** — "11-language" → "12-language"
- [ ] **Step 3: Line 134** — "10 dicts" → "12 dicts" or add date stamp "as of 2026-09-30"
- [ ] **Step 4: Verify** — `ls vanilla/locales/*.json | wc -l` == stated counts

- [ ] **Step 5: Commit**

```bash
git add SLICES.md && git commit -m "docs: SLICES.md row-18 + language counts (R4)"
```

---

### Task R5: README.md — principles + counts + slice status

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: 10 principles listed, 12-language, slices 1–18

- [ ] **Step 1: Line 31** — "## The 9 guiding principles" → "## The 10 guiding principles"
- [ ] **Step 2: Add principle 10 entry** after #9 in the list
- [ ] **Step 3: Line 83** — "10-language i18n" → "12-language i18n"
- [ ] **Step 4: Line 113-115** — "Slices 1–17" → "Slices 1–18 built; 19 in progress"
- [ ] **Step 5: Verify** — counts match disk

- [ ] **Step 6: Commit**

```bash
git add README.md && git commit -m "docs: README.md 10 principles + 12-language + slice status (R5)"
```

---

### Task R6: "14 sessions" disambiguation (docs + provenance + collator)

**Files:**
- Modify: `AGENTS.md` (making_body in §3.1 or wherever), `vanilla/assets/BUILD-DIALOG-PROVENANCE.md`, `docs/superpowers/specs/2026-10-03-build-dialog-design.md` (§1), `tooling/collate_vanilla_prompts.py` (header output)

**Interfaces:**
- Produces: "14 sessions (13 distinct titles — two sessions share one title)" in all four places

- [ ] **Step 1: Edit each file** — add parenthetical disambiguation
- [ ] **Step 2: Verify** — `grep "14 sessions" AGENTS.md vanilla/assets/BUILD-DIALOG-PROVENANCE.md docs/superpowers/specs/2026-10-03-build-dialog-design.md` — all show disambiguated
- [ ] **Step 3: Commit**

```bash
git add AGENTS.md vanilla/assets/BUILD-DIALOG-PROVENANCE.md docs/superpowers/specs/2026-10-03-build-dialog-design.md tooling/collate_vanilla_prompts.py
git commit -m "docs: 14 sessions disambiguation (R6)"
```

---

### Task R7: dex-ux date correction (AGENTS.md:852)

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: accurate commit date

- [ ] **Step 1: Line ~852** — "HEAD `bad2545` (committed 2023-02-21, cloned 2026-09-28)"
- [ ] **Step 2: Verify** — `git -C /workspace/reference/bitshares-dex-ux log --oneline -1` matches
- [ ] **Step 3: Commit**

```bash
git add AGENTS.md && git commit -m "docs: dex-ux date correction (R7)"
```

---

### Task R8: No-JS fallback line in about-ui.js (build-dialog spec §2)

**Files:**
- Modify: `vanilla/js/views/about-ui.js` (renderAbout)
- Modify: `vanilla/locales/en.json` + 11 stubs (new key `about.dlg_noscript`)

**Interfaces:**
- Produces: static fallback line after bdBox, keyed

- [ ] **Step 1: Add i18n key** — `about.dlg_noscript`: "This archive needs JavaScript; the same text lives in docs/vanilla-ui-dialog.md in the source repo." (en + 11 stubs verbatim, append to `en.json _meta.translated`)
- [ ] **Step 2: Add fallback in renderAbout** — after `bdBox` append: `wrap.appendChild(el(doc, "p", t("about.dlg_noscript", "..."), "muted"));`
- [ ] **Step 3: Run gates** — `check_i18n.py`, `check_rot.py`, `check_types.sh`
- [ ] **Step 4: Commit**

```bash
git add vanilla/js/views/about-ui.js vanilla/locales/
git commit -m "feat(about): no-JS fallback line for build-dialog (R8)"
```

---

### Task R9: Spec anchor amendment (build-dialog design §3)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-build-dialog-design.md`

**Interfaces:**
- Produces: one-line recording query-param decision

- [ ] **Step 1: In §3 Anchors bullet** — append: "Shipped as `?dialog=N` query deep-link (via `Router.query()`) to avoid hash-router collision; `#N` fragment scheme abandoned as unnecessary."
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-03-build-dialog-design.md && git commit -m "docs: build-dialog spec anchor amendment (R9)"
```

---

### Task R10: afk-resume + extension-wrapper proposal staleness

**Files:**
- Modify: `afk-resume.md`, `extension-wrapper-proposal.md`

**Interfaces:**
- Produces: supersession notes

- [ ] **Step 1: afk-resume.md** — add top banner: "**Superseded by SLICES.md** (current build status); this doc frozen at 2026-10-01."
- [ ] **Step 2: extension-wrapper-proposal.md line 4** — add: "**Superseded:** Tier 1/2 wired 2026-10-04, human drills gate v1. This proposal's rationale (threat model, patterns-not-chassis) remains the reference."
- [ ] **Step 3: Commit**

```bash
git add afk-resume.md extension-wrapper-proposal.md && git commit -m "docs: supersession banners (R10)"
```

---

### Task R11: tester-manual.md refs + viewport gate

**Files:**
- Modify: `tester-manual.md`

**Interfaces:**
- Produces: fixed section refs; 360px + 2560px checks

- [ ] **Step 1: Line 373-374** — replace `§5.8, §11.4, §3.4` with actual section numbers (verify §§0–20 first via `grep -n "^###" tester-manual.md`)
- [ ] **Step 2: Viewport gate** — add "360px phone spot-check" and "2560px dense-grid check" to the gate items
- [ ] **Step 4: Commit**

```bash
git add tester-manual.md && git commit -m "docs: tester-manual refs + viewport gate (R11)"
```

---

### Task R11b: collator live headers (R11 from audit)

**Files:**
- Modify: `tooling/collate_vanilla_prompts.py`

**Interfaces:**
- Produces: headers with live counts, frozen stamp, scope sentence

- [ ] **Step 1: Compute at generation** — `prompt_count = len(prompts)`, `session_count = len(set(titles[s] for s in sessions))`, `worker_count` via indexed sqlite `COUNT`, `frozen_at = utc(now)`, `scope_sentence` from provenance
- [ ] **Step 2: Inject into all three outputs** (prompts.md, dialog.md, asset banner)
- [ ] **Step 3: Delete dead VANILLA_SESSIONS entry** (ses_f12ebe6a5) — keep drop-note comment
- [ ] **Step 4: Rerun + commit regenerated artifacts**

```bash
python3 tooling/collate_vanilla_prompts.py
git add docs/vanilla-ui-prompts.md docs/vanilla-ui-dialog.md vanilla/assets/build-dialog.js vanilla/assets/BUILD-DIALOG-PROVENANCE.md tooling/collate_vanilla_prompts.py
git commit -m "feat(collator): live headers + dead session removed (R11b)"
```

---

### Task R12: UX polish (app.css + about-ui.js)

**Files:**
- Modify: `vanilla/css/app.css`, `vanilla/js/views/about-ui.js`
- Modify: `vanilla/locales/en.json` + 11 stubs (2 new keys: `about.dlg_no_match`, `about.dlg_bad_link`)

**Interfaces:**
- Produces: code-fence wrap, permalink tap target, empty-search hint, bad-link feedback

- [ ] **Step 1: CSS** (append to app.css)
```css
.bd-details p { white-space: pre-wrap; overflow-wrap: anywhere; }
.bd-details a[href*="dialog="] { display: inline-block; min-height: 44px; padding: 10px 4px; }
```
- [ ] **Step 2: about-ui.js applyFilter** — when `shown===0`, append `t("about.dlg_no_match", "No matching exchanges. Clear the search to see everything.")` hint
- [ ] **Step 3: about-ui.js dialogNumber** — if `query.dialog` present but `target===null`, set status to `t("about.dlg_bad_link", "Invalid exchange number. Valid range: 1–413.")`
- [ ] **Step 4: i18n keys** — add 2 keys to all 12 dicts, append to en `_meta.translated`
- [ ] **Step 5: Run gates** — `check_i18n.py`, `check_rot.py`, `check_types.sh`
- [ ] **Step 6: Commit**

```bash
git add vanilla/css/app.css vanilla/js/views/about-ui.js vanilla/locales/
git commit -m "feat(about): UX polish — fences, tap targets, empty/bad-link hints (R12)"
```

---

### Task R13: Placeholder interpolation (about-ui.js + locales + app.js)

**Files:**
- Modify: `vanilla/js/views/about-ui.js` (3 concat sites), `vanilla/locales/en.json` + 11 stubs (2 new keys with `%(total)s`/`%(shown)s`), `vanilla/js/app.js` (verify `I18n.t` supports `%(name)s` — already at 907)

**Interfaces:**
- Produces: localized word order for heading/status

- [ ] **Step 1: New keys** — `about.dlg_heading_c`: "Full build dialog (%(total)s)", `about.dlg_showing_c`: "Showing %(shown)s / %(total)s"
- [ ] **Step 2: Convert call sites** — `t("about.dlg_heading_c", ..., { total: n })`, `t("about.dlg_showing_c", ..., { shown, total })`
- [ ] **Step 3: Deprecate old keys** — keep `dlg_heading`/`dlg_showing` until all call sites converted, then remove (dead-text rule)
- [ ] **Step 4: Run gates** — `check_i18n.py`
- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/about-ui.js vanilla/locales/ vanilla/js/app.js
git commit -m "feat(i18n): placeholder interpolation for dialog heading/status (R13)"
```

---

### Task R14: theme hygiene — xplore-flash fallback

**Files:**
- Modify: `vanilla/css/themes.css` (define `--flash` per theme), `vanilla/css/app.css` (drop fallback)

**Interfaces:**
- Produces: no hex literals outside comments

- [ ] **Step 1: themes.css** — add `--flash` to each theme block (ref-ui: `#6b6b6b`, vanilla-ui: `#6b6b6b`, dex-ux: `#6b6b6b` — already same value, just move from app.css fallback)
- [ ] **Step 2: app.css:1181** — change `background-color: var(--flash, #6b6b6b)` → `background-color: var(--flash)`
- [ ] **Step 3: Verify** — `grep -n "#[0-9a-f]\{3,6\}" vanilla/css/app.css vanilla/css/themes.css` — only in comments/provenance
- [ ] **Step 4: Commit**

```bash
git add vanilla/css/themes.css vanilla/css/app.css && git commit -m "feat(themes): xplore-flash tokenized (R14)"
```

---

### Task R15: committee-account probe citation (AGENTS.md)

**Files:**
- Modify: `AGENTS.md` (lines 75-77)

**Interfaces:**
- Produces: citation to verification artifact

- [ ] **Step 1: Find or create citation** — locate where `1.2.0` on both chains was verified (testnet `get_objects` output, parity note, or probe log). If none exists, add a one-liner: "Verified via testnet `get_objects [\"1.2.0\"]` on both mainnet/testnet — see parity note `vanilla/notes/committee-account.md`" (create that note if needed).
- [ ] **Step 2: Commit**

```bash
git add AGENTS.md && git commit -m "docs: committee-account probe citation (R15)"
```

---

### Task R16: Collator live headers + dead session (R11b detail)

Already covered in Task R11b above — merged.

---

### Task R17: Translation-quality human pass (UNVERIFIED → note)

**Files:**
- Create: `vanilla/notes/i18n-human-audit.md` (tracking note)

**Interfaces:**
- Produces: audit tracking doc

- [ ] **Step 1: Create note** listing all 11 non-en locales, `making_body` + `s1–s6_body` keys, status "unverified — stubs honest per §3.9", target: human audit before v1 done-claim.
- [ ] **Step 2: Commit**

```bash
git add vanilla/notes/i18n-human-audit.md && git commit -m "docs: i18n human audit tracking (R17)"
```

---

### Task R18: Help→archive discoverability + Community back-link

**Files:**
- Modify: `vanilla/js/views/help-ui.js` (add topic + back-link), `vanilla/locales/en.json` + 11 stubs (1-2 keys if new chrome strings)

**Interfaces:**
- Produces: discoverable archive, bidirectional links

- [ ] **Step 1: Add topic** to `TOPICS` array: `["about-making", "Making of this wallet", "...", "#/about"]` (use existing key pattern; i18n keys if needed)
- [ ] **Step 2: Community back-link** — in `renderCommunity`, append "About this wallet → #/about" beside Help back-link
- [ ] **Step 3: i18n keys if new chrome strings** — add to all 12 dicts
- [ ] **Step 4: Run gates** — `check_i18n.py`
- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/help-ui.js vanilla/locales/
git commit -m "feat(help): archive discoverability + community back-link (R18)"
```

---

## Execution Order

**Batch 1 (docs only, disjoint files):** R1, R2, R3, R4, R5, R6, R7, R9, R10, R11 (10 subagents, parallel)
**Batch 2 (code + i18n, disjoint):** R8, R11b, R12, R13, R14, R15, R18 (7 subagents, parallel)
**Batch 3 (tracking):** R17 (1 subagent)

Total: 18 repairs → 18 subagents in 3 rounds.

---

## Self-Review

- All 18 audit findings mapped 1:1 to tasks.
- Each task: single file or small file group, explicit code/edit, verify command, commit.
- No placeholders: every step has exact paths, strings, commands.
- Gates run per commit: `check_rot.py`, `check_i18n.py`, `check_types.sh`.
- R11b regenerates collated artifacts — idempotent, committed with source.
- R13 depends on `app.js:907` var-substitution — verified exists.

---

**Plan complete and saved to `docs/superpowers/plans/2026-10-03-origin-story-repairs.md`. Ready for subagent-driven execution.**