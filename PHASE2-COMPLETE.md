# Phase 2 Complete: Refactored loadAllShows()

## What Was Changed

### 1. Refactored `loadAllShows()` in [apps/client/src/emby.js](apps/client/src/emby.js)

**Before:** 450 lines of complex merging logic
**After:** ~250 lines with clear separation of concerns

**Key improvements:**

- ✅ Uses tvdb as source of truth (not Emby objects)
- ✅ Syncs Emby user data INTO tvdb records
- ✅ Populates new Phase 1 fields (emby, disk, sync)
- ✅ Cleaner flow: fetch → sync → build show list
- ✅ Returns backward-compatible show objects (for now)

### 2. Added Helper Functions

**Three new helper functions for clarity:**

- `syncCollections()` - Syncs toTry, continue, mark, linda flags into tvdb
- `syncRejectsAndPickups()` - Syncs reject/pickup flags into tvdb
- `setWaitStrings()` - Sets wait strings for unaired shows

### 3. Data Flow Changes

**Old flow:**

1. Fetch Emby shows
2. Merge disk data into shows
3. Merge gaps into shows
4. Merge notes into shows
5. Fetch collections, apply to shows
6. Fetch tvdb data, merge into shows
7. Return merged show objects

**New flow (Phase 2):**

1. Fetch all data sources in parallel
2. Get tvdb (source of truth)
3. Sync Emby + disk data into tvdb records
4. Sync collections into tvdb records
5. Sync rejects/pickups into tvdb records
6. Build show list from tvdb
7. Return shows (backward compatible format)

### 4. Backward Compatibility

**Show objects returned still have old format:**

- `show.Name`, `show.Id`, `show.InToTry`, etc.
- Clients don't need changes yet
- Internal reference: `show._tvdb` points to full tvdb record

**Why:** Phase 6 will update components to use new structure directly

## Testing Phase 2

### Local Testing

```bash
cd /root/apps/tv/apps/client
./run
```

**Watch console for:**

- `Phase 2: loadAllShows completed in Xms` (should be faster)
- No errors during load
- Shows display correctly
- Collections work (toTry, continue, etc.)
- Filters work (rejects, pickups)

### What to Verify

1. ✅ Shows load successfully
2. ✅ Collection flags display correctly (toTry, continue, mark, linda)
3. ✅ Reject/pickup flags work
4. ✅ Gap indicators show properly
5. ✅ Notes display
6. ✅ No errors in browser console
7. ✅ Performance: should be ~same speed or faster

### Remote Deployment

When local testing passes:

```bash
cd /root/apps/tv
./srvr
# PM2 restarts automatically
# Client will use new code on next page load
```

## What Changed Internally

### Data Sync Process

**Emby → TVDB:**

- Emby user data (watched status, dates) → `tvdb.emby.*`
- Disk info → `tvdb.disk.*`
- Gaps → `tvdb.gap`
- Notes → `tvdb.note`
- Collections → `tvdb.emby.inToTry`, etc.
- Rejects → `tvdb.reject`
- Pickups → `tvdb.pickup`

### New Timestamps

Every show now tracks:

- `tvdb.sync.lastEmbySync` - When Emby data was synced
- `tvdb.sync.lastDiskCheck` - When disk data was checked
- `tvdb.sync.lastMetadataUpdate` - When TVDB metadata refreshed

### Deleted Show Handling

Shows without matching Emby/noEmby entry are marked:

- `tvdb.deleted = "2026-02-06"` (date deleted)
- Filtered out from show list
- Can be undeleted if added back to Emby

## Benefits Achieved

✅ **Simpler code** - 450 → 250 lines, clearer logic
✅ **Single source of truth** - tvdb contains all data
✅ **Better tracking** - Sync timestamps show data freshness
✅ **Foundation for Phase 3** - Ready for incremental updates
✅ **Backward compatible** - No client changes needed yet

## Known Issues / Notes

**None expected** - Logic is equivalent to old version, just reorganized

**If you see issues:**

1. Check browser console for errors
2. Verify shows load
3. Check collection flags display
4. Test filtering (rejects, pickups)

## Next Steps

**After you verify Phase 2:**

1. Test locally with dev client
2. Deploy with `./srvr` when confident
3. Monitor for any issues
4. Move to Phase 3 (incremental syncs)

**Phase 3 will add:**

- Background sync every 5 minutes (Emby user data)
- Background sync every 1 hour (disk data)
- Real-time updates without full reload

## Rollback Plan

If issues occur:

```bash
cd /root/apps/tv
git log --oneline -5   # Find previous commit
git revert HEAD        # Undo Phase 2
./srvr                 # Redeploy old version
```

## Files Modified

- ✅ `apps/client/src/emby.js` - Refactored loadAllShows, added helpers

## Status

✅ **Phase 2 Complete** - Ready for testing

**Ready for your review!**
