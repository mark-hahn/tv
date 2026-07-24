import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseKeyValueFile } from "./qb-cred.js";
import { getApiSecretsDir, getApiDataDir } from "./tvPaths.js";
import { buildFileTree } from "./fileTree.js";
import { logHere, unilog } from "@tv/share";

const execFileAsync = promisify(execFile);

const USB_FILES_ROOT = "/home/xobtlu/files";
const USB_MOVIES_ROOT = "/home/xobtlu/movies";

// Common ssh options for every USB-server command.
const SSH_BASE_ARGS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=20",
  "-o",
  "LogLevel=ERROR",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
];

function shellQuote(s) {
  if (typeof s !== "string") return "''";
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function remotePathUnderRoot(root, relPath) {
  const rel = String(relPath || "").trim();
  if (
    !rel ||
    path.posix.isAbsolute(rel) ||
    rel.includes("\0") ||
    rel.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(`Invalid path: ${rel}`);
  }
  return path.posix.join(root, rel.replace(/\\/g, "/"));
}

// Run one command on the USB server; returns stdout.
async function runUsbSsh(
  cmd,
  { timeout = 120000, maxBuffer = 10 * 1024 * 1024 } = {},
) {
  const qbHost = await loadQbHostForSsh();
  const out = await execFileAsync("ssh", [...SSH_BASE_ARGS, qbHost, cmd], {
    timeout,
    maxBuffer,
    windowsHide: true,
  });
  return String(out?.stdout ?? "");
}

function resolveCredPath() {
  return path.join(getApiSecretsDir(), "qbt-cred.txt");
}

async function loadQbtCreds() {
  const credPath = resolveCredPath();
  try {
    await fs.access(credPath);
  } catch {
    throw new Error(`Missing required qBittorrent creds file: ${credPath}`);
  }
  const text = await fs.readFile(credPath, "utf8");
  const creds = parseKeyValueFile(text);

  let qbHost = creds.QB_HOST;
  let qbUser = creds.QB_USER;
  const qbPass = creds.QB_PASS;

  if (!qbHost) throw new Error(`Missing QB_HOST in ${credPath}`);
  if (!qbPass) throw new Error(`Missing QB_PASS in ${credPath}`);

  // If QB_HOST is user@host, derive QB_USER if missing and strip user for HTTP host.
  if (qbHost.includes("@")) {
    const [userPart, hostPart] = qbHost.split("@");
    if (!qbUser && userPart) qbUser = userPart;
    qbHost = hostPart || qbHost;
  }

  if (!qbUser)
    throw new Error(
      `Missing QB_USER in ${credPath} (or set QB_HOST as user@host)`,
    );

  return { qbHost, qbUser, qbPass };
}

async function loadQbHostForSsh() {
  const credPath = resolveCredPath();
  try {
    await fs.access(credPath);
  } catch {
    throw new Error(`Missing required qBittorrent creds file: ${credPath}`);
  }
  const text = await fs.readFile(credPath, "utf8");
  const creds = parseKeyValueFile(text);
  const qbHost = creds.QB_HOST;
  if (!qbHost) throw new Error(`Missing QB_HOST in ${credPath}`);
  return String(qbHost).trim();
}

async function loadFlexgetOverridesForSsh() {
  const credPath = resolveCredPath();
  const text = await fs.readFile(credPath, "utf8");
  const creds = parseKeyValueFile(text);
  const flexgetCmd = (creds.FLEXGET_CMD ?? "").toString().trim();
  const flexgetBin = (creds.FLEXGET_BIN ?? "").toString().trim();
  return {
    flexgetCmd: flexgetCmd || null,
    flexgetBin: flexgetBin || null,
    credPath,
  };
}

// Parses `quota` output (no -s flag, so values are raw 1K blocks).
// Data line columns: Filesystem blocks(used) quota(soft) limit(hard) grace files ...
// Returns { usedK, limitK } or undefined.
function parseQuotaOutput(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const line of lines) {
    // Data lines start with a filesystem path like /dev/...
    if (!line.startsWith("/")) continue;
    const parts = line.split(/\s+/);
    // parts: [filesystem, blocks, quota, limit, grace?, files, ...]
    // grace may be absent if not in grace period, making it 4+ columns
    const usedK = Number(parts[1]);
    // hard limit is at index 3 (or 2 if soft==hard and grace absent, but index 3 is standard)
    const limitK = Number(parts[3]);
    if (
      Number.isFinite(usedK) &&
      usedK >= 0 &&
      Number.isFinite(limitK) &&
      limitK > 0
    ) {
      return { usedK: Math.trunc(usedK), limitK: Math.trunc(limitK) };
    }
  }
  return undefined;
}

