import fetch from "node-fetch";
import { logHere, unilog } from "@tv/share";
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

// Stands in for a key in the lockout message when the losing side is a remote
// sitting in the tvapprc filter text screen. keyLabels.js gives it its wording.
const FILTER_KEY = "filter";

// Last press seen from any remote. A repeating/held key keeps re-recording this
// (same senderId falls straight through), so while one remote holds a key it
// owns the floor and any different key from another remote loses.
let lastPress = null; // { key, senderId, who, at, fromSubCtrl, repeating }
let locked = false;
// What the lock in force is about, so a remote that connects while it stands
// (a reopened phone app, a fresh browser tab) can be shown the same overlay
// the others got instead of silently having every key dropped.
let lockInfo = null; // { sentKey, blockedKey }

export function tvRemoteLockInfo() {
  return locked ? lockInfo : null;
}

// Remotes that currently have the tvapprc filter text screen open. That screen
// stays up for as long as someone is typing, so it holds the floor by identity
// rather than through the timed press window above: any *other* remote's key
// while it is up is a collision, however long ago it was opened. Reported by
// the remote on every open and close (and on startup, which clears a stale
// entry left by an app that died with the screen up).
const filterOpen = new Set(); // senderIds

export function tvRemoteFilterOpen({ senderId, open }) {
  if (open) filterOpen.add(senderId);
  else filterOpen.delete(senderId);
  return { ok: true };
}

export function tvRemoteUnlock() {
  locked = false;
  lockInfo = null;
}

// Locks every remote and tells them why. The remotes close their filter screen
// on this too, so the set is dropped here to match.
function lock(sentKey, blockedKey) {
  locked = true;
  lockInfo = { sentKey, blockedKey };
  filterOpen.clear();
  notifyClients("tvRemoteLock", lockInfo);
  return { blocked: true, sentKey, blockedKey };
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

// Bare GET at tv-tv for callers that aren't remote key presses and so skip the
// collision check (the skip-key show-select trigger). Never rejects.
export function tvTvGet(path) {
  return forward("tv", "GET", path);
}

// Single choke point for every remote (web + android) key/command send. Checks
// the press against the other remote's last press before forwarding to the tv
// (or skip-intro to srvr). path=null just arms the collision window without
// sending anything (the left/right button-down, whose real send happens later
// once we know it's a tap vs a scrub).
export async function keySendWithChk({
  key,
  senderId,
  from = "unknown",
  fromSubCtrl = false,
  repeating = false,
  base = "tv",
  method = "GET",
  path,
  body,
}) {
  if (locked) return { blocked: true };

  const who = `${senderId}@${from}`;

  // Another remote is sitting in the filter text screen — it owns the floor
  // until it closes, so this key loses no matter how the press window stands.
  const filterOwner = [...filterOpen].find((id) => id !== senderId);
  if (filterOwner) {
    unilog(2336, `collision: filter screen open on ${filterOwner}, blocked=${key} from ${who}`);
    return lock(FILTER_KEY, key);
  }

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
      unilog(2337, `collision: sent=${prev.key} from ${prev.who} ${now - prev.at}ms ago, blocked=${key} from ${who}`);
      return lock(prev.key, key);
    }
  }

  lastPress = { key, senderId, who, at: now, fromSubCtrl, repeating };

  if (!path) return { blocked: false };
  const result = await forward(base, method, path, body);
  return { blocked: false, result };
}
