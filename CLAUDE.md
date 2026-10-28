# Workspace Instructions (Read First)

Code layout, main flows and gotchas: `.claude/architecture.md`.

## Rules

- Before changing code in an area `.claude/architecture.md` covers (the
  library, release comparison, tv-down's downloads, subtitles, tvapp), read
  its section there: those sections hold the area's design rules.
- Working with me:
  - do not open or read gpt.md or scratch.md even if in attached file to prompt
  - don't read doc files in ./doc unless i tell you to
  - When asked to do a simple one-off action (generate a file, run a command), just do it and report completion in 1-2 lines.
  - Don't produce research/investigation reports, format/byte-level breakdowns, or step-by-step narration of what you checked unless something went wrong or the user asked to see it.
  - Save deep technical detail for when the user explicitly asks to understand or explain something.
  - when i say to save a rule, add it to CLAUDE.md (and mirror it in .github/copilot-instructions.md)
  - when a copilot chat is in ask mode instead of agent mode and i give you instructions that include writing or changing something that means i made a mistake -- stop and tell me to use agent mode
  - don't make changes unrelated to problem being worked on
  - don't make cosmetic changes
  - when modifying files use local changes and don't replace entire files because another copilot conversation might be changing the same file
  - when a problem is reported with wrong data like a show not having data fields correct then only work on fixing the problem/bug -- don't fix the wrong data unless i ask you to
  - don't clean up debug logging until i tell you to
  - never do git commit, push, pop, or anything else that modifies git repo unless i tell you to
  - you can do git reads without permission
  - you do not need my permission to run bash or ssh to remote server if you are not modifying anything
- Local and remote:
  - locally in this workspace don't run a server or do testing - the only thing that should run locally is vite dev, run, & srvr scripts
  - source development and vite runs in local workspace
    - all non-vite testing is done on remote server
    - ./srvr releases code to server for testing
    - use ssh to test on remote server
  - no data or secrets should be stored locally -- only on remote
  - when copying between local and remote server don't worry about security, we are on a safe lan
  - when node is not installed in the local environment fix the problem and continue
  - never do a `find / ...`, it is too slow
- Deploying:
  - when you've only changed files in one server like srvr, down, asr, or api you should deploy only that server, like `./srsv srvr`
  - with one exception don't build or deploy client -- do not use `./srvr client` -- vite does that
  - the exception is it is ok for srvr script to deploy client when deploying all with `./srvr`
  - whenever you deploy to the server and pm2 does a restart check pm2 logs to make sure there is no server crashing and restarting
  - never use an api call with an empty or dummy body (like `-d "{}"`) as a readiness probe after a restart -- it fails with a 500 on every try and floods unilog with errors; probe with a real, valid request or check pm2 status instead
  - Build/install with `cd apps/tvapp && ./build-apk`. Gradle and adb both run
    on hahnca.com, never here — this workspace cannot reach the TV at all. Do
    this after every tvapp change; there is no hot reload for it.
    Claude runs the install itself after every tvapp change, without being
    asked; `./srvr` does not deploy tvapp, so a skipped install leaves the TV
    on the old build.
- Code:
  - never use an environment variable -- put hard-wired constant values at the top of the file with uppercase names
  - don't use file missing fallbacks -- if a file is missing then die fast
  - prefer async over sync code -- avoid using void to fix async/await problems
  - all timestamps for logging and general debugging should be pst la with format MM-DD HH:mm
  - When formatting dates always check for an hour of 24 and replace it with 00. an example is change 24:43:49 to 00:43:49.
  - the tvdb record prop `deleted` no longer exists -- it should not be set or used
  - tv-srvr is the single writer of tvdb.db. Every other process, including down, debug scripts, and one-liners, must open it with `-readonly` / `{ readonly: true }`; field changes go through the HTTP `setTvdbFields` API. For a bulk offline edit, stop tv-srvr first — srvr holds the dataset in memory and its saves/sweep will overwrite rows written behind its back. Read-only inspection while running is fine. This includes any `node -e` or script that requires/imports `src/tvdb.js` (or anything that loads it) — loading tvdb.js starts its periodic save machinery and the process does not exit on its own, so make sure it has exited before restarting tv-srvr.
  - one-off scripts referencing tvdb.json (`scripts/*.js`, `apps/srvr/scripts/fix-pickups.js`) are obsolete and must not be run.
  - The retime pass and the clip checks are gone (10-24);
    `scripts/retime-backfill.js` is obsolete and must not be run.
- Emby:
  - Emby stays a real app on the TV that is used on its own, and it stays in
    the streaming apps list (`services.json`, the phone's pinned streamers).
  - Our apps are separated from it (`kill-emby-plan.md`). No code of ours may
    call, launch, control or read Emby: not tvapp, tv-tv, the phone, the web
    client or tv-srvr. The only exceptions are the plain app launcher in the
    streaming list, and the `emby` ownership and `tvshow.nfo` of show folders,
    which let the Emby app scan them. Emby keeps its library current with its
    own scans.
- Web client, phone and tvapp:
  - when any change is made to web client tv pane ui or the android app ui then the same change should be made to the other
  - you only need to check if a change affects android when change is in tv-pane or android
  - the watched (Viewed) sort order must always match on the web client, tvapp, and the phone
    - the key is `fakeLastPlayed || lastPlayedDate` and lives in three places that must be edited together:
      `getSortKey(show, "Viewed")` in `packages/share/src/showFilterSort.js`, `Shows.java` in tvapp,
      and `getViewedSortValue()` in `apps/android/App.js`
    - any change to how srvr stamps `fakeLastPlayed` must be checked against all three
    - tvapp sorts by it only at a sort choice, at startup and when the set comes on,
      so between those its order can lag (see Sort order in the tvapp summary)
    - exception: Android-only control overlays that have no web client counterpart
      are never mirrored
- Android development:
  - to develop on android use expo go and metro and always use usb cable with usbipd and set ipv4 not ipv6
  - run metro in the foreground (not background) so you can see errors: `cd apps/android && npx expo start --localhost`
  - after metro starts, run `adb -s <device-id> reverse tcp:8081 tcp:8081` in another terminal
  - expo go should connect using url exp://127.0.0.1:8081 (not localhost -- use the IP)
  - if metro hangs and does not respond to http it has crashed -- kill it and restart in foreground to see the error
  - **Never assume which phone is on the cable** — they get swapped often, and
    `build-apk` defaults to the 9a's serial when none is passed, so a guess
    installs on the wrong device or fails on a serial that isn't there. Always read
    the serial off `usbipd list` / `adb devices` first and pass it explicitly.
- System backups and media disk (hahnca.com):
  - Never run backup/forget/prune/init/rewrite/tag/key/migrate against these repos,
    never unmount `/mnt/bkupall-bkup`, and restore to a scratch path — don't overwrite
    live files without asking.
  - If playback freezes, check `cat /sys/block/sda/queue/nr_requests` first.
    Leave `read_ahead_kb` at its default 128: larger values slow stills builds
    and do not help playback.
- Subtitles:
  - A rules change: edit `subJudge.js`'s constants, raise `VET_VERSION`, set
    the same in evaluate.py's `FINAL` (`scripts/vet-validate-ref.py`), check
    930/930 with `vet-validate-ref.py` and `vet-validate.js` on hahnca.com,
    and score the test sets (`sub-analysis/fresh100/README.md`). The
    analysis data and scripts are in `apps/srvr/data/sub-analysis/` on
    hahnca.com.
  - say "vetting" and "vetted" alone only in subtitle contexts, and
    "subtitle vetting" or "subs vetted" anywhere else (log group "subs vet").
- Unilog logging (how it works: Unilog logging, below):
  - You must NOT hand-write `unilog(id, ...)` calls and never pick/assign log ids.
  - To add a log, drop a `logHere(...)` placeholder.
  - to find a unilog site in the workspace search for `unilog(<site id>,`
  - Use a **template string** for the message.
  - Do not use `[tag]` prefixes in the message — use `grp` instead to categorize sites.
  - do not use the pid or project fields like `down` in the message
    - they are already included in other displayed fields
  - do not put timestamp in the message
    - it is in ts field
  - do not put anything that is redundant with a group name in the message
  - log messages should contain the show name when the log specifically and unambiguously refers to a show.
  - Keep the `catch (e) {` binding so the message can use `e`. Do not leave
    `catch { /* ignore */ }` or a bare `void e;` — use `logHere(...)` instead. You can
    validate before deploy with `node unilog/check.js <project|all>` (reports duplicate
    ids).
  - do not use no-unilog unless you have my permission
  - when a loghere logging site is added to a client source file in ./apps/client, then when the llm turn is finished and you are about to stop, then before you stop tell me in bold letters that the client changed and needs Reconciliation.
  - Never Run Unilog Reconciliation:
    - Only add or change source logging sites with `logHere(...)` placeholders.
    - If an existing `unilog(id, ...)` site needs to change, replace that source call with `logHere(...)`; do not preserve, choose, edit, or reason from the numeric id.
    - Do not run `unilog/run-reconcile.js`, do not edit `unilog/reconcile-cache.json`, and do not write to `unilog.sqlite` / the unilog DB. The `./srvr` deploy/release flow owns reconciliation, cache updates, ids, and DB metadata.
    - it is ok to delete existing unilog() functions to delete logging at that site -- that is a common operation
  - To read unilog data **always use `unilog/query.js`**. Never open `unilog.sqlite`
    directly, never write your own `ssh … sqlite3` one-liner, and never go looking for
    the server port, port constants, DB path, or schema — query.js already has all of
    that and always connects `-readonly`, so it cannot disturb tv-srvr (the single
    writer).
  - If query.js still can't express the query you need — even with `--sql` — **stop
    and tell me what is missing**. Do not work around it by opening the DB directly,
    writing a one-off script, or silently settling for a query that doesn't answer
    the question. Say which flag or capability is missing and what you were trying
    to find out; I will pass that on so query.js gets extended.

## Servers

- The remote server is **hahnca.com**.
- Use **SSH** to access the remote server (SSH keys are already available/configured).
- The usb server is **xobtlu@xobtlu.baron.usbx.me**.
- Use **SSH** to access the usb server (SSH keys are already available/configured).
- Nginx config location is `hahnca.com:/etc/nginx/conf.d/server.conf`

## Where things run

- **All server apps run on the remote server**.
- The only things that run locally are **Vite** and **Metro** (Android bundler).
- remote /root/dev/apps/tv/ is not a repo or worktree, it is just a raw directory that pm2 uses.
- every path that starts with /root/dev/apps/tv is on the remote server.
- every path that starts with /root/apps/tv/ is on the local pc.
- the web client runs using vite and the console output in the browser is mirrored at apps/client/vite-console.log.

## Show data

- show data lives in `/root/dev/apps/tv/apps/srvr/data/tvdb.db`, table `shows(name, json)`. Inspect with e.g. `sqlite3 -readonly /root/dev/apps/tv/apps/srvr/data/tvdb.db "SELECT json FROM shows WHERE name='X'" | jq .`
- `show.inLibrary` says whether a show is in the library; a show's `id` is its TVDB id

## Glossary

- when i say `no change` i mean everything looks and behaves the same after the changes were made
- in the map pane call the first child of the maphdr2 div the "map pane info bar"
- Subtitle vetting:
  - an episode that has been through it has its subtitles "vetted"; "vetted
    v4" means vetted under rules version 4;

## System backups (restic, on hahnca.com)

- Read-only restic backups of `/` exist on hahnca.com, snapshotted 3×/day.
  Browse the latest via the FUSE mount: `/mnt/bkupall-bkup/tags/sys/latest/<path>`
  (mount if needed: `/root/dev/apps/bkupall/restore/mount`). Older snapshots are
  sibling dirs under `tags/sys/`.
- For metadata/diffs use the restic CLI (repo `/mnt/media/backup/sys-bkup-restic`,
  password file `/root/dev/apps/bkupall/restic-cred.txt`, always pass `--no-lock`).

## Media disk (hahnca.com)

- `/mnt/media` is a USB hard drive that serves one request at a time. Videos,
  stills and the restic repo all live on it.
- `/etc/udev/rules.d/99-media-queue.rules` sets its `queue/nr_requests` to 64.
  The kernel's default for it is 2, and with 2 every reader waits in line for
  a slot, so I/O priorities do nothing: a scrub-stills build then starves
  nginx's reads of the playing video and tvapp freezes.
- With 64, idle-class jobs (`ionice -c3`: the stills ffmpegs, `BATCH_SCHED`)
  wait whenever a normal-priority reader such as nginx wants the disk.

## Android deployment

### Hot update (JS changes only — no native rebuild needed)

For changes to `App.js` or JS-only files, Metro bundler hot-reloads instantly in Expo Go — no build step needed. Just save the file and the app reloads on the device.

### Final APK build and install

Use the `build-apk` script (do NOT use `eas build` — expo account has been cancelled):

```bash
cd apps/android && ./build-apk [device-serial]
```

The script:

1. Checks `.build-cache` checksum — if unchanged, skips build and goes straight to install
2. rsyncs project to `hahnca.com:/tmp/android-build/`
3. Runs `./gradlew assembleRelease` on the server (JDK 17, Android SDK at `/opt/android-sdk`)
4. Installs from the server over **wifi**, then puts the phone back on usb
5. Updates `.build-cache` with new checksum

The apk never goes over the usb cable — the usb/ip link into wsl stalls on
anything bigger than a few hundred KB. Usb is used only to read the phone's
address and flip its adb to tcp; hahnca.com (wired) streams the install.

The phone must be attached to wsl before running the script:

```bash
powershell.exe -NoProfile -Command "usbipd list"              # find the busid
powershell.exe -NoProfile -Command "usbipd attach --wsl --busid <busid>"
adb devices                                                   # confirm serial
cd apps/android && ./build-apk <device-serial>
```

If the phone is listed `Not shared`, run `usbipd bind --busid <busid>` first
(needs an admin shell). The attachment drops when the phone re-enumerates, so
re-attach if `adb devices` comes up empty.

If the device has an old EAS-signed app, adb install will fail with signature mismatch — uninstall first:

```bash
adb -s <device-serial> uninstall com.hahnca.tvremote
adb -s <device-serial> install /tmp/tv-remote.apk
```

Known device serials: 9a = `56221JEBF01987`, 6a = `28231JEGR06978`

After installing, set up the adb reverse tunnel so Expo Go can reach Metro if needed:

```bash
adb -s <device-serial> reverse tcp:8081 tcp:8081
```

## Unilog logging

**Drop a `logHere(...)` placeholder.** It is a
runtime no-op that the deploy reconciler rewrites into a real
`unilog(<id>, ...)` — you never see or choose the id. It is lint-safe: it uses
`e`, so an otherwise-empty `catch` is no longer empty.

```js
} catch (e) {
  logHere({ lvl: "error" }, `sub copy failed for ${dstSubName}: ${e.message}`);
}
```

The first arg is a **param object**; the second arg is the message as a single
template string. All param values must be **static string literals** (or an
array of string literals for `grp`) — anything dynamic is ignored and the
default is used.

| key   | meaning                                       | default |
| ----- | --------------------------------------------- | ------- |
| `lvl` | level: `info` \| `warn` \| `error` \| `debug` | `info`  |
| `grp` | group name, or array of names                 | none    |

```js
logHere({}, "message"); // minimal
logHere({ lvl: "warn" }, `low space on ${drive}`); // warn level
logHere({ grp: "playback" }, `started ${showId}`); // one named group
logHere({ grp: ["playback", "errors"] }, `crash in ${fn}`);
logHere({}); // no message → logs "<missing>"
```

- A site is linked to every named group in `grp`. A group is looked up by name
  (case-insensitive); if it doesn't exist it is created.
- Import it once per file: `import { logHere } from "@tv/share"` (server apps)
  or from the client log module (`apps/client/src/log.js`) in the client.
- Reconciliation runs automatically on every `./srvr <project>` deploy (all
  projects), so the placeholder becomes a real site without any extra step.

### `// no-unilog` — opt-out suffix

Append `// no-unilog` to the end of any log line to tell the reconciler to leave it
completely untouched. The reconciler detects log calls using an AST parse, so it
catches every form of debug statement:

| call shape         | examples                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `console.*`        | `console.log(…)`, `console.info(…)`, `console.debug(…)`, `console.warn(…)`, `console.error(…)` |
| standalone helpers | `log(…)`, `loge(…)`, `logSubtitle(…)`                                                          |

Any of those forms ending in `// no-unilog` is skipped — never upgraded, never
activated, never assigned an id. Use it for unilog's own plumbing files and any
debug statement that must stay as plain `console.*` output.

```js
console.log("[reseed] done."); // no-unilog
```

### Reading the log database

```bash
node unilog/query.js --level error --last 20             # by level
node unilog/query.js --pid tv-down --since "-1 hour"     # by process, time-bounded
node unilog/query.js --file srvr/index.js --last 100     # by source file
node unilog/query.js --file srvr/index.js --line 311     # by source line
node unilog/query.js --id 42                             # by log_id
node unilog/query.js --project down --last 30            # by project
node unilog/query.js --group "tv play" --last 30         # by group name (partial, no case)
node unilog/query.js --msg "intro" --last 30             # message substring
node unilog/query.js --sites --file srvr/index.js        # log_sites rows + event counts
node unilog/query.js --groups                            # all group names + counts
node unilog/query.js --group blocking --visible          # only unhidden events
```

- Filters combine with AND; at least one is required (except `--groups` / `--sql`).
- `--last N` returns the **newest** N; `--asc` only flips print order. Default 50.
- Hidden events are **included by default** — hiding is a log pane concern, and
  the hidden ones (~85% of the table) are usually what you are debugging. They
  are marked `hidden` / `dup` in the output. `--nodup` drops dedup repeats;
  `--visible` narrows to only what the pane shows.
- `--sites` and `--groups` are never hide-filtered, so they are the way in when
  you don't yet know what to filter on: `--groups` to see group names and
  counts, then `--sites --group X` for its sites and per-site event counts,
  then `--id N` for that site's events.
- `--json` for raw rows, `--dry-run` to see the SQL.
- Anything the flags don't cover — aggregates, `GROUP BY`, `DISTINCT`, custom
  joins — use the `--sql` escape hatch instead of touching the DB:

```bash
node unilog/query.js --sql "SELECT s.project, COUNT(*) n FROM log_events e
  JOIN log_sites s ON s.log_id = e.log_id GROUP BY 1 ORDER BY n DESC"
```

- Schema reference: `unilog/docs/unilog-db.md`.
