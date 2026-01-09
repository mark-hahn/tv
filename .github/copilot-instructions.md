# Copilot project brief (tv-series-client)

## What this repo is
A Vue 3 + Vite client for browsing TV series metadata and working with torrents. There is a separate Node-based torrents server under `torrents/`.

## How to run
- Client + torrents server together: `npm run dev`
- Client only (Vite): `npm run serve-vite`
- Torrents server only: `npm run torrents`
- Build static output to `shows/`: `npm run build-vite`

## Key folders
- `src/`: main client app code (Vue components in `src/assets/components/`)
- `torrents/`: Node service used by the client
- `shows/`: built output directory (generated)
- `samples/`: sample API payloads and fixtures

## Coding preferences
- Prefer small, surgical changes; avoid broad refactors unless requested.
- Match existing code style (mostly JS/ESM).
- If you need context, ask for the specific files and symbols to inspect instead of guessing.

## When debugging
- First reproduce from scripts/logs, then identify the smallest fix.
- When proposing fixes, include the exact file paths and minimal diffs.
