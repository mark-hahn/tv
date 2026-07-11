import fs from "fs";
import fsp from "fs/promises";
import * as path from "node:path";
import date from "date-and-time";
import { SRVR_MISC_DIR } from "./srvrPaths.js";
import { unilog } from "@tv/share";

const LOG_APPS_SRVR_DATA_MISC_SRVR_LOG = false;

const SRVR_LOG_PATH = path.join(SRVR_MISC_DIR, "srvr.log");

try {
  fs.mkdirSync(SRVR_MISC_DIR, { recursive: true });
} catch {}

export const jParse = (str, label) => {
  let obj;
  try {
    obj = JSON.parse(str);
  } catch (e) {
    unilog(785, `JSON parse error${label ? " at " + label : ""}, ${e.message}`);
    return null;
  }
  return obj;
};

// Convert an ISO/UTC date string to PST YYYY-MM-DD HH:mm:ss
export function toPstDateTime(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d)) return null;
  const datePart = d.toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles",
    hour12: false,
  });
  return datePart + " " + timePart;
}

// Get current date/time in PST timezone as YYYY-MM-DD HH:mm:ss string
export function getPstDate() {
  const d = new Date();
  const date = d.toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles",
    hour12: false,
  });
  return date + " " + time;
}

let lastMsg = null;
let repeatCount = 0;
export const log = (msg, err = false, spacing = false) => {
  if (msg == lastMsg) {
    repeatCount++;
    return;
  }
  lastMsg = msg;
  // https://github.com/knowledgecode/date-and-time
  msg =
    date.format(new Date(), "MM/DD HH:mm:ss ") +
    (repeatCount ? ("" + repeatCount).padStart(4, " ") : "    ") +
    " " +
    msg;
  if (err) unilog(786, msg);
  else unilog(787, msg);
  if (LOG_APPS_SRVR_DATA_MISC_SRVR_LOG)
    try {
      if (spacing) fs.appendFileSync(SRVR_LOG_PATH, "\n");
      fs.appendFileSync(SRVR_LOG_PATH, msg + "\n");
    } catch {}
  repeatCount = 0;
};

let busyByPath = {};
let dataByPath = {};
let waitersByPath = {};

const chkWriteFile = async () => {
  for (let path in dataByPath) {
    if (busyByPath[path]) continue;
    busyByPath[path] = true;
    // Snapshot the pending value and its waiters before writing. A newer
    // value queued during the write stays in dataByPath (with its own
    // waiters) and is written by the re-scan below — it must never be
    // dropped by this write's cleanup.
    const pending = dataByPath[path];
    const waiters = waitersByPath[path] || [];
    waitersByPath[path] = [];
    let data = pending;
    if (typeof data != "string") data = JSON.stringify(data);
    // Atomic write: write to a temp file in the same directory, then rename.
    // fs.rename() on Linux is a single syscall — if the process is killed
    // mid-write the original file is untouched.
    const tmpPath = path + ".tmp";
    try {
      await fsp.writeFile(tmpPath, data);
      await fsp.rename(tmpPath, path);
      if (dataByPath[path] === pending) delete dataByPath[path];
      waiters.forEach((w) => w.resolve());
    } catch (e) {
      unilog(131, `writeFile failed for ${path}: ${e.message}`);
      fsp.unlink(tmpPath).catch(() => {});
      if (dataByPath[path] === pending) delete dataByPath[path];
      // Die fast: a failed write must not look like a success to callers.
      waiters.forEach((w) => w.reject(e));
    } finally {
      busyByPath[path] = false;
    }
  }
  // Re-scan for values queued while a write was in flight. Only recurse when
  // there is a non-busy entry this pass can process (a busy entry belongs to
  // another in-flight pass, which will do its own re-scan).
  if (Object.keys(dataByPath).some((p) => !busyByPath[p])) {
    await chkWriteFile();
  }
};

export const writeFile = (path, data) => {
  dataByPath[path] = data;
  if (!waitersByPath[path]) waitersByPath[path] = [];
  const promise = new Promise((resolve, reject) => {
    waitersByPath[path].push({ resolve, reject });
  });
  chkWriteFile();
  return promise;
};

export function getLog(module) {
  const timers = Object.create(null);

  const start = function (name, hide = false, msg = "") {
    timers[name] = Date.now();
    if (hide) return;
    const line = `[${module}]: ${name} started${msg ? ", " + msg : ""}`;
    unilog(788, line);
  };

  const end = function (name, onlySlow = false, msg = "") {
    if (!timers[name]) {
      const line = `[${module}]: ${name} ended${msg ? ", " + msg : ""}`;
      unilog(789, line);
      return;
    }
    const duration = Date.now() - timers[name];
    if (onlySlow && duration < 100) return;
    const line = `[${module}]: ${name} ended, ${duration}ms${msg ? ", " + msg : ""}`;
    unilog(790, line);
  };

  const log = function (...args) {
    let errFlag = false;
    let errMsgFlag = false;
    let nomodFlag = false;
    let notimeFlag = false;

    if (typeof args[0] === "string") {
      errFlag = args[0].includes("err");
      nomodFlag = args[0].includes("nomod");
      notimeFlag = args[0].includes("notime");
      errMsgFlag = args[0].includes("errmsg");
    }

    if (errFlag || nomodFlag || notimeFlag || errMsgFlag) args = args.slice(1);

    let errMsg;
    if (errMsgFlag) {
      errMsg = args[0]?.message + " -> ";
      args = args.slice(1);
      errFlag = true;
    }

    const par = args.map((a) => {
      if (typeof a === "object" && a !== null) {
        try {
          return JSON.stringify(a, null, 2);
        } catch (e) {
          return (
            JSON.stringify(Object.keys(a)) + (e && e.message ? e.message : "")
          );
        }
      } else {
        return a;
      }
    });

    const line =
      (nomodFlag ? "" : "[" + module + "] ") +
      (errFlag ? " error, " : "") +
      (errMsg != null ? errMsg : "") +
      par.join(" ");

    // Temporary: trace calls that produce empty error lines
    if (errFlag && par.length === 0) {
      const stack = new Error().stack.split("\n").slice(1, 6).join(" | ");
      unilog(791, line + " [TRACE] " + stack);
    } else if (errFlag) unilog(792, line);
    else unilog(793, line);
  };

  return { log, start, end };
}
