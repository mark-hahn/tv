// The TVDB login token, shared by everything in tv-srvr that talks to TVDB.
const TVDB_APIKEY = "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df";
const TVDB_PIN = "HXEVSDFF";
const TOKEN_LIFE_MS = 20 * 60 * 60 * 1000;

let cachedToken = null;
let cachedAtMs = 0;

export async function getToken() {
  const now = Date.now();
  if (cachedToken && now - cachedAtMs < TOKEN_LIFE_MS) return cachedToken;

  const res = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: TVDB_APIKEY, pin: TVDB_PIN }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `TVDB login failed: ${res.status} ${text?.slice(0, 200) || ""}`.trim(),
    );
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const token = json?.data?.token;
  if (!token) throw new Error("TVDB login failed: missing token");
  cachedToken = token;
  cachedAtMs = now;
  return token;
}

// A 401 means the token went stale early; the next getToken logs in again.
export function clearToken() {
  cachedToken = null;
}
