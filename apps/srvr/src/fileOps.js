// Filesystem operation handlers (apiWrapper-style): list a directory (getFile),
// recursively delete a path / batch of paths, delete a season's files, and
// create a show folder with season subdirs + tvshow.nfo. Self-contained: only
// filesystem access plus the show-folder/NFO helpers from disk.js.

import fs from "fs";
import * as path from "node:path";
import { rimraf } from "rimraf";
import { unilog } from "@tv/share";
import {
  safeShowFolderName,
  seasonFolderName,
  buildTvShowNfo,
} from "./disk.js";

const tvDir = "/mnt/media/tv";

export const getFile = async (params) => {
  // Param is usually an object { path: "..." }
  let requestedPath = params?.path;
  if (requestedPath === undefined || requestedPath === null) requestedPath = "";

  if (typeof requestedPath !== "string") {
    throw new Error("getFile: path must be string");
  }

  const rawPath = requestedPath.trim();
  const basePath = tvDir;
  const targetPath = rawPath ? path.resolve(rawPath) : path.resolve(basePath);

  // Safety: only allow listings within tvDir.
  const allowedRoot = path.resolve(basePath) + path.sep;
  if (
    !(targetPath + path.sep).startsWith(allowedRoot) &&
    targetPath !== path.resolve(basePath)
  ) {
    throw new Error(`getFile: path not allowed: ${rawPath}`);
  }

  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (e) {
    throw new Error(`getFile: stat failed: ${e.message}`);
  }

  if (!stat.isDirectory()) {
    throw new Error("getFile: path is not a directory");
  }

  let dirents;
  try {
    dirents = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch (e) {
    throw new Error(`getFile: readdir failed: ${e.message}`);
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  dirents.sort((a, b) => collator.compare(a.name, b.name));

  const out = [];
  for (const d of dirents) {
    const name = d.name;
    if (!name) continue;

    if (d.isDirectory()) {
      const childPath = path.join(targetPath, name);
      try {
        const childDirents = fs.readdirSync(childPath, { withFileTypes: true });
        const childNames = childDirents
          .map((cd) => cd.name)
          .filter(Boolean)
          .sort((a, b) => collator.compare(a, b));
        out.push({ [name]: childNames });
      } catch {
        // If we can't read the directory, still return it with empty children.
        out.push({ [name]: [] });
      }
    } else {
      out.push(name);
    }
  }

  return out;
};

const deleteOnePath = async (pathParam) => {
  // If it's just a folder name (no slashes), construct the full path in tvDir
  // Otherwise use the path as-is (for episode file deletions)
  let fullPath =
    pathParam.includes("/") || pathParam.includes("\\")
      ? pathParam
      : path.join(tvDir, pathParam);

  try {
    // Check if path exists
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;

      // Season folder names may differ by zero-padding (e.g., Season 05 vs Season 5).
      // If the requested path is missing, try to resolve a same-season sibling dir.
      const baseName = path.basename(fullPath);
      const seasonMatch = /^Season\s+(\d+)$/i.exec(baseName);
      if (seasonMatch) {
        const parentDir = path.dirname(fullPath);
        const seasonNum = Number.parseInt(seasonMatch[1], 10);
        if (!Number.isNaN(seasonNum)) {
          let parentEntries = [];
          try {
            parentEntries = fs.readdirSync(parentDir, { withFileTypes: true });
          } catch (readErr) {
            if (readErr?.code !== "ENOENT") throw readErr;
          }

          const alt = parentEntries
            .filter((entry) => entry.isDirectory())
            .find((entry) => {
              const m = /^Season\s+(\d+)$/i.exec(entry.name);
              if (!m) return false;
              return Number.parseInt(m[1], 10) === seasonNum;
            });

          if (alt) {
            fullPath = path.join(parentDir, alt.name);
            stats = fs.statSync(fullPath);
            unilog(
              564,
              "deletePath: resolved missing season path",
              pathParam,
              "->",
              fullPath,
            );
          }
        }
      }

      if (!stats) {
        unilog(35, "deletePath: path doesn't exist");
        return "ok";
      }
    }

    fs.rmSync(fullPath, { recursive: true, force: true });

    // Wait for filesystem to sync
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify deletion
    try {
      fs.statSync(fullPath);
      unilog(565, "deletePath: path still exists after deletion:", fullPath);
      throw new Error(`Path still exists after deletion: ${fullPath}`);
    } catch (e) {
      if (e.code !== "ENOENT") {
        throw e;
      }
    }
  } catch (e) {
    unilog(566, "error removing path:", fullPath, e.message);
    throw new Error(`Failed to delete path: ${e.message}`);
  }
  return "ok";
};

export const deletePath = async (params) => {
  const pathParam = params?.path;
  if (!pathParam) {
    throw new Error("deletePath: missing path parameter");
  }
  return deleteOnePath(pathParam);
};

export const deletePaths = async (params) => {
  const paths = params?.paths;
  if (!Array.isArray(paths)) {
    throw new Error("deletePaths: missing paths array");
  }
  const results = [];
  for (const pathParam of paths) {
    try {
      await deleteOnePath(pathParam);
      results.push({ path: pathParam, ok: true });
    } catch (e) {
      results.push({ path: pathParam, ok: false, error: e.message });
    }
  }
  return results;
};

export const delSeasonFiles = async (params) => {
  const showName = params?.showName;
  const showPathParam = params?.showPath;
  const season = params?.season;

  if (!showName || !showPathParam || season === undefined || season === null) {
    throw new Error("delSeasonFiles: requires showName, showPath, season");
  }

  const showPath =
    showPathParam.includes("/") || showPathParam.includes("\\")
      ? showPathParam
      : path.join(tvDir, showPathParam);

  const seasonStr = String(season).trim();
  const parsedSeason = Number.parseInt(seasonStr, 10);
  const normalizedSeason = Number.isNaN(parsedSeason)
    ? null
    : String(parsedSeason);
  const wantedNames = new Set([`Season ${seasonStr}`]);
  if (normalizedSeason !== null) wantedNames.add(`Season ${normalizedSeason}`);

  const directMatches = [];
  for (const seasonName of wantedNames) {
    const dir = path.join(showPath, seasonName);
    try {
      const st = await fs.promises.stat(dir);
      if (st.isDirectory()) directMatches.push(dir);
    } catch (e) {
      if (e?.code !== "ENOENT") {
        throw new Error(`delSeasonFiles: stat failed for ${dir}: ${e.message}`);
      }
    }
  }

  let seasonDirs = directMatches;
  if (!seasonDirs.length && normalizedSeason !== null) {
    let showDirEntries = [];
    try {
      showDirEntries = await fs.promises.readdir(showPath, {
        withFileTypes: true,
      });
    } catch (e) {
      throw new Error(`delSeasonFiles: readdir showPath failed: ${e.message}`);
    }

    seasonDirs = showDirEntries
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const m = /^Season\s+(\d+)$/i.exec(entry.name);
        if (!m) return false;
        return String(Number.parseInt(m[1], 10)) === normalizedSeason;
      })
      .map((entry) => path.join(showPath, entry.name));
  }

  if (!seasonDirs.length) {
    throw new Error(
      `delSeasonFiles: no season folder found for season ${season} under ${showPath}`,
    );
  }

  for (const seasonDir of seasonDirs) {
    unilog(33, `${showName}: ${seasonDir}`);

    let entries = [];
    try {
      entries = await fs.promises.readdir(seasonDir);
    } catch (e) {
      throw new Error(`delSeasonFiles: readdir failed: ${e.message}`);
    }

    for (const entry of entries) {
      const entryPath = path.join(seasonDir, entry);
      unilog(34, `deleting: ${entryPath}`);
      try {
        await rimraf(entryPath);
      } catch (e) {
        throw new Error(`delSeasonFiles: delete failed: ${e.message}`);
      }
    }
  }

  return { status: "ok" };
};

