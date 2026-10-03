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
   * Batch-8 i18n: labels keyed via t() under settings dot theme, header
   * copy in app.js stays plain until its own batch owns it).
   * The change handler (settings.js) persists + flips data-theme on <html>.
   * Params: doc, settings, t. Returns: {label, select}. */
  function buildTheme(doc, settings, t) {
    var themeLabel = doc.createElement("label");
    themeLabel.textContent = t("settings.theme_label", "Theme ");
    var themeSelect = doc.createElement("select");
    themeSelect.id = "theme-select";
    var themeNames = {
      "ref-ui-theme": t("settings.theme_classic", "Classic"),
      "vanilla-ui-theme": t("settings.theme_vanilla_light", "Vanilla light"),
      "dex-ux-theme": t("settings.theme_dex_dark", "DEX dark")
    };
    ["ref-ui-theme", "vanilla-ui-theme", "dex-ux-theme"].forEach(function (id) {
      var opt = doc.createElement("option");
      opt.value = id;
      opt.textContent = themeNames[id] || id;
      if (settings.theme === id) opt.selected = true;
      themeSelect.appendChild(opt);
    });
    themeLabel.appendChild(themeSelect);
    return { label: themeLabel, select: themeSelect };
  }

  /* Locale switcher (slice-17 Task 2): mirrors the theme selector shape
   * (Reference #8). Option labels are the Reference-#7 display names;
   * stub locales (10) are suffixed " — in English" (honest marking) and
   * render English via the t() fallback chain. The visible "Language "
   * label is keyed via t("settings.language_label") so all 12 dicts carry
   * it; the failure line in the settings.js handler is likewise keyed
   * (settings.locale_unavailable) — shown only when the dict fetch fails.
   * Params: doc, t (passed in from settings.js, same shape as the other
   *   builders). Returns: {label, select, error, currentLocale} where
   *   currentLocale is the I18n tag the select reflects ("en" fallback). */
  function buildLocale(doc, t) {
    var localeLabel = doc.createElement("label");
    localeLabel.textContent = t("settings.language_label", "Language ");
    var localeSelect = doc.createElement("select");
    localeSelect.id = "locale-select";
    var localeNames = {};
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.names === "function") localeNames = I18n.names();
    } catch (e) { localeNames = {}; }
    var localeCodes = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"];
    var stubCodes = ["de", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"];
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

  /* Community-history (ElasticSearch) switch + third-party disclaimer
   * (Phase 3). DOM owned here; the change handler lives in settings.js
   * (persists esEnabled — views read it live, no reconnect needed).
   * Params: doc, settings (for the checked seed), t. Returns
   *   {wrap, checkbox}. Never throws. */
  function buildHistory(doc, settings, t) {
    var wrap = doc.createElement("div");
    wrap.id = "es-block";
    var title = doc.createElement("h2");
    title.textContent = t("settings.es_title", "Community history index");
    wrap.appendChild(title);
    var label = doc.createElement("label");
    var box = doc.createElement("input");
    box.type = "checkbox";
    box.id = "es-toggle";
    try { box.checked = !(settings && settings.esEnabled === false); }
    catch (e) { box.checked = true; }
    try { box.style.minHeight = "44px"; } catch (e) { /* label taps anyway */ }
    label.appendChild(box);
    label.appendChild(doc.createTextNode(" " + t("settings.es_toggle", "Enable community history (ElasticSearch)")));
    wrap.appendChild(label);
    var note = doc.createElement("p");
    note.className = "muted";
    note.textContent = t("settings.es_note", "Run by the community, not by this wallet — questions: t.me/bitsharesDEV. Turn off to use chain history only.");
    wrap.appendChild(note);
    return { wrap: wrap, checkbox: box };
  }

  return {
    buildNetwork: buildNetwork,
    buildTheme: buildTheme,
    buildLocale: buildLocale,
    buildHistory: buildHistory
  };
})();

if (typeof module !== "undefined") { module.exports = SettingsPrefs; }
