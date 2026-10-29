// Self-check for the provider page subtitle reader: node torrentSubtitles.check.js
import assert from "node:assert/strict";
import { analyzePageText, findTorrentDownloadUrls, judgeWithFiles } from "./torrentSubtitles.js";
import { unilog } from "@tv/share";

// A TL detail page holding the given NFO text, then a comments section.
const page = (nfo, comments = "") =>
  `<div>Torrent Description</div><pre>${nfo}</pre><div>Comments</div><div>${comments}</div>`;
const status = (nfo) => analyzePageText(page(nfo)).status;

// CAKES NFO: a Subtitles heading over Count / Tracks.
assert.equal(
  status(
    "── Audio ───────\nFormat ....: Dolby Digital Plus\nLanguage ..: English\n" +
      "── Subtitles ───────\nCount .....: 1\nTracks ....: American English [SDH]",
  ),
  "yes",
);

// ETHEL NFO: a Subs line with a count and languages, between Audio and Source.
assert.equal(
  status(
    "Audio        : English E-AC-3 384 kb/s\nSubs         : 2: English, Spanish\nSource       : PEACOCKTV",
  ),
  "yes",
);

// IPT page: a Subtitle(s) line after the Audio block.
assert.equal(
  analyzePageText(
    "Size: 2.90 GB in 2 files<br />\nAudio:<br />\n Codec : E-AC-3<br />\n Language(s) : English (US)<br />\n<br />\n" +
      "Subtitle(s) : English (US), English (US)<br />\n<br />\nScreenshots:<br />\nThank Uploader<br />",
  ).status,
  "yes",
);

// A plain label with a language.
assert.equal(status("Language: English\nSubtitles: English"), "yes");

// No tracks listed: an English audio line above must not read as "English Subtitles".
assert.equal(status("Language......: English\nSubtitles.....: N/A\nTotal Size....: 32 GB"), "no");
assert.equal(status("Subtitles: None"), "no");
assert.notEqual(status("── Subtitles ───────\nCount .....: 0"), "yes");
assert.notEqual(status("Subs         : none"), "yes");
assert.notEqual(status("Subtitle(s) :\nScreenshots:"), "yes");

// A release name and nothing else: the page does not say.
assert.equal(status("Accidentally.On.Purpose.(2009).Season.1.S01.(1080p.AMZN.WEB-DL.x265.MONOLITH)"), "maybe");

// A login page is a failed fetch, not a no.
assert.equal(
  analyzePageText("<title>Login :: TorrentLeech.org</title><form><input type=password></form>").source,
  "error",
);

// Comments are not the release's notes.
assert.equal(analyzePageText(page("Some.Show.S01E01.1080p.WEB", "English subtitles please? no srt?")).status, "maybe");

// The word "text" ahead of MediaInfo fields is not a Text track.
assert.equal(
  status("Plain text notes follow.\nGeneral\nFormat : Matroska\nVideo\nFormat : AVC"),
  "maybe",
);

// A MediaInfo with General, Video and Audio but no Text track is a no.
assert.equal(
  status("General\nFormat : AVI\nVideo\nCodec ID : XVID\nAudio\nCodec ID : MP3\nLanguage : English"),
  "no",
);

// A TL page with an NFO but no Torrent Description is still a detail page.
assert.equal(
  analyzePageText("<div>NFO</div><pre>Subs : 2: English, Spanish</pre><div>Comments</div>").status,
  "yes",
);

// MediaInfo Text tracks: a full one is a yes, forced ones alone are a no.
const textTrack = (forced) =>
  `Text #1\nID : 3\nFormat : UTF-8\nCodec ID : S_TEXT/UTF8\nLanguage : English\nForced : ${forced}\n`;
assert.equal(analyzePageText(page(textTrack("No"))).source, "page-mediainfo");
assert.equal(status(textTrack("Yes")), "no");
assert.notEqual(status("Forced subtitles"), "yes");
assert.notEqual(status("Subtitles: English (Forced)"), "yes");
assert.equal(status("Subtitles: English, English (Forced)"), "yes");

// A page's own .torrent link: IPT's page-relative links resolve from the site
// root, and related releases' links are left out.
assert.deepEqual(
  findTorrentDownloadUrls(
    '<a href="download.php/7710512/Other.Release.torrent">x</a>' +
      '<a href="download.php/7730289/Next%20Gen%20NYC%20S02E13.torrent">x</a>',
    "https://iptorrents.com/t/7730289",
  ),
  ["https://iptorrents.com/download.php/7730289/Next%20Gen%20NYC%20S02E13.torrent"],
);
assert.deepEqual(
  findTorrentDownloadUrls(
    '<a href="/download/241745403/Rooster.S01E06.torrent">x</a>',
    "https://www.torrentleech.org/torrent/241745403",
  ),
  ["https://www.torrentleech.org/download/241745403/Rooster.S01E06.torrent"],
);

// The file list: an .srt is a yes; all-.avi videos are a no unless the page says yes.
const unsure = { status: "maybe", confidence: "low", source: "page-text" };
assert.equal(judgeWithFiles(unsure, ["Show/S01E01.avi", "Show/S01E01.srt"]).status, "yes");
assert.equal(judgeWithFiles(unsure, ["Show/S01E01.avi", "Show/S01E02.avi", "Show/info.nfo"]).status, "no");
assert.equal(judgeWithFiles(unsure, ["Show/S01E01.mkv"]).status, "maybe");
assert.equal(judgeWithFiles({ ...unsure, status: "yes" }, ["Show/S01E01.avi"]).status, "yes");

unilog(3095, "torrentSubtitles.check ok");
