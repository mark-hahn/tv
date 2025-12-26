import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseKeyValueFile } from './qb-cred.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);

function resolveCredPath() {
  return path.resolve(__dirname, '..', 'cookies', 'qbt-cred.txt');
}

async function loadQbtCreds() {
  const credPath = resolveCredPath();
  const text = await fs.readFile(credPath, 'utf8');
  const creds = parseKeyValueFile(text);

  let qbHost = creds.QB_HOST;
  const qbPortRaw = creds.QB_PORT;
  let qbUser = creds.QB_USER;
  const qbPass = creds.QB_PASS;

  if (!qbHost) throw new Error(`Missing QB_HOST in ${credPath}`);
  if (!qbPortRaw) throw new Error(`Missing QB_PORT in ${credPath}`);
  if (!qbPass) throw new Error(`Missing QB_PASS in ${credPath}`);

  // If QB_HOST is user@host, derive QB_USER if missing and strip user for HTTP host.
  if (qbHost.includes('@')) {
    const [userPart, hostPart] = qbHost.split('@');
    if (!qbUser && userPart) qbUser = userPart;
    qbHost = hostPart || qbHost;
  }

  if (!qbUser) throw new Error(`Missing QB_USER in ${credPath} (or set QB_HOST as user@host)`);

  const qbPort = Number(qbPortRaw);
  if (!Number.isInteger(qbPort) || qbPort <= 0 || qbPort > 65535) {
    throw new Error(`Invalid QB_PORT in ${credPath}: ${qbPortRaw}`);
  }

  return { qbHost, qbPort, qbUser, qbPass };
}

async function loadQbHostForSsh() {
  const credPath = resolveCredPath();
  const text = await fs.readFile(credPath, 'utf8');
  const creds = parseKeyValueFile(text);
  const qbHost = creds.QB_HOST;
  if (!qbHost) throw new Error(`Missing QB_HOST in ${credPath}`);
  return String(qbHost).trim();
}

async function loadFlexgetOverridesForSsh() {
  const credPath = resolveCredPath();
  const text = await fs.readFile(credPath, 'utf8');
  const creds = parseKeyValueFile(text);
  const flexgetCmd = (creds.FLEXGET_CMD ?? '').toString().trim();
  const flexgetBin = (creds.FLEXGET_BIN ?? '').toString().trim();
  return {
    flexgetCmd: flexgetCmd || null,
    flexgetBin: flexgetBin || null,
    credPath
  };
}

function lastNonEmptyLine(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function lastLineStartingWithInt(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^\d+/.test(lines[i])) return lines[i];
  }
  return '';
}

