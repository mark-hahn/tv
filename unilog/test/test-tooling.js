// unilog tooling test — runs deterministic cases against unilog-lib.js and
// records every result in unilog.sqlite (table `tool_tests`) so the DB can be
// reviewed after the run. Intended to run on the remote (reuses the srvr DB).
//
// Run on remote:  node /root/dev/apps/tv/unilog/test/test-tooling.js
// (uses console with `// no-unilog`; this is unilog's own plumbing)

import {
  buildStub,
  parseStub,
  activateStub,
  sanityCheckDescription,
} from "../unilog-lib.js";
import { reconcileText, scanLines, projectOf } from "../reconcile.js";
import { db, nowPst } from "../../apps/srvr/src/unilogDb.js";

const results = [];
function check(suite, name, pass, detail) {
  results.push({ suite, name, pass: !!pass, detail });
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- stub round-trip ------------------------------------------------------

{
  const stub = buildStub({
    indent: "    ",
    level: "info",
    tag: "chokidar",
    argExpr: "`detected add: ${filePath}`",
  });
  const p = parseStub(stub);
  const a = activateStub(stub, 42);
  const pass =
    p &&
    p.level === "info" &&
    p.tag === "chokidar" &&
    a &&
    a.line === "    unilog(42, `detected add: ${filePath}`);";
  check(
    "stub",
    "build -> parse -> activate",
    pass,
    JSON.stringify({ stub, p, a }),
  );
}

// ---- description sanity check ---------------------------------------------

{
  const r = sanityCheckDescription("log when a bif build is queued", {
    tag: "bif",
    argExpr: "`queued ${show} ${bifPath}`",
  });
  check("sanity", "relevant prompt accepted", r.ok === true, JSON.stringify(r));
}
{
  const r = sanityCheckDescription("completely unrelated banana sandwich", {
    tag: "bif",
    argExpr: "`queued ${show}`",
  });
  check(
    "sanity",
    "irrelevant prompt -> fallback",
    r.ok === false && !!r.description,
    JSON.stringify(r),
  );
}
{
  const r = sanityCheckDescription("", { argExpr: "`x`" });
  check(
    "sanity",
    "empty prompt -> fallback",
    r.ok === false && !!r.description,
    JSON.stringify(r),
  );
}

// ---- reconciler -----------------------------------------------------------

{
  const sample = [
    "function f() {",
    "  console.log(`[chokidar] detected add: ${p}`);",
    "  // unilog-stub {level=warn,tag=disk} unilog(`low ${n}`);",
    '  console.log("multi", x);',
    "  unilog(7, `already`); // log-id: 7",
    "}",
  ].join("\n");

  const scan = scanLines(sample.split("\n"), "apps/srvr/index.js");
  check(
    "reconcile",
    "scan finds 2 creates + 1 refresh",
    scan.creates.length === 2 &&
      scan.refreshes.length === 1 &&
      scan.refreshes[0].logId === 7,
    JSON.stringify(scan),
  );

  let counter = 100;
  const r = reconcileText(sample, "apps/srvr/index.js", () => counter++);
  const out = r.text.split("\n");
  const pass =
    r.changed &&
    out[1] === "  unilog(100, `detected add: ${p}`); // log-id: 100" &&
    out[2] === "  unilog(101, `low ${n}`); // log-id: 101" &&
    out[3] === '  console.log("multi", x);' &&
    out[4] === "  unilog(7, `already`); // log-id: 7" &&
    r.refreshes.length === 1 &&
    r.refreshes[0].srcLine === 5;
  check(
    "reconcile",
    "activate + upgrade + refresh + leave multi-arg",
    pass,
    JSON.stringify({ out, refreshes: r.refreshes }),
  );
}
{
  check(
    "reconcile",
    "projectOf srvr",
    projectOf("apps/srvr/index.js") === "srvr",
    projectOf("apps/srvr/index.js") || "null",
  );
}

// ---- persist results to unilog.sqlite ------------------------------------

db.exec(`CREATE TABLE IF NOT EXISTS tool_tests (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT,
  suite  TEXT,
  name   TEXT,
  pass   INTEGER,
  detail TEXT
);`);

const ts = nowPst();
const ins = db.prepare(
  "INSERT INTO tool_tests (ts, suite, name, pass, detail) VALUES (?, ?, ?, ?, ?)",
);
const writeAll = db.transaction((rows) => {
  for (const r of rows) ins.run(ts, r.suite, r.name, r.pass ? 1 : 0, r.detail);
});
writeAll(results);

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
for (const r of results)
  console.log(`${r.pass ? "PASS" : "FAIL"}  [${r.suite}] ${r.name}`); // no-unilog
console.log(`\ntool_tests: ${passed} passed, ${failed} failed @ ${ts}`); // no-unilog
process.exit(failed ? 1 : 0);
