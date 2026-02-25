# Dev / Prod Environment Swap

## Current state on branch `dev`
- Client (Vite) points to **dev servers** (`tv-api-dev`, `tv-srvr-dev`, `tv-down-dev`)
- Server code deploys to `/root/dev/apps/tv-dev` (NOT `/root/dev/apps/tv`)
- Dev servers run on different ports so prod is never disturbed

## Port map
| Server       | Prod port | Dev port |
|--------------|-----------|----------|
| tv-api       | 3001      | 3002     |
| tv-down      | 3003      | 3004     |
| tv-srvr HTTP | 8737      | 8747     |
| tv-srvr WS   | 8736      | 8746     |

## To switch client back to PROD (point Vite at prod servers)
Edit `apps/client/src/config.js` — change the three URL constants:
```js
const TV_API_URL  = "https://hahnca.com/tv-api";
const TV_SRVR_URL = "https://hahnca.com/tv-srvr";
const TV_DOWN_URL = "https://hahnca.com/tv-down";
```

## To deploy dev server code
```bash
./srvr            # deploys all to /root/dev/apps/tv-dev, restarts tv-*-dev pm2 apps
./srvr srvr       # deploy only srvr
./srvr api        # deploy only api
./srvr down       # deploy only down
```

## To deploy to PROD instead (override deploy target)
```bash
TV_REMOTE_BASE=/root/dev/apps/tv ./srvr
```
Do NOT do this while on the `dev` branch — the dev branch has dev ports baked in.
Switch to `main` first, then deploy to prod.

## To fully switch back to prod workflow
1. `git checkout main`
2. Use prod config.js values (above) for local Vite against prod, OR just stop running Vite
3. `TV_REMOTE_BASE=/root/dev/apps/tv ./srvr` to deploy main to prod

## One-time setup: seed dev server data from prod (already done)
If the dev directory is ever re-created from scratch, run on the remote:
```bash
rsync -a /root/dev/apps/tv/apps/down/data/  /root/dev/apps/tv-dev/apps/down/data/
rsync -a /root/dev/apps/tv/apps/api/data/   /root/dev/apps/tv-dev/apps/api/data/
rsync -a /root/dev/apps/tv/apps/srvr/data/  /root/dev/apps/tv-dev/apps/srvr/data/
cp -r /root/dev/apps/tv/apps/api/secrets    /root/dev/apps/tv-dev/apps/api/
cp -r /root/dev/apps/tv/apps/srvr/secrets   /root/dev/apps/tv-dev/apps/srvr/
cp /root/dev/apps/tv/apps/api/src/qb-cred.js /root/dev/apps/tv-dev/apps/api/src/
pm2 restart tv-api-dev tv-down-dev tv-srvr-dev && pm2 save
```

## Nginx routes (on hahnca.com — already configured, do not change)
- `/tv-api/`      → prod api (port 3001)
- `/tv-api-dev/`  → dev api (port 3002)
- `/tv-srvr`      → prod srvr (WS 8736, HTTP 8737)
- `/tv-srvr-dev`  → dev srvr (WS 8746, HTTP 8747)
- `/tv-down/`     → prod down (port 3003)
- `/tv-down-dev/` → dev down (port 3004)
