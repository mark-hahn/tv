# Plan: toggle video resolution (2160 ↔ 1080)

This plan implements the feature described in `toggle-resolution-instr.md`:
keep a 1080 fallback next to each 2160 episode, expose a `Res` button in the
local pane to switch which resolution Emby sees, and add a long‑press toggle on
the Android remote. **No code changes are made by this plan — it is design only.**

---

## 1. Background: how the pieces fit today (verified in code)

### Resolution detection

- Server detects resolution from the filename: `2160p` / `1080p` / `720p`
  regex in `apps/srvr/index.js` (`getResolution`, ~lines 7286‑7288). Files are
  named `Show.S01E01.2160p.mkv`, etc.

### Folder / subtitle layout

- `/mnt/media/tv/{Show}/Season N/{basename}.{ext}`.
- Sidecar subtitles share the video basename (`...2160p.srt`) and are matched by
  basename minus extension (`apps/srvr/index.js` ~lines 1249‑1286).

### Existing suffix convention

- When a higher‑quality file arrives, the downloader renames the old file to
  `*.old` (can stack to `*.old.old`) — `apps/down/src/main.js` ~lines
  3239‑3339. Emby ignores `*.old` because it is not a known video extension.
- `.alt` does not exist yet anywhere in the code. **Assumption:** like `.old`,
  appending `.alt` makes Emby ignore the file (the suffix moves the real
  extension out of the way, e.g. `...1080p.mkv.alt`). This is the mechanism that
  lets exactly one resolution be visible to Emby at a time.

### chokidar watcher

- `apps/srvr/index.js` `handleShowDiskChange()` (~8790‑8850), watcher created
  ~8871 on `tvDir` with `awaitWriteFinish`, 3s debounce. `"add"` events extract
  the show name and refresh episodeData + trigger Emby refresh + gap check.

### tvdb background task

- `apps/srvr/src/tvdb.js` has `showProcessQueue` (~2040), `enqueueShowProcess`
  (~2045), and the processing loop `tryLocalGetTvdb()` (~2246‑2430).
  `refreshEpisodeDataCallback()` (~2324) and `perShowCallback()` (~2336‑2348)
  run after a show is processed — the natural hook for the per‑show scan.

### Watched / in‑progress

- Watched: `epd.isWatched(episodeData, season, ep)` from `packages/share`.
- In‑progress download: `tv-inProgress.json` map in `apps/down/src/main.js`
  (~244, 2041‑2046, 2371).

### ffmpeg

- ffmpeg is only used today for **live streaming/transcode** in
  `apps/srvr/index.js` (~4825‑5011, `cp.spawn("ffmpeg", ...)`). There is **no**
  batch re‑encode pipeline — that is new work.

### Emby "view show" (the TV button)

- Web `map.vue` TV button → `GET {tvTvUrl}/tv/viewshow` (`apps/tv/src/main.js`
  ~603) → turns TV on, sends Home, launches Emby app, then
  `POST {srvr}/api/embyViewShow` → `emby.viewShowOnLivingRoomTv`
  (`apps/srvr/src/emby.js` ~73) → Emby `Sessions/{id}/Viewing` API.
- Home key: `GET {tvTvUrl}/tv/key/home` (`apps/tv/src/main.js` ~1040) maps to HA
  `Home` / Fire `KEYCODE_HOME`.

### Android up key

- `apps/android/App.js` up button (~1170) uses `startRepeat("up")` /
  `stopRepeat` (~206‑290). **Up already has hold behavior**: it sends `up`
  immediately then auto‑repeats with acceleration while held. There is also a
  generic long‑press helper `lpStart`/`lpStop` (~667‑715) used elsewhere.

---

## 2. Server: keep / generate the 1080 fallback

### 2.1 Conditions to need a 1080 file (all must hold)

1. A `2160p` video file exists for the episode.
2. The show is in Emby (`show.inEmby` — never test for a `noemby-` id prefix).
3. The episode is **not watched** (`epd.isWatched(...) === false`).
4. No `1080p` video already exists for the episode (active or `.alt`).
5. No 1080 download for the episode is in progress (`tv-inProgress.json`).

### 2.2 Acquire the 1080 file — two paths

**Path A (preferred): reuse an old 1080.**

- Look in the season folder for `*1080p*.{ext}.old` matching the same S/E.
- If found, rename by replacing the `.old` suffix with `.alt`
  (`...1080p.mkv.old` → `...1080p.mkv.alt`). Immediate, no encode.

**Path B: re‑encode from the 2160 file.**

