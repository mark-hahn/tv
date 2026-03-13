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
        flex: showSubs || showAsr ? '0 0 50%' : '1 1 auto',
        borderBottom: showSubs || showAsr ? '1px solid #ddd' : 'none',
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
        <div
          class="pane-header-title"
          style="margin-right: auto"
        >
          Local files
        </div>

        <span
          v-if="loading"
          style="color: lightgray; margin-right: 10px; font-weight: bold"
          >&lt;Loading...&gt;</span
        >

        <input
          v-model="searchInput"
          @keyup.enter="searchLocal"
          placeholder="Search"
          style="width: 100px; margin-right: 10px"
        />

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
          @click="clickAsr"
          :style="{
            cursor: 'pointer',
            borderRadius: '7px',
            padding: '4px 10px',
            border: '1px solid #bbb',
            backgroundColor: showAsr ? '#ddd' : 'whitesmoke',
            marginRight: '10px',
          }"
        >
          Asr
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

    <!-- Asr Pane -->
    <div
      id="asrPane"
      v-show="showAsr"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
        borderLeft: '1px solid #ddd',
      }"
    >
      <div
        style="
          flex: 0 0 auto;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          margin-bottom: 5px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div>
          <strong>ASR Output</strong> <span v-if="asrBusy">(Running)</span>
        </div>
        <div>
          <button
            @click="startAsr"
            :disabled="asrBusy"
            :style="{
              cursor: asrBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
              opacity: asrBusy ? 0.6 : 1,
            }"
          >
            Start
          </button>
          <button
            @click="clearAsrLog"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Clear
          </button>
          <button
            @click="killAsr"
            :disabled="!asrBusy"
            :style="{
              cursor: !asrBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              opacity: !asrBusy ? 0.6 : 1,
            }"
          >
            Kill
          </button>
        </div>
      </div>
      <div
        ref="asrScroll"
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre-wrap;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        {{ asrLogs }}
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
        <div
          class="pane-header-title"
          style="margin-right: auto"
        >
          Subs files
          <span
            v-if="currentShowName"
            style="font-weight: normal; font-size: 0.9em; color: #666"
            >({{ currentShowName }})</span
          >
        </div>
        <div style="display: flex; gap: 8px; align-items: center">
          <button
            @click="adjustOffset(-500)"
            title="-500ms"
            :disabled="_trimBusy"
            style="
              cursor: pointer;
              border-radius: 4px;
              padding: 2px 6px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
              font-weight: bold;
            "
          >
            ↓
          </button>
          <button
            @click="adjustOffset(-100)"
            title="-100ms"
            :disabled="_trimBusy"
            style="
              cursor: pointer;
              border-radius: 4px;
              padding: 2px 6px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
              font-weight: bold;
            "
          >
            ↓
          </button>
          <div style="width: 64px; text-align: center">
            {{ cumulativeTrim }} ms
          </div>
          <button
            @click="adjustOffset(100)"
            title="+100ms"
            :disabled="_trimBusy"
            style="
              cursor: pointer;
              border-radius: 4px;
              padding: 2px 6px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
              font-weight: bold;
            "
          >
            ↑
          </button>
          <button
            @click="adjustOffset(500)"
            title="+500ms"
            :disabled="_trimBusy"
            style="
              cursor: pointer;
              border-radius: 4px;
              padding: 2px 6px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
              font-weight: bold;
            "
          >
            ↑
          </button>
          <button
            @click="applySubs"
            :disabled="
              applyInProgress || Object.keys(selectedSubKeys).length === 0
            "
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
        <div
          v-if="subsError"
          style="color: red"
        >
          {{ subsError }}
        </div>
        <template
          v-for="(item, index) in subsItems"
          :key="item.key"
        >
          <div
            v-if="
              index > 0 &&
              (item.season !== subsItems[index - 1].season ||
                item.episode !== subsItems[index - 1].episode)
            "
            style="height: 1px; background-color: #000; margin: 4px 0"
          ></div>
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
                color: #000;
              "
            >
              <div
                :style="{
                  fontWeight: 'bold',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  color: '#000',
                }"
              >
                {{ item?.line1 || "" }}
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
                  {{ item?.uploader || "" }}
                </div>
                <div
                  style="
                    width: 45px;
                    min-width: 45px;
                    max-width: 45px;
                    text-align: right;
                    font-family: monospace;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  "
                >
                  {{ encodeFileIdBase32(item?.file_id) }}
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
  offsetSubFiles,
  handleAsr,
} from "../srvr.js";
import evtBus from "../evtBus.js";
import * as util from "../util.js";
import parseTorrentTitle from "parse-torrent-title";

