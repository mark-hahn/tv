// Builds data/glueWords.txt, the word table subGlue.js splits glued words in
// subtitle files by, from these in data/glue-src:
//   en_full.txt: how often each word turns up in OpenSubtitles' English text
//     (2018), from https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt
//   american-english-huge, british-english-huge: the English dictionaries,
//     names included, of Debian's wamerican-huge and wbritish-huge packages
//     (apt-get download, dpkg-deb -x): the real words, never split
//   american-english, british-english: the mid-size ones, of wamerican and
//     wbritish: their lower-case words are those a glued word is split into
// It keeps the common words with their counts ("word count"), the pieces with
// theirs ("+word count"), the list's words subGlue.js would split with theirs
// ("=word count", for its odds) and the real words ("word").
//
//   cd /root/dev/apps/tv/apps/srvr && node scripts/glue-words.js

import fsp from "fs/promises";
import { MIN_PART, MIN_WORD_LEN, splitGlued } from "../src/subGlue.js";

const SRC_DIR = "/root/dev/apps/tv/apps/srvr/data/glue-src";
const OUT_PATH = "/root/dev/apps/tv/apps/srvr/data/glueWords.txt";
const REAL_DICTS = ["american-english-huge", "british-english-huge"];
const PIECE_DICTS = ["american-english", "british-english"];
const dictWords = async (name) =>
  (await fsp.readFile(`${SRC_DIR}/${name}`, "utf8")).split("\n").map((l) => l.trim()).filter(Boolean);

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
const pieces = new Set(["i"]);
for (const name of PIECE_DICTS)
  for (const w of await dictWords(name)) if (/^[a-z]+$/.test(w)) pieces.add(w);
const real = new Set();
for (const name of [...REAL_DICTS, ...PIECE_DICTS])
  for (const w of await dictWords(name)) real.add(w.toLowerCase().replace(/’/g, "'"));
const pieceCounts = new Map([...pieces].map((w) => [w, all.get(w) ?? 0]));
const asTable = { counts: parts, pieces: pieceCounts, own: new Map(), real, total };
const own = [...all].filter(([w]) => w.length >= MIN_WORD_LEN && splitGlued(w, asTable));
const lines = [
  `#total ${total}`,
  ...[...parts].map(([w, c]) => `${w} ${c}`),
  ...[...pieces].sort().map((w) => `+${w} ${all.get(w) ?? 0}`),
  ...own.map(([w, c]) => `=${w} ${c}`),
  ...[...real].filter((w) => !w.includes(" ")).sort(),
];
await fsp.writeFile(OUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(
  `${OUT_PATH}: ${parts.size} common words, ${pieces.size} pieces, ${own.length} splittable, ${real.size} real words`,
);
