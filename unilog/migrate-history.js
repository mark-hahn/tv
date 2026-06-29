#!/usr/bin/env node
// unilog/migrate-history.js — one-shot migration that:
//   1. Creates a 'history' unilog group
//   2. Replaces every postHistory/history.addEvent call with unilog(id, ...)
//   3. Removes the history infrastructure (imports, endpoint, history.js files)
// Run ONCE. Safe to re-run (skips already-replaced sites).
// (unilog plumbing — console with `// no-unilog`.)

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { extractLeadingTag } from "./unilog-lib.js";

const SSH_HOST = "hahnca.com";
const REMOTE_DB = "/root/dev/apps/tv/unilog/unilog.sqlite";
const SRVR_URL = "https://hahnca.com/tv-srvr";
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const req = createRequire(import.meta.url);
function findPnpm(prefix) {
  const base = path.join(REPO_ROOT, "node_modules/.pnpm");
  const dir = fs.readdirSync(base).find((d) => d.startsWith(prefix));
  // The dir contains node_modules/@scope/pkg; rebuild full path from pnpm dirname
  // e.g. @babel+parser@7.28.6 → @babel/parser
  const parts = dir.split("@").filter(Boolean); // ["babel+parser", "7.28.6"]
  const pkgPath = parts[0].replace(/\+/g, "/"); // "babel/parser"
  return path.join(base, dir, "node_modules", "@" + pkgPath);
}
const babel = req(path.join(findPnpm("@babel+parser@"), "lib/index.js"));

const PARSE_OPTS = {
  sourceType: "module",
  errorRecovery: true,
  plugins: ["topLevelAwait", "objectRestSpread"],
};

function walk(n, cb) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) {
    for (const x of n) walk(x, cb);
    return;
  }
  if (n.type) cb(n);
  for (const k in n) {
    if (k === "loc" || k === "start" || k === "end") continue;
    walk(n[k], cb);
  }
}

// ---- DB helpers (always ssh for this script) ----------------------------

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
function sqlRun(sql) {
  const r = spawnSync(
    "ssh",
    [SSH_HOST, `sqlite3 ${REMOTE_DB} ${JSON.stringify(sql)}`],
    { encoding: "utf8" },
  );
  if (r.status !== 0)
    throw new Error((r.stderr || "ssh sqlite3 failed").trim());
  return (r.stdout || "").trim();
}
function nowPst() {
  const d = new Date();
  const date = d
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
  let time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles",
    hour12: false,
  });
  if (time.startsWith("24:")) time = "00:" + time.slice(3);
  return `${date} ${time}`;
}

// ---- create 'history' group --------------------------------------------

const ts = nowPst();
sqlRun(
  `INSERT INTO log_groups (group_id, group_type, ts, description) VALUES ((SELECT COALESCE(MAX(group_id),0)+1 FROM log_groups),'history',${q(ts)},'history migration');`,
);
const groupId = Number(sqlRun("SELECT MAX(group_id) FROM log_groups;"));
console.log(`[migrate-history] created group id=${groupId}`); // no-unilog

// ---- collect call sites -------------------------------------------------

const FILES = [
  { file: "apps/srvr/index.js", project: "srvr" },
  { file: "apps/down/src/main.js", project: "down" },
  { file: "apps/down/src/tvJson.js", project: "down" },
  { file: "apps/api/src/server.js", project: "api" },
];

// Extract property expression source text from an ObjectExpression
function prop(obj, key, src) {
  const p = obj.properties.find((p) => (p.key?.name || p.key?.value) === key);
  if (!p) return null;
  return src.slice(p.value.start, p.value.end);
}

const sites = []; // { file, start, end, srcLine, typeExpr, showNameExpr, descExpr, project }
for (const { file, project } of FILES) {
  const abs = path.join(REPO_ROOT, file);
  const src = fs.readFileSync(abs, "utf8");
  const ast = babel.parse(src, PARSE_OPTS);
  walk(ast, (n) => {
    if (n.type !== "CallExpression") return;
    const isPost =
      n.callee.type === "Identifier" && n.callee.name === "postHistory";
    const isAdd =
      n.callee.type === "MemberExpression" &&
      n.callee.object?.name === "history" &&
      n.callee.property?.name === "addEvent";
    if (!isPost && !isAdd) return;
    const arg = n.arguments[0];
    if (!arg || arg.type !== "ObjectExpression") return;
    const typeExpr = prop(arg, "type", src) || '"unknown"';
    const showNameExpr = prop(arg, "showName", src) || '""';
    const descExpr = prop(arg, "description", src);
    const indent = /^(\s*)/.exec(src.split("\n")[n.loc.start.line - 1])[1];
    sites.push({
      file,
      abs,
      src,
      start: n.start,
      end: n.end,
      srcLine: n.loc.start.line,
      project,
      typeExpr,
      showNameExpr,
      descExpr,
      indent,
    });
  });
}
console.log(`[migrate-history] found ${sites.length} call sites`); // no-unilog

// ---- allocate IDs via batch ssh insert ----------------------------------

