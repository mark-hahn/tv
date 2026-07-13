// Reddit loid cookie management. Reddit's public JSON api 403s every request
// that lacks a browser-issued anonymous "loid" cookie. The cookie is stored in
// data/loid-cookie.txt; when reddit rejects it, clients are notified to show an
// input box so a fresh loid (pasted from a browser) can be saved and verified.
import fs from "fs";
import * as path from "node:path";
import fetch from "node-fetch";
import { logHere, unilog } from "@tv/share";
import { SRVR_DATA_DIR } from "./srvrPaths.js";

const LOID_COOKIE_PATH = path.join(SRVR_DATA_DIR, "loid-cookie.txt");
const VERIFY_URL =
  "https://www.reddit.com/subreddits/search.json?q=ted%20lasso&limit=1";
const USER_AGENT = "tv-app/1.0";

let loidNeeded = false;
let notifyCallback = null; // called with true (loid needed) / false (verified)

export function setLoidNotifyCallback(cb) {
  notifyCallback = cb;
}

export function isLoidNeeded() {
  return loidNeeded;
}

export async function getLoid() {
  return (await fs.promises.readFile(LOID_COOKIE_PATH, "utf8")).trim();
}

// Called when a reddit request 403s: flag the loid as bad and tell clients.
// Only fires the notification once until a new cookie is verified.
export function loidFailed() {
  if (loidNeeded) return;
  loidNeeded = true;
  unilog(1290, "reddit loid cookie rejected, asking clients");
  if (notifyCallback) notifyCallback(true);
}

// Save a pasted cookie to loid-cookie.txt, then verify it against reddit.
// The loidNeeded flag stays set (and the client box stays up) until a cookie
// verifies. Accepts "loid=..." or bare values, with or without attributes.
export async function saveAndVerifyLoid(cookie) {
  const value = String(cookie ?? "")
    .trim()
    .replace(/^loid=/, "")
    .replace(/;.*$/, "")
    .trim();
  if (!value) return { error: "empty cookie" };

  let resp;
  try {
    await fs.promises.writeFile(LOID_COOKIE_PATH, value + "\n");
    resp = await fetch(VERIFY_URL, {
      headers: { "User-Agent": USER_AGENT, Cookie: `loid=${value}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    unilog(1438, `loid cookie save or verify failed: ${e.message}`);
    return { error: e?.message || String(e) };
  }
  if (!resp.ok) {
    unilog(1291, `loid cookie verify failed: reddit returned ${resp.status}`);
    return { error: `reddit returned ${resp.status}` };
  }

  loidNeeded = false;
  unilog(1292, "new loid cookie verified and saved");
  if (notifyCallback) notifyCallback(false);
  return { ok: true };
}
