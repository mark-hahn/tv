// Self-check for src/subOrigin.js against real OpenSubtitles results.
// Run: node apps/srvr/scripts/check-sub-origin.js (silent when it passes)
import assert from "node:assert";
import { sameOrigin, releaseKey, sidecarType, sidecarLabel, srtContent } from "../src/subOrigin.js";

const row = (o) => ({
  hearingImpaired: 0,
  hd: 0,
  foreignPartsOnly: 0,
  aiTranslated: 0,
  machineTranslated: 0,
  fps: 0,
  comments: "",
  ...o,
});

// One person's batch, minutes apart.
const tinklesE1 = row({ season: 1, episode: 1, title: "Pilot", uploaderId: 215338, uploadDate: "2021-12-06T17:45:00Z", fps: 29.97, release: "Breaking Bad S01E01 Pilot.DVDRip.NonHI.cc.en.SNY" });
const tinklesE2 = row({ season: 1, episode: 2, title: "Cat's in the Bag...", uploaderId: 215338, uploadDate: "2021-12-06T17:45:40Z", fps: 29.97, release: "Breaking Bad S01E02 Cat's in the Bag.DVDRip.NonHI.cc.en.SNY" });
assert(sameOrigin(tinklesE1, tinklesE2));
assert(!sameOrigin(tinklesE1, { ...tinklesE2, hearingImpaired: 1 }));
assert(!sameOrigin(tinklesE1, { ...tinklesE2, uploadDate: "2021-12-08T17:45:00Z" }));
assert.equal(releaseKey(tinklesE1), releaseKey(tinklesE2));

// The import bot: uploader and date mean nothing, the release name decides.
const knightsE3 = row({ season: 1, episode: 3, title: "Operation: Fighting Shape", uploaderId: 3282, uploadDate: "2014-07-04T12:28:56Z", release: "The Knights of Prosperity - 01x03 - Operation- Fighting shape.Unspecified.English.orig.Addic7ed.com" });
const knightsE4 = row({ season: 1, episode: 4, title: "Operation: Deliver the Case", uploaderId: 3282, uploadDate: "2009-11-21T00:04:28Z", release: "the.knights.of.prosperity.s01e04.hdtv.xvid-xor" });
assert(!sameOrigin(knightsE3, knightsE4));
const krisszE1 = row({ season: 1, episode: 1, title: "Pilot", uploaderId: 3282, uploadDate: "2013-08-24T21:38:00Z", hd: 1, fps: 25, release: "Breaking.Bad.S01E01.BDRIP.x264.Hun.Eng-Krissz" });
const krisszE2 = row({ season: 1, episode: 2, title: "Cat's in the Bag...", uploaderId: 3282, uploadDate: "2013-08-25T11:02:00Z", hd: 1, fps: 25, release: "Breaking.Bad.S01E02.BDRIP.x264.Hun.Eng-Krissz" });
assert(sameOrigin(krisszE1, krisszE2));

// The same rip under the bot and under a person.
const rewardE1 = row({ season: 1, episode: 1, title: "Pilot", uploaderId: 3282, uploadDate: "2011-06-09T11:32:00Z", hd: 1, fps: 23.976, release: "Breaking.Bad.S01.720p.BluRay.X264-REWARD" });
const rewardE2 = row({ season: 1, episode: 2, title: "Cat's in the Bag...", uploaderId: 45901, uploadDate: "2011-06-09T11:32:00Z", hd: 1, fps: 23.976, release: "Breaking.Bad.S01.720p.BluRay.X264-REWARD" });
assert(sameOrigin(rewardE1, rewardE2));

// Anonymous imports that carry the pack's url in the comments.
const anonE1 = row({ season: 1, episode: 1, title: "Pilot", uploaderId: null, release: "Breaking Bad S01E01 Pilot", comments: "NON-HI\nImported from subscene.com/x" });
const anonE2 = row({ season: 1, episode: 2, title: "Cat's in the Bag...", uploaderId: null, release: "Breaking Bad S01E02 Cats in the Bag", comments: "NON-HI\nImported from subscene.com/x" });
assert(sameOrigin(anonE1, anonE2));

assert.equal(sidecarType("T3"), "T");
assert.equal(sidecarType("mb4"), "T");
assert.equal(sidecarType("H5"), "H");
assert.equal(sidecarType("opnCYR4Q"), "V");
assert.equal(sidecarType("asr"), "+");
assert.equal(sidecarType("en"), "S");
assert.equal(sidecarType(""), "S");
assert.equal(sidecarLabel("opnCYR4Q"), "v CYR4Q");
assert.equal(sidecarLabel("opnCYR4Q", "L"), "vL CYR4Q");
assert.equal(sidecarLabel("T3", "LS"), "tLS3");
assert.equal(sidecarLabel("H10", "S"), "hS10");
assert.equal(sidecarLabel("S2"), "s2");
assert.equal(sidecarLabel("mb4"), "t4");
assert.equal(sidecarLabel("en"), "s en");
assert.equal(sidecarLabel("en", "S"), "sS en");
assert.equal(sidecarLabel(""), "s");
assert.equal(sidecarLabel("asr"), "+");

const cue = (n, text) => `${n}\n00:00:0${n},000 --> 00:00:0${n},900\n${text}\n`;
const srt = (lines) => lines.map((t, i) => cue(i + 1, t)).join("\n");
const dialogue = ["Hello.", "Where were you?", "Out."];
const sounds = ["[door slams]", "(sighs)", "ROSE: Come in.", "[phone buzzing]", "- [laughs]"];
const lyrics = ["♪ Yeah, I'm right here ♪", "<i>♪ But I guess you didn't know ♪</i>", "♪ When there's no one left ♪"];
const tunes = ["♪ tense music ♪", "♪ ♪", "♪ [upbeat music playing] ♪"];
assert.equal(srtContent(srt(dialogue)), "");
assert.equal(srtContent(srt([...dialogue, ...sounds])), "S");
assert.equal(srtContent(srt([...dialogue, ...lyrics])), "L");
assert.equal(srtContent(srt([...sounds, ...lyrics])), "LS");
assert.equal(srtContent(srt([...dialogue, ...tunes, ...tunes])), "");
assert.equal(srtContent(srt([...dialogue, ...sounds.slice(0, 4)])), "");
