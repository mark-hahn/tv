// Shared file-tree builder for `find -printf "%y|%P|%s|<date>\n"` output.
// Used by the local (local.js) and USB (usb.js) file/movie listings.

// Parse find output lines into a nested {name, type, children, size?, date?}
// tree, then sort it: folders first, "The " prefix ignored, numeric-aware
// ordering for folders (Season 9 before Season 10).
export function buildFileTree(stdout) {
  const lines = String(stdout || "")
    .split("\n")
    .filter(Boolean);
  const tree = [];

  const findOrCreate = (list, name, type, size, date) => {
    let node = list.find((n) => n.name === name);
    if (!node) {
      node = { name, type, children: [] };
      if (type === "file") {
        node.size = size;
        node.date = date;
      }
      list.push(node);
    }
    return node;
  };

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 4) continue;
    const type = parts[0]; // f or d
    const relPath = parts[1];
    const size = parseInt(parts[2], 10) || 0;
    const date = parts[3];

    if (!relPath) continue;

    const segments = relPath.split("/");
    let currentLevel = tree;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      const segType = isLast ? (type === "d" ? "folder" : "file") : "folder";

      const node = findOrCreate(currentLevel, seg, segType, size, date);
      if (segType === "folder") {
        if (!node.children) node.children = [];
        currentLevel = node.children;
      }
    }
  }

  const sortNodes = (nodes) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      const nameA = a.name.toLowerCase().replace(/^the\s+/, "");
      const nameB = b.name.toLowerCase().replace(/^the\s+/, "");

      // Numeric-aware ordering (Season 9 before Season 10) for folders only.
      if (a.type === "folder" && b.type === "folder") {
        return nameA.localeCompare(nameB, undefined, { numeric: true });
      }
      return nameA.localeCompare(nameB);
    });
    nodes.forEach((n) => {
      if (n.children) sortNodes(n.children);
    });
  };
  sortNodes(tree);

  return tree;
}
