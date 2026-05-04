# Flexget Processing Update — Plan

## Overview of Changes

1. **New local static config files** — currently server-only, will now live in local workspace
2. **New config.yml structure** — no more qbittorrent plugin; uses regexp + exec to write NDJSON + run script
3. **New `send-data.sh`** — local source, deployed to USB server
4. **New `prefTorProviders.txt`** — local, deployed with srvr
5. **New srvr API endpoint** — accepts flexget-data.json POST from USB server
6. **New `pending-flexget.json`** — server-side state file for candidate management
7. **Decision logic** — runs after each merge, sends chosen candidate to qbt
8. **Logging** — `apps/srvr/data/flexget-decision.log`
9. **Deploy script update** — rsync static config files; skip the two dynamic JSON files
10. **One-time config-test** — validate new config.yml before going live

---

## 1. New local config files

Create these files in local workspace under `apps/srvr/config/`:

| File                          | Content                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `config/config1-header.txt`   | schedules block + clear-list task + fetch-feeds task through `regexp:\n      accept:` |
| `config/config3-middle.txt`   | closing of accept list + `      reject:`                                              |
| `config/config5-footer.txt`   | quality + disable + exec/python block + run-script task                               |
| `config/prefTorProviders.txt` | ordered list of preferred release groups (one per line, case-insensitive)             |

These replace the current server-only txt files. The two JSON files (`config2-rejects.json`, `config4-pickups.json`) remain server-side data files only — never stored locally.

---

## 2. New config.yml structure

The assembly in `upload()` (index.js) changes order and removes the qbittorrent template. New build:

```
headerStr                              ← config1-header.txt
  + '        - "dummy"\n'              ← placeholder so accept list is never empty
  + one line per pickup name           ← from config4-pickups.json
middleStr                              ← config3-middle.txt (closes accept, opens reject)
  + '        - "dummy"\n'              ← placeholder so reject list is never empty
  + one line per reject name           ← from config2-rejects.json
footerStr                              ← config5-footer.txt
```

### Example config.yml (abbreviated)

```yaml
schedules:
  - tasks:
      - clear-list
      - fetch-feeds
      - run-script
    interval:
      minutes: 15

tasks:

  clear-list:
    priority: 1
    exec:
      on_start:
        phase: truncate /home/xobtlu/flexget/flexget-data.json

  fetch-feeds:
    priority: 2
    inputs:
      - rss: https://iptorrents.com/t.rss?u=1961978;tp=44462d6cdc795cb9204c454f38785dcd;78;23;24;25;66;82;65;83;79;22;5;99;4;download;new
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

    exec:
      on_output:
        for_accepted: >
          python3 -c "
          import json, sys
          d = {
            'title':               '{{title}}',
            'url':                 '{{url}}',
            'quality':             '{{quality}}',
            'content_size':        '{{content_size}}',
            'torrent_seeds':       '{{torrent_seeds}}',
            'torrent_leeches':     '{{torrent_leeches}}',
            'torrent_availability':'{{torrent_availability}}',
            'torrent_timestamp':   '{{torrent_timestamp}}',
            'series_name':         '{{series_name}}',
            'series_season':       '{{series_season}}',
            'series_episode':      '{{series_episode}}',
            'series_id':           '{{series_id}}',
            'proper':              '{{proper}}',
            'release_group':       '{{release_group}}',
            'task':                '{{task}}',
          }
          print(json.dumps(d))
          " >> /home/xobtlu/flexget/flexget-data.json

  run-script:
    priority: 3
    exec:
      on_start:
        phase: /home/xobtlu/flexget/send-data.sh
```

The `qbittorrent` template section is removed entirely.

---

## 3. send-data.sh

Local source: `apps/srvr/send-data.sh`  
Deploy target: `/home/xobtlu/flexget/send-data.sh` (USB server)

```bash
#!/usr/bin/env bash
FILE=/home/xobtlu/flexget/flexget-data.json
[ -s "$FILE" ] || exit 0
curl -s -X POST https://hahnca.com/tv-srvr/api/flexget-data \
  --data-binary @"$FILE" \
  -H "Content-Type: application/x-ndjson" \
  -H "X-Flexget-Token: <secret>"
```

The `X-Flexget-Token` header provides simple authentication. A secret value must be stored in `apps/srvr/secrets/` on the remote server.

---

## 4. New srvr API endpoint: POST /api/flexget-data

Proxied automatically via the existing nginx `location /tv-srvr/api/` block — **no nginx changes needed**.

Accepts NDJSON body (one JSON object per line, as appended by flexget exec). Parses each line, merges into `apps/srvr/data/pending-flexget.json`.

---

## 5. pending-flexget.json data structure

```json
{
  "ShowName\u0000S01\u0000E05": [
    {
      "title": "Show Name S01E05 1080p WEB-DL x265-NTb",
      "url": "https://...",
      "quality": "1080p",
      "content_size": "850",
      "torrent_seeds": "42",
      "torrent_leeches": "3",
      "series_name": "Show Name",
      "series_season": "1",
      "series_episode": "5",
      "proper": "False",
      "release_group": "NTb",
      "task": "ipt",
      "addedAt": 1746400000
    }
  ],
  "AnotherShow\u0000S02\u0000E03": "decided"
}
```

**Key format**: `normalizedShowName + "\x00" + "S" + zeroPaddedSeason + "\x00" + "E" + zeroPaddedEpisode`  
**Value**: array of candidate objects, or the string `"decided"` once a candidate has been sent to qbt.

