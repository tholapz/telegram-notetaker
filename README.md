# telegram-notetaker

A Telegram bot that silently collects notes throughout the day and compiles them into a structured Obsidian Markdown file committed to GitHub at end of day.

## Architecture

- **Telegram webhook** — receives messages (text, photo, voice, video, audio, document); stores text and `file_id` only, never downloads media
- **Storage** — Cloudflare D1 (serverless SQLite)
- **Scheduler** — Cloudflare Cron Trigger at 23:55 Bangkok time (16:55 UTC)
- **Compiler** — resolves `file_id` to Telegram file URI at compile time, passes everything to the Claude API
- **Output** — one Markdown daily note per day committed to GitHub, plus upserted Person Cards
- **Runtime** — TypeScript, deployed as a Cloudflare Worker

## Project structure

```
src/
├── index.ts        # Worker entry point (fetch + scheduled handlers)
├── bot.ts          # Telegram webhook handler
├── db.ts           # D1 database layer
├── github.ts       # GitHub REST API client
├── compiler.ts     # Daily note compiler
├── personCards.ts  # Person card generator
└── types.ts        # Shared TypeScript types
schema.sql          # D1 schema
wrangler.toml       # Worker config
```

## Commands

```bash
npm install          # install dependencies
make dev             # run local dev server
make typecheck       # TypeScript type check
make deploy          # deploy to Cloudflare Workers
make db-init         # apply schema.sql to D1
```

## First-time setup

### 1. Create the D1 database

```bash
npx wrangler d1 create telegram-notetaker
# copy the database_id into wrangler.toml
```

### 2. Apply schema

```bash
make db-init
```

### 3. Set secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ALLOWED_USER_ID
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GH_TOKEN
npx wrangler secret put GH_REPO
```

### 4. Deploy

```bash
make deploy
```

### 5. Register Telegram webhook (once after deploy)

```
GET https://<your-worker>.workers.dev/setup
```

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret | From @BotFather |
| `TELEGRAM_ALLOWED_USER_ID` | secret | Your numeric Telegram user ID |
| `ANTHROPIC_API_KEY` | secret | Claude API key |
| `GH_TOKEN` | secret | Fine-grained PAT, Contents read+write on vault repo |
| `GH_REPO` | secret | `username/repo-name` |
| `GH_BRANCH` | var | Default: `main` |
| `MODEL` | var | Default: `claude-sonnet-4-6` |
| `TIMEZONE` | var | Default: `Asia/Bangkok` |

## CI/CD

- **CI** (`ci.yml`) — type-check on pull requests to `main`
- **CD** (`cd.yml`) — `wrangler deploy` on push to `main`

Requires `CLOUDFLARE_API_TOKEN` set as a GitHub Actions secret (create at Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template).

## Manual compile trigger (testing)

```bash
npx wrangler dev
# then in another terminal:
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-worker.your-subdomain.workers.dev/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'",
    "drop_pending_updates": true
  }'
```

Or trigger the scheduled handler directly:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=55+16+*+*+*"
```

## Notes

- Telegram file URIs expire after ~1 hour; resolution happens immediately before the Claude API call, never cached
- The daily compilation job (LLM + GitHub API) can take 30–60s; enable the **Unbound** usage model in the Cloudflare dashboard for reliable cron execution
- Bot never replies to regular messages; only `/start` and `/help` receive a response
