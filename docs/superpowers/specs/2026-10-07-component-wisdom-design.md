# Component-Wisdom Design (2026-10-07)

## Context
- Request: skill covering all component collections at https://www.uiguideline.com/systems, mapped to our UX, then a full audit.
- Finding: `/systems` lists 20 benchmark systems; `/components` lists 70+ components (38 free visible, 30+ Pro gated). Detail pages are paywalled (Figma-kit logos only) — skill must NOT claim scraped Pro content.
- App: `vanilla/` has ~77 views in `js/views/`, shared utils `DOM/Forms/ConfirmDialog/Overlay/TableRenderer/Event` (AGENTS.md rule 9), zero-dep + no-build doctrine (§4.5), 3 themes.

## Decisions (user-approved)
1. Scope: full sweep, deep — all 77 views, file:line evidence, multi-session OK.
2. Constraints: zero-dep + shared-utils MUST stay; retro look MAY be broken only with a UX justification + before/after note.
3. Outputs: `skills/component-wisdom/SKILL.md` + `docs/parity/component-audit.md` (standard paths).
4. Skill shape: hybrid (recommended) — families + decision trees + vanilla mapping + audit template.

## Skill architecture
- Frontmatter: `name: component-wisdom`, `description: Use when …` (triggers only, third person).
- Sections: Overview → When to Use → Source catalog (20 systems, 38 free + Pro families, honest provenance) → 6 families (Navigation / Forms&Input / Feedback&Status / Data Display / Overlays&Disclosure / Selection&Pickers) with when-to-use-X-vs-Y trees → Vanilla mapping (every choice binds to DOM/Forms/Overlay/ConfirmDialog/TableRenderer + theme tokens) → Retro-override rule → Audit workflow + per-view row template → Common mistakes.
- Non-goals: no new deps, no per-component Figma specs, no redesign for taste.

## Audit workflow (with the skill)
1. Inventory all `vanilla/js/views/*.js` via `ls` + grep signals (TableRenderer/Overlay/ConfirmDialog/Forms/select/search/empty/spinner/toast/tooltip/badge/pagination/stepper).
2. Read high-traffic views for file:line evidence (dashboard, market-desk*, transfer, account, pools, vote, explorer).
3. Per-view table: view file → components used → wiser choice → vanilla mapping → effort → retro impact.
4. Top-10 recommendations, each with constraint check (zero-dep OK? shared-util OK? retro break justified?).
5. Save to `docs/parity/component-audit.md`; verify with `check_rot.py` (vanilla untouched) + `git status`.

## Risks
- Paywalled Pro components: mitigate by marking inferred families as such, grounding rules in public system docs + general wisdom.
- 77-view depth in one session: mitigate by code-evidence sweep now, live screenshot verification as follow-up round.
