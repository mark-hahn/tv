// Self-check for the provider page subtitle reader: node torrentSubtitles.check.js
import assert from "node:assert/strict";
import { analyzePageText } from "./torrentSubtitles.js";
import { unilog } from "@tv/share";

const status = (nfo) => analyzePageText(`<pre>${nfo}</pre>`).status;

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

// No tracks listed.
assert.notEqual(status("── Subtitles ───────\nCount .....: 0"), "yes");
assert.notEqual(status("Subs         : none"), "yes");

// A release name and nothing else.
assert.equal(status("Accidentally.On.Purpose.(2009).Season.1.S01.(1080p.AMZN.WEB-DL.x265.MONOLITH)"), "no");

unilog(3095, "torrentSubtitles.check ok");
