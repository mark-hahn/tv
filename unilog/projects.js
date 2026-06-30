// unilog/projects.js — shared source-discovery config used by the reconciler
// (run-reconcile.js) and the offline checker (check.js). Keeping this in ONE
// place stops the two tools from drifting on which files each project owns.
// (unilog plumbing — no instrumentation here.)

import fs from "node:fs";
import path from "node:path";

// Per-project source roots. Each entry lists directories to walk recursively
// plus any individual files that live outside the src/ tree. New source files
// are picked up automatically without touching this config.
export const PROJECT_DIRS = {
  srvr: { roots: ["apps/srvr/src"], extras: ["apps/srvr/index.js"] },
  api: { roots: ["apps/api/src"] },
  down: { roots: ["apps/down/src"] },
  asr: { roots: ["apps/asr"] },
  tv: { roots: ["apps/tv"] },
  client: { roots: ["apps/client/src"] },
};

// Basenames that are unilog plumbing or path constants — never instrument.
export const EXCLUDE_BASENAMES = new Set([
  "unilogDb.js",
  "srvrPaths.js",
  "tvPaths.js",
  "urls.js",
  "config.js",
  "evtBus.js",
  "log.js",
]);

// Directory names to skip when walking source roots.
export const SKIP_DIRS = new Set([
  "node_modules",
  "data",
  "tmp",
  "test",
  "scripts",
]);

// Resolve the instrumented source files for a project. Paths are resolved
// against `repoRoot` (defaults to cwd) so callers get stable absolute paths.
export function findProjectFiles(proj, repoRoot = process.cwd()) {
  const { roots = [], extras = [] } = PROJECT_DIRS[proj] || {};
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const name = entry.name;
        if (!name.endsWith(".js") && !name.endsWith(".vue")) continue;
        if (name.endsWith(".user.js")) continue;
        if (EXCLUDE_BASENAMES.has(name)) continue;
        found.push(path.resolve(dir, name));
      }
    }
  }
  for (const root of roots) {
    const abs = path.resolve(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const extra of extras) {
    const abs = path.resolve(repoRoot, extra);
    if (fs.existsSync(abs)) found.push(abs);
  }
  return found;
}
