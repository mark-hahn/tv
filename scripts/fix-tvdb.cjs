#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'data', 'tvdb-no-created.json');
const OUTPUT = path.join(__dirname, '..', 'data', 'tvdb.json');

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Input file not found:', INPUT);
    process.exitCode = 2;
    return;
  }

  const raw = fs.readFileSync(INPUT, 'utf8');
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON:', err.message);
    process.exitCode = 3;
    return;
  }

  const keys = Object.keys(obj);
  let entriesUpdated = 0;

  // Iterate top-level entries in reverse order and add dateCreated to each entry object.
  // Start with 2025-10-26 for the last entry, then decrement one day per entry as we move backward.
  let d = new Date('2025-10-22');
  for (let k = keys.length - 1; k >= 0; k--) {
    const key = keys[k];
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      val.dateCreated = isoDate(d);
      entriesUpdated++;
    } else if (Array.isArray(val)) {
      // backward-compat: if the value is actually an array of elements, handle that as before
      let arrDate = new Date('2025-10-26');
      for (let j = val.length - 1; j >= 0; j--) {
        const elem = val[j];
        if (elem === null || typeof elem !== 'object') {
          val[j] = { value: elem };
        }
        val[j].dateCreated = isoDate(arrDate);
        arrDate.setDate(arrDate.getDate() - 1);
      }
      entriesUpdated++;
    }
    // decrement the date for the next (previous) top-level entry
    d.setDate(d.getDate() - 1);
  }

  try {
  fs.writeFileSync(OUTPUT, JSON.stringify(obj, null, 2), 'utf8');
  console.log(`Wrote ${OUTPUT}`);
  console.log(`Entries processed: ${entriesUpdated}`);
  } catch (err) {
    console.error('Failed to write output file:', err.message);
    process.exitCode = 4;
  }
}

if (require.main === module) main();
