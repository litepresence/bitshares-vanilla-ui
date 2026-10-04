/* SettingsPrefs: preference sections of the #/settings page.
  * Owns: the theme selector
 *   (ref-ui-theme/vanilla-ui-theme/dex-ux-theme), and the locale switcher
 *   stub marking). Builds DOM only — the change-event wiring lives in
 *   settings.js (SettingsPage.render passes `t` in; I18n is read here for
 *   the locale names/current tag only, never written — I18n.setLocale owns
 *   the pref write). There is no reset section: the old UI's reset tab was
 *   never ported, so nothing was moved for it and nothing is added here.
 * Consumes: I18n.names/locale (display only),
 *   document elements callers pass in.
 * Globals/side effects: DOM nodes it returns (appended by the caller under
 *   the router root); global SettingsPrefs only. No storage writes here.
 * Created by: building-vanilla-slices skill, slice-18 audit (settings split).
 *   Bodies moved verbatim from js/settings.js render; closure variables
 *   became params, the theme/locale change handlers stayed in
 *   settings.js (they rerender the page, which only the orchestrator owns).
 */
var SettingsPrefs = (function () {
  "use strict";

  /* Theme selector (ref-ui-theme/vanilla-ui-theme/dex-ux-theme, current
   * selected; option labels are the keyed human names below — values stay
   * the ids. The header copies are deleted (owner call): this settings
   * select is the only switcher, so no cross-copy agreement to maintain.
   * Batch-8 i18n: labels keyed via t() under settings dot theme.
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
    /* Wave-2 complete: all 11 non-en dicts fully translated — no stubs left,
     * no suffixes. Kept as an empty list (not deleted) so a future partial
     * language has a marked place to land. es was partial-by-design and has
     * never been suffixed. */
    var stubCodes = [];
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

  /* Signing section (Tier 2): route display + override + warning + sites.
   * Builds DOM only — radio/revoke wiring lives in settings.js (it owns
   * rerender). Effective mode resolves via SignMode (guarded: missing
   * module reads as in-browser, the safe display direction — never claim
   * protection that isn't there). The allowlist listBox is filled async by
   * settings.js (chrome.storage read); prefs only owns the empty shell +
   * empty note so this builder stays sync like the rest.
   * Params: doc, settings (Store envelope with .signing), t. Returns
   * {wrap, radios, listBox, emptyNote}. */
  function buildSigning(doc, settings, t) {
    var wrap = doc.createElement("div");
    wrap.id = "sign-block";
    var title = doc.createElement("h2");
    title.textContent = t("settings.sign_title", "Signing");
    /* Owner-supplied blue shield beside the heading (same art family as
     * the header badges; decorative — the h2 text stays the name). */
    try {
      if (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function") {
        title.appendChild(doc.createTextNode(" "));
        title.appendChild(Icon.img("shield-blue", "sign-title-icon", ""));
      }
    } catch (e) { /* heading stands without the icon */ }
    wrap.appendChild(title);
    var mode = "browser", cap = "none";
    try {
      if (typeof SignMode !== "undefined" && SignMode) {
        if (typeof SignMode.effectiveMode === "function") mode = SignMode.effectiveMode();
        if (typeof SignMode.capable === "function") cap = SignMode.capable();
      }
    } catch (e) { /* browser display below */ }
    if (mode !== "extension" && mode !== "browser") mode = "browser";
    var status = doc.createElement("p");
    status.className = "muted";
    status.setAttribute("aria-live", "polite");
    /* Single state line (mode + install facts combined — two stacked
     * notices read as a contradiction). Per state, one honest sentence
     * pair at most, reusing existing keys only:
     * extension route implies a channel, so the mode sentence stands
     * alone; browser route appends the install sentence, except the
     * no-extension sentence already covers in-page signing on its own.
     * Provider injection can land after boot, so one delayed re-read
     * settles late arrivals; after that the line stands until the next
     * settings render — display-only, never gates signing. */
    function paintState() {
      var m = "browser", c = "none";
      try {
        if (typeof SignMode !== "undefined" && SignMode) {
          if (typeof SignMode.effectiveMode === "function") m = SignMode.effectiveMode();
          if (typeof SignMode.capable === "function") c = SignMode.capable();
        }
      } catch (e) { /* browser display below */ }
      if (m !== "extension" && m !== "browser") m = "browser";
      var detected = (c === "extension-page" || c === "provider");
      try {
        if (m === "extension" && c === "extension-page") {
          status.textContent = t("settings.sign_mode_ext_page", "Signatures stay in the extension — isolated from websites.");
        } else if (m === "extension") {
          status.textContent = t("settings.sign_mode_ext", "Signatures are approved in the extension window.");
        } else if (detected) {
          status.textContent = t("settings.sign_ext_present", "Extension detected on this device.") + " " +
            t("settings.sign_mode_browser", "Signatures happen in this page's memory.");
        } else {
          status.textContent = t("settings.sign_ext_absent", "No extension detected on this device — signatures happen in this page.");
        }
      } catch (e) { /* prior text stands */ }
    }
    paintState();
    wrap.appendChild(status);
    try {
      setTimeout(function () {
        try { if (status.parentNode) paintState(); } catch (e) { /* line stands */ }
      }, 3000);
    } catch (e) { /* single paint stands */ }
    var pin = "auto";
    try {
      if (settings && (settings.signing === "extension" || settings.signing === "browser" ||
          settings.signing === "auto")) pin = settings.signing;
    } catch (e) { /* auto stands */ }
    var radios = {};
    [["auto", t("settings.sign_auto", "Automatic (extension when available)")],
     ["extension", t("settings.sign_ext", "Always use the extension")],
     ["browser", t("settings.sign_browser", "Always sign in this page")]].forEach(function (pr) {
      var label = doc.createElement("label");
      var radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "signing";
      radio.value = pr[0];
      if (pin === pr[0]) radio.checked = true;
      try { radio.style.minHeight = "44px"; } catch (e) { /* native stands */ }
      label.appendChild(radio);
      label.appendChild(doc.createTextNode(" " + pr[1]));
      wrap.appendChild(label);
      radios[pr[0]] = radio;
    });
    if (mode === "browser") {
      var warn = doc.createElement("p");
      warn.className = "muted";
      warn.textContent = t("settings.sign_warn", "Any script running on this page — including a compromised hosted copy — could read your keys while unlocked. Route signing through the extension, or run a copy you control.");
      wrap.appendChild(warn);
      var guide = doc.createElement("a");
      guide.textContent = t("settings.sign_guide", "How to install the extension");
      try { guide.setAttribute("href", "#/help/extension-install"); } catch (e) { /* label stands */ }
      try { guide.style.minHeight = "44px"; } catch (e) { /* native stands */ }
      wrap.appendChild(guide);
    }
    var sitesTitle = doc.createElement("h2");
    sitesTitle.textContent = t("settings.sign_sites", "Connected sites");
    wrap.appendChild(sitesTitle);
    /* Concrete example (owner request): a fictional dice game shows what a
     * row means. The link is intentionally dead (RFC 2606 .example — it can
     * never resolve); the sentence says so. */
    try {
      var story = doc.createElement("p");
      story.className = "muted";
      story.appendChild(doc.createTextNode(t("settings.sign_sites_story_a", "Example: a dice game at ")));
      var storyLink = doc.createElement("a");
      try { storyLink.setAttribute("href", "https://dice-game.example"); } catch (e) { /* text stands */ }
      storyLink.textContent = "dice-game.example";
      story.appendChild(storyLink);
      story.appendChild(doc.createTextNode(t("settings.sign_sites_story_b", " asks to play as your account — approving lists it here, bound to that account only. Signatures still prompt every time. (That link goes nowhere — it is a fictional example.)")));
      wrap.appendChild(story);
    } catch (e) { /* section stands without the story */ }
    var listBox = doc.createElement("div");
    listBox.className = "sign-sites";
    wrap.appendChild(listBox);
    var emptyNote = doc.createElement("p");
    emptyNote.className = "muted";
    emptyNote.textContent = t("settings.sign_sites_empty", "No sites approved yet — approvals appear here with per-site revoke.");
    wrap.appendChild(emptyNote);
    return { wrap: wrap, radios: radios, listBox: listBox, emptyNote: emptyNote };
  }

  return {
    buildTheme: buildTheme,
    buildLocale: buildLocale,
    buildHistory: buildHistory,
    buildSigning: buildSigning
  };
})();

if (typeof module !== "undefined") { module.exports = SettingsPrefs; }
