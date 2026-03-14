# History Feature — Implementation Plan

## Overview

Track and display a timeline of major events for each show across all servers (srvr, api, down) and the client.

---

## 1. Database

### Location

`apps/srvr/data/history.sqlite`

### Schema

```sql
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tvdbId TEXT,                      -- NULL for shows not yet in tvdb.json
  showName TEXT NOT NULL,
  addTime INTEGER NOT NULL,         -- epoch ms
  updateTime INTEGER NOT NULL,      -- epoch ms, same as addTime initially
  updateCount INTEGER DEFAULT 0,
  description TEXT,
  type TEXT NOT NULL,
  hash TEXT,                        -- torrent info_hash, used by tor/qbt events
  fields TEXT                       -- JSON list of changed tvdb fields (bkgndUpdate only)
);

CREATE INDEX IF NOT EXISTS idx_history_tvdbId ON history(tvdbId);
CREATE INDEX IF NOT EXISTS idx_history_showName ON history(showName);
CREATE INDEX IF NOT EXISTS idx_history_type ON history(type);
CREATE INDEX IF NOT EXISTS idx_history_hash ON history(hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_history_dedup ON history(tvdbId, type)
  WHERE type IN ('chkDown','skipDown','rejDown','browse','preview');
```

Note: `bkgndUpdate` uses conditional dedup — only deduped when the changed fields
are the same as the previous event (see Dedup Logic below).

### Dedup Logic

For simple dedup types (`chkDown`, `skipDown`, `rejDown`, `browse`, `preview`), upsert:

```sql
INSERT INTO history (tvdbId, showName, addTime, updateTime, updateCount, description, type)
VALUES (?, ?, ?, ?, 0, ?, ?)
ON CONFLICT (tvdbId, type) WHERE type IN ('chkDown','skipDown','rejDown','browse','preview')
DO UPDATE SET
  updateTime = excluded.updateTime,
  updateCount = updateCount + 1,
  description = excluded.description;
```

For `bkgndUpdate`: conditional dedup in application code:

1. Query the latest `bkgndUpdate` event for the show
2. If the `fields` value matches the new event's fields → dedup (update time + count)
3. If `fields` differ or no previous event → INSERT new row
4. When no fields actually changed, `fields` is `null` and description is `"No fields changed"` — these are always deduped

For all other types, plain INSERT (each event creates a new row).

For tor/qbt events, the `hash` field is populated with the torrent info_hash.

### Show Removal

The instruction to remove history when a show is removed from tvdb.json is ignored per user direction.
History events are retained permanently.

### Dependency

Add `better-sqlite3` to `apps/srvr/package.json`.

### Initialization

New module `apps/srvr/src/history.js`:

