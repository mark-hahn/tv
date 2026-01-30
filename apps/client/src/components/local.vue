<template>
  <div
    id="local"
    :style="{
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: '#fafafa',
    }"
  >
    <div
      id="localFiles"
      :style="{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flex: showSubs ? '0 0 50%' : '1 1 auto',
        borderBottom: showSubs ? '1px solid #ddd' : 'none',
      }"
    >
      <!-- Header -->
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
        padding: '8px',
        borderBottom: '1px solid #ddd',
        flex: '0 0 auto',
      }"
    >
      <div style="font-weight: bold; margin-right: auto">Local files</div>

      <span
        v-if="loading"
        style="color: lightgray; margin-right: 10px; font-weight: bold"
        >&lt;Loading...&gt;</span
      >

      <button
        @click="toShow"
        title="Select show matching selected folder"
        style="
          cursor: pointer;
          border-radius: 7px;
          padding: 4px 10px;
          border: 1px solid #bbb;
          background-color: whitesmoke;
          margin-right: 10px;
        "
      >
        To show
      </button>

      <button
        @click="selectTopLevel"
        title="Find folder matching current show"
        style="
          cursor: pointer;
          border-radius: 7px;
          padding: 4px 10px;
          border: 1px solid #bbb;
          background-color: whitesmoke;
          margin-right: 10px;
        "
      >
        From show
      </button>

      <button
        @click="toggleSubs"
        :style="{
          cursor: 'pointer',
          borderRadius: '7px',
          padding: '4px 10px',
          border: '1px solid #bbb',
          backgroundColor: showSubs ? '#ddd' : 'whitesmoke',
          marginRight: '10px',
        }"
      >
        Subs
      </button>

      <button
        @click="deleteSelected"
        :disabled="loading || (!selectedName && selectedFiles.size === 0)"
        title="Delete selected files"
        style="
          cursor: pointer;
          border-radius: 7px;
          padding: 4px 10px;
          border: 1px solid #bbb;
          background-color: whitesmoke;
          margin-right: 10px;
        "
      >
        Delete
      </button>

      <button
        @click="refresh"
        :disabled="loading"
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
        :node="node"
        :ref="(el) => setNodeRef(el, node.name)"
        :selected="selectedName === node.name"
        :selected-files="selectedFiles"
        @node-click="handleNodeClick"
      />
    </div>
    </div>

    <!-- Subs Pane -->
    <div
      id="localSubs"
      v-if="showSubs"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
      }"
    >
      <div
        style="
          display: flex;
          align-items: center;
          padding: 8px;
          border-bottom: 1px solid #ddd;
          flex: 0 0 auto;
        "
      >
        <div style="font-weight: bold; margin-right: auto">
          Subs files
          <span
            v-if="currentShowName"
            style="font-weight: normal; font-size: 0.9em; color: #666"
            >({{ currentShowName }})</span
          >
        </div>
        <div style="display: flex; gap: 8px">
          <button
            @click="openLibrary"
            style="
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Library
          </button>
          <button
            @click="applySubs"
            :disabled="applyInProgress || selectedSubKeys.size === 0"
            style="
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Apply
          </button>
        </div>
      </div>

      <div style="flex: 1 1 auto; overflow: auto; padding: 10px">
        <div v-if="subsLoading">Loading...</div>
        <div v-if="subsError" style="color: red">{{ subsError }}</div>
        <template v-for="item in subsItems" :key="item.key">
          <div
            @click="handleSubClick($event, item)"
            :style="getSubCardStyle(item)"
            @mouseenter="
              $event.currentTarget.style.boxShadow =
                '0 2px 8px rgba(0,0,0,0.15)'
            "
            @mouseleave="$event.currentTarget.style.boxShadow = 'none'"
          >
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                font-size: 12px;
                color: #333;
              "
            >
              <div
                :style="{
                  fontWeight: 'bold',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  color: item?.lineColor || '#333',
                }"
              >
                {{ item?.line1 || '' }}
              </div>
              <div
                style="
                  color: #666;
                  white-space: nowrap;
                  min-width: 0;
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  justify-content: flex-end;
                "
              >
                <div
                  style="
                    width: 100px;
                    min-width: 100px;
                    max-width: 100px;
                    text-align: center;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  "
                >
                  {{ item?.uploader || '' }}
                </div>
              </div>
            </div>
            <div
              v-if="item.line2"
              style="
                font-size: 11px;
                color: #666;
                margin-top: 2px;
                white-space: pre-wrap;
                font-family: monospace;
                overflow: hidden;
                text-overflow: ellipsis;
              "
            >
              {{ item.line2 }}
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import TreeNode from "./tree-node.vue";
import { config } from "../config.js";
import {
  deletePath,
  subsSearch,
  applySubFiles,
  getSubFileIds,
} from "../srvr.js";
import evtBus from "../evtBus.js";
import * as util from "../util.js";
import parseTorrentTitle from "parse-torrent-title";

