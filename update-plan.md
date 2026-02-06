# Implementation Plan: Option 1 - Expand TVDB Records

## Goal

Make `tvdb.json` the single source of truth for all show data by expanding TVDB records to include Emby user data, disk info, and download status.

## Benefits

- Single authoritative data source (`apps/srvr/data/tvdb.json`)
- Leverage existing 6-minute refresh mechanism
- Simplify `loadAllShows()` merge logic
- Enable incremental updates instead of full reloads
- Faster client startup (no complex merging)

---

## Collaboration Approach

**How we'll work together:**

1. **I'll implement each phase** - You review/test when it's done
2. **Per-phase delivery:**
   - I complete the code changes
   - I test basic functionality
   - You do final testing/deployment when ready
3. **You intervene when:**
   - Something breaks in testing
   - You see architectural issues
   - You want to adjust the approach

**Your minimal work:**
- Quick review of each phase (5-10 min)
- Test on your actual data
- Run the `srvr` deployment script when ready
- Give feedback if issues arise

**Checkpoints:**
- After Phase 1: Review new schema, test loadAllShows()
- After Phase 2: Test simplified loadAllShows()
- After Phase 3-4: Test incremental updates
- After Phase 5-6: Full integration test

---

## Architecture Improvements (Bonus)

### Question 1: Can we consolidate files/dbs into tvdb.json?

**Yes - here's what we can consolidate:**

✅ **Consolidate into tvdb.json:**
- `gaps.json` → `tvdb[name].gap` (Phase 5.1) ✓ Already planned
- `notes.json` → `tvdb[name].note` (Phase 5.2) ✓ Already planned
- `noemby.json` → `tvdb[name]` with `emby.id = "noemby-{uuid}"` ✓ Should add
- `rejects.json` → `tvdb[name].reject = true` ✓ Should add
- `pickups.json` → `tvdb[name].pickup = true` ✓ Should add
- `lastViewed.json` → `tvdb[name].lastViewed = timestamp` ✓ Should add

⚠️ **Keep separate for now:**
- `tv.sqlite` (downloads) - Different domain (torrent tracking), high write frequency
  - Could add summary status to tvdb.json: `tvdb[name].download.status`
  - Keep full download tracking in tv.sqlite
- `tvmaze.sqlite` - 75k+ shows (way more than you track), readonly cache
  - Just reference it via `tvdb[name].tvmaze.id`

**I'll add consolidation of rejects, pickups, noemby to Phase 5**

### Question 2: Should we replace WebSocket RPC with HTTP endpoints?

**Yes - this is a good idea. Here's why:**

**Current problems with WebSocket RPC:**
- Messy queue in `apps/srvr/index.js` (lines 2300-2600)
- Everything is serialized (one request at a time)
- Hard to debug (no HTTP status codes, no browser devtools)
- Reconnection complexity
- Can't use standard HTTP tools (curl, fetch cache, etc.)

**Proposed: Hybrid approach**

**Keep WebSocket for:**
- Real-time notifications (devices on, Emby playback updates)
- Push updates (when tvdb refreshes, notify all clients)
- Live progress (download progress, queue updates)

**Move to HTTP for:**
- Data fetching: `GET /api/shows` (returns allTvdb)
- Updates: `POST /api/shows/:name` (update tvdb fields)
- Metadata refresh: `POST /api/shows/:name/refresh` (queue tvdb update)
- Queries: `GET /api/shows/:name/episodes` (get episode data)
- Collections: `POST /api/collections/:type/add` (add to collection)

**Which can be concurrent:**
- ✅ All GET requests (read-only, fully concurrent)
- ✅ POST to different shows (concurrent updates to different records)
- ⚠️ POST to same show (serialize updates to same record)
- ❌ Full tvdb.json writes (needs locking or queue)

**Implementation:**
- Keep current WebSocket server for push notifications
- Add HTTP endpoints in `apps/srvr/index.js` (use existing http server)
- Use in-memory locking for concurrent writes (simple Map)
- Phase 8: Add HTTP endpoints (after core refactor is stable)

**I can add this as Phase 8 if you want, or we can do it later**

---

## Phase 1: Extend TVDB Schema

