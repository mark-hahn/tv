#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// 1. Argument Parsing
const args = process.argv.slice(2);
let jsonFile = "";
let showName = "";

if (args[0] === "-file") {
  jsonFile = args[1];
  showName = args.slice(2).join(" ");
} else {
  showName = args.join(" ");
}

if (!showName) {
  console.log("Usage: ./show.js [-file <db or json file>] <show name>");
  process.exit(1);
}

// Default to the SQLite show DB if no file specified. Relative paths are
// resolved against apps/srvr on the remote (where better-sqlite3 resolves).
if (!jsonFile) {
  jsonFile = "data/tvdb.db";
} else {
  if (!path.isAbsolute(jsonFile)) {
    jsonFile = `data/${jsonFile}`;
  }
}

const tempShowRecordPath = "/tmp/show-record.json";

// 2. SSH Command to fetch show data. A ".db" file is read from SQLite
// (table shows(name, json)); anything else is read as a legacy JSON archive.
const sshCommand = `ssh hahnca.com "cd /root/dev/apps/tv/apps/srvr && node -e \\"
  const file = process.argv[1];
  const showName = process.argv[2];
  const lower = showName.toLowerCase();
  let keys, getShow;
  if (file.endsWith('.db')) {
    const Database = require('better-sqlite3');
    const db = new Database(file, { readonly: true });
    keys = db.prepare('SELECT name FROM shows').all().map(r => r.name);
    getShow = (k) => JSON.parse(db.prepare('SELECT json FROM shows WHERE name = ?').get(k).json);
  } else {
    const fs = require('fs');
    const tvdb = JSON.parse(fs.readFileSync(file, 'utf8'));
    keys = Object.keys(tvdb);
    getShow = (k) => tvdb[k];
  }
  let matchedKey = keys.find(k => k.toLowerCase() === lower);
  if (!matchedKey) {
    const matches = keys.filter(k => k.toLowerCase().includes(lower));
    if (matches.length === 1) matchedKey = matches[0];
    else if (matches.length > 1) {
      process.stderr.write('Multiple matches for ' + showName + ':\\\\n' + matches.join('\\\\n') + '\\\\n');
      process.exit(1);
    }
  }
  if (matchedKey) {
    console.log(JSON.stringify({ key: matchedKey, show: getShow(matchedKey) }));
  } else {
    process.stderr.write('Show not found: ' + showName + '\\\\n');
    process.exit(1);
  }\\" \\"${jsonFile}\\" \\"${showName}\\""`;

exec(sshCommand, (error, stdout, stderr) => {
  if (error) {
    console.error(`Failed to fetch show '${showName}': ${stderr}`);
    process.exit(1);
  }

  fs.writeFileSync(tempShowRecordPath, stdout);

  // 3. Process the fetched data
  try {
    const { key: matchedName, show: showData } = JSON.parse(
      fs.readFileSync(tempShowRecordPath, "utf8"),
    );

    // Sort properties alphabetically
    const sortObject = (obj) => {
      if (typeof obj !== "object" || obj === null) return obj;
      if (Array.isArray(obj)) return obj.map(sortObject);
      return Object.keys(obj)
        .sort()
        .reduce((sorted, key) => {
          sorted[key] = sortObject(obj[key]);
          return sorted;
        }, {});
    };

    let finalData = { [matchedName]: sortObject(showData) };

    // 4. Integrate and apply formatting from format-episodes.cjs
    function formatEpisodeData(data) {
      function processValue(key, value) {
        if (Array.isArray(value)) {
          const inEpisodeData =
            key === "episodeData" || (this && this.inEpisodeData);
          if (inEpisodeData) {
            const isInnermost = value.every(
              (subItem) => !Array.isArray(subItem),
            );
            if (isInnermost) {
              const seasonNum =
                this && this.seasonNum !== undefined ? this.seasonNum : 0;
              const episodeNum =
                this && this.episodeNum !== undefined ? this.episodeNum : 1;
              return `%%PLACEHOLDER_S${seasonNum}_E${episodeNum}_${JSON.stringify(value)}%%`;
            } else {
              if (key === "episodeData") {
                return value.map((item, idx) => {
                  const context = { inEpisodeData: true, seasonNum: idx };
                  return processValue.call(context, null, item);
                });
              } else {
                const seasonNum =
                  this && this.seasonNum !== undefined ? this.seasonNum : 0;
                return value.map((item, idx) => {
                  const context = {
                    inEpisodeData: true,
                    seasonNum: seasonNum,
                    episodeNum: idx + 1,
                  };
                  return processValue.call(context, null, item);
                });
              }
            }
          }
        }
        if (typeof value === "object" && value !== null) {
          const newObj = {};
          for (const objKey in value) {
            newObj[objKey] = processValue.call(this, objKey, value[objKey]);
          }
          return newObj;
        }
        return value;
      }
      return processValue(null, data);
    }

    const processedData = formatEpisodeData(finalData);
    let jsonString = JSON.stringify(processedData, null, 2);

    // Replace placeholders with array content and add S/E comment
    jsonString = jsonString.replace(
      /"%%PLACEHOLDER_S(\d+)_E(\d+)_(.*?)%%"(,?)/g,
      (match, season, episode, p1, comma) => {
        const arr = p1.replace(/\\"/g, '"');
        return `${arr}${comma} // S${season} E${episode}`;
      },
    );

    // 5. Write to ./show.jsonc
    fs.writeFileSync("./show.jsonc", jsonString);
    console.log("Saved output to ./show.jsonc");

    // 6. Cleanup
    fs.unlinkSync(tempShowRecordPath);
  } catch (e) {
    console.error("Error processing show data:", e);
    process.exit(1);
  }
});
