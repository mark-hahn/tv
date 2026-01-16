const path = require('path');

// PM2 config intended to be run FROM a deployed git worktree checkout.
// `cwd` points to the app folder inside that worktree so relative paths and
// local files (cookies/secrets/db) resolve consistently.
//
// Usage (on remote host, inside the worktree directory):
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save

const root = __dirname;

function appCwd(rel) {
  return path.join(root, rel);
}

module.exports = {
  apps: [
    {
      name: 'tv-api',
      cwd: appCwd('apps/api'),
      script: 'src/server.js',
      interpreter: 'node',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'tv-down',
      cwd: appCwd('apps/down'),
      script: 'src/main.js',
      interpreter: 'node',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'tv-srvr',
      cwd: appCwd('apps/srvr'),
      script: 'index.js',
      interpreter: 'node',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
