# Deployment Ready: Show Object Simplification

## Summary of Changes

Major refactoring to merge show objects into tvdb records, replace `deleted` property with `inEmby` boolean, and flatten all nested objects (emby/gap/disk/sync).

## Key Changes

1. **Property Structure**
   - Removed show object building layer
   - Tvdb records now have ALL properties flattened at top level
   - Replaced `deleted` date string with `inEmby` boolean flag
   - Replaced `Id.startsWith("noemby-")` checks with `inEmby === false` checks
   - Removed nested `emby`, `gap`, `disk`, and `sync` objects
   - Removed duplicate `show.name` property (using only `show.Name`)

2. **Data Flow**
   - `loadAllShows()` now returns tvdb records with flattened properties
   - Components access properties directly from tvdb records at top level
   - All properties use consistent naming: PascalCase for display, camelCase for metadata

3. **Filter Behavior**
   - Default "All" filter now hides shows with `inEmby: false`
   - hasemby condFltr uses `show.inEmby !== false` condition
   - Delete button sets `inEmby: false` instead of `deleted` date

4. **Persistence for Deleted Shows**
   - Toggle functions (InToTry, InContinue, InMark, InLinda) persist even when `inEmby: false`
   - SeriesMap persists for deleted shows
   - Collection flags maintained across delete/restore operations

## Files Modified (Client)

1. **apps/client/src/emby.js**
   - Updated `loadAllShows()` to flatten tvdb records instead of building show objects
   - Replaced `deleted` checks with `inEmby` checks
   - Added property flattening: emby/gap/disk data merged to top level
   - Updated `startGapWorker()` and `startUpdateWorker()` to use inEmby

2. **apps/client/src/components/list.vue**
   - Updated `hasemby` condFltr: `show.inEmby !== false` instead of `!show.Id.startsWith("noemby-")`
   - Updated `deleteShow()`: sets `inEmby: false` instead of `deleted` date
   - Updated toggle functions: `toggleToTry`, `toggleContinue`, `toggleMark`, `toggleLinda` to use inEmby
   - Fixed property access to use tvdb record structure (show.name instead of show.Name in some places)

3. **apps/client/src/components/info.vue**
   - Replaced `show.Id.startsWith("noemby-")` with `show.inEmby === false`
   - Updated `notInEmby` computed property
   - Updated path button and trailer refresh checks

4. **apps/client/src/components/actors.vue**
   - Updated seriesMap caching to check `show.inEmby === false`

5. **apps/client/src/components/tor.vue**
   - Updated show validation to use `show.inEmby === false`

6. **apps/client/src/components/shows.vue**
   - Updated button visibility: `v-show="show.inEmby !== false"`

7. **apps/client/src/components/map.vue**
   - Updated multiple button visibility checks to use `mapShow?.inEmby !== false`
   - Updated trailer button to show when `mapShow?.inEmby === false`

8. **apps/client/src/components/browse.vue**
   - Updated watchedCount logic to check `inEmby === false` instead of `showId.startsWith("noemby-")`

9. **apps/client/src/util.js**
   - Updated "All" preset: `hasemby = 1` (filters out inEmby:false by default)

## Files Modified (Server)

10. **apps/srvr/src/tvdb.js**
    - Replaced `if (deleted !== undefined) tvdbData.deleted = deleted`
    - With `if (inEmby !== undefined) tvdbData.inEmby = inEmby`

## Migration Scripts

### 1. Initial Migration: deleted → inEmby

**Script:** `/root/apps/tv/scripts/migrate-deleted-to-inemby.js`

**What it does:**

- Converts `deleted` property to `inEmby` boolean (inverted)
- Removes `deleted` property
- Backs up old tvdb.json

**Status:** ✅ Completed

### 2. Flatten Migration: Remove Nested Objects

**Script:** `/root/apps/tv/scripts/flatten-tvdb-records.js`

**What it does:**

