// Guard for the routes that hand out the usb password or a login made with it
// (qbt-open, cp-token). They are on the public internet, so off the LAN the
// browser asks for that password. Any user name will do.
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";

const CRED_FILE = "/root/dev/apps/tv/apps/api/secrets/qbt-cred.txt";
const LAN_PREFIX = "192.168.1.";

const sha256 = (s) => createHash("sha256").update(s).digest();

export function usbPassOk(req, pass) {
  // nginx sets X-Real-IP itself, so a client can't fake it.
  const ip = String(req.headers["x-real-ip"] || "");
  if (ip.startsWith(LAN_PREFIX) || ip === "127.0.0.1") return true;

  const [scheme, b64] = String(req.headers.authorization || "").split(" ");
  if (scheme?.toLowerCase() !== "basic" || !b64) return false;
  const decoded = Buffer.from(b64, "base64").toString();
  const given = decoded.slice(decoded.indexOf(":") + 1);
  return timingSafeEqual(sha256(given), sha256(pass));
}

export async function requireUsbPass(req, res, next) {
  // cors() would let any website a LAN browser visits read the answer.
  res.removeHeader("Access-Control-Allow-Origin");

  let pass;
  try {
    const text = await fs.readFile(CRED_FILE, "utf8");
    pass = text.match(/^QB_PASS=(.*)$/m)?.[1];
    if (!pass) throw new Error(`no QB_PASS in ${CRED_FILE}`);
  } catch (e) {
    next(e);
    return;
  }

  if (usbPassOk(req, pass)) {
    next();
    return;
  }
  res.set("WWW-Authenticate", 'Basic realm="usb password", charset="UTF-8"');
  res.status(401).send("usb password required");
}
