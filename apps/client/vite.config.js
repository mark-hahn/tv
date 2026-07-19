import { fileURLToPath, URL } from "node:url";
import fs from "node:fs";
import path from "node:path";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Terminal from "vite-plugin-terminal";

const LOG_FILE = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "vite-console.log",
);

const MAX_BYTES = 1 * 1024 * 1024; // 1 MB
const KEEP_LINES = 5000;

function pruneLog() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_BYTES) return;
    const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n");
    fs.writeFileSync(LOG_FILE, lines.slice(-KEEP_LINES).join("\n"));
  } catch (_) {}
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Dev-only endpoint behind the log viewer's Delete Sites action. Edits the
// local source tree (source of truth) by removing unilog() calls.
function unilogSitesEndpoint() {
  return {
    name: "unilog-sites-endpoint",
    configureServer(server) {
      server.middlewares.use("/__unilog", async (req, res, next) => {
        const url = req.url || "";
        const mode = url.startsWith("/delete")
          ? "delete"
          : url.startsWith("/open-editor")
            ? "open-editor"
            : null;
        if (mode === null || req.method !== "POST") return next();

        // Handle open-editor mode separately
        if (mode === "open-editor") {
          try {
            const body = await readJsonBody(req);
            const { file, line } = body;

            if (!file || line == null) {
              res.statusCode = 400;
              res.setHeader("content-type", "application/json");
              res.end(
                JSON.stringify({ ok: false, error: "Missing file or line" }),
              );
              return;
            }

            // Build absolute path
            const { spawn } = await import("node:child_process");
            const filePath = `/root/apps/tv/${file}`;

            // Use VS Code CLI: code --goto file:line
            const proc = spawn("code", ["--goto", `${filePath}:${line}`], {
              stdio: "ignore",
              detached: true,
            });

            proc.unref(); // Don't wait for VS Code to exit

            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                error: String(err?.message || err),
              }),
            );
          }
          return;
        }

        // Handle delete mode
        try {
          const body = await readJsonBody(req);
          const sites = Array.isArray(body?.sites)
            ? body.sites
            : Array.isArray(body?.ids)
              ? body.ids
              : [];
          const { deleteSites } = await import("../../unilog/delete.js");
          const { changed } = deleteSites(sites);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, changed }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({ ok: false, error: String(err?.message || err) }),
          );
        }
      });
    },
  };
}

// Dev-only endpoint reporting whether the laptop lid is closed. Asks Windows
// (from WSL) for the Active flag of every attached panel; when nothing is
// active the display is off, i.e. the lid is shut. Any failure reports
// closed:false so callers stay silent rather than guessing.
const POWERSHELL = "/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe";
const LID_QUERY =
  "(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams" +
  " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Active) -join ','";
const LID_TIMEOUT_MS = 5000;

function lidStateEndpoint() {
  return {
    name: "lid-state-endpoint",
    configureServer(server) {
      server.middlewares.use("/__lid", async (req, res, next) => {
        if (req.method !== "GET") return next();
        res.setHeader("content-type", "application/json");
        try {
          const { execFile } = await import("node:child_process");
          const stdout = await new Promise((resolve, reject) => {
            execFile(
              POWERSHELL,
              ["-NoProfile", "-NonInteractive", "-Command", LID_QUERY],
              { timeout: LID_TIMEOUT_MS },
              (err, out) => (err ? reject(err) : resolve(out)),
            );
          });
          const active = stdout
            .trim()
            .split(",")
            .map((s) => s.trim().toLowerCase());
          res.end(JSON.stringify({ closed: !active.includes("true") }));
        } catch (err) {
          res.end(
            JSON.stringify({
              closed: false,
              error: String(err?.message || err),
            }),
          );
        }
      });
    },
  };
}

function consoleToFile() {
  return {
    name: "console-to-file",
    enforce: "pre",
    configureServer(server) {
      pruneLog();
      const timer = setInterval(pruneLog, 24 * 60 * 60 * 1000);
      timer.unref();
      server.middlewares.use("/__terminal", (req, res, next) => {
        try {
          const reqUrl = req.url || "";
          const qstart = reqUrl.indexOf("?");
          const pathPart = qstart === -1 ? reqUrl : reqUrl.slice(0, qstart);
          if (qstart !== -1) {
            const params = new URLSearchParams(reqUrl.slice(qstart + 1));
            const segments = pathPart.split("/").filter(Boolean);
            const method =
              segments.length >= 2 ? segments[1] : segments[0] || "log";
            const message = params.get("m") ?? "";
            if (message) {
              const now = new Date()
                .toLocaleString("en-US", {
                  timeZone: "America/Los_Angeles",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })
                .replace(/24:(\d+):(\d+)/, "00:$1:$2");
              fs.appendFileSync(LOG_FILE, `[${now}] [${method}] ${message}\n`);
            }
          }
        } catch (_) {}
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    consoleToFile(),
    unilogSitesEndpoint(),
    lidStateEndpoint(),
    vue(),
    ...(command === "serve"
      ? [Terminal({ console: "terminal", output: ["terminal", "console"] })]
      : []),
  ],
  server: {
    fs: {
      // Allow importing prompt/key from ../api (client-only Mistral pane).
      allow: [
        // Always allow serving the client app itself.
        fileURLToPath(new URL(".", import.meta.url)),
        // Allow importing prompt/key from ../api.
        fileURLToPath(new URL("../api", import.meta.url)),
      ],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
}));
