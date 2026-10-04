# Origin-story audit — comprehensive repair specification

Date: 2026-10-03. Status: specification, no code changed.
Source: four parallel read-only audits (A: feature-vs-spec, B: corpus
integrity, C: meta-docs-vs-standards, D: stub/polish sweep) of the
build-dialog archive (`/about` making-of section + `docs/vanilla-ui-*.md` +
`vanilla/assets/build-dialog.js`) and the workspace meta documents.

## Verified clean (no repair — do not re-litigate)

- Corpus integrity: #N identical across prompts/dialog/asset (spot + programmatic checks); 413×3 contiguous; 6 message-ID exclusions absent everywhere; asset fidelity byte-exact incl. unicode; issue-#1 endpoint true (#413 prompt + fix reply).
- New surface: zero-dep/file://-safe, textContent-only, no new routes, no TODO/FIXME, no hex leaks in `.bd-*` rules, no orphan routes, all chrome strings keyed, gates green.
- Reference hashes in AGENTS.md (bitshares-ui/astro-ui/extension/core/open-graphene) accurate; route/line counts accurate; anti-rot doctrine + principles #2–#8 prose accurate as requirements; why-no-typescript.md accurate.

## Auditor disagreement resolved here

- Audit A flagged "13 vs 14 sessions" as a must-fix (13 distinct asset titles vs copy claiming 14). Audit B accounts all 413 across **14 sessions sharing 13 titles** (two sessions are both titled "Current project state and upcoming objectives"; per-session sums 98+134+81+41+15+13+10+9+5+2+2+2+1). **Ruling: the copy is correct; no count change.** Repair R6 below closes it with a one-word disambiguation so the next auditor does not re-flag it.

## Must-fix (binding-standard violations, contradictions)

### R1. "All ten binding" vs §1/§3 gaps (AGENTS.md) — HIGH
- Standard: #8 readability/honesty; a mission-control contradiction misdirects every agent.
- Evidence: `AGENTS.md:39` claims ten; `AGENTS.md:91-108` end-goal bullets cover #2–#8 only (#9, #10 missing); #9 has no §3.x elaboration (3.1–3.7 then unnumbered 3.8 then 3.9).
- Repair: add #9 + #10 bullets to §1; add a §3.x elaboration for #9 (browse-as-anyone incl. committee-account default + viewing-as notice); label 3.8 explicitly as a non-principle box.
- Verify: `grep -n "3\." AGENTS.md` shows 3.1–3.9 each naming its principle; §1 bullets ten.

### R2. "Eight audit checks" → nine (AGENTS.md, SLICES.md) — HIGH
- Evidence: `AGENTS.md:142-143`, `SLICES.md:3,82` say eight; type gate is check 9 (`AGENTS.md:817-819`).
- Repair: "nine-check audit" in all three spots.
- Verify: grep shows no remaining "eight" audit references.

### R3. Stale build status in AGENTS.md — HIGH
- Evidence: `AGENTS.md:140-143` ("Slices 1–3 built, slice 4 next"); footer `AGENTS.md:1046-1047` ("Last updated 2026-09-27, slice 7 in progress"); `AGENTS.md:864-873` Phase-2-DONE-via-1–3 + duplicate stub at `:896-901`; `AGENTS.md:181` "outranks all six below" (nine below); `AGENTS.md:149/907` "Parity = §2.6" (no §2.6 exists); `AGENTS.md:24-30` theme-alias block is fine, keep.
- Repair: status line → "Slices 1–18 built; 19 + extension drills remain — see SLICES.md"; footer date → today, next-action pointer at SLICES.md (never a named slice); delete stub Phase-2 block; "six" → "nine"; §2.6 refs → the §2 objectives paragraph.
- Verify: footer date == commit date; no "slice 7 in progress" string remains.

