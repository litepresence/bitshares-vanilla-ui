"""Collate the user's vanilla-UI prompts across opencode sessions into two docs.

Outputs (same numbering in both, so #N is the same prompt in each file):
- docs/vanilla-ui-prompts.md: verbatim user prompts only, time-ordered.
- docs/vanilla-ui-dialog.md: each prompt followed by the assistant's reply
  text (final visible response only -- no reasoning/tool-call internals),
  forming a readable user/assistant dialog.

Source: fixed list of /workspace main-session IDs (human sessions only,
never @general subagent workers). Read-only against opencode.db
(uri mode=ro). All lookups are indexed (session by id, message by
session_id, part by message_id) -- never a full-table scan, never a
write/VACUUM while opencode is live.

Usage: python3 tooling/collate_vanilla_prompts.py
Rerun is idempotent (rewrites both docs).
"""

import datetime
import json
import sqlite3

DB = "file:/root/.local/share/opencode/opencode.db?mode=ro"
OUT = "/workspace/docs/vanilla-ui-prompts.md"
OUT_DIALOG = "/workspace/docs/vanilla-ui-dialog.md"

# Human sessions that created bitshares-vanilla-ui (excludes translation,
# EPUB/OCR, oracle-design, protocol-audit, and all subagent worker sessions).
VANILLA_SESSIONS = [
    "ses_f20cf2239ffelbgbh3rcLs3H1U",  # Bitshares UI vanilla port planning
    "ses_f17441b09ffeuPGll5xmbUnPbl",  # Vanilla UI falling short of BitShares UI UX
    "ses_f1543556fffe4JcCKkpFoIM0gn",  # Pool swap candlestick plots navigation
    # ses_f12ebe6a5ffePDyVlYC9nEQJa8  # DROPPED: sampled as BSIP/three-upgrades protocol work, not vanilla UI
    "ses_f09022af8ffeXG6yhUk2z6874K",  # Current project state and upcoming objectives
    "ses_f0901d456ffepSTvtA0hRKCgo1",  # Current project state and upcoming objectives
    "ses_f01344c32ffeyQd10YlXAVNTIo",  # Why TypeScript was rejected from stack
    "ses_f00a68566ffeHyPZ3EEvWXM5hL",  # Swagger UI-style explorer API probing page
    "ses_f0093a95fffeE526fttSymORPT",  # Reviewing api-lab build work
    "ses_f00568b95ffeebHiFYOpotvUFL",  # Burger menu headings to styled TOC pages
    "ses_efe94bcc5ffeaMw18tLyByFYc8",  # Changing top page signed-in user display
    "ses_efe594df6ffeKeCc0AD4ao3gl3",  # Checking commits ready for push
    "ses_efe53b1eaffeOKVmFjl2e8URXO",  # API lab and ES lab template review
    "ses_efe4e7202ffeOoAP0jtAZ6k4um",  # Price plot pool mapper default setup
    "ses_efe1fdb60ffeai253BNzFFV1qN",  # Implementing Bitshares vanilla UI issue #1
]

# Individual user prompts reviewed and excluded: off-topic core-protocol
# upgrade chat (protocols H/G release, oracle/smartcoin/ACCS/true-stealth
# rollout, truestealth readme, nemotron 3-protocol audit) that leaked into
# the vanilla session ses_f0901d45... (doc entries #272, #278, #294, #295,
# #300, #314 at time of removal).
EXCLUDE_MESSAGE_IDS = frozenset({
    "msg_0f9a7626c0013CeOIC6wCwe31K",
    "msg_0f9efbb51001EQbF77KefGe5wQ",
    "msg_0fa471521001x9yB6tLbkSFtgg",
    "msg_0fa4a8884001AyvC0pkMubgVOP",
    "msg_0fa5ade27001hJ4Aon9yvAdNcE",
    "msg_0fc5d62d10014uzxVwoxTxF3SM",
})
EXCLUDED = [
    ("ses_f2745d476ffeQH07PvAI66TkHC", "pre-vanilla worktree/RECOVERY review"),
    ("ses_f25cc2b08ffeHMwztXWazEmCdh", "EPUB scripting"),
    ("ses_f24d0918effeJp8qIO1EQnNALi", "v2 translation dispatch"),
    ("ses_f24b3e46affeQ4zIxoqavj0ENC", "skills review / v2 translation"),
    ("ses_f24b33f4affeKcf84cy0tyzm6q", "v2 translation batch"),
    ("ses_f21d60396ffeZ8vZZ6LK2ALqWa", "oracle design / cryptoeconomic security"),
    ("ses_f1b75aa2cffe92MjBFZD6dcxzF", "book-photo OCR"),
    ("ses_f03a1be9cffeniBID9s713MWyy", "audit of 3 protocols"),
    ("ses_f039d4510ffe27omjwIPQCqagi", "protocol audit (longcat)"),
    ("ses_f0398a6feffeRFglK9rC0rFesN", "protocol audit (ling)"),
    ("ses_f03976c92ffeosPwSaQJAF0Dd6", "comprehensive audit of 3 protocols"),
    ("ses_f039572f8ffeqUQIkb3KlHjM0C", "auditing 3 protocols for repair agent"),
    ("ses_efe17ef3cffeAqyWUZnPX3Tmyy", "this collation session itself (meta)"),
]