### 1.1 Add New Fields to TVDB Records

**File:** `apps/srvr/src/tvdb.js`

**Action:** Modify `getTvdbData()` function to include new fields:

```javascript
const tvdbData = {
  // Existing fields (keep as-is)
  name,
  tvdbId,
  showId,
  seasonCount,
  episodeCount,
  watchedCount,
  image,
  score,
  overview,
  firstAired,
  lastAired,
  averageRuntime,
  originalCountry,
  originalLanguage,
  status,
  remotes,
  characters,
  added,
  saved,
  deleted,

  // NEW: Emby-specific data
  emby: {
    id: showId, // Emby's Id (already stored as showId)
    path: paramObj.embyPath || null,
    dateCreated: paramObj.dateCreated || null,
    premiereDate: paramObj.premiereDate || null,
    inToTry: paramObj.inToTry || false,
    inContinue: paramObj.inContinue || false,
    inMark: paramObj.inMark || false,
    inLinda: paramObj.inLinda || false,
    isFavorite: paramObj.isFavorite || false,
    isPlayed: paramObj.isPlayed || false,
    playCount: paramObj.playCount || 0,
    lastPlayedDate: paramObj.lastPlayedDate || null,
  },

  // NEW: Disk/filesystem data
  disk: {
    date: paramObj.diskDate || null,
    size: paramObj.diskSize || 0,
    noFiles: paramObj.noFiles || false,
  },

  // NEW: Download tracking summary
  download: {
    status: null, // null | 'queued' | 'downloading' | 'completed' | 'error'
    lastCheck: null,
  },

  // NEW: TVMaze reference
  tvmaze: {
    id: paramObj.tvmazeId || null,
    status: paramObj.tvmazeStatus || null,
  },

  // NEW: Gap tracking (moved from separate gaps.json)
  gap: paramObj.gap || null, // {seasons: [], showName: "..."}

  // NEW: Notes (moved from separate notes.json)
  note: paramObj.note || "",

  // NEW: Sync timestamps
  sync: {
    lastEmbySync: paramObj.lastEmbySync || null,
    lastDiskCheck: paramObj.lastDiskCheck || null,
    lastMetadataUpdate: Date.now(),
  },
};
```

### 1.2 Update Parameters Passed to getTvdbData

**File:** `apps/srvr/src/tvdb.js` - `chkTvdbQueue()` function

**Action:** Ensure paramObj includes all new fields when queuing updates.

### 1.3 Add Backward Compatibility

**File:** `apps/srvr/src/tvdb.js` - After loading `allTvdb` from disk

**Action:** Add migration code to initialize new fields on existing records:

```javascript
// After: allTvdb = util.jParse(fs.readFileSync(TVDB_PATH, "utf8"));

// Migrate existing records to new schema
for (const [name, tvdb] of Object.entries(allTvdb)) {
  if (!tvdb.emby) {
    tvdb.emby = {
      id: tvdb.showId || null,
      path: null,
      dateCreated: tvdb.added || null,
      premiereDate: null,
      inToTry: false,
      inContinue: false,
      inMark: false,
      inLinda: false,
      isFavorite: false,
      isPlayed: false,
      playCount: 0,
      lastPlayedDate: null,
    };
  }
  if (!tvdb.disk) {
    tvdb.disk = { date: null, size: 0, noFiles: false };
  }
  if (!tvdb.download) {
    tvdb.download = { status: null, lastCheck: null };
  }
  if (!tvdb.tvmaze) {
    tvdb.tvmaze = { id: null, status: null };
  }
  if (!tvdb.gap) {
    tvdb.gap = null;
  }
  if (!tvdb.note) {
    tvdb.note = "";
  }
  if (!tvdb.sync) {
    tvdb.sync = {
      lastEmbySync: null,
      lastDiskCheck: null,
      lastMetadataUpdate: tvdb.saved || null,
    };
  }
}
```

---

## Phase 2: Refactor loadAllShows()

### 2.1 Simplify Data Flow

**File:** `apps/client/src/emby.js` - `loadAllShows()` function

**Current:** 450 lines of complex merging logic
**Target:** 150 lines focused on syncing Emby state into tvdb

