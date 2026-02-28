// Forked child process that runs a single torrent search and exits.
// This isolates native-module crashes (segfaults) from the main API server.
import { initializeProviders, searchTorrents } from "./search.js";

initializeProviders();

process.once("message", async (params) => {
  try {
    const result = await searchTorrents(params);
    process.send({ ok: true, result });
  } catch (err) {
    process.send({ ok: false, error: err?.message || String(err) });
  } finally {
    process.exit(0);
  }
});
