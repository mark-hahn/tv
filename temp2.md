# In-Memory Cache for getShowsFromDisk - Detailed Explanation

## Cache Architecture

### Server-Side Cache (Primary)

**Location:** `apps/srvr/index.js` (line 2841)

**Cache Variable:**

```javascript
let diskShowsCache = null;
```

This is a module-level variable that persists across requests for the lifetime of the Node.js process.

## Cache Loading Process

### 1. Initial State

Cache starts as `null` on server startup

### 2. First Request Flow

```javascript
const getShowsFromDisk = async (_params) => {
  if (diskShowsCache) return diskShowsCache;  // Cache hit - return immediately
  // ... cache miss - perform disk scan
```

When `diskShowsCache` is `null`, the function performs a full disk scan:

- **Walks the entire TV directory** (`/mnt/media/tv`) recursively using async I/O (`fsp.readdir`, `fsp.stat`)
- **For each show folder**, it:
  - Finds all video files (extensions: mp4, mkv, avi, etc.)
  - Extracts season/episode information using `parseFileSeasonEpisode()`
  - Determines video quality (resolution/bit depth)
  - Tracks file modification dates and total size
  - Builds an episode map: `{ season -> Set<episode> }`

- **Returns data structure:**

```javascript
shows[showFolderName] = [maxDate, totalSize, filesOnDisk, fileQuality];
```

Where:

- `maxDate`: Most recent file modification timestamp
- `totalSize`: Total bytes of all video files
- `filesOnDisk`: Array like `[[1, 1, 2, 3], [2, 1, 2, 3, 4]]` (season, episodes...)
- `fileQuality`: Map of episode keys to quality scores

### 3. Cache Storage

```javascript
diskShowsCache = shows;
return shows;
```

After the scan completes, the result is stored in `diskShowsCache` and returned.

### 4. Subsequent Requests

All subsequent calls to `getShowsFromDisk()` immediately return the cached value without touching the disk.

## Cache Updates

The cache is incrementally updated when video files are added or deleted. Instead of invalidating the entire cache, only the affected show's entry is refreshed.

### File Watcher Setup (line ~8047)

```javascript
const watcher = chokidar.watch(tvDir, {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100,
  },
});
```

### Invalidation Trigger (line 8066)

```javascript
watcher.on("add", async (filePath) => {
  console.log(`[chokidar] detected add: ${filePath}`);
  const ext = filePath.split(".").pop();
  if (!videoFileExtensions.includes(ext)) return;

  const showName = extractShowNameFromPath(filePath);
  if (!showName) return;

  console.log(`[chokidar] video added: ${showName}`);

  // Update only the affected show in cache instead of invalidating everything
  if (diskShowsCache) {
    try {
      const showInfo = await getShowDiskInfo(showName);
      if (showInfo) {
        diskShowsCache[showName] = showInfo;
        console.log(`[chokidar] updated cache for ${showName}`);
      }
    } catch (err) {
      console.error(
        `[chokidar] failed to update cache for ${showName}:`,
        err.message,
      );
      // On error, invalidate entire cache to be safe
      diskShowsCache = null;
    }
  }
  // ... trigger subtitle check and other processing
});
```

When a video file is added, the cache entry for that specific show is updated in milliseconds, keeping all other cached data intact.

## Cache Usage Patterns

### 1. Hourly Sync (`syncDiskData` - line 7495)

```javascript
async function syncDiskData() {
  const diskShows = await getShowsFromDisk({});
  // Updates tvdb records with fresh disk data
}
```

This runs every hour to update TVDB records with current disk information. After the first call, it uses the cached data unless invalidated.

### 2. Client-Side Usage (info.vue - line 1273)

```javascript
async recheckTwoLocalFolders() {
  cachedDiskShows = await srvr.getShowsFromDisk();
  const folderNames = Object.keys(cachedDiskShows || {});
  // Check if multiple folders match the show name
}
```

The client also maintains a simple cache (`cachedDiskShows`) at the component level to avoid repeated HTTP calls.

## Performance Characteristics

- **Cold cache (first load):** ~44 seconds to scan ~1,575 show folders (per temp.md documentation)
- **Warm cache (subsequent requests):** Instant return (< 1ms)
- **Incremental update (file add/delete):** Milliseconds to update single show
- **Cache lifetime:** Until server restarts (incremental updates keep it fresh)
- **Memory footprint:** Stores metadata for all shows in memory (dates, sizes, episode lists)

## Key Benefits

1. **Eliminates blocking:** Async I/O prevents event loop blocking
2. **Single scan:** Multiple concurrent requests during initial scan all wait for and share the same result
3. **Incremental updates:** File additions/deletions update only the affected show (milliseconds vs 44-second full rescan)
4. **Cache availability:** Cache remains usable during updates (no downtime)
5. **Hourly background sync:** Keeps TVDB records updated without user-initiated requests

## Cache Invalidation - Now Using Incremental Updates

**Updated Behavior (Current):**
When a video file is added or deleted, only that specific show's entry in the cache is updated using the `getShowDiskInfo(showFolderName)` function. This takes milliseconds instead of forcing a 44-second full rescan.

**Implementation:**

1. **On file add** (chokidar "add" event):

   ```javascript
   if (diskShowsCache) {
     const showInfo = await getShowDiskInfo(showName);
     if (showInfo) {
       diskShowsCache[showName] = showInfo;
       console.log(`[chokidar] updated cache for ${showName}`);
     }
   }
   ```

2. **On file delete** (chokidar "unlink" event → handleShowDiskChange):
   ```javascript
   const diskInfo = await getShowDiskInfo(showName);
   if (diskInfo) {
     if (diskShowsCache) {
       diskShowsCache[showName] = diskInfo;
     }
   } else {
     // Folder was deleted, remove from cache
     if (diskShowsCache && showName in diskShowsCache) {
       delete diskShowsCache[showName];
     }
   }
   ```

**Performance Improvement:**

- **Before:** 44 seconds to invalidate and rescan all ~1,575 shows
- **After:** Milliseconds to update just the affected show
- **Cache availability:** Cache remains available during updates (no downtime)
- **Data freshness:** Other shows' data stays fresh (not marked stale unnecessarily)

**Edge Cases Handled:**

- If `getShowDiskInfo()` fails for any reason, falls back to full cache invalidation
- If cache doesn't exist yet (`null`), allows normal first-scan behavior
- If a show folder is deleted entirely, removes that entry from cache

## Summary

The cache design balances freshness with performance by using an incremental update strategy. When video files are added or deleted, only the affected show's cache entry is updated (taking milliseconds) rather than invalidating the entire cache and forcing a 44-second full rescan. The in-memory cache persists for the entire server lifetime and stays fresh through targeted updates triggered by file system events.
