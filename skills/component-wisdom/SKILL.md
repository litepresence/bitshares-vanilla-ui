---
name: component-wisdom
description: Use when choosing UI components for vanilla views, replacing ad-hoc widgets with established patterns, or auditing component usage across vanilla/js/views for consistency and usability
---

# Component Wisdom

## Overview

Distilled chooser wisdom from the 20 benchmark design systems catalogued at
uiguideline.com/systems, mapped onto our zero-dependency vanilla stack.
Teaches WHEN to use which component — not just what exists.

## When to Use

- Building or revising any `vanilla/js/views/*-ui.js` screen with forms, tables, overlays, or navigation
- Replacing a hand-rolled widget with the wiser established pattern
- Running a component audit across the app (see Audit Workflow)

When NOT to use: chain-call questions (that is `mapping-chain-calls`);
principle-compliance sign-off (that is `auditing-vanilla-slices`).

## Source catalog (provenance — read before citing)

Benchmark systems (uiguideline.com/systems, fetched 2026-10-07):
Material Design (Google) · Atlassian · Polaris (Shopify) · Ant Design ·
Fluent 2 (Microsoft) · Primer (GitHub) · Garden (Zendesk) · Spectrum (Adobe) ·
Chakra UI · Carbon (IBM) · Base (Uber) · Elastic UI · Pajamas (GitLab) ·
Vuetify · Mantine · Material UI (MUI) · Radix · Blueprint (Palantir) ·
Angular Material · Pluralsight.

Component catalog (uiguideline.com/components, fetched 2026-10-07):
38 free entries visible — Alert, Avatar, Badge, Breadcrumbs, Button, Calendar,
Card, Carousel, Checkbox, Color Picker, Combobox, Date Picker, Divider,
Empty State, File Uploader, Link, Menu, Modal, Number Input, Pagination,
Popover, Progress Bar, Radio, Rating, Search, Select, Skeleton, Slider,
Spinner, Stepper, Switch, Table, Tag, Text Input, Textarea, Toast, Toggle
Button, Tooltip. 30+ Pro entries are paywalled (detail pages show Figma-kit
logos only) — this skill does NOT claim their contents. Pro-family guidance
below (Drawer/Tabs/Accordion/Dropdown/Sidebar/Navigation-patterns) is inferred
from the 20 systems' public docs + general practice, marked [inferred].

## The six families (choose inside the family first)

### 1. Navigation — Breadcrumbs · Menu · Tabs [inferred] · Stepper · Pagination · Link
- Breadcrumbs: location in a hierarchy (Explorer block/tx, Help articles). Never for actions.
- Menu: 5+ destinations or commands in one place (app nav, account switcher). Our `menu-ui.js` + `Event.delegate`.
- Tabs [inferred]: same-level peer views (Explorer blocks/assets/activity). Needs APG keyboard support.
- Stepper: multi-step flows with order (create-account, wallet import). Shows position + allows back.
- Pagination: split long lists the server pages (history, explorer). Prefer over infinite scroll for chain data (stable URLs, testable).
- Link: inline navigation inside text only. Never a button-styled link for actions.

### 2. Forms & Input — Text Input · Number Input · Textarea · Select · Combobox · Checkbox · Radio · Switch · Toggle Button · Slider · Date Picker · Calendar · File Uploader · Color Picker · Search
- Text vs Number: amounts use `inputmode="decimal"` + `Forms.labeledInput`; never `type="number"` spinners for money (precision + mobile keyboards).
- Textarea: multi-line only (memos, payloads, brainkeys). Single-line values stay inputs.
- Select vs Combobox vs Search+Menu: <8 static options → Select/Radio; 8+ or dynamic (assets, accounts, markets) → Combobox or Search+Menu with typo-tolerance (market-picker.js precedent). Never a raw Select with 100+ chain assets.
- Checkbox vs Switch vs Toggle Button: Checkbox = multi-select/agreement; Switch = immediate on/off setting (node prefs); Toggle Button = view mode (chart type). Never Switch for form-submit options.
- Radio: 2–5 mutually exclusive options shown all at once (fee asset, sign mode). More → Select.
- Slider: approximate range (slippage, percent) WITH a numeric readout; never the only input for exact money.
- Search: every picker over chain data (markets, accounts, assets) gets Search with debounce + keyboard + empty state — release blocker per principle #4.
- Date Picker/Calendar: expiry/review-period fields only (proposals, HTLC). Prefer duration presets (1 day/3 days) + custom date — chain users think in durations.
- File Uploader: keystore import/backup only, with explicit format hint + error states. Never for images.
- Color Picker: theme work only; never per-view colors (tokens in themes.css).

