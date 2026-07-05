# Plan — don't log redundant `down blocked` events

## Goal

Stop the unilog viewer from filling with identical `down blocked` events that
re-fire every processing cycle (e.g. the same USB file blocked over and over).
Real but redundant events should be dropped **in tv-srvr** before they are
inserted / broadcast, using a short-lived in-memory cache.

## Findings from the codebase

### The group and its sites

- `down blocked` is `log_groups.group_id = 26` in the remote DB
  (`/root/dev/apps/tv/unilog/unilog.sqlite`). The word "down" is coincidental —
  it covers the whole tor/flex → qbt → down flow.
- 28 active/known sites are linked to group 26 (via `site_groups`):

  | project | file                                 | log_ids                                                       |
  | ------- | ------------------------------------ | ------------------------------------------------------------- |
  | api     | `apps/api/src/server.js`             | 1170,1171,1172,1173,1174,1175,1176                            |
  | client  | `apps/client/src/components/tor.vue` | 1186                                                          |
  | down    | `apps/down/src/main.js`              | 1185\*,1195,1196,1197,1198,1199,1200,1201,1202,1203,1204,1205 |
  | srvr    | `apps/srvr/index.js`                 | 1177,1178,1179,1180,1181,1182,1183,1184                       |

  \* `1185` is currently a **hidden** (commented `// hidden`) site.

### Assumption check — "only torrent titles and usb file names are needed"

**Confirmed true.** Every group-26 site already embeds its identifying string in
the message field, exactly like the example in the instructions:

- **down** (`fname` / `seriesName`): e.g. `Down: previous error in tvJson for "Call.Me.Fitz.S01E09...mkv" (Call Me Fitz)` — always quotes the USB `fname`.
- **srvr flexget** (`rawTitle`): e.g. `Flexget: worse quality than last sent Show S01E01 "Show.S01E01.1080p...-GRP"` — always quotes the raw torrent title.
- **api** (`torTitle()` / `requestedTitle`): e.g. `API: tv-proc blocked (1 existing, 0 errors) for "Show.S01E01..."`.
- **client** (`newTitle`): `Client: qBittorrent has higher quality S01E01 ... : "Show.S01E01..."`.

**Conclusion:** no message rewrites are required to add identifying info — the
data is already present. `log_id + message` is a sufficient dedup key. This
makes the "figure out / embed the info" step a no-op for identification.

### Message fields that carry volatile data (dedup-relevant caveat)

A few messages interpolate values that can change between otherwise-identical
events, which would _defeat_ dedup (each variant treated as new). These are all
low-frequency/action events, so impact is minor, but noted:

- `1180` srvr — includes `(${eSeeds}->${cSeeds} seeds)` (seed counts vary).
- `1172` / `1173` / `1175` api — include an upstream `error` string.

No change proposed (see Suggestions); flagged for awareness.

## Where the dedup logic goes (the "centralized processing routine")

Both event paths funnel through `unilogDb.insertEvent(...)`:

- in-process srvr logs: `epd.setUnilogSink(...)` → `insertEvent` (index.js ~4193).
- remote processes/clients: `POST /api/log` → `insertEvent` (index.js ~4205).

Putting the filter at/just-before `insertEvent` covers **both** local and
remote emitters, satisfying "when an event arrives ... from a remote unilog
call."

## Design

### 1. Know which log_ids are `down blocked`

At tv-srvr startup, load the set of group-26 site ids into memory:

```
SELECT log_id FROM site_groups WHERE group_id =
  (SELECT group_id FROM log_groups WHERE description = 'down blocked');
```

Keep as `Set<number>`. Sites are only created at deploy time (which restarts
srvr), so the set is naturally fresh. Non-member events bypass all dedup logic.

### 2. In-memory dedup cache

- Structure: `Map<string, number>` keyed by `` `${logId}\u0000${message}` ``,
  value = `Date.now()` of last insertion.
- Only group-26 events are ever put in the cache.
- **Prune** entries older than ~1 hour (`DEDUP_TTL_MS = 60*60*1000`). Because the
  cache only holds sub-hour entries, "timestamps within 1 hr" is automatic — any
  cache hit is by definition < 1 h old, so no explicit timestamp comparison is
  needed (matches the instruction).

### 3. Filter algorithm (per incoming event)

```
if (logId is a down-blocked id) {
  pruneCache(now);                       // drop entries older than TTL
  const key = logId + "\0" + message;
  if (cache.has(key)) return null;       // redundant → skip insert + broadcast
  cache.set(key, now);
}
// else / not a dupe:
return realInsertEvent(...);             // insert to DB, return joined row
```

Return `null` on a dropped dupe so `broadcastUnilog(null)` is a no-op (it already
guards `if (!row) return`). Nothing is written to `log_events` and nothing is
broadcast — the row count stays clean.

### 4. Seed cache from DB on startup ("cache matches events in the db")

To survive srvr restarts (so a file blocked just before restart isn't re-logged
right after), seed the cache from recent DB rows:

