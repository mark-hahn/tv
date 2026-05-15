# Flexget Processing Update — Plan

## Overview of Changes

1. **New local static config files** — currently server-only, will now live in local workspace
2. **New config.yml structure** — no qbittorrent plugin, no exec/python output block; regexp accept/reject + RSS feeds only
3. **Flexget runs on hahnca.com** — srvr triggers `flexget execute` via cron every 15 min; results parsed from stdout `--dump` output
4. **New `flexget-history.json`** — replaces `pending-flexget.json`; stores all candidates with `sent` timestamp
5. **Incremental decision logic** — runs per-candidate as received; no 24hr wait; better files re-sent to qbt
6. **Down server changes** — skip files that are not the most-recent-sent for an episode; rename old video file to `.old` when replaced
7. **Deploy script update** — rsync static config files from local; skip the two dynamic JSON files
8. **One-time config-test** — execute flexget dry run to verify config.yml is valid
9. **Web client flex pane redesign** — lists files sent to qbt from flexget-history.json

---

## 1. New local config files

Create these files in local workspace under `apps/srvr/config/`:

| File                        | Content                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `config/config1-header.txt` | `tasks:\n\n  fetch-feeds:\n    inputs:` block through RSS feed lines                             |
| `config/config3-middle.txt` | closes `inputs` + opens `regexp:\n      accept:`                                                 |
| `config/config5-footer.txt` | closes `accept:`, opens `reject:` then closes it; adds `quality: "any"` and `disable:\n  - seen` |

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

## 4. flexget-history.json (renamed from pending-flexget.json)

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
4. Skip if the exact same `url` is already in the history list for this key
5. Add candidate object to array with `sent: null`
6. Run decision logic for this episode key

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
   - **Seeds**: higher is better
   - If new candidate is **better**: send to qbt, set `sent` to current timestamp
   - If new candidate is **same or worse**: do not send, leave `sent: null`
4. Save flexget-history.json after every change

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

Static files (`config1-header.txt`, `config3-middle.txt`, `config5-footer.txt`) sync normally since they now exist in local workspace.

No changes needed for `./srvr down`.

---

## 9. index.js changes summary

- Add `node-cron` job: every 15 min run `flexget execute --tasks fetch-feeds --config <path> --dump`
- Parse stdout of `--dump` to extract candidate records (see config-test section for format verification steps)
- For each candidate: run merge + decision logic
- Load `flexget-history.json` at startup (create empty `{}` if missing — first run)
- `upload()` function: updated assembly order (header + pickups + middle + rejects + footer); remove qbittorrent
- Remove: `send-data.sh` logic, USB flexget reload, `POST /api/flexget-data` endpoint, `pending-flexget.json`

---

## 10. One-time config-test

**Key constraint**: Do not deploy with `./srvr srvr` during testing — old flexget code must not run with new data. Deploy files directly to the test folder only.

### If using `--dump` stdout (chosen approach):

Steps (order matters — confirm format before writing parse code):

1. Create local static files (`config1-header.txt`, `config3-middle.txt`, `config5-footer.txt`) with new content
2. On remote, create `/root/dev/apps/tv/apps/srvr/config-test/`
3. rsync static txt files directly to `config-test/` on the server (do not `./srvr srvr`)
4. Copy `config2-rejects.json` and `config4-pickups.json` from `config/` to `config-test/`
5. Run a small Node snippet that does the same assembly as the new `upload()` and writes `config-test/config.yml`
6. Run `flexget execute --tasks fetch-feeds --config /root/dev/apps/tv/apps/srvr/config-test/config.yml --test --dump` to see output format
7. Confirm which fields are present in `--dump` output (`title`, `url`, `seeds`, `quality`, `release_group`, etc.)
8. Update the stdout-parsing code in index.js to match the confirmed format
9. Re-rsync updated files to `config-test/` if config changed
10. Run `flexget execute --tasks fetch-feeds --config /root/dev/apps/tv/apps/srvr/config-test/config.yml --test --dump` again to confirm accepted entries look correct

### If switching away from `--dump`:

Use the same test-folder approach. Run whichever format check is needed at step 7 before writing parse code.

---

## 11. Web client flex pane redesign

The existing flex pane is replaced with a list of files sent to qbt.

**Data source**: `GET /api/flexget-history` endpoint — returns all candidates with non-null `sent` from `flexget-history.json`, flattened into a list.

**Sort**: by `sent` timestamp, oldest first (standard log scrolling; bottom is non-sticky — new entries appear at bottom but do not auto-scroll).

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

## Resolved questions

1. **`--dump` output format**: Approach: use `--dump` stdout. Format must be confirmed before writing parse code — see config-test section (step 7 first, code second). If `--dump` proves unreliable, a server-local temp file via exec plugin is an alternative.

2. **flexget installation**: Use `pipx install flexget`. Confirm Python version available on hahnca.com before installing.

3. **`--config` path**: Pass `--config /root/dev/apps/tv/apps/srvr/config/config.yml` to all flexget commands. The `upload()` function already writes to that path — no change needed.

4. **Season packs**: Skip candidates where episode is null — do not send season packs to qbt.

5. **`release_group` source**: Use whichever is available, preferring flexget's `release_group` field. Fall back to `parseTorrentTitle(title).group`.

6. **Cross-app file read**: `down` reading `apps/srvr/data/flexget-history.json` directly is confirmed acceptable. Hard-code path as uppercase constant in `down/src/main.js`.

7. **`.old` file accumulation**: No cleanup needed. If a file already has a `.old` suffix, chain the rename (e.g. `.old` → `.old.old`).

8. **qbt send mechanism**: Reuse the existing qbt API call path in srvr.

9. **`<idx>` calculation**: Client-side computation over the returned list — no server field needed.

10. **USB server flexget**: Stop the flexget daemon on the USB server and disable the cron or systemd unit. Infrastructure (`send-data.sh`, `reload-cmd`) can remain in place but unused. Note: shared server — privileges may be limited.
