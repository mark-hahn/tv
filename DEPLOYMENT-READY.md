# Deployment Ready: Show Object Simplification

## Summary of Changes

Major refactoring to merge show objects into tvdb records and replace `deleted` property with `inEmby` boolean.

## Key Changes

1. **Property Structure**
   - Removed show object building layer
   - Tvdb records now have flattened properties (emby/gap data at top level)
   - Replaced `deleted` date string with `inEmby` boolean flag
   - Replaced `Id.startsWith("noemby-")` checks with `inEmby === false` checks

2. **Data Flow**
   - `loadAllShows()` now returns tvdb records with flattened properties
   - Components access properties directly from tvdb records
   - Gap worker results merged into tvdb records at top level

3. **Filter Behavior**
   - Default "All" filter now hides shows with `inEmby: false`
   - hasemby condFltr uses `show.inEmby !== false` condition
   - Delete button sets `inEmby: false` instead of `deleted` date

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

## Migration Script (Run Once on Remote)

**Script:** `/root/apps/tv/scripts/migrate-deleted-to-inemby.js`

**Run on remote server:**

```bash
ssh hahnca.com
cd /root/dev/apps/tv/apps/srvr
node /root/apps/tv/scripts/migrate-deleted-to-inemby.js
```

**What it does:**

- Reads tvdb.json
- Converts `deleted` property to `inEmby` boolean (inverted)
- Removes `deleted` property
- Backs up old tvdb.json to tvdb.json.backup-[timestamp]
- Writes updated tvdb.json

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
  name: "Show Name",         // original property
  Name: "Show Name",         // flattened for compatibility
  tvdbId: 67890,             // original property
  TvdbId: 67890,             // flattened for compatibility
  Id: "12345" or "noemby-67890", // computed from emby.id
  inEmby: true,              // NEW: boolean flag
  showId: "12345",           // original property

  // Nested emby object (preserved)
  emby: {
    id: "12345",
    inToTry: true,
    inContinue: false,
    isFavorite: true,
    // ...
  },

  // Flattened for component access
  InToTry: true,             // from emby.inToTry
  InContinue: false,         // from emby.inContinue
  IsFavorite: true,          // from emby.isFavorite

  // Nested gap object (preserved)
  gap: {
    FileGap: true,
    WatchGap: false,
    ShowId: "12345",
    // ...
  },

  // Flattened gap properties
  FileGap: true,             // from gap.FileGap
  WatchGap: false,           // from gap.WatchGap

  note: "some notes",        // original property
  Notes: "some notes",       // flattened for compatibility
}
```

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
- Flattened properties added to tvdb records for component compatibility
- Nested emby/gap/disk objects preserved in tvdb records
- Components can access both nested (`show.emby.inToTry`) and flattened (`show.InToTry`) properties
- Default filter behavior now hides deleted shows (inEmby:false)
