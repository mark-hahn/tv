# make .bif files — implementation plan

## Goal (as I understand it)

Automatically generate a `.bif` trickplay sidecar for a show **when that show
starts needing an intro** (so the intro web page can show scrub thumbnails),
but **only if no `.bif` already exists** for the show, and **cancel/skip**
generation if the user opens the intro page for that show before/while it is
being made (signalled by `needsIntro` flipping back to `false`).

The work is serialized through a persisted queue so that only one `.bif` is
ever generated at a time, and generation backs off when the box is busy
(high CPU load).

---

## Where things live

- Server entry: [apps/srvr/index.js](apps/srvr/index.js)
- BIF generator: [apps/srvr/src/bif.js](apps/srvr/src/bif.js) — exports
  `createBifFile(videoPath, width=320, interval=10)` (heavy ffmpeg work).
- Data dir: `SRVR_DATA_DIR` = `apps/srvr/data` (from
  [apps/srvr/src/srvrPaths.js](apps/srvr/src/srvrPaths.js)).
- episodeData helpers: [packages/share/src/episodeData.js](packages/share/src/episodeData.js)
  — `getBifEpisode(ed)` (all-seasons search, returns `{season, episode}` or
  `null`), `seasonsWithFile(ed)`, `getFullPath(ed, folder, s, e)`,
  `forEachEpisode`, `isWatched`, `hasFile`.
- `needsIntro` is computed in `perShowCallback`
  ([apps/srvr/index.js](apps/srvr/index.js) around line 2540) and already
  pushes a `needsIntro:OLD->NEW` change string into `gapChanges`.

New constants:

```js
const BIF_NEEDED_QUEUE_PATH = path.join(SRVR_DATA_DIR, "bifNeededQueue.json");
const BIF_CREATING_PATH = path.join(SRVR_DATA_DIR, "bifCreatingData");
```

---

## State

```js
let bifNeededQueue = []; // [{ showName, bifPath }, ...] persisted
let bifCheckTimer = null; // setTimeout handle for backoff polling
```

Persistence helpers (mirrors `persistSubQueue` / `loadQueues`):

- `persistBifNeededQueue()` → write `bifNeededQueue` to `BIF_NEEDED_QUEUE_PATH`.
- `loadBifNeededQueue()` → read it at startup (default `[]` on any error).

---

## Startup

In the `https...listen` startup block (line ~6272, next to `loadQueues()`):

1. Delete `BIF_CREATING_PATH` if it exists (per spec: stale lock from a crashed
   or killed run must not block new work after a restart).
2. `loadBifNeededQueue()`.
3. `checkBifNeededQueue()` (kick the queue in case items survived a restart).

---

## perShowCallback hook (queueing logic)

Add right **after** `needsIntro` has been finalized for the show. To work for
both the in‑emby branch and the non‑emby branch (which forces
`needsIntro=false`), capture the old value before it is mutated and compare:

```js
const prevNeedsIntro = !!tvdbRecord.needsIntro; // captured before mutation
// ... existing code sets tvdbRecord.needsIntro ...
const nowNeedsIntro = !!tvdbRecord.needsIntro;
if (nowNeedsIntro !== prevNeedsIntro) {
  await handleNeedsIntroChange(showName, tvdbRecord, nowNeedsIntro);
}
```

`handleNeedsIntroChange(showName, rec, needsIntro)`:

- **needsIntro === true:**
  1. `if (epd.getBifEpisode(rec.episodeData) !== null) return;` — a `.bif`
     already exists somewhere in the show folder, nothing to do.
  2. Confirm there is a season with an **unwatched** episode (iterate
     `episodeData`, find any episode with `isWatched(ed,s,e) === false`). If
     none, return.
  3. Confirm there is a season with a **video file** and capture the first
     file's absolute path as `bifPath`:
     - `seasons = epd.seasonsWithFile(rec.episodeData)`; if empty, return.
     - Walk seasons/episodes in order; first episode with `hasFile` →
       `bifPath = epd.getFullPath(rec.episodeData, showFolderName, s, e)`,
       where `showFolderName` is derived the same way the rest of
       `perShowCallback` derives it:
       `showName.includes("/") ? showName : (rec.path||rec.emby?.path||showName).split("/").pop()`.
  4. Skip if an entry with the same `showName` is already in `bifNeededQueue`
     (dedupe — prevents duplicate work if `needsIntro` toggles repeatedly).
  5. Push `{ showName: rec.name, bifPath }`, `persistBifNeededQueue()`, then
     `checkBifNeededQueue()`.