### R4. SLICES.md row-18 self-contradiction — HIGH
- Evidence: `SLICES.md:28` 🔨 vs `SLICES.md:137-144` ✅ with two unchecked boxes at `:143-144`.
- Repair: one consistent marker (🔨 until the boxes check, or DONE-WITH-BROWSER-ITEMS matching slices 7–17 if that is the true state — verify against disk first, do not guess).
- Verify: table marker == heading marker == box state.

### R5. Language-count three-way contradiction — HIGH
- Evidence: `SLICES.md:29` "11-language" vs `AGENTS.md:360` 12 codes vs 12 files on disk vs `README.md:83` "10-language" vs `SLICES.md:134` "10 dicts".
- Repair: 12 everywhere on disk-backed statements; `SLICES.md:134` either updated or stamped as historical snapshot with date.
- Verify: `ls vanilla/locales/*.json | wc -l` == every stated count.

### R6. "14 sessions" disambiguation (closes A-vs-B) — LOW
- Evidence: copy ("413 exchanges across 14 sessions") is correct per Audit B's per-session accounting; Audit A counted distinct titles (13).
- Repair: one-word change in `making_body`, `BUILD-DIALOG-PROVENANCE.md:3-4`, design §1: "413 exchanges across 14 sessions (13 distinct titles — two sessions share one title)". No count changes anywhere.
- Verify: recount titles in generator output if touched; otherwise text-only.

### R7. README.md principle + status counts — HIGH/MEDIUM
- Evidence: `README.md:31` "9 guiding principles" omitting #10; `:83` "10-language i18n"; `:113-115` "Slices 1–17" omitting 18/19.
- Repair: add principle-10 entry; "12-language"; "Slices 1–18 built; 19 in progress".
- Verify: README counts == disk (12 locales) and SLICES.md.

### R8. dex-ux date implication (AGENTS.md:852) — HIGH
- Evidence: HEAD `bad2545` "as of 2026-09-28" vs actual commit date 2023-02-21 (verified read-only).
- Repair: "HEAD `bad2545` (committed 2023-02-21, cloned 2026-09-28)".
- Verify: `git -C reference/bitshares-dex-ux log --oneline -1` still matches.

### R9. No-JS fallback line (spec §2 promised, never built) — must-fix, cheap
- Evidence: zero `noscript` in `vanilla/`; spec §2 requires a fallback line after the archive box.
- Repair: one static line after `bdBox` in `renderAbout` (keyed `about.dlg_noscript`, e.g. "This archive needs JavaScript; the same text lives in docs/vanilla-ui-dialog.md in the source repo." — finalize wording at implementation; add key to all 12 dicts en-verbatim + en `_meta.translated`, keep `check_i18n.py` green).
- Verify: view-source shows the line with JS disabled (or `grep -n noscript`).

### R10. Spec anchor amendment (design §3) — LOW, docs-only
- Evidence: spec says "`#N`-derived anchor, exact scheme at plan time"; shipped `?dialog=N` query deep-link (functionally better, avoids the collision the spec feared) but spec never amended.
- Repair: one-line amendment in `2026-10-03-build-dialog-design.md` §3 recording the query-param decision + why.
- Verify: spec text names `?dialog=N`.

## Polish batch (small, independent — bundle per pipeline-full rule)

### R11. Frozen-scope headers (prompts/dialog docs + generator)
- Gap (Audit B §4–5): docs headers state only the generation instant — no time range, no ends-after-#1, no 6-exclusion note, hardcoded "1505 worker sessions" already stale (1532).
- Repair: generate header values live in `collate_vanilla_prompts.py` (prompt count, session count, worker-session count via indexed `COUNT`, `len(EXCLUDE_MESSAGE_IDS)`, min/max timestamps, "frozen at" stamp, scope sentence mirrored from provenance) into all three outputs incl. asset banner (`len(asset)`, not hardcoded 413); delete dead 15th `VANILLA_SESSIONS` entry (keep drop-note comment); rerun + commit regenerated artifacts.
- Verify: headers contain range + frozen stamp + live counts; rerun is idempotent.

