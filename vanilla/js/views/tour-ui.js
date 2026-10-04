/* TourUI: first-run guided tour (5-step coach marks for new users).
 * Owns: tour overlay DOM (#tour-card + #tour-style, body-level only),
 *   step state, dismissal flag, dashboard "Take tour" replay button.
 *   Callers into others (read-only, never behavior-changing): Store.backend
 *   (dismissal flag seam — view-state, non-secret), Router view DOM (#view
 *   targets via querySelector only), MarketUI.homeTarget (CTA market id,
 *   guarded), I18n.t (strings with verbatim en defaults). No chain calls,
 *   no signing, no keystore touch. Side effects: body-level overlay div +
 *   injected <style>, one class on the highlighted target, hashchange/
 *   keydown/resize/passive-scroll listeners + a #view MutationObserver (all
 *   removed on end) plus one session-long body observer (+ a hashchange hook for
 *   dismissed profiles) that keeps the dashboard replay button injected
 *   across async fills and hash-only navigations — both idempotent and both
 *   also removed on end (handles kept for teardown, by design). Missing targets render centered with their
 *   CTA (issue #1: never skip — no single route holds every target), never throw.
 * Created by: marketing directive, first-run guided tour task. */
var TourUI = (function () {
  "use strict";

  /* Dismissal flag (view-state, non-secret — same class as favs/last-market:
   * direct localStorage by design per store.js; the Store.backend seam is
   * used when trivially available so extension wrappers stay coherent). */
  var FLAG_KEY = "bts-vanilla-tour-dismissed-v1";

  var active = false;
  var stepIdx = 0;
  var card = null;
  var highlighted = null;
  var styleEl = null;
  var viewObs = null;
  var placeTimer = null;
  var bootTimer = null;
  var bootObs = null;
  /* Session replay upkeep handles (dismissed-profile injector): the body
   * observer + hashchange hook created in boot(). Stored (not anonymous)
   * so end() can disconnect/remove them — start() listeners already clean. */
  var upkeepObs = null;
  var onReplayHash = null;
  /* Scroll-once tracker: smooth-scrollIntoView hijacks the user's own
   * scrolling when it re-fires, so it must run exactly once per real
   * step/target change — never on observer re-renders of the same card.
   * Reset on end() so replays scroll fresh (stale node refs never linger). */
  var scrollIdx = -1;
  var scrollTgt = null;

  /* Display strings via I18n.t with the pre-conversion literal kept verbatim
   * as enDefault (English-identical offline). Falls back to the default when
   * i18n.js failed to load: never blank, never throws. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof vars === "object") {
      return String(dflt).replace(/%\(([^)]+)\)s/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
      });
    }
    return dflt;
  }

  /* Flag read: Store.backend seam first, direct localStorage fallback.
   * Params: none. Returns true when the tour was dismissed/completed. */
  function dismissed() {
    try {
      if (typeof Store !== "undefined" && Store && Store.backend &&
          typeof Store.backend.get === "function") {
        if (Store.backend.get(FLAG_KEY) === "1") return true;
      }
    } catch (e) { /* fallback below */ }
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(FLAG_KEY) === "1") return true;
    } catch (e) { /* unreadable storage reads as not-dismissed */ }
    return false;
  }

  /* Flag write: persists dismissal so reloads never re-tour. Never throws. */
  function setDismissed() {
    var done = false;
    try {
      if (typeof Store !== "undefined" && Store && Store.backend &&
          typeof Store.backend.set === "function") {
        Store.backend.set(FLAG_KEY, "1");
        done = true;
      }
    } catch (e) { /* fallback below */ }
    if (!done) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(FLAG_KEY, "1");
      } catch (e) { /* session-only tour */ }
    }
  }

  /* Default desk target for the step-2 CTA (branding.js network default via
   * MarketUI.homeTarget when loaded, else the mainnet BTS_CNY). Never throws. */
  function defaultMarketId() {
    try {
      if (typeof MarketUI !== "undefined" && MarketUI &&
          typeof MarketUI.homeTarget === "function") return MarketUI.homeTarget();
    } catch (e) { /* fallback below */ }
    return "BTS_CNY";
  }

  /* Step table: target = dashboard/desk selectors (first live match wins).
   * Every step is centerOk: a missing target renders a centered card with
   * its CTA/links (issue #1 — the old skip-forward loop jumped Next/dots
   * to the finale because no single route holds .mkt-strip + .mkt-charts +
   * .mkt-buy together, and boot can fire before the strip paints). Dots
   * and Next always land on the requested step; the hashchange + #view
   * observers upgrade the centered card to a highlight once its target
   * materializes or the user follows the CTA. */
  function steps() {
    var deskHash = "#/market/" + defaultMarketId();
    return [
      { targets: [".dashboard-gate", "#view .wrap"], centerOk: true,
        title: ["tour.s1_title", "Welcome to BitShares Vanilla"],
        body: ["tour.s1_body", "A plain HTML, JavaScript, and CSS wallet for the BitShares chain. Look around and play: every page reads public chain data with no login. Your password is asked only when you sign."] },
      { targets: [".mkt-strip"], centerOk: true,
        cta: { label: ["tour.s2_cta", "Open the Exchange"], hash: deskHash },
        title: ["tour.s2_title", "Pick a market"],
        body: ["tour.s2_body", "This strip lists starred and featured markets with live prices. Choose any chip to open that trading desk."] },
      { targets: [".mkt-charts"], centerOk: true,
        cta: { label: ["tour.s2_cta", "Open the Exchange"], hash: deskHash },
        title: ["tour.s3_title", "Desk plots"],
        body: ["tour.s3_body", "Price candles, volume, and depth plus the indicators menu: overlays like SMA and EMA, oscillators like RSI, MACD, and Stochastic."] },
      { targets: [".mkt-buy"], centerOk: true,
        cta: { label: ["tour.s2_cta", "Open the Exchange"], hash: deskHash },
        title: ["tour.s4_title", "Practice quoting"],
        body: ["tour.s4_body", "The Buy and Sell panels accept any numbers for practice. Nothing leaves your machine until you review and sign with an unlocked wallet."] },
      { targets: [], centerOk: true,
        links: [
          ["#/pools", "pools.title", "Liquidity Pools"],
          ["#/explorer", "nav.explorer", "Explore"],
          ["#/help", "help.help", "Help"]
        ],
        title: ["tour.s5_title", "Keep exploring"],
        body: ["tour.s5_body", "Liquidity pools, the chain explorer, voting, and help are one click away. Everything stays viewable while locked: unlock only to sign."] }
    ];
  }

  /* Pure scroll gate: true only on a real step/target change. Params: i +
   * target (now) vs lastI + lastT (last scrolled). No side effects — the
   * caller records the new key after scrolling. Unit-tested. */
  function scrollChanged(i, target, lastI, lastT) {
    return i !== lastI || target !== lastT;
  }

  /* Pure re-render gate for observer refires: rebuild the card only when
   * the current step's target situation actually changed. Params: step
   * (current step def), found (live target or null), shown (highlighted
   * node or null), hasCard (a card is already showing). A newly
   * materialized target re-renders (highlight upgrades); a vanished target
   * re-renders too (highlight drops to a centered card — issue #1: staying
   * on the stale node strands the card after route changes); a centered
   * card with no target change skips, so no rebuild and no scroll hijack.
   * Unit-tested with sentinel objects. */
  function needsRerender(step, found, shown, hasCard) {
    if (found) return found !== shown;
    if (shown) return true;
    if (step && step.centerOk) return !hasCard;
    return true;
  }

  /* Pure step-index resolver: every dot/Next/Back lands on exactly the
   * requested step (issue #1 — no skip-forward). Params: i (requested),
   * total (step count). Returns the clamped index, or total meaning
   * past-the-end (caller finishes). Unit-tested. */
  function resolveIndex(i, total) {
    if (typeof total !== "number" || !(total > 0)) return 0;
    if (typeof i !== "number" || isNaN(i)) return 0;
    if (i < 0) return 0;
    if (i >= total) return total;
    return Math.floor(i);
  }

  /* First live target for a step, or null. Never throws. */
  function findTarget(step) {
    if (typeof document === "undefined" || !step || !step.targets) return null;
    for (var i = 0; i < step.targets.length; i++) {
      try {
        var el = document.querySelector(step.targets[i]);
        if (el) return el;
      } catch (e) { /* bad selector: try the next */ }
    }
    return null;
  }

  /* Reduced-motion probe (matchMedia guarded for old browsers). */
  function reducedMotion() {
    try {
      if (typeof window !== "undefined" && window.matchMedia) {
        return !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
    } catch (e) { /* assume full motion */ }
    return false;
  }

  /* Injects the tour stylesheet once (theme tokens with neutral fallbacks;
   * phones get a full-width bottom sheet; reduced-motion kills motion). */
  function ensureStyle() {
    if (typeof document === "undefined" || styleEl || document.getElementById("tour-style")) return;
    try {
      var s = document.createElement("style");
      s.id = "tour-style";
      s.textContent =
        ".tour-target{outline:3px solid var(--accent,#1ec3fa)!important;outline-offset:3px;border-radius:6px;}" +
        "#tour-card{position:fixed;z-index:9999;width:min(360px,calc(100vw - 32px));background:var(--panel,#ffffff);color:var(--text,#111111);" +
        "border:1px solid var(--border,rgba(128,128,128,0.45));border-radius:10px;padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,0.35);}" +
        "#tour-card h2{margin:0 0 6px;font-size:1.05rem;}" +
        "#tour-card p{margin:0 0 10px;}" +
        "#tour-card .tour-eyebrow{font-size:0.8rem;opacity:0.75;margin:0 0 4px;}" +
        "#tour-card .tour-away{font-size:0.85rem;font-style:italic;opacity:0.85;margin:0 0 8px;}" +
        "#tour-card .tour-links{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px;}" +
        "#tour-card .tour-cta{display:inline-block;margin:0 0 10px;min-height:44px;line-height:44px;}" +
        "#tour-card .tour-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}" +
        "#tour-card .tour-row > button{min-height:44px;min-width:44px;}" +
        "#tour-card .tour-dots{display:flex;gap:6px;margin-left:auto;}" +
        "#tour-card .tour-dot{width:12px;height:12px;border-radius:50%;border:1px solid currentColor;background:transparent;padding:0;min-height:12px;min-width:12px;}" +
        "#tour-card .tour-dot[aria-current=\"step\"]{background:var(--accent,#1ec3fa);border-color:var(--accent,#1ec3fa);}" +
        "@media (max-width:600px){#tour-card{left:8px!important;right:8px;top:auto!important;bottom:8px;width:auto;max-height:60vh;overflow:auto;}}" +
        "@media (prefers-reduced-motion:reduce){#tour-card{transition:none!important;}.tour-target{transition:none!important;}}";
      (document.head || document.documentElement).appendChild(s);
      styleEl = s;
    } catch (e) { /* card renders unstyled rather than not at all */ }
  }

  /* Clears the previous highlight. Never throws. */
  function clearHighlight() {
    try {
      if (highlighted && highlighted.classList) highlighted.classList.remove("tour-target");
    } catch (e) { /* highlight keeps prior state */ }
    highlighted = null;
  }

  /* Positions the card near the target (below when room, else above, else
   * bottom-anchored); null target renders centered. Never throws. */
  function placeCard(target) {
    if (!card || typeof window === "undefined") return;
    try {
      var vw = window.innerWidth || 800;
      var vh = window.innerHeight || 600;
      if (!target || typeof target.getBoundingClientRect !== "function") {
        card.style.left = Math.max(8, Math.floor((vw - 360) / 2)) + "px";
        card.style.top = Math.max(8, Math.floor(vh / 4)) + "px";
        return;
      }
      var r = target.getBoundingClientRect();
      var w = Math.min(360, vw - 32);
      var left = Math.max(8, Math.min(Math.floor(r.left), vw - w - 8));
      var below = Math.floor(r.bottom) + 12;
      var top = (below + 220 < vh) ? below : Math.max(8, Math.floor(r.top) - 232);
      card.style.left = left + "px";
      card.style.top = top + "px";
    } catch (e) { /* card keeps prior position */ }
  }

  /* Builds the tooltip card for step i (dots + Back/Next/Skip + step links).
   * Params: i (index into steps()). Returns nothing. Never throws. */
  function renderCard(i, list, target) {
    if (typeof document === "undefined") return;
    ensureStyle();
    try { if (card && card.parentNode) card.parentNode.removeChild(card); } catch (e) { /* rebuild below */ }
    clearHighlight();
    var step = list[i];
    var total = list.length;
    var doc = document;
    var box = doc.createElement("div");
    box.id = "tour-card";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", t(step.title[0], step.title[1]));
    var eye = doc.createElement("p");
    eye.className = "tour-eyebrow";
    eye.textContent = t("tour.step_of", "Step %(current)s of %(total)s", { current: String(i + 1), total: String(total) });
    box.appendChild(eye);
    var h = doc.createElement("h2");
    h.textContent = t(step.title[0], step.title[1]);
    box.appendChild(h);
    var body = doc.createElement("p");
    body.textContent = t(step.body[0], step.body[1]);
    box.appendChild(body);
    /* Honest fallback framing: a centered card with no live target is a
     * preview of another page, not a pointer — say where the target lives
     * (tester report: desk steps "pop up in the middle pointing at
     * nothing"). The CTA below it navigates there; observers upgrade to
     * a highlight on arrival. */
    if (!target && step.cta) {
      var away = doc.createElement("p");
      away.className = "tour-away";
      away.textContent = t("tour.away_note", "On the Exchange desk — open it to see this highlighted.");
      box.appendChild(away);
    }
    if (step.cta) {
      var cta = touchable(doc.createElement("a"));
      cta.className = "tour-cta";
      cta.setAttribute("href", step.cta.hash);
      cta.textContent = t(step.cta.label[0], step.cta.label[1]);
      box.appendChild(cta);
    }
    if (step.links) {
      var row0 = doc.createElement("div");
      row0.className = "tour-links";
      step.links.forEach(function (triple) {
        var a = touchable(doc.createElement("a"));
        a.setAttribute("href", triple[0]);
        a.textContent = t(triple[1], triple[2]);
        a.classList.add("subtle-btn");
        row0.appendChild(a);
      });
      box.appendChild(row0);
    }
    var row = doc.createElement("div");
    row.className = "tour-row";
    var last = (i === total - 1);
    if (i > 0) {
      var back = touchable(doc.createElement("button"));
      back.type = "button";
      back.textContent = t("tour.back", "Back");
      back.classList.add("subtle-btn");
      back.addEventListener("click", function () { showStep(i - 1); });
      row.appendChild(back);
    }
    var next = touchable(doc.createElement("button"));
    next.type = "button";
    next.id = "tour-next";
    next.textContent = last ? t("tour.done", "Done") : t("tour.next", "Next");
    next.classList.add("subtle-btn");
    next.addEventListener("click", function () { showStep(i + 1); });
    row.appendChild(next);
    var skip = touchable(doc.createElement("button"));
    skip.type = "button";
    skip.id = "tour-skip";
    skip.textContent = t("tour.skip", "Skip");
    skip.classList.add("subtle-btn");
    skip.addEventListener("click", function () { end(); });
    row.appendChild(skip);
    var dots = doc.createElement("div");
    dots.className = "tour-dots";
    dots.setAttribute("role", "group");
    for (var d = 0; d < total; d++) {
      (function (n) {
        var dot = touchable(doc.createElement("button"));
        dot.type = "button";
        dot.className = "tour-dot subtle-btn";
        dot.setAttribute("aria-label", t("tour.step_of", "Step %(current)s of %(total)s", { current: String(n + 1), total: String(total) }));
        if (n === i) dot.setAttribute("aria-current", "step");
        dot.addEventListener("click", function () { showStep(n); });
        dots.appendChild(dot);
      })(d);
    }
    row.appendChild(dots);
    box.appendChild(row);
    doc.body.appendChild(box);
    card = box;
    if (target) {
      try {
        target.classList.add("tour-target");
        highlighted = target;
      } catch (e) { highlighted = null; }
      /* Scroll-once: smooth scrolling hijacks the user's own scrolling when
       * it re-fires, so it runs only on a real step/target change — never
       * on observer re-renders of the same card (the jerky-scroll fix). */
      try {
        if (scrollChanged(i, target, scrollIdx, scrollTgt)) {
          scrollIdx = i;
          scrollTgt = target;
          if (reducedMotion()) target.scrollIntoView({ block: "center" });
          else if (typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "center" });
          else target.scrollIntoView();
        }
      } catch (e) { /* card still shows */ }
    }
    placeCard(target);
    try {
      var focusBtn = /** @type {any} */ (box.querySelector("#tour-next"));
      if (focusBtn && typeof focusBtn.focus === "function") focusBtn.focus({ preventScroll: true });
    } catch (e) { /* focus stays */ }
  }

  /* Shows step i (dots/Next/Back land exactly — issue #1: never skips).
   * A missing target renders centered with its CTA/links; the hashchange
   * + #view observers upgrade it to a highlight once the target appears.
   * Past-the-end finishes (persisted). Never throws. */
  function showStep(i) {
    if (!active || typeof document === "undefined") return;
    var list = steps();
    var n = resolveIndex(i, list.length);
    if (n >= list.length) { end(); return; }
    stepIdx = n;
    renderCard(n, list, findTarget(list[n]));
  }

  /* Removes overlay, highlight, and listeners; persists dismissal.
   * Then re-offers the tour: the dashboard replay button is injected now
   * (hosts are usually present — the user is looking at one) plus two
   * delayed retries for a dashboard that repaints async after the skip.
   * Same-session hash-only navigation never re-boots, so waiting for the
   * next full load would strand the replay. Never throws. */
  function end() {
    setDismissed();
    active = false;
    scrollIdx = -1;
    scrollTgt = null;
    clearHighlight();
    try { if (card && card.parentNode) card.parentNode.removeChild(card); } catch (e) { /* gone */ }
    card = null;
    try {
      if (typeof document !== "undefined") document.removeEventListener("keydown", onKey);
      if (typeof window !== "undefined") {
        window.removeEventListener("hashchange", onHash);
        window.removeEventListener("resize", onMove);
        window.removeEventListener("scroll", onMove);
        /* Session replay upkeep (boot): disconnect the body observer and
         * drop the named hashchange hook so end() leaks nothing. */
        if (onReplayHash) {
          try { window.removeEventListener("hashchange", onReplayHash); } catch (e2) { /* hook best-effort */ }
          onReplayHash = null;
        }
      }
      if (viewObs) { viewObs.disconnect(); viewObs = null; }
      if (upkeepObs) { try { upkeepObs.disconnect(); } catch (e3) { /* gone */ } upkeepObs = null; }
    } catch (e) { /* listeners best-effort */ }
    if (placeTimer) { try { clearTimeout(placeTimer); } catch (e) { /* done */ } placeTimer = null; }
    stopBootWait();
    clearReplayTimers();
    try { ensureReplay(); } catch (e) { /* retry below */ }
    try {
      replayTimers.push(setTimeout(function () { try { ensureReplay(); } catch (e) { /* dashboard stands */ } }, 1500));
      replayTimers.push(setTimeout(function () { try { ensureReplay(); } catch (e) { /* dashboard stands */ } }, 4000));
    } catch (e) { /* immediate attempt stands */ }
  }

  /* ESC skips the tour (dismisses + persists). Never throws. */
  function onKey(ev) {
    try {
      if ((ev && ev.key === "Escape") || (ev && ev.keyCode === 27)) end();
    } catch (e) { /* tour keeps state */ }
  }

  /* Route change while touring: re-resolve the current step after the router
   * repaints (centered card upgrades to a highlight when its target
   * appears). Never throws. */
  function onHash() {
    if (!active) return;
    try {
      setTimeout(function () { if (active) showStep(stepIdx); }, 400);
    } catch (e) { /* current card stands */ }
  }

  /* Scroll/resize/hash re-anchors the card (debounced, position-only — no
   * rebuild, no scroll hijack). Scroll binds passive where supported so it
   * never blocks the user's own scrolling. Never throws. */
  function onMove() {
    if (!active || !card) return;
    if (placeTimer) { try { clearTimeout(placeTimer); } catch (e) { /* reset below */ } }
    try {
      placeTimer = setTimeout(function () {
        placeTimer = null;
        if (!active || !card) return;
        try { placeCard(highlighted); } catch (e) { /* position stands */ }
      }, 120);
    } catch (e) { /* position stands */ }
  }

  /* Watches #view while touring: async fills (dashboard lazy-load, desk
   * sections) can materialize the current step's target after the card
   * painted — re-resolve debounced so the highlight upgrades. Never throws. */
  function watchView() {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    try {
      if (viewObs) viewObs.disconnect();
      var view = document.getElementById("view");
      if (!view) return;
      var pending = false;
      viewObs = new MutationObserver(function () {
        if (pending || !active) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          if (!active) return;
          /* Re-render gate: routine async fills must NOT rebuild the card
           * (each rebuild re-placed + re-scrolled = jerky scroll). Only
           * re-resolve when the current step's target situation changed:
           * newly materialized, or vanished from a target-required step. */
          try {
            var list = steps();
            var cur = (stepIdx >= 0 && stepIdx < list.length) ? list[stepIdx] : null;
            if (needsRerender(cur, findTarget(cur), highlighted, !!card)) showStep(stepIdx);
          } catch (e) { /* card stands */ }
        }, 300);
      });
      viewObs.observe(view, { childList: true, subtree: true });
    } catch (e) { /* static card stands */ }
  }

  /* Dashboard replay button ("Take tour"): appended into the gate action row
   * when locked, else into the markets-strip section. Idempotent (one button
   * per render, keyed by id). Never throws, never duplicates. */
  function ensureReplay() {
    if (typeof document === "undefined") return;
    try {
      var hash = (typeof location !== "undefined" && location.hash) || "#/";
      if (hash && hash !== "#/" && hash !== "#") return;
      if (document.getElementById("tour-replay")) return;
      var host = document.querySelector(".dashboard-gate-row");
      var btn = touchable(document.createElement("button"));
      btn.type = "button";
      btn.id = "tour-replay";
      btn.className = "btn btn-ghost";
      btn.textContent = t("tour.take_tour", "Take tour");
      btn.addEventListener("click", function () { start(true); });
      if (host) {
        host.appendChild(btn);
        return;
      }
      var strip = document.querySelector(".mkt-strip");
      if (strip) {
        var p = document.createElement("p");
        p.className = "tour-replay-row";
        p.appendChild(btn);
        strip.appendChild(p);
      }
    } catch (e) { /* dashboard stands without replay */ }
  }

  /* Starts the tour (force=true replays even when dismissed). Safe to call
   * repeatedly — a running tour restarts at step 1. Never throws. */
  function start(force) {
    if (typeof document === "undefined") return;
    if (!force && dismissed()) return;
    try {
      stopBootWait();
      clearReplayTimers();
      if (active) end();
      active = true;
      stepIdx = 0;
      document.addEventListener("keydown", onKey);
      if (typeof window !== "undefined") {
        window.addEventListener("hashchange", onHash);
        window.addEventListener("resize", onMove);
        /* Passive scroll re-anchor: keeps the fixed card glued to its
         * target while the user scrolls (onMove only re-places, debounced).
         * Options-object throws on old browsers — fall back to bare bind. */
        try {
          window.addEventListener("scroll", onMove, { passive: true });
        } catch (e) {
          try { window.addEventListener("scroll", onMove); } catch (f) { /* no re-anchor */ }
        }
      }
      watchView();
      showStep(0);
      ensureReplay();
    } catch (e) {
      try { end(); } catch (f) { /* overlay best-effort */ }
    }
  }

  /* Stops the pre-boot wait (observer + timer). Never throws. */
  function stopBootWait() {
    try { if (bootObs) { bootObs.disconnect(); bootObs = null; } } catch (e) { /* gone */ }
    try { if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; } } catch (e) { /* done */ }
  }

  /* Dashboard-replay retries scheduled by end() (1.5s/4s second chances for
   * an async dashboard repaint). Tracked — never anonymous — so start/end
   * transitions clear stale ones instead of stacking overlapping replays.
   * Single-boot-timer discipline: at most one pending pair per exit, all
   * cleared on tour exit (end) and on replay start. Never throws. */
  var replayTimers = [];
  function clearReplayTimers() {
    try {
      for (var i = 0; i < replayTimers.length; i++) {
        try { clearTimeout(replayTimers[i]); } catch (e) { /* done */ }
      }
    } catch (e) { /* list stands cleared below */ }
    replayTimers = [];
  }

  /* Boot: dismissed profiles only get the replay injector; fresh profiles
   * wait for the first #view paint (App.boot renders async via I18n) then
   * auto-start. A 6s backstop starts centered rather than never.
   * The replay upkeep observer is created BEFORE the ready() early-return:
   * the connecting shell already contains #view .wrap, so ready() is often
   * true at kick while the gate/strip hosts arrive seconds later on chain
   * connect — returning early used to skip the observer and strand dismissed
   * sessions with no replay button until a full reload. */
  function boot() {
    if (typeof document === "undefined") return;
    var kick = function () {
      try {
        /* replayUpkeep: session-long dashboard replay injector (idempotent —
         * ensureReplay exits fast once the button exists). Watches body so
         * async fills and hash-only SPA navigations (which never re-boot)
         * still get the button. Never throws. The observer handle is kept
         * in upkeepObs so end() can disconnect it (no longer fire-and-forget). */
        var replayUpkeep = function () {
          try {
            if (typeof MutationObserver === "undefined") return;
            try { if (upkeepObs) upkeepObs.disconnect(); } catch (e0) { /* re-observe below */ }
            upkeepObs = new MutationObserver(function () {
              try { ensureReplay(); } catch (e) { /* retry next mutation */ }
            });
            upkeepObs.observe(document.body, { childList: true, subtree: true });
          } catch (e) { /* immediate attempt below stands */ }
          try { ensureReplay(); } catch (e) { /* retry on mutation */ }
        };
        if (dismissed()) {
          replayUpkeep();
          try {
            if (typeof window !== "undefined") {
              /* Named (not anonymous) so end() can remove it. */
              onReplayHash = function () {
                try { setTimeout(ensureReplay, 600); } catch (e) { /* retry on mutation */ }
              };
              window.addEventListener("hashchange", onReplayHash);
            }
          } catch (e) { /* observer stands */ }
          return;
        }
        replayUpkeep();
        var started = false;
        var go = function () {
          if (started) return;
          started = true;
          stopBootWait();
          start(false);
        };
        var view = document.getElementById("view");
        var ready = function () {
          return !!document.querySelector(".dashboard-gate, .mkt-strip, #view .wrap");
        };
        if (ready()) { go(); return; }
        if (typeof MutationObserver !== "undefined" && view) {
          bootObs = new MutationObserver(function () {
            try { if (ready()) go(); } catch (e) { /* keep waiting */ }
          });
          bootObs.observe(view, { childList: true, subtree: true });
        }
        bootTimer = setTimeout(go, 6000);
        /* Replay upkeep already runs (created above before ready()); the
         * boot wait below only gates the auto-start. */
      } catch (e) { /* no tour; app stands */ }
    };
    try {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kick);
      else kick();
    } catch (e) { /* no tour */ }
  }

  if (typeof document !== "undefined") boot();

  return { start: start, dismissed: dismissed, _test: { scrollChanged: scrollChanged, needsRerender: needsRerender, resolveIndex: resolveIndex } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.TourUI === "undefined") { globalThis.TourUI = TourUI; }
if (typeof module !== "undefined") { module.exports = TourUI; }