```
SELECT e.log_id, e.message, e.ts
  FROM log_events e
 WHERE e.log_id IN (<group-26 ids>)
   AND e.ts >= (now - 1h)   -- ts is PST 'yyyy/mm/dd hh:mm:ss'
```

Populate `cache[key] = <parsed ts millis>`. Prune immediately. (If ts parsing is
awkward, an acceptable simpler fallback is to seed with `Date.now()` for all rows
in the last hour — slightly over-retains but harmless.)

### 5. Implementation shape

- Add the cache + `Set` of ids + prune helper + seeding in
  `apps/srvr/src/unilogDb.js`, exposed via a new function, e.g.
  `insertEventDedup({ logId, pid, message })` that wraps `insertEvent` and
  returns `null` on a drop. Keep the raw `insertEvent` intact for internal use.
- Point both call sites (`setUnilogSink` and `/api/log`) in `index.js` at the
  new dedup wrapper.
- `logHere(...)` placeholders for any new log lines (never hand-assign ids).

## Source cleanup — remove redundant sibling unilog calls (keep highest id)

While scanning, remove the older duplicate call in the same code path, keeping
the highest log_id (the group-26 one). Confirmed pairs in
`apps/down/src/main.js`:

- keep `1197` (line ~2472), **remove** legacy `320` "NOT A TV SHOW, SKIPPING" (line ~2476).
- keep `1200` (line ~2785), **remove** legacy `326` "NOT A TV SHOW, SKIPPING" (line ~2772).
- keep `1202` (line ~2986), **remove** legacy `330` "ALREADY ON DISK" (line ~2990).

Already-hidden siblings need no action (they don't emit): `319`, `329`, the
`477/478/479/481/488/491` history skip sites, and hidden `1185`.

Possible extra (api `apps/api/src/server.js`, judgment call — see Suggestions):

- near `1176` there is `if (debug) unilog(239, "blocked by tv-proc", {...})` in
  the same path. By "keep highest id" this `239` would be removed, but it only
  fires under `debug` and carries a structured object. **Proposed: leave it**
  unless you confirm removal.

Hidden sites are treated the same as non-hidden per the instruction: they were
inspected, already carry the identifying info, and need no edits.

## Ambiguities / contradictions / risks

1. **"cache of events that matches events in the db"** — read as: seed + keep the
   cache in sync with recently-inserted DB events. Since srvr is the single
   writer and dupes are dropped _before_ insert, the cache and DB stay
   consistent by construction. Confirm this reading.
2. **Scope of dedup** — applied only to group-26 (`down blocked`) events, not all
   events. This matches the instruction's intent; other groups are untouched.
3. **Volatile message fields** (1180 seeds, 1172/1173/1175 error text) mean a few
   sites may occasionally slip a near-dupe through. Left as-is (rare, and they're
   genuine state changes). Flag if you want them normalized.
4. **"1 hour apart"** is enforced implicitly by TTL pruning rather than a per-pair
   timestamp diff. The instruction explicitly blesses this ("timing requirement
   is automatic").
5. **TTL boundary** — a file blocked every cycle keeps refreshing... **Decision
   needed:** should a cache hit _refresh_ the entry's timestamp (suppress
   indefinitely while it keeps re-blocking) or _not_ (so it re-logs ~once per
   hour)? Proposed: **do not refresh** on hit → the event re-appears at most once
   per hour, giving a periodic heartbeat that the block is still active. Please
   confirm.
6. **`id`/message uniqueness within a batch** — `/api/log` accepts arrays; the
   filter runs per-element in order, so intra-batch dupes are also collapsed.
7. **Client-emitted `1186`** — client events reach srvr via `/api/log`, so they
   are covered too. No client-side change needed.

## Suggestions

- Make the down-blocked id `Set` and cache live entirely in `unilogDb.js` so all
  writers share one code path; expose only `insertEventDedup`.
- Add a tiny counter (e.g. `dedupDropped`) surfaced in `dbInfo()` for visibility
  into how many redundant events were suppressed.
- Consider not removing debug-guarded `239`; structured debug detail is useful
  and it doesn't spam the viewer (debug off by default).
- If volatile-field near-dupes become a nuisance, strip the volatile tail (e.g.
  the `(...seeds)` / trailing `: <error>`) from the dedup **key** only, leaving
  the stored message intact.

## Steps (once approved — NOT done in this pass)

1. `unilogDb.js`: add group-26 id loader, dedup cache, prune, DB seeding, and
   `insertEventDedup(...)` wrapper (`// no-unilog` plumbing).
2. `index.js`: route `setUnilogSink` and `/api/log` through `insertEventDedup`.
3. `apps/down/src/main.js`: remove legacy `320`, `326`, `330`.
4. (optional) api `239` removal — pending your call.
5. Deploy affected servers only: `./srvr srvr` and `./srvr down` (and `./srvr api`
   only if `239` is touched); no client build. Check pm2 logs for restart loops.
