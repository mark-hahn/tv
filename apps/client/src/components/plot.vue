<template>
  <div
    id="plot"
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
        gap: 18px;
        padding: 5px 10px;
        background-color: #fafafa;
      "
    >
      <span>Plots</span>
      <label
        v-for="p in plots"
        :key="p.key"
        style="
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 14px;
          font-weight: normal;
          cursor: pointer;
        "
      >
        <input
          type="radio"
          name="plotSel"
          :value="p.key"
          v-model="plotSel"
          style="cursor: pointer"
        />
        {{ p.label }}
      </label>
      <span
        style="
          margin-left: auto;
          font-size: 12px;
          color: #666;
          white-space: nowrap;
        "
      >
        <span v-if="loading">loading…</span>
        <span
          v-else-if="error"
          style="color: #c00"
          >{{ error }}</span
        >
        <span v-else>{{ plotTitle }}</span>
      </span>
    </div>
    <div
      ref="chartEl"
      style="flex: 1 1 auto; min-height: 0; min-width: 0"
    ></div>
  </div>
</template>

<script>
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import * as srvr from "../srvr.js";
import evtBus from "../evtBus.js";
import { logHere, unilog} from "../log.js"

echarts.use([
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

// Categorical slots, assigned in fixed order (blue, green).
const SERIES_COLORS = ["#2a78d6", "#008300"];
const SURFACE = "#fafafa"; // pane background — draws the gap between segments

// One entry per radio button; add new plots here. `series` lists the per-day
// fields the server returns; more than one stacks them. `usb` plots scan the
// usb server instead of querying the unilog db.
const PLOTS = [
  {
    key: "down",
    label: "Down",
    title: "Downloads per day",
    series: [
      { field: "tor", name: "Tor" },
      { field: "flex", name: "Flex" },
    ],
  },
  {
    key: "shows",
    label: "Shows",
    title: "Usb shows per day",
    usb: true,
    series: [{ field: "count", name: "Shows" }],
  },
];

// "yyyy/mm/dd" for today in PST.
function todayPst() {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
}

// Fill missing days with zero counts from the first data day through today.
function fillDays(days, fields) {
  if (!days.length) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const [y, m, d] = days[0].day.split("/").map(Number);
  const cur = new Date(y, m - 1, d);
  const last = todayPst();
  const out = [];
  for (let i = 0; i < 400; i++) {
    const day =
      `${cur.getFullYear()}/` +
      `${String(cur.getMonth() + 1).padStart(2, "0")}/` +
      `${String(cur.getDate()).padStart(2, "0")}`;
    const row = byDay.get(day);
    const filled = { day };
    for (const f of fields) filled[f] = row?.[f] ?? 0;
    out.push(filled);
    if (day >= last) break;
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default {
  name: "PlotPane",
  props: {
    active: { type: Boolean, default: false },
  },
  data() {
    return {
      plots: PLOTS,
      plotSel: PLOTS[0].key,
      loading: false,
      error: "",
      chart: null,
      resizeObserver: null,
    };
  },
  computed: {
    plotTitle() {
      return this.plots.find((p) => p.key === this.plotSel)?.title || "";
    },
  },
  watch: {
    active(now) {
      if (now) this.$nextTick(() => this.loadPlot());
    },
    plotSel() {
      this.loadPlot();
    },
  },
  mounted() {
    evtBus.on("plotArrowKey", this.onPlotArrowKey);
    if (this.active) this.$nextTick(() => this.loadPlot());
  },
  beforeUnmount() {
    evtBus.off("plotArrowKey", this.onPlotArrowKey);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chart?.dispose();
    this.chart = null;
  },
  methods: {
    // Keyboard left/right arrow — step through the plot radio buttons.
    onPlotArrowKey(dir) {
      const idx = this.plots.findIndex((p) => p.key === this.plotSel);
      if (idx === -1) return;
      const next = dir === "left" ? idx - 1 : idx + 1;
      if (next < 0 || next >= this.plots.length) return;
      this.plotSel = this.plots[next].key;
    },
    ensureChart() {
      if (this.chart || !this.$refs.chartEl) return;
      this.chart = echarts.init(this.$refs.chartEl);
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(this.$refs.chartEl);
    },
    async loadPlot() {
      this.loading = true;
      this.error = "";
      try {
        const plot = this.plots.find((p) => p.key === this.plotSel);
        const res = plot?.usb
          ? await srvr.getUsbFileDays()
          : await srvr.getUnilogPlotDays(this.plotSel);
        const fields = plot.series.map((s) => s.field);
        const days = fillDays(res?.days || [], fields);
        this.ensureChart();
        this.renderChart(days, plot.series);
      } catch (e) {
        this.error = e?.message || String(e);
        unilog(1569, `plot load failed: ${e.message}`);
      } finally {
        this.loading = false;
      }
    },
    renderChart(days, series) {
      if (!this.chart) return;
      const stacked = series.length > 1;
      this.chart.setOption(
        {
          grid: { left: 45, right: 20, top: stacked ? 40 : 20, bottom: 40 },
          legend: stacked
            ? {
                top: 8,
                itemWidth: 10,
                itemHeight: 10,
                textStyle: { color: "#666", fontSize: 12 },
              }
            : { show: false },
          tooltip: {
            trigger: "axis",
            axisPointer: { type: "shadow" },
            formatter: (params) => {
              const ps = Array.isArray(params) ? params : [params];
              if (!stacked)
                return `${ps[0].name}<br/>${this.plotTitle}: <b>${ps[0].value}</b>`;
              const rows = ps
                .map((p) => `${p.marker}${p.seriesName}: <b>${p.value}</b>`)
                .join("<br/>");
              const total = ps.reduce((n, p) => n + (p.value || 0), 0);
              return `${ps[0].name}<br/>${rows}<br/>Total: <b>${total}</b>`;
            },
          },
          xAxis: {
            type: "category",
            data: days.map((d) => d.day.slice(5)), // "mm/dd"
            axisTick: { alignWithLabel: true },
            axisLine: { lineStyle: { color: "#bbb" } },
            axisLabel: { color: "#666", fontSize: 11 },
          },
          yAxis: {
            type: "value",
            minInterval: 1,
            axisLabel: { color: "#666", fontSize: 11 },
            splitLine: { lineStyle: { color: "#e8e8e8" } },
          },
          series: series.map((s, i) => ({
            name: s.name,
            type: "bar",
            stack: stacked ? "total" : undefined,
            data: days.map((d) => d[s.field]),
            barMaxWidth: 28,
            itemStyle: {
              color: SERIES_COLORS[i],
              // Round only the top of the stack; a surface-colored border
              // leaves a gap between stacked segments.
              borderRadius: i === series.length - 1 ? [4, 4, 0, 0] : 0,
              borderColor: SURFACE,
              borderWidth: stacked ? 2 : 0,
            },
          })),
        },
        true,
      );
      this.chart.resize();
    },
  },
};
</script>