- Flattens `emby` object properties to top level (with PascalCase names)
- Flattens `gap` object properties to top level (already PascalCase)
- Flattens `disk` object properties to top level (with PascalCase names)
- Flattens `sync` object properties to top level (camelCase)
- Removes lowercase `name` property (keeps only `Name`)
- Removes all nested objects after flattening
- Backs up tvdb.json before changes

**Status:** ✅ Completed

**Results:**

- Total shows: 1,177
- Flattened objects: 3,684
- Removed name properties: 1,177
- Errors: 0

## Deployment Steps

1. **Run migration script on remote server** (one-time operation)
2. **Deploy client files** (copy /root/apps/tv/apps/client to remote)
3. **Deploy server files** (copy /root/apps/tv/apps/srvr to remote)
4. **Restart services** (pm2 restart as needed)

## Property Mapping Reference

### Before (Show Objects)

```javascript
{
  Name: "Show Name",
  Id: "12345" or "noemby-67890",
  TvdbId: 67890,
  InToTry: true,
  InContinue: false,
  IsFavorite: true,
  FileGap: true,
  WatchGap: false,
  Notes: "some notes"
}
```

### After (Flattened Tvdb Records)

```javascript
{
  // Core identity
  Name: "Show Name",         // display name (only Name, no lowercase name)
  TvdbId: 67890,             // tvdb ID
  tvdbId: 67890,             // legacy property
  Id: "12345" or "noemby-67890", // emby ID or computed
  showId: "12345",           // original emby ID property
  inEmby: true,              // NEW: boolean flag (replaces deleted)

  // Collection flags (flattened from emby object)
  InToTry: true,
  InContinue: false,
  InMark: false,
  InLinda: false,
  IsFavorite: true,

  // Emby playback data (flattened from emby object)
  Played: false,
  PlayCount: 0,
  LastPlayedDate: "2024-01-15",
  DateCreated: "2023-12-01",
  PremiereDate: "2023-11-15",
  Path: "/media/Shows/Show Name",

  // Disk data (flattened from disk object)
  Date: "2024-01-15",
  Size: 123456789,
  NoFiles: false,

  // Gap data (flattened from gap object)
  FileGap: true,
  WatchGap: false,
  ShowId: "12345",           // from gap object
  NotReady: false,

  // Sync data (flattened from sync object)
  lastEmbySync: 1704123456789,
  lastTvdbSync: 1704123456789,
  lastDiskCheck: 1704123456789,

  // TVDB metadata
  OriginalCountry: "US",
  Overview: "Show description...",
  Genres: ["Drama", "Action"],
  Ended: false,
  LastAired: "2024-01-10",
  Ratings: 8.5,

  // Other flags
  Reject: false,
  Pickup: false,
  WaitStr: "{Jan 15}",
  Notes: "some notes"
}
```

**Note:** All nested objects (emby, gap, disk, sync) have been flattened to top level. The lowercase `name` property has been removed - only `Name` exists.

## Testing Checklist

After deployment:

- [ ] Shows load correctly in list view
- [ ] hasemby filter works (hides inEmby:false shows by default)
- [ ] Delete button sets inEmby:false and removes show from list
- [ ] Collection toggles (ToTry, Continue, Mark, Linda) work for both emby and non-emby shows
- [ ] Gap worker updates show state correctly
- [ ] Map view works for all show types
- [ ] Browse view shows correct watched status
- [ ] Info pane displays correctly for emby and non-emby shows

## Rollback Plan

If issues occur:

1. Restore tvdb.json from backup: `tvdb.json.backup-[timestamp]`
2. Revert code changes (git checkout previous commit)
3. Restart services

## Notes

- All existing capitalization preserved (no PascalCase→camelCase conversion)
- All nested objects (emby/gap/disk/sync) have been flattened to top level
- Removed duplicate `name` property - only `Name` exists now
- Components access all properties directly at top level (no nested access needed)
- Default filter behavior now hides deleted shows (inEmby:false)
- Toggle functions and seriesMap persist for deleted shows (inEmby:false)
- Collection flags maintained across delete/restore operations