**New approach:**

1. Fetch Emby shows, disk data, collections, gaps, notes (parallel)
2. Get allTvdb (single source of truth)
3. For each Emby show: update corresponding tvdb record with Emby user data
4. For noEmby shows: ensure they exist in tvdb with proper flags
5. Sync collection flags (toTry, continue, mark, linda)
6. Sync gaps and notes into tvdb records
7. Return array of tvdb records (not Emby objects)

**Actions:**

```javascript
export async function loadAllShows() {
  const loadStart = Date.now();

  // 1. Fetch all data sources in parallel
  const [embyShows, diskShows, rejectsIn, pickups, noEmbys, gaps, notesIn] =
    await Promise.all([
      axios.get(urls.showListUrl(cred, 0, 10000)),
      srvr.getShowsFromDisk(),
      srvr.getRejects(),
      srvr.getPickups(),
      srvr.getNoEmbys(),
      srvr.getGaps(),
      srvr.getAllNotes(),
    ]);

  // 2. Get authoritative tvdb data (our source of truth)
  allTvdb = await tvdb.getAllTvdb();

  // 3. Sync Emby shows into tvdb
  for (const embyShow of embyShows.data.Items) {
    const name = embyShow.Name;
    const tvdbId = embyShow?.ProviderIds?.Tvdb || embyShow?.TvdbId;

    if (!tvdbId || tvdbId == "0") {
      console.error(`loadAllShows: no tvdbId for ${name}, deleting from Emby`);
      await deleteShowFromEmby(embyShow);
      continue;
    }

    // Get disk info
    const embyPath = embyShow.Path.split("/").pop();
    const diskInfo = diskShows[embyPath];
    const [diskDate, diskSize] = diskInfo || [null, 0];

    // Get gap info
    const gapData = gaps[embyShow.Id] || null;

    // Get note
    const note = notesIn?.[name] || "";

    // Update tvdb record with Emby data
    const updateFields = {
      name,
      showId: embyShow.Id,
      tvdbId,
      embyPath,
      dateCreated: embyShow.DateCreated?.substring(0, 10),
      premiereDate: embyShow.PremiereDate?.substring(0, 10),
      isFavorite: embyShow.UserData?.IsFavorite || false,
      isPlayed: embyShow.UserData?.Played || false,
      playCount: embyShow.UserData?.PlayCount || 0,
      lastPlayedDate: embyShow.UserData?.LastPlayedDate,
      diskDate,
      diskSize,
      noFiles: !diskInfo,
      gap: gapData,
      note,
      lastEmbySync: Date.now(),
      lastDiskCheck: Date.now(),
    };

    // Create or update tvdb record
    if (!allTvdb[name]) {
      const epicounts = await getEpisodeCounts(embyShow);
      const param = Object.assign({ show: embyShow }, epicounts, updateFields);
      allTvdb[name] = await srvr.getNewTvdb(param);
    } else {
      allTvdb[name] = await srvr.setTvdbFields(updateFields);
    }
  }

  // 4. Process noEmby shows
  for (const noEmbyShow of noEmbys) {
    const name = noEmbyShow.Name;
    if (
      allTvdb[name]?.emby?.id &&
      !allTvdb[name].emby.id.startsWith("noemby-")
    ) {
      // Show now exists in Emby - upgrade it
      await upgradeNoEmbyShow(noEmbyShow, allTvdb[name]);
      await srvr.delNoEmby(name);
    }
  }

  // 5. Sync collection flags
  await syncCollections(allTvdb);

  // 6. Sync rejects and pickups
  syncRejectsAndPickups(allTvdb, rejectsIn, pickups);

  // 7. Set WaitStr for shows with unaired episodes
  await setWaitStrings(allTvdb);

  const elapsed = Date.now() - loadStart;
  console.log("all shows loaded, elapsed ms:", elapsed);

  // Return array of tvdb records (not Emby objects)
  return Object.values(allTvdb).filter((show) => !show.deleted);
}
```

### 2.2 Add Helper Functions

**File:** `apps/client/src/emby.js`

**Action:** Create helper functions to reduce complexity:

