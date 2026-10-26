# Plan: eztv as a third flexget feed

Goal: flexget's `fetch-feeds` task takes `https://myrss.org/eztv` beside
iptorrents and torrentleech, and tv-srvr handles its entries the way it handles
theirs: provider tag, dedup, size, choice and send to qbt.

## What was checked (10-26)

- The feed: 30 items covering about 4 h 20 min, so the 15-minute cron misses
  nothing. Titles use spaces ("Big Brother AU S17E01 1080p HEVC x265-MeGusta").
  `normTitle` strips them, so the same release from ipt or tl still counts as
  the same file.
- flexget's dump of an eztv entry has `title`, `url`, `original_url`, `guid`,
  `size` (bytes), `rss_pubdate`, `filename`, `type` and `quality`. It has no
  `description` and no `content_size`, so the current parser gets neither a
  size nor seeds for it.
- `url` is a `zoink.ch/d/<token>` link. It serves the `.torrent` directly (200,
  application/x-bittorrent, no redirect), from hahnca.com and from the usb
  server, so qbt can fetch it. **The token is new on every fetch**: the same
  item (guid `eztvx.to/ep/3176287/...`) had two different urls one minute
  apart. `guid` stays the same. ipt and tl also have stable guids
  (`iptorrents.com/t/<id>`, `torrentleech.org/torrent/<id>`).
- The file inside is a single file named like
  `Big.Brother.AU.S17E01.1080p.HEVC.x265-MeGusta[EZTVx.to].mkv`.
  parse-torrent-title reads it correctly (group `MeGusta`, the bracket goes to
  `tracker`). tv-down and `isBadGroup` both name files through
  parse-torrent-title.

## 1. Feed line in the header (required)

The line added by hand to the server's `config.yml` will be lost:
`upload()` (`apps/srvr/index.js:566`) writes `config.yml` again from
`config1-header.txt` + pickups + footer every time tv-srvr starts and every
time the pickups are saved. The header on the server is the same as the one
in this repo, and neither has the line.

- Add `      - rss: https://myrss.org/eztv` as the last entry under `inputs:` in
  `apps/srvr/config/config1-header.txt`. The `srvr` script copies it (it skips
  only the config2/config4 json files).
- Keep it last: a tie between two copies of a release in one run goes to the
  earlier one (the order the inputs are listed), so ipt and tl win over eztv.

## 2. Stable dedup by guid (`apps/srvr/src/flexget.js`)

Because the url changes on every fetch, both url checks fail for eztv:
- the fast path at line 244 ("URL already seen") never matches;
- `storeFlexgetRejectedCandidate` (line 213) dedups by url only, and it runs
  before the title+quality check. A watched or past-next-season eztv entry
  would be stored again every 15 minutes for as long as it stays in the feed
  (up to about 17 copies each).

Change:
- `parseFlexgetDumpOutput`: add `guid: null` to a new entry and read
  `key === "guid"`.
- Store `guid` on both history entry shapes (the rejected one at line 216 and
  `newCandidate` at line 331).
- Both checks match on `(candidate.guid && c.guid === candidate.guid) ||
  c.url === candidate.url`. Rows already in `flexget-history.json` have no
  guid, so the url check stays.

## 3. Provider `eztv`

The url ternary appears at lines 228 and 343, line 172 tests for tl, and
`localHistory.js:314` (`flexProvider`) has another copy.

- One exported `providerOf(c)` in `flexget.js`: `ipt` for an `iptorrents.com`
  url, `tl` for `torrentleech.org`, `eztv` when the guid's host is `eztvx.to`
  (not the `zoink.ch` url: that's only a download host and may change), else
  null.
- Use it at 228 and 343, and at 172 as `providerOf(c) === "tl"` (no change in
  behavior).
- `localHistory.js` `flexProvider`: `entry.provider || flexget.providerOf(entry)
  || "unknown provider"`. New rows carry `provider` anyway; this only covers
  old rows.

## 4. Size

- In the parser, `key === "size"` fills `content_size` when it is still null,
  written as "1.72 GB" like ipt's so the flex pane dialog reads the same.
  `sizeToBytes` reads that back.
- ipt also sends `size`, but its `description` comes first in the dump and
  already sets `content_size`, so nothing changes for ipt. tl sends no `size`.

## 5. Seeds and tracker

- eztv entries have no seeds (the feed's own `torrent:seeds` is 0 when an item
  is posted, and flexget doesn't read it). `torrent_seeds` stays null and
  `compareRelease` skips seeds whenever either side has none.
- Decided 10-26: the `tracker` factor ranks TL > IPT > EZTV (3, 2, 1, compared
  as a number), so a private copy beats an equal public one. The tor pane
  still sends true for torrentleech, which counts as 1, so it is unchanged.
  An eztv copy posted before the ipt/tl copy of the same release is still
  sent, and the later private copy is then dropped as "same file from
  different provider".
- qbt: unchanged. The add is still the full torrent, started. eztv is public,
  so hit-and-run rules don't apply to it.

## 6. Plot pane

The Down histogram stacks four series: Tor, TL, IPT, EZTV. Flexget's sends
per day and feed come from its sent history (the same days as its SENT log
lines), taken out of the day's downloads TL first; what is left is Tor.

## Not touched

- `apps/api/src/usb.js:921,933` (`["ipt", "tl"]`): the usb server's own old
  flexget status check with tasks named ipt and tl. Not this feed.
- `flex.vue`: shows `provider` as plain text, so `eztv` appears without a
  change.
- The tor pane's eztv search (`search.js`, `download.js`): a separate path.

## Deploy and verify

1. `./srvr srvr`, then check pm2 logs for crashes and restarts.
2. `config.yml` on hahnca.com has the eztv line after the restart, and the
   next run's `flexget.log` shows about 30 more entries produced (about 1282
   instead of about 1252).
3. When the first eztv entry for a library show is accepted, its history row
   has `provider: "eztv"`, a `guid`, a readable `content_size`, and a real
   `quality` (not flexget's `<LazyField ...>` text). The next run logs "URL
   already seen" for it and does not add a second row.
4. If it is sent: qbt fetches the zoink link, and tv-down lands the
   `...[EZTVx.to].mkv` file under the right episode.