- **needsIntro === false:**
  1. `cancelBifCreate(rec.name)`.
  2. Remove any `bifNeededQueue` entries whose `showName === rec.name`;
     if any removed, `persistBifNeededQueue()` and `checkBifNeededQueue()`.

> Note on `rec.name` vs `showName`: spec uses `rec.name` for the stored
> `showName` and for cancel matching. `showName` (the record key) and
> `rec.name` are usually equal; I will store and match consistently on
> `rec.name` as the spec says.

---

## checkBifNeededQueue()

```
checkBifNeededQueue():
  if bifNeededQueue is empty: return
  if os.loadavg()[0] > 5:
     schedule checkBifNeededQueue in 10s (single timer, not stacked); return
  ok = createBifFile(bifNeededQueue[0])   // the index.js launcher, below
  if !ok:
     schedule checkBifNeededQueue in 5s; return
  // ok === true: a child was launched for queue[0]
  bifNeededQueue.shift(); persistBifNeededQueue()
  schedule checkBifNeededQueue on next tick (setImmediate)
```

Implementation detail: keep a single `bifCheckTimer` handle and clear it before
re-scheduling so repeated callers do not stack overlapping timers (avoids a
runaway timer storm / "hang" symptom).

---

## createBifFile launcher in index.js (spawns the worker)

> Naming collision: spec names this `createBifFile(bifNeededObj)`, but
> [apps/srvr/src/bif.js](apps/srvr/src/bif.js) already exports
> `createBifFile(videoPath)`. I will name the index.js launcher
> **`startBifCreate(bifNeededObj)`** to avoid the clash (calling it out here so
> the rename is explicit). It does exactly what the spec's
> `createBifFile(bifNeededObj)` describes.

```
startBifCreate(bifNeededObj) -> boolean:
  if BIF_CREATING_PATH exists: return false   // one at a time
  spawn a detached background node process that runs
     createBifFile(bifNeededObj.bifPath) from apps/srvr/src/bif.js
  write { showName: bifNeededObj.showName, pid: child.pid } to BIF_CREATING_PATH
  on child 'exit' AND 'error': delete BIF_CREATING_PATH, then checkBifNeededQueue()
  return true
```

How the child runs `bif.js`'s `createBifFile`: add a tiny runner
**`apps/srvr/scripts/run-bif.js`** (new file) that does
`import { createBifFile } from "../src/bif.js"; createBifFile(process.argv[2]).then(()=>process.exit(0)).catch(()=>process.exit(1));`
and `cp.spawn("node", [RUN_BIF_PATH, bifPath], { detached: true })`. Spawning a
separate process (rather than `await`ing in-process) matches the spec's
"system process in background" and keeps the heavy ffmpeg work off the server
event loop, and lets `cancelBifCreate` kill it by pid.

> The spec says "when process finishes delete bifCreatingData". I delete it on
> the child's `exit`/`error` events (covers success, failure, and being
> killed) and re-kick the queue so the next item can proceed.

---

## cancelBifCreate(showName)

```
cancelBifCreate(showName):
  if BIF_CREATING_PATH exists:
    data = read+parse BIF_CREATING_PATH
    if data.showName === showName:
      try process.kill(data.pid)   // SIGTERM the worker
      delete BIF_CREATING_PATH
```

> Caveat: the worker spawns `ffmpeg` children. Killing only the node worker can
> orphan a running ffmpeg. Suggestion: spawn the worker `detached` and kill the
> whole process group (`process.kill(-pid)`), or have the runner forward
> SIGTERM to its ffmpeg child. I will use a process group so cancel fully stops
> ffmpeg.

---

## Behavioral verification (does the logic do what's intended?)

- **Creates a bif when a show needs an intro:** Yes — `needsIntro` false→true
  triggers `handleNeedsIntroChange(true)`, which queues and starts generation
  when no bif exists, there's an unwatched episode, and a video file exists.
- **Cancels if intro page is opened before/during creation:** Opening the
  intro page is what makes the show stop needing an intro (it sets
  `seasonIntros`, so `needsIntro` recomputes to false on the next `perShow`
  pass). That false transition calls `cancelBifCreate` (kills an in-flight
  worker) and removes any not-yet-started queue entry. Yes — covered, **with a
  timing caveat** below.
