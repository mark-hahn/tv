// unilog tooling library — pure, deterministic helpers shared by the CLI,
// the reconciler, and the test scripts. No DB, no fs, no network here.
//
// Covers:
//   - the old-style -> unilog auto-upgrade transform (single string/template arg)
//   - stub parsing + activation (stub -> active `unilog(id, ...)` call)
//   - tag extraction, level derivation
//   - the description sanity check + context fallback
//
// This plumbing is intentionally NOT instrumented with unilog.

// ---- levels ---------------------------------------------------------------

export const LEVEL_BY_METHOD = {
  log: "info",
  info: "info",
  debug: "debug",
  warn: "warn",
  error: "error",
  loge: "error",
  logSubtitle: "info",
};

export function levelForCall(callee, method) {
  if (callee === "console") return LEVEL_BY_METHOD[method] || "info";
  return LEVEL_BY_METHOD[callee] || "info";
}

// ---- tag handling ---------------------------------------------------------

// Pull a leading "[tag]" out of literal CONTENT (text between the quotes).
// Returns { tag, content } with the tag (and one following space) stripped.
export function extractLeadingTag(content) {
  const m = /^\[([^\]]+)\]\s*/.exec(content);
  if (!m) return { tag: null, content };
  return { tag: m[1].trim(), content: content.slice(m[0].length) };
}

// ---- old-style detection --------------------------------------------------