function parseLeadingInt(text) {
  const line = String(text ?? '').trim();
  const m = line.match(/^(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function parseDfForMount(dfText, mountPoint) {
  const text = String(dfText ?? '');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
    if (!Number.isFinite(total) || !Number.isFinite(used) || !Number.isFinite(avail)) return undefined;
    return { target, total: Math.trunc(total), used: Math.trunc(used), avail: Math.trunc(avail) };
  };

  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed && parsed.target === mountPoint) return { total: parsed.total, used: parsed.used, avail: parsed.avail };
  }

  // If df only printed a single filesystem line, accept it.
  if (rows.length === 1) {
    const parsed = parseRow(rows[0]);
    if (parsed) return { total: parsed.total, used: parsed.used, avail: parsed.avail };
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
    const text = String(dfText ?? '');
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length < 2) return undefined;
    const row = lines[1];
    const parts = String(row).split(/\s+/);
    if (parts.length < 6) return undefined;
    const total = Number(parts[1]);
    const used = Number(parts[2]);
    const avail = Number(parts[3]);
    if (!Number.isFinite(total) || !Number.isFinite(used) || !Number.isFinite(avail)) return undefined;
    return { total: Math.trunc(total), used: Math.trunc(used), avail: Math.trunc(avail) };
  };

  const dfToTotalUsed = (parsed) => {
    if (!parsed) return undefined;
    if (parsed.used < 0 || parsed.avail < 0) return undefined;
    return {
      // Match `df` semantics: Available excludes reserved blocks.
      // Use (used + avail) so client pctUsed and (total-used) match df Use%/Available.
      total: Math.trunc(parsed.used + parsed.avail),
      used: Math.trunc(parsed.used)
    };
  };

  try {
    const qbHost = await loadQbHostForSsh();

    const sshBaseArgs = [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'LogLevel=ERROR',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
    ];

    // du may exit non-zero if it hits unreadable directories; still emits a usable summary line.
    // Keep command exactly as requested (cd; du -s) and parse stdout even on non-zero exit.
    const args = [
      ...sshBaseArgs,
      qbHost,
      'cd; du -s'
    ];

    const runDuOnce = async () => {
      try {
        const du = await execFileAsync('ssh', args, {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          windowsHide: true
        });
        return { stdout: String(du.stdout ?? ''), stderr: String(du.stderr ?? ''), err: null };
      } catch (e) {
        const stdout = (e && typeof e === 'object' && 'stdout' in e) ? String(e.stdout ?? '') : '';
        const stderr = (e && typeof e === 'object' && 'stderr' in e) ? String(e.stderr ?? '') : '';
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
        console.error('spaceAvail: ssh du failed (no output):', attempt.err);
      }
    } else {
      if (attempt.err) {
        console.error('spaceAvail: ssh du failed (unparsable output):', attempt.err);
      }
      // Preserve old log shape (stdout-focused) but include stderr for diagnosis.
      console.error('spaceAvail: unexpected ssh du output:', attempt.stdout || attempt.stderr);
    }
  } catch (e) {
    console.error('spaceAvail: ssh space probing failed (returning usbSpaceUsed=0):', e);
  }

  let mediaSpaceTotal = 0;
  let mediaSpaceUsed = 0;
  try {
    // Host server mounts: try /media first, then /m-bkup.
    const candidateMounts = ['/media', '/m-bkup'];

    // In Windows/dev environments, none of these mounts may exist.
    let mediaMount = '';
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
        usbSpaceTotal: Math.trunc(usbSpaceTotalK * 1024),
        usbSpaceUsed: Math.trunc(usbSpaceUsedK * 1024),
        mediaSpaceTotal: 0,
        mediaSpaceUsed: 0
      };
    }

    const df = await execFileAsync('df', ['-B1', '-P', mediaMount], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    const dfText = String(df.stdout ?? '');
    const parsed = parseDfForMount(dfText, mediaMount);
    const tu = dfToTotalUsed(parsed);
    if (tu) {
      mediaSpaceUsed = tu.used;
      mediaSpaceTotal = tu.total;
    } else {
      console.error('spaceAvail: unexpected df output:', dfText);
    }
  } catch (e) {
    console.error('spaceAvail: df failed (returning mediaSpaceTotal/mediaSpaceUsed=0):', e);
  }

  return {
    usbSpaceTotal: Math.trunc(usbSpaceTotal),
    usbSpaceUsed: Math.trunc(usbSpaceUsed),
    mediaSpaceTotal: Math.trunc(mediaSpaceTotal),
    mediaSpaceUsed: Math.trunc(mediaSpaceUsed)
  };
}

/**
 * Runs `flexget history` on the USB server via ssh.
 * Uses torrents/cookies/qbt-cred.txt QB_HOST (user@host) as the SSH target.
 * Returns raw stdout (text table).
 */
