# Comments on refactoring `apps/srvr/index.js`

## TL;DR

- Splitting the 9,965-line `index.js` is worthwhile, but **line count is not the
  real problem** — the real problem is a large web of **shared mutable state**
  and a **WebSocket messaging fabric** that almost every cluster touches. A naive
  split produces many small files that all import one giant `state.js`, which
  moves lines around without reducing coupling.
- **Do not create a new project / pm2 task.** It is one logical process (queues,
  a single WebSocket server, a single file watcher, shared caches). Splitting the
  process turns cheap in-process calls into IPC and multiplies surface area.
- **Put new files in `apps/srvr/src/`** — that folder already holds ~15 extracted
  modules (`tvdb.js`, `emby.js`, `tmdb.js`, `rotten.js`, `bif.js`, `unilogDb.js`,
  …). Add subfolders only when one domain grows past ~3 files.
- Of the three refactors below, **Option 2 (domain modules + a small composition
  root) is the best long-term target**, but **Option 1 (extract the leaf/pure
  clusters first) is the right first step** because it is low-risk and unblocks
  Option 2.

---

## What the file actually is today

Roughly 40% of the original server has _already_ been extracted into
`apps/srvr/src/` (tvdb, emby, tmdb, rotten, bif, fix, email, groupCounts,
lastViewed, unilogDb, urls, util, srvrPaths). Those are **leaf modules**: nothing
in `src/` imports `index.js`. Where a `src/` module needs something from the
orchestrator, it already uses a **callback-injection pattern** to avoid circular
imports, e.g. in `tvdb.js`:

```js
// Callbacks set by index.js to avoid circular imports
let notifyCallback = null;
export const setNotifyCallback = (fn) => {
  notifyCallback = fn;
};
```

wired from `index.js`:

```js
tvdb.setNotifyCallback((name) => debouncedTvdbPush(name));
tvdb.setPickupChangeCallback(handlePickupChange);
tvdb.setRefreshEpisodeDataCallback(refreshEpisodeData);
```

So `index.js` is now the **composition root + everything not yet extracted**:
subtitle/ASR queues, the OpenSubtitles client, the BIF queue, Flexget download
automation, Emby sync/full-sweep, the gap checker, the chokidar watcher, the
resolution-fallback/reencode pipeline, the HTTP route table, and the WebSocket
server.

### Functional clusters currently inside `index.js`

| #   | Cluster                                                                                                                                                                 | Approx lines |    Owns state?    |   Talks to clients?   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: | :---------------: | :-------------------: |
| A   | Bootstrap: imports, `ensureDir/File`, config read/write, header/pickup/footer, path constants                                                                           |         ~165 |         —         |           —           |
| B   | SRT text processing (`parseSrt`, `serializeSrt`, `derollSrt`, `sanitizeSrt`, time conv.) + sub-file id ops (`deleteSubFiles`, `getSubFileIds`, `offsetSubFiles`)        |         ~700 |     no (pure)     |          no           |
| C   | Subtitle / ASR / chksrt **queues** + processing (`processSubQueueEntry`, `generateSrtWithAsr`, `generateEmbSrts`, `applyOpenSubSrts`, OPN sidecar download, batch msgs) |        ~2000 |      **yes**      | yes (`syncBatchMsgs`) |
| D   | BIF queue (`bifNeededQueue`, `startBifCreate`, `handleNeedsIntroChange`)                                                                                                |         ~200 |      **yes**      |          yes          |
| E   | OpenSubtitles API client (login/token, search, download, `subsSearch`, `subsCountEpisodes`)                                                                             |         ~450 |    token cache    |          no           |
| F   | Disk shows + episode data (`getShowsFromDisk`, `getShowDiskInfo`, `buildTvShowNfo`, `refreshEpisodeData`, `probeRawHeight`)                                             |         ~600 |      caches       |      indirectly       |
| G   | Pickups / gaps / noEmby / shared-filters / config-yml / file & path CRUD handlers                                                                                       |         ~800 |       some        |          yes          |
| H   | Express app + **unilog** HTTP routes                                                                                                                                    |         ~330 |  subscribers set  |          SSE          |
| I   | API route registration (`apiWrapper` + ~90 `app.get/post` one-liners)                                                                                                   |         ~550 |         —         |           —           |
| J   | Media routes (`/api/stream`, `/audio-list`, `/subtitle-list`, `/episodeSubs`, `/episodeStats`, `/subtitle`, flexget HTTP, `/opn/search`)                                |         ~950 |         —         |          no           |
| K   | ASR/chksrt/bif/intro HTTP routes                                                                                                                                        |         ~900 |     via C/D/L     |          yes          |
| L   | Emby intro **skip/trim engine** (`doSkipIntro`, `doTrimIntro`, `embySeekTicks`, `handleEmbyIntroPress`)                                                                 |         ~340 |     a little      |          yes          |
| M   | Internal routes + `nowPlaying` + `checkMissingEpisodes`                                                                                                                 |         ~280 |      **yes**      |          yes          |
| N   | **WebSocket server + global messages** (`wss`, `connectedClients`, `notifyClients`, `setGlobalMessage`, `pollGlobalMessages`)                                           |         ~260 | **yes (the hub)** |        **yes**        |
| O   | Flexget download engine (`processFlexgetCandidate`, scoring, `badGroups`, `runFlexgetAndProcess`)                                                                       |         ~670 |      **yes**      |          yes          |
| P   | Emby sync + full sweep (`syncEmbyUserData`, `runEmbyFullSweep`)                                                                                                         |         ~660 |      **yes**      |          yes          |
| Q   | Gap check + `embyRefreshManager`                                                                                                                                        |         ~330 |      **yes**      |          yes          |
| R   | Chokidar file watcher (`handleShowDiskChange`, `watcher`)                                                                                                               |         ~260 |   debounce maps   |          yes          |
| S   | Resolution fallback / reencode (`reencodeQueue`, `scanShowForResFallback`, `handleToggleResolution`)                                                                    |         ~500 |      **yes**      |          yes          |