### 3. Feedback & Status — Alert · Toast · Badge · Tag · Progress Bar · Spinner · Skeleton · Rating · notify
- Alert: persistent page-level state (node down, testnet banner, compat). `warn-banner`/`compat-banner` in index.html.
- Toast: transient confirmations (broadcast sent, copied). Our `notify-ui.js` host; auto-dismiss + reduced-motion respect.
- Badge vs Tag: Badge = count/status dot on another element (unread, open orders); Tag = removable label/facet (market favourites). Never static text styled as badge.
- Spinner vs Skeleton vs Progress: unknown wait → Spinner; known layout loading → Skeleton (balance rows, orderbook); known-duration task (sync, export) → Progress Bar with %.
- Rating: never in a wallet (no star-ratings for chain objects). If seen, remove.

### 4. Data Display — Table · Card · Avatar · Divider · Carousel
- Table: dense comparable rows (balances, orders, fills, votes). Our `TableRenderer.render` with `th scope="col"`, sticky first col on scroll, 360px → stacked cards or horizontal scroll region.
- Card: heterogeneous summary (account overview, pool summary, dashboard tiles). Never a one-row table disguised as cards, never 20 identical cards where a table sorts/filters better.
- Avatar: account identicons only (jdenticon-style). Never decorative.
- Divider: groups inside a panel, not page structure (that is headings).
- Carousel: marketing/tour surfaces only (`tour-ui.js`). Never for transactional content.

### 5. Overlays & Disclosure — Modal · Popover · Tooltip · Accordion [inferred] · Drawer [inferred]
- Modal: confirm/sign flows ONLY via `ConfirmDialog.show({title, rows, feeHuman, onBack, onSend})` and generic sheets via `Overlay.open`. Returns focus, cleans listeners (R1-LISTEN).
- Popover: rich hover/tap disclosure tied to one trigger (fee breakdown). Must work on tap — never hover-only.
- Tooltip: 1-line label for icon-only buttons. Never paragraphs, never critical info only in tooltips (phone has no hover).
- Accordion/Drawer [inferred]: Help FAQ, advanced form sections. Never for primary actions.

### 6. Selection & Pickers — Menu · Combobox · market-picker · account/asset search
- The wallet's most consequential family: picking wrong market/account/asset loses money.
- Rule: every chain-object picker = Search input + filtered Menu + keyboard + empty state + recent/favourite shortcuts. `market-picker.js` is the reference implementation.
- Never a plain text input for an object with an on-chain registry (accounts, assets).

## Decision trees (the "more wisely" part)

```dot
digraph chooser {
    "Need to tell user something?" [shape=diamond];
    "Page-level, persists?" [shape=diamond];
    "Alert" [shape=box];
    "Transient confirmation?" [shape=diamond];
    "Toast" [shape=box];
    "Count on an element?" [shape=diamond];
    "Badge" [shape=box];
    "Loading state?" [shape=diamond];
    "Layout known?" [shape=diamond];
    "Skeleton" [shape=box];
    "Spinner" [shape=box];
    "Need to choose one of many?" [shape=diamond];
    "Options <8 and static?" [shape=diamond];
    "Select or Radio" [shape=box];
    "Combobox or Search+Menu" [shape=box];
    "Need overlay?" [shape=diamond];
    "Sign/confirm tx?" [shape=diamond];
    "ConfirmDialog modal" [shape=box];
    "One-line icon hint?" [shape=diamond];
    "Tooltip" [shape=box];
    "Rich disclosure?" [shape=diamond];
    "Popover (tap-safe)" [shape=box];
    "Showing rows?" [shape=diamond];
    "Comparable + sortable?" [shape=diamond];
    "Table" [shape=box];
    "Card" [shape=box];
}
```