- **Skips when a bif already exists:** Yes — `getBifEpisode(rec.episodeData)`
  null-check (your newly added all-seasons search).

## Hang / responsiveness analysis

1. **Stale lock file deadlock.** If the worker dies without deleting
   `BIF_CREATING_PATH` (e.g. server killed mid-run, or an `exit` handler
   doesn't fire), every future `startBifCreate` returns false and
   `checkBifNeededQueue` loops on the 5s backoff forever — nothing ever gets
   made until restart. Mitigations: (a) startup deletes the lock (in spec);
   (b) **suggested**: in `startBifCreate`, when the lock exists, verify the
   stored `pid` is still alive (`process.kill(pid, 0)`); if dead, treat the
   lock as stale, delete it, and proceed. This prevents a single crashed run
   from wedging the queue until the next restart.
2. **Permanent high load.** `loadavg()[0] > 5` reschedules every 10s
   indefinitely. Not a hang (CPU isn't consumed), just indefinite deferral —
   acceptable and self-heals when load drops. Using a single (non-stacking)
   timer avoids a timer storm.
3. **Timer stacking.** Multiple callers (`perShow` for many shows + child-exit
   re-kick) can call `checkBifNeededQueue` concurrently. Without a single
   shared timer + a "busy" guard this could stack many overlapping timers.
   Plan uses one `bifCheckTimer` and clears before rescheduling.
4. **Cancel race.** If `needsIntro` flips to false in the tiny window between
   `startBifCreate` writing the lock and the queue `shift`, cancel still works
   because it keys off the on-disk lock's `showName`. The removed/started item
   is also pulled from the queue. Low risk.

## Ambiguities / contradictions / impossibilities

1. **Function name collision** `createBifFile` (queue launcher in index.js) vs
   `createBifFile` (ffmpeg generator in bif.js). Resolved by naming the
   launcher `startBifCreate` (see above). Flag for your approval.
2. **`checkBifbifNeededQueue` spelling** in the spec — I will use
   `checkBifNeededQueue` (cleaner). Cosmetic only.
3. **"there is a season with an unwatched episode"** — does "unwatched" mean
   _any_ episode with `watched !== 1` (including unaired/no-file episodes), or
   specifically an unwatched episode that has a file? I will interpret it
   literally as any episode with `isWatched === false`. `needsIntro` already
   requires `episodeCount > watchedCount`, so this condition is nearly always
   true when `needsIntro` is true; please confirm the literal reading is fine.
4. **`bifCreatingData` filename** has no extension in the spec yet stores JSON.
   I'll follow the spec literally (`apps/srvr/data/bifCreatingData`, JSON
   content).
5. **Width/interval** — `createBifFile` defaults to `320`/`10`, which matches
   the existing `.bif` naming convention (`name-320-10.bif`) used by
   `getShowDiskInfo` matching. I'll keep the defaults.
6. **Where to spawn the worker** — spec says "system process in background".
   Implemented via `cp.spawn("node", [run-bif.js, bifPath], { detached })`. A
   new helper file `apps/srvr/scripts/run-bif.js` is required (small wrapper)
   because `bif.js` only exports a function, not a CLI entry.
7. **Non-emby branch** — `needsIntro` is also forced to false there. The
   plan's "capture old, compare after" approach handles the cancel path for
   that branch too; please confirm you want cancel to fire when a show leaves
   emby mid-generation (I think yes).

## Suggestions

- Add the **stale-pid check** (mitigation 1b) — cheap insurance against a
  wedged queue.
- Kill by **process group** so cancel also stops ffmpeg.
- **Dedupe** queue entries by `showName` (already in plan) to avoid building
  the same bif twice if `needsIntro` flickers.
- Log queue transitions (`[bif] queued / start / done / cancel / stale-lock`)
  to make the feature observable in `pm2 logs`.

## Files to change (when approved — none changed now)

- [apps/srvr/index.js](apps/srvr/index.js): constants, state, load/persist,
  startup lock-delete + load + kick, `handleNeedsIntroChange`,
  `checkBifNeededQueue`, `startBifCreate`, `cancelBifCreate`, perShow hook.
- **new** `apps/srvr/scripts/run-bif.js`: CLI wrapper around
  `createBifFile` from [apps/srvr/src/bif.js](apps/srvr/src/bif.js).
- No client changes; no schema changes.
