// Builds data/glueWords.txt, the word table subGlue.js splits glued words in
// subtitle files by, from these in data/glue-src:
//   en_full.txt: how often each word turns up in OpenSubtitles' English text
//     (2018), from https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt
//   american-english-huge, british-english-huge: the English dictionaries,
//     names included, of Debian's wamerican-huge and wbritish-huge packages
//     (apt-get download, dpkg-deb -x)
// It keeps the common words, with their counts, and the real words that would
// be split were they not known: rare words of the list whose own count says
// they are real, and the dictionaries' words.
//
//   cd /root/dev/apps/tv/apps/srvr && node scripts/glue-words.js

import fsp from "fs/promises";
import { MIN_PART, MIN_WORD_LEN, splitGlued } from "../src/subGlue.js";

const SRC_DIR = "/root/dev/apps/tv/apps/srvr/data/glue-src";
const OUT_PATH = "/root/dev/apps/tv/apps/srvr/data/glueWords.txt";
const DICTS = ["american-english-huge", "british-english-huge"];

const all = new Map();
let total = 0;
for (const line of (await fsp.readFile(`${SRC_DIR}/en_full.txt`, "utf8")).split("\n")) {
  const sp = line.lastIndexOf(" ");
  if (sp < 0) continue;
  const word = line.slice(0, sp);
  const count = Number(line.slice(sp + 1));
  total += count;
  if (/^[a-z]+$/.test(word)) all.set(word, count);
}
const parts = new Map([...all].filter(([, c]) => c >= MIN_PART));
const never = new Set();
// As tv-srvr sees words, and as the full list does.
const asKnown = { counts: parts, never, total };
const asListed = { counts: all, never: new Set(), total };
for (const w of all.keys())
  if (
    w.length >= MIN_WORD_LEN &&
    splitGlued(w, asKnown)?.likely &&
    !splitGlued(w, asListed)?.likely
  )
    never.add(w);
const listed = never.size;
for (const name of DICTS)
  for (const line of (await fsp.readFile(`${SRC_DIR}/${name}`, "utf8")).split("\n")) {
    const w = line.trim().toLowerCase();
    if (w.length >= MIN_WORD_LEN && splitGlued(w, asKnown)?.likely) never.add(w);
  }
const lines = [
  `#total ${total}`,
  ...[...parts].map(([w, c]) => `${w} ${c}`),
  ...[...never].sort(),
];
await fsp.writeFile(OUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(
  `${OUT_PATH}: ${parts.size} common words, ${listed} rare real words, ${never.size - listed} dictionary words`,
);
