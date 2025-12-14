#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadCreds } from './qb-cred.js';

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
    '  node qbt-torrents.js [--ssh user@host] [--qb-port 12041]',
    '',
    'Config:',
    '  Reads defaults from torrents/qb-cred.txt:',
    '    QB_USER, QB_PASS, SSH_TARGET, optional QB_PORT',
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
  sshTarget,
  qbPort,
  qbUser,
  qbPass,
} = {}) {
  const { creds: fileCreds } = await loadCreds();

  const resolvedQbUser = qbUser || fileCreds.QB_USER;
  const resolvedQbPass = qbPass || fileCreds.QB_PASS;
  const resolvedSshTarget = sshTarget || fileCreds.SSH_TARGET;
  const resolvedQbPortRaw =
    qbPort ??
    (fileCreds.QB_PORT ? Number(fileCreds.QB_PORT) : 12041);

  if (!resolvedQbUser || !resolvedQbPass) {
    throw new Error('Missing QB_USER/QB_PASS in torrents/qb-cred.txt');
  }
  if (!resolvedSshTarget) {
    throw new Error('Missing SSH_TARGET in torrents/qb-cred.txt');
  }
  if (!Number.isInteger(resolvedQbPortRaw) || resolvedQbPortRaw <= 0 || resolvedQbPortRaw > 65535) {
    throw new Error(`Invalid qbPort: ${resolvedQbPortRaw}`);
  }

  // Run curl on the remote host against its localhost WebUI.
  const remoteScript = `set -euo pipefail
QB_USER=${bashEscape(resolvedQbUser)}
QB_PASS=${bashEscape(resolvedQbPass)}

BASE="http://127.0.0.1:${resolvedQbPortRaw}"
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

  const { stdout } = await runSshScript({ sshTarget: resolvedSshTarget, script: remoteScript });
  return stdout;
}

// Convenience default export so callers can do:
//   import fetchTorrentsInfo from './qbt-torrents.js'
export default fetchTorrentsInfo;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usageAndExit(0);
  }

  const sshTarget = parseArgValue(argv, '--ssh');
  const qbPortRaw = parseArgValue(argv, '--qb-port');
  const qbPort = qbPortRaw ? Number(qbPortRaw) : undefined;

  const json = await fetchTorrentsInfo({ sshTarget, qbPort });
  process.stdout.write(json);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
}