export async function flexgetHistory() {
  const qbHost = await loadQbHostForSsh();

  const { flexgetCmd, flexgetBin } = await loadFlexgetOverridesForSsh();

  const sshBaseArgs = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
  ];

  const extractHistoryTable = (text) => {
    const s = String(text ?? '');
    if (!s) return { text: '', ok: false };

    // FlexGet renders a table using box drawing chars; when we run via an interactive shell
    // we may get MOTD/prompt noise. Strip everything before the header.
    const lines = s.split(/\r?\n/);
    const isHeaderLine = (line) => {
      const l = String(line ?? '');
      if (l.includes('│Task│') || l.includes('|Task|')) return true;
      // Some installs output without box chars or leading pipes, e.g. "Task   |ipt".
      return /^\s*Task\s*\|/.test(l);
    };

    const headerIdx = lines.findIndex(isHeaderLine);
    if (headerIdx >= 0) return { text: lines.slice(headerIdx).join('\n'), ok: true };
    return { text: s, ok: false };
  };

  const runSsh = async (args) => {
    try {
      const out = await execFileAsync('ssh', args, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      });
      return { stdout: String(out.stdout ?? ''), stderr: String(out.stderr ?? ''), err: null };
    } catch (e) {
      const stdout = (e && typeof e === 'object' && 'stdout' in e) ? String(e.stdout ?? '') : '';
      const stderr = (e && typeof e === 'object' && 'stderr' in e) ? String(e.stderr ?? '') : '';
      return { stdout, stderr, err: e };
    }
  };

  const formatRemoteTail = (stdout, stderr) => {
    const s = String(stdout ?? '').trim();
    const e = String(stderr ?? '').trim();
    const pickTail = (t) => {
      const lines = String(t ?? '').split(/\r?\n/).filter(Boolean);
      return lines.slice(Math.max(0, lines.length - 8)).join('\n');
    };
    const parts = [];
    if (s) parts.push(`stdout tail:\n${pickTail(s)}`);
    if (e) parts.push(`stderr tail:\n${pickTail(e)}`);
    return parts.join('\n\n');
  };

  const looksLikeFlexgetNotFound = (stdout, stderr) => {
    const combined = `${stdout || ''}\n${stderr || ''}`.toLowerCase();
    return combined.includes('command not found') || combined.includes('flexget not found');
  };

  // If configured, prefer explicit command or binary path.
  // - FLEXGET_CMD should be a full command that prints history (e.g. "flexget history").
  // - FLEXGET_BIN should be an absolute path to the flexget executable (we append "history").
  if (flexgetCmd || flexgetBin) {
    const cmdLine = flexgetCmd
      ? flexgetCmd
      : `"${flexgetBin.replace(/\"/g, '\\"')}" history`;

    const args = [
      ...sshBaseArgs,
      qbHost,
      'bash',
      '-lc',
      `cd "$HOME" || exit 1\n${cmdLine}`
    ];

    const r = await runSsh(args);
    if (r.stdout) {
      const extracted = extractHistoryTable(r.stdout);
      if (extracted.ok) return extracted.text;
    }
    if (r.err) throw r.err;
    throw new Error(`flexget history did not return expected table header.\n${formatRemoteTail(r.stdout, r.stderr)}`);
  }

  // Try to find flexget in typical locations; fall back to python module.
  // Run in a login shell so user PATH/profile is loaded.
  const remoteScript = [
    'cd "$HOME" || exit 1',
    // Common local install used on this box (often exposed via an alias in interactive shells).
    'if [ -x "$HOME/flexget/bin/flexget" ]; then',
    '  "$HOME/flexget/bin/flexget" history',
    '  exit $?',
    'fi',
    'FLEXGET_BIN="$(command -v flexget 2>/dev/null || true)"',
    'if [ -n "$FLEXGET_BIN" ] && [ -x "$FLEXGET_BIN" ]; then',
    '  "$FLEXGET_BIN" history',
    '  exit $?',
    'fi',
    'if [ -x "$HOME/.local/bin/flexget" ]; then',
    '  "$HOME/.local/bin/flexget" history',
    '  exit $?',
    'fi',
    'if [ -x "/usr/local/bin/flexget" ]; then',
    '  "/usr/local/bin/flexget" history',
    '  exit $?',
    'fi',
    'if [ -x "/usr/bin/flexget" ]; then',
    '  "/usr/bin/flexget" history',
    '  exit $?',
    'fi',
    'if command -v python3 >/dev/null 2>&1; then',
    '  PY_SCRIPTS="$(python3 -c \'import sysconfig; print(sysconfig.get_path("scripts") or "")\' 2>/dev/null || true)"',
    '  if [ -n "$PY_SCRIPTS" ] && [ -x "$PY_SCRIPTS/flexget" ]; then',
    '    "$PY_SCRIPTS/flexget" history',
    '    exit $?',
    '  fi',
    '  PY_USERBASE="$(python3 -c \'import site; print(site.getuserbase() or "")\' 2>/dev/null || true)"',
    '  if [ -n "$PY_USERBASE" ] && [ -x "$PY_USERBASE/bin/flexget" ]; then',
    '    "$PY_USERBASE/bin/flexget" history',
    '    exit $?',
    '  fi',
    'fi',
    'echo "flexget not found (no flexget executable found)" 1>&2',
    'exit 127'
  ].join('\n');

  // First, try a non-interactive login shell (clean output).
  // This will NOT pick up aliases/functions defined only in ~/.bashrc.
  const argsLogin = [
    ...sshBaseArgs,
    qbHost,
    'bash',
    '-lc',
    remoteScript
  ];
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
      'fi',
      'printf "%s" "$sh"'
    ].join('\n');

    const shellQueryArgs = [
      ...sshBaseArgs,
      qbHost,
      'sh',
      '-lc',
      shellQuery
    ];

    const shellRes = await runSsh(shellQueryArgs);
    const shellPath = String(shellRes.stdout ?? '').trim();
    const shellName = shellPath ? path.posix.basename(shellPath) : 'bash';

    const interactiveScript = [
      // Suppress prompt/noise as much as possible.
      'export PS1=""',
      'export PROMPT_COMMAND=""',
      'export PROMPT=""',
      'cd "$HOME" || exit 1',
      'if [ -x "$HOME/flexget/bin/flexget" ]; then "$HOME/flexget/bin/flexget" history; else flexget history; fi'
    ].join('\n');

    // Prefer the user's actual shell if it supports login+interactive modes.
    // For bash/zsh, use -ilc to approximate an actual interactive login session.
    const shellToRun = shellName || 'bash';
    const shellArgs = (shellToRun === 'zsh' || shellToRun === 'bash')
      ? ['-ilc', interactiveScript]
      : ['-ic', interactiveScript];

    const argsInteractive = [
      ...sshBaseArgs,
      // Force a pseudo-tty so interactive rc files are loaded and job control warnings are avoided.
      '-tt',
      qbHost,
      shellToRun,
      ...shellArgs
    ];

    const r2 = await runSsh(argsInteractive);
    if (r2.stdout) {
      const extracted = extractHistoryTable(r2.stdout);
      if (extracted.ok) return extracted.text;
    }
    if (r2.err) {
      throw new Error(`flexget history ssh (interactive) failed.\n${formatRemoteTail(r2.stdout, r2.stderr)}`);
    }
  }

  if (r1.err) {
    throw new Error(`flexget history ssh (login) failed.\n${formatRemoteTail(r1.stdout, r1.stderr)}`);
  }
  throw new Error(`flexget history did not return expected table header.\n${formatRemoteTail(r1.stdout, r1.stderr)}`);
}

