<template>
  <div
    id="queues"
    style="
      height: 100%;
      width: 100%;
      padding: 5px;
      margin: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      max-width: 100%;
      box-sizing: border-box;
      background-color: #fafafa;
    "
  >
    <div
      class="pane-header-title"
      style="
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 10px;
        background-color: #fafafa;
      "
    >
      <span>Queues</span>
      <button
        v-for="q in queueDefs"
        :key="q.key"
        :disabled="countOf(q.key) === 0"
        @click="toggle(q.key)"
        :style="{
          padding: '2px 10px',
          fontFamily: 'sans-serif',
          cursor: countOf(q.key) === 0 ? 'default' : 'pointer',
          opacity: countOf(q.key) === 0 ? 0.4 : 1,
          border:
            selected === q.key ? '2px solid #333' : '1px solid #999',
          borderRadius: '4px',
          backgroundColor: selected === q.key ? 'lightgray' : 'whitesmoke',
        }"
      >
        {{ q.label }} {{ countOf(q.key) }}
      </button>
      <button
        @click="selClick"
        :disabled="!selectedPath"
        :style="{
          marginLeft: '20px',
          padding: '2px 10px',
          fontFamily: 'sans-serif',
          cursor: selectedPath ? 'pointer' : 'default',
          opacity: selectedPath ? 1 : 0.4,
          border: '1px solid #999',
          borderRadius: '4px',
          backgroundColor: selFlash ? 'orange' : 'whitesmoke',
        }"
      >
        Sel
      </button>
      <span
        style="
          margin-left: auto;
          font-size: 14.4px;
          color: #666;
          white-space: nowrap;
        "
      >
        <span v-if="error">{{ error }}</span>
      </span>
    </div>

    <div v-if="selected" style="flex: 1 1 auto; overflow: auto; padding: 0 10px">
      <!-- In-flight status of entry 1 -->
      <div
        v-if="inflight"
        style="
          margin: 6px 0 10px 0;
          padding: 6px 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background-color: #fff;
          font-size: 15.6px;
        "
      >
        <div style="font-weight: bold">
          {{ inflight.stage }}
          <span v-if="hasEta && inflight.remainingSecs !== undefined">
            — {{ mmss(inflight.remainingSecs) }} left
          </span>
          <span style="font-weight: normal; color: #666">
            ({{ mmss(inflight.elapsedSecs) }} elapsed)
          </span>
        </div>
        <div style="color: #444; word-break: break-all">
          {{ inflight.file }}
        </div>
      </div>
      <!-- ChkSrt is a review queue with nothing ever running on the server, so
           the idle line would be noise there. -->
      <div
        v-else-if="selected !== 'chksrt'"
        style="margin: 6px 0 10px 0; font-size: 15.6px; color: #666"
      >
        nothing running
      </div>

      <!-- Queue entries, head first -->
      <div
        v-for="e in entries"
        :key="e.n + ':' + e.path"
        @click="lineClick($event, e)"
        :style="{
          display: 'flex',
          gap: '10px',
          alignItems: 'baseline',
          padding: '2px 0',
          fontSize: selected === 'chksrt' ? '18.7px' : '15.6px',
          borderBottom: '1px solid #eee',
          cursor: 'pointer',
          backgroundColor:
            e.path === copyFlashPath
              ? 'orange'
              : e.path === selectedPath
                ? '#fffacd'
                : 'transparent',
        }"
      >
        <span
          style="
            flex: 0 0 auto;
            width: 30px;
            text-align: right;
            color: #666;
          "
          >{{ e.n }}.</span
        >
        <span
          v-if="hasEta"
          style="
            flex: 0 0 auto;
            width: 70px;
            font-family: monospace;
            color: #036;
          "
          >{{ clock(e.etaMs) }}</span
        >
        <span
          :style="{
            flex: '1 1 auto',
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontWeight: e.running ? 'bold' : 'normal',
          }"
          >{{ e.file }}</span
        >
      </div>
    </div>
  </div>
</template>

<script>
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import evtBus from "../evtBus.js";
import { logHere } from "../log.js";

const POLL_MS = 1000;
const FLASH_MS = 300;

