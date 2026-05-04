# Flexget Processing Update — Plan

## Overview of Changes

1. **New local static config files** — currently server-only, will now live in local workspace
2. **New config.yml structure** — no qbittorrent plugin, no exec/python output block; regexp accept/reject + RSS feeds only
3. **Flexget runs on hahnca.com** — srvr triggers `flexget execute` via cron every 15 min; results parsed from stdout `--dump` output
4. **New `prefTorProviders.txt`** — local, deployed with srvr
5. **New `flexget-history.json`** — replaces `pending-flexget.json`; stores all candidates with `sent` timestamp
6. **Incremental decision logic** — runs per-candidate as received; no 24hr wait; better files re-sent to qbt
7. **Down server changes** — skip files that are not the most-recent-sent for an episode; rename old video file to `.old` when replaced
8. **Logging** — `apps/srvr/data/flexget-decision.log`
9. **Deploy script update** — rsync static config files from local; skip the two dynamic JSON files
10. **One-time config-test** — execute flexget dry run to verify config.yml is valid
11. **Web client flex pane redesign** — lists files sent to qbt from flexget-history.json

---

## 1. New local config files

Create these files in local workspace under `apps/srvr/config/`:

| File                          | Content                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `config/config1-header.txt`   | `tasks:\n\n  fetch-feeds:\n    inputs:` block through RSS feed lines                             |
| `config/config3-middle.txt`   | closes `inputs` + opens `regexp:\n      accept:`                                                 |
| `config/config5-footer.txt`   | closes `accept:`, opens `reject:` then closes it; adds `quality: "any"` and `disable:\n  - seen` |
| `config/prefTorProviders.txt` | ordered release group names, one per line, case-insensitive                                      |

No `schedules` block is needed — srvr triggers flexget directly. The two JSON files (`config2-rejects.json`, `config4-pickups.json`) remain server-side data only.

---

## 2. New config.yml structure

Assembly in `upload()` (index.js):

```
headerStr                              ← config1-header.txt
  + '        - "dummy"\n'              ← placeholder so accept list is never empty
  + one line per pickup name           ← from config4-pickups.json
middleStr                              ← config3-middle.txt (closes accept, opens reject)
  + '        - "dummy"\n'             ← placeholder so reject list is never empty
  + one line per reject name           ← from config2-rejects.json
footerStr                              ← config5-footer.txt
```

### Example config.yml (abbreviated)

```yaml
tasks:

  fetch-feeds:
    inputs:
      - rss: https://iptorrents.com/t.rss?u=1961978;tp=...;download;new
      - rss: https://rss24h.torrentleech.org/23b3105eda2478749d21

    regexp:
      accept:
        - "dummy"
        - "A Gentleman in Moscow"
        - "The Bear"
        - "Slow Horses"
        ... (full pickups list)
      reject:
        - "dummy"
        - "A Taste for Murder"
        - "BEEF"
        ... (full rejects list)

    quality: "any"

    disable:
      - seen
```

No `schedules`, no `exec`, no `qbittorrent`, no `clear-list`, no `run-script` tasks.  
No action is needed after updating config.yml (flexget reads it fresh on each execute call).

---

## 3. Running flexget on hahnca.com

- Install flexget on hahnca.com server
- srvr triggers it directly via `exec('flexget execute --tasks fetch-feeds --dump', callback)` every 15 minutes using `node-cron`
- Do not run in daemon mode
- Results are parsed from stdout of the `--dump` output

### Config file location

Flexget reads from its default config location (`~/.config/flexget/config.yml`) or an explicit `--config` path. srvr will pass `--config /root/dev/apps/tv/apps/srvr/config/config.yml` so it uses the same assembled file.

### Parsing --dump output

The `flexget execute --dump` plain text format outputs one accepted entry per block. Example stdout lines:

```
ACCEPTED: Show.Name.S04E01.1080p.WEB-DL.x265-NTb torrent_url=https://... seeds=42 ...
```

The exact format depends on flexget version — fields available and delimiters need to be confirmed by running `flexget execute --tasks fetch-feeds --dump --test` on the server after install. At minimum, `title` and `url` are always present. `seeds`, `quality`, `release_group` availability depends on plugins loaded.

---

## 4. prefTorProviders.txt

Local file: `apps/srvr/config/prefTorProviders.txt`  
Deployed to: `/root/dev/apps/tv/apps/srvr/config/prefTorProviders.txt` via `./srvr srvr`

One release group name per line, most preferred first. Example (based on groups found in library):

```
BHDStudio
CtrlHD
NTb
Kitsune
FLUX
SYNCOPY
ELiTE
FENiX
EDGE2020
MeGusta
RCVR
XEBEC
```

Loaded at srvr startup. Fail fast if missing (per workspace rules) — pre-create during config-test.

---

## 5. flexget-history.json (renamed from pending-flexget.json)

**File**: `apps/srvr/data/flexget-history.json`

**Key format**: `normalizedShowName + "\x00" + "S" + zeroPaddedSeason + "\x00" + "E" + zeroPaddedEpisode`

