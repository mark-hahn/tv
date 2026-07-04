// unilog tooling library — pure, deterministic helpers shared by the reconciler.
// No DB, no fs, no network here.
//
// Covers:
//   - tag extraction, level derivation
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