// Match a WHOLE-LINE call whose single argument is one string/template literal:
//   console.log(`...`)  console.warn("...")  log('...')  loge(`...`)  logSubtitle(`...`)
// Multi-arg calls, non-literal args, or args spanning lines do NOT match
// (the agent must handle those — see plan §6.2 anchor escalation).
const SINGLE_LITERAL_RE =
  /^(\s*)(?:(console)\.(log|info|debug|warn|error)|(log|loge|logSubtitle))\((`(?:\\.|\$\{[^}]*\}|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\)\s*;?\s*$/;

// Shared literal pattern reused by the multi-line matcher below.
const LITERAL_ONLY_RE =
  /^\s*(`(?:\\.|\$\{[^}]*\}|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'),?\s*$/;

const OPEN_CALL_RE =
  /^(\s*)(?:(console)\.(log|info|debug|warn|error)|(log|loge|logSubtitle))\(\s*$/;

const CLOSE_CALL_RE = /^\s*\);\s*$/;

// Match an old-style log call that spans multiple lines:
//   console.log(          ← line at startIdx; nothing after the `(`
//     `any literal`,      ← one or more lines of a single literal argument
//   );                    ← first line matching `);` after the open
//
// Returns { indent, callee, method, quote, content, lineCount } or null.
// `lineCount` is the total number of source lines consumed (open + arg + close).
// The caller should advance its loop index by (lineCount - 1) after a match.
export function matchMultiLineOldStyle(lines, startIdx) {
  const line0 = lines[startIdx];
  if (!line0) return null;
  if (/\/\/\s*no-unilog\s*$/.test(line0)) return null;
  const m0 = OPEN_CALL_RE.exec(line0);
  if (!m0) return null;

  // Find the first `);` within a reasonable window.
  const MAX_WINDOW = 15;
  let closeIdx = -1;
  for (
    let j = startIdx + 1;
    j <= Math.min(startIdx + MAX_WINDOW, lines.length - 1);
    j++
  ) {
    if (CLOSE_CALL_RE.test(lines[j])) {
      closeIdx = j;
      break;
    }
  }
  if (closeIdx < 0) return null;

  // Collect argument lines, join them, strip trailing comma.
  const argLines = lines.slice(startIdx + 1, closeIdx);
  if (argLines.length === 0) return null;
  const joined = argLines
    .map((l) => l.trim())
    .join("\n")
    .replace(/,\s*$/, "")
    .trim();

  // Must be a single literal: starts and ends with the same quote character.
  const quote = joined[0];
  if (quote !== "`" && quote !== '"' && quote !== "'") return null;
  const trimmed = joined.trimEnd();
  if (trimmed[trimmed.length - 1] !== quote) return null;

  const content = joined.slice(1, trimmed.length - 1);
  const indent = m0[1];
  const callee = m0[2] ? "console" : m0[4];
  const method = m0[3] || m0[4];
  return {
    indent,
    callee,
    method,
    quote,
    content,
    lineCount: closeIdx - startIdx + 1,
  };
}

// Returns null when the line is not an upgradeable old-style single-literal call.
export function matchOldStyle(line) {
  const m = SINGLE_LITERAL_RE.exec(line);
  if (!m) return null;
  const indent = m[1];
  const callee = m[2] ? "console" : m[4];
  const method = m[3] || m[4];
  const literal = m[5];
  const quote = literal[0];
  const content = literal.slice(1, -1);
  return { indent, callee, method, quote, content };
}

// ---- stub grammar ---------------------------------------------------------
//
//   // unilog-stub {level=info,tag=chokidar} unilog(`detected add: ${p}`);
//   // unilog-stub {level=warn} unilog("low disk");
//
// `tag` is optional. The argument is the (tag-stripped) message expression.

export function buildStub({
  indent = "",
  level = "info",
  tag = null,
  argExpr,
}) {
  const meta = tag ? `level=${level},tag=${tag}` : `level=${level}`;
  return `${indent}// unilog-stub {${meta}} unilog(${argExpr});`;
}

const STUB_RE = /^(\s*)\/\/ unilog-stub \{([^}]*)\} unilog\(([\s\S]*)\);\s*$/;

export function parseStub(line) {
  const m = STUB_RE.exec(line);
  if (!m) return null;
  const indent = m[1];
  const meta = {};
  for (const part of m[2].split(",")) {
    const [k, v] = part.split("=");
    if (k) meta[k.trim()] = (v || "").trim();
  }
  return {
    indent,
    level: meta.level || "info",
    tag: meta.tag || null,
    argExpr: m[3].trim(),
  };
}

// ---- the auto-upgrade transform ------------------------------------------

// Convert one old-style line into a unilog stub line.
// Returns { upgradeable, line, level, tag, argExpr, reason }.
export function upgradeLine(line) {
  if (/\/\/\s*no-unilog\s*$/.test(line))
    return { upgradeable: false, reason: "blocked by // no-unilog" };
  if (parseStub(line)) return { upgradeable: false, reason: "already a stub" };
  if (/\/\/ log-id:\s*\d+/.test(line))
    return { upgradeable: false, reason: "already an active unilog call" };

  const m = matchOldStyle(line);
  if (!m)
    return { upgradeable: false, reason: "not a single-literal log call" };

  const level = levelForCall(m.callee, m.method);
  const { tag, content } = extractLeadingTag(m.content);
  const argExpr = `${m.quote}${content}${m.quote}`;
  const stub = buildStub({ indent: m.indent, level, tag, argExpr });
  return { upgradeable: true, line: stub, level, tag, argExpr };
}

// ---- stub activation (reconciler) ----------------------------------------

// Turn a stub line into an active call line with the allocated id.
// No trailing comment: the id is the first arg, read back via the AST.
export function activateStub(line, logId) {
  const s = parseStub(line);
  if (!s) return null;
  return {
    line: `${s.indent}unilog(${logId}, ${s.argExpr});`,
    level: s.level,
    tag: s.tag,
    argExpr: s.argExpr,
  };
}

export const LOG_ID_RE = /\/\/ log-id:\s*(\d+)\s*$/;

export function parseLogId(line) {
  const m = LOG_ID_RE.exec(line);
  return m ? Number(m[1]) : null;
}

// ---- description sanity check --------------------------------------------

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "are",
  "log",
  "logs",
  "logging",
  "when",
  "add",
  "added",
  "message",
  "msg",
  "this",
  "that",
  "it",
  "with",
  "from",
  "into",
  "at",
  "be",
  "as",
  "by",
  "we",
]);

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// Build a short fallback description from code context (message + identifiers).
export function generateDescription(context = {}) {
  const fromMsg = String(context.argExpr || context.message || "")
    .replace(/[`'"]/g, "")
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (fromMsg) return fromMsg.slice(0, 80);
  const id = (context.identifiers || []).filter(Boolean).slice(0, 4).join(" ");
  if (id) return `log near ${id}`.slice(0, 80);
  if (context.tag) return `${context.tag} log`;
  return "log site";
}

// Decide whether the creating PROMPT is a good description, else fall back.
// Heuristic: prompt must be a non-empty, not-absurdly-long string that shares
// at least one meaningful token with the surrounding code context.
export function sanityCheckDescription(prompt, context = {}) {
  const p = String(prompt || "").trim();
  if (!p)
    return {
      ok: false,
      reason: "empty prompt",
      description: generateDescription(context),
    };
  if (p.length > 200)
    return {
      ok: false,
      reason: "prompt too long",
      description: generateDescription(context),
    };

  const ctxText = [
    context.argExpr,
    context.message,
    context.tag,
    ...(context.identifiers || []),
  ]
    .filter(Boolean)
    .join(" ");
  const ctxTokens = new Set(tokens(ctxText));
  if (ctxTokens.size === 0) return { ok: true, description: p }; // no context to contradict

  const pTokens = tokens(p);
  const overlap = pTokens.some((t) => ctxTokens.has(t));
  if (!overlap)
    return {
      ok: false,
      reason: "prompt shares no token with code context",
      description: generateDescription(context),
    };
  return { ok: true, description: p };
}
