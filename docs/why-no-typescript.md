# Why No TypeScript — Decision Record

Status: binding. Date: 2026-10-02. Scope: `vanilla/` (the shipped wallet).
Companion: `vanilla/notes/type-safety-report.md` (the 2026-10-01 gate pass log).

## TL;DR

We ship plain `.js` plus JSDoc comments, checked by `tsc --checkJs --noEmit`
as a dev-only lint. We do not write, ship, or require TypeScript-the-language
(`.ts`/`.tsx`, `tsconfig.json`, emitted output, type-only imports at runtime).
The checker is deletable without losing the ability to ship; the language
would not be.

This is not a claim that types are useless. It is a claim that everything
TypeScript-the-language would buy this stack is either (a) already covered by
`tsc` + JSDoc + runtime guards + vectors + testnet proofs, or (b) not worth
the rot it reintroduces. Section 5 lists what we genuinely lose.

## 1. Why TypeScript-the-language violates the stack ethos

Every design decision, slice review, and "done" claim in this project must
answer the three Anti-Rot gate questions (`AGENTS.md` §4.5 rule 7). Quoted
verbatim because they are the grading rubric for everything that follows:

- **(a) The 2036 test.** If every author of this code disappears and nothing
  is updated for ten years, does it still run in a contemporary browser?
- **(b) New dependencies.** What, exactly, did this change newly depend on
  (package, service, toolchain, hosted asset)? If anything: why can't it be
  vendored or deleted?
- **(c) Deletable subset.** What is the smallest subset that could be deleted
  while keeping the slice working? Why wasn't it?

A "done" claim that cannot answer (a)–(c) is not done. Each reason below
names which question(s) TypeScript-the-language fails and why the current
plain-JS + dev-only-`tsc` arrangement passes the same question.

### 1.1 Zero runtime dependencies (§4.5 rule 1) — gate (b), (c)

`vanilla/` contains no `package.json`, no `node_modules`, no lockfile, no CDN
`<script src>`, no framework. Verified today:

- `ls vanilla/package.json` → `No such file`.
- `python3 tooling/check_rot.py` → `ROT CHECK PASSED`.
- `tooling/check_rot.py:23-40` forbids `package.json`, `*-lock.*`,
  `tsconfig.json`, `node_modules` anywhere inside `vanilla/`.

TypeScript-the-language needs all three of those things to be useful: a
compiler version to pin, a `tsconfig.json` to configure it, and `@types/*`
packages for the DOM and any vendored code. Each is a release cycle. Default
answer per doctrine: don't add it.

### 1.2 Platform APIs only (§4.5 rule 2) — gate (a), (b)

The stack permits HTML, CSS, vanilla JS, WebSocket, WebCrypto,
`localStorage`/`IndexedDB`, `Intl` — standards browsers guarantee for
decades. TypeScript is not a platform API. It is a Microsoft-owned toolchain
with annual breaking changes (template-literal types, `satisfies`,
`const` type params, `using`, decorator reversals, `lib`/`target` drift,
`@types/node` drift). Adopting it couples every file to that treadmill —
the same coupling that killed the reference wallet.

### 1.3 No build step to run (§4.5 rule 4) — gate (a), (c)

`python3 -m http.server` (or `file://`) must serve a working app. The motto
test: if `curl`-ing the folder doesn't include it, the app doesn't need it.

- `.ts`/`.tsx` cannot pass this test. Browsers do not execute them.
  `tooling/check_rot.py:42-44` lists `.ts`, `.tsx` (with `.scss`, `.vue`,
  `.svelte`, etc.) as `BUILD_REQUIRED_EXTS` — presence fails the gate.
- Today's app passes because it is 108 classic `<script src="js/...">` tags
  (`vanilla/index.html`), zero emit, zero bundling. `tsc` runs with
  `"noEmit": true` (`tooling/typecheck/jsconfig.json:5`) precisely so the
  checker can never become an emitter.

A `.ts` codebase would need a compile before every browser pass, every
testnet verification, every deploy. That is a build step by definition,
however fast.

### 1.4 The 2036 test (§4.5 rule 7a) — gate (a)

> If every author disappears and nothing is updated for ten years, does it
> still run in a contemporary browser?