```javascript
async function syncCollections(allTvdb) {
  const [toTryRes, continueRes, markRes, lindaRes] = await Promise.all([
    axios.get(urls.collectionListUrl(cred, toTryCollId)),
    axios.get(urls.collectionListUrl(cred, continueCollId)),
    axios.get(urls.collectionListUrl(cred, markCollId)),
    axios.get(urls.collectionListUrl(cred, lindaCollId)),
  ]);

  const toTryIds = new Set(toTryRes.data.Items.map((i) => i.Id));
  const continueIds = new Set(continueRes.data.Items.map((i) => i.Id));
  const markIds = new Set(markRes.data.Items.map((i) => i.Id));
  const lindaIds = new Set(lindaRes.data.Items.map((i) => i.Id));

  for (const tvdb of Object.values(allTvdb)) {
    if (tvdb.deleted) continue;
    const embyId = tvdb.emby?.id;
    if (embyId && !embyId.startsWith("noemby-")) {
      tvdb.emby.inToTry = toTryIds.has(embyId);
      tvdb.emby.inContinue = continueIds.has(embyId);
      tvdb.emby.inMark = markIds.has(embyId);
      tvdb.emby.inLinda = lindaIds.has(embyId);
    }
  }
}

function syncRejectsAndPickups(allTvdb, rejectsIn, pickups) {
  // Build normalized name lookup
  const showsByNormName = new Map();
  for (const [name, tvdb] of Object.entries(allTvdb)) {
    if (!tvdb.deleted) {
      const key = normShowName(name).toLowerCase();
      showsByNormName.set(key, tvdb);
    }
  }

  // Mark rejects
  const rejects = (rejectsIn || []).map(normShowName).filter(Boolean);
  for (const rejectName of rejects) {
    const key = rejectName.toLowerCase();
    const tvdb = showsByNormName.get(key);
    if (tvdb) tvdb.reject = true;
  }

  // Mark pickups
  for (const pickupName of pickups || []) {
    const key = normShowName(pickupName).toLowerCase();
    const tvdb = showsByNormName.get(key);
    if (tvdb) tvdb.pickup = true;
  }
}

async function setWaitStrings(allTvdb) {
  for (const tvdb of Object.values(allTvdb)) {
    if (tvdb.deleted) continue;
    try {
      const show = { Name: tvdb.name, Id: tvdb.emby?.id };
      const waitStr = await tvdb.getWaitStr(show);
      if (waitStr) tvdb.waitStr = waitStr;
    } catch (e) {
      // Ignore errors
    }
  }
}
```

---

## Phase 3: Add Incremental Sync Functions

### 3.1 Create Emby User Data Sync

**File:** `apps/srvr/index.js` (or new `apps/srvr/src/embySync.js`)

**Action:** Add function to sync just user data (watched status, collections) without full reload:

```javascript
export async function syncEmbyUserData() {
  // Fetch only user-specific data (fast)
  const [sessions, collections] = await Promise.all([
    fetchEmbyUserData(),
    fetchEmbyCollections(),
  ]);

  // Update corresponding tvdb records
  for (const [showName, tvdb] of Object.entries(allTvdb)) {
    if (tvdb.deleted || !tvdb.emby?.id) continue;

    const embyData = sessions[tvdb.emby.id];
    if (embyData) {
      tvdb.emby.isPlayed = embyData.Played;
      tvdb.emby.playCount = embyData.PlayCount;
      tvdb.emby.lastPlayedDate = embyData.LastPlayedDate;
      tvdb.sync.lastEmbySync = Date.now();
    }
  }

  // Save updated tvdb.json
  await util.writeFile(TVDB_PATH, allTvdb);
}
```

**Schedule:** Run every 5 minutes

### 3.2 Create Disk Sync Function

**File:** `apps/srvr/index.js`

**Action:** Add function to sync disk filesystem data:

