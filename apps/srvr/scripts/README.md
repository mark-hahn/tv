# SRVR Scripts

## create-tvdb-template.js

**One-time script** to generate `tvdbTemplate.json` from actual TVDB API data.

### Purpose

Creates a template of expected TVDB properties by fetching data from multiple shows and merging all their property names. This template is used to identify missing/empty fields during TVDB refresh operations.

### Usage

```bash
cd /root/apps/tv/apps/srvr
node scripts/create-tvdb-template.js
```

### Output

Creates `/root/apps/tv/apps/srvr/data/tvdbTemplate.json` containing an array of all property paths found across test shows.

### Test Shows

- 30 Rock
- The Bear
- Black Mirror
- Breaking Bad
- Family Guy
- The Golden Girls
- Only Murders in the Building

### Notes

- Only needs to be run once or when TVDB API schema changes
- Do NOT use existing tvdb.json as reference since it contains custom properties
- Template contains ~220 unique property paths from TVDB API
