# Code Sweep — 2026-07-10

Full sweep of app source for bugs, convoluted/fragile/redundant logic, dead code, and wrong comments.

Scope: apps/api, apps/srvr, apps/down, apps/client, apps/tv, apps/watchdog, apps/android, apps/asr, packages/share, unilog, scripts.
Excluded: node_modules, built bundles (apps/client/shows/assets), temp*.* files, sample data.

Legend: severity = how much it matters; difficulty = effort to fix; recommendation = fix now / fix eventually / leave alone.

---

## apps/api

### 1. qb-cred.js exists only on the remote server — repo code imports a file the repo doesn't have

- **Summary**: `download.js` line 5 does `import { loadCreds } from "./qb-cred.js"`, but qb-cred.js was deleted from the repo in commit 7ed8d9f9 ("Remove local data/secrets"). The file still exists at `hahnca.com:/root/dev/apps/tv/apps/api/src/qb-cred.js` and the server only runs because the deploy rsync doesn't use `--delete`. qb-cred.js is *code* (a cred-file parser), not data — only the cred file itself (`secrets/download-cred.txt`) is data.
- **Main file**: apps/api/src/download.js (missing: apps/api/src/qb-cred.js)
- **Severity**: High. A fresh deploy to a clean directory, a git-based deploy, or anyone adding `--delete` to the rsync would crash the api server at import time. The module also can't be reviewed or edited through the repo, and local tooling (lint, tests) can't resolve the import.
- **Difficulty**: Easy — copy the file back from the remote into the repo (it contains no secrets, just parsing logic), or inline `loadCreds` into download.js.
- **Recommendation**: Fix now.

### 2. searchInChild.js — timeout error message disagrees with the actual timeout