function parseDfForMount(dfText, mountPoint) {
  const text = String(dfText ?? "");
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length < 2) return undefined;

  // Skip header; find the row whose mountpoint matches.
  const rows = lines.slice(1);

  const parseRow = (row) => {
    const parts = String(row).split(/\s+/);
    if (parts.length < 6) return undefined;
    const target = parts[parts.length - 1];
    const total = Number(parts[1]);
    const used = Number(parts[2]);
    const avail = Number(parts[3]);
    if (
      !Number.isFinite(total) ||
      !Number.isFinite(used) ||
      !Number.isFinite(avail)
    )
      return undefined;
    return {
      target,
      total: Math.trunc(total),
      used: Math.trunc(used),
      avail: Math.trunc(avail),
    };
  };

  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed && parsed.target === mountPoint)
      return { total: parsed.total, used: parsed.used, avail: parsed.avail };
  }

  // If df only printed a single filesystem line, accept it.
  if (rows.length === 1) {
    const parsed = parseRow(rows[0]);
    if (parsed)
      return { total: parsed.total, used: parsed.used, avail: parsed.avail };
  }

  return undefined;
}

/**
 * Returns USB seed-box space: { usbSpaceTotal, usbSpaceUsed } in bytes.
 * Uses ssh `quota` on the USB server — reads per-user quota (instant, no directory walk).
 * `quota` columns (1K blocks): Filesystem blocks(used) quota(soft) limit(hard) grace files ...
 */
