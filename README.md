a Telegram chatbot service that silently collects notes throughout the day and compiles them into a structured Obsidian vault Markdown file committed to GitHub at end of day.

## ARCHITECTURE OVERVIEW
- Telegram Bot: receives messages silently, stores text and file_id only — no media downloaded
- Storage: SQLite on a Docker managed volume
- Scheduler: runs daily at 23:55 (Bangkok time, UTC+7)
- Compiler: resolves file_id to Telegram file URI at compile time, passes everything to LLM API
- LLM API: analyzes all messages + media URIs and produces the final structured daily note
- Output: one Markdown file per day committed to GitHub, plus upserted Person Cards
- Runtime: Python, packaged as Docker image, deployed on Alibaba SAS

## ENVIRONMENT VARIABLES (injected at runtime, never baked into image)
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_ALLOWED_USER_ID=<your numeric Telegram user ID>
ANTHROPIC_API_KEY=<Claude API key>
GEMINI_API_KEY=<Gemini API key>
OPENAI_API_KEY=<your-openai-api-key>
MODEL=<LLM_MODEL_NAME>
GITHUB_TOKEN=<fine-grained PAT, Contents read+write on vault repo>
GITHUB_REPO=<username/repo-name>
GITHUB_VAULT_PATH=Notes
GITHUB_BRANCH=main
TIMEZONE=Asia/Bangkok

## STEP 1 — PROJECT STRUCTURE

telegram-notetaker/
├── .env.example
├── .gitignore              # exclude .env, __pycache__, *.db
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── bot.py                  # Telegram listener
├── db.py                   # SQLite interface
├── compiler.py             # daily note compiler
├── person_cards.py         # person card upsert logic
├── scheduler.py            # APScheduler daily job
└── main.py                 # entrypoint

## STEP 2 — DEPENDENCIES
requirements.txt:
python-telegram-bot==20.7
apscheduler==3.10.4
PyGithub==2.1.1
python-dotenv==1.0.0
anthropic==0.25.0
aiohttp==3.9.1
aisuite==0.1.14

## STEP 3 — DOCKERFILE
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -m -u 1000 notebot && \
    mkdir -p /app/data && \
    chown -R notebot:notebot /app

USER notebot

ENTRYPOINT ["python", "main.py"]

## STEP 4 — DOCKER COMPOSE
version: "3.9"

services:
  telegram-notetaker:
    build: .
    image: telegram-notetaker:latest
    restart: always
    env_file: .env
    volumes:
      - notes_data:/app/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  notes_data:
    driver: local

## STEP 5 — DATABASE (db.py)
SQLite at /app/data/notes.db

Tables:

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,               -- YYYY-MM-DD Bangkok time
  timestamp TEXT NOT NULL,          -- ISO8601 Bangkok time
  message_type TEXT NOT NULL,       -- text | photo | voice | video | document | audio
  text TEXT,                        -- message text or caption (nullable)
  file_id TEXT,                     -- Telegram file_id (nullable, for media messages)
  file_mime_type TEXT,              -- MIME type as reported by Telegram (nullable)
  file_name TEXT                    -- original filename for documents (nullable)
);

CREATE TABLE IF NOT EXISTS person_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,        -- normalized full name
  first_seen TEXT NOT NULL,         -- YYYY-MM-DD
  last_seen TEXT NOT NULL,          -- YYYY-MM-DD
  notes_json TEXT NOT NULL          -- JSON array of {date, context} objects
);

Functions:
- save_message(date, timestamp, message_type, text, file_id, file_mime_type, file_name)
- get_messages_for_date(date_str) → list of rows ordered by timestamp
- delete_messages_for_date(date_str)
- upsert_person_card(name, date_str, context) → insert or append to existing card
- get_person_card(name) → row or None
- get_all_person_cards() → list of all rows

## STEP 6 — TELEGRAM BOT (bot.py)
- Use python-telegram-bot v20 async API
- Accept: text, photo, voice, video, audio, document
- Reject any sender other than TELEGRAM_ALLOWED_USER_ID — silently ignore
- For all accepted messages:
    - Store text or caption as-is
    - For media: store file_id, file_mime_type, file_name — DO NOT download anything
    - Send NO reply under any circumstances except /start and /help
- On /start or /help: reply with exactly "Bot active." — nothing else

## STEP 7 — FILE ID RESOLUTION
Function: async resolve_file_uri(bot, file_id) → str

Use bot.get_file(file_id) to obtain the Telegram file path.
Construct the direct URI:
  https://api.telegram.org/file/bot<TELEGRAM_BOT_TOKEN>/<file_path>

