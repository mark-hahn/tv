# Video player buffering — current situation and options

## How playback works today

The player (`apps/client/src/components/video-player.vue`) sets the `<video>` src to
`/api/stream?path=...` on tv-srvr (`apps/srvr/src/routes/media.js`). The server has
two paths:

1. **Fast path** — if the file is already h264 + aac in an **.mp4** container (and
   default audio track), the server does a 302 redirect to the raw file on nginx
   (`https://hahnca.com/tv/...`). nginx serves it with HTTP **Range** support, so the
   browser can jump to any position instantly — exactly like Emby.

2. **Slow path** — everything else (mkv container, hevc/x265 video, non-aac audio,
   alternate audio track). ffmpeg pipes a **live fragmented MP4**
   (`-movflags frag_keyframe+empty_moov`) to the response:
   - No Content-Length, no Range support, and the browser sees an **unknown/growing
     duration**.
   - The `<video>` element can only play or seek within bytes it has already
     downloaded. Jumping ahead means waiting for the pipe to deliver everything up to
     that point.
   - h264-in-mkv is only remuxed (`-c:v copy`, fast delivery, network-limited), but
     hevc gets a full `libx264 ultrafast` transcode, which is roughly realtime — the
     buffer grows only about as fast as you watch.

Nearly all chksrt files are mkv, so chksrt almost always hits the slow path. That is
the wait you experience: the pane can't seek to the first subtitle cue until the
stream has streamed its way there.

The server already accepts a `&start=<sec>` param (ffmpeg `-ss`), but the client only
uses it inside `_mseRecover()` — a MediaSource-based **error recovery** that restarts
the stream at the failure point. It is never used for user seeks.

## What we tried before (the forgotten attempt)

It was **HLS** — this is the "load the buffer only where we are playing" idea:

- `eb01f9ee` (May 29) "switched player to hls" — hls.js in the client, plus
  `/api/hls/manifest.m3u8` and `/api/hls/segment.ts` on the server. v1 was stateless:
  every 10-sec segment spawned its own ffmpeg with `-ss`. Problem noted in the code:
  per-segment PTS offsets didn't line up, so hls.js kept jumping the playback
  position.
- `904be71a` (May 30) "impoved video player" — v2 rewrote it as a session-based
  ffmpeg with an on-disk segment cache: ffprobe scanned every keyframe timestamp,
  segments were keyframe-aligned via `-force_key_frames` + the `segment` muxer,
  sessions restarted when you seeked far from the produced position, requests could
  wait up to 60s for a segment.
- `98a90133` (May 30, same day) "reverted video player" — the whole thing was backed
  out. No written reason survives, but the v2 machinery (per-file keyframe scans, PTS
  continuity, session lifecycle, seek-tolerance heuristics) was a lot of fragile
  moving parts for something that still stuttered on seeks.

The only survivor is the small MSE `_mseRecover` path in video-player.vue.

## Why Emby can jump instantly

Emby either serves the raw file with Range requests (direct play) or runs its
transcoder as **HLS with time-addressed segments**: the player asks for "segment at
12:40" and the server starts transcoding right there. Nothing before the playhead is
ever downloaded. Our slow path instead delivers one linear pipe from 0:00.

## Options

### 1. Pre-transcode the chksrt queue to seekable mp4 (recommended)

Your "recode the video" idea, applied narrowly. The chksrt queue is known in advance,
so a background job on the server can prepare each queued file as
h264/aac/`+faststart` mp4 in a cache dir **before** you open the pane:

- h264-in-mkv (the common case): `-c:v copy` remux — lossless and very fast
  (a whole episode in seconds).
- hevc: real transcode — slow, but it runs in the background ahead of time, so you
  never wait.

`/api/stream` then checks the cache and redirects to nginx exactly like the existing
fast path → instant seek everywhere in the file, zero client changes, no new player
tech. Cache keyed on path+mtime, entries deleted after the file is checked/OK'd.
This is by far the least machinery for the specific pain point.

### 2. Play chksrt inside Emby via tampermonkey (your idea #2)

Reuse the intro-pane pattern: open Emby web with a `tvui=chksrt` URL param and let
`emby-ui.user.js` draw the OK / GenSrt / Sel / Save buttons as an overlay. Emby's
transcoder gives instant seeking for free. Two real obstacles:

- chksrt's core job is switching among **candidate subtitle tracks** — sidecar
  `.opnXXXXX.srt`, `.asr.srt`, embedded text, PGS. Emby only knows about tracks it
  scanned into its library, and driving its subtitle selection from a userscript is
  clumsy compared to our own `<track>` swapping.
- Files needing chksrt are often **not in Emby yet** (`show.inEmby` false), so a
  fallback player is still required.

Workable, but the overlay + Emby API work is significant and it only covers part of
the queue.

### 3. Resurrect HLS, but the simple way

The v2 failure mode was trying to make _cached, keyframe-aligned_ segments. The way
Emby/Jellyfin actually do it is simpler: **one ffmpeg session per viewer**, always
transcoding (no copy), with forced keyframes on a fixed grid
(`-force_key_frames expr:gte(t,n_forced*4)`) feeding the `hls` muxer; on a seek
outside the produced window, kill and restart at the new position. Fixed keyframe
grid = perfectly regular segments = no per-file keyframe scanning and no PTS
alignment problem. This fixes seeking for _all_ panes (intro too) but is the most
work, and always-transcode costs CPU even for h264 sources.

