// Pure subtitle facts: what type a sidecar file is from its name, and whether
// two OpenSubtitles search results for different episodes of a show come from
// the same origin, so a choice made on one can default for the other. No I/O.

// Uploader ids that are not a person: os-auto, os_robot and system. Their
// uploads are imports from everywhere, and their dates are import dates.
const SHARED_UPLOADERS = new Set([3282, 119465, 2]);
const SAME_UPLOAD_MS = 60 * 60 * 1000;
const FLAGS = [
  "hearingImpaired",
  "hd",
  "foreignPartsOnly",
  "aiTranslated",
  "machineTranslated",
];

// T and H are copies of the video's own text tracks (mb<N> is the old name
// for one), V an OpenSubtitles download, + ASR's, S anything else.
export function sidecarType(suffix) {
  if (/^(T|mb)\d+$/.test(suffix)) return "T";
  if (/^H\d+$/.test(suffix)) return "H";
  if (/^opn[A-Za-z2-7]{5,}$/.test(suffix)) return "V";
  if (suffix === "asr") return "+";
  return "S";
}

// The subtitle panel's name for a sidecar: its type in lower case, then its
// content letters (srtContent), then its number or tag: "tLS3", "vL CYR4Q",
// "s1", "+".
export function sidecarLabel(suffix, content = "") {
  const type = sidecarType(suffix);
  if (type === "+") return type;
  const head = type.toLowerCase() + content;
  if (type === "V") return `${head} ${suffix.slice(3).toUpperCase()}`;
  const num = /^(?:T|H|S|mb)(\d+)$/.exec(suffix)?.[1];
  if (num) return head + num;
  return suffix ? `${head} ${suffix}` : head;
}

// A sound description: [door slams], a line that is only (sighs), or a
// speaker's name in capitals before what they say.
const SOUND_RE = /\[[^\]]+\]|^-?\s*\([^)]+\)$|^-?\s*[A-Z][A-Z .']+:\s/;
// A ♪ line that describes the music instead of singing it: "♪ tense music ♪".
const MUSIC_WORD_RE =
  /\b(music|humming|hums|vocalizing|whistling|singing|instrumental|melody)\b/i;
const SOUND_LINES = 5;
const LYRIC_LINES = 3;

// What an .srt's text holds besides dialogue: "S" for sound descriptions,
// "L" for song lyrics (♪ lines with words in them), "LS" for both, "" for
// neither. A few lines of either are taken as noise.
export function srtContent(text) {
  let sounds = 0;
  let lyrics = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/<[^>]+>/g, "").trim();
    if (!line || line.includes("-->") || /^\d+$/.test(line)) continue;
    if (SOUND_RE.test(line)) sounds++;
    if (!/[♪♫]/.test(line)) continue;
    const words = line.replace(/[♪♫#\s-]+/g, " ").trim();
    if (
      words &&
      !/^[[(].*[\])]$/.test(words) &&
      !(words.split(" ").length <= 4 && MUSIC_WORD_RE.test(words))
    )
      lyrics++;
  }
  return (lyrics >= LYRIC_LINES ? "L" : "") + (sounds >= SOUND_LINES ? "S" : "");
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// The release name with the episode's number and title taken out, so two
// episodes of one release set compare equal.
export function releaseKey(r) {
  const nnn = `${r.season}${String(r.episode).padStart(2, "0")}`;
  let s = ` ${norm(r.release)} `
    .replace(/ s\d{1,2} ?e\d{1,3} /g, " ")
    .replace(/ \d{1,2}x\d{1,3} /g, " ")
    .replace(/ episode \d{1,3} /g, " ")
    .replace(` ${nnn} `, " ");
  const title = norm(r.title);
  if (title) s = s.replace(` ${title} `, " ");
  return s.replace(/ +/g, " ").trim();
}

export function sameOrigin(a, b) {
  if (FLAGS.some((k) => !a[k] !== !b[k])) return false;
  if (a.fps && b.fps && a.fps !== b.fps) return false;
  const person = (r) =>
    r.uploaderId != null && !SHARED_UPLOADERS.has(r.uploaderId);
  if (person(a) && person(b))
    return (
      a.uploaderId === b.uploaderId &&
      Math.abs(Date.parse(a.uploadDate) - Date.parse(b.uploadDate)) <=
        SAME_UPLOAD_MS
    );
  const key = releaseKey(a);
  if (key && key === releaseKey(b)) return true;
  return !!a.comments && a.comments === b.comments;
}
