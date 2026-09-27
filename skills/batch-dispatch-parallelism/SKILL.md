---
name: batch-dispatch-parallelism
description: Use when planning a subagent dispatch round for the vanilla BitShares build — deciding how many slice tasks to bundle, which workstreams to pull in, whether failed or empty results need redoing, and whether the queue saturates a full parallel dispatch.
---

# Batch Dispatch Parallelism

## Overview

The director's PRIMARY role is precisely orchestrated, massive parallelism of
skill-infused subagents. One round completes a whole slice. Three running
while six tasks sit queued is ten needlessly unemployed slots.

Think like a director running multiple workstreams at once: the whole slice
is the objective. All tasks in the active implementation plan are legitimate
parallel workstreams the moment their interfaces are specified.

Awaken underused workflows: if a dispatch cannot saturate on the current
slice alone, PULL IN the next work — tooling scripts, the next slice's
independent tasks, parity-note drafting — anything in AGENTS.md that can
start without prerequisites.

## Dispatch Shapes

| Shape | Contents | When |
|---|---|---|
| Single-slice | All tasks of one slice, disjoint files | First sweep of a fresh slice |
| Cross-slice | Audit fixes for slice N + build tasks for slice N+1 | Any dispatch once a slice is built |
| Mixed repair + next | Failed-task redos bundled with forward tasks | Anything must be REDONE |
| Tooling-parallel | `tooling/` scripts + slice tasks | Probe/audit tooling needed alongside build |

## Pipeline-Full Principle

Whenever something must be REDONE (failed/empty task result, audit finding,
parity-note gap), bundle it into the SAME dispatch as the next logical tasks.
Never waste a dispatch on a lone repair; fill free slots with forward work.

## Workstream Posture

- Slice tasks are file-local (interfaces + the implementation plan carry the contracts — workers read the plan task, not each other's minds).
- Audits and parity notes run on landed files, in a later dispatch than the build that produced them.
- Priority: fill the current slice's next tasks first, then saturate remaining slots with tooling or next-slice independent work.

## Stage Discipline

- Build order per plan (scaffold → styles → store/chain → pages → verify); later tasks may dispatch early ONLY if their interfaces are fully specified in the plan.
- Auditors never audit files whose build is in flight in the same dispatch.
- Disjoint file sets, never overlapping writes — one file, one worker per round.
- Commit after every dispatch round — the next dispatch reads committed baselines.

## Verify on Disk (after EVERY dispatch)

Subagents sometimes return EMPTY tool results and never wrote their file. Never trust reports alone:

1. Target files exist with real content (no placeholder markers, no TODO stubs).
2. `node --check` passes on every new/modified JS file.
3. `python3 tooling/check_rot.py` passes.
4. Line-count and interface sanity: the produced globals match the plan's interface blocks.

## Red Flags

- "It was just one failure — a lone repair dispatch is fine"
- "The subagent confirmed it wrote the file"
- "I'll commit after the next dispatch too"
- "Auditing in-flight files saves a round"
- "Only 2 tasks ready — dispatch now"

**All mean: bundle repairs, pull in other workstreams, verify on disk, commit, then dispatch.**
