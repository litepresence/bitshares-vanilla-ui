# Node discovery sweep 2026-10-02 (repo search → extract → probe)

Method: `tooling/discover-repos.py` (new — GitHub repo search `q=bitshares`,
top-60 by name-score, 10 candidate config paths each via raw fetch, wss://
extraction) → `latencyTEST.py` concurrent sweep (upgraded: ThreadPoolExecutor
25 workers, same bucket taxonomy) → targeted `ping_one` re-probe.

## Sources hit (4 repos with node lists)

- `bitshares/bitshares-ui` develop (15 nodes) + `BitSharesEurope/wallet.bitshares.eu` (5)
- `trackmusic/bitshares-ui` master (34 nodes — richest fork list found)
- `BTS-CM/astro-ui` main (6 nodes — thin but current; gave `api-testnet.61bts.com`)

34 candidates outside our lists probed. Full logs: `/tmp` (volatile);
verdicts below are the durable record.

## Verdicts

- **ADDED: `wss://api.dex.trading/ws`** (mainnet #7 in `store.js`): GOOD 0.42s,
  chain-verified, fresh head, full participation. Likely same operator as
  our testnet node. Bare + /ws + /wss all answer.
- **Near-miss, NOT added:** `node.bitshares.eu` + `node.testnet.bitshares.eu`
  (European community) — hosts answer but serve SELF-SIGNED certs (browsers
  reject; same disease as the dead EU faucet). Revisit if they fix TLS.
- **Dead (DNS/NXDOMAIN, parked, 404, reset, timeout):** all bitshares.im sop
  (hk/sg/ny/testnet), bts.ai, btslebin, btspp.io, bitshares.info,
  us/asia.api.bitshares.org, bitshares.bhuz, bitsharesle:8443, btsgo.net,
  icowallet, mypi.win (parked Cloudflare), loclx pair (404), nexus01.co.uk,
  gdex.top (DNS dead — GDEX manual-only stands), all 61bts hosts,
  crypto-bridge fleet, walldex, eu/us/testnet.nodes.bitshares.ws (timeout),
  roelandp.nl (dead, confirmed from second angle).
- **Zero STALE / zero FORKED** anywhere — the live network is healthy;
  everything else is simply gone.

## Standing practice (no first-connect discovery in-app)

Repo discovery stays an OFFLINE pipeline (this script, run by maintainers)
feeding the curated list that ships. Rationale, recorded for the next time
this is proposed: unauthenticated GitHub search allows 10 req/min and raw
fetches 60/hr (a full sweep needs a token); probing hundreds of strangers'
sockets from every visitor's browser on first connect would stall startup,
burn battery/bandwidth, and make github.com availability load-bearing for
the wallet (doctrine refusal). The app keeps: fast curated probe-all +
custom-node add. If ever wanted, the doctrine-compatible shape is an
explicit opt-in "Discover more nodes" button in Settings (user-initiated,
cancellable, fail-open) — never automatic on first connect.