export async function spaceAvailUsb() {
  let usbSpaceTotal = 0;
  let usbSpaceUsed = 0;

  try {
    const qbHost = await loadQbHostForSsh();

    // `quota` reports per-user quota in 1K blocks: used, soft-limit, hard-limit.
    // This is instant and reflects the actual per-user allocation, not the shared filesystem.
    const args = [...SSH_BASE_ARGS, qbHost, "quota 2>/dev/null"];

    let stdout = "";
    try {
      const result = await execFileAsync("ssh", args, {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      stdout = String(result.stdout ?? "");
    } catch (e) {
      // quota exits non-zero on some hosts but still prints the table.
      stdout =
        e && typeof e === "object" && "stdout" in e
          ? String(e.stdout ?? "")
          : "";
      if (!stdout) {
        unilog(278, "spaceAvailUsb: ssh quota failed:", e);
        return { usbSpaceTotal: 0, usbSpaceUsed: 0 };
      }
    }

    // Parse the data line: Filesystem blocks quota limit grace files quota limit grace
    // All values are in 1K blocks. Use hard limit (col index 3) as total.
    const parsed = parseQuotaOutput(stdout);
    if (parsed) {
      usbSpaceTotal = parsed.limitK * 1024;
      usbSpaceUsed = parsed.usedK * 1024;
    } else {
      unilog(279, "spaceAvailUsb: unexpected quota output:", stdout);
    }
  } catch (e) {
    unilog(
      280,
      "spaceAvailUsb: ssh space probing failed (returning zeros):",
      e,
    );
  }

  return {
    usbSpaceTotal: Math.trunc(usbSpaceTotal),
    usbSpaceUsed: Math.trunc(usbSpaceUsed),
  };
}

/**
 * Returns local media server space: { mediaSpaceTotal, mediaSpaceUsed } in bytes.
 * Uses `df -B1` on the local media mount; fast (local disk).
 */
export async function spaceAvailMedia() {
  const dfToTotalUsed = (parsed) => {
    if (!parsed) return undefined;
    if (parsed.used < 0 || parsed.avail < 0) return undefined;
    return {
      // Match `df` semantics: Available excludes reserved blocks.
      // Use (used + avail) so client pctUsed and (total-used) match df Use%/Available.
      total: Math.trunc(parsed.used + parsed.avail),
      used: Math.trunc(parsed.used),
    };
  };

  let mediaSpaceTotal = 0;
  let mediaSpaceUsed = 0;
  try {
    // Host server mounts.
    // Prefer the actual mounted paths under /mnt (common on Linux servers) to avoid
    // accidentally measuring the root filesystem when /media exists as a plain directory.
    // Fallback to legacy paths if present.
    const candidateMounts = ["/mnt/media", "/mnt/m-bkup", "/media", "/m-bkup"];

    // In Windows/dev environments, none of these mounts may exist.
    let mediaMount = "";
    for (const m of candidateMounts) {
      try {
        await fs.access(m);
        mediaMount = m;
        break;
      } catch {
        // keep trying
      }
    }

    if (mediaMount) {
      const df = await execFileAsync("df", ["-B1", "-P", mediaMount], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      const dfText = String(df.stdout ?? "");
      const parsed = parseDfForMount(dfText, mediaMount);
      const tu = dfToTotalUsed(parsed);
      if (tu) {
        mediaSpaceUsed = tu.used;
        mediaSpaceTotal = tu.total;
      } else {
        unilog(281, "spaceAvailMedia: unexpected df output:", dfText);
      }
    }
  } catch (e) {
    unilog(
      282,
      "spaceAvailMedia: df failed (returning mediaSpaceTotal/mediaSpaceUsed=0):",
      e,
    );
  }

  return {
    mediaSpaceTotal: Math.trunc(mediaSpaceTotal),
    mediaSpaceUsed: Math.trunc(mediaSpaceUsed),
  };
}

/**
 * Returns all four space integers by running USB and media probes concurrently.
 * Units:
 * - usbSpaceTotal/usbSpaceUsed are bytes from `quota` (per-user 1K blocks)
 * - mediaSpaceTotal/mediaSpaceUsed are bytes (from `df -B1`)
 */
export async function spaceAvail() {
  const [usb, media] = await Promise.all([spaceAvailUsb(), spaceAvailMedia()]);
  return { ...usb, ...media };
}

// FlexGet renders a table using box drawing chars; strip any noise before
// the header line.
function extractHistoryTable(text) {
  const s = String(text ?? "");
  if (!s) return { text: "", ok: false };

  const lines = s.split(/\r?\n/);
  const isHeaderLine = (line) => {
    const l = String(line ?? "");
    if (l.includes("│Task│") || l.includes("|Task|")) return true;
    // Some installs output without box chars or leading pipes, e.g. "Task   |ipt".
    return /^\s*Task\s*\|/.test(l);
  };

  const headerIdx = lines.findIndex(isHeaderLine);
  if (headerIdx >= 0)
    return { text: lines.slice(headerIdx).join("\n"), ok: true };
  return { text: s, ok: false };
}

function formatRemoteTail(stdout, stderr) {
  const s = String(stdout ?? "").trim();
  const e = String(stderr ?? "").trim();
  const pickTail = (t) => {
    const lines = String(t ?? "")
      .split(/\r?\n/)
      .filter(Boolean);
    return lines.slice(Math.max(0, lines.length - 8)).join("\n");
  };
  const parts = [];
  if (s) parts.push(`stdout tail:\n${pickTail(s)}`);
  if (e) parts.push(`stderr tail:\n${pickTail(e)}`);
  return parts.join("\n\n");
}

/**
 * Runs `flexget history --limit 1000` on the USB server via ssh.
 * Uses apps/api/secrets/qbt-cred.txt QB_HOST (user@host) as the SSH target.
 * FLEXGET_CMD/FLEXGET_BIN in the creds file override the default binary path
 * (the same fixed path flexgetStatus uses).
 * Returns raw stdout (text table).
 */
export async function flexgetHistory() {
  const qbHost = await loadQbHostForSsh();
  const { flexgetCmd, flexgetBin } = await loadFlexgetOverridesForSsh();

  const cmdLine = flexgetCmd
    ? flexgetCmd
    : `"${(flexgetBin || "$HOME/flexget/bin/flexget").replace(/"/g, '\\"')}" history --limit 1000`;

  const args = [
    ...SSH_BASE_ARGS,
    qbHost,
    "bash",
    "-lc",
    `cd "$HOME" || exit 1\n${cmdLine}`,
  ];

  let stdout = "";
  let stderr = "";
  try {
    const out = await execFileAsync("ssh", args, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    stdout = String(out.stdout ?? "");
    stderr = String(out.stderr ?? "");
  } catch (e) {
    stdout =
      e && typeof e === "object" && "stdout" in e ? String(e.stdout ?? "") : "";
    stderr =
      e && typeof e === "object" && "stderr" in e ? String(e.stderr ?? "") : "";
    if (!stdout) {
      throw new Error(
        `flexget history ssh failed.\n${formatRemoteTail(stdout, stderr)}`,
      );
    }
  }

  const extracted = extractHistoryTable(stdout);
  if (extracted.ok) return extracted.text;
  throw new Error(
    `flexget history did not return expected table header.\n${formatRemoteTail(stdout, stderr)}`,
  );
}

function getSetCookieHeader(headers) {
  // Node's fetch (undici) supports getSetCookie(); fall back to single header.
  const anyHeaders = /** @type {any} */ (headers);
  if (typeof anyHeaders.getSetCookie === "function") {
    const arr = anyHeaders.getSetCookie();
    if (Array.isArray(arr)) return arr;
  }
  const v = headers.get("set-cookie");
  return v ? [v] : [];
}

function pickCookie(setCookieHeaders) {
  // qBittorrent sets SID=<...>; Path=/; HttpOnly
  for (const raw of setCookieHeaders) {
    const firstPart = String(raw).split(";")[0].trim();
    if (firstPart.toLowerCase().startsWith("sid=")) return firstPart;
  }
  // Fallback: use first cookie if present.
  if (setCookieHeaders.length > 0) {
    return String(setCookieHeaders[0]).split(";")[0].trim();
  }
  return "";
}

async function qbLogin({ baseUrl, qbUser, qbPass }) {
  const body = new URLSearchParams({ username: qbUser, password: qbPass });

  const res = await fetch(new URL("api/v2/auth/login", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok || (text !== "Ok." && text !== "Ok")) {
    throw new Error(
      `qBittorrent login failed: ${text || `HTTP ${res.status}`}`,
    );
  }

  const setCookies = getSetCookieHeader(res.headers);
  const cookie = pickCookie(setCookies);
  if (!cookie) {
    // qB sometimes returns Ok without cookie if something's off.
    throw new Error(
      "qBittorrent login succeeded but no session cookie was returned",
    );
  }

  return cookie;
}

// Cached qBittorrent session cookie. The qbt pane polls torrents/info
// continuously; logging in on every call doubled the round trips and churned
// sessions, so the SID is reused and refreshed once on a 403 (expired).
let qbtSessionCookie = "";

async function getQbtSession() {
  const { qbHost, qbUser, qbPass } = await loadQbtCreds();
  const baseUrl = `https://${qbHost}/qbittorrent/`;
  if (!qbtSessionCookie) {
    qbtSessionCookie = await qbLogin({ baseUrl, qbUser, qbPass });
  }
  return { baseUrl, cookie: qbtSessionCookie };
}

// Run a qBittorrent WebUI request with the cached session cookie.
// makeRequest(baseUrl, cookie) must build and send the request itself (so a
// retry re-creates any FormData body). On 403 the session is refreshed once.
async function qbtRequest(makeRequest) {
  let session = await getQbtSession();
  let res = await makeRequest(session.baseUrl, session.cookie);
  if (res.status === 403) {
    logHere(
      { lvl: "warn", grp: "qbt request" },
      `qBittorrent request returned HTTP 403, refreshing session and retrying`,
    );
    qbtSessionCookie = "";
    session = await getQbtSession();
    res = await makeRequest(session.baseUrl, session.cookie);
    if (res.status === 403) {
      logHere(
        { lvl: "error", grp: "qbt request" },
        `qBittorrent request gave up after session refresh with HTTP 403`,
      );
    }
  }
  return res;
}

/**
 * Query qBittorrent WebUI /api/v2/torrents/info using creds from apps/api/secrets/qbt-cred.txt.
 *
 * Optional filtering is forwarded to qBittorrent as query params.  see misc/notes.txt for details of input
 *
 * @typedef {{
 *   hash?: string | string[],
 *   category?: string,
 *   tag?: string,
 *   filter?: string,
 * }} QbtInfoFilter
 *
 * Notes:
 * - qBittorrent expects hashes to be provided as a single string joined by '|'.
 * - qBittorrent's 'filter' values are WebUI state filters (e.g. downloading, seeding, completed, etc.).
 *
 * @param {QbtInfoFilter | undefined} [filter]
 * @returns {Promise<any>} Parsed JSON returned by qBittorrent (typically an array of torrent objects)
 */
export async function getQbtInfo(filter) {
  const res = await qbtRequest((baseUrl, cookie) => {
    const url = new URL("api/v2/torrents/info", baseUrl);

    if (filter && typeof filter === "object" && !Array.isArray(filter)) {
      const { hash, category, tag, filter: state } = filter;

      if (hash) {
        const hashes = Array.isArray(hash) ? hash.join("|") : String(hash);
        if (hashes.trim()) url.searchParams.set("hashes", hashes);
      }
      if (category) url.searchParams.set("category", String(category));
      if (tag) url.searchParams.set("tag", String(tag));
      if (state) url.searchParams.set("filter", String(state));
    }

    return fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
      },
    });
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `qBittorrent info failed: HTTP ${res.status}${text ? `: ${text}` : ""}`,
    );
  }

  return res.json();
}

/**
 * Delete one or more torrents in qBittorrent.
 *
 * Uses qBittorrent WebUI endpoint `/api/v2/torrents/delete`.
 *
 * @param {{ hash: string | string[], deleteFiles?: boolean }} input
 * @returns {Promise<{ ok: true, hashes: string[] }>} basic success payload
 */
export async function delQbtTorrent(input) {
  const hashValue = input?.hash;
  const hashesArr = Array.isArray(hashValue)
    ? hashValue
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    : [String(hashValue ?? "").trim()].filter(Boolean);

  if (!hashesArr.length) {
    throw new Error("delQbtTorrent requires hash");
  }

  const res = await qbtRequest((baseUrl, cookie) =>
    fetch(new URL("api/v2/torrents/delete", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
      },
      body: new URLSearchParams({
        hashes: hashesArr.join("|"),
        deleteFiles: input?.deleteFiles === false ? "false" : "true",
      }),
    }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `qBittorrent delete failed: HTTP ${res.status}${text ? `: ${text}` : ""}`,
    );
  }

  // qB often returns empty body or "Ok."; ignore content.
  return { ok: true, hashes: hashesArr };
}

/**
 * Add a .torrent to qBittorrent via WebUI API `/api/v2/torrents/add`.
 *
 * This is deterministic with respect to duplicates: qBittorrent will refuse
 * duplicate torrents (same infohash).
 *
 * @param {{ torrentData: Buffer, filename?: string, tags?: string | string[] }} input
 * @returns {Promise<{ ok: boolean, status: number, text: string }>} result
 */
export async function addQbtTorrent(input) {
  const torrentData = input?.torrentData;
  if (!Buffer.isBuffer(torrentData) || torrentData.length === 0) {
    throw new Error("addQbtTorrent requires torrentData Buffer");
  }

  const filenameRaw =
    String(input?.filename || "download.torrent").trim() || "download.torrent";
  const filename = filenameRaw.replace(/[\\/]+/g, "_");

  const tagsValue = input?.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",")
    : String(tagsValue ?? "").trim();

  const res = await qbtRequest((baseUrl, cookie) => {
    const form = new FormData();
    const blob = new Blob([torrentData], { type: "application/x-bittorrent" });
    form.append("torrents", blob, filename);
    if (tags) form.append("tags", tags);
    if (input?.savePath) form.append("savepath", input.savePath);

    return fetch(new URL("api/v2/torrents/add", baseUrl), {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
      },
      body: form,
    });
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `qBittorrent add failed: HTTP ${res.status}${text ? `: ${text}` : ""}`,
    );
  }

  const t = String(text || "").trim();
  // qBittorrent often returns "Ok.", but some versions/configs return an empty body on success.
  const ok = t.length === 0 || t.toLowerCase().startsWith("ok");
  return { ok, status: res.status, text: t };
}

