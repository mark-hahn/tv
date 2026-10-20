// Self-check for compareRelease and releaseFactors: node releaseCompare.check.js
import assert from "node:assert/strict";
import { compareRelease, releaseFactors, sizeToBytes } from "./releaseCompare.js";

const cmp = (a, b) => compareRelease(a, b);

// Each rank decides, in order.
assert.deepEqual(cmp({ res: 1080, proper: false }, { res: 720, proper: true }), { cmp: 1, factor: "resolution" });
assert.deepEqual(cmp({ res: 720, proper: true }, { res: 720, proper: false }), { cmp: 1, factor: "proper/repack" });
assert.deepEqual(cmp({ source: 4, hevc: true }, { source: 3, hevc: false }), { cmp: 1, factor: "source" });
assert.deepEqual(cmp({ hevc: false, depth: 8 }, { hevc: true, depth: 10 }), { cmp: 1, factor: "hevc/av1" });
assert.deepEqual(cmp({ depth: 10, size: 1 }, { depth: 8, size: 9 }), { cmp: 1, factor: "bit depth" });
assert.deepEqual(cmp({ size: 130, seeds: 0 }, { size: 100, seeds: 50 }), { cmp: 1, factor: "size" });
assert.deepEqual(cmp({ seeds: 5, badGroup: true }, { seeds: 1, badGroup: false }), { cmp: 1, factor: "seeds" });
assert.deepEqual(cmp({ badGroup: false, tracker: false }, { badGroup: true, tracker: true }), { cmp: 1, factor: "bad group" });
assert.deepEqual(cmp({ tracker: true }, { tracker: false }), { cmp: 1, factor: "tracker" });

// The 20% size rule.
assert.equal(cmp({ size: 115 }, { size: 100 }).cmp, 0);
assert.equal(cmp({ size: 100 }, { size: 121 }).cmp, -1);

// A factor blank on either side is skipped.
assert.deepEqual(cmp({ res: 1080, size: 200 }, { size: 100 }), { cmp: 1, factor: "size" });
assert.deepEqual(cmp({ source: null, hevc: false }, { source: 6, hevc: true }), { cmp: 1, factor: "hevc/av1" });
assert.deepEqual(cmp({}, {}), { cmp: 0, factor: "" });

// The name reader.
assert.deepEqual(releaseFactors("Show.S01E02.1080p.WEB.h264-GRP.mkv"), { res: 1080, proper: false, source: 4, hevc: false, depth: 8 });
assert.deepEqual(releaseFactors("Show.S01E02.REPACK.720p.WEBRip.x265.10bit-GRP"), { res: 720, proper: true, source: 3, hevc: true, depth: 10 });
assert.deepEqual(releaseFactors("Show S01E02 HDTV"), { res: 480, proper: false, source: 2, hevc: false, depth: 8 });
assert.equal(releaseFactors("Show.S01E02.2160p.BluRay.REMUX.HDR-GRP").source, 6);
assert.equal(releaseFactors("x", "720p webdl h264").res, 720);
assert.equal(releaseFactors("Time 2021 S03E01 1080p AV1 10bit-MeGusta").hevc, true);
assert.equal(
  compareRelease(
    releaseFactors("Time.S03E01.1080p.WEBRip.X264-DEADPOOL.mkv"),
    releaseFactors("Time 2021 S03E01 1080p AV1 10bit-MeGusta"),
  ).factor,
  "hevc/av1",
);

assert.equal(sizeToBytes("1.5 GB"), 1.5 * 1024 ** 3);
assert.equal(sizeToBytes("700 MiB"), 700 * 1024 ** 2);
assert.equal(sizeToBytes(""), null);

console.log("releaseCompare ok");