The **coupling hubs** that make this hard:

- **N (messaging)** — `notifyClients` / `setGlobalMessage` / `connectedClients` /
  `activeServerMessages` / `syncBatchMsgs` are called from C, D, F, G, M, O, P, Q,
  R **and** from the `tvdb.js`/`emby.js` callbacks. This is the single most
  cross-cutting dependency in the file.
- **A (config helpers)** — `readTextOrWithChosenPath`, `configWritePath`,
  `ensureDir/File` are used by C, G, O.
- **B (SRT parsing)** — used by C and J.
- **`app` / `wss`** — every route cluster (H, I, J, K, M) needs `app`; N owns
  `wss`.
- Many **module-level `let`** queues (`subQueue`, `chksrtHistory`,
  `flexgetHistory`, `reencodeQueue`, `badGroups`, `diskShowsCache`,
  `lastPlayingKeys`, …) are read/written across several clusters.

---

## Answers to your specific questions

### “Edits should be limited to `index.js`. Any need for exceptions?”

Mostly yes, but there are **four real exceptions**:

1. **The new module files themselves** (obviously — they’re new, not edits to
   existing files).
2. **`unilog` ids.** `index.js` contains many _already-numbered_ calls like
   `unilog(60, "wss listening…")` and `unilog(504, …)`. The deploy reconciler
   assigns/reconciles ids using an AST parse **per project**, keyed by site. When
   you _move_ a numbered `unilog(<id>, …)` call into a new file, the reconciler
   may treat it as a new site (duplicate id) or reassign it. So a refactor that
   relocates logging **will** require running `node unilog/check.js srvr` and a
   normal `./srvr srvr` deploy to let reconciliation settle — and you should
   expect the `reconcile-cache.json` to change. This is a genuine cross-file
   effect you cannot avoid. (New logging you add during the refactor should use
   `logHere(...)` placeholders, never hand-written ids — per repo rules.)
3. **Wiring existing `src/` modules.** Some code you extract is _called back into_
   from `tvdb.js`/`emby.js` (e.g. `refreshEpisodeData`, `handlePickupChange`). If
   that code leaves `index.js`, the `set*Callback(...)` wiring in `index.js` must
   point at the new module. That’s still an edit _in_ `index.js`, so fine — but if
   you ever need a _new_ callback seam you’d touch the `src/` module too.
4. **pm2 / run scripts** — only if you (against my advice) create a second
   process. If you keep one process, `run` / `ecosystem.config.js` / `pull-srvr`
   need no changes because they launch `index.js`, which stays the entry point.

### “Should there be a new project with a new pm2 task?”

**No.** Strong recommendation against. Reasons:

