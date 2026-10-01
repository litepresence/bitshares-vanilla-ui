#!/usr/bin/env node
/* spec-diff.js — serializer cross-check oracle: tx.js op registry vs
 * open-graphene BitShares spec (reference #6).
 *
 * What it owns: read-only comparison of two local files —
 *   (1) vanilla/js/api/tx.js op dispatch table + serialize* function names, vs
 *   (2) reference/open-graphene/.../dist/bitshares.open-graphene.json
 *   (78 ops, wireTags 0-77). Prints a human-readable mismatch report to
 *   stdout. NEVER auto-edits serializers; NEVER fetches network (local files
 *   only); NEVER imports the spec into vanilla/ runtime (tooling-only oracle).
 * Consumes: the two files above (read-only, fs + crypto + path stdlib only).
 * Side effects: none except stdout + exit code.
 * Created by: serializer cross-check task 2026-10-01 (mapping-chain-calls
 *   skill, reference #6 row: rank below BJS, #4 wins conflicts, testnet
 *   decides, reference-only).
 *
 * Reference priority (mapping-chain-calls skill): #4 bitshares-core headers
 * are ground truth and win every conflict; BJS is the official JS rendering
 * (second opinion); #6 open-graphene spec is a machine-extracted third
 * opinion — BELOW BJS, reference-only, never a dependency. If this oracle
 * disagrees with #4 or BJS, #4/BJS win; testnet decides.
 *
 * Usage: node tooling/spec-diff.js [specPath] [txPath]
 *   defaults (relative to workspace root = parent of tooling/):
 *     reference/open-graphene/open-graphene-packages/rust/graphene-chain-bitshares/graphene-chain-bitshares-spec/dist/bitshares.open-graphene.json
 *     vanilla/js/api/tx.js
 * Exit codes: 0 = compared, no mismatch; 2 = compared, mismatch found
 *   (missing non-virtual tag, virtual tag dispatched, or spec virtual list
 *   drifted from expectation); 1 = fatal (missing file / bad JSON / IO).
 *   Per-op field-name overlap (section 2) is BEST-EFFORT by name matching
 *   and REPORT-ONLY — it never affects the exit code.
 *
 * Staleness: the report header always prints spec SHA-256 + file mtime (and
 * tx.js mtime) so a stale spec checkout is visible. Verified complete
 * 2026-10-01: 78 ops, tags 0-77, spec SHA caa33ea945b63d32 (short) — see
 * FIRST-RUN RESULTS below for the full hash of that checkout.
 *
 * FIRST-RUN RESULTS (2026-10-01, recorded after `node --check` clean):
 *   exit=2 (mismatch found — expected: intentional deferrals + one new gap).
 *   - Virtuals: spec virtual list == expected [4,42,44,46,51,53,74]; all 7
 *     correctly ABSENT from tx.js dispatch (must NOT be signed). 6 of 7 are
 *     named in tx.js WHY notes / the throw-line virtual list; tag 4
 *     fill_order is absent-but-unnamed (no note says "fill_order" — WARNING
 *     only, signing-safe since it is not dispatched).
 *   - Op-35 guard exception NOTED: tag 35 dispatches to
 *     serializeCustomTrollboxOp which rejects every sub-id except 9198/9199
 *     (chat only); generic custom ops stay deferred.
 *   - Missing non-virtual tags (10): 5 account_create, 9 account_transfer,
 *     18 asset_global_settle, 31 committee_member_update_global_parameters,
 *     36 assert_operation, 38 override_transfer, 39 transfer_to_blind,
 *     40 blind_transfer, 41 transfer_from_blind (all 9 name-assessed in the
 *     tx.js header/dispatch WHY notes) + 77 limit_order_update (NO tx.js
 *     mention — the one genuine unassessed gap this oracle surfaced).
 *   - Field overlap (report-only): 61 dispatched non-virtual ops compared;
 *     one note — tag 76 credit_deal_update reads op.borrower (legacy alias
 *     fallback for `account`, documented tx.js:227-230), spec has no
 *     `borrower` field. Constant-empty `extensions` (varint 0) handled.
 *   Rerun: `node tooling/spec-diff.js` (exit 2 while the 10 deferrals/gap
 *   remain undispatched — that is the oracle working, not a failure).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* Workspace root = parent of tooling/ (script lives at tooling/spec-diff.js). */
const TOOLING_DIR = __dirname;
const WORKSPACE = path.dirname(TOOLING_DIR);

