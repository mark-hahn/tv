// unilog runtime smoke test — exercises the end-to-end Step 3 infra and the
// Step 2 reconciler against the real remote DB, then leaves all results in
// unilog.sqlite (tables log_groups/log_sites/log_events + tool_tests) for review.
//
// Run on remote AFTER tv-srvr is deployed:
//   node /root/dev/apps/tv/unilog/test/smoke-runtime.js
// (unilog plumbing — console with `// no-unilog`.)

import fs from "node:fs";
import {
  db,
  nowPst,
  createGroup,
  createSite,
  insertEvent,
  dbInfo,
} from "../../apps/srvr/src/unilogDb.js";
import { reconcileFilesWithDb } from "../reconcile.js";

const POST_URL = "http://127.0.0.1:8739/api/log"; // srvr internal port
const results = [];
const note = (name, pass, detail) =>
  results.push({ name, pass: !!pass, detail });

// 1) groups + sites (direct DB owner path)
const groupId = createGroup({
  groupType: "conversation",
  description: "unilog smoke run",
});
note(
  "createGroup returns id",
  Number.isInteger(groupId) && groupId > 0,
  "group=" + groupId,
);

const siteId = createSite({
  level: "info",
  tag: "smoke",
  description: "smoke direct write",
  srcFile: "TEST/smoke",
  srcLine: 1,
  project: "srvr",
  groupIds: [groupId],
});
note(
  "createSite returns id",
  Number.isInteger(siteId) && siteId > 0,
  "site=" + siteId,
);

const linked = db
  .prepare("SELECT COUNT(*) n FROM site_groups WHERE log_id=? AND group_id=?")
  .get(siteId, groupId).n;
note("site_groups link written", linked === 1, "linked=" + linked);

// 2) direct writer path (in-process sink equivalent)
for (let i = 0; i < 3; i++)
  insertEvent({ logId: siteId, pid: "tv-srvr", message: `direct event ${i}` });

// 3) POST /api/log path (other-process / client transport -> central writer)
let posted = 0;
try {
  const res = await fetch(POST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { logId: siteId, pid: "smoke-post", message: "posted event a" },
      { logId: siteId, pid: "smoke-post", message: "posted event b" },
    ]),
  });
  const j = await res.json();
  posted = j.count || 0;
  note(
    "POST /api/log accepted batch",
    res.ok && posted === 2,
    JSON.stringify(j),
  );
} catch (e) {
  note("POST /api/log accepted batch", false, "ERROR " + (e?.message || e));
}

// give the srvr-side writer a moment to flush its own connection
await new Promise((r) => setTimeout(r, 400));

const directCount = db
  .prepare("SELECT COUNT(*) n FROM log_events WHERE log_id=? AND pid='tv-srvr'")
  .get(siteId).n;
const postCount = db
  .prepare(
    "SELECT COUNT(*) n FROM log_events WHERE log_id=? AND pid='smoke-post'",
  )
  .get(siteId).n;
note(
  "direct events persisted (>=3)",
  directCount >= 3,
  "direct=" + directCount,
);
note("posted events persisted (>=2)", postCount >= 2, "post=" + postCount);

// 4) reconciler end-to-end against the real DB (temp file)
const tmp = "/tmp/unilog-smoke-src.js";
fs.writeFileSync(
  tmp,
  [
    "function demo(p, n) {",
    "  console.log(`[smoke] reconciled add: ${p}`);",
    "  // unilog-stub {level=warn,tag=smoke} unilog(`low ${n}`);",
    '  console.log("multi", n); // stays old-style (multi-arg)',
    "}",
    "",
  ].join("\n"),
);
const before = db.prepare("SELECT COUNT(*) n FROM log_sites").get().n;
const summary = await reconcileFilesWithDb([tmp]);
const after = db.prepare("SELECT COUNT(*) n FROM log_sites").get().n;
const rewritten = fs.readFileSync(tmp, "utf8");
const activeCalls = (rewritten.match(/\/\/ log-id: \d+/g) || []).length;
note(
  "reconciler created 2 sites + rewrote source",
  after - before === 2 &&
    activeCalls === 2 &&
    /unilog\(\d+, `reconciled add/.test(rewritten),
  JSON.stringify({ summary, activeCalls }),
);
note(
  "reconciler left multi-arg console.log",
  /console\.log\("multi", n\);/.test(rewritten),
  "ok",
);

// 5) persist tool_tests rows
db.exec(`CREATE TABLE IF NOT EXISTS tool_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, suite TEXT, name TEXT, pass INTEGER, detail TEXT
);`);
const ts = nowPst();
const ins = db.prepare(
  "INSERT INTO tool_tests (ts, suite, name, pass, detail) VALUES (?,?,?,?,?)",
);
db.transaction((rows) => {
  for (const r of rows)
    ins.run(ts, "smoke-runtime", r.name, r.pass ? 1 : 0, r.detail);
})(results);

for (const r of results)
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  — ${r.detail}`); // no-unilog
const failed = results.filter((r) => !r.pass).length;
console.log("\nDB:", JSON.stringify(dbInfo())); // no-unilog
console.log(
  `smoke-runtime: ${results.length - failed} passed, ${failed} failed @ ${ts}`,
); // no-unilog
process.exit(failed ? 1 : 0);
