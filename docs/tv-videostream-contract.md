# Contract: show a live video stream on the TV

Status: **implemented and verified on the hardware** (2026-09-10)

Two projects, two Claude/copilot conversations, one feature:

| project | path | runs as | owns |
| --- | --- | --- | --- |
| tv | `/root/apps/tv` (local), deployed to `/root/dev/apps/tv` | pm2 `tv-tv` | the TV: power, mode, Emby, tvapp |
| hvac2 | `/root/dev/apps/hvac2` (hahnca.com, no local copy) | pm2 `hvac` | the Ring camera, go2rtc, ffmpeg, the player page |

Both processes run on **hahnca.com**, so the command is a localhost HTTP call.
Neither side needs to understand the other's internals — only what is below.

## Decisions already made

1. **Interrupt = pause and restore.** If Emby is playing, tv pauses it, shows the
   stream, and on stop brings Emby back to the front and unpauses. Position is
   preserved by Emby itself, so no seek is involved.
2. **Display = tvapp WebView overlay.** tvapp gains a fullscreen overlay that
   loads an hvac2-served page URL. All video logic (codec, nonce, Ring session,
   ffmpeg) stays in hvac2. tv never learns what fMP4 or Ring is.
3. **Trigger = manual only.** An hvac2 UI control starts and stops it. No
   auto-show on a doorbell press, so tv needs no dedup or rate-limit rule.

The tv-side API is deliberately **generic** — `videostream`, not `doorbell`. tv
takes a URL and a label; that the URL happens to be a Ring camera is hvac2's
business.

## The rule: never the tablet and the television at once

Ring video shows on the wall tablet or on the television, never both. It is a
hard invariant, not a preference, and it is enforced on both sides:

- `writeDoorbell` in hvac2 is the only place the tablet is ever told to show a
  stream, so the check lives there: if a television view is up — however it was
  started — it comes down first. That covers real doorbell events as well as
  manual ones. **The consequence is deliberate: a visitor arriving while
  somebody is watching the camera on the television moves the picture to the
  wall.**
- The television path (`/ring/view?tv=1`) clears the tablet before the
  television comes up, in case a real event has it.

## The Door key on the remotes

Both remotes — the phone (`apps/android/App.js`) and the web tv pane
(`apps/client/src/components/tvpane.vue`) — carry a `Door` key in row 3, in
normal *and* tvapprc mode. It is one request and no local state:

```
GET https://hahnca.com/ring/tvcam?action=toggle
```

`toggle` exists so the remotes never decide: only hvac2 knows whether a view is
up, and a remote that read the state first would race its own second press.
The endpoint answers with `Access-Control-Allow-Origin: *`, because the tv pane
calls it from the browser and that is cross-origin under vite dev.

Door replaced the Emby/Sel cell, and Search (phone) / Sel (web) moved onto what
was the Hide cell. Two things lost their key in the process: the normal-mode
Emby app switch, and Hide (the watched mark / hide-show press to tvapp).

## The /ring button

One control, three behaviours:

| gesture | result |
| --- | --- |
| click | video on the **wall tablet**, and in the /ring page |
| ctrl-click | video on the **television**, and in the /ring page |
| any click while viewing | stops, whichever screen it was on |

There is deliberately no way to move a live view from one screen to the other
without stopping it first — which is most of what keeps the rule above true.
The button label carries the state: `View` idle, `Hide 7` for the tablet,
`Hide TV 7` for the television.

`/ring`'s own video is not part of the rule. That page is the remote control;
it shows what it is sending, on either path.

## Constants

Hard-wired at the top of the file on each side (project rule: no env vars).

| name | value | used by |
| --- | --- | --- |
| `TV_TV_URL` | `http://127.0.0.1:3004` | hvac2 (already `TV_PORT` = 3004 in tv) |
| `HVAC2_PORT` | `1339` | hvac2 (existing) |
| `VIDEOSTREAM_HOLD_MS` | `90000` | tv — default dead-man hold |
| `VIDEOSTREAM_MAX_HOLD_MS` | `300000` | tv — ceiling on a requested hold |
| `VIDEOSTREAM_PING_MS` | `15000` | hvac2 — how often it pings while showing |

tv-tv is also reachable as `https://hahnca.com/tv-tv/` through nginx, but hvac2
must use `127.0.0.1:3004` directly: same host, no TLS, no proxy buffering.

## tv side: the command API

Four routes on tv-tv, modelled on the existing `/tv/scrub/{start,ping,stop}`
dead-man's-switch pattern in `apps/tv/src/main.js`.

