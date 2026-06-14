# Plan: TV Control via Home Automation + Chromecast

## Overview

Add a new `apps/tv` server app that connects to the Home Assistant (ha) WebSocket API to control a Chromecast media player. Add a **TV** button to the client `hdrtop.vue` that calls a `tv-on` endpoint on the new server.

---

## Background Research

### HA WebSocket API (from `hahnca.com:/root/dev/apps/hvac2/src/drivers/`)

- **Host:** `wss://hahnca.com:8123/api/websocket`
- **Auth token** (same token used by hvac2 `samsung.coffee`):
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (full token in samsung.coffee)
- **Connection pattern:** copy `websock-ha.coffee` logic in JS — auth handshake, subscribe to state_changed events, call services
- **Relevant service calls:**
  - Turn on: `callService('media_player', 'turn_on', { entity_id })`
  - Turn off: `callService('media_player', 'turn_off', { entity_id })`
  - Play media: `callService('media_player', 'play_media', { entity_id }, { media_content_id, media_content_type })`

### Chromecast Media Player Discovery

Query `GET https://localhost:8123/api/states` (internal on server). Current `media_player` entities:

- `media_player.master_spkr_left` — class: speaker
- `media_player.stereo` — class: speaker
- `media_player.living_room_speaker` — class: speaker
- `media_player.roku_2` — class: receiver
- `media_player.patio_speaker` — class: speaker
- `media_player.living_room_tv` — class: tv, assumed_state: true (IR-controlled TV)
- `media_player.living_room_tv_2` — no class, no assumed_state (network-controlled → likely Chromecast)

**Auto-discovery strategy:** at startup, query HA REST API for all states, filter media_players that:

1. Do NOT have `assumed_state: true`
2. Have `device_class` of `tv` OR no `device_class` (exclude pure speakers/receivers)
3. Log which entity was selected; die fast if none found

Best current candidate: `media_player.living_room_tv_2`

### Existing Port/URL Map

