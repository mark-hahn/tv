// unilog/parse.js — bullet-proof, AST-based detection of old-style log calls.
//
// Why: regex/line scanning breaks on tricky literals like `console.log(")");`
// or templates that span many lines. We parse with @babel/parser and inspect
// real CallExpression nodes, so the closing `)` is found by the grammar, not by
// guessing. .vue files are split with @vue/compiler-sfc and only the <script>
// block is parsed (its offset is added back so positions map to the whole file).
//
// Exports findLogCalls(code, { vue }) -> [{ start, end, line, callee, method,
//   argText, single }] with byte offsets into the ORIGINAL text.
// (unilog plumbing — console with `// no-unilog`.)

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

// Resolve packages that live in pnpm's store (not hoisted to root).
function resolvePnpm(prefix, sub) {
  const base = path.resolve(
    new URL(".", import.meta.url).pathname,
    "../node_modules/.pnpm",
  );
  const dir = fs.readdirSync(base).find((d) => d.startsWith(prefix));
  if (!dir) throw new Error(`cannot find ${prefix} under ${base}`);
  return path.join(base, dir, "node_modules", sub);
}

const babel = require(resolvePnpm("@babel+parser@", "@babel/parser"));
let vueSfc = null;
function getVueSfc() {
  if (!vueSfc)
    vueSfc = require(resolvePnpm("@vue+compiler-sfc@", "@vue/compiler-sfc"));
  return vueSfc;
}

const LOG_FNS = new Set(["log", "loge", "logSubtitle"]);
const CONSOLE_METHODS = new Set(["log", "info", "debug", "warn", "error"]);

const PARSE_OPTS = {
  sourceType: "module",
  errorRecovery: true,
  plugins: ["jsx", "typescript", "topLevelAwait", "objectRestSpread"],
};

// Recursively walk an AST node, calling cb on every object that has a `.type`.
function walk(node, cb) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, cb);
    return;
  }
  if (typeof node.type === "string") cb(node);
  for (const k in node) {
    if (k === "loc" || k === "start" || k === "end") continue;
    walk(node[k], cb);
  }
}

// Identify a logging callee: console.<m>, log(), loge(), logSubtitle().
function calleeInfo(callee) {
  if (
    callee.type === "MemberExpression" &&
    callee.object?.name === "console" &&
    callee.property?.type === "Identifier" &&
    CONSOLE_METHODS.has(callee.property.name)
  )
    return { callee: "console", method: callee.property.name };
  if (callee.type === "Identifier" && LOG_FNS.has(callee.name))
    return { callee: callee.name, method: callee.name };
  return null;
}

// Find all log call sites + existing active `unilog(N, ...)` sites in `code`.
// Offsets are absolute into the original `code` (vue offset added back).
//   old-style: { kind:"old", start, end, line, callee, method, argsText[], firstLiteral }
//   logHere:   old-style with callee:"logHere", plus level, tag, grpNames[]
//   active:    { kind:"active", logId, line, end }
export function findLogCalls(code, { vue = false } = {}) {
  let src = code;
  let offset = 0;
  let lineBase = 0;
  if (vue) {
    const { parse } = getVueSfc();
    const { descriptor } = parse(code);
    const block = descriptor.scriptSetup || descriptor.script;
    if (!block) return [];
    src = block.content;
    offset = block.loc.start.offset;
    lineBase = block.loc.start.line - 1;
  }

  let ast;
  try {
    ast = babel.parse(src, PARSE_OPTS);
  } catch {
    return []; // unparseable — caller leaves file untouched
  }

  const hits = [];
  walk(ast, (n) => {
    if (n.type !== "CallExpression") return;
    const line = lineBase + (n.loc?.start.line ?? 0);

    // Existing active unilog(N, ...) call — read id from the first arg.
    if (n.callee.type === "Identifier" && n.callee.name === "unilog") {
      const a0 = n.arguments[0];
      if (a0 && a0.type === "NumericLiteral") {
        const argsText = n.arguments
          .slice(1)
          .map((a) => src.slice(a.start, a.end));
        hits.push({
          kind: "active",
          logId: a0.value,
          line,
          end: n.end + offset,
          idStart: a0.start + offset,
          idEnd: a0.end + offset,
          argsText,
        });
      }
      return;
    }

    // logHere({ lvl, grp }, <msg>) — the author placeholder.
    // Upgrade to a real unilog site. The first arg MUST be an object literal
    // (the param block); the second arg is the message template string. All
    // param values must be static string literals (or an array of string
    // literals for grp); anything dynamic is ignored and the default is used.
    //   lvl → level  (default "info")
    //   grp → group name(s): string or array of strings (default [])
    if (n.callee.type === "Identifier" && n.callee.name === "logHere") {
      const LEVELS = ["info", "warn", "error", "debug"];
      const a0 = n.arguments[0];
      let level = "info";
      let grpNames = [];
      if (a0 && a0.type === "ObjectExpression") {
        for (const prop of a0.properties) {
          if (prop.type !== "ObjectProperty" || prop.computed) continue;
          const key = prop.key.name || prop.key.value;
          const v = prop.value;
          if (key === "lvl") {
            if (v.type === "StringLiteral" && LEVELS.includes(v.value))
              level = v.value;
          } else if (key === "grp") {
            if (v.type === "StringLiteral") grpNames = [v.value];
            else if (v.type === "ArrayExpression")
              grpNames = v.elements
                .filter((e) => e && e.type === "StringLiteral")
                .map((e) => e.value);
          }
        }
      }
      const msgArgs = n.arguments.slice(1);
      hits.push({
        kind: "old",
        start: n.start + offset,
        end: n.end + offset,
        line,
        callee: "logHere",
        method: "logHere",
        level,
        grpNames,
        argsText: msgArgs.map((a) => src.slice(a.start, a.end)),
        firstLiteral: false,
      });
      return;
    }

    const info = calleeInfo(n.callee);
    if (!info) return;
    const argsText = n.arguments.map((a) => src.slice(a.start, a.end));
    const a0 = n.arguments[0];
    const firstLiteral =
      a0 && (a0.type === "StringLiteral" || a0.type === "TemplateLiteral");
    hits.push({
      kind: "old",
      start: n.start + offset,
      end: n.end + offset,
      line,
      callee: info.callee,
      method: info.method,
      argsText,
      firstLiteral: !!firstLiteral,
    });
  });
  hits.sort((a, b) => a.line - b.line);
  return hits;
}
