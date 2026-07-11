import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, readdir } from "node:fs/promises";
import parseTorrentTitleLib from "parse-torrent-title";
import { buildFileTree } from "./fileTree.js";
import { unilog } from "@tv/share";

const execFileAsync = promisify(execFile);

const TV_ROOT = "/mnt/media/tv";
const TV_ERRORS_ROOT = "/mnt/media/tv-errors";

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

export async function renameLocalFile(oldPath, newName, isErrs = false) {
  const root = isErrs ? TV_ERRORS_ROOT : TV_ROOT;

  if (
    oldPath.includes("..") ||
    newName.includes("..") ||
    newName.includes("/")
  ) {
    throw new Error("Invalid path or name");
  }

  const parts = oldPath.split("/");
  const fileName = parts.pop();
  const dirPath = parts.join("/");

  const fullOldPath = dirPath
    ? `${root}/${dirPath}/${fileName}`
    : `${root}/${fileName}`;
  const fullNewPath = dirPath
    ? `${root}/${dirPath}/${newName}`
    : `${root}/${newName}`;

  await rename(fullOldPath, fullNewPath);
  return { success: true };
}

const TRIAL_ERROR_DIR = "/mnt/media/tv/Trial & Error/Season 1";

export async function moveToTrial(relPath) {
  if (!relPath || relPath.includes("..")) {
    throw new Error("Invalid path");
  }

  const srcPath = `${TV_ERRORS_ROOT}/${relPath}`;

  // Extract filename and extension
  const fileName = relPath.split("/").pop();
  const dotIdx = fileName.lastIndexOf(".");
  const ext = dotIdx !== -1 ? fileName.slice(dotIdx + 1) : "";
  const nameNoExt = dotIdx !== -1 ? fileName.slice(0, dotIdx) : fileName;

  // Derive show title
  let title = "";
  try {
    const parsed = parseTorrentTitleLib.parse(nameNoExt);
    title = parsed.title || "";
  } catch (_) {}

  if (!title) {
    // Fake title: periods to spaces, keep only all-alpha segments, rejoin with periods
    const segments = nameNoExt
      .replace(/\./g, " ")
      .split(" ")
      .filter((s) => /^[a-zA-Z]+$/.test(s));
    title = segments.length > 0 ? segments.join(".") : "error.file";
  } else {
    title = title.replace(/ /g, ".");
  }

  // Scan destination for highest episode number
  let highestEpi = 0;
  try {
    const entries = await readdir(TRIAL_ERROR_DIR);
    for (const entry of entries) {
      const m = entry.match(/S01E(\d+)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > highestEpi) highestEpi = n;
      }
    }
  } catch (_) {}

  const epiNum = String(highestEpi + 1).padStart(2, "0");
  const newName = ext
    ? `${title}.S01E${epiNum}.${ext}`
    : `${title}.S01E${epiNum}`;
  const destPath = `${TRIAL_ERROR_DIR}/${newName}`;

  await rename(srcPath, destPath);
  return { success: true, newName };
}