### 4. Minimal MSE seek (smallest code change)

`_mseRecover(startSec)` already does 90% of this: fetch `/api/stream?...&start=N`,
append via MediaSource with `timestampOffset = N`. Extend it:

- ffprobe the real duration (the probe already runs on every stream request) and set
  `mediaSource.duration`, so the seek bar shows the full length immediately.
- Intercept seeks outside the buffered range → abort the current fetch, restart the
  stream at the seek position.

Client-only plus one small server response field. Caveats: the mime string is
hard-coded (`avc1.640028, mp4a.40.2`) and must keep matching ffmpeg's output (it does
today — slow path always emits h264/aac), and `-ss` on mkv seeks to the prior
keyframe so landings are approximate by a couple seconds.

## My recommendation

Do **#1** for chksrt — it eliminates the wait entirely using infrastructure that
already exists (the nginx fast path), and the pre-transcode job is plain ffmpeg with
no player complexity. If later you want instant seek in ad-hoc playback (map pane,
movies) without pre-processing, add **#4**, which builds on code already in
video-player.vue. I'd avoid re-attempting HLS (#3) unless #4 proves inadequate, and
keep #2 as the fallback only if you want chksrt to inherit Emby's trick-play/bif
thumbnails too.

---

# Answers to your questions (implementing #1)

## Does the recoded file have to have a .mp4 suffix?

For nginx, effectively yes — nginx picks the `Content-Type` from the file
extension, so `.mp4` is the no-friction choice. But the Emby concern goes away
because of **where** the file lives, not what it's called: Emby only scans its
configured library folders (`/mnt/media/tv`, `/mnt/media/movies`). Files in
`/mnt/media/mpfour` are invisible to Emby no matter what suffix they have. So:
keep `.mp4`, store outside the library tree.

One small server change is needed: nginx currently only exposes
`location /tv { root /mnt/media; }`, so we add a matching
`location /mpfour { root /mnt/media; }` block to serve the cache tree.

## Will the recoded file have the same quality as the .mkv?

**Video: yes** for the common case. h264-in-mkv is remuxed with `-c:v copy` —
the video bitstream is copied byte-for-byte, zero quality loss. Only hevc/x265
sources get a real transcode (h264 `-crf 23`), which is lower quality.

**But the file as a whole is not an equal replacement**, so I recommend against
the rename-to-`.mkv.orig` scheme even for pure remuxes:

- Non-aac audio (ac3/dts/eac3 — very common in mkv releases) must be transcoded
  to stereo aac because browsers can't decode ac3/dts. The mp4 loses the 5.1
  surround your TV gets through Emby.
- mp4 can't carry PGS subtitle tracks, and chapters/secondary audio tracks
  generally get dropped. chksrt itself reads embedded tracks from the original
  path, so those must stay intact.
- Renaming originals changes the basenames that everything is keyed on — srt
  sidecars, asr queue, emby item paths, chksrt history matching. That's a lot of
  churn for no gain.

So: **parallel tree it is** — `/mnt/media/mpfour/<Show>/<Season>/<episode>.mp4`,
mirroring `/mnt/media/tv`, originals untouched. (For chksrt the stereo/subtitle
losses in the mp4 are irrelevant — the sidecar srt candidates are served
separately by `/api/subtitle`, and you only need watchable video+audio to judge
sync.)

## Persistence

Files persist indefinitely so chksrt can be re-run later. Invalidation is by
comparing the original's mtime+size (stored alongside or in the cache filename):
if the mkv is replaced by a new release, the stale mp4 is re-encoded on the next
queue pass. A periodic sweep (or a hook in the existing delete path) removes
mp4s whose original no longer exists.

## Separate queue

Agreed. The existing `ffmpegQueue` (`apps/srvr/src/batchQueue.js`) is a single
serialized queue shared by subtitle extraction, re-encodes, and BIF generation —
a chksrt preprocess job stuck behind a long re-encode would defeat the purpose.
New dedicated queue (concurrency 1), fed in the same order as the chksrt queue
itself, so the file you'll see first is recoded first. CPU headroom isn't a
concern per your note, and remuxes are seconds each anyway; only hevc files will
occupy the queue for real time.

## Resulting flow

1. File enters the chksrt queue → also enqueued in the new mpfour queue.
2. Queue worker: h264 → remux (`-c:v copy`, aac copy or ac3→aac stereo),
   hevc → transcode; output `-movflags +faststart` mp4 written to a temp name in
   `/mnt/media/mpfour/...` and renamed into place when complete.
3. `/api/stream` — when the requested path has a valid mpfour mirror (exists,
   original mtime/size match), 302-redirect to
   `https://hahnca.com/mpfour/...` → nginx serves with Range support → instant
   seek. Otherwise fall back to today's behavior (so nothing breaks while a file
   is still cooking).
4. Subtitles, audio-list, chksrt OK/Sel/Save all keep using the **original**
   path — only the video stream URL changes. No client changes needed at all.
