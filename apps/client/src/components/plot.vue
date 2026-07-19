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
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import * as srvr from "../srvr.js";
import { logHere, unilog} from "../log.js"

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

// One entry per radio button; add new plots here.
const PLOTS = [
  { key: "down", label: "Down", title: "Downloads per day" },
  { key: "flex", label: "Flex", title: "Flex downloads per day" },
];

const BAR_COLOR = "#2a78d6";

// "yyyy/mm/dd" for today in PST.
function todayPst() {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
}

// Fill missing days with zero counts from the first data day through today.
function fillDays(days) {
  if (!days.length) return [];
  const counts = new Map(days.map((d) => [d.day, d.count]));
  const [y, m, d] = days[0].day.split("/").map(Number);
  const cur = new Date(y, m - 1, d);
  const last = todayPst();
  const out = [];
  for (let i = 0; i < 400; i++) {
    const day =
      `${cur.getFullYear()}/` +
      `${String(cur.getMonth() + 1).padStart(2, "0")}/` +
      `${String(cur.getDate()).padStart(2, "0")}`;
    out.push({ day, count: counts.get(day) ?? 0 });
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
    if (this.active) this.$nextTick(() => this.loadPlot());
  },
  beforeUnmount() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chart?.dispose();
    this.chart = null;
  },
  methods: {
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
        const res = await srvr.getUnilogPlotDays(this.plotSel);
        const days = fillDays(res?.days || []);
        this.ensureChart();
        this.renderChart(days);
      } catch (e) {
        this.error = e?.message || String(e);
        unilog(1569, `plot load failed: ${e.message}`);
      } finally {
        this.loading = false;
      }
    },
    renderChart(days) {
      if (!this.chart) return;
      this.chart.setOption(
        {
          grid: { left: 45, right: 20, top: 20, bottom: 40 },
          tooltip: {
            trigger: "axis",
            axisPointer: { type: "shadow" },
            formatter: (params) => {
              const p = Array.isArray(params) ? params[0] : params;
              return `${p.name}<br/>${this.plotTitle}: <b>${p.value}</b>`;
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
          series: [
            {
              type: "bar",
              data: days.map((d) => d.count),
              barMaxWidth: 28,
              itemStyle: {
                color: BAR_COLOR,
                borderRadius: [4, 4, 0, 0],
              },
            },
          ],
        },
        true,
      );
      this.chart.resize();
    },
  },
};
</script>
