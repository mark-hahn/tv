// Intro test side door (see src/stills.js): the "download just finished"
// trigger, stills progress, a cold-run reset, and the on-click video window.
// Additive — nothing here touches mpfour, /api/stream, the intro queue or
// tvdb, and the real Intro/Chksrt flows never call it.

import * as path from "node:path";
import {
  startStills,
  stillsStatus,
  resetStills,
  streamWindow,
} from "../stills.js";
import {
  subsState,
  enqueueSubQueueChkSrt,
  cleanChkSrtQueue,
  persistSubQueueChkSrt,
} from "../subsQueue.js";

const TV_DIR = "/mnt/media/tv";

export function registerIntroTestRoutes(
  app,
  { getRecord, pickIntroFile, publishChksrtState, syncBatchMsgs },
) {
  // The episode the real Intro flow would open for this show.
  const episodeFor = (showName) => {
    if (!showName) throw new Error("showName required");
    const record = getRecord(showName);
    if (!record) throw new Error("show not found");
    const pick = pickIntroFile(record);
    if (!pick?.path) throw new Error(pick?.error || "no playable episode");
    return pick;
  };
  const inTvTree = (p) => !!p && path.resolve(p).startsWith(TV_DIR + "/");

  // Land: start building the stills for this show's intro episode.
  app.post("/api/introStart", async (req, res) => {
    try {
      const pick = episodeFor(req.body?.showName);
      startStills(pick.path);
      res.json({
        ok: true,
        path: pick.path,
        season: pick.season ?? null,
        episode: pick.episode ?? null,
        ...(await stillsStatus(pick.path)),
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Cold run: kill any job and delete the stills for this show's episode.
  app.post("/api/introReset", async (req, res) => {
    try {
      const pick = episodeFor(req.body?.showName);
      await resetStills(pick.path);
      res.json({ ok: true, path: pick.path });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // Q-chksrt: put this show's intro-pick episode at the head of the real
  // chksrt queue, so Chksrt and Test-chksrt open the same file and Save/OK
  // retire it exactly as in production.
  app.post("/api/introQueueChksrt", (req, res) => {
    try {
      const pick = episodeFor(req.body?.showName);
      enqueueSubQueueChkSrt({ videoFilePath: pick.path, fromUI: true }, true);
      cleanChkSrtQueue();
      persistSubQueueChkSrt();
      publishChksrtState();
      syncBatchMsgs();
      res.json({
        ok: true,
        path: pick.path,
        count: subsState.subQueueChkSrt.length,
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.get("/api/introStills", async (req, res) => {
    const filePath = req.query.path;
    if (!inTvTree(filePath)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      res.json(await stillsStatus(filePath));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // WINDOW_SECS of 480p from `start` seconds, fragmented mp4 for MSE. `audio`
  // is an absolute stream index (as /api/audio-list reports them).
  app.get("/api/window", (req, res) => {
    const filePath = req.query.path;
    if (!inTvTree(filePath)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const startSec = parseFloat(req.query.start);
    if (!Number.isFinite(startSec) || startSec < 0) {
      res.status(400).json({ error: "start required" });
      return;
    }
    const rawAudio = req.query.audio;
    const audioIndex = rawAudio === undefined ? null : parseInt(rawAudio, 10);
    if (audioIndex !== null && !Number.isInteger(audioIndex)) {
      res.status(400).json({ error: "invalid audio stream index" });
      return;
    }
    streamWindow(filePath, startSec, audioIndex, req, res);
  });
}