Return the URI. Do not download the file.
This URI is passed directly to the LLM API as a media source.

Note: Telegram file URIs expire after ~1 hour. Resolution must happen immediately
before the LLM API call during compilation — not cached or stored.

## STEP 8 — COMPILER (compiler.py)
Function: async compile_daily_note(date_str)

### 8a — Fetch messages
- Load all messages for date_str from SQLite
- If none, return early — do not create a file

### 8b — Resolve media URIs
For each message with a file_id:
- Call resolve_file_uri(bot, file_id) to get the live Telegram URI
- On failure: substitute with placeholder text "[Media unavailable: <file_id>]"

### 8c — Build LLM API payload
Construct a multimodal message to LLM.

System prompt:
"""
You are a personal knowledge assistant for a solo AI consultant based in Bangkok.
You receive a day's worth of raw notes — text messages, photos, voice memos, videos,
and documents — captured informally via Telegram throughout the day.

Your task is to produce a structured daily note in Obsidian Markdown format.

Analyze all content carefully. For media, examine the actual content of the image,
listen to/read voice or document content where possible.

Output ONLY the Markdown content. No preamble, no explanation.
"""

User message content array — for each message in chronological order:
- Always include: { type: "text", text: "[\(timestamp)] [\(message_type)]:\n\(text or caption or '')" }
- If message has a resolved URI, append a media block:
    - photo/image: { type: "image", source: { type: "url", url: "<uri>" } }
    - document (PDF): { type: "document", source: { type: "url", url: "<uri>", media_type: "application/pdf" } }
    - voice/audio/video: { type: "text", text: "[Audio/Video: <uri>]" }
      (LLM cannot process audio/video natively — include URI as reference text only)

After all message blocks, append a final instruction block:
"""
Based on all the above, produce the daily note using EXACTLY this structure:

---
date: YYYY-MM-DD
tags: [<2-5 inferred tags>]
people: [<all names mentioned>]
---

# Daily Note — DD-MM-YYYY

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

---
"""

### 8d — Call LLM API
- Model: specified in environment variable
- max_tokens: 4096
- Extract text from response
- This is the final Markdown content — do not post-process

### 8e — Upsert Person Cards
Parse the People section from the compiled note.
For each person listed, call upsert_person_card(name, date_str, context).
Then call compile_person_cards() to regenerate all Person Card files on GitHub.

### 8f — Commit to GitHub
1. Commit daily note to: <GITHUB_VAULT_PATH>/YYYY/DD-MM-YYYY.md
   Commit message: "notes: DD-MM-YYYY"
2. Commit all updated person cards (see Step 9)
3. On success: delete messages for date_str from SQLite

## STEP 9 — PERSON CARDS (person_cards.py)
Function: compile_person_cards()

For each person in the person_cards SQLite table, generate a Markdown file at:
  <GITHUB_VAULT_PATH>/People/<Normalized-Name>.md

File format:

---
name: <Full Name>
first_seen: YYYY-MM-DD
last_seen: YYYY-MM-DD
---

# <Full Name>

## Interaction Log
<for each entry in notes_json, sorted by date:>
- **YYYY-MM-DD** — <context>

Commit all changed person card files in a single GitHub commit:
  Commit message: "people: update person cards"

## STEP 10 — SCHEDULER (scheduler.py)
- APScheduler AsyncIOScheduler
- Trigger: daily at 23:55 Asia/Bangkok
- On failure: retry up to 3 times at 60 second intervals, then log and alert via
  Telegram message to TELEGRAM_ALLOWED_USER_ID: "⚠️ Daily note compilation failed: <error>"

## STEP 11 — ENTRYPOINT (main.py)
- Run bot and scheduler concurrently via asyncio
- On startup log: "Notes bot active — <GITHUB_REPO>/<GITHUB_VAULT_PATH>"

# Manual compile trigger for a specific date (testing)
docker compose exec telegram-notetaker python -c \
  "import asyncio; from compiler import compile_daily_note; asyncio.run(compile_daily_note('YYYY-MM-DD'))"

## CONSTRAINTS
- Never download media files — store file_id only, resolve URI at compile time
- Telegram file URIs must be resolved immediately before the LLM API call
- Never bake secrets into the Docker image
- SQLite must live on the notes_data managed volume at /app/data/notes.db
- All timestamps in Bangkok time (UTC+7)
- Bot never responds to regular messages under any circumstances
- Reject all senders except TELEGRAM_ALLOWED_USER_ID silently
- Run container as non-root user (notebot, UID 1000)
- Code must handle: Telegram API errors, expired file URIs, LLM API errors,
  GitHub API errors — all with retries and structured logging