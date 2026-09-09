// Film-strip stills and on-click video windows for the intro and chksrt panes
// (see src/stills.js).

import * as path from "node:path";
import { startStills, stillsStatus, streamWindow } from "../stills.js";

const TV_DIR = "/mnt/media/tv";

export function registerStillsRoutes(app) {
  const inTvTree = (p) => !!p && path.resolve(p).startsWith(TV_DIR + "/");

  // Stills progress for an episode, starting the build (ahead of the sweep's
  // queue) if nothing has yet — the pane polls this until `done`.
  app.get("/api/stills", async (req, res) => {
    const filePath = req.query.path;
    if (!inTvTree(filePath)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      await startStills(filePath, { urgent: true });
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
