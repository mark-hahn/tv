#!/usr/bin/env node
// One-time script: download one OpenSubtitles .opn*.srt file per video listed
// in /root/dev/apps/tv/temp.txt. Runs as background process.
// Progress logged to /root/dev/apps/tv/temp2.txt.
// On error, stops immediately (may be rate-limited).
// Completed entries are removed from temp.txt so script can be restarted.

const fs = require("fs");
const path = require("path");

const TVDB_PATH = "/root/dev/apps/tv/apps/srvr/data/tvdb.json";
const SECRETS_DIR = "/root/dev/apps/tv/apps/srvr/secrets";
const SUBS_LOGIN_PATH = path.join(SECRETS_DIR, "subs-login.txt");
const SUBS_TOKEN_PATH = path.join(SECRETS_DIR, "subs-token.txt");
const LIST_PATH = "/root/dev/apps/tv/temp.txt";
const LOG_PATH = "/root/dev/apps/tv/temp2.txt";
const TV_DIR = "/mnt/media/tv";

const USER_AGENT = "tv-srvr v1.0.0";

// -- helpers --

function loadLogin() {
  const raw = fs.readFileSync(SUBS_LOGIN_PATH, "utf8");
  const obj = JSON.parse(raw);
  return {
    apiKey: obj.apiKey.trim(),
    username: obj.username.trim(),
    password: obj.password.trim(),
  };
}

function loadToken() {
  try {
    const t = fs.readFileSync(SUBS_TOKEN_PATH, "utf8").trim();
    return t || null;
  } catch {
    return null;
  }
}

function saveToken(token) {
  fs.writeFileSync(SUBS_TOKEN_PATH, token, "utf8");
}

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString("utf8"),
    );
    const exp = payload?.exp;
    if (!Number.isFinite(exp)) return true;
    return Date.now() / 1000 > exp - 86400;
  } catch {
    return true;
  }
}

async function login(creds) {
  const resp = await fetch("https://api.opensubtitles.com/api/v1/login", {
    method: "POST",
    headers: {
      "Api-Key": creds.apiKey,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username: creds.username,
      password: creds.password,
    }),
  });
  const body = await resp.json();
  if (!resp.ok)
    throw new Error(`login failed ${resp.status}: ${body?.message || ""}`);
  const token = body?.token?.trim();
  if (!token) throw new Error("login: no token returned");
  return token;
}

function normalizeImdbId(id) {
  if (!id) return null;
  const m = String(id).match(/(\d+)/);
  return m ? m[1] : null;
}