**Value**: array of candidate objects (never replaced with `"decided"` — full history kept)

### Candidate object structure

```json
{
  "title": "Slow.Horses.S04E01.1080p.WEB-DL.x265-NTb",
  "url": "https://...",
  "quality": "1080p",
  "content_size": "850",
  "torrent_seeds": "42",
  "torrent_leeches": "3",
  "proper": "false",
  "release_group": "NTb",
  "task": "ipt",
  "sent": 1746400000
}
```

`sent` is a Unix timestamp (seconds) set when the candidate is sent to qbt, or `null` if not sent.

### Example flexget-history.json

```json
{
  "Slow Horses\u0000S04\u00000001": [
    {
      "title": "Slow.Horses.S04E01.720p.WEBRip.x264-FoV",
      "url": "https://...",
      "quality": "720p",
      "torrent_seeds": "12",
      "release_group": "FoV",
      "sent": 1746300000
    },
    {
      "title": "Slow.Horses.S04E01.1080p.WEB-DL.x265-NTb",
      "url": "https://...",
      "quality": "1080p",
      "torrent_seeds": "42",
      "release_group": "NTb",
      "sent": 1746400000
    }
  ],
  "The Bear\u0000S04\u00000003": [
    {
      "title": "The.Bear.S04E03.1080p.WEB-DL.x265-ELiTE",
      "url": "https://...",
      "quality": "1080p",
      "torrent_seeds": "67",
      "release_group": "ELiTE",
      "sent": 1746500000
    }
  ]
}
```

### Processing each candidate from flexget stdout

1. Parse `title` using `parseTorrentTitle(title)` (no extension to strip — these are torrent names) to get show name, season, episode
2. Skip if parsed show is not in Emby (`show.inEmby` is false)
3. Skip if parsed show name or season/episode cannot be determined
4. Skip if a video file for that episode already exists in the media library
5. Skip if the exact same `url` is already in the history list for this key
6. Add candidate object to array with `sent: null`
7. Run decision logic for this episode key

---

## 6. Incremental decision logic

Runs per-episode-key immediately after each new candidate is added. No 24hr wait.

### For each new candidate added:

1. Find the candidate in the list with the most recent non-null `sent` timestamp — call it `lastSent`
2. If `lastSent` is null (no candidate sent yet for this episode):
   - Send the new candidate to qbt immediately
   - Set `sent` to current timestamp
3. If `lastSent` exists, compare new candidate vs `lastSent` by priority:
   - **Resolution**: higher is better; missing treated as 640
   - **Bit depth**: higher is better; missing treated as 8
   - **Group rank**: position in `prefTorProviders.txt`; lower rank number = better; missing group = worst
   - **Seeds**: higher is better
   - If new candidate is **better**: send to qbt, set `sent` to current timestamp
   - If new candidate is **same or worse**: do not send, leave `sent: null`
4. Save flexget-history.json after every change
5. Log decision to `apps/srvr/data/flexget-decision.log`

### Log format

```
05-04 14:23 SENT(first)  Slow Horses S04E01  "Slow.Horses.S04E01.720p.WEBRip.x264-FoV" (720p, 8bit, group=FoV[rank 8], seeds=12)
05-04 16:41 SENT(better) Slow Horses S04E01  "Slow.Horses.S04E01.1080p.WEB-DL.x265-NTb" (1080p, 10bit, group=NTb[rank 3], seeds=42)  prev: "Slow.Horses.S04E01.720p.WEBRip.x264-FoV"
05-04 16:41 SKIP(worse)  The Bear S04E03     "The.Bear.S04E03.720p.HDTV.x264-LOL" (720p, 8bit, group=LOL[unranked], seeds=5)  prev: "The.Bear.S04E03.1080p.WEB-DL.x265-ELiTE"
```

---

## 7. Down server changes

### 7a. Skip non-most-recent-sent files

When a qbt download completes and `down` processes it:

1. Parse the filename to get show name, season, episode (existing logic)
2. Look up the episode key in `flexget-history.json`
3. If the key exists, find the candidate with the most recent `sent` timestamp
4. If the completed file's title does **not** match the most-recent-sent candidate's `title`: skip the file, log as skipped

**File access**: `down` needs to read `apps/srvr/data/flexget-history.json`. Since `down` and `srvr` are separate processes, `down` reads the file directly from disk (same as it reads `tv.sqlite`). Read-only for `down`; `srvr` is the sole writer.

### 7b. Rename old video file to .old

When `down` downloads a new video file for an episode that already has a video file:

1. Find the existing video file(s) for that episode in the media directory
2. Rename each by appending `.old` suffix (e.g. `Show.S04E01.720p.mkv` → `Show.S04E01.720p.mkv.old`)
3. Leave all sidecar files (`.srt`, `.nfo`, etc.) unchanged
4. Proceed with normal processing of the new file

---

## 8. Deploy script changes (./srvr)

Add two rsync excludes for srvr so dynamic JSON config files are never overwritten:

```bash
--exclude 'config/config2-rejects.json'
--exclude 'config/config4-pickups.json'
```

