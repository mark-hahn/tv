# Long Log-Line Report (one-time scan)

Triage list of existing log statements that emit lines **longer than 120 characters**,
so the source messages can be shortened before universal logging begins.

## Methodology

- Sampled the **current + today's rotated** pm2 logs for the tv apps plus the two
  explicit app log files:
  `tv-srvr-out/err`, `tv-api-out`, `tv-down-out/err`, `tv-tv-out/err`,
  `apps/asr/data/subtitle.log`, `apps/down/data/misc/tv.log`.
  (Other pm2 apps — bath, hvac, bkupall, ham-srvr, torrents-server, etc. — are not
  part of this project and were excluded.)
- For each line: stripped the leading pm2/app timestamp, then measured length. Lines
  ≤120 chars were ignored.
- Grouped lines into **location-families** (collapsing show names, file paths, ids,
  and stack traces) so each row ≈ one source `log` statement. Kept the **longest**
  actual example and an occurrence count per family.
- Source `file:line` resolved by grepping the workspace (line numbers may drift).

## Per-app long-line volume ( >120 chars, in the sampled window )

| long lines | app/log           |
| ---------: | ----------------- |
|     23,981 | tv-down           |
|      2,681 | tv-srvr           |
|         30 | tv-api            |
|         15 | srvr/subtitle.log |

**33** distinct location-families. tv-down dominates by volume; tv-srvr dominates by
length (stack-trace and property-dump logs).

## Location-families — longest first

