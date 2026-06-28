# Log-Adding Agent — Plan

Goal: define a single, dedicated agent that Copilot chat invokes **whenever a log
line needs to be added** to a source file. The agent is the _only_ sanctioned path
for adding logging, so every new log line is consistent and the registry + DB stay
in sync automatically.

This document is a plan only. No code has been changed.

> Depends on the universal-logging design in `univ-logs-plan.md` (the `logEvent()`
> shared routine, `logRegistry.json`, and the `log_sites` / `log_events` SQLite
> tables). This agent is the authoring tool that _produces_ correctly-formed log
> sites for that system.

---

## 0. Is this hard for me to generate? — Short answer: no.

It is very feasible. The work splits cleanly into two kinds:

- **Deterministic / mechanical** (id allocation, comment insertion, registry write,
  DB upsert, line-number refresh) — these are error-prone for an LLM to do by hand
  but trivial for a tiny CLI. **Push them into a script**, not into model reasoning.
- **Judgment** (where to place the log, choosing the tag, writing a ≤15-word
  description, picking error vs. normal, matching the file's existing style) — this
  is exactly what the model is good at.

So the recommended shape is a **thin AI agent over a deterministic CLI**. The agent
decides _what_ and _where_; the CLI performs the _edit + bookkeeping_ atomically.
The only genuinely tricky parts are concurrency on id allocation and keeping
`src_line` fresh — both solved below.

### 0.1 Logging destination policy (latest direction)

- **New log calls write to the DB only.** No new logging to console/pm2/flat files.
- The house `[tag]` style is preserved **only inside the stored message text** for
  readability — it is no longer written to a flat file.
- Existing `console.*` / wrapper / `appendFile` logging stays for now; a later
  migration removes **all** old file logging.
- This **supersedes** the earlier "add traditional logging to log files using
  existing style" instruction (see ambiguity #1).

---

## 1. What the agent must do (responsibilities)

Given an instruction like _"log when a bif build is queued in srvr"_, the agent:

1. Locate the correct insertion point in the target source file.
2. Format the message in the house **tag** style (see §4) — e.g. `[bif] …`. The call
   is a **universal (DB-only) log**; it does **not** write to console/pm2/flat files
   (§0.1).
3. Choose `tag` and `isError`. The **`description` is the creating prompt verbatim**
   (e.g. "log when a bif build is queued in srvr").
4. Allocate the next unique `log_id` (race-safe).
5. Insert the universal log call **plus** the `// log-id: <n>` trailing comment.
6. **Immediately** update `logRegistry.json` with the new site row (incl.
   `created_at`, `session_id`, `prompt`).
7. **Immediately** upsert the row into the remote `log_sites` table (ssh + sqlite3).
8. **Refresh `src_line`** for every `// log-id:` site below the insertion in that
   file (registry + DB), because inserting a line shifts everything beneath it.
9. Record the new `log_id` in session memory (`/memories/session/`) so "delete all
   added in this conversation" works later (§8).
10. Report back: the id, file:line, tag, prompt, and the exact inserted line.

The agent does **only** logging edits — it must not refactor or touch unrelated code.

---

## 2. Recommended architecture: AI agent + backing CLI

```
Copilot chat ──► log-add agent (decisions) ──► scripts/log-add.js (mechanics)
                                                     │
                          ┌──────────────────────────┼───────────────────────────┐
                          ▼                           ▼                           ▼
                  edit source file          update logRegistry.json      ssh hahnca.com
                  (insert call + comment)    (allocate id, add row,       sqlite3 UPSERT
                                              refresh sibling lines)       into log_sites
```

### Why a CLI underneath

- **Atomic id allocation** (file lock) prevents two chats picking the same id.
- **One implementation** of registry + DB writes — the model can't get it subtly
  wrong on the 50th call.
- **Idempotent / reversible**: the CLI can validate and refuse on conflicts.
- The agent's instructions stay short: "call `node scripts/log-add.js …` and report
  the result", instead of re-deriving bookkeeping each time.

### CLI contract (proposed)

```
node scripts/log-add.js \
  --file apps/srvr/index.js \
  --anchor "queued ${showName} ${bifPath}"   # unique nearby text OR --line N \
  --position after \                          # before|after the anchor line
  --tag bif \
  --prompt "log when a bif build is queued in srvr" \  # stored as description
  --session <conversation-id> \               # for conversation-scoped deletes (§8)
  --level info \                              # info|warn|error  (error => is_error=1)
  --message '`[bif] queued ${showName} ${bifPath}`'   # JS expression, project style
  [--dry-run]
```

The CLI:

1. Locks `logRegistry.json`, computes `next_id = max(log_id)+1`.
2. Renders the call line for the file's project style (§4) with the `// log-id: N`
   comment appended.
3. Inserts it at the resolved line; writes the file.
4. Re-scans the file for all `// log-id:` comments and updates each site's
   `src_file`, `src_line`, `project`, `old_log` in the registry.
5. Writes the registry; releases the lock.
6. Upserts the new + shifted rows into remote `log_sites` via
   `ssh hahnca.com 'sqlite3 /root/dev/apps/tv/logs/all-logging.sqlite "…"'`.
7. Prints JSON `{ logId, file, line, tag, desc, level, inserted }` for the agent.

`--dry-run` prints the planned edit + id without writing — the agent uses this to
preview, then re-runs to commit.

---

## 3. Agent definition (VS Code custom agent)

Create `.github/agents/log-add.agent.md` (sibling to the existing `tv-control` /
`Explore` agents). Sketch of frontmatter + body:

```markdown
---
name: log-add
description: >
  Use whenever a log line must be added to a source file. Adds the house-style
  traditional log AND the universal logEvent() call, allocates the log id, and
  updates logRegistry.json and the log_sites DB. The ONLY way to add logging.
tools: [read_file, grep_search, run_in_terminal, replace_string_in_file]
---

You add logging and nothing else. For each request:

1. Read the target region; find a unique anchor string near the insertion point.
2. Decide tag (reuse existing [tag] in that flow), a <=15-word description,
   and level (info/warn/error).
3. Run `node scripts/log-add.js --dry-run …` and verify the planned line/id.
4. Re-run without --dry-run to commit.
5. Report id, file:line, tag, description, and the inserted line.
   Never edit unrelated code. Never hand-write the log id or registry/DB updates —
   always go through scripts/log-add.js so allocation stays race-safe.
```

Restricting `tools` keeps the agent from wandering. (If invoked via `runSubagent`
instead of a `.agent.md`, the same body becomes the subagent prompt.)

---

## 4. Per-project logging style (the agent must match these)

The table shows each project's existing tag conventions (so new messages match) and
where that project's logs go **today**. New calls no longer target those files.

| project | existing house style (tag conventions)                                             | current destination (legacy)              |
| ------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| srvr    | `console.log` / `console.error`, `[tag]` prefix; `logSubtitle()` for subtitle flow | pm2 `tv-srvr-out/err.log`, `subtitle.log` |
| api     | `console.*` with `[tag]` prefix                                                    | pm2 `tv-api-out/err.log`                  |
| down    | `console.*`; `tvJson.js` appends `misc/tv.log`                                     | pm2 `tv-down-*.log`, `tv.log`             |
| asr     | `console.*`                                                                        | pm2 `tv-srvr` (spawned) / asr log         |
| tv      | `log()` / `loge()` wrappers                                                        | pm2 `tv-tv-*.log`, `tv-adb.log`           |
| client  | shared `apps/client/src/log.js` routine (POSTs + `console.*`)                      | browser console / `vite-console.log`      |

**DB-only for new logging (resolves ambiguity #1):** per the latest direction, new
log calls go to the **DB only** — they do **not** also write to console/pm2/flat
files. The agent emits a single universal call, keeping the house `[tag]` prefix in
the stored message text for readability:

```js
logEvent(/*id*/ 412, "info", `[bif] queued ${showName} ${bifPath}`); // log-id: 412
```

The "current destination (legacy)" column describes where each project's **existing**
logs go today; new calls no longer target those files. Existing `console.*` / wrapper
calls stay until the planned migration removes old file logging entirely.

---

## 5. Concurrency & id allocation

- Single source of truth for the next id = `max(log_id)` in `logRegistry.json`,
  guarded by an OS file lock (`proper-lockfile` or an `O_EXCL` lock file) during the
  read-modify-write. The CLI never trusts an id passed in.
- The remote `log_sites` table also has `log_id` as PRIMARY KEY, so a duplicate
  insert fails loudly — a second safety net against races.
- If two chats run the CLI concurrently, the lock serializes them; each gets a
  distinct id. No model-side coordination required.

---

## 6. Keeping `src_line` accurate

- After each insertion the CLI re-derives line numbers by scanning `// log-id:`
  comments in the edited file, so siblings below the new line are corrected
  immediately (matches the universal-logging requirement that line numbers be read
  while lines above change).
- Lines in _other_ files are unaffected by an edit, so no cross-file rescan needed.
- Process restart still reconciles everything from the registry (defense in depth).

---

## 7. Example end-to-end

Request: _"Add an info log in srvr when the flexget run starts."_

1. Agent greps `apps/srvr/index.js` for the start of the flexget run, picks anchor
   `flexgetIsRunning = true`.
2. Dry-run: `log-add --file apps/srvr/index.js --anchor "flexgetIsRunning = true"
--position after --tag flexget --desc "flexget run started" --level info
--message '`[flexget] run started`'` → previews id 1209 at line 842.
3. Commit run → inserts
   `logEvent(1209, "info", \`[flexget] run started\`); // log-id: 1209`,
adds the registry row (prompt = "Add an info log in srvr when the flexget run
starts", `created_at`, `session_id`), refreshes sibling `src_line`s, upserts
`log_sites`, and records id 1209 in session memory.
4. Agent reports: `log-id 1209 · apps/srvr/index.js:842 · [flexget] run started`.

---

## 8. Removing log lines

Removal **only deletes the call from the source file** (and tombstones the site).
**`log_events` rows are never deleted** — historical messages stay forever, so the
tombstoned `log_sites` row is kept (flagged `removed_at`) to keep old events
interpretable.

CLI: `node scripts/log-remove.js <selector>` (or `log-add.js --remove`). Selectors:

| selector                        | flag                            | how it resolves                                                                  |
| ------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| delete last added               | `--last`                        | highest `created_at` among non-removed sites (or last id in session memory)      |
| delete by location              | `--file F --line N` / `--id N`  | the `// log-id` at that spot                                                     |
| delete all by id                | `--id N`                        | the one site with that `log_id` (ids are unique — see ambiguity #9)              |
| delete all since date/time      | `--since "2026/06/27 12:00:00"` | every site with `created_at >= T`                                                |
| delete all in this conversation | `--session <id>`                | every site whose `session_id` matches (ids also tracked in `/memories/session/`) |
| delete by description in prompt | `--match "bif queued"`          | fuzzy match against `prompt`; **preview + confirm before deleting**              |

For each removal the CLI: deletes the source line, sets `removed_at` in registry +
`log_sites`, and refreshes sibling `src_line`s in that file. Multi-match selectors
(`--since`, `--session`, `--match`) print the full hit list and require confirmation
(or `--yes`) before editing, so a vague description can't nuke unintended logs.

> Removal never touches `log_events`; the message history for a removed site stays
> queryable forever via its tombstoned `log_sites` row.

---

## 9. Detecting externally-modified source files (on deploy)

Yes — feasible and worth doing. The registry's `src_line`s only stay accurate if
every edit goes through the agent; a hand edit or another chat silently shifts them.

On every `./srvr*` deploy, run a guard that compares each tracked source file to a
stored fingerprint and re-syncs line numbers when they differ:

- Store per-file `{ size, mtime, sha256 }` (a `logFiles.json` sidecar) the last time
  the agent touched it.
- At deploy, recompute fingerprints for all files that contain `// log-id:` comments.
- If a file changed **without** going through the agent (fingerprint mismatch),
  re-scan its `// log-id:` comments, refresh every affected `src_line` in the
  registry + `log_sites`, and update the stored fingerprint.
- Emit a deploy warning listing externally-modified files so drift is visible.

Prefer **sha256** over size+mtime alone: an edit can keep byte length identical and
some tools preserve mtime, so a hash is the only reliable change signal (size+mtime
is a fast pre-filter). This is exactly the "read line numbers while lines above
change" requirement, applied at deploy time as a safety net.

---

## 10. Ambiguities / contradictions / impossibilities

1. **Contradiction across messages — destination of new logs.** The first agent
   request said the agent adds "traditional logging to log files using existing
   style" _and_ universal logging. The latest notes say "only add new logging to db,
   no new logging to flat files" and "eventually remove all old logging to files."
   These conflict. Adopting the **newer** instruction: new calls are **DB-only**
   (§0.1/§4), the house `[tag]` style survives only inside the stored message, and
   the existing `console.*`/wrapper file logging is migrated away later. Confirm.

2. **"Update the `log_sites` DB immediately" — local vs. remote.** The DB lives on
   `hahnca.com` (`/root/dev/apps/tv/logs/all-logging.sqlite`); edits happen in the
   local workspace before `./srvr` deploys. "Immediately" therefore means an
   **ssh + sqlite3 UPSERT from the dev machine**. That's fine for `log_sites`
   (metadata), but note the _source change isn't live_ until deployed — the row will
   describe code that isn't running yet. Acceptable (process-start reconciliation
   fixes drift), but worth confirming.

3. **Single writer vs. agent-driven DB writes.** The universal-logging plan keeps one
   DB owner (tv-srvr) for runtime events. The agent writing `log_sites` over ssh is a
   _second_ writer to the same file. Low risk (rare, metadata-only, WAL +
   busy_timeout), but it does mean two write paths. Could instead have the agent only
   update `logRegistry.json` and let tv-srvr reconcile `log_sites` on its next
   restart/heartbeat — simpler, but not "immediate". Pick one.

4. **"The agent is the _only_ way to add logs" is a convention, not enforceable.**
   Nothing prevents a human (or another chat) from typing `console.log` directly.
   Best we can do: document the rule, and add a CI/lint check that flags any
   `console.*` (or wrapper) call lacking a `// log-id:` comment. Flagged as a
   guardrail, not a guarantee.

5. **Anchor ambiguity.** If the `--anchor` text isn't unique in the file, the
   insertion point is undefined. CLI must refuse when the anchor matches 0 or >1
   lines and ask the agent to narrow it (or pass `--line`).

6. **Out-of-scope contexts.** android and the Tampermonkey `*.user.js` files can't
   participate in universal logging (per `univ-logs-plan.md`). The agent must refuse
   to "add universal logging" there and, at most, add a plain traditional log.

7. **Vue SFCs / line counting.** Inserting into a `.vue` `<script>` block shifts the
   `// log-id` line numbers like any JS file; the rescan handles it. Just ensure the
   CLI only scans/inserts within `<script>` regions for `.vue`.

8. **Description = creating prompt.** Per the notes, `log_sites.description` is the
   prompt that created the log (e.g. "log when a bif build is queued in srvr"). This
   overloads `description` (was a generated ≤15-word flow summary). Suggest keeping
   **both**: `prompt` (verbatim) plus an optional short summary. Note prompts can
   exceed 15 words and may contain quotes/newlines, so the ≤15-word guidance no
   longer applies to this field. Confirm storing the raw prompt.

9. **"Delete all by id" vs. "delete by flow."** Each `log_id` is unique, so "all by
   id" deletes exactly one site. If you actually want to remove a whole logical group
   at once, we need a shared key (e.g. `tag` or a `flow_id`) and a `--tag` selector.
   Which did you mean?

10. **Conversation-scoped deletes need a conversation id.** "Delete all added in the
    current Copilot chat" requires a stable per-conversation identifier. Copilot does
    not hand the agent a guaranteed conversation id, so the plan tracks added ids in
    **session memory** (`/memories/session/`) and/or stamps `session_id` at add time.
    If a conversation spans restarts or session memory is cleared, this set may be
    incomplete. Confirm the approach.

11. **`log_sites` schema must grow.** This adds columns not in `univ-logs-plan.md`:
    `created_at`, `removed_at` (tombstone), `prompt`, `session_id`, plus a per-file
    fingerprint sidecar (`logFiles.json`) for the deploy check. `univ-logs-plan.md`
    should be updated to match — flagging the cross-doc dependency.

---

## 11. Suggestions

- **Build the CLI first, the agent second.** Once `scripts/log-add.js` is solid and
  tested, the agent file is ~30 lines of instructions. Most reliability lives in the
  CLI.
- **`--dry-run` by default in the agent's first call**, then commit — gives a cheap
  preview and keeps edits intentional.
- **Add a companion `scripts/log-rescan.js`** that rebuilds all `src_line`s and
  re-upserts `log_sites` from the registry across the repo — run in CI and after big
  refactors so drift never accumulates.
- **Lint rule** (eslint) to reject new `console.*` / wrapper calls without a
  `// log-id:` comment — turns the "only via the agent" convention into an enforced
  check (ambiguity #4).
- **Store `level` (info/warn/error)**, not just the error boolean, so the agent can
  faithfully represent `console.warn`. (Already suggested in `univ-logs-plan.md`.)
- **Keep `logRegistry.json` in git** so id allocation and `log-id -> location`
  review work without the live DB, and code review shows new log sites as diffs.
- **Tombstone, never reuse ids** when a log line is deleted, so historical
  `log_events` keep meaning.
- **A `--remove` mode** for the CLI (delete a `// log-id` site, tombstone it in
  registry + DB, refresh siblings) so removals stay consistent too.
- **`--yes`/preview for fuzzy deletes** so "delete by description" always shows hits
  first (§8) — never delete on an ambiguous match without confirmation.
- **Stamp `created_at` + `session_id` at add time** so date- and conversation-scoped
  deletes are pure data queries, not guesswork.
- **Tombstone (`removed_at`) instead of deleting `log_sites`** — keeps every retained
  `log_events` row interpretable forever (matches "never remove message entries").
- **`sha256` fingerprint per source file**, checked on deploy, to auto-heal
  `src_line` drift from external edits (§9).
- **A `log-doctor` command** that reports drift, orphaned `// log-id:` comments
  (in source but not registry) and orphaned registry rows (in registry but not
  source), so the two never silently diverge.
