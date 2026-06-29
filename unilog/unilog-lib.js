// unilog tooling library — pure, deterministic helpers shared by the CLI,
// the reconciler, and the test scripts. No DB, no fs, no network here.
//
// Covers:
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
