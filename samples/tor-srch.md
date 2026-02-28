# searchTorrents Operation

Defined in [apps/api/src/search.js](apps/api/src/search.js). Called from the API server endpoint in [apps/api/src/server.js](apps/api/src/server.js).

## Parameters

| Param      | Description                                                                         |
| ---------- | ----------------------------------------------------------------------------------- |
| `showName` | Show name to search for (may include year in parens, e.g. `"Fallout (2024)"`)       |
| `limit`    | Max results to request from each provider (default 1000)                            |
| `iptCf`    | Optional `cf_clearance` cookie value to override for IPTorrents                     |
| `tlCf`     | Optional `cf_clearance` cookie value to override for TorrentLeech                   |
| `needed`   | Array of `S##` / `S##E##` strings, or special tokens (`loadall`, `noemby`, `force`) |

---

## Pipeline

### 1. Provider Cookie Override

If `iptCf` or `tlCf` are provided, the corresponding provider is re-enabled with the new `cf_clearance` cookie replacing any existing one. For IPTorrents, the custom provider config is reloaded from disk and patched with the SSH tunnel.

### 2. Query Construction

- Show name is sanitized: non-alphanumeric chars replaced with spaces, whitespace collapsed.
- If the name ends with a parenthetical (e.g. `(2024)`), a second variant without it is also produced.
- Duplicate queries (case-insensitive) are removed.

### 3. Provider Search

`TorrentSearchApi.search(query, "TV", limit)` is called for each unique query in parallel. Results are flattened and deduplicated by `provider|title` key. Raw per-provider counts are recorded at this stage (used by the client for cookie-warning logic).

### 4. Normalize

Each raw torrent is passed through `normalize(t, showName)`, which parses the title (season, episode, resolution, bit depth, etc.) and sets a `nameMatch` flag.

### 5. Name Match Filter

Torrents where `nameMatch` is false are dropped.

### 6. Year Extraction

A year is extracted from the torrent title (looks for `(YYYY)` or a bare 4-digit year surrounded by non-alphanumeric chars) and attached to `raw.year`.

### 7. Detail URL

- TorrentLeech: `https://www.torrentleech.org/torrent/{fid}#torrentinfo`
- IPTorrents: the raw `desc` field

### 8. TV-Only Filter

Drops torrents with no season info. Season-range torrents (e.g. `S01-S05`) are kept even when `parsed.season` is absent.

### 9. Year Filter

If the show name contains a year in parens (e.g. `(2024)`), torrents whose extracted `raw.year` does not match are dropped. Torrents with no extractable year pass through.

### 10. Excluded Strings Filter

Torrents whose titles contain any of `"2160"`, `"nordic"`, or `"mobile"` are dropped.

### 11. Warnings (no filtering)

Warnings are attached to individual torrents but they are **not** filtered out:

- `low_res_480` — title/resolution indicates 480p
- `zero_seeds` — seed count is 0 or missing

### 12. SeasonEpisode Assignment

A display string (`S##` or `S##E##`) is computed and stored on each torrent.

### 13. Mode-Based Filtering (driven by `needed`)

| Mode                            | Behavior                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `force`                         | All torrents returned, no further filtering                                                                                                 |
| `noemby`                        | All season packs; episode torrents only for seasons that have no pack. S01E01 also included when S01 has a pack.                            |
| `loadall`                       | Same logic as `noemby`                                                                                                                      |
| Specific `S##`/`S##E##` entries | Only torrents matching the listed seasons/episodes are kept. Season-range torrents are matched if any needed season falls within the range. |
| Empty `needed`                  | No additional filtering                                                                                                                     |

### 14. Sort Order

Remaining torrents are sorted by (priority order):

1. Season number (ascending)
2. Kind: season pack (0) < season range (1) < episode (2)
3. Within range torrents: end season ascending
4. Within episodes: episode number ascending
5. 1080p before 720p
6. 10-bit before 8-bit
7. More seeds first
8. Larger size first
9. TorrentLeech before IPTorrents

### 15. Return

Returns the filtered, sorted torrent array. The caller also receives `rawProviderCounts` (counts before filtering) and a `warningSummary` (aggregated warning counts across returned torrents).

---

## Return Value

The function returns a single object:

```json
{
  "show": "<showName>",
  "count": 42,
  "torrents": [ ... ],
  "rawProviderCounts": { "TorrentLeech": 310, "IpTorrents": 87 },
  "warningSummary": { "zero_seeds": 5, "low_res_480": 2 }
}
```