- Enqueue the 2160 path into a new persistent re‑encode queue.
- A single background worker pulls paths and runs ffmpeg:
  - Output filename = 2160 name with `2160`→`1080` substring substitution, then
    the active/`.alt` rule below.
  - Target bitrate ≤ 10 Mbit/s; preserve 10‑bit if the source is 10‑bit; copy
    all non‑video tracks (`-map 0 -c copy -c:v <codec>`); see §6 for the codec
    ambiguity.

### 2.3 Which file gets `.alt`

- The currently‑viewed resolution keeps a normal extension (visible to Emby).
- The fallback gets the `.alt` suffix (hidden from Emby).
- Per the instruction the 1080 is the alternate by default, so a freshly
  created/renamed 1080 is written as `...1080p.mkv.alt` while the 2160 stays
  active.

### 2.4 Subtitles

- Keep all subtitle files. Copy each `2160p` sidecar to a matching `1080p`
  basename (identical contents, identical extension), so both resolutions have
  sidecars regardless of which is active. No subtitle renaming happens during a
  toggle.

### 2.5 When the scan runs

- **chokidar:** when a `2160p` `"add"` event stabilizes, after the existing
  `handleShowDiskChange` work, evaluate §2.1 for that episode and act (rename
  immediately or enqueue encode).
- **tvdb background task:** after `perShowCallback()` (~tvdb.js 2348), scan every
  video file in the show folder; for each episode meeting §2.1, act the same way.
- Suffix‑swap‑only cases run immediately; encode cases go on the queue.

### 2.6 Re‑encode queue (new)

- Persist as `apps/srvr/.../reencode-queue.json` (model after
  `tv-inProgress.json` / `showProcessQueue`).
- Entry: `{ sourceFile, show, season, episode, status, dateAdded }`.
- Single‑worker loop (sequential, like `tryLocalGetTvdb`) so only one ffmpeg
  encode runs at a time. On success, write the `.alt` 1080, copy subtitles, then
  trigger an Emby library refresh (reuse the existing refresh call).
- **Important (repo rule):** before writing/renaming files on disk for a show,
  coordinate with the watcher so the change isn't treated as a fresh download
  and re‑queued; and when touching `tvdb.json` stop `tv-srvr` first (memory:
  stale‑overwrite rule). The queue worker only renames/creates video + subtitle
  files, not `tvdb.json`, so this is mainly about debouncing the watcher.

---

## 3. Local pane UI — button changes

File: `apps/client/src/components/local.vue`.

Current row 1 (non‑movie): `… Fix, Errs, Move, Play, Refresh`
Current row 2 (non‑movie): `… First, Info, Del`

### Changes

1. **Move `Errs`** from row 1 to row 2, placed immediately to the **left of
   `Info`** (row 2 becomes `… First, Errs, Info, Del`).
2. **Add `Res`** to row 1 in the slot `Errs` vacated — **between `Fix` and
   `Move`** (row 1 becomes `… Fix, Res, Move, Play, Refresh`).

> Movie‑mode header (lines ~345‑516) has its own layout; apply the equivalent
> placement there only if `Errs`/`Res` are meant to appear in movie mode.
> **Ambiguity:** instruction doesn't mention movie mode — assume non‑movie only.

### `Res` enabled condition

- Exactly one file selected (`selectedFiles.size === 1`, no folder selection),
  and that file is one of a valid 2160↔1080 pair in the same season folder where
  the other member exists (one active, one `.alt`).
- Because the file‑list node only carries `{name,type,size,date}`, the pair is
  detected by **filename parsing** on the client: same S/E, one contains
  `2160p` and the other `1080p`, and exactly one of the two ends in `.alt`.
- Disabled otherwise (and while `loading`).

### `Res` click handler

- POST a new endpoint, e.g. `POST {torrentsApiUrl}/api/local/toggle-res` with
  the selected file's relative path.
- Server swaps the `.alt` suffix between the 2160 and 1080 members (remove `.alt`
  from the fallback, add `.alt` to the previously‑active file), then triggers an
  Emby library refresh so the player can switch resolution. Model after
  `moveSelected()` / `move-to-trial` (`local.vue` ~2850, `apps/api`/`apps/srvr`
  local routes). Refresh the pane afterward.
- The button is a pure toggle: clicking again swaps back.

---

## 4. Android remote — long‑press toggle

File: `apps/android/App.js`.

### Trigger

- On **long‑press of the up key while a video is playing** and the playing
  episode has a valid 2160↔1080 pair, perform the resolution toggle.

### Behavior (per instruction)

1. Send Home to the TV to exit Emby (`/tv/key/home`).
2. Load the **other** resolution into Emby — the same flow the web TV button
   uses (`/tv/viewshow` → `/api/embyViewShow` → toggle `.alt` first so the other
   file is the one Emby resolves).

### Implementation approach

