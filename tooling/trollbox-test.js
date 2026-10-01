#!/usr/bin/env node
/* trollbox-test.js — offline unit proofs for the R1c on-chain trollbox slice.
 *
 * What it owns: stdlib-only checks that vanilla/js/trollbox.js (pack/unpack,
 *   catalog math, budget, decode, clean-text, probe-error map, pager cursor,
 *   post builder) + the tx.js op-35 chat exception (9198/9199 only) implement
 *   the task contract with zero network, zero keys, zero float money math.
 * Consumes: vanilla/js/trollbox.js + vanilla/js/tx.js (require — offline;
 *   stubbed Chain global for the pager vector only, no socket).
 * Side effects: none (prints FAIL lines, summary, exit 0 green / 1 red).
 * Created by: R1c trollbox task (slice-14 delta).
 */
"use strict";

const TB_PATH = "/workspace/vanilla/js/trollbox.js";
const TX_PATH = "/workspace/vanilla/js/tx.js";

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}
function throwsRe(fn, re, name) {
  try { fn(); } catch (e) {
    ok(re.test((e && e.message) || ""), name, "got: " + ((e && e.message) || e));
    return;
  }
  ok(false, name, "did not throw");
}

const TB = require(TB_PATH);
const Tx = require(TX_PATH);

