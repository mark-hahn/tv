<template>
  <div
    style="
      overflow-y: auto;
      padding: 6px;
      font-size: 14px;
      height: 100%;
      box-sizing: border-box;
    "
  >
    <div
      v-if="loading"
      style="color: gray; padding: 10px"
    >
      Loading…
    </div>
    <div
      v-else-if="!cards.length"
      style="color: gray; padding: 10px"
    >
      No history events
    </div>
    <div v-else>
      <div
        v-for="card in cards"
        :key="card.key"
        style="
          border: 1px solid #444;
          border-radius: 6px;
          padding: 6px 8px;
          margin-bottom: 5px;
          background: #fafafa;
          cursor: pointer;
        "
        @click="toggle(card.key)"
      >
        <div
          style="
            display: flex;
            align-items: baseline;
            font-family: monospace;
            white-space: pre;
          "
        >
          <span style="color: #888; font-size: 12px"
            >{{ card.countPad }} {{ card.time }}:
          </span>
          <span
            :style="{
              color: badgeColor(card.type),
              fontWeight: 'bold',
              fontSize: '14px',
            }"
            >{{ card.typePad }}</span
          >
          <span style="font-weight: bold; font-size: 14px">{{
            card.showName
          }}</span>
        </div>
        <template v-if="expanded[card.key]">
          <div
            v-if="card.description"
            style="margin-top: 4px; color: #555; font-size: 13px"
          >
            {{ card.description }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { config } from "../config.js";

const TYPE_COLORS = {
  browse: "#6c63ff",
  preview: "#9b59b6",
  addEmby: "#27ae60",
  remEmby: "#c0392b",
  torSent: "#2980b9",
  errTor: "#e74c3c",
  addQbt: "#16a085",
  remQbt: "#d35400",
  qbtFinished: "#27ae60",
  forceDown: "#8e44ad",
  skipDown: "#95a5a6",
  rejDown: "#e67e22",
  acceptDown: "#2ecc71",
  startDown: "#3498db",
  endDown: "#1abc9c",
  errDown: "#e74c3c",
  errorSync: "#c0392b",
  bkgndUpdate: "#bdc3c7",
  reject: "#e74c3c",
  unreject: "#27ae60",
  pickup: "#2980b9",
  unpickup: "#e67e22",
  search: "#8e44ad",
  deleteShow: "#c0392b",
};

const PAD_LEN = 11;

const formatPST = (iso) => {
  if (!iso) return "";
  // iso is like "2026-03-14 10:30:00.123" already in PST
  const m = iso.match(/(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]} ${m[3]}:${m[4]}` : iso;
};

export default {
  name: "History",
  props: {
    tvdbId: { type: String, default: "" },
    showName: { type: String, default: "" },
    visible: { type: Boolean, default: false },
  },
  data() {
    return {
      events: [],
      loading: false,
      expanded: {},
    };
  },
  computed: {
    cards() {
      const out = [];
      for (const ev of this.events) {
        const uc = ev.updateCount || 0;
        out.push({
          key: String(ev.id),
          type: ev.type,
          typePad: ev.type.padEnd(PAD_LEN),
          time: formatPST(uc > 0 ? ev.updateTime : ev.addTime),
          sortMs: uc > 0 ? ev.updateTime : ev.addTime,
          sortAdd: ev.addTime,
          showName: ev.showName || "",
          description: ev.description || "",
          updateCount: uc,
          countPad: String(uc).padStart(3),
        });
      }
      out.sort((a, b) => {
        if (b.sortMs > a.sortMs) return 1;
        if (b.sortMs < a.sortMs) return -1;
        // Tiebreaker: original addTime preserves causal order (chkDown before skipDown).
        if (a.sortAdd > b.sortAdd) return 1;
        if (a.sortAdd < b.sortAdd) return -1;
        return 0;
      });
      return out;
    },
  },
  watch: {
    tvdbId() {
      if (this.visible) this.fetchHistory();
    },
    showName() {
      if (this.visible) this.fetchHistory();
    },
    visible(v) {
      if (v) {
        this.fetchHistory();
        this._startPoll();
      } else {
        this._stopPoll();
      }
    },
  },
  mounted() {
    if (this.visible) {
      this.fetchHistory();
      this._startPoll();
    }
  },
  beforeUnmount() {
    this._stopPoll();
  },
  methods: {
    badgeColor(type) {
      return TYPE_COLORS[type] || "#7f8c8d";
    },
    toggle(key) {
      this.expanded = { ...this.expanded, [key]: !this.expanded[key] };
    },
    _startPoll() {
      this._stopPoll();
      this._pollTimer = setInterval(() => this.fetchHistory(), 5000);
    },
    _stopPoll() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    },
    async fetchHistory() {
      const id = this.tvdbId;
      const name = this.showName;
      if (!id && !name) {
        this.events = [];
        return;
      }
      const isInitial = !this.events.length;
      if (isInitial) this.loading = true;
      try {
        const params = new URLSearchParams();
        if (id) params.set("tvdbId", id);
        if (name) params.set("showName", name);
        const resp = await fetch(
          `${config.tvSrvrUrl}/api/history?${params.toString()}`,
        );
        const data = await resp.json();
        const fresh = Array.isArray(data.events) ? data.events : [];
        if (JSON.stringify(fresh) !== JSON.stringify(this.events)) {
          this.events = fresh;
        }
      } catch (e) {
        console.error("History fetch error:", e);
        this.events = [];
      } finally {
        if (isInitial) this.loading = false;
      }
    },
  },
};
</script>
