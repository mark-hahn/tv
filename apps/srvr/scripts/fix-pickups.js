import fs from "fs";
import path from "node:path";
import { execSync } from "child_process";
import { SRVR_DATA_DIR, SRVR_ROOT_DIR } from "../src/srvrPaths.js";

const TVDB_PATH = path.join(SRVR_DATA_DIR, "tvdb.json");
const TVDB_BACKUP_PATH = path.join(SRVR_DATA_DIR, "tvdb.json.bak");
const PICKUPS_PATH = path.join(SRVR_ROOT_DIR, "config", "config4-pickups.json");

// Stop tv-srvr before modifying shared files
console.log("Stopping tv-srvr...");
try {
  execSync("pm2 stop tv-srvr", { stdio: "inherit" });
} catch {
  console.log("tv-srvr was not running");
}

const raw = fs.readFileSync(TVDB_PATH, "utf8");
const allTvdb = JSON.parse(raw);

const pickups = [];
let pickupFieldsRemoved = 0;

for (const [name, record] of Object.entries(allTvdb)) {
  if (!record || typeof record !== "object") continue;

  // Remove pickup fields from record
  if ("pickup" in record) {
    delete record.pickup;
    pickupFieldsRemoved++;
  }
  if ("Pickup" in record) {
    delete record.Pickup;
    pickupFieldsRemoved++;
  }

  // Calculate: inEmby true AND status is not "Ended" -> add to pickups
  if (record.inEmby === true && record.status !== "Ended") {
    pickups.push(record.Name || name);
  }
}

// Sort pickups ignoring leading "The "
pickups.sort((a, b) => {
  const aname = a.replace(/The\s/i, "");
  const bname = b.replace(/The\s/i, "");
  return aname.toLowerCase() > bname.toLowerCase() ? +1 : -1;
});

// Write updated tvdb.json (with pickup fields removed)
fs.writeFileSync(TVDB_PATH, JSON.stringify(allTvdb), "utf8");
fs.writeFileSync(TVDB_BACKUP_PATH, JSON.stringify(allTvdb), "utf8");
console.log(`Removed ${pickupFieldsRemoved} pickup fields from tvdb records`);

// Write pickups config
fs.writeFileSync(PICKUPS_PATH, JSON.stringify(pickups, null, 2), "utf8");
console.log(`Wrote ${pickups.length} shows to ${PICKUPS_PATH}`);

// Restart tv-srvr
console.log("Starting tv-srvr...");
try {
  execSync("pm2 start tv-srvr", { stdio: "inherit" });
} catch (err) {
  console.error("Failed to start tv-srvr:", err.message);
}

console.log("Done.");