export async function addQbtMagnet(input) {
  const magnetUrl = String(input?.magnetUrl || "").trim();
  if (!magnetUrl.startsWith("magnet:")) {
    throw new Error("addQbtMagnet requires a magnet URL");
  }

  const tagsValue = input?.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",")
    : String(tagsValue ?? "").trim();

  const res = await qbtRequest((baseUrl, cookie) => {
    const form = new FormData();
    form.append("urls", magnetUrl);
    if (tags) form.append("tags", tags);
    if (input?.savePath) form.append("savepath", input.savePath);

    return fetch(new URL("api/v2/torrents/add", baseUrl), {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
      },
      body: form,
    });
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `qBittorrent magnet add failed: HTTP ${res.status}${text ? `: ${text}` : ""}`,
    );
  }

  const t = String(text || "").trim();
  const ok = t.length === 0 || t.toLowerCase().startsWith("ok");

  // When qBittorrent returns "Fails." check if it's a duplicate infohash
  if (!ok && t.toLowerCase() === "fails.") {
    const xtMatch = magnetUrl.match(
      /xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i,
    );
    if (xtMatch) {
      const hash = xtMatch[1].toLowerCase();
      try {
        const infoRes = await qbtRequest((baseUrl, cookie) =>
          fetch(new URL(`api/v2/torrents/info?hashes=${hash}`, baseUrl), {
            headers: { Cookie: cookie },
          }),
        );
        const torrents = await infoRes.json().catch(() => []);
        if (Array.isArray(torrents) && torrents.length > 0) {
          const tor = torrents[0];
          return {
            ok: false,
            status: res.status,
            text: `Duplicate: "${tor.name}" already in qBittorrent (state: ${tor.state})`,
          };
        }
      } catch {
        // ignore — fall through to generic error
      }
    }
  }

  return { ok, status: res.status, text: t };
}