export default {
  name: "Local",
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

      // Subs pane state
      showSubs: false,
      subsItems: [],
      subsLoading: false,
      subsError: null,
      hasSearchedSubs: false,
      selectedSubKeys: new Set(),
      lastClickedSubKey: null,
      applyInProgress: false,
      applyFailures: [],
      showApplyFailuresModal: false,
      totalSubsCount: 0,
      validSubsCount: 0,
      currentShowName: "",
    };
  },
  created() {
    this.nodeRefs = new Map();
  },
  beforeUpdate() {
    this.nodeRefs.clear();
  },
  watch: {
    show(val) {
      console.log("Local: show prop changed:", val ? val.Name : "null");
    },
    active(val) {
      if (val && !this.hasLoaded && !this.loading) {
        this.fetchFiles();
      }
    },
  },
  mounted() {
    if (this.active && !this.hasLoaded) {
      this.fetchFiles();
    }
  },
  methods: {
    async fetchFiles() {
      this.loading = true;
      this.error = null;
      try {
        const url = `${config.torrentsApiUrl}/api/local/files`;
        const res = await fetch(url);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const rootTree = await res.json();
        this.tree = this.processTree(rootTree);
        this.hasLoaded = true;
      } catch (e) {
        this.error = e.message || "Failed to load files";
      } finally {
        this.loading = false;
      }
    },
    processTree(nodes) {
      if (!nodes) return [];

      // Sort nodes first.
      // - If nodes match "Season X", use numeric sort (S1 < S2 < S10).
      // - Otherwise use standard ASCII sort (30 Rock < 3rd Rock).
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
        // Fallback to standard sort (case insensitive? or just standard?)
        // User wants "30 Rock" < "3rd Rock" which suggests standard string comparison or ASCII.
        // localeCompare usually handles this "correctly" for languages, but let's check ASCII specific cases.
        // In ASCII '0' < 'r', so "30 Rock" comes before "3rd Rock".
        // localeCompare generally respects this.
        return a.name.localeCompare(b.name, undefined, { numeric: false });
      });

      nodes.forEach((n) => {
        if (n.children) n.children = this.processTree(n.children);
      });

      // For "Season X" folders, we re-structure children into groups (thirds)
      // Check if current level is inside a "Season X" or if we are iterating "Season X" folders?
      // Wait, the logic is: "in local pane file list inside every folder named 'Season <season number>' sort the files..."
      // So if *we* (the list of nodes `nodes`) are children of a Season X folder...
      // But we don't know who our parent is here easily unless we pass ctx.
      // Alternatively, we look for folders named "Season ..." and process THEIR children.

      // Actually, standard iteration:
      // If `n` is a folder and its name matches "Season \d+", then process `n.children`.
      return nodes.map((node) => {
        if (node.type === "folder" && /^Season \d+$/i.test(node.name)) {
          // Re-sort children
          // Split into video, srt, other.
          const videos = [];
          const subs = [];
          const others = [];

          const VIDEO_EXTS = new Set([
            "mkv",
            "avi",
            "mp4",
            "m4v",
            "mov",
            "wmv",
            "webm",
            "mpg",
            "mpeg",
            "ts",
            "m2ts",
          ]);

          const getExt = (name) => {
            const s = String(name || "");
            const i = s.lastIndexOf(".");
            if (i < 0) return "";
            return s.slice(i + 1).toLowerCase();
          };

          const isVideo = (name) => VIDEO_EXTS.has(getExt(name));
          const isSrt = (name) => getExt(name) === "srt";

          // Current children might already be sorted by name/type from server.
          // We group files. Keep folders at top? The requirement says "file list inside..."
          // Assuming children are mix of files and folders (though usually Season folders just contain files)
          // Let's separate folders out first? Or treat them as "others"?
          // Typically "Others" implies files.
          // Let's assume we keep folders at the very top (standard), then grouped files.

          const folders = (node.children || []).filter(
            (c) => c.type === "folder",
          );
          const files = (node.children || []).filter((c) => c.type === "file");

          for (const f of files) {
            if (isVideo(f.name)) videos.push(f);
            else if (isSrt(f.name)) subs.push(f);
            else others.push(f);
          }

          // Insert separators.
          // How to representation separators in `tree-node`?
          // We can add a dummy node with type="separator". We need to update tree-node to render it.

          const newChildren = [...folders];
          if (videos.length) {
            newChildren.push(...videos);
          }
          if (subs.length) {
            if (newChildren.length)
              newChildren.push({ type: "separator", name: "sep1" });
            newChildren.push(...subs);
          }
          if (others.length) {
            if (newChildren.length)
              newChildren.push({ type: "separator", name: "sep2" });
            newChildren.push(...others);
          }
          node.children = newChildren;
        }
        return node;
      });
    },
    setNodeRef(el, name) {
      if (el) this.nodeRefs.set(name, el);
    },
    toShow() {
      // 1. Determine selected top-level folder
      let folderName = this.selectedName;
      if (!folderName && this.selectedFiles.size > 0) {
        // Assume first file's root
        const path = [...this.selectedFiles][0];
        if (path) {
          const parts = path.split("/");
          if (parts.length > 0) folderName = parts[0];
        }
      }

      if (!folderName) {
        alert("Please select a file or folder first.");
        return;
      }

      if (!this.allShows || !this.allShows.length) {
        console.warn("No shows loaded.");
        return;
      }

      // 2. Find matching show
      let match = this.allShows.find((s) => s.Name === folderName);
      if (!match) {
        const lower = folderName.toLowerCase();
        match = this.allShows.find((s) => s.Name.toLowerCase() === lower);
      }

      if (match) {
        this.$emit("select-show", match.Name);
      } else {
        alert(`No show found matching folder "${folderName}"`);
      }
    },
    async selectTopLevel() {
      // 1. Get current show name
      const showName = this.show ? this.show.Name : null;
      console.log("Local.vue selectTopLevel", {
        showProp: this.show,
        showName,
      });
      if (!showName) {
        // Fallback or ignore if no show selected
        console.log("No current show selected.");
        return;
      }

      // 2. Find matching top-level folder
      let folderName = null;
      if (this.tree && this.tree.length) {
        const exact = this.tree.find((n) => n.name === showName);
        if (exact) {
          folderName = exact.name;
        } else {
          const lower = showName.toLowerCase();
          const ci = this.tree.find((n) => n.name.toLowerCase() === lower);
          if (ci) folderName = ci.name;
        }
      }

      if (!folderName) {
        console.log(`Folder "${showName}" not found in tree.`);
        return;
      }

      const nodeIndex = this.tree.findIndex((n) => n.name === folderName);
      if (nodeIndex === -1) {
        console.log(`Folder "${folderName}" not found in tree.`);
        return;
      }
      const node = this.tree[nodeIndex];

      // 4. Select and expand
      this.selectedName = node.name;
      this.selectedFiles.clear();
      this.selectionParentPath = null;
      this.lastSelectedFile = null;

      // 5. Expand target & Collapse others
      this.nodeRefs.forEach((cmp, name) => {
        if (name !== folderName) {
          if (typeof cmp.collapse === "function") {
            cmp.collapse();
          }
        } else {
          if (typeof cmp.expand === "function") {
            cmp.expand();
          }
        }
      });

      // 6. Wait for DOM updates (collapsing) then Scroll
      this.$nextTick(() => {
        const cmp = this.nodeRefs.get(folderName);
        if (cmp && cmp.$el) {
          cmp.$el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    },
    countRecursive(node) {
      if (!node) return 0;
      if (node.type === "file") return 1;
      if (node.children) {
        return node.children.reduce(
          (acc, c) => acc + this.countRecursive(c),
          0,
        );
      }
      return 0;
    },
    findNodeByPath(relPath) {
      if (!relPath) return null;
      const parts = relPath.split("/");
      let current = this.tree;
      let node = null;
      for (const part of parts) {
        if (!current) return null;
        node = current.find((n) => n.name === part);
        if (!node) return null;
        current = node.children;
      }
      return node;
    },
    async deleteSelected() {
      if (!this.selectedName && this.selectedFiles.size === 0) return;

      let fileCount = 0;
      let pathsToDelete = [];

      if (this.selectedName) {
        // Top level folder deletion
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (node) {
          fileCount = this.countRecursive(node);
          pathsToDelete.push(this.selectedName);
        }
      } else {
        // Selected files/folders
        for (const relPath of this.selectedFiles) {
          const node = this.findNodeByPath(relPath);
          if (node) {
            fileCount += this.countRecursive(node);
          } else {
            // If strictly not found, assume 1 (maybe a loose file?) or 0.
            // But if it's in selectedFiles it should be in the tree presumably.
            // Fallback to 1 just to be safe in count logic.
            fileCount += 1;
          }
          pathsToDelete.push(relPath);
        }
      }

      const itemLabel = pathsToDelete.length === 1 ? "item" : "items";
      const fileLabel = fileCount === 1 ? "file" : "files";
      const confirmMsg = `Are you sure you want to delete ${pathsToDelete.length} ${itemLabel} containing ${fileCount} ${fileLabel}?\nThis cannot be undone.`;

      if (!confirm(confirmMsg)) return;

      this.loading = true;
      try {
        const root = "/mnt/media/tv";
        for (const relPath of pathsToDelete) {
          const fullPath = `${root}/${relPath}`;
          await deletePath(fullPath);
        }

        this.selectedFiles.clear();
        this.selectedName = null; // Clear top level selection too
        this.selectionParentPath = null;
        this.lastSelectedFile = null;
        await this.refresh();
      } catch (e) {
        console.error("Error deleting files:", e);
        alert(`Error deleting files: ${e.message}`);
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },
    refresh() {
      return this.fetchFiles();
    },
    handleNodeClick({ node, depth, fullPath, ctrlKey, shiftKey }) {
      // 1. Top-level folder selection
      if (depth === 0) {
        // If clicking top-level folder, clear any file selection context
        this.selectedFiles.clear();
        this.selectionParentPath = null;
        if (ctrlKey && this.selectedName === node.name) {
          this.selectedName = null;
        } else {
          this.selectedName = node.name;
        }
        this.lastSelectedFile = null;
        return;
      }

      // 2. File OR Folder selection
      // Allow selecting nested folders too
      if (node.type === "file" || node.type === "folder") {
        const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"));

        // If switching folders, or if a top-level folder was previously selected, reset.
        if (this.selectedName) {
          this.selectedName = null;
        }

        if (
          this.selectionParentPath &&
          this.selectionParentPath !== parentPath &&
          !this.selectedFiles.has(fullPath)
        ) {
          this.selectedFiles.clear();
          this.selectionParentPath = null;
        }

        if (!this.selectionParentPath) {
          this.selectionParentPath = parentPath;
        }

        if (
          shiftKey &&
          this.lastSelectedFile &&
          this.selectionParentPath === parentPath
        ) {
          // Handle range selection
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
    // Subtitles logic
    toggleSubs() {
      this.showSubs = !this.showSubs;
      if (this.showSubs) {
        this.loadSubs();
      }
    },
    async loadSubs() {
      // 1. Determine Identity (Show Name + Season)
      let showName = this.selectedName;
      let season = null;

      if (!showName && this.selectedFiles.size > 0) {
        // derive from first file
        const path = [...this.selectedFiles][0];
        const parts = path.split("/");
        if (parts.length > 0) showName = parts[0];
        // check for season in path
        for (const p of parts) {
          const m = /^Season\s*(\d+)$/i.exec(p);
          if (m) {
            season = parseInt(m[1], 10);
            break;
          }
        }
      }

      this.currentShowName = showName || "";
      this.subsItems = [];
      this.subsError = null;

      if (!showName) {
        this.subsError = "No show selected (folder or files).";
        return;
      }

      // 2. Find matching show to get IMDb ID
      const match = (this.allShows || []).find((s) => s.Name === showName) || (this.allShows || []).find((s) => s.Name.toLowerCase() === showName.toLowerCase());
      
      if (!match) {
        this.subsError = `Show "${showName}" not found in library.`;
        return;
      }

      const imdb =
        match.ProviderIds?.Imdb ||
        match.ProviderIds?.imdb ||
        match.ProviderIds?.IMDb ||
        match.ProviderIds?.IMDB;
      
      if (!imdb) {
        this.subsError = "Show has no IMDb ID.";
        return;
      }

      const raw = String(imdb).trim();
      const digits = raw.toLowerCase().startsWith("tt") ? raw.slice(2) : raw;
      const imdbIdDigits = digits.replace(/\D/g, "").replace(/^0+/, ""); // Normalize

       this.subsLoading = true;
       try {
           const params = { imdb_id: imdbIdDigits, page: 1 };
           if (season !== null) params.season = season;

           const res = await subsSearch(params);
           
           // Process results similar to subs.vue
           // Filter for language 'en', type 'subtitle', feature_type 'Tvshow'|'Episode'
           const data = Array.isArray(res?.data) ? res.data : [];
           const filtered = data.filter((d) => {
              if (!d || typeof d !== "object") return false;
              if (d.type !== "subtitle") return false;
              if (d.attributes?.language !== "en") return false;
              const ft = d.attributes?.feature_details?.feature_type;
              if (ft !== "Tvshow" && ft !== "Episode") return false;
              return true;
           });

           this.subsItems = filtered.map(entry => {
               const release = entry.attributes?.release || "";
               const uploader = entry.attributes?.uploader?.name || "anonymous";
               const { season, episode } = this.parseSeasonEpisodeFromEntry(entry);
                const sStr = season != null ? String(season).padStart(2, "0") : "??";
                const eStr = episode != null ? String(episode).padStart(2, "0") : "??";
                const line1 = release ? `S${sStr}E${eStr} | ${release}` : `S${sStr}E${eStr}`;
                
                return {
                    key: entry.id,
                    line1,
                    line2: "", // Simplification
                    uploader,
                    season,
                    episode,
                    raw: entry
                };
           });
           
           if (!this.subsItems.length) {
               this.subsError = "No subtitles found.";
           }

       } catch (e) {
           this.subsError = e.message || "Error searching subs";
       } finally {
           this.subsLoading = false;
       }
    },
    parseSeasonEpisodeFromEntry(entry) {
        let bestSeason = null;
        let bestEpisode = null;
        
        const tryParse = (txt) => {
            if (!txt) return;
            try {
                const p = parseTorrentTitle.parse(txt);
                if (p.season != null) bestSeason = p.season;
                if (p.episode != null) bestEpisode = p.episode;
            } catch(e) {}
             
             // Fallback regex if library fails or returns nothing useful
            if (bestSeason == null || bestEpisode == null) {
                let m = txt.match(/S(\d{1,2})E(\d{1,2})/i);
                if (m) {
                    if (bestSeason == null) bestSeason = parseInt(m[1]);
                    if (bestEpisode == null) bestEpisode = parseInt(m[2]);
                }
            }
        };

        tryParse(entry.attributes?.release);
        if (bestSeason == null || bestEpisode == null) {
             // Try filename if available
             const files = entry.attributes?.files || [];
             if (files.length > 0) tryParse(files[0].file_name);
        }

        return { season: bestSeason, episode: bestEpisode };
    },
    getSubCardStyle(item) {
        const isSelected = this.selectedSubKeys.has(item.key);
        return {
            padding: "8px",
            background: isSelected ? "#fffacd" : "#fff",
            borderRadius: "5px",
            border: "1px solid #ddd",
            cursor: "pointer",
            marginBottom: "4px",
            userSelect: "none"
        };
    },
    handleSubClick(event, item) {
        const key = item.key;
        const isCtrl = !!(event.ctrlKey || event.metaKey);
        const isShift = !!event.shiftKey;

        if (isShift && this.lastClickedSubKey) {
            // Range select (simplified: index based)
            const idx1 = this.subsItems.findIndex(i => i.key === this.lastClickedSubKey);
            const idx2 = this.subsItems.findIndex(i => i.key === key);
            if (idx1 !== -1 && idx2 !== -1) {
                const s = Math.min(idx1, idx2);
                const e = Math.max(idx1, idx2);
                const range = this.subsItems.slice(s, e + 1);
                range.forEach(i => this.selectedSubKeys.add(i.key));
            }
        } else if (isCtrl) {
            if (this.selectedSubKeys.has(key)) this.selectedSubKeys.delete(key);
            else this.selectedSubKeys.add(key);
        } else {
            this.selectedSubKeys.clear();
            this.selectedSubKeys.add(key);
        }
        this.lastClickedSubKey = key;
    },
    openLibrary() {
        evtBus.emit("startLibraryRefresh");
    },
    async applySubs() {
         if (this.applyInProgress) return;
         if (this.selectedSubKeys.size === 0) return;
         
         this.applyInProgress = true;
         // build payload
         // Needed: [{ file_id, showName, season, episode }]
         // We have file_id inside item.raw.attributes.files? Or is key the file_id?
         // In subs.vue, item.key is not always file_id. OpenSubtitles entries have multiple files sometimes.
         // subs.vue logic uses `buildFileIdObjsPayload`. It looks at `validEntries`.
         // `subsSearch` returns groupings. `files` attribute contains file_ids.
         
         // Simplified: Pick the first file of the selected subtitle entry.
         const payload = [];
         
         for (const key of this.selectedSubKeys) {
             const item = this.subsItems.find(i => i.key === key);
             if (!item) continue;
             const entry = item.raw;
             const files = entry.attributes?.files || [];
             if (!files.length) continue;
             const fileId = files[0].file_id;
             if (!fileId) continue;
             
             payload.push({
                 file_id: Number(fileId),
                 showName: this.currentShowName,
                 season: item.season,
                 episode: item.episode
             });
         }
         
         if (!payload.length) {
             alert("No valid files found in selection");
             this.applyInProgress = false;
             return;
         }

         try {
             const res = await applySubFiles(payload);
              if (res && res.error) {
                 alert("Error applying subs: " + res.error);
             } else {
                 alert("Subs applied successfully");
             }
         } catch (e) {
             alert("Error applying subs: " + e.message);
         } finally {
             this.applyInProgress = false;
         }
    },
  },
};
</script>
