# Zoom Meeting Agent

An AI-powered Telegram bot that manages Zoom meetings through natural conversation. Built with the [Mastra AI](https://mastra.ai) framework, it lets users create, list, update, and delete Zoom meetings using plain language — including voice messages.

## Features

- **Natural Language Scheduling** — Say "Book a team sync tomorrow at 2pm" and the agent handles the rest
- **Meeting Updates** — Reschedule or rename meetings with "Change the standup to 4pm" or "Rename my sync to weekly review"
- **Smart Date Resolution** — Understands relative dates like "tomorrow", "next Wednesday", "next week Thursday", "in 2 hours"
- **Voice Message Support** — Send a voice note on Telegram and the agent transcribes it via AssemblyAI, then acts on it
- **Conflict Detection** — Checks for scheduling conflicts before creating meetings
- **Confirmation Flow** — Always confirms before creating, updating, or deleting a meeting
- **Future-Date Enforcement** — Prevents scheduling or rescheduling meetings in the past
- **Conversation Memory** — Remembers context within a conversation (last 20 messages) for natural multi-turn interactions

## Architecture

```
src/
├── lib/
│   ├── assemblyai.ts         # Voice message transcription (AssemblyAI)
│   ├── db.ts                 # Turso/LibSQL client + schema initialization
│   ├── telegram-bot.ts       # Telegram bot service (webhook/polling, text/voice handlers)
│   ├── time-utils.ts         # Jamaica timezone helpers (date formatting, conflict detection)
│   └── zoom-auth.ts          # Zoom S2S OAuth token manager + authenticated fetch
└── mastra/
    ├── index.ts              # Mastra instance, storage config, bootstrap
    ├── agents/
    │   └── zoom-agent.ts     # Agent definition (dynamic system prompt, model, tools, memory)
    └── tools/
        ├── create-meeting.ts # Create a scheduled Zoom meeting
        ├── list-meetings.ts  # List upcoming meetings
        ├── update-meeting.ts # Update meeting topic, time, or duration
        └── delete-meeting.ts # Delete a meeting by ID
```

### How It Works

1. **User sends a message** on Telegram (text or voice)
2. **Telegram bot** receives it via webhook (or polling fallback) and sends a typing indicator
3. If it's a **voice message**, it's first transcribed via AssemblyAI
4. The message is passed to the **Mastra agent** with conversation memory
5. The agent's **dynamic system prompt** includes the current date/time so it can resolve relative dates
6. The agent decides which **tool** to call (create, list, update, or delete) based on user intent
7. The tool makes an **authenticated Zoom API call** via the `zoomFetch()` helper
8. The agent formats the response and sends it back to the user on Telegram

### Key Design Decisions

- **Dynamic System Prompt** — The `instructions` field is a function (not a static string) that injects the current date and time on every invocation. This enables the LLM to accurately resolve "tomorrow", "next Monday", etc. without any custom date-parsing logic.
- **Server-to-Server OAuth** — Uses Zoom's `account_credentials` grant type. Tokens are cached in Turso with a 5-minute expiry buffer and automatically refreshed. No user-facing OAuth flow needed.
- **Single-Row Token Storage** — The `zoom_tokens` table always has exactly one row (`id = 1`). Tokens are upserted, not inserted, so there's no cleanup needed.
- **Jamaica Timezone** — All times are interpreted and displayed in `America/Jamaica` (UTC-5, no DST). This is configurable in `src/lib/time-utils.ts`.

## Prerequisites

- **Node.js** 18+ (uses native `fetch`)
- **Telegram Bot** — Create one via [@BotFather](https://t.me/BotFather)
- **Zoom Server-to-Server OAuth App** — Create one in the [Zoom App Marketplace](https://marketplace.zoom.us/)
- **AssemblyAI Account** — For voice message transcription ([assemblyai.com](https://www.assemblyai.com/))
- **Turso Database** — For token storage and conversation memory ([turso.tech](https://turso.tech/))
- **OpenAI API Key** — The agent uses `gpt-4o` as its LLM

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/ikcalvin/zoom-meeting-agent.git
cd zoom-meeting-agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

```env
# ── Telegram ──
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_URL=https://your-cloud-run-url.a.run.app
TELEGRAM_WEBHOOK_PORT=8081

# ── Zoom Server-to-Server OAuth ──
ZOOM_CLIENT_ID=your_zoom_client_id
ZOOM_CLIENT_SECRET=your_zoom_client_secret
ZOOM_ACCOUNT_ID=your_zoom_account_id

# ── AssemblyAI ──
ASSEMBLYAI_API_KEY=your_assemblyai_api_key

# ── Turso (LibSQL) ──
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token

# ── OpenAI ──
OPENAI_API_KEY=your_openai_api_key
```

#### Getting Each Credential

| Service | How to Get It |
|---------|--------------|
| **Telegram Bot Token** | Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → follow the prompts → copy the token |
| **Zoom Client ID / Secret / Account ID** | Go to [Zoom App Marketplace](https://marketplace.zoom.us/) → Develop → Build App → Choose **Server-to-Server OAuth** → Copy the three values from the App Credentials page. Required scopes: `meeting:write`, `meeting:read` |
| **AssemblyAI API Key** | Sign up at [assemblyai.com](https://www.assemblyai.com/) → Dashboard → Copy your API key |
| **Turso Database URL + Auth Token** | Install the [Turso CLI](https://docs.turso.tech/cli/installation) → `turso db create zoom-agent` → `turso db show zoom-agent --url` and `turso db tokens create zoom-agent` |
| **OpenAI API Key** | Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → Create new secret key |

### 4. Run in Development Mode

```bash
npm run dev
```

This starts the Mastra dev server, initializes the database schema, and starts Telegram bot integration. With `TELEGRAM_WEBHOOK_URL` set, webhook mode is used; otherwise polling is used. You should see:

```
[mastra] Database schema initialized
[telegram] Bot started with webhook listener
```

### Webhook Testing with ngrok (Local)

Use a separate port for Telegram webhook traffic so it does not conflict with Mastra Studio/API.

```bash
# .env
PORT=8080
TELEGRAM_WEBHOOK_PORT=8081
TELEGRAM_WEBHOOK_URL=https://<your-ngrok-domain>
```

Run app and tunnel:

```bash
npm run dev
ngrok http 8081
```

Notes:
- `TELEGRAM_WEBHOOK_URL` must be the base URL only (no `/telegram/webhook/...` path).
- The bot appends `/telegram/webhook/<TELEGRAM_BOT_TOKEN>` automatically.

### 5. Build and Run for Production

```bash
npm run build
npm start
```

## Usage

Open your Telegram bot and start chatting:

### Create a Meeting

> "Schedule a team standup tomorrow at 9am"

The agent will confirm the details and create the meeting, returning the join URL and passcode.

### List Meetings

> "Show my upcoming meetings"

Returns a numbered list of all scheduled meetings with times and topics.

### Update a Meeting

> "Change the team standup to 10am"
> "Rename my 3pm meeting to Project Review"
> "Reschedule tomorrow's sync to next Wednesday at 2pm"

The agent will find the matching meeting, confirm what you want to change, and update it. Only future dates are accepted for rescheduling.

### Delete a Meeting

> "Cancel the team standup"
> "Delete my 3pm meeting"

The agent will identify the meeting, ask for confirmation, and delete it.

### Voice Messages

Send a voice note with any of the above requests. The agent transcribes it and responds as if you typed it.

## Tools Reference

### `create-zoom-meeting`

Creates a new scheduled Zoom meeting.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | Yes | Meeting topic/title |
| `start_time` | string | Yes | ISO 8601 UTC datetime (e.g., `2025-05-01T19:00:00Z`) |
| `duration` | number | No | Duration in minutes (default: 60) |

**Zoom API:** `POST /users/me/meetings`

### `list-zoom-meetings`

Lists all upcoming scheduled and recurring meetings, sorted by start time.

No input parameters.

**Zoom API:** `GET /users/me/meetings?type=upcoming_meetings&page_size=50`

### `update-zoom-meeting`

Updates the topic, time, and/or duration of an existing meeting.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `meeting_id` | number | Yes | The Zoom meeting ID to update |
| `topic` | string | No | New meeting topic (omit to keep unchanged) |
| `start_time` | string | No | New start time as ISO 8601 UTC string (must be in the future) |
| `duration` | number | No | New duration in minutes |

At least one of `topic`, `start_time`, or `duration` must be provided. The tool validates that `start_time` is in the future before making the API call.

**Zoom API:** `PATCH /meetings/{meetingId}`

### `delete-zoom-meeting`

Deletes a meeting by its ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `meeting_id` | number | Yes | The Zoom meeting ID to delete |

**Zoom API:** `DELETE /meetings/{meetingId}`

## Customization

### Changing the Timezone

The default timezone is `America/Jamaica` (UTC-5, no DST). To change it:

1. Update `JAMAICA_TZ` in `src/lib/time-utils.ts` to your IANA timezone (e.g., `America/New_York`)
2. Update the timezone references in the system prompt in `src/mastra/agents/zoom-agent.ts`

### Changing the LLM Model

The agent uses `openai/gpt-4o` by default. To change it, update the `model` field in `src/mastra/agents/zoom-agent.ts`. Mastra supports any model provider compatible with the Vercel AI SDK.

### Adding New Tools

Follow the pattern in `src/mastra/tools/`:

1. Create a new file with `createTool()` from `@mastra/core/tools`
2. Define `inputSchema` and `outputSchema` with Zod
3. Implement the `execute` function using `zoomFetch()` for Zoom API calls
4. Import and register the tool in `src/mastra/agents/zoom-agent.ts`
5. Add usage instructions to the system prompt

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **AI Framework** | [Mastra AI](https://mastra.ai) (`@mastra/core` v1.22+) |
| **LLM** | OpenAI GPT-4o |
| **Bot Platform** | Telegram (via `node-telegram-bot-api`) |
| **Meeting API** | Zoom REST API v2 (Server-to-Server OAuth) |
| **Voice Transcription** | AssemblyAI |
| **Database** | Turso / LibSQL (token storage + conversation memory) |
| **Language** | TypeScript (ES2022, ESM) |
| **Date Handling** | `date-fns` + `date-fns-tz` |

## License

ISC
