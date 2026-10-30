// Self-check for cleanSrt's line layout: node srt.check.js
import assert from "node:assert/strict";
import { cleanSrt, decodeSrt, parseSrt } from "./srt.js";

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

console.log("srt ok");
