// Flexget download automation: runs the flexget CLI, parses its --dump output,
// scores candidates against on-disk/history/quality state, and pushes the
// winning torrent URL to qBittorrent. Owns the persisted flexget history and
// the "is running" flag; index.js wires the thin HTTP routes.

import fs from "fs";
import * as path from "node:path";
import * as cp from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";
import { unilog, smartTitleMatch } from "@tv/share";
import * as epd from "@tv/share";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import { SRVR_ROOT_DIR, SRVR_DATA_DIR } from "./srvrPaths.js";
import * as util from "./util.js";
import * as tvdb from "./tvdb.js";
import {
  flexgetFmtSent,
  parseResolutionStrict,
  getFirstFilesOnDiskSeasonGap,
  flexgetIsBetterSameRun,
  flexgetIsBetterCrossRun,
} from "./flexgetScore.js";
import { isBadGroup, hasBadGroup } from "./badGroups.js";

const exec = promisify(cp.exec);
const TV_DIR = "/mnt/media/tv";

const FLEXGET_HISTORY_PATH = path.join(SRVR_DATA_DIR, "flexget-history.json");
const QBT_CRED_PATH_FLEX = path.join(
  path.dirname(SRVR_ROOT_DIR),
  "api",
  "secrets",
  "qbt-cred.txt",
);
const FLEXGET_CMD = "/root/.local/bin/flexget";
const FLEXGET_CONFIG = path.join(SRVR_ROOT_DIR, "config", "config.yml");

let flexgetIsRunning = false;
let flexgetHistory = {};
const flexgetChangeListeners = new Set();

export function onFlexgetChange(listener) {
  flexgetChangeListeners.add(listener);
  return () => flexgetChangeListeners.delete(listener);
}

function notifyFlexgetChange() {
  for (const listener of flexgetChangeListeners) listener();
}

// Load flexget-history.json at startup — create empty {} if missing (first run).
export function loadFlexgetHistory() {
  try {
    const histText = fs.readFileSync(FLEXGET_HISTORY_PATH, "utf8");
    flexgetHistory = JSON.parse(histText);
  } catch (e) {
    if (e.code !== "ENOENT") {
      unilog(507, `FATAL: flexget-history.json parse error: ${e.message}`);
      process.exit(1);
    }
    flexgetHistory = {};
  }
}

export function isFlexgetRunning() {
  return flexgetIsRunning;
}

// The flat, sent-only, sorted rows served by /api/flexget-history.
export function getSentHistoryRows() {
  const result = [];
  for (const [key, list] of Object.entries(flexgetHistory)) {
    if (!Array.isArray(list)) continue;
    const parts = key.split("\x00");
    const showName = parts[0] || "";
    const seasonKey = parts[1] || "";
    const episodeKey = parts[2] || "";
    for (const c of list) {
      if (c.sent !== null) {
        result.push({ ...c, showName, seasonKey, episodeKey });
      }
    }
  }
  result.sort((a, b) => (a.sent || "").localeCompare(b.sent || ""));
  return result;
}

export async function readFlexgetConfig() {
  return fs.promises.readFile(FLEXGET_CONFIG, "utf8");
}

