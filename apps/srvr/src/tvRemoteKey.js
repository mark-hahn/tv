import fetch from "node-fetch";
import { logHere, unilog} from "@tv/share"
import { notifyClients } from "./messaging.js";

// tv-tv runs on the same box as tv-srvr, so "tv" is a loopback call to the
// tv-tv process, not the public hahnca.com/tv-tv nginx path the clients use.
// "srvr" loops back to tv-srvr's own http server (for skip-intro, which is a
// tv-srvr feature, not a tv/ha command).
const TV_TV_INTERNAL_URL = "http://127.0.0.1:3004";
const SRVR_INTERNAL_URL = "http://127.0.0.1:8739";
const BASE_URLS = { tv: TV_TV_INTERNAL_URL, srvr: SRVR_INTERNAL_URL };

const COLLISION_WINDOW_MS = 1500;
const COLLISION_WINDOW_MS_SUBCTRL = 5000;

// Last press seen from any remote. A repeating/held key keeps re-recording this
// (same senderId falls straight through), so while one remote holds a key it
// owns the floor and any different key from another remote loses.
let lastPress = null; // { key, senderId, at, fromSubCtrl, repeating }
let locked = false;

export function tvRemoteUnlock() {
  locked = false;
}

async function forward(base, method, path, body) {
  const baseUrl = BASE_URLS[base] ?? TV_TV_INTERNAL_URL;
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  try {
    const r = await fetch(`${baseUrl}${path}`, opts);
    return await r.json();
  } catch (e) {
    unilog(1600, `forward ${path} failed: ${e.message}`);
    return null;
  }
}

// Single choke point for every remote (web + android) key/command send. Checks
// the press against the other remote's last press before forwarding to the tv
// (or skip-intro to srvr). path=null just arms the collision window without
// sending anything (the left/right button-down, whose real send happens later
// once we know it's a tap vs a scrub).
export async function keySendWithChk({
  key,
  senderId,
  fromSubCtrl = false,
  repeating = false,
  base = "tv",
  method = "GET",
  path,
  body,
}) {
  if (locked) return { blocked: true };

  const now = Date.now();
  const prev = lastPress;
  const windowMs = prev?.fromSubCtrl
    ? COLLISION_WINDOW_MS_SUBCTRL
    : COLLISION_WINDOW_MS;
  const crossRemote =
    prev &&
    prev.senderId !== senderId &&
    now - prev.at < windowMs &&
    prev.key !== key;

  if (crossRemote) {
    if (prev.repeating) {
      // A held/repeating key owns the floor: it keeps winning and the
      // intruding key is dropped, with no lockout (locking would freeze the
      // winner too). Keep the incumbent — do not record the intruder.
      return { blocked: true, repeatWin: true };
    }
    if (repeating) {
      // Incoming is a repeat beating a stale discrete press — the repeat takes
      // the floor. Falls through to record + forward below.
    } else {
      // Two discrete presses of different keys within the window — a real
      // collision. First key already went out; lock every remote.
      locked = true;
      unilog(1601, `collision: sent=${prev.key} blocked=${key}`);
      notifyClients("tvRemoteLock", { sentKey: prev.key, blockedKey: key });
      return { blocked: true, sentKey: prev.key, blockedKey: key };
    }
  }

  lastPress = { key, senderId, at: now, fromSubCtrl, repeating };

  if (!path) return { blocked: false };
  const result = await forward(base, method, path, body);
  return { blocked: false, result };
}
