# Plan: Convert Server Polling to WebSocket Channels

Status: **design/plan only — no code has been written.** This document is
detailed enough to hand to another LLM or engineer for implementation.

---

## 1. Goal

Replace the client's ~12 periodic HTTP/WS polls with a **push model** built on a
single centralized **channel facility** multiplexed over one WebSocket per
peer. The client is a **sink**: it opens a channel when a view needs the data
and closes it when it doesn't. On open, the current snapshot is delivered
immediately; thereafter only **changed** data is pushed. Data sources live in
whichever pm2 task owns them and expose a **standard source interface**;
`tv-srvr` acts as an **opaque payload broker** that routes channel traffic
between the browser and the owning task.

This plan incorporates decisions reached in prior discussion:

- **Snapshot-on-open is mandatory** (restores the "instant data" property that
  polling gave for free on its first tick).
- **Change-detection lives at the source** (the broker never inspects payloads).
- **Ref-count on both legs** (browser↔srvr and srvr↔source): a source only
  produces a channel while ≥1 browser is subscribed.
- **Two channel flavors**: `state` (snapshot + diff) and `stream` (append, e.g.
  logs) — see §4.4.
- **srvr is a two-legged broker**; reconnect on either leg self-heals via
  re-subscribe → re-snapshot.
- **Short (server↔server RPC) channels are scoped, not wholesale** — see §8.

---

## 2. Current state (verified against the codebase)

### 2.1 pm2 topology (remote `hahnca.com`, from `pm2 ls`)

| pm2 name      | app dir        | framework          | role |
| ------------- | -------------- | ------------------ | ---- |
| `tv-srvr`     | `apps/srvr`    | express + `ws`     | **WS hub** for the browser; owns Emby/tvdb/flexget/badGroups/lastViewed/asr/fix |
| `tv-api`      | `apps/api`     | express            | torrents / qBittorrent / browse / file tree |
| `tv-down`     | `apps/down`    | raw `http` (pathname switch, not express) | download + movie-rsync job status |
| `tv-tv`       | `apps/tv`      | express            | TV + Emby session control |
| `tv-watchdog` | `apps/watchdog`| —                  | not polled by the client; **out of scope** |

Notes:
- **There is no `tv-asr` process.** ASR runs inside `tv-srvr`; `asr-log`
  originates in `apps/srvr/src/subsQueue.js` (`notifyClients("asr-log", line)`).
- The browser reaches four different origins today via nginx:
  `tv-srvr`, `tv-api`, `tv-down`, `tv-tv` (see `apps/client/src/config.js`).

### 2.2 Existing WebSocket infrastructure

**Client** (`apps/client/src/srvr.js`):
- One `WebSocket` to `wss://hahnca.com/tv-srvr` (`WS_URL`, nginx → `tv-srvr:8736`).
- Auto-reconnect (`WS_RECONNECT_DELAY_MS = 10000`), emits `evtBus.emit("ws-reconnected")` on `onopen` (`srvr.js:159`).
- `rejectAllPending()` already fails in-flight calls on close (`srvr.js:136`) — **the orphaned-call hazard is already handled** for the existing RPC path.
- `fCall(fname, param)` — id-matched request/reply over WS via the `calls[]` promise map (`srvr.js:197`). Currently used only for `handleFix`.
- `httpCall(endpoint, …)` — REST, but **only to `tv-srvr`** (`HTTP_URL = config.tvSrvrUrl`, `srvr.js:219`). Calls to `tv-api`/`tv-down`/`tv-tv` are raw `fetch()` in components.
- `wsSend(obj)` — fire-and-forget send (`srvr.js:186`).
- `handleMsg` (`srvr.js:319`) routes inbound frames:
  - `status:"asr-log"` → `evtBus.emit("asr-log", …)`
  - `status:"fix-log"` → `evtBus.emit("fix-log", …)`
  - `{id:0, notification, data}` → `evtBus.emit(notification, data)` (generic push)
  - otherwise id-matched RPC response → resolve/reject the pending call.

