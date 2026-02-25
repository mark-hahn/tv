const path = require("path");
const fs = require("fs");
const os = require("os");

// PM2 config for the dev environment.
// Runs alongside prod (tv-api, tv-srvr, tv-down) on different ports.
// Deploy with: ./srvr  (TV_REMOTE_BASE defaults to /root/dev/apps/tv-dev)
//
// Port mapping (dev vs prod):
//   tv-api-dev  : 3002  (prod: 3001)
//   tv-down-dev : 3004  (prod: 3003)
//   tv-srvr-dev : HTTP 8747, WS 8746  (prod: 8737, 8736)

const root = __dirname;

function resolveNodeInterpreter() {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  let version = null;
  try {
    version = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  } catch {
    version = null;
  }
  if (!version) return "node";
  const nodePath = path.join(
    nvmDir,
    "versions",
    "node",
    version,
    "bin",
    "node",
  );
  if (fs.existsSync(nodePath)) return nodePath;
  return "node";
}

const nodeInterpreter = resolveNodeInterpreter();

function appCwd(name) {
  return path.join(root, "apps", name);
}

module.exports = {
  apps: [
    {
      name: "tv-api-dev",
      cwd: appCwd("api"),
      script: "xvfb-run",
      args: ["-a", nodeInterpreter, "src/server.js"],
      interpreter: "none",
      time: true,
      env: {
        NODE_ENV: "production",
        DISABLE_INTERNAL_CORS: "1",
      },
    },
    {
      name: "tv-down-dev",
      cwd: appCwd("down"),
      script: "src/main.js",
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tv-srvr-dev",
      cwd: appCwd("srvr"),
      script: "index.js",
      interpreter: nodeInterpreter,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