### Merge logic (on each POST)

For each NDJSON line:

1. Parse show name, season, episode using `parseTorrentTitle` (with extension-strip) + `parseFileSeasonEpisode` from `@tv/share`, falling back to `series_name`/`series_season`/`series_episode` from flexget
2. Skip if parsed show is not in Emby (`show.inEmby` is false)
3. Skip if a video file for that episode already exists or is queued
4. Skip if the key already has value `"decided"`
5. Skip if the exact same `url` is already in the list
6. Append candidate object with `addedAt: Date.now() / 1000`

After merge, run decision logic if anything changed.

---

## 6. Decision logic

Runs after each merge where at least one new candidate was added.

For each key whose value is an array (not `"decided"`):

1. If no candidates: skip
2. If newest `addedAt` is less than 24 hours ago: skip (wait for more candidates)
3. Choose best candidate by priority:
   a. Highest resolution — parse from `quality` or `title` via `parseTorrentTitle`; treat missing as 640
   b. Highest bit depth — from `parseTorrentTitle`; treat missing as 8
   c. Group position in `prefTorProviders.txt` — lower line number = preferred; case-insensitive; missing group = worst
   d. Highest `torrent_seeds` (parsed as integer)
4. Send chosen candidate's `url` to qbittorrent
5. Set key value to `"decided"`
6. Log decision to `apps/srvr/data/flexget-decision.log`

### Log format (one line per decision)

```
05-04 14:23 DECIDED  Slow Horses S04E01  chosen: "Slow.Horses.S04E01.1080p.WEB-DL.x265-NTb" (1080p, 10bit, group=NTb[rank 3], seeds=55)  rejected: ["Slow.Horses.S04E01.720p.WEBRip.x264-FoV" (720p, 8bit, group=FoV[rank 8], seeds=12)]
```

---

## 7. prefTorProviders.txt

Local file: `apps/srvr/config/prefTorProviders.txt`  
Deployed to: `/root/dev/apps/tv/apps/srvr/config/prefTorProviders.txt` via `./srvr srvr`

One release group name per line. First line is most preferred. Example:

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

---

## 8. Deploy script changes (./srvr)

The `remote_sync_app` function for `srvr` currently has no local `config/` dir to sync. After this change it will. Need to add two excludes to the srvr rsync call so the dynamic JSON data files are never overwritten by deploy:

```bash
--exclude 'config/config2-rejects.json'
--exclude 'config/config4-pickups.json'
```

The three static txt files and `prefTorProviders.txt` will then be synced normally.

---

## 9. index.js changes summary

- `upload()` function: change assembly order (header + pickups + middle + rejects + footer; add dummy to both lists); remove qbittorrent-related reference
- Add `POST /api/flexget-data` handler
- Add merge logic and decision logic
- Load `prefTorProviders.txt` at startup (from `config/` dir, fail-fast if missing once deployed)
- Load and persist `pending-flexget.json`

---

## 10. One-time config-test

Steps:

1. Create local static files (`config1-header.txt`, `config3-middle.txt`, `config5-footer.txt`) with new content
2. On remote, create `/root/dev/apps/tv/apps/srvr/config-test/`
3. rsync the three local static txt files to `config-test/`
4. Copy `config2-rejects.json` and `config4-pickups.json` from `config/` to `config-test/`
5. Run a small Node snippet that does the same assembly as the new `upload()` and writes `config-test/config.yml`
6. Manual review of `config-test/config.yml`

---

## Issues, ambiguities, and questions

1. **NDJSON format**: The flexget exec appends one JSON object per line (`>> file`). The `truncate` command at the start of each run clears it. This means `flexget-data.json` is NDJSON (not a JSON array). The srvr endpoint needs to parse it line-by-line. **Confirm this is the intended format.**

2. **Authentication for /api/flexget-data**: The endpoint will be publicly accessible via nginx. The plan uses a shared secret token in a header. **Confirm this approach, and the token needs to be added to `apps/srvr/secrets/` on the remote.**

3. **Season packs**: The old `series` plugin filtered them with `season_packs: no`. The new regexp approach will accept season packs that match a show name. The merge logic should probably skip entries where episode is null (season pack) to avoid sending a full season to qbt unexpectedly. **Should season packs be ignored or handled specially?**

4. **Empty file handling for `truncate`**: `truncate /home/xobtlu/flexget/flexget-data.json` sets the file to 0 bytes. If flexget gets zero matches in a run, the file will be empty when `run-script` sends it. The `send-data.sh` plan already handles this with `[ -s "$FILE" ] || exit 0`. **Confirm this is the right behavior (skip send if nothing matched).**

5. **`parseTitleFromFilename` vs flexget `series_name`**: Flexget's `series_name` field will be empty/`"None"` since we're not using the series plugin — we're using `regexp`. **Parsing should rely on `parseTorrentTitle(title)` for show name, not `series_name`.**

6. **`prefTorProviders.txt` at startup**: The instructions say "fail fast if file is missing" (per workspace coding rules). But during the period before first deploy, the file won't exist on the server. Either pre-create it on server during config-test phase, or do a soft fail (log warning, treat all groups as equal). **Recommend: create the file during config-test, so by go-live it's always present.**

7. **qbt endpoint**: Decision logic sends candidate to qbittorrent. The current qbt integration in srvr is via the torrent search flow. **Confirm the new code can reuse existing qbt-send logic in srvr, or if a new direct qbt API call is needed.**
