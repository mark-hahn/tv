// Self-check for cleanSrt's line layout: node srt.check.js
import assert from "node:assert/strict";
import { cleanSrt, parseSrt } from "./srt.js";

const cue = (a, b, text) => `1\n${a} --> ${b}\n${text}\n`;

// A short cue broken over two lines is joined onto one.
const short = cleanSrt(cue("00:01:32,075", "00:01:33,576", "And you're\nnot judgmental?"));
assert.equal(parseSrt(short)[0].text, "And you're not judgmental?");

// A cue over 60 characters wraps onto two, after the sentence end.
const two = cleanSrt(
  cue("00:00:01,000", "00:00:05,000", "Hey, it's not called judgmental\nwhen you're right. It's called right."),
);
assert.equal(parseSrt(two)[0].text, "Hey, it's not called judgmental when you're right.\nIt's called right.");

// A cue over 120 characters becomes several, sharing its time out.
const long = cleanSrt(
  cue("00:00:10,000", "00:00:20,000",
    "I'm telling you, those moms at that school are scary, snobby and judgmental.\n" +
    "They look at me like I'm something on the bottom of their very expensive shoes."),
);
const pieces = parseSrt(long);
assert.equal(pieces.length, 2);
assert.equal(pieces[0].startMs, 10000);
assert.equal(pieces[1].endMs, 20000);
assert.ok(pieces[0].endMs <= pieces[1].startMs);
for (const e of pieces) for (const l of e.text.split("\n")) assert.ok(l.length <= 60, l);

// A cleaned file is left as it is.
for (const s of [short, two, long]) assert.equal(cleanSrt(s), s);

console.log("srt ok");
