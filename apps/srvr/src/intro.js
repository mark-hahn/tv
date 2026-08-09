// Intro skip/trim during TV playback: seeks the Emby session on the TV by the
// show's configured skipDur or to its trimPos. Driven by the Skip Intro button
// (emby-skip-intro.user.js -> /api/skipIntro, /api/trimIntro) and by the
// auto-skip in index.js. Marking intros is not here — that happens in the web
// client's own player, which never touches Emby.

import fetch from "node-fetch";
import { unilog } from "@tv/share";
import * as tvdb from "./tvdb.js";
import * as bifQueue from "./bifQueue.js";
import { EMBY_BASE_URL, EMBY_API_KEY } from "./embyConfig.js";

// A seek sent while the TV player is still starting up is silently dropped:
// Emby accepts the command (204) but the position never moves. So the trim seek
// is verified and retried until the position actually lands.
const TRIM_SEEK_ATTEMPTS = 6;
const TRIM_SEEK_VERIFY_MS = 1200; // wait before re-reading the position
const TRIM_SEEK_LAND_TOL_MS = 1500; // seeks snap back to the nearest keyframe

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Current playback position (ms) of the TV's playing session, or null.
async function playbackPosMs(deviceName) {
  const res = await fetch(`${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const s = findTvPlaySession(await res.json(), deviceName);
  if (!s) return null;
  return Math.round((s.PlayState?.PositionTicks ?? 0) / 10000);
}

// Commands (seek etc.) must go to the device's remote-controllable session.
// The Emby Android TV app reports playback on one session but only accepts
// seek/playstate commands on a companion controller session with the same
// DeviceId. Seeking the playback session itself returns HTTP 500 — and that
// session now (mis)reports SupportsRemoteControl:true, so we can't trust that
// flag. Always prefer a same-DeviceId sibling; fall back to the playback
// session for single-session devices (web player, etc.).
function controlSessionId(sessions, playSession) {
  if (!playSession) return null;
  const sibling = sessions.find(
    (s) =>
      s.Id !== playSession.Id &&
      s.DeviceId === playSession.DeviceId &&
      s.SupportsRemoteControl,
  );
  return sibling?.Id ?? playSession.Id;
}

// Emby DeviceNames reported by the Emby app on each TV. With no explicit
// deviceName, skip/trim act on whichever TV is currently playing.
const TV_DEVICE_NAMES = ["Living Room TV"];

function findTvPlaySession(sessions, deviceName) {
  const matches = sessions.filter(
    (s) =>
      s.NowPlayingItem &&
      (deviceName
        ? s.DeviceName === deviceName
        : TV_DEVICE_NAMES.includes(s.DeviceName)),
  );
  return matches.find((s) => s.SupportsRemoteControl) ?? matches[0] ?? null;
}

export async function doSkipIntro(pressedAt, deviceName = null) {
  const sessRes = await fetch(
    `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
    { headers: { Accept: "application/json" } },
  );
  if (!sessRes.ok) {
    unilog(52, `sessions fetch failed: ${sessRes.status}`);
    return { ok: false, error: `sessions ${sessRes.status}` };
  }
  const sessions = await sessRes.json();
  const session = findTvPlaySession(sessions, deviceName);
  if (!session) {
    const deviceNames = sessions.map((s) => s.DeviceName).join(", ");
    const playingDevices = sessions
      .filter((s) => s.NowPlayingItem)
      .map((s) => s.DeviceName);
    unilog(603, `no ${deviceName} session. devices: ${deviceNames}`);
    return {
      ok: false,
      reason: "notPlaying",
      requestedDevice: deviceName,
      playingDevices,
      allDevices: sessions.map((s) => s.DeviceName),
    };
  }
  const rawPositionTicks = session.PlayState?.PositionTicks ?? 0;
  const pressDelay = pressedAt ? Math.max(0, Date.now() - pressedAt) : 0;
  const positionTicks = Math.max(0, rawPositionTicks - pressDelay * 10000);
  const showName =
    session.NowPlayingItem.SeriesName || session.NowPlayingItem.Name;
  const allTvdb = tvdb.getAllTvdbSync();
  const showId = session.NowPlayingItem.SeriesId || session.NowPlayingItem.Id;
  let record = allTvdb[showName];
  if (!record) {
    record = Object.values(allTvdb).find((r) => r.id === showId);
  }
  const season = session.NowPlayingItem.ParentIndexNumber ?? null;
  const skipDur = tvdb.getSeasonIntro(record, season).skipDur;
  if (!skipDur || skipDur <= 0) {
    unilog(53, `no skipDur for show: ${showName}`);
    return { ok: false, reason: "noSkipDur" };
  }
  // Skipping: jump ahead by skipDur from current position.
  const newTicks = Math.round(positionTicks + skipDur * 10000);
  unilog(
    604,
    `show=${showName} pressDelay=${pressDelay}ms rawPos=${Math.round(rawPositionTicks / 10000)}ms skipDur=${skipDur}ms newPos=${Math.round(newTicks / 10000)}ms`,
  );
  const seekRes = await fetch(
    `${EMBY_BASE_URL}/Sessions/${controlSessionId(sessions, session)}/Playing/seek?SeekPositionTicks=${newTicks}&api_key=${EMBY_API_KEY}`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
  if (!seekRes.ok) {
    unilog(54, `seek failed for ${showName}: ${seekRes.status}`);
    return { ok: false, error: `seek ${seekRes.status}` };
  }
  return { ok: true };
}

// Intro: trimming — seek to absolute trimPos position on the specified device
export async function doTrimIntro(deviceName = null) {
  const sessRes = await fetch(
    `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
    { headers: { Accept: "application/json" } },
  );
  if (!sessRes.ok) {
    unilog(55, `sessions fetch failed: ${sessRes.status}`);
    return { ok: false, error: `sessions ${sessRes.status}` };
  }
  const sessions = await sessRes.json();
  const session = findTvPlaySession(sessions, deviceName);
  if (!session) {
    const devs = sessions.map((s) => s.DeviceName).join(", ");
    unilog(1332, `doTrimIntro: no ${deviceName} session. devices: ${devs}`);
    return { ok: false, reason: "notPlaying" };
  }
  const showName =
    session.NowPlayingItem.SeriesName || session.NowPlayingItem.Name;
  const allTvdb = tvdb.getAllTvdbSync();
  const showId = session.NowPlayingItem.SeriesId || session.NowPlayingItem.Id;
  let record = allTvdb[showName];
  if (!record) {
    record = Object.values(allTvdb).find((r) => r.id === showId);
  }
  const season = session.NowPlayingItem.ParentIndexNumber ?? null;
  const trimPos = tvdb.getSeasonIntro(record, season).trimPos;
  if (!trimPos || trimPos <= 0) {
    unilog(56, `no trimPos for show: ${showName}`);
    return { ok: false, reason: "noTrimPos" };
  }
  const newTicks = Math.round(trimPos * 10000);
  unilog(
    606,
    `show=${showName} trimPos=${trimPos}ms newPos=${Math.round(newTicks / 10000)}ms`,
  );
  const sid = controlSessionId(sessions, session);
  for (let attempt = 1; attempt <= TRIM_SEEK_ATTEMPTS; attempt++) {
    const seekRes = await fetch(
      `${EMBY_BASE_URL}/Sessions/${sid}/Playing/seek?SeekPositionTicks=${newTicks}&api_key=${EMBY_API_KEY}`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
    if (!seekRes.ok) {
      unilog(57, `seek failed for ${showName}: ${seekRes.status}`);
      return { ok: false, error: `seek ${seekRes.status}` };
    }
    await sleep(TRIM_SEEK_VERIFY_MS);
    const posMs = await playbackPosMs(deviceName);
    if (posMs != null && posMs >= trimPos - TRIM_SEEK_LAND_TOL_MS) {
      unilog(
        1350,
        `trim seek landed on attempt ${attempt}: pos=${posMs}ms target=${Math.round(trimPos)}ms`,
      );
      return { ok: true };
    }
    if (attempt < TRIM_SEEK_ATTEMPTS) {
      unilog(1730, `trim seek did not land (attempt ${attempt}/${TRIM_SEEK_ATTEMPTS}): pos=${posMs}ms target=${Math.round(trimPos)}ms`);
    }
  }
  unilog(1731, `trim seek gave up for ${showName} after ${TRIM_SEEK_ATTEMPTS} attempts: target=${Math.round(trimPos)}ms`);
  return { ok: false, reason: "seekDidNotLand" };
}

// After a season-intro save, if the show now has a configured intro (trimPos,
// skipDur, or an explicit "none"), clear needsIntro and cancel any pending .bif
// job. Called from every save path (client endpoint + emby overlay press) so
// the flag never lingers. One-directional (only clears); the background update
// re-sets needsIntro when a show becomes unconfigured again.
// A show is "configured" once any season carries a trim, a skip, or an explicit
// "none" — meaning it will not be opened for intro marking again.
export function hasConfiguredIntro(rec) {
  return (
    rec?.seasonIntros != null &&
    Object.values(rec.seasonIntros).some(
      (si) => si?.trimPos != null || si?.skipDur != null || si?.none === true,
    )
  );
}

export async function reconcileNeedsIntro(name) {
  const rec = name && tvdb.getAllTvdbSync()?.[name];
  if (!rec) return;
  if (hasConfiguredIntro(rec) && rec.needsIntro) {
    await tvdb.setTvdbFields({ name, needsIntro: false });
    try {
      bifQueue.handleNeedsIntroChange(name, rec, false);
    } catch (e) {
      unilog(1248, `needsIntro clear failed for ${name}: ${e.message}`);
    }
  }
}

