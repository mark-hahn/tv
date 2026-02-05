# Problem Summary: `asr.js` Regression and Silent Failure

## Context

We were addressing an issue with duplicate log lines appearing in the frontend console.

1. **Resolved:** The server-side race condition in `apps/srvr/src/asr.js` was fixed by adding a "Zombie Guard" (`if (ws._asrTailProc !== proc) return;`). This ensures abandoned `tail` processes do not send data to the WebSocket.
2. **Regression:** In an attempt to clean up debug logs in the worker script (`apps/asr/asr.js`), a manual revert was performed. The user reported that this revert went "too far back," resulting in the worker script producing almost no output ("output too small") or exiting immediately.

## Current Symptoms

- **Silent Failure:** When the `asr.js` worker runs, it appears to exit immediately or fail to write to stdout/stderr.
- **Missing Logs:** The expected `[DEBUG-FLOW]` or standard processing logs are absent.
- **User Observation:** "temp1, temp2, and temp3 have old data" and "asr pane output too small on first run".

## Files Involved

### 1. `apps/srvr/src/asr.js` (Status: ✅ Fixed)

- Logic added to prevent duplicate logs from zombie processes.
- **Action:** No changes needed here. Ensure this file is deployed.

### 2. `apps/asr/asr.js` (Status: ❌ Broken/Regressed)

- This file is the primary suspect.
- **Potential Cause 1 (Logging Wrapper):** The file contains a custom `console.log = function` wrapper (Lines 37-77). It is possible this wrapper is aggressively filtering messages, causing the "silent" behavior.
- **Potential Cause 2 (Entry Point):** The `main()` function or the IIFE at the bottom of the file (Lines 1025-1035) might be failing silently or `process.exit(1)` is being called without a logged error.
- **Environment:** This script runs on a remote server. Local testing showed "No input file specified" when run with `node`, suggesting the file _can_ parse locally, but the runtime behavior on the server is failing.

## Constraints & Instructions for Next Steps

- **Execution:** The app runs on a remote server. Do not try to run full integration tests locally.
- **Deployment:** Do not run deployment scripts. Edit the local files and inform the user which files to deploy.
- **Goal:** Restore `apps/asr/asr.js` to a state where it:
  1. Runs successfully.
  2. Outputs enough logging to verify it is working.
  3. Does not produce the "duplicate lines" (though that was primarily a server-side fix).

## Recommendation for Next LLM

Focus immediately on **`apps/asr/asr.js`**. Review the `console.log` override and the `main()` execution flow. The code currently in the file looks syntactically valid but logically "muted" or broken. The priority is to restore standard output visibility.
