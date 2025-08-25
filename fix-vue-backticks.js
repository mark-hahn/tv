// fix-vue-backticks.js

// In-place rewrite of files: converts style=`...`) → style="..."),
// flattens newlines inside the style block, and collapses whitespace.
// Usage: node fix-vue-backticks.js src/components/list.vue src/components/series.vue

const fs = require("fs");
const path = require("path");

function fixStyles(text) {
  return text.replace(/style=`([\s\S]*?)`\)/g, (_, css) => {
    let clean = css.replace(/\r?\n/g, " ");   // flatten line breaks
    clean = clean.replace(/\s+/g, " ").trim(); // collapse spaces
    return `style="${clean}")`;
  });
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node fix-styles.js <file1> [file2 ...]");
  process.exit(1);
}

for (const file of files) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      console.error(`✖ Not a file: ${file}`);
      continue;
    }
    const input = fs.readFileSync(file, "utf8");
    const output = fixStyles(input);
    if (output !== input) {
      fs.writeFileSync(file, output, "utf8");
      console.log(`✔ Updated ${file}`);
    } else {
      console.log(`• No changes ${file}`);
    }
  } catch (err) {
    console.error(`✖ Error processing ${file}: ${err.message}`);
  }
}
