# Torrent Subtitle Detection Algorithm

The implementation is in `apps/api/src/torrentSubtitles.js` and is exposed by:

- `GET /api/tor/subs?url=<provider detail url>`
- `POST /api/tor/chk-subs`, where each result now includes `providerSubs`

The detector returns `yes`, `no`, or `maybe` with `confidence`, `source`, `reason`, and short `evidence`.

## Order of Checks

1. Fetch the IPTorrents or TorrentLeech detail page through the existing USB SSH curl path and provider cookies.
2. Look for a `.torrent` download link on the detail page.
3. If a `.torrent` file is reachable, parse its metadata first.
   - Any `.srt` path is a high-confidence `yes`.
   - If metadata only shows packed archives (`.rar`, `.rNN`, `.001`) and no page-text proof exists, return `maybe` because embedded subtitles cannot be verified without unpacking.
4. If no `.srt` is proven from metadata, score the provider page text.
5. Strip common provider chrome before scoring so TorrentLeech UI text like `Download Subtitles`, `Search subtitles`, and unrelated deleted-torrent notices do not count.
6. Strip `Audio` sections before using language mentions so `Language: eng` from audio tracks does not count as subtitle evidence.

## Page-Text Signals

High-confidence `yes`:

- MediaInfo-style `Text` section, such as `Text`, `Text #1`, `Codec ID: S_TEXT`, or nearby `Format`, `Language`, `Default`, or `Forced` fields.

Medium-confidence `yes`:

- Explicit subtitle wording, such as `English subtitles`, `subtitles included`, `embedded subtitles`, `muxed subtitles`, or `srt`.

Medium-confidence `no`:

- Explicit no-subtitle wording, such as `no subtitles`, `without subtitles`, or `subtitles: none`.
- No `.srt`, MediaInfo `Text`, explicit subtitle wording, or useful group prior found.

Low-confidence `maybe`:

- Known positive release-group prior but no direct proof. Current positive priors from the examples: `d3g`, `ETHEL`, `FraMeSToR`, `HETeam`, `KRATOS`, `MORON`, `OUIJA`, `SiGMA`, `XEBEC`.
- Packed archive metadata with no direct page-text proof.

Low-confidence `no`:

- Known negative release-group prior. Current negative prior: `MeGusta`.

Language mentions outside audio sections are recorded as evidence but are not enough by themselves to return `yes` or `maybe`; they were too noisy in the examples.

## Example Validation

Against `subs-yes.txt` and `subs-no.txt` after implementation:

- `subs-yes.txt`: 11 `yes`, 5 `maybe`, 0 `no`
- `subs-no.txt`: 19 `no`, 15 `maybe`, 0 `yes`

The important guardrail is that the detector avoids hard contradictions: no known-positive example returns `no`, and no known-negative example returns `yes`. The `maybe` cases are mostly weak release-group priors or packed/inconclusive metadata.
