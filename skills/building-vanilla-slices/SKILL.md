---
name: building-vanilla-slices
description: Use when implementing a vertical slice of the vanilla BitShares UI (settings/nodes, wallet lifecycle, account view, transfer, DEX read/trade, or any feature slice), before writing implementation code
---

# Building Vanilla Slices

## Overview

One slice at a time: spec, implement, verify on testnet, record parity. A slice is not done until its parity note exists and the audit passes.

## When to Use

- Starting any vertical slice in `/workspace/vanilla/` (first slice: shell + settings/nodes)
- Extending an existing slice with new behavior

When NOT to use: pure inventory/mapping work with no new UI code (that is `mapping-chain-calls`); reviewing already-written code (that is `auditing-vanilla-slices`).

## Workflow

1. **Brainstorm the slice design** (REQUIRED: use the brainstorming skill). Present the design, get approval.
2. **Write the implementation plan** (REQUIRED: use the writing-plans skill). Keep the slice small enough to verify on testnet in one session.
3. **Map chain calls first** (REQUIRED: use `mapping-chain-calls`). No WS method or op field enters the code without a recorded source.
4. **Implement in `/workspace/vanilla/` only.** Static files, zero runtime deps. All money math goes through `vanilla/js/api/format.js` — never inline `amount / Math.pow(10, precision)` (binary float for money is a bug, not a shortcut).
5. **Verify on testnet.** Connect → read → sign → broadcast, observed — not assumed.
6. **Write the parity note** under `/workspace/vanilla/notes/<slice>.md`, then run the audit (REQUIRED: use `auditing-vanilla-slices`).

## Parity Note Contract

Every parity note MUST contain these fields, in this order:

1. Reference behavior (`bitshares-ui` file:line, plus `astro-ui`/`wallet-extension` file:line where applicable)
2. Vanilla implementation (file:line)
3. Manual test steps + observed result (testnet)
4. Raw→human test vectors for every displayed number (see principle #6, AGENTS.md §3.5)
5. Theme screenshot trio (original blue / light / dark) plus phone-width AND desktop-width flow checks
6. Module headers + function descriptions present per §3.7 (no dead text)
7. Anti-rot gate answers (AGENTS.md §4.5 questions a–c)

Missing field = slice not done. No exceptions for "trivial" slices.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Starting slice N+1 before slice N passes audit | Finish the parity note first; slices are sequential |
| Editing anything under `reference/` | Read-only. Copy to `/tmp` or `vanilla/notes/` to experiment |
| Inline float math for amounts | Route through `format.js`; the audit greps for this |
| Adding a dependency "just for this slice" | Answer §4.5(b) in writing, with a removal plan — or don't add it |
| Skipping themes/tests "for now" | "For now" is how #3583 started; the note requires both |
