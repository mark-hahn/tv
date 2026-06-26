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
