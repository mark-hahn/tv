import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseKeyValueFile } from "./qb-cred.js";
import { getApiSecretsDir, preferSharedReadPath } from "./tvPaths.js";

const execFileAsync = promisify(execFile);

const USB_FILES_ROOT = "/home/xobtlu/files";
const USB_SPACE_TOTAL_BYTES = Math.trunc(2e9 * 1024);
const PRUNE_DELETE_TARGET_BYTES = 100 * 1_000_000_000;
const PRUNE_DRY_RUN = true;

const USB_PRUNE_STATE = {
  running: false,
  phase: "idle",
  latestLogLine: "",
  summaryLine: "",
  dryRun: PRUNE_DRY_RUN,
  foldersScanned: 0,
  deletedCount: 0,
  runningDeletedBytes: 0,
  startedAt: 0,
  finishedAt: 0,
  updatedAt: Date.now(),
  error: "",
};

let usbPruneInFlight = null;

function setUsbPruneState(patch) {
  Object.assign(USB_PRUNE_STATE, patch, { updatedAt: Date.now() });
}

export function getUsbPruneStatus() {
  return {
    ...USB_PRUNE_STATE,
  };
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
  const qbPortRaw = creds.QB_PORT;
  let qbUser = creds.QB_USER;
  const qbPass = creds.QB_PASS;

  if (!qbHost) throw new Error(`Missing QB_HOST in ${credPath}`);
  if (!qbPortRaw) throw new Error(`Missing QB_PORT in ${credPath}`);
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

  const qbPort = Number(qbPortRaw);
  if (!Number.isInteger(qbPort) || qbPort <= 0 || qbPort > 65535) {
    throw new Error(`Invalid QB_PORT in ${credPath}: ${qbPortRaw}`);
  }

  return { qbHost, qbPort, qbUser, qbPass };
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

function lastNonEmptyLine(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function lastLineStartingWithInt(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^\d+/.test(lines[i])) return lines[i];
  }
  return "";
}

function parseLeadingInt(text) {
  const line = String(text ?? "").trim();
  const m = line.match(/^(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
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
 * Returns four integers describing free space.
 *
 * Units:
 * - usbSpaceTotal/usbSpaceUsed are bytes derived from `du -s` output (1K blocks)
 * - mediaSpaceTotal/mediaSpaceUsed are bytes (from `df -B1`)
 */
export async function spaceAvail() {
  // Seed box (USB server): use ssh `du -s` as requested.
  // Total is a fixed-size assumption used for percent calculations.
  const usbSpaceTotalKFallback = 2e9;
  const usbSpaceTotal = Math.trunc(usbSpaceTotalKFallback * 1024);
  let usbSpaceUsed = 0;

  const parseDfFirstDataRow = (dfText) => {
    const text = String(dfText ?? "");
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length < 2) return undefined;
    const row = lines[1];
    const parts = String(row).split(/\s+/);
    if (parts.length < 6) return undefined;
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
      total: Math.trunc(total),
      used: Math.trunc(used),
      avail: Math.trunc(avail),
    };
  };

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

  try {
    const qbHost = await loadQbHostForSsh();

    const sshBaseArgs = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
    ];

    // du may exit non-zero if it hits unreadable directories; still emits a usable summary line.
    // Keep command exactly as requested (cd; du -s) and parse stdout even on non-zero exit.
    const args = [...sshBaseArgs, qbHost, "cd; du -s"];

    const runDuOnce = async () => {
      try {
        const du = await execFileAsync("ssh", args, {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
        return {
          stdout: String(du.stdout ?? ""),
          stderr: String(du.stderr ?? ""),
          err: null,
        };
      } catch (e) {
        const stdout =
          e && typeof e === "object" && "stdout" in e
            ? String(e.stdout ?? "")
            : "";
        const stderr =
          e && typeof e === "object" && "stderr" in e
            ? String(e.stderr ?? "")
            : "";
        return { stdout, stderr, err: e };
      }
    };

    const parseDuK = (stdout, stderr) => {
      const duLine =
        lastLineStartingWithInt(stdout) ||
        lastLineStartingWithInt(stderr) ||
        lastNonEmptyLine(stdout) ||
        lastNonEmptyLine(stderr);
      const duK = parseLeadingInt(duLine);
      return Number.isInteger(duK) && duK >= 0 ? duK : undefined;
    };

    // First attempt.
    let attempt = await runDuOnce();
    let duK = parseDuK(attempt.stdout, attempt.stderr);

    // Retry once if we couldn't parse a usable summary.
    if (!Number.isInteger(duK)) {
      attempt = await runDuOnce();
      duK = parseDuK(attempt.stdout, attempt.stderr);
    }

    if (Number.isInteger(duK)) {
      usbSpaceUsed = Math.trunc(duK * 1024);
      if (attempt.err && !attempt.stdout && !attempt.stderr) {
        console.error("spaceAvail: ssh du failed (no output):", attempt.err);
      }
    } else {
      if (attempt.err) {
        console.error(
          "spaceAvail: ssh du failed (unparsable output):",
          attempt.err,
        );
      }
      // Preserve old log shape (stdout-focused) but include stderr for diagnosis.
      console.error(
        "spaceAvail: unexpected ssh du output:",
        attempt.stdout || attempt.stderr,
      );
    }
  } catch (e) {
    console.error(
      "spaceAvail: ssh space probing failed (returning usbSpaceUsed=0):",
      e,
    );
  }

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

    if (!mediaMount) {
      return {
        usbSpaceTotal: Math.trunc(usbSpaceTotal),
        usbSpaceUsed: Math.trunc(usbSpaceUsed),
        mediaSpaceTotal: 0,
        mediaSpaceUsed: 0,
      };
    }

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
      console.error("spaceAvail: unexpected df output:", dfText);
    }
  } catch (e) {
    console.error(
      "spaceAvail: df failed (returning mediaSpaceTotal/mediaSpaceUsed=0):",
      e,
    );
  }

  return {
    usbSpaceTotal: Math.trunc(usbSpaceTotal),
    usbSpaceUsed: Math.trunc(usbSpaceUsed),
    mediaSpaceTotal: Math.trunc(mediaSpaceTotal),
    mediaSpaceUsed: Math.trunc(mediaSpaceUsed),
  };
}