function getSetCookieHeader(headers) {
  // Node's fetch (undici) supports getSetCookie(); fall back to single header.
  const anyHeaders = /** @type {any} */ (headers);
  if (typeof anyHeaders.getSetCookie === 'function') {
    const arr = anyHeaders.getSetCookie();
    if (Array.isArray(arr)) return arr;
  }
  const v = headers.get('set-cookie');
  return v ? [v] : [];
}

function pickCookie(setCookieHeaders) {
  // qBittorrent sets SID=<...>; Path=/; HttpOnly
  for (const raw of setCookieHeaders) {
    const firstPart = String(raw).split(';')[0].trim();
    if (firstPart.toLowerCase().startsWith('sid=')) return firstPart;
  }
  // Fallback: use first cookie if present.
  if (setCookieHeaders.length > 0) {
    return String(setCookieHeaders[0]).split(';')[0].trim();
  }
  return '';
}

async function qbLogin({ baseUrl, qbUser, qbPass }) {
  const body = new URLSearchParams({ username: qbUser, password: qbPass });

  const res = await fetch(new URL('/api/v2/auth/login', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok || (text !== 'Ok.' && text !== 'Ok')) {
    throw new Error(`qBittorrent login failed: ${text || `HTTP ${res.status}`}`);
  }

  const setCookies = getSetCookieHeader(res.headers);
  const cookie = pickCookie(setCookies);
  if (!cookie) {
    // qB sometimes returns Ok without cookie if something's off.
    throw new Error('qBittorrent login succeeded but no session cookie was returned');
  }

  return cookie;
}

/**
 * Query qBittorrent WebUI /api/v2/torrents/info using creds from torrents/cookies/qbt-cred.txt.
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

  const url = new URL('/api/v2/torrents/info', baseUrl);

  if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
    const { hash, category, tag, filter: state } = filter;

    if (hash) {
      const hashes = Array.isArray(hash) ? hash.join('|') : String(hash);
      if (hashes.trim()) url.searchParams.set('hashes', hashes);
    }
    if (category) url.searchParams.set('category', String(category));
    if (tag) url.searchParams.set('tag', String(tag));
    if (state) url.searchParams.set('filter', String(state));
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Cookie: cookie,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`qBittorrent info failed: HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }

  return res.json();
}
