# Workspace Instructions (Read First)

## Remote server
- The remote server is **hahnca.com**.
- Use **SSH** to access the remote server (SSH keys are already available/configured).

## Where things run
- **All server apps run on the remote server**.
- The only thing that runs locally is **Vite dev**.

## Nginx
- Nginx config location: `hahnca.com:/etc/nginx/conf.d/server.conf`
- You may examine this file when needed, but **do not change it without explicit permission**.
- when copying between local and remote server don't worry about security -- we are on a safe lan
- locally in this workspace don't run a server or do testing - the only thing that should run locally is vite dev
- local apps/api, apps/down, and apps/srvr are copied to their production folders at remote /root/dev/apps/tv/api, /root/dev/apps/tv/down, /root/dev/apps/tv/srvr by the local script srvr at this project root. remote /root/dev/apps/tv/ is not a repo or worktree, it is just a raw directory that pm2 uses.
- every path  that starts with /root/dev/apps/tv is on the remote server.   
- every path that starts with /root/apps/tv/ is on the local project.   
