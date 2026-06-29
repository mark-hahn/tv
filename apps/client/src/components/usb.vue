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
    <!-- Files section (header + tree) -->
    <div
      :style="{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flex: showInfo ? '0 0 50%' : '1 1 auto',
        borderBottom: showInfo ? '1px solid #ddd' : 'none',
      }"
    >
      <!-- Header -->
      <div
        :style="{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          padding: '8px',
          borderBottom: '1px solid #000',
          flex: '0 0 auto',
        }"
      >
        <!-- Row 1: hidden in movie mode -->
        <div
          v-if="!movieMode"
          style="display: flex; align-items: center"
        >
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

          <button
            @click="usbCp"
            style="
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
              margin-right: 8px;
            "
          >
            Usb CP
          </button>

          <button
            @click="forceDown"
            :disabled="loading || !hasSelection"
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

        <!-- Row 2: normal mode -->
        <div
          v-if="!movieMode"
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
          "
        >
          <div style="display: flex; gap: 8px; align-items: center">
            <input
              v-model="searchInput"
              @keyup.enter="searchUsb"
              placeholder="Search"
              style="width: 96px"
            />
            <input
              v-model="renameInput"
              @focus="onRenameFocus"
              @keyup.enter="renameFile"
              placeholder="Rename"
              style="width: 96px"
            />
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <span
              v-if="selectedFolders.size + selectedFiles.size > 0"
              style="
                font-size: 15px;
                font-weight: bold;
                color: green;
                align-self: center;
                white-space: nowrap;
              "
              >Sel: {{ selectedFolders.size + selectedFiles.size }}</span
            >
            <button
              @click.stop="usbSelClick"
              :disabled="!hasSelection"
              :class="{ 'btn-disabled': !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              Sel
            </button>

            <button
              @click.stop="highlightShow"
              :disabled="!show"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              From
            </button>

            <button
              @click.stop="usbAllClick"
              :disabled="!hasSelection"
              :class="{ 'btn-disabled': !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              All
            </button>

            <button
              @click.stop="usbFirstClick"
              :disabled="!hasSelection"
              :class="{ 'btn-disabled': !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              First
            </button>

            <button
              @click.stop="clickInfo"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': showInfo ? '#ddd' : 'whitesmoke',
              }"
            >
              Info
            </button>

            <button
              @click.stop="usbDelClick"
              :disabled="!hasSelection"
              :class="{ 'btn-disabled': !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              Del
            </button>
          </div>
        </div>

        <!-- Row 2: movie mode — title + Force/Refresh/All/First/Del -->
        <div
          v-else
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
          "
        >
          <div class="pane-header-title">USB Movies</div>
          <div style="display: flex; gap: 8px; align-items: center">
            <button
              @click="forceMovieDown"
              :disabled="loading || !hasSelection"
              :class="{ 'btn-disabled': loading || !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              Force Down
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

            <button
              @click.stop="usbAllClick"
              :disabled="!hasSelection"
              :class="{ 'btn-disabled': !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              All
            </button>

            <button
              @click.stop="usbFirstClick"
              :disabled="!hasSelection"
              :class="{ 'btn-disabled': !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              First
            </button>

            <button
              @click.stop="clickInfo"
              :style="{
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                border: '1px solid #bbb',
                '--btn-bg': showInfo ? '#ddd' : 'whitesmoke',
              }"
            >
              Info
            </button>

            <button
              @click.stop="usbDelClick"
              :disabled="!hasSelection"
              :class="{ 'btn-disabled': !hasSelection }"
              style="
                cursor: pointer;
                border-radius: 7px;
                padding: 4px 10px;
                border: 1px solid #bbb;
              "
            >
              Del
            </button>
          </div>
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
          :selected="selectedFolders.has(node.name)"
          :selected-files="selectedFiles"
          @node-click="handleNodeClick"
        />
      </div>
    </div>

    <!-- Info Pane -->
    <div
      v-show="showInfo"
      :style="{
        flex: '1 1 50%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fafafa',
        color: '#000',
        fontFamily: 'monospace',
        padding: '10px',
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
          align-items: flex-start;
        "
      >
        <div style="min-width: 0; margin-right: 8px; overflow: hidden">
          <template v-if="infoMultiFiles.length > 0">
            <div style="white-space: pre-wrap; word-break: break-word">
              {{ infoMultiTitle }}
            </div>
            <div
              v-if="infoMultiMeta"
              style="margin-top: 2px"
            >
              {{ infoMultiMeta }}
            </div>
          </template>
          <template v-else>
            <div style="white-space: pre-wrap; word-break: break-word">
              {{ wrapFileName(infoFileName) }}
            </div>
            <div
              v-if="infoFileMeta"
              style="margin-top: 2px"
            >
              {{ infoFileMeta }}
            </div>
          </template>
        </div>
        <button
          @click="showInfo = false"
          title="Close"
          :style="{
            cursor: 'pointer',
            borderRadius: '4px',
            padding: '2px 8px',
            border: '1px solid #bbb',
            backgroundColor: 'whitesmoke',
            fontWeight: 'bold',
            flexShrink: 0,
          }"
        >
          ✕
        </button>
      </div>
      <div
        style="
          flex: 1 1 auto;
          overflow: auto;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
          font-size: 12px;
        "
      >
        <span
          v-if="infoLoading"
          style="color: #666"
          >Loading...</span
        >
        <template v-else-if="infoMultiFiles.length > 0">
          <div
            v-for="(f, idx) in infoMultiFiles"
            :key="idx"
            style="
              padding: 3px 2px;
              border-bottom: 1px solid #eee;
              line-height: 1.5;
            "
          >
            <div
              style="
                font-family: sans-serif;
                font-size: 13px;
                white-space: pre-wrap;
                word-break: break-word;
              "
            >
              {{ wrapFileName(f.name) }}
            </div>
            <div
              v-if="f.meta"
              style="color: #555; font-size: 11px"
            >
              {{ f.meta }}
            </div>
          </div>
        </template>
        <template v-else-if="!infoFileName && infoText">
          <span style="color: #888">{{ infoText }}</span>
        </template>
        <template v-else-if="!infoFileName">
          <span style="color: #888">No files selected</span>
        </template>
        <template v-else>
          <div
            v-for="(line, idx) in infoText.split('\n')"
            :key="idx"
            style="white-space: pre; line-height: 1.4"
          >
            {{ line || "\u00a0" }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import parseTorrentTitle from "parse-torrent-title";
import TreeNode from "./tree-node.vue";
import { config } from "../config.js";
import { deletePath } from "../srvr.js";
import evtBus from "../evtBus.js";
import * as util from "../util.js";
import {
  smartTitleMatch,
  parseFileSeasonEpisode,
  parseTitleFromFilename,
} from "../util.js";
import { unilog } from "../log.js";

export default {
  name: "Usb",
  components: { TreeNode },
  props: {
    active: Boolean,
    show: Object,
    allShows: Array,
    movieMode: { type: Boolean, default: false },
  },
  data() {
    return {
      tree: [],
      selectedName: null, // For top-level folder selection (first of selectedFolders)
      selectedFolders: new Set(), // Multi-select top-level folders
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
      showInfo: false,
      infoFileName: "",
      infoFileMeta: "",
      infoText: "",
      infoLoading: false,
      infoMultiFiles: [],
      infoMultiTitle: "",
      infoMultiMeta: "",
      _infoRefreshTimer: null,
    };
  },
  computed: {
    hasSelection() {
      const hasName = this.selectedFolders.size > 0;
      const hasFiles = this.selectedFiles.size > 0;
      return hasName || hasFiles;
    },
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
    movieMode() {
      this.hasLoaded = false;
      this.tree = [];
      this.selectedFolders = new Set();
      this.selectedFiles = new Set();
      this.fetchFiles();
    },
    selectedFolders() {
      this.handleSelectionChanged();
    },
    selectedFiles: {
      deep: true,
      handler() {
        this.handleSelectionChanged();
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
        unilog(1045, "Rename failed", e);
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
        this.selectedFolders = new Set([node.name]);
        this.selectedFiles.clear();
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
        unilog(1046, "usb: parser resolution error:", e);
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
        this.selectedFolders = new Set([bestMatch.name]);
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
              unilog(167, "usb: could not find component ref for match");
            }
          } else {
            unilog(168, "usb: refs.treeNodes is missing");
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
        const url = this.movieMode
          ? `${config.torrentsApiUrl}/api/usb/movies`
          : `${config.torrentsApiUrl}/api/usb/files`;
        const res = await fetch(url);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const rootTree = await res.json();
        this.tree = this.processTree(rootTree);
        this.hasLoaded = true;
        await this.updateUsbSpaceAvail();

        if (this.show && this.selectedFolders.size === 0) {
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
      // 1. Top-level folder selection (folders at depth 0 only)
      if (depth === 0 && node.type !== "file") {
        // If clicking top-level folder, clear any file selection context
        this.selectedFiles.clear();
        this.renameInput = "";
        this.selectionParentPath = null;
        if (ctrlKey) {
          // Toggle this folder in multi-select
          if (this.selectedFolders.has(node.name)) {
            this.selectedFolders.delete(node.name);
          } else {
            this.selectedFolders.add(node.name);
          }
          this.selectedFolders = new Set(this.selectedFolders);
          this.selectedName = [...this.selectedFolders][0] || null;
        } else {
          this.selectedFolders = new Set([node.name]);
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
          this.selectedFolders = new Set();
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
      if (!parentPath) return this.tree; // depth-0 items (flat file list)
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
    wrapFileName(name) {
      return util.wrapFileName(name);
    },
    formatFileSize(bytes) {
      if (bytes == null) return "";
      if (bytes >= 1024 * 1024 * 1024)
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
      if (bytes >= 1024 * 1024)
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
      if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
      return bytes + " B";
    },
    // Find the first video file path in the current selection
    findFirstFile() {
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
        const i = name.lastIndexOf(".");
        return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
      };
      const firstInNode = (node, prefix) => {
        const p = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === "file") return { relPath: p, node };
        if (node.children) {
          for (const c of node.children) {
            const r = firstInNode(c, p);
            if (r) return r;
          }
        }
        return null;
      };
      // Try selected folders first
      for (const folderName of this.selectedFolders) {
        const topNode = this.tree.find((n) => n.name === folderName);
        if (topNode) {
          const r = firstInNode(topNode, null);
          if (r && VIDEO_EXTS.has(getExt(r.node.name))) return r;
          if (r) return r;
        }
      }
      // Fall back to selected files
      if (this.selectedFiles.size > 0) {
        const relPath = [...this.selectedFiles][0];
        const parts = relPath.split("/");
        let cur = this.tree;
        let node = null;
        for (const part of parts) {
          node = (cur || []).find((n) => n.name === part) || null;
          cur = node ? node.children : null;
        }
        return node
          ? { relPath, node }
          : { relPath, node: { name: parts[parts.length - 1] } };
      }
      return null;
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
    collectFilePaths() {
      const paths = [];
      const collectNode = (n, prefix) => {
        const fullPath = prefix ? `${prefix}/${n.name}` : n.name;
        if (n.type === "file") {
          paths.push(fullPath);
        } else if (n.children) {
          n.children.forEach((c) => collectNode(c, fullPath));
        }
      };
      if (this.selectedFolders.size > 0) {
        for (const folderName of this.selectedFolders) {
          const node = this.tree.find((n) => n.name === folderName);
          if (node) collectNode(node, null);
        }
      } else {
        for (const relPath of this.selectedFiles) {
          const node = this.findNodeByPath(relPath);
          if (node)
            collectNode(
              node,
              relPath.substring(0, relPath.lastIndexOf("/")) || null,
            );
        }
      }
      return paths;
    },
    handleSelectionChanged() {
      if (this.showInfo) {
        if (this._infoRefreshTimer) clearTimeout(this._infoRefreshTimer);
        this._infoRefreshTimer = setTimeout(() => {
          this.loadInfo();
        }, 300);
      }
    },
    async clickInfo() {
      if (this.showInfo) {
        this.showInfo = false;
        return;
      }
      this.showInfo = true;
      await this.loadInfo();
    },
    async loadInfo() {
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
        const i = name.lastIndexOf(".");
        return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
      };
      this.infoText = "";
      this.infoFileName = "";
      this.infoFileMeta = "";
      this.infoMultiFiles = [];
      this.infoMultiTitle = "";
      this.infoMultiMeta = "";
      this.infoLoading = true;

      const filePaths = this.collectFilePaths();

      if (filePaths.length === 0) {
        this.infoLoading = false;
        return;
      }

      if (filePaths.length === 1) {
        // Single file
        const relPath = filePaths[0];
        const node = this.findNodeByPath(relPath);
        const fileName = relPath.split("/").pop();
        this.infoFileName = fileName;
        if (node && node.size != null) {
          const sizeStr = this.formatFileSize(node.size);
          const dateStr = (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "");
          this.infoFileMeta = dateStr ? `${sizeStr} | ${dateStr}` : sizeStr;
        }
        if (!VIDEO_EXTS.has(getExt(fileName))) {
          this.infoLoading = false;
          return;
        }
        try {
          const res = await fetch(
            `${config.torrentsApiUrl}/api/usb/mediainfo`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ relPath, movieMode: this.movieMode }),
            },
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          this.infoText = data.output || "";
          const sizeStr =
            node && node.size != null ? this.formatFileSize(node.size) : "";
          const dateStr = node
            ? (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "")
            : "";
          let durStr = "";
          let widthStr = "";
          let bitDepthStr = "";
          let rateStr = "";
          const widthMatch = this.infoText.match(
            /^Height\s+:\s+(\d[\d\s]*)pixels/m,
          );
          if (widthMatch) widthStr = widthMatch[1].replace(/\s/g, "") + " px";
          const bitrateMatch = this.infoText.match(
            /^Bit rate\s+:\s+([\d\s]+kb\/s)/m,
          );
          if (bitrateMatch)
            rateStr = bitrateMatch[1].replace(/\s(?=\d)/g, "").trim();
          const vSecs = this.infoText.split(/\n\n+/);
          const vSec = vSecs.find((s) => /^Video\b/.test(s.trim()));
          if (vSec) {
            const durLine = vSec.match(/^Duration\s+:\s+(.+)/m);
            if (durLine) {
              const raw = durLine[1];
              const hm = raw.match(/(\d+)\s*h/);
              const mm = raw.match(/(\d+)\s*min/);
              const total =
                (hm ? parseInt(hm[1]) : 0) * 60 + (mm ? parseInt(mm[1]) : 0);
              if (total > 0) durStr = total + " min";
            }
            const bdLine = vSec.match(/^Bit depth\s+:\s+(\d+)\s*bits/m);
            if (bdLine) bitDepthStr = bdLine[1] + " bits";
          }
          this.infoFileMeta = [
            sizeStr,
            durStr,
            dateStr,
            widthStr,
            bitDepthStr,
            rateStr,
          ]
            .filter(Boolean)
            .join(" | ");
          const subsCount = data.subsCount ?? 0;
          const srtsCount = data.srtsCount ?? 0;
          this.infoFileMeta += ` | ${subsCount} sub | ${srtsCount} srt`;
        } catch (e) {
          this.infoText = `Error: ${e.message}`;
        } finally {
          this.infoLoading = false;
        }
        return;
      }

      // Multiple files
      const entries = [];
      for (const relPath of filePaths) {
        const fileName = relPath.split("/").pop();
        const node = this.findNodeByPath(relPath);
        let sizeStr = "";
        let dateStr = "";
        if (node && node.size != null) {
          sizeStr = this.formatFileSize(node.size);
          dateStr = (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "");
        }
        if (VIDEO_EXTS.has(getExt(fileName))) {
          try {
            const res = await fetch(
              `${config.torrentsApiUrl}/api/usb/mediainfo`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relPath, movieMode: this.movieMode }),
              },
            );
            const data = await res.json();
            let rStr = "";
            let dStr = "";
            let wStr = "";
            let bdStr = "";
            if (res.ok && data.output) {
              const wm = data.output.match(/^Height\s+:\s+(\d[\d\s]*)pixels/m);
              if (wm) wStr = wm[1].replace(/\s/g, "") + " px";
              const bm = data.output.match(/^Bit rate\s+:\s+([\d\s]+kb\/s)/m);
              if (bm) rStr = bm[1].replace(/\s(?=\d)/g, "").trim();
              const vSecs = data.output.split(/\n\n+/);
              const vSec = vSecs.find((s) => /^Video\b/.test(s.trim()));
              if (vSec) {
                const durLine = vSec.match(/^Duration\s+:\s+(.+)/m);
                if (durLine) {
                  const raw = durLine[1];
                  const hm = raw.match(/(\d+)\s*h/);
                  const mm = raw.match(/(\d+)\s*min/);
                  const total =
                    (hm ? parseInt(hm[1]) : 0) * 60 +
                    (mm ? parseInt(mm[1]) : 0);
                  if (total > 0) dStr = total + " min";
                }
                const bdLine = vSec.match(/^Bit depth\s+:\s+(\d+)\s*bits/m);
                if (bdLine) bdStr = bdLine[1] + " bits";
              }
            }
            const subsCount = data.subsCount ?? 0;
            const srtsCount = data.srtsCount ?? 0;
            const meta =
              [sizeStr, dStr, dateStr, wStr, bdStr, rStr]
                .filter(Boolean)
                .join(" | ") + ` | ${subsCount} sub | ${srtsCount} srt`;
            entries.push({ name: fileName, meta });
          } catch (_) {
            const meta = [sizeStr, dateStr].filter(Boolean).join(" | ");
            entries.push({ name: fileName, meta });
          }
          continue;
        }
        {
          const meta = [sizeStr, dateStr].filter(Boolean).join(" | ");
          entries.push({ name: fileName, meta });
        }
      }
      this.infoMultiFiles = entries;

      // Aggregate header
      const names = filePaths.map((p) => p.split("/").pop());
      // Common sections via recursive longest-common-substring
      const MIN_SECT = 8;
      const s0 = names[0] || "";
      const s1 = names.length > 1 ? names[1] : "";
      if (!s1) {
        this.infoMultiTitle = s0;
      } else {
        const lcsRange = (aS, aE, bS, bE) => {
          let best = { a: aS, b: bS, len: 0 };
          for (let i = aS; i < aE; i++) {
            for (let j = bS; j < bE; j++) {
              let k = 0;
              while (i + k < aE && j + k < bE && s0[i + k] === s1[j + k]) k++;
              if (k > best.len) best = { a: i, b: j, len: k };
            }
          }
          return best;
        };
        const rawSects = [];
        const findSects = (aS, aE, bS, bE) => {
          if (aS >= aE || bS >= bE) return;
          const m = lcsRange(aS, aE, bS, bE);
          if (m.len < MIN_SECT) return;
          findSects(aS, m.a, bS, m.b);
          rawSects.push(s0.slice(m.a, m.a + m.len));
          findSects(m.a + m.len, aE, m.b + m.len, bE);
        };
        findSects(0, s0.length, 0, s1.length);
        const valid = rawSects.filter((t) =>
          names.every((nm) => nm.includes(t)),
        );
        if (valid.length === 0) {
          this.infoMultiTitle = s0;
        } else {
          const parts = valid
            .map((t) => t.replace(/^\.+|\.+$/g, ""))
            .filter(Boolean);
          const last = parts[parts.length - 1] || "";
          const hasTrail =
            last &&
            names.some((nm) => nm.indexOf(last) + last.length < nm.length);
          this.infoMultiTitle = parts.join(" ... ") + (hasTrail ? " ..." : "");
        }
      }

      let totalSize = 0;
      const allDates = [];
      for (const relPath of filePaths) {
        const node = this.findNodeByPath(relPath);
        if (node && node.size != null) totalSize += node.size;
        if (node && node.date) {
          const d = (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "");
          if (d) allDates.push(d);
        }
      }
      const sizeAgg = this.formatFileSize(totalSize);
      allDates.sort();
      if (allDates.length >= 2) {
        this.infoMultiMeta = `${sizeAgg} | ${allDates[0]} | ${allDates[allDates.length - 1]}`;
      } else if (allDates.length === 1) {
        this.infoMultiMeta = `${sizeAgg} | ${allDates[0]}`;
      } else {
        this.infoMultiMeta = sizeAgg;
      }

      this.infoLoading = false;
    },
    async forceMovieDown() {
      if (this.selectedFolders.size === 0 && this.selectedFiles.size === 0)
        return;
      const paths = [...[...this.selectedFolders], ...[...this.selectedFiles]];
      if (!confirm(`Delete ${paths.length} item(s) from local movies?`)) return;
      this.loading = true;
      try {
        for (const relPath of paths) {
          await deletePath(`/mnt/media/movies/${relPath}`);
        }
        await fetch(`${config.tvDownUrl}/movieCycle`, { method: "POST" });
      } catch (e) {
        alert("Error: " + (e?.message || e));
      } finally {
        this.loading = false;
        await this.fetchFiles();
      }
    },
    async usbCp() {
      try {
        const resp = await fetch(`${config.torrentsApiUrl}/api/usb/cp-token`);
        const data = await resp.json();
        if (!resp.ok || !data.token) {
          alert("Usb CP login failed: " + (data.error || "no token"));
          return;
        }
        const target =
          "https://cp.ultra.cc/#/userservice/5ba78e1c-ac41-40bd-8e82-a8261428829e?tok=" +
          encodeURIComponent(data.token);
        util.openExternalPage(target);
      } catch (e) {
        alert("Usb CP error: " + (e?.message || e));
      }
    },
    async forceDown() {
      if (this.selectedFolders.size === 0 && this.selectedFiles.size === 0)
        return;

      let files = [];
      let label = "";

      if (this.selectedFolders.size > 0) {
        // One or more top-level folders selected
        for (const folderName of this.selectedFolders) {
          const node = this.tree.find((n) => n.name === folderName);
          if (node) files.push(...this.collectFiles(node, node.name));
        }
        label = `'${[...this.selectedFolders].join(", ")}'`;
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

      // Separate DVD files (inside VIDEO_TS folders) from regular files.
      const extractPath = (fe) =>
        fe.split("-").slice(0, -1).join("-").slice(11);
      const dvdFiles = files.filter((fe) =>
        extractPath(fe).includes("/VIDEO_TS/"),
      );
      const regularFiles = files.filter(
        (fe) => !extractPath(fe).includes("/VIDEO_TS/"),
      );

      // Validate regular files can be parsed (title + season + episode).
      const parseErrors = [];
      for (const fileEntry of regularFiles) {
        const filePath = extractPath(fileEntry);
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
          .map((s) => s.name || s.name)
          .filter(Boolean);
        const notInEmby = [];

        // Check DVD files by top-level folder name (not individual VOBs).
        const dvdFolders = new Set();
        for (const fe of dvdFiles) {
          const topFolder = extractPath(fe).split("/")[0];
          if (topFolder) dvdFolders.add(topFolder);
        }
        for (const folder of dvdFolders) {
          let parsedPtt = {};
          try {
            if (typeof parseTorrentTitle === "function")
              parsedPtt = parseTorrentTitle(folder) || {};
            else if (parseTorrentTitle?.parse)
              parsedPtt = parseTorrentTitle.parse(folder) || {};
          } catch (e) {}
          const title = parseTitleFromFilename(folder, "", parsedPtt);
          if (title) {
            const match = smartTitleMatch(title, embyShows, null, false);
            if (!match) notInEmby.push(title);
          }
        }

        // Check regular files individually.
        for (const fileEntry of regularFiles) {
          const filePath2 = extractPath(fileEntry);
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

    // Sel: emit selectShowFromCardTitle for first selected
    usbSelClick() {
      if (this.selectedFolders.size > 0) {
        evtBus.emit("selectShowFromCardTitle", [...this.selectedFolders][0]);
        return;
      }
      if (this.selectedFiles.size > 0) {
        // Use parent folder name or first file name
        const parentPath = this.selectionParentPath;
        if (parentPath) {
          // Last segment of parent path as show name
          const parts = parentPath.split("/");
          const name = parts[parts.length - 1];
          if (name) {
            evtBus.emit("selectShowFromCardTitle", name);
            return;
          }
        }
        // Fall back to first file name
        const firstPath = [...this.selectedFiles][0];
        const fileName = firstPath ? firstPath.split("/").pop() : null;
        if (fileName) evtBus.emit("selectShowFromCardTitle", fileName);
      }
    },

    // All: select all siblings of first selected file
    usbAllClick() {
      const parentPath =
        this.selectedFiles.size > 0 ? this.selectionParentPath : null;

      if (!parentPath && this.selectedFolders.size > 0) {
        // For top-level, select all immediate children that are folders or files?
        // Just emit selectShowFromCardTitle — All doesn't make sense for top-level
        return;
      }
      if (!parentPath) return;

      const siblings = this.getSiblings(parentPath);
      if (!siblings || siblings.length === 0) return;

      const newFiles = new Set();
      for (const s of siblings) {
        if (s.type === "file" || s.type === "folder") {
          newFiles.add(this.getPath(parentPath, s.name));
        }
      }
      this.selectedFiles = newFiles;
      this.selectionParentPath = parentPath;
      this.lastSelectedFile = [...newFiles][0] || null;
    },

    // First: scroll to first selected item
    usbFirstClick() {
      const firstFolder = [...this.selectedFolders][0] || null;
      const target =
        firstFolder ||
        (this.selectedFiles.size > 0 ? [...this.selectedFiles][0] : null);
      if (!target) return;

      if (firstFolder && this.$refs.treeNodes) {
        const comp = this.$refs.treeNodes.find((c) => {
          const n = c.node || c.$props?.node;
          return n && n.name === firstFolder;
        });
        if (comp && comp.$el) {
          comp.$el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }

      if (this.$refs.treeNodes) {
        // find by emitting event from child or scanning $el text
        const firstFile = [...this.selectedFiles][0];
        const firstName = firstFile ? firstFile.split("/").pop() : null;
        if (firstName) {
          const comp = this.$refs.treeNodes.find((c) => {
            const n = c.node || c.$props?.node;
            return n && n.name === firstName;
          });
          if (comp && comp.$el) {
            comp.$el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }
    },

    // Del: confirm then delete selected files from USB
    async usbDelClick() {
      if (!this.hasSelection) return;

      let paths = [];
      if (this.selectedName) {
        // Whole top-level folder selected
        paths = [this.selectedName];
      } else {
        paths = [...this.selectedFiles];
      }

      const count = paths.length;
      if (count === 0) return;

      const ok = window.confirm(
        `Delete ${count} file${count === 1 ? "" : "s"} from USB disk?`,
      );
      if (!ok) return;

      try {
        const res = await fetch(
          `${config.torrentsApiUrl}/api/usb/deleteFiles`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths }),
          },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          window.alert(`Delete failed: ${txt || res.statusText}`);
          return;
        }
        this.selectedName = null;
        this.selectedFolders = new Set();
        this.selectedFiles.clear();
        this.selectionParentPath = null;
        this.lastSelectedFile = null;
        await this.fetchFiles();
      } catch (err) {
        window.alert(`Delete failed: ${err?.message || String(err)}`);
      }
    },
  },
};
</script>
