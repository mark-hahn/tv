// Forked child process that runs a single torrent search and exits.
// This isolates native-module crashes (segfaults) from the main API server.
import { initializeProviders, searchTorrents } from "./search.js";

initializeProviders();

function sendAndExit(message, exitCode) {
  if (typeof process.send !== "function" || !process.connected) {
    process.exit(exitCode);
    return;
  }
  try {
    process.send(message, () => process.exit(exitCode));
  } catch {
    process.exit(exitCode);
  }
}

process.once("message", async (params) => {
  try {
    const result = await searchTorrents(params);
    sendAndExit({ ok: true, result }, 0);
  } catch (err) {
    sendAndExit({ ok: false, error: err?.message || String(err) }, 1);
  }
});