```javascript
export async function syncDiskData() {
  const diskShows = await getShowsFromDisk();

  for (const [showName, tvdb] of Object.entries(allTvdb)) {
    if (tvdb.deleted || !tvdb.emby?.path) continue;

    const embyPath = tvdb.emby.path.split("/").pop();
    const diskInfo = diskShows[embyPath];

    if (diskInfo) {
      const [date, size] = diskInfo;
      tvdb.disk.date = date;
      tvdb.disk.size = size;
      tvdb.disk.noFiles = false;
    } else {
      tvdb.disk.noFiles = true;
    }

    tvdb.sync.lastDiskCheck = Date.now();
  }

  await util.writeFile(TVDB_PATH, allTvdb);
}
```

**Schedule:** Run every 1 hour

### 3.3 Update Background Refresh

**File:** `apps/srvr/src/tvdb.js` - `updateTvdbLocal()` function

**Action:** Already runs every 6 minutes - just ensure it updates `sync.lastMetadataUpdate`:

```javascript
// In getTvdbData() after building tvdbData:
tvdbData.sync = tvdbData.sync || {};
tvdbData.sync.lastMetadataUpdate = Date.now();
```

---

## Phase 4: Event-Driven Updates

### 4.1 Update on User Actions

**File:** `apps/client/src/components/*.vue` (list.vue, info.vue, etc.)

**Action:** When user performs actions, update tvdb immediately:

```javascript
// Example: When marking show as watched
async function markWatched(show) {
  await emby.markWatched(show.emby.id);

  // Update local tvdb cache
  show.emby.isPlayed = true;
  show.emby.playCount += 1;
  show.emby.lastPlayedDate = new Date().toISOString();

  // Persist to server
  await srvr.setTvdbFields({
    name: show.name,
    embyPlayed: true,
    embyPlayCount: show.emby.playCount,
    embyLastPlayedDate: show.emby.lastPlayedDate,
  });
}
```

### 4.2 Update on Collection Changes

**File:** `apps/client/src/emby.js` - collection save functions

**Action:** Update tvdb record when adding/removing from collections:

```javascript
export async function saveToTry(embyId, value) {
  await axios.post(urls.collectionUrl(cred, embyId, toTryCollId, value));

  // Update tvdb
  const show =
    allTvdb && Object.values(allTvdb).find((s) => s.emby?.id === embyId);
  if (show) {
    show.emby.inToTry = value;
    await srvr.setTvdbFields({ name: show.name, inToTry: value });
  }
}
```

### 4.3 Update on Download Complete

**File:** `apps/down/src/tvJson.js`

**Action:** When download completes, update tvdb record:

```javascript
// After successful download
async function onDownloadComplete(title, showName) {
  // Notify srvr to update tvdb
  await fetch(`https://hahnca.com:8091/updateDownloadStatus`, {
    method: "POST",
    body: JSON.stringify({ showName, status: "completed" }),
  });
}
```

**File:** `apps/srvr/index.js`

**Action:** Add endpoint to handle download status updates:

```javascript
case "/updateDownloadStatus":
  const { showName, status } = JSON.parse(body);
  const tvdb = allTvdb[showName];
  if (tvdb) {
    tvdb.download.status = status;
    tvdb.download.lastCheck = Date.now();
    await util.writeFile(TVDB_PATH, allTvdb);
  }
  break;