export default {
  name: "Queues",
  props: {
    active: { type: Boolean, default: false },
  },
  data() {
    return {
      selected: null,
      selectedPath: null,
      selFlash: false,
      copyFlashPath: null,
      error: "",
      data: { sub: null, asr: null, mp4: null, chksrt: null },
      queueDefs: [
        { key: "sub", label: "Sub" },
        { key: "asr", label: "Asr" },
        { key: "mp4", label: "Mp4" },
        { key: "chksrt", label: "ChkSrt" },
      ],
      timer: null,
    };
  },
  computed: {
    // Sub has no ETA — its cost is fixed overhead plus an external API with
    // retries, so there is nothing about the file to predict from.
    hasEta() {
      return this.selected === "asr" || this.selected === "mp4";
    },
    entries() {
      return this.data[this.selected]?.entries || [];
    },
    inflight() {
      return this.data[this.selected]?.inflight || null;
    },
  },
  watch: {
    active(on) {
      if (on) this.start();
      else this.stop();
    },
  },
  mounted() {
    if (this.active) this.start();
  },
  beforeUnmount() {
    this.stop();
  },
  methods: {
    countOf(key) {
      return this.data[key]?.count || 0;
    },
    // Select-only: one enabled queue is always the selected one, so there is no
    // deselect.
    toggle(key) {
      if (this.countOf(key) === 0) return;
      if (key !== this.selected) this.selectedPath = null;
      this.selected = key;
    },
    // Alt-click copies the line's path, like the other panes; plain click
    // selects.
    lineClick(event, e) {
      if (event?.altKey) {
        navigator.clipboard
          .writeText(util.shellQuote(e.path))
          .catch((err) => logHere({ lvl: "error" }, `copy failed: ${err}`));
        this.copyFlashPath = e.path;
        setTimeout(() => {
          this.copyFlashPath = null;
        }, FLASH_MS);
        return;
      }
      this.toggleLine(e);
    },
    // One line at a time, click toggles it off again.
    toggleLine(e) {
      this.selectedPath = this.selectedPath === e.path ? null : e.path;
    },
    // Queue paths are <media root>/<Show Name>/Season N/<file>, so the show is
    // the directory above the season one. Anything that doesn't fit falls back
    // to the file name, which selectShowFromCardTitle parses as a torrent title.
    showNameOfPath(p) {
      const parts = String(p || "").split("/");
      const file = parts.pop() || "";
      const parent = parts.pop() || "";
      if (/^season\b/i.test(parent)) return parts.pop() || file;
      return parent || file;
    },
    selClick() {
      if (!this.selectedPath) return;
      this.selFlash = true;
      setTimeout(() => {
        this.selFlash = false;
      }, FLASH_MS);
      const name = this.showNameOfPath(this.selectedPath);
      if (name) evtBus.emit("selectShowFromCardTitle", name);
    },
    start() {
      this.fetchOnce();
      if (!this.timer) this.timer = setInterval(this.fetchOnce, POLL_MS);
    },
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    },
    async fetchOnce() {
      try {
        const d = await srvr.getQueues();
        this.data = d;
        this.error = "";
        // A queue that drains while selected drops the selection, and any other
        // non-empty queue takes over — the pane is never blank while there is
        // something to show.
        if (this.selected && this.countOf(this.selected) === 0) {
          this.selected = null;
        }
        const live = this.queueDefs
          .map((q) => q.key)
          .filter((k) => this.countOf(k) > 0);
        if (!this.selected && live.length) this.selected = live[0];
        // A line that leaves the queue takes its selection with it.
        if (
          this.selectedPath &&
          !this.entries.some((e) => e.path === this.selectedPath)
        ) {
          this.selectedPath = null;
        }
      } catch (e) {
        this.error = e?.message || "fetch failed";
      }
    },
    // m:ss with an unbounded minutes field.
    mmss(secs) {
      const s = Math.max(0, Math.round(Number(secs) || 0));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    },
    // Wall-clock finish time, LA. hourCycle h23 so midnight is 00, never 24.
    clock(ms) {
      if (!ms) return "";
      return new Date(ms).toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    },
  },
};
</script>