export async function recheckQbtTorrent(input) {
  const hashValue = input?.hash;
  const hashes =
    hashValue === "all"
      ? "all"
      : Array.isArray(hashValue)
        ? hashValue
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean)
            .join("|")
        : String(hashValue ?? "").trim();

  if (!hashes) throw new Error("recheckQbtTorrent requires hash");

  const res = await qbtRequest((baseUrl, cookie) =>
    fetch(new URL("api/v2/torrents/recheck", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
      },
      body: new URLSearchParams({ hashes }),
    }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `qBittorrent recheck failed: HTTP ${res.status}${text ? `: ${text}` : ""}`,
    );
  }

  return { ok: true, hashes };
}

// Fetch a file tree from a USB-server directory.
// find -printf: %y type (f/d), %P relative path, %s size, %CY-%Cm-%Cd date.
async function getUsbTree(root, label) {
  const cmd = `find ${root} -maxdepth 5 -not -path '*/.*' -printf "%y|%P|%s|%CY-%Cm-%Cd\\n"`;
  try {
    const stdout = await runUsbSsh(cmd);
    return buildFileTree(stdout);
  } catch (e) {
    unilog(283, `getUsbTree ${label} failed`, e);
    throw new Error(`Failed to list USB ${label}: ${e.message}`);
  }
}

