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
  if (/^opn[A-Z2-7]{5}$/i.test(suffix)) return "V";
  if (suffix === "asr") return "+";
  return "S";
}

// The subtitle panel's name for a sidecar: "T 3", "V CYR4Q", "S 1", "+".
export function sidecarLabel(suffix) {
  const type = sidecarType(suffix);
  if (type === "+") return type;
  if (type === "V") return `V ${suffix.slice(3).toUpperCase()}`;
  const rest = /^(?:T|H|S|mb)(\d+)$/.exec(suffix)?.[1] ?? suffix;
  return rest ? `${type} ${rest}` : type;
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
