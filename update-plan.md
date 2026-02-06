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

### 5.3 Keep noemby.json Separate (for now)

**Reason:** noEmby shows are temporary - they become regular shows when added to Emby
**Action:** Can merge later if desired, but not critical

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
- [ ] Phase 6: Update all client component field references
- [ ] Phase 6: Update filtering and sorting logic
- [ ] Phase 7: Test data integrity
- [ ] Phase 7: Test incremental updates
- [ ] Phase 7: Performance testing

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