/**
 * Returns a file tree of /home/xobtlu/files from the USB server.
 */
export async function getUsbFiles() {
  return getUsbTree(USB_FILES_ROOT, "files");
}

/**
 * Returns a file tree of /home/xobtlu/movies from the USB server.
 */
export async function getUsbMovies() {
  return getUsbTree(USB_MOVIES_ROOT, "movies");
}

/**
 * Runs `~/flexget/bin/flexget status` on the USB server via ssh.
 * Also measures the timezone difference between local and remote by
 * running `date` on the USB server and comparing with local parse.
 * Returns { output, tzDiffMs }.
 */
async function flexgetStatus() {
  const qbHost = await loadQbHostForSsh();
  const cmd =
    "echo \"__DATES__|$(date '+%Y-%m-%d %H:%M:%S')|$(date +%s)\" && ~/flexget/bin/flexget status";

  const args = [...SSH_BASE_ARGS, qbHost, cmd];

  try {
    const { stdout } = await execFileAsync("ssh", args, {
      timeout: 60000,
    });

    let tzDiffMs = 0;
    const outputLines = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("__DATES__|")) {
        const parts = line.split("|");
        const remoteLocalStr = parts[1];
        const remoteEpochSec = parseInt(parts[2], 10);
        const parsedAsLocal = new Date(remoteLocalStr).getTime();
        const remoteEpochMs = remoteEpochSec * 1000;
        if (!isNaN(parsedAsLocal) && Number.isFinite(remoteEpochMs)) {
          tzDiffMs = parsedAsLocal - remoteEpochMs;
        }
      } else {
        outputLines.push(line);
      }
    }

    return { output: outputLines.join("\n"), tzDiffMs };
  } catch (error) {
    if (error.killed) {
      throw new Error("[flexget] status check timed out after 1 minute");
    }
    throw error;
  }
}

/**
 * Checks flexget status and throws an error if tasks are stale or failed.
 */
