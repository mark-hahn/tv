# Plan: fix duplicate `log_id`s in unilog

Implements `unilog/fix-id-dupes-instr.md`. This document is a plan only — no code
is changed by writing it.

## 1. Background — how things work today

- Deploy-time reconciliation runs **locally** in `unilog/run-reconcile.js`, which
  drives the pure core in `unilog/reconcile.js` (`scanText` / `reconcileText`).
- `unilog/parse.js#findLogCalls` AST-parses each file and reports:
  - `kind:"old"` — legacy `console.log` / `log()` calls to upgrade.
  - `kind:"active"` — existing `unilog(N, ...)` calls (it reads `N` from the first
    numeric arg).
- New sites (stubs + upgrades) are sent to **tv-srvr** (the single id generator)
  via `POST /api/unilog/sites` → `unilogDb.createSite` → returns a fresh `log_id`.
  Existing active sites are _refreshed_ (src_file/src_line updated) via
  `/api/unilog/refresh-sites`. If srvr is unreachable, `run-reconcile.js` stops
  tv-srvr and writes the DB directly over ssh+sqlite3.
- `unilog/reconcile-cache.json` (local, gitignored) has shape:
  ```json
  { "<relPath>": { "hash": "...", "sites": { "<logId>": <srcLine> } } }
  ```
  It is used to (a) skip unchanged files by hash and (b) decide whether a site's
  line moved (compare cached line for a `logId` against the current line).
- DB schema (`apps/srvr/src/unilogDb.js`): `log_sites(log_id PK, tag, description,
level, src_file, src_line, old_log, project, created_at, removed_at)`,
  `site_groups(log_id, group_id)`, `log_groups`, `log_events`.

### Why duplicates are a real bug today

If a `unilog(42, ...)` line is copy-pasted, two source lines now carry id `42`.
The reconciler treats both as `active` and emits a refresh for `42` from each —
they oscillate, overwriting each other's `src_line` every deploy. The current
`seenLogIds` / `collisions` logic in `run-reconcile.js` only notices **cross-file**
collisions and merely _skips_ them; **same-file** duplicates are silently collapsed
because the cache `sites` map is keyed by `logId` (two lines → one key).

## 2. Cache format change: invert `sites` map (line → logId)

The `sites` map cannot represent two lines sharing one id while keyed by id. Invert
it so the **line number is the key** and the **logId is the value**:

```json
{ "<relPath>": { "hash": "...", "sites": { "<srcLine>": <logId> } } }
```

Line numbers are unique per file (only one unilog call per line), so duplicate ids
within a file are now representable.

Work items:

1. **One-time migration script** `unilog/migrate-cache-invert.js`: read
   `reconcile-cache.json`, for each file flip `{logId: line}` → `{line: logId}`,
   write it back. Idempotency guard: detect already-inverted files (e.g. a version
   marker `"v": 2` on the file, or by heuristic) so re-running is safe. Add a
   top-level `"version"` field to the cache to make future migrations explicit.