**Server** (`apps/srvr/src/messaging.js`):
- `new WebSocketServer({ port: 8736 })`; `connectedClients: Set`.
- `notifyClients(notification, data)` broadcasts `{id:0, notification, data}` to **all** connected clients (no per-client subscription).
- `activeServerMessages: Map` replayed to new connections — **precedent for
  snapshot-on-connect**; the channel facility generalizes this.
- Per-connection handler lives in `apps/srvr/index.js` (`fname` dispatch, e.g. `handleFix` at `index.js:3024`).

### 2.3 The polling sites to convert (from prior analysis in `temp.md`)

| # | Source view | Origin server | Endpoint | Cadence | Subscribe when | Kind |
|---|---|---|---|---|---|---|
| 1 | `srvr.js` lastViewed cache | tv-srvr | `GET /api/getLastViewed` | 10s, always | app load → app close | state |
| 2 | `App.vue` qbt active indicator | tv-api | `GET /api/qbt/info` | 5s, always (not simpleMode) | app load | state (derived boolean) |
| 3 | `App.vue` chksrt badge | tv-srvr | `getChksrtList()` → `GET /api/asr/chksrt/list` | 60s | app load | state |
| 4 | `App.vue` browse "has more" badge | tv-api | `GET /api/hasBrowseShow` | 60s | app load | state |
| 5 | `down.vue` main list | tv-down | `GET /downloads` | 5s (1s for 30s after `cycle-started`) | mounted (boot), even hidden | state |
| 6 | `down.vue` movie downloads | tv-down | `GET /movieDownloads` | 2s | `movieMode` true | state |
| 7 | `qbt.vue` pane | tv-api | `GET /api/qbt/info` | 5s | pane `qbt` active | state |
| 8 | `flex.vue` pane | tv-srvr | `GET /api/flexget-history` + `/api/flexget-status` | 10s | pane `flex` active | state |
| 9 | `tor.vue` bad groups | tv-srvr | `getBadGroups()` → `GET /api/getBadGroups` | 3s | mounted | state |
| 10 | `local.vue` fix/ffmpeg log tail | tv-srvr | `handleFix({action:"tail",offset})` (WS RPC) | 1s | fix job running | **stream** |
| 11 | `tvpane.vue` picture popup | tv-tv | `GET /tv/picture` | 3s | popup open | state |
| 12 | `tvpane.vue` subtitle-players popup | tv-tv | `GET /tv/emby/playing` | 3s | popup open | state |

**Not pollers — leave alone** (documented in `temp.md`): the srvr.js lag
monitor, video-player seek-retry, the debounced one-shot fetches in
`usb.vue`/`local.vue`, the tvpane scrub auto-repeat, and the WS reconnect timer.

### 2.4 Existing server→client pushes (candidates for later unification, §6)

- **stream**: `asr-log` (`subsQueue.js:140`), `fix-log` (fix-runner).
- **notification** (`{id:0, notification}`): `embyText` (`intro.js:201`),
  `setGlobalMessage`, `libraryProgress`/`libraryRefreshDone`,
  `asr-queue-update`, `subs-progress`, etc.
- `activeServerMessages` replay = an ad-hoc snapshot-on-connect already in place.

---

## 3. Target architecture

```
 Browser (client, SINK)                tv-srvr (BROKER)                 Owning pm2 task (SOURCE)
 ┌───────────────────────┐            ┌──────────────────────┐         ┌──────────────────────────┐
 │ ChannelManager        │            │ ChannelBroker        │         │ ChannelSource (per chan) │
 │  - open(name)         │  browser   │  - client sub table  │ backend │  - onFirstSubscriber()   │
 │  - close(name)        │◄── WS ────►│  - peer registry     │◄── WS ─►│    → produce()           │
 │  - onSnapshot/onDelta │  (existing │  - fan-out           │  (NEW   │  - detectChange()        │
 │  - re-subscribe on    │   :8736)   │  - ref-count (2 legs)│  peer   │  - snapshot()            │
 │    ws-reconnected     │            │  - OPAQUE to payload │  link)  │  - onLastUnsubscriber()  │
 └───────────────────────┘            └──────────────────────┘         └──────────────────────────┘
     one WS per browser                one hub process                  api / down / tv (+ srvr-local)
```

