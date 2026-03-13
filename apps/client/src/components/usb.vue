<template>
  <div
    id="usb"
    :style="{
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: '#fafafa',
    }"
  >
    <!-- Header -->
    <div
      :style="{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: '8px',
        borderBottom: '1px solid #ddd',
        flex: '0 0 auto',
      }"
    >
      <div style="display: flex; align-items: center">
        <div
          class="pane-header-title"
          style="
            margin-right: auto;
            display: flex;
            align-items: center;
            gap: 12px;
          "
        >
          <span>USB Files</span>
        </div>

        <input
          v-model="searchInput"
          @keyup.enter="searchUsb"
          placeholder="Search"
          style="width: 100px; margin-right: 8px"
        />

        <input
          v-model="renameInput"
          @focus="onRenameFocus"
          @keyup.enter="renameFile"
          placeholder="Rename"
          style="width: 100px; margin-right: 8px"
        />

        <button
          @click.stop="highlightShow"
          :disabled="!show"
          style="
            cursor: pointer;
            border-radius: 7px;
            padding: 4px 10px;
            border: 1px solid #bbb;
            background-color: whitesmoke;
            margin-right: 8px;
          "
        >
          From show
        </button>

        <button
          @click="forceDown"
          :disabled="loading || (!selectedName && selectedFiles.size === 0)"
          style="
            cursor: pointer;
            border-radius: 7px;
            padding: 4px 10px;
            border: 1px solid #bbb;
            background-color: whitesmoke;
            margin-right: 8px;
          "
        >
          Force Down
        </button>

        <button
          @click="prune"
          :disabled="loading || pruneBusy"
          :style="{
            cursor: loading || pruneBusy ? 'default' : 'pointer',
            borderRadius: '7px',
            padding: '4px 10px',
            border: '1px solid #bbb',
            backgroundColor: pruneBusy ? 'lightgray' : 'whitesmoke',
            marginRight: '8px',
          }"
        >
          Prune
        </button>

        <button
          @click="refresh"
          :disabled="loading || pruneBusy"
          style="
            cursor: pointer;
            border-radius: 7px;
            padding: 4px 10px;
            border: 1px solid #bbb;
            background-color: whitesmoke;
          "
        >
          Refresh
        </button>
      </div>

      <div
        v-if="showPruneLine && pruneLineText"
        style="
          margin-top: 6px;
          display: flex;
          align-items: center;
          font-weight: normal;
          color: #666;
          font-size: 13px;
        "
      >
        <span
          style="
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-right: auto;
          "
          >{{ pruneLineText }}</span
        >
        <button
          @click="clearPruneLine"
          style="
            cursor: pointer;
            border-radius: 7px;
            padding: 2px 8px;
            border: 1px solid #bbb;
            background-color: whitesmoke;
            margin-left: 8px;
          "
        >
          Clr
        </button>
      </div>
    </div>

    <!-- Tree -->
    <div
      :style="{
        flex: '1 1 auto',
        overflow: 'auto',
        padding: '0px 8px',
      }"
    >
      <div
        v-if="error"
        style="color: red; margin: 10px 0"
      >
        {{ error }}
      </div>
      <tree-node
        v-for="node in tree"
        :key="node.name"
        ref="treeNodes"
        :node="node"
        :selected="selectedName === node.name"
        :selected-files="selectedFiles"
        @node-click="handleNodeClick"
      />
    </div>
  </div>
</template>

<script>
import parseTorrentTitle from "parse-torrent-title";
import TreeNode from "./tree-node.vue";
import { config } from "../config.js";
import evtBus from "../evtBus.js";
import * as util from "../util.js";
import {
  smartTitleMatch,
  parseFileSeasonEpisode,
  parseTitleFromFilename,
} from "../util.js";

