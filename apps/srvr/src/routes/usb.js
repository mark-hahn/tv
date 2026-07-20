// Usb server inspection routes. Currently one endpoint: per-day counts of the
// top-level entries in the usb server's ~/files, used by the client Plot pane
// ("Shows" plot).

import { execFile } from "child_process";
import { logHere, unilog} from "@tv/share"

const USB_HOST = "xobtlu@xobtlu.baron.usbx.me";
const USB_FILES_DIR = "~/files";
const SSH_TIMEOUT_MS = 30000;

const sshExec = (host, remoteCmd, timeoutMs = SSH_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const args = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      host,
      remoteCmd,
    ];
    execFile(
      "ssh",
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve(String(stdout || ""));
      },
    );
  });

// Epoch seconds -> "yyyy/mm/dd" in PST LA.
function pstDay(epochSec) {
  return new Date(epochSec * 1000)
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
}

export function registerUsbRoutes(app) {
  // Mod-date counts of top-level files/folders in the usb server's ~/files.
  app.get("/api/usb/file-days", async (req, res) => {
    try {
      const cmd = `find ${USB_FILES_DIR} -maxdepth 1 -mindepth 1 -printf '%T@\\n'`;
      const stdout = await sshExec(USB_HOST, cmd);
      const counts = new Map();
      for (const line of stdout.split(/\r?\n/)) {
        const epoch = Number(line.trim());
        if (!epoch) continue;
        const day = pstDay(epoch);
        counts.set(day, (counts.get(day) || 0) + 1);
      }
      const days = [...counts.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day));
      res.json({ days });
    } catch (e) {
      unilog(1582, `usb file-days scan failed: ${e.message}${e.stderr ? ` ${e.stderr}` : ""}`);
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
