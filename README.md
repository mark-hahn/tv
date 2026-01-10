# tv-series

Vue 3 + Vite client for browsing TV series metadata.

This client expects a separate "torrents API" service (see the `torrents/` folder in this repo history). The client is now set up to run without a local `torrents/` folder by pointing at an external torrents API URL.

## Run

- Client (Vite): `npm run dev`
- Build static output to `shows/`: `npm run build-vite`

## Torrents API

The client calls a hard-coded torrents API base URL (see `src/config.js`).

If you run the torrents server elsewhere (Remote-SSH / another host), update that constant to match your deployed endpoint.
