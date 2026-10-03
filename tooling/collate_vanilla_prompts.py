"""Collate the user's vanilla-UI prompts across opencode sessions into one doc.

What it does: for a fixed list of /workspace main-session IDs (human sessions
only, never @general subagent workers), reads every user-role message's
verbatim text parts and writes them time-ordered to docs/vanilla-ui-prompts.md.

Read-only against opencode.db (uri mode=ro). All lookups are indexed
(session by id, message by session_id, part by message_id) -- never a
full-table scan, never a write/VACUUM while opencode is live.

Usage: python3 tooling/collate_vanilla_prompts.py
Rerun is idempotent (rewrites the doc).
"""

import datetime
import json
import sqlite3

DB = "file:/root/.local/share/opencode/opencode.db?mode=ro"
OUT = "/workspace/docs/vanilla-ui-prompts.md"

# Human sessions that created bitshares-vanilla-ui (excludes translation,
# EPUB/OCR, oracle-design, protocol-audit, and all subagent worker sessions).
VANILLA_SESSIONS = [
    "ses_f20cf2239ffelbgbh3rcLs3H1U",  # Bitshares UI vanilla port planning
    "ses_f17441b09ffeuPGll5xmbUnPbl",  # Vanilla UI falling short of BitShares UI UX
    "ses_f1543556fffe4JcCKkpFoIM0gn",  # Pool swap candlestick plots navigation
    "ses_f12ebe6a5ffePDyVlYC9nEQJa8",  # (check: actually BSIP/3-updates -- see note)
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


def main() -> None:
    db = sqlite3.connect(DB, uri=True, timeout=30)
    cur = db.cursor()

    # NOTE: ses_f12ebe6a5 ("Project status check") turned out on sampling to
    # be BSIP/three-upgrades protocol work, not vanilla-UI creation, so drop
    # it from the vanilla list despite the generic title.
    sessions = [s for s in VANILLA_SESSIONS if s != "ses_f12ebe6a5ffePDyVlYC9nEQJa8"]

    titles: dict[str, str] = {}
    for sid in sessions:
        cur.execute("SELECT title FROM session WHERE id=?", (sid,))
        row = cur.fetchone()
        titles[sid] = row[0] if row else sid

    prompts: list[tuple[int, str, str, str]] = []  # (time, sid, mid, text)
    for sid in sessions:
        cur.execute(
            "SELECT id, time_created FROM message "
            "WHERE session_id=? ORDER BY time_created",
            (sid,),
        )
        for mid, mtc in cur.fetchall():
            if mid in EXCLUDE_MESSAGE_IDS:
                continue
            cur.execute("SELECT data FROM message WHERE id=?", (mid,))
            row = cur.fetchone()
            if not row:
                continue
            try:
                role = json.loads(row[0]).get("role")
            except (ValueError, AttributeError):
                continue
            if role != "user":
                continue
            cur.execute(
                "SELECT data FROM part WHERE message_id=? ORDER BY time_created",
                (mid,),
            )
            texts = []
            for (pdata,) in cur.fetchall():
                try:
                    pj = json.loads(pdata)
                except ValueError:
                    continue
                if pj.get("type") == "text" and pj.get("text", "").strip():
                    texts.append(pj["text"])
            if texts:
                prompts.append((mtc, sid, mid, "\n".join(texts)))

    prompts.sort(key=lambda p: p[0])

    lines = []
    lines.append("# bitshares-vanilla-ui — user prompt history")
    lines.append("")
    lines.append(
        "Every verbatim user prompt that created the vanilla UI, collated "
        "chronologically across all opencode sessions. Times are UTC."
    )
    lines.append("")
    lines.append(
        f"Generated {utc(int(datetime.datetime.now(tz=datetime.timezone.utc).timestamp() * 1000))} "
        f"from opencode.db: {len(prompts)} prompts across {len(sessions)} sessions. "
        "1505 `@general subagent` worker sessions excluded (agent-generated, "
        "not user prompts)."
    )
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
    for i, (mtc, sid, mid, text) in enumerate(prompts, 1):
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


if __name__ == "__main__":
    main()