## Vanilla mapping (every choice binds to shared code — AGENTS.md rule 9)

| Wisdom component | Vanilla implementation |
|---|---|
| Form rows/inputs/selects | Global `Forms` (`fieldRow`, `labeledInput`, `labeledSelect`, `labeledTextarea`) |
| DOM/status/empty states | Global `DOM` (`el`, `clear`, `status`, `error`, `pageHead`) |
| Confirm/sign modals | Global `ConfirmDialog.show` (keyed fee term, raw `dd` titles) |
| Generic sheets | Global `Overlay.open` (focus return, listener cleanup) |
| Tables | Global `TableRenderer.render` |
| Clicks/menus | Global `Event.delegate` |
| Touch floor | Shared `touchable` / `DOM.touchable` (≥44px one dimension) |
| Styling | `themes.css` tokens only — no hardcoded hex, contrast ≥4.5:1 |

Local `function el/clearRoot/showStatus/confirmList/fieldRow/touchable` is a
defect, not a shortcut — the audit greps for these.

## Retro-override rule (user policy 2026-10-07)

Zero-dep + shared-utils are inviolable. Retro look (principle #2) MAY be
broken when the wiser component measurably improves usability — but then the
audit row MUST carry: (a) before/after note, (b) which wisdom source prefers
the new pattern, (c) why retro styling could not host it. Taste-only restyles
still fail.

## Audit workflow

1. Inventory: `ls vanilla/js/views/*.js` + grep signals (`TableRenderer`,
   `Overlay`, `ConfirmDialog`, `Forms\.`, `type="search"`, `placeholder`,
   `empty|No .*found`, `spinner|skeleton|loading`, `toast|notify`,
   `tooltip|popover|title=`, `badge|tag`, `pagination|page`, `stepper|step`,
   `select|<select`, `tabs|tablist`).
2. Read high-traffic views for file:line evidence (dashboard, market-desk*,
   transfer, account, pools, vote, explorer, settings, wallet).
3. Per-view row: view file → components used (file:line) → wiser choice +
   wisdom source → vanilla mapping → effort (S/M/L) → retro impact
   (none / justified break with note).
4. Phone (360–390px) + desktop (≥1440px) reading of each changed pattern;
   numeric `inputmode`; no hover-only UI.
5. Record in `docs/parity/component-audit.md` with Top-N list first, then the
   full per-view table. Follow-up live-screenshot round stays a separate pass.

## Common mistakes

| Mistake | Fix |
|---|---|
| Select with 100+ assets | Combobox/Search+Menu with typo-tolerance (market-picker precedent) |
| Raw text input for account/asset | Search + validated lookup (`get_account_by_name`, symbol→1.3.x) |
| Tooltip carrying critical info | Move into visible text or Popover/Alert; tooltips are hints only |
| Cards where a sortable table belongs (fills, history) | TableRenderer with sort/filter |
| Table where heterogeneous summary belongs (dashboard) | Cards |
| Spinner with known layout | Skeleton rows matching final layout |
| Toast for errors needing action | Alert with action button |
| Modal for non-blocking info | Inline section or Popover |
| Slider as sole money input | Slider + synced numeric field via Forms |
| Local helper duplicating DOM/Forms/Confirm/Overlay/Table | Use the shared global (rule 9) |

## Red flags — stop and re-choose

- "It's just a quick input, search is overkill" (pickers are money paths)
- "One small local helper, shared utils are overkill"
- "Tooltip explains it" (for critical info)
- "Desktop users can hover" (phone-first, principle #7)
- "We'll add empty states later" (never later — principle #4 floor)
