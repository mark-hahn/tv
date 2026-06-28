#!/usr/bin/env node
// unilog CLI — the deterministic backend the unilog agent calls to ADD or
// REMOVE a log site in source. It only edits source (writes a `// unilog-stub`
// line, or deletes a stub / active line). It NEVER touches the DB — the DB is
// updated later by the deploy-time reconciler (plan §6.1/§7).
//
// Add:    node unilog/unilog-cli.js --file F (--anchor "TXT" | --line N)
//             [--position before|after] [--level info|warn|error]
//             --message 'EXPR' [--tag T] [--dry-run]
// Remove: node unilog/unilog-cli.js --remove --file F --line N [--dry-run]
//
// On an ambiguous anchor (0 or >1 matches) it refuses and asks the agent to
// narrow it (plan §6.2). (unilog plumbing — console with `// no-unilog`.)

import fs from "node:fs";
import {
  buildStub,
  extractLeadingTag,
  parseStub,
  parseLogId,
} from "./unilog-lib.js";

function parseArgs(argv) {
  const a = { position: "after", level: "info" };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--remove") a.remove = true;
    else if (t === "--dry-run") a.dryRun = true;
    else if (t.startsWith("--")) a[t.slice(2)] = argv[++i];
  }
  return a;
}

function die(msg) {
  console.error("error: " + msg); // no-unilog
  process.exit(1);
}

// Split a JS literal "EXPR" into { quote, content } when it is a single
// string/template literal; otherwise treat the whole thing as a raw expr.
function splitLiteral(expr) {
  const s = String(expr || "").trim();
  const q = s[0];
  if ((q === "`" || q === '"' || q === "'") && s[s.length - 1] === q)
    return { quote: q, content: s.slice(1, -1), raw: false };
  return { quote: null, content: s, raw: true };
}

function findAnchor(lines, anchor) {
  const hits = [];
  for (let i = 0; i < lines.length; i++)
    if (lines[i].includes(anchor)) hits.push(i);
  return hits;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) die("missing --file");
const text = fs.readFileSync(args.file, "utf8");
const nl = text.includes("\r\n") ? "\r\n" : "\n";
const lines = text.split(/\r?\n/);

if (args.remove) {
  const ln = Number(args.line);
  if (!ln || ln < 1 || ln > lines.length) die("invalid --line for --remove");
  const target = lines[ln - 1];
  if (!parseStub(target) && parseLogId(target) == null)
    die(`line ${ln} is not a unilog stub or active call: ${target.trim()}`);
  const removed = lines.splice(ln - 1, 1)[0];
  if (!args.dryRun) fs.writeFileSync(args.file, lines.join(nl), "utf8");
  console.log(
    JSON.stringify({
      action: "remove",
      file: args.file,
      line: ln,
      removed: removed.trim(),
      dryRun: !!args.dryRun,
    }),
  ); // no-unilog
  process.exit(0);
}

// ---- add ----
if (!args.message) die("missing --message");

let idx;
if (args.anchor) {
  const hits = findAnchor(lines, args.anchor);
  if (hits.length === 0)
    die(`anchor not found: ${JSON.stringify(args.anchor)}`);
  if (hits.length > 1)
    die(
      `anchor not unique (${hits.length} matches) — narrow it or use --line: ${JSON.stringify(args.anchor)}`,
    );
  idx = hits[0];
} else if (args.line) {
  idx = Number(args.line) - 1;
  if (idx < 0 || idx >= lines.length) die("invalid --line");
} else {
  die("provide --anchor or --line");
}

const indent = /^(\s*)/.exec(lines[idx])[1];
const lit = splitLiteral(args.message);
let tag = args.tag || null;
let argExpr = args.message.trim();
if (!lit.raw) {
  const ex = extractLeadingTag(lit.content);
  if (ex.tag && !tag) tag = ex.tag;
  argExpr = `${lit.quote}${ex.content}${lit.quote}`;
}

const stub = buildStub({ indent, level: args.level, tag, argExpr });
const insertAt = args.position === "before" ? idx : idx + 1;
lines.splice(insertAt, 0, stub);
if (!args.dryRun) fs.writeFileSync(args.file, lines.join(nl), "utf8");

console.log(
  // no-unilog
  JSON.stringify({
    action: "add",
    file: args.file,
    line: insertAt + 1,
    level: args.level,
    tag,
    inserted: stub.trim(),
    dryRun: !!args.dryRun,
  }),
);
