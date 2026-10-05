---
name: i18n-batch
description: Use when converting user-visible plain literals to t() keys across view JS + all 12 locale dicts while keeping check_i18n green.
---

# i18n Batch Conversion

Repeated pattern (8+ batches): scope diff → convert → 12 dicts + inventory →
verify English-identical rendering.

## Contract

1. **Scope via diff.** `git log <base>..HEAD --name-only` for view JS;
   convert NEW user-visible literals only (in `el()`/`textContent`/
   `placeholder`/`title`/`aria-label`). Skip: help-ui.js bodies
   (English-first by design), test/proof scripts, identifier-symbols
   (indicator names, theme ids), glue/punctuation, token values, raw chain
   ints in titles, code-prefixed throws.
2. **Conversion.** `t(key, enDefault)` with byte-verbatim defaults,
   namespaced by view (`transfer.*`, `vote.*`, …). Dynamic concats: wrap
   ONLY complete static segments; values and punctuation glue stay raw
   (batch-2b precedent). Reuse an existing key when the default matches
   byte-for-byte instead of minting a duplicate. Placeholders (`%(name)s`),
   URLs, object IDs, op numbers, asset symbols, theme/network IDs stay
   byte-verbatim — a translation that breaks a placeholder is a bug.
3. **Dicts.** Entries + English values in ALL 12 `vanilla/locales/*.json`
   (en,de,es,fr,hi,it,ja,ko,pt,ru,tr,zh) + `en.json` inventory array
   (`_meta.translated`). Non-en dicts keep English outside allowlists
   (stubs honest — never machine-translate into "verified"). `tooling/apply_i18n_batch<N>.py`
   converter scripts are committable reuse (`batch3`/`batch4` precedent).
4. **Copy-voice (RAW5 precedent — every human-audit wave re-fixed these).**
   Sentence-case defaults ("My account", not "My Account"); shared-glossary
   BitShares terms per language (witness, committee, worker, proxy, brainkey,
   vesting, HTLC, swap, slate — never per-translator improvisation); unlock
   failures route to `common.unlock_failed`; CTA/defaults reuse `common.*`
   where the default matches byte-for-byte.
5. **Verify.** `check_i18n.py` OK (key-complete + drift-free) ·
   `node --check` touched JS · `check_rot` PASS · headless spot shots
   (serve 8081 + `PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers`),
   PNGs read English-identical, zero console errors. Drop orphaned keys
   touched by the batch (`tooling/collect_i18n_orphans.py`) — never leave
   dead keys behind.

## Red Flags

- New `t()` key without all 12 dict entries (gate goes red).
- Wrapping dynamic concats whole (breaks translators + drift check).
- Minting a key whose default duplicates an existing one.
- Translating non-en dicts by machine (stubs stay English outside allowlists).
- Title-case default that breaks sentence-case voice; per-language glossary improvisation.
