/* api/types.js — shared JSDoc typedefs for the vanilla seam (tsc-only).
 * WHY UNTAGGED (no script tag in index.html): this file is NEVER loaded by
 *   the browser — it contains ZERO runtime values, only typedefs for
 *   tsc checkJs noEmit (tooling check_types). Adding a script tag
 *   would fetch and parse dead bytes on every boot for no benefit and would turn
 *   a lint aid into a load-bearing artifact (doctrine 4.5: smallest deletable
 *   subset — deleting this file loses a lint, never the wallet). tsc still
 *   reads it via the typecheck jsconfig include of vanilla js files.
 *   Consumers reference via import types X (api) or parent api types
 *   (sdk, builders, js root) or via typedef re-export — both resolve
 *   because this file is a CommonJS module guard (same footer as all seam
 *   files), never a browser script.
 * Owns: NOTHING at runtime — eleven shared shapes only. Consumes: nothing.
 *   Side effects: none (module.exports guard only for tsc module-ness).
 * Created by: JSDoc seam pass 2026-10-01 (slices 1-4 group).
 */

/**
 * Chain object id ("1.2.0", "1.3.0", "1.10.5" — space.instance.serial).
 * @typedef {string} ChainObjectId
 */

/**
 * Raw chain integer as a digit string (never a float — principle #6).
 * @typedef {string} RawInt
 */

/**
 * Human display amount ("1.23456 BTS" leg without the symbol).
 * @typedef {string} HumanAmount
 */

/**
 * Fee-charged asset id ("1.3.0" default — core).
 * @typedef {string} FeeAssetId
 */

/**
 * Chain connection status (chain.js lastStatus shape).
 * @typedef {Object} ChainStatus
 */

/**
 * Unsigned/signed tx envelope (tx-send.js buildTx shape).
 * @typedef {Object} TxEnvelope
 */

/**
 * One operation tuple [opId, opData] (serializeTransaction shape).
 * @typedef {Array} OpTuple
 */

/**
 * Queue/count snapshot (TxBuilder.count/state shape).
 * @typedef {Object} CountResult
 */

/**
 * Chain pulse sample (heartbeat/probe shape).
 * @typedef {Object} PulseResult
 */

/**
 * Top-market row (database get_top_markets shape — explorer-tabs marketsTab).
 * @typedef {Object} TopMarketRow
 */

/**
 * i18n translate fn (key, enDefault, vars?) -> string.
 * @typedef {Function} TFunction
 */

if (typeof module !== "undefined") { module.exports = {}; }