- The clusters share **in-memory state** (queues, caches, `connectedClients`,
  `activeServerMessages`, debounce maps). A second process can’t share that
  without turning function calls into IPC/HTTP/DB round-trips — the exact opposite
  of reducing surface area.
- There is exactly **one** WebSocket server (`:8736`), **one** HTTP server, and
  **one** chokidar watcher over `/mnt/media/tv`. Duplicating or coordinating those
  across processes is pure downside.
- pm2 restart/watch semantics (`--watch index.js`) are simpler with one entry
  point.

Modules are just files `import`ed by the **same** process. That gets you all the
readability benefit with none of the IPC cost.

### “All in `apps/srvr/src/`, or a subfolder?”

Use **`apps/srvr/src/`** (flat) to match the 15 modules already there. Introduce
subfolders only when a single domain needs several files, e.g. later:

```
src/subs/       (queue.js, opensubtitles.js, srt.js)
src/flexget/    (engine.js, scoring.js)
src/routes/     (media.js, asr.js, intro.js, crud.js)
```

Don’t pre-create empty subfolders; promote to a subfolder when a domain reaches
~3 files.

### “Measure the quality of every possible split numerically.”

Enumerating _all_ splits is combinatorial and not useful. The right method is to
evaluate a few **principled** candidates against two proxies:

- **inbound imports** a module needs (fan-in of dependencies), and
- **cross-module call edges** at runtime (fan-out of calls).

The goal is to **minimize edges that cross the messaging hub (N) and shared
state**, and to keep each module describable in one sentence. Estimates for the
three candidates are below.

---

## What I disagree with / would adjust

- **“Limit edits to `index.js`.”** Achievable, but the `unilog`-id reconciliation
  (exception 2) means the _repository state_ will change even if your source edits
  are confined to `index.js` + new files. Plan for a deploy + `unilog/check.js`
  pass as part of “done”.
- **“Measure every possible split.”** Replace “every” with “a handful of
  principled candidates”; the metric is only meaningful relative to the coupling
  hubs, not as an absolute over all partitions.
- **The implicit assumption that smaller = better.** The win comes from **domains
  that own their own state**, not from raw line reduction. If a split forces a
  shared `state.js` that everyone imports, you’ve added indirection without
  reducing coupling — worse than leaving it alone.
- **Sequencing.** Do it in **passes** (extract leaves first, then domains), each
  pass independently deployable and testable on the remote server. A single
  10k-line “big bang” refactor is high-risk given the shared state.

---

## Refactor proposals

Sizes are estimates; “edges” = cross-module runtime call sites (lower is better).

### Option 1 — Extract the leaf / pure clusters (low risk, first pass)

Only move clusters that have **little inbound coupling and little/no shared
mutable state**. Everything stateful and every route stays in `index.js`.

| New file               | One-sentence purpose                                                                 | Est. lines | New exports |  New imports it needs  | Call edges into it |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------: | :---------: | :--------------------: | :----------------: |
| `src/srt.js`           | Pure SRT parse/serialize/deroll/sanitize + time conversion.                          |       ~250 |     ~8      |          none          |   ~6 (from C, J)   |
| `src/subFiles.js`      | Sidecar sub-file id encode + delete/get/offset operations.                           |       ~450 |     ~4      |   `srt`, `fs`, paths   |         ~5         |
| `src/opensubtitles.js` | OpenSubtitles REST client (login/token/search/download).                             |       ~450 |     ~6      | `fetch`, secrets paths |         ~6         |
| `src/flexgetScore.js`  | Pure Flexget candidate scoring/comparison + bad-group test.                          |       ~200 |     ~7      | `parse-torrent-title`  |         ~5         |
| `src/resFiles.js`      | Pure resolution filename helpers (`res2160FileName`, `resOfName`, …).                |       ~150 |     ~10     |      `fs`, `path`      |         ~8         |
| `src/config.js`        | Config read/write (`readTextOrWithChosenPath`, `configWritePath`, `ensureDir/File`). |       ~150 |     ~6      |      `fs`, paths       |        ~10         |

- **index.js after:** ~7,700 lines.
- **Surface area:** ~40 exports, all one-directional (index → module). **Zero new
  shared-state seams** — these modules are pure or own only their own caches
  (token cache, bad-group set can stay in index and be passed in).