export async function checkFlexgetStatus() {
  const { output, tzDiffMs } = await flexgetStatus();
  const lines = output.split("\n");
  const tasks = {};

  for (const line of lines) {
    // Support both box-drawing char │ and simple pipe |
    const separator = line.includes("│")
      ? "│"
      : line.includes("|")
        ? "|"
        : null;
    if (!separator) continue;

    // Some formats have leading/trailing pipes, some might not.
    // e.g. "│ ipt │ ..." or "ipt | ..."
    // Expected content columns: Task, Last execution, Last success, Produced,
    // Accepted, Rejected, Failed, Duration — 8 columns.
    const parts = line.split(separator).map((s) => s.trim());
    const nonBlankParts = parts.filter((p) => p !== "");

    if (nonBlankParts.length < 8) continue;

    const name = nonBlankParts[0];
    if (name === "Task" || name.startsWith("----")) continue;
    if (!["ipt", "tl"].includes(name)) continue;

    const lastExec = nonBlankParts[1];
    const lastSuccess = nonBlankParts[2];
    const failed = parseInt(nonBlankParts[6], 10);

    tasks[name] = { lastExec, lastSuccess, failed };
  }

  const now = Date.now();
  const TWENTY_MINS = 20 * 60 * 1000;

  for (const name of ["ipt", "tl"]) {
    const info = tasks[name];
    if (!info) {
      const err = new Error(
        `[flexget] Task ${name} missing from status output`,
      );
      err.fullOutput = output;
      throw err;
    }

    if (info.failed > 0) {
      const err = new Error(`Task ${name} has ${info.failed} failed entries`);
      err.fullOutput = output;
      throw err;
    }

    const validateTime = (timeStr, label) => {
      const dt = new Date(timeStr);
      if (isNaN(dt.getTime())) {
        const err = new Error(`Invalid date ${timeStr}`);
        err.fullOutput = output;
        throw err;
      }
      const eventTimePst = dt.getTime() - tzDiffMs;
      const age = now - eventTimePst;

      if (age > TWENTY_MINS) {
        const err = new Error(
          `${name} ${label} is too old: ${Math.round(age / 60000)} mins ago`,
        );
        err.fullOutput = output;
        throw err;
      }
    };

    validateTime(info.lastExec, "last execution");
    validateTime(info.lastSuccess, "last success");
  }

  return true;
}

export async function renameUsbFile(oldPath, newName) {
  const root = USB_FILES_ROOT;

  if (
    !newName ||
    path.posix.isAbsolute(String(newName)) ||
    /[\\/]/.test(String(newName)) ||
    String(newName).includes("\0")
  ) {
    throw new Error("Invalid path or name");
  }

  const fullOldPath = remotePathUnderRoot(root, oldPath);
  const fullNewPath = path.posix.join(
    path.posix.dirname(fullOldPath),
    String(newName).trim(),
  );

  await runUsbSsh(`mv ${shellQuote(fullOldPath)} ${shellQuote(fullNewPath)}`);
  return { success: true };
}

// Recursively delete paths (relative to root) on the USB server.
async function deleteUsbPaths(root, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths must be a non-empty array");
  }

  for (const p of paths) {
    const fullPath = remotePathUnderRoot(root, p);
    await runUsbSsh(`rm -rf -- ${shellQuote(fullPath)}`);
  }

  return { success: true, deleted: paths.length };
}

export async function deleteUsbFiles(paths) {
  return deleteUsbPaths(USB_FILES_ROOT, paths);
}

export async function deleteUsbMovies(paths) {
  return deleteUsbPaths(USB_MOVIES_ROOT, paths);
}

const USB_CP_LOGIN_URL = "https://cp.ultra.cc/api/rest-auth/login/";

export async function usbCpToken() {
  const credsPath = path.join(getApiDataDir(), "usb-creds.json");
  const raw = await fs.readFile(credsPath, "utf8");
  const creds = JSON.parse(raw);
  if (!creds.Email || !creds.Password) {
    throw new Error("usb-creds.json missing Email or Password");
  }

  const body = new URLSearchParams();
  body.append("username", creds.Email);
  body.append("password", creds.Password);

  const resp = await fetch(USB_CP_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`cp.ultra.cc login failed: ${resp.status}`);
  }
  const data = await resp.json();
  if (!data.key) {
    throw new Error("cp.ultra.cc login returned no token key");
  }
  return data.key;
}