- Opens DB with WAL mode, busy_timeout=5000 (same pattern as down's tvJson.js)
- Exports:
  - `addEvent({ tvdbId, showName, type, description, hash, fields })` — insert or upsert
  - `getEvents(tvdbId)` — get events by tvdbId
  - `getEventsByName(showName)` — get events by normalized showName where tvdbId is NULL
  - `getEventsByHash(hash)` — look up tor event by hash (for qbt event resolution)
- Prepares statements at init for insert, upsert, select, conditional-dedup query

---

## 2. API Endpoints on Srvr

### POST /api/history

Record a history event. Called by api server, down server, and client.

```json
{
  "tvdbId": "string | null",
  "showName": "string",
  "type": "string",
  "description": "string (optional)",
  "hash": "string (optional, for tor/qbt events)",
  "fields": "string (optional, JSON for bkgndUpdate)"
}
```

Returns `{ ok: true }`.

### GET /api/history?tvdbId=XXX&showName=YYY

Fetch all events for a show, ordered by time.

Query logic:

- If tvdbId is provided: return events matching tvdbId
- Also include events where tvdbId is NULL and normalized showName matches
- showName parameter used for the NULL-tvdbId lookup

Returns `{ events: [...] }`.

---

## 3. Event Sources by Server

### Client-side events → POST /api/history to srvr

| Event       | Location                           | Trigger                                                                             | Description Content                 |
| ----------- | ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| browse      | browse.vue `handleGallerySelect()` | Gallery image clicked (including auto-select of top image when Next loads new show) | Show name and source                |
| preview     | browse.vue `handlePreview()`       | Preview mode activated                                                              | Show name, tvdbId, overview snippet |
| addQbt      | qbt.vue `pollOnce()`               | New hash detected in poll                                                           | Torrent name, hash, state           |
| remQbt      | qbt.vue `pollOnce()`               | Hash disappeared from poll                                                          | Torrent name, hash, previous state  |
| qbtFinished | qbt.vue `pollOnce()`               | State changed to finished                                                           | Torrent name, hash, completion info |

**Show identification for qbt events**: The `hash` field links qbt events to tor events.

1. When `torSent` is recorded, the torrent info_hash is stored in the `hash` field along with tvdbId/showName
2. When a qbt event fires (addQbt, remQbt, qbtFinished), look up the hash in the history DB via `GET /api/history/byHash?hash=XXX`
3. If a matching `torSent` event is found, use its tvdbId and showName
4. If no match (torrent added outside the app), extract show name from the torrent/folder title and store with tvdbId=NULL

### Srvr-side events → direct call to history.js

| Event       | Location                                         | Trigger                | Description Content                                                                                                                                                                                                |
| ----------- | ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| addEmby     | index.js POST /api/addNoEmby or createShowFolder | Show added to Emby     | Show name, folder path                                                                                                                                                                                             |
| remEmby     | index.js DELETE /embyRemove                      | Show removed from Emby | Show name, emby Id                                                                                                                                                                                                 |
| bkgndUpdate | tvdb.js periodic update loop                     | Every cycle per show   | Changed fields diff (e.g., "watchGap: true→false") or "No fields changed". `fields` column stores JSON of changed field before/after values. Conditional dedup: only deduped when `fields` matches previous event. |

### Api-side events → POST /api/history to srvr

| Event     | Location                                       | Trigger                           | Description Content                       |
| --------- | ---------------------------------------------- | --------------------------------- | ----------------------------------------- |
| torSent   | server.js `handleDownloadRequest()`            | Torrent added to qbt successfully | Torrent filename, provider, size, seeds   |
| errTor    | server.js `handleDownloadRequest()` error path | qbt add failed                    | Error message, stage, torrent info        |
| forceDown | server.js POST /api/tvproc/forceDown           | Force down clicked                | Comma-separated list of forced file paths |

### Down-side events → POST /api/history to srvr

| Event      | Location                         | Trigger                   | Description Content                                                     |
| ---------- | -------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| chkDown    | main.js cycle start              | File found in USB listing | USB file path, parseTorrentTitle raw data, adjusted title               |
| skipDown   | main.js skip logic               | File silently skipped     | Skip reason (e.g., "already downloaded", "missing S/E info", "blocked") |
| rejDown    | main.js reject logic             | File explicitly rejected  | Rejection reason                                                        |
| acceptDown | main.js accept logic             | File queued for download  | Title, season, episode, USB path, local destination                     |
| startDown  | main.js/worker.js                | Worker spawned for rsync  | Title, procId, USB path, local path                                     |
| endDown    | worker.js rsync close (code 0)   | Rsync completed           | Title, final local path                                                 |
| errDown    | main.js error handler            | Error during cycle        | Error message, stage, filename                                          |
| errorSync  | worker.js rsync close (non-zero) | Rsync failed              | Error code, stderr summary, filename                                    |

### Cross-server HTTP call

Down and api servers call `https://hahnca.com/api/history` (srvr) to record events. Use a lightweight helper:

```js
async function postHistory(tvdbId, showName, type, description) {
  try {
    await fetch("https://hahnca.com/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tvdbId, showName, type, description }),
    });
  } catch (e) {
    // log but don't fail the main operation
  }
}
```

This helper goes in `packages/share/src/history.js` so all servers can import it.

---

## 4. Client UI

### History Button

- Location: [apps/client/src/components/map.vue](apps/client/src/components/map.vue) in the `mapbuttons` section, to the right of the → (right-arrow pan) button
- Appearance: Same styling as the ← → buttons (font-size: 15px, margin: 5px, max-height: 24px, border-radius: 7px)
- Label: `History`
- Toggle behavior: Clicking toggles `showHistory` boolean
- Active state: `--btn-bg: lightgray` when history pane is showing, `whitesmoke` otherwise

### History Pane

- New file: `apps/client/src/components/history.vue`
- Rendered inside map.vue, below the map header (#maphdr), covering the map table area
- When `showHistory` is true, history pane is shown and map table is hidden (v-show toggle)
- When `showHistory` is false, map table is visible and history pane is hidden

### Show Selection

- **Normal mode**: Selected show from list → use its tvdbId to fetch history
- **Preview mode**: Selected show from browse → use its tvdbId (or showName fallback)
- Emit `evtBus` event or pass as prop from map.vue parent

**Shows not in tvdb.json**: Events may have tvdbId=NULL (e.g., browse/preview of unknown shows). The GET endpoint includes events with matching normalized showName and NULL tvdbId. History cards for these events display the actual showName (since there's no tvdb record to reference).

### History Cards

Each card displays:

- **Type** badge (color-coded by event type category)
- **Time** (PST, format MM-DD HH:mm)
- **Show name**
- **Description** (if present)

### Deduped Event Display

When `updateCount > 0`, display the event as two cards in the timeline:

1. Card at `addTime` — shows initial event info
2. Card at `updateTime` — shows "Updated" label + `updateCount` times + latest description

Both cards sorted chronologically within the full event list.

### Card Sort

All cards sorted by time descending (newest first). Each deduped event contributes two sort keys (addTime and updateTime).

### Fetching

- On show selection change: `GET /api/history?tvdbId=XXX`
- Cache briefly to avoid redundant fetches during rapid selection changes

---

## 5. Implementation Phases

### Phase 1: Database & API (srvr)

1. Add `better-sqlite3` to `apps/srvr/package.json`
2. Create `apps/srvr/src/history.js` — DB init, prepared statements, exported functions
3. Add `POST /api/history` and `GET /api/history` routes to `apps/srvr/index.js`
4. Instrument srvr-side events (addEmby, remEmby, bkgndUpdate, reject, unreject, pickup, unpickup, deleteShow) with direct history.js calls

### Phase 2: Cross-server helper (share)

1. Create `packages/share/src/history.js` — `postHistory()` helper
2. Export from `packages/share/src/index.js`

### Phase 3: Down server instrumentation

1. Import `postHistory` from share package
2. Instrument: chkDown, skipDown, rejDown, acceptDown, startDown, endDown, errDown, errorSync
3. Each call is fire-and-forget (catch errors, don't block cycle)

### Phase 4: Api server instrumentation

1. Import `postHistory` from share package
2. Instrument: torSent (include hash), errTor (include hash), forceDown, search

### Phase 5: Client UI

1. Create `apps/client/src/components/history.vue`
2. Add History button to map.vue header (right of → button)
3. Add history pane rendering in map.vue (v-show toggle)
4. Implement card layout, sorting, dedup display
5. Wire up show selection (list mode vs preview mode)

### Phase 6: Client event instrumentation

1. Instrument browse, preview events in browse.vue → POST to srvr
2. Instrument addQbt, remQbt, qbtFinished in qbt.vue → POST to srvr (look up hash in history DB for show identification)

---

## 6. File Changes Summary

| File                                     | Change                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/srvr/package.json`                 | Add `better-sqlite3` dependency                                                                               |
| `apps/srvr/src/history.js`               | **New** — SQLite DB module                                                                                    |
| `apps/srvr/index.js`                     | Add POST/GET /api/history routes; instrument addEmby, remEmby, reject, unreject, pickup, unpickup, deleteShow |
| `apps/srvr/src/tvdb.js`                  | Instrument bkgndUpdate; hook show removal to delete history                                                   |
| `packages/share/src/history.js`          | **New** — postHistory() helper                                                                                |
| `packages/share/src/index.js`            | Export postHistory                                                                                            |
| `apps/down/src/main.js`                  | Instrument chkDown, skipDown, rejDown, acceptDown, errDown                                                    |
| `apps/down/src/worker.js`                | Instrument startDown, endDown, errorSync                                                                      |
| `apps/down/package.json`                 | Add share package dependency (if not already)                                                                 |
| `apps/api/src/server.js`                 | Instrument torSent (with hash), errTor (with hash), forceDown, search                                         |
| `apps/api/package.json`                  | Add share package dependency (if not already)                                                                 |
| `apps/client/src/components/history.vue` | **New** — History pane component                                                                              |
| `apps/client/src/components/map.vue`     | Add History button, toggle logic, render history.vue                                                          |
| `apps/client/src/components/browse.vue`  | Instrument browse, preview events                                                                             |
| `apps/client/src/components/qbt.vue`     | Instrument addQbt, remQbt, qbtFinished events                                                                 |

---

## 7. Complete Event Type Reference

| Type        | Category | Dedup       | Server      | Hash | Description                                         |
| ----------- | -------- | ----------- | ----------- | ---- | --------------------------------------------------- |
| browse      | user     | yes         | client→srvr | no   | Gallery image clicked                               |
| preview     | user     | yes         | client→srvr | no   | Preview mode activated                              |
| addEmby     | emby     | no          | srvr        | no   | Show added to Emby                                  |
| remEmby     | emby     | no          | srvr        | no   | Show removed from Emby                              |
| torSent     | torrent  | no          | api→srvr    | yes  | Torrent sent to qbt                                 |
| errTor      | torrent  | no          | api→srvr    | yes  | Error sending torrent                               |
| addQbt      | qbt      | no          | client→srvr | yes  | New torrent in qbt list                             |
| remQbt      | qbt      | no          | client→srvr | yes  | Torrent removed from qbt                            |
| qbtFinished | qbt      | no          | client→srvr | yes  | Torrent finished in qbt                             |
| forceDown   | download | no          | api→srvr    | no   | Force download clicked                              |
| chkDown     | download | yes         | down→srvr   | no   | File found in USB listing                           |
| skipDown    | download | yes         | down→srvr   | no   | File silently skipped                               |
| rejDown     | download | yes         | down→srvr   | no   | File explicitly rejected                            |
| acceptDown  | download | no          | down→srvr   | no   | File queued for download                            |
| startDown   | download | no          | down→srvr   | no   | Worker starts rsync                                 |
| endDown     | download | no          | down→srvr   | no   | Worker finishes rsync                               |
| errDown     | download | no          | down→srvr   | no   | Error in down cycle                                 |
| errorSync   | download | no          | down→srvr   | no   | Error during rsync                                  |
| bkgndUpdate | system   | conditional | srvr        | no   | Periodic tvdb update (dedup only when fields match) |
| reject      | user     | no          | srvr        | no   | Show added to reject list                           |
| unreject    | user     | no          | srvr        | no   | Show removed from reject list                       |
| pickup      | user     | no          | srvr        | no   | Show added to pickup list                           |
| unpickup    | user     | no          | srvr        | no   | Show removed from pickup list                       |
| search      | user     | no          | api→srvr    | no   | Torrent search performed                            |
| deleteShow  | user     | no          | srvr        | no   | Show fully removed                                  |

See questions below — these need answers before implementation begins.
