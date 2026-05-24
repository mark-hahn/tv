---
timestamp: 2026-05-24
warning: Code may have changed since this document was written. Verify details against current source.
---

# ASR Server — Context Document

## Overview

The ASR (Automatic Speech Recognition) module generates subtitle files for TV episodes using the Mistral AI audio transcription API. It takes a video file, extracts and preprocesses its audio, splits it into manageable chunks at natural silence boundaries, sends each chunk to the Mistral API, and assembles the responses into a polished `.asr.srt` sidecar subtitle file alongside the video.

The module has two layers:

- **`asr.js`** — the core processor. A pure Node.js ESM script that accepts one video file path as its CLI argument, runs `processOneVideo()`, and exits. It does all audio processing, API calls, and SRT generation.
- **`asr.sh`** — a Bash wrapper that resolves paths, manages a PID file and lock, runs `asr.js` detached in a `setsid` background process, and tails its log. It also provides `tail`, `kill`, `status`, `log`, `clear` subcommands.

In production, `asr.js` is spawned as a child process by `srvr/index.js` (the `tv-srvr` pm2 process). The old `tv-asr-bkgnd` pm2 process that ran `asr.sh` directly has been retired.

---

## Output: `.asr.srt` Sidecar Files

For a video at `/mnt/media/tv/ShowName/Season 1/episode.mkv`, the output is:

```
/mnt/media/tv/ShowName/Season 1/episode.asr.srt
```

The SRT content goes through multiple quality passes before writing:

1. **Overlap de-duplication** — segments with near-matching start or end timestamps (within 0.3 s) are collapsed, keeping the shorter text (avoids repeat text from chunk overlaps).
2. **Adjacent-merge** — consecutive segments with identical normalized text and a gap ≤ 2 s are merged into one. Short repeated captions across slightly larger gaps (≤ 5 s) are also merged.
3. **Single-token collapse** — single-word captions that repeat within a 30 s window are collapsed into one span.
4. **Line-length splitting** — segments longer than 42 characters are split at natural word boundaries using a balanced-chunks algorithm that avoids ending a line on an honorific (Mr., Dr., etc.).
5. **Short-segment padding** — segments under 1 s are padded up to 0.5 s on each side, staying at least 0.2 s away from neighboring entries.
6. **Honorific re-attachment** — if a segment ends on an honorific word, it is moved to the start of the next segment.

---

## Audio Pipeline

Before transcription, audio is processed through ffmpeg in two stages:

1. **Raw extraction** — video → mono WAV at 48 kHz / 256 kbps (the `max` audio config).
2. **Preprocessing** — mono WAV → filtered mono WAV applying `highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11`. This bandlimits to speech frequencies and normalizes loudness.

The preprocessed WAV is then chunked for API upload.

---

## VAD-Based Chunking

The Mistral API has a 24 MB file-size limit per request. The chunking algorithm cuts only at silence boundaries so no chunk ever splits mid-sentence:

1. **Silence detection** — ffmpeg `silencedetect` is run on the full preprocessed WAV. Midpoints of detected silence spans become candidate cut points.
2. **Binary search for threshold** — the algorithm binary-searches between −50 dB (strict/few cuts) and −20 dB (loose/many cuts), finding the strictest threshold at which every speech span fits within the 24 MB limit. Up to 8 iterations.
3. **Greedy combining** — silence-delimited spans are combined greedily into chunks, each estimated ≤ 22.3 MB (93% of limit).
4. **Adaptive BPS estimate** — an exponential moving average of measured bytes-per-second (FLAC) is maintained across chunks and used to refine size estimates. Starts at `ADAPTIVE_INITIAL_BPS = 45000`.
5. **Oversize retry** — if a FLAC chunk still exceeds the limit after VAD (BPS estimate was off), the chunk is shrunk by 20% and retried. Adjacent chunk start is adjusted accordingly.

Each chunk is extracted as a WAV snippet, encoded to FLAC, and uploaded. Chunk WAV files are written to `$ASR_TMPDIR` (default: `/tmp/asr-<ppid>`) and cleaned up after each chunk is uploaded. The two full WAV files (raw and processed) are deleted in a `finally` block after the episode completes.

---

## Mistral API Integration

- **Endpoint**: `POST https://api.mistral.ai/v1/audio/transcriptions`
- **Model**: `voxtral-mini-latest`
- **Format**: `verbose_json` — returns segment-level timestamps
- **Timestamp granularity**: `segment`
- **Language prediction**: disabled (`return_language=false`) — required when timestamp granularities are requested
- **Temperature**: `0`
- **Retry policy**: exponential backoff, up to 5 retries, starting at 5 s, doubling each attempt. Timeout per request: 2 minutes.
- **API key**: read at startup from `apps/asr/secrets/mistral-asr-key.txt` (file must exist; missing key causes immediate exit).

Usage dashboard: https://console.mistral.ai/usage

---

## Embedded Subtitle Extraction

Before (or alongside) ASR generation, the system can extract embedded text subtitles from the video container. This logic lives in `srvr/index.js` (`generateEmbSrts`), not `asr.js`:

- ffprobe is used to enumerate subtitle streams.
- Only English or language-untagged streams are processed.
- Only text-based codecs are extracted: `ass`, `ssa`, `subrip`, `webvtt`, `mov_text`, `text`.
- Each extracted stream becomes a sidecar `base.en<n>.srt` file (1-indexed). ASS/font/bold/italic tags are stripped.
- If any embedded subtitle streams exist but were NOT extracted (e.g. PGS/bitmap), a `base.enx.srtstub` sidecar is created to record that embedded subs exist but need ASR.

