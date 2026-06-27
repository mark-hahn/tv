# Global Message Display — Implementation Plan

Plan for the feature described in `global-msg-instr.md`. **No code changes have been
made** — this document is the plan only.

---

## 1. Overview

Add a single full-width text row (`hdrMsg`) at the top of `list.vue`, above `HdrTop`,
that concatenates a set of "global messages". Each message is an object keyed by `id`,
stored in a reactive `Map`. Messages can be added/removed from anywhere in the client,
or pushed from the server over the existing websocket. A single function
`setGlobalMessage(msgObj)` is the entry point on both client and server.

---

## 2. Data model

### Message object

| key                  | type                 | default             | notes                                                       |
| -------------------- | -------------------- | ------------------- | ----------------------------------------------------------- |
| `id`                 | string               | (required)          | unique key; only one message per id                         |
| `action`             | `"show"` \| `"hide"` | `"show"`            | `hide` only needs `id`                                      |
| `text`               | string               | (required for show) | displayed text                                              |
| `position` (x-index) | integer              | `1e9`               | clamped via `Math.min(position, 1e9)`; lower = further left |
| `duration`           | number (secs)        | `0`                 | `0` = never auto-expire                                     |

### Internal stored fields (added automatically, not passed by caller)

- `timeAdded`: `Date.now()` recorded when the show call is made. Used as tie-breaker
  (oldest = leftmost) when two messages share the same `position`.
- (optional) `expireTimer`: handle for the `setTimeout` that auto-removes the message
  when `duration > 0`.

### Storage

- A reactive `Map<id, messageObj>` — proposed name `globalMessages`.
- Lives in a shared singleton module so it is reachable from anywhere in the client
  (see §4). Vue 3 `reactive(new Map())` works for reactivity in templates.

---

## 3. Rendering (`hdrMsg`)

- New `<div id="hdrMsg">` inserted **above** `<HdrTop>`, inside the `id="hdr"`
  container in `list.vue`.
- **Two insertion points** — `list.vue` renders `HdrTop` twice:
  - `apps/client/src/components/list.vue` ~L118 (simpleMode + wide landscape branch)
  - `apps/client/src/components/list.vue` ~L212 (default branch)
  - The `hdrMsg` div must be added in **both** places (or factored into a tiny child
    component used in both) so it shows regardless of layout branch.
