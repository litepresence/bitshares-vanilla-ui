---
name: i18n-batch
description: Use when converting user-visible plain literals to t() keys across view JS + all 10 locale dicts while keeping check_i18n green.
---

# i18n Batch Conversion

Repeated pattern (8 batches): scope diff → convert → 10 dicts + inventory →
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
   byte-for-byte instead of minting a duplicate.
3. **Dicts.** Entries + English values in ALL 10 `vanilla/locales/*.json`
   + `en.json` inventory array (`_meta.translated`). Non-en dicts keep
   English outside allowlists (stubs honest). `tooling/apply_i18n_batch<N>.py`
   converter scripts are committable reuse (`batch3`/`batch4` precedent).
4. **Verify.** `check_i18n.py` OK (key-complete + drift-free) ·
   `node --check` touched JS · `check_rot` PASS · headless spot shots
   (serve 8081 + `PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers`),
   PNGs read English-identical, zero console errors.

## Red Flags

- New `t()` key without all 10 dict entries (gate goes red).
- Wrapping dynamic concats whole (breaks translators + drift check).
- Minting a key whose default duplicates an existing one.
- Translating non-en dicts by machine (stubs stay English outside allowlists).