---

## Subtitle Queue System (in `srvr/index.js`)

Three in-memory queues coordinate subtitle processing. Each entry contains `{ videoFilePath, fromUI }`. All queues are persisted to JSON on every change and reloaded on server startup:

| Queue | Persisted file | Purpose |
|---|---|---|
| `subQueue` | `data/subQueue.json` | Files needing full subtitle processing (emb extraction + OpenSubs + ASR decision) |
| `subQueueChkSrt` | `data/subQueueChkSrt.json` | Files awaiting human review to choose/approve a subtitle |
| `subQueueGenSrt` | `data/subQueueGenSrt.json` | Files queued for ASR generation |

Queue files are located at `/root/dev/apps/tv/apps/asr/data/` on the remote server.

### Queue population sources

- **ASR button in local pane** — adds selected files to the top of `subQueueGenSrt` with `fromUI=true` (high priority).
- **TVDB update background task** — scans newly-in-Emby shows; adds files to end of `subQueue` with `fromUI=false` (low priority).
- **chokidar file watcher** — when a new video file appears, checks conditions and adds to top of `subQueue` with `fromUI=false`.

### Processing flow

`subQueue` → (emb extraction + OpenSubs) → if no srt exists → `subQueueGenSrt` → ASR → done  
`subQueue` → (emb extraction + OpenSubs) → if srt found → `subQueueChkSrt` → human review → optionally → `subQueueGenSrt`

One ASR job runs at a time, guarded by `genSrtRunning`. CPU load average is checked before starting a background ASR job (skips start if load > 2 when not in urgent mode).

---

## Data Files and Logs

All paths below are on the remote server at `/root/dev/apps/tv/apps/asr/data/` unless noted.

| File | Description |
|---|---|
| `asr.log` | Output of the most recent `asr.sh` run (overwritten each run). Tailed live by `asr tail`. |
| `subtitle.log` | Persistent log of all subtitle activity: emb extraction, OpenSubs downloads, ASR starts/completions. Rotated to `subtitle-logs/` at 5 am. |
| `subtitle-logs/` | Archive of rotated subtitle logs. |
| `subQueue.json` | Persisted subQueue array. |
| `subQueueChkSrt.json` | Persisted chkSrt queue array. |
| `subQueueGenSrt.json` | Persisted genSrt queue array. |
| `seasonPath` | Single line: the last target directory processed (written by `asr.sh`, read by `asr status`). |
| `asr-bkgnd.log` | Legacy background log from the retired `tv-asr-bkgnd` pm2 process. |
| `/tmp/asr-debug.log` | Debug log written by `asr.sh` on every invocation (env, args, Node path). |
| `/tmp/asr-background.log` | stdout/stderr of the detached bash wrapper process spawned by `asr.sh`. |
| `apps/asr/secrets/mistral-asr-key.txt` | Mistral API key. Not in repo. Must exist on server at runtime. |

---

## Dependencies

### Runtime (npm)

| Package | Purpose |
|---|---|
| `axios` | HTTP client for Mistral API calls |
| `form-data` | Multipart form construction for audio file uploads |
| `@mistralai/mistralai` | Official Mistral client (currently unused in favor of raw axios calls) |
| `@tv/share` | Shared workspace utilities |
| `node-fetch` | Fetch polyfill (available but not directly used in core path) |

### System binaries (must be installed on server)

| Binary | Purpose |
|---|---|
| `ffmpeg` | Audio extraction, preprocessing (filters), WAV chunking, FLAC encoding, subtitle extraction |
| `ffprobe` | Video duration, subtitle stream enumeration |
| `node` | JavaScript runtime for `asr.js` |

Both `ffmpeg` and `ffprobe` are verified at startup via a version check; missing binaries cause immediate exit.

---

## Process Management

- **Current architecture**: `srvr/index.js` spawns `node asr.js <videoFilePath>` directly as a child process for each ASR job. The `tv-asr-bkgnd` pm2 process is retired.
- **`asr.sh` wrapper**: still usable for manual CLI invocation. Accepts a folder or single file, runs in background via `setsid`, manages PID file at `data/asr.pid`, log at `data/asr.log`. Singleton — refuses to start if already running.
- **Temp files**: all temp WAV and FLAC files go to `/tmp/asr-<ppid>/` (set via `ASR_TMPDIR` env var). Chunk WAVs are deleted after each chunk uploads; full WAVs are deleted in a `finally` block.

---

## Key Constants

| Constant | Value | Meaning |
|---|---|---|
| `model` | `voxtral-mini-latest` | Mistral ASR model |
| `FILE_LIMIT_BYTES` | 24 MB | API per-file upload limit |
| `ADAPTIVE_INITIAL_BPS` | 45,000 B/s | Initial estimate of FLAC bytes/sec for chunking |
| `timeMatchMgn` | 0.3 s | Tolerance for considering two timestamps "equal" during dedup |
| `MAX_CHARS` | 42 | Max characters per SRT line before splitting |
| `AUDIO_FILTER` | `highpass=f=80,lowpass=f=8000,loudnorm=I=-16:TP=-1.5:LRA=11` | ffmpeg audio filter chain |
| `audioConfig` | `max`: 48 kHz / 256 kbps | Audio quality for extraction |
| `MAX_RETRIES` | 5 | API retry limit |
| `API_TIMEOUT` | 120,000 ms | Per-request timeout to Mistral |
