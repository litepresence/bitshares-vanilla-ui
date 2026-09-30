/* SettingsPrefs: preference sections of the #/settings page.
 * Owns: the network toggle (mainnet/testnet radios), the theme selector
 *   (ref-ui-theme/vanilla-ui-theme/dex-ux-theme), and the locale switcher
 *   stub marking). Builds DOM only — the change-event wiring lives in
 *   settings.js (SettingsPage.render passes `t` in; I18n is read here for
 *   the locale names/current tag only, never written — I18n.setLocale owns
 *   the pref write). There is no reset section: the old UI's reset tab was
 *   never ported, so nothing was moved for it and nothing is added here.
 * Consumes: Store.DEFAULT_NODES (first-node fallback is owned by the
 *   settings.js switch handler, not here), I18n.names/locale (display only),
 *   document elements callers pass in.
 * Globals/side effects: DOM nodes it returns (appended by the caller under
 *   the router root); global SettingsPrefs only. No storage writes here.
 * Created by: building-vanilla-slices skill, slice-18 audit (settings split).
 *   Bodies moved verbatim from js/settings.js render; closure variables
 *   became params, the network/theme/locale change handlers stayed in
 *   settings.js (they rerender the page, which only the orchestrator owns).
 */
var SettingsPrefs = (function () {
  "use strict";

  /* Network toggle (mainnet/testnet radios, current network checked).
   * The change handler (settings.js) swaps activeNode to the new network's
   * first default and rerenders. Params: doc, settings, t. Returns: the
   * toggle div (id net-toggle). */
  function buildNetwork(doc, settings, t) {
    var netToggle = doc.createElement("div");
    netToggle.id = "net-toggle";
    var networks = ["mainnet", "testnet"];
    networks.forEach(function (net) {
      var label = doc.createElement("label");
      var radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "network";
      radio.value = net;
      if (settings.network === net) radio.checked = true;
      label.appendChild(radio);
      var netLabel = (net === "testnet") ? t("settings.network_testnet", "testnet") : t("settings.network_mainnet", "mainnet");
      label.appendChild(doc.createTextNode(" " + netLabel));
      netToggle.appendChild(label);
    });
    return netToggle;
  }

  /* Theme selector (ref-ui-theme/vanilla-ui-theme/dex-ux-theme, current
   * selected; option labels are the same human names the header switcher
   * shows (app.js THEME_NAMES) so both copies agree — values stay the ids.
   * English literals, no dict churn, matching the header pattern).
   * The change handler (settings.js) persists + flips data-theme on <html>.
   * Params: doc, settings, t. Returns: {label, select}. */
  function buildTheme(doc, settings, t) {
    var themeLabel = doc.createElement("label");
    themeLabel.textContent = t("settings.theme_label", "Theme ");
    var themeSelect = doc.createElement("select");
    themeSelect.id = "theme-select";
    var themeNames = {
      "ref-ui-theme": "Classic",
      "vanilla-ui-theme": "Vanilla light",
      "dex-ux-theme": "DEX dark"
    };
    ["ref-ui-theme", "vanilla-ui-theme", "dex-ux-theme"].forEach(function (t) {
      var opt = doc.createElement("option");
      opt.value = t;
      opt.textContent = themeNames[t] || t;
      if (settings.theme === t) opt.selected = true;
      themeSelect.appendChild(opt);
    });
    themeLabel.appendChild(themeSelect);
    return { label: themeLabel, select: themeSelect };
  }

  /* Locale switcher (slice-17 Task 2): mirrors the theme selector shape
   * (Reference #8). Option labels are the Reference-#7 display names;
   * stub locales (8) are suffixed " — in English" (honest marking) and
   * render English via the t() fallback chain. The visible "Language "
   * label stays a hardcoded English literal (no dict key exists for it;
   * converting it would churn all 10 dicts — queued for a later per-view
   * batch with its Task-1-style key). The failure line in the settings.js
   * handler is likewise hardcoded: the ambiguity-E wording, shown only
   * when the dict fetch fails.
   * Params: doc, t (unused today — kept so the signature matches the other
   *   builders). Returns: {label, select, error, currentLocale} where
   *   currentLocale is the I18n tag the select reflects ("en" fallback). */
  function buildLocale(doc, t) {
    var localeLabel = doc.createElement("label");
    localeLabel.textContent = "Language ";
    var localeSelect = doc.createElement("select");
    localeSelect.id = "locale-select";
    var localeNames = {};
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.names === "function") localeNames = I18n.names();
    } catch (e) { localeNames = {}; }
    var localeCodes = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh"];
    var stubCodes = ["de", "fr", "it", "ja", "ko", "ru", "tr", "zh"];
    var currentLocale = "en";
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.locale === "function") currentLocale = I18n.locale();
    } catch (e) { currentLocale = "en"; }
    localeCodes.forEach(function (code) {
      var opt = doc.createElement("option");
      opt.value = code;
      var name = localeNames[code] || code;
      opt.textContent = (stubCodes.indexOf(code) !== -1) ? name + " — in English" : name;
      if (currentLocale === code) opt.selected = true;
      localeSelect.appendChild(opt);
    });
    localeLabel.appendChild(localeSelect);
    var localeError = doc.createElement("div");
    localeError.id = "locale-error";
    localeError.className = "error";
    localeError.setAttribute("aria-live", "polite");
    return { label: localeLabel, select: localeSelect, error: localeError, currentLocale: currentLocale };
  }

  return {
    buildNetwork: buildNetwork,
    buildTheme: buildTheme,
    buildLocale: buildLocale
  };
})();

if (typeof module !== "undefined") { module.exports = SettingsPrefs; }
