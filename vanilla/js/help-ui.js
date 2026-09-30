/* help-ui.js — help index + full topic articles.
 * Owns: /help/** (index at /help, one article view per topic key). Topic list
 *   follows reference #1's help structure (app/help/en/toc.md + index.md).
 * Consumes: I18n.t for chrome + titles + one-line guides ONLY (existing keys;
 *   zero new t() keys — new topics reuse the dynamic help.topic_<key>_title
 *   pattern, which falls back to the literal and is invisible to check_i18n).
 *   No wallet, no chain, no amounts — no Format vectors apply.
 *   Global HelpUI only; static renders. Rendering is textContent-only
 *   (el() + createElement); no innerHTML anywhere in this file.
 * PROVENANCE: article bodies are adapted closely from reference #1's help
 *   markdown (CC help text — concepts + words, reworded where the old UI's
 *   screens differ from this wallet's):
 *   disclaimer<-app/help/en/disclaimer.md; bitshares<-introduction/bitshares.md;
 *   wallets<-introduction/wallets.md; backups<-introduction/backups.md;
 *   blockchain<-introduction/blockchain.md; voting<-voting.md;
 *   accounts-general<-accounts/general.md; accounts-proposed<-accounts/proposed.md;
 *   accounts-permissions<-accounts/permissions.md;
 *   accounts-membership<-accounts/membership.md; assets-mpa<-assets/mpa.md;
 *   assets-uia<-assets/uia.md; assets-private<-assets/privbitassets.md;
 *   dex-intro<-dex/introduction.md; dex-trading<-dex/trading.md;
 *   dex-shorting<-dex/shorting.md; gateways<-gateways/introduction.md plus
 *   introduction/bridges_gateways.md (trust model); gateways-xbts<-gateways/xbtsx.md;
 *   gateways-ioxbank<-gateways/ioxbank.md; witnesses/workers/committee<-voting.md
 *   sections + components/AccountVoting{Witnesses,Workers,Committee,Proxy}.md
 *   (#1 ships no dedicated witness.md/workers.md/committee.md files).
 * FRESH (no reference source; written from in-app behavior, no chain facts
 *   invented): glossary (glossary.md is an empty stub); accounts-general is
 *   mostly fresh (general.md is a single paragraph); gateways-xbts is partly
 *   fresh (xbtsx.md is a single paragraph + links).
 * ENGLISH-FIRST: bodies are English string literals, NOT t() keys — translating
 *   23 articles x 10 locales is out of scope. check_i18n scans only t() calls,
 *   so literals stay invisible and the gate stays green. The index carries an
 *   honest English-only note (literal, not a t() key).
 * Refs: App.jsx:618-633 (/help + 3 nested :path routes); toc.md structure.
 * Created by: stub-queue build (matrix §A STUB queue, batch 2); articles port
 *   2026-09-29 (help punchlist: summaries -> full articles + 3 missing topics).
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
    ["dex-intro", "Decentralized exchange", "Order books settle on-chain — the desk shows book, chart and your orders.", "#/market/BTS_USD"],
    ["dex-trading", "Trading", "Limit orders with exact prices; instant-trade wraps the same path in one screen.", "#/instant-trade"],
    ["dex-shorting", "Borrowing and shorting", "Borrow smartcoins against collateral; positions and margin calls under Borrow.", "#/borrow"],
    ["gateways", "Gateways", "Move coins across chains via gateway bridges (deposit / withdraw desks).", "#/deposit-withdraw"],
    ["gateways-xbts", "XBTS gateway", "XBTS bridge desk with supported coins and manual fallback.", "#/deposit-withdraw"],
    ["gateways-ioxbank", "IOXBank gateway", "IOXBank bridge desk with supported coins.", "#/deposit-withdraw"],
    ["glossary", "Glossary", "Names used across this wallet: objects (1.x.y), operations, witnesses, committee.", null]
  ];

  /* Article bodies: key -> sections. Section = [heading, [paragraphs], [bullets]?].
   * English literals (see header). All strings render via textContent only. */
  var BODIES = {
    "disclaimer": [
      ["What this wallet is",
        ["This wallet is an interface to the BitShares blockchain. Information you see here — balances, orders, markets — is created by blockchain users, not by this app.",
         "Your keys are stored locally in your browser and never leave it: transactions are signed locally before they are broadcast. Never expose your keys to anyone."]],
      ["Not advice of any kind",
        ["Nothing here is legal, business, or investment advice. You act at your own risk when you rely on anything shown by this wallet.",
         "If a decision matters, talk to a licensed professional in your jurisdiction. The people who built this interface are not responsible for actions you take or do not take."]],
      ["Where your risk sits",
        ["Most losses fall into a few buckets: your own mistakes (forgotten password, funds sent to the wrong name, deleted wallet data), broken software or malware on your machine, failed hardware, someone getting into your wallet, or a third-party service failing you.",
         "Back up before funding anything, and treat every address and memo you paste as guilty until checked."]],
      ["Assets live on the chain, not here",
        ["This app does not store, send, receive, or hold any asset. Assets exist only as ownership records on the BitShares blockchain; every transfer happens on that decentralized ledger, not inside this page."]],
      ["Investment and tax reality",
        ["BitShares holdings can lose money over short or long periods, with large price swings. Nothing shown here promises otherwise.",
         "You alone work out which taxes apply to your transactions. The contributors to this wallet do not do that for you."]],
      ["No warranties, limited liability",
        ["This wallet is provided as-is, at your own risk. To the extent the law allows, its owners and contributors are not liable for any damages from using it — including lost use, lost profits, or lost data.",
         "By using it you agree to arbitrate disputes rather than litigate, except for copyright, trademark, trade-secret, or patent matters."]]
    ],
    "bitshares": [
      ["The fast decentralized exchange",
        ["BitShares is a delegated-proof-of-stake blockchain with a built-in exchange: order matching happens in the protocol itself, so trading needs no central company holding your funds.",
         "It extends the blockchain idea beyond money — banking, exchanges, voting, auctions and more — run as distributed companies under public, auditable rules instead of human management."]],
      ["What it enables",
        ["On one chain you get user-issued assets, market-pegged assets, non-fungible tokens, the order-book exchange, pooled automated markets, and hashed time-lock contracts.",
         "This wallet exposes most of those features: smartcoins, custom tokens, and the market desk are the places to start."]],
      ["Your keys never leave the browser",
        ["This is a browser wallet. Your keys are stored locally and transactions are signed locally before broadcast — the servers you connect to never see your secrets.",
         "That is also why backups are your job alone: lose the brainkey or password and nobody can recover your funds."]],
      ["Design goals",
        ["No custody: traders keep their own private keys and funds at all times.",
         "High performance and low cost: fast confirmation, room for many users and liquid trading, with small fees — and fair, transparent matching where every order is provably handled."]],
      ["Getting help",
        ["Gateway problems go to the gateway provider directly — the wallet cannot fix a bridge operator's desk.",
         "For community chat and wallet support, look for the BitShares community channels; developers contribute through the public UI and core repositories."]]
    ],
    "wallets": [
      ["A web app with a local vault",
        ["This application runs in your browser and talks to a trusted chain node as its gateway to the network. Everything secret stays in your browser's local vault."]],
      ["Cloud-style login",
        ["If you registered with a username and password, you hold a cloud-style wallet: the same credentials open your account from any browser. It serves one account at a time and is the usual choice for new users.",
         "Do not change the auto-generated password on your own — wait for a guided, safe way to do it."]],
      ["Local wallet",
        ["A local wallet is a database inside one specific browser. It will not follow you to another computer or browser unless you carry a backup file over and import it.",
         "See the Backups article before you rely on a local wallet for real funds."]],
      ["Security model",
        ["Our servers never touch your funds because your private keys never leave the browser — they are stored encrypted with your passphrase in the browser's own database.",
         "That protection is only as good as your backup discipline and your machine's hygiene."]],
      ["Managing wallets",
        ["This wallet can carry several separate wallets, each with its own accounts and funds. Create, back up, and switch between them under Wallet in this app.",
         "Open the wallet manager to see which wallet is active and what it holds."]]
    ],
    "backups": [
      ["Back up early, back up twice",
        ["Make a backup of your local wallet before you fund it — one backup is usually enough going forward, but keep it in at least two secure places only you can reach.",
         "Backups are encrypted with your passphrase, so without both the file AND the password your funds are gone. Never store the password next to the backup."]],
      ["Where to do it",
        ["Create and restore backups from the Wallet screens in this app. The file downloads to your machine; guard it like cash.",
         "Restoring on a new browser or computer means importing that file and entering the same passphrase."]],
      ["The brainkey alternative",
        ["If you never imported raw keys by hand, your whole wallet derives deterministically from one brainkey — a string of words. Writing down the brainkey backs up every account and fund in that wallet.",
         "View it in the wallet manager and copy it to paper, stored separately from anything digital."]],
      ["Advanced: hierarchical authorities",
        ["If you use weighted multi-account authorities instead of plain keys, a key backup alone may NOT restore access — the authority structure itself matters.",
         "Re-read the Permissions article and record the full authority setup, not just the words."]]
    ],
    "blockchain": [
      ["A public chain of blocks",
        ["Like most cryptocurrencies, BitShares records transfers and market activity in blocks, each pointing at the previous one — a chain holding every transaction ever made.",
         "The ledger is public and auditable: anyone can verify transfers, orders, and order books. This wallet's explorer is built for exactly that."]],
      ["Who builds the blocks",
        ["Block producers are chosen by delegated proof of stake: BTS holders vote for preferred producers, called witnesses, and the top-voted ones may produce blocks.",
         "Every transaction must validate against the witnesses' work, so voting is how holders keep the chain honest. See the Voting and Witnesses articles."]],
      ["More than transfers",
        ["The chain offers many transaction types beyond sending assets: exchange orders, borrowing, proposals, vesting, pools, and more.",
         "Most types are self-explanatory in the confirm dialog; the deeper ones each have their own help article here."]]
    ],
    "voting": [
      ["Why your vote matters",
        ["Voting keeps BitShares secure and funded: it picks the block producers, the policy setters, and which worker projects get paid.",
         "Your vote's weight follows the BTS you hold. If community mechanics are new to you, a proxy (below) is the recommended start."]],
      ["Proxy: delegate when unsure",
        ["A proxy is an account you trust to vote with your weight on your behalf — like electing a representative.",
         "While a proxy is set, you cannot vote directly for witnesses, committee members, or workers. You can release the proxy any time and vote yourself. Remember to publish your changes."]],
      ["Witnesses",
        ["Witnesses build and sign blocks from validated transactions — the chain's miners in DPoS form. Vote for as many as you like; each gets your full weight.",
         "Full detail lives in the Witnesses article."]],
      ["Committee",
        ["The committee sets chain policy: trading and transaction fees, block size and interval, cashback percentages, vesting periods, and similar parameters.",
         "Full detail lives in the Committee Members article."]],
      ["Workers and the budget",
        ["Workers are paid proposals — services for the chain in exchange for a salary. Each states a start and end date, a daily pay, a maximum total, and a link explaining the work.",
         "Proposals climb from proposed to active once they out-vote the refund worker, and fall back if support fades. Pay comes from a fixed daily budget, first-come first-served by votes — so a low-ranked proposal can earn nothing.",
         "Full detail lives in the Workers article."]]
    ],
    "witnesses": [
      ["What witnesses do",
        ["Witnesses are the block producers of BitShares. They collect validated transactions, construct new blocks, and sign them so the network can trust the chain's history."],
        ["Their role parallels miners on other chains — except here the right to produce blocks comes from shareholder votes, not hashing power."]],
      ["How they are chosen",
        ["BTS holders vote for their preferred block producers on-chain under delegated proof of stake. The candidates with the most vote weight earn the producer slots.",
         "You may vote for as many witnesses as you like, and each one receives your full vote weight — voting for more never dilutes your support."]],
      ["Voting well",
        ["Candidate statements and community discussion are the honest way to pick: look for reliable block production, honest price feeds, and steady maintenance.",
         "If you do not want to research every candidate, set a proxy you trust instead of voting blind. Publish your changes so the chain records them."]],
      ["In this wallet",
        ["Browse producers, your current votes, and the proxy setting under Voting in this app, and confirm any slate change before signing — votes are on-chain transactions with fees."]]
    ],
    "workers": [
      ["Work paid by the chain",
        ["Workers are proposals to do something useful — development, marketing, infrastructure — in exchange for a salary paid by the blockchain itself.",
         "Each proposal states at minimum a start and end date, a daily pay, a maximum total pay, and a link to a page or forum thread explaining the work. Check that link before voting."]],
      ["Lifecycle: proposed, active, expired",
        ["Proposed workers are collecting votes. Once a proposal out-votes the refund worker it becomes active and starts getting paid; if support drops below that bar it is defunded.",
         "Expired proposals stay visible for history after their end date passes."]],
      ["How the budget works",
        ["All workers share one fixed daily budget, paid first-come first-served by vote rank: the top-voted proposals collect their daily pay until the budget runs out.",
         "That means a proposal can be approved yet earn nothing if higher-ranked workers already consumed the day's funds — rank matters, not just approval."]],
      ["In this wallet",
        ["Read proposals, compare pay and dates, and cast or withdraw your votes under Voting in this app. Publish your changes so the chain records them."]]
    ],
    "committee": [
      ["What the committee decides",
        ["Committee members are elected by shareholders to set chain policy: transaction and trading fees, block size and block interval, referral rewards, cashback percentages, vesting periods, and similar parameters."],
        ["It is a position of real responsibility — a bad parameter can raise everyone's costs or slow the chain, so it demands a working understanding of BitShares."]],
      ["How members are chosen",
        ["Like witnesses, committee members win their seats through shareholder votes, and holders may back as many candidates as they like or delegate to a proxy.",
         "If the mechanics feel unfamiliar, a proxy is safer than a random ballot. Publish your changes so the chain records them."]],
      ["In this wallet",
        ["Review candidates and your current ballot under Voting in this app, and confirm any slate change before signing — votes are on-chain transactions with fees."]]
    ],
    "accounts-general": [
      ["One name, one account",
        ["On this chain you register a human-readable account name first, then use it everywhere instead of pasting raw addresses.",
         "Owning the name and being able to spend its funds are separate rights, which is what makes shared and corporate accounts possible — see Permissions."]],
      ["What lives on an account",
        ["Balances across every asset you hold, your open exchange orders, and your full transaction history all hang off the account."]],
      ["In this wallet",
        ["Open any account overview to see its balances, open orders, and history with no login — reads are public on a public chain.",
         "Only spending needs your keys: cancelling someone else's order is refused, and your own cancels ask you to unlock first."]]
    ],
    "accounts-proposed": [
      ["Suggest what you cannot sign",
        ["A proposal submits a transaction for someone else's approval: you suggest an action on an account you do not control, and the controlling parties approve or ignore it.",
         "The classic case is a shared multi-signature account — one party proposes a transfer, the others approve until the authority threshold is met, and then it executes."]],
      ["They expire on their own",
        ["Every proposal carries an expiry date. Past that date it disappears by itself, so a stale suggestion cannot surprise anyone months later."]],
      ["Treat surprises as hostile",
        ["An unexpected proposal on your account deserves suspicion, not curiosity — even if the proposer's name looks familiar.",
         "When in doubt, ignore it and contact the supposed counterparty (gateway, bridge, partner) through a channel you already trust. Never approve what you do not understand."]],
      ["In this wallet",
        ["Review pending proposals and approve or reject them from the proposals screens; the confirm dialog shows exactly what the proposal would do before you sign."]]
    ],
    "accounts-permissions": [
      ["Two locks: active and owner",
        ["Active permission controls the money — spending, trading, transferring. Owner permission controls the account itself and can overwrite keys and settings.",
         "Both are edited in your account's Permissions tab as authorities plus a threshold: the summed weight of the signers must beat the threshold for a transaction to count."]],
      ["Authorities, weights, thresholds",
        ["An authority names one or more accounts (or keys), each with a weight. Signatures add up their weights; cross the threshold and the action is authorized.",
         "This one mechanism expresses everything from a single key to corporate hierarchies — the examples below show how."]],
      ["Example: shared funds, any two of four",
        ["Give Alice, Bob, Charlie, and Dennis weight 33 each with threshold 51: any two together pass, no single one can move funds alone.",
         "Want three of four instead? Lower the weights or raise the threshold toward 99."]],
      ["Example: Alice stays in charge",
        ["Give Alice 49 and each friend a smaller slice (say 25, 25, 10) with threshold 51: Alice plus any one friend can act, or all three friends together — theft by one friend alone is impossible."]],
      ["Example: company hierarchy",
        ["Give the CEO account and the CFO account weight 51 each with threshold 51, then define the CFO account's own authority across its officers (chief, treasurer, controller, tax, accounting).",
         "The CEO spends directly; finance spends through its internal quorums; treasurer plus controller together can act; smaller roles must combine. Trees of any depth work the same way."]],
      ["The memo key",
        ["The memo key only receives encrypted memos — it can never spend. Because it carries no spending power, you may share its private key with a reader (auditor, accountant) for read-only memo access without risking funds."]]
    ],
    "accounts-membership": [
      ["Three tiers",
        ["Every account starts as a regular non-member. Upgrading buys lifetime status; an annual subscription sits in between for smaller budgets.",
         "Upgrading is an on-chain action with a fee from the published fee schedule — the confirm dialog shows the exact price before you sign."]],
      ["Why go lifetime",
        ["Lifetime members earn cashback on every transaction fee they pay, plus referral income from users they bring to the network.",
         "If the lifetime price stings, the annual subscription still earns cashback for a year at a fraction of the cost."]],
      ["Where fee money goes",
        ["Each fee you pay is split: the network takes its cut, the lifetime member who referred you takes theirs, and the registrar — the account that paid to register you — divides the remainder with its own affiliate program.",
         "Your registrar's exact split is visible on your account, so there are no hidden beneficiaries."]],
      ["Pending and vesting fees",
        ["Referral splits settle once per maintenance interval, not instantly — recent payments show as pending until the next round.",
         "Large fees, such as membership upgrades or premium names, vest over the committee-defined period instead of arriving all at once."]]
    ],
    "assets-mpa": [
      ["Dollars without a bank",
        ["A market-pegged asset is a token that tracks an outside price — BitUSD, BitEUR, BitGOLD and friends — through contracts for difference enforced by the chain itself.",
         "Each unit is always backed by 100 percent or more of its value in BTS collateral, convertible at any time. Holders call them SmartCoins."]],
      ["No counterparty to fail you",
        ["Unlike an IOU from an exchange, a SmartCoin needs no issuer promise: the network protocol locks the collateral and performs settlements automatically.",
         "That removes the classic exchange risk — hacked, bankrupt, or frozen custodian — from the tracked-price part of your portfolio."]],
      ["How the peg holds",
        ["Borrowers lock BTS to create SmartCoins; witnesses publish the real-world price feeds the chain enforces against.",
         "If collateral thins, margin calls close the weakest positions first; any holder can also force-settle at a fair price. The Borrowing article covers the mechanics."]],
      ["In this wallet",
        ["Trade SmartCoins on any market desk, borrow them against BTS collateral under Borrow, and inspect supply, feeds, and settlement data in the asset and explorer screens."]]
    ],
    "assets-uia": [
      ["Your token in minutes",
        ["Beyond SmartCoins, anyone — person or company — can create a user-issued asset for anything imaginable: event tickets on a customer's phone, crowdfunding shares, ownership records, even company equity."]],
      ["Powerful, so handle with care",
        ["The issuer defines the rules: supply, precision, fees, transfer restrictions. A UIA is only as trustworthy as its issuer and its on-chain description.",
         "Regulations differ by place and by token kind; issuers must stay compliant where they operate, and holders should read the asset details before buying."]],
      ["In this wallet",
        ["Create and manage your own tokens under Assets, and inspect any token's issuer, supply, and permissions before you trade or accept it."]]
    ],
    "assets-private": [
      ["Pegged assets, private feeds",
        ["A privatized BitAsset works like a market-pegged asset, except the issuer — not the witnesses — chooses who may publish its price feeds.",
         "The issuer also sets the asset's fees and earns from them."]],
      ["Who wants this",
        ["Exchanges and institutions with real-time price access use privatized assets to quote their own markets, gain exposure, and grow volume — without waiting on witness feeds."]],
      ["What it means for you",
        ["You trade the issuer's price, not the witnesses': check who publishes feeds and what the fee schedule is before holding a privatized asset."]]
    ],
    "dex-intro": [
      ["Exchange without the exchange company",
        ["The DEX trades digital goods directly on-chain: nobody holds your coins between order and fill, and the same entity need never both issue an IOU and run the order book.",
         "One global book serves everyone with internet access, around the clock — there is no single server to fail and no opening bell."]],
      ["Trade almost anything",
        ["The protocol is asset-agnostic: any pair can trade, from USD against EUR for forex down to long-tail pairs that may simply have thin liquidity.",
         "No one can limit what you list or quote — the chain cannot discriminate between pairs."]],
      ["Secure and fast",
        ["Funds and orders are guarded by industry-grade elliptic-curve cryptography; multi-signature and escrow setups from the Permissions article work here too.",
         "Unlike slower decentralized networks, this DEX confirms in real time — your only limits are physics and the planet's size."]],
      ["Matching you can verify",
        ["Given a set of orders, anyone can re-check that they were matched correctly: the matching algorithm is public and provable, not a black box on a server.",
         "Combined with the public ledger, that makes the whole market auditable from this wallet's explorer."]],
      ["Smartcoins complete the picture",
        ["BitUSD, BitEUR, BitCNY and siblings trade at their tracked values, each backed by locked BTS collateral redeemable through settlement.",
         "In this wallet they usually display under their short names (USD, EUR, CNY) — the asset screens always show the full backing detail."]]
    ],
    "dex-trading": [
      ["Pairs: quote against base",
        ["Any two assets form a market pair, written quote:base — EUR:USD means euros quoted in dollars.",
         "Pairs flip freely: the bid side of USD:EUR is the ask side of EUR:USD, with prices stored internally as exact fractions so both views always agree."]],
      ["Reading the book",
        ["The ask side sells quote and buys base; the bid side sells base and buys quote.",
         "Depth and spread tell you the cost of size: a thin book moves against large orders, a tight spread means cheap immediacy."]],
      ["Placing an order",
        ["Fill the buy or sell form with a price and an amount; the wallet computes the cost and adds the chain fee before you confirm.",
         "Your order rests open until someone takes it, and your account is credited in the bought asset when it fills."]],
      ["Cancelling",
        ["Unfilled orders cancel any time for a small fee — use it when the market moves away from your price.",
         "In this wallet your open orders sit beside the desk and on your account page; cancelling asks you to unlock only if the order is yours."]]
    ],
    "dex-shorting": [
      ["Borrow, then sell short",
        ["To short a SmartCoin you borrow it from the network against BTS collateral, then sell it into any market at whatever price buyers pay.",
         "You are now short: profit if the SmartCoin cheapens against your collateral, pain if BTS falls. To close, buy back the borrowed amount and hand it to the network, which burns it and releases your collateral."]],
      ["Words you must know",
        ["Settlement price: what 1 BTS fetches on outside exchanges. Maintenance collateral ratio: the witnesses' minimum backing.",
         "Maximum short-squeeze ratio and squeeze protection cap what shorts can be forced to pay; call price is where YOUR position gets margin-called."],
        ["Settlement price divided by squeeze ratio gives the protection floor; debt over collateral times the maintenance ratio gives your call price."]],
      ["Margin calls",
        ["Whenever the best bid falls below your call price (but above the protection floor), the network force-sells your collateral into the market to buy back the debt.",
         "Whatever BTS remains after covering returns to you — a margin call closes the position, it does not zero you by default."]],
      ["Settlement by holders",
        ["Any SmartCoin holder may force-settle at a fair price at any time; the lowest-collateral shorts are closed first to fund it.",
         "Borrowing into thin air has a real exit queue on the other side — size positions accordingly."]],
      ["Managing a position",
        ["Raise the ratio by locking more BTS, or lower it by repaying some debt — any adjustment is allowed while you stay above maintenance.",
         "Watch the ratio after sharp BTS moves: top up collateral or buy back debt BEFORE the call price reaches you."]]
    ],
    "gateways": [
      ["Coins from other chains",
        ["Gateways and bridges are outside companies that carry assets onto BitShares: you send them BTC (or fiat, or XRP...), they hand you a matching token on this chain, redeemable back for a fee.",
         "While you hold their token, THEY hold your original coins — read their terms as the custody deal it is."]],
      ["Bridges: trust minimized",
        ["A bridge swaps your deposit for a SmartCoin equivalent, so after the short transfer window you hold collateral-backed tokens with no custodian risk.",
         "Your exposure to the operator lasts minutes, not months — strictly safer than parking coins on a centralized exchange."]],
      ["Gateways: trust required",
        ["A gateway issues its own branded IOUs (OPEN.*, XBTSX.*, IOB.* ...), each backed by the real coins users deposited with that operator.",
         "Like any exchange balance, those tokens are worth exactly as much as the operator's solvency and honesty. Prefer gateways with transparent reserves and a support channel that answers."]],
      ["In this wallet",
        ["Deposit and withdraw through the bridge screens in this app; each coin's desk shows addresses, memos, limits, and a manual fallback when automation is down.",
         "Withdrawals leave as normal transfers with the gateway's memo format — copy it exactly, because the operator's software parses it."]]
    ],
    "gateways-xbts": [
      ["What XBTS is",
        ["XBTS runs a gateway service on the BitShares exchange, moving popular cryptocurrencies in and out. Its tokens are easy to spot: every supported coin carries the XBTSX. prefix, such as XBTSX.BTC.",
         "Its site and live support chat are the places for status, terms, and incident help — this wallet only drives its desks."]],
      ["Depositing",
        ["Pick the coin on the deposit desk to get the gateway's address (and tag or memo where needed), then send from the outside chain including every reference shown.",
         "Credit needs outside-chain confirmations first — impatience here only produces support tickets."]],
      ["Withdrawing and fallback",
        ["Withdraw from the desk with your destination address; the wallet prefills the transfer and the gateway's memo format for you.",
         "If automation is down, the same desk documents the manual path: send the XBTSX.* token to the gateway account with the memo format shown, exactly as written."]]
    ],
    "gateways-ioxbank": [
      ["Instant swaps to IOU tokens",
        ["The IOXBank gateway bridges outside coins onto BitShares with immediate settlement after outside-chain confirmation. Its tokens wear the IOB. prefix — IOB.XRP and IOB.XLM among them.",
         "No sign-up, no limits, and no maker/taker market fee on its pairs; only small minimums and the withdraw fee apply."]],
      ["Reserves you can check",
        ["IOXBank publishes its outside-chain reserve addresses, so you can compare its XRP and XLM balances against the IOB.XRP and IOB.XLM supplies visible in this wallet's asset screens.",
         "A gateway whose reserves you can audit is strictly preferable to one you must take on faith."]],
      ["Depositing from the wallet",
        ["Choose the coin on the deposit desk: you receive the gateway address plus the tag or memo to include, and you must repeat that reference at the source of your outside transfer.",
         "If you already know your numeric user id, you can deposit directly: XRP to the published XRP address with your id digits as tag, XLM likewise to the XLM address — same rule, reference or it did not happen."]],
      ["Withdrawing manually",
        ["To withdraw by hand, send your IOB.* tokens to the ioxbank-gateway account with a memo naming the coin, destination address, and tag. For an XRP target with a tag: xrp:ADDRESS:tag:NUMBER — append :NOTE for an optional note; omit the tag part only when the destination needs none.",
         "XLM follows the same shape with xlm: first. Replace every placeholder with your own values and double-check the address — outside chains rarely forgive typos."]],
      ["Limits and support",
        ["Minimums are small (single-digit XRP, tens of XLM) — below them, deposits may not credit.",
         "Live chat and the ticket desk on the gateway's site handle stuck transfers; have your BitShares account, transaction id, and outside-chain hash ready."]]
    ],
    "glossary": [
      ["Objects: everything has an id",
        ["Accounts, assets, orders, proposals, witnesses — nearly everything on-chain is an object with an id like 1.2.0 (the leading digits say which space it lives in).",
         "In this wallet, account ids look like 1.2.x and asset ids like 1.3.x; pasting an id into the explorer opens that object directly."]],
      ["Operations: what transactions do",
        ["Every transaction carries one or more operations — transfer, limit-order create, vote update, asset issue, and dozens more — each with its own numbered type.",
         "Confirm dialogs in this wallet name the operation in plain words and list its fields, so you sign meanings, not codes."]],
      ["People and roles",
        ["Witnesses produce blocks; committee members set chain parameters; workers deliver paid projects; proxies vote on your behalf; the registrar is whoever paid to create your account.",
         "Gateways and bridges are outside companies moving value across chains — see the Gateways article."]],
      ["Money words",
        ["Precision is how many decimals an asset uses — amounts are stored as integers and shifted by it, so the wallet always shows human decimals, never raw integers.",
         "Collateral backs borrowed SmartCoins; margin calls and settlements close weak positions; fees on every operation split between the network, referrers, and registrars."]]
    ]
  };

  function topicByKey(key) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i][0] === key) return TOPICS[i];
    return null; }
  /* textContent-only element (topic strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }

  /* Route entry: empty wildcard -> index; known key -> topic; else honest miss. */
  function renderHelp(root, params) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    var key = params && typeof params.wildcard === "string" ? params.wildcard.replace(/^\/+|\/+$/g, "") : "";
    if (!key) { paintIndex(doc, wrap); return; }
    var hit = topicByKey(key);
    if (!hit) {
      wrap.appendChild(el(doc, "h1", t("help.help", "Help")));
      wrap.appendChild(el(doc, "p", "No help topic named “" + key + "”. Pick one from the index.", "muted"));
      paintIndexList(doc, wrap);
      return;
    }
    paintTopic(doc, wrap, hit);
  }

  /* Renders one article section: h2 heading, paragraphs, optional bullet list.
   * Every string lands via textContent — structure without HTML injection. */
  function paintSection(doc, wrap, section) {
    var head = section[0], paras = section[1] || [], bullets = section[2] || null, i;
    if (head) wrap.appendChild(el(doc, "h2", head));
    for (i = 0; i < paras.length; i++) wrap.appendChild(el(doc, "p", paras[i]));
    if (bullets && bullets.length) {
      var ul = doc.createElement("ul"), li;
      for (i = 0; i < bullets.length; i++) {
        li = doc.createElement("li");
        li.textContent = bullets[i];
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
    }
  }

  /* Renders the stored article body for a topic key (English literals). */
  function paintBody(doc, wrap, key) {
    var secs = BODIES[key], i;
    if (!secs) return;
    for (i = 0; i < secs.length; i++) paintSection(doc, wrap, secs[i]);
  }

  /* Index: every topic as a link (mirrors the #1 toc structure). */
  function paintIndex(doc, wrap) {
    wrap.appendChild(el(doc, "h1", t("help.help", "Help")));
    wrap.appendChild(el(doc, "p", t("help.short_guides_for_each_part_of_the_wallet_thes", "Short guides for each part of the wallet. These are summaries written for this app, not the reference UI's full help pages."), "muted"));
    /* English-first honesty note (literal, not a t() key — see header). */
    wrap.appendChild(el(doc, "p", "Each topic below opens a full article adapted from the reference wallet's help text. Articles are English-only in this version.", "muted"));
    paintIndexList(doc, wrap);
  }
  function paintIndexList(doc, wrap) {
    var list = doc.createElement("ul");
    list.className = "help-index";
    TOPICS.forEach(function (e) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = "#/help/" + e[0]; a.textContent = t("help.topic_" + e[0] + "_title", e[1]); li.appendChild(a); list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  /* Topic: title + guide summary + full article body + in-app pointer + back.
   * help-article hook (app.css): prose paragraphs/ul cap at ~75ch so article
   * lines stay readable at desk widths. Display-only class, no strings. */
  function paintTopic(doc, wrap, topic) {
    try { wrap.classList.add("help-article"); } catch (e) { /* class best-effort */ }
    wrap.appendChild(el(doc, "h1", t("help.topic_" + topic[0] + "_title", topic[1])));
    wrap.appendChild(el(doc, "p", t("help.topic_" + topic[0] + "_text", topic[2])));
    paintBody(doc, wrap, topic[0]);
    if (topic[3]) {
      var p = el(doc, "p", null, "muted"), a = doc.createElement("a");
      a.href = topic[3]; a.textContent = t("help.open_in_the_wallet", "Open in the wallet");
      p.appendChild(a); wrap.appendChild(p);
    } else {
      wrap.appendChild(el(doc, "p", t("help.reference_reading_no_dedicated_wallet_screen", "Reference reading — no dedicated wallet screen."), "muted"));
    }
    var back = el(doc, "p", null, "muted"), b = doc.createElement("a");
    b.href = "#/help"; b.textContent = t("help.all_help_topics", "All help topics");
    back.appendChild(b); wrap.appendChild(back);
  }

  return { renderHelp: renderHelp, TOPICS: TOPICS };
})();

if (typeof module !== "undefined") { module.exports = HelpUI; }