### `POST /tv/videostream`

Show a stream fullscreen on the TV.

```json
{ "url": "https://hahnca.com/tvtab/doorbell-view/9f3a...", "label": "Front door", "holdMs": 90000 }
```

- `url` — **required**, absolute `https://hahnca.com/...`. tv rejects anything else.
- `label` — optional short caption tvapp may draw over the video.
- `holdMs` — optional, clamped to `VIDEOSTREAM_MAX_HOLD_MS`. Defaults to `VIDEOSTREAM_HOLD_MS`.

Success:

```json
{ "ok": true, "expiresAt": 1757523600000, "interrupted": "emby" }
```

`interrupted` is `"emby"`, `"tvapp"`, or `null` — what tv had to displace, so
hvac2's UI can say "your show is paused".

Refusals (HTTP 200, `ok:false`, one of these `reason` values):

| reason | meaning |
| --- | --- |
| `badUrl` | not an absolute `https://hahnca.com` URL |
| `tvOff` | TV would not come on |
| `tvappDown` | tvapp did not come up or did not ack the command |
| `busy` | a different stream is already showing — hvac2 should stop it first |

Calling it again with the **same** url while showing is a no-op that re-arms the
hold and returns `ok:true` (idempotent, so a UI retry is safe).

### `POST /tv/videostream/ping`

Body `{}`. Re-arms the hold. Returns `{ "ok": true, "expiresAt": ... }`, or
`{ "ok": false, "reason": "notShowing" }`. hvac2 pings every
`VIDEOSTREAM_PING_MS` for as long as its UI is in the showing state.

### `POST /tv/videostream/stop`

Body `{}`. Hides the overlay and restores what was interrupted. Returns
`{ "ok": true, "restored": "emby" | "tvapp" | null }`. Stopping when nothing is
showing is `{ "ok": true, "restored": null }` — never an error.

### `GET /tv/videostream/status`

```json
{ "showing": true, "url": "https://...", "label": "Front door",
  "since": 1757523510000, "expiresAt": 1757523600000, "interrupted": "emby" }
```

`{ "showing": false }` when idle. hvac2's UI polls this to stay in sync when the
hold expires on its own or someone dismisses the overlay with the remote.

## hvac2 side: what the URL must satisfy

tv passes the URL to a WebView and nothing else. So the page must:

1. Be **absolute https on hahnca.com** — the WebView's origin is `https://hahnca.com`
   (same as `TrailerPlayer.BASE_URL`), and mixed content will not load.
2. **Self-authenticate via the path** — a single-use nonce, as
   `/doorbell-h264/<nonce>` already does. No cookies, no headers, no query auth:
   tv sends nothing but the URL.
3. **Start playing with no user gesture.** tvapp sets
   `setMediaPlaybackRequiresUserGesture(false)`, but the page must not wait on a
   click of its own.
4. **Survive being loaded twice.** A WebView can reload; the nonce must not be
   consumed so hard that the second load 404s inside the hold window.
5. **Fill the viewport on a black background**, no scrollbars, no chrome. It is
   the whole screen, not a card in a page.
6. **Tear down the Ring session when the socket closes** — the existing
   `req.on 'close'` / `maxStreamMs` behaviour in `websock-server.coffee`. tv
   guarantees it closes the WebView, never that it tells hvac2 first.
7. **404 after expiry** rather than hanging, so a stale overlay fails visibly.

Reusing the existing tablet path is expected: hvac2 already serves an MSE player
page against `/doorbell-h264/<nonce>` with `/doorbell-stream/<nonce>` as the
MJPEG fallback, and `ring-capture.coffee` already multiplexes one capture to
several viewers.

## tvapp side: the overlay

New WebView overlay class alongside `TrailerPlayer` (same pattern, and
`TrailerPlayer` is proof the approach works on this TV).

New `CtrlServer` commands — free letters; `k j b g e r x f s p c h` are taken:

| command | meaning |
| --- | --- |
| `v,<url>` | show the overlay on `<url>`, fullscreen |
| `v,off` | hide the overlay, leave the show list exactly as it was |

- The overlay swallows all keys except **Back**, which hides it and reports up.
- Back to tv-tv: `z` (existing ack) on show, and a distinct ack when the user
  dismisses it, so tv can run the restore path it would have run on `stop`.
- The overlay must not disturb tvapp's selected show, cardMisc mode, or filters.

## Lifecycle

Show:

