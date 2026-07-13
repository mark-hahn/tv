// Emby "intro overlay" engine: the skip/trim seek actions and the intro-marker
// editing UI driven by button presses from the tampermonkey emby-ui overlay
// (labels pushed back over the client's WebSocket). All logic + Emby control
// lives here; index.js wires the routes and the WebSocket press dispatch.

import fetch from "node-fetch";
import { unilog, logHere } from "@tv/share";
import * as tvdb from "./tvdb.js";
import * as bifQueue from "./bifQueue.js";
import { EMBY_BASE_URL, EMBY_API_KEY, EMBY_USER_ID } from "./embyConfig.js";

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
const TV_DEVICE_NAMES = ["Living Room TV", "Mark's Fire TV"];

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
      unilog(1350, `trim seek landed on attempt ${attempt}: pos=${posMs}ms target=${Math.round(trimPos)}ms`);
      return { ok: true };
    }
    unilog(1351, `trim seek did not land (attempt ${attempt}/${TRIM_SEEK_ATTEMPTS}): pos=${posMs}ms target=${Math.round(trimPos)}ms`);
  }
  return { ok: false, reason: "seekDidNotLand" };
}

// Format ms as the intro pane does: "m:ss.t" / "s.t"; 0 -> "--"; null -> ""
function fmtIntroPos(ms) {
  if (ms == null) return "";
  if (ms === 0) return "--";
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  const tenth = Math.floor((sec % 1) * 10);
  const wholeSec = Math.floor(sec);
  if (min > 0) return `${min}:${String(wholeSec).padStart(2, "0")}.${tenth}`;
  return `${wholeSec}.${tenth}`;
}

function pushEmbyText(ws, textId, text) {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(
      JSON.stringify({
        id: 0,
        notification: "embyText",
        data: { textId, text: text == null ? "" : String(text) },
      }),
    );
  } catch (e) {
    unilog(608, "send error:", e.message);
  }
}

function introTitleText(record, showName, season, episode) {
  const name = record?.name || showName || "";
  let se = "";
  if (season != null && episode != null) {
    se = ` (s${String(season).padStart(2, "0")}e${String(episode).padStart(2, "0")})`;
  }
  const all = tvdb.getAllTvdbSync?.() || {};
  const introCount = Object.values(all).filter((r) => r?.needsIntro).length;
  const prefix = introCount > 0 ? `(${introCount}) ` : "";
  return `${prefix}${name}${se}`;
}

export function pushIntroState(ws, record, showName, season, episode) {
  const si = tvdb.getSeasonIntro(record, season);
  pushEmbyText(ws, "title", introTitleText(record, showName, season, episode));
  pushEmbyText(ws, "startMark", fmtIntroPos(si.startMark ?? 0));
  pushEmbyText(ws, "trim", fmtIntroPos(si.trimPos ?? null));
  pushEmbyText(ws, "skip", fmtIntroPos(si.skipDur ?? null));
  pushEmbyText(ws, "ant", record?.anticipating ? "ANT" : "Ant");
  pushEmbyText(ws, "none", si.none ? "NONE" : "None");
}

// After a season-intro save, if the show now has a configured intro (trimPos,
// skipDur, or an explicit "none"), clear needsIntro and cancel any pending .bif
// job. Called from every save path (client endpoint + emby overlay press) so
// the flag never lingers. One-directional (only clears); the background update
// re-sets needsIntro when a show becomes unconfigured again.
export async function reconcileNeedsIntro(name) {
  const rec = name && tvdb.getAllTvdbSync()?.[name];
  if (!rec) return;
  const hasConfiguredIntro =
    rec.seasonIntros != null &&
    Object.values(rec.seasonIntros).some(
      (si) => si?.trimPos != null || si?.skipDur != null || si?.none === true,
    );
  if (hasConfiguredIntro && rec.needsIntro) {
    await tvdb.setTvdbFields({ name, needsIntro: false });
    try {
      bifQueue.handleNeedsIntroChange(name, rec, false);
    } catch (e) {
      unilog(1248, `needsIntro clear failed for ${name}: ${e.message}`);
    }
  }
}

