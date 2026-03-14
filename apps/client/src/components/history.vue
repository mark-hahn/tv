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
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 6px 8px;
          margin-bottom: 5px;
          background: #fafafa;
        "
      >
        <div style="display: flex; align-items: center; gap: 6px">
          <span
            :style="{
              display: 'inline-block',
              padding: '1px 6px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              color: 'white',
              backgroundColor: badgeColor(card.type),
            }"
          >
            {{ card.type }}
          </span>
          <span style="color: #888; font-size: 12px">{{ card.time }}</span>
          <span
            v-if="card.updated"
            style="
              font-size: 11px;
              color: #666;
              margin-left: auto;
              white-space: nowrap;
            "
          >
            ×{{ card.updateCount }}
          </span>
        </div>
        <div
          v-if="card.showName"
          style="margin-top: 3px; font-weight: 500"
        >
          {{ card.showName }}
        </div>
        <div
          v-if="card.description"
          style="margin-top: 2px; color: #555; font-size: 13px"
        >
          {{ card.description }}
        </div>
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

const formatPST = (epochMs) => {
  const d = new Date(epochMs);
  const opts = {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
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
    };
  },
  computed: {
    cards() {
      const out = [];
      for (const ev of this.events) {
        out.push({
          key: `${ev.id}-add`,
          type: ev.type,
          time: formatPST(ev.addTime),
          sortMs: ev.addTime,
          showName: ev.showName,
          description: ev.description || "",
          updated: false,
          updateCount: 0,
        });
        if (ev.updateCount > 0 && ev.updateTime !== ev.addTime) {
          out.push({
            key: `${ev.id}-upd`,
            type: ev.type,
            time: formatPST(ev.updateTime),
            sortMs: ev.updateTime,
            showName: ev.showName,
            description: ev.description || "",
            updated: true,
            updateCount: ev.updateCount,
          });
        }
      }
      out.sort((a, b) => b.sortMs - a.sortMs);
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
