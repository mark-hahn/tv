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
        flex:
          showAsr || showEmb || showFix || showInfo ? '0 0 50%' : '1 1 auto',
        borderBottom:
          showAsr || showEmb || showFix || showInfo ? '1px solid #ddd' : 'none',
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
        <!-- Row 1: title, loading, search, rename, To, From -->
        <div style="display: flex; align-items: center">
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
            style="width: 150px; margin-right: 10px"
          />

          <input
            v-model="renameInput"
            @focus="onRenameFocus"
            @keyup.enter="renameLocalFile"
            placeholder="Rename"
            style="width: 150px; margin-right: 10px"
          />

          <button
            @click="errsMode || toShow()"
            :disabled="errsMode"
            title="Select show matching selected folder"
            :style="{
              cursor: errsMode ? 'default' : 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor: errsMode ? '#e8e8e8' : 'whitesmoke',
              color: errsMode ? '#aaa' : 'inherit',
              marginRight: '10px',
            }"
          >
            To
          </button>

          <button
            @click="errsMode || selectTopLevel()"
            :disabled="errsMode"
            title="Find folder matching current show"
            :style="{
              cursor: errsMode ? 'default' : 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor: errsMode ? '#e8e8e8' : 'whitesmoke',
              color: errsMode ? '#aaa' : 'inherit',
            }"
          >
            From
          </button>
        </div>

        <!-- Row 2: Subs, Asr, Fix, Errs, Del, Ref aligned right -->
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: flex-end;
            margin-top: 6px;
          "
        >
          <button
            @click="clickSubs()"
            :style="{
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor:
                subsPending.length > 0 ? 'lightgray' : 'whitesmoke',
              marginRight: '10px',
            }"
          >
            Subs
          </button>

          <button
            @click="errsMode || clickAsr()"
            :disabled="errsMode"
            :style="{
              cursor: errsMode ? 'default' : 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor: errsMode
                ? '#e8e8e8'
                : showAsr
                  ? '#ddd'
                  : 'whitesmoke',
              color: errsMode ? '#aaa' : 'inherit',
              marginRight: '10px',
            }"
          >
            Asr
          </button>

          <button
            @click="errsMode || clickEmb()"
            :disabled="errsMode"
            :style="{
              cursor: errsMode ? 'default' : 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor: errsMode
                ? '#e8e8e8'
                : showEmb
                  ? '#ddd'
                  : 'whitesmoke',
              color: errsMode ? '#aaa' : 'inherit',
              marginRight: '10px',
            }"
          >
            Emb
          </button>

          <button
            @click="clickFix"
            :style="{
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor: showFix ? '#ddd' : 'whitesmoke',
              marginRight: '10px',
            }"
          >
            Fix
          </button>

          <button
            @click="toggleErrs"
            :style="{
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor: errsMode ? 'lightgray' : 'white',
              marginRight: '10px',
            }"
          >
            Errs
          </button>

          <button
            @click="clickInfo"
            :style="{
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              backgroundColor: showInfo ? '#ddd' : 'whitesmoke',
              marginRight: '10px',
            }"
          >
            Info
          </button>

          <button
            @click="moveSelected"
            :disabled="!errsMode || loading || selectedFiles.size === 0"
            title="Move selected error file to Trial &amp; Error"
            :style="{
              cursor:
                errsMode && selectedFiles.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg':
                errsMode && selectedFiles.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: errsMode && selectedFiles.size > 0 ? 'inherit' : '#aaa',
              marginRight: '10px',
            }"
          >
            Move
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
            Del
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
            Ref
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
          :node="node"
          :ref="(el) => setNodeRef(el, node.name)"
          :selected="selectedName === node.name"
          :selected-files="selectedFiles"
          @node-click="handleNodeClick"
        />
      </div>
    </div>

    <!-- Emb Pane -->
    <div
      id="embPane"
      v-show="showEmb"
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
          <strong>Emb Output</strong>
          <span v-if="embBusy">(Running)</span>
        </div>
        <div>
          <button
            @click="applyEmb"
            :disabled="embBusy"
            :style="{
              cursor: embBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
              opacity: embBusy ? 0.6 : 1,
            }"
          >
            Apply
          </button>
          <button
            @click="clearEmbLog"
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
            @click="showEmb = false"
            title="Close"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              fontWeight: 'bold',
              marginLeft: '5px',
            }"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        ref="embScroll"
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre-wrap;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        {{ embLogs }}
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
          <strong>ASR Output</strong>
          <span v-if="asrBusy">(Running)</span>
          <span
            v-if="asrQueueLen > 0"
            style="margin-left: 6px; font-size: 0.85em; color: #555"
            >[Queue: {{ asrQueueLen }}]</span
          >
        </div>
        <div>
          <button
            @click="clickQueue"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              '--btn-bg': asrQueueMode ? 'lightgray' : 'whitesmoke',
              marginRight: '5px',
            }"
          >
            Queue
          </button>
          <button
            @click="startAsr"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
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
            @click="showAsr = false"
            title="Close"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              fontWeight: 'bold',
              marginLeft: '5px',
            }"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        v-if="!asrQueueMode"
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
      <div
        v-else
        style="
          flex: 1 1 auto;
          overflow: auto;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        <div
          v-if="asrQueueEntries.length === 0"
          style="color: #888; padding: 8px"
        >
          Queue is empty
        </div>
        <div
          v-for="entry in sortedAsrQueue"
          :key="entry.videoPath"
          @click="removeFromQueue(entry.videoPath)"
          :style="{
            cursor: 'pointer',
            padding: '6px 8px',
            borderBottom: '1px solid #eee',
            display: 'flex',
            flexDirection: 'column',
          }"
        >
          <span style="font-size: 14px; word-break: break-all">{{
            entry.videoPath.split("/").pop()
          }}</span>
          <span style="font-size: 14px; color: #666">
            Added by {{ entry.source || "unknown" }}, at
            {{ formatAsrTime(entry.addedAt)
            }}<span
              v-if="
                asrBusy && asrQueueEntries[0]?.videoPath === entry.videoPath
              "
              style="color: #c77"
              >, Processing</span
            >
          </span>
        </div>
      </div>
    </div>

    <!-- Fix Pane -->
    <div
      id="fixPane"
      v-show="showFix"
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
          <strong>FFMPEG Output</strong> <span v-if="fixBusy">(Running)</span>
        </div>
        <div>
          <button
            @click="startFix"
            :disabled="fixBusy"
            :style="{
              cursor: fixBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              marginRight: '5px',
              opacity: fixBusy ? 0.6 : 1,
            }"
          >
            Start
          </button>
          <button
            @click="clearFixLog"
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
            @click="killFix"
            :disabled="!fixBusy"
            :style="{
              cursor: !fixBusy ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              opacity: !fixBusy ? 0.6 : 1,
            }"
          >
            Kill
          </button>
          <button
            @click="showFix = false"
            title="Close"
            :style="{
              cursor: 'pointer',
              borderRadius: '4px',
              padding: '2px 8px',
              border: '1px solid #bbb',
              backgroundColor: 'whitesmoke',
              fontWeight: 'bold',
              marginLeft: '5px',
            }"
          >
            ✕
          </button>
        </div>
      </div>
      <div
        ref="fixScroll"
        style="
          flex: 1 1 auto;
          overflow: auto;
          white-space: pre-wrap;
          background-color: #fff;
          border: 1px solid #eee;
          padding: 4px;
        "
      >
        {{ fixLogs }}
      </div>
    </div>

    <!-- Info Pane -->
    <div
      id="infoPane"
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
          align-items: flex-start;
        "
      >
        <div style="min-width: 0; margin-right: 8px; overflow: hidden">
          <div style="white-space: pre-wrap; word-break: break-word">
            {{ wrapFileName(infoFileName) }}
          </div>
          <div
            v-if="infoFileMeta"
            style="margin-top: 2px"
          >
            {{ infoFileMeta }}
          </div>
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
            v-for="(item, idx) in infoLines"
            :key="idx"
            @click="infoSelectedLine = idx"
            :style="{
              backgroundColor:
                infoSelectedLine === idx ? '#fffde7' : 'transparent',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.5',
              padding: '0 2px',
              cursor: 'default',
              minHeight: '1.5em',
              fontWeight:
                item.line &&
                !item.line.includes(':') &&
                item.line.trim() === item.line &&
                item.line.trim().length > 0
                  ? 'bold'
                  : 'normal',
              fontFamily: /^=+$/.test(item.line)
                ? 'monospace'
                : item.line &&
                    !item.line.includes(':') &&
                    item.line.trim() === item.line &&
                    item.line.trim().length > 0
                  ? 'sans-serif'
                  : 'inherit',
              fontSize:
                item.line &&
                !item.line.includes(':') &&
                item.line.trim() === item.line &&
                item.line.trim().length > 0
                  ? '13px'
                  : 'inherit',
              textDecoration:
                item.line &&
                !item.line.includes(':') &&
                item.line.trim() === item.line &&
                item.line.trim().length > 0 &&
                !/^=+$/.test(item.line)
                  ? 'underline'
                  : 'none',
              color: 'inherit',
            }"
          >
            {{ item.line || "\u00a0" }}
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
  handleAsr,
  handleFix,
  handleEmb,
  embApply,
  enqueueSubs,
  enqueueGenSrt,
  generateEmb,
  getAsrLog,
  getAsrQueue,
  addToAsrQueue,
  removeFromAsrQueue,
  killAsrProcess,
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
      renameInput: "",

      // Asr
      showAsr: false,
      asrLogs: "",
      asrBusy: false,
      activeAsrPath: null,
      ignoreLogs: false,
      asrQueueMode: false,
      asrQueueEntries: [],
      asrQueueLen: 0,

      // Emb
      showEmb: false,
      embLogs: "",
      embBusy: false,

      // Fix (ffmpeg)
      showFix: false,
      fixLogs: "",
      fixBusy: false,
      activeFixPath: null,
      ignoreFixLogs: false,

      // Subs progress tracking
      subsPending: [],

      // Errs mode
      errsMode: false,

      // Info pane
      showInfo: false,
      infoText: "",
      infoFileName: "",
      infoFileMeta: "",
      infoLoading: false,
      infoSelectedLine: null,
      infoMultiFiles: [], // [{name, meta}] for multi-file display
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
      if (val && !this.loading) {
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
    embLogs() {
      const el = this.$refs.embScroll;
      if (!el) return;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    showEmb(val) {
      if (val) {
        this.$nextTick(() => {
          if (this.$refs.embScroll)
            this.$refs.embScroll.scrollTop = this.$refs.embScroll.scrollHeight;
        });
      }
    },
    fixLogs() {
      const el = this.$refs.fixScroll;
      if (!el) return;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isAtBottom) {
        this.$nextTick(() => {
          this.scrollToFixBottom();
        });
      }
    },
    showFix(val) {
      if (val) {
        this.$nextTick(() => {
          this.scrollToFixBottom();
        });
      }
    },
  },
  mounted() {
    if (this.active && !this.hasLoaded) {
      this.fetchFiles();
    }
    evtBus.off("asr-log", this.onAsrLog);
    evtBus.off("asr-queue-update", this.onAsrQueueUpdate);
    evtBus.on("asr-log", this.onAsrLog);
    evtBus.on("asr-queue-update", this.onAsrQueueUpdate);
    evtBus.off("fix-log", this.onFixLog);
    evtBus.on("fix-log", this.onFixLog);
    evtBus.off("emb-log", this.onEmbLog);
    evtBus.on("emb-log", this.onEmbLog);
    evtBus.off("subs-progress", this.onSubsProgress);
    evtBus.on("subs-progress", this.onSubsProgress);
    this.initAsrState();
    this.initFixState();
    this.initEmbState();
  },
  unmounted() {
    evtBus.off("asr-log", this.onAsrLog);
    evtBus.off("asr-queue-update", this.onAsrQueueUpdate);
    evtBus.off("fix-log", this.onFixLog);
    evtBus.off("emb-log", this.onEmbLog);
    evtBus.off("subs-progress", this.onSubsProgress);
  },
  computed: {
    sortedAsrQueue() {
      return [...this.asrQueueEntries].sort(
        (a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0),
      );
    },
    infoLines() {
      if (!this.infoText) return [];
      const lines = this.infoText.split("\n");
      let inVideo = false;
      return lines.map((line) => {
        if (
          line &&
          !line.includes(":") &&
          line.trim() === line &&
          line.trim().length > 0 &&
          !/^=+$/.test(line)
        ) {
          inVideo = /^Video\b/.test(line.trim());
        }
        return { line, inVideo };
      });
    },
  },
  methods: {
    wrapFileName(name) {
      return util.wrapFileName(name);
    },
    formatAsrTime(ts) {
      if (!ts) return "";
      const d = new Date(ts);
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const p = {};
      for (const { type, value } of parts) p[type] = value;
      let hh = p.hour;
      if (hh === "24") hh = "00";
      return `${p.month}/${p.day} ${hh}:${p.minute}:${p.second}`;
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
    scrollToAsrBottom() {
      const el = this.$refs.asrScroll;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    },
    scrollToFixBottom() {
      const el = this.$refs.fixScroll;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    },
    async fetchFiles() {
      this.loading = true;
      this.error = null;
      try {
        const endpoint = this.errsMode
          ? "/api/local/error-files"
          : "/api/local/files";
        const url = `${config.torrentsApiUrl}${endpoint}`;
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
          const isSrt = (name) =>
            getExt(name) === "srt" || name.toLowerCase().endsWith(".chosen");

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
        this.$emit("select-show", match.name);
      } else {
        alert(`No show found matching folder "${folderName}"`);
      }
    },
    onRenameFocus() {
      if (this.renameInput) return;
      if (this.selectedFiles.size === 1) {
        const fullPath = Array.from(this.selectedFiles)[0];
        const parts = fullPath.split("/");
        const fileName = parts.pop();
        this.renameInput = fileName;
      }
    },
    async renameLocalFile() {
      if (!this.renameInput) return;
      if (this.selectedFiles.size !== 1) return;

      const oldPath = Array.from(this.selectedFiles)[0];
      const newName = this.renameInput.trim();
      if (!newName) return;

      const parts = oldPath.split("/");
      const oldName = parts[parts.length - 1];
      if (oldName === newName) return;

      this.loading = true;
      try {
        const url = `${config.torrentsApiUrl}/api/local/rename`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath, newName, errsMode: this.errsMode }),
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
        this.loading = false;
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
      const showName = this.show ? this.show.name : null;
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
        const root = this.errsMode ? "/mnt/media/tv-errors" : "/mnt/media/tv";
        for (const relPath of pathsToDelete) {
          const fullPath = `${root}/${relPath}`;
          await deletePath(fullPath);
        }

        this.selectedFiles.clear();
        this.selectedName = null; // Clear top level selection too
        this.selectionParentPath = null;
        this.lastSelectedFile = null;
        evtBus.emit("localFoldersChanged");
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
      // 1. Top-level folder selection (normal mode only)
      if (depth === 0 && !this.errsMode) {
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
      if (!parentPath) return this.tree; // depth-0 items (errs mode)
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
    clickSubs() {
      const videoPaths = this.collectFilePaths()
        .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
        .map((p) => `/mnt/media/tv/${p}`);
      if (videoPaths.length === 0) {
        alert("No video files selected");
        return;
      }
      for (const p of videoPaths) {
        if (!this.subsPending.includes(p)) this.subsPending.push(p);
      }
      enqueueSubs(videoPaths, true).catch((e) =>
        console.error("enqueueSubs", e),
      );
    },
    onSubsProgress({ path }) {
      const idx = this.subsPending.indexOf(path);
      if (idx !== -1) {
        this.subsPending.splice(idx, 1);
        if (this.subsPending.length === 0) {
          this.fetchFiles();
        }
      }
    },
    clickAsr() {
      this.showAsr = !this.showAsr;
      if (this.showAsr) {
        this.showEmb = false;
        this.showFix = false;
        this.showInfo = false;
      }
    },
    async clearAsrLog() {
      this.asrLogs = "";
      this.asrQueueMode = false;
    },
    async startAsr() {
      const videoPaths = this.collectFilePaths()
        .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
        .map((p) => `/mnt/media/tv/${p}`);
      if (videoPaths.length === 0) {
        this.asrLogs += "[Error] No video files selected.\n";
        return;
      }
      this.asrQueueMode = false;
      try {
        await addToAsrQueue(videoPaths);
        this.asrLogs += `Queued ${videoPaths.length} file(s) for ASR.\n`;
      } catch (e) {
        this.asrLogs += `Error: ${e.message}\n`;
      }
    },
    async killAsr() {
      try {
        await killAsrProcess();
        this.asrLogs += `\n[Kill command sent]\n`;
      } catch (e) {
        this.asrLogs += `\nError killing ASR: ${e.message}\n`;
      }
    },
    onAsrLog(msg) {
      if (this.ignoreLogs) return;
      if (!msg) return; // ignore empty

      const el = this.$refs.asrScroll;
      let atBottom = true;
      if (el) {
        atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      }

      this.asrLogs += msg.endsWith("\n") ? msg : msg + "\n";

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
        const [logRes, queueRes] = await Promise.all([
          getAsrLog(),
          getAsrQueue(),
        ]);
        if (logRes?.lines) this.asrLogs = logRes.lines;
        if (queueRes) {
          this.asrQueueLen = queueRes.count ?? 0;
          this.asrBusy = queueRes.running ?? false;
        }
      } catch (e) {
        console.error("Failed to init Asr State", e);
      }
    },
    onAsrQueueUpdate({ count, running, entries }) {
      this.asrQueueLen = count ?? 0;
      if (running !== undefined) this.asrBusy = running;
      if (entries !== undefined) this.asrQueueEntries = entries;
    },
    async clickQueue() {
      this.asrQueueMode = !this.asrQueueMode;
      if (this.asrQueueMode) {
        await this.fetchAsrQueue();
      }
    },
    async fetchAsrLog() {
      try {
        const res = await getAsrLog();
        if (res?.lines != null) this.asrLogs = res.lines;
      } catch (e) {
        console.error("fetchAsrLog error", e);
      }
    },
    async fetchAsrQueue() {
      try {
        const res = await getAsrQueue();
        if (res) {
          this.asrQueueEntries = res.entries ?? [];
          this.asrQueueLen = res.count ?? 0;
          this.asrBusy = res.running ?? this.asrBusy;
        }
      } catch (e) {
        console.error("fetchAsrQueue error", e);
      }
    },
    async removeFromQueue(videoPath) {
      if (!confirm(`Remove from queue?\n${videoPath}`)) return;
      try {
        await removeFromAsrQueue(videoPath);
        await this.fetchAsrQueue();
      } catch (e) {
        console.error("removeFromQueue error", e);
      }
    },
    clickFix() {
      this.showFix = !this.showFix;
      if (this.showFix) {
        this.showAsr = false;
        this.showInfo = false;
      }
    },
    async clearFixLog() {
      this.fixLogs = "";
    },
    async startFix() {
      if (this.fixBusy) return;

      let startPath = null;
      if (this.selectedFiles.size === 1) {
        const relPath = [...this.selectedFiles][0];
        startPath = relPath;
      } else if (this.selectedName) {
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (node && node.type === "folder") startPath = node.name;
      }

      if (!startPath) {
        if (this.activeFixPath) startPath = this.activeFixPath;
        else {
          this.fixLogs += "\n[Error] No file or folder selected for ffmpeg.\n";
          return;
        }
      }

      this.fixBusy = true;
      this.activeFixPath = startPath;
      this.ignoreFixLogs = true;
      this.fixLogs = "";
      this.showFix = true;
      this.showAsr = false;
      this.showInfo = false;

      try {
        this.ignoreFixLogs = false;
        const res = await handleFix({ action: "start", path: startPath });
        if (res && res.error) {
          this.fixLogs += `Start Error: ${res.error}\nStderr: ${res.stderr || ""}\n`;
          this.fixBusy = false;
          return;
        }
        if (res && res.stdout) {
          console.log("Fix Start stdout:", res.stdout);
        }
      } catch (e) {
        this.ignoreFixLogs = false;
        this.fixLogs += `Error starting ffmpeg: ${e.message}\n`;
        this.fixBusy = false;
      }
    },
    async killFix() {
      try {
        const res = await handleFix({ action: "kill" });
        this.fixLogs += `\n[Kill command sent]\n`;
        if (res && res.stdout) this.fixLogs += res.stdout;
        if (res && res.stderr) this.fixLogs += res.stderr;
      } catch (e) {
        this.fixLogs += `\nError killing ffmpeg: ${e.message}\n`;
      }
      this.fixBusy = false;
    },
    onFixLog(msg) {
      if (this.ignoreFixLogs) return;
      if (!msg) return;

      const el = this.$refs.fixScroll;
      let atBottom = true;
      if (el) {
        atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      }

      if (msg.startsWith("\r")) {
        // Replace the last (incomplete) line — everything after the last \n
        const lastNl = this.fixLogs.lastIndexOf("\n");
        if (lastNl !== -1) {
          this.fixLogs = this.fixLogs.slice(0, lastNl + 1) + msg.slice(1);
        } else {
          this.fixLogs = msg.slice(1);
        }
      } else {
        this.fixLogs += msg;
      }

      if (msg.includes("[fix] EXIT")) {
        this.fixBusy = false;
      }

      if (atBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    async initFixState() {
      try {
        const res = await handleFix({ action: "check" });
        if (res && res.running) {
          this.fixBusy = true;
        } else {
          this.fixBusy = false;
        }
      } catch (e) {
        console.error("Failed to init Fix State", e);
      }
    },
    async initEmbState() {
      try {
        await handleEmb({ action: "tail" });
      } catch (e) {
        console.error("Failed to init Emb state", e);
      }
    },
    clickEmb() {
      this.showEmb = !this.showEmb;
      if (this.showEmb) {
        this.showAsr = false;
        this.showFix = false;
        this.showInfo = false;
      }
    },
    async applyEmb() {
      if (this.embBusy) return;
      this.embBusy = true;
      this.showEmb = true;
      this.showAsr = false;
      this.showFix = false;
      this.showInfo = false;

      try {
        const videoPaths = this.collectFilePaths()
          .filter((p) => /\.(mkv|mp4|avi|m4v|mov|webm)$/i.test(p))
          .map((p) => `/mnt/media/tv/${p}`);
        if (videoPaths.length === 0) {
          this.embLogs += "[Error] No video files selected.\n\n";
          this.embBusy = false;
          return;
        }
        const res = await generateEmb(videoPaths);
        if (res && res.ok) {
          this.embLogs += `[Queued ${res.queued} file(s) for emb extraction]\n`;
        } else {
          this.embLogs += `[emb apply error: ${JSON.stringify(res)}]\n`;
        }
      } catch (e) {
        this.embLogs += `[Error: ${e.message}]\n`;
      }

      this.embBusy = false;

      try {
        await handleEmb({ action: "tail" });
      } catch (e) {
        this.embLogs += `[Tail error: ${e.message}]\n`;
      }
    },
    async clearEmbLog() {
      this.embLogs = "";
      try {
        await handleEmb({ action: "clear" });
      } catch (e) {
        console.error("Failed to clear emb log", e);
      }
    },
    onEmbLog(msg) {
      if (!msg) return;
      const el = this.$refs.embScroll;
      const atBottom =
        !el || el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      this.embLogs += (msg.endsWith("\n") ? msg : msg + "\n") + "\n";
      if (atBottom) {
        this.$nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    toggleErrs() {
      this.errsMode = !this.errsMode;
      if (this.errsMode) {
        this.showAsr = false;
        this.showInfo = false;
      }
      this.selectedName = null;
      this.selectedFiles = new Set();
      this.fetchFiles();
    },
    async clickInfo() {
      if (this.showInfo) {
        this.showInfo = false;
        return;
      }
      this.showInfo = true;
      this.showAsr = false;
      this.showFix = false;
      await this.loadInfo();
    },
    // Collect all file paths from a selection (handles folders recursively)
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
      if (this.selectedName) {
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (node) collectNode(node, null);
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
    async loadInfo() {
      this.infoText = "";
      this.infoFileName = "";
      this.infoFileMeta = "";
      this.infoMultiFiles = [];
      this.infoSelectedLine = null;
      this.infoLoading = true;

      // Collect selected file paths
      const filePaths = this.collectFilePaths();

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

      if (filePaths.length === 0) {
        // No selection
        this.infoLoading = false;
        return;
      }

      if (this.selectedName) {
        this.infoText = "Show folders are not supported.";
        this.infoLoading = false;
        return;
      }

      if (filePaths.length === 1) {
        // Single file — full mediainfo
        const relPath = filePaths[0];
        const fileName = relPath.split("/").pop();
        this.infoFileName = fileName;
        const node = this.findNodeByPath(relPath);
        let sizeStr = "";
        let dateStr = "";
        if (node && node.size != null) {
          sizeStr = this.formatFileSize(node.size);
          dateStr = (node.date || "").replace(/:\d+\.\d+$|:\d+$/, "");
          this.infoFileMeta = dateStr ? `${sizeStr} | ${dateStr}` : sizeStr;
        }
        if (!VIDEO_EXTS.has(getExt(fileName))) {
          this.infoLoading = false;
          return;
        }
        try {
          const url = `${config.torrentsApiUrl}/api/local/mediainfo`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ relPath, errsMode: this.errsMode }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          this.infoText = data.output || "";
          const subsCount = data.subsCount ?? 0;
          const srtsCount = data.srtsCount ?? 0;
          let widthStr = "";
          let rateStr = "";
          let durStr = "";
          const widthMatch = this.infoText.match(
            /^Height\s+:\s+(\d[\d\s]*)pixels/m,
          );
          if (widthMatch) {
            widthStr = widthMatch[1].replace(/\s/g, "") + " px";
          }
          const bitrateMatch = this.infoText.match(
            /^Bit rate\s+:\s+([\d\s]+kb\/s)/m,
          );
          if (bitrateMatch) {
            rateStr = bitrateMatch[1].replace(/\s(?=\d)/g, "").trim();
          }
          let bitDepthStr = "";
          const videoSecs = this.infoText.split(/\n\n+/);
          const videoSec = videoSecs.find((s) => /^Video\b/.test(s.trim()));
          if (videoSec) {
            const durLine = videoSec.match(/^Duration\s+:\s+(.+)/m);
            if (durLine) {
              const raw = durLine[1];
              const hm = raw.match(/(\d+)\s*h/);
              const mm = raw.match(/(\d+)\s*min/);
              const total =
                (hm ? parseInt(hm[1]) : 0) * 60 + (mm ? parseInt(mm[1]) : 0);
              if (total > 0) durStr = total + " min";
            }
            const bdLine = videoSec.match(/^Bit depth\s+:\s+(\d+)\s*bits/m);
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
          const subsPart = `${subsCount} sub`;
          const srtsPart = `${srtsCount} srt`;
          this.infoFileMeta += ` | ${subsPart} | ${srtsPart}`;
        } catch (e) {
          this.infoText = `Error: ${e.message}`;
        } finally {
          this.infoLoading = false;
        }
      } else {
        // Multiple files — show header list only
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
          let rStr = "";
          let dStr = "";
          if (VIDEO_EXTS.has(getExt(fileName))) {
            try {
              const url = `${config.torrentsApiUrl}/api/local/mediainfo`;
              const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ relPath, errsMode: this.errsMode }),
              });
              const data = await res.json();
              let bdStr = "";
              if (res.ok && data.output) {
                const wm = data.output.match(
                  /^Height\s+:\s+(\d[\d\s]*)pixels/m,
                );
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
              const subsPart = `${subsCount} sub`;
              const srtsPart = `${srtsCount} srt`;
              const meta =
                [sizeStr, dStr, dateStr, wStr, bdStr, rStr]
                  .filter(Boolean)
                  .join(" | ") + ` | ${subsPart} | ${srtsPart}`;
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
        this.infoLoading = false;
      }
    },
    async moveSelected() {
      if (!this.errsMode || this.selectedFiles.size === 0) return;
      const relPath = Array.from(this.selectedFiles)[0];
      this.loading = true;
      try {
        const url = `${config.torrentsApiUrl}/api/local/move-to-trial`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relPath }),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        // Select Trial & Error in the shows list first
        this.$emit("select-show", "Trial & Error");
        // Exit errs mode and refresh local pane
        this.errsMode = false;
        this.selectedName = null;
        this.selectedFiles = new Set();
        await this.fetchFiles();
        // Switch back to local pane (select-show may have navigated away)
        evtBus.emit("showLocalPane");
        // Expand and show Trial & Error/Season 1
        const trialFolder = this.tree.find((n) => n.name === "Trial & Error");
        if (trialFolder) {
          this.selectedName = trialFolder.name;
          this.$nextTick(() => {
            this.nodeRefs.forEach((cmp, name) => {
              if (name !== "Trial & Error") {
                if (typeof cmp.collapse === "function") cmp.collapse();
              } else {
                if (typeof cmp.expand === "function") cmp.expand();
              }
            });
            this.$nextTick(() => {
              const cmp = this.nodeRefs.get("Trial & Error");
              if (cmp && cmp.$el) {
                cmp.$el.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            });
          });
        }
      } catch (e) {
        console.error("Error moving file:", e);
        alert(`Error moving file: ${e.message}`);
      } finally {
        this.loading = false;
      }
    },
    handleSelectionChanged() {
      if (this.showInfo) {
        if (this._infoRefreshTimer) clearTimeout(this._infoRefreshTimer);
        this._infoRefreshTimer = setTimeout(() => {
          this.refreshInfo();
        }, 300);
      }
    },
    async refreshInfo() {
      // Re-run loadInfo without toggling off
      await this.loadInfo();
    },
  },
};
</script>
