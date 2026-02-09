# Background tvdb.json Refresh Processes

The server runs three independent background processes that continuously update tvdb.json with fresh data.

## 1. Metadata Refresh Loop (Every 6 Minutes)

**Location:** [apps/srvr/src/tvdb.js](apps/srvr/src/tvdb.js#L1260-L1266)

**Function:** `updateTvdbLocal()`

**Interval:** 6 minutes (360 seconds) in production, 30 seconds if `FAST_UPDATE=true`

**Purpose:** Continuously refresh TVDB metadata for all shows to keep remotes data current

### How It Works

1. **Find oldest show:** Scans all tvdb records to find the show with the oldest `saved` timestamp
2. **Queue update:** Adds that show to the `newTvdbQueue` for processing
3. **Fetch fresh data:** Calls `getTvdbData()` which:
   - Fetches latest metadata from TVDB API (genres, status, airDates, etc.)
   - Fetches Rotten Tomatoes scores via web scraping
   - Fetches TMDB data (ratings, images, etc.)
   - Updates the `saved` timestamp to current time
4. **Auto-pickup detection:** If the show is not in Emby (`Id` starts with 'noemby-'), it's automatically added to the pickups list
5. **Save and repeat:** Updates tvdb.json and schedules next refresh in 6 minutes

### What Gets Updated
- TVDB metadata (genres, status, overview, airDates, episodes list)
- Rotten Tomatoes ratings
- TMDB ratings and data
- Remote links (IMDB, TVDB, etc.)
- `saved` timestamp (marks when metadata was last refreshed)

### Code Flow
```javascript
const updateTvdbLocal = () => {
  if (UPDATE_DATA) tryLocalGetTvdb();
  const delay = FAST_UPDATE ? 30 * 1000 : 6 * 60 * 1000;
  setTimeout(updateTvdbLocal, delay);
};
updateTvdbLocal(); // Starts immediately on server startup
```

**Cycle Time:** With ~500 shows and 6-minute intervals, each show gets refreshed approximately every 50 hours (2 days).

---

## 2. Emby User Data Sync (Every 5 Minutes)

**Location:** [apps/srvr/index.js](apps/srvr/index.js#L2598-L2668)

**Function:** `syncEmbyUserData()`

**Interval:** 5 minutes (300 seconds)

**Initial Delay:** Starts 2 minutes after server startup

**Purpose:** Keep tvdb.json in sync with Emby user activity (watching episodes, marking favorites, etc.)

### How It Works

1. **Fetch from Emby:** Makes single API call to get all TV series with UserData:
   ```
   GET https://hahnca.com:8920/emby/Users/{userId}/Items
     ?IncludeItemTypes=Series
     &Recursive=true
     &Fields=UserData
     &Limit=10000
   ```

2. **Compare and update:** For each show in tvdb.json with `inEmby=true`:
   - Compares current UserData with tvdb record
   - If changed, updates the following flattened properties:
     - `Played` (has any episode been watched)
     - `PlayCount` (total plays across all episodes)
     - `IsFavorite` (favorite flag)
     - `LastPlayedDate` (when last watched)
     - `UnplayedItemCount` (number of unwatched episodes)

3. **Save if changed:** Only writes tvdb.json if at least one show changed

### Code Setup
```javascript
const EMBY_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(syncEmbyUserData, EMBY_SYNC_INTERVAL);
setTimeout(syncEmbyUserData, 2 * 60 * 1000); // 2 min startup delay
```

**Performance:** ~1 Emby API call, processes ~500 shows in <1 second

---

## 3. Disk Data Sync (Every 60 Minutes)

**Location:** [apps/srvr/index.js](apps/srvr/index.js#L2675-L2729)

**Function:** `syncDiskData()`

**Interval:** 60 minutes (1 hour)

**Initial Delay:** Starts 3 minutes after server startup

**Purpose:** Update tvdb.json with current filesystem metadata (file dates, sizes)

### How It Works

1. **Scan disk:** Calls `getShowsFromDisk()` which:
   - Runs `ls -lR` on the TV shows directory
   - Parses filesystem to get last modified date and total size for each show folder

2. **Compare and update:** For each show in tvdb.json with an `emby.path`:
   - Extracts folder name from path
   - Looks up current disk metadata
   - If changed, updates:
     - `disk.date` (last modified date)
     - `disk.size` (total size in bytes)
     - `disk.noFiles` (true if folder not found)
     - `sync.lastDiskCheck` (timestamp)

3. **Save if changed:** Only writes tvdb.json if at least one show changed

### Code Setup
```javascript
const DISK_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
setInterval(syncDiskData, DISK_SYNC_INTERVAL);
setTimeout(syncDiskData, 3 * 60 * 1000); // 3 min startup delay
```

**Performance:** Single disk scan, processes ~500 shows in ~2-5 seconds

---

## Summary Table

| Process | Interval | What It Updates | API Calls | Purpose |
|---------|----------|-----------------|-----------|---------|
| **Metadata Refresh** | 6 min | TVDB metadata, Rotten Tomatoes, TMDB data | TVDB API, Rotten Tomatoes scrape, TMDB API | Keep show metadata current |
| **Emby User Data Sync** | 5 min | Watch status, favorites, play counts | 1 Emby API call | Track user viewing activity |
| **Disk Data Sync** | 60 min | File dates, sizes, existence | 0 (filesystem only) | Monitor disk space usage |

## Combined Effect

These three processes work together to ensure tvdb.json is always current:
- **Metadata** stays fresh via periodic TVDB refreshes
- **User activity** reflects in real-time (5-min lag max)
- **Disk state** accurate within 1 hour
- Client apps receive updated data on next `loadAllShows()` call

All three processes write to tvdb.json independently and use file locking to prevent conflicts.