const ts2 = nowPst();
const insStmts = sites.map(
  (s, i) =>
    `INSERT INTO log_sites (log_id, tag, description, level, src_file, src_line, project, created_at) VALUES ` +
    `((SELECT COALESCE(MAX(log_id),0)+${i + 1} FROM log_sites), 'history', 'history migration', 'info', ` +
    `${q(s.file)}, ${s.srcLine}, ${q(s.project)}, ${q(ts2)});`,
);
// We need IDs in order; pre-compute the current max then assign sequentially
const currentMax = Number(
  sqlRun("SELECT COALESCE(MAX(log_id),0) FROM log_sites;"),
);
const ids = sites.map((_, i) => currentMax + i + 1);

const insertScript =
  "BEGIN;\n" +
  sites
    .map(
      (s, i) =>
        `INSERT INTO log_sites (log_id, tag, description, level, src_file, src_line, project, created_at) ` +
        `VALUES (${ids[i]}, 'history', 'history migration', 'info', ${q(s.file)}, ${s.srcLine}, ${q(s.project)}, ${q(ts2)});\n` +
        `INSERT OR IGNORE INTO site_groups (log_id, group_id) VALUES (${ids[i]}, ${groupId});`,
    )
    .join("\n") +
  "\nCOMMIT;";
const r = spawnSync("ssh", [SSH_HOST, `sqlite3 ${REMOTE_DB}`], {
  input: insertScript,
  encoding: "utf8",
});
if (r.status !== 0) throw new Error((r.stderr || "batch insert failed").trim());
console.log(`[migrate-history] allocated ids ${ids[0]}–${ids[ids.length - 1]}`); // no-unilog

// ---- replace call sites offset-by-offset (end-to-start per file) --------

const byFile = new Map();
for (let i = 0; i < sites.length; i++) {
  const s = sites[i];
  if (!byFile.has(s.file)) byFile.set(s.file, []);
  byFile.get(s.file).push({ ...s, id: ids[i] });
}

for (const [file, fileSites] of byFile) {
  const abs = path.join(REPO_ROOT, file);
  let src = fs.readFileSync(abs, "utf8");
  // Process end-to-start so earlier offsets stay valid.
  fileSites.sort((a, b) => b.start - a.start);
  for (const s of fileSites) {
    const descPart = s.descExpr ? `, ${s.descExpr}` : "";
    const replacement = `unilog(${s.id}, "history", ${s.typeExpr}, ${s.showNameExpr}${descPart})`;
    src = src.slice(0, s.start) + replacement + src.slice(s.end);
  }
  fs.writeFileSync(abs, src, "utf8");
  console.log(`[migrate-history] ${file}: replaced ${fileSites.length} sites`); // no-unilog
}

// ---- remove history infrastructure -------------------------------------

// 1. apps/srvr/index.js: strip import, strip /api/history endpoints
{
  const abs = path.join(REPO_ROOT, "apps/srvr/index.js");
  let src = fs.readFileSync(abs, "utf8");
  src = src.replace(
    /^import \* as history from "\.\/src\/history\.js";\n/m,
    "",
  );
  // Remove the three history endpoint blocks (POST + two GETs)
  src = src.replace(
    /\/\/ History\napp\.post\("\/api\/history"[\s\S]*?app\.get\("\/api\/flexget-history"/,
    'app.get("/api/flexget-history"',
  );
  fs.writeFileSync(abs, src, "utf8");
  console.log(
    "[migrate-history] srvr/index.js: removed history import + endpoints",
  ); // no-unilog
}

// 2. apps/down/src/main.js: remove postHistory from the @tv/share import
{
  const abs = path.join(REPO_ROOT, "apps/down/src/main.js");
  let src = fs.readFileSync(abs, "utf8");
  src = src.replace(/\s*postHistory,\n?/, "\n");
  fs.writeFileSync(abs, src, "utf8");
  console.log("[migrate-history] down/main.js: removed postHistory import"); // no-unilog
}

// 3. apps/down/src/tvJson.js: remove postHistory import line
{
  const abs = path.join(REPO_ROOT, "apps/down/src/tvJson.js");
  let src = fs.readFileSync(abs, "utf8");
  src = src.replace(/^import \{ postHistory \} from "@tv\/share";\n/m, "");
  fs.writeFileSync(abs, src, "utf8");
  console.log("[migrate-history] down/tvJson.js: removed postHistory import"); // no-unilog
}

// 4. apps/api/src/server.js: remove postHistory from import
{
  const abs = path.join(REPO_ROOT, "apps/api/src/server.js");
  if (fs.existsSync(abs)) {
    let src = fs.readFileSync(abs, "utf8");
    src = src.replace(/\s*postHistory,\n?/, "\n");
    fs.writeFileSync(abs, src, "utf8");
    console.log("[migrate-history] api/server.js: removed postHistory import"); // no-unilog
  }
}

// 4. packages/share/src/index.js: remove postHistory export
{
  const abs = path.join(REPO_ROOT, "packages/share/src/index.js");
  let src = fs.readFileSync(abs, "utf8");
  src = src.replace(/^export \{ postHistory \} from "\.\/history\.js";\n/m, "");
  fs.writeFileSync(abs, src, "utf8");
  console.log("[migrate-history] share/index.js: removed postHistory export"); // no-unilog
}

// 5. Delete the two history.js files
for (const f of ["apps/srvr/src/history.js", "packages/share/src/history.js"]) {
  const abs = path.join(REPO_ROOT, f);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
    console.log(`[migrate-history] deleted ${f}`);
  } // no-unilog
}

console.log("[migrate-history] done."); // no-unilog