- **Summary**: `SEARCH_TIMEOUT_MS = 300 * 1000` (5 minutes) but the rejection message says "search timed out after 3 minutes" ([searchInChild.js:36](apps/api/src/searchInChild.js#L36)). Whoever reads that error in a log will hunt for a 3-minute timeout that doesn't exist.
- **Main file**: apps/api/src/searchInChild.js
- **Severity**: Low — misleading log text only; behavior is correct.
- **Difficulty**: Trivial (one string).
- **Recommendation**: Fix eventually (fold into any nearby change).

### 3. tvPaths.js — duplicate and unused path helpers

- **Summary**: `getSecretsDir()` and `getApiSecretsDir()` are byte-for-byte identical; `getApiCookiesDir()` is identical to `getApiDataDir()` (kept only for its historical name); `getApiBaseDir()` is exported but never imported anywhere. `preferSharedReadPath()` is imported by download.js and usb.js/server.js import lists — worth confirming call sites actually use it (server.js does).
- **Main file**: apps/api/src/tvPaths.js
- **Severity**: Low — pure redundancy/dead code; confuses readers about which helper is canonical.
- **Difficulty**: Easy — pick one name per dir, update ~4 import sites, delete the rest.
- **Recommendation**: Fix eventually.

### 4. sshTunnel.js — curl runs without `--fail`, so HTTP error pages count as success

- **Summary**: `sshCurlFetch` builds `curl -sS -L --globoff --compressed --max-time 60` with no `--fail`/`-f`. curl exits 0 on HTTP 403/404/500, so `ok: code === 0 && stdout.length > 0` reports success and the caller parses an error page as if it were real content. Downstream code partially compensates (`looksLikeCloudflareChallenge`, "HTML returned instead of torrent" checks in download.js), which is scattered defensive patching around one root cause. Related: an empty-body HTTP 200 is reported as *failure* (`stdout.length > 0` requirement), and the fake `status: r.ok ? 200 : 0` in download.js's `sshFetch` wrapper puts misleading httpStatus values into failure diagnostics.
- **Main file**: apps/api/src/sshTunnel.js (also apps/api/src/download.js sshFetch wrapper)
- **Severity**: Medium. Provider fetches that 403/404 look like "page loaded but no torrents found" instead of clean HTTP failures, which wastes debugging time and can cache/act on garbage.
- **Difficulty**: Moderate — adding `--fail` changes behavior (body of error responses is suppressed); alternatively add `-w '%{http_code}'` or a `--write-out` sidecar and surface the real status. Needs a quick retest of the providers.
- **Recommendation**: Fix eventually (when next touching provider fetch problems; behavior change needs live retesting).

### 5. sshTunnel.js — cookie-jar duck typing is fragile

- **Summary**: `patchProviderWithSshTunnel` reads cookies via `jar.getCookieString(urlStr)` treating it as sync. On tough-cookie jars that method is async (returns a Promise), which would silently stringify to nothing useful; it only works because torrent-search-api's request jar exposes a sync version. The try/catch hides any mismatch, so a library upgrade would silently drop all cookies rather than error.
- **Main file**: apps/api/src/sshTunnel.js
- **Severity**: Low-medium — works today; silent auth breakage on dependency change.
- **Difficulty**: Easy — detect a thenable result and await it, or log when cookieHeader comes back empty for a provider that has a jar.
- **Recommendation**: Leave alone for now; note it. (A one-line thenable check is cheap if you want it.)

### 6. local.js — shell string interpolation in getLocalFiles, plus a leftover musing comment

- **Summary**: `getLocalFiles(root)` interpolates `root` into a `bash -c` string unquoted ([local.js:21](apps/api/src/local.js#L21)). Current callers pass only hardwired constants ("/mnt/media/tv", "/mnt/media/movies", "/mnt/media/tv-errors") so it's not exploitable today, but any future caller passing request data would be a shell injection; even a path with a space breaks it. Also [local.js:71](apps/api/src/local.js#L71) has a leftover "Sort tree? … maybe we want folders first?" musing comment above code that already answers the question.
- **Main file**: apps/api/src/local.js
- **Severity**: Low today (fixed inputs), but it's a loaded footgun.
- **Difficulty**: Easy — pass root as an argv element (`find`, root, …) via execFile without bash, since no shell feature is needed except the pipe to sort (sort can be done in JS — the code re-sorts anyway in `sortNodes`, so the `| sort` is arguably redundant too).
- **Recommendation**: Fix eventually. Note the `| sort` is redundant work given `sortNodes` fully re-sorts.

### 7. imdb-credits.js — dead `log` helper and a redundant filter-button branch

- **Summary**: (a) `const log = (...args) => { unilog(142, ...args); }` ([imdb-credits.js:173](apps/api/src/imdb-credits.js#L173)) is never called — dead code holding a unilog id. (b) In the Actor-filter loop ([imdb-credits.js:277-297](apps/api/src/imdb-credits.js#L277-L297)), both the "already active" branch and the fallthrough do exactly the same thing (set `actorButton`, break); the class check inside the loop is repeated again right after the loop where it actually matters. The in-loop check is pure noise.
- **Main file**: apps/api/src/imdb-credits.js
- **Severity**: Low — dead/duplicated logic in a scraper that otherwise works.
- **Difficulty**: Trivial.
- **Recommendation**: Fix eventually. (General note: this scraper is inherently fragile against IMDb DOM changes — expected for scrapers, no action.)

### 8. reviews.js — unbounded caches, hardcoded season-1 reviews URL, unparameterized GraphQL

- **Summary**: (a) `reviewsCache` and `imdbReviewsCache` are module-level Maps with no size/TTL limit — every distinct show browsed grows process memory until pm2 restart, and reviews can never refresh. (b) `getReviews` always fetches `${cleanUrl}/s01/reviews/...` — season 1 only, by construction; if that's the intent it deserves a comment, because it looks like a bug when a show's later-season reviews never appear. (c) `getImdbReviews` builds the GraphQL query by string-interpolating `titleId` — any non-`tt\d+` input malforms the query; a `^tt?\d+$` validation would make it airtight. (d) The `fetch` to IMDb GraphQL has no timeout/AbortController — a hung connection pins the request forever.
- **Main file**: apps/api/src/reviews.js
- **Severity**: Low-medium — (a) is a slow leak on a long-lived server; (b) is a behavior surprise; (c)/(d) are hardening.
- **Difficulty**: Easy — cap the Maps (or clear on N entries), add a comment or season param for s01, validate imdbId, add AbortController.
- **Recommendation**: Fix (a) and (d) eventually; decide intent on (b) and document it.

### 9. download.js — env-var config, debug dump to a hardcoded path, stale comments, double validation

- **Summary**:
  - [download.js:38](apps/api/src/download.js#L38) reads `process.env.TOR_LOG_TORRENT_MAX_BYTES` — violates the workspace rule "never use an environment variable; hard-wire constants at top of file". (It's inside a debug path that's currently disabled, but it's still the pattern the rule bans.)
  - [download.js:327-335](apps/api/src/download.js#L327-L335): on torrent validation failure it synchronously writes `JSON` and the raw torrent to hardcoded `/root/dev/apps/tv/temp.txt` / `temp.torrent` — a debug leftover that fires on every validation failure in production, silently overwriting the previous dump.
  - Stale/wrong comments: [download.js:654](apps/api/src/download.js#L654) says "Source of truth: cf-clearance.local.json" and mentions "req-browser.txt", but the code reads `cf_clearance-cookies.json` and `curl-tl.txt`. [download.js:101](apps/api/src/download.js#L101) says "NO FALLBACKS" above a one-element `candidates` array retained from a fallback design.
  - `download()` validates the torrent twice: every branch of `fetchTorrentFile` already runs `validateTorrentData` before returning success, then [download.js:1114](apps/api/src/download.js#L1114) validates again.
  - `appendTorrentBytesLog` is dead in practice — gated behind `LOG_APPS_API_DATA_MISC_TEMP_TXT = false`, ~45 lines that never run (fine as a debug switch, but it carries the env-var read above).
- **Main file**: apps/api/src/download.js
- **Severity**: Medium for the temp.txt debug dump (production writes to a repo-root path on the server; the CLAUDE.md history shows temp-file debris has bitten before) and the wrong comments (they point at files that don't exist — someone will chase cf-clearance.local.json). Low for the rest.
- **Difficulty**: Easy — delete/guard the debug dump, fix comments, drop the duplicate validate call, replace env read with a constant.
- **Recommendation**: Fix now (comments + debug dump), rest eventually.

### 10. qbt-stats.js — unused logHere import

- **Summary**: `import { logHere, unilog } from "@tv/share"` but `logHere` is never used in the file. Dead import (lint-visible).
- **Main file**: apps/api/src/qbt-stats.js
- **Severity**: Trivial.
- **Difficulty**: Trivial.
- **Recommendation**: Fix whenever the file is next touched. (Rest of the new stats logic looks correct; the "last 10 skipping final 2" comment matches the `slice(0,-2).slice(-10)` code.)

### 11. browse.js — show year suffix can never appear (premiered format mismatch) [BUG]

- **Summary**: `buildShowTitle` does `new Date(show.premiered * 1000)` assuming epoch-seconds ([browse.js:222](apps/api/src/browse.js#L222)), but the `show` objects come from `getCandidateShows()` in tvmaze.js, which returns `JSON.parse(data_json)` — the raw TVMaze record where `premiered` is a date **string** like `"2013-06-24"`. `"2013-06-24" * 1000` is NaN, so the year is silently never appended to any browse card title. (tvmaze.js stores an epoch-seconds `premiered` *column*, but that column is not what's in `data_json`.) The dedupe/already-seen logic keys on the title, so titles like "Show" vs "Show (2013)" behaving differently is user-visible.
- **Main file**: apps/api/src/browse.js (data source: apps/api/src/tvmaze.js getCandidateShows)
- **Severity**: Medium-low — feature silently dead; distinguishing same-named shows by year was presumably the point.
- **Difficulty**: Easy — either `Date.parse(show.premiered)` for strings, or have getCandidateShows attach the epoch column onto the returned object.
- **Recommendation**: Fix now (it's a two-line change and it's the difference between a working and dead feature).
- Also minor in the same file: the outer try/catch around `loadResultTitles()` at [browse.js:210-215](apps/api/src/browse.js#L210-L215) is dead (loadResultTitles catches everything internally and can't throw), and `y && !Number.isNaN(y)` double-checks the same condition (NaN is already falsy).

### 12. tvmaze.js — leftover planning-notes comment block and inconsistently gated sync log

- **Summary**:
  - [tvmaze.js:654-671](apps/api/src/tvmaze.js#L654-L671) is an 18-line conversational planning comment ("We want to log each show added individually… Let's modify perPageTx… Actually, let's just inspect the logic…") that narrates a past edit rather than describing the code. Plus the vestigial "-- removed" comment at line 626.
  - The sync file log is inconsistently gated: `appendSyncLog` is a no-op (`LOG_APPS_API_DATA_MISC_TVMAZE_SYNC_LOG = false`), but `appendSyncBlankLine()` (module load, [tvmaze.js:244](apps/api/src/tvmaze.js#L244)) and the "======== UPDATES ========" header write ([tvmaze.js:920-936](apps/api/src/tvmaze.js#L920-L936)) write to `tvmaze-sync.log` **unconditionally**. Net effect with the gate off: the log file accumulates only blank lines and UPDATES headers — junk. Either gate all three or none.
- **Main file**: apps/api/src/tvmaze.js
- **Severity**: Low — comment noise + a slowly growing junk log file on the server.
- **Difficulty**: Trivial-easy.
- **Recommendation**: Fix eventually. Two smaller notes, leave-alone grade: `scheduleDaily3am` re-arms with `setInterval(24h)` after the first run, so the "3am" time drifts by each run's duration and by DST; and the `getTvdbToken` helper calls `res.json()` before checking `res.ok`, so a non-JSON error page produces a confusing JSON-parse error instead of "login failed: 4xx".

### 13. search.js — `tpbError` can never be true (client feature silently dead) [BUG]

- **Summary**: `let tpbFailed = false` ([search.js:650](apps/api/src/search.js#L650)) is declared and **never assigned** — `searchTpbDirect` catches its own errors and returns `[]` without touching it. The return value `tpbError: more && tpbFailed ? true : undefined` is therefore always `undefined`. The client *does* consume it (tor.vue:3008 `if (data?.tpbError)`), so whatever warning the UI is supposed to show when ThePirateBay fails can never appear.
- **Main file**: apps/api/src/search.js (consumer: apps/client/src/components/tor.vue)
- **Severity**: Medium — a designed error-surface is dead; TPB outages look identical to "no results".
- **Difficulty**: Easy — have `searchTpbDirect` signal failure (return null vs [] or set a flag via out-param) and set `tpbFailed` in the `more` branch.
- **Recommendation**: Fix now.

### 14. search.js — noemby and loadall branches are ~70 duplicated lines

- **Summary**: The `isNoEmby` block ([search.js:1114-1186](apps/api/src/search.js#L1114-L1186)) and the `isLoadAll` block ([search.js:1196-1268](apps/api/src/search.js#L1196-L1268)) are identical (group by season, keep season packs, keep S01E01 episodes, same removal-reason logic) except for the log-stage string and reason prefix. Same story on a smaller scale: `searchTpbDirect` vs `searchTpbDirectMovie` differ only in URL query and category set.
- **Main file**: apps/api/src/search.js
- **Severity**: Medium-low — classic divergence trap: a fix applied to one branch and not the other would be very hard to spot.
- **Difficulty**: Easy — extract `selectSeasonPacks(torrents, label)`; parameterize the TPB fetcher by category set.
- **Recommendation**: Fix eventually (next time this selection logic changes, do the extraction first).

### 15. search.js — in-memory IPT/TL cache is dead weight under the fork-per-search architecture

- **Summary**: `iptTlSearchCache` (module-level Map) is written on every base search and read on `more=true`. But searches run via `searchTorrentsInChild` → a **fresh forked process per search** (search-worker.js), so the Map is always empty when `more=true` arrives in a new child; only the tmp-file cache (`writeIptTlCache`/`readIptTlCache`) actually carries data between phases. The Map read/write/delete calls work but never hit. Comment at [search.js:147](apps/api/src/search.js#L147) still describes the in-memory design.
- **Main file**: apps/api/src/search.js
- **Severity**: Low — misleads readers into thinking results are cached in RAM; the real mechanism is the tmpdir JSON file (which also never expires — stale-cache staleness is bounded only by tmpdir cleanup).
- **Difficulty**: Easy — delete the Map and its three uses; optionally add an age check to the file cache.
- **Recommendation**: Fix eventually.

### 16. search.js — "Temporarily override cookies" isn't temporary; env-var log knobs; movie mode searches IPT with TV category

- **Summary**:
  - The `iptCf`/`tlCf` override path re-enables the provider with replacement cookies and never restores the originals — the comment "Temporarily override cookies" ([search.js:573](apps/api/src/search.js#L573)) is only accidentally true because the whole process is a throwaway fork. If searchTorrents were ever called in-process the override would leak into later searches.
  - `TOR_LOG_STDOUT`, `TOR_PROVIDER_SEARCH_MAX`, `TOR_RETURN_MAX` are env-var switches, against the workspace hard-constants rule. With `LOG_APPS_API_DATA_TOR_RESULTS_TXT = false` and no env vars set, the entire torLog/logFilterStage/logProviderSearchResults apparatus is a no-op — yet each search still pays to build label strings and groupings for it. Note: the *active* debug logging (unilog 197/198 dumping every raw title per search) is per the "don't clean up debug logging" standing instruction — left alone, just flagged for volume.
  - Movie mode searches IpTorrents with category "TV" ([search.js:667](apps/api/src/search.js#L667)) while TorrentLeech/TPB/LIM use movie categories. If the custom IPT provider config maps "TV" to an all-categories URL this is deliberate, but as written it looks wrong — worth confirming.
- **Main file**: apps/api/src/search.js
- **Severity**: Low-medium (the movie/TV category question could be a real bug if IPT never returns movie results).
- **Difficulty**: Easy each.
- **Recommendation**: Verify the IPT movie-category question now (one search on the qbt/tor pane); rest eventually.

### 17. usb.js — dead helpers, required-but-ignored QB_PORT, unused import

- **Summary**:
  - Dead functions: `lastNonEmptyLine`, `lastLineStartingWithInt`, `parseLeadingInt` ([usb.js:117-142](apps/api/src/usb.js#L117-L142)) and `fmtGb3` ([usb.js:1014](apps/api/src/usb.js#L1014)) are never called — leftovers from the pre-`quota` space implementation.
  - `loadQbtCreds` *requires* `QB_PORT` (throws if missing/invalid) but the port is never used — every caller builds `https://${qbHost}/qbittorrent/` and destructures `qbPort` into an unused variable (5 call sites). A missing QB_PORT would fail a system that doesn't need it.
  - `preferSharedReadPath` is imported and unused (also unused in download.js).
- **Main file**: apps/api/src/usb.js
- **Severity**: Low — dead code plus a misleading required-config validation.
- **Difficulty**: Easy.
- **Recommendation**: Fix eventually. Decide whether QB_PORT should be used (put it in the URL) or dropped from validation.

### 18. usb.js — qBittorrent login on every API call

- **Summary**: `getQbtInfo`, `delQbtTorrent`, `addQbtTorrent`, `addQbtMagnet`, `recheckQbtTorrent` each call `qbLogin()` fresh. The qbt pane polls torrent info continuously, so every poll is 2 sequential HTTPS round-trips (login + query) and a new qBittorrent session. Caching the SID cookie with re-login on 403 would halve the poll latency and stop session churn.
- **Main file**: apps/api/src/usb.js
- **Severity**: Low-medium — works, but doubles poll latency and hammers the seedbox auth endpoint 24/7.
- **Difficulty**: Easy-moderate — small cookie cache + retry-on-403 wrapper.
- **Recommendation**: Fix eventually.

### 19. usb.js — flexgetHistory's 200-line shell-discovery ladder vs flexgetStatus's one-liner

- **Summary**: `flexgetHistory` implements a login-shell attempt, a "flexget not found" detector, remote login-shell lookup via getent/awk, then an interactive `-tt` PTY fallback with prompt suppression (~[usb.js:366-597](apps/api/src/usb.js#L366-L597)). Meanwhile `flexgetStatus` ([usb.js:1246](apps/api/src/usb.js#L1246)) just runs `~/flexget/bin/flexget status` directly and works — proving the binary's location is known and stable on the one seedbox this ever talks to. The discovery ladder is dead-in-practice complexity (the very first candidate in its own list is `$HOME/flexget/bin/flexget`).
- **Main file**: apps/api/src/usb.js
- **Severity**: Low — convoluted but functioning; big maintenance surface for one ssh call.
- **Difficulty**: Easy — collapse to the direct path (plus the FLEXGET_CMD override already supported).
- **Recommendation**: Fix eventually; safe to leave.

### 20. usb.js / local.js — three copies of the same file-tree builder, two copies of delete

- **Summary**: `getUsbFiles`, `getUsbMovies` (usb.js) and `getLocalFiles` (local.js) are the same ~70-line find-parse-tree-sort routine with tiny diffs (root path, ssh vs local, `numeric` folder sort only in local.js — and only local.js includes time in the date, an accidental inconsistency). `deleteUsbFiles`/`deleteUsbMovies` are identical except the root constant. The duplicated `sshBaseArgs` block appears 8×. The stray "Sort tree? … maybe we want folders first?" musing comment is duplicated into all three copies.
- **Main file**: apps/api/src/usb.js, apps/api/src/local.js
- **Severity**: Low-medium — divergence has already started (numeric sort + timestamp differences between copies).
- **Difficulty**: Moderate-easy — one `buildTreeFromFind(lines)` helper + one `runUsbSsh` helper; parameterize root.
- **Recommendation**: Fix eventually.

### 21. usb.js — prune feature is permanently dry-run

- **Summary**: `PRUNE_DRY_RUN = true` is a hardwired constant, so `pruneUsbFiles` never deletes anything — it reports folders it *would* delete (state/summary lines say "dry-run", so the UI is honest). The `rm -rf` branch is dead code until someone edits the constant.
- **Main file**: apps/api/src/usb.js
- **Severity**: Informational — if this is a deliberate safety latch it's fine; if you believe prune is reclaiming space, it isn't.
- **Difficulty**: n/a (decision, not code).
- **Recommendation**: Leave alone; just be aware.

### 22. server.js — force and non-force download paths are ~300 duplicated lines

- **Summary**: `handleDownloadRequest` contains two nearly complete copies of the fetch→validate→year-guardrail→tv-proc→qbt-add→disambiguate pipeline: the `!forceDownload` branch ([server.js:1600-1927](apps/api/src/server.js#L1600-L1927)) and the force branch ([server.js:1929-2256](apps/api/src/server.js#L1929-L2256)). They've already diverged in accidental ways: only non-force writes the bad-torrent debug dump; only force calls `handoffForcedTorrentToTvDown`; log messages/ids differ; the force branch adds `debug: true` to responses. Intentional differences (force deletes an existing duplicate and re-adds; skips nothing else) are a handful of lines buried in the copies. Also inside: `tagInfoHash` ([server.js:1836-1844](apps/api/src/server.js#L1836-L1844)) is computed and never used, and a `const torTitle = String(...)` at [server.js:2172](apps/api/src/server.js#L2172) shadows the outer `torTitle()` *function* with a string.
- **Main file**: apps/api/src/server.js
- **Severity**: Medium — this is the money path (sending torrents to qBittorrent); duplication here is where a future fix will land on one side only.
- **Difficulty**: Moderate — extract the shared pipeline with a `{ force }` option; needs careful retest of both download modes.
- **Recommendation**: Fix eventually, deliberately (not as a drive-by).

### 23. server.js — dead constants/blocks and a copy-paste comment

- **Summary**:
  - `RECENT_SENT_LOG_PATH` ([server.js:1316](apps/api/src/server.js#L1316)) — dead constant; `logRecentSent` was converted to unilog and the path is never used.
  - `FILTER_TORRENTS = false` with `if (FILTER_TORRENTS && typeof FILTER_TORRENTS === "object" ...)` ([server.js:792-818](apps/api/src/server.js#L792-L818)) — a constant-false condition guarding a 25-line startup dump; the `typeof` check on a hardwired boolean makes it read like it could ever run.
  - `handoffForcedTorrentToTvDown` accepts `tvdbId` and `showName` params that are never used in the body (callers carefully compute and pass them).
  - `QBT_TEST_PORT` is the *production* listen port (3001) — the name says test.
  - Comment "Load SSL certificate (prefer shared cookie store)" ([server.js:554](apps/api/src/server.js#L554)) — the parenthetical is pasted from cookie-loading code and is nonsense here.
  - Small wrappers that only rename: `flexget()` → flexgetHistory, `getRootSecretsDir()` → getSecretsDir, `getSubsTokenReadPath()`/`getSubsTokenWritePath()` are identical.
- **Main file**: apps/api/src/server.js
- **Severity**: Low — reader confusion, no behavior impact.
- **Difficulty**: Trivial-easy.
- **Recommendation**: Fix eventually in one cleanup pass.

### 24. server.js — usb mediainfo srt count ignores the file's base name (differs from local twin) [BUG-ish]

- **Summary**: In `/api/usb/mediainfo` a `baseName` is carefully computed (strip extension, escape quotes, lowercase — [server.js:1161-1164](apps/api/src/server.js#L1161-L1164)) and then **never used**: the remote find counts *every* `*.srt` in the folder ([server.js:1173](apps/api/src/server.js#L1173)). The local twin `/api/local/mediainfo` counts only sidecars whose name starts with the video's base name ([server.js:1294-1303](apps/api/src/server.js#L1294-L1303)). For a season folder with many episodes, the USB `srtsCount` is wildly inflated relative to the local one. Additionally, in both copies the `.chosen` exclusion is ineffective as written: a name can't match/end with `.srt` and `.chosen` at the same time, so unless the convention is literally `x.chosen`, the `-not -iname '*.chosen'` / `!el.endsWith(".chosen")` conditions never exclude anything (if the convention is `x.chosen.srt`, the pattern should be `*.chosen.srt`).
- **Main file**: apps/api/src/server.js
- **Severity**: Medium-low — a displayed count that's wrong in a specific, confusing way.
- **Difficulty**: Easy — add `-iname "${baseName}*.srt"` to the remote find; fix the chosen pattern per the actual sidecar naming (check subsQueue/subFiles naming convention first).
- **Recommendation**: Fix now if the usb pane's srt count matters to you; otherwise eventually.

### 25. server.js / api generally — env-var switches and debug dumps under `/root/dev/apps/tv`

- **Summary**: Rounding up the pattern across the app (some named in earlier sections): `DISABLE_INTERNAL_CORS` ([server.js:577](apps/api/src/server.js#L577)), `TOR_LOG_TORRENT_MAX_BYTES` (download.js), `TOR_LOG_STDOUT`, `TOR_PROVIDER_SEARCH_MAX`, `TOR_RETURN_MAX` (search.js) — all env vars, against the workspace "hard-wired constants" rule. And unconditional debug dumps writing to the deploy dir on validation failures: `/root/dev/apps/tv/temp.txt` + `temp.torrent` (download.js:329-334) and `/root/dev/apps/tv/bad-torrent-<title>.txt` ([server.js:1645](apps/api/src/server.js#L1645)) — the latter accumulates one file per failed title, with .txt extensions holding binary torrent data. Active debug logging via `appendCallsLog`/`appendDownloadsRequestLog`/`appendReviewCallsLog` to `data/misc/*.log|temp.txt` is left as-is per the standing "don't clean up debug logging" instruction — but note none of these files are rotated or capped, so they grow forever on the server.
- **Main file**: apps/api/src/server.js (+ download.js, search.js)
- **Severity**: Medium for the uncapped/unpruned dump files on the server; low for the env vars.
- **Difficulty**: Easy.
- **Recommendation**: Fix the `/root/dev/apps/tv/*` dumps now (redirect into data/misc or delete); env vars whenever touched.

### 26. server.js — `/api/getActorCredits` headed-browser dependency is invisible

- **Summary**: The endpoint runs the IMDb scraper with `headless: false` ([server.js:2793](apps/api/src/server.js#L2793)). This works only because pm2 launches tv-api under `xvfb-run` (verified on the remote). Nothing in the code says so — imdb-credits.js even defaults to `headless = true`, so the one production caller overriding it to headed looks like a mistake and would break silently if the pm2 config ever lost xvfb-run.
- **Main file**: apps/api/src/server.js (context: apps/api/ecosystem.config.cjs / pm2 config on remote)
- **Severity**: Low — works today; a trap for future config edits.
- **Difficulty**: Trivial — one comment at the call site ("headed to reduce IMDb bot detection; requires xvfb-run in pm2 config").
- **Recommendation**: Fix now (it's one comment).

Files examined with no problems worth reporting: apps/api/src/search-worker.js, apps/api/src/tv-proc.js, apps/api/src/normalize.js (heuristic-heavy by nature, but internally consistent), apps/api/ecosystem.config.cjs.

---

## apps/srvr

### 27. fix.js — fix-runner.js exists only on the remote server (second repo-orphaned module)

- **Summary**: `fix.js` spawns `./fix-runner.js` ([fix.js:9-11](apps/srvr/src/fix.js#L9-L11)), but fix-runner.js is not in the repo, has no git history, and is *not* gitignored — it exists only at `hahnca.com:/root/dev/apps/tv/apps/srvr/src/fix-runner.js`. Unlike qb-cred.js (which was deliberately gitignored as cred-adjacent), this one looks like it was simply never committed. Same risks: unreviewable, unrecoverable from the repo, breaks on a clean deploy.
- **Main file**: apps/srvr/src/fix.js (missing: apps/srvr/src/fix-runner.js)
- **Severity**: High (same class as finding 1).
- **Difficulty**: Trivial — `scp` it back into the repo and commit.
- **Recommendation**: Fix now.

### 28. util.js — the shared writeFile queue can silently drop the newest write [BUG]

- **Summary**: `writeFile(path, data)` stores `dataByPath[path] = data` and `chkWriteFile` writes it. But if a second `writeFile(path, data2)` arrives while a write for the same path is in flight (`busyByPath[path]` set), the in-flight completion handler unconditionally runs `delete dataByPath[path]` and resolves *all* accumulated resolvers ([util.js:97-99](apps/srvr/src/util.js#L97-L99)) — including data2's. Result: data2 is never written to disk, yet its caller's promise resolves as success. The final `if (anyWritten) await chkWriteFile()` re-scan finds nothing because the entry was just deleted. Additionally, the catch path ([util.js:101-106](apps/srvr/src/util.js#L101-L106)) resolves the promises on a *failed* write — callers can't distinguish success from failure.
- **Main file**: apps/srvr/src/util.js (used by tvdb.js persistence and other srvr writers)
- **Severity**: High-medium. This is the write path for tvdb.json state. In steady state the periodic save loop rewrites the full snapshot so the loss self-heals on the next save, but any "save right before exit/restart" or one-shot writer can lose its final write — and the CLAUDE.md history shows tvdb.json corruption has real cost here.
- **Difficulty**: Easy-moderate — capture the resolver list and data at write start (swap `resolvesByPath[path] = []` *before* the write), and after the write only delete `dataByPath[path]` if it still `===` the captured data, otherwise loop again. Reject (or at least don't resolve) on failure.
- **Recommendation**: Fix now.

### 29. asr.js / fix.js — MEDIA_ROOT boundary check allows sibling paths

- **Summary**: Both use `targetPath.startsWith(MEDIA_ROOT)` with `MEDIA_ROOT = "/mnt/media/tv"` ([asr.js:79](apps/srvr/src/asr.js#L79), [fix.js:183](apps/srvr/src/fix.js#L183)). `"/mnt/media/tv-errors/..."` (a real sibling dir in this system) passes the check, as would any `/mnt/media/tvXYZ`. Not a security issue on this LAN, but the guard doesn't enforce the boundary it claims; an asr/fix run pointed at tv-errors would operate outside the intended tree.
- **Main file**: apps/srvr/src/asr.js, apps/srvr/src/fix.js
- **Severity**: Low.
- **Difficulty**: Trivial — compare against `MEDIA_ROOT + "/"` (or `path.relative` without `..`).
- **Recommendation**: Fix eventually.

### 30. lastViewed.js — comment says fail-fast but code does the opposite; repeat views never refresh

- **Summary**: (a) The catch around the initial load says "Fail fast: lastViewed is required state" ([lastViewed.js:27](apps/srvr/src/lastViewed.js#L27)) but the code *recovers* by recreating the file — the comment describes a policy the code doesn't implement (and per workspace rules it arguably should die fast instead). (b) `recordNowPlaying` skips when `showName === lastRecordedShowName` ([lastViewed.js:41](apps/srvr/src/lastViewed.js#L41)) — if you watch the same show again days later (with no other show in between and no srvr restart), its lastViewed timestamp is never updated. The dedupe guard should be time-based, not identity-based.
- **Main file**: apps/srvr/src/lastViewed.js
- **Severity**: Low-medium — (b) quietly degrades the "last viewed" ordering for the common binge case.
- **Difficulty**: Trivial — also update when `Date.now() - lastViewed[showName]` exceeds some window, or just always write (it's throttled naturally by now-playing polling).
- **Recommendation**: Fix (b) now, (a) whenever touched.

### 31. urls.js — near-duplicate of client urls.js, with whitespace-stripping template trick

- **Summary**: The file header says "copied from client urls.js" — a hand-maintained duplicate of the emby URL builders (`apiKey`, user id, and server id constants duplicated too). The `.replace(/\s*/g, "")` trick (strip ALL whitespace from multi-line templates) silently corrupts any interpolated value containing spaces; today every interpolation is an id or pre-encoded name, so it works, but it's a trap (e.g. someone adds `&SearchTerm=${name}`). Also `embyPageUrl`'s odd `#!` template survives only because of the stripping.
- **Main file**: apps/srvr/src/urls.js (twin: apps/client/src/urls.js)
- **Severity**: Low — works; duplication means emby URL changes must be made twice.
- **Difficulty**: Moderate to unify (client vs server import paths); trivial to at least comment the constraint.
- **Recommendation**: Leave alone for now; unify into packages/share if urls change again.

### 32. email.js + repo root — Mailtrap API token committed to the repo

- **Summary**: `MAILTRAP_TOKEN = "2cd4e557..."` is hardcoded in [email.js:4](apps/srvr/src/email.js#L4) and the same token also sits in `mailtrap-token.txt` at the repo root (tracked or not, it's on the local PC). Workspace rules say secrets live only on the remote. The hard-wired-constants rule covers config values, but this is a live API credential in git history.
- **Main file**: apps/srvr/src/email.js, mailtrap-token.txt
- **Severity**: Medium-low (blast radius = someone with repo access can send email as the mailtrap account).
- **Difficulty**: Easy — move to `apps/srvr/secrets/` on the remote (read at startup, die fast if missing), delete mailtrap-token.txt, rotate the token.
- **Recommendation**: Fix eventually (rotate + relocate); flagging because it contradicts the stated no-local-secrets policy.

### 33. config.js — dead `firstExistingPath`, vestigial candidate-list plumbing

- **Summary**: `firstExistingPath` is exported and never used anywhere. `configReadCandidates` returns a single-element array (the comment admits config now has exactly one owner), so `readTextOrWithChosenPath`'s multi-path loop and `readTextOr`'s array support are one-caller generality left over from the old shared-config design.
- **Main file**: apps/srvr/src/config.js
- **Severity**: Low.
- **Difficulty**: Easy.
- **Recommendation**: Fix eventually — delete firstExistingPath now, simplify the rest opportunistically. (Note: `readTextOr`'s fallback behavior is at odds with the workspace "no file-missing fallbacks — die fast" rule; worth auditing its call sites for required-vs-optional files.)

### 34. tmdb.js — stale JSDoc, pointless alias, sequential image fetches

- **Summary**: `getTmdb(params)`'s JSDoc documents a 4-arg `(id, param, resolve, reject)` WebSocket signature that no longer exists ([tmdb.js:5-11](apps/srvr/src/tmdb.js#L5-L11)); first line of the body is `const data = params;` — a rename with no purpose. Guest-actor images are fetched one-by-one in a loop ([tmdb.js:82-92](apps/srvr/src/tmdb.js#L82-L92)) — `Promise.all` would cut episode-info latency by ~Nx. The TMDB api key literal is duplicated (client constructor + fallback URL).
- **Main file**: apps/srvr/src/tmdb.js
- **Severity**: Low.
- **Difficulty**: Easy.
- **Recommendation**: Fix eventually.

Small srvr files examined, no problems: embyConfig.js, srvrPaths.js, batchQueue.js, groupCounts.js, messaging.js, loid.js, badGroups.js, emb.js (remote-path constant is correct for where it runs), videoFiles.js, flexgetScore.js, srt.js, bif.js, bifQueue.js (well-structured; lock/queue handling is careful).


