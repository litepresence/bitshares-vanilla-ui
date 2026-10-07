# build-dialog.js provenance

Generated asset: the vanilla-UI build dialog (user prompts + assistant
replies, 2026-09-26 → present). Source: opencode.db via
`tooling/collate_vanilla_prompts.py` (third output; rerun regenerates docs +
asset together). Exclusions: 6 off-topic protocol-upgrade prompts by message
ID (script `EXCLUDE_MESSAGE_IDS`), plus whole sessions listed in the
script's `EXCLUDED` (protocol/G1 audits, EPUB/OCR, oracle design, translation
dispatch — per the owner, protocol-level work is a separate concern from the
UI). Verbatim English historical record: never translated, never hand-edited.
Same-origin `<script>` data (not fetched JSON) so `file://` keeps working.

Counts are NOT restated here on purpose — they drift on every rerun. The
live counts are in the `Generated …` header of
`docs/vanilla-ui-prompts.md` and `docs/vanilla-ui-dialog.md`, which the
script writes from the data it just read.

Keep this file in step with the script: if `VANILLA_SESSIONS` or `EXCLUDED`
changes, the doc follows automatically. If a session in opencode.db is
neither, the script prints a WARNING naming it — that is the signal to
classify it here rather than let the history silently truncate.
