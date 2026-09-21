// Film-strip stills and on-click video windows for the intro and chksrt panes
// (see src/stills.js).

import * as path from "node:path";
import { logHere, unilog} from "@tv/share"
import {
  MAX_OFFSET_SECS,
  startStills,
  stillsStatus,
  streamWindow,
} from "../stills.js";

const TV_DIR = "/mnt/media/tv";

export function registerStillsRoutes(app) {
  const inTvTree = (p) => !!p && path.resolve(p).startsWith(TV_DIR + "/");

  // Stills progress for an episode at `offset` whole seconds (0..MAX_OFFSET_SECS,
  // default 0), starting the build (ahead of the sweep's queue) if nothing has
  // yet — the pane polls this until `done`.
  app.get("/api/stills", async (req, res) => {
    const filePath = req.query.path;
    if (!inTvTree(filePath)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const offset = req.query.offset === undefined ? 0 : parseInt(req.query.offset, 10);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET_SECS) {
      res.status(400).json({ error: `offset must be 0..${MAX_OFFSET_SECS}` });
      return;
    }
    try {
      await startStills(filePath, { urgent: true, offset });
      res.json(await stillsStatus(filePath, offset));
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
    // The response lasts as long as ffmpeg takes to encode the whole window,
    // ~5s for WINDOW_SECS at 480p. The client's MediaSource consumes fragments
    // as they arrive (first byte is on the wire in ~150ms), so nothing is
    // actually waiting — exempt it from the slow-request warning in index.js.
    res.locals.slowExempt = true;

    streamWindow(filePath, startSec, audioIndex, req, res).catch((e) => {
      unilog(2447, `window failed for ${filePath}: ${e.message}`);
      if (!res.writableEnded) res.end();
    });
  });
}
