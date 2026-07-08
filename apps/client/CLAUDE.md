# Copilot project brief (tv-series-client)

## What this repo is
A Vue 3 + Vite client for browsing TV series metadata and working with torrents. The torrents API server is a separate project (not in this repo).

## How to run
- Client (Vite): `npm run dev` or `npm run serve-vite`
- Build static output to `shows/`: `npm run build-vite`

## Key folders
- `src/`: main client app code (Vue components in `src/assets/components/`)
- `shows/`: built output directory (generated)
- `samples/`: sample API payloads and fixtures

## Coding preferences
- Prefer small, surgical changes; avoid broad refactors unless requested.
- Match existing code style (mostly JS/ESM).
- If you need context, ask for the specific files and symbols to inspect instead of guessing.

## When debugging
- First reproduce from scripts/logs, then identify the smallest fix.
- When proposing fixes, include the exact file paths and minimal diffs.

## tabbed pane card tabs

when a pane is referenced by tab name it means the file for that tab.  For example, the down tab refers to tvproc.vue
