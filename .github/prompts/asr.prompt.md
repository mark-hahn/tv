---
description: ASR (automatic speech recognition / subtitle) server documentation and context
timestamp: 2026-05-24
warning: Code may have changed since this document was written. Verify details against current source.
---

# ASR Module (`apps/asr`)

## Overview
Generates `.asr.srt` subtitle sidecar files for TV episodes using the Mistral audio transcription API.
- **`asr.js`** — core processor; CLI: `node asr.js <videoFilePath>`. Spawned by `srvr/index.js` as a child process.
- **`asr.sh`** — Bash wrapper for manual CLI use (subcommands: `tail`, `kill`, `status`, `log`, `clear`).

## Output
For `/mnt/media/tv/ShowName/Season 1/episode.mkv` → `episode.asr.srt` in the same directory.

## Audio Pipeline
1. Extract: video → mono WAV at 48 kHz / 256 kbps
2. Preprocess: `highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11`
3. VAD-based chunking at silence boundaries (binary-search threshold; greedy combine to ≤22.3 MB)
4. Each chunk → FLAC → `POST https://api.mistral.ai/v1/audio/transcriptions`
5. Assemble segments into SRT (dedup, line-split at 42 chars, pad short segments)

## Mistral API
- Model: `voxtral-mini-latest`; format: `verbose_json`; temp: `0`
- File limit: **24 MB** per request; timeout: 120s; up to 5 retries (exponential backoff, 5s start)
- API key: `apps/asr/secrets/mistral-asr-key.txt` (must exist; missing = immediate exit)

## Queue System (in `srvr/index.js`)
| Queue | Persisted file | Purpose |
|---|---|---|
| `subQueue` | `data/subQueue.json` | Files needing full subtitle processing (emb + OpenSubs + ASR decision) |
| `subQueueChkSrt` | `data/subQueueChkSrt.json` | Awaiting human review to choose/approve a subtitle |
| `subQueueGenSrt` | `data/subQueueGenSrt.json` | Queued for ASR generation |

Flow: `subQueue` → emb extraction + OpenSubs → no srt → `subQueueGenSrt` → ASR → done
One ASR job at a time. CPU load checked before starting background jobs (skips if load > 2).

## Queue Sources
- **ASR button in local pane** → top of `subQueueGenSrt` (high priority, `fromUI=true`)
- **TVDB update background task** → end of `subQueue` (low priority)
- **chokidar watcher** (new video file) → top of `subQueue`

## Key Data Files (remote: `/root/dev/apps/tv/apps/asr/data/`)
- `asr.log` — output of most recent run
- `subtitle.log` — persistent log of all subtitle activity; rotated to `subtitle-logs/` at 5am
- `/tmp/asr-<ppid>/` — temp WAV/FLAC chunk files (cleaned up per-chunk and in finally block)

## Key Constants
| Constant | Value |
|---|---|
| Model | `voxtral-mini-latest` |
| `FILE_LIMIT_BYTES` | 24 MB |
| `MAX_CHARS` | 42 chars/line |
| `timeMatchMgn` | 0.3s (dedup tolerance) |
| `ADAPTIVE_INITIAL_BPS` | 45,000 B/s (FLAC size estimate) |
