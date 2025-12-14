#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function parseArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (!val || val.startsWith('--')) return '';
  return val;
}

function usageAndExit(code) {
  const msg = [
    'Usage:',
    '  QB_USER=... QB_PASS=... node qb-info.js [--ssh xobtlu@oracle.usbx.me] [--qb-port 12041]',
    '',
    'Env vars:',
    '  QB_USER     qBittorrent WebUI username (required)',
    '  QB_PASS     qBittorrent WebUI password (required)',
    '  SSH_TARGET  SSH target (default: xobtlu@oracle.usbx.me)',
    '  QB_PORT     qBittorrent WebUI port on the remote host (default: 12041)',
    '  LOCAL_PORT  Local forwarded port (default: auto)',
    '',
    'Notes:',
    '  This script runs curl on the remote host via SSH against http://127.0.0.1:<QB_PORT>.',
    '  It logs in and then GETs /api/v2/torrents/info and writes JSON to stdout.',
  ].join('\n');
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function bashEscape(value) {
  // Safe for embedding as a single-quoted bash string.
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runSshScript({ sshTarget, script, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const ssh = spawn(
      'ssh',
      [
        '-o', 'BatchMode=yes',
        sshTarget,
        'bash',
        '-s',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Avoid noisy stack traces when output is piped and closed early.
    process.stdout.on('error', (e) => {
      if (e && e.code === 'EPIPE') process.exit(0);
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ssh.kill('SIGTERM');
      } catch {
        // ignore
      }
      reject(new Error(`Timed out running ssh script after ${timeoutMs}ms`));
    }, timeoutMs);

    ssh.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`Failed to run ssh: ${e.message}`));
    });

    ssh.stdout.on('data', (d) => stdoutChunks.push(d));
    ssh.stderr.on('data', (d) => stderrChunks.push(d));

    ssh.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `ssh exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    ssh.stdin.write(script);
    ssh.stdin.end();
  });
}

export async function fetchTorrentsInfo({
  sshTarget = 'xobtlu@oracle.usbx.me',
  qbPort = 12041,
  qbUser,
  qbPass,
} = {}) {
  if (!qbUser || !qbPass) {
    throw new Error('Missing qbUser/qbPass');
  }
  if (!Number.isInteger(qbPort) || qbPort <= 0 || qbPort > 65535) {
    throw new Error(`Invalid qbPort: ${qbPort}`);
  }

  // Run curl on the remote host against its localhost WebUI.
  const remoteScript = `set -euo pipefail
QB_USER=${bashEscape(qbUser)}
QB_PASS=${bashEscape(qbPass)}

BASE="http://127.0.0.1:${qbPort}"
COOK="$(mktemp)"
trap 'rm -f "$COOK"' EXIT

LOGIN_RESP="$(curl -sS -c "$COOK" -d "username=${'${QB_USER}'}&password=${'${QB_PASS}'}" "$BASE/api/v2/auth/login" || true)"
if [ "$LOGIN_RESP" != "Ok." ] && [ "$LOGIN_RESP" != "Ok" ]; then
  echo "qBittorrent login failed: $LOGIN_RESP" 1>&2
  exit 1
fi

curl -sS \
  -b "$COOK" \
  -H "Referer: $BASE/" \
  -H "Origin: $BASE" \
  -H "Accept: application/json" \
  "$BASE/api/v2/torrents/info"
`;

  const { stdout } = await runSshScript({ sshTarget, script: remoteScript });
  return stdout;
}

// Convenience default export so callers can do:
//   import fetchTorrentsInfo from './qb-info.js'
export default fetchTorrentsInfo;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usageAndExit(0);
  }

  const qbUser = process.env.QB_USER;
  const qbPass = process.env.QB_PASS;
  if (!qbUser || !qbPass) {
    process.stderr.write('Missing QB_USER and/or QB_PASS.\n');
    usageAndExit(2);
  }

  const sshTarget = parseArgValue(argv, '--ssh') || process.env.SSH_TARGET || 'xobtlu@oracle.usbx.me';
  const qbPortRaw = parseArgValue(argv, '--qb-port') || process.env.QB_PORT;
  const qbPort = qbPortRaw ? Number(qbPortRaw) : 12041;
  const localPortRaw = parseArgValue(argv, '--local-port') || process.env.LOCAL_PORT;
  const localPort = localPortRaw ? Number(localPortRaw) : undefined;

  const json = await fetchTorrentsInfo({ sshTarget, qbPort, qbUser, qbPass, localPort });
  process.stdout.write(json);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
}
