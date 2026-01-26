# tv-series

Vue 3 + Vite client for browsing TV series metadata.

This client expects a separate API service (the monorepo `tv-api`) for torrent search/download helpers. The client is now set up to run without a local `torrents/` folder by pointing at an external API base URL.

## Run

- Client (Vite): `pnpm dev`
- Build static output to `shows/`: `pnpm build-vite`

## API

The client calls a hard-coded API base URL (see `src/config.js`).

If you run the API elsewhere (Remote-SSH / another host), update that constant to match your deployed endpoint.