- **Risk:** low. Each file is independently testable. No messaging-hub coupling.
- **Best for:** unblocking further work with minimal chance of regression.

### Option 2 — Domain modules + small composition root (best long-term target)

Split by **domain**, and give each stateful domain an `init(ctx)` (or a factory)
that receives a **small explicit `ctx`** object with the shared seams:
`{ notifyClients, setGlobalMessage, syncBatchMsgs, config, refreshEpisodeData }`.
Routes are registered via `registerXRoutes(app, deps)`. `index.js` becomes a
~300–450 line **composition root**: build `ctx`, `init` each domain, register
routes, start `wss`/watcher/cron.

| New file                                                  | One-sentence purpose                                                                               |  Est. lines |     Exports     |                  Imports                   |  Cross-module edges   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------: | :-------------: | :----------------------------------------: | :-------------------: |
| `src/messaging.js`                                        | The client hub: `wss`, `connectedClients`, `notifyClients`, `setGlobalMessage`, global-msg poller. |        ~280 |       ~6        |                 `ws`, `fs`                 |  inbound hub (many)   |
| `src/config.js`                                           | Config + path + ensure helpers (as Option 1).                                                      |        ~150 |       ~6        |                    `fs`                    |          ~10          |
| `src/srt.js` + `src/subFiles.js` + `src/opensubtitles.js` | (as Option 1)                                                                                      |       ~1150 |       ~18       |                   mutual                   |          ~15          |
| `src/subsQueue.js`                                        | Subtitle/ASR/chksrt queues + processing loops + OPN sidecar.                                       |       ~2000 |  `init` + ~12   | messaging, subFiles, opensubtitles, config |          ~25          |
| `src/bifQueue.js`                                         | BIF-needed queue + create/cancel + needs-intro reaction.                                           |        ~220 |   `init` + ~4   |             messaging, config              |          ~8           |
| `src/disk.js`                                             | Disk show discovery, per-show disk info, episode-data refresh, NFO.                                |        ~600 |       ~6        |             config, emby, tvdb             |          ~18          |
| `src/crud.js`                                             | pickups/gaps/noEmby/shared-filters/config-yml/file+path handlers.                                  |        ~800 |       ~20       |          messaging, disk, config           |          ~15          |
| `src/flexget.js`                                          | Flexget run + candidate processing + qbt push (uses `flexgetScore`).                               |        ~700 |   `init` + ~5   |      flexgetScore, messaging, config       |          ~12          |
| `src/embySync.js`                                         | Emby user-data sync + full sweep + gap check + refresh manager.                                    |       ~1000 |   `init` + ~6   |        messaging, emby, tvdb, disk         |          ~22          |
| `src/watcher.js`                                          | chokidar watcher + show-change debounce.                                                           |        ~260 |     `init`      |         messaging, embySync, disk          |          ~8           |
| `src/resolution.js`                                       | Resolution fallback + reencode queue + toggle (uses `resFiles`).                                   |        ~500 |   `init` + ~3   |        resFiles, messaging, config         |          ~10          |
| `src/intro.js`                                            | Emby intro skip/trim engine + intro state push.                                                    |        ~340 |       ~8        |              messaging, emby               |          ~10          |
| `src/routes/*.js`                                         | 3–4 route files (`media`, `asr`, `intro`, `crud`) each `registerX(app, deps)`.                     | ~2000 total | ~4 register fns |                all domains                 | ~90 (route → handler) |

- **index.js after:** ~350 lines (composition root).
- **Surface area:** highest — ~120 exports, and every domain imports
  `messaging.js`. But the coupling is now **explicit and one-directional**: it
  flows into `messaging` and `config`, and route files depend on domains (never
  the reverse).
- **Risk:** medium-high, best done as **several passes on top of Option 1**.
- **Best for:** the end state you actually want — every file has a one-sentence
  description, and the messaging hub is a single named dependency instead of an
  ambient global.

### Option 3 — Few large feature modules (pragmatic middle ground)

Group into a **small number of cohesive modules**, accepting larger files in
exchange for far fewer inter-file edges than Option 2.

