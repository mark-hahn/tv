// Route HTTP requests through the USB server via SSH exec (no port binding).
// Each request runs `ssh USB_SSH_TARGET curl ...` on the remote API server,
// so the outbound connection originates from the USB server's IP.

import { spawn } from "child_process";

const USB_SSH_TARGET = "xobtlu@xobtlu.baron.usbx.me";

// Connection multiplexing: a full SSH handshake to the USB server costs ~2s,
// and a provider search does one exec per result page, so without a shared
// master connection the handshakes dominate the search time. The master is
// kept alive between searches (each search runs in its own forked worker), so
// every page after the first reuses it for ~0.3s instead of ~2s.
const SSH_CONTROL_PATH = "/tmp/tv-api-sshtun-%r@%h:%p";
const SSH_CONTROL_PERSIST = "10m";

function shellEsc(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/**
 * Fetch a URL by running curl on the USB server via SSH exec.
 * Returns { ok, code, stdout (Buffer), stderr (Buffer), error? }
 * Same interface as the local curlFetchBinary result.
 */
export async function sshCurlFetch(
  targetUrl,
  { headers = {}, cookieHeader = "" } = {},
) {
  // Percent-encode non-ASCII characters (e.g. Cyrillic) in the URL so curl
  // receives a valid ASCII URL. new URL().href handles this automatically.
  let safeUrl = targetUrl;
  try {
    safeUrl = new URL(targetUrl).href;
  } catch {
    // malformed URL — pass as-is and let curl fail
  }

  // --fail makes curl exit 22 on HTTP >= 400 so error pages don't parse as
  // success (the error body is suppressed; stderr carries the status line).
  const args = [
    "-sS",
    "--fail",
    "-L",
    "--globoff",
    "--compressed",
    "--max-time",
    "60",
  ];

  for (const [k, v] of Object.entries(headers || {})) {
    if (!k) continue;
    const kl = String(k).toLowerCase();
    // Move Cookie header to -b so curl handles it correctly
    if (kl === "cookie") {
      const cv = String(v || "").trim();
      if (cv) cookieHeader = cookieHeader ? `${cookieHeader}; ${cv}` : cv;
      continue;
    }
    if (v == null || String(v).length === 0) continue;
    args.push("-H", `${k}: ${v}`);
  }

  if (cookieHeader) {
    args.push("-b", cookieHeader);
  }

  args.push(safeUrl);

  const curlCmd = "curl " + args.map(shellEsc).join(" ");

  return await new Promise((resolve) => {
    const child = spawn("ssh", [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=30",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ControlMaster=auto",
      "-o",
      `ControlPath=${SSH_CONTROL_PATH}`,
      "-o",
      `ControlPersist=${SSH_CONTROL_PERSIST}`,
      USB_SSH_TARGET,
      curlCmd,
    ]);

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr.on("data", (d) => stderrChunks.push(Buffer.from(d)));

    child.on("error", (err) => {
      resolve({
        ok: false,
        code: -1,
        error: err?.message || String(err),
        stdout: Buffer.alloc(0),
        stderr: Buffer.concat(stderrChunks),
      });
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

/**
 * Patch a torrent-search-api TorrentProvider instance so its HTTP requests
 * go through the USB server via SSH exec instead of direct from hahnca.com.
 *
 * Must be called after each enableProvider() call (including re-enable on
 * removeProvider + loadProvider + enableProvider flows).
 */
export function patchProviderWithSshTunnel(provider) {
  if (!provider) return;

  provider.request = async function sshPatchedRequest(
    url,
    options = {},
    _body = null,
    ensureLogin = true,
  ) {
    if (ensureLogin) {
      await provider.ensureLogin();
    }

    const urlStr = String(url || "");

    // Extract cookies from the provider's cookie jar
    let cookieHeader = "";
    try {
      const jar = provider.cookieJar;
      if (typeof jar.getCookieString === "function") {
        // tough-cookie jars return a Promise here; request jars are sync.
        let cs = jar.getCookieString(urlStr);
        if (cs && typeof cs.then === "function") cs = await cs;
        cookieHeader = String(cs || "");
      } else if (typeof jar.getCookies === "function") {
        const cookies = jar.getCookies(urlStr) || [];
        if (Array.isArray(cookies)) {
          cookieHeader = cookies
            .map((c) => `${c.key || c.name}=${c.value}`)
            .join("; ");
        }
      }
    } catch {
      // ignore jar errors
    }

    const headers = Object.assign(
      {},
      provider.headers || {},
      options.headers || {},
    );

    const result = await sshCurlFetch(urlStr, { headers, cookieHeader });

    if (!result.ok) {
      const stderr = result.stderr.toString("utf8").slice(0, 300);
      throw new Error(
        `SSH tunnel curl failed for ${urlStr} (exit ${result.code}): ${stderr}`,
      );
    }

    return result.stdout.toString("utf8");
  };
}