Plain `.js` + JSDoc comments: yes. Comments are ignored by every future
parser. A `.ts` tree: no — it runs only after a contemporary `tsc` still
accepts decade-old `tsconfig` semantics, `lib` names, and decorator/
`enum`/`namespace` emit. The reference wallet is the exhibit for what
happens when the answer is no (`AGENTS.md` §4: Node 6 → 16 → 20/22,
React 16 → 19, Electron 16 → 44, ~400 components, several thousand hours in
issue #3583).

### 1.5 Small and boring (§4.5 rule 5) — gate (a), (c)

One human reads the whole app in a weekend. JSDoc adds lines but no new
syntax to learn: `@param`, `@returns`, `@typedef`, `@type`, and one cast
idiom `/** @type {X} */ (expr)`. TypeScript-the-language adds generics,
mapped/conditional types, variance annotations, ` satisfies`, `declare`,
`abstract`, access modifiers, `enum` emit semantics, module-resolution modes
(`node` vs `bundler` vs `nodenext`), and `strict`-family flags whose
interaction is itself a specialty. That is framework-shaped abstraction grown
inside `vanilla/`, which rule 2 forbids.

### 1.6 Vendor, never depend (§4.5 rule 3) — gate (b), (c)

Crypto/serializer code is *copied* with provenance (`vanilla/js/vendor/`,
`PROVENANCE.md`). TypeScript cannot be vendored this way — the compiler is
megabytes of JavaScript with its own release cadence. The project handles
this honestly instead of pretending otherwise:

- `tooling/typecheck/package.json:3` pins `typescript@7.0.2` exact.
- `tooling/typecheck/pnpm-lock.yaml` locks it (commit `c02f1a9`).
- `tooling/typecheck/node_modules/` is gitignored (`.gitignore:30`) and
  lives *outside* `vanilla/`, so the shipped folder never contains it.
- `tooling/check_types.sh:6-9` documents the removal plan in the file
  header: if TypeScript ever becomes unobtainable, delete the script plus
  `tooling/typecheck/` and lose a lint, not the ability to ship.

A `.ts` codebase has no such removal plan. Deleting the compiler deletes the
app.

### 1.7 The rot gate already encodes this — gate (b), (c)

`tooling/check_rot.py:86-108` carries a narrow, self-policing carve-out for
exactly one non-JS artifact: ambient `*.d.ts` files that no `<script>` tag
and no `import` ever references. A `.d.ts` that is loaded fails as
`loaded .d.ts would need a build step`. The only `.d.ts` in the tree is
`vanilla/js/globals.d.ts` (dev-only declares, never loaded). Any proposal
to add real `.ts` sources trips three independent failures: forbidden
extension, forbidden `tsconfig.json`, and (once imported) framework/build
coupling. The gate was extended in the same commit that added the type gate
(`da344ae`), so the exception cannot outgrow its justification silently.

### 1.8 Browsers run JS natively; TS never runs anywhere — gate (a), (c)

Every TypeScript feature — however elegant — is erased, downleveled, or
polyfilled before it reaches the browser. The wallet's hardest code
(WebCrypto digests, secp256k1 scalar math on `bigint`, binary serializers
with `DataView`, IndexedDB envelopes) must be correct *as emitted JS*
anyway. Debugging then happens against emitted output the author never
wrote. Plain JS removes that indirection: the reviewed source is the shipped
source is the debugged source.

### 1.9 Both references warn against it — gate (a), (b)

- Reference #1 (`bitshares-ui`, React 16 + Babel + webpack + Electron) is
  the thousand-hour trap documented in `AGENTS.md` §4. TypeScript would not
  have saved it; the toolchain around it (Babel presets, `@types/react`
  versions, `lib` targets) is part of what rotted.
- Reference #2 (`astro-ui`, Astro 7 + React 19 + Tailwind + Electron 44) is
  already on the same treadmill — fresher today, a future #3583 tomorrow
  (`AGENTS.md` §4.5 note). Copying its `.tsx` idioms reintroduces the rot
  the port exists to escape.

### 1.10 Chain truth arrives as untyped JSON at runtime — gate (a), (b)

The wallet speaks WebSocket JSON to nodes whose responses are shaped by
C++ (`reference/bitshares-core/.../database_api.hpp`, `api.hpp`) and by
per-node configuration (bucket sets, history plugins, asset ids differ —
see `vanilla/notes/phase-06-es-design.md`). No static type, however strict,
can promise that `get_account_history` returns rows, that testnet BTS is
`1.3.1420` rather than `1.3.0`, or that a fee field is present. Those facts
are established by runtime guards, probe fixtures
(`tooling/history-capabilities-2026-10-02.json`), and testnet inclusion
proofs — layers TypeScript cannot replace and might lull authors into
skipping.

## 2. What TypeScript actually provides, and what covers each item

| # | TS benefit | Mitigation in this stack | Evidence |
|---|-----------|--------------------------|----------|
| 1 | Catch wrong-arity calls, misspelled properties, wrong argument shapes at edit time | `tsc --checkJs` over all of `vanilla/js` (`bash tooling/check_types.sh`, hard gate in `AGENTS.md` §7 rule 5 and `skills/auditing-vanilla-slices/SKILL.md` check 9). JSDoc `@param`/`@returns` on seams; shared shapes in `vanilla/js/api/types.js`; cross-file globals in `vanilla/js/globals.d.ts`. Sole code-shape change allowed is parenthesized `/** @type {X} */ (expr)` casts — any behavior delta fails audit. | `tooling/typecheck/jsconfig.json` (allowJs + checkJs + noEmit, `strict:false`, `target es2020`, `lib es2020+dom`, `types:[]`, vendor excluded); `vanilla/js/api/types.js:18-71` (11 shared typedefs); 367 JSDoc tags across 112 `.js` files (2026-10-02 count) |
| 2 | Shared interfaces / type aliases across modules | `api/types.js` typedefs (`ChainObjectId`, `RawInt`, `HumanAmount`, `FeeAssetId`, `ChainStatus`, `TxEnvelope`, `OpTuple`, `CountResult`, `PulseResult`, `TopMarketRow`, `TFunction`) consumed via `import('./types.js')` / `import('../api/types.js')` per file. tsc-only file: no `<script>` tag by documented rule (`types.js:1-16`), so it can never become load-bearing. | `vanilla/js/sdk/crypto.js:39-41`, `vanilla/js/api/wallet.js:17-22`, `vanilla/js/app.js:13-16` typedef headers |
| 3 | Cross-file name resolution without imports (classic scripts share one scope) | `vanilla/js/globals.d.ts` ambient declares (116 lines, one `declare var X: any` per namespace global). Dev-only, never loaded — the rot gate fails any `.d.ts` referenced by markup or imports. Starts as `any`; seams refine per module. | `globals.d.ts:1-8` header states the contract and removal plan; `check_rot.py:86-108` enforces it |
| 4 | Syntax safety | `node --check` on every touched file before every claim (slice plans since the founding commit; e.g. `docs/superpowers/plans/2026-09-28-slice-13-credit.md` acceptance: "`node --check` green"). | Slice plans + parity notes record exit 0 per round |
| 5 | Logic correctness (types never prove behavior) | Stdlib-only `tooling/*-test.js` vectors (31 suites on 2026-10-02; 517 vectors + keepalive battery green at gate time), malformed-payload fuzz guards (commit `b21d83b`), byte-determinism fixtures for all 78 ops, and testnet connect → read → sign → broadcast proofs per slice. The type gate caught what tests missed and vice versa — see below. | `vanilla/notes/type-safety-report.md:13-16`; parity notes per slice |
| 6 | Null/undefined and shape drift at the WS boundary | Runtime guards at every seam: `typeof X === "undefined"` checks, named `throw` errors (`crypto backend missing`, `chain not ready`), `Object.prototype.hasOwnProperty` discrimination, `format.js` as the single money-math module (audit check 6 greps `Math.pow(10` outside it). Types describe; runtime asserts defend. | e.g. `vanilla/js/api/wallet.js` guards; `vanilla/js/api/history-notice.js:44-50` null/doc guards; `skills/auditing-vanilla-slices/SKILL.md` check 6 |
| 7 | Documentation of intent | Module headers (owns/consumes/side effects/origin) and function descriptions (what/params/returns/failure-modes) required by principle #8 and audit check 8; JSDoc doubles as the type annotation so docs and checks cannot drift apart. | e.g. `vanilla/js/api/history-notice.js:1-16`, `vanilla/js/sdk/crypto.js:374-376` |
| 8 | Exhibit: the gate paid for itself | `samet-ui.js openAction` used the route-liveness token `myGen` it never received (5-arg call, 6-arg body) — every Borrow/Repay/Update/Delete click threw `ReferenceError`. Dead feature, shipped. No test covered the click path; `tsc` flagged the arity mismatch. Fix threaded `myGen` through (2 lines + `BUGFIX NOTE` at site); regression covered by tester manual §11 step 3. | `vanilla/notes/type-safety-report.md:18-26`; commit `da344ae` |

## 3. Git-history review: how the mitigation was built

The project never had TypeScript-the-language. The full history is 231
commits (2026-09-27 founding commit `2a02991` through 2026-10-02); exactly
two commits touch the type machinery, both on 2026-10-01:

1. **`da344ae` — Type gate: checkJs hard gate + JSDoc seams + samet click fix.**
   41 files, +798/−158. Added `tooling/check_types.sh` (25 lines),
   `tooling/typecheck/jsconfig.json` (13 lines),
   `tooling/typecheck/package.json` (`typescript: 7.0.2`),
   `vanilla/js/api/types.js` (73 lines), `vanilla/js/globals.d.ts` (112
   declares), `vanilla/notes/type-safety-report.md` (46 lines); extended
   `.gitignore` (typecheck `node_modules/`), `AGENTS.md` (hard type gate),
   `skills/auditing-vanilla-slices/SKILL.md` (check 9), and `check_rot.py`
   (the `.d.ts` carve-out). Annotated the sdk seam (`chain.js`,
   `crypto.js`), all `api/` + `builders/` seams, and the 13 highest-error
   views. Rules of engagement held throughout: JSDoc comments only, casts
   only, every file `node --check` clean, full test battery green after.
   Baseline 3361 errors → 432 (declares + vendor exclusion) → 92 → **0**.
   Gate `PASS`.
2. **`c02f1a9` — Typecheck pin: typescript 7.0.2 lockfile.** One file,
   `tooling/typecheck/pnpm-lock.yaml` (+225). Pins the dev-only compiler so
   the lint is reproducible without ever entering `vanilla/`.

Before the gate, type safety rested on the layers the gate did not replace:
`node --check` per plan, explicit runtime `typeof`/shape guards, stdlib
vector suites, byte-determinism fixtures, `format.js` money discipline, and
testnet inclusion proofs. After the gate, those layers remain mandatory —
the auditing skill runs all nine checks (rot, retro, coverage, glow,
themes, human-terms, viewports, readability, types), and a green type gate
with a red any other gate is still not done.

The `0835586` commit ("typed-account previews", 2026-09-29) is unrelated —
"typed" there means account-typed UI previews, not static types.

## 4. How the mitigation works today (commands)

```bash
python3 tooling/check_rot.py   # want: ROT CHECK PASSED (no .ts/.tsx/tsconfig/package.json in vanilla/)
bash tooling/check_types.sh    # want: PASS — vanilla/js typechecks (checkJs, no emit)
```

- `check_types.sh` cds into `tooling/typecheck/` and runs the pinned
  `node_modules/.bin/tsc -p jsconfig.json`. If `typescript` was never
  installed there (`npm install` in that dir only — dev-only, never
  required to run the app), it exits 1 with an instruction rather than
  silently passing.
- `jsconfig.json` includes `../../vanilla/js/**/*.js` plus `globals.d.ts`
  and excludes `../../vanilla/js/sdk/vendor/**` (vendored curve code is
  audited, not typechecked).
- New/changed code must typecheck with JSDoc on touched seams, shared
  shapes added to `types.js`, and new cross-file globals added to
  `globals.d.ts` (never a `<script>` tag for either tsc-only file).
- The gate is deliberately `strict: false` with `types: []`: it checks what
  JSDoc claims without pulling `@types/node` or DOM-plus-node ambient
  collisions into the wallet scope.

## 5. Honest shortcomings — what we genuinely lose

1. **We run `strict: false`, not strict.** `noImplicitAny`, strict null
   checks, and exhaustive narrowing are off. The `bigint`/`number` ladder
   mixes got real `bigint` shapes at the seams that needed them
   (`type-safety-report.md:30-33`), but most function params are
   pragmatically `@param {any}` with validation at runtime. A strict
   `.ts` project would catch more at edit time; we catch it later (checker
   with `any`, tests, or testnet) or not at all until a user path trips a
   guard.
2. **Most cross-file globals are still `any`.** `globals.d.ts` declares
   ~100 namespaces as `any` and refines only at call sites via casts
   (`/** @type {any} */ (Crypto).brainPrivateKeyHex(...)`). This silences
   the checker without describing the surface. Two named follow-ups from
   the gate pass remain open because the gate is green without them
   (`type-safety-report.md:34-42`): (a) our `Crypto` namespace collides
   with the DOM lib's `Crypto` interface, so ~20 cross-file `Crypto.*`
   calls bridge via `any` casts — a dedicated wallet-crypto `@typedef`
   would remove them; (b) custom `Error` properties (`err.detail`,
   `fromName`/`fromId`/`walletId`) need an `Error & {...}` typedef family
   (~10 casts). Both are half-hour typedef chores, neither is
   expressiveness JSDoc lacks — but they are not done, and until they are
   the checker proves less than it appears to on those two seams.
3. **JSDoc drifts more easily than TS.** A stale `@returns {string}` is a
   comment; a stale `: string` is a compile error. Nothing forces an author
   to update the annotation when the code changes except the audit and the
   next `check_types` run. Reviewers must treat JSDoc as code.
4. **No generics, discriminated unions, or exhaustiveness for the 78 ops.**
   The op-confirm table (`wallet-extension/src/popup/popup.js` as wording
   spec), serializer dispatch (`tx.js`), and fee-fill paths are validated
   by fixtures and runtime switches, not by a compiler proving every
   variant handled. Adding op 78 means writing the fixture, not satisfying
   a `never` branch.
5. **Refactoring is manual.** Renaming a method across 112 script-scope
   files is grep + `node --check` + `check_types` + tests, not F2-rename
   with compiler-verified call sites. IDE autocomplete on `any`-typed
   seams is weak. Contributors arriving from TS codebases will feel this
   first.
6. **The WS boundary is untyped by construction (see §1.10).** Even a
   strict TS project would need Zod-style runtime validation or honest
   `unknown` + narrowing for every node response. Our guards do that work;
   the checker does not, and must never be cited as if it does.
7. **The gate is skippable by neglect.** It requires a one-time dev-only
   install in `tooling/typecheck/`; a contributor who never runs it gets no
   signal. The audit makes it a hard gate on every done-claim, but unlike a
   build-breaking `tsc -b`, nothing physically stops an untypechecked edit
   from rendering in a browser. Discipline carries what tooling does not.
8. **JSDoc has its own footguns.** Multi-declarator `var` needs per-name
   casts; `/**` vs `/*` matters (the former checks, the latter is
   ignored); parenthesized casts add visual noise. The gate pass burned
   real hours on exactly these (§3 baseline 92 → 0).
9. **Current-dirty-tree exhibit (2026-10-02).** At the time of writing the
   tree has uncommitted work (`history-notice.js` untracked,
   `pool-swap-ui.js` modified) and `check_types.sh` FAILS with four
   `TS2304: Cannot find name 'HistoryNotice'` errors — the new module's
   global was never added to `globals.d.ts`. That is the gate working as
   designed (a missing declare is a loud error, not a silent `any`), and
   also the honest demonstration of shortcoming 3 and 7: JSDoc-era safety
   lasts exactly as long as authors update the two tsc-only files alongside
   the code.

None of these shortcomings has caused a shipped money bug to date. The one
live bug the gate caught (samet `myGen`, §2 row 8) was an arity error tests
missed — the direction the mitigation was designed for. The money-math
class of bug (raw integers reaching the screen, float math on balances) is
covered not by the checker but by `format.js` single-module discipline plus
per-slice raw→human vectors and testnet proofs — layers a TS migration
would leave untouched.

## 6. Standing offer and removal plan

- **Standing offer** (`type-safety-report.md:44-46`): name a seam JSDoc
  cannot express and it gets fancier machinery. Nothing on the list has
  qualified — the two open items are typedef chores, not language gaps.
  A future challenger must show a concrete seam, not a general preference
  for TS.
- **Removal plan** (required by doctrine for anything added): delete
  `tooling/check_types.sh`, `tooling/typecheck/` (including its
  `node_modules/` and lockfile), `vanilla/js/globals.d.ts`, and
  `vanilla/js/api/types.js`, then strip JSDoc type annotations at leisure.
  The app runs identically the next boot — nothing shipped ever imported
  any of it. There is no symmetric removal plan for TypeScript-the-language,
  which is the point.
- **Reconsider only if**: (a) a concrete seam defeats JSDoc expressiveness
  with vectors to prove it, (b) the proposal carries its own ten-year
  removal plan answering §4.5(a–c), and (c) `check_rot.py` is updated first
  so the exception is self-policing like the `.d.ts` carve-out — not
  discovered after the fact.

## 7. References

- Doctrine + gates: `AGENTS.md` §4 (Rot Report), §4.5 (rules 1–7, gate
  questions a–c), §7 rule 5 (hard type gate), §8 (tooling list).
- Type gate: `tooling/check_types.sh`, `tooling/typecheck/jsconfig.json`,
  `tooling/typecheck/package.json`, `tooling/typecheck/pnpm-lock.yaml`.
- Seams: `vanilla/js/globals.d.ts`, `vanilla/js/api/types.js`.
- Pass log: `vanilla/notes/type-safety-report.md`.
- Audit: `skills/auditing-vanilla-slices/SKILL.md` checks 1 (rot), 6
  (human terms), 8 (readability), 9 (type gate).
- Commits: `da344ae` (gate + seams + samet fix), `c02f1a9` (pin),
  `2a02991` (founding plain-JS commit), `b21d83b` (fuzz guards).
- Chain contract (why runtime validation stays mandatory):
  `reference/bitshares-core/libraries/app/include/graphene/app/database_api.hpp`,
  `reference/bitshares-core/libraries/protocol/operations.hpp`.
