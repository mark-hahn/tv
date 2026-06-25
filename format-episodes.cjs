const fs = require("fs");
const path = require("path");

const filePath = path.join("/root/apps/tv/temp.json");

try {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(fileContent);

  // Recursive function to process values
  function processValue(key, value) {
    if (Array.isArray(value)) {
      // Only process arrays if we are inside 'episodeData'
      if (key === "episodeData" || this.inEpisodeData) {
        const isInnermost = value.every((subItem) => !Array.isArray(subItem));
        if (isInnermost) {
          // It's an innermost array within the target scope.
          // Use a placeholder for single-line formatting later.
          return `%%PLACEHOLDER_${JSON.stringify(value)}%%`;
        } else {
          // It's an outer array, recurse on its items.
          // We pass the context `inEpisodeData` to the next level.
          const context = { inEpisodeData: true };
          return value.map((item) => processValue.call(context, null, item));
        }
      }
    }

    // Recurse into objects to find 'episodeData'
    if (typeof value === "object" && value !== null) {
      const newObj = {};
      for (const objKey in value) {
        newObj[objKey] = processValue.call(this, objKey, value[objKey]);
      }
      return newObj;
    }

    // Return primitives as is
    return value;
  }

  // Start processing from the root of the data
  const processedData = processValue(null, data);

  // Stringify the structure with placeholders
  let jsonString = JSON.stringify(processedData, null, 2);

  // Replace placeholders with the actual single-line array strings
  jsonString = jsonString.replace(/"%%PLACEHOLDER_(.*?)%%"/g, (match, p1) => {
    return p1.replace(/\\"/g, '"');
  });

  fs.writeFileSync(filePath, jsonString, "utf-8");
  console.log(
    "Successfully formatted innermost arrays within episodeData in temp.json.",
  );
} catch (error) {
  console.error("Error processing file:", error);
}
