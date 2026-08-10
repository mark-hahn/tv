import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildFileTree } from "./fileTree.js";
import { unilog } from "@tv/share";

const execFileAsync = promisify(execFile);

const TV_ROOT = "/mnt/media/tv";
const MOVIE_ROOT = "/mnt/media/movies";

// trailing chain of `.old` / `.alt` markers, e.g. ".old", ".old.old", ".alt"
const OLD_SUFFIX_RE = /^(.+?)((?:\.(?:old|alt))+)$/i;

function resolveUnderRoot(root, relPath) {
  const rel = String(relPath || "").trim();
  if (
    !rel ||
    path.isAbsolute(rel) ||
    rel.includes("\0") ||
    rel.split(/[\\/]+/).includes("..")
  ) {
    throw new Error("Invalid path");
  }
  const rootPath = path.resolve(root);
  const fullPath = path.resolve(rootPath, rel);
  if (!(fullPath === rootPath || fullPath.startsWith(rootPath + path.sep))) {
    throw new Error("Invalid path");
  }
  return fullPath;
}

/**
 * Returns a file tree of /mnt/media/tv from the local file system.
 */
export async function getLocalFiles(root = TV_ROOT) {
  // using find with -printf to get type, path, size, and date+time
  // %y: type (f=file, d=directory)
  // %P: file's name relative to start point
  // %s: size in bytes
  // %CY-%Cm-%Cd %CH:%CM:%CS: datetime (YYYY-MM-DD HH:MM:SS)
  // No shell and no `| sort` — sortNodes below fully sorts the tree.
  try {
    const { stdout } = await execFileAsync(
      "find",
      [
        root,
        "-maxdepth",
        "5",
        "-not",
        "-path",
        "*/.*",
        "-printf",
        "%y|%P|%s|%CY-%Cm-%Cd %CH:%CM:%CS\\n",
      ],
      {
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
    );

    return buildFileTree(stdout);
  } catch (e) {
    unilog(167, "getLocalFiles failed", e);
    throw new Error(`Failed to list local files: ${e.message}`);
  }
}

export async function renameLocalFile(oldPath, newName) {
  const root = TV_ROOT;

  if (
    !newName ||
    path.isAbsolute(newName) ||
    /[\\/]/.test(newName) ||
    newName.includes("\0")
  ) {
    throw new Error("Invalid path or name");
  }

  const fullOldPath = resolveUnderRoot(root, oldPath);
  const fullNewPath = path.resolve(
    path.dirname(fullOldPath),
    String(newName).trim(),
  );
  const rootPath = path.resolve(root);
  if (
    !(fullNewPath === rootPath || fullNewPath.startsWith(rootPath + path.sep))
  ) {
    throw new Error("Invalid path or name");
  }

  await rename(fullOldPath, fullNewPath);
  return { success: true };
}

/**
 * Make the `.old`/`.alt` sidecar at relPath the active file: the sidecar takes
 * the base name and the file that held it is demoted with a `.old` suffix
 * (`.old.old`, ... if that name is taken).
 */
export async function swapLocalOld(relPath, movieMode) {
  const root = movieMode ? MOVIE_ROOT : TV_ROOT;
  const fullSidecar = resolveUnderRoot(root, relPath);
  const dir = path.dirname(fullSidecar);
  const sidecarName = path.basename(fullSidecar);

  const m = OLD_SUFFIX_RE.exec(sidecarName);
  if (!m) throw new Error(`${sidecarName} has no .old/.alt suffix`);
  const baseName = m[1];
  const fullBase = path.join(dir, baseName);

  if (!existsSync(fullSidecar)) throw new Error(`${sidecarName} is missing`);
  if (!existsSync(fullBase)) throw new Error(`${baseName} is missing`);

  const tmpPath = path.join(dir, `${baseName}.swaptmp-${Date.now()}`);
  await rename(fullBase, tmpPath);
  await rename(fullSidecar, fullBase);

  let demoted = `${fullBase}.old`;
  while (existsSync(demoted)) demoted += ".old";
  await rename(tmpPath, demoted);

  return {
    success: true,
    activeName: baseName,
    oldName: path.basename(demoted),
  };
}
