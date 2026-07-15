import fs from "node:fs";

// ext4 (Linux) is case-sensitive, so "Based on a True Story" and
// "Based On A True Story" are two distinct directories. TVDB is the
// authoritative source for a show's name/casing, but a raw release folder
// can land on disk with different casing and, once it exists, files keep
// piling into it as a second folder for the same show.
//
// This guard prevents our code from ever creating a case-variant duplicate:
// given the TVDB-canonical folder name we want, if a directory already exists
// under `parentDir` that matches case-insensitively, reuse that existing
// directory's actual on-disk name instead of creating a new one. An exact
// match (or no match at all) returns the name unchanged.
export function resolveShowFolderName(parentDir, name) {
  if (!parentDir || !name) return name;

  let entries;
  try {
    entries = fs.readdirSync(parentDir, { withFileTypes: true });
  } catch {
    // parentDir unreadable — nothing to reconcile against.
    return name;
  }

  // Exact match wins — nothing to reconcile.
  for (const e of entries) {
    if (e.isDirectory() && e.name === name) return name;
  }

  const lower = name.toLowerCase();
  for (const e of entries) {
    if (e.isDirectory() && e.name.toLowerCase() === lower) {
      return e.name; // reuse existing case-variant folder
    }
  }

  return name;
}
