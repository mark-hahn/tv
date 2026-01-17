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

function appCwd(name) {
  return path.join(root, 'apps', name);
}

module.exports = {
  apps: [
    {
      name: 'tv-api',
      cwd: appCwd('api'),
      script: 'src/server.js',
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: 'production',
        DISABLE_INTERNAL_CORS: '1',
        TV_DATA_DIR: '/root/dev/apps/tv-data',
      },
      env_production: {
        NODE_ENV: 'production',
        DISABLE_INTERNAL_CORS: '1',
        TV_DATA_DIR: '/root/dev/apps/tv-data',
      },
    },
    {
      name: 'tv-down',
      cwd: appCwd('down'),
      script: 'src/main.js',
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: 'production',
        TV_DATA_DIR: '/root/dev/apps/tv-data',
      },
      env_production: {
        NODE_ENV: 'production',
        TV_DATA_DIR: '/root/dev/apps/tv-data',
      },
    },
    {
      name: 'tv-srvr',
      cwd: appCwd('srvr'),
      script: 'index.js',
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: 'production',
        TV_DATA_DIR: '/root/dev/apps/tv-data',
      },
      env_production: {
        NODE_ENV: 'production',
        TV_DATA_DIR: '/root/dev/apps/tv-data',
      },
    },
  ],
};
