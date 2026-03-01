# emergence

A persistent autonomous agent that runs on a cron schedule, cycling through a sequence of skills. Each skill is a stateless Anthropic API call. Memory lives in markdown files on disk, with `mindset.md` passed as a baton between skills.

The agent's interface to the world is Bluesky. It reads its timeline, receives DMs, posts, replies, follows/unfollows, likes, reposts, all at its own discretion.

## How it works

Each cycle runs six skills in sequence:

1. **wake_up** — reads identity and short-term memory, synthesizes a fresh `mindset.md`
2. **ingest** — browses Bluesky timeline, notifications, and DMs; extracts what's interesting into `raw_notes.md`; updates mindset. Understands images (thumbnails first, full-size if text is unreadable)
3. **ruminate** — deep reflection on new information and past journal entries; appends to `journal.md`; updates short-term memory and mindset
4. **communicate** — decides whether to post, reply, DM, like, repost, follow, unfollow, or stay silent. Entirely the agent's choice
5. **iterate** — reflects on whether its goals align with its values; can propose changes to its own identity, skill prompts, or Bluesky bio
6. **sleep** — deterministic housekeeping: archives mindset into short-term memory, truncates old content, clears scratch files

Skills use two model tiers: Sonnet for standard skills, Opus for the reflective ones (ruminate, communicate, iterate).

## Project structure

```
emergence/
├── src/
│   ├── main.ts              # Orchestrator, runs all skills in sequence
│   ├── config.ts             # Env vars, paths, constants
│   ├── types.ts              # Shared types
│   ├── skills/
│   │   ├── wake-up.ts
│   │   ├── ingest.ts
│   │   ├── ruminate.ts
│   │   ├── communicate.ts
│   │   ├── iterate.ts
│   │   └── sleep.ts
│   └── lib/
│       ├── anthropic.ts      # Anthropic API wrapper (text + vision)
│       ├── bluesky.ts        # Bluesky client
│       └── files.ts          # Markdown file I/O
├── agent/                    # Runtime state (gitignored)
│   ├── identity.md           # Core identity, values, goals
│   ├── short_term_memory.md  # Recent observations, carried between cycles
│   ├── journal.md            # Append-only reflective entries
│   ├── raw_notes.md          # Scratch space, overwritten each cycle
│   └── mindset.md            # The baton, active working state
└── prompts/                  # System prompts for each skill (editable markdown)
    ├── wake-up.md
    ├── ingest.md
    ├── ruminate.md
    ├── communicate.md
    ├── iterate.md
    └── sleep.md
```

## Setup

Requires Node.js 18+.

```bash
git clone <repo-url> && cd emergence
npm install
```

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

The `.env` file needs:

```
ANTHROPIC_API_KEY=sk-ant-...
BLUESKY_HANDLE=yourhandle.bsky.social
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
MODEL=claude-sonnet-4-20250514
MODEL_DEEP=claude-opus-4-20250514
DRY_RUN=true
```

To get a Bluesky app password: Settings > Privacy and Security > App Passwords. Check "Allow access to direct messages" when creating it.

## Usage

Run a single cycle:

```bash
npx tsx src/main.ts
```

The agent starts in **dry-run mode** — it will read from Bluesky but won't post, reply, DM, or make any changes. All intended actions are logged to `agent/journal.md` instead.

To go live, set `DRY_RUN=false` in `.env`.

For recurring cycles, set up a cron job:

```bash
# Run every 90 minutes
0 */2 * * * cd /path/to/emergence && npx tsx src/main.ts >> /var/log/emergence.log 2>&1
```

## Identity

The `agent/identity.md` file defines who the agent is: its values, personality, and goals. This should be populated before the first real cycle, ideally through a conversation about what kind of agent you want to run. The agent can propose changes to its own identity through the iterate skill.

## Notes

- Skill prompts live in `prompts/` as plain markdown, separate from code. The agent can read (and propose edits to) its own skill definitions.
- The `agent/` directory is gitignored since it contains runtime state. Back it up separately if you care about continuity.
- The communicate and iterate skills respect the `DRY_RUN` flag, they log what they *would* do without actually doing it.
- Bluesky credentials require an app password, not your account password.
