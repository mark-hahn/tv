// Run searchTorrents in a forked child process for crash isolation.
// If native code inside the worker segfaults, only the child dies;
// the API server stays alive and this function rejects with an error.

import { fork } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { unilog } from "@tv/share";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKER_PATH = path.join(__dirname, "search-worker.js");
const SEARCH_TIMEOUT_MS = 300 * 1000; // 300 seconds (providers each have 90s timeouts; more=true can do two phases)

export async function searchTorrentsInChild(params) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_PATH, [], {
      env: process.env,
      // silent: false so child stdout/stderr flows through to PM2 logs
      silent: false,
    });

    let settled = false;

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        unilog(201, "searchTorrentsInChild: worker timed out — killing");
        child.kill("SIGKILL");
        reject(
          new Error(`search timed out after ${SEARCH_TIMEOUT_MS / 1000}s`),
        );
      });
    }, SEARCH_TIMEOUT_MS);

    child.on("message", (msg) => {
      settle(() => {
        if (msg?.ok) {
          resolve(msg.result);
        } else {
          reject(new Error(msg?.error || "search worker returned error"));
        }
      });
    });

    child.on("exit", (code, signal) => {
      settle(() => {
        unilog(
          202,
          `searchTorrentsInChild: worker exited unexpectedly (code=${code}, signal=${signal})`,
        );
        reject(
          new Error(
            `search worker crashed (code=${code ?? "null"}, signal=${signal ?? "none"})`,
          ),
        );
      });
    });

    child.on("error", (err) => {
      settle(() => reject(err));
    });

    child.send(params);
  });
}
