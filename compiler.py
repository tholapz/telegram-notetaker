import logging
import os
import re
import sqlite3
from datetime import datetime

import anthropic
from github import Github, GithubException

from db import delete_messages_for_date, get_messages_for_date, upsert_person_card
from person_cards import compile_person_cards

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a personal knowledge assistant for a solo AI consultant based in Bangkok.
You receive a day's worth of raw notes — text messages, photos, voice memos, videos,
and documents — captured informally via Telegram throughout the day.

Your task is to produce a structured daily note in Obsidian Markdown format.

Analyze all content carefully. For media, examine the actual content of the image,
listen to/read voice or document content where possible.

Output ONLY the Markdown content. No preamble, no explanation.\
"""

def _final_instruction(date_str: str = "") -> str:
    if date_str:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        date_ymd = date_str
        date_dmy = dt.strftime("%d-%m-%Y")
    else:
        date_ymd = "YYYY-MM-DD"
        date_dmy = "DD-MM-YYYY"
    return f"""\
Based on all the above, produce the daily note using EXACTLY this structure:

---
date: {date_ymd}
tags: [<2-5 inferred tags>]
people: [<all names mentioned>]
---

# Daily Note — {date_dmy}

## Accomplishments
<!-- What was completed or meaningfully progressed today -->
<bullet list — omit section if nothing qualifies>

## Challenges
<!-- Obstacles, blockers, frustrations encountered today -->
<bullet list — omit section if nothing qualifies>

## Learnings
<!-- New knowledge, insights, or realizations from today -->
<bullet list — omit section if nothing qualifies>

## People
<!-- For each person mentioned, one line: Name — context of interaction -->
<list — omit section if no people mentioned>

## Raw Timeline
<!-- Chronological log of all messages, preserving original wording -->
### HH:MM
<original text or caption>
<if media: insert markdown reference — image embed for photos, link for others>

---"""


async def resolve_file_uri(bot, file_id: str) -> str:
    tg_file = await bot.get_file(file_id)
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    return f"https://api.telegram.org/file/bot{token}/{tg_file.file_path}"


def _build_content_blocks(messages: list[sqlite3.Row], resolved_uris: dict[str, str], date_str: str = "") -> list:
    blocks = []
    for msg in messages:
        hhmm = msg["timestamp"][11:16]
        text = msg["text"] or ""
        blocks.append({
            "type": "text",
            "text": f"[{hhmm}] [{msg['message_type']}]:\n{text}",
        })

        file_id = msg["file_id"]
        if not file_id:
            continue

        uri = resolved_uris.get(file_id)
        if not uri:
            blocks.append({"type": "text", "text": f"[Media unavailable: {file_id}]"})
            continue

        msg_type = msg["message_type"]
        mime = msg["file_mime_type"] or ""

        if msg_type == "photo" or mime.startswith("image/"):
            blocks.append({"type": "image", "source": {"type": "url", "url": uri}})
        elif msg_type == "document" and mime == "application/pdf":
            blocks.append({
                "type": "document",
                "source": {"type": "url", "url": uri, "media_type": "application/pdf"},
            })
        else:
            blocks.append({"type": "text", "text": f"[Audio/Video: {uri}]"})

    blocks.append({"type": "text", "text": _final_instruction(date_str)})
    return blocks


def _parse_people(markdown: str) -> list[tuple[str, str]]:
    people: list[tuple[str, str]] = []
    in_section = False
    for line in markdown.splitlines():
        if line.strip() == "## People":
            in_section = True
            continue
        if in_section:
            if line.startswith("## "):
                break
            m = re.match(r"^[-*]\s+(.+?)\s+[—–-]+\s+(.+)$", line.strip())
            if m:
                people.append((m.group(1).strip(), m.group(2).strip()))
    return people


def _upsert_github_file(repo, path: str, content: str, message: str) -> None:
    try:
        existing = repo.get_contents(path)
        repo.update_file(path, message, content, existing.sha)
    except GithubException as exc:
        if exc.status == 404:
            repo.create_file(path, message, content)
        else:
            raise


async def compile_daily_note(date_str: str, bot=None) -> None:
    messages = get_messages_for_date(date_str)
    if not messages:
        logger.info("No messages for %s, skipping.", date_str)
        return

    # Resolve Telegram media URIs immediately before LLM call
    resolved_uris: dict[str, str] = {}
    if bot:
        for msg in messages:
            file_id = msg["file_id"]
            if file_id:
                try:
                    resolved_uris[file_id] = await resolve_file_uri(bot, file_id)
                except Exception as exc:
                    logger.warning("Could not resolve file_id %s: %s", file_id, exc)

    content_blocks = _build_content_blocks(messages, resolved_uris, date_str)

    # Call LLM
    model = os.environ.get("MODEL", "claude-opus-4-5")
    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = await client.messages.create(
        model=model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content_blocks}],
    )
    note_markdown = response.content[0].text

    # Upsert person cards
    for name, context in _parse_people(note_markdown):
        upsert_person_card(name, date_str, context)

    # Commit daily note to GitHub
    branch = os.environ.get("GH_BRANCH", "main")
    repo = Github(os.environ["GH_TOKEN"]).get_repo(os.environ["GH_REPO"])

    note_path = date_str + ".md"
    _upsert_github_file(repo, note_path, note_markdown, f"notes: {date_str}")
    logger.info("Committed daily note: %s", note_path)

    # Regenerate all person card files
    compile_person_cards()

    # Clean up stored messages
    delete_messages_for_date(date_str)
    logger.info("Deleted messages for %s from SQLite.", date_str)
