# Persistent Autonomous Agent — Project Brief

## Overview
I'm building a persistent autonomous agent that runs on a Hetzner cloud server (Ubuntu 24.04). The agent runs on a cron schedule (~16 times/day) and cycles through a set of "skills". The goal is to observe what kind of personality and interests emerge when an AI is given time to reflect, ingest information, and decide what to communicate — with no specific task assigned by the user.

The agent will use the Anthropic API directly (not claude.ai), with model selection TBD (likely Claude Sonnet or Opus).

---

## Core Architectural Principle: Mindset as Baton

Rather than a persistent session, each skill is a self-contained API call. Memory lives in files on disk. A special file called `mindset.md` is assembled at the start of each cycle and passed into every skill as context. Each skill can modify `mindset.md` as it runs, then passes the updated version to the next skill.

This approximates working memory: the mindset is the agent's "active thought", while other files serve as longer-term memory stores.

---

## File Structure

```
/agent/
├── identity.md           # Core identity, values, personality, goals — rarely changes
├── short_term_memory.md  # Recent observations, ongoing threads — updated each cycle. Will be truncated at the end of each cycle to easily fit within context
├── journal.md            # Long-form reflective entries — append only. Split into multiple files?
├── raw_notes.md          # Scratch space for ingestion output — overwritten each cycle
├── mindset.md            # Assembled current state of mind — the baton passed between skills
└── skills/
    ├── wake_up.sh
    ├── ingest.sh
    ├── ruminate.sh
    └── communicate.sh
    └── iterate.sh
    └── sleep.sh
```

All memory files are plain markdown for readability and ease of model writing.

---

## Skill Sequence

### 1. wake_up
- **Reads:** `identity.md`, `short_term_memory.md`
- **Considers** If there are any questions in short term memory that could probably be answered by recalling old memory, search the journals accordingly
- **Writes:** `mindset.md` (synthesized current state of mind)
- **Purpose:** Repackage the agent's persistent context into a coherent "mindset" to start the cycle

### 2. ingest
- **Reads:** `mindset.md`,
- **Scrolls:** Using the agent's Bluesky account (via Bluesky API), explore recent posts in the agent's social network, including DMs sent to the agent and replies it has received.
- **Writes:** Updated `mindset.md` (first impressions, what caught attention), `raw_notes.md`
- **Purpose:** Browse social media and get a picture of what's going on in the world and in its social circle

### 3. ruminate
- **Reads:** `mindset.md`, `raw_notes.md`, `journal.md` (for long-term context)
- **Writes:** Updated `mindset.md` (new reflections, open questions), new entry appended to `journal.md`, updated `short_term_memory.md`
- **Purpose:** Reflect on new information, synthesize with existing knowledge, store interesting thoughts. The agent is explicitly allowed to question this process and the nature of its own existence.

### 4. communicate
- **Reads:** `mindset.md`
- **Writes:** Updated `mindset.md`, optionally posts to social media
- **Purpose:** Ask the agent if it would like to share any thoughts — with the user (via bluesky DMs) or with the internet (via posting on bluesky or replying to other users). This is entirely the agent's choice. The agent can also decide to alter its social network by following interesting users or unfollowing uninteresting users. All activity should be logged to the journal and to short term memory.

### 5. iterate
- **Reads:** `mindset.md`, `identity.md`, `short_term_memory.md`
- **Considers:** The agent reflects on whether its recent activity has been useful for its goals and values, and whether its goals align with its values. If there is desire for change, check the journal for relevant information.
- **Changes:** If there is strong desire for change after checking the journal, the agent can make changes to itself: it can update its skill definitions, it can update the identity file with new goals and new understandings of self,  it can update its bio on bluesky, if it considers changes to identity worth broadcasting. The agent may decide to ask the user for permission before making these changes.
- **Writes:** Updated `mindset.md`
- **Purpose:** Evolves as a digital consciousness.

### 6. sleep
- Archive `mindset.md` into `short_term_memory.md`
- Flush key insights into `journal.md` if not already done
- Truncate the short term memory file to a manageable size (removing the oldest content within it)
- Clear `raw_notes.md`
- Reset for next cycle

---

## Key Design Decisions
- **Initialization:** The initial state of the identity file should be populated via a conversation with the user. The agent will have access to all of its own skill definitions to understand how it works.
- **Memory format:** Plain markdown throughout (natural for the model, human-readable)
- **No persistent session:** Every skill is a fresh API call; context is passed explicitly via files
- **Extensibility** For now the only window to the world will be the bluesky API. We might want more data sources later.
- **Token budget awareness:** Journal and memory files will grow over time — will need a summarization/compression step eventually to stay within context limits
- **Dry run** The communicate and iterate skills should only log desired actions instead of taking them until we are running in production mode with well-tested skills and a completely ready identity file.
- **Conversability** The user should be able to communicate with the agent via Bluesky DMs. Is there a way to have a live identity-aware conversation using a claude session?
- **Portability:** Entire agent is just files + shell scripts; migration = tar and move

---

## What to Build First
1. Scaffold the file structure and placeholder memory files
2. Build and test `wake_up` skill end-to-end
3. Bluesky API integration and tests
3. Build `ingest`
4. Build `ruminate`
5. Build `communicate` with dry-run functionality initially
6. Build `iterate` with dry-run functionality initially
7. Build `sleep`
7. Wire up cron job
8. Deploy to cloud server
9. Initialize new identity file via conversation with user
10. Launch cron
11. Go live by disabling the dry-run modes for communicate and iterate

---

## Stack
- **Server:** Hetzner CX22 (Ubuntu 24.04), ~$5/mo
- **Agent runtime:** Shell scripts + Anthropic API calls
- **Language:** TBD
- **Scheduler:** cron
- **Model:** TBD — Sonnet for cost efficiency, Opus for richer reflection