# File locations (data + secrets)

This repo is deployed to the remote host under `/root/dev/apps/tv/`.

Rule of thumb:
- **Data** (mutable/runtime state) lives in each app’s `data/` folder.
- **Secrets** (keys, creds, tokens) live in each app’s `secrets/` folder.

## apps/api

**Data** (apps/api/data)
- `apps/api/data/cf-clearance.local.json` (runtime cookie cache)
- `apps/api/data/req-browser.txt` (optional curl template; DevTools “Copy as cURL (bash)”)
- `apps/api/data/req-reelgood.txt` (optional request template)
- `apps/api/data/accept-cert.html` (helper HTML)
- `apps/api/data/iptorrents-custom.json` (optional provider override)
- `apps/api/data/tor-results.txt` (torrent-search logging)
- `apps/api/data/reel-shows.json` (reelgood state)
- `apps/api/data/reelgood-titles.json` (reelgood state)
- `apps/api/data/*.json` (provider cookies like `iptorrents.json`, `torrentleech.json`, etc.)

**Data misc/logs** (apps/api/data/misc)
- `apps/api/data/misc/temp.txt` (debug payload log)
- `apps/api/data/misc/reelgood.log`
- `apps/api/data/misc/calls.log`
- `apps/api/data/misc/review-calls.log`

**Secrets** (apps/api/secrets)
- `apps/api/secrets/localhost-key.pem` (TLS private key)
- `apps/api/secrets/localhost-cert.pem` (TLS cert)
- `apps/api/secrets/mistral-key.txt` (used by client build; still a secret)
- `apps/api/secrets/qbt-cred.txt` (qBittorrent creds used by usb helpers)
- `apps/api/secrets/qb-cred.txt` (alternate creds file used by qb-cred.js)
- `apps/api/secrets/download-cred.txt` (SFTP/SSH download creds)
- `apps/api/secrets/subs-login.txt` (OpenSubtitles login JSON)
- `apps/api/secrets/subs-token.txt` (OpenSubtitles token; auto-updated)

Remote equivalents
- `/root/dev/apps/tv/apps/api/data/...`
- `/root/dev/apps/tv/apps/api/secrets/...`

## apps/down

**Data** (apps/down/data)
- `apps/down/data/tv.sqlite` (+ `tv.sqlite-wal`, `tv.sqlite-shm`, backups)
- `apps/down/data/tv-finished.json`
- `apps/down/data/tv-inProgress.json`
- `apps/down/data/tv-blocked.json`
- `apps/down/data/tv-map/` (directory)

**Data misc/logs** (apps/down/data/misc)
- `apps/down/data/misc/tv.log`

Remote equivalent
- `/root/dev/apps/tv/apps/down/data/...`

## apps/srvr

**Data** (apps/srvr/data)
- `apps/srvr/data/tvdb.json`
- `apps/srvr/data/gaps.json`
- `apps/srvr/data/lastViewed.json`
- `apps/srvr/data/notes.json`
- `apps/srvr/data/noemby.json`

**Data misc/logs** (apps/srvr/data/misc)
- `apps/srvr/data/misc/srvr.log`

**Secrets** (apps/srvr/secrets)
- Intended location for srvr secrets (currently used for subtitles creds/tokens if srvr needs them).

Remote equivalents
- `/root/dev/apps/tv/apps/srvr/data/...`
- `/root/dev/apps/tv/apps/srvr/secrets/...`

## apps/asr

**Data** (apps/asr/data)
- `apps/asr/data/logs/...` (per-run logs)

**Secrets** (apps/asr/secrets)
- `apps/asr/secrets/mistral-asr-key.txt`
- `apps/asr/secrets/openai-asr-key.txt`

Remote equivalent
- `/root/dev/apps/tv/apps/asr/data/...`
- `/root/dev/apps/tv/apps/asr/secrets/...`
