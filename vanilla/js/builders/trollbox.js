/* Trollbox: on-chain chat reads + post builder (op-35 custom_operation, sub-ids 9198/9199).
 * Owns: channel/lang catalog math, account_storage_map pack/unpack (hex),
 *   trollbox value decode, clean-text hardening, byte budget, plugin probe,
 *   get_storage_info pager (100/page by storage id), author enrichment,
 *   post-op builder (9199 only). No rendering, no signing, no broadcasting.
 * Consumes: Chain.custom/.db/.call (read-only, never owns the socket),
 *   TextEncoder/TextDecoder (platform). Side effects: none beyond the single
 *   `Trollbox` global (no DOM, no storage writes).
 * Created by: building-vanilla-slices skill, R1c trollbox plan (slice-14 delta).
 *
 * Provenance (per-file, mapping-chain-calls rule):
 * - Pack/unpack math + constants (TROLLBOX_OP_ID=9199, FORUM_OP_ID=9198,
 *   CUSTOM_OPERATION_ID=35, TEXT_MAX_CHARS=1024, MAX_KEY_SIZE=200,
 *   DEFAULT_MAX_TRANSACTION_SIZE=2048, TX_SIZE_RESERVE=256, catalog
 *   `trollbox-<channel>` / `trollbox-<channel>-<lang>`, channels/langs,
 *   pager limit 100, meta-catalog probe, cleanMessageText hardening,
 *   byte-budget maxMessageBytes, message-key shape) ported from
 *   reference/astro-ui/src/bts/serializer/customOperations.js +
 *   reference/astro-ui/src/nanoeffects/Trollbox.ts @ commit 5037d61
 *   (astro-ui main, v0.6.30). Hand-ported, no import: astro's ByteBuffer /
 *   types.js pack is re-expressed with local varint + UTF-8 helpers whose
 *   bytes are identical for our inputs (string = varint byte-len + UTF-8,
 *   bool = 1 byte, optional = 0x00 / 0x01+payload, map = varint count +
 *   entries, static_variant = varint 0 + payload).
 * - Op-35 wire order (fee)(payer)(required_auths)(id:u16)(data:bytes) from
 *   bitshares-core libraries/protocol/include/graphene/protocol/custom.hpp
 *   FC_REFLECT + operations.hpp:91 (op 35 = custom_operation); serializer
 *   itself lives in vanilla/js/tx.js (single exception for 9198/9199).
 * - get_storage_info(account,catalog,key,limit,start_id) param order from
 *   bitshares-core libraries/app/include/graphene/app/api.hpp:650-688.
 * - wallet-extension src/lib/bitshares-api.js serializeCustomOp confirms the
 *   same field order (fee, payer, set, u16 id, bytes).
 *
 * Scope (honest): text-only v1. Attachments (astro attach kinds
 * asset/pair/pool/offer/barter) are NOT built and NOT badged: posts with an
 * attach payload still READ (text renders, attach dropped to null, never raw
 * payload). Forum sub-id 9198 serializes (same op-35 path) but has no UI —
 * the trollbox desk posts 9199 only.
 */