(async function main() {
  /* 1. Constants (astro @5037d61 verbatim). */
  ok(TB.CUSTOM_OP_ID === 35, "const: CUSTOM_OP_ID 35");
  ok(TB.TROLLBOX_OP_ID === 9199, "const: TROLLBOX_OP_ID 9199");
  ok(TB.FORUM_OP_ID === 9198, "const: FORUM_OP_ID 9198");
  ok(TB.TEXT_MAX_CHARS === 1024, "const: TEXT_MAX_CHARS 1024");
  ok(TB.PAGE_LIMIT === 100, "const: PAGE_LIMIT 100");
  ok(TB.POLL_MS === 15000, "const: POLL_MS 15000");
  ok(TB.META_CATALOG === "trollbox-meta", "const: META_CATALOG");
  ok(Array.isArray(TB.CHANNELS) && TB.CHANNELS.length === 10 && TB.CHANNELS[0] === "general", "const: 10 channels");
  ok(Array.isArray(TB.LANGS) && TB.LANGS.indexOf("en") !== -1 && TB.LANGS.length === 11, "const: 11 langs");

  /* 2. Catalog math (English legacy + lang suffix). */
  ok(TB.trollboxCatalog("general", "en") === "trollbox-general", "catalog: en legacy");
  ok(TB.trollboxCatalog("general", "de") === "trollbox-general-de", "catalog: de suffix");
  ok(TB.trollboxCatalog("trading", "xx") === "trollbox-trading", "catalog: unknown lang -> en");
  ok(TB.normalizeLang("de") === "de" && TB.normalizeLang("xx") === "en", "normalizeLang");
  ok(TB.isValidChannel("general") === true, "channel: general valid");
  ok(TB.isValidChannel("pair-0-31") === true, "channel: pair room valid");
  ok(TB.isValidChannel("#announcements") === false, "channel: spoof tag rejected");
  ok(TB.isValidChannel("") === false, "channel: empty rejected");

  /* 3. Byte budget. */
  ok(TB.maxMessageBytes(2048) === 1792, "budget: 2048 -> 1792");
  ok(TB.maxMessageBytes() === 1792, "budget: default 1792");
  ok(TB.maxMessageBytes(300) === 256, "budget: floor 256");
  ok(TB.maxMessageBytes(NaN) === 1792, "budget: NaN -> default");
  ok(TB.utf8Length("hello") === 5, "utf8: ascii");
  ok(TB.utf8Length("日本語") === 9, "utf8: multibyte");

  /* 4. Pack/unpack round-trip. */
  const key = "1700000000000-abcdef";
  const val = JSON.stringify({ v: 1, ch: "general", u: "alice", ln: "en", text: "hello chain" });
  const hex = TB.packAccountStorageMap({ remove: false, catalog: "trollbox-general", entries: [[key, val]] });
  ok(typeof hex === "string" && hex.length > 0 && hex.length % 2 === 0, "pack: hex shape");
  const un = TB.unpackCustomPluginData(hex);
  ok(un !== null && un.remove === false && un.catalog === "trollbox-general", "unpack: catalog/remove");
  ok(un && un.entries.length === 1 && un.entries[0].key === key && un.entries[0].value === val, "round-trip: key+value match");
  /* UTF-8 + remove=true round-trip. */
  const hex2 = TB.packAccountStorageMap({ remove: true, catalog: "trollbox-general-de", entries: [["k-日本語", "v-✓"]] });
  const un2 = TB.unpackCustomPluginData(hex2);
  ok(un2 !== null && un2.remove === true && un2.entries[0].key === "k-日本語", "round-trip: utf8 + remove");
  /* Unpack rejections (astro null rules). */
  ok(TB.unpackCustomPluginData("") === null, "unpack: empty null");
  ok(TB.unpackCustomPluginData("zz") === null, "unpack: bad hex null");
  ok(TB.unpackCustomPluginData("01" + hex.slice(2)) === null, "unpack: variant 1 null");
  ok(TB.unpackCustomPluginData(hex + "00") === null, "unpack: trailing garbage null");
  throwsRe(() => TB.packAccountStorageMap({ remove: false, catalog: "", entries: [[key, val]] }), /catalog/, "pack: empty catalog throws");
  throwsRe(() => TB.packAccountStorageMap({ remove: false, catalog: "c", entries: [] }), /non-empty array/, "pack: empty entries throws");
  throwsRe(() => TB.packAccountStorageMap({ remove: false, catalog: "c", entries: [["k", 42]] }), /must be strings/, "pack: non-string value throws");

  /* 5. Message key shape. */
  const mk = TB.buildMessageKey(1700000000000, 0xabcdef);
  ok(mk === "1700000000000-abcdef", "key: deterministic shape, got " + mk);
  ok(/^\d+-[0-9a-f]{6}$/.test(TB.buildMessageKey()), "key: random shape");

  /* 6. buildTrollboxData guards. */
  const dh = TB.buildTrollboxData({ channel: "general", catalog: "trollbox-general", key: "k1", username: "alice", text: " hi ", lang: "en", maxBytes: 1792 });
  ok(typeof dh === "string" && dh.length > 0, "buildData: ok");
  throwsRe(() => TB.buildTrollboxData({ channel: "general", catalog: "c", key: "k", username: "a", text: "   ", maxBytes: 1792 }), /empty/, "buildData: blank throws");
  throwsRe(() => TB.buildTrollboxData({ channel: "general", catalog: "c", key: "k", username: "a", text: "x".repeat(1025), maxBytes: 1792 }), /1024/, "buildData: over-chars throws");
  throwsRe(() => TB.buildTrollboxData({ channel: "general", catalog: "c", key: "k", username: "a", text: "hello", maxBytes: 10 }), /over the size limit/, "buildData: over-bytes throws");
  throwsRe(() => TB.buildTrollboxData({ channel: "general", catalog: "c", key: "k", username: "a", text: "hi", attach: { t: "x" }, maxBytes: 1792 }), /attachments not supported/, "buildData: attach throws");

  /* 7. decodeTrollboxValue. */
  const so1 = { id: "7.0.9", account: "1.2.5", catalog: "trollbox-general", key: "k", value: val };
  const d1 = TB.decodeTrollboxValue(so1);
  ok(d1 !== null && d1.text === "hello chain" && d1.author === "alice" && d1.channel === "general" && d1.attach === null, "decode: string value");
  const so2 = { id: "7.0.10", account: "1.2.5", catalog: "c", key: "k", value: { v: 1, ch: "general", u: "b", text: "t2" } };
  ok(TB.decodeTrollboxValue(so2) !== null && TB.decodeTrollboxValue(so2).text === "t2", "decode: object value");
  ok(TB.decodeTrollboxValue({ id: "7.0.1", value: "not json" }) === null, "decode: bad json null");
  ok(TB.decodeTrollboxValue({ id: "7.0.1", value: JSON.stringify({ v: 1 }) }) === null, "decode: missing text null");
  ok(TB.decodeTrollboxValue(null) === null, "decode: null null");

  /* 8. cleanMessageText hardening. */
  ok(TB.cleanMessageText('<script>alert(1)</script>hi') === "alert(1)hi", "clean: strips tags");
  ok(TB.cleanMessageText(null) === "" && TB.cleanMessageText(undefined) === "", "clean: null -> empty");
  ok(TB.cleanMessageText('<a href="x">link</a>') === "link", "clean: strips link, no linkify");

  /* 9. storageIdNum + plugin-error map. */
  ok(TB.storageIdNum("7.0.123") === 123, "idnum: 123");
  ok(TB.storageIdNum("bogus") === -1, "idnum: bogus -1");
  ok(TB.isPluginMissingError(new Error("method not found")) === true, "plugerr: method-not-found");
  ok(TB.isPluginMissingError(new Error("foobar -32601 baz")) === true, "plugerr: -32601");
  ok(TB.isPluginMissingError(new Error("custom_operations plugin is not enabled")) === true, "plugerr: not-enabled");
  ok(TB.isPluginMissingError(new Error("call timeout: get_storage_info")) === false, "plugerr: timeout is error, not missing");

  /* 10. tx.js op-35 chat exception. */
  const opData = { fee: { amount: "0", asset_id: "1.3.0" }, payer: "1.2.5", required_auths: ["1.2.5"], id: 9199, data: dh };
  const bytes = Tx._ser.serializeCustomTrollboxOp(opData);
  const hx = Tx._ser.bytesToHex(bytes);
  ok(hx.indexOf("05" + "01" + "05" + "ef23") !== -1, "op35: payer/auths/9199-LE present, got ..." + hx.slice(0, 40));
  const opForum = { fee: { amount: "0", asset_id: "1.3.0" }, payer: "1.2.5", required_auths: ["1.2.5"], id: 9198, data: dh };
  const hxF = Tx._ser.bytesToHex(Tx._ser.serializeCustomTrollboxOp(opForum));
  ok(hxF.indexOf("ee23") !== -1, "op35: forum 9198 encodes");
  throwsRe(() => Tx._ser.serializeCustomTrollboxOp({ fee: { amount: "0", asset_id: "1.3.0" }, payer: "1.2.5", required_auths: ["1.2.5"], id: 1234, data: dh }), /not allowed/, "op35: other sub-id rejected");
  throwsRe(() => Tx._ser.serializeCustomTrollboxOp({ fee: { amount: "0", asset_id: "1.3.0" }, payer: "1.2.6", required_auths: ["1.2.5"], id: 9199, data: dh }), /must contain the payer/, "op35: auths-without-payer rejected");
  throwsRe(() => Tx._ser.serializeCustomTrollboxOp({ fee: { amount: "0", asset_id: "1.3.0" }, payer: "1.2.5", required_auths: [], id: 9199, data: dh }), /non-empty/, "op35: empty auths rejected");
  throwsRe(() => Tx._ser.serializeCustomTrollboxOp({ fee: { amount: "0", asset_id: "1.3.0" }, payer: "1.2.5", required_auths: ["1.2.5"], id: 9199, data: "" }), /non-empty hex/, "op35: empty data rejected");
  ok(Tx.OP.custom_operation === 35, "OP: custom_operation 35");
  /* Dispatch coverage (both sites). */
  const viaNested = Tx._ser.serializeOperationData(35, opData);
  ok(viaNested instanceof Uint8Array && viaNested.length > 0, "dispatch: nested op-35");
  throwsRe(() => Tx._ser.serializeOperationData(36, {}), /got op 36/, "dispatch: op-36 still undispatched");

  /* 11. buildPost shape (fee placeholder + 9199 + hex data). */
  const post = TB.buildPost({ payerId: "1.2.17", username: "alice", channel: "general", lang: "en", text: "hello", maxBytes: 1792 });
  ok(post.opData.id === 9199 && post.opData.payer === "1.2.17", "buildPost: id+payer");
  ok(Array.isArray(post.opData.required_auths) && post.opData.required_auths[0] === "1.2.17", "buildPost: auths");
  ok(post.catalog === "trollbox-general" && typeof post.key === "string", "buildPost: catalog+key");
  ok(typeof post.opData.data === "string" && TB.unpackCustomPluginData(post.opData.data) !== null, "buildPost: data unpacks");
  throwsRe(() => TB.buildPost({ payerId: "alice", username: "a", channel: "general", lang: "en", text: "hi", maxBytes: 1792 }), /1\.2/, "buildPost: bad payer throws");
  throwsRe(() => TB.buildPost({ payerId: "1.2.17", username: "a", channel: "nope", lang: "en", text: "hi", maxBytes: 1792 }), /unknown trollbox channel/, "buildPost: bad channel throws");

  /* 12. Pager cursor: 150 rows across 2 get_storage_info pages (100 + 50),
   * sorted newest-first by storage id, author enrichment via get_accounts. */
  function msgVal(i) { return JSON.stringify({ v: 1, ch: "general", u: "u" + i, ln: "en", text: "msg " + i }); }
  const page1 = [], page2 = [];
  for (let i = 1; i <= 100; i++) page1.push({ id: "7.0." + i, account: "1.2.5", catalog: "trollbox-general", key: "k" + i, value: msgVal(i) });
  for (let i = 101; i <= 150; i++) page2.push({ id: "7.0." + i, account: "1.2.6", catalog: "trollbox-general", key: "k" + i, value: msgVal(i) });
  const calls = [];
  globalThis.Chain = {
    custom: () => Promise.resolve(7),
    db: () => Promise.resolve(2),
    call: (api, method, params) => {
      calls.push([api, method, JSON.stringify(params)]);
      if (method === "get_storage_info") {
        if (params.length === 4) return Promise.resolve(page1);
        if (params.length === 5 && params[4] === "7.0.100") return Promise.resolve(page2);
        return Promise.resolve([]);
      }
      if (method === "get_accounts") return Promise.resolve([{ id: "1.2.5", name: "alice" }, { id: "1.2.6", name: "bob" }]);
      return Promise.reject(new Error("unexpected " + method));
    }
  };
  const TB2 = (() => { delete require.cache[require.resolve(TB_PATH)]; return require(TB_PATH); })();
  const msgs = await TB2.fetchChannelMessages("trollbox-general", 10);
  ok(msgs.length === 150, "pager: 150 rows across 2 pages, got " + msgs.length);
  ok(msgs[0].id === "7.0.150" && msgs[149].id === "7.0.1", "pager: newest-first by storage id");
  ok(msgs[0].displayAuthor === "bob" && msgs[149].displayAuthor === "alice", "pager: author enrichment");
  ok(calls.filter(c => c[1] === "get_storage_info").length === 2, "pager: exactly 2 storage calls");
  ok(JSON.parse(calls[0][2])[3] === 100, "pager: limit 100");
  delete globalThis.Chain;

  console.log("trollbox-test: " + pass + " passed, " + fail + " failed (" + (pass + fail) + " total)");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL harness threw: " + ((e && e.stack) || e)); process.exit(1); });