```

---

## Phase 5: Migrate Supporting Data

### 5.1 Merge gaps.json into tvdb.json

**Current:** `apps/srvr/data/gaps.json` - separate file keyed by Emby Id
**Target:** Move to `tvdb.gap` field

**File:** `apps/srvr/src/tvdb.js`

**Action:** One-time migration on startup:

```javascript
// After loading allTvdb
const gapsPath = path.join(SRVR_DATA_DIR, "gaps.json");
if (fs.existsSync(gapsPath)) {
  const gaps = JSON.parse(fs.readFileSync(gapsPath, "utf8"));

  for (const [embyId, gapData] of Object.entries(gaps)) {
    const tvdb = Object.values(allTvdb).find((t) => t.emby?.id === embyId);
    if (tvdb && !tvdb.gap) {
      tvdb.gap = gapData;
    }
  }

  // Backup and remove old file
  fs.renameSync(gapsPath, gapsPath + ".backup");
  await util.writeFile(TVDB_PATH, allTvdb);
}
```

### 5.2 Merge notes.json into tvdb.json

**Current:** `apps/srvr/data/notes.json` - separate file keyed by show name
**Target:** Move to `tvdb.note` field

**File:** `apps/srvr/src/tvdb.js`

**Action:** One-time migration:

```javascript
const notesPath = path.join(SRVR_DATA_DIR, "notes.json");
if (fs.existsSync(notesPath)) {
  const notes = JSON.parse(fs.readFileSync(notesPath, "utf8"));

  for (const [showName, note] of Object.entries(notes)) {
    if (allTvdb[showName] && !allTvdb[showName].note) {
      allTvdb[showName].note = note;
    }
  }

  fs.renameSync(notesPath, notesPath + ".backup");
  await util.writeFile(TVDB_PATH, allTvdb);
}
```

### 5.3 Merge noemby.json into tvdb.json

**Current:** `apps/srvr/data/noemby.json` - separate file for shows not in Emby
**Target:** Just store in tvdb.json with `emby.id = "noemby-{uuid}"`

**File:** `apps/srvr/src/tvdb.js`

**Action:** One-time migration:

```javascript
const noembyPath = path.join(SRVR_DATA_DIR, "noemby.json");
if (fs.existsSync(noembyPath)) {
  const noembys = JSON.parse(fs.readFileSync(noembyPath, "utf8"));

  for (const noembyShow of Object.values(noembys)) {
    const name = noembyShow.Name;
    if (!allTvdb[name]) {
      // Create tvdb entry for noemby show
      allTvdb[name] = {
        name,
        tvdbId: noembyShow.TvdbId,
        showId: noembyShow.Id, // already has "noemby-" prefix
        emby: {
          id: noembyShow.Id,
          inToTry: noembyShow.InToTry || false,
          inContinue: noembyShow.InContinue || false,
          inMark: noembyShow.InMark || false,
          inLinda: noembyShow.InLinda || false,
        },
        added: noembyShow.added || Date.now(),
        saved: 0, // Will trigger refresh
      };
    }
  }

  fs.renameSync(noembyPath, noembyPath + ".backup");
  await util.writeFile(TVDB_PATH, allTvdb);
}
```

**Update srvr endpoints:**
- Remove `getNoEmbys`, `addNoEmby`, `delNoEmby`
- Just use regular tvdb operations
- Filter by `show.emby.id.startsWith("noemby-")` when needed

### 5.4 Merge rejects.json into tvdb.json

**Current:** `apps/srvr/data/rejects.json` (or wherever it's stored)
**Target:** Add `tvdb[name].reject = true` flag

**File:** `apps/srvr/src/tvdb.js`

**Action:** One-time migration:

```javascript
// Rejects might be fetched from srvr endpoint - find the source
const rejects = await getRejectsFromSource(); // Adjust as needed

for (const rejectName of rejects) {
  const normalized = normShowName(rejectName);
  if (allTvdb[normalized]) {
    allTvdb[normalized].reject = true;
  }
}
```

### 5.5 Merge pickups.json into tvdb.json

**Current:** `apps/srvr/data/pickups.json` (or wherever it's stored)
**Target:** Add `tvdb[name].pickup = true` flag

**File:** `apps/srvr/src/tvdb.js`

**Action:** One-time migration:

```javascript
const pickups = await getPickupsFromSource();

