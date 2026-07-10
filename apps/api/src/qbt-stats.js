import fs from "fs";
import path from "node:path";
import { getApiDataDir } from "./tvPaths.js";
import { unilog } from "@tv/share";

const STATS_PATH = path.join(getApiDataDir(), "qbt-stats.json");
const MIN_SAMPLE_INTERVAL_MS = 4000;
const MAX_RATE_SAMPLES = 12; // last 10 skipping the final 2

let stats = null;
let lastSampleMs = 0;

function loadStats() {
  if (stats) return stats;
  try {
    stats = JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    stats = {};
  }
  return stats;
}

async function saveStats() {
  try {
    await fs.promises.writeFile(STATS_PATH, JSON.stringify(stats), "utf8");
  } catch (e) {
    unilog(1295, `qbt stats save failed: ${e.message}`);
  }
}

// Rate from the same remaining-bytes/eta data used for time remaining, in Mb/s.
function calcRateMb(t) {
  const size = Number(t?.size);
  const completed = Number(t?.completed);
  const eta = Number(t?.eta);
  if (
    !Number.isFinite(size) ||
    !Number.isFinite(completed) ||
    !Number.isFinite(eta) ||
    eta <= 0
  )
    return null;
  const remBytes = Math.max(0, size - completed);
  return (remBytes * 8) / 1e6 / eta;
}

// Track per-torrent download stats and add them to each torrent object:
//   last_seeds  — last non-zero num_seeds seen
//   avg_rate_mb — average Mb/s of the last 10 samples skipping the final 2,
//                 computed when the torrent stops downloading
// Only call with the full unfiltered torrent list (stale hashes are pruned).
export async function enrichQbtStats(torrents) {
  if (!Array.isArray(torrents)) return torrents;
  const s = loadStats();
  const now = Date.now();
  const takeSample = now - lastSampleMs >= MIN_SAMPLE_INTERVAL_MS;
  if (takeSample) lastSampleMs = now;
  let changed = false;
  const curHashes = new Set();

  for (const t of torrents) {
    const hash = String(t?.hash || "").trim();
    if (!hash) continue;
    curHashes.add(hash);
    const entry = s[hash] || (s[hash] = {});
    if (takeSample) {
      const seeds = Number(t?.num_seeds);
      if (Number.isFinite(seeds) && seeds > 0 && entry.lastSeeds !== seeds) {
        entry.lastSeeds = seeds;
        changed = true;
      }
      const downloading = String(t?.state || "").trim() === "downloading";
      if (downloading) {
        // A (re)downloading torrent invalidates any previous average.
        if (entry.avgRateMb !== undefined) {
          delete entry.avgRateMb;
          changed = true;
        }
        const rate = calcRateMb(t);
        if (rate !== null) {
          const hist = entry.rateHist || (entry.rateHist = []);
          hist.push(rate);
          if (hist.length > MAX_RATE_SAMPLES)
            hist.splice(0, hist.length - MAX_RATE_SAMPLES);
          changed = true;
        }
      } else if (Array.isArray(entry.rateHist)) {
        const samples = entry.rateHist.slice(0, -2).slice(-10);
        if (samples.length > 0) {
          entry.avgRateMb = samples.reduce((a, b) => a + b, 0) / samples.length;
        }
        delete entry.rateHist;
        changed = true;
      }
    }
    if (entry.lastSeeds !== undefined) t.last_seeds = entry.lastSeeds;
    if (entry.avgRateMb !== undefined) t.avg_rate_mb = entry.avgRateMb;
  }

  if (takeSample) {
    for (const h of Object.keys(s)) {
      if (!curHashes.has(h)) {
        delete s[h];
        changed = true;
      }
    }
  }
  if (changed) await saveStats();
  return torrents;
}
