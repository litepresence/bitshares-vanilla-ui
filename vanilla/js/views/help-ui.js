/* help-ui.js — help index + full topic articles + community page.
 * Owns: /help/** (index at /help, one article view per topic key) and
 *   /community (the community link directory, split out 2026-10-04 —
 *   footer REPORT target). Topic list
 *   is curated for this wallet (67 topics: wallet basics plus every feature
 *   this app ships — pools, HTLC, credit, samet, barter, spotlight, debit,
 *   trollbox, alerts, prediction/PMO, builder, labs, charts, dashboard,
 *   registration, URIs, and more — plus 4 cross-link topics (assets-issue,
 *   assets-feed, community, menu) that point at their in-app screens.
 * Consumes: I18n.t for chrome, titles, guides, and full article bodies
 *   (help.topic_<key>_title/_text/_body). Bodies are lite-markdown blocks
 *   ("# " heading, "- " bullets, blank-line paragraphs) rendered via
 *   textContent only — structure without HTML injection, translators
 *   translate one block per topic.
 *   No wallet, no chain, no amounts — no Format vectors apply.
 *   Global HelpUI only; static renders.
 * PROVENANCE: older articles adapted from reference #1's help markdown
 *   (concepts + words, reworded for this wallet's screens); newer feature
 *   articles written fresh from in-app behavior. Copy never mentions the
 *   old UI and never apologizes — honest limits are stated plainly as facts.
 * Refs: App.jsx:618-633 (/help + 3 nested :path routes) for route shape only.
 * Created by: stub-queue build (matrix §A STUB queue, batch 2); articles port
 *   2026-09-29; multilingual + coverage pass 2026-10-02.
 */
var HelpUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. vars supports
   * %(name)s templates at a few asset/named-count labels. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  /* key, title, one-line guide (own words, navigational), in-app route or null. */
  var TOPICS = [
    ["disclaimer", "Disclaimer", "Keys stay on your device; nothing here is financial advice. Back up before funding.", null],
    ["bitshares", "What is BitShares", "A delegated-proof-of-stake chain with an on-chain exchange. Start at the market desk.", "#/market/BTS_USD"],
    ["wallets", "Wallets", "A wallet holds your brainkey and derives owner, active and memo keys. Managed under Wallet.", "#/wallet"],
    ["backups", "Backups", "Your brainkey IS the backup — write it down. View it any time in the wallet manager.", "#/wallet"],
    ["blockchain", "Blockchain", "Blocks, transactions and objects, browsable in the explorer.", "#/explorer"],
    ["voting", "Voting", "Vote for witnesses, committee members and workers, or set a proxy.", "#/voting"],
    ["witnesses", "Witnesses", "Block producers that validate transactions and build blocks; vote for them or through a proxy.", "#/voting"],
    ["workers", "Workers", "Paid proposals funded by the chain itself; votes decide which ones earn the daily budget.", "#/voting"],
    ["committee", "Committee members", "Elected members that set fees and chain parameters such as block size.", "#/voting"],
    ["accounts-general", "Accounts", "One name, one on-chain account: balances, orders and history.", "#/accounts"],
    ["accounts-proposed", "Proposed transactions", "Multi-signature proposals: review and approve pending actions.", "#/proposals"],
    ["accounts-permissions", "Permissions", "Owner, active and memo keys and what each one may sign.", "#/accounts"],
    ["accounts-membership", "Memberships", "Basic vs lifetime membership tiers and what changes.", "#/accounts"],
    ["assets-mpa", "Market-pegged assets", "Smartcoins backed by collateral with price feeds from witnesses.", "#/assets"],
    ["assets-uia", "User-issued assets", "Anyone can issue a custom token; create and manage them under Assets.", "#/assets/create"],
    ["assets-private", "Privatized BitAssets", "Issuer-controlled assets with restricted transfer lists.", "#/assets"],
    ["assets-issue", "Issuing assets", "Mint new supply of an asset you control from the Issue desk.", "#/assets/issue"],
    ["assets-feed", "Publishing price feeds", "Publish price feeds for market-pegged assets you feed.", "#/assets/feed"],
    ["dex-intro", "Decentralized exchange", "Order books settle on-chain — the desk shows book, chart and your orders.", "#/market/BTS_USD"],
    ["dex-trading", "Trading", "Limit orders with exact prices; instant-trade wraps the same path in one screen.", "#/instant-trade"],
    ["dex-shorting", "Borrowing and shorting", "Borrow smartcoins against collateral; positions and margin calls under Borrow.", "#/borrow"],
    ["gateways", "Gateways", "Move coins across chains via gateway bridges (deposit / withdraw desks).", "#/deposit-withdraw"],
    ["gateways-xbts", "XBTS gateway", "XBTS bridge desk with supported coins and manual fallback.", "#/deposit-withdraw"],
    ["gateways-ioxbank", "IOXBank gateway", "IOXBank bridge desk with supported coins.", "#/deposit-withdraw"],
    ["transfer", "Sending assets", "Send any asset to any account, with optional encrypted memos.", "#/transfer"],
    ["instant", "Instant trade", "One-screen simple buy and sell without building orders by hand.", "#/instant-trade"],
    ["pools", "Liquidity pools", "Supply two assets, earn a cut of every swap; stake pool shares.", "#/pools"],
    ["htlc", "Hash time-locked contracts", "Trustless atomic swaps with hash-lock plus timelock refund.", "#/htlc"],
    ["credit", "Credit offers", "Lend assets on your terms; borrowers draw against the offer.", "#/credit-offer"],
    ["borrow-extra", "Settling and collateral", "Force-settle smartcoins and watch collateral ratios and bids.", "#/borrow"],
    ["trollbox", "Trollbox chat", "On-chain public chat rooms, paid per kilobyte like any transaction.", "#/trollbox"],
    ["alerts", "Price alerts", "Get notified when a market crosses a price you set.", "#/alerts"],
    ["settings", "Settings and nodes", "Pick API nodes by live health, switch themes and language.", "#/settings"],
    ["extension-install", "Installing the extension", "Per-browser install steps, what changes, and the honest limits.", "#/settings"],
    ["history-index", "Community history index", "Node history vs the community index: what works where, and how to reconcile gaps.", "#/settings"],
    ["topops", "Top operations", "Which chain operations run hottest, counted from recent blocks.", "#/top-ops"],
    ["txbuilder", "Transaction builder", "Compose several operations into one transaction and sign once.", "#/txbuilder"],
    ["prediction", "Prediction markets", "YES/NO shares on real-world outcomes with live probabilities.", "#/prediction"],
    ["pmo", "Prediction organizations", "Branded houses that issue prediction markets under one name.", "#/prediction"],
    ["proposals", "Proposals", "Pending multi-signature actions awaiting approval or expiry.", "#/proposals"],
    ["tickets", "Vote-locked tickets", "Lock stake for voting weight that grows with lock time.", "#/tickets"],
    ["authorities", "Authorities", "Custom permission sets beyond owner, active and memo.", "#/authorities"],
    ["vesting", "Vesting balances", "Time-locked balances that release on schedule; claim when due.", "#/vesting"],
    ["lists", "Allow and block lists", "Control who can hold or transact your assets.", "#/lists"],
    ["airdrop", "Airdrops", "Distribute an asset to many accounts in one plan.", "#/airdrop"],
    ["invoice", "Invoices", "Request a specific payment with a shareable invoice.", "#/invoice"],
    ["fees", "Network fees", "What each operation costs and which asset pays it.", "#/explorer/fees"],
    ["referrals", "Referrals", "How registration splits fees between referrer and registrar.", "#/referrals"],
    ["favourites", "Favourites", "Pin markets, assets and accounts for quick access.", "#/favourites"],
    ["tour", "Welcome tour", "The five-step first-run walkthrough; replay it any time.", "#/"],
    ["samet", "Same-T Funds", "Pooled same-asset funds with draws and repayments.", "#/samet"],
    ["barter", "Barter", "Propose direct asset-for-asset trades for approval.", "#/barter"],
    ["spotlight", "Spotlight", "Showcase tiles plus a recurring-orders helper.", "#/spotlight"],
    ["direct-debit", "Direct Debit", "Authorize recurring withdrawals; claim and manage them.", "#/direct-debit"],
    ["api-lab", "API Lab", "Probe the connected node with a 29-call catalog.", "#/api-lab"],
    ["es-lab", "ES Lab", "Search the community history index with curated forms.", "#/es-lab"],
    ["browser", "Browser support", "Which browsers run the wallet, and what the compatibility notice means.", null],
    ["charts", "Charts and indicators", "Candles, depth, and the 25-indicator catalog on the desk.", "#/market/BTS_USD"],
    ["dashboard", "Dashboard", "Locked splash vs your unlocked watched-account overview.", "#/"],
    ["register", "Creating an account", "Claim a name through the faucet registrar.", "#/create-account"],
    ["password", "Changing the wallet password", "Re-encrypt the local vault with a new passphrase.", "#/wallet/password"],
    ["news", "News", "Why this wallet ships no in-app news feed.", "#/news"],
    ["uris", "Payment requests and exports", "BitShares links that prefill payments, plus CSV history export.", "#/invoice"],
    ["glossary", "Glossary", "Names used across this wallet: objects (1.x.y), operations, witnesses, committee.", null],
    ["about-making", "Making of this wallet", "The build story behind this wallet — 413 exchanges across 14 sessions.", "#/about"],
    ["community", "Community", "Chats, forums, explorers, and code around BitShares.", "#/community"],
    ["menu", "Site menu", "Every page in this wallet, grouped the way the navigation menu groups them.", "#/menu"]
  ];

  /* Article bodies: key -> sections. Section = [heading, [paragraphs], [bullets]?].
   * English literals (see header). All strings render via textContent only. */
  var BODY_DEFAULTS = {
    "disclaimer": [
      "# What this wallet is",
      "This wallet is an interface to the BitShares blockchain. Information you see here — balances, orders, markets — is created by blockchain users, not by this app.",
      "Your keys are stored locally in your browser and never leave it: transactions are signed locally before they are broadcast. Never expose your keys to anyone.",
      "# Not advice of any kind",
      "Nothing here is legal, business, or investment advice. You act at your own risk when you rely on anything shown by this wallet.",
      "If a decision matters, talk to a licensed professional in your jurisdiction.",
      "# Where your risk sits",
      "Most losses fall into a few buckets: your own mistakes (forgotten password, funds sent to the wrong name, deleted wallet data), broken software or malware on your machine, failed hardware, someone getting into your wallet, or a third-party service failing you.",
      "Back up before funding anything, and treat every address and memo you paste as guilty until checked.",
      "# Assets live on the chain, not here",
      "This app does not store, send, receive, or hold any asset. Assets exist only as ownership records on the BitShares blockchain; every transfer happens on that decentralized ledger, not inside this page.",
      "# Investment and tax reality",
      "BitShares holdings can lose money over short or long periods, with large price swings. Nothing shown here promises otherwise.",
      "You alone work out which taxes apply to your transactions.",
      "# No warranties, limited liability",
      "This wallet is provided as-is, at your own risk. To the extent the law allows, its owners and contributors are not liable for any damages from using it — including lost use, lost profits, or lost data."
    ],
    "bitshares": [
      "# The delegated-proof-of-stake exchange",
      "BitShares is a delegated-proof-of-stake blockchain with a built-in exchange: order matching happens in the protocol itself, so trading needs no central company holding your funds.",
      "It extends the blockchain idea beyond money — banking, exchanges, voting, auctions and more — run as distributed companies under public, auditable rules instead of human management.",
      "# What it enables",
      "On one chain you get user-issued assets, market-pegged assets, non-fungible tokens, the order-book exchange, pooled automated markets, and hashed time-lock contracts.",
      "This wallet exposes most of those features: smartcoins, custom tokens, and the market desk are the places to start.",
      "# Your keys never leave the browser",
      "This is a browser wallet. Your keys are stored locally and transactions are signed locally before broadcast — the servers you connect to never see your secrets.",
      "That is also why backups are your job alone: lose the brainkey or password and nobody can recover your funds.",
      "# Design goals",
      "- No custody: traders keep their own private keys and funds at all times.",
      "- Blocks every few seconds; every operation lists its chain fee before you sign."
    ],
    "wallets": [
      "# A web app with a local vault",
      "This application runs in your browser and talks to a chain node as its gateway to the network. Everything secret stays in your browser's local vault.",
      "# Cloud-style login",
      "If you registered with a username and password, you hold a cloud-style wallet: the same credentials open your account from any browser. It serves one account at a time and is the usual choice for new users.",
      "# Local wallet",
      "A local wallet is a database inside one specific browser. It will not follow you to another computer or browser unless you carry a backup over and import it.",
      "See the Backups article before you rely on a local wallet for real funds.",
      "# Password discipline",
      "The password encrypts the vault. Short or reused passwords fall to guessing; a unique passphrase written on paper does not.",
      "Changing the password re-encrypts everything — verify the current one first, then confirm the wallet still unlocks before you walk away."
    ],
    "backups": [
      "# Back up early, back up twice",
      "Make a backup of your local wallet before you fund it — one backup is usually enough going forward, but keep it in at least two secure places only you can reach.",
      "Backups are encrypted with your passphrase, so without both the file AND the password your funds are gone. Never store the password next to the backup.",
      "# Where to do it",
      "Create and restore backups from the Wallet screens in this app. The file downloads to your machine; guard it like cash.",
      "Restoring on a new browser or computer means importing that file and entering the same passphrase.",
      "# The brainkey alternative",
      "If you never imported raw keys by hand, your whole wallet derives deterministically from one brainkey — a string of words. Writing down the brainkey backs up every account and fund in that wallet.",
      "View it in the wallet manager and copy it to paper, stored separately from anything digital.",
      "# Advanced: hierarchical authorities",
      "If you use weighted multi-account authorities instead of plain keys, a key backup alone may NOT restore access — the authority structure itself matters.",
      "Re-read the Permissions article and record the full authority setup, not just the words."
    ],
    "blockchain": [
      "# A public chain of blocks",
      "Like most cryptocurrencies, BitShares records transfers and market activity in blocks, each pointing at the previous one — a chain holding every transaction ever made.",
      "The ledger is public and auditable: anyone can verify transfers, orders, and order books. This wallet's explorer is built for exactly that.",
      "# Who builds the blocks",
      "Block producers are chosen by delegated proof of stake: BTS holders vote for preferred producers, called witnesses, and the top-voted ones may produce blocks.",
      "Every transaction must validate against the witnesses' work, so voting is how holders keep the chain honest. See the Voting and Witnesses articles.",
      "# More than transfers",
      "The chain offers many transaction types beyond sending assets: exchange orders, borrowing, proposals, vesting, pools, and more.",
      "Most types are self-explanatory in the confirm dialog; the deeper ones each have their own help article here."
    ],
    "voting": [
      "# Why your vote matters",
      "Voting keeps BitShares secure and funded: it picks the block producers, the policy setters, and which worker projects get paid.",
      "Your vote's weight follows the BTS you hold. If community mechanics are new to you, a proxy (below) is the recommended start.",
      "# Proxy: delegate when unsure",
      "A proxy is an account you trust to vote with your weight on your behalf — like electing a representative.",
      "While a proxy is set, you cannot vote directly for witnesses, committee members, or workers. You can release the proxy any time and vote yourself. Remember to publish your changes.",
      "# Witnesses",
      "Witnesses build and sign blocks from validated transactions. Vote for as many as you like; each gets your full weight. Full detail lives in the Witnesses article.",
      "# Committee",
      "The committee sets chain policy: trading and transaction fees, block size and interval, cashback percentages, vesting periods, and similar parameters. Full detail lives in the Committee Members article.",
      "# Workers and the budget",
      "Workers are paid proposals climbing from proposed to active once they out-vote the refund worker, paid from a fixed daily budget first-come first-served by rank. Full detail lives in the Workers article."
    ],
    "witnesses": [
      "# What witnesses do",
      "Witnesses are the block producers of BitShares. They collect validated transactions, construct new blocks, and sign them so the network can trust the chain's history.",
      "Their role parallels miners on other chains — except here the right to produce blocks comes from shareholder votes, not hashing power.",
      "# How they are chosen",
      "BTS holders vote for their preferred block producers on-chain under delegated proof of stake. The candidates with the most vote weight earn the producer slots.",
      "You may vote for as many witnesses as you like, and each one receives your full vote weight — voting for more never dilutes your support.",
      "# Voting well",
      "Candidate statements and community discussion are the honest way to pick: look for reliable block production, honest price feeds, and steady maintenance.",
      "If you do not want to research every candidate, set a proxy you trust instead of voting blind. Publish your changes so the chain records them.",
      "# In this wallet",
      "Browse producers, your current votes, and the proxy setting under Voting, and confirm any slate change before signing — votes are on-chain transactions with fees."
    ],
    "workers": [
      "# Work paid by the chain",
      "Workers are proposals to do something useful — development, marketing, infrastructure — in exchange for a salary paid by the blockchain itself.",
      "Each proposal states at minimum a start and end date, a daily pay, a maximum total pay, and a link explaining the work. Check that link before voting.",
      "# Lifecycle: proposed, active, expired",
      "Proposed workers are collecting votes. Once a proposal out-votes the refund worker it becomes active and starts getting paid; if support drops below that bar it is defunded.",
      "Expired proposals stay visible for history after their end date passes.",
      "# How the budget works",
      "All workers share one fixed daily budget, paid first-come first-served by vote rank: the top-voted proposals collect their daily pay until the budget runs out.",
      "A proposal can be approved yet earn nothing if higher-ranked workers already consumed the day's funds — rank matters, not just approval.",
      "# In this wallet",
      "Read proposals, compare pay and dates, and cast or withdraw your votes under Voting. Publish your changes so the chain records them."
    ],
    "committee": [
      "# What the committee decides",
      "Committee members are elected by shareholders to set chain policy: transaction and trading fees, block size and block interval, referral rewards, cashback percentages, vesting periods, and similar parameters.",
      "It is a position of real responsibility — a bad parameter can raise everyone's costs or slow the chain, so it demands a working understanding of BitShares.",
      "# How members are chosen",
      "Like witnesses, committee members win their seats through shareholder votes, and holders may back as many candidates as they like or delegate to a proxy.",
      "If the mechanics feel unfamiliar, a proxy is safer than a random ballot. Publish your changes so the chain records them.",
      "# In this wallet",
      "Review candidates and your current ballot under Voting, and confirm any slate change before signing — votes are on-chain transactions with fees."
    ],
    "accounts-general": [
      "# One name, one account",
      "On this chain you register a human-readable account name first, then use it everywhere instead of pasting raw addresses.",
      "Owning the name and being able to spend its funds are separate rights, which is what makes shared and corporate accounts possible — see Permissions.",
      "# What lives on an account",
      "Balances across every asset you hold, your open exchange orders, and your full transaction history all hang off the account.",
      "# In this wallet",
      "Open any account overview to see its balances, open orders, and history with no login — reads are public on a public chain.",
      "Only spending needs your keys: cancelling someone else's order is refused, and your own cancels ask you to unlock first."
    ],
    "accounts-proposed": [
      "# Suggest what you cannot sign",
      "A proposal submits a transaction for someone else's approval: you suggest an action on an account you do not control, and the controlling parties approve or ignore it.",
      "The classic case is a shared multi-signature account — one party proposes a transfer, the others approve until the authority threshold is met, and then it executes.",
      "# They expire on their own",
      "Every proposal carries an expiry date. Past that date it disappears by itself, so a stale suggestion cannot surprise anyone months later.",
      "# Treat surprises as hostile",
      "An unexpected proposal on your account deserves suspicion, not curiosity — even if the proposer's name looks familiar.",
      "When in doubt, ignore it and contact the supposed counterparty through a channel you already trust. Never approve what you do not understand.",
      "# In this wallet",
      "Review pending proposals and approve or reject them from the proposals screens; the confirm dialog shows exactly what the proposal would do before you sign."
    ],
    "accounts-permissions": [
      "# Two locks: active and owner",
      "Active permission controls the money — spending, trading, transferring. Owner permission controls the account itself and can overwrite keys and settings.",
      "Both are edited in your account's Permissions tab as authorities plus a threshold: the summed weight of the signers must beat the threshold for a transaction to count.",
      "# Authorities, weights, thresholds",
      "An authority names one or more accounts (or keys), each with a weight. Signatures add up their weights; cross the threshold and the action is authorized.",
      "This one mechanism expresses everything from a single key to corporate hierarchies.",
      "# Example: shared funds, any two of four",
      "Give four partners weight 33 each with threshold 51: any two together pass, no single one can move funds alone.",
      "# Example: one stays in charge",
      "Give the lead 49 and each friend a smaller slice with threshold 51: the lead plus any one friend can act, or all friends together — theft by one friend alone is impossible.",
      "# The memo key",
      "The memo key only receives encrypted memos — it can never spend. Because it carries no spending power, you may share its private key with a reader (auditor, accountant) for read-only memo access without risking funds."
    ],
    "accounts-membership": [
      "# Three tiers",
      "Every account starts as a regular non-member. Upgrading buys lifetime status; an annual subscription sits in between for smaller budgets.",
      "Upgrading is an on-chain action with a fee from the published fee schedule — the confirm dialog shows the exact price before you sign.",
      "# Why go lifetime",
      "Lifetime members earn cashback on every transaction fee they pay, plus referral income from users they bring to the network.",
      "# Where fee money goes",
      "Each fee you pay is split: the network takes its cut, the lifetime member who referred you takes theirs, and the registrar divides the remainder with its affiliate program.",
      "# Pending and vesting fees",
      "Referral splits settle once per maintenance interval, not instantly. Large fees, such as membership upgrades, vest over the committee-defined period."
    ],
    "assets-mpa": [
      "# Dollars without a bank",
      "A market-pegged asset tracks an outside price — BitUSD, BitEUR, BitGOLD and friends — through contracts enforced by the chain itself.",
      "Each unit stays backed by 100 percent or more of its value in BTS collateral, convertible at any time. Holders call them SmartCoins.",
      "# No counterparty to fail you",
      "Unlike an exchange IOU, a SmartCoin needs no issuer promise: the protocol locks the collateral and performs settlements automatically.",
      "# How the peg holds",
      "Borrowers lock BTS to create SmartCoins; witnesses publish the real-world price feeds the chain enforces against.",
      "If collateral thins, margin calls close the weakest positions first; any holder can also force-settle at a fair price.",
      "# In this wallet",
      "Trade SmartCoins on any market desk, borrow them against BTS collateral under Borrow, and inspect supply, feeds, and settlement data in the asset and explorer screens."
    ],
    "assets-uia": [
      "# Your token in minutes",
      "Anyone — person or company — can create a user-issued asset for anything imaginable: event tickets, crowdfunding shares, ownership records, even company equity.",
      "# Powerful, so handle with care",
      "The issuer defines the rules: supply, precision, fees, transfer restrictions. A UIA is only as trustworthy as its issuer and its on-chain description.",
      "Regulations differ by place and by token kind; issuers must stay compliant where they operate, and holders should read the asset details before buying.",
      "# In this wallet",
      "Create and manage your own tokens under Assets, and inspect any token's issuer, supply, and permissions before you trade or accept it."
    ],
    "assets-private": [
      "# Pegged assets, private feeds",
      "A privatized BitAsset works like a market-pegged asset, except the issuer — not the witnesses — chooses who may publish its price feeds.",
      "The issuer also sets the asset's fees and earns from them.",
      "# Who wants this",
      "Exchanges and institutions with real-time price access use privatized assets to quote their own markets without waiting on witness feeds.",
      "# What it means for you",
      "You trade the issuer's price, not the witnesses': check who publishes feeds and what the fee schedule is before holding a privatized asset."
    ],
    "assets-issue": [
      "# Issuing assets",
      "Create new supply of an asset your account controls from the Issue desk; amounts use the asset's precision and the confirm dialog shows the exact fee before you sign."
    ],
    "assets-feed": [
      "# Publishing price feeds",
      "Publish the settlement price for a market-pegged asset from the Feed desk; the confirm dialog shows the exact fee before you sign."
    ],
    "dex-intro": [
      "# Exchange without the exchange company",
      "The DEX trades digital goods directly on-chain: nobody holds your coins between order and fill.",
      "One global book serves everyone with internet access, around the clock — there is no single server to fail and no opening bell.",
      "# Trade almost anything",
      "The protocol is asset-agnostic: any pair can trade, from USD against EUR down to long-tail pairs with thin liquidity.",
      "# Secured by your keys, settled on-chain",
      "Funds and orders are guarded by industry-grade elliptic-curve cryptography; multi-signature setups from the Permissions article work here too.",
      "Orders settle on-chain, in blocks a few seconds apart — the matching rules are public and re-checkable.",
      "# Matching you can verify",
      "Given a set of orders, anyone can re-check that they were matched correctly: the matching algorithm is public and provable, not a black box on a server.",
      "# Smartcoins complete the picture",
      "BitUSD, BitEUR, BitCNY and siblings trade at their tracked values, each backed by locked BTS collateral redeemable through settlement."
    ],
    "dex-trading": [
      "# Pairs: quote against base",
      "Any two assets form a market pair, written quote:base — EUR:USD means euros quoted in dollars.",
      "Prices are stored internally as exact fractions so both views of a pair always agree.",
      "# Reading the book",
      "The ask side sells quote and buys base; the bid side sells base and buys quote.",
      "Depth and spread tell you the cost of size: a thin book moves against large orders, a tight spread means cheap immediacy.",
      "# Placing an order",
      "Fill the buy or sell form with a price and an amount; the wallet computes the cost and adds the chain fee before you confirm.",
      "Your order rests open until someone takes it, and your account is credited in the bought asset when it fills.",
      "# Cancelling",
      "Unfilled orders cancel any time for a small fee — use it when the market moves away from your price.",
      "In this wallet your open orders sit beside the desk and on your account page; cancelling asks you to unlock only if the order is yours."
    ],
    "dex-shorting": [
      "# Borrow, then sell short",
      "To short a SmartCoin you borrow it from the network against BTS collateral, then sell it into any market at whatever price buyers pay.",
      "To close, buy back the borrowed amount and hand it to the network, which burns it and releases your collateral.",
      "# Words you must know",
      "Settlement price: what 1 BTS fetches on outside exchanges. Maintenance collateral ratio: the witnesses' minimum backing.",
      "Maximum short-squeeze ratio and squeeze protection cap what shorts can be forced to pay; call price is where YOUR position gets margin-called.",
      "# Margin calls",
      "Whenever the best bid falls below your call price (but above the protection floor), the network force-sells your collateral into the market to buy back the debt.",
      "Whatever BTS remains after covering returns to you — a margin call closes the position, it does not zero you by default.",
      "# Settlement by holders",
      "Any SmartCoin holder may force-settle at a fair price at any time; the lowest-collateral shorts are closed first to fund it.",
      "# Managing a position",
      "Raise the ratio by locking more BTS, or lower it by repaying some debt — any adjustment is allowed while you stay above maintenance.",
      "Watch the ratio after sharp BTS moves: top up collateral or buy back debt BEFORE the call price reaches you."
    ],
    "gateways": [
      "# Coins from other chains",
      "Gateways and bridges are outside companies that carry assets onto BitShares: you send them BTC (or fiat, or XRP...), they hand you a matching token on this chain, redeemable back for a fee.",
      "While you hold their token, THEY hold your original coins — read their terms as the custody deal it is.",
      "# Bridges: trust minimized",
      "A bridge swaps your deposit for a SmartCoin equivalent, so after the short transfer window you hold collateral-backed tokens with no custodian risk.",
      "# Gateways: trust required",
      "A gateway issues its own branded IOUs, each backed by the real coins users deposited with that operator.",
      "Like any exchange balance, those tokens are worth exactly as much as the operator's solvency and honesty. Prefer gateways with transparent reserves and a support channel that answers.",
      "# In this wallet",
      "Deposit and withdraw through the bridge screens in this app; each coin's desk shows addresses, memos, limits, and a manual fallback when automation is down.",
      "Withdrawals leave as normal transfers with the gateway's memo format — copy it exactly, because the operator's software parses it."
    ],
    "gateways-xbts": [
      "# What XBTS is",
      "XBTS runs a gateway service on the BitShares exchange, moving popular cryptocurrencies in and out. Every supported coin carries the XBTSX. prefix, such as XBTSX.BTC.",
      "Its site and live support chat are the places for status, terms, and incident help — this wallet only drives its desks.",
      "# Depositing",
      "Pick the coin on the deposit desk to get the gateway's address (and tag or memo where needed), then send from the outside chain including every reference shown.",
      "Credit needs outside-chain confirmations first.",
      "# Withdrawing and fallback",
      "Withdraw from the desk with your destination address; the wallet prefills the transfer and the gateway's memo format for you.",
      "If automation is down, the same desk documents the manual path: send the XBTSX.* token to the gateway account with the memo format shown, exactly as written."
    ],
    "gateways-ioxbank": [
      "# Instant swaps to IOU tokens",
      "The IOXBank gateway bridges outside coins onto BitShares with immediate settlement after outside-chain confirmation. Its tokens wear the IOB. prefix — IOB.XRP and IOB.XLM among them.",
      "# Reserves you can check",
      "IOXBank publishes its outside-chain reserve addresses, so you can compare its XRP and XLM balances against the IOB.XRP and IOB.XLM supplies visible in this wallet's asset screens.",
      "# Depositing from the wallet",
      "Choose the coin on the deposit desk: you receive the gateway address plus the tag or memo to include, and you must repeat that reference at the source of your outside transfer.",
      "# Withdrawing manually",
      "To withdraw by hand, send your IOB.* tokens to the ioxbank-gateway account with a memo naming the coin, destination address, and tag: xrp:ADDRESS:tag:NUMBER, or xlm: first for Stellar.",
      "Replace every placeholder with your own values and double-check the address — outside chains rarely forgive typos.",
      "# Limits and support",
      "Minimums are small (single-digit XRP, tens of XLM) — below them, deposits may not credit."
    ],
    "transfer": [
      "# Sending assets",
      "Pick the asset, the recipient account, and the amount; the wallet adds the chain fee and shows the full confirm before you sign.",
      "Double-check the name — chain transfers do not reverse.",
      "# Encrypted memos",
      "Attach a memo to transfer text privately: it encrypts to the recipient's memo key and only they can read it.",
      "Leave the memo empty for a plain public transfer.",
      "# Fees",
      "Every transfer pays the chain fee from the fee schedule. The confirm dialog shows the exact fee before you sign — never estimate, never guess."
    ],
    "instant": [
      "# One screen, no order book",
      "Instant trade buys or sells at the current market price without building limit orders by hand.",
      "Enter what you give and the wallet previews what you get, fee included, before anything signs.",
      "# When to use the desk instead",
      "Large sizes move thin books: the desk's limit orders with exact prices beat instant fills past a few percent of visible depth.",
      "Instant is for convenience size; the desk is for precision size."
    ],
    "pools": [
      "# Supply two assets, earn the flow",
      "Liquidity pools hold pairs of assets and price swaps between them automatically. Suppliers deposit both sides and earn a cut of every swap fee, proportional to their share.",
      "# Staking pool shares",
      "Depositing mints share tokens tracking your slice. Stake them to earn, unstake to leave; updating fees or deleting an empty pool are owner actions with confirms.",
      "# Impermanent reality",
      "If prices drift apart after you deposit, withdrawing buys back less value than holding both assets would have. Fees must outrun that drift — check the pool's volume before committing size."
    ],
    "htlc": [
      "# Trustless swaps across time",
      "A hash time-locked contract locks funds behind two conditions: reveal a secret hash preimage, or wait out the timelock for a refund.",
      "Two parties lock both sides with the same hash — either both legs complete or both refund. No escrow agent, no trust.",
      "# Create, redeem, refund",
      "Create with the hash, the counterparty, and an expiry comfortably past the other leg. Redeem by revealing the preimage before expiry; after expiry the funder reclaims.",
      "Watch expiries on both chains involved — a missed window strands funds until refund."
    ],
    "credit": [
      "# Lend on your terms",
      "Credit offers publish an asset, an interest rate, and limits. Borrowers draw against an offer and repay with interest; the chain enforces the deal.",
      "# Borrowers: know the cost",
      "Interest accrues per the offer terms from draw to repay. Repay early to stop the clock; the confirm shows principal plus accrued interest.",
      "# Deals, not promises",
      "Each draw opens a deal with its own balance and schedule. Track open deals under Credit and close them by repaying in full."
    ],
    "borrow-extra": [
      "# Force-settle smartcoins",
      "Any SmartCoin holder may force-settle at a fair feed-derived price. The lowest-collateral shorts fund it first.",
      "Settlement carries a fee and a delay — the confirm shows both before you sign.",
      "# Collateral ratios, live",
      "The borrow screens show each position's ratio against maintenance in real time. Top up or repay before the call price reaches you.",
      "# Settlement bids",
      "After global settlement events, collateral goes to bid. Bids commit funds at your price; winners settle, losers release automatically."
    ],
    "trollbox": [
      "# Public chat on-chain",
      "Trollbox channels live on the blockchain itself: every message is a tiny paid transaction, which is exactly what keeps spam uneconomical.",
      "Posting costs a fraction of a cent per kilobyte — reads are free and need no login.",
      "# Channels and manners",
      "Pick a channel, read first, then post. Messages are permanent and public to the whole world — never post secrets, keys, or personal data.",
      "# Cost honesty",
      "The composer shows the live fee before you sign. Long messages cost more kilobytes; split essays across posts."
    ],
    "alerts": [
      "# Never watch a screen again",
      "Price alerts watch markets while you live your life: set a price, pick above or below, get notified when the market crosses it.",
      "Notifications stay off by default — each rule opts in explicitly, and rules die with one tap.",
      "# Rules that respect you",
      "Alerts evaluate on ticker refreshes, never on your keystrokes. No account needed to create one; signing is never involved — alerts only read."
    ],
    "settings": [
      "# Nodes: pick by health, not habit",
      "The node table probes every endpoint live: latency plus head age, witness participation, and irreversible lag, graded Good through Forked.",
      "A fast-but-stale or forked node is labeled, never shown as healthy. Switch with one tap; the footer always shows where you are connected.",
      "# Find more nodes",
      "The opt-in discovery button searches public node lists and probes what it finds. It names the privacy cost up front, runs cancellable in the background, and only ever proposes candidates — nothing joins your list without your tap.",
      "# Themes, language, housekeeping",
      "Three themes, ten languages, custom nodes with add and remove, plus wallet, password, and reset controls — all on this one page, all instant, no reload.",
      "# Candle depth",
      "The candle-count input sets how many candles charts fetch (default 2000). Deeper windows cost more history calls — raise it for research, lower it on slow connections.",
      "# Signing route",
      "The Signing section shows where your signatures happen: in the extension (isolated from websites) or in this page's memory. Automatic mode prefers the extension whenever it is detected.",
      "# Connected sites",
      "Every site you approve for signing is listed with its bound accounts and a per-site Revoke. Revoking never affects past transactions — it only stops future prompts from skipping straight past your attention. Wallet requests always prompt; they are never remembered."
    ],
    "extension-install": [
      "# What the extension changes",
      "The extension runs the exact same wallet in an isolated browser origin with a locked-down script policy. Page scripts on websites cannot read its storage or memory. Signing requests from sites — and from the wallet itself when extension routing is on — open an approval window showing every operation field, and die unapproved after 60 seconds.",
      "# What it does not change",
      "It cannot protect a hosted web copy you do not control: a compromised page could still show you lies (wrong addresses, wrong amounts) even when signatures are gated. Verify what you approve, every time. It also cannot move your existing web wallet over by itself — migration is one explicit import, then wipe the web copy.",
      "# Chromium, Edge, Opera, Brave",
      "Open the extensions page (chrome://extensions), enable Developer mode, choose Load unpacked, and point it at the extension folder (or the unzipped store package). Pin the wallet icon for one-tap access.",
      "# Firefox",
      "Install the signed Firefox package through Add-ons Manager and confirm it is enabled. The Firefox build is the MV2 variant — same wallet, same approvals.",
      "# Safari",
      "Safari needs an Xcode wrapper app around the extension sources plus an Apple developer account — follow-up work with real cost, not yet built. The web build remains the Safari story.",
      "# Android and iOS",
      "Firefox Android can install extensions distributed through AMO. Chrome on Android supports no extensions at all — the web build is the mobile story there.",
      "# Migrating",
      "Create fresh inside the extension, or import your web envelope once (Settings shows the way) and then wipe the web copy. Back up the brainkey first either way — the envelope import moves ciphertext, and only your password plus brainkey can ever recover it.",
      "# Supply-chain honesty",
      "Extensions auto-update through their store, which is a trust relationship with the store and the publisher key — a static folder you diff yourself has neither. Prefer reproducible builds and published hashes where offered."
    ],
    "topops": [
      "# What the chain does most",
      "Top operations counts real operation types across the last 200 blocks: transfers, orders, fills, votes — ranked with shares, plus a donut for the shape of chain activity.",
      "Refresh re-runs the window. Testnet works here, unlike the old stats pages that were mainnet-only.",
      "# Two desks, one count",
      "Top Operations pairs the rankings with the activity donut; the Operations desk shows the same window as a plain ranked table. Both read the same blocks.",
      "# Reading it",
      "A healthy chain shows transfers and order flow on top with governance and maintenance underneath. Spikes in exotic types deserve a look in the explorer."
    ],
    "history-index": [
      "# Two histories, two jobs",
      "Node history comes from the public API node you picked: account activity, fills, market candles, settlement and order reads. The Settings table marks every node with a History pill from a live probe — pick a History node for history features.",
      "The community index is a third-party ElasticSearch (es.bitshares.dev) that adds what no node serves: top asset holders, transaction lookup by hash, and deeper archives. It is run by the community, not by this wallet — questions go to t.me/bitsharesDEV.",
      "# When something is missing",
      "A panel that needs history you don't have says so and links back to Settings: switch to a History node, or turn the community index on. Nothing here ever shows a blank panel or a guessed number.",
      "# Testnet limits",
      "Node history works on testnet, but the community index covers mainnet only — index-powered features (holders, hash lookup) are unavailable on testnet by data, not by bug.",
      "# The switch",
      "Settings holds the community-index toggle (on by default). Turn it off and every index surface falls back to chain history or an honest notice — your call, reversible any time.",
      "# Browsing the index",
      "The ES Lab desk turns the index into searchable forms plus a raw console: operations by account or type, holders, and hash lookup, each showing the exact query it runs."
    ],
    "txbuilder": [
      "# Several operations, one signature round",
      "The builder composes multiple operations — transfers, votes, stakes — into a single transaction you review once and sign once.",
      "Add from Transfer, Voting, or Pool stake screens, or queue manually; export and import envelopes to move drafts between sessions.",
      "# Review before you sign",
      "Every queued operation renders a human row with amounts in human terms. The fee preview covers the whole bundle with one chain fee call.",
      "# Proposals from bundles",
      "Wrap any bundle as a multi-signature proposal instead of sending it: proposers, expiry, and review accounts, all before signatures."
    ],
    "prediction": [
      "# YES/NO shares on real outcomes",
      "Prediction market assets are SmartCoins whose feed tracks a real-world condition — an election, a launch, a price level — stated in plain English with an expiry.",
      "Buy YES by buying the asset; the feed price is the market's live probability. After expiry the issuer settles at 1.0 (happened) or 0.0 (didn't), and winners redeem collateral.",
      "# Reading a market",
      "The detail view shows condition, expiry, feed history, and the probability in four formats: implied percent, decimal, fractional, and American.",
      "No price means no probability — the screen says so instead of inventing fifty percent.",
      "# Positions and portfolio",
      "Holdings show average cost against current price with unrealised profit and loss. Settle settled-market holdings for collateral; sell live ones back on the desk."
    ],
    "pmo": [
      "# Branded prediction houses",
      "A prediction market organization is a parent asset carrying a machine-readable charter: name, website, resolution policy, and dispute rules.",
      "Sub-markets issue under it as dotted names (HOUSE.ELECTION2028), so holders can verify who stands behind a market before trusting its resolution.",
      "# Creating and joining",
      "Create an organization from the prediction page, then issue sub-markets beneath it. Long dotted names also pay the cheapest creation-fee tier.",
      "Browsing organizations shows each house with its active and expired market counts — empty houses with no markets earn no trust."
    ],
    "proposals": [
      "# Pending multi-signature actions",
      "Proposals wait for approvals or expiry: transfers, updates, and bundle wraps proposed by one party for others to sign.",
      "Each shows proposer, expiry, review accounts, and the enclosed operations in human rows — approve only what you understand.",
      "# Approve, reject, or let expire",
      "Approval adds your signature toward the threshold; rejection is on the record; expiry deletes the proposal by itself.",
      "Treat surprise proposals as hostile until proven otherwise."
    ],
    "tickets": [
      "# Lock stake, grow weight",
      "Vote-locked tickets convert stake plus time into voting weight: longer locks weigh more, and weight decays nothing until unlock.",
      "Create a ticket from liquid stake, top it up, and claim it back when the lock ends.",
      "# Where weight counts",
      "Ticket weight feeds witness, committee, and worker votes through the normal slate — publish the slate to activate it."
    ],
    "authorities": [
      "# Beyond owner, active, memo",
      "Custom authorities define new permission sets — named roles with their own keys, weights, and thresholds for specific operation families.",
      "Create them for treasuries, bots, and shared desks that should sign some things but never everything.",
      "# Keep the map readable",
      "Name each authority for its job, record thresholds beside the keys that meet them, and review the map yearly — stale authorities are attack surface."
    ],
    "vesting": [
      "# Locked now, yours later",
      "Vesting balances release on schedule: worker pay, referral rewards, and large fees arrive over time instead of at once.",
      "Each balance shows its schedule and claimable remainder; claiming is one transaction with one fee.",
      "# Claim when due",
      "Claimed funds land liquid immediately. Unclaimed schedules simply wait — nothing expires, nothing decays."
    ],
    "lists": [
      "# Who may hold your assets",
      "Asset issuers can restrict holding and transfer to listed accounts: allow-lists for compliance, block-lists for bad actors.",
      "Check an asset's lists before accepting it — a token you cannot move is a souvenir, not money.",
      "# Blocking users",
      "Your personal block list mutes accounts across the app's social surfaces. It changes nothing on-chain; it changes what you have to look at."
    ],
    "airdrop": [
      "# One plan, many recipients",
      "Airdrops distribute an asset to a list of accounts in a single planned operation instead of hundreds of manual transfers.",
      "Build the recipient list, preview totals, confirm once — the chain fans the payments out.",
      "# Mind the dust",
      "Tiny outputs can cost more in fees than they deliver. Preview per-recipient net amounts and drop dust lines before signing."
    ],
    "invoice": [
      "# Ask to be paid, precisely",
      "Invoices name an asset, an amount, a recipient, and an optional memo, packed into a shareable request.",
      "Send the link or code; the payer's wallet prefills everything, leaving only review and sign.",
      "# Paying one",
      "Open an invoice to see exactly what is asked before your wallet builds the transfer. Verify the recipient name yourself — links can lie."
    ],
    "fees": [
      "# Every operation has a price",
      "The chain charges per operation from a published fee schedule: transfers, orders, creations, votes — each with a flat core fee, some plus data-size surcharges.",
      "This wallet previews the exact fee from the live chain before every signature — never estimated, never guessed.",
      "# Who pays, in what",
      "The signer pays, in the asset the form names (usually the core asset). Fee pools let some assets pay their own way; the fee-asset line names the payer.",
      "# Creation tiers",
      "Asset creation prices by symbol length: short premium names cost most, long dotted names least. The create form names the tier beside the live fee."
    ],
    "referrals": [
      "# Bring users, earn splits",
      "Registering an account names a referrer and a registrar. Every fee that account ever pays splits three ways: network, referrer, registrar.",
      "Your splits vest and settle per maintenance interval — recent earnings show pending until the round closes.",
      "# Lifetime leverage",
      "Lifetime members earn bigger splits plus cashback on their own fees. The account page shows your registrar's exact cut — no hidden beneficiaries."
    ],
    "favourites": [
      "# Pin what you touch daily",
      "Star markets, assets, and accounts to pin them on the dashboard strip and pickers.",
      "Favourites live per wallet profile and survive reloads; unstar with the same tap.",
      "# The dashboard strip",
      "Starred plus featured quotes form the above-fold market strip — your tape, your pairs, live prices without opening the desk."
    ],
    "tour": [
      "# Five steps, then freedom",
      "The first-run tour walks the dashboard, market strip, charts, trade panels, and beyond: where to look, what each part does, how to leave. Dismiss any time; it never blocks.",
      "# Replay",
      "Take tour replays from the dashboard whenever you want a refresher — same five steps, same dismiss."
    ],
    "samet": [
      "# Pooled funds, same asset in and out",
      "Same-T funds pool one asset from many suppliers. Borrowers draw against a fund and repay with interest; the chain enforces balances and schedules.",
      "# Denomination discipline",
      "Funds denominate in whole units (1M base): create, draw, and repay in the same asset, and mind the fund's limits before committing size.",
      "# Same-transaction rule",
      "Paired fund operations belong in one transaction: split legs can strand half a deal. The desk builds the pair together — review once, sign once."
    ],
    "barter": [
      "# Propose a straight swap",
      "Barter proposes an asset-for-asset trade to a counterparty: you offer an amount of one asset and ask an amount of another, with an expiry.",
      "# They approve or it lapses",
      "The proposal executes when the counterparty approves, and deletes itself past expiry. Treat surprise barters as hostile until proven otherwise.",
      "# In this wallet",
      "Build the offer under Barter; the confirm dialog shows both legs in human terms before you sign."
    ],
    "spotlight": [
      "# A showcase, not an exchange",
      "Spotlight is the reference UI's showcase grid: tiles that point at wallet features (HTLC, Direct Debit) plus a recurring-orders helper. It moves no funds itself and carries no chain operation.",
      "# Recurring orders helper",
      "The helper places N limit orders NOW at stepped prices — one transaction per order, each with its own confirm. No scheduler runs in a static page: closing the page places nothing further."
    ],
    "direct-debit": [
      "# Authorize pulls, then manage them",
      "Direct debit lets an account authorize another to withdraw up to a limit on a schedule. Givers and recipients each see their side in tables.",
      "# Create, update, claim, delete",
      "Permissions carry periods and limits; claims draw against them, updates change the terms, and deletion is a free cancel. Claim memos are plaintext — never put secrets in one.",
      "# Reads are public",
      "Tables render even while locked (viewing as committee-account); the password is asked only at Sign & Send."
    ],
    "api-lab": [
      "# A 29-call node prober",
      "API Lab catalogs the calls this wallet actually uses — account and asset lookups, market data, fees, block reads — with forms for parameters and raw JSON results.",
      "# Reads run free, broadcasts cost",
      "Read-only calls execute against the connected node immediately. Anything that would broadcast names its fee before signing, same as every other desk.",
      "# When a call fails",
      "Failures name the cause (offline node, history-less node, bad parameter) and link back to Settings. Switch nodes from the node table and re-run."
    ],
    "es-lab": [
      "# The community index, browsable",
      "ES Lab searches the third-party community index (es.bitshares.dev): operations by account or type, block ranges, transaction lookup by hash, and top asset holders — the things no public node serves.",
      "# Gated and honest",
      "The lab runs only while the community-index switch in Settings is on, and says so when it is off. Holders and hash lookup cover mainnet only — on testnet those desks explain the data gap instead of guessing.",
      "# Curated forms plus raw console",
      "Every catalog search shows the exact query it runs; the raw console accepts arbitrary bodies against the allowlisted indexes for power users."
    ],
    "browser": [
      "# Detected features, never brand names",
      "This wallet never asks which browser you use — it probes the four platform features it genuinely needs: WebSocket (chain data), WebCrypto (keystore), BigInt (money math), and local storage (settings). Silence is a pass: no banner on a modern browser means everything is present.",
      "# The most common cause: insecure context",
      "Modern browsers expose WebCrypto only in secure contexts: https pages, localhost, and opened files. The same up-to-date browser served over plain http (for example a LAN address) reports WebCrypto missing — the browser is fine, the address is not. Serve the folder over https or localhost, or open index.html directly.",
      "# What still works",
      "Browsing always works: balances, markets, explorer, and voting read public chain data with no wallet features. Only local signing needs the missing piece. Dismissing the notice hides it on this machine; it never blocks a page."
    ],
    "charts": [      "# Price, depth, and oscillators",
      "The desk shows a price pane (candles plus moving averages) with stacked oscillator sub-panes on independent scales, a volume pane, and a cumulative depth chart beside the book.",
      "# Real candles, carried forward",
      "Candles come from chain history with timeframe-aware interpolation: gaps carry the last price forward and flag red/green, so thin markets never invent volume.",
      "# A 25-indicator catalog",
      "Trend, momentum, volatility, and volume math (SMA through Fisher and PSAR) ships as dependency-free formulas verified against published vectors. Pick them from the indicator menu; parameters stay on their published defaults unless you change them."
    ],
    "dashboard": [
      "# Locked: the splash",
      "While locked, the home page is a landing: the project motto, a live market strip, the chain pulse, feature cards, and the steps to start. Nothing here needs your keys.",
      "# Unlocked: your watched account",
      "Unlock and the same page becomes your overview: balances, recent activity, favourite markets, and quick links for the wallet's own account.",
      "# Starred markets strip",
      "The above-fold strip mixes starred and featured quotes — star pairs from any market picker to make the tape yours."
    ],
    "register": [
      "# Claim a name",
      "Registration claims an on-chain account name through the faucet registrar: pick an unused name, fund the creation fee, and the registrar creates the account for you.",
      "# Faucet reality",
      "The testnet faucet answers reliably; the old European testnet faucet is dead and stays listed nowhere. On mainnet, creation goes through the registrar your settings name.",
      "# After creation",
      "Back up the new wallet before funding it — the brainkey IS the backup. Import existing keys instead under Import if the account already exists."
    ],
    "password": [
      "# Re-encrypt everything",
      "Changing the password re-encrypts the whole local vault under a new passphrase: enter the current one, choose a unique replacement, and confirm.",
      "# Verify before you walk away",
      "Lock and unlock once with the new passphrase before funding anything — a typo here plus a lost brainkey means lost funds.",
      "# Short or reused passwords fall to guessing; a unique passphrase written on paper does not."
    ],
    "news": [
      "# No in-app feed, by decision",
      "This wallet ships no news feed: the reference UI pulled headlines from an external blog service, and bundling a hosted feed would break the day its owner moves it. No fetch is attempted, so there is no spinner and no fetch-error panel.",
      "# Staying current instead",
      "The connection line on the News page is always live, and project discussion happens in the linked community chats under Help."
    ],
    "uris": [
      "# Links that prefill payments",
      "BitShares URIs (bitshares:…) pack a payment request — recipient, asset, amount, memo — into a shareable link. Opening one prefills the transfer or invoice form; only review and sign remain.",
      "# Verify before signing",
      "Links can lie about who they pay: check the recipient name yourself. The wallet never signs from a link alone.",
      "# CSV history export",
      "Account history exports to CoinTracking-compatible CSV for taxes and records. Amounts export as display decimals with symbols; dates stay empty rather than guessed."
    ],
    "glossary": [
      "# Objects: everything has an id",
      "Accounts, assets, orders, proposals, witnesses — nearly everything on-chain is an object with an id like 1.2.0 (the leading digits say which space it lives in).",
      "In this wallet, account ids look like 1.2.x and asset ids like 1.3.x; pasting an id into the explorer opens that object directly.",
      "# Operations: what transactions do",
      "Transactions carry operations numbered 0-77: transfers, orders, votes, pool moves, tickets, chat. The explorer names each op it shows.",
      "# People and roles",
      "Witnesses produce blocks; committee members set chain parameters; workers deliver paid projects; proxies vote on your behalf; the registrar is whoever paid to create your account.",
      "# Money words",
      "Precision is how many decimals an asset uses — amounts are stored as integers and shifted by it, so the wallet always shows human decimals, never raw integers.",
      "Collateral backs borrowed SmartCoins; margin calls and settlements close weak positions; fees on every operation split between the network, referrers, and registrars."
    ],
    "about-making": [
      "# Making of this wallet",
      "What follows is the original build story: every prompt that created this wallet, from \"acquire bitshares-ui\" on 26 September 2026 to the issue-1 fix on 3 October, with the builders' replies — preserved unedited.",
      "It records the decisions this wallet stands on: walking away from another React uplift after issue #3583 and its thousand-hour trap, so this wallet depends on nothing with a release cycle; signing every transaction locally like the old wallet instead of outsourcing it; three themes with the classic look as default; numbers in human terms, never raw chain integers; phone-first layouts from the first slice; and fees read from the live chain, never estimated.",
      "413 exchanges across 14 sessions. Read it as history: this is how the wallet got built.",
      "# The full dialog archive",
      "The complete exchange-by-exchange record lives on the About page (#/about). Expand the \"Full build dialog\" section there to browse all 413 exchanges, filter by keyword, or deep-link to a specific exchange with ?dialog=N."
    ],
    "community": [
      "# Community",
      "People and places around BitShares — homepage, code, explorers, forums, and chats — live on the Community page."
    ],
    "menu": [
      "# Site menu",
      "The Menu page lists every screen in this wallet by section, so any desk is one tap away."
    ]
  };

  function topicByKey(key) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i][0] === key) return TOPICS[i];
    return null; }
  /* No local el — use DOM.el */
  /* clearRoot removed — use DOM.clear */
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }

  /* Route entry: empty wildcard -> index; known key -> topic; else honest miss. */
  function renderHelp(root, params) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    var key = params && typeof params.wildcard === "string" ? params.wildcard.replace(/^\/+|\/+$/g, "") : "";
    if (!key) { paintIndex(doc, wrap); return; }
    var hit = topicByKey(key);
    if (!hit) {
      wrap.appendChild(DOM.pageHead(doc, t("help.help", "Help"), "question-circle"));
      wrap.appendChild(DOM.el(doc, "p", "No help topic named “" + key + "”. Pick one from the index.", "muted"));
      paintIndexList(doc, wrap);
      return;
    }
    paintTopic(doc, wrap, hit);
  }

  /* Renders one lite-markdown article: "# " lines become h2, "- " lines
   * group into one ul, consecutive text lines join into one paragraph (so
   * translated blocks stay correct even if a translator wraps lines
   * differently). Every string lands via textContent — structure without
   * HTML injection. */
  function paintBlock(doc, wrap, items) {
    var list = null, para = [], i;
    function flushPara() {
      if (para.length) wrap.appendChild(DOM.el(doc, "p", para.join(" ")));
      para = [];
    }
    function closeList() {
      if (list && list.length) {
        var ul = doc.createElement("ul");
        for (i = 0; i < list.length; i++) {
          var li = doc.createElement("li");
          li.textContent = list[i];
          ul.appendChild(li);
        }
        wrap.appendChild(ul);
      }
      list = null;
    }
    (items || []).forEach(function (raw) {
      String(raw === undefined || raw === null ? "" : raw).split("\n").forEach(function (ln) {
        var s = ln.trim();
        if (!s) { flushPara(); closeList(); return; }
        if (s.indexOf("# ") === 0) { flushPara(); closeList(); wrap.appendChild(DOM.el(doc, "h2", s.slice(2))); return; }
        if (s.indexOf("- ") === 0) {
          flushPara();
          if (!list) list = [];
          list.push(s.slice(2));
          return;
        }
        para.push(s);
      });
    });
    flushPara();
    closeList();
  }

  function paintBody(doc, wrap, key) {
    var fallback = "";
    try {
      var arr = BODY_DEFAULTS[key] || [];
      fallback = Array.isArray(arr) ? arr.join("\n") : String(arr);
    } catch (e) { fallback = ""; }
    var src = t("help.topic_" + key + "_body", fallback);
    var items = Array.isArray(src) ? src : String(src).split(/\n\s*\n/);
    if (!items.length) return;
    paintBlock(doc, wrap, items);
  }

  /* Index: every topic as a link (mirrors the #1 toc structure). */
  function paintIndex(doc, wrap) {
    wrap.appendChild(DOM.pageHead(doc, t("help.help", "Help"), "question-circle"));
    wrap.appendChild(DOM.el(doc, "p", t("help.index_intro", "Short guides for every part of the wallet, each opening into a full article."), "muted"));
    paintIndexList(doc, wrap);
    /* Pointer to the Community page (help/community split 2026-10-04):
     * chats, forums, and explorers live there now, not here. */
    var hint = DOM.el(doc, "p", null, "muted");
    hint.appendChild(doc.createTextNode(t("help.community_hint", "Chats, forums, and explorers live on the Community page: ")));
    var link = doc.createElement("a");
    link.setAttribute("href", "#/community");
    link.textContent = t("help.community_title", "Community");
    hint.appendChild(link);
    wrap.appendChild(hint);
    /* Documentation: chain-level references beyond this wallet. External
     * links open a new tab (target _blank + noopener); textContent-only. */
    wrap.appendChild(DOM.el(doc, "h2", t("help.documentation", "Documentation")));
    var docs = doc.createElement("ul");
    [["https://docs.bitshares.org", t("help.docs_org", "BitShares Docs (docs.bitshares.org)")],
     ["https://docs.bitshares.dev", t("help.docs_dev", "BitShares Developer Docs (docs.bitshares.dev)")]].forEach(function (pair) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = pair[0]; a.textContent = pair[1];
      try { a.target = "_blank"; a.rel = "noopener"; } catch (e) { /* same-tab fallback */ }
      li.appendChild(a); docs.appendChild(li);
    });
    wrap.appendChild(docs);
    /* AI-assisted help: machine-readable mirror of this project for
     * AI assistants and researchers. Same external-link treatment. */
    wrap.appendChild(DOM.el(doc, "h2", t("help.ai_help", "AI Assisted Help")));
    wrap.appendChild(DOM.el(doc, "p", t("help.ai_help_hint", "Ask an AI assistant about BitShares against a structured mirror of this repository."), "muted"));
    var aiul = doc.createElement("ul");
    var aili = doc.createElement("li"), aia = doc.createElement("a");
    aia.href = "https://deepwiki.com/litepresence/bitshares-vanilla-ui";
    aia.textContent = t("help.ai_deepwiki", "Project wiki on DeepWiki (deepwiki.com)");
    try { aia.target = "_blank"; aia.rel = "noopener"; } catch (e) { /* same-tab fallback */ }
    aili.appendChild(aia); aiul.appendChild(aili);
    wrap.appendChild(aiul);
  }

  /* renderCommunity: #/community — the community link directory that used to
   * live at the bottom of #/help (split 2026-10-04; REPORT footer target).
   * Same external-link treatment throughout (new tab + noopener,
   * textContent-only). Params: root (element). Returns nothing. */
  function renderCommunity(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.pageHead(doc, t("help.community_title", "Community"), "share"));
    wrap.appendChild(DOM.el(doc, "p", t("help.community_intro", "People and places around BitShares: homepage, code, explorers, forums, and chats. External links open in a new tab."), "muted"));
    paintCommunityDir(doc, wrap);
    var back = DOM.el(doc, "p", null, "muted"), b = doc.createElement("a");
    b.href = "#/help"; b.textContent = t("help.help", "Help");
    back.appendChild(b);
    back.appendChild(doc.createTextNode(" · "));
    var ab = doc.createElement("a");
    ab.href = "#/about"; ab.textContent = t("help.about_link", "About this wallet");
    back.appendChild(ab);
    wrap.appendChild(back);
  }

  /* paintCommunityDir: the link directory (Homepage/Code/Explorers/Elastic/
   * Forum/English+Chinese chats). Shared by renderCommunity only.
   * Params: doc, wrap. Returns nothing. Never throws. */
  function paintCommunityDir(doc, wrap) {
    /** @type {any} */
    var SECTIONS = [
      ["help.homepage", "Homepage", [
        ["https://bitshares.github.io", "help.link_bts_home", "BitShares homepage (bitshares.github.io)"]]],
      ["help.code", "Code", [
        ["https://github.com/bitshares", "help.link_gh_org", "BitShares on GitHub (github.com/bitshares)"],
        ["https://github.com/bitshares/bitshares-core", "help.link_gh_core", "Core blockchain (bitshares-core)"],
        ["https://github.com/litepresence/bitshares-vanilla-ui", "help.link_gh_vanilla", "This wallet (bitshares-vanilla-ui)"]]],
      ["help.explorers", "Explorers", [
        ["https://btslens.pages.dev", "help.link_exp_lens", "BTS Lens explorer (btslens.pages.dev)"],
        ["https://bitshares.network", "help.link_exp_network", "BitShares.network explorer"],
        ["https://bitshares-explorer.lovable.app", "help.link_exp_lovable", "BitShares Explorer (lovable.app)"]]],
      ["help.elastic", "Community index (third-party history)", [
        ["https://es.bitshares.dev", "help.link_es_api", "History API (es.bitshares.dev)"],
        ["https://kibana.bitshares.dev", "help.link_es_kibana", "History dashboards (kibana.bitshares.dev)"]]],
      ["help.forum", "Forum", [
        ["https://bitsharestalk.org", "help.link_forum", "BitSharesTalk forum (bitsharestalk.org)"]]],
      ["help.chat_en", "English Chat", [
        ["https://t.me/BitsharesDev", "help.link_tg_dev", "Dev chat (t.me/BitsharesDev)"],
        ["https://t.me/BitsharesNews", "help.link_tg_news", "News (t.me/BitsharesNews)"],
        ["https://t.me/BitsharesScams", "help.link_tg_scams", "Scam alerts (t.me/BitsharesScams)"],
        ["https://t.me/BitsharesGroup", "help.link_tg_group", "Community group (t.me/BitsharesGroup)"],
        ["https://t.me/BitsharesWallet", "help.link_tg_wallet", "Wallet chat (t.me/BitsharesWallet)"]]],
      ["help.chat_cn", "Chinese Chat", [
        ["https://t.me/BitsharesDEXcn", "help.link_tg_cn", "Chinese community (t.me/BitsharesDEXcn)"]]]];
    SECTIONS.forEach(function (sec) {
      wrap.appendChild(DOM.el(doc, "h2", t(sec[0], sec[1])));
      var ul = doc.createElement("ul");
      sec[2].forEach(function (pair) {
        var li = doc.createElement("li"), a = doc.createElement("a");
        a.href = pair[0]; a.textContent = t(pair[1], pair[2]);
        try { a.target = "_blank"; a.rel = "noopener"; } catch (e) { /* same-tab fallback */ }
        li.appendChild(a); ul.appendChild(li);
      });
      wrap.appendChild(ul);
    });
  }
  /* GROUPS: help index sections (menu-sitemap slice) — same 7 headings as
   * the sitemap (nav-pulldown Task 3 splits Labs & Personal the same way:
   * Labs holds the power-tool topics, Personal the rest). [i18nKey,
   * enDefault, [topicKeys]]. Unknown future keys fall into "More" at
   * render. Exported via _test for locale/test tooling.
   * @type {Array.<[string, string, string[]]>} */
  var GROUPS = [
    ["menu.section_wallet", "Wallet", ["disclaimer", "wallets", "backups", "accounts-general", "accounts-proposed", "accounts-permissions", "accounts-membership", "transfer", "invoice", "vesting", "authorities", "lists", "register", "password", "referrals", "dashboard"]],
    ["menu.section_trade", "Trade", ["bitshares", "blockchain", "dex-intro", "dex-trading", "dex-shorting", "instant", "pools", "gateways", "gateways-xbts", "gateways-ioxbank", "borrow-extra", "samet", "barter", "spotlight"]],
    ["menu.section_earn", "Earn & Protect", ["credit", "direct-debit", "htlc", "tickets", "airdrop"]],
    ["menu.section_govern", "Govern", ["voting", "witnesses", "workers", "committee", "proposals", "prediction", "pmo"]],
    ["menu.section_explore", "Explore", ["assets-mpa", "assets-uia", "assets-private", "assets-issue", "assets-feed", "topops", "fees", "charts", "history-index", "community"]],
    ["menu.section_labs", "Labs", ["txbuilder", "api-lab", "es-lab", "browser"]],
    ["menu.section_personal", "Personal", ["settings", "extension-install", "trollbox", "favourites", "alerts", "tour", "news", "uris", "glossary", "menu", "about-making"]]
  ];

  function paintIndexList(doc, wrap) {
    /* Grouped index (menu-sitemap slice): same 7 headings as the sitemap so
     * help mirrors the burger. Unknown future keys fall into "More" — never
     * dropped. Group titles reuse menu.* keys with verbatim defaults. */
    var byKey = {};
    TOPICS.forEach(function (e) { byKey[e[0]] = e; });
    var seen = {};
    GROUPS.forEach(function (g) {
      var h = doc.createElement("h2");
      h.textContent = t(g[0], g[1]);
      wrap.appendChild(h);
      var list = doc.createElement("ul");
      list.className = "help-index";
      /** @type {string[]} */ (g[2]).forEach(function (key) {
        var e = byKey[key];
        if (!e) return;
        seen[key] = true;
        var li = doc.createElement("li"), a = doc.createElement("a");
        a.href = "#/help/" + e[0]; a.textContent = t("help.topic_" + e[0] + "_title", e[1]); li.appendChild(a); list.appendChild(li);
      });
      wrap.appendChild(list);
    });
    var rest = TOPICS.filter(function (e) { return !seen[e[0]]; });
    if (rest.length) {
      var mh = doc.createElement("h2");
      mh.textContent = t("menu.section_more", "More");
      wrap.appendChild(mh);
      var mlist = doc.createElement("ul");
      mlist.className = "help-index";
      rest.forEach(function (e) {
        var li = doc.createElement("li"), a = doc.createElement("a");
        a.href = "#/help/" + e[0]; a.textContent = t("help.topic_" + e[0] + "_title", e[1]); li.appendChild(a); mlist.appendChild(li);
      });
      wrap.appendChild(mlist);
    }
  }

  /* Topic: title + guide summary + full article body + in-app pointer + back.
   * help-article hook (app.css): prose paragraphs/ul cap at ~75ch so article
   * lines stay readable at desk widths. Display-only class, no strings. */
  function paintTopic(doc, wrap, topic) {
    try { wrap.classList.add("help-article"); } catch (e) { /* class best-effort */ }
    wrap.appendChild(DOM.pageHead(doc, t("help.topic_" + topic[0] + "_title", topic[1]), "question-circle"));
    wrap.appendChild(DOM.el(doc, "p", t("help.topic_" + topic[0] + "_text", topic[2])));
    paintBody(doc, wrap, topic[0]);
    if (topic[3]) {
      var p = DOM.el(doc, "p", null, "muted"), a = doc.createElement("a");
      a.href = topic[3]; a.textContent = t("help.open_in_the_wallet", "Open in the wallet");
      p.appendChild(a); wrap.appendChild(p);
    } else {
      wrap.appendChild(DOM.el(doc, "p", t("help.background_reading", "Background reading."), "muted"));
    }
    var back = DOM.el(doc, "p", null, "muted"), b = doc.createElement("a");
    b.href = "#/help"; b.textContent = t("help.all_help_topics", "All help topics");
    back.appendChild(b); wrap.appendChild(back);
  }

  /* topicBody: joined English body for a topic key (locale/tooling seam).
   * Params: key string. Returns the "\n"-joined body or "". Pure. */
  function topicBody(key) {
    try {
      var arr = BODY_DEFAULTS[key] || [];
      return Array.isArray(arr) ? arr.join("\n") : String(arr);
    } catch (e) { return ""; }
  }

  return { renderHelp: renderHelp, renderCommunity: renderCommunity, TOPICS: TOPICS,
    _test: { topicBody: topicBody, GROUPS: GROUPS } };
})();

if (typeof module !== "undefined") { module.exports = HelpUI; }
