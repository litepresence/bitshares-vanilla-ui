---
name: afk-keep-rolling
description: Use when the user says they are going AFK, away from keyboard, or says keep rolling until they return during slice work, audit rounds, or repair batches.
---

# AFK Keep Rolling

## Overview

AFK means the agent is the driver: no idle stops, no questions, no waiting. The todo list carries one permanent tail item so the loop survives batch boundaries.

## When to Use

- User says "going afk", "away for a bit", "keep rolling", "keep going until I get back", or equivalent during iterative work (slice builds, audit rounds, repair batches)
- Symptoms: parity notes or audit findings remain open, agent would otherwise end its turn after one batch and wait

When NOT to use: user is present and responsive (normal todo discipline applies); single one-shot tasks with nothing queued behind them.

## Contract

1. **Tail invariant.** The last todo item is always the keep-rolling item (e.g. "Keep rolling until user returns — next slice batch, no idle stop"). It stays `pending` until the user sends a new message. Never mark it complete while the user is away. All new round items insert ABOVE it.
2. **No idle stop.** After every batch commit, immediately begin the next logical batch (next slice tasks per the plan, open audit findings, next parity note). A turn never ends with a clean tree and no next batch started.
3. **No questions while AFK.** The question tool would block forever — decide per the skills and AGENTS.md (seven-check audit, core-wins-tiebreak, on-disk truth) and log assumptions in the commit message instead.
4. **Keep the established pattern.** Batch discipline is unchanged: director rounds, verify on disk (never trust self-reports), small focused commits, findings folded into parity notes. This skill only governs CONTINUATION, not quality — see `auditing-vanilla-slices` for the audit contract.
5. **Stop only when:** the user sends any new message (stop, report position), or zero open slices/findings remain anywhere (finish the final audit round too, then stop and report shippable).

## Red Flags — STOP and re-read this skill

- Ending a turn with "waiting for you" / "let me know" while AFK flag is set
- Asking the user anything before continuing
- Marking the keep-rolling tail item complete while the user is still away
- Starting a batch without inserting it into the todo list first
- Committing to reference dirs, or committing generated artifacts (`dist/`, `__pycache__/`, backups)

## Quick Reference

| Situation | Action |
|---|---|
| Batch committed, items remain | Insert next batch above tail, start it same turn |
| Ambiguous chain call, user unreachable | Follow `chain-doctor` tiebreakers, log in parity note |
| New user message arrives | AFK over: stop loop, mark tail complete, report |
| Queue fully empty | Final audit round, then stop and report |
