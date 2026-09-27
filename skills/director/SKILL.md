---
name: vanilla-director
description: Use when coordinating multi-task execution on the vanilla BitShares build — planning dispatch rounds across slices, dispatching worker subagents, running audit cycles, maintaining parity-note tracking, and routing chain-behavior questions.
---

# Vanilla Director

## Overview

You coordinate the **slice-by-slice construction** of the vanilla BitShares UI
per AGENTS.md. Work proceeds one implementation plan at a time
(`docs/superpowers/plans/`); each slice moves scaffold → styles → store/chain
→ pages → verify, and nothing is done until its parity note passes the full
audit cycle.

**REQUIRED SUB-SKILL:** every worker you dispatch MUST load
`building-vanilla-slices` first (it carries the workflow and the parity-note
contract). You read it yourself too.

## Workspace

| Path | Role |
|---|---|
| `vanilla/` | The app under construction (the only writable code) |
| `vanilla/notes/` | Parity notes, one per slice (completion tracking) |
| `tooling/` | Audit/probe scripts (`check_rot.py`, `ws-probe.mjs`) |
| `docs/superpowers/plans/` | Implementation plans (dispatch source of truth) |
| `bitshares-ui/`, `astro-ui/`, `wallet-extension/`, `bitshares-core/` | References (immutable — workers never write here) |

Reference files are never modified by anyone, including you.

## The Roster of Skills

| Skill | Role |
|---|---|
| `building-vanilla-slices` | Slice workflow + parity-note contract (every worker loads this) |
| `auditing-vanilla-slices` | Seven-check audit before any done-claim |
| `mapping-chain-calls` | WS methods, op fields, fees, endpoints |
| `batch-dispatch-parallelism` | How to saturate dispatch rounds |
| `chain-doctor` | Authority when references disagree on chain behavior |
| `afk-keep-rolling` | Continuation contract when the user goes AFK |

## Round Workflow

### 1. Plan the batch

Take tasks from the active implementation plan. Dispatch together everything
whose interfaces are fully specified and whose files are disjoint — scaffold,
styles, store, and standalone tooling routinely go in round one. Never assign
two workers the same file in one round.

**Build order matters:**
```
scaffold (index.html, app boot) → themes + layout CSS
  → store → chain → router → pages
    → probe/verify → parity note → audit
tooling/* (parallel anytime — disjoint files, stdlib only)
```

### 2. Pre-flight each task

Interfaces specified in the plan (exact globals, signatures, element IDs)?
Output file path disjoint from every other task in the round? Required skill
named in the prompt? Skip or fix before dispatch.

### 3. Dispatch workers

Each worker gets ONE task (ONE file, or one file + its check run):

- Explicit instruction to **load building-vanilla-slices first** (do not rely on auto-discovery)
- Exact input (plan task text or section) and exact output path
- For repairs: the audit findings attached verbatim
- Order to run `node --check` on JS it writes and report the result
- Order to deliver a short report: files written, checks run, deviations from plan

Audits are reports-only in their own round: auditors never edit files; workers repair in the next round.

### 4. Update tracking

After each round: verify on disk (see batch-dispatch-parallelism), update the
todo list, note open questions. The parity note is the slice's completion record.

### 5. Audit cycle (per finished slice, in order)

Run the eight checks in `auditing-vanilla-slices`: rot → look → features →
glow → themes → numbers → viewports → readability. Only slices that pass all eight move to
done. Failed slices return to in_progress with findings attached, bundled with
forward work per the pipeline-full principle.

### 6. Commit per round

Commit built files + tracking update together; message names the slice and
round contents. Never commit to reference dirs (AGENTS.md §7 rule 7).

## Pipeline-Full Principle

Never dispatch a lone repair. Bundle repairs with next-slice work or tooling
tasks. A round that ends with idle capacity while the queue is non-empty is a
planning defect.

## When a Worker Disagrees with the References

Route to `chain-doctor` with the method/op, each reference's file:line, and
both candidate readings. Confirmed rulings go in the parity note. Apply
corpus-wide only via a repair task, not ad hoc.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Marking a slice done without the audit cycle | done = parity note + all eight checks green |
| Letting an auditor edit files | Auditors report; workers repair next round |
| Two workers on one file in a round | Disjoint file sets, always |
| Modifying reference checkouts | Never |
| Re-dispatching already-landed tasks | Verify on disk first, then decide |

## Red Flags

- A worker claims to "know BitShares" and skips the skill
- Tracking diverges from disk reality
- Audit steps skipped "because the slice was small"
- Two number formats for one asset in one slice
- A repair dispatched alone while forward work waits

**Any of these: stop the round, fix the process, continue.**