/**
 * Runs `flexget history --limit 1000` on the USB server via ssh.
 * Uses apps/api/secrets/qbt-cred.txt QB_HOST (user@host) as the SSH target.
 * Returns raw stdout (text table).
 */
export async function flexgetHistory() {
  const qbHost = await loadQbHostForSsh();

  const { flexgetCmd, flexgetBin } = await loadFlexgetOverridesForSsh();

  const sshBaseArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
  ];

  const extractHistoryTable = (text) => {
    const s = String(text ?? "");
    if (!s) return { text: "", ok: false };

    // FlexGet renders a table using box drawing chars; when we run via an interactive shell
    // we may get MOTD/prompt noise. Strip everything before the header.
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
  };

  const runSsh = async (args) => {
    try {
      const out = await execFileAsync("ssh", args, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });
      return {
        stdout: String(out.stdout ?? ""),
        stderr: String(out.stderr ?? ""),
        err: null,
      };
    } catch (e) {
      const stdout =
        e && typeof e === "object" && "stdout" in e
          ? String(e.stdout ?? "")
          : "";
      const stderr =
        e && typeof e === "object" && "stderr" in e
          ? String(e.stderr ?? "")
          : "";
      return { stdout, stderr, err: e };
    }
  };

  const formatRemoteTail = (stdout, stderr) => {
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
  };

  const looksLikeFlexgetNotFound = (stdout, stderr) => {
    const combined = `${stdout || ""}\n${stderr || ""}`.toLowerCase();
    return (
      combined.includes("command not found") ||
      combined.includes("flexget not found")
    );
  };

  // If configured, prefer explicit command or binary path.
  // - FLEXGET_CMD should be a full command that prints history (e.g. "flexget history --limit 1000").
  // - FLEXGET_BIN should be an absolute path to the flexget executable (we append "history --limit 1000").
  if (flexgetCmd || flexgetBin) {
    const cmdLine = flexgetCmd
      ? flexgetCmd
      : `"${flexgetBin.replace(/\"/g, '\\"')}" history --limit 1000`;

    const args = [
      ...sshBaseArgs,
      qbHost,
      "bash",
      "-lc",
      `cd "$HOME" || exit 1\n${cmdLine}`,
    ];

    const r = await runSsh(args);
    if (r.stdout) {
      const extracted = extractHistoryTable(r.stdout);
      if (extracted.ok) return extracted.text;
    }
    if (r.err) throw r.err;
    throw new Error(
      `flexget history did not return expected table header.\n${formatRemoteTail(r.stdout, r.stderr)}`,
    );
  }

  // Try to find flexget in typical locations; fall back to python module.
  // Run in a login shell so user PATH/profile is loaded.
  const remoteScript = [
    'cd "$HOME" || exit 1',
    // Common local install used on this box (often exposed via an alias in interactive shells).
    'if [ -x "$HOME/flexget/bin/flexget" ]; then',
    '  "$HOME/flexget/bin/flexget" history --limit 1000',
    "  exit $?",
    "fi",
    'FLEXGET_BIN="$(command -v flexget 2>/dev/null || true)"',
    'if [ -n "$FLEXGET_BIN" ] && [ -x "$FLEXGET_BIN" ]; then',
    '  "$FLEXGET_BIN" history --limit 1000',
    "  exit $?",
    "fi",
    'if [ -x "$HOME/.local/bin/flexget" ]; then',
    '  "$HOME/.local/bin/flexget" history --limit 1000',
    "  exit $?",
    "fi",
    'if [ -x "/usr/local/bin/flexget" ]; then',
    '  "/usr/local/bin/flexget" history --limit 1000',
    "  exit $?",
    "fi",
    'if [ -x "/usr/bin/flexget" ]; then',
    '  "/usr/bin/flexget" history --limit 1000',
    "  exit $?",
    "fi",
    "if command -v python3 >/dev/null 2>&1; then",
    '  PY_SCRIPTS="$(python3 -c \'import sysconfig; print(sysconfig.get_path("scripts") or "")\' 2>/dev/null || true)"',
    '  if [ -n "$PY_SCRIPTS" ] && [ -x "$PY_SCRIPTS/flexget" ]; then',
    '    "$PY_SCRIPTS/flexget" history --limit 1000',
    "    exit $?",
    "  fi",
    '  PY_USERBASE="$(python3 -c \'import site; print(site.getuserbase() or "")\' 2>/dev/null || true)"',
    '  if [ -n "$PY_USERBASE" ] && [ -x "$PY_USERBASE/bin/flexget" ]; then',
    '    "$PY_USERBASE/bin/flexget" history --limit 1000',
    "    exit $?",
    "  fi",
    "fi",
    'echo "flexget not found (no flexget executable found)" 1>&2',
    "exit 127",
  ].join("\n");

  // First, try a non-interactive login shell (clean output).
  // This will NOT pick up aliases/functions defined only in ~/.bashrc.
  const argsLogin = [...sshBaseArgs, qbHost, "bash", "-lc", remoteScript];
  const r1 = await runSsh(argsLogin);
  if (r1.stdout) {
    const extracted = extractHistoryTable(r1.stdout);
    if (extracted.ok) return extracted.text;
  }

  // If that failed due to "flexget not found", fall back to an interactive shell.
  // This matches the "ssh, then run flexget" behavior you described (loads ~/.bashrc).
  if (looksLikeFlexgetNotFound(r1.stdout, r1.stderr)) {
    // Figure out the remote account's login shell; many setups use zsh and only
    // configure PATH/aliases in interactive rc files.
    const shellQuery = [
      'u="$(id -un 2>/dev/null || echo "$USER")"',
      // Prefer getent, but fall back to /etc/passwd to avoid dependency on getent.
      'sh="$(getent passwd "$u" 2>/dev/null | cut -d: -f7)"',
      'if [ -z "$sh" ] && [ -r /etc/passwd ]; then',
      '  sh="$(awk -F: -v u="$u" \"$1==u{print $7}\" /etc/passwd 2>/dev/null | head -n 1)"',
      "fi",
      'printf "%s" "$sh"',
    ].join("\n");

    const shellQueryArgs = [...sshBaseArgs, qbHost, "sh", "-lc", shellQuery];

    const shellRes = await runSsh(shellQueryArgs);
    const shellPath = String(shellRes.stdout ?? "").trim();
    const shellName = shellPath ? path.posix.basename(shellPath) : "bash";

    const interactiveScript = [
      // Suppress prompt/noise as much as possible.
      'export PS1=""',
      'export PROMPT_COMMAND=""',
      'export PROMPT=""',
      'cd "$HOME" || exit 1',
      'if [ -x "$HOME/flexget/bin/flexget" ]; then "$HOME/flexget/bin/flexget" history --limit 1000; else flexget history --limit 1000; fi',
    ].join("\n");

    // Prefer the user's actual shell if it supports login+interactive modes.
    // For bash/zsh, use -ilc to approximate an actual interactive login session.
    const shellToRun = shellName || "bash";
    const shellArgs =
      shellToRun === "zsh" || shellToRun === "bash"
        ? ["-ilc", interactiveScript]
        : ["-ic", interactiveScript];

    const argsInteractive = [
      ...sshBaseArgs,
      // Force a pseudo-tty so interactive rc files are loaded and job control warnings are avoided.
      "-tt",
      qbHost,
      shellToRun,
      ...shellArgs,
    ];

    const r2 = await runSsh(argsInteractive);
    if (r2.stdout) {
      const extracted = extractHistoryTable(r2.stdout);
      if (extracted.ok) return extracted.text;
    }
    if (r2.err) {
      throw new Error(
        `flexget history ssh (interactive) failed.\n${formatRemoteTail(r2.stdout, r2.stderr)}`,
      );
    }
  }

  if (r1.err) {
    throw new Error(
      `flexget history ssh (login) failed.\n${formatRemoteTail(r1.stdout, r1.stderr)}`,
    );
  }
  throw new Error(
    `flexget history did not return expected table header.\n${formatRemoteTail(r1.stdout, r1.stderr)}`,
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

  const res = await fetch(new URL("/api/v2/auth/login", baseUrl), {
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
  const { qbHost, qbPort, qbUser, qbPass } = await loadQbtCreds();
  const baseUrl = `http://${qbHost}:${qbPort}`;

  const cookie = await qbLogin({ baseUrl, qbUser, qbPass });

  const url = new URL("/api/v2/torrents/info", baseUrl);

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

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookie,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
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
  const { qbHost, qbPort, qbUser, qbPass } = await loadQbtCreds();
  const baseUrl = `http://${qbHost}:${qbPort}`;

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

  const cookie = await qbLogin({ baseUrl, qbUser, qbPass });

  const body = new URLSearchParams({
    hashes: hashesArr.join("|"),
    deleteFiles: input?.deleteFiles === false ? "false" : "true",
  });

  const res = await fetch(new URL("/api/v2/torrents/delete", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body,
  });

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

  const { qbHost, qbPort, qbUser, qbPass } = await loadQbtCreds();
  const baseUrl = `http://${qbHost}:${qbPort}`;

  const cookie = await qbLogin({ baseUrl, qbUser, qbPass });

  const form = new FormData();
  const blob = new Blob([torrentData], { type: "application/x-bittorrent" });
  form.append("torrents", blob, filename);
  if (tags) form.append("tags", tags);

  const res = await fetch(new URL("/api/v2/torrents/add", baseUrl), {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body: form,
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

  const { qbHost, qbPort, qbUser, qbPass } = await loadQbtCreds();
  const baseUrl = `http://${qbHost}:${qbPort}`;
  const cookie = await qbLogin({ baseUrl, qbUser, qbPass });

  const form = new FormData();
  form.append("urls", magnetUrl);
  if (tags) form.append("tags", tags);

  const res = await fetch(new URL("/api/v2/torrents/add", baseUrl), {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body: form,
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
        const infoRes = await fetch(
          new URL(`/api/v2/torrents/info?hashes=${hash}`, baseUrl),
          { headers: { Cookie: cookie } },
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

/**
 * Returns a file tree of /home/xobtlu/files from the USB server.
 */
export async function getUsbFiles() {
  const qbHost = await loadQbHostForSsh();
  const root = USB_FILES_ROOT;

  const sshBaseArgs = [
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

  // using find with -printf to get type, path, size, and date
  // %y: type (f=file, d=directory)
  // %P: file's name relative to start point
  // %s: size in bytes
  // %CY-%Cm-%Cd: date (YYYY-MM-DD)
  const cmd = `find ${root} -maxdepth 5 -not -path '*/.*' -printf "%y|%P|%s|%CY-%Cm-%Cd\\n" | sort`;

  try {
    const { stdout } = await execFileAsync(
      "ssh",
      [...sshBaseArgs, qbHost, cmd],
      {
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
    );

    const lines = (stdout || "").split("\n").filter(Boolean);
    const tree = [];

    // Helper to find or create child node in list
    const findOrCreate = (list, name, type, size, date) => {
      let node = list.find((n) => n.name === name);
      if (!node) {
        node = { name, type, children: [] };
        if (type === "file") {
          node.size = size;
          node.date = date;
        }
        list.push(node);
      }
      return node;
    };

    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length < 4) continue;
      const type = parts[0]; // f or d
      const relPath = parts[1];
      const size = parseInt(parts[2], 10) || 0;
      const date = parts[3];

      if (!relPath) continue;

      const segments = relPath.split("/");
      let currentLevel = tree;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;
        const segType = isLast ? (type === "d" ? "folder" : "file") : "folder";

        const node = findOrCreate(currentLevel, seg, segType, size, date);
        if (segType === "folder") {
          if (!node.children) node.children = [];
          currentLevel = node.children;
        }
      }
    }

    // Sort tree? linux sort on paths helps, but maybe we want folders first?
    const sortNodes = (nodes) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        const nameA = a.name.toLowerCase().replace(/^the\s+/, "");
        const nameB = b.name.toLowerCase().replace(/^the\s+/, "");
        return nameA.localeCompare(nameB);
      });
      nodes.forEach((n) => {
        if (n.children) sortNodes(n.children);
      });
    };
    sortNodes(tree);

    return tree;
  } catch (e) {
    console.error("getUsbFiles failed", e);
    throw new Error(`Failed to list USB files: ${e.message}`);
  }
}

function fmtIsoMinute(tsMs) {
  const d = new Date(Number(tsMs) || 0);
  if (Number.isNaN(d.getTime())) return "1970-01-01-00:00";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}:${min}`;
}

function fmtGb3(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0.000 GB";
  return `${(n / 1_000_000_000).toFixed(3)} GB`;
}

function fmtGbInt(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 GB";
  return `${Math.round(n / 1_000_000_000)} GB`;
}

function fmtGbPad(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "  0 GB";
  const gb = Math.round(n / 1_000_000_000);
  return `${String(gb).padStart(3, " ")} GB`;
}

export async function pruneUsbFiles() {
  if (usbPruneInFlight) {
    return usbPruneInFlight;
  }

  usbPruneInFlight = (async () => {
    const qbHost = await loadQbHostForSsh();

    const sshBaseArgs = [
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

    const runUsbSsh = async (cmd, maxBuffer = 16 * 1024 * 1024) => {
      const out = await execFileAsync("ssh", [...sshBaseArgs, qbHost, cmd], {
        maxBuffer,
        timeout: 120000,
        windowsHide: true,
      });
      return String(out?.stdout || "");
    };

    setUsbPruneState({
      running: true,
      phase: "scan",
      latestLogLine: "",
      summaryLine: "",
      foldersScanned: 0,
      deletedCount: 0,
      runningDeletedBytes: 0,
      startedAt: Date.now(),
      finishedAt: 0,
      error: "",
    });

    try {
      const folders = [];
      let totalUsedBytes = 0;
      let usbUsedBeforeBytes = 0;

      const scanScript = `
set -e
    du_k="$(cd; du -s | awk 'NR==1{print $1}')"
    printf '__DUK__|%s\\n' "$du_k"
cd ${USB_FILES_ROOT}
find . -mindepth 1 -maxdepth 1 -type d -print0 | sort -z | while IFS= read -r -d '' d; do
  data="$(find "$d" -type f -printf '%T@|%s\\n')"
  if [ -n "$data" ]; then
    newest="$(printf '%s\\n' "$data" | awk -F'|' 'BEGIN{m=0}{if(($1+0)>m)m=$1+0}END{printf "%.3f",m}')"
    size="$(printf '%s\\n' "$data" | awk -F'|' 'BEGIN{s=0}{s+=($2+0)}END{printf "%.0f",s}')"
  else
    newest="$(find "$d" -maxdepth 0 -printf '%T@')"
    size="0"
  fi
  name="\${d#./}"
  printf '%s|%s|%s\\n' "$name" "$newest" "$size"
done
`;
      const scanCmd = `bash -lc ${shellQuote(scanScript)}`;
      const scanText = await runUsbSsh(scanCmd, 64 * 1024 * 1024);
      const scanLines = scanText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const line of scanLines) {
        if (line.startsWith("__DUK__|")) {
          const duKRaw = Number(line.slice("__DUK__|".length));
          if (Number.isFinite(duKRaw) && duKRaw > 0) {
            usbUsedBeforeBytes = Math.trunc(duKRaw * 1024);
          }
          continue;
        }

        const [folderNameRaw, tsRaw, sizeRaw] = line.split("|");
        const folderName = String(folderNameRaw || "").trim();
        if (!folderName) continue;

        const tsSeconds = Number(tsRaw);
        const folderSizeIn = Number(sizeRaw);
        const folderSizeBytes =
          Number.isFinite(folderSizeIn) && folderSizeIn > 0
            ? Math.trunc(folderSizeIn)
            : 0;
        const folderTimeMs =
          Number.isFinite(tsSeconds) && tsSeconds > 0
            ? Math.trunc(tsSeconds * 1000)
            : 0;

        totalUsedBytes += folderSizeBytes;
        folders.push({
          folderName,
          folderPath: `${USB_FILES_ROOT}/${folderName}`,
          folderTimeMs,
          folderSizeBytes,
        });
      }

      setUsbPruneState({
        foldersScanned: folders.length,
      });

      folders.sort((a, b) => {
        if (a.folderTimeMs !== b.folderTimeMs)
          return a.folderTimeMs - b.folderTimeMs;
        return a.folderName.localeCompare(b.folderName);
      });

      const deleted = [];
      let runningDeletedBytes = 0;
      let usedAfterBytes =
        usbUsedBeforeBytes > 0 ? usbUsedBeforeBytes : totalUsedBytes;
      let latestDeletedTimeMs = 0;

      setUsbPruneState({
        phase: "delete",
        latestLogLine: "Prune pass starting...",
      });

      for (const folder of folders) {
        if (runningDeletedBytes >= PRUNE_DELETE_TARGET_BYTES) break;

        const deleteSizeBytes = folder.folderSizeBytes;
        runningDeletedBytes += deleteSizeBytes;
        usedAfterBytes = Math.max(0, usedAfterBytes - deleteSizeBytes);

        const logLine = [
          fmtIsoMinute(folder.folderTimeMs),
          fmtGbPad(deleteSizeBytes),
          fmtGbPad(runningDeletedBytes),
          folder.folderName,
        ].join(" | ");
        console.log(
          `usb prune ${PRUNE_DRY_RUN ? "[dry-run]" : "[delete]"}: ${logLine}`,
        );

        if (!PRUNE_DRY_RUN) {
          const rmCmd = `rm -rf -- ${shellQuote(folder.folderPath)}`;
          await runUsbSsh(rmCmd);
        }

        deleted.push({
          folderName: folder.folderName,
          folderTime: fmtIsoMinute(folder.folderTimeMs),
          folderSizeBytes: deleteSizeBytes,
          runningDeletedBytes,
        });
        if (folder.folderTimeMs > latestDeletedTimeMs) {
          latestDeletedTimeMs = folder.folderTimeMs;
        }

        setUsbPruneState({
          latestLogLine: logLine,
          deletedCount: deleted.length,
          runningDeletedBytes,
        });
      }

      const latestDeletedTimeText =
        latestDeletedTimeMs > 0 ? fmtIsoMinute(latestDeletedTimeMs) : "none";
      const summaryLine = `Done ${PRUNE_DRY_RUN ? "dry-run" : "delete"}: ${folders.length} scanned, ${deleted.length} folders, ${fmtGbInt(runningDeletedBytes)}, ${latestDeletedTimeText}`;
      setUsbPruneState({
        running: false,
        phase: "done",
        summaryLine,
        latestLogLine: summaryLine,
        finishedAt: Date.now(),
      });

      return {
        ok: true,
        dryRun: PRUNE_DRY_RUN,
        deleteTargetBytes: PRUNE_DELETE_TARGET_BYTES,
        usbSpaceTotal: USB_SPACE_TOTAL_BYTES,
        usbSpaceUsedBefore:
          usbUsedBeforeBytes > 0 ? usbUsedBeforeBytes : totalUsedBytes,
        usbSpaceUsedAfter: usedAfterBytes,
        foldersScanned: folders.length,
        deletedCount: deleted.length,
        deleted,
      };
    } catch (e) {
      const msg = e?.message || String(e);
      const summaryLine = `Prune failed: ${msg}`;
      setUsbPruneState({
        running: false,
        phase: "error",
        latestLogLine: summaryLine,
        summaryLine,
        error: msg,
        finishedAt: Date.now(),
      });
      throw e;
    } finally {
      usbPruneInFlight = null;
    }
  })();

  return usbPruneInFlight;
}

/**
 * Runs `~/flexget/bin/flexget status` on the USB server via ssh.
 * Returns raw stdout.
 */
async function flexgetStatus() {
  const qbHost = await loadQbHostForSsh();
  // We use the specific path requested by user: ~/flexget/bin/flexget
  const cmd = "~/flexget/bin/flexget status";

  const sshBaseArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
  ];

  const args = [...sshBaseArgs, qbHost, cmd];

  try {
    const { stdout, stderr } = await execFileAsync("ssh", args, {
      timeout: 60000,
    });
    // flexget status might output warnings to stderr but still succeed.
    // We strictly return stdout.
    // If command failed (exit code != 0), execFileAsync naturally throws.
    return stdout;
  } catch (error) {
    if (error.killed) {
      throw new Error("Flexget status check timed out after 1 minute");
    }
    // If it's an execution error, we throw it so the caller can catch and email.
    throw error;
  }
}

/**
 * Checks flexget status and throws an error if tasks are stale or failed.
 */
export async function checkFlexgetStatus() {
  const output = await flexgetStatus();
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
    const parts = line.split(separator).map((s) => s.trim());

    // If splitting by | resulted in empty first/last elements (due to surrounding pipes), remove them if they are empty
    // But be careful about index matching.
    // Let's filter out empty strings to find the content.
    // Expected content columns: Task, Last execution, Last success, Produced, Accepted, Rejected, Failed, Duration
    // That's 8 columns.

    // Filter out purely empty parts distinct from legitimate empty columns?
    // Flexget status columns are unlikely to be empty strings.
    const nonBlankParts = parts.filter((p) => p !== "");

    if (nonBlankParts.length < 8) continue;

    // Map nonBlankParts indices to our needs:
    // 0: Task Name (ipt)
    // 1: Last Execution
    // 2: Last Success
    // ...
    // 6: Failed

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
  const NINE_HOURS = 9 * 60 * 60 * 1000;

  for (const name of ["ipt", "tl"]) {
    const info = tasks[name];
    if (!info) {
      const err = new Error(`Task ${name} missing from status output`);
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
      // Adjust for timezone difference: Remote (PST) vs USB (Europe ~ +9h)
      const eventTimePst = dt.getTime() - NINE_HOURS;
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

function shellQuote(s) {
  if (typeof s !== "string") return "''";
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export async function renameUsbFile(oldPath, newName) {
  const qbHost = await loadQbHostForSsh();
  const root = "/home/xobtlu/files";

  if (
    oldPath.includes("..") ||
    newName.includes("..") ||
    newName.includes("/")
  ) {
    throw new Error("Invalid path or name");
  }

  const parts = oldPath.split("/");
  const fileName = parts.pop();
  const dirPath = parts.join("/");

  const fullOldPath = dirPath
    ? `${root}/${dirPath}/${fileName}`
    : `${root}/${fileName}`;
  const fullNewPath = dirPath
    ? `${root}/${dirPath}/${newName}`
    : `${root}/${newName}`;

  const cmd = `mv ${shellQuote(fullOldPath)} ${shellQuote(fullNewPath)}`;

  const sshBaseArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
  ];

  await execFileAsync("ssh", [...sshBaseArgs, qbHost, cmd]);
  return { success: true };
}
