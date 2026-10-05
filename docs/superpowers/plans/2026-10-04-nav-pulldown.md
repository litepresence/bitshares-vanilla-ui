# Nav Pulldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the burger's in-flow directory strip with an overlay pulldown holding the primary links plus section links, with the static bar untouched.

**Architecture:** Reuse `buildNavLink`/`headingLink` builders in `app.js`; move `#nav-directory` from in-flow (`flex-basis:100%` inside `#nav`) to `position:fixed` overlay pinned below the header's live rect; add outside-tap close; CSS-only responsive rules.

**Tech Stack:** Vanilla JS/CSS, Node stdlib tests, Python gates.

## Global Constraints

- Zero runtime dependencies in `vanilla/` (`python3 tooling/check_rot.py` green).
- Theme tokens only, no hardcoded colors outside `themes.css`.
- All targets ≥44px; no hover-dependent UI; keyboard: Esc closes, focus returns to toggle.
- Every user-visible string via `t(key, default)` with keys in all 12 locales (`python3 tooling/check_i18n.py` green).
- JSDoc on touched seams; `bash tooling/check_types.sh` green.
- Never edit `reference/`; no TODO/FIXME markers.
- Frequent commits.

---

### Task 1: Pulldown panel (overlay + contents + open/close)

**Files:**
- Modify: `vanilla/js/app.js` (`buildDirectory`, `closeDirectory`, toggle wiring ~lines 186-250, 1196-1212)
- Modify: `vanilla/css/app.css` (`#nav-directory`, `#nav.open` rules ~lines 66-69)
- Test: extend `tooling/app-shell-test.js` (DOM-shape asserts, no browser needed)

**Interfaces:**
- Consumes: `buildNavLink(href, iconOK)`, `MenuUI.SECTIONS`, `Icon.img`, existing `t()` keys (reuse; new divider needs no string — use `role="separator"` without text, or reuse an existing key).
- Produces: `#nav-directory` overlay with 7 primary links + separator + 6 section links + All pages; `closeDirectory(refocus)` unchanged signature.

- [ ] **Step 1: Write the failing test**

Add to `tooling/app-shell-test.js` (follow its existing fake-DOM style):

```js
// pulldown contents: 7 primary + 6 sections + All pages, icons on primary links
var links = panel.querySelectorAll("a");
assert.ok(links.length >= 14, "pulldown holds bar links + sections + all-pages");
assert.ok(panel.querySelector("a[href='#/pools'] img.nav-icon"), "pools link keeps its icon");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/app-shell-test.js`
Expected: FAIL (panel holds 7 links, no section links; strip is in-flow).

- [ ] **Step 3: Implement**

In `buildDirectory`, after the 7 primary links are NOT present — add them: reuse `buildNavLink` for each `ORIGINAL_NAV` href, then a `div` with `role="separator"`, then the existing section heading links + All pages. In `app.css`, replace the in-flow rules:

```css
#nav-directory { display: none; position: fixed; z-index: 9000;
  background: var(--header-bg); color: var(--header-text);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 8px; max-height: 70vh; overflow-y: auto;
  min-width: min(320px, calc(100vw - 32px)); }
#nav.open #nav-directory { display: block; }
```