async function searchSubs({ apiKey, token, imdbDigits, season, episode }) {
  const url = new URL("https://api.opensubtitles.com/api/v1/subtitles");
  url.search = new URLSearchParams({
    parent_imdb_id: imdbDigits,
    season_number: String(season),
    episode_number: String(episode),
    languages: "en",
    page: "1",
  }).toString();
  const headers = {
    "Api-Key": apiKey,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  const resp = await fetch(url.toString(), { headers });
  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(`search HTTP ${resp.status}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function downloadSub({ apiKey, token, fileId }) {
  const resp = await fetch("https://api.opensubtitles.com/api/v1/download", {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ file_id: fileId }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(`download HTTP ${resp.status}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

function encodeFileIdBase32(fileId) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let n = Math.floor(Number(fileId));
  if (!Number.isFinite(n) || n < 0) n = 0;
  let out = "";
  do {
    out = alphabet[n % 32] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return "#" + out;
}

function stripSrtFormatting(srt) {
  return srt
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\h/g, " ")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n");
}

function parseSeasonEpisode(filePath) {
  const m = path.basename(filePath).match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (!m) return null;
  return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
}

function toTimestamp(date) {
  return date
    .toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/(\d+)\/(\d+),\s*/, "$1/$2 ");
}

function shortName(videoPath) {
  // Return everything after /Season N/ (or just filename if no season folder)
  const m = videoPath.match(/\/Season \d+\/(.+)$/i);
  return m ? m[1] : path.basename(videoPath);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// -- main --

async function main() {
  const tvdb = JSON.parse(fs.readFileSync(TVDB_PATH, "utf8"));
  const creds = loadLogin();

  // Wait 3 hours before starting (quota reset)
  const waitMs = 3 * 60 * 60 * 1000;
  const startAt = new Date(Date.now() + waitMs);
  fs.appendFileSync(
    LOG_PATH,
    `PID ${process.pid}  waiting until ${toTimestamp(startAt)} to start\n`,
    "utf8",
  );
  await sleep(waitMs);

  let token = loadToken();

  if (isTokenExpired(token)) {
    token = await login(creds);
    saveToken(token);
  }

  const lines = fs
    .readFileSync(LIST_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const total = lines.length;

  // Append PID/start line to log (preserves previous runs)
  const pidLine = `PID ${process.pid}  started ${toTimestamp(new Date())}  total ${total}\n`;
  fs.appendFileSync(LOG_PATH, pidLine, "utf8");

  let done = 0;

  for (const videoPath of lines) {
    done++;
    const showName = videoPath.replace(TV_DIR + "/", "").split("/")[0];
    const tvdbRec = tvdb[showName];
    const imdbDigits = normalizeImdbId(tvdbRec?.imdbId);
    const parsed = parseSeasonEpisode(videoPath);
    const name = shortName(videoPath);

    const remaining = total - done;
    const secsLeft = remaining * 1; // 1 sec/file minimum
    const etaDate = new Date(Date.now() + secsLeft * 1000);
    const ts = toTimestamp(new Date());
    const eta = toTimestamp(etaDate);

    if (!imdbDigits || !parsed) {
      fs.appendFileSync(
        LOG_PATH,
        `- ${ts}  ${name}  (no imdb/episode)  eta ${eta}\n`,
        "utf8",
      );
      removeFromList(videoPath);
      continue;
    }

    let results;
    try {
      results = await searchSubs({
        apiKey: creds.apiKey,
        token,
        imdbDigits,
        season: parsed.season,
        episode: parsed.episode,
      });
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        // Token expired mid-run, refresh and retry once
        token = await login(creds);
        saveToken(token);
        try {
          results = await searchSubs({
            apiKey: creds.apiKey,
            token,
            imdbDigits,
            season: parsed.season,
            episode: parsed.episode,
          });
        } catch (e2) {
          fs.appendFileSync(
            LOG_PATH,
            `STOPPED at ${ts}: search error: ${e2.message}\n`,
            "utf8",
          );
          process.exit(1);
        }
      } else {
        fs.appendFileSync(
          LOG_PATH,
          `STOPPED at ${ts}: search error: ${e.message}\n`,
          "utf8",
        );
        process.exit(1);
      }
    }

    const items = Array.isArray(results?.data) ? results.data : [];
    if (items.length === 0) {
      fs.appendFileSync(
        LOG_PATH,
        `- ${ts}  ${name}  (no results)  eta ${eta}\n`,
        "utf8",
      );
      removeFromList(videoPath);
      await sleep(1000);
      continue;
    }

    // Find first file_id
    const fid = items[0].file_id || items[0].attributes?.files?.[0]?.file_id;
    if (!fid) {
      fs.appendFileSync(
        LOG_PATH,
        `- ${ts}  ${name}  (no file_id)  eta ${eta}\n`,
        "utf8",
      );
      removeFromList(videoPath);
      await sleep(1000);
      continue;
    }

    // Download
    let dlBody;
    try {
      dlBody = await downloadSub({ apiKey: creds.apiKey, token, fileId: fid });
    } catch (e) {
      fs.appendFileSync(
        LOG_PATH,
        `STOPPED at ${ts}: download error: ${e.message}\n`,
        "utf8",
      );
      process.exit(1);
    }

    const link = typeof dlBody?.link === "string" ? dlBody.link.trim() : "";
    if (!link) {
      fs.appendFileSync(
        LOG_PATH,
        `- ${ts}  ${name}  (no link)  eta ${eta}\n`,
        "utf8",
      );
      removeFromList(videoPath);
      await sleep(1000);
      continue;
    }

    let txt;
    try {
      const resp = await fetch(link, { headers: { Accept: "*/*" } });
      if (!resp.ok) throw new Error(`fetch link HTTP ${resp.status}`);
      txt = await resp.text();
    } catch (e) {
      fs.appendFileSync(
        LOG_PATH,
        `STOPPED at ${ts}: fetch error: ${e.message}\n`,
        "utf8",
      );
      process.exit(1);
    }

    const base = videoPath.replace(/\.[^.]+$/, "");
    const tag = "opn" + encodeFileIdBase32(fid).slice(1);
    const outPath = `${base}.${tag}.srt`;
    const outName = shortName(outPath);

    fs.writeFileSync(outPath, stripSrtFormatting(txt), "utf8");
    removeFromList(videoPath);

    fs.appendFileSync(LOG_PATH, `  ${ts}  ${outName}  eta ${eta}\n`, "utf8");

    await sleep(1000);
  }

  fs.appendFileSync(LOG_PATH, `\nDone at ${toTimestamp(new Date())}\n`, "utf8");
}

function removeFromList(videoPath) {
  try {
    const lines = fs
      .readFileSync(LIST_PATH, "utf8")
      .split("\n")
      .filter((l) => l.trim() && l.trim() !== videoPath);
    fs.writeFileSync(
      LIST_PATH,
      lines.join("\n") + (lines.length ? "\n" : ""),
      "utf8",
    );
  } catch {}
}

main().catch((e) => {
  const ts = toTimestamp(new Date());
  fs.appendFileSync(LOG_PATH, `FATAL at ${ts}: ${e.message}\n`, "utf8");
  process.exit(1);
});