| App    | pm2 name  | Port     | Nginx path  |
| ------ | --------- | -------- | ----------- |
| api    | tv-api    | 3001     | /tv-api/    |
| down   | tv-down   | 3003     | /tv-down/   |
| srvr   | tv-srvr   | 8737     | /tv-srvr/   |
| **tv** | **tv-tv** | **3004** | **/tv-tv/** |

Pick 3004 (verify it is unused on server before implementing).

---

## Phase 1 — Create `apps/tv` Server App

### File: `apps/tv/package.json`

```json
{
  "name": "@tv/tv",
  "version": "1.0.0",
  "description": "TV control via Home Assistant / Chromecast",
  "main": "src/main.js",
  "type": "module",
  "scripts": {
    "dev": "node src/main.js",
    "build": "node -e \"console.log('build: @tv/tv (no build step)')\"",
    "lint": "node -e \"console.log('lint: @tv/tv (not configured)')\"",
    "test": "node -e \"console.log('test: @tv/tv (not configured)')\"",
    "clean": "node -e \"console.log('clean: @tv/tv (not configured)')\""
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "ws": "^8.14.2",
    "node-fetch": "^3.3.2",
    "@tv/share": "workspace:*"
  }
}
```

### File: `apps/tv/src/main.js`

Top-level constants (no env vars):

```js
const HA_HOST = "hahnca.com:8123";
const HA_ACCESS_TOKEN = "<same token as samsung.coffee>";
const TV_PORT = 3004;
const LOG_PREFIX = "TV";
```

**Startup sequence:**

1. Connect to HA WebSocket (reuse logic from `websock-ha.coffee` — re-implement inline in JS since the hvac2 driver is CoffeeScript in a separate project)
2. On `connected`, query HA REST API `GET https://hahnca.com:8123/api/states` to discover the Chromecast entity
3. Discovery: pick the first `media_player` entity where `attributes.assumed_state` is NOT true AND `device_class` is `tv` OR no `device_class`. Log entity name. Die if none found.
4. Cache discovered `CHROMECAST_ENTITY_ID`
5. Start Express HTTP server on port 3004

**Endpoints:**

`GET /tv/on`

- Calls HA `media_player.turn_on` with `CHROMECAST_ENTITY_ID`
- Returns `{ ok: true, entity: CHROMECAST_ENTITY_ID }`
- Called from client TV button

`GET /tv/off`

- Calls HA `media_player.turn_off`
- Returns `{ ok: true }`

`GET /tv/status`

- Returns `{ entity: CHROMECAST_ENTITY_ID, state: <current cached state> }`

**HA WebSocket implementation in main.js:**

- Implement a minimal class `HaWs` mirroring `websock-ha.coffee`:
  - `connect()` → websocket to `wss://HA_HOST/api/websocket` (rejectUnauthorized: false)
  - Auth handshake
  - Subscribe to `state_changed` for `CHROMECAST_ENTITY_ID` once discovered
  - `callService(domain, service, entityId, serviceData)` method
  - Reconnect on disconnect with 5-second delay

**Logging:**

- All timestamps in PST LA format `MM-DD HH:mm`
- Use `console.log` with prefix `[TV MM-DD HH:mm]`

---

## Phase 2 — Deployment Infrastructure

### 2a. Update `ecosystem.config.cjs`

Add a new pm2 app entry alongside the existing ones:

```js
{
  name: "tv-tv",
  cwd: appCwd("tv"),
  script: "src/main.js",
  interpreter: nodeInterpreter,
  time: true,
  env: {
    NODE_ENV: "production",
  },
},
```

### 2b. Update `srvr` script

Add `tv` to the following sections (mirroring how `down` and `srvr` are handled):

1. `pm2_name_for_project()` — add `tv) printf '%s' "tv-tv" ;;`
2. `remote_sync_app()` — add `tv` to the list that excludes `data/` and `secrets/`
3. `remote_pm2_restart_all_silent()` — add `tv-tv` to the reload list
4. The `case` dispatch at the bottom — add `tv` as valid argument alongside `api|down|srvr|client|share|asr`

### 2c. Update nginx `server.conf` on remote

Add nginx location block (send to `hahnca.com` via SSH, edit `/etc/nginx/conf.d/server.conf`):

```nginx
location /tv-tv/ {
  rewrite ^/tv-tv/(.*) /$1 break;
  proxy_pass http://localhost:3004;
  proxy_redirect off;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

Reload nginx after: `nginx -s reload`

### 2d. Update `pnpm-workspace.yaml`

Verify `apps/tv` is covered by the workspace glob (likely `apps/*` already covers it — confirm before adding).

---

## Phase 3 — Client Changes

### 3a. `apps/client/src/config.js`

Add:

```js
const TV_TV_URL = "https://hahnca.com/tv-tv";
```

And export it in the config object:

```js
tvTvUrl: TV_TV_URL,
```

### 3b. `apps/client/src/components/hdrtop.vue`

**Template:** Add a `TV` button after the `Actors` button (inside the right-side flex div):

```html
<button
  @click="$emit('tv-click')"
  style="
    height: 24px;
    background-color: white;
    font-size: 13px;
    cursor: pointer;
    border-radius: 7px;
    margin: 0 0 0 10px;
  "
>
  TV
</button>
```

**Props:** No new props needed for the basic TV-on button.

**Emits:** Add `"tv-click"` to the `emits` array.

### 3c. `apps/client/src/components/list.vue`

1. Pass `@tv-click="handleTvClick"` on both `<HdrTop>` usages.
2. Add handler method:

```js
async handleTvClick() {
  const url = `${config.tvTvUrl}/tv/on`;
  const res = await fetch(url);
  const data = await res.json();
}
```

---

## Deploy Order

```bash
# First time (new app):
./srvr share    # share package may have changed
./srvr tv       # sync + pnpm install + pm2 start tv-tv

# Future changes to tv app only:
./srvr tv
```

---

## Open Questions / Risks

1. **Port 3004** — verify not already in use on remote: `ssh hahnca.com 'ss -tlnp | grep 3004'`
2. **Chromecast entity** — `media_player.living_room_tv_2` is the best candidate but identity is not 100% confirmed. The auto-discovery logic at startup will log the selected entity; review the log after first deploy.
3. **HA token expiry** — the same long-lived token from `samsung.coffee` should be used; it expires in 2033 per the JWT payload.
4. **HTTP vs HTTPS for tv app** — `srvr` uses HTTPS with self-signed certs; `down` uses plain HTTP proxied by nginx. The `tv` app should follow `down`'s pattern (plain HTTP on 3004, nginx handles TLS).