1. hvac2 mints a nonce URL and `POST /tv/videostream`.
2. tv reads the Emby session (`getEmbyPlaybackSession`). If playing and not
   paused → `Sessions/<id>/Playing/Pause`, remember `{ sessionId, wasPlaying }`.
3. If `tvMode === "off"` → `media_player.turn_on`, wait for it.
4. Bring tvapp up if it is not up — the **doorbell variant**: no `closeEmbyShow()`,
   no show selection. Leaving Emby paused underneath is exactly what we want here.
5. Send `v,<url>` on `ws://192.168.1.86:8099`, wait for the ack.
6. Arm the hold timer, reply `ok:true`.

Stop (hvac2 `stop`, hold expiry, or Back on the remote — all the same path):

1. Send `v,off`.
2. If `wasPlaying` → `play_media` `EMBY_APP_URI` to bring Emby forward, settle,
   then `Sessions/<id>/Playing/Unpause`.
3. Clear state. `status` now reports `showing:false`.

## Split of work

**tv** — the four routes, the hold timer, the pause/restore state, the doorbell
variant of the tvapp launch, the `v,<url>` / `v,off` commands, and the tvapp
overlay class. Build with `cd apps/tvapp && ./build-apk` (gradle and adb run on
hahnca.com; there is no hot reload).

**hvac2** — the UI control, minting and expiring the nonce URL, the fullscreen
player page, the `POST`/`ping`/`stop` calls, polling `status` to follow tv's
state, and keeping the Ring session tied to the stream socket.

## As built

| side | files |
| --- | --- |
| tv | `apps/tv/src/main.js` (the four routes, hold timer, pause/restore), `apps/tvapp/.../CamOverlay.java`, `CtrlServer.java` (`v,`), `MainActivity.java` |
| hvac2 | `src/drivers/tvcam.coffee` (tv-tv client + ping loop), `www/tvcam-html.coffee`, `www/tvcam-client.coffee`, routes in `src/drivers/websock-server.coffee` |

hvac2 has two ways in: `GET /ring/tvcam?action=show|stop|status[&label=]` for
scripting, and ctrl-click on `/ring`'s View button for people. Both mint the
page url and call tv-tv; the /ring path also arms the dead-man's switch on the
page's own stream socket, so closing the tab stops the television too.

Two things worth knowing that the design above did not anticipate:

- The stream nonces expire 45s after minting (`DOORBELL_NONCE_TTL_MS`), so the
  page url carries a nonce of its own and mints a fresh stream pair on **every
  page load**. That is what makes a WebView reload work rather than 404.
- Back is reported by tvapp calling tv-tv's own `/tv/videostream/stop` over
  https, not by a message up the ctrl socket — that socket only exists while
  the phone has a bridge leg open, and Back has to work regardless. One stop
  route means one restore path for all three ways a view can end.

## Verified

On the real hardware, 2026-09-10:

- **The WebView plays the fMP4.** `MediaSource.isTypeSupported` true, h264 path
  taken, first frame decoded ~4s after load, then 2.58 MB over 20s with an
  empty append queue. The MJPEG fallback stays in place for a future encoder
  change, but this television does not need it.
- show → decoded → stop, restoring `tvapp`.
- Over a playing show: paused at 32.62s, `interrupted:"emby"`; on stop,
  `restored:"emby"`, unpaused, and advancing 5.03s per 5s of wall clock.
  Emby honours `Unpause` as its own command.
- Hold expiry with no pings drops the view by itself.
- Back on the remote closes the overlay and runs the same restore.
- hvac2's ping sees a view the television dropped and matches its state.
- The rule, end to end: ctrl-click puts it on the television, a doorbell event
  takes it straight back off (`stopped on tv tablet is taking the video`), a
  plain click never touches the television, and any click stops.
- A `busy` refusal — tv-tv holding a view hvac2 restarted and forgot — is
  recovered by stopping that view and asking once more.

## Open items
- **Audio is unspecified.** The fMP4 pump is video-only today. A doorbell with no
  audio is half a doorbell; decide whether the page needs an audio track before
  building the UI.
- **Two-way talk** (talking back through the doorbell) is out of scope here.

## Keeping the two conversations in sync

This file is the source of truth, in the tv repo. There is no shared filesystem:
the hvac2 session lives on hahnca.com and cannot read `/root/apps/tv`. A copy is
at `/root/dev/apps/hvac2/tv-videostream-contract.md`; re-copy it after any edit,
and change the interface in this file first, never in the copy.