Three layers, each with a small standard interface. The **payload** is opaque to
the broker; the **envelope/control plane** is not (the broker reads channel
name, subscribe/unsubscribe, and routing metadata).

### 3.1 Client: `ChannelManager` (new module, e.g. `apps/client/src/channels.js`)

Responsibilities:
- `openChannel(name, { onSnapshot, onDelta })` → returns a handle; increments a
  local ref-count. First local subscriber sends a `sub` control frame over the
  existing WS. Subsequent local subscribers to the same `name` attach to the
  already-open channel (no extra wire traffic).
- `handle.close()` → decrements ref-count; last local unsubscriber sends `unsub`.
- On inbound `snapshot` frame → call `onSnapshot(data)`. On `delta` → `onDelta(data)`.
- On `evtBus.emit("ws-reconnected")` → **re-send `sub` for every open channel**;
  each re-sub triggers a fresh snapshot. This is the self-heal mechanism.
- Reuses the existing socket, `ensureWs`, `wsSend`. No new socket.

Client components change from `setInterval(fetch)` to
`openChannel/close` at the **same lifecycle points** they already have
(`mounted`/`unmounted`, `onPaneChanged`, popup open/close). See §5.

### 3.2 Broker: `ChannelBroker` in `tv-srvr` (extend `apps/srvr/src/messaging.js` + `index.js`)

Responsibilities:
- **Client subscription table**: `channelName → Set<clientWs>`.
- **Peer registry**: `channelName → peerWs` (which backend task owns the channel).
  Built from `register` frames sent by peers on connect (§3.4).
- **Local source table**: for channels owned by `tv-srvr` itself
  (lastViewed, chksrt, flexget, badGroups, fix, asr) there is **no peer link** —
  the source runs in-process and registers directly with the broker.
