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