| New file             | One-sentence purpose                                                                        | Est. lines |    Exports    | Cross-module edges |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------: | :-----------: | :----------------: |
| `src/runtime.js`     | Messaging hub + config + shared path/ensure helpers (N + A).                                |       ~430 |      ~12      |    inbound hub     |
| `src/subtitles.js`   | Everything subtitle: SRT, sub-files, OpenSubtitles, queues, OPN (B+C+E).                    |      ~3100 |      ~20      |        ~20         |
| `src/mediaRoutes.js` | All streaming/subtitle/audio/episode HTTP routes (J).                                       |       ~950 | 1 register fn |        ~15         |
| `src/flexget.js`     | Flexget engine + scoring (O + flexget bits).                                                |       ~870 |  `init` + ~5  |        ~12         |
| `src/emby.js`\*      | Emby sync/full-sweep/gap/refresh/watcher (P+Q+R). _(name clash — call it `embyRuntime.js`)_ |      ~1250 |  `init` + ~6  |        ~20         |
| `src/resolution.js`  | Resolution fallback + reencode (S).                                                         |       ~500 |  `init` + ~3  |        ~10         |

- **index.js after:** ~2,000 lines (routes wiring + intro + nowPlaying +
  bootstrap remain).
- **Surface area:** ~50 exports; **fewer edges** than Option 2 because related
  clusters that call each other a lot (e.g. SRT ↔ queue ↔ OpenSubtitles) stay in
  one file, so those calls become **intra**-file again.
- **Risk:** medium. Fewer files to review, but `subtitles.js` at ~3,100 lines is
  still large and violates the “one sentence” goal a bit (it does “everything
  subtitle,” which is really 3 things).
- **Best for:** cutting `index.js` roughly in half with minimal ceremony, without
  committing to the full DI structure.

---

## Comparison

| Criterion                         | Option 1 (leaves) |    Option 2 (domains + root)     |        Option 3 (few big)         |
| --------------------------------- | :---------------: | :------------------------------: | :-------------------------------: |
| index.js final size               |      ~7,700       |               ~350               |              ~2,000               |
| # new files                       |         6         |               ~18                |                 6                 |
| Total cross-module edges          | **lowest** (~40)  |          highest (~250)          |           medium (~90)            |
| Shared-state seams introduced     |        ~0         | explicit `ctx` (many, but named) |           1 (`runtime`)           |
| “one sentence per file” satisfied |        yes        |          **yes (best)**          | mostly (subtitles.js is 3 things) |
| Risk / effort                     |      **low**      |               high               |              medium               |
| Deploy-in-passes friendly         |        yes        |               yes                |              partly               |

**Is one clearly better?** Not in isolation — they’re **stages of the same
journey**, and the honest recommendation is a sequence, not a single pick:

1. **Do Option 1 first.** It’s cheap, safe, deploys in one `./srvr srvr`, and
   removes ~2,300 pure lines with essentially no coupling risk.
2. **Then move toward Option 2**, one domain per pass (suggested order:
   `messaging.js` → `subsQueue.js` → `flexget.js` → `embySync.js`+`watcher.js` →
   `resolution.js` → `intro.js` → `routes/*`). Each pass is independently
   testable on the remote server.
3. **Option 3 is the stopping point** if, partway through, the DI ceremony of
   Option 2 feels like too much for the payoff — it’s a legitimate “good enough”
   resting place at ~2k lines.

**Key trade-off:** Option 2 minimizes file size and maximizes “one sentence per
file,” but it maximizes explicit edges and requires threading a `ctx`/`deps`
object everywhere. Option 3 keeps chatty clusters together (fewer edges) at the
cost of a couple of still-large files. Option 1 barely reduces size but is the
only one with near-zero risk.

## Practical guardrails for whoever does this

- **Extract the messaging hub (N) first** in any full split — it’s the dependency
  everything else needs; getting its shape right (a `ctx` with `notifyClients` /
  `setGlobalMessage` / `syncBatchMsgs`) determines how clean the rest is.
- **Keep each queue’s state inside the module that owns it** (don’t create a
  shared `state.js`). Cross-cutting reads become small exported getters.
- Move code **verbatim**; do not “improve” it in the same pass (repo rule: no
  unrelated/cosmetic changes). Refactor moves and behavior changes must be
  separate commits.
- After each pass: `node unilog/check.js srvr`, `./srvr srvr`, then watch
  `pm2 logs tv-srvr` for restart loops (relocated `unilog(<id>)` sites are the
  most likely source of noise).
- Verify `import * as epd from "@tv/share"` and the other package imports are
  re-added to each new file that uses them — the current file leans on a lot of
  top-level imports that will need to follow the code.