| Field               | Type   | Description                                                                                                                                 |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `show`              | string | The show name that was searched                                                                                                             |
| `count`             | number | Length of the `torrents` array                                                                                                              |
| `torrents`          | array  | Filtered, sorted torrent objects (see below)                                                                                                |
| `rawProviderCounts` | object | Per-provider counts **before** any filtering — `{ ProviderName: n }`. Used by the client to decide whether to show cookie-missing warnings. |
| `warningSummary`    | object | Count of each warning code across all returned torrents — `{ code: n }`                                                                     |

---

## Torrent Object Structure

Each element of `torrents` has the following shape:

### `parsed` — title parse results (from `parse-torrent-title`)

| Field                  | Type                | Example              | Description                                                    |
| ---------------------- | ------------------- | -------------------- | -------------------------------------------------------------- |
| `parsed.title`         | string              | `"Fallout"`          | Show title as parsed from the torrent title                    |
| `parsed.season`        | number \| undefined | `2`                  | Season number                                                  |
| `parsed.episode`       | number \| undefined | `5`                  | Episode number; absent for season packs                        |
| `parsed.resolution`    | string \| undefined | `"1080p"`            | Resolution string                                              |
| `parsed.bitDepth`      | number \| undefined | `10`                 | Bit depth (10 for HDR/10-bit encodes)                          |
| `parsed.year`          | number \| undefined | `2024`               | Year from torrent title, if any                                |
| `parsed.seasonEpisode` | string \| undefined | `"S02"` / `"S02E05"` | Computed display label added by `searchTorrents` after parsing |

### `seasonRange` — season-range pack info

Present (non-null) only when the title matches a range pattern like `S01-S05`.

| Field                     | Type   | Description                              |
| ------------------------- | ------ | ---------------------------------------- |
| `seasonRange.isRange`     | `true` | Always true when object is present       |
| `seasonRange.startSeason` | number | First season in range                    |
| `seasonRange.endSeason`   | number | Last season in range                     |
| `seasonRange.fullMatch`   | string | The substring matched (e.g. `"S01-S05"`) |

### `group` / `groupSrc`

| Field      | Type                  | Description                                                             |
| ---------- | --------------------- | ----------------------------------------------------------------------- |
| `group`    | string \| null        | Release group name, uppercased (e.g. `"DEFLATE"`)                       |
| `groupSrc` | `"parse"` \| `"calc"` | Whether group came from `parse-torrent-title` or was extracted manually |

### `nameMatch`

`boolean` — `true` if the torrent's parsed title matched the searched show name. Torrents where this is `false` are filtered out before being returned, so all returned torrents have `nameMatch: true`.

### `clientTitle`

`string` — Echo of the `showName` argument passed to `searchTorrents`.

### `raw` — original provider record

The untouched object returned by `TorrentSearchApi`, with two fields added by `searchTorrents`:

| Field          | Type                | Description                                                                                   |
| -------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `raw.title`    | string              | Full torrent title as listed by the provider                                                  |
| `raw.provider` | string              | Provider name, e.g. `"TorrentLeech"`, `"IpTorrents"`                                          |
| `raw.seeds`    | number              | Seed count reported by provider                                                               |
| `raw.size`     | string              | Size string as reported, e.g. `"4.50 GB"`                                                     |
| `raw.fid`      | string \| undefined | TorrentLeech numeric torrent ID (used to build `detailUrl`)                                   |
| `raw.desc`     | string \| undefined | IPTorrents detail URL (used as `detailUrl`)                                                   |
| `raw.year`     | number \| undefined | **Added by `searchTorrents`**: lowest 4-digit year extracted from the title (1950–2049 range) |

### `detailUrl`

`string | undefined` — Direct link to the torrent's detail page on its provider:

- TorrentLeech: `https://www.torrentleech.org/torrent/{raw.fid}#torrentinfo`
- IPTorrents: value of `raw.desc`

### `warnings`

Array of `{ code, message }` objects attached by `searchTorrents`. Torrents with warnings are **not** filtered out; the client decides how to handle them.

| Code            | Message                   | Condition                                  |
| --------------- | ------------------------- | ------------------------------------------ |
| `"low_res_480"` | `"Low resolution (480p)"` | `parsed.resolution` or title contains 480p |
| `"zero_seeds"`  | `"No seeds (seeds=N)"`    | `raw.seeds` is 0 or missing                |

### `notorrent`

`boolean | undefined` — When `true`, marks a dummy/placeholder torrent. These are sorted to the end of the array.

---

## Client-Side Counterpart

`searchTorrents(show)` in [apps/client/src/components/tor.vue](apps/client/src/components/tor.vue) is a UI method that:

1. Resets all torrent display state.
2. Kicks off a disk-space fetch immediately.
3. Short-circuits if `show.S1E1Unaired` is set.
4. Calls `calculateNeeded(show)` to build the `needed` array.
5. Short-circuits with "nothing needed" if `needed` is empty.
6. Posts to the API endpoint which runs the server-side `searchTorrents` above.
