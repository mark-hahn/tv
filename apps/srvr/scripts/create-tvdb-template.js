import fs from "fs";
import path from "node:path";
import fetch from "node-fetch";
import { SRVR_DATA_DIR } from "../src/srvrPaths.js";

const TVDB_APIKEY = "d7fa8c90-36e3-4335-a7c0-6cbb7b0320df";
const TVDB_PIN = "HXEVSDFF";
const TEMPLATE_PATH = path.join(SRVR_DATA_DIR, "tvdbTemplate.json");

const TEST_SHOWS = [
  "30 Rock",
  "The Bear",
  "Black Mirror",
  "Breaking Bad",
  "Family Guy",
  "The Golden Girls",
  "Only Murders in the Building",
];

async function getToken() {
  const res = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: TVDB_APIKEY, pin: TVDB_PIN }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TVDB login failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const token = json?.data?.token;
  if (!token) throw new Error("TVDB login failed: missing token");
  return token;
}

async function searchShow(token, showName) {
  const url = `https://api4.thetvdb.com/v4/search?type=series&query=${encodeURIComponent(showName)}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Search failed for ${showName}: ${res.status}`);
  }

  const json = await res.json();
  const data = json?.data;
  if (!data || data.length === 0) {
    throw new Error(`No results for ${showName}`);
  }

  return data[0].tvdb_id;
}

async function getExtendedData(token, tvdbId) {
  const url = `https://api4.thetvdb.com/v4/series/${tvdbId}/extended`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Extended fetch failed for ${tvdbId}: ${res.status}`);
  }

  const json = await res.json();
  return json?.data;
}

function collectKeys(obj, prefix = "") {
  const keys = new Set();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.add(fullKey);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nestedKeys = collectKeys(value, fullKey);
      nestedKeys.forEach((k) => keys.add(k));
    } else if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object"
    ) {
      const nestedKeys = collectKeys(value[0], fullKey);
      nestedKeys.forEach((k) => keys.add(k));
    }
  }

  return keys;
}

async function main() {
  console.log("Creating TVDB template from API data...");

  const token = await getToken();
  console.log("Got TVDB token");

  const allKeys = new Set();

  for (const showName of TEST_SHOWS) {
    try {
      console.log(`\nFetching: ${showName}`);
      const tvdbId = await searchShow(token, showName);
      console.log(`  TVDB ID: ${tvdbId}`);

      const data = await getExtendedData(token, tvdbId);
      console.log(`  Got extended data`);

      const keys = collectKeys(data);
      console.log(`  Found ${keys.size} properties`);

      keys.forEach((k) => allKeys.add(k));
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  const sortedKeys = Array.from(allKeys).sort();

  console.log(`\n\nTotal unique properties: ${sortedKeys.length}`);
  console.log(`Writing to: ${TEMPLATE_PATH}`);

  fs.mkdirSync(path.dirname(TEMPLATE_PATH), { recursive: true });
  fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(sortedKeys, null, 2), "utf8");

  console.log("Done!");
  console.log("\nSample properties:");
  sortedKeys.slice(0, 20).forEach((k) => console.log(`  - ${k}`));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
