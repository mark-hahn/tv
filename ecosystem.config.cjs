const path = require('path');
const fs = require('fs');
const os = require('os');

// PM2 config intended to be run FROM a deployed git worktree checkout.
// `cwd` points to the app folder inside that worktree so relative paths and
// local files (cookies/secrets/db) resolve consistently.
//
// Usage (on remote host, inside the worktree directory):
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save

const root = __dirname;

function resolveNodeInterpreter() {
  // PM2 (especially when started via systemd) may not inherit an nvm-initialized PATH.
  // Force the app interpreter to the Node version pinned by .nvmrc when available.
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  let version = null;
  try {
    version = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
  } catch {
    version = null;
  }

  if (!version) return 'node';
  const nodePath = path.join(nvmDir, 'versions', 'node', version, 'bin', 'node');
  if (fs.existsSync(nodePath)) return nodePath;
  return 'node';
}

const nodeInterpreter = resolveNodeInterpreter();

function appCwd(rel) {
  return path.join(root, rel);
}

module.exports = {
  apps: [
    {
      name: 'tv-api',
      cwd: appCwd('apps/api'),
      script: 'src/server.js',
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'tv-down',
      cwd: appCwd('apps/down'),
      script: 'src/main.js',
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'tv-srvr',
      cwd: appCwd('apps/srvr'),
      script: 'index.js',
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