export const createShowFolder = async (params) => {
  const showNameRaw = params?.showName;
  const tvdbId = params?.tvdbId;
  const seriesMapSeasons = params?.seriesMapSeasons;

  unilog(558, "request", {
    showName: showNameRaw,
    tvdbId: params?.tvdbId,
    seriesMapSeasons,
  });

  const showName = safeShowFolderName(showNameRaw);
  if (!showName) {
    unilog(559, "invalid showName", { showNameRaw });
    throw new Error("createShowFolder: invalid showName");
  }

  const showPath = path.join(tvDir, showName);
  const existed = fs.existsSync(showPath);

  try {
    fs.mkdirSync(showPath, { recursive: true });
    unilog(560, "show dir", { showPath, existed });
  } catch (e) {
    throw new Error(`createShowFolder: mkdir failed: ${e.message}`);
  }

  if (Array.isArray(seriesMapSeasons)) {
    for (const season of seriesMapSeasons) {
      const seasonDirName = seasonFolderName(season);
      if (!seasonDirName) continue;
      const seasonPath = path.join(showPath, seasonDirName);
      try {
        fs.mkdirSync(seasonPath, { recursive: true });
        unilog(561, "season dir", { season, seasonPath });
      } catch (e) {
        throw new Error(`createShowFolder: mkdir season failed: ${e.message}`);
      }
    }
  } else if (seriesMapSeasons !== undefined) {
    unilog(562, "seriesMapSeasons not an array; skipping season dirs", {
      seriesMapSeasonsType: typeof seriesMapSeasons,
    });
  }

  const nfo = buildTvShowNfo(showName, tvdbId);
  if (nfo) {
    const nfoPath = path.join(showPath, "tvshow.nfo");
    try {
      fs.writeFileSync(nfoPath, nfo, "utf8");
      unilog(563, "wrote tvshow.nfo", { nfoPath, tvdbId });
    } catch (e) {
      throw new Error(`createShowFolder: write nfo failed: ${e.message}`);
    }
  }

  try {
    unilog(469, "history", "addEmby", showName, `Created folder: ${showPath}`);
  } catch {}

  return { ok: true, created: !existed, path: showPath };
};