const DEFAULT_SPEC = path.join(
  WORKSPACE,
  "reference/open-graphene/open-graphene-packages/rust/graphene-chain-bitshares",
  "graphene-chain-bitshares-spec/dist/bitshares.open-graphene.json"
);
const DEFAULT_TX = path.join(WORKSPACE, "vanilla/js/api/tx.js");

/* Virtual ops that must NEVER be signed. Cross-checked against the spec's own
 * isVirtual flags below (drift => mismatch). Source: #4 operations.hpp
 * virtual-operation rule; spec 2026-10-01 checkout confirms exactly these 7. */
const EXPECTED_VIRTUALS = [4, 42, 44, 46, 51, 53, 74];

/* Chat-only exception: op 35 dispatches but the serializer rejects every
 * sub-id except these two. Presence of both strings in tx.js = guard noted. */
const CHAT_SUB_IDS = ["9198", "9199"];

function fail(msg) {
  console.log("spec-diff: FATAL: " + msg);
  process.exit(1);
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function fmtMtime(stat) {
  return stat.mtime.toISOString() + " (" + stat.size + " bytes)";
}

/* Extract every `opType === N` dispatch tag from the two dispatch
 * functions. Returns { tags:Set, tagToFn:Map(tag->serializerName) }.
 * Only lines shaped `) return serializeX` / `) parts.push(serializeX`
 * count — comment mentions of tags (WHY notes, virtual guards) never match,
 * so deliberate absences stay absent, which is exactly the assertion. */
function parseDispatch(txSrc) {
  const tags = new Set();
  const tagToFn = new Map();
  const re = /opType\s*===\s*(\d+)\s*\)\s*(?:return|parts\.push\()\s*(serialize\w+)?/g;
  let m;
  while ((m = re.exec(txSrc)) !== null) {
    const tag = Number(m[1]);
    tags.add(tag);
    if (m[2] && !tagToFn.has(tag)) tagToFn.set(tag, m[2]);
  }
  return { tags, tagToFn };
}

/* All `function serialize*` names defined in tx.js (serializer inventory). */
function parseSerializerNames(txSrc) {
  const out = new Set();
  const re = /function\s+(serialize\w+)\s*\(/g;
  let m;
  while ((m = re.exec(txSrc)) !== null) out.add(m[1]);
  return out;
}

/* Deliberateness check: is this spec op's absence/role documented in tx.js?
 * Name-stem based (bare tag numbers false-positive on BSIP/line refs like
 * "BSIP74/75/77" or "operations.hpp:76-77"). Returns true when tx.js contains
 * the op's name stem (e.g. "limit_order_update") or the tag inside an
 * explicit virtual enumeration ("42/44/46/51/53/74 virtual" in the dispatch
 * throw line). Name stems are exact: "fill_order" has zero hits, so tag 4
 * correctly reports unguarded (absent from dispatch — safe — but with no WHY
 * note naming it, unlike 42/44 which the throw line enumerates). */
function opStem(opName) {
  return opName.replace(/_operation$/, "");
}

function virtualListTags(txSrc) {
  const out = new Set();
  const re = /(\d+(?:\/\d+)+)\s+virtual/g;
  let m;
  while ((m = re.exec(txSrc)) !== null) {
    for (const t of m[1].split("/")) out.add(Number(t));
  }
  return out;
}

function isDocumented(txSrc, tag, opName, virtTags) {
  if (txSrc.indexOf(opStem(opName)) !== -1) return true;
  if (virtTags.has(tag)) return true;
  return false;
}

/* Best-effort top-level field reads of one serializer: every `op.<name>`
 * token inside its function body. Sub-struct fields delegated to helpers
 * (e.g. serializeAssetOptions) intentionally do NOT appear here — the
 * comparison is top-level spec fields[] vs top-level op.* reads only. */
function serializerReads(txSrc, fnName) {
  const start = txSrc.indexOf("function " + fnName + "(");
  if (start === -1) return null;
  const brace = txSrc.indexOf("{", start);
  if (brace === -1) return null;
  /* Body ends at the next "\n  }" at column 2 (file uses 2-space indent,
   * top-level functions close as "  }"). Falls back to brace counting. */
  let end = txSrc.indexOf("\n  }", brace);
  if (end === -1) {
    let depth = 0;
    end = -1;
    for (let i = brace; i < txSrc.length; i++) {
      if (txSrc[i] === "{") depth++;
      else if (txSrc[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return null;
  }
  const body = txSrc.slice(brace, end);
  const reads = new Set();
  const re = /op\.([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) reads.add(m[1]);
  return { reads, hasEmptyExtensions: /varintUint32\(0\)/.test(body) };
}

function main() {
  const specPath = process.argv[2] || DEFAULT_SPEC;
  const txPath = process.argv[3] || DEFAULT_TX;

  let specBuf, txSrc, specStat, txStat;
  try {
    specStat = fs.statSync(specPath);
  } catch (e) {
    fail("spec file not found: " + specPath + " (" + e.message + ")");
  }
  try {
    txStat = fs.statSync(txPath);
  } catch (e) {
    fail("tx.js file not found: " + txPath + " (" + e.message + ")");
  }
  try {
    specBuf = fs.readFileSync(specPath);
  } catch (e) {
    fail("cannot read spec: " + e.message);
  }
  try {
    txSrc = fs.readFileSync(txPath, "utf8");
  } catch (e) {
    fail("cannot read tx.js: " + e.message);
  }

  let spec;
  try {
    spec = JSON.parse(specBuf.toString("utf8"));
  } catch (e) {
    fail("spec JSON parse failed: " + e.message);
  }
  const ops = spec.operations;
  if (!Array.isArray(ops) || ops.length === 0) fail("spec.operations is not a non-empty array");

  const specHash = sha256Hex(specBuf);
  const { tags: dispatchTags, tagToFn } = parseDispatch(txSrc);
  const serializerNames = parseSerializerNames(txSrc);

  const specVirtuals = ops.filter((o) => o.isVirtual).map((o) => o.wireTag).sort((a, b) => a - b);
  const expectedSorted = EXPECTED_VIRTUALS.slice().sort((a, b) => a - b);
  const virtualListMatches =
    specVirtuals.length === expectedSorted.length &&
    specVirtuals.every((t, i) => t === expectedSorted[i]);

  let mismatch = false;
  const out = [];

  out.push("spec-diff: tx.js op registry vs open-graphene spec (reference #6 oracle)");
  out.push("  spec : " + specPath);
  out.push("  spec SHA-256: " + specHash);
  out.push("  spec mtime  : " + fmtMtime(specStat));
  out.push("  tx.js: " + txPath);
  out.push("  tx.js mtime : " + fmtMtime(txStat));
  out.push("  rank: #6 below BJS; #4 wins conflicts; testnet decides; reference-only.");
  out.push("");

  /* ---- (1) wireTag coverage 0-77 ---- */
  out.push("(1) wireTag coverage (spec tags 0-77 vs tx.js dispatch)");
  const missingNonVirtual = [];
  const dispatchedVirtual = [];
  const absentVirtual = [];
  for (const o of ops) {
    const inTx = dispatchTags.has(o.wireTag);
    if (o.isVirtual) {
      if (inTx) { dispatchedVirtual.push(o); mismatch = true; }
      else absentVirtual.push(o);
    } else if (!inTx) {
      missingNonVirtual.push(o);
      mismatch = true;
    }
  }
  out.push("  spec ops: " + ops.length + " (tags 0-" + Math.max.apply(null, ops.map((o) => o.wireTag)) + ")");
  out.push("  tx.js dispatch tags: " + dispatchTags.size);
  out.push("  spec virtual list: [" + specVirtuals.join(", ") + "]" +
    (virtualListMatches ? " (matches expected — ok)" : " (DRIFT from expected [" + expectedSorted.join(", ") + "] — MISMATCH)"));
  if (!virtualListMatches) mismatch = true;
  out.push("  virtuals absent from dispatch (must NOT be signed — ok): " +
    (absentVirtual.length ? absentVirtual.map((o) => o.wireTag + "=" + o.name).join(", ") : "(none)"));
  /* Guard cross-check: each absent virtual should be documented in tx.js
   * (name stem in a WHY comment or tag inside the throw-line virtual list),
   * proving the absence is deliberate. Undocumented absence is signing-safe
   * (not dispatched) so it is a WARNING only — it never sets mismatch. */
  const virtTags = virtualListTags(txSrc);
  const unmentioned = absentVirtual.filter((o) => !isDocumented(txSrc, o.wireTag, o.name, virtTags));
  out.push("  tx.js guard notes for absent virtuals: " +
    (unmentioned.length === 0
      ? "all " + absentVirtual.length + " documented in tx.js comments/guards — ok"
      : "WARNING (safe — absent from dispatch — but no WHY note names " +
        unmentioned.map((o) => o.wireTag + "=" + opStem(o.name)).join(", ") + ")"));
  if (dispatchedVirtual.length > 0) {
    out.push("  VIRTUALS DISPATCHED (must never be signed — MISMATCH): " +
      dispatchedVirtual.map((o) => o.wireTag + "=" + o.name).join(", "));
  }
  if (missingNonVirtual.length > 0) {
    out.push("  missing non-virtual tags (" + missingNonVirtual.length + " — MISMATCH, triage: assessed-deferral vs genuine gap):");
    for (const o of missingNonVirtual) {
      const documented = isDocumented(txSrc, o.wireTag, o.name, virtTags);
      out.push("    tag " + o.wireTag + " " + o.name +
        " fields=[" + o.fields.map((f) => f.name).join(", ") + "]" +
        (documented ? " (name in tx.js — assessed, see header/dispatch WHY)" : " (NO tx.js mention — unassessed gap)"));
    }
  } else {
    out.push("  missing non-virtual tags: none — ok");
  }
  /* Op-35 guard exception note. */
  const hasTrollboxFn = txSrc.indexOf("serializeCustomTrollboxOp") !== -1;
  const chatGuard = hasTrollboxFn && CHAT_SUB_IDS.every((id) => txSrc.indexOf(id) !== -1);
  out.push("  op-35 guard exception: " +
    (dispatchTags.has(35)
      ? (chatGuard
        ? "tag 35 dispatches to serializeCustomTrollboxOp, 9198/9199-only guard present — NOTED (generic custom ops stay deferred)"
        : "tag 35 dispatched but 9198/9199 guard strings NOT both found — MISMATCH (guard missing?)")
      : "tag 35 NOT dispatched"));
  if (dispatchTags.has(35) && !chatGuard) mismatch = true;
  out.push("");

  /* ---- (2) per-op field-name overlap (report-only) ---- */
  out.push("(2) per-op field-name overlap (best-effort op.* reads vs spec fields[] — REPORT-ONLY)");
  let overlapNotes = 0;
  for (const o of ops) {
    if (o.isVirtual || !dispatchTags.has(o.wireTag)) continue;
    const fn = tagToFn.get(o.wireTag);
    if (!fn) {
      out.push("  tag " + o.wireTag + " " + o.name + ": dispatched but serializer fn unresolved — skipped");
      continue;
    }
    const parsed = serializerReads(txSrc, fn);
    if (!parsed) {
      out.push("  tag " + o.wireTag + " " + o.name + ": " + fn + " body not found — skipped");
      continue;
    }
    const specFields = o.fields.map((f) => f.name);
    const unread = specFields.filter((f) => !parsed.reads.has(f) && !(f === "extensions" && parsed.hasEmptyExtensions));
    const extra = Array.from(parsed.reads).filter((r) => specFields.indexOf(r) === -1);
    if (unread.length === 0 && extra.length === 0) continue; /* quiet on exact match */
    overlapNotes++;
    out.push("  tag " + o.wireTag + " " + o.name + " (" + fn + "):");
    if (unread.length > 0) {
      out.push("    spec fields with no op.* read: " + unread.join(", ") +
        (unread.indexOf("extensions") !== -1 && parsed.hasEmptyExtensions
          ? " [extensions=constant-empty varint 0 — known ok]"
          : ""));
    }
    if (extra.length > 0) out.push("    op.* reads not in spec: " + extra.join(", "));
  }
  if (overlapNotes === 0) out.push("  all dispatched ops: top-level reads match spec fields[] — ok");
  out.push("");

  /* ---- summary ---- */
  const nonVirtualDispatched = ops.filter((o) => !o.isVirtual && dispatchTags.has(o.wireTag)).length;
  const nonVirtualTotal = ops.filter((o) => !o.isVirtual).length;
  out.push("summary: dispatched non-virtual " + nonVirtualDispatched + "/" + nonVirtualTotal +
    "; virtuals dispatched " + dispatchedVirtual.length + " (must be 0)" +
    "; serializers defined " + serializerNames.size +
    "; result=" + (mismatch ? "MISMATCH" : "CLEAN"));
  out.push("note: NEVER auto-edit serializers from this report; NEVER fetch network;");
  out.push("note: NEVER import the spec into vanilla/ runtime (oracle is tooling-only).");
  out.push(mismatch
    ? "exit 2: mismatch found (see section 1 — assessed deferrals still count as mismatch for triage)."
    : "exit 0: compared, no mismatch.");

  process.stdout.write(out.join("\n") + "\n");
  process.exit(mismatch ? 2 : 0);
}

main();