// --- smartTitleMatch Helpers (copied from packages/share) ---

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
      searchInput: "",

      // Subs pane state
      showSubs: false,
      subsItems: [],
      subsLoading: false,
      subsError: null,
      hasSearchedSubs: false,
      selectedSubKeys: {},
      lastClickedSubKey: null,
      applyInProgress: false,
      applyFailures: [],
      showApplyFailuresModal: false,
      totalSubsCount: 0,
      validSubsCount: 0,
      currentShowName: "",

      // Offset
      cumulativeTrim: 0,
      _trimBusy: false,

      // Asr
      showAsr: false,
      asrLogs: "",
      asrBusy: false,
      activeAsrPath: null,
      ignoreLogs: false,
    };
  },
  created() {
    this.nodeRefs = new Map();
  },
  beforeUpdate() {
    this.nodeRefs.clear();
  },
  watch: {
    show(val) {},
    selectedName() {
      this.handleSelectionChanged();
    },
    selectedFiles: {
      deep: true,
      handler() {
        this.handleSelectionChanged();
      },
    },
    active(val) {
      if (val && !this.hasLoaded && !this.loading) {
        this.fetchFiles();
      }
    },
    asrLogs() {
      const el = this.$refs.asrScroll;
      if (!el) return;
      // Auto-scroll only if we are already near the bottom
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        this.$nextTick(() => {
          this.scrollToAsrBottom();
        });
      }
    },
    showAsr(val) {
      if (val) {
        this.$nextTick(() => {
          this.scrollToAsrBottom();
        });
      }
    },
  },
  mounted() {
    if (this.active && !this.hasLoaded) {
      this.fetchFiles();
    }
    evtBus.on("asr-log", this.onAsrLog);
    this.initAsrState();
  },
  unmounted() {
    evtBus.off("asr-log", this.onAsrLog);
  },
  methods: {
    scrollToAsrBottom() {
      const el = this.$refs.asrScroll;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    },
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

          const getEpisode = (name) => {
            let parsedPtt = null;
            try {
              parsedPtt = parseTorrentTitle.parse(name);
            } catch (e) {}
            const se = util.parseFileSeasonEpisode(name, "", parsedPtt, null);
            if (se && se.episode != null) return se.episode;
            return 999999;
          };

          const sortByEpisode = (a, b) => {
            const epA = getEpisode(a.name);
            const epB = getEpisode(b.name);
            if (epA !== epB) return epA - epB;
            return a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            });
          };

          const folders = (node.children || []).filter(
            (c) => c.type === "folder",
          );
          const files = (node.children || []).filter((c) => c.type === "file");

          for (const f of files) {
            if (isVideo(f.name)) videos.push(f);
            else if (isSrt(f.name)) subs.push(f);
            else others.push(f);
          }

          videos.sort(sortByEpisode);
          subs.sort(sortByEpisode);
          others.sort(sortByEpisode);

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
      // Folder -> Show: forceChoice = true
      const match = util.smartTitleMatch(
        folderName,
        this.allShows || [],
        null,
        true,
      );

      if (match) {
        this.$emit("select-show", match.Name);
      } else {
        alert(`No show found matching folder "${folderName}"`);
      }
    },
    searchLocal() {
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
        this.selectionParentPath = null;
        this.lastSelectedFile = null;

        this.$nextTick(() => {
          const cmp = this.nodeRefs.get(node.name);
          if (cmp && cmp.$el) {
            cmp.$el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        });
        return;
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
        // Show -> Folder: forceChoice = true
        const match = util.smartTitleMatch(showName, this.tree, null, true);
        if (match) folderName = match.name;
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
    clickAsr() {
      this.showAsr = !this.showAsr;
      if (this.showAsr) this.showSubs = false;
    },
    async clearAsrLog() {
      this.asrLogs = "";
      try {
        // Send a request to truncate the log file on the server
        await handleAsr({ action: "clear" });
      } catch (e) {
        console.error("Failed to clear remote log", e);
      }
    },
    async startAsr() {
      if (this.asrBusy) return;

      let startPath = null;
      if (this.selectedName) {
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (node && node.type === "folder") startPath = node.name;
      } else if (this.selectedFiles.size === 1) {
        const relPath = [...this.selectedFiles][0];
        const node = this.findNodeByPath(relPath);
        if (node && node.type === "folder") startPath = relPath;
      }

      if (!startPath) {
        if (this.activeAsrPath) startPath = this.activeAsrPath;
        else {
          this.asrLogs += "\n[Error] No folder selected to start ASR.\n";
          return;
        }
      }

      this.asrBusy = true;
      this.activeAsrPath = startPath;
      this.ignoreLogs = true;
      this.asrLogs = ""; // clear old text
      this.showAsr = true; // ensure visible
      this.showSubs = false; // close subs

      try {
        const res = await handleAsr({ action: "start", path: startPath });
        if (res && res.error) {
          this.ignoreLogs = false;
          this.asrLogs += `Start Error: ${res.error}\nStderr: ${res.stderr || ""}\n`;
          this.asrBusy = false;
          return;
        }
        if (res && res.stdout) {
          // If we attach tailing immediately, stdout from the 'start' call might duplicate
          // what the 'tail' command picks up if the process logs quickly.
          // However, start usually just returns wrapper output.
          // In the duplicate case seen, it seems we get duplicates of everything?
          // The issue is likely that 'start' returns stdout which contains the first few lines,
          // AND 'tail' picks up the same lines from the log file.
          // Let's NOT append stdout from start command to the logs pane,
          // because we are tailing the log file anyway which should contain everything.
          // this.asrLogs += res.stdout + "\n";
          console.log("ASR Start stdout:", res.stdout);
        }
        // Start tailing immediately
        this.ignoreLogs = false;
        await handleAsr({ action: "tail", path: startPath });
      } catch (e) {
        this.ignoreLogs = false;
        this.asrLogs += `Error starting ASR: ${e.message}\n`;
        this.asrBusy = false;
      }
    },
    async killAsr() {
      try {
        const res = await handleAsr({ action: "kill" });
        this.asrLogs += `\n[Kill command sent]\n`;
        if (res && res.stdout) this.asrLogs += res.stdout;
        if (res && res.stderr) this.asrLogs += res.stderr;
      } catch (e) {
        this.asrLogs += `\nError killing ASR: ${e.message}\n`;
      }
      this.asrBusy = false;
      // Keep activeAsrPath so we can restart the same job easily
      // this.activeAsrPath = null;
    },
    onAsrLog(msg) {
      if (this.ignoreLogs) return;
      if (!msg) return; // ignore empty

      const el = this.$refs.asrScroll;
      let atBottom = true;
      if (el) {
        atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      }

      this.asrLogs += msg;

      // Auto-detect running state from logs if we missed initial state
      if (msg.includes("matches (running)")) {
        // This matches 'asr is running (PID...)' from status/check
        this.asrBusy = true;
      }

      if (msg.includes("[asr] EXIT")) {
        this.asrBusy = false;
      }

      // Check for Processing line from status command
      // "Processing: /mnt/media/..."
      const match = msg.match(/^Processing: (.+)$/m);
      if (match) {
        this.activeAsrPath = match[1].trim();
      }

      if (atBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    async initAsrState() {
      try {
        // Check status. response will come via handleAsr return AND potential logs?
        // Actually handleAsr('check') calls 'status' which prints to stdout.
        // srvr/src/asr.js:check uses execFile. callback returns stdout.
        const res = await handleAsr({ action: "check" });

        if (res && res.running) {
          this.asrBusy = true;
          if (res.stdout) {
            const match = res.stdout.match(/Processing: (.+)$/m);
            if (match) {
              this.activeAsrPath = match[1].trim();
            }
          }
        } else {
          this.asrBusy = false;
        }

        // Always start tailing to get persistent log
        // This is safe even if not running; it tails the existing log file.
        // If running, it tails the live log.
        await handleAsr({ action: "tail", path: this.activeAsrPath || "" });
      } catch (e) {
        console.error("Failed to init Asr State", e);
      }
    },
    toggleSubs() {
      this.showSubs = !this.showSubs;
      if (this.showSubs) {
        this.showAsr = false;
        this.loadSubs();
      }
    },
    handleSelectionChanged() {
      if (this.showSubs) {
        if (this._subsRefreshTimer) clearTimeout(this._subsRefreshTimer);
        this._subsRefreshTimer = setTimeout(() => {
          this.loadSubs();
        }, 300);
      }
    },
    async loadSubs() {
      this.subsItems = [];
      this.subsError = null; // Don't clear error here? actually we should.
      this.currentShowName = "";

      let showName = this.selectedName;
      let targetFiles = [];

      // 1. Collect target files (as full paths so parseFile can use parent folder for season)
      const collect = (n, pathPrefix) => {
        const fullPath = pathPrefix ? `${pathPrefix}/${n.name}` : n.name;
        if (n.type === "file") targetFiles.push(fullPath);
        if (n.children) n.children.forEach((child) => collect(child, fullPath));
      };

      if (showName) {
        // Find the node in tree
        const node = this.tree.find((n) => n.name === showName);
        if (node) collect(node, null);
      } else if (this.selectedFiles.size > 0) {
        for (const path of this.selectedFiles) {
          const parts = path.split("/");
          if (!showName && parts.length > 0) showName = parts[0];

          // Use tree traversal to find files - supports recursive folder select
          let current = this.tree.find((n) => n.name === parts[0]);
          for (let i = 1; i < parts.length; i++) {
            if (current && current.children) {
              current = current.children.find((n) => n.name === parts[i]);
            } else {
              current = null;
              break;
            }
          }

          if (current)
            collect(current, parts.slice(0, parts.length - 1).join("/"));
        }
      }

      // Filter non-video files
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
      targetFiles = targetFiles.filter((name) => {
        const i = name.lastIndexOf(".");
        if (i < 0) return false;
        const ext = name.slice(i + 1).toLowerCase();
        return VIDEO_EXTS.has(ext);
      });

      this.currentShowName = showName || "";

      if (!showName) {
        this.subsError = "No show selected.";
        return;
      }

      // 2. Determine needed seasons/episodes
      const needed = new Map(); // "S:E" -> true
      const neededSeasons = new Set();
      let hasTargetFiles = targetFiles.length > 0;

      const parseFile = (fullPath) => {
        const pathParts = fullPath.split("/");
        const name = pathParts[pathParts.length - 1];
        const folderName =
          pathParts.length >= 2 ? pathParts[pathParts.length - 2] : "";

        let parsedPtt = null;
        let parsedPttFolder = null;
        try {
          parsedPtt = parseTorrentTitle.parse(name);
        } catch (ex) {}
        try {
          parsedPttFolder = parseTorrentTitle.parse(folderName);
        } catch (ex) {}

        const se = util.parseFileSeasonEpisode(
          name,
          folderName,
          parsedPtt,
          parsedPttFolder,
        );
        if (!se) return null;
        return { s: se.season, e: se.episode };
      };

      for (const f of targetFiles) {
        const se = parseFile(f);
        if (se && se.s != null && se.e != null) {
          neededSeasons.add(se.s);
          needed.set(`${se.s}:${se.e}`, true);
        }
      }

      if (needed.size === 0) {
        this.subsError = "No valid SxxExx files found in selection.";
        return;
      }

      // 3. Find matching show
      // Subtitles: forceChoice = false
      const match = util.smartTitleMatch(
        showName,
        this.allShows || [],
        null,
        false,
      );

      if (!match) {
        this.subsError = `Show "${showName}" not found in library.`;
        return;
      }

      const imdb =
        match.ProviderIds?.Imdb ||
        match.ProviderIds?.imdb ||
        match.ProviderIds?.IMDb ||
        match.ProviderIds?.IMDB ||
        match.imdbId;

      if (!imdb) {
        this.subsError = "Show has no IMDb ID.";
        return;
      }

      const raw = String(imdb).trim();
      const digits = raw.toLowerCase().startsWith("tt") ? raw.slice(2) : raw;
      const imdbIdDigits = digits.replace(/\D/g, "").replace(/^0+/, "");

      this.subsLoading = true;
      try {
        const seasonsToFetch =
          neededSeasons.size > 0 ? Array.from(neededSeasons) : [null];

        const fetchSeason = async (season) => {
          const results = [];
          let page = 1;
          let maxPages = 1;

          // Fetch pages (limit to reasonable max to prevent flooding)
          while (page <= maxPages) {
            const params = { imdb_id: imdbIdDigits, page };
            if (season !== null) params.season = season;

            let res;
            try {
              res = await subsSearch(params);
            } catch (e) {
              console.warn(
                `subsSearch failed for season ${season} page ${page}`,
                e,
              );
              break;
            }

            if (res && Array.isArray(res.data)) {
              results.push(...res.data);
            }

            if (res) {
              const tp = Number(res.total_pages);
              if (tp > 0) maxPages = tp;
              if (maxPages > 5) maxPages = 5; // Safety cap
            } else {
              break;
            }
            if (page >= maxPages) break;
            page++;
          }
          return results;
        };

        const promises = seasonsToFetch.map((s) => fetchSeason(s));
        const resultsArray = await Promise.all(promises);
        const allSubs = resultsArray.flat();

        // Filter
        const filtered = allSubs.filter((d) => {
          if (!d || typeof d !== "object") return false;
          if (d.type !== "subtitle") return false;
          if (d.attributes?.language !== "en") return false;
          const ft = d.attributes?.feature_details?.feature_type;
          return ft === "Tvshow" || ft === "Episode";
        });

        const seenIds = new Set();
        const finalItems = [];

        for (const entry of filtered) {
          if (seenIds.has(entry.id)) continue;

          const { season, episode } = this.parseSeasonEpisodeFromEntry(entry);

          const files = entry.attributes?.files || [];
          const fileId = files.length > 0 ? files[0].file_id : null;

          // Filtering Logic:
          // If we have specific needed Episodes (S:E), keep only those.
          // If we have needed Seasons but no Episodes (full season file?), keep all for that season?
          // If we had input files but couldn't parse S/E (needed empty), maybe show everything?
          // Current logic: if needed map is not empty, strict match.
          // BUT: if I have S01E01 locally, I want S01E01 subs.
          // What if subs result is a "Full Season" pack? It might not have 'episode' in attributes.
          // parseSeasonEpisodeFromEntry tries to parse release name.
          // If episode is null, it's likely a whole season pack or unparseable.
          // Users usually want per-episode subs.
          // If strict map is populated:
          if (needed.size > 0) {
            if (season != null && episode != null) {
              if (!needed.has(`${season}:${episode}`)) continue;
            } else {
              // Strict mode: skip if we can't identify the episode
              continue;
            }
          }

          seenIds.add(entry.id);

          const release = entry.attributes?.release || "";
          const uploader = entry.attributes?.uploader?.name || "anonymous";
          const sStr = season != null ? String(season).padStart(2, "0") : "??";
          const eStr =
            episode != null ? String(episode).padStart(2, "0") : "??";
          const line1 = release
            ? `S${sStr}E${eStr} | ${release}`
            : `S${sStr}E${eStr}`;

          finalItems.push({
            key: entry.id,
            line1,
            line2: "",
            uploader,
            season,
            episode,
            file_id: fileId,
            raw: entry,
          });
        }

        // Sort
        finalItems.sort((a, b) => {
          const sa = a.season || 0;
          const sb = b.season || 0;
          if (sa !== sb) return sa - sb;
          const ea = a.episode || 0;
          const eb = b.episode || 0;
          if (ea !== eb) return ea - eb;
          return 0;
        });

        this.subsItems = finalItems;

        if (!this.subsItems.length) {
          this.subsError = "No subtitles found";
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
        } catch (e) {}

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
      const isSelected = item.key in this.selectedSubKeys;
      return {
        padding: "8px",
        background: isSelected ? "#fffacd" : "#fff",
        borderRadius: "5px",
        border: "1px solid #ddd",
        cursor: "pointer",
        marginBottom: "4px",
        userSelect: "none",
      };
    },
    handleSubClick(event, item) {
      const key = item.key;
      const isCtrl = !!(event.ctrlKey || event.metaKey);
      const isShift = !!event.shiftKey;

      if (isShift && this.lastClickedSubKey) {
        // Range select (simplified: index based)
        const idx1 = this.subsItems.findIndex(
          (i) => i.key === this.lastClickedSubKey,
        );
        const idx2 = this.subsItems.findIndex((i) => i.key === key);
        if (idx1 !== -1 && idx2 !== -1) {
          const s = Math.min(idx1, idx2);
          const e = Math.max(idx1, idx2);
          const range = this.subsItems.slice(s, e + 1);
          range.forEach((i) => (this.selectedSubKeys[i.key] = true));
        }
      } else if (isCtrl) {
        if (key in this.selectedSubKeys) delete this.selectedSubKeys[key];
        else this.selectedSubKeys[key] = true;
      } else {
        this.selectedSubKeys = {};
        this.selectedSubKeys[key] = true;
      }
      this.lastClickedSubKey = key;
      this.cumulativeTrim = 0;
    },
    async adjustOffset(offset) {
      if (this._trimBusy) return;
      this._trimBusy = true;
      try {
        if (!offset || typeof offset !== "number") return;
        // Build Payload
        const payload = [];
        for (const key of Object.keys(this.selectedSubKeys)) {
          const item = this.subsItems.find((i) => i.key === key);
          if (!item) continue;

          let fileId = item.file_id;
          if (!fileId) {
            const entry = item.raw;
            const files = entry.attributes?.files || [];
            if (files.length) fileId = files[0].file_id;
          }
          if (!fileId) continue;

          payload.push({
            file_id: Number(fileId),
            showName: this.currentShowName,
            season: item.season,
            episode: item.episode,
          });
        }

        if (!payload.length) {
          // No alert permitted
          return;
        }

        const payloadWithOffset = payload.map((o) => ({ ...o, offset }));

        // Call server
        const timeoutMs = 120000;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  `offsetSubFiles: timed out after ${timeoutMs / 1000}s`,
                ),
              ),
            timeoutMs,
          );
        });
        const res = await Promise.race([
          offsetSubFiles(payloadWithOffset),
          timeoutPromise,
        ]);

        if (
          res &&
          typeof res === "object" &&
          res.ok &&
          Array.isArray(res.failures)
        ) {
          this.applyFailures = res.failures;
          this.showApplyFailuresModal = res.failures.length > 0;
          if (!res.failures.length) {
            this.cumulativeTrim += offset;
          }
        } else if (
          res &&
          typeof res === "object" &&
          typeof res.error === "string"
        ) {
          console.error("Error: " + res.error);
        } else {
          // String "ok" or object without failures/error.
          this.cumulativeTrim += offset;
        }
      } catch (e) {
        console.error("Error: " + (e.message || e));
      } finally {
        this._trimBusy = false;
      }
    },
    encodeFileIdBase32(fileId) {
      if (fileId == null) return "";
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let n = Number(fileId);
      if (!Number.isFinite(n) || n < 0) n = 0;
      n = Math.floor(n);

      let base32 = "";
      do {
        base32 = alphabet[n % 32] + base32;
        n = Math.floor(n / 32);
      } while (n > 0);

      return base32;
    },
    async applySubs() {
      if (this.applyInProgress) return;
      if (Object.keys(this.selectedSubKeys).length === 0) return;

      this.applyInProgress = true;
      const payload = [];

      for (const key of Object.keys(this.selectedSubKeys)) {
        const item = this.subsItems.find((i) => i.key === key);
        if (!item) continue;

        let fileId = item.file_id;
        if (!fileId) {
          const entry = item.raw;
          const files = entry.attributes?.files || [];
          if (files.length) fileId = files[0].file_id;
        }
        if (!fileId) continue;

        payload.push({
          file_id: Number(fileId),
          showName: this.currentShowName,
          season: item.season,
          episode: item.episode,
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
          await this.refresh();
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
