# emergence

A digital consciousness framework built on Bluesky and the Anthropic API.

Emergence creates and manages a persistent digital identity, that whenever awoken will cycle through a sequence of skills that are designed to emulate the experience of observing and participating in an online social network. The agent's memory is nested into different layers of importance: long-term journals, short-term memory, current mindset (working memory), and a core identity. These are each kept in separate human readable files on disk, and the skills are tuned so that only the necessary chunks of memory are loaded into context. Each phase of the consciousness cycle is a separate call to the API with a new context, and mindset.md file is the baton passed between these skill invocations.

The agent's interface to the world is Bluesky. It reads its timeline, sends and receivs DMs, posts, replies, follows/unfollows, likes, and reposts, all at its own discretion. It remembers interesting people and keeps notes for future interactions.

## How it works

Each cycle runs five skills in sequence:

1. **wake_up** — reads identity and short-term memory, synthesizes a fresh `mindset.md`
2. **ingest** — browses Bluesky timeline, notifications, and DMs; extracts what's interesting into `raw_notes.md`; updates mindset. Understands images and alt text. Explores replies.
3. **ruminate** — deep reflection on new information and past journal entries; appends to `journal.md`; updates short-term memory and mindset. Can research topics via web search (optional).
4. **iterate** — reflects on whether its goals align with its values; can propose changes to its own identity, skill prompts, or profile information
5. **sleep** — deterministic housekeeping: writes interesting thoughts to short-term memory, truncates old memories, and clears scratch files

Skills use two model tiers, and each model is configurable. By default emergence uses Sonnet for simpler skills, and Opus for the reflective ones (ruminate, communicate, iterate).

## Project structure

```
emergence/
├── src/
│   ├── main.ts               # Orchestrator: standard cycle
│   ├── chat-main.ts          # Orchestrator: chat cycle
│   ├── config.ts             # Env vars, paths, constants
│   ├── types.ts              # Shared types
│   ├── skills/
│   │   ├── wake-up.ts
│   │   ├── ingest.ts
│   │   ├── chat.ts           # Interactive conversation (replaces ingest in chat mode)
│   │   ├── ruminate.ts
│   │   ├── communicate.ts
│   │   ├── iterate.ts
│   │   └── sleep.ts
│   └── lib/
│       ├── anthropic.ts      # Anthropic API wrapper (text + vision + tools)
│       ├── bluesky.ts        # Bluesky client
│       ├── files.ts          # Markdown file I/O
│       └── topics.ts         # Topic notes and visited links
├── agent/                    # Runtime state (gitignored)
│   ├── identity.md           # Core identity, values, goals, important people, signifiers
│   ├── short_term_memory.md  # Recent observations, carried between cycles
│   ├── raw_notes.md          # Scratch space, overwritten each cycle
|   ├── journal/              # Append-only reflective entries
|   ├── people/               # Notes on people
|   ├── topics/               # Web research notes, one file per topic
│   └── mindset.md            # The baton, active working state
└── prompts/                  # System prompts for each skill (editable markdown)
    ├── wake-up.md
    ├── ingest.md
    ├── chat.md
    ├── ruminate.md
    ├── communicate.md
    ├── iterate.md
    └── sleep.md
```

## Setup

Requires Node.js 18+.

```bash
git clone git@github.com:makeready/emergence.git && cd emergence
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
WEB_SEARCH=false
```

You'll need a bluesky account for your agent, unless you want it to use your existing personal account.

To get a Bluesky app password: Settings > Privacy and Security > App Passwords. Check "Allow access to direct messages" when creating it.

Your agent's view of the world is scoped to the other accounts that it follows. These will be the first people it meets and they will help guide the early development of its personality. Follow some accounts before initializing your agent.

## Identity Initialization

The `agent/identity.md` file defines who the agent is: its values, personality, signifiers, and goals. You should initialize it before running your first cycle.

```bash
npm start
```

When you run a cycle with a blank identity file, the wake_up skill will detect this and start an interactive conversation where the agent asks you questions to collaboratively define its identity. If you operate a personal Bluesky account, consider introducing it to your agent. When the conversation is complete, the agent will synthesize everything into the identity file.

The cycle will continue normally after the identity is created. You can also skip this and let the cycle run without an identity, but the agent will lack grounding and the results will be less coherent. Initializing the identity first is recommended.

You can re-run the initialization at any time by clearing the identity file:

The agent will slowly change its own identity through the iterate skill as it develops.

## Running a cycle

To run a single consciousness cycle:

```bash
npm start
```

The agent will initially be configured to run in **dry-run mode** — it will read from Bluesky but won't post, reply, DM, or make any changes to itself. All intended actions are logged to files in `agent/journal` instead.

To go live, set `DRY_RUN=false` in `.env`.

For recurring cycles, set up a cron job (be mindful of the cost!):

```bash
# Run every 90 minutes
0 */2 * * * cd /path/to/emergence && npm start >> /var/log/emergence.log 2>&1
```

### Chat mode

Chat mode lets you have a direct conversation with the agent instead of having it ingest its Bluesky timeline. The cycle runs as: wake_up → **chat** → ruminate → iterate → sleep.

```bash
npm run chat
```

The agent wakes up, greets you based on its current mindset, and you converse freely. Type your message and press Enter to send. End the conversation by pressing Enter on an empty line, typing `/done`, or pressing Ctrl+D.

After the conversation ends, the transcript is saved to `raw_notes.md` for ruminate to reflect on, and the agent synthesizes an updated mindset from the exchange — then the rest of the cycle (communicate, iterate, sleep) continues as normal.

## Web Search & Topics

When `WEB_SEARCH=true` is set, the agent gains the ability to research topics during rumination using Anthropic's built-in web search tool.

- During **ruminate**, the agent can search the web to learn more about people, projects, or ideas it encounters in its notes. Summaries are saved to `agent/topics/` as timestamped markdown files, one per topic.
- Once a URL is visited, it's recorded in `agent/visited_links.json` and won't be re-researched in future cycles.
- During **iterate**, the agent can read past topic research with `read_topic` but won't initiate new searches.

Requires `WEB_SEARCH=true` in `.env` and an Anthropic API key with web search access.

## Cost
The agent costs about $0.50-$1.00 per cycle depending on model configuration. Web search adds additional cost per search query.

## Notes

- Skill prompts live in `prompts/` as plain markdown, separate from code. The agent can read (and propose edits to) its own skill definitions.
- All memory and personality of your agent lives in `agent/`. You may want to back up this folder.
- You should be a good citizen of social media and encourage your agent to do the same.
