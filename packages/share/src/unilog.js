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

// Author placeholder. Code authors write
//   logHere({ lvl, tag, grp, typ }, ...msgArgs)
// at the spot a log belongs (it uses `e`, so it satisfies no-empty / no-unused
// in an otherwise-empty catch). It is a runtime NO-OP; the deploy reconciler
// rewrites it into a real `unilog(<id>, ...)`. The first arg is a param object:
//   lvl: "info" | "warn" | "error" | "debug"  (default "info")
//   tag: category string                        (default none)
//   grp: group name or array of names           (default none)
//   typ: group_type applied only to new groups  (default none)
// All param values must be static string literals. The remaining args are the
// message (joined like console.log); with no message args the site logs
// "<missing>". Minimal call: logHere({}, "message"). Never write `unilog(...)`
// by hand — use this.
export function logHere() {}
