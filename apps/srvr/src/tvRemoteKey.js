import fetch from "node-fetch";
import { logHere, unilog} from "@tv/share"
import { notifyClients } from "./messaging.js";

// tv-tv runs on the same box as tv-srvr, so this is a loopback call, not the
// public hahnca.com/tv-tv nginx path the clients use.
const TV_TV_INTERNAL_URL = "http://127.0.0.1:3004";
const COLLISION_WINDOW_MS = 1500;
const COLLISION_WINDOW_MS_SUBCTRL = 5000;

// Last press seen from any remote, used to detect a second remote pressing a
// different key within the collision window. Presses from the same senderId
// never collide with each other (that's just one remote repeating/holding).
let lastPress = null; // { key, senderId, at, fromSubCtrl }
let locked = false;

export function tvRemoteUnlock() {
  locked = false;
}

// Single choke point for every remote (web + android) key/command send. Checks
// for a same-window, different-key press from the other remote before
// forwarding to the tv (or ha) — see main.js for what a given path actually
// does once it gets there.
export async function keySendWithChk({
  key,
  senderId,
  fromSubCtrl,
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
  const isCollision =
    prev &&
    prev.senderId !== senderId &&
    now - prev.at < windowMs &&
    prev.key !== key;

  if (isCollision) {
    locked = true;
    unilog(1595, `collision: sent=${prev.key} blocked=${key}`);
    notifyClients("tvRemoteLock", { sentKey: prev.key, blockedKey: key });
    return { blocked: true, sentKey: prev.key, blockedKey: key };
  }

  lastPress = { key, senderId, at: now, fromSubCtrl };

  // Button-down for a scrub gesture only needs to arm the collision window —
  // the actual send (tap release, or scrub start/ping) happens separately.
  if (!path) return { blocked: false };

  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  let result = null;
  try {
    const r = await fetch(`${TV_TV_INTERNAL_URL}${path}`, opts);
    result = await r.json();
  } catch (e) {
    unilog(1596, `forward ${path} failed: ${e.message}`);
  }
  return { blocked: false, result };
}