async function embySeekTicks(sessionId, ticks, runtimeTicks) {
  let t = Math.max(0, Math.round(ticks));
  if (runtimeTicks && t > runtimeTicks) t = runtimeTicks; // past end -> seek to end
  const res = await fetch(
    `${EMBY_BASE_URL}/Sessions/${sessionId}/Playing/seek?SeekPositionTicks=${t}&api_key=${EMBY_API_KEY}`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
  if (!res.ok) unilog(609, `seek failed: ${res.status}`);
}

// Find the playing session + tvdb record for a device name
async function getEmbyIntroContext(deviceName) {
  if (!deviceName) return null;
  const sessRes = await fetch(
    `${EMBY_BASE_URL}/Sessions?api_key=${EMBY_API_KEY}`,
    { headers: { Accept: "application/json" } },
  );
  if (!sessRes.ok) return null;
  const sessions = await sessRes.json();
  const matches = sessions.filter(
    (s) => s.NowPlayingItem && s.DeviceName === deviceName,
  );
  const session = matches.find((s) => s.SupportsRemoteControl) ?? matches[0];
  if (!session) return null;
  const showName =
    session.NowPlayingItem.SeriesName || session.NowPlayingItem.Name;
  const allTvdb = tvdb.getAllTvdbSync();
  const showId = session.NowPlayingItem.SeriesId || session.NowPlayingItem.Id;
  let record = allTvdb[showName];
  if (!record) record = Object.values(allTvdb).find((r) => r.id === showId);
  return {
    session,
    controlId: controlSessionId(sessions, session),
    record,
    showName,
    season: session.NowPlayingItem.ParentIndexNumber ?? null,
    episode: session.NowPlayingItem.IndexNumber ?? null,
  };
}

// Seed intro labels from the emby item id (before playback starts)
export async function pushIntroStateFromItem(ws, embyItemId) {
  if (!embyItemId) return;
  try {
    const res = await fetch(
      `${EMBY_BASE_URL}/Users/${EMBY_USER_ID}/Items/${embyItemId}?api_key=${EMBY_API_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return;
    const item = await res.json();
    const showName = item.SeriesName || item.Name;
    const allTvdb = tvdb.getAllTvdbSync();
    const showId = item.SeriesId || item.Id;
    let record = allTvdb[showName];
    if (!record) record = Object.values(allTvdb).find((r) => r.id === showId);
    pushIntroState(
      ws,
      record,
      showName,
      item.ParentIndexNumber ?? null,
      item.IndexNumber ?? null,
    );
  } catch (e) {
    unilog(610, "seed error:", e.message);
  }
}

export async function handleEmbyIntroPress(ws, btnId, pressedAt, videoTimeSec) {
  const ctx = await getEmbyIntroContext(ws._embyUi?.deviceName);
  if (!ctx?.session) return; // nothing playing yet
  const { session, controlId, record, showName, season, episode } = ctx;
  const name = record?.name;
  let posTicks;
  if (videoTimeSec != null) {
    // Use the browser's live video.currentTime — always accurate, never stale
    posTicks = Math.max(0, Math.round(videoTimeSec * 1000 * 10000));
  } else {
    const rawPositionTicks = session.PlayState?.PositionTicks ?? 0;
    const pressDelay = pressedAt ? Math.max(0, Date.now() - pressedAt) : 0;
    posTicks = Math.max(0, rawPositionTicks - pressDelay * 10000);
  }
  const posMs = Math.round(posTicks / 10000);
  const runtime = session.NowPlayingItem?.RunTimeTicks ?? null;
  const sid = controlId ?? session.Id;
  const si = tvdb.getSeasonIntro(record, season);
  const startMark = si.startMark ?? 0;

  switch (btnId) {
    case "zero":
      await embySeekTicks(sid, 0, runtime);
      break;
    case "back30":
      await embySeekTicks(sid, posTicks - 30 * 1000 * 10000, runtime);
      break;
    case "back10":
      await embySeekTicks(sid, posTicks - 10 * 1000 * 10000, runtime);
      break;
    case "back3":
      await embySeekTicks(sid, posTicks - 3 * 1000 * 10000, runtime);
      break;
    case "fwd10":
      await embySeekTicks(sid, posTicks + 10 * 1000 * 10000, runtime);
      break;
    case "fwd30":
      await embySeekTicks(sid, posTicks + 30 * 1000 * 10000, runtime);
      break;
    case "pre":
      await embySeekTicks(sid, (startMark - 3000) * 10000, runtime);
      break;
    case "trimJump":
      if (si.trimPos) await embySeekTicks(sid, si.trimPos * 10000, runtime);
      break;
    case "skipTest":
      if (si.skipDur)
        await embySeekTicks(sid, posTicks + si.skipDur * 10000, runtime);
      break;
    case "startMark":
      if (name) await tvdb.saveSeasonIntro(record, season, "startMark", posMs);
      break;
    case "trimSet":
      if (name) await tvdb.saveSeasonIntro(record, season, "trimPos", posMs);
      break;
    case "skipSet":
      if (name && posMs >= startMark)
        await tvdb.saveSeasonIntro(
          record,
          season,
          "skipDur",
          posMs - startMark,
        );
      break;
    case "trimClr":
      if (name)
        await tvdb.saveSeasonIntro(
          record,
          season,
          "trimPos",
          si.trimPos === 0 ? null : 0,
        );
      break;
    case "skipClr":
      if (name)
        await tvdb.saveSeasonIntro(
          record,
          season,
          "skipDur",
          si.skipDur === 0 ? null : 0,
        );
      break;
    case "ant":
      if (name)
        await tvdb.setTvdbFields({ name, anticipating: !record?.anticipating });
      break;
    case "none":
      // Toggle "checked, no intro": keeps needsIntro false with no trim/skip.
      if (name)
        await tvdb.saveSeasonIntro(
          record,
          season,
          "none",
          si.none ? null : true,
        );
      break;
    default:
      return;
  }
  // setTvdbFields mutates allTvdb[name] in place; re-read for fresh labels
  if (name) await reconcileNeedsIntro(name);
  const fresh = (name && tvdb.getAllTvdbSync()?.[name]) || record;
  pushIntroState(ws, fresh, showName, season, episode);
}
