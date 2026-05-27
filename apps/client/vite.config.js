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
          const qstart = req.url.indexOf("?");
          if (qstart !== -1) {
            const params = new URLSearchParams(req.url.slice(qstart + 1));
            const method = req.url.slice(1, qstart === -1 ? undefined : qstart);
            const message = params.get("m") ?? "";
            if (message) {
              const now = new Date().toLocaleString("en-US", {
                timeZone: "America/Los_Angeles",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
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
export default defineConfig({
  plugins: [consoleToFile(), vue(), Terminal({ console: "terminal" })],
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
});
