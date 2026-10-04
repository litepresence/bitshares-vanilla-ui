/* prediction-ui.js — #/prediction + #/prediction/:market route entries (FACADE).
 * Owns: NOTHING but delegation — renderList / renderDetail keep the exact
 *   names the router (router.js) uses. Bodies live in the res-split1 files:
 *   pure parsing / validity / probability math in prediction-helpers.js
 *   (PredictionHelpers, also backing the _test surface below) and the scan
 *   core + list / portfolio / settle + org / detail flows in
 *   prediction-flows.js (PredictionFlows).
 * Load order: any — entries resolve the sibling globals at CALL time, and
 *   node suites resolve them through module.require below (tx.js precedent:
 *   module.require, never a bare require, so checkJs stays TS2591-clean).
 *   Browser <script> order (wired by the controller): prediction-helpers.js,
 *   prediction-flows.js, then this facade.
 * Surface: renderList + renderDetail + _test (identical to the pre-split
 *   file — same globals, same signatures).
 */
var __splRequire = null;
try {
  if (typeof module !== "undefined" && module && (/** @type {any} */ (module)).require && (/** @type {any} */ (module)).require.bind) __splRequire = (/** @type {any} */ (module)).require.bind(module);
} catch (e) { __splRequire = null; }

var __predHelpers = null;
function __predhelpers() {
  if (__predHelpers) return __predHelpers;
  try { if (typeof PredictionHelpers !== "undefined" && PredictionHelpers) { __predHelpers = PredictionHelpers; return __predHelpers; } } catch (e) {}
  try { if (typeof globalThis !== "undefined" && globalThis.PredictionHelpers) { __predHelpers = globalThis.PredictionHelpers; return __predHelpers; } } catch (e) {}
  if (__splRequire) { try { __predHelpers = __splRequire("./prediction-helpers.js"); } catch (e) { __predHelpers = null; } }
  return __predHelpers;
}
var __predFlows = null;
function __predflows() {
  if (__predFlows) return __predFlows;
  try { if (typeof PredictionFlows !== "undefined" && PredictionFlows) { __predFlows = PredictionFlows; return __predFlows; } } catch (e) {}
  try { if (typeof globalThis !== "undefined" && globalThis.PredictionFlows) { __predFlows = globalThis.PredictionFlows; return __predFlows; } } catch (e) {}
  if (__splRequire) { try { __predFlows = __splRequire("./prediction-flows.js"); } catch (e) { __predFlows = null; } }
  return __predFlows;
}

var PredictionUI = (function () {
  "use strict";

  function renderList(root, extra) {
    var V = __predflows();
    return V.renderList(root, extra);
  }
  function renderDetail(root, extra) {
    var V = __predflows();
    return V.renderDetail(root, extra);
  }
  var testSurface = {
    parsePMADescription: function () { var h = __predhelpers(); return h.parsePMADescription.apply(null, arguments); },
    parsePMO: function () { var h = __predhelpers(); return h.parsePMO.apply(null, arguments); },
    isSubAssetOf: function () { var h = __predhelpers(); return h.isSubAssetOf.apply(null, arguments); },
    invalidReason: function () { var h = __predhelpers(); return h.invalidReason.apply(null, arguments); },
    clamp01: function () { var h = __predhelpers(); return h.clamp01.apply(null, arguments); },
    probabilityFromPrice: function () { var h = __predhelpers(); return h.probabilityFromPrice.apply(null, arguments); },
    probabilityFromBook: function () { var h = __predhelpers(); return h.probabilityFromBook.apply(null, arguments); },
    formatImplied: function () { var h = __predhelpers(); return h.formatImplied.apply(null, arguments); },
    formatDecimal: function () { var h = __predhelpers(); return h.formatDecimal.apply(null, arguments); },
    gcd: function () { var h = __predhelpers(); return h.gcd.apply(null, arguments); },
    formatFractional: function () { var h = __predhelpers(); return h.formatFractional.apply(null, arguments); },
    formatAmerican: function () { var h = __predhelpers(); return h.formatAmerican.apply(null, arguments); },
    get PMO_TYPE() { return __predhelpers().PMO_TYPE; },
    get PROB_MAX_DEN() { return __predhelpers().PROB_MAX_DEN; }
  };

  return {
    renderList: renderList,
    renderDetail: renderDetail,
    _test: testSurface
  };
})();

if (typeof module !== "undefined") { module.exports = PredictionUI; }