async function addUrlToQbt(torrentUrl) {
  const credText = await fs.promises.readFile(QBT_CRED_PATH_FLEX, "utf8");
  const creds = {};
  for (const rawLine of credText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    creds[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const qbHostRaw = String(creds.QB_HOST || "localhost");
  const qbHost = qbHostRaw.includes("@")
    ? qbHostRaw.split("@").slice(-1)[0]
    : qbHostRaw;
  const qbUser = qbHostRaw.includes("@")
    ? qbHostRaw.split("@")[0]
    : String(creds.QB_USER || "");
  const qbPass = String(creds.QB_PASS || "");
  const baseUrl = `https://${qbHost}/qbittorrent/`;

  const loginParams = new URLSearchParams({
    username: qbUser,
    password: qbPass,
  });
  const loginRes = await fetch(`${baseUrl}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body: loginParams.toString(),
  });
  const cookie = loginRes.headers.get("set-cookie") || "";

  const form = new FormData();
  form.append("urls", torrentUrl);
  form.append("category", "tv");
  const addRes = await fetch(`${baseUrl}/api/v2/torrents/add`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: baseUrl, Referer: `${baseUrl}/` },
    body: form,
  });
  const resText = await addRes.text().catch(() => "");
  const t = resText.trim().toLowerCase();
  if (!addRes.ok || (t.length > 0 && !t.startsWith("ok"))) {
    throw new Error(`qbt add failed: HTTP ${addRes.status} ${resText}`);
  }
}

async function saveFlexgetHistory() {
  const PRUNE_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - PRUNE_MS;
  for (const key of Object.keys(flexgetHistory)) {
    const list = flexgetHistory[key];
    const maxSent = list.reduce((best, c) => {
      if (!c.sent) return best;
      const t = new Date(
        c.sent.replace(
          /^(\d{4})\/(\d{2})\/(\d{2})-(\d{2}):(\d{2}):(\d{2})$/,
          "$1-$2-$3T$4:$5:$6",
        ),
      ).getTime();
      return t > best ? t : best;
    }, 0);
    if (maxSent > 0 && maxSent < cutoff) {
      delete flexgetHistory[key];
    }
  }
  await util.writeFile(FLEXGET_HISTORY_PATH, flexgetHistory);
  notifyFlexgetChange();
}

function getEpisodeDiskResolution(showPath, season, episode) {
  try {
    const sKey = `S${String(season).padStart(2, "0")}`;
    const eKey = `E${String(episode).padStart(2, "0")}`;
    const seasonDir = path.join(TV_DIR, showPath, `Season ${season}`);
    const files = fs.readdirSync(seasonDir);
    const videoExts = new Set([".mkv", ".mp4", ".avi", ".m4v"]);
    const epRe = new RegExp(`${sKey}${eKey}`, "i");
    for (const f of files) {
      if (!epRe.test(f)) continue;
      if (!videoExts.has(path.extname(f).toLowerCase())) continue;
      if (/2160p/i.test(f)) return 2160;
      if (/1080p/i.test(f)) return 1080;
      if (/720p/i.test(f)) return 720;
      if (/576p/i.test(f)) return 576;
      if (/480p/i.test(f)) return 480;
      if (/384p/i.test(f)) return 384;
    }
    return 0;
  } catch {
    return 0;
  }
}

function getEpisodeDiskGroup(showPath, season, episode) {
  try {
    const sKey = `S${String(season).padStart(2, "0")}`;
    const eKey = `E${String(episode).padStart(2, "0")}`;
    const seasonDir = path.join(TV_DIR, showPath, `Season ${season}`);
    const files = fs.readdirSync(seasonDir);
    const videoExts = new Set([".mkv", ".mp4", ".avi", ".m4v"]);
    const epRe = new RegExp(`${sKey}${eKey}`, "i");
    for (const f of files) {
      if (!epRe.test(f)) continue;
      if (!videoExts.has(path.extname(f).toLowerCase())) continue;
      const parsed = parseTorrentTitle(f.replace(/\.[a-z0-9]{2,4}$/i, ""));
      return (parsed?.group || "").toLowerCase();
    }
    return "";
  } catch {
    return "";
  }
}

async function storeFlexgetRejectedCandidate(
  list,
  histKey,
  candidate,
  rawTitle,
) {
  if (!candidate.url || list.some((entry) => entry.url === candidate.url))
    return;

  list.push({
    title: rawTitle,
    url: candidate.url || null,
    quality: candidate.quality || null,
    resolution: candidate.resolution || null,
    content_size: candidate.content_size || null,
    torrent_seeds: candidate.torrent_seeds || null,
    torrent_leeches: candidate.torrent_leeches || null,
    proper: candidate.proper || null,
    release_group: candidate.release_group || null,
    task: candidate.task || null,
    regexp: candidate.regexp || null,
    provider: String(candidate.url || "").includes("iptorrents.com")
      ? "ipt"
      : String(candidate.url || "").includes("torrentleech.org")
        ? "tl"
        : null,
    sent: null,
    addedAt: flexgetFmtSent(),
  });
  flexgetHistory[histKey] = list;
  await saveFlexgetHistory();
}

async function processFlexgetCandidate(candidate, storeOnly = false) {
  const rawTitle = String(candidate.title || "").trim();
  if (!rawTitle) return;

  // Exact URL dedup — fast path before any expensive TVDB lookup
  if (candidate.url) {
    for (const list of Object.values(flexgetHistory)) {
      if (list.some((c) => c.url === candidate.url)) {
        unilog(1177, `Flexget: URL already seen "${rawTitle}"`);
        return;
      }
    }
  }

  const ptt = parseTorrentTitle(rawTitle.replace(/\.[a-z0-9]{2,4}$/i, ""));
  const showName = ptt?.title;
  const season = ptt?.season;
  let episode = ptt?.episode;
  if (!episode && Array.isArray(ptt?.episodes) && ptt.episodes.length)
    episode = ptt.episodes[0];
  const newRes = parseResolutionStrict(
    ptt?.resolution || rawTitle,
    candidate.quality,
  );

  if (!showName || !Number.isInteger(season) || !Number.isInteger(episode))
    return;
  if (episode === 0) return; // skip season packs

  const allTvdb = tvdb.getAllTvdbSync();
  const matchedName = smartTitleMatch(
    showName,
    Object.keys(allTvdb),
    null,
    false,
  );
  if (!matchedName) return;
  const rec = allTvdb[matchedName];
  if (!rec?.inEmby) return;

  const sKey = `S${String(season).padStart(2, "0")}`;
  const eKey = `E${String(episode).padStart(2, "0")}`;
  const histKey = `${matchedName}\x00${sKey}\x00${eKey}`;
  const list = flexgetHistory[histKey] || [];

  const isWatched = epd.isWatched(rec.episodeData, season, episode);
  const firstSeasonGap = getFirstFilesOnDiskSeasonGap(
    epd.seasonsWithFile(rec.episodeData),
    season,
  );
  const isPastSeasonGap = firstSeasonGap !== null && season > firstSeasonGap;

  if (isWatched || isPastSeasonGap) {
    await storeFlexgetRejectedCandidate(
      list,
      histKey,
      { ...candidate, resolution: ptt?.resolution || null },
      rawTitle,
    );
    if (isWatched) {
      unilog(
        1178,
        `Flexget: episode watched ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    }
    if (isPastSeasonGap) {
      unilog(
        1179,
        `Flexget: past season gap S${String(firstSeasonGap).padStart(2, "0")} ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    }
    return;
  }

  const normTitle = (t) =>
    String(t || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const normQuality = (q) =>
    String(q || "")
      .toLowerCase()
      .replace(/\s+/g, "");

  const newNormTitle = normTitle(rawTitle);
  const newNormQuality = normQuality(candidate.quality);
  // Same file from a different provider: same normalized title + quality → deduplicate,
  // but prefer the entry with more seeds if this one is better.
  const sameFileIdx = list.findIndex(
    (c) =>
      normTitle(c.title) === newNormTitle &&
      normQuality(c.quality) === newNormQuality,
  );
  if (sameFileIdx !== -1) {
    const existing = list[sameFileIdx];
    const cSeeds = parseInt(String(candidate.torrent_seeds || "0"), 10) || 0;
    const eSeeds = parseInt(String(existing.torrent_seeds || "0"), 10) || 0;
    if (cSeeds > eSeeds) {
      // Update seeds/leeches/url/provider on the existing entry but keep sent timestamp
      existing.torrent_seeds =
        candidate.torrent_seeds || existing.torrent_seeds;
      existing.torrent_leeches =
        candidate.torrent_leeches || existing.torrent_leeches;
      existing.url = candidate.url || existing.url;
      existing.provider = String(candidate.url || "").includes("iptorrents.com")
        ? "ipt"
        : String(candidate.url || "").includes("torrentleech.org")
          ? "tl"
          : existing.provider;
      flexgetHistory[histKey] = list;
      await saveFlexgetHistory();
      unilog(
        1180,
        `Flexget: same file, better seeds updated ${matchedName} ${sKey}${eKey} "${rawTitle}" (${eSeeds}->${cSeeds} seeds)`,
      );
    } else {
      unilog(
        1181,
        `Flexget: same file from different provider ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    }
    return;
  }

  const newCandidate = {
    title: rawTitle,
    url: candidate.url || null,
    quality: candidate.quality || null,
    resolution: ptt?.resolution || null,
    content_size: candidate.content_size || null,
    torrent_seeds: candidate.torrent_seeds || null,
    torrent_leeches: candidate.torrent_leeches || null,
    proper: candidate.proper || null,
    release_group: candidate.release_group || null,
    task: candidate.task || null,
    regexp: candidate.regexp || null,
    provider: String(candidate.url || "").includes("iptorrents.com")
      ? "ipt"
      : String(candidate.url || "").includes("torrentleech.org")
        ? "tl"
        : null,
    sent: null,
    addedAt: flexgetFmtSent(),
  };

  list.push(newCandidate);
  flexgetHistory[histKey] = list;

  // Best-quality ever sent — used to decide if a new candidate is an upgrade.
  const lastSent = list.reduce((best, c) => {
    if (c.sent === null) return best;
    if (!best) return c;
    return flexgetIsBetterCrossRun(c, best) ? c : best;
  }, null);

  const episodeOnDisk = epd.hasFile(rec.episodeData, season, episode);
  const diskRes =
    episodeOnDisk && rec.path
      ? getEpisodeDiskResolution(rec.path, season, episode)
      : 0;
  const diskGroup =
    episodeOnDisk && rec.path
      ? getEpisodeDiskGroup(rec.path, season, episode)
      : "";
  const diskIsBadGroup = diskGroup ? hasBadGroup(diskGroup) : false;
  const newIsBadGroup = isBadGroup(rawTitle);

  if (storeOnly) {
    /* skip: store-only (run-loser) */
  } else if (episodeOnDisk) {
    if (!newRes) {
      unilog(
        1182,
        `Flexget: no resolution parsed ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    } else if (
      diskRes > newRes ||
      (diskRes === newRes && (!diskIsBadGroup || newIsBadGroup))
    ) {
      unilog(
        1183,
        `Flexget: disk quality ${diskRes}p >= new ${newRes}p ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
      );
    } else if (newCandidate.url) {
      try {
        await addUrlToQbt(newCandidate.url);
        newCandidate.sent = flexgetFmtSent();
        unilog(
          631,
          `SENT(upgrade-${diskRes}p->${newRes}p) ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
        );
      } catch (e) {
        unilog(632, `qbt add failed for "${rawTitle}":`, e.message);
      }
    }
  } else if (!lastSent) {
    if (newCandidate.url) {
      try {
        await addUrlToQbt(newCandidate.url);
        newCandidate.sent = flexgetFmtSent();
        unilog(633, `SENT(first) ${matchedName} ${sKey}${eKey} "${rawTitle}"`);
      } catch (e) {
        unilog(634, `qbt add failed for "${rawTitle}":`, e.message);
      }
    }
  } else if (flexgetIsBetterCrossRun(newCandidate, lastSent)) {
    if (newCandidate.url) {
      try {
        await addUrlToQbt(newCandidate.url);
        newCandidate.sent = flexgetFmtSent();
        unilog(
          635,
          `SENT(better) ${matchedName} ${sKey}${eKey} "${rawTitle}" over "${lastSent.title}"`,
        );
      } catch (e) {
        unilog(636, `qbt add failed for "${rawTitle}":`, e.message);
      }
    }
  } else {
    unilog(
      1184,
      `Flexget: worse quality than last sent ${matchedName} ${sKey}${eKey} "${rawTitle}"`,
    );
  }
}

function parseFlexgetDumpOutput(stdout) {
  // flexget 3.x --dump output format (verified from config-test):
  //   ─── Accepted ─── (section header, one per task)
  //   title         : Number One Fan S01E03 720p WEB H264-iNSiDiOUS
  //   url           : https://...
  //   description   : 1.44 GB; TV/Web-DL (S:0 L:0)
  //   quality       : 720p webdl h264
  //   ...
  //   (empty line separates entries)
  const candidates = [];
  const lines = stdout.split(/\r?\n/);
  let inAcceptedSection = false;
  let current = null;
  for (const line of lines) {
    // Section header for accepted entries
    if (/─+\s*Accepted\s*─+/i.test(line)) {
      inAcceptedSection = true;
      continue;
    }
    // Section header for other sections ends accepted block
    if (/─+\s*(Rejected|Undecided|Failed)\s*─+/i.test(line)) {
      inAcceptedSection = false;
      if (current) {
        candidates.push(current);
        current = null;
      }
      continue;
    }
    if (!inAcceptedSection) continue;
    // Empty line = entry separator
    if (/^\s*$/.test(line)) {
      if (current) {
        candidates.push(current);
        current = null;
      }
      continue;
    }
    const fieldMatch = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);
    if (fieldMatch) {
      const key = fieldMatch[1].trim().toLowerCase();
      const val = fieldMatch[2].trim();
      if (key === "title") {
        if (current) candidates.push(current);
        current = {
          title: val,
          regexp: null,
          url: null,
          quality: null,
          release_group: null,
          torrent_seeds: null,
          torrent_leeches: null,
          content_size: null,
          proper: null,
          task: null,
        };
      } else if (current) {
        if (key === "url" || key === "original_url") {
          if (!current.url)
            current.url = val
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">"); // prefer first url; decode HTML entities
        } else if (key === "quality") current.quality = val;
        else if (key === "release_group") current.release_group = val;
        else if (key === "torrent_seeds" || key === "seeds")
          current.torrent_seeds = parseInt(val, 10) || 0;
        else if (key === "torrent_leeches" || key === "leeches")
          current.torrent_leeches = parseInt(val, 10) || 0;
        else if (key === "content_size") current.content_size = val;
        else if (key === "task") current.task = val;
        else if (key === "proper") current.proper = val;
        else if (key === "reason") {
          const m = val.match(/regexp '(.+?)' matched/);
          if (m) current.regexp = m[1];
        } else if (key === "description") {
          // iptorrents: "1.44 GB; TV/Web-DL (S:4 L:4)"
          const ipMatch = val.match(/\(S:(\d+)\s+L:(\d+)\)/);
          // torrentleech: "Category: ... - Seeders: 14 - Leechers: 0"
          const tlMatch = val.match(/Seeders:\s*(\d+).*?Leechers:\s*(\d+)/i);
          const sm = ipMatch || tlMatch;
          if (sm) {
            if (current.torrent_seeds === null)
              current.torrent_seeds = parseInt(sm[1], 10);
            if (current.torrent_leeches === null)
              current.torrent_leeches = parseInt(sm[2], 10);
          }
        }
      }
    }
  }
  if (current) candidates.push(current);
  return candidates;
}

async function processFlexgetOutput(stdout) {
  const candidates = parseFlexgetDumpOutput(stdout);
  if (candidates.length === 0) {
    unilog(61, "no accepted entries");
    return;
  }
  unilog(62, `processing ${candidates.length} accepted candidates`);

  const runGroups = new Map();
  for (let i = 0; i < candidates.length; i++) {
    const rawTitle = String(candidates[i].title || "").trim();
    const ptt = parseTorrentTitle(rawTitle.replace(/\.[a-z0-9]{2,4}$/i, ""));
    const sn = ptt?.title;
    let ep = ptt?.episode;
    if (!ep && Array.isArray(ptt?.episodes) && ptt.episodes.length)
      ep = ptt.episodes[0];
    const roughKey =
      sn && Number.isInteger(ptt?.season) && Number.isInteger(ep)
        ? `${sn}\x00${ptt.season}\x00${ep}`
        : `__solo__${i}`;
    if (!runGroups.has(roughKey)) runGroups.set(roughKey, []);
    runGroups.get(roughKey).push(i);
  }

  const storeOnlySet = new Set();
  for (const indices of runGroups.values()) {
    if (indices.length <= 1) continue;
    let bestIdx = indices[0];
    for (let j = 1; j < indices.length; j++) {
      if (flexgetIsBetterSameRun(candidates[indices[j]], candidates[bestIdx])) {
        storeOnlySet.add(bestIdx);
        bestIdx = indices[j];
      } else {
        storeOnlySet.add(indices[j]);
      }
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    try {
      await processFlexgetCandidate(candidates[i], storeOnlySet.has(i));
    } catch (e) {
      unilog(638, "processCandidate error:", e.message);
    }
  }
  await saveFlexgetHistory();
}

export async function runFlexgetAndProcess() {
  if (flexgetIsRunning) return;
  flexgetIsRunning = true;
  notifyFlexgetChange();
  try {
    const cmd = `"${FLEXGET_CMD}" -c "${FLEXGET_CONFIG}" execute --tasks fetch-feeds --dump accepted 2>&1`;
    unilog(63, `running flexget execute --tasks fetch-feeds`);
    let stdout = "";
    try {
      const result = await exec(cmd, {
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, COLUMNS: "300" },
      });
      stdout = String(result.stdout || "");
    } catch (e) {
      stdout = String(e.stdout || e.message || "");
      unilog(639, "execute error:", String(e.message || "").slice(0, 200));
    }
    await processFlexgetOutput(stdout);
  } finally {
    flexgetIsRunning = false;
    notifyFlexgetChange();
  }
}

// Streaming run for the SSE route: spawns flexget, delivers each output line to
// onLine(line) as it arrives, processes the output on completion. Resolves true
// when a run was started, or false immediately if one was already running.
export async function runFlexgetStream(onLine) {
  if (flexgetIsRunning) return false;
  flexgetIsRunning = true;
  notifyFlexgetChange();
  unilog(44, "stream run started");
  try {
    const args = [
      "-c",
      FLEXGET_CONFIG,
      "execute",
      "--tasks",
      "fetch-feeds",
      "--dump",
      "accepted",
    ];
    const child = cp.spawn(FLEXGET_CMD, args, {
      env: { ...process.env, COLUMNS: "300" },
    });
    let stdout = "";
    await new Promise((resolve) => {
      const bufferStream = (stream) => {
        let buf = "";
        stream.on("data", (chunk) => {
          buf += chunk.toString();
          const parts = buf.split("\n");
          buf = parts.pop();
          for (const line of parts) {
            stdout += line + "\n";
            onLine(line);
          }
        });
        stream.on("end", () => {
          if (buf) {
            stdout += buf + "\n";
            onLine(buf);
          }
        });
      };
      bufferStream(child.stdout);
      bufferStream(child.stderr);
      child.on("close", resolve);
    });
    try {
      await processFlexgetOutput(stdout);
    } catch (e) {
      unilog(588, "stream run processing error:", e.message);
    }
    return true;
  } finally {
    flexgetIsRunning = false;
    notifyFlexgetChange();
  }
}

loadFlexgetHistory();