### R12. UX polish on the archive surface (no new deps)
- R12a. Code-fence readability: `.bd-details p{white-space:pre-wrap;overflow-wrap:anywhere}` (long replies collapse today).
- R12b. Permalink tap target: `.bd-details a[href*="dialog="]{display:inline-block;min-height:44px;padding:10px 4px}` (inline anchor likely <44px).
- R12c. Empty-search guidance: when `shown===0`, append a `t("about.dlg_no_match",…)` hint reusing the `help.no_match` pattern (new key, 12 dicts, gate green).
- R12d. Bad-deep-link feedback: `?dialog=0|9999|abc` is silent today; surface `t("about.dlg_bad_link",…)` in status after first expansion (new key, 12 dicts).
- R12e. Help→archive discoverability: add an `about-making` topic (or pointer in tour/settings article) to `help-ui.js` TOPICS/GROUPS; add Community→About back-link beside the Help one.
- R12f. Widen search to `session` strings (spec amendment first — search covers user+reply only by current spec).
- Verify: 360px + 1440px pass, three themes, `check_i18n.py` green after new keys.

### R13. Concatenation → placeholders (i18n word order)
- Gap (Audit D 5.2): `dlg_heading`/`dlg_showing`/day-head counts concatenate, locking English order (§3.9 placeholder rule). `I18n.t` already supports `%(name)s` (`app.js:907` precedent).
- Repair: `about.dlg_heading_c` / `about.dlg_showing_c` with `%(total)s`/`%(shown)s`, call-site conversion, 12 dicts, gate green. Keep old keys until call sites convert, then remove dead keys (dead-text rule).
- Verify: `check_i18n.py` green; no orphan keys remain.

### R14. One-line theme hygiene
- `app.css:1181` `@keyframes xplore-flash` fallback `#6b6b6b`: define `--flash` per theme in `themes.css` and drop the fallback (or record it as intentional last-resort gray).
- Verify: no `#[hex]` outside comments/provenance in `app.css` + `about-ui.js`.

### R15. Committee-account probe citation (AGENTS.md:75-77)
- Gap: `1.2.0`-on-both-chains claim has no probe citation.
- Repair: one line pointing at where the verification lives (testnet `get_objects` output, parity note, or probe log — verify first, do not assert blind).
- Verify: cited artifact exists and shows 1.2.0 on both chains.

### R16. afk-resume.md + extension-wrapper-proposal.md staleness notes
- Repair: re-date or stamp "superseded by SLICES.md" on afk-resume; one-line supersession pointer atop the proposal (Tier-1/2 wired 2026-10-04) without rewriting its rationale.
- Verify: no doc claims a status SLICES.md contradicts.

### R17. tester-manual.md refs + viewport gate
- Repair: replace broken `§5.8/§11.4/§3.4` cites (`:373-374`) with real section numbers (verify §§0–20 first); add 360px spot-check + 2560px dense-grid check (or record the 390-representative-360 decision explicitly).
- Verify: all cited sections exist; gate covers 360–390 and 1440+/2560.

### R18. Translation-quality human pass (UNVERIFIED → task, not grep)
- Gap: 11 non-en locales' long-form values (making_body et al.) unverified as human-vs-stub.
- Repair: human audit pass per §3.9 (stubs stay honestly English); validator + honest-stub policy already mitigate — schedule, do not block on.
- Verify: audit note recorded; `check_i18n.py` green throughout.

## Execution guidance (for the repair round)

- Order: R1–R10 (doc truth + missing spec items) first — all are text-only, disjoint files, one worker each or batched; R11 (generator rerun) next since it regenerates shared artifacts; R12–R14 (code) after, with gates per change (`check_rot.py`, `check_i18n.py`, `check_types.sh`, node tests); R15–R18 (citations/notes/human) anytime, disjoint.
- Every repair ends with its Verify line run, not asserted. Text-only doc repairs still get a second pair of eyes via `git diff` read-back before commit.
- Do not "fix" R6 by changing counts; do not scrub the asset for any reason; auditors never edit — repairs land in the next round per the director contract.