2. **Update every reader/writer of the cache** (all in `run-reconcile.js`):
   - `currentSitesByFile[srcFile][line] = logId` (was `[logId] = line`).
   - The "did the line move?" check at
     [run-reconcile.js](unilog/run-reconcile.js#L313) currently does
     `cached = hashCache[srcFile]?.sites?.[String(logId)]` (id→line). With the
     inverted map, build a per-file reverse lookup `logId → line` once from the
     cached `{line: logId}` map and compare against the current line. (After the
     dedup pass below runs, ids are unique within a file again, so the reverse
     map is 1:1 and well-defined.)
   - Cache write blocks at
     [run-reconcile.js](unilog/run-reconcile.js#L366) and
     [run-reconcile.js](unilog/run-reconcile.js#L371) build `{line: logId}`.
   - The post-injection rebuild at
     [run-reconcile.js](unilog/run-reconcile.js#L341-L356) stores `{line: logId}`.

(The cache is the only consumer of the `sites` map — `query.js`, `reseed.js`,
`uni`, and `reconcile.js` do not read it — so the blast radius is contained to
`run-reconcile.js` plus the one-time migration.)

## 3. Duplicate detection (runs early)

Add a detection pass that runs **before** the main reconcile pass, operating over
**all** files (same-file and cross-file dupes in one operation).

Input set = union of:

- For **changed** files: a fresh `scanText(...).refreshes` (current source ids +
  lines) — _not_ the stale cache, so a dupe newly pasted into a changed file is
  caught this deploy.
- For **unchanged** files: their existing cache `{line: logId}` entries.

Algorithm (O(total sites), not n²):

```
const seen = new Map();            // logId -> [{ file, line, changed:boolean }, ...]
for each site (file, line, logId): seen.get(logId).push({file, line, changed})
duplicates = [...seen].filter(([id, occ]) => occ.length > 1)
```

A single `Map` build + group-by replaces the suggested n² scan. Any id whose
occurrence list has length > 1 is a duplicate group.

## 4. Fixing duplicates

For each duplicate group `{ logId: X, occurrences: [...] }`:

- **Keeper selection** (deterministic; see Ambiguity A): keep id `X` on exactly one
  occurrence; every other occurrence is _reassigned_. Prefer keeping an occurrence
  in an **unchanged** file (its source is never rewritten); otherwise keep the
  first occurrence by `(file, line)` order.
- For each occurrence to reassign (these must be in **changed** files — see
  Ambiguity B):
  1. Call the new endpoint (Section 5) with `{ logId: X, project, srcFile, srcLine }`
     → returns `newId`.
  2. Rewrite that source line `unilog(X, ...)` → `unilog(newId, ...)` (Section 6).

This whole pass runs **before** `reconcileFilesWithDb`, so the main pass then sees
unique, corrected ids and emits clean (non-oscillating) refreshes. The existing
`seenLogIds` / `collisions` skip-logic in `run-reconcile.js` is **removed** —
it is fully superseded by this dedup pass.

## 5. New srvr endpoint + DB function

### `unilogDb.createDuplicateSite({ oldLogId, project, srcFile, srcLine, groupIds })`

Transactional:

1. `newId = MAX(log_id)+1`.
2. `SELECT * FROM log_sites WHERE log_id = oldLogId` → original row.
3. **If the original exists:** insert a **copy of the original row**, overriding
   only `log_id=newId`, `project`, `src_file`, `src_line`, fresh `created_at`,
   `removed_at=NULL`. `tag`, `description`, `level`, and `old_log` are copied
   verbatim (`old_log` is **left unchanged** per decision D). Then for every
   `(oldLogId, gid)` in `site_groups`, insert `(newId, gid)` so the new id
   inherits the same groups.
4. **If the original does NOT exist** (a hand-typed/bogus id — decision C): create
   a fresh stub-like site (`level="info"`, `tag=null`, given
   `project`/`src_file`/`src_line`) and link it to the run's `groupIds`.
5. Return `newId`.

### `POST /api/unilog/duplicate-site`

In `apps/srvr/index.js`, next to the other `/api/unilog/*` tooling endpoints
([index.js](apps/srvr/index.js#L4063)):

```js
app.post("/api/unilog/duplicate-site", (req, res) => {
  try {
    res.json({ id: unilogDb.createDuplicateSite(req.body || {}) });
  } catch (e) {
    /* log + 500 */
  }
});
```

### ssh fallback in `run-reconcile.js`

Mirror the existing `createSiteFn` fallback pattern: when the endpoint is
unavailable, stop tv-srvr and do the copy directly over ssh+sqlite3:
`INSERT INTO log_sites (...) SELECT <newId>, tag, description, level, <srcFile>,
<srcLine>, project, <nowPst> FROM log_sites WHERE log_id=<oldId>` followed by
`INSERT INTO site_groups (log_id, group_id) SELECT <newId>, group_id FROM
site_groups WHERE log_id=<oldId>`, with `newId = MAX(log_id)+1`.

## 6. Source rewrite of the numeric id

`findLogCalls` active hits currently expose `logId`, `line`, `end`, `argsText` but
**not** the byte offset of the numeric id literal. Two options:

- **Preferred:** extend `findLogCalls` to also return `idStart`/`idEnd` (the
  `NumericLiteral` `a0.start/a0.end`, with the vue `offset` added back). Rewrite by
  precise byte slice — consistent with how `reconcileText` already does offset-based
  edits.
- **Fallback:** line-scoped regex `s/unilog\(\s*\d+/unilog(<newId>/` on the single
  target line (safe because only one unilog call per line is allowed).

Plan uses the preferred AST-offset approach. Rewrites for a file are applied
end-to-start (like `reconcileText`) so offsets stay valid when a group reassigns
multiple ids in one file.

## 7. `old_log` — left unchanged (decision D)

The instruction originally asked to remove `old_log`; this was reversed. The
column stays in the schema and in all code paths (`createSite`, `createDuplicateSite`
copies it verbatim, the ssh-fallback INSERTs keep the `old_log` column). No schema
migration and no doc changes for `old_log`.

## 8. Ordering inside `run-reconcile.js` (final sequence)

1. Build file list (changed-by-hash, or all with `--force`).
2. **Dedup pass** (Sections 3–6): scan changed files fresh + cache for the rest →
   detect → for each reassignment call `duplicate-site` and rewrite source.
3. Main reconcile (`reconcileFilesWithDb`) — now sees unique ids.
4. Inject unilog import; re-scan; flush refreshes (unchanged from today).
5. Write cache in the **inverted** `{line: logId}` format.

## 9. Tests (`unilog/test/`)

- Unit-test the dedup detector: same-file dupes, cross-file dupes, mixed
  changed/unchanged, keeper selection.
- Unit-test `createDuplicateSite`: row copied correctly, groups copied, new id
  allocated, stub fallback for a bogus id.
- Extend `test-tooling.js` to cover the inverted cache round-trip.

## 10. Completeness check ("am I forgetting anything?")

Things in the instruction that are covered above and one extra that the instruction
did not call out but is **required**:

- ✅ Early detection in one O(n) operation across all files (§3).
- ✅ Cache inversion + one-time migration + update all cache code (§2).
- ✅ New endpoint copying the original row + group rows + ssh fallback (§5).
- ✅ Source rewrite of only the id param (§6).
- ✅ `old_log` left unchanged in the DB per decision D (§7).
- ➕ **Not in the instruction but needed:** extending `findLogCalls` to expose the
  id literal offset (§6); removing the now-redundant `seenLogIds`/`collisions`
  block (§4); adding a cache `version` marker + auto-migration so the inversion is
  safe to re-run (§2).

## Ambiguities / contradictions / impossibilities — resolutions

- **A. Which occurrence keeps the original id?** _Decision: use the proposal._
  Prefer the occurrence in an unchanged file (its source is never rewritten),
  else the first by `(file, line)`. Implemented in `findDuplicateIds`.
- **B. "Use reconcile-cache.json for detection" vs. fresh source.** _Decision: feed
  detection the fresh scan for changed files_ and the cache only for unchanged
  files. Consequently, reassignment only ever rewrites occurrences in **changed**
  files; unchanged source is never modified.
- **C. Duplicate of an id with no DB row.** _Decision: treat it as a new site like
  a stub._ `createDuplicateSite` falls back to a fresh `level="info"`/`tag=null`
  row linked to the run group when the old id has no row.
- **D. `old_log`.** _Decision: leave `old_log` unchanged in the DB._ No schema or
  code removal (§7).
- **E. n² question.** Resolved: a single hash-map group-by is O(n) (§3,
  `findDuplicateIds`).
