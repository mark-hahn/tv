#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'data', 'tvdb.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'created.json');
// no fixed count: process all top-level keys

function isoDate(d) { return d.toISOString().slice(0, 10); }

if (!fs.existsSync(INPUT)) {
  console.error('Input file not found:', INPUT);
  process.exitCode = 2;
}

const raw = fs.readFileSync(INPUT, 'utf8');
let obj;
try {
  obj = JSON.parse(raw);
} catch (err) {
  const msg = err && err.message ? String(err.message) : 'JSON.parse failed';
  const posMatch = /position\s+(\d+)/i.exec(msg);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    const before = raw.slice(0, pos);
    const lines = before.split(/\r?\n/);
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    console.error(`Failed to parse JSON: ${msg}`);
    console.error(`Error location: line ${line}, column ${col} (position ${pos})`);
  } else {
    console.error('Failed to parse JSON:', msg);
  }
  process.exitCode = 3;
  process.exit();
}

const keys = Object.keys(obj);
const available = keys.length;
const assignments = [];

// Scan keys in reverse (last -> first), assigning dates starting at 2025-10-22
let d = new Date('2025-10-22');
for (let i = 0; i < available; i++) {
  const idx = keys.length - 1 - i; // start from last key and go backward
  const key = keys[idx];
  assignments.push({ key, date: isoDate(d) });
  d.setDate(d.getDate() - 1);
}

// Sort by date ascending so the output object has oldest date first
assignments.sort((a, b) => a.date.localeCompare(b.date));

const out = {};
for (const a of assignments) out[a.key] = a.date;

fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`Wrote ${OUTPUT} (${Object.keys(out).length} entries, used ${Object.keys(out).length} of ${available} top-level keys)`);
