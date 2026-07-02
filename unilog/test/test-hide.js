// unilog/test/test-hide.js — in-memory tests for hide.js text transforms.
// Run locally:  node unilog/test/test-hide.js
// (uses console with `// no-unilog`; this is unilog's own plumbing)

import assert from "node:assert";
import { hideInText, unhideInText } from "../hide.js";

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  pass++;
  console.log("ok -", name); // no-unilog
}

// ---- single-line hide / unhide round-trip ---------------------------------
{
  const src = ["function f() {", "  unilog(42, `hi ${x}`);", "}", ""].join(
    "\n",
  );
  const { text: hidden, hidden: h } = hideInText(src, [42]);
  ok("single: reports id", h.length === 1 && h[0] === 42);
  ok(
    "single: line commented",
    hidden.includes("// deleted   unilog(42, `hi ${x}`);"),
  );
  const { text: back, unhidden: u } = unhideInText(hidden, [42]);
  ok("single: unhide reports id", u.length === 1 && u[0] === 42);
  ok("single: round-trips", back === src);
}

// ---- multi-line call: every line commented, exact span restored -----------
{
  const src = [
    "function f() {",
    "  unilog(7, `line one",
    "    ${mid}`,",
    "    tail);",
    "  const after = 1;",
    "}",
    "",
  ].join("\n");
  const { text: hidden } = hideInText(src, [7]);
  const lines = hidden.split("\n");
  ok("multi: line1 commented", lines[1].startsWith("// deleted   unilog(7,"));
  ok("multi: line2 commented", lines[2].startsWith("// deleted "));
  ok("multi: line3 commented", lines[3].startsWith("// deleted "));
  ok("multi: after-line untouched", lines[4] === "  const after = 1;");
  const { text: back } = unhideInText(hidden, [7]);
  ok("multi: round-trips", back === src);
}

// ---- no-unilog opt-out: never commented ------------------------------------
{
  const src = ["  unilog(9, `x`); // no-unilog", ""].join("\n");
  const { text: out, hidden } = hideInText(src, [9]);
  ok("no-unilog: skipped", hidden.length === 0 && out === src);
}

// ---- idempotent hide -------------------------------------------------------
{
  const src = ["  unilog(5, `y`);", ""].join("\n");
  const once = hideInText(src, [5]).text;
  const twice = hideInText(once, [5]).text;
  ok("hide idempotent", once === twice);
}

// ---- unknown / already-live id is a no-op ----------------------------------
{
  const src = ["  unilog(1, `a`);", ""].join("\n");
  const { unhidden } = unhideInText(src, [1]); // not commented -> nothing
  ok("unhide of live id is no-op", unhidden.length === 0);
}

// ---- adjacent hidden sites: unhide only targets its own span ---------------
{
  const src = ["  unilog(1, `a`);", "  unilog(2, `b`);", ""].join("\n");
  const { text: hidden } = hideInText(src, [1, 2]);
  const { text: back } = unhideInText(hidden, [2]);
  const lines = back.split("\n");
  ok("adjacent: id1 stays hidden", lines[0].startsWith("// deleted "));
  ok("adjacent: id2 restored", lines[1] === "  unilog(2, `b`);");
}

console.log(`\n${pass} checks passed`); // no-unilog
