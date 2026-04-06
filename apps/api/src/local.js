import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const TV_ROOT = "/mnt/media/tv";
const TV_ERRORS_ROOT = "/mnt/media/tv-errors";

/**
 * Returns a file tree of /mnt/media/tv from the local file system.
 */
export async function getLocalFiles(root = TV_ROOT) {
  // using find with -printf to get type, path, size, and date
  // %y: type (f=file, d=directory)
  // %P: file's name relative to start point
  // %s: size in bytes
  // %CY-%Cm-%Cd: date (YYYY-MM-DD)
  const cmd = `find ${root} -maxdepth 5 -not -path '*/.*' -printf "%y|%P|%s|%CY-%Cm-%Cd\\n" | sort`;

  try {
    const { stdout } = await execFileAsync("bash", ["-c", cmd], {
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const lines = (stdout || "").split("\n").filter(Boolean);
    const tree = [];

    // Helper to find or create child node in list
    const findOrCreate = (list, name, type, size, date) => {
      let node = list.find((n) => n.name === name);
      if (!node) {
        node = { name, type, children: [] };
        if (type === "file") {
          node.size = size;
          node.date = date;
        }
        list.push(node);
      }
      return node;
    };

    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length < 4) continue;
      const type = parts[0]; // f or d
      const relPath = parts[1];
      const size = parseInt(parts[2], 10) || 0;
      const date = parts[3];

      if (!relPath) continue;

      const segments = relPath.split("/");
      let currentLevel = tree;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;
        const segType = isLast ? (type === "d" ? "folder" : "file") : "folder";

        const node = findOrCreate(currentLevel, seg, segType, size, date);
        if (segType === "folder") {
          if (!node.children) node.children = [];
          currentLevel = node.children;
        }
      }
    }

    // Sort tree? linux sort on paths helps, but maybe we want folders first?
    const sortNodes = (nodes) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        const nameA = a.name.toLowerCase().replace(/^the\s+/, "");
        const nameB = b.name.toLowerCase().replace(/^the\s+/, "");

        // Only use strict sorting (Season 9 before Season 10) for folders
        if (a.type === "folder" && b.type === "folder") {
          return nameA.localeCompare(nameB, undefined, { numeric: true });
        }
        return nameA.localeCompare(nameB);
      });
      nodes.forEach((n) => {
        if (n.children) sortNodes(n.children);
      });
    };
    sortNodes(tree);

    return tree;
  } catch (e) {
    console.error("getLocalFiles failed", e);
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
