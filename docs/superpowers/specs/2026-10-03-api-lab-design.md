# API Lab ("swagger-like" node prober) — Design

Date: 2026-10-03. Status: approved (Option B). Author: brainstorm with owner.
Scope: one new standalone slice-addition to `vanilla/` — a curated, Swagger-feel
page that probes the connected public API node with input boxes + pulldowns.
No Swagger-UI dependency, no build step, no `eval`.

## 1. Goal

Serve all four audiences from one page: builders debugging slices, power users
exploring chain data, newcomers seeing a live API demo, testers verifying
chain-call mappings. The old UI's `Console.jsx`
(`reference/bitshares-ui/app/components/Console/Console.jsx:7-22`) is an
`eval(js)` box with `db/net/app/wallet/debug` in scope — explicitly NOT copied
for security. Vanilla gets a curated catalog + typed inputs + raw JSON I/O
through the single `Chain` socket owner (`vanilla/js/sdk/chain.js:55-63`).

## 2. Decisions (from brainstorm)

- Placement: standalone route `#/api-lab`, linked from Explorer header + footer
  dev entry. Not an Explorer tab, not a Console-route replacement.
- API surface: full catalog grouped `database / history / network-broadcast /
  debug`, seeded with ~25 reads first; broadcast + debug entries present but
  tier-gated (see §5). Rationale: owner asked for everything incl. debug;
  public nodes will reject most debug/network calls, so honest errors rule.
- Param style: curated typed boxes/pulldowns AND raw-JSON mirror, kept in sync
  both ways.
- Sharing: deep-link `?method=&params=` on every Run + in-session history
  (last ~20, no persistence).
- Display: raw node JSON untouched + separate human-hint line where the shape
  is known (`format.js`; e.g. `2000→20%`, `74900 p2→749.00`). Unknown shapes
  render raw-only, never guessed.
- Advanced-use gate (owner requirement): first visit per session + first
  tier-escalation show a modal — "advanced use, confirm you understand what
  you are doing" — before the desk / tier unlocks. Broadcast still needs its
  own per-call confirm on top.

## 3. Architecture

Two new files only, plus route + nav wiring:

- `vanilla/js/api/api-lab.js` — catalog + pure helpers, no DOM. Entry shape:
  `{ api, method, description, sourceRef, params: [{name,type,required,enum?,
  example,hint}], tier }` with `tier: read|fee|broadcast|debug`.
  Ground truth per entry is `#4` (`database_api.hpp`, `api.hpp`); BJS on demand
  for serialization questions; `#1/#2/#3` file:line where behavior is borrowed.
  Seed reads (v1, all `database_api` unless noted): `get_chain_id`,
  `get_dynamic_global_properties`, `get_config`, `get_block`, `get_transaction`,
  `get_recent_transaction_by_id`, `get_objects`, `get_accounts`,
  `get_account_by_name`, `lookup_account_names`, `lookup_accounts`,
  `get_account_count`, `get_account_balances`, `get_assets`,
  `lookup_asset_symbols`, `get_asset_count`, `get_limit_orders`,
  `get_order_book`, `get_ticker`, `get_top_markets`, `get_witnesses` +
  `get_committee_members`, `get_required_fees` (fee tier),
  `get_account_history` (history_api), `broadcast_transaction` (broadcast tier),
  `get_connected_peers`/`network_node` + `get_debug_info` (debug tier,
  expected-reject).
- `vanilla/js/views/api-lab-ui.js` — the desk (DOM only). Builds inputs from
  the schema, mirrors curated↔raw, calls `Chain.db/history/net/call` (sole
  socket path), renders pretty raw JSON `<pre>` (escaped) + hint line.
- Router: `#/api-lab` + query `method/params`; lazy-load pattern per
  `router.js` placeholders; `index.html` script tags in dependency order
  (catalog before UI, both before `router.js` usage point like explorer).
- i18n: `I18n.t` with verbatim en defaults (slice-17 precedent); catalog
  descriptions are data, wrapped same way.

Out of scope: per-probe node picker (settings owns nodes; lab shows a
`connected to X + latency` strip with link), persisted history, POST-style
URI building beyond method+params, pie charts / Swagger-UI assets.

## 4. Layout (Swagger feel, retro skin)

Desktop two-column, phone stacked (principle #7):

- Left: grouped method list (Database / History / Network / Debug) + search
  (typo-tolerant filter, market-picker precedent, keyboard-navigable). Debug
  group carries a permanent "usually disabled on public nodes" banner.
- Right: method card — description + `sourceRef`, curated param boxes/pulldowns
  with example placeholders, collapsible raw-JSON mirror, Run / Reset /
  Copy-link (≥44px targets), connection strip, result pane (raw `<pre>` +
  hint line).
- Styling: existing retro cards + `themes.css` tokens only; verified in all
  three themes. No Swagger-UI code vendored.

## 5. Data flow

1. Select method → build empty form from schema (examples as placeholders).
2. Typing in curated boxes re-serializes the raw mirror live; editing raw
   re-validates into boxes (bad JSON = inline error, never sent).
3. Run → `Chain` call on the current connection (8s timeout, generation
   counter teardown on route change — explorer/vote pattern).
4. Success → pretty JSON + hint; failure → verbatim node error + tier note.
5. Every Run updates the URL (`method + params`) and pushes history.
   Broadcast-tier links load prefilled + locked (never auto-run).

## 6. Safety + errors

- Tiers: `read`/`fee` free; `broadcast` needs unlock + Transfer-style
  human-readable confirm (field rows + `get_required_fees` line, never blind);
  `debug`/`network_node` free to attempt, expected to fail honestly.
- Advanced gate (§2) precedes desk + tier escalation; per-session, never a
  persisted blanket OK.
- Offline → slice-1 offline panel + Retry, never blank. Timeouts named per
  method. No keys/WIFs in DOM; all interpolated strings escaped.
- `signMessage`-style blind-signing is out (extension `#3` discipline).

## 7. Verification

- Catalog: every entry cites `#4` header line; conflicts resolved #4 > BJS >
  #1/#2/#3, recorded in the parity note.
- Testnet: 2–3 vectors per seeded read (known account/asset/block → expected
  shape); broadcast proven by confirm-render path (no stray broadcast);
  debug proven by real node rejection rendering.
- Gates: `tooling/check_rot.py` clean, `check_types.sh` (checkJs) clean,
  theme trio + 360px/1440px checks, raw→human vectors for every hinted shape,
  parity note `vanilla/notes/api-lab.md` with the 7 slice fields
  (ref behavior, vanilla file:line, test steps + observed, vectors, trio +
  viewports, headers/descriptions, anti-rot a–c).
- 2036 test: catalog is data (no fetch of remote spec), UI is platform DOM,
  Chain is the only node surface.

## 8. Build order

1. `api/api-lab.js` catalog (reads seed) + `index.html` tags.
2. `views/api-lab-ui.js` desk (list+search, form builder, raw mirror,
   run/history/deep-link, advanced gate) + `#/api-lab` route + nav links.
3. Broadcast/debug tiers + confirm wiring.
4. Testnet vectors + parity note + audit + screenshots.
