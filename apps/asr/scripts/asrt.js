#!/usr/bin/env node

// Remote test helper for @tv/asr.
// Writes:
//  - ./asrt-id.txt (saved asrId from start)
//  - ./asrt-results.txt (appended results)

import fs from 'fs';
import path from 'node:path';

// Safe LAN / local box: ignore TLS verification if needed.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const ASR_URL = process.env.ASR_URL || 'https://hahnca.com/asr/controlAsr';

const START_FOLDER = '/mnt/media/tv/Less Than Perfect/Season 1';
const START_FILE = 'Less.Than.Perfect.s01e01.Pilot.DVDRip.AC3.XviD.avi';
const START_SFX = 'entst';

const idPath = path.join(__dirname, 'asrt-id.txt');
const resultsPath = path.join(__dirname, 'asrt-results.txt');

function nowIso() {
  return new Date().toISOString();
}

function appendResult(obj) {
  const txt = `========== ${nowIso()}\n${JSON.stringify(obj, null, 2)}\n`;
  fs.appendFileSync(resultsPath, txt, 'utf8');
}

function readAsrIdOrThrow() {
  if (!fs.existsSync(idPath)) {
    throw new Error(`Missing ${idPath}`);
  }
  const raw = fs.readFileSync(idPath, 'utf8').trim();
  const id = Number(raw);
  if (!Number.isFinite(id)) throw new Error(`Invalid asrId in ${idPath}: ${raw}`);
  return id;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(txt);
  } catch {
    parsed = { raw: txt };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

async function main() {
  const cmd = String(process.argv[2] || '').trim();
  if (!cmd) {
    console.error('Usage: asrt.js start|status|dump|kill');
    process.exit(1);
  }

  let asrArgs = null;

  if (cmd === 'start') {
    asrArgs = {
      command: 'start',
      provider: 'gpt',
      folder: START_FOLDER,
      file: START_FILE,
      sfx: START_SFX,
    };
  } else {
    asrArgs = {
      asrId: readAsrIdOrThrow(),
      command: cmd,
    };
  }

  const out = await postJson(ASR_URL, asrArgs);
  appendResult({ url: ASR_URL, asrArgs, out });

  if (cmd === 'start') {
    const id = out?.body?.asrId;
    if (!Number.isFinite(Number(id))) {
      throw new Error(`start did not return numeric asrId: ${JSON.stringify(out?.body)}`);
    }
    fs.writeFileSync(idPath, String(id), 'utf8');
  }

  // Print a compact summary
  console.log(JSON.stringify(out.body, null, 2));
}

main().catch((err) => {
  const payload = { error: err?.message || String(err), stack: err?.stack || null };
  try { appendResult(payload); } catch { /* ignore */ }
  console.error(err);
  process.exit(1);
});
