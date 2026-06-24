// Background worker: generate a .bif sidecar for a single video file.
// Spawned by apps/srvr/index.js (startBifCreate) as a detached process so the
// heavy ffmpeg work runs off the main server's event loop.
//
// Usage: node run-bif.js <videoPath>
//
// The parent kills this process group on cancel; createBifFile's ffmpeg child
// is in the same group, so it is stopped too.

import { createBifFile } from "../src/bif.js";

const videoPath = process.argv[2];

if (!videoPath) {
  console.error("[run-bif] no video path given");
  process.exit(1);
}

createBifFile(videoPath)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[run-bif] error:", e?.message || e);
    process.exit(1);
  });