| len |  seen | source location                                      | what it logs / sample (truncated)                                                                                                                                                                                                                                                         |
| --: | ----: | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 753 |     8 | [apps/srvr/index.js](apps/srvr/index.js#L9062)       | `[chokidar] sub check for <show>: inEmby=… files=<comma-joined full paths>` — joins **every** file path for the show.                                                                                                                                                                     |
| 431 |  1407 | [apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js#L2019) | `[tvdb] [tvdb loop] enqueue [<show>] from: <full stack trace>` — logs a multi-frame stack every enqueue. **High volume + long.**                                                                                                                                                          |
| 418 |    72 | [apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js#L2319) | `[tvdb] tvdb push [<show>]: <every changed field undefined->null …>` — dumps full field diff.                                                                                                                                                                                             |
| 300 |     6 | [apps/down/src/main.js](apps/down/src/main.js#L2094) | `findUsb: \`ssh … find … \| grep -Ev … \| grep -Evi …\`` — logs the whole remote shell command.                                                                                                                                                                                           |
| 210 |  6429 | [apps/down/src/main.js](apps/down/src/main.js#L2437) | `log("not blocked", usbLine)` — full `YYYY-MM-DD-<release>/<release>.mkv` line. **Very high volume.**                                                                                                                                                                                     |
| 204 | 17433 | [apps/down/src/main.js](apps/down/src/main.js#L2360) | `log("------", n, "/", total, "SKIPPING ALREADY DOWNLOADED:", fname)` — full filename. **Highest volume.** (sibling emitters at lines [2382](apps/down/src/main.js#L2382), [2287](apps/down/src/main.js#L2287), [3007](apps/down/src/main.js#L3007), [3124](apps/down/src/main.js#L3124)) |
| 201 |   150 | [apps/srvr/index.js](apps/srvr/index.js#L8418)       | `[overview] embyFullSweep: tvdb="…80 chars…" emby="…80 chars…"` — two 80-char overview slices.                                                                                                                                                                                            |
| 190 |     4 | [apps/srvr/index.js](apps/srvr/index.js#L2804)       | `[needsIntro dbg] <show>: stored=… computed=… inEmby=… …` — many debug fields.                                                                                                                                                                                                            |
| 181 |    66 | (node runtime)                                       | `(node:…) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED … insecure …` — **not an app log**; emitted by Node (tv-srvr/api/down). Can only be silenced via env, not source.                                                                                                             |
| 176 |   163 | [apps/srvr/index.js](apps/srvr/index.js#L5084)       | `[stream] transcode video=…→h264, audio=…→aac +pgs:N: <full path>`                                                                                                                                                                                                                        |
| 170 |    21 | [apps/srvr/index.js](apps/srvr/index.js#L9011)       | `[chokidar] detected add: <full path>`                                                                                                                                                                                                                                                    |
| 167 |     4 | [apps/srvr/index.js](apps/srvr/index.js#L2804)       | `[needsIntro dbg] <show>: …` (same family as len-190)                                                                                                                                                                                                                                     |
| 162 |     1 | [apps/srvr/index.js](apps/srvr/index.js)             | `[bif] start <show> pid=… <full path>`                                                                                                                                                                                                                                                    |
| 158 |   626 | [apps/srvr/index.js](apps/srvr/index.js#L9094)       | `[chokidar] detected unlink: <full path>` (often a `-thumb.jpg`)                                                                                                                                                                                                                          |
| 146 |    47 | [apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js)       | `[tvdb] getRemotesCmd [<show>] fast=… fetched={…} existing={…} inAllTvdb=…`                                                                                                                                                                                                               |
| 144 |     6 | [apps/srvr/index.js](apps/srvr/index.js#L7624)       | `[flexget] SKIP(run-loser) <name> SxxExx "<raw torrent title>"`                                                                                                                                                                                                                           |
| 143 |    12 | [apps/srvr/index.js](apps/srvr/index.js#L1233)       | subtitle.log `opn-bg: <full .srt path>` (via `logSubtitle`)                                                                                                                                                                                                                               |
| 139 |    53 | [apps/srvr/index.js](apps/srvr/index.js#L3960)       | `deletePath: deleting <full path>`                                                                                                                                                                                                                                                        |
| 138 |    53 | [apps/srvr/index.js](apps/srvr/index.js#L4028)       | `deletePath success: <full path>`                                                                                                                                                                                                                                                         |
| 138 |     1 | [apps/srvr/index.js](apps/srvr/index.js#L1233)       | subtitle.log `opensubs: <full .srt path>` (via `logSubtitle`)                                                                                                                                                                                                                             |
| 136 |   ~10 | [apps/srvr/src/emby.js](apps/srvr/src/emby.js#L454)  | `[getShowState] <show> result: fileEndError=… fileGap=… …`                                                                                                                                                                                                                                |
| 131 |     1 | [apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js)       | `[tvdb] [tvdb loop2] setTvdbFields enqueue [<show>] params=[…] …`                                                                                                                                                                                                                         |
| 128 |     2 | [apps/srvr/index.js](apps/srvr/index.js#L1233)       | subtitle.log `emb: <full .srt path>` (via `logSubtitle`)                                                                                                                                                                                                                                  |
| 127 |     1 | [apps/api/src/download.js](apps/api/src/download.js) | `[torrent-file] using magnet from link hash for: <release> <hash>`                                                                                                                                                                                                                        |
| 122 |   104 | [apps/down/src/main.js](apps/down/src/main.js)       | `fname: '<full release filename>.mkv'`                                                                                                                                                                                                                                                    |

> ~25 families shown (the long tail below 120 collapses to the same locations). The
> two tv-down emitters (`not blocked`, the `------ … SKIPPING …` progress line) plus
> the two tvdb.js emitters (`enqueue … from: <stack>`, `tvdb push … <diff>`) account
> for the overwhelming majority of long-line volume.

## Biggest wins (suggested priorities)

1. **`[tvdb] [tvdb loop] enqueue … from: <stack trace>`** ([tvdb.js:2019](apps/srvr/src/tvdb.js#L2019)) —
   1,407 lines, each ~430 chars with a full stack. Drop or shorten the stack.
2. **`------ … SKIPPING ALREADY DOWNLOADED: <fname>`** ([down/main.js:2360](apps/down/src/main.js#L2360)) —
   17,433 lines. Log basename only, or gate behind a verbosity flag.
3. **`not blocked <usbLine>`** ([down/main.js:2437](apps/down/src/main.js#L2437)) —
   6,429 lines. Log basename only.
4. **`[chokidar] sub check for …: files=<all paths>`** ([index.js:9062](apps/srvr/index.js#L9062)) —
   753 chars; log file **count** instead of every path.
5. **`[tvdb] tvdb push …: <field diff>`** ([tvdb.js:2319](apps/srvr/src/tvdb.js#L2319)) —
   only log changed fields, not the full `undefined->null` set.

## Notes / caveats

- The Node `NODE_TLS_REJECT_UNAUTHORIZED` warning is **not** an app log line; it can't
  be shortened in source (silence via `NODE_OPTIONS=--no-warnings` if undesired).
- Counts are for the **sampled window** (current + 2026-06-27 rotated logs), not all
  history — they indicate relative volume, not lifetime totals.
- Line numbers are best-effort from the current workspace and will drift as files
  change.