Position via JS at open (header's live bottom edge — the bar wraps, so no constant): in the toggle handler, `panel.style.top = (header.getBoundingClientRect().bottom + 4) + "px"; panel.style.right = "8px";`. Add document-level pointerdown listener (wired once, guarded) that calls `closeDirectory(false)` when the tap lands outside both panel and toggle. Keep Esc + hashchange wiring.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tooling/app-shell-test.js && python3 tooling/check_rot.py && bash tooling/check_types.sh`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/app.js vanilla/css/app.css tooling/app-shell-test.js
git commit -m "feat(nav): burger pulldown overlay with bar links + sections"
```

---

### Task 2: Small screens + verification

**Files:**
- Modify: `vanilla/css/app.css` (responsive rules near line 178-179)
- Test: manual/heading asserts + existing suites

**Interfaces:**
- Consumes: Task 1 panel.
- Produces: scroll-row bar + sheet pulldown under 720px.

- [ ] **Step 1: Write the failing check**

```js
// app-shell-test.js: CSS contains the phone rules
assert.ok(css.includes("overflow-x: auto"), "bar scrolls instead of wrapping");
```

Read `vanilla/css/app.css` text in the test (follow `button-test.js` CSS-shape precedent).

- [ ] **Step 2: Run to verify it fails**

Run: `node tooling/app-shell-test.js`
Expected: FAIL (no such rule).

- [ ] **Step 3: Implement**

```css
@media (max-width: 719px) {
  #nav { flex-wrap: nowrap; overflow-x: auto; }
  #nav.open #nav-directory { left: 8px; right: 8px; min-width: 0; }
}
```

Verify the pre-existing `#nav { display:none; flex-direction:column }` rule at old line 179 (phone collapse) is reconciled — the scroll-row replaces the hide; delete the hide if it conflicts, keeping keyboard/focus behavior.

- [ ] **Step 4: Run everything**

Run: `node tooling/app-shell-test.js && node tooling/menu-test.js && python3 tooling/check_rot.py && bash tooling/check_types.sh && python3 tooling/check_i18n.py`
Expected: all green. Human browser pass (390px + 1440px × 3 themes, Esc/outside-tap/focus-return, content-offset-doesn't-move) stays with the tester.

- [ ] **Step 5: Commit**

```bash
git add vanilla/css/app.css tooling/app-shell-test.js
git commit -m "feat(nav): phone scroll-row bar + sheet pulldown"
```

---

### Task 3: Owner rework (no duplication, vertical stack, labs out, split Labs/Personal)

**Files:**
- Modify: `vanilla/js/app.js` (`ORIGINAL_NAV` → 5 hrefs, `NAV_ICONS` drop labs entries, `buildDirectory` remove 7 primaries + separator), `vanilla/index.html` (static bar 7→5 links), `vanilla/css/app.css` (pulldown links vertical: column layout on `#nav-directory`), `vanilla/js/views/menu-ui.js` (split labs→labs+personal), `vanilla/js/views/help-ui.js` (mirror split in GROUPS), `vanilla/locales/*.json` (keys below), `tooling/menu-test.js` (6→7), `tooling/app-shell-test.js` (pulldown asserts: sections-only, vertical)
- Test: `node tooling/menu-test.js`, `node tooling/app-shell-test.js`, `node tooling/help-test.js`

**Interfaces:**
- Consumes: existing `headingLink`, `MenuUI.SECTIONS`, existing keys.
- Produces: pulldown = 7 section links + All pages, stacked vertically; bar = 5 links; `#/menu/labs` (api-lab, es-lab, txbuilder) + `#/menu/personal` (trollbox, favourites, alerts, help, about, community, settings).

- [ ] **Step 1: Update SECTIONS + groups + keys**

Split the labs entry: `{ slug: "labs", icon: "cogs", titleKey: "menu.section_labs" ("Labs"), blurbKey: "menu.blurb_labs" ("Power tools for chain and node work."), links: [api-lab, es-lab, txbuilder] }` + `{ slug: "personal", icon: "user", titleKey: "menu.section_personal" ("Personal"), blurbKey: "menu.blurb_personal" ("Chat, alerts, and your setup."), links: [trollbox, favourites, alerts, help, about, community, settings] }` (move link objects byte-identically). Update the counts comment (14+9+7+4+9+3+7=53). Mirror in help-ui GROUPS: split the labs group into Labs (`txbuilder, api-lab, es-lab, browser`) + Personal (rest). Keys (`menu.section_labs` default→"Labs", `menu.blurb_labs` new default, new `menu.section_personal`/`menu.blurb_personal`) via one-shot script + `check_i18n.py`.

- [ ] **Step 2: Strip duplication + vertical stack**

`ORIGINAL_NAV` → 5 hrefs; drop the 2 labs `NAV_ICONS` entries; `buildDirectory` emits section links + All only; `index.html` bar drops the 2 lab anchors; pulldown CSS stacks items vertically (single column — verify `#nav-directory a` computes to one-per-row at 390px and 1440px).

- [ ] **Step 3: Verify + commit**

Run: `node tooling/menu-test.js && node tooling/app-shell-test.js && node tooling/help-test.js && python3 tooling/check_i18n.py && bash tooling/check_types.sh && python3 tooling/check_rot.py`
Expected: all green (menu-test updated 6→7 sections).

```bash
git add vanilla/js/app.js vanilla/index.html vanilla/css/app.css vanilla/js/views/menu-ui.js vanilla/js/views/help-ui.js vanilla/locales/*.json tooling/menu-test.js tooling/app-shell-test.js tooling/add_menu_split_i18n.py
git commit -m "feat(nav): sections-only vertical pulldown, labs out of menus, split Labs/Personal"
```