Static files (`config1-header.txt`, `config3-middle.txt`, `config5-footer.txt`, `prefTorProviders.txt`) sync normally since they now exist in local workspace.

No changes needed for `./srvr down`.

---

## 9. index.js changes summary

- Add `node-cron` job: every 15 min run `flexget execute --tasks fetch-feeds --config <path> --dump`
- Parse stdout of `--dump` to extract candidate records
- For each candidate: run merge + decision logic
- Load `prefTorProviders.txt` at startup (fail fast if missing)
- Load `flexget-history.json` at startup (create empty `{}` if missing — first run)
- `upload()` function: updated assembly order (header + pickups + middle + rejects + footer); remove qbittorrent
- Remove: `send-data.sh` logic, USB flexget reload, `POST /api/flexget-data` endpoint, `pending-flexget.json`

---

## 10. One-time config-test

Steps:

1. Create local static files (`config1-header.txt`, `config3-middle.txt`, `config5-footer.txt`) with new content
2. Create local `config/prefTorProviders.txt`
3. Deploy srvr (`./srvr srvr`) — syncs static config files to server
4. On remote, assemble `config-test/config.yml` using same logic as `upload()`, sourcing from the deployed static files + existing `config2-rejects.json` + `config4-pickups.json`
5. Run `flexget execute --tasks fetch-feeds --config /root/dev/apps/tv/apps/srvr/config-test/config.yml --test --dump` on the server
6. Confirm no config errors in output and accepted entries look correct

---

## 11. Web client flex pane redesign

The existing flex pane is replaced with a list of files sent to qbt.

**Data source**: `GET /api/flexget-history` endpoint — returns all candidates with non-null `sent` from `flexget-history.json`, flattened into a list.

**Sort**: by `sent` timestamp, most recent first.

**Line format**: `yyyy/mm/dd hh:mm:ss  S01E01  <show name>  <idx>`

- `<idx>` is blank for the first sent file per episode
- `<idx>` is `(2)`, `(3)`, etc. for subsequent sends for the same episode (ordered by `sent` timestamp)

**Example list**:

```
2026/05/04 14:23:01  S04E01  Slow Horses
2026/05/04 16:41:55  S04E01  Slow Horses  (2)
2026/05/04 16:41:56  S04E03  The Bear
2026/05/03 09:10:22  S02E07  Severance
```

**Click**: opens a dialog showing all stored fields for that candidate object.

**Implementation**: new Vue component or updated `flex.vue`; new srvr endpoint `GET /api/flexget-history`.

---

## Issues, ambiguities, and questions

1. **`--dump` output format**: The exact plain-text format of `flexget execute --dump` varies by flexget version and installed plugins. Key fields needed are `title`, `url`, `seeds`, `quality`. Need to run `flexget execute --tasks fetch-feeds --test --dump` on the server after install to confirm parseable fields are present. If the format is unreliable, a local temp file written by an exec plugin (same server, no SSH needed) may be cleaner — but instructions say use stdout.

2. **flexget installation on hahnca.com**: Instructions say "install flexget" but don't specify method (pip, pipx, apt, docker). Recommend `pipx install flexget` for isolation. Need to confirm Python version available on server.

3. **`--config` path for flexget**: Confirm the correct path to pass. Plan assumes `apps/srvr/config/config.yml` on the remote. The `upload()` function currently writes this file — the path doesn't change, just the content.

4. **Season packs**: `regexp` accept/reject will match season pack titles (e.g. "Slow Horses S04"). `parseTorrentTitle` will return `season` but no `episode` for these. Decision: skip candidates where episode is null — do not send season packs to qbt.

5. **`release_group` from --dump vs parseTorrentTitle**: Flexget may provide `release_group` as a field in `--dump` output. If not available, use `parseTorrentTitle(title).group` (after verifying torrent names have no extension). Plan should use whichever is available, preferring flexget's value.

6. **flexget-history.json path from down server**: `down` runs as a separate pm2 process. It needs to read `apps/srvr/data/flexget-history.json`. The path is `/root/dev/apps/tv/apps/srvr/data/flexget-history.json` — hard-code as uppercase constant in `down/src/main.js`. Confirm this cross-app file read is acceptable.

7. **`.old` file accumulation**: If many better files are downloaded over time, old `.old` files accumulate. No cleanup is specified in the instructions — confirm no cleanup is needed, or whether a second `.old` rename should chain (e.g. `.old.old`).

8. **qbt send mechanism**: Decision logic sends candidate `url` to qbittorrent. Confirm the existing qbt API call path in srvr is reusable for this, or if a new direct HTTP call to qbt is needed.

9. **flex pane `<idx>` calculation**: `<idx>` is determined at display time by counting prior sends for the same episode key, ordered by `sent`. This is a client-side computation over the returned list — no server-side field needed.

10. **USB server flexget**: Instructions say "usb server flexget will be idled". This means stopping the flexget daemon on the USB server and removing/disabling the cron or systemd unit there. The `reload-cmd` script on the USB server is no longer needed. The existing `send-data.sh` and `reload-cmd` infrastructure can be left in place but unused, or cleaned up separately.
