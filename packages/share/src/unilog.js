// unilog runtime facade — environment-agnostic (safe to bundle in the client).
// It holds NO sqlite/fs imports. A "sink" is registered by the host:
//   - tv-srvr registers a direct DB-writer sink (apps/srvr/src/unilogDb.js)
//   - every other process / the client registers a POST /api/log sink
// Logging must never throw into business logic, so the sink call is guarded.
// (unilog plumbing itself uses plain console with `// no-unilog`.)

let _sink = null;

export function setUnilogSink(fn) {
  _sink = typeof fn === "function" ? fn : null;
}

// Join multiple args the way console.* does: strings as-is, objects as JSON,
// separated by spaces. So `unilog(5, "a", obj, n)` -> one message string.
export function unilogJoin(parts) {
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      try {
        return typeof p === "object" ? JSON.stringify(p) : String(p);
      } catch {
        return String(p);
      }
    })
    .join(" ");
}

// The single call every active log site invokes at runtime. Variadic so
// multi-arg legacy calls copy through unchanged: unilog(id, a, b, c).
// `level` is NOT looked up here: it lives on log_sites and is resolved later
// (read/display time) by the log viewer, so the hot write path is minimal.
export function unilog(logId, ...parts) {
  if (!_sink) return;
  try {
    _sink({ logId, message: unilogJoin(parts) });
  } catch {
    // best-effort: never break the app because logging failed
  }
}
