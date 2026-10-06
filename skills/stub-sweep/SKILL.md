---
name: stub-sweep
description: Use when hunting deferred stubs, pending TODOs, placeholder routes, unwired files, or incomplete designer instructions left behind by other agents
---

# Stub Sweep

## Overview

Other agents defer honestly and move on; this skill finds every deferral before it rots. Four sources, no guessing: code, git, meta docs, fresh story collation.

## When to Use

- After any multi-agent round, before a done-claim, or when asked "what is left / incomplete?"
- Symptoms: `TODO`, `placeholder()`, unwired files, `DEFERRED`/`PENDING` notes, `🔨`/`⏳` rows, dialog prompts with no reply
- When NOT to use: principle-compliance gate (that is `auditing-vanilla-slices`); chain-call truth (that is `mapping-chain-calls`)

## The Four Sources (run all four, in order)

### 1. Code — what the tree still says

```bash
grep -rniE "TODO|FIXME|XXX|HACK|placeholder\(|STUB|not implemented" vanilla/js/ vanilla/css/; echo "---above---"
grep -rn "function el(\|function clearRoot\|function showStatus\|function confirmList\|function fieldRow" vanilla/js/views/; echo "---helpers above (want none)---"
find vanilla/js -name '*.js' | xargs wc -l | sort -n | tail -n 8
git status --short
```

Zero `TODO|FIXME` in shipped code (§3.7). Unresolved = tracked task or nonexistent.

### 2. Git — what agents admitted

```bash
git log --oneline --grep="defer\|stub\|pending\|TODO\|placeholder" -i | head -n 30
git log --oneline -15 --stat | head -n 60
git status --short | head -n 50
```

Record hashes verbatim. A deferral without a hash is a rumor.

### 3. Meta docs — what the project promises

- `SLICES.md`: every `🔨`/`⬜`/`⏳`/`🔒` row + unchecked `- [ ]` is pending. Table marker = heading marker = box state.
- `docs/parity/op-coverage-matrix.md`: `MISSING (unjustified)` must stay zero; every `DEFERRED` needs reason + note.
- `AGENTS.md` + `README.md`: counts must equal disk (`ls vanilla/locales/*.json | wc -l`). A count disagreeing with disk is itself a finding.
- `docs/parity/*.md`: `PENDING|tester-queued|browser pass|human` hits = pending verification, not done.

### 4. Origin story — what the designer left unfinished

Fresh collation first (REQUIRED):

```bash
python3 tooling/collate_vanilla_prompts.py  # idempotent; rewrites docs/vanilla-ui-*.md + asset
```

Then review `docs/vanilla-ui-dialog.md` tail-first:
- `(no reply recorded)` = interrupted instruction; check the next reply covered it.
- `DROPPED` / `excluded` IDs = scope decisions; verify the note still holds.
- Prompts matching `defer|stub|later|pending|TODO|follow-up|next round` = authorized deferrals; each needs a code/meta counterpart or it is lost.
- Counts line must match rerun output; mismatch = stale audit.

Sweeper covers 1–3 + marker scan (`--recollate` includes collation):

```bash
python3 tooling/audit_stubs.py [--recollate]
```

## Output Contract

Table: `source | location (file:line or commit) | item | status (pending/stub/deferred/out-of-scope) | next action`. End with total pending count, top-3 ship-blockers, rerun command + dialog counts. `⏳ browser/testnet/human` items stay pending with gate named.

## Red Flags

- "No TODO hits, so nothing pending" (boxes, unwired files, no-reply prompts carry no TODO)
- "DEFERRED with reason = done" (tracked, never done)
- "I skimmed the dialog tail" (the tail IS the audit)
- "Counts look about right" (counts equal disk or are findings)
- Auditors never edit — repairs land next round per director contract.
