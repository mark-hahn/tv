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

// The single call every active log site invokes at runtime.
// `level` is intentionally NOT looked up here: it lives on log_sites and is
// resolved later (read/display time) by the log viewer, so the hot write path
// only carries { logId, message }.
export function unilog(logId, message) {
  if (!_sink) return;
  try {
    _sink({ logId, message });
  } catch {
    // best-effort: never break the app because logging failed
  }
}