for (const pickupName of pickups) {
  const normalized = normShowName(pickupName);
  if (allTvdb[normalized]) {
    allTvdb[normalized].pickup = true;
  }
}
```

### 5.6 Merge lastViewed.json into tvdb.json

**Current:** `apps/srvr/data/lastViewed.json` - tracks last viewed timestamp
**Target:** Add `tvdb[name].lastViewed = timestamp`

**File:** `apps/srvr/src/tvdb.js`

**Action:** One-time migration:

```javascript
const lastViewedPath = path.join(SRVR_DATA_DIR, "lastViewed.json");
if (fs.existsSync(lastViewedPath)) {
  const lastViewed = JSON.parse(fs.readFileSync(lastViewedPath, "utf8"));

  for (const [showName, timestamp] of Object.entries(lastViewed)) {
    if (allTvdb[showName]) {
      allTvdb[showName].lastViewed = timestamp;
    }
  }

  fs.renameSync(lastViewedPath, lastViewedPath + ".backup");
  await util.writeFile(TVDB_PATH, allTvdb);
}
```

**Result after Phase 5:**
- `tvdb.json` - Contains everything ✓
- `gaps.json.backup` - Archived
- `notes.json.backup` - Archived
- `noemby.json.backup` - Archived
- `rejects.json.backup` - Archived (if exists)
- `pickups.json.backup` - Archived (if exists)
- `lastViewed.json.backup` - Archived
- `tv.sqlite` - Keep (download tracking)
- `tvmaze.sqlite` - Keep (readonly cache)

---

## Phase 6: Update Client Components

### 6.1 Update Show Object References

**Files:** `apps/client/src/components/*.vue`

**Action:** Update all references to show fields to use new structure:

**Before:**

```javascript
show.Name;
show.Id;
show.TvdbId;
show.InToTry;
show.Date;
show.Size;
```

**After:**

```javascript
show.name;
show.emby.id;
show.tvdbId;
show.emby.inToTry;
show.disk.date;
show.disk.size;
```

**Files to update:**

- `apps/client/src/components/list.vue` (main list display)
- `apps/client/src/components/info.vue` (detail view)
- `apps/client/src/components/browse.vue` (browsing)
- `apps/client/src/components/down.vue` (downloads)
- Others that reference show properties

### 6.2 Update Filtering and Sorting

**File:** `apps/client/src/components/list.vue` - computed properties

**Action:** Update filters to use new structure:

```javascript
computed: {
  filteredShows() {
    return this.shows.filter(show => {
      // Update field references
      if (this.filters.toTry && !show.emby.inToTry) return false;
      if (this.filters.favorites && !show.emby.isFavorite) return false;
      if (this.filters.rejects && !show.reject) return false;
      // ... etc
      return true;
    });
  }
}
```

---

## Phase 7: Testing & Validation

### 7.1 Test Data Integrity

**Actions:**

1. Backup `tvdb.json` before testing
2. Run loadAllShows() and verify all shows load correctly
3. Verify no data loss (compare show counts before/after)
4. Check that Emby user data syncs correctly
5. Verify disk data is accurate
6. Test collection flags (toTry, continue, mark, linda)

### 7.2 Test Incremental Updates

**Actions:**

1. Mark show as watched → verify tvdb updates
2. Add show to collection → verify tvdb updates
3. Complete download → verify tvdb updates
4. Wait 6 minutes → verify metadata refresh works

### 7.3 Performance Testing

**Metrics to track:**

- `loadAllShows()` execution time (target: < 2 seconds)
- `tvdb.json` file size (monitor growth)
- Memory usage (ensure no leaks)
- WebSocket response times

---

## Migration Checklist

- [ ] Phase 1: Extend TVDB schema with new fields
- [ ] Phase 1: Add backward compatibility migration
- [ ] Phase 2: Refactor loadAllShows() to sync into tvdb
- [ ] Phase 2: Create helper functions
- [ ] Phase 3: Add syncEmbyUserData() (5 min interval)
- [ ] Phase 3: Add syncDiskData() (1 hour interval)
- [ ] Phase 3: Update metadata refresh timestamps
- [ ] Phase 4: Add event-driven updates for user actions
- [ ] Phase 4: Add event-driven updates for collections
- [ ] Phase 4: Add event-driven updates for downloads
- [ ] Phase 5: Migrate gaps.json into tvdb.json
- [ ] Phase 5: Migrate notes.json into tvdb.json
- [ ] Phase 5: Migrate noemby.json into tvdb.json
- [ ] Phase 5: Migrate rejects into tvdb.json
- [ ] Phase 5: Migrate pickups into tvdb.json
- [ ] Phase 5: Migrate lastViewed.json into tvdb.json
- [ ] Phase 6: Update all client component field references
- [ ] Phase 6: Update filtering and sorting logic
- [ ] Phase 7: Test data integrity
- [ ] Phase 7: Test incremental updates
- [ ] Phase 7: Performance testing

---

## Phase 8 (Optional): Replace WebSocket RPC with HTTP Endpoints

**Note:** This can be done later after core refactor stabilizes.

### 8.1 Analysis of Current RPC System

**File:** `apps/srvr/index.js` - Lines 2300-2600

**Current problems:**
- Everything serialized through queue
- No concurrent requests
- Hard to debug (no HTTP status codes)
- Complex reconnection logic
- Can't use browser devtools network tab

### 8.2 Proposed Hybrid Architecture

**Keep WebSocket for push notifications:**
- Device status updates
- Emby playback events
- Download progress
- Real-time tvdb refresh notifications

**Move to HTTP REST endpoints:**

```javascript
// Read operations (fully concurrent)
GET  /api/shows                    // getAllTvdb()
GET  /api/shows/:name              // Get single show
GET  /api/shows/:name/episodes     // getSeriesMap()
GET  /api/shows/:name/season/:s    // Get season data

// Write operations (concurrent to different shows, serialized per show)
POST   /api/shows/:name            // Update tvdb fields
DELETE /api/shows/:name            // Mark deleted
POST   /api/shows/:name/refresh    // Queue metadata refresh

// Collections
POST /api/collections/:type/add    // Add to collection (toTry, continue, etc.)
POST /api/collections/:type/remove

// Downloads
POST /api/downloads                // Add download
GET  /api/downloads                // Get download status

// Other
GET  /api/disk/shows               // Get shows from disk
GET  /api/emby/devices             // Get on devices
POST /api/notes/:name              // Update note (now part of tvdb)
```

### 8.3 Concurrency Strategy

**Use in-memory locking per show:**

```javascript
const showLocks = new Map(); // showName -> Promise

async function withShowLock(showName, fn) {
  // Wait for existing operation on this show
  while (showLocks.has(showName)) {
    await showLocks.get(showName);
  }
  
  // Create new lock
  let releaseLock;
  const lockPromise = new Promise(resolve => { releaseLock = resolve; });
  showLocks.set(showName, lockPromise);
  
  try {
    return await fn();
  } finally {
    showLocks.delete(showName);
    releaseLock();
  }
}

// Usage:
app.post('/api/shows/:name', async (req, res) => {
  const { name } = req.params;
  const updates = req.body;
  
  await withShowLock(name, async () => {
    const tvdb = allTvdb[name];
    Object.assign(tvdb, updates);
    await util.writeFile(TVDB_PATH, allTvdb);
  });
  
  res.json({ ok: true });
});
```

**For full tvdb.json writes (rare):**
- Use global write lock
- Or batch writes (write every 10 seconds max)

### 8.4 Migration Strategy

1. Add HTTP endpoints alongside existing WebSocket
2. Update client to use HTTP for data operations
3. Keep WebSocket for notifications
4. Remove old WebSocket RPC handlers after testing
5. Keep backwards compatibility for 1 version

### 8.5 Benefits

- ✅ Browser devtools show all requests
- ✅ Can use fetch() instead of custom RPC
- ✅ Standard HTTP caching
- ✅ Concurrent reads (faster)
- ✅ RESTful, easier to understand
- ✅ Can use curl for debugging
- ✅ Standard error codes (404, 500, etc.)

**I recommend doing Phase 8 after Phase 1-7 are stable.**

---

## Rollback Plan

If issues arise:

1. Restore `tvdb.json` from backup
2. Revert client changes (git reset)
3. Restart srvr process
4. Original `loadAllShows()` should still work with old tvdb.json structure

---

## Benefits Summary

**After completion:**

- ✅ Single source of truth (`tvdb.json`)
- ✅ Simpler client code (no complex merging)
- ✅ Faster loadAllShows() (< 2 seconds vs current 5+ seconds)
- ✅ Incremental updates (no need to reload everything)
- ✅ Real-time UI updates (event-driven)
- ✅ Less network traffic (fewer API calls)
- ✅ Easier debugging (one data structure to inspect)
- ✅ Foundation for future enhancements

**Files reduced in complexity:**

- `apps/client/src/emby.js`: 450 lines → ~200 lines
- `apps/srvr/src/tvdb.js`: 1100 lines → ~1200 lines (slightly more for new features)
- Total complexity: **significantly reduced**