def utc(ms: int) -> str:
    return datetime.datetime.fromtimestamp(
        ms / 1000, tz=datetime.timezone.utc
    ).strftime("%Y-%m-%d %H:%M UTC")


def _text_parts(cur: sqlite3.Cursor, message_id: str) -> list[str]:
    """Verbatim non-empty text parts of one message, in stored order."""
    cur.execute(
        "SELECT data FROM part WHERE message_id=? ORDER BY time_created",
        (message_id,),
    )
    texts = []
    for (pdata,) in cur.fetchall():
        try:
            pj = json.loads(pdata)
        except ValueError:
            continue
        if pj.get("type") == "text" and pj.get("text", "").strip():
            texts.append(pj["text"])
    return texts


def main() -> None:
    db = sqlite3.connect(DB, uri=True, timeout=30)
    cur = db.cursor()

    sessions = VANILLA_SESSIONS

    titles: dict[str, str] = {}
    for sid in sessions:
        cur.execute("SELECT title FROM session WHERE id=?", (sid,))
        row = cur.fetchone()
        titles[sid] = row[0] if row else sid

    # Live header values computed at generation time
    prompt_count = 0  # will be set after prompts collected
    session_count = len(sessions)
    title_count = len(set(titles[s] for s in sessions))
    # worker_count: @general subagent worker sessions (indexed COUNT)
    cur.execute(
        "SELECT COUNT(*) FROM session WHERE title LIKE '%@general%' OR title LIKE '%worker%'"
    )
    worker_count = cur.fetchone()[0]
    frozen_at = utc(int(datetime.datetime.now(tz=datetime.timezone.utc).timestamp() * 1000))
    scope_sentence = (
        "Scope: verbatim user prompts from the 14 vanilla-UI creation sessions "
        "(two share a title), excluding 6 protocol-off-topic messages and "
        f"{worker_count} @general subagent worker sessions."
    )

    prompts: list[tuple[int, str, str, str, str]] = []  # (time, sid, mid, user, reply)
    for sid in sessions:
        cur.execute(
            "SELECT id, time_created FROM message "
            "WHERE session_id=? ORDER BY time_created",
            (sid,),
        )
        ordered = cur.fetchall()
        roles: dict[str, str] = {}
        for mid, _mtc in ordered:
            if mid in EXCLUDE_MESSAGE_IDS:
                continue
            cur.execute("SELECT data FROM message WHERE id=?", (mid,))
            row = cur.fetchone()
            if not row:
                continue
            try:
                roles[mid] = json.loads(row[0]).get("role", "")
            except (ValueError, AttributeError):
                continue
        user_times = [(mid, mtc) for mid, mtc in ordered
                      if roles.get(mid) == "user"]
        for idx, (mid, mtc) in enumerate(user_times):
            texts = _text_parts(cur, mid)
            if not texts:
                continue
            end = user_times[idx + 1][1] if idx + 1 < len(user_times) else 10**18
            reply_chunks = []
            for amid, amtc in ordered:
                if not (mtc < amtc < end):
                    continue
                if roles.get(amid) != "assistant":
                    continue
                reply_chunks.extend(_text_parts(cur, amid))
            prompts.append((mtc, sid, mid, "\n".join(texts),
                            "\n\n".join(reply_chunks)))

    prompts.sort(key=lambda p: p[0])
    prompt_count = len(prompts)

    # Shared header block
    header_block = (
        f"Generated {frozen_at} from opencode.db: "
        f"{prompt_count} prompts across {session_count} sessions "
        f"({title_count} distinct titles — two sessions share one title). "
        f"{worker_count} `@general subagent` worker sessions excluded "
        "(agent-generated, not user prompts)."
    )

    lines = []
    lines.append("# bitshares-vanilla-ui — user prompt history")
    lines.append("")
    lines.append(
        "Every verbatim user prompt that created the vanilla UI, collated "
        "chronologically across all opencode sessions. Times are UTC."
    )
    lines.append("")
    lines.append(header_block)
    lines.append("")
    lines.append("## Sessions included")
    lines.append("")
    for sid in sorted(sessions, key=lambda s: titles[s]):
        lines.append(f"- {titles[sid]} (`{sid}`)")
    lines.append("")
    lines.append("## Sessions reviewed and excluded (not vanilla-UI creation)")
    lines.append("")
    for sid, why in EXCLUDED:
        lines.append(f"- {why} (`{sid}`)")
    lines.append("- Project status check (`ses_f12ebe6a5ffePDyVlYC9nEQJa8`) — "
                 "sampled: BSIP/three-upgrades protocol work, not vanilla UI")
    lines.append("")
    lines.append("---")
    lines.append("")

    current_day = ""
    for i, (mtc, sid, mid, text, _reply) in enumerate(prompts, 1):
        day = utc(mtc)[:10]
        if day != current_day:
            current_day = day
            lines.append(f"## {day}")
            lines.append("")
        lines.append(f"### #{i} — {utc(mtc)} — {titles[sid]}")
        lines.append("")
        lines.append(text.strip())
        lines.append("")
        lines.append("---")
        lines.append("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    chars = sum(len(p[3]) for p in prompts)
    print(f"wrote {OUT}: {len(prompts)} prompts, {chars} chars")

    dlines = []
    dlines.append("# bitshares-vanilla-ui — dialog history")
    dlines.append("")
    dlines.append(
        "The vanilla-UI build as a user/assistant dialog: each verbatim user "
        "prompt followed by the assistant's reply text (the final visible "
        "response only -- no reasoning or tool-call internals). Numbering "
        "matches docs/vanilla-ui-prompts.md exactly. Times are UTC."
    )
    dlines.append("")
    dlines.append(header_block)
    dlines.append("")
    dlines.append("---")
    dlines.append("")

    current_day = ""
    n_replied = 0
    for i, (mtc, sid, _mid, text, reply) in enumerate(prompts, 1):
        day = utc(mtc)[:10]
        if day != current_day:
            current_day = day
            dlines.append(f"## {day}")
            dlines.append("")
        dlines.append(f"### #{i} — {utc(mtc)} — {titles[sid]}")
        dlines.append("")
        dlines.append("**You:**")
        dlines.append("")
        dlines.append(text.strip())
        dlines.append("")
        dlines.append("**Assistant:**")
        dlines.append("")
        if reply.strip():
            dlines.append(reply.strip())
            n_replied += 1
        else:
            dlines.append("*(no reply recorded -- next prompt followed immediately)*")
        dlines.append("")
        dlines.append("---")
        dlines.append("")

    with open(OUT_DIALOG, "w", encoding="utf-8") as f:
        f.write("\n".join(dlines))

    rchars = sum(len(p[4]) for p in prompts)
    print(f"wrote {OUT_DIALOG}: {len(prompts)} exchanges, "
          f"{n_replied} with reply, {rchars} reply chars")

    asset = []
    for i, (mtc, sid, _mid, text, reply) in enumerate(prompts, 1):
        asset.append({
            "n": i,
            "time": utc(mtc),
            "session": titles[sid],
            "user": text.strip(),
            "reply": reply.strip() or None,
        })
    asset_count = len(asset)
    payload = (
        f"/* Build-dialog archive: {asset_count} vanilla-UI exchanges, generated by\n"
        f" * tooling/collate_vanilla_prompts.py from opencode.db. DO NOT HAND-EDIT.\n"
        f" * Verbatim English historical record, never translated. See\n"
        f" * vanilla/assets/BUILD-DIALOG-PROVENANCE.md. */\n"
        "if (typeof window === \"undefined\") { var window = {}; }\n"
        "window.BuildDialog = " + json.dumps(asset, ensure_ascii=False) + ";\n"
        "if (typeof module !== \"undefined\") { module.exports = window.BuildDialog; }\n")
    with open("/workspace/vanilla/assets/build-dialog.js", "w", encoding="utf-8") as f:
        f.write(payload)
    print("wrote asset: %d entries" % asset_count)


if __name__ == "__main__":
    main()
