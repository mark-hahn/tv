// Self-check for cleanSrt's line layout: node srt.check.js
import assert from "node:assert/strict";
import { asrCues, cleanSrt, decodeSrt, fitsCue, parseSrt, recueSrt } from "./srt.js";

const cue = (a, b, text) => `1\n${a} --> ${b}\n${text}\n`;
const layout = (text) => {
  const out = parseSrt(cleanSrt(cue("00:00:01,000", "00:00:05,000", text)));
  assert.equal(out.length, 1);
  assert.equal(out[0].startMs, 1000);
  assert.equal(out[0].endMs, 5000);
  return out[0].text;
};

// A short cue broken over two lines is joined onto one.
assert.equal(layout("And you're\nnot judgmental?"), "And you're not judgmental?");

// Over 60: two lines nearly even, the wider one at the bottom, even when a
// sentence end is further from even.
assert.equal(
  layout("Hey, it's not called judgmental\nwhen you're right. It's called right."),
  "Hey, it's not called judgmental\nwhen you're right. It's called right.",
);

// A clause end within NEAR_EVEN_CHARS of the most even split wins.
assert.equal(
  layout("Look, I don't know what you want from me, but I can't do this anymore."),
  "Look, I don't know what you want from me,\nbut I can't do this anymore.",
);

// Over 120: three lines in one cue, never cut, its timing kept.
const three = layout(
  "There's nothing I like better than kicking the brown bread out of a\n" +
    "bunch of Commies high on potato juice, but I'm out of the game.",
);
assert.equal(three.split("\n").length, 3);
for (const l of three.split("\n")) assert.ok(l.length <= 60, l);

// Speakers keep a line each when each fits, and are wrapped together when not.
assert.equal(layout("- Bye.\n- Bye."), "- Bye.\n- Bye.");
assert.equal(layout("Hello there.\n-Hi."), "Hello there.\n-Hi.");
assert.equal(
  layout(
    "- Then why didn't you tell me about her?\n" +
      "- Because of this very conversation, that's why. Look, it's completely platonic",
  ),
  "- Then why didn't you tell me about her?\n" +
    "- Because of this very conversation,\nthat's why. Look, it's completely platonic",
);

// The same words broken differently in back-to-back cues become one cue.
const repeat = parseSrt(
  cleanSrt(
    cue("00:03:58,030", "00:03:59,822", "♪ It didn't take long ♪") +
      "\n" +
      cue("00:03:59,823", "00:04:01,032", "♪ It didn't\ntake long ♪"),
  ),
);
assert.equal(repeat.length, 1);
assert.equal(repeat[0].endMs, 241032);

// Unexpected non-ASCII is removed; music symbols, accents and curly quotes stay.
assert.equal(
  layout("There�s an appointment​ in his private diary, you see."),
  "Theres an appointment in his private diary, you see.",
);
assert.equal(layout("♪ Café — it’s “fine”… ♫"), "♪ Café — it’s “fine”… ♫");

// UTF-8 bytes stay UTF-8; anything else is read as Windows-1252.
assert.equal(decodeSrt(Buffer.from("There’s é ♪", "utf8")), "There’s é ♪");
assert.equal(decodeSrt(Buffer.from([0x54, 0x92, 0x73, 0x20, 0xe9])), "T’s é");

// A cleaned file is left as it is.
for (const text of [
  "And you're\nnot judgmental?",
  "Look, I don't know what you want from me, but I can't do this anymore.",
  "- Bye.\n- Bye.",
  "a ".repeat(150).trim(),
]) {
  const once = cleanSrt(cue("00:00:01,000", "00:00:05,000", text));
  assert.equal(cleanSrt(once), once);
}

// ASR's cues: a run of speech too long for one cue is cut evenly at a
// clause, not filled to the brim with its last word left over (Becker
// S02E11).
const becker =
  cue("00:16:42,800", "00:16:50,920", "Oh, I'm so sorry. But, you know,\nnow that you mention it, there's always been\nsomething about Louis that seemed a little") +
  "\n" +
  cue("00:16:51,000", "00:16:51,900", "off.");
const recued = parseSrt(recueSrt(becker));
assert.deepEqual(
  recued.map((c) => c.text.replace(/\n/g, " ")),
  ["Oh, I'm so sorry. But, you know, now that you mention it,", "there's always been something about Louis that seemed a little off."],
);
assert.equal(recued[0].startMs, 1002800);
assert.equal(recueSrt(recueSrt(becker)), recueSrt(becker));
// a cue that ends its phrase is left as it is
const kept = cue("00:16:53,000", "00:16:54,500", "Louis? Our Louis?");
assert.equal(parseSrt(recueSrt(becker + "\n" + kept)).at(-1).startMs, 1013000);
assert.equal(parseSrt(recueSrt(becker + "\n" + kept)).at(-1).endMs, 1014500);
// with the video's transcript, cut from its word times
const words = "Oh, I'm so sorry. But, you know, now that you mention it, there's always been something about Louis that seemed a little off."
  .split(" ")
  .map((w, i) => [w, 1002800 + i * 350 + (i >= 12 ? 500 : 0), 1002800 + i * 350 + 300 + (i >= 12 ? 500 : 0)]);
const fromWords = parseSrt(recueSrt(becker, words));
assert.equal(fromWords[1].startMs, words[12][1]);
// not when the file was moved by hand: its starts are not the words' starts
assert.equal(recueSrt(becker, words.map(([w, s, e]) => [w, s + 300, e + 300])), recueSrt(becker));

// From timed words: every cue fits two lines, and a pause beats a plain word.
const timed = (text, from, step, pauseAfter = -1, pauseMs = 0) =>
  text.split(" ").map((w, i) => {
    const s = from + i * step + (i > pauseAfter && pauseAfter >= 0 ? pauseMs : 0);
    return { text: w, s, e: s + step - 20 };
  });
const long = timed(
  "and then we drove all the way down to the coast and back again in one day " +
    "because nobody wanted to stay over in that terrible little motel by the highway",
  0,
  300,
  17,
  600,
);
const cues = asrCues(long);
assert.equal(cues.length, 2);
for (const c of cues) assert.ok(fitsCue(c.text.split(/\s+/)), c.text);
assert.ok(cues[0].text.replace(/\n/g, " ").endsWith("in one day because"), cues[0].text);

console.log("srt ok");