export default {
  name: "Usb",
  components: { TreeNode },
  props: {
    active: Boolean,
    show: Object,
    allShows: Array,
  },
  data() {
    return {
      tree: [],
      selectedName: null, // For top-level folder selection
      selectedFiles: new Set(), // For file selection inside a folder
      selectionParentPath: null, // To enforce "same folder" rule
      lastSelectedFile: null, // For check-range logic
      loading: false,
      error: null,
      hasLoaded: false,
      renameInput: "",
      searchInput: "",
      usbAvailGb: "---",
      usbAvailPct: "--%",
      pruneBusy: false,
      pruneLiveLine: "",
      pruneSummaryLine: "",
      showPruneLine: false,
      _prunePollTimer: null,
    };
  },
  computed: {
    pruneLineText() {
      if (this.pruneBusy) return this.pruneLiveLine || "Pruning...";
      return this.pruneSummaryLine || "";
    },
  },
  watch: {
    show: {
      immediate: true,
      handler(val) {},
    },
    active: {
      immediate: true,
      handler(val) {
        if (val && !this.hasLoaded && !this.loading) {
          this.fetchFiles();
        }
      },
    },
  },
  mounted() {
    if (this.active && !this.hasLoaded) {
      this.fetchFiles();
    }
    this.updateUsbSpaceAvail();
    this.fetchPruneStatus();
  },
  unmounted() {
    this.stopPrunePolling();
  },
  methods: {
    clearPruneLine() {
      this.showPruneLine = false;
      this.pruneLiveLine = "";
      this.pruneSummaryLine = "";
    },
    startPrunePolling() {
      if (this._prunePollTimer) return;
      this._prunePollTimer = setInterval(() => {
        void this.fetchPruneStatus();
      }, 400);
    },
    stopPrunePolling() {
      if (this._prunePollTimer) {
        clearInterval(this._prunePollTimer);
        this._prunePollTimer = null;
      }
    },
    async fetchPruneStatus() {
      try {
        const url = `${config.torrentsApiUrl}/api/usb/prune/status`;
        const res = await fetch(url);
        if (!res.ok) return;
        const status = await res.json();
        const latest = String(status?.latestLogLine || "").trim();
        const summary = String(status?.summaryLine || "").trim();
        const running = status?.running === true;
        const phase = String(status?.phase || "").trim();

        if (running && phase === "delete" && latest) {
          this.pruneLiveLine = latest;
          this.showPruneLine = true;
        }

        if (running && phase !== "delete") {
          this.showPruneLine = false;
          this.pruneLiveLine = "";
        }

        if (!running) {
          if (summary) {
            this.pruneSummaryLine = summary;
            this.showPruneLine = true;
          }
          if (!this.pruneBusy) {
            this.stopPrunePolling();
          }
        }
      } catch {
        // Keep current line unchanged.
      }
    },
    pctAvail(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "--%";
      const avail = Math.max(0, t - u);
      const pct = Math.floor((avail / t) * 100);
      return `${Math.max(0, Math.min(100, pct))}%`;
    },
    fmtAvailGb(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "---";
      const avail = Math.max(0, t - u);
      return String(Math.round(avail / 1_024_000_000));
    },
    async updateUsbSpaceAvail() {
      try {
        const url = `${config.torrentsApiUrl}/api/space/avail`;
        const res = await fetch(url);
        if (!res.ok) return;
        const s = await res.json();
        if (
          Number.isFinite(Number(s?.usbSpaceTotal)) &&
          Number.isFinite(Number(s?.usbSpaceUsed))
        ) {
          this.usbAvailPct = this.pctAvail(s.usbSpaceTotal, s.usbSpaceUsed);
          this.usbAvailGb = this.fmtAvailGb(s.usbSpaceTotal, s.usbSpaceUsed);
        }
      } catch {
        // Keep last shown values.
      }
    },
    async prune() {
      if (this.loading || this.pruneBusy) return;
      this.pruneBusy = true;
      this.error = null;
      this.showPruneLine = false;
      this.pruneSummaryLine = "";
      this.pruneLiveLine = "";
      this.startPrunePolling();
      try {
        const url = `${config.torrentsApiUrl}/api/usb/prune`;
        const res = await fetch(url, { method: "POST" });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const result = await res.json();
        if (
          Number.isFinite(Number(result?.usbSpaceTotal)) &&
          Number.isFinite(Number(result?.usbSpaceUsedAfter))
        ) {
          this.usbAvailPct = this.pctAvail(
            result.usbSpaceTotal,
            result.usbSpaceUsedAfter,
          );
          this.usbAvailGb = this.fmtAvailGb(
            result.usbSpaceTotal,
            result.usbSpaceUsedAfter,
          );
        }
        await this.fetchPruneStatus();
      } catch (e) {
        this.error = e?.message || "Prune failed";
        this.pruneSummaryLine = this.error;
        this.showPruneLine = true;
      } finally {
        this.pruneBusy = false;
        await this.fetchPruneStatus();
        this.stopPrunePolling();
      }
    },
    onRenameFocus() {
      // If input is not empty, assume user is editing and don't overwrite
      if (this.renameInput) return;

      if (this.selectedFiles.size === 1) {
        // Get the single file path
        const fullPath = Array.from(this.selectedFiles)[0];
        // Extract filename
        const parts = fullPath.split("/");
        const fileName = parts.pop();
        this.renameInput = fileName;
      }
    },
    async renameFile() {
      if (!this.renameInput) return;
      if (this.selectedFiles.size !== 1) return;

      const oldPath = Array.from(this.selectedFiles)[0];
      const newName = this.renameInput.trim();

      if (!newName) return;
      // No change check
      const parts = oldPath.split("/");
      const oldName = parts[parts.length - 1];
      if (oldName === newName) return;

      this.loading = true;
      try {
        const url = `${config.torrentsApiUrl}/api/usb/rename`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath, newName }),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt);
        }

        this.renameInput = "";
        this.selectedFiles.clear();
        this.lastSelectedFile = null;
        await this.fetchFiles();
      } catch (e) {
        console.error("Rename failed", e);
        this.error = e.message || "Rename failed";
        this.loading = false; // ensure loading is off on error
      }
      // fetchFiles sets loading=false in its finally block, but if we await it, it should correspond.
      // But fetchFiles sets loading=true at start.
      // Let's rely on fetchFiles for loading state clears?
      // Wait, fetchFiles sets loading=true then finally loading=false.
      // If rename works, we await fetchFiles().
      // If fetchFiles fails, it catches its own error and sets this.error.
    },

    searchUsb() {
      const raw = this.searchInput.trim();
      if (!raw) return;
      const norm = raw
        .replace(/[^a-zA-Z\s]/g, "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
      if (!norm) return;

      for (const node of this.tree) {
        const nodeName = (node.name || "")
          .replace(/[^a-zA-Z\s]/g, "")
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ");
        if (!nodeName.includes(norm)) continue;

        this.selectedName = node.name;
        this.selectedFiles.clear();
        this.renameInput = "";
        this.selectionParentPath = null;
        this.lastSelectedFile = null;

        this.$nextTick(() => {
          if (this.$refs.treeNodes) {
            const comp = this.$refs.treeNodes.find((c) => {
              const n = c.node || c.$props?.node;
              return n && n.name === node.name;
            });
            if (comp && comp.$el) {
              comp.$el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
        });
        return;
      }
    },

    highlightShow() {
      const targetShow = this.show;
      if (!targetShow) return;

      const candidates = [targetShow];
      let bestMatch = null;
      let parser = null;

      // Resolve parser once
      try {
        if (typeof parseTorrentTitle === "function") {
          parser = parseTorrentTitle;
        } else if (
          parseTorrentTitle &&
          typeof parseTorrentTitle.parse === "function"
        ) {
          parser = parseTorrentTitle.parse;
        } else if (
          parseTorrentTitle &&
          parseTorrentTitle.default &&
          typeof parseTorrentTitle.default.parse === "function"
        ) {
          parser = parseTorrentTitle.default.parse;
        }
        // console.log("usb: parser resolved:", !!parser);
      } catch (e) {
        console.error("usb: parser resolution error:", e);
      }

      const allMatches = [];
      for (const node of this.tree) {
        const rawTitle = node.name || "";
        if (!rawTitle) continue;

        let parsed = null;
        try {
          // If parser is available, use it
          if (parser) {
            parsed = parser(rawTitle);
          }
        } catch (e) {
          // console.error("usb: parsing error for", rawTitle, e);
        }

        const searchTitle = parsed?.title || rawTitle;
        const searchYear = parsed?.year || null;

        // Import Scanning: forceChoice = false
        const match = util.smartTitleMatch(
          searchTitle,
          candidates,
          searchYear,
          false,
        );
        if (match) {
          allMatches.push(node);
        }
      }

      if (allMatches.length > 0) {
        // Determine the next match to select
        let nextIndex = 0;
        if (this.selectedName) {
          const currentIndex = allMatches.findIndex(
            (m) => m.name === this.selectedName,
          );
          if (currentIndex !== -1) {
            if (currentIndex === allMatches.length - 1) {
              return;
            }
            nextIndex = currentIndex + 1;
          }
        }
        bestMatch = allMatches[nextIndex];

        this.selectedName = bestMatch.name;
        this.selectedFiles.clear();
        this.renameInput = "";
        this.selectionParentPath = null;
        this.lastSelectedFile = null;

        this.$nextTick(() => {
          if (this.$refs.treeNodes) {
            const comp = this.$refs.treeNodes.find((c) => {
              // Access prop 'node' on component instance.
              // In Vue 3 Options API Proxy, properties are usually available directly.
              // Or via $props.
              const n = c.node || c.$props?.node;
              return n && n.name === bestMatch.name;
            });

            if (comp && comp.$el) {
              comp.$el.scrollIntoView({ behavior: "smooth", block: "center" });
            } else {
              console.warn("usb: could not find component ref for match");
            }
          } else {
            console.warn("usb: refs.treeNodes is missing");
          }
        });
      }
    },
    async fetchFiles() {
      // If we have a selected show but no tree, we should fetch.
      // Or if active.
      if (!this.active && !this.show) return;

      this.loading = true;
      this.error = null;
      try {
        console.log("usb: fetchFiles start");
        const url = `${config.torrentsApiUrl}/api/usb/files`;
        const res = await fetch(url);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const rootTree = await res.json();
        this.tree = this.processTree(rootTree);
        this.hasLoaded = true;
        await this.updateUsbSpaceAvail();

        if (this.show && !this.selectedName) {
          this.$nextTick(() => {
            this.highlightShow();
          });
        }
      } catch (e) {
        this.error = e.message || "Failed to load files";
      } finally {
        this.loading = false;
      }
    },
    processTree(nodes, parentFolderName = "") {
      if (!nodes) return [];

      // Sort nodes first.
      nodes.sort((a, b) => {
        // Group folders before files
        const aIsFolder =
          a.type === "folder" || (a.children && a.children.length > 0);
        const bIsFolder =
          b.type === "folder" || (b.children && b.children.length > 0);
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;

        const seasonRegex = /^Season \s*(\d+)$/i;
        const ma = seasonRegex.exec(a.name);
        const mb = seasonRegex.exec(b.name);

        if (ma && mb) {
          const na = parseInt(ma[1], 10);
          const nb = parseInt(mb[1], 10);
          return na - nb;
        }

        return a.name.localeCompare(b.name, undefined, { numeric: false });
      });

      nodes.forEach((n) => {
        if (n.children) {
          n.children = this.processTree(n.children, n.name);
        } else if (n.type === "file") {
          n.parseError =
            this.computeFileError(n.name, parentFolderName) || null;
        }
      });
      return nodes;
    },
    computeFileError(fname, folderName) {
      const videoExts = new Set([
        "mkv",
        "mp4",
        "avi",
        "mov",
        "wmv",
        "m4v",
        "mpg",
        "mpeg",
        "ts",
      ]);
      const ext = (fname.split(".").pop() || "").toLowerCase();
      if (!videoExts.has(ext)) return null;

      // Resolve the ptt parser defensively (Vite may expose it as an object)
      let _pttParser = null;
      try {
        if (typeof parseTorrentTitle === "function") {
          _pttParser = parseTorrentTitle;
        } else if (
          parseTorrentTitle &&
          typeof parseTorrentTitle.parse === "function"
        ) {
          _pttParser = parseTorrentTitle.parse;
        } else if (
          parseTorrentTitle?.default &&
          typeof parseTorrentTitle.default.parse === "function"
        ) {
          _pttParser = parseTorrentTitle.default.parse;
        }
      } catch (e) {}

      let parsedPtt = {};
      try {
        if (_pttParser) parsedPtt = _pttParser(fname) || {};
      } catch (e) {}

      let parsedFolder = {};
      try {
        if (_pttParser && folderName)
          parsedFolder = _pttParser(folderName) || {};
      } catch (e) {}

      const title = parseTitleFromFilename(fname, folderName, parsedPtt);
      const se = parseFileSeasonEpisode(
        fname,
        folderName,
        parsedPtt,
        parsedFolder,
      );
      const season = se && se.season != null ? se.season : null;
      const episode = se && se.episode != null ? se.episode : null;

      if (!title && !folderName) return "no title";
      if (!Number.isInteger(season)) return "no season";
      if (!Number.isInteger(episode)) return "no episode";
      return null;
    },
    refresh() {
      this.fetchFiles();
    },
    handleNodeClick({ node, depth, fullPath, ctrlKey, shiftKey }) {
      // 1. Top-level folder selection
      if (depth === 0) {
        // If clicking top-level folder, clear any file selection context
        this.selectedFiles.clear();
        this.renameInput = "";
        this.selectionParentPath = null;
        if (ctrlKey && this.selectedName === node.name) {
          this.selectedName = null;
        } else {
          this.selectedName = node.name;
        }
        this.lastSelectedFile = null;
        return;
      }

      // 2. File selection
      if (node.type === "file" || node.type === "folder") {
        const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
        this.renameInput = "";

        // If switching folders, or if a top-level folder was previously selected, reset.
        // Also if we have existing file selection but in a DIFFERENT parent, reset?
        // User requirements: "when files inside folder are selected do not allow any files outside of that folder ... to be selected"

        if (this.selectedName) {
          // Clearing top-level highlight because we are now selecting files
          this.selectedName = null;
        }

        if (
          this.selectionParentPath &&
          this.selectionParentPath !== parentPath
        ) {
          // We are in a different folder.
          // If user tries to add to selection (ctrl/shift), we must block or reset.
          // Prompt says "do not allow". We'll treat it as a reset (switch context).
          this.selectedFiles.clear();
          this.selectionParentPath = null;
          // Fall through to treat as new selection
        }

        // Set the context if not set
        if (!this.selectionParentPath) {
          this.selectionParentPath = parentPath;
        }

        if (
          shiftKey &&
          this.lastSelectedFile &&
          this.selectionParentPath === parentPath
        ) {
          // Handle range selection
          // We need to find the list of siblings to determine range.
          // This is tricky without reference to the parent's children array.
          // But we can traverse `this.tree` to find the parent node.
          const siblings = this.getSiblings(this.selectionParentPath);
          if (siblings) {
            const idx1 = siblings.findIndex(
              (n) => this.getPath(parentPath, n.name) === this.lastSelectedFile,
            );
            const idx2 = siblings.findIndex((n) => n.name === node.name);

            if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2);
              const end = Math.max(idx1, idx2);
              const range = siblings.slice(start, end + 1);

              // Add all into selection
              for (const s of range) {
                if (s.type === "file" || s.type === "folder") {
                  this.selectedFiles.add(this.getPath(parentPath, s.name));
                }
              }
            }
          }
        } else if (ctrlKey) {
          // Toggle
          if (this.selectedFiles.has(fullPath)) {
            this.selectedFiles.delete(fullPath);
            if (this.selectedFiles.size === 0) {
              this.selectionParentPath = null;
            }
          } else {
            this.selectedFiles.add(fullPath);
          }
          this.lastSelectedFile = fullPath;
        } else {
          // Single select
          this.selectedFiles.clear();
          this.selectedFiles.add(fullPath);
          this.selectionParentPath = parentPath;
          this.lastSelectedFile = fullPath;
        }
      }
    },
    getPath(parent, name) {
      return parent ? `${parent}/${name}` : name;
    },
    getSiblings(parentPath) {
      // Traverse tree to find the array of children for this path
      // parentPath e.g. "ShowName/Season 1"
      if (!parentPath) return []; // Should not happen for files inside folder
      const parts = parentPath.split("/");
      // First part is top level
      let current = this.tree.find((n) => n.name === parts[0]);
      if (!current) return [];

      for (let i = 1; i < parts.length; i++) {
        if (!current.children) return [];
        current = current.children.find((n) => n.name === parts[i]);
        if (!current) return [];
      }
      return current.children || [];
    },
    collectFiles(node, currentPath) {
      if (node.type === "file") {
        // Format as YYYY-MM-DD-Path-Size
        // Ensure date exists, otherwise fallback to generic/current?
        // Apps/down expects a date, so let's default if missing (though it shouldn't be).
        const date = node.date || util.getPstDate();
        const size = node.size || 0;
        return [`${date}-${currentPath}-${size}`];
      }
      if (node.children) {
        return node.children.flatMap((child) =>
          this.collectFiles(child, currentPath + "/" + child.name),
        );
      }
      return [];
    },
    async forceDown() {
      if (!this.selectedName && this.selectedFiles.size === 0) return;

      let files = [];
      let label = "";

      if (this.selectedName) {
        // Whole top-level folder selected
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (!node) return;
        files = this.collectFiles(node, node.name);
        label = `'${node.name}'`;
      } else {
        // Top level folders don't have parentPath/siblings logic here easily,
        // but if selectionParentPath is null, we can check root tree?
        // Actually, selectionParentPath is set when individual files/subfolders are selected.

        // Individual files OR subfolders selected
        // We need to construct the file entries manually.
        // We know they are all in this.selectionParentPath
        // And we have the full paths in this.selectedFiles
        // We need the date/size info though, which is in the node objects.

        // Problem: getSiblings(selectionParentPath) just gets the immediate children.
        // If we selected a file deep inside, selectionParentPath is its parent folder.
        // That works.

        const parentPath = this.selectionParentPath;
        const siblings = this.getSiblings(parentPath);

        files = [];
        for (const fileFullPath of this.selectedFiles) {
          const fileName = fileFullPath.split("/").pop();
          const node = siblings.find((n) => n.name === fileName);
          if (node) {
            // If it's a file, add it directly.
            // If it's a folder, recurse and add all its contents.
            const date = node.date || util.getPstDate();
            const size = node.size || 0;

            if (node.type === "file") {
              files.push(`${date}-${fileFullPath}-${size}`);
            } else if (node.type === "folder") {
              // Recurse
              const childFiles = this.collectFiles(node, fileFullPath);
              files.push(...childFiles);
            }
          }
        }
        label = `${files.length} selected files`;
      }

      if (files.length === 0) {
        alert("No files found to download.");
        return;
      }

      // Filter out files the server would skip (same logic as checkFile in main.js).
      const shouldSkipExt = (ext) =>
        ext.length === 6 ||
        ext === "nfo" ||
        ext === "idx" ||
        ext === "sub" ||
        ext === "txt" ||
        ext === "jpg" ||
        ext === "gif" ||
        ext === "jpeg" ||
        ext === "part";
      const skippedFiles = files.filter((fe) => {
        const fn =
          fe.split("-").slice(0, -1).join("-").slice(11).split("/").pop() || "";
        return shouldSkipExt((fn.split(".").pop() || "").toLowerCase());
      });
      files = files.filter((fe) => {
        const fn =
          fe.split("-").slice(0, -1).join("-").slice(11).split("/").pop() || "";
        return !shouldSkipExt((fn.split(".").pop() || "").toLowerCase());
      });
      if (skippedFiles.length > 0) {
        const skippedNames = skippedFiles.map((fe) =>
          fe.split("-").slice(0, -1).join("-").slice(11).split("/").pop(),
        );
        alert("These files ignored:\n\n" + skippedNames.join("\n"));
      }
      if (files.length === 0) return;

      // Validate each file can be parsed (title + season + episode).
      const parseErrors = [];
      for (const fileEntry of files) {
        const parts = fileEntry.split("-");
        parts.pop(); // remove size
        const filePath = parts.join("-").slice(11); // strip YYYY-MM-DD-
        const pathParts = filePath.split("/");
        const fname = pathParts[pathParts.length - 1];
        const folderName =
          pathParts.length >= 2 ? pathParts[pathParts.length - 2] : "";
        const err = this.computeFileError(fname, folderName);
        if (err) parseErrors.push(`${fname} (${err})`);
      }
      if (parseErrors.length > 0) {
        alert(
          "Cannot force download — parse error:\n\n" + parseErrors.join("\n"),
        );
        return;
      }

      // Emby check: all files must belong to a show that is in Emby.
      if (Array.isArray(this.allShows) && this.allShows.length > 0) {
        const embyShows = this.allShows
          .filter((s) => s && s.inEmby)
          .map((s) => s.Name || s.name)
          .filter(Boolean);
        const notInEmby = [];
        for (const fileEntry of files) {
          const parts2 = fileEntry.split("-");
          parts2.pop();
          const filePath2 = parts2.join("-").slice(11);
          const pathParts2 = filePath2.split("/");
          const fname2 = pathParts2[pathParts2.length - 1];
          const folderName2 =
            pathParts2.length >= 2 ? pathParts2[pathParts2.length - 2] : "";

          let parsedPtt2 = {};
          try {
            if (typeof parseTorrentTitle === "function")
              parsedPtt2 = parseTorrentTitle(fname2) || {};
            else if (parseTorrentTitle?.parse)
              parsedPtt2 = parseTorrentTitle.parse(fname2) || {};
          } catch (e) {}

          const title2 = parseTitleFromFilename(
            fname2,
            folderName2,
            parsedPtt2,
          );
          if (title2) {
            const match = smartTitleMatch(title2, embyShows, null, false);
            if (!match) notInEmby.push(title2);
          }
        }
        if (notInEmby.length > 0) {
          alert("Show not in emby:\n\n" + [...new Set(notInEmby)].join("\n"));
          return;
        }
      }

      if (!confirm(`Force download ${label}?`)) return;

      this.loading = true;
      try {
        const url = `${config.torrentsApiUrl}/api/tvproc/forceDown`;
        const res = await fetch(url, {
          method: "POST",
          body: JSON.stringify(files),
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const txt = await res.text();
          let msg = txt;
          try {
            msg = JSON.parse(txt).error || msg;
          } catch (e) {}
          throw new Error(msg);
        }
        // Force download started - no alert needed.
      } catch (e) {
        alert("Error: " + e.message);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
