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
        <div style="font-size: 16px; font-weight: bold; display: flex; gap: 6px; align-items: baseline">
          <span
            :style="{ color: badgeColor(card.type), fontFamily: 'monospace', whiteSpace: 'pre' }"
          >{{ card.typePad }}</span>
          <span>{{ card.showName }}</span>
          <span style="color: #888; margin-left: auto; white-space: nowrap">{{ card.time }}<template v-if="card.updateCount > 0">({{ card.updateCount }})</template></span>
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
  chkDown: "#7f8c8d",
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
          showName: ev.showName || "",
          description: ev.description || "",
          updateCount: uc,
        });
      }
      out.sort((a, b) =>
        b.sortMs > a.sortMs ? 1 : b.sortMs < a.sortMs ? -1 : 0,
      );
      return out;
    },
  },
  watch: {
    tvdbId() {
      this.fetchHistory();
    },
    showName() {
      this.fetchHistory();
    },
  },
  mounted() {
    this.fetchHistory();
  },
  methods: {
    badgeColor(type) {
      return TYPE_COLORS[type] || "#7f8c8d";
    },
    toggle(key) {
      this.expanded = { ...this.expanded, [key]: !this.expanded[key] };
    },
    async fetchHistory() {
      const id = this.tvdbId;
      const name = this.showName;
      if (!id && !name) {
        this.events = [];
        return;
      }
      this.loading = true;
      try {
        const params = new URLSearchParams();
        if (id) params.set("tvdbId", id);
        if (name) params.set("showName", name);
        const resp = await fetch(
          `${config.tvSrvrUrl}/api/history?${params.toString()}`,
        );
        const data = await resp.json();
        this.events = Array.isArray(data.events) ? data.events : [];
      } catch (e) {
        console.error("History fetch error:", e);
        this.events = [];
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
