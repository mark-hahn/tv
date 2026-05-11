import fs from "fs";
import * as fsp from "fs/promises";
import * as path from "node:path";
import { jParse } from "./util.js";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const GROUP_COUNTS_PATH = path.join(SRVR_DATA_DIR, "groupCounts.json");

let groupCounts = {};
try {
  if (fs.existsSync(GROUP_COUNTS_PATH)) {
    const raw = fs.readFileSync(GROUP_COUNTS_PATH, "utf8");
    groupCounts = jParse(raw, "groupCounts") || {};
  }
} catch {
  groupCounts = {};
}

export const getGroupCounts = async () => {
  return groupCounts;
};

export const incrementGroupCount = async (params) => {
  const group = String(params?.group || "")
    .trim()
    .toLowerCase();
  if (!group) return { ok: false, error: "Missing group" };
  groupCounts[group] = (groupCounts[group] || 0) + 1;
  await fsp.mkdir(path.dirname(GROUP_COUNTS_PATH), { recursive: true });
  await fsp.writeFile(GROUP_COUNTS_PATH, JSON.stringify(groupCounts));
  return { ok: true, count: groupCounts[group] };
};