- Full width of `list.vue` (`width: 100%`). Single line of text, no wrap
  (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`).
- **Computed text**: sort the Map's values by `position` ascending, tie-break by
  `timeAdded` ascending, then join each as `` `${id}: ${text}` `` with `, ` separators.
- When the Map is empty the row renders empty (proposal: collapse height to 0 so it
  takes no space — see Suggestions).

### Computed example (pseudo)

```js
globalMsgText() {
  return [...globalMessages.values()]
    .sort((a, b) => (a.position - b.position) || (a.timeAdded - b.timeAdded))
    .map(m => `${m.id}: ${m.text}`)
    .join(", ");
}
```

---

## 4. `setGlobalMessage` — client side

- New module, proposed `apps/client/src/globalMessages.js`, exporting:
  - `globalMessages` (the reactive Map)
  - `setGlobalMessage(msgObj)`
- `setGlobalMessage` logic:
  1. If `action === "hide"`: clear any `expireTimer`, `globalMessages.delete(id)`, return.
  2. Else (`show`, the default):
     - `position = Math.min(position ?? 1e9, 1e9)`.
     - `duration = duration ?? 0`.
     - `timeAdded`: if an entry with this `id` already exists, **decide whether to keep
       the original timeAdded or reset it** (ambiguity — see §7). Proposed: reset to
       `Date.now()` on each show, since the instruction says "show adds the message
       object … replaces any existing message object with same id".
     - Clear any prior `expireTimer` for that id.
     - Store the object in the Map (replacing existing id).
     - If `duration > 0`, set `expireTimer = setTimeout(() => globalMessages.delete(id), duration*1000)`.
- `list.vue` imports `globalMessages` and renders the computed text.

### Server-pushed messages → client

- The client websocket handler is in `apps/client/src/srvr.js` (`handleMsg`, ~L175),
  which emits server notifications onto the mitt event bus (`evtBus`).
- Server broadcasts via `notifyClients("setGlobalMessage", msgObj)`
  (`apps/srvr/index.js` `notifyClients`, ~L6912), arriving as
  `{ id: 0, notification: "setGlobalMessage", data: msgObj }`.
- In `srvr.js handleMsg`, the existing `id === 0 && notification` branch already does
  `evtBus.emit(notification, result)`. So add a bus listener that calls the client
  `setGlobalMessage(result)`.
  - Proposed: register `evtBus.on("setGlobalMessage", setGlobalMessage)` once in
    `globalMessages.js` (self-contained) **or** in `App.vue` `mounted()` with cleanup in
    `unmounted()`. Recommend doing it inside `globalMessages.js` so the wiring is
    centralized and there is exactly one listener.

---

## 5. `setGlobalMessage` — server side

- Add an exported `setGlobalMessage(msgObj)` in `apps/srvr/index.js` with the **same
  signature** as the client. Implementation simply broadcasts to clients:
  ```js
  export const setGlobalMessage = (msgObj) =>
    notifyClients("setGlobalMessage", msgObj);
  ```
- This lets any server code call `setGlobalMessage({ id, action, text, position, duration })`
  and have it appear on every connected client.
- **Note:** duration auto-expiry runs on the **client** timer (each client expires its
  own copy). The server need not track timers. (See §7 for a caveat.)

---

## 6. First message ids (wiring the initial producers)

To make these easy to find, proposal: tag every producing call site with a comment
`// GLOBAL-MSG: <Id>` so they can be grepped.

| id     | x-index | shown when                    | text                                  | source today                                                                                    |
| ------ | ------- | ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Lib`  | 0       | emby library being scanned    | scan percentage (e.g. `42%`)          | server `notifyClients("libraryProgress", {pct})` ~L8682; cleared on `libraryRefreshDone` ~L8704 |
| `Qbt`  | 10      | any qbt file active           | active qbt file count                 | client `qbt.vue` emits `activeQbtTitles` ~L714; App.vue `_downActiveQbt` ~L1879                 |
| `Down` | 11      | any Down file active          | active Down file count                | `apps/down` `inProgress` map (`tv-inProgress.json`) — **not currently pushed**                  |
| `Bif`  | 1000    | ffmpeg bif sidecar generating | show name cropped to 20 chars + `...` | server spawns `run-bif.js` ~L1018; lock written ~L1027, cleared in `onDone` ~L1036              |
| `CPU`  | 1001    | 1-min load ≥ 2                | cpu load                              | server `os.loadavg()[0]` (used ~L993, L1769); **no push today**                                 |

### Lib (x-index 0)

- Currently surfaced as `libraryProgressText` prop in `hdrtop.vue` (~L77-90), fed by
  App.vue handlers `handleLibraryProgress` / `handleSetLibraryProgress` /
  `handleLibraryRefreshDone` (~L1393-1415) reacting to `libraryProgress` /
  `libraryRefreshDone` bus events.
- **Change:** stop rendering the percentage span in `hdrtop.vue` ("not shown in hdrtop
  any more"), and instead, when progress updates, call
  `setGlobalMessage({ id: "Lib", text: "<pct>%", position: 0 })`; on
  `libraryRefreshDone` call `setGlobalMessage({ id: "Lib", action: "hide" })`.
- Cleanest spot: do it inside the existing App.vue handlers (they already receive the
  pct), or convert them to call `setGlobalMessage`. The `libraryProgressText` prop /
  span in `hdrtop.vue` can be removed.

### Qbt (x-index 10)

- App.vue already tracks active qbt via `_downActiveQbt` and qbt.vue emits active
  titles (`activeQbtTitles`, ~L714). Instruction wants a **count**.
- **Change:** where the active qbt list/count is known (App.vue handler for
  `activeQbtTitles`), call
  `setGlobalMessage({ id: "Qbt", text: String(count), position: 10 })` when count > 0,
  and `setGlobalMessage({ id: "Qbt", action: "hide" })` when count === 0.

### Down (x-index 11)

- `apps/down` tracks `inProgress` per cycle but does **not** push to clients today.
- **Change needed (new plumbing):** the down server (or srvr, if it can read the count)
  must emit the active Down count. Options:
  - (a) `apps/down` calls into srvr to broadcast, or writes a count that srvr reads and
    pushes; or
  - (b) srvr reads `apps/down/data/tv-inProgress.json` size on its existing poll loop and
    calls `setGlobalMessage` accordingly.
  - This is an open design choice (see §7 ambiguities). Proposed: srvr reads the
    inProgress count on a small interval and calls `setGlobalMessage({ id: "Down",
text: String(count), position: 11 })` / hide when 0. `down` and `srvr` are separate
    pm2 apps, so a shared file or an HTTP/ws hop is required.

### Bif (x-index 1000)

- Server spawns `run-bif.js` (~L1018) and writes `bifCreatingData.json` with showName
  (~L1027); clears it in `onDone` (~L1036).
- **Change:** at spawn, call `setGlobalMessage({ id: "Bif", text: crop(showName, 20),
position: 1000 })`; in `onDone`, call `setGlobalMessage({ id: "Bif", action: "hide" })`.
- `crop(name, 20)`: if `name.length > 20` → `name.slice(0, 20) + "..."` (see §7 re: "20
  chars width").

### CPU (x-index 1001)

- No push exists. `os.loadavg()[0]` is read in srvr.
- **Change (new plumbing):** add a small interval in srvr that reads `os.loadavg()[0]`;
  when `>= 2` call `setGlobalMessage({ id: "CPU", text: <load>, position: 1001 })`,
  else `setGlobalMessage({ id: "CPU", action: "hide" })`. Polling interval and load
  formatting need a decision (see §7).

---

## 7. Ambiguities / contradictions / open questions

1. **`timeAdded` on re-show of same id.** Spec says "time added should be stored when
   the call is made" and also "replaces any existing message object with same id." When a
   `show` arrives for an existing id, do we keep the original `timeAdded` (stable
   ordering) or reset it (latest wins → moves right among ties)? **Proposed: reset.**
   This matters for ids like `Lib`/`Qbt`/`CPU` that re-show frequently with updated text;
   resetting would constantly reshuffle ties. **Recommendation: actually keep original
   timeAdded if id already present**, to avoid jitter. Needs your call.

2. **x-index "like z-index but horizontal".** Interpreted as a sort key (lower =
   leftmost). The defined values (0,10,11,1000,1001) are sparse/non-sequential, matching
   "the values aren't sequential, just compared." Confirm this is purely an ordering key
   and not a literal column index.

3. **Empty row height.** Not specified whether an empty `hdrMsg` should occupy vertical
   space. Proposed: collapse to 0 height when empty so layout is unaffected.

4. **`Bif` "cropped to 20 chars width".** "chars width" is ambiguous — character count vs
   pixel width. Proposed: character count (`slice(0,20)+"..."`). Also unclear whether the
   20 includes the `...`. Proposed: 20 chars of name **then** append `...`.

5. **`CPU` text format & threshold cadence.** "cpu load" text format unspecified —
   `os.loadavg()[0]` is a float (e.g. `2.37`). Proposed: 1 decimal (`load.toFixed(1)`).
   Poll interval unspecified — proposed 5s. "only shown when load >= 2" implies hide when
   it drops below 2.

6. **`Down` and `CPU` require new server plumbing.** Neither is pushed today, and `down`
   is a **separate pm2 process** from `srvr`. Cross-process delivery (shared file poll,
   or down→srvr HTTP/ws) must be chosen. Proposed: srvr-side polling (reads
   `tv-inProgress.json` for Down; reads `os.loadavg` for CPU) so all producers live in
   srvr and reuse `notifyClients`.

7. **`Qbt`/`Down` counts source of truth.** qbt active state is currently computed
   **client-side** (qbt.vue polls qBittorrent). So `Qbt` is most naturally produced on the
   **client** (call `setGlobalMessage` locally — no ws needed). `Down`/`Lib`/`Bif`/`CPU`
   are server-side. Confirm it's fine that some producers are client-side and some
   server-side (both share the same `setGlobalMessage` signature, as the spec requires).

8. **Per-client duration timers.** With server push + client-side expiry, each client
   expires independently. Fine for the listed ids (none use duration), but worth noting
   for future duration-based messages: a late-connecting client won't see a message that
   already expired, and the remaining duration is not adjusted for connection time.

9. **Late-joining clients / state resync.** A client connecting mid-scan won't get the
   current `Lib`/`Bif`/etc. message until the next update. App.vue already calls
   `checkLibraryRefreshStatus()` on mount for Lib; the others have no resync. Proposed:
   acceptable for v1; could add an on-connect snapshot later.

---

## 8. Suggestions

- **Factor `hdrMsg` into a tiny `hdrmsg.vue` component** used in both `list.vue` HdrTop
  branches, so the row markup/logic isn't duplicated.
- **Centralize all server producers in srvr** (`Lib`, `Down`, `Bif`, `CPU`) and keep
  `Qbt` client-side, all calling the shared `setGlobalMessage`. Tag each call site with
  `// GLOBAL-MSG: <Id>` for grep-ability (satisfies "make it easy to find the calls").
- **Keep original `timeAdded` on re-show** (don't reset) to avoid horizontal jitter for
  frequently-updating ids.
- **Collapse empty row** to avoid a blank gray bar when no messages are active.
- **Android parity:** repo conventions say tv-pane UI changes should mirror in the
  Android app. `hdrMsg` is a list/header UI element — confirm whether the Android app
  needs the same global message row (likely yes if it shares the header).
- Consider a max-width / ellipsis strategy when many messages are active so the single
  line never pushes header controls.

---

## 9. File touch-list (for the eventual implementation, not done here)

- `apps/client/src/globalMessages.js` — **new**: reactive Map + `setGlobalMessage` +
  bus listener for server pushes.
- `apps/client/src/components/list.vue` — add `hdrMsg` row above both `HdrTop` usages;
  render concatenated text.
- `apps/client/src/components/hdrtop.vue` — remove the library percentage span and
  `libraryProgressText` prop.
- `apps/client/src/components/App.vue` — route `Lib` (library progress/done) and `Qbt`
  (active qbt count) into `setGlobalMessage`; remove `libraryProgressText` plumbing.
- `apps/client/src/srvr.js` — no change needed if the existing `id===0` bus emit is
  reused; otherwise add explicit `setGlobalMessage` handling.
- `apps/srvr/index.js` — export server `setGlobalMessage`; emit `Lib`, `Bif`; add `Down`
  - `CPU` pollers.
- `apps/down/*` (or srvr reading `tv-inProgress.json`) — surface active Down count.
- (optional) `apps/android/App.js` — mirror the header row if shared.
