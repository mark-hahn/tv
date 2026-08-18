// Scrape the IPT/TL home pages to see whether either tracker is asking for
// seeding (hit-and-run warnings). Fetched through the USB server so the
// request comes from the IP the tracker cookies belong to.

import fs from "fs";
import path from "node:path";
import { getApiDataDir } from "./tvPaths.js";
import { sshCurlFetch } from "./sshTunnel.js";
import { logHere, unilog} from "@tv/share"

const DATA_DIR = getApiDataDir();

// The home pages are only scraped once a day; every request in between gets
// the cached answer.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PROVIDERS = {
  tl: {
    label: "tl seed",
    curlFile: "curl-tl.txt",
    homeUrl: "https://www.torrentleech.org/",
    origin: "https://www.torrentleech.org",
    // <a href="/profile/mchahn/hnr"> … SEEDING REMINDER: YOU HAVE
    //   <span class="hitnrunCountTotal">1</span> TORRENTS THAT NEED SEEDING! …
    re: /<a\s[^>]*href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?SEEDING REMINDER[\s\S]*?<\/a>/i,
    countRe: /hitnrunCountTotal[^>]*>\s*(\d+)\s*</i,
  },
  ipt: {
    label: "ipt seed",
    curlFile: "curl-ipt.txt",
    homeUrl: "https://iptorrents.com/",
    origin: "https://iptorrents.com",
    // <a href="/seeding_required.php"> … <b class="red"> 1 torrents require seeding</b></a>
    re: /<a\s[^>]*href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?torrents? require seeding[\s\S]*?<\/a>/i,
    countRe: />\s*(\d+)\s+torrents? require seeding/i,
  },
};

// Cookie + User-Agent come from the same curl-*.txt files the searches use.
function readCurlAuth(curlFile) {
  const p = path.join(DATA_DIR, curlFile);
  const raw = fs.readFileSync(p, "utf8");
  const mc = raw.match(/-H\s+['"]Cookie:\s*([^'"]+)['"]/i);
  const mu = raw.match(/-H\s+['"]User-Agent:\s*([^'"]+)['"]/i);
  if (!mc) throw new Error(`no Cookie header in ${curlFile}`);
  if (!mu) throw new Error(`no User-Agent header in ${curlFile}`);
  return { cookieHeader: mc[1].trim(), userAgent: mu[1].trim() };
}

function absUrl(origin, href) {
  if (/^https?:\/\//i.test(href)) return href;
  return origin + (href.startsWith("/") ? href : `/${href}`);
}

async function checkProvider(key) {
  const cfg = PROVIDERS[key];
  const { cookieHeader, userAgent } = readCurlAuth(cfg.curlFile);

  const result = await sshCurlFetch(cfg.homeUrl, {
    headers: { "User-Agent": userAgent },
    cookieHeader,
  });
  if (!result.ok) {
    throw new Error(
      `home page fetch failed (exit ${result.code}): ${result.stderr
        .toString("utf8")
        .slice(0, 200)}`,
    );
  }

  const html = result.stdout.toString("utf8");
  const m = html.match(cfg.re);
  if (!m) return { needed: false };

  const mc = html.match(cfg.countRe);
  return {
    needed: true,
    count: mc ? Number(mc[1]) : null,
    label: cfg.label,
    url: absUrl(cfg.origin, m[1]),
  };
}

let cache = null;
let cacheMs = 0;

// Returns { tl: {...}, ipt: {...} }; each is { needed:false } or
// { needed:true, count, label, url }, or { needed:false, error } on failure.
// Rescraped when the cached answer is more than a day old, or when the caller
// forces it (client app load) -- a forced scrape restarts the day.
export async function checkSeedingNeeded({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheMs < CACHE_TTL_MS) return cache;

  const keys = Object.keys(PROVIDERS);
  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        return await checkProvider(key);
      } catch (e) {
        unilog(2234, `${key} seed check failed: ${e.message}`);
        return { needed: false, error: e.message };
      }
    }),
  );
  cache = Object.fromEntries(keys.map((key, i) => [key, results[i]]));
  cacheMs = Date.now();
  return cache;
}

// Drop a provider's reminder once its link has been opened, so the button goes
// away. It only comes back if the next scrape (a day later) still sees it.
export function dismissSeeding(key) {
  if (!PROVIDERS[key]) throw new Error(`unknown provider: ${key}`);
  if (cache) cache[key] = { needed: false };
}