var Trollbox = (function () {
  "use strict";

  /* Chain ids: op number + chat sub-ids. The plugin ignores the sub-id;
   * the constant keeps explorers filterable (astro convention). */
  var CUSTOM_OP_ID = 35;
  var TROLLBOX_OP_ID = 9199;
  var FORUM_OP_ID = 9198;

  /* Channels: astro TROLLBOX_CHANNELS verbatim (10). English keeps the
   * legacy unprefixed catalog; other langs suffix the code. */
  var CHANNELS = ["general", "announcements", "trading", "pools", "barter",
    "credit", "assets", "governance", "proposals", "dev"];
  var LANGS = ["en", "da", "de", "es", "et", "fr", "it", "ja", "ko", "pt", "th"];
  var META_CATALOG = "trollbox-meta";

  /* Limits: astro values verbatim. */
  var TEXT_MAX_CHARS = 1024;
  var MAX_KEY_SIZE = 200;
  var DEFAULT_MAX_TRANSACTION_SIZE = 2048;
  var TX_SIZE_RESERVE = 256;
  var PAGE_LIMIT = 100;
  var MAX_PAGES = 10;
  var TEXT_CAP = 4096;
  var POLL_MS = 15000;

  /* --- byte helpers (local copies so this module stays Tx-independent) --- */

  /* utf8Length: UTF-8 byte length of a string. Params: s (any, stringified).
   * Returns byte count. Fails: never (empty on missing encoder). */
  function utf8Length(s) {
    try {
      return new TextEncoder().encode(String(s)).length;
    } catch (e) {
      return String(s).length;
    }
  }

  /* encodeVarint: unsigned LEB128. Params: non-negative safe integer.
   * Returns Uint8Array. Fails: throws on non-integer/negative. */
  function encodeVarint(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("varint needs a non-negative safe integer, got: " + String(value).slice(0, 32));
    }
    var v = value, out = [];
    while (v >= 0x80) { out.push((v & 0x7F) | 0x80); v = Math.floor(v / 128); }
    out.push(v);
    return new Uint8Array(out);
  }

  /* concat: join Uint8Array parts. Params: array. Returns Uint8Array. */
  function concat(arrays) {
    var total = 0, i;
    for (i = 0; i < arrays.length; i++) total += arrays[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < arrays.length; i++) { out.set(arrays[i], off); off += arrays[i].length; }
    return out;
  }

  /* encodeString: varint byte-len + UTF-8 (astro types.string equivalent).
   * Params: s (string). Returns Uint8Array. */
  function encodeString(s) {
    var bytes;
    try {
      bytes = new TextEncoder().encode(String(s));
    } catch (e) {
      throw new Error("trollbox string needs encodable text");
    }
    return concat([encodeVarint(bytes.length), bytes]);
  }

  /* hexToBytes: even-length hex -> bytes. Throws on bad input. */
  function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error("bad hex string");
    }
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  /* bytesToHex: bytes -> lowercase hex. */
  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  /* --- catalog / channel / lang math (astro Trollbox.ts verbatim rules) --- */

  /* normalizeLang: supported code or "en". Params: any. Returns code. */
  function normalizeLang(value) {
    return (typeof value === "string" && LANGS.indexOf(value) !== -1) ? value : "en";
  }

  /* isSupportedLang: true when the code is a known content lang. */
  function isSupportedLang(value) {
    return typeof value === "string" && LANGS.indexOf(value) !== -1;
  }

  /* isPairRoom: "pair-<min>-<max>" numeric rooms (astro pattern). */
  function isPairRoom(channelId) {
    return typeof channelId === "string" && /^pair-\d+-\d+$/.test(channelId);
  }

  /* isValidChannel: known channel id or pair room. Params: any. */
  function isValidChannel(channelId) {
    return typeof channelId === "string" &&
      (CHANNELS.indexOf(channelId) !== -1 || isPairRoom(channelId));
  }

  /* trollboxCatalog: legacy unprefixed catalog for English, suffixed else.
   * Params: channelId string, lang string. Returns catalog string. */
  function trollboxCatalog(channelId, lang) {
    var normalized = normalizeLang(lang);
    return normalized === "en"
      ? "trollbox-" + channelId
      : "trollbox-" + channelId + "-" + normalized;
  }

  /* maxMessageBytes: chain-budget minus framing reserve, floor 256.
   * Params: maxTransactionSize (number, default 2048). Returns byte budget. */
  function maxMessageBytes(maxTransactionSize) {
    var size = (maxTransactionSize === undefined || maxTransactionSize === null)
      ? DEFAULT_MAX_TRANSACTION_SIZE : Number(maxTransactionSize);
    var budget = (Number.isFinite(size) ? size : DEFAULT_MAX_TRANSACTION_SIZE) - TX_SIZE_RESERVE;
    return Math.max(256, budget);
  }

  /* storageIdNum: numeric suffix of a "7.0.x" storage id. Unparseable -> -1. */
  function storageIdNum(id) {
    var tail = String(id == null ? "" : id).split(".").pop();
    if (tail === "" || tail === undefined) return -1;
    if (!/^\d+$/.test(tail)) return -1;
    var n = Number(tail);
    return Number.isFinite(n) ? n : -1;
  }

  /* isPluginMissingError: true when the failure means "no custom_operations
   * plugin on this node" (astro list verbatim). Params: any error. */
  function isPluginMissingError(error) {
    var msg = "";
    try {
      msg = String((error && error.message) || (error && error.data && error.data.message) || error || "");
    } catch (e) { msg = String(error); }
    return (/custom_operations API not available/i.test(msg) ||
      /method not found/i.test(msg) ||
      /-32601/.test(msg) ||
      /custom_operations plugin is not enabled/i.test(msg) ||
      /access denied/i.test(msg) ||
      /is_allowed/i.test(msg) ||
      /account_storage/i.test(msg) ||
      /unknown (index|object)|index not found|no such index/i.test(msg));
  }

  /* cleanMessageText: strip all markup so messages render as inert plain
   * text (astro DOMPurify ALLOWED_TAGS [] equivalent, minus the dep).
   * The view ALSO uses textContent only — belt and braces. Params: any.
   * Returns plain string ("" for null/undefined). Fails: never throws. */
  function cleanMessageText(input) {
    if (input === null || input === undefined) return "";
    var s;
    try { s = String(input); } catch (e) { return ""; }
    try {
      s = s.replace(/<[^>]*>/g, "");
      if (typeof document !== "undefined" && typeof document.createElement === "function") {
        var ta = document.createElement("textarea");
        ta.innerHTML = s;
        return ta.value;
      }
      return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    } catch (e) {
      return String(input);
    }
  }

  /* --- account_storage_map pack / unpack (astro customOperations.js port) --- */

  /* assertCatalog/assertKey: non-empty strings within MAX_KEY_SIZE. */
  function assertCatalog(catalog) {
    if (typeof catalog !== "string" || catalog.length === 0) {
      throw new Error("trollbox catalog must be a non-empty string");
    }
    if (catalog.length > MAX_KEY_SIZE) {
      throw new Error("trollbox catalog exceeds " + MAX_KEY_SIZE + " chars");
    }
  }
  function assertKey(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("trollbox message key must be a non-empty string");
    }
    if (key.length > MAX_KEY_SIZE) {
      throw new Error("trollbox message key exceeds " + MAX_KEY_SIZE + " chars");
    }
  }

  /* packAccountStorageMap: {remove, catalog, entries:[[k,v],...]} -> hex of
   * fc::raw::pack(custom_plugin_operation) = varint 0 + account_storage_map
   * (remove:bool)(catalog:string)(key_values:map<string,optional<string>>).
   * Params per astro buildTrollboxData path. Returns hex string. */
  function packAccountStorageMap(args) {
    args = args || {};
    var remove = !!args.remove;
    var catalog = args.catalog;
    var entries = args.entries;
    assertCatalog(catalog);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("trollbox entries must be a non-empty array of [key, value] pairs");
    }
    for (var i = 0; i < entries.length; i++) {
      var pair = entries[i];
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new Error("trollbox entries must be [key, value] pairs");
      }
      assertKey(pair[0]);
      if (typeof pair[1] !== "string") {
        throw new Error("trollbox entry values must be strings (JSON-encoded)");
      }
    }
    var parts = [encodeVarint(0), new Uint8Array([remove ? 1 : 0]), encodeString(catalog)];
    parts.push(encodeVarint(entries.length));
    for (var k = 0; k < entries.length; k++) {
      parts.push(encodeString(entries[k][0]));
      parts.push(concat([new Uint8Array([1]), encodeString(entries[k][1])]));
    }
    return bytesToHex(concat(parts));
  }

  /* ByteReader: minimal LE reader over Uint8Array for unpack. */
  function ByteReader(bytes) {
    this.b = bytes;
    this.off = 0;
  }
  ByteReader.prototype.readVarint = function () {
    var shift = 0, result = 0;
    for (;;) {
      if (this.off >= this.b.length) throw new Error("trollbox unpack: truncated varint");
      var byte = this.b[this.off++];
      result += (byte & 0x7F) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 53) throw new Error("trollbox unpack: varint overflow");
    }
    if (!Number.isSafeInteger(result)) throw new Error("trollbox unpack: varint overflow");
    return result;
  };
  ByteReader.prototype.readBytes = function (n) {
    if (n < 0 || this.off + n > this.b.length) throw new Error("trollbox unpack: truncated bytes");
    var out = this.b.slice(this.off, this.off + n);
    this.off += n;
    return out;
  };
  ByteReader.prototype.readString = function () {
    var n = this.readVarint();
    var bytes = this.readBytes(n);
    try {
      return new TextDecoder().decode(bytes);
    } catch (e) {
      throw new Error("trollbox unpack: bad UTF-8 string");
    }
  };

  /* unpackCustomPluginData: hex -> {remove, catalog, entries:[{key,value}]}
   * or null when not a clean custom_plugin_operation (trailing garbage,
   * unknown variant, decode error — astro null rules verbatim). */
  function unpackCustomPluginData(hex) {
    if (typeof hex !== "string" || hex.length === 0) return null;
    var r, which, remove, catalog, count, entries;
    try {
      r = new ByteReader(hexToBytes(hex));
      which = r.readVarint();
      if (which !== 0) return null;
      var flag = r.readBytes(1)[0];
      if (flag !== 0 && flag !== 1) return null;
      remove = (flag === 1);
      catalog = r.readString();
      count = r.readVarint();
      entries = [];
      for (var i = 0; i < count; i++) {
        var k = r.readString();
        var present = r.readBytes(1)[0];
        if (present !== 0 && present !== 1) return null;
        var v = (present === 1) ? r.readString() : null;
        entries.push({ key: k, value: v });
      }
      if (r.off !== r.b.length) return null;
    } catch (e) {
      return null;
    }
    if (!catalog) return null;
    return { remove: remove, catalog: catalog, entries: entries };
  }

  /* buildMessageKey: unique per-(account,catalog) key. Params: nowMs, rand
   * (both optional — defaults mirror astro Date.now + 24-bit random). */
  function buildMessageKey(nowMs, rand) {
    var t = (nowMs === undefined || nowMs === null) ? Date.now() : nowMs;
    var r = (rand === undefined || rand === null) ? Math.floor(Math.random() * 0xffffff) : rand;
    if (!Number.isSafeInteger(t) || t < 0) throw new Error("trollbox key needs a non-negative timestamp");
    if (!Number.isInteger(r) || r < 0 || r > 0xffffff) throw new Error("trollbox key needs a 24-bit random");
    var hex = r.toString(16);
    while (hex.length < 6) hex = "0" + hex;
    return String(t) + "-" + hex;
  }

  /* buildTrollboxData: chat message -> custom_operation.data hex. The stored
   * value is a JSON string {v:1,ch,u,ln,text} (v:2 when attach — never built
   * here). Size enforced in UTF-8 bytes against maxBytes. NOTE: no timestamp
   * stored — ordering uses the plugin storage id (astro rule). */
  function buildTrollboxData(args) {
    args = args || {};
    var text = args.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("message text is empty");
    var trimmed = text.trim();
    if (trimmed.length > TEXT_MAX_CHARS) {
      throw new Error("message is " + (trimmed.length - TEXT_MAX_CHARS) + " chars over the 1024-character limit");
    }
    if (args.attach !== null && args.attach !== undefined) {
      throw new Error("trollbox attachments not supported in vanilla v1 (text only)");
    }
    var lang = (typeof args.lang === "string" && /^[a-z]{2}$/.test(args.lang)) ? args.lang : "en";
    var valueObj = { v: 1, ch: args.channel, u: args.username, ln: lang, text: trimmed };
    if (typeof valueObj.ch !== "string" || !valueObj.ch) throw new Error("trollbox channel is required");
    if (typeof valueObj.u !== "string" || !valueObj.u) throw new Error("trollbox username is required");
    var value = JSON.stringify(valueObj);
    var maxBytes = (args.maxBytes === undefined || args.maxBytes === null) ? maxMessageBytes() : args.maxBytes;
    if (utf8Length(value) > maxBytes) {
      throw new Error("message is " + (utf8Length(value) - maxBytes) + " bytes over the size limit (" + maxBytes + " bytes)");
    }
    assertKey(args.key);
    return packAccountStorageMap({ remove: false, catalog: args.catalog, entries: [[args.key, value]] });
  }

  /* decodeTrollboxValue: account_storage_object -> normalized message or
   * null for non-trollbox payloads. The plugin parses our JSON-string values
   * into objects — tolerate both. Attach payloads decode to attach:null
   * (text renders, no badge — v1 downscope, never raw payload). */
  function decodeTrollboxValue(storageObject) {
    if (!storageObject || typeof storageObject !== "object") return null;
    var raw = storageObject.value;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (e) { return null; }
    }
    if (!raw || typeof raw !== "object" || typeof raw.text !== "string") return null;
    return {
      id: storageObject.id,
      account: storageObject.account,
      catalog: storageObject.catalog,
      key: storageObject.key,
      author: (typeof raw.u === "string") ? raw.u : null,
      channel: (typeof raw.ch === "string") ? raw.ch : null,
      text: raw.text,
      attach: null
    };
  }

  /* --- chain reads (via the sole Chain module — never a socket here) --- */

  /* probe: minimal get_storage_info on the meta catalog. Never throws:
   * {supported:true} live, {supported:false,reason:"missing"} plugin-less,
   * {supported:false,reason:"error"} unreachable/other. */
  async function probe() {
    var customId;
    try {
      customId = await Chain.custom();
    } catch (e) {
      return isPluginMissingError(e)
        ? { supported: false, reason: "missing" }
        : { supported: false, reason: "error" };
    }
    try {
      await Chain.call(customId, "get_storage_info", [null, META_CATALOG, null, 1]);
      return { supported: true };
    } catch (e) {
      return isPluginMissingError(e)
        ? { supported: false, reason: "missing" }
        : { supported: false, reason: "error" };
    }
  }

  /* fetchChannelMessages: every message under a catalog, paginating
   * get_storage_info (limit 100) by storage id. Throws on transport errors
   * (caller maps plugin-missing to the honest empty state). Returns newest
   * first by storage id with displayAuthor filled best-effort. */
  async function fetchChannelMessages(catalog, maxPages) {
    assertCatalog(catalog);
    var pages = (maxPages === undefined || maxPages === null) ? MAX_PAGES : maxPages;
    var customId = await Chain.custom();
    var out = [], seen = {}, startId = null, pageCount = 0;
    for (;;) {
      var params = (startId !== null)
        ? [null, catalog, null, PAGE_LIMIT, startId]
        : [null, catalog, null, PAGE_LIMIT];
      var res = await Chain.call(customId, "get_storage_info", params);
      if (!Array.isArray(res) || res.length === 0) break;
      for (var i = 0; i < res.length; i++) {
        var o = res[i];
        if (!o || !o.id || seen[o.id]) continue;
        seen[o.id] = true;
        var decoded = decodeTrollboxValue(o);
        if (!decoded) continue;
        var channel = (typeof decoded.channel === "string" && isValidChannel(decoded.channel))
          ? decoded.channel : null;
        var author = cleanMessageText(decoded.author);
        out.push({
          id: decoded.id,
          account: decoded.account,
          catalog: decoded.catalog,
          key: decoded.key,
          author: author,
          channel: channel,
          text: cleanMessageText(decoded.text).slice(0, TEXT_CAP),
          displayAuthor: author || decoded.account,
          isLtm: false
        });
      }
      if (res.length < PAGE_LIMIT) break;
      startId = res[res.length - 1].id;
      pageCount++;
      if (pageCount >= pages) break;
    }
    out.sort(function (a, b) { return storageIdNum(b.id) - storageIdNum(a.id); });
    /* Best-effort author names: 1.2.x ids -> account names (max 100). */
    try {
      var ids = [], have = {};
      for (var j = 0; j < out.length; j++) {
        var aid = out[j].account;
        if (typeof aid === "string" && aid && !have[aid]) { have[aid] = true; ids.push(aid); }
        if (ids.length >= 100) break;
      }
      if (ids.length > 0) {
        var dbId = await Chain.db();
        var accounts = await Chain.call(dbId, "get_accounts", [ids]);
        var names = {};
        for (var k = 0; k < (accounts || []).length; k++) {
          var a = accounts[k];
          if (a && typeof a.id === "string" && typeof a.name === "string" && a.name) names[a.id] = a.name;
        }
        for (var m = 0; m < out.length; m++) {
          var nm = names[out[m].account];
          out[m].displayAuthor = cleanMessageText(nm !== undefined ? nm : (out[m].author || out[m].account));
        }
      }
    } catch (e) { /* embedded/raw ids stand */ }
    return out;
  }

  /* fetchMaxMessageBytes: live budget from global properties
   * parameters.maximum_transaction_size. Falls back to the protocol default
   * when unreadable — never throws (budget always defined). */
  async function fetchMaxMessageBytes() {
    try {
      var dbId = await Chain.db();
      var props = await Chain.call(dbId, "get_global_properties", []);
      var maxTx = props && props.parameters ? Number(props.parameters.maximum_transaction_size) : NaN;
      if (Number.isFinite(maxTx) && maxTx > 0) return maxMessageBytes(maxTx);
    } catch (e) { /* default below */ }
    return maxMessageBytes(DEFAULT_MAX_TRANSACTION_SIZE);
  }

  /* buildPost: validated op-35 chat payload for the trollbox desk.
   * Params: {payerId ("1.2.N"), username, channel, lang, text, maxBytes}.
   * Returns {opData, catalog, key, valueBytes}. Throws loudly on any bad
   * input (never a silent empty post). Attachments rejected (v1 text-only). */
  function buildPost(args) {
    args = args || {};
    var payerId = args.payerId;
    if (typeof payerId !== "string" || !/^1\.2\.\d+$/.test(payerId)) {
      throw new Error("trollbox payer must be an account id (1.2.N), got: " + JSON.stringify(payerId));
    }
    if (typeof args.username !== "string" || !args.username) {
      throw new Error("trollbox username is required");
    }
    if (!isValidChannel(args.channel)) {
      throw new Error("unknown trollbox channel: " + JSON.stringify(args.channel));
    }
    var lang = normalizeLang(args.lang);
    var catalog = trollboxCatalog(args.channel, lang);
    var key = buildMessageKey(args.nowMs, args.rand);
    var maxBytes = (args.maxBytes === undefined || args.maxBytes === null)
      ? maxMessageBytes() : args.maxBytes;
    var data = buildTrollboxData({
      channel: args.channel, catalog: catalog, key: key,
      username: args.username, text: args.text, lang: lang, maxBytes: maxBytes
    });
    return {
      opData: {
        fee: { amount: 0, asset_id: "1.3.0" },
        payer: payerId,
        required_auths: [payerId],
        id: TROLLBOX_OP_ID,
        data: data
      },
      catalog: catalog,
      key: key,
      valueBytes: utf8Length(JSON.stringify({ v: 1 }))
    };
  }

  return {
    CUSTOM_OP_ID: CUSTOM_OP_ID,
    TROLLBOX_OP_ID: TROLLBOX_OP_ID,
    FORUM_OP_ID: FORUM_OP_ID,
    CHANNELS: CHANNELS.slice(),
    LANGS: LANGS.slice(),
    META_CATALOG: META_CATALOG,
    TEXT_MAX_CHARS: TEXT_MAX_CHARS,
    MAX_KEY_SIZE: MAX_KEY_SIZE,
    DEFAULT_MAX_TRANSACTION_SIZE: DEFAULT_MAX_TRANSACTION_SIZE,
    TX_SIZE_RESERVE: TX_SIZE_RESERVE,
    PAGE_LIMIT: PAGE_LIMIT,
    MAX_PAGES: MAX_PAGES,
    TEXT_CAP: TEXT_CAP,
    POLL_MS: POLL_MS,
    utf8Length: utf8Length,
    encodeVarint: encodeVarint,
    bytesToHex: bytesToHex,
    hexToBytes: hexToBytes,
    normalizeLang: normalizeLang,
    isSupportedLang: isSupportedLang,
    isPairRoom: isPairRoom,
    isValidChannel: isValidChannel,
    trollboxCatalog: trollboxCatalog,
    maxMessageBytes: maxMessageBytes,
    storageIdNum: storageIdNum,
    isPluginMissingError: isPluginMissingError,
    cleanMessageText: cleanMessageText,
    packAccountStorageMap: packAccountStorageMap,
    unpackCustomPluginData: unpackCustomPluginData,
    buildMessageKey: buildMessageKey,
    buildTrollboxData: buildTrollboxData,
    decodeTrollboxValue: decodeTrollboxValue,
    probe: probe,
    fetchChannelMessages: fetchChannelMessages,
    fetchMaxMessageBytes: fetchMaxMessageBytes,
    buildPost: buildPost
  };
})();

if (typeof module !== "undefined") { module.exports = Trollbox; }
