import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TVDB_DB_PATH = path.resolve(SCRIPT_DIR, "../data/tvdb.db");
const LA_TIME_ZONE = "America/Los_Angeles";
const TIMESTAMP_FIELDS = {
  date: "ms",
  dateCreated: "ms",
  firstAired: "day",
  lastAired: "day",
  lastGapCheck: "ms",
  lastPlayedDate: "ms",
  leftEmby: "ms",
  nextAired: "day",
  premiereDate: "day",
  saved: "ms",
  "last-downloaded": "sec",
};

function laParts(dateIn) {
  const d = dateIn instanceof Date ? dateIn : new Date(dateIn);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const out = {};
  for (const part of parts) {
    if (part && part.type && part.value) out[part.type] = part.value;
  }
  if (!out.year || !out.month || !out.day) return null;
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === "24" ? "00" : out.hour,
    minute: out.minute,
    second: out.second,
    ms: String(d.getMilliseconds()).padStart(3, "0"),
  };
}

function formatParts(parts, resolution) {
  const datePart = `${parts.year}/${parts.month}/${parts.day}`;
  if (resolution === "day") return datePart;
  const timePart = `${parts.hour || "00"}:${parts.minute || "00"}:${parts.second || "00"}`;
  if (resolution === "sec") return `${datePart} ${timePart}`;
  return `${datePart} ${timePart}.${parts.ms || "000"}`;
}

function formatDate(dateIn, resolution) {
  const parts = laParts(dateIn);
  return parts ? formatParts(parts, resolution) : null;
}

function normalizeTimestamp(field, value) {
  const resolution = TIMESTAMP_FIELDS[field];
  if (!resolution || value === null || value === undefined || value === "") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const epochMs = value > 0 && value < 100000000000 ? value * 1000 : value;
    return formatDate(new Date(epochMs), resolution) ?? value;
  }

  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return raw;
  if (/^\d+$/.test(raw)) return normalizeTimestamp(field, Number(raw));

  let match = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (match) {
    return formatParts(
      { year: match[1], month: match[2], day: match[3] },
      resolution,
    );
  }

  match = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[- T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,}))?$/,
  );
  if (match) {
    return formatParts(
      {
        year: match[1],
        month: match[2],
        day: match[3],
        hour: match[4] === "24" ? "00" : match[4],
        minute: match[5],
        second: match[6],
        ms: (match[7] || "000").slice(0, 3).padEnd(3, "0"),
      },
      resolution,
    );
  }

  const parsedMs = Date.parse(raw);
  if (Number.isFinite(parsedMs)) {
    return formatDate(new Date(parsedMs), resolution) ?? value;
  }

  return value;
}

function backupPath() {
  const stamp = formatDate(new Date(), "ms")
    .replace(/[/:]/g, "")
    .replace(" ", "-")
    .replace(".", "");
  return `${TVDB_DB_PATH}.pre-timestamp-upgrade-${stamp}.bak`;
}

const db = new Database(TVDB_DB_PATH);
db.pragma("busy_timeout = 5000");
const backup = backupPath();
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);

const rows = db.prepare("SELECT name, json FROM shows").all();
const update = db.prepare("UPDATE shows SET json = ? WHERE name = ?");
const changesByField = {};
let updatedRows = 0;

const migrate = db.transaction(() => {
  for (const row of rows) {
    const record = JSON.parse(row.json);
    let changed = false;
    for (const field of Object.keys(TIMESTAMP_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
      const before = record[field];
      const after = normalizeTimestamp(field, before);
      if (after !== before) {
        record[field] = after;
        changesByField[field] = (changesByField[field] || 0) + 1;
        changed = true;
      }
    }
    if (changed) {
      update.run(JSON.stringify(record), row.name);
      updatedRows++;
    }
  }
});

migrate();
console.log(
  JSON.stringify(
    {
      db: TVDB_DB_PATH,
      backup,
      rows: rows.length,
      updatedRows,
      changesByField,
    },
    null,
    2,
  ),
);