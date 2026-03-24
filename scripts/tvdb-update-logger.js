#!/usr/bin/env node
// Reads tv-srvr pm2 log and summarizes tvdb update tasks from the past hour.

import { readFileSync, writeFileSync } from "fs";

const LOG_PATH = "/root/.pm2/logs/tv-srvr-out.log";
const OUT_PATH = "/root/dev/apps/tv/temp.txt";
const HOUR_MS = 60 * 60 * 1000;

if (process.argv.includes("help")) {
  console.log(`Usage: node tvdb-update-logger.js [help]

Reads the tv-srvr pm2 log and prints one summary line per tvdb update task
from the past hour.

Output columns per line:
  HH:MM:SS  [initiator]  ShowName  tvdb:<changes>  rotten:<scores>

Initiators:
  bg-timer       periodic background timer (stalest emby/non-emby)
  user           user HTTP request via express route
  unknown        could not determine

Restart markers are printed as:
  ====== RESTART HH:MM:SS ======`);
  process.exit(0);
}

const raw = readFileSync(LOG_PATH, "utf8");
const lines = raw.split("\n");
const now = Date.now();
const cutoff = now - HOUR_MS;

function parseTs(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return m ? new Date(m[1]).getTime() : null;
}

function extractTime(line) {
  const m = line.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : "??:??:??";
}

// Determine initiator from the [tvdb loop] enqueue line's stack trace
function detectInitiator(enqueueLine) {
  if (!enqueueLine) return "unknown";
  if (enqueueLine.includes("Timeout.updateTvdbLocal")) return "bg-timer";
  if (enqueueLine.includes("Layer.handle")) return "user";
  return "unknown";
}

// Look back from processingIdx for this show's enqueue line
function findEnqueueLine(showName, processingIdx) {
  for (let i = processingIdx - 1; i >= Math.max(0, processingIdx - 25); i--) {
    const l = lines[i];
    if (l.includes(`[tvdb loop] enqueue [${showName}]`)) return l;
    if (l.includes("timer: enqueued") && l.includes(`[${showName}]`)) return l;
  }
  return null;
}

// Look forward from processingIdx for push result, rotten result, and imdb score
function findResults(showName, processingIdx) {
  let tvdbChanges = null;
  let rottenScore = null;
  let imdbScore = null;

  for (
    let i = processingIdx + 1;
    i < Math.min(lines.length, processingIdx + 40);
    i++
  ) {
    const l = lines[i];
    // Stop if we hit a new unrelated show's processing
    if (l.includes("[tvdb] processing [") && !l.includes(`[${showName}]`))
      break;

    if (!tvdbChanges && l.includes(`[tvdb] tvdb push [${showName}]:`)) {
      const m = l.match(/tvdb push \[.+?\]: (.+)/);
      if (m) tvdbChanges = m[1].trim();
    }

    if (!rottenScore && l.includes(`tvdb push3 [${showName}]:`)) {
      const m = l.match(/tvdb push3 \[.+?\]: Rotten (.+)/);
      if (m) rottenScore = m[1].trim();
    }

    if (!imdbScore && l.includes(`getRemotesCmd [${showName}]`)) {
      const m = l.match(/fetched=\{imdb:([\d.]+)/);
      if (m && m[1] !== "-") imdbScore = m[1];
    }

    if (tvdbChanges && rottenScore) break;
  }

  return { tvdbChanges, rottenScore, imdbScore };
}

// Collect all restart line indices within the past hour
const restartIdxs = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("wss listening on port")) {
    const ts = parseTs(lines[i]);
    if (ts && ts >= cutoff) restartIdxs.push(i);
  }
}

const output = [];
const nowStr = new Date().toLocaleString("en-US", {
  timeZone: "America/Los_Angeles",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
output.push(`tv-srvr tvdb update log — past hour as of ${nowStr} PST`);
output.push("");

let nextRestartIdx = 0; // pointer into restartIdxs

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const ts = parseTs(line);
  if (!ts || ts < cutoff) continue;

  // Emit any restart markers that precede this line index
  while (
    nextRestartIdx < restartIdxs.length &&
    restartIdxs[nextRestartIdx] <= i
  ) {
    const ri = restartIdxs[nextRestartIdx];
    output.push("");
    output.push(`====== RESTART ${extractTime(lines[ri])} ======`);
    nextRestartIdx++;
  }

  // Match processing start
  const procMatch = line.match(/\[tvdb\] processing \[(.+?)\]/);
  if (!procMatch) continue;

  const showName = procMatch[1];
  const timeStr = extractTime(line);

  const enqueueLine = findEnqueueLine(showName, i);
  const initiator =
    enqueueLine && enqueueLine.includes("timer:")
      ? "bg-timer"
      : detectInitiator(enqueueLine);

  const { tvdbChanges, rottenScore, imdbScore } = findResults(showName, i);

  const changes = tvdbChanges || "no changes";
  const parts = [
    `${timeStr}`,
    `[${initiator}]`,
    showName.padEnd(30),
    `tvdb: ${changes}`,
  ];

  if (rottenScore !== null) {
    const imdbPart = imdbScore ? `imdb:${imdbScore}` : null;
    const rottenPart = `rotten:${rottenScore}`;
    parts.push([imdbPart, rottenPart].filter(Boolean).join("  "));
  }

  output.push(parts.join("  "));
}

console.log(output.join("\n"));
writeFileSync(OUT_PATH, output.join("\n") + "\n");
console.log(`Written to ${OUT_PATH}`);
