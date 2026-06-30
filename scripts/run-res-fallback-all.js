// One-time: ask tv-srvr to visit every inEmby show and acquire/queue a 1080
// fallback for each unwatched 2160 episode (same logic the tvdb background task
// runs per-show). Re-encodes are added to the server's ffmpeg queue and run in
// the background. Run on the remote server:  node scripts/run-res-fallback-all.js
//
// Safe to re-run: shows that already have a 1080 (active or .alt) are skipped.

const SRVR_INTERNAL_URL = "http://127.0.0.1:8739";

async function main() {
  const url = `${SRVR_INTERNAL_URL}/api/resFallbackScanAll`;
  console.log(`POST ${url}`);
  const resp = await fetch(url, { method: "POST" });
  const result = await resp.json();
  console.log("result:", JSON.stringify(result, null, 2));
  if (!result?.ok) process.exit(1);
}

main().catch((e) => {
  console.error("run-res-fallback-all failed:", e.message);
  process.exit(1);
});