- Add a long‑press branch for `up` (reuse `lpStart`/`lpStop`, ~667‑715, or add a
  hold timer inside `startRepeat`’s non‑LR path) that, on crossing the hold
  threshold, fires a single "toggle resolution" action instead of (or in
  addition to) the repeat.
- New tv‑tv (or srvr) endpoint, e.g. `POST /tv/toggleResAndView`, that: performs
  the server‑side `.alt` swap for the currently‑playing episode, sends Home, then
  re‑runs the viewshow load for the now‑active file.

### ⚠ Conflict to resolve (see §6)

- The up key **already** auto‑repeats on hold (scrolls up in Emby). Overloading
  long‑press‑up for resolution toggle collides with that. Needs a decision.

### UI parity rule

- Per repo instructions, any TV‑pane/Android UI change must be mirrored in the
  other. The `Res` button is a local‑pane (not tv‑pane) feature, so the Android
  long‑press is the “mirror.” Confirm no tv‑pane button is also expected.

---

## 5. Deploy / test notes (repo conventions)

- Server‑only changes (`srvr`): deploy with `./srsv srvr` (or `./srvr srvr`).
  `apps/api` local routes deploy with their own server. After deploy, check pm2
  logs for crash/restart loops.
- Client changes are served by local Vite (do not `./srvr client`).
- Android JS changes hot‑reload via Metro; a final APK uses
  `apps/android/build-apk`.
- All new logging via unilog, timestamps PST `MM-DD HH:mm`, and guard the
  hour‑24 → 00 rule.

---

## 6. Ambiguities, contradictions, impossibilities, suggestions

1. **Android up long‑press conflicts with existing up auto‑repeat/scroll.**
   The up key already sends repeated `up` events while held (Emby navigation).
   Reusing long‑press‑up for the resolution toggle would break or hijack normal
   scrolling. _Suggestions:_ (a) use a **very long** hold (e.g. ≥1.5s) distinct
   from the existing accelerate threshold, (b) require the toggle only when a
   video is actively **playing** (not in a menu) so up‑repeat is irrelevant, or
   (c) pick a less‑used gesture (long‑press a different key). Needs your call.

2. **ffmpeg codec choice ("is that hvec?").** The instruction asks for "best for
   emby playback on all devices" **and** ≤10 Mbit/s **and** keep 10‑bit. These
   pull in opposite directions: HEVC (h265) gives the best quality at low
   bitrate and supports 10‑bit, but **h265 is the codec that today’s streaming
   path transcodes _away_ to h264** for compatibility (see srvr ~4927‑5000) —
   so HEVC is _not_ the most compatible for direct play. _Suggestion:_ encode
   1080p as **H.264 High@L4.1, 8‑bit, ≤10 Mbit/s** for maximum direct‑play
   compatibility; only keep 10‑bit/HEVC if every target device is known to
   direct‑play it. Please confirm the codec.

3. **`.alt` ignored by Emby — needs confirmation.** The whole toggle relies on
   Emby ignoring a `*.mkv.alt` file the same way it ignores `*.mkv.old`. This is
   inferred, not proven. _Action:_ verify by placing a test `.alt` file and
   refreshing the Emby library before building on it. If Emby still indexes it,
   we instead need to move the inactive file to a sibling/ignored folder.

4. **Client can only see `{name,type,size,date}` per file.** Pair detection
   (2160↔1080, `.alt` state) must be done by filename parsing on the client, or
   the `/api/local/files` payload must be extended to include resolution/alt
   flags. _Suggestion:_ filename parsing first (no API change); extend the API
   only if parsing proves unreliable.

5. **"Two files that meet the condition, one selected."** Assumed to mean the
   2160 and its 1080 fallback in the same season folder, exactly one selected,
   nothing else selected. Confirm this is the intent (vs. selecting both).

6. **Re‑encode vs. watcher race.** Creating the `.alt`/`1080p` file fires the
   chokidar `"add"` event, which could re‑trigger the §2 logic or a download
   re‑evaluation. Must debounce/ignore self‑generated files (e.g. skip `.alt`
   and freshly‑encoded outputs in the watcher) to avoid loops.

7. **Subtitle duplication cost.** Keeping two identical subtitle copies per
   episode doubles sidecar count. Acceptable per instruction, but a symlink
   would avoid duplication if the filesystem/Emby tolerate it — optional.

8. **Where the new server endpoints live.** Local‑pane file ops currently live
   across `apps/api` and `apps/srvr`. The toggle touches video files and Emby
   refresh (srvr territory), so I propose putting `toggle-res` and the scan/queue
   in `apps/srvr`, with the local‑pane button calling through the existing
   `torrentsApiUrl` base. Confirm preferred placement.