- **Two-leg ref-count**:
  - First browser to subscribe to `name` → broker sends `sub` to the owning
    peer (or calls the local source's `onFirstSubscriber`), which starts
    producing and returns a snapshot.
  - Last browser to unsubscribe → broker sends `unsub` to the peer / calls
    `onLastUnsubscriber`, which stops producing.
- **Snapshot nudge**: because the broker can't see payloads, when a browser
  subscribes to an already-active channel the broker asks the source for a
  fresh snapshot (a `snapshot-request` control frame) and relays the result to
  that one browser only.
- **Fan-out**: a `delta`/`snapshot` from a source is forwarded to the exact set
  of subscribed browsers.
- **Opaque payloads**: broker never `JSON.parse`s channel `data`. It routes by
  the envelope only.
- **Reconnect (peer leg)**: if a peer WS drops, mark its channels unavailable;
  on peer reconnect + `register`, re-issue `sub` for any channel that still has
  browser subscribers, and relay the new snapshot out.
- **Reconnect (browser leg)**: handled by the client re-subscribing; broker just
  processes the incoming `sub` frames normally.

### 3.3 Backend peer link (NEW: `apps/api`, `apps/down`, `apps/tv`)

Each of `tv-api`, `tv-down`, `tv-tv` opens **one outbound WS to the broker**
(`ws://127.0.0.1:8736`, same-host, no nginx). On connect it sends a `register`
frame listing the channel names it owns. It then:
- Handles `sub`/`unsub`/`snapshot-request` control frames from the broker.
- Sends `snapshot` (on subscribe) and `delta` (on change) frames upstream.
- Reconnects with backoff if the broker restarts (mirror the client's reconnect
  pattern; a peer restart re-dials and re-`register`s).

A **shared helper** belongs in `packages/share` (already imported by all peers as
`@tv/share`, e.g. `apps/api/src/server.js:50`, `apps/tv/src/main.js:9`). Add a
`ChannelPeer` class there so all three peers use identical framing, reconnect,
and ref-count logic.

### 3.4 Wire protocol (envelope; payload is opaque)

All frames are JSON. **Reserve a `ch` field** so channel frames are
distinguishable from the existing `{id:…}` RPC frames and `{id:0,notification}`
pushes — `handleMsg` on the client and the srvr handler branch on presence of
`ch`.

Browser ↔ broker:
```jsonc
// browser → broker
{ "ch": "downloads", "op": "sub" }
{ "ch": "downloads", "op": "unsub" }
// broker → browser
{ "ch": "downloads", "op": "snapshot", "data": <opaque> }
{ "ch": "downloads", "op": "delta",    "data": <opaque> }
{ "ch": "downloads", "op": "unavailable" }   // source down; client keeps last data, shows staleness if desired
```

Broker ↔ peer:
```jsonc
// peer → broker (on connect)
{ "op": "register", "channels": ["downloads", "movieDownloads"] }
// broker → peer
{ "ch": "downloads", "op": "sub" }             // first browser subscribed
{ "ch": "downloads", "op": "unsub" }           // last browser unsubscribed
{ "ch": "downloads", "op": "snapshot-request" }// new subscriber joined an active channel
// peer → broker
{ "ch": "downloads", "op": "snapshot", "data": <opaque> }
{ "ch": "downloads", "op": "delta",    "data": <opaque> }
```

For **stream** channels, `snapshot` carries the current buffer / a `sinceOffset`
cursor and `delta` carries appended lines (see §4.4).

### 3.5 Change detection (source responsibility)

Sources fall into two groups:
- **Event-driven**: the source already knows when its data changes (e.g. the
  `down` worker updates job rows; flexget writes `flexget-history.json`;
  `tvdb.js` mutations). Emit a `delta` (or new `snapshot`) at that moment.
- **No native change event**: qBittorrent (`/api/qbt/info`), TV picture
  settings, Emby `playing`. The **source process** runs one internal poll and
  **diffs**; it emits a `delta` only when the value changed. This is still a net
  win — one server-side poll instead of N browsers — but the poll **relocates,
  it does not vanish**. Gate that internal poll on the two-leg ref-count so it
  only runs while a browser is subscribed.

Default diff granularity: **whole-snapshot-on-change** (emit the full new state;
client replaces). Only adopt field-level deltas for a channel that proves to be
large/high-frequency. Do not build patch/merge machinery up front.

### 3.6 Snapshot/delta ordering (correctness requirement)

On subscribe, the source must **register the subscriber before capturing the
snapshot**, so any change occurring after the snapshot is delivered as a delta
(no lost or duplicated update). Equivalent: take the snapshot, then start the
delta stream from the exact state the snapshot reflects. This applies on both
first-subscribe and every reconnect re-subscribe.

---

## 4. Channel catalog

### 4.1 srvr-owned channels (no peer link; source runs inside `tv-srvr`)

| channel | replaces | source module | change signal |
|---|---|---|---|
| `lastViewed` | #1 | `apps/srvr/src/lastViewed.js` (`view.getLastViewed`, `index.js:1217`) | on Emby lastViewed update; else internal poll + diff |
| `chksrt` | #3 | `apps/srvr/src/…` (`/api/asr/chksrt/list`, `index.js:2075`) | on asr chksrt queue change |
| `browseHasMore` (see note) | #4 | **tv-api** — actually api-owned, see §4.2 | — |
| `flexget` | #8 | `apps/srvr/src/flexget.js` (`/api/flexget-history` `:1727`, `/api/flexget-status` `:1780`) | `fs.watch` on `flexget-history.json` + status transitions |
| `badGroups` | #9 | `apps/srvr/src/badGroups.js` (`/api/getBadGroups`, `index.js:1315`) | on bad-groups list mutation |
| `fixLog` | #10 | `apps/srvr/src/fix.js` / `fix-runner.js` (`handleFix`) | **stream**: append per ffmpeg line |

`flexget` combines history + status into one channel payload `{history, status}`
(they are always consumed together in `flex.vue`).

### 4.2 tv-api-owned channels (new peer link from `apps/api`)

| channel | replaces | handler today | change signal |
|---|---|---|---|
| `qbtInfo` | #2 + #7 | `GET /api/qbt/info` (`server.js:809`) | internal poll of qBittorrent + diff |
| `browseHasMore` | #4 | `GET /api/hasBrowseShow` (`server.js:2214`, `hasBrowseShow()` in `browse.js:324`) | on browse candidate set change; else internal poll + diff |

**Consolidation decision (qbt):** #2 (App.vue active indicator) and #7 (qbt pane)
both derive from qBittorrent state. Use **one `qbtInfo` channel**; App.vue
derives its boolean (`recomputeDownActive`) from the same snapshot/delta the qbt
pane uses. The broker ref-count means the single internal poll runs whenever
either subscriber is present. (Alternative: a lightweight `qbtActive` boolean
channel for App.vue — only if the full payload proves too heavy to push at
App-lifetime scope. Flagged as an ambiguity, §7.)

### 4.3 tv-down-owned channels (new peer link from `apps/down`)

| channel | replaces | handler today | change signal |
|---|---|---|---|
| `downloads` | #5 | `pathname === "/downloads"` (`down/src/main.js:600`) | on job row insert/update in the down worker (`tvJson.js`) |
| `movieDownloads` | #6 | `pathname === "/movieDownloads"` (`down/src/main.js:981`) | on movie-rsync job status change |

`apps/down` uses a **raw http server** (pathname switch), not express — the
`ChannelPeer` helper is transport-independent (it's a WS client), so this is not
a blocker, but the peer link is added alongside the existing http server, which
stays for now.

The **`cycle-started` fast-poll window disappears** — with push, the server
emits a delta the instant a job changes, so the 1s/5s/30s window logic in
`down.vue` (`scheduleNextPoll`) is removed. `App.vue`'s `recomputeDownActive`
should consume the `downloads`/`qbtInfo` channels instead of its own qbt poll.

### 4.4 tv-tv-owned channels (new peer link from `apps/tv`)

| channel | replaces | handler today | change signal |
|---|---|---|---|
| `tvPicture` | #11 | `GET /tv/picture` (`tv/src/main.js:1939`) | internal poll of TV + diff |
| `embyPlaying` | #12 | `GET /tv/emby/playing` (`tv/src/main.js:1598`, already cached) | internal poll of Emby sessions + diff |

`embyPlaying` already has a server-side cache to avoid hammering Emby — the
channel's internal poll should reuse/replace that cache and diff against it.

### 4.5 Channel type reference

| type | snapshot-on-open | update payload | dedup | used by |
|---|---|---|---|---|
| `state` | full current value | full new value (or field delta) | yes (source diffs) | all except fixLog |
| `stream` | current buffer or `sinceOffset` | appended items only | n/a (every item new) | `fixLog` (and later `asr-log`) |

The `stream` snapshot generalizes `local.vue`'s existing
`syncFixLog({action:"tail", offset})` backfill — the source sends the log from a
cursor on open, then appends.

---

## 5. Per-view client changes

For every state channel the pattern is identical — remove the timer, open on the
existing start condition, close on the existing stop condition, render on
snapshot/delta:

```js
// BEFORE (example: tor.vue badGroups)
this._badGroupsPollTimer = setInterval(() => this.refreshBadGroups(), 3000);
// AFTER
this._badGroups = openChannel("badGroups", {
  onSnapshot: (list) => { this.badGroups = new Set(list); },
  onDelta:    (list) => { this.badGroups = new Set(list); },
});
// on stop:
this._badGroups.close();
```

| view / file | open at | close at | channel(s) |
|---|---|---|---|
| `srvr.js` | app load (module scope) | app teardown (`import.meta.hot` dispose) | `lastViewed` |
| `App.vue` | `mounted()` | `unmounted()` | `qbtInfo`, `chksrt`, `browseHasMore` |
| `down.vue` | `mounted()` (boot) | `unmounted()`; movie: `movieMode` watcher | `downloads`, `movieDownloads` |
| `qbt.vue` | `onPaneChanged('qbt')` / mounted | pane change away / `unmounted()` | `qbtInfo` |
| `flex.vue` | `onPaneChanged('flex')` | pane change away / `unmounted()` | `flexget` |
| `tor.vue` | `mounted()` | `unmounted()` | `badGroups` |
| `local.vue` | fix job start | fix close/kill | `fixLog` (stream) |
| `tvpane.vue` | `openPicCtrl()` / `openSubCtrl()` | `closePicCtrl()` / `subClose()` | `tvPicture`, `embyPlaying` |

**Android parity:** none of these 12 are UI; the tvpane sub/picture controls
have Android equivalents but the polling logic there is separate. Per
`CLAUDE.md`, verify whether the Android app mirrors tvpane's picture/subtitle
polling and, if so, apply the same channel conversion there. (Flag: confirm
before touching Android — see §7.)

---

## 6. Unifying existing pushes (do AFTER the pollers are proven)

Once the facility is proven on the pollers:

- **State-style notifications** (`embyText`, `libraryProgress`,
  `asr-queue-update`, `subs-progress`, `setGlobalMessage`): migrate onto
  `state`/`stream` channels. They gain reconnect re-sync for free (today they are
  silently lost across a reconnect gap). `activeServerMessages` replay becomes a
  normal snapshot-on-subscribe.
- **`asr-log` / `fix-log`**: fold into `stream` channels (fixLog is already
  planned as one in §4.1).
- **Keep the RPC path separate.** The `fCall`/`httpCall` id-matched request/reply
  (`srvr.js:197`) is a different primitive; do not force it into channels.

This phase is lower risk-adjusted value than killing the polling, so it follows,
never leads.

---

## 7. Ambiguities, contradictions, impossibilities

1. **"srvr would not look at the data" — partial contradiction.** The broker
   must be opaque to **payloads** but cannot be opaque to the **control plane**:
   it reads channel names, `sub`/`unsub`, routing, and generates
   `snapshot-request` nudges. Resolution: opaque payload, transparent envelope.
   This is stated as fact in §3.2/§3.4; calling out here because the phrasing in
   the request implies more opaqueness than is achievable.

2. **Polling does not fully disappear — it relocates.** qBittorrent, TV picture,
   and Emby `playing` have no change event, so the owning process must still
   poll and diff. "Zero polling" is impossible for those; "one server-side poll
   instead of N browser polls, quiet wire when unchanged" is what's achievable.

3. **qbt channel granularity (open decision).** One `qbtInfo` channel shared by
   App.vue's active indicator and the qbt pane, vs. a separate lightweight
   `qbtActive` boolean channel. Recommend one channel (§4.2); needs confirmation
   because App.vue subscribes for the whole app lifetime and the full qbt payload
   may be larger than the boolean it needs. **Decision required.**

4. **`lastViewed` is app-global, not view-scoped.** It is a cache read by many
   components, not tied to a pane. Model it as a channel subscribed at app load
   and closed at app teardown (always-on while the app is open). No ref-count
   subtlety, but note it never benefits from open/close savings.

5. **Two-legged reconnect is the main new failure surface.** A `tv-srvr` restart
   drops every browser AND every peer link at once; all channels go dark until
   peers re-dial and browsers re-subscribe. Correctness depends entirely on
   snapshot-on-resubscribe being right on both legs (§3.6). This is the highest-risk
   part of the implementation and must be tested explicitly (kill/restart
   `tv-srvr`, kill/restart a peer, drop the browser socket).

6. **`tv-down` is not express.** Its raw-http pathname switch means the peer link
   is added as a separate WS client, not an express route. Not a blocker, but the
   implementer must not assume express middleware in `apps/down`.

7. **Android parity is unconfirmed.** `CLAUDE.md` requires mirroring tvpane UI
   changes to Android, but these are data-fetch changes, not UI. Whether the
   Android app polls TV picture/subtitle state independently must be checked
   before deciding if channels #11/#12 need an Android counterpart. **Do not
   touch Android without confirming.**

8. **Source-not-connected policy (must define).** When a browser subscribes to a
   channel whose owning peer is down (booting/crashed), the broker must either
   queue the subscription and snapshot once the peer registers, or reply
   `unavailable`. Recommend: reply `unavailable`, keep the subscription pending,
   and snapshot on peer `register`. **Decision required.**

9. **One owner per channel.** The broker must reject a second peer `register`ing a
   channel another peer already owns, to keep routing unambiguous. Trivial but
   must be enforced.

10. **Effort/scope contradiction with prior guidance.** This is a substantially
    bigger change than a 1:1 poll→push rewrite. It is justified *because* there
    are 12 pollers sharing one lifecycle, but the plan deliberately front-loads
    one proof channel (§9) before committing to all 12.

---

## 8. Short (server↔server RPC) channels — scoped recommendation

Prior discussion concluded: **do not bulk-convert internal HTTP to WS-RPC.**
Reasons: internal calls are same-host (negligible latency); HTTP already gives
timeouts, retries, isolation, and `curl`-ability for free; folding RPC onto the
push socket introduces head-of-line blocking and hand-rolled orphaned-call
handling. Note the client already has `rejectAllPending` (`srvr.js:136`), but the
new peer legs would each need the equivalent.

Adopt short channels **only** where the push nature earns its keep:
- **peer → srvr, unsolicited** (a task must *notify* srvr on its own, which HTTP
  can't do without srvr exposing an inbound endpoint). Use the same backend WS.
- **srvr → peer request/reply**: leave on HTTP.

Requirement if implemented: every short-channel call gets a timeout, and on
peer-socket drop the broker rejects all pending calls for that peer. Reuse the
`calls[]`/`rejectAllPending` shape already in `srvr.js`.

---

## 9. Recommended implementation sequence

1. **Build the facility end-to-end on ONE channel first: `badGroups`.**
   - srvr-owned (no peer link needed), simple data (a `Set`), clear change
     signal, single subscriber (`tor.vue`). Proves: client `ChannelManager`,
     broker sub table + fan-out + ref-count, snapshot-on-open, delta-on-change,
     and browser-leg reconnect — without the peer-link complexity.
2. **Add the peer link on ONE peer: `tv-api` `qbtInfo`.** Proves the
   `ChannelPeer` helper, `register`, two-leg ref-count, peer reconnect, and the
   internal-poll-with-diff pattern. Land `@tv/share` `ChannelPeer` here.
3. **Roll out the remaining srvr channels** (`lastViewed`, `chksrt`, `flexget`,
   `fixLog` as the first stream channel).
4. **Roll out `tv-down`** (`downloads`, `movieDownloads`); remove the
   `cycle-started` fast-poll window; rewire `App.vue` `recomputeDownActive`.
5. **Roll out `tv-tv`** (`tvPicture`, `embyPlaying`); confirm Android parity
   first.
6. **Phase 2 (optional): unify existing pushes** (§6).
7. **Phase 3 (optional, scoped): short channels** (§8) only where peer→srvr
   unsolicited push is needed.

Deployment note (per `CLAUDE.md`): each phase touches specific servers — deploy
only those (`./srvr srvr`, `./srvr api`, `./srvr down`, `./srvr tv`); the client
is served by vite. After each pm2 restart, check `pm2 logs` for crash/restart
loops. Add all new logging via `logHere(...)` placeholders, never hand-written
`unilog`.

---

## 10. Suggestions

- **Put the shared framing in `@tv/share`** (`packages/share`) — one
  `ChannelPeer` (peer side) and one message-envelope/const module used by srvr,
  api, down, tv, and the client, so framing can't drift between processes.
- **Add a `channels` debug view** (or extend the existing `log` pane) showing
  open channels, subscriber counts, and last-snapshot time — the broker's
  subscription table is the natural source, and it makes the two-legged reconnect
  debuggable without `curl`.
- **Keep the old HTTP endpoints alive during migration.** Convert one consumer at
  a time; the REST handlers (`/downloads`, `/api/qbt/info`, etc.) can stay until
  every consumer is on channels, giving a clean rollback per channel.
- **Prove reconnect explicitly** with a test matrix: browser socket drop, peer
  socket drop, srvr restart, peer restart — each must end with correct, current
  data in every open view (this is the failure mode most likely to ship broken).
- **Resist field-level deltas** until a specific channel's payload size/frequency
  demands it; whole-snapshot-on-change keeps the source and client simple and
  sidesteps a second snapshot/patch consistency problem.
```