#!/usr/bin/env python3
"""split-tx-serializers.py — ONE-SHOT migration: split vanilla/js/api/tx.js
(3018-line serializer registry) into 3 focused modules + thin facade.

Why this split: every serialize*Op is a LEAF (verified: helpers call only
helpers, ops call only helpers — except proposal_create -> OperationData
recursion). The two dispatch hubs (serializeOperationData/serializeTransaction)
stay in tx.js, now calling Tx._ser.* late-bound (the tx-send.js precedent).

Usage: python3 tooling/split-tx-serializers.py   (from /workspace)
Refuses if targets already exist. Review `git diff --stat` after.
Stdlib only.
"""
import os
import re
import sys

WS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APIDIR = os.path.join(WS, "vanilla", "js", "api")
SRC = os.path.join(APIDIR, "tx.js")

PRIMITIVES = [
    "concatBytes", "writeUint16LE", "writeUint32LE", "writeInt64LE",
    "varintUint32", "serializeString", "serializeOptional", "serializeBytesHex",
    "hexToBytes", "bytesToHex", "base58Decode", "serializeObjectId",
    "serializeAsset", "serializePublicKey", "serializeMemo", "voteIdToUint32",
    "serializeAccountOptions", "writeUint8", "serializeIdSet", "serializePrice",
    "serializeAssetOptions", "serializeBitassetOptions", "assertRatioU16",
    "serializePriceFeed", "serializeTimestamp", "assertUint32",
    "serializeHtlcHash", "serializeAuthority", "serializeAddressHex",
    "timestampToSecs", "serializeVestingPolicy", "serializePubkeySet",
    "serializeU16Set", "serializeSortedIdSet", "serializeRestrictionArgument",
    "serializeRestriction", "serializeRestrictionArray", "sortedMapEntries",
    "serializeCollateralMap", "serializeBorrowerMap",
    "serializeOptionalCollateralMap", "serializeOptionalBorrowerMap",
    "assertGovUrl", "assertAutoRepay", "serializeWorkerInitializer",
]
TRADE = [
    "serializeTransferOp", "serializeLimitOrderAutoAction",
    "serializeLimitOrderCreateOp", "serializeLimitOrderCancelOp",
    "serializeCallOrderUpdateOp", "serializeAssetCreateOp",
    "serializeAssetUpdateOp", "serializeAssetUpdateBitassetOp",
    "serializeAssetUpdateFeedProducersOp", "serializeAssetIssueOp",
    "serializeAssetReserveOp", "serializeAssetFundFeePoolOp",
    "serializeAssetSettleOp", "serializeAssetClaimFeesOp",
    "serializeAssetClaimPoolOp", "serializeAssetUpdateIssuerOp",
    "serializeAssetPublishFeedOp", "serializeHtlcCreateOp",
    "serializeHtlcRedeemOp", "serializeHtlcExtendOp",
    "serializeWithdrawPermissionCreateOp", "serializeWithdrawPermissionUpdateOp",
    "serializeWithdrawPermissionClaimOp", "serializeWithdrawPermissionDeleteOp",
    "serializeLiquidityPoolCreateOp", "serializeLiquidityPoolDeleteOp",
    "serializeLiquidityPoolDepositOp", "serializeLiquidityPoolWithdrawOp",
    "serializeLiquidityPoolExchangeOp", "serializeLiquidityPoolUpdateOp",
    "serializeSametFundCreateOp", "serializeSametFundDeleteOp",
    "serializeSametFundUpdateOp", "serializeSametFundBorrowOp",
    "serializeSametFundRepayOp", "serializeCreditOfferCreateOp",
    "serializeCreditOfferDeleteOp", "serializeCreditOfferUpdateOp",
    "serializeCreditOfferAcceptOp", "serializeCreditDealRepayOp",
    "serializeCreditDealUpdateOp", "serializeBidCollateralOp",
]
GOV = [
    "serializeAccountUpdateOp", "serializeAccountWhitelistOp",
    "serializeAccountUpgradeOp", "serializeWitnessCreateOp",
    "serializeWitnessUpdateOp", "serializeCommitteeMemberCreateOp",
    "serializeCommitteeMemberUpdateOp", "serializeProposalCreateOp",
    "serializeProposalUpdateOp", "serializeProposalDeleteOp",
    "serializeVestingBalanceCreateOp", "serializeVestingBalanceWithdrawOp",
    "serializeBalanceClaimOp", "serializeCustomAuthorityCreateOp",
    "serializeCustomAuthorityUpdateOp", "serializeCustomAuthorityDeleteOp",
    "serializeTicketCreateOp", "serializeTicketUpdateOp",
    "serializeWorkerCreateOp", "serializeCustomTrollboxOp",
]
FACADE = ["serializeOperationData", "serializeTransaction"]
ALL = PRIMITIVES + TRADE + GOV + FACADE

GUARD = ('var Tx = (typeof globalThis !== "undefined" && globalThis.Tx) '
         '? globalThis.Tx : ((typeof Tx !== "undefined") ? Tx : {});')


def mask_spans(text):
    """Replace comments/strings with spaces (keep offsets) for safe renaming."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        elif text.startswith("/*", i):
            j = text.find("*/", i)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
        elif text[i] in ("'", '"'):
            q = text[i]
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == q or text[j] == "\n":
                    if text[j] == q:
                        j += 1
                    break
                j += 1
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def rebind(block, own):
    """Rewrite bare cross-module refs -> Tx._ser.* (code only).

    Covers BOTH call sites `NAME(` and value refs `fn(..., NAME)` (helpers
    passed as callbacks, e.g. serializeOptional(x, serializeMemo)). Skips
    declarations, existing Tx._ser.* prefixes, comments and strings.
    """
    masked = mask_spans(block)
    out = []
    last = 0
    hits = []
    for m in re.finditer(r"(?<![\w$.])([A-Za-z_]\w*)", masked):
        name = m.group(1)
        if name not in ALL or name in own:
            continue
        s = m.start(1)
        if re.search(r"function\s*$", block[:s]):
            continue  # declaration, not a reference
        hits.append((s, s + len(name)))
    for s, e in hits:
        out.append(block[last:s])
        out.append("Tx._ser." + block[s:e])
        last = e
    out.append(block[last:])
    return "".join(out)


def main():
    for target in ("tx-primitives.js", "tx-ops-trade.js", "tx-ops-gov.js"):
        if os.path.exists(os.path.join(APIDIR, target)):
            print("REFUSING: %s already exists" % target)
            return 1
    with open(SRC, "r", encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    # locate `  function NAME(` definitions (exactly 2-space indent)
    starts = {}
    order = []
    for i, ln in enumerate(lines):
        m = re.match(r"^  function (\w+)\(", ln)
        if m:
            starts[m.group(1)] = i
            order.append(m.group(1))
    missing = [n for n in ALL if n not in starts]
    if missing:
        print("MISSING definitions: %s" % missing)
        return 1
    # function body spans: [comment-start, next-comment-start), so attached
    # comments are claimed exactly once (no duplication across modules).
    cstarts = {}
    for name in ALL:
        i = starts[name]
        j = i - 1
        while j >= 0 and re.match(r"^  (/\*|\*|//)", lines[j]):
            j -= 1
        cstarts[name] = j + 1
    # envelope tail: first `  /* Envelope/fee/sign/send moved` after the last def
    tail = next(i for i, ln in enumerate(lines)
                if ln.startswith("  /* Envelope/fee/sign/send moved"))
    src_order = sorted(ALL, key=lambda n: starts[n])
    blocks = {}
    for idx, name in enumerate(src_order):
        nxt = cstarts[src_order[idx + 1]] if idx + 1 < len(src_order) else tail
        blocks[name] = "\n".join(lines[cstarts[name]:nxt]).rstrip("\n")
    # OP literal: from `  return {` to the matching `  };` before `})();`
    ret_start = next(i for i, ln in enumerate(lines) if ln == "  return {")
    ret_end = next(i for i, ln in enumerate(lines) if ln == "  };")
    ret_block = "\n".join(lines[ret_start:ret_end + 1])
    m = re.search(r"^    _ser: \{$.*?^    \}$", ret_block,
                  re.MULTILINE | re.DOTALL)
    if not m:
        print("cannot isolate _ser export list")
        return 1
    op_lines = (ret_block[:m.start()] + "  };").split("\n")
    oi = next(i for i, ln in enumerate(op_lines) if ln == "    OP: {")
    oj = next(i for i, ln in enumerate(op_lines) if ln == "    },")
    op_emit = ["  Tx.OP = {"] + op_lines[oi + 1:oj] + ["  };"]
    exported = re.findall(r"^      (\w+): \1,$", ret_block, re.MULTILINE)
    unmoved = [n for n in exported if n not in ALL]
    if unmoved:
        print("UNMOVED exports would be lost: %s" % unmoved)
        return 1
    print("functions: %d (prim %d / trade %d / gov %d / facade %d)" % (
        len(ALL), len(PRIMITIVES), len(TRADE), len(GOV), len(FACADE)))
    print("exported _ser keys: %d, all covered" % len(exported))

    def module_file(fname, names, blurb):
        own = set(names)
        parts = [blurb, GUARD, "Tx.OP = Tx.OP || {};", "Tx._ser = Tx._ser || {};",
                 "(function () {", '  "use strict";', ""]
        for name in names:
            parts.append(rebind(blocks[name], own))
            parts.append("")
        for name in names:
            parts.append("  Tx._ser." + name + " = " + name + ";")
        parts += ["  if (typeof globalThis !== \"undefined\") { globalThis.Tx = Tx; }",
                  "})();", "",
                  'if (typeof module !== "undefined") { module.exports = Tx; }',
                  ""]
        with open(os.path.join(APIDIR, fname), "w", encoding="utf-8") as fh:
            fh.write("\n".join(parts))
        print("wrote %s (%d fns)" % (fname, len(names)))

    prim_blurb = "\n".join([
        "/* tx-primitives.js — shared serializer primitives for the Tx registry.",
        " *",
        " * What it owns: byte writers (concatBytes, writeUint16LE, writeUint32LE,",
        " * writeInt64LE, varintUint32), base codecs (string/optional/bytesHex,",
        " * object-id/asset/pubkey/memo), and the shared composite helpers every",
        " * op serializer builds on (price, asset/bitasset options, price_feed,",
        " * authority, address, timestamps, vesting policy, pubkey/u16/id sets,",
        " * restrictions, samet collateral/borrower maps, gov asserts).",
        " * Consumes: nothing (leaf module — no Tx._ser calls at load).",
        " * Side effects: attaches its functions to the shared `Tx._ser` object",
        " * (created here if absent); sets globalThis.Tx. Load order in",
        " * index.html: this file first, then tx-ops-*.js, then tx.js, then",
        " * tx-send.js. Created by: tx.js responsibility split (slice-18",
        " * readability pass) — code moved byte-verbatim out of tx.js, internal",
        " * calls unchanged (same scope), cross-module calls go via Tx._ser.",
        " * Provenance: HAND-PORTED from wallet-extension/src/lib/bitshares-api.js",
        " * (#3), cross-checked against bitshares-core (#4) — full per-function",
        " * credits lived in the tx.js header at split time (see git history).",
        " */"])
    trade_blurb = "\n".join([
        "/* tx-ops-trade.js — money-movement op serializers for the Tx registry.",
        " *",
        " * What it owns: transfer (op 0), limit orders (ops 1/2 + on-fill helper),",
        " * call_order_update (op 3), ALL asset ops (10-17, 19, 43, 47, 48),",
        " * HTLC (49/50/52), withdraw-permission (25-28), liquidity pools",
        " * (59-63, 75), samet_fund (64-68), credit offers/deals (69-73, 76)",
        " * and bid_collateral (op 45).",
        " * Consumes: Tx._ser primitives from tx-primitives.js (late-bound at call",
        " * time — never owned here).",
        " * Side effects: attaches its functions to the shared `Tx._ser` object;",
        " * sets globalThis.Tx. Load order in index.html: after tx-primitives.js,",
        " * before tx.js. Created by: tx.js responsibility split (slice-18",
        " * readability pass) — code moved byte-verbatim out of tx.js except",
        " * primitive calls now spell Tx._ser.* (same functions, same bytes).",
        " * Provenance: HAND-PORTED from wallet-extension/src/lib/bitshares-api.js",
        " * (#3), cross-checked against bitshares-core (#4) — full per-function",
        " * credits lived in the tx.js header at split time (see git history).",
        " */"])
    gov_blurb = "\n".join([
        "/* tx-ops-gov.js — identity/governance op serializers for the Tx registry.",
        " *",
        " * What it owns: account_update/whitelist/upgrade (ops 6/7/8), witnesses",
        " * (20/21), committee members (29/30), proposals (22/23/24), vesting",
        " * balances (32/33), worker_create (34), custom trollbox chat (op 35,",
        " * 9198/9199 only), balance_claim (37), custom authorities (54/55/56)",
        " * and tickets (57/58).",
        " * Consumes: Tx._ser primitives from tx-primitives.js (late-bound at call",
        " * time — never owned here) plus Tx._ser.serializeOperationData for the",
        " * op-22 nested-proposal recursion (defined in tx.js, call-time lookup).",
        " * Side effects: attaches its functions to the shared `Tx._ser` object;",
        " * sets globalThis.Tx. Load order in index.html: after tx-primitives.js,",
        " * before tx.js. Created by: tx.js responsibility split (slice-18",
        " * readability pass) — code moved byte-verbatim out of tx.js except",
        " * shared calls now spell Tx._ser.* (same functions, same bytes).",
        " * Provenance: HAND-PORTED from wallet-extension/src/lib/bitshares-api.js",
        " * (#3), cross-checked against bitshares-core (#4) — full per-function",
        " * credits lived in the tx.js header at split time (see git history).",
        " */"])
    module_file("tx-primitives.js", PRIMITIVES, prim_blurb)
    module_file("tx-ops-trade.js", TRADE, trade_blurb)
    module_file("tx-ops-gov.js", GOV, gov_blurb)

    # ---- facade tx.js: header + loader + dispatch + OP map + exports ----
    own = set(FACADE)
    facade = ["/* tx.js — Tx registry FACADE (thin) after the responsibility split.",
              " *",
              " * What it owns: the op dispatch hubs serializeOperationData (single-op",
              " * bytes for proposals/envelopes) and serializeTransaction (signed-bytes",
              " * framing) plus the Tx.OP id map. The ~100 serializer functions moved",
              " * to tx-primitives.js (shared writers/helpers), tx-ops-trade.js",
              " * (money-movement ops) and tx-ops-gov.js (identity/governance ops) —",
              " * this file calls them via Tx._ser.* at call time (same late binding",
              " * tx-send.js already uses), so load order is the only contract.",
              " * Consumes: Tx._ser.* (defined by the split modules; browser: classic",
              " * <script> order in index.html; node: module.require()d below).",
              " * Side effects: defines Tx.OP + Tx._ser.serializeOperationData +",
              " * Tx._ser.serializeTransaction on the shared `Tx` global.",
              " * Created by: building-vanilla-slices skill, slice-04-transfer plan",
              " * Task 2; split by the slice-18 readability pass. Serializer coverage",
              " * unchanged: ops 0-3, 6-8, 10-17, 19-24, 25-30, 32-35 (35 chat",
              " * 9198/9199 only), 37, 43, 45, 47, 48, 49, 50, 52, 54-58, 59-73,",
              " * 75, 76. Full provenance record: git history of this file.",
              " */",
              GUARD,
              "Tx.OP = Tx.OP || {};",
              "Tx._ser = Tx._ser || {};",
              "/* Node suites require() this file directly (tooling/*-test.js) while the",
              " * browser loads tx-primitives/tx-ops-* via <script> order. Pull the",
              " * split modules through the module loader WITHOUT naming `require`",
              " * (checkJs runs browser libs — a bare require() call is TS2591 there).",
              " * module.require resolves relative to THIS file, like require(). */",
              "var __txRequire = null;",
              "try {",
              "  if (typeof module !== \"undefined\" && module && module.require && module.require.bind) __txRequire = module.require.bind(module);",
              "} catch (e) { __txRequire = null; }",
              "if (__txRequire && (typeof globalThis === \"undefined\" || !globalThis.Tx || !globalThis.Tx._ser || !globalThis.Tx._ser.serializeTransferOp)) {",
              '  __txRequire("./tx-primitives.js");',
              '  __txRequire("./tx-ops-trade.js");',
              '  __txRequire("./tx-ops-gov.js");',
              "  if (typeof globalThis !== \"undefined\" && globalThis.Tx) Tx = globalThis.Tx;",
              "}",
              "(function () {",
              '  "use strict";',
              ""]
    for name in FACADE:
        facade.append(rebind(blocks[name], own))
        facade.append("")
    facade += op_emit
    facade += ["  Tx._ser.serializeOperationData = serializeOperationData;",
               "  Tx._ser.serializeTransaction = serializeTransaction;",
               "  if (typeof globalThis !== \"undefined\") { globalThis.Tx = Tx; }",
               "})();", "",
               'if (typeof module !== "undefined") { module.exports = Tx; }',
               ""]
    with open(SRC, "w", encoding="utf-8") as fh:
        fh.write("\n".join(facade))
    print("rewrote tx.js as facade")
    return 0


if __name__ == "__main__":
    sys.exit(main())
