# Phase 1 Complete: TVDB Schema Extension

## What Was Changed

### 1. Extended TVDB Schema (`apps/srvr/src/tvdb.js`)

**Modified `getTvdbData()` function** to include new fields in every tvdb record:

**New nested objects:**
- `emby`: Emby user data (id, path, collections, watched status)
- `disk`: Filesystem data (date, size, noFiles flag)
- `download`: Download tracking summary (status, lastCheck)
- `tvmaze`: TVMaze reference (id, status)
- `sync`: Sync timestamps (lastEmbySync, lastDiskCheck, lastMetadataUpdate)

**New top-level fields:**
- `gap`: Gap tracking data (moved from gaps.json in Phase 5)
- `note`: Show notes (moved from notes.json in Phase 5)
- `reject`: Reject flag (moved from rejects in Phase 5)
- `pickup`: Pickup flag (moved from pickups in Phase 5)
- `lastViewed`: Last viewed timestamp (moved from lastViewed.json in Phase 5)
- `waitStr`: Waiting indicator string

### 2. Added Backward Compatibility Migration

**On startup**, `apps/srvr/src/tvdb.js` now:
1. Loads existing `tvdb.json`
2. Checks each record for new fields
3. Initializes missing fields with defaults
4. Saves updated structure back to disk (only if changes made)

This ensures existing data continues to work without manual intervention.

### 3. Enhanced `setTvdbFields()` Function

Now handles nested field updates:
- Can update `emby.inToTry` instead of requiring full `emby` object
- Can update `disk.date` individually
- Can update `sync.lastEmbySync` individually

## Testing Phase 1

### Local Testing (Limited)

Since the actual `tvdb.json` is on the remote server, local testing is limited:

```bash
# This will show that the file needs to be tested on remote
node test-phase1.js
```

### Remote Testing (Full)

SSH to the remote server and test:

```bash
# Connect to remote
ssh hahnca.com

# Navigate to project
cd /root/dev/apps/tv

# Restart srvr to trigger migration
cd apps/srvr
./stop
./run

# Check logs for migration message
tail -f data/misc/srvr.log | grep -i "phase 1"

# You should see:
# "Phase 1 migration: Saving updated tvdb.json with new schema fields"
```

### Manual Verification

On remote server:

```bash
# Check a sample show has new fields
cd /root/dev/apps/tv/apps/srvr
node -e "
const fs = require('fs');
const tvdb = JSON.parse(fs.readFileSync('data/tvdb.json', 'utf8'));
const show = Object.values(tvdb)[0];
console.log('Sample show:', show.name);
console.log('Has emby:', !!show.emby);
console.log('Has disk:', !!show.disk);
console.log('Has sync:', !!show.sync);
"
```

## What to Expect

**On first srvr startup after Phase 1:**
1. Migration runs automatically
2. Log message confirms: "Phase 1 migration: Saving updated tvdb.json..."
3. All shows now have new fields initialized
4. No data loss - all existing fields preserved

**On subsequent startups:**
- No migration needed
- Instant load (migration only runs once)

## Files Modified

- ✅ `apps/srvr/src/tvdb.js` - Extended schema, added migration
- ✅ `test-phase1.js` - Created test script

## Next Steps

**After you verify Phase 1:**
1. Check that srvr starts successfully
2. Verify no errors in logs
3. Confirm shows still load in client
4. Check that a sample show has the new fields

**Then we move to Phase 2:**
- Refactor `loadAllShows()` to use the new schema
- Simplify the merge logic
- Make it populate the new fields from Emby

## Rollback Plan

If issues occur:

```bash
# On remote server
cd /root/dev/apps/tv/apps/srvr

# Restore from git
git checkout apps/srvr/src/tvdb.js

# Restart srvr
./stop
./run
```

Your data is safe - the migration only adds fields, never removes them.

## Status

✅ **Phase 1 Complete** - Schema extended, migration ready

Ready for your review and testing!
