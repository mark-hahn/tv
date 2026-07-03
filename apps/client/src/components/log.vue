<template>
  <div
    v-show="active"
    class="logPane"
    style="
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 6px;
    "
  >
    <div
      class="logToolbar"
      style="
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        padding-bottom: 6px;
      "
    >
      <select
        v-model="pickerSel.mo"
        class="logSel"
        @change="onPickerChangeMo"
      >
        <option value="">Month</option>
        <option
          v-for="m in 12"
          :key="m"
          :value="m"
        >
          {{ String(m).padStart(2, "0") }}
        </option>
      </select>
      <select
        v-model="pickerSel.da"
        class="logSel"
        @change="onPickerChangeDa"
      >
        <option value="">Day</option>
        <option
          v-for="d in 31"
          :key="d"
          :value="d"
        >
          {{ String(d).padStart(2, "0") }}
        </option>
      </select>
      <select
        v-model="pickerSel.hr"
        class="logSel"
        @change="onPickerChangeHr"
      >
        <option value="">Hrs</option>
        <option
          v-for="h in 24"
          :key="h - 1"
          :value="h - 1"
        >
          {{ String(h - 1).padStart(2, "0") }}
        </option>
      </select>
      <select
        v-model="pickerSel.mi"
        class="logSel"
        @change="onPickerChange"
      >
        <option value="">Mins</option>
        <option
          v-for="m in 60"
          :key="m - 1"
          :value="m - 1"
        >
          {{ String(m - 1).padStart(2, "0") }}
        </option>
      </select>

      <button
        class="logBtn"
        @click="clearPicker"
      >
        Clr
      </button>
      <button
        class="logBtn"
        @click="scrollLeft"
      >
        ←
      </button>
      <button
        class="logBtn"
        @click="scrollRight"
      >
        →
      </button>
      <button
        class="logBtn"
        @click="scrollPageUp"
      >
        ↑
      </button>
      <button
        class="logBtn"
        @click="scrollPageDown"
      >
        ↓
      </button>
      <button
        class="logBtn"
        @click="scrollToBottom(true)"
      >
        ⇊
      </button>
      <select
        v-model="actionSel"
        class="logSel"
        @change="onAction"
      >
        <option value="">Actions</option>
        <option value="goto">Go To Selection</option>
        <option value="selectSites">Select Sites</option>
        <option value="clear">Clear Selections</option>
        <option value="hide">Hide Sites</option>
        <option value="unhide">Unhide Sites</option>
        <option value="setInfo">Set Info</option>
        <option value="setDebug">Set Debug</option>
        <option value="setWarn">Set Warn</option>
        <option value="setError">Set Error</option>
      </select>
      <span
        v-if="flashMsg"
        style="font-size: 12px; color: #2a7d2a; white-space: nowrap"
        >{{ flashMsg }}</span
      >

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
        <span v-else
          >{{ selectedCount }}/{{ displayedCount }}/{{ rowCount }}/{{
            dbTotal
          }}</span
        >
      </span>
    </div>

    <div
      ref="tableEl"
      class="logTable"
      style="flex: 1; min-height: 0"
    ></div>
  </div>
</template>

<script>
import { TabulatorFull as Tabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator.min.css";
import evtBus from "../evtBus.js";
import * as srvr from "../srvr.js";
import { unilog } from "../log.js";

const MAX_ROWS = 5000;
const PAGE = 500;

// "2026/07/01 11:44:43" -> epoch ms (local).
function tsToMs(s) {
  if (!s) return 0;
  const [d, t] = String(s).split(" ");
  const [Y, Mo, Da] = d.split("/").map(Number);
  const [H = 0, Mi = 0, Se = 0] = (t || "").split(":").map(Number);
  return new Date(Y, (Mo || 1) - 1, Da || 1, H, Mi, Se).getTime();
}
// pickerToMs from individual dropdown values (year=2026, sec=0).
// Any blank field falls back to the corresponding value from `now`.
function selToMs({ mo, da, hr, mi }) {
  const now = new Date();
  const M = mo !== "" ? Number(mo) - 1 : now.getMonth();
  const D = da !== "" ? Number(da) : now.getDate();
  const H = hr !== "" ? Number(hr) : now.getHours();
  const Mi = mi !== "" ? Number(mi) : now.getMinutes();
  return new Date(2026, M, D, H, Mi, 0).getTime();
}

export default {
  name: "LogPane",
  props: {
    active: { type: Boolean, default: false },
  },
  data() {
    return {
      table: null,
      holder: null,
      rowCount: 0,
      displayedCount: 0,
      dbTotal: 0,
      loading: false,
      error: "",
      loadedOnce: false,
      subscribed: false,
      atBottom: true,
      oldestId: null,
      newestId: null,
      loadingOlder: false,
      exhausted: false,
      pickerSel: { mo: "", da: "", hr: "", mi: "" },
      filterLevels: [],
      filterPids: [],
      pendingRows: [],
      flushTimer: null,
      selectedIds: new Set(),
      selAnchorId: null,
      selectedCount: 0,
      actionSel: "",
      flashMsg: "",
      flashTimer: null,
      appending: false,
      suppressHeaderClick: false,
      prunedWhileClosed: false,
    };
  },
  watch: {
    active(now) {
      if (now) this.activate();
      else this.deactivate();
    },
  },
  mounted() {
    evtBus.on("unilog-pruned", this.onUnilogPruned);
    if (this.active) this.activate();
  },
  beforeUnmount() {
    evtBus.off("unilog-pruned", this.onUnilogPruned);
    this.deactivate();
    if (this.table) {
      this.table.destroy();
      this.table = null;
    }
  },
  methods: {
    activate() {
      this.$nextTick(() => {
        this.ensureTable();
        if (!this.subscribed) {
          evtBus.on("unilog-event", this.onUnilogEvent);
          evtBus.on("ws-reconnected", this.onWsReconnected);
          srvr.unilogSubscribe();
          this.subscribed = true;
        }
        if (this.prunedWhileClosed) {
          this.prunedWhileClosed = false;
          this.loadedOnce = false;
          this.oldestId = null;
          this.newestId = null;
          this.exhausted = false;
          if (this.table) this.table.replaceData([]);
        }
        if (!this.loadedOnce) this.loadLogs();
      });
    },
    deactivate() {
      if (this.subscribed) {
        evtBus.off("unilog-event", this.onUnilogEvent);
        evtBus.off("ws-reconnected", this.onWsReconnected);
        srvr.unilogUnsubscribe();
        this.subscribed = false;
      }
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
      if (this.flashTimer) {
        clearTimeout(this.flashTimer);
        this.flashTimer = null;
      }
    },
    columns() {
      return [
        {
          title: "Time",
          field: "ts",
          width: 105,
          hozAlign: "center",
          formatter: (cell) => (cell.getValue() || "").replace(/^\d{4}\//, ""),
        },
        {
          title: "Message",
          field: "message",
          width: 280,
          headerFilter: "input",
        },
        {
          title: "Tag",
          field: "tag",
          width: 55,
          hozAlign: "center",
          headerFilter: "input",
        },
        {
          title: "Level",
          field: "level",
          width: 50,
          hozAlign: "center",
          headerFilter: "list",
          headerFilterParams: {
            values: this.filterLevels,
            clearable: true,
          },
        },
        {
          title: "Proj",
          field: "pid",
          width: 71,
          hozAlign: "center",
          formatter: (cell) => (cell.getValue() || "").replace(/^tv-/, ""),
          headerFilter: "list",
          headerFilterParams: {
            values: this.filterPids,
            clearable: true,
          },
        },
        {
          title: "Groups",
          field: "groups",
          width: 278,
          headerFilter: "input",
        },
        {
          title: "File",
          field: "src_file",
          width: 123,
          formatter: (cell) => (cell.getValue() || "").replace(/^apps\//, ""),
          headerFilter: "input",
        },
        {
          title: "Line",
          field: "src_line",
          width: 45,
          hozAlign: "right",
          headerFilter: "input",
        },
        {
          title: "Id",
          field: "log_id",
          width: 55,
          hozAlign: "right",
          headerFilter: "input",
          headerFilterFunc: (headerValue, rowValue) => {
            if (headerValue === "" || headerValue == null) return true;
            return String(rowValue) === String(headerValue).trim();
          },
          formatter: (cell) => {
            cell.getElement().style.paddingRight = "20px";
            return String(cell.getValue() ?? "");
          },
        },
      ];
    },
    ensureTable() {
      if (this.table || !this.$refs.tableEl) return;
      this.table = new Tabulator(this.$refs.tableEl, {
        data: [],
        index: "id",
        layout: "fitData",
        height: "100%",
        placeholder: "no log events",
        columnDefaults: { headerSort: false },
        selectableRows: false,
        columns: this.columns(),
        rowFormatter: (row) => {
          this.paintRow(row);
          // native tooltip: full value on hover (cells are cropped to one line).
          for (const cell of row.getCells()) {
            cell
              .getElement()
              .setAttribute("title", String(cell.getValue() ?? ""));
          }
        },
      });
      this.table.on("cellClick", this.onCellClick);
      this.table.on("dataFiltered", (filters, rows) => {
        this.displayedCount = rows.length;
      });
      this.table.on("tableBuilt", () => {
        this.holder = this.$refs.tableEl.querySelector(
          ".tabulator-tableholder",
        );
        if (this.holder)
          this.holder.addEventListener("scroll", this.onScroll, {
            passive: true,
          });
        // Header-filter interactions: ctrl-click clears a column's filter; a
        // second click on an open list dropdown closes it.
        const headerEl = this.$refs.tableEl.querySelector(".tabulator-header");
        if (headerEl) {
          headerEl.addEventListener("mousedown", this.onHeaderMouseDown, true);
          headerEl.addEventListener("click", this.onHeaderClick, true);
        }
        // Inject live clock into the Time column header at the bottom.
        const tsCol = this.table.getColumn("ts");
        if (tsCol) {
          const hdr = tsCol.getElement();
          hdr.style.position = "relative";
          const clock = document.createElement("div");
          clock.className = "tsClock";
          clock.style.cssText =
            "position:absolute;bottom:5px;left:9px;font-weight:normal;pointer-events:none;white-space:nowrap";
          clock.textContent = "";
          hdr.appendChild(clock);
        }
      });
    },
    onScroll() {
      if (!this.holder) return;
      const gap =
        this.holder.scrollHeight -
        this.holder.scrollTop -
        this.holder.clientHeight;
      // Hysteresis so bursts of appended rows don't transiently unpin us.
      if (gap > 60) this.atBottom = false;
      else if (gap < 24) this.atBottom = true;
      // Guard: skip loadOlder during initial data load (replaceData resets
      // scrollTop to 0) and during live row appends (addData also briefly
      // resets virtual-scroll position to 0, causing spurious triggers).
      if (this.holder.scrollTop < 80 && !this.loading && !this.appending)
        this.loadOlder();
    },
    onCellClick(e, cell) {
      const row = cell.getRow();
      // ctrl+alt: load cell value into that column's header filter.
      if (e.ctrlKey && e.altKey) {
        const def = cell.getColumn().getDefinition();
        if (!def.headerFilter) return;
        this.table.setHeaderFilterValue(
          cell.getColumn(),
          String(cell.getValue() ?? ""),
        );
        return;
      }
      // alt: copy cell value to clipboard (pink flash).
      if (e.altKey) {
        const val = String(cell.getValue() ?? "");
        navigator.clipboard.writeText(val).catch(() => {});
        const el = cell.getElement();
        const prev = el.style.backgroundColor;
        el.style.backgroundColor = "#ffb6c1";
        setTimeout(() => {
          el.style.backgroundColor = prev;
        }, 300);
        return;
      }
      // selection gestures (standard mouse selection).
      if (e.shiftKey) this.selectRange(row);
      else if (e.ctrlKey) this.toggleRow(row);
      else this.selectOnly(row);
    },
    // Paint a row: all selected rows get blue row bg; warn/error level cell
    // always shows its level color (on top of the row bg).
    paintRow(row) {
      const data = row.getData();
      const el = row.getElement();
      if (!el) return;
      const selected = this.selectedIds.has(data.id);
      el.style.backgroundColor = selected ? "#b3d4fc" : "";
      for (const cell of row.getCells()) {
        if (cell.getColumn().getField() !== "level") continue;
        const cel = cell.getElement();
        if (data.level === "error") {
          cel.style.backgroundColor = "#ffe5e5";
        } else if (data.level === "warn") {
          cel.style.backgroundColor = "#fff6d9";
        } else {
          cel.style.backgroundColor = selected ? "#b3d4fc" : "";
        }
        break;
      }
    },
    updateOldestTs() {
      if (!this.table) return;
      const rows = this.table.getRows();
      if (!rows.length) return;
      const ts = rows[0].getData().ts || "";
      // "2026/MM/DD HH:mm:ss" -> "MM/DD HH:mm"
      const label = ts.replace(/^\d{4}\//, "").replace(/:\d{2}$/, "");
      const el = this.$refs.tableEl?.querySelector(".tsClock");
      if (el) el.textContent = label;
    },
    // Map a header DOM event target to its Tabulator column.
    columnFromEvent(target) {
      if (!this.table) return null;
      for (const col of this.table.getColumns()) {
        const el = col.getElement();
        if (el && el.contains(target)) return col;
      }
      return null;
    },
    onHeaderMouseDown(e) {
      const hf = e.target.closest(".tabulator-header-filter");
      if (!hf) return;
      // ctrl-click clears the filter on that column.
      if (e.ctrlKey) {
        const col = this.columnFromEvent(e.target);
        if (col) {
          e.preventDefault();
          e.stopPropagation();
          this.suppressHeaderClick = true;
          this.table.setHeaderFilterValue(col, "");
        }
        return;
      }
      // Second click on an already-open list dropdown closes it (no reopen).
      const listOpen = document.querySelector(".tabulator-edit-list");
      if (listOpen && hf.contains(document.activeElement)) {
        e.preventDefault();
        e.stopPropagation();
        this.suppressHeaderClick = true;
        document.activeElement.blur();
      }
    },
    // Swallow the click that follows a handled mousedown so the list editor
    // doesn't reopen after we close it (or after a ctrl-clear).
    onHeaderClick(e) {
      if (this.suppressHeaderClick) {
        this.suppressHeaderClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    reformatRows(ids) {
      if (!this.table) return;
      for (const id of ids) {
        const r = this.table.getRow(id);
        if (r) r.reformat();
      }
    },
    setSelection(newSet) {
      const touched = new Set([...this.selectedIds, ...newSet]);
      this.selectedIds = newSet;
      this.selectedCount = newSet.size;
      this.reformatRows(touched);
    },
    selectOnly(row) {
      const id = row.getData().id;
      // Plain-click on the sole selected row deselects it.
      if (this.selectedIds.size === 1 && this.selectedIds.has(id)) {
        this.selAnchorId = null;
        this.setSelection(new Set());
        return;
      }
      this.selAnchorId = id;
      this.setSelection(new Set([id]));
    },
    toggleRow(row) {
      const id = row.getData().id;
      const next = new Set(this.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.selAnchorId = id;
      this.setSelection(next);
    },
    selectRange(row) {
      if (this.selAnchorId == null) {
        this.selectOnly(row);
        return;
      }
      const ids = this.table.getRows("active").map((r) => r.getData().id);
      const aIdx = ids.indexOf(this.selAnchorId);
      const tIdx = ids.indexOf(row.getData().id);
      if (aIdx === -1 || tIdx === -1) {
        this.selectOnly(row);
        return;
      }
      const [lo, hi] = aIdx <= tIdx ? [aIdx, tIdx] : [tIdx, aIdx];
      this.setSelection(new Set(ids.slice(lo, hi + 1)));
    },
    // Unique sites across the selected rows, as { id, srcFile } pairs.
    selectedSites() {
      const seen = new Map(); // log_id -> src_file
      for (const r of this.table.getRows()) {
        const d = r.getData();
        if (
          this.selectedIds.has(d.id) &&
          d.log_id != null &&
          !seen.has(d.log_id)
        )
          seen.set(d.log_id, d.src_file);
      }
      return [...seen.entries()].map(([id, srcFile]) => ({ id, srcFile }));
    },
    flash(msg) {
      this.flashMsg = msg;
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => {
        this.flashMsg = "";
        this.flashTimer = null;
      }, 2500);
    },
    async onAction() {
      const act = this.actionSel;
      this.actionSel = ""; // reset selector back to "Actions"
      if (!act || !this.table) return;
      if (act === "goto") this.gotoSelection();
      else if (act === "selectSites") this.selectSites();
      else if (act === "clear") this.setSelection(new Set());
      else if (act === "hide") await this.hideSites();
      else if (act === "unhide") await this.unhideSites();
      else if (act === "setInfo") await this.setSiteLevel("info");
      else if (act === "setDebug") await this.setSiteLevel("debug");
      else if (act === "setWarn") await this.setSiteLevel("warn");
      else if (act === "setError") await this.setSiteLevel("error");
    },
    gotoSelection() {
      const first = this.table
        .getRows("active")
        .find((r) => this.selectedIds.has(r.getData().id));
      if (!first) return;
      this.atBottom = false;
      this.table.scrollToRow(first, "top", false);
    },
    selectSites() {
      const siteIds = new Set(this.selectedSites().map((s) => s.id));
      if (!siteIds.size) return;
      const next = new Set();
      for (const r of this.table.getRows()) {
        const d = r.getData();
        if (siteIds.has(d.log_id)) next.add(d.id);
      }
      this.setSelection(next);
    },
    async hideSites() {
      const sites = this.selectedSites();
      if (!sites.length) {
        this.flash("no sites selected");
        return;
      }
      if (!import.meta.env.DEV) {
        this.flash("hide only works in vite dev");
        return;
      }
      const n = sites.length;
      if (
        !window.confirm(
          `Hide ${n} site${n === 1 ? "" : "s"}? This comments out the unilog() call(s) in source.`,
        )
      )
        return;
      await this.postSites("/__unilog/hide", sites, "hid");
    },
    async unhideSites() {
      const sites = this.selectedSites();
      if (!sites.length) {
        this.flash("no sites selected");
        return;
      }
      if (!import.meta.env.DEV) {
        this.flash("unhide only works in vite dev");
        return;
      }
      // No confirmation; does not change selection or scroll.
      await this.postSites("/__unilog/unhide", sites, "unhid");
    },
    async setSiteLevel(level) {
      const sites = this.selectedSites();
      if (!sites.length) {
        this.flash("no sites selected");
        return;
      }
      const ids = sites.map((s) => s.id);
      try {
        const res = await srvr.setUnilogSiteLevel(ids, level);
        if (res?.ok) {
          this.flash(
            `set ${res.changed} site${res.changed === 1 ? "" : "s"} to ${level}`,
          );
          // Update level field in loaded rows so coloring reflects the change.
          for (const r of this.table.getRows()) {
            const d = r.getData();
            if (ids.includes(d.log_id)) {
              r.update({ level });
            }
          }
        } else {
          this.flash(`failed: ${res?.error ?? "unknown error"}`);
        }
      } catch (err) {
        this.flash(`failed: ${err?.message || err}`);
      }
    },
    async postSites(url, sites, verb) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sites }),
        });
        const data = await res.json();
        if (data.ok) {
          const c = data.changed.length;
          this.flash(`${verb} ${c} site${c === 1 ? "" : "s"}`);
        } else {
          this.flash(`failed: ${data.error}`);
        }
      } catch (err) {
        this.flash(`failed: ${err?.message || err}`);
      }
    },
    async loadOlder() {
      if (this.loadingOlder || this.exhausted || !this.table) return;
      if (this.oldestId == null) return;
      const existing = this.table.getData();
      const room = MAX_ROWS - existing.length;
      if (room <= 0) return;
      this.loadingOlder = true;
      try {
        const pageLimit = Math.min(PAGE, room);
        const res = await srvr.getUnilogEvents({
          limit: pageLimit,
          beforeId: this.oldestId,
        });
        // server returns newest-first; display oldest-first (ascending).
        const older = (res?.events || []).slice().reverse();
        if (!older.length) {
          this.exhausted = true;
          return;
        }
        this.oldestId = older[0].id;
        // Prepend via addData(rows, true) to avoid replaceData which resets
        // the virtual-scroll offset and causes the blank-table flash.
        this.appending = true;
        try {
          await this.table.addData(older, true);
        } finally {
          this.appending = false;
        }
        this.updateOldestTs();
        this.rowCount = this.table.getDataCount();
        this.displayedCount = this.table.getDataCount("active");
        if (older.length < pageLimit) this.exhausted = true;
      } catch (err) {
        this.error = err?.message || String(err);
      } finally {
        this.loadingOlder = false;
      }
    },
    scrollToBottom(force = false) {
      if (force) this.atBottom = true;
      this.$nextTick(() => {
        if (this.holder) {
          this.holder.scrollTop = this.holder.scrollHeight;
        }
      });
    },
    scrollLeft() {
      if (this.holder) this.holder.scrollLeft = 0;
    },
    scrollRight() {
      if (this.holder) this.holder.scrollLeft = this.holder.scrollWidth;
    },
    pageRowHeight() {
      // Measure the height of an actual rendered row (reliable even with
      // Tabulator's virtual DOM). Falls back to 24 if none rendered yet.
      const rowEl = this.$refs.tableEl?.querySelector(".tabulator-row");
      return rowEl && rowEl.offsetHeight ? rowEl.offsetHeight : 24;
    },
    pageStep() {
      const rowH = this.pageRowHeight();
      const n = Math.max(3, Math.floor(this.holder.clientHeight / rowH));
      return { rowH, step: n - 2 };
    },
    scrollPageUp() {
      if (!this.holder || !this.table) return;
      const rows = this.table.getRows();
      if (!rows.length) return;
      const { rowH, step } = this.pageStep();
      const topIdx = Math.round(this.holder.scrollTop / rowH);
      const targetIdx = Math.max(0, topIdx - step);
      const savedScrollLeft = this.holder.scrollLeft;
      this.atBottom = false;
      this.table.scrollToRow(rows[targetIdx], "top", true);
      this.holder.scrollLeft = savedScrollLeft;
    },
    scrollPageDown() {
      if (!this.holder || !this.table) return;
      const rows = this.table.getRows();
      if (!rows.length) return;
      const { rowH, step } = this.pageStep();
      const topIdx = Math.round(this.holder.scrollTop / rowH);
      const targetIdx = Math.min(rows.length - 1, topIdx + step);
      const savedScrollLeft = this.holder.scrollLeft;
      this.table.scrollToRow(rows[targetIdx], "top", true);
      this.holder.scrollLeft = savedScrollLeft;
    },
    onPickerChangeMo() {
      if (this.pickerSel.mo !== "") {
        const now = new Date();
        this.pickerSel.da = now.getDate();
        this.pickerSel.hr = 0;
        this.pickerSel.mi = 0;
      }
      this.onPickerChange();
    },
    onPickerChangeDa() {
      if (this.pickerSel.da !== "") {
        this.pickerSel.hr = 0;
        this.pickerSel.mi = 0;
      }
      this.onPickerChange();
    },
    onPickerChangeHr() {
      if (this.pickerSel.hr !== "") {
        this.pickerSel.mi = 0;
      }
      this.onPickerChange();
    },
    onPickerChange() {
      this.scrollToTime(selToMs(this.pickerSel));
    },
    clearPicker() {
      this.pickerSel = { mo: "", da: "", hr: "", mi: "" };
      // Clear all column header filters.
      if (this.table) {
        for (const col of this.table.getColumns()) {
          this.table.setHeaderFilterValue(col, "");
        }
      }
      this.scrollToBottom(true);
    },
    async scrollToTime(target) {
      if (!this.table || target == null) return;
      // Page in older rows until the target time is within the loaded range
      // (or we hit the 5000-row cap / run out of history).
      let guard = 0;
      while (guard++ < 20) {
        const rows = this.table.getRows();
        if (!rows.length) return;
        if (tsToMs(rows[0].getData().ts) <= target) break;
        if (rows.length >= MAX_ROWS || this.exhausted) break;
        await this.loadOlder();
      }
      const rows = this.table.getRows();
      if (!rows.length) return;
      // First row at/after the target time; if none (target older than all
      // loaded, e.g. cap reached) this is the top row -> scroll to top.
      let found = null;
      for (const r of rows) {
        if (tsToMs(r.getData().ts) >= target) {
          found = r;
          break;
        }
      }
      if (!found) found = rows[rows.length - 1];
      this.atBottom = false;
      this.table.scrollToRow(found, "top", false);
    },
    // Re-subscribe and fill any gap after a WebSocket reconnect.
    async onWsReconnected() {
      if (!this.subscribed) return;
      srvr.unilogSubscribe();
      if (this.newestId != null) await this.loadMissed();
    },
    // Server pruned the log_events table while pane was closed; mark so
    // activate() will flush stale rows and do a fresh load.
    onUnilogPruned() {
      if (!this.active) this.prunedWhileClosed = true;
    },
    async loadMissed() {
      if (!this.table || this.newestId == null) return;
      try {
        const res = await srvr.getUnilogEvents({
          limit: PAGE,
          afterId: this.newestId,
        });
        // afterId returns oldest-first (ascending) — no need to reverse.
        const missed = res?.events || [];
        if (!missed.length) return;
        await this.appendRows(missed);
        this.dbTotal = res?.total ?? this.dbTotal;
      } catch (err) {
        this.error = err?.message || String(err);
      }
    },
    dumpWidths() {
      if (!this.table) return;
      const widths = this.table.getColumns().map((c) => ({
        field: c.getField(),
        width: Math.round(c.getWidth()),
      }));
      // eslint-disable-next-line no-console
      unilog(1126, "log column widths:", JSON.stringify(widths));
    },
    async onUnilogEvent(row) {
      if (!this.table || !row) return;
      // A header-filter list dropdown is open: buffer the row instead of
      // mutating the table, which would scroll/redraw and close the dropdown.
      if (document.querySelector(".tabulator-edit-list")) {
        this.pendingRows.push(row);
        this.scheduleFlush();
        return;
      }
      await this.appendRows([row]);
    },
    scheduleFlush() {
      if (this.flushTimer) return;
      this.flushTimer = setInterval(() => {
        if (
          !document.querySelector(".tabulator-edit-list") &&
          this.pendingRows.length
        ) {
          const buffered = this.pendingRows;
          this.pendingRows = [];
          this.appendRows(buffered);
        }
        if (!this.pendingRows.length) {
          clearInterval(this.flushTimer);
          this.flushTimer = null;
        }
      }, 500);
    },
    async appendRows(rows) {
      if (!this.table || !rows.length) return;
      const stick = this.atBottom;
      this.appending = true;
      try {
        await this.table.addData(rows, false);
      } finally {
        this.appending = false;
      }
      if (stick) {
        const all = this.table.getRows();
        if (all.length > MAX_ROWS) {
          for (let i = 0; i < all.length - MAX_ROWS; i++) all[i].delete();
        }
        this.scrollToBottom();
      }
      // Track newest id for reconnect gap-fill.
      for (const r of rows) {
        if (this.newestId == null || r.id > this.newestId) this.newestId = r.id;
      }
      this.rowCount = this.table.getDataCount();
    },
    async loadLogs() {
      this.loading = true;
      this.error = "";
      try {
        const res = await srvr.getUnilogEvents({ limit: PAGE });
        // server returns newest-first; display oldest-first (ascending).
        const events = (res?.events || []).slice().reverse();
        this.rowCount = events.length;
        this.displayedCount = events.length;
        this.dbTotal = res?.total ?? 0;
        if (Array.isArray(res?.levels)) this.filterLevels = ["", ...res.levels];
        if (Array.isArray(res?.pids))
          this.filterPids = [
            "",
            ...res.pids.map((p) => ({
              label: p.replace(/^tv-/, ""),
              value: p,
            })),
          ];
        this.oldestId = events.length ? events[0].id : null;
        this.newestId = events.length ? events[events.length - 1].id : null;
        this.exhausted = events.length < PAGE;
        this.loadedOnce = true;

        this.ensureTable();
        if (this.table) {
          // Header filters were built (in ensureTable) before the level/pid
          // lists arrived; refresh those two column defs so the list
          // dropdowns pick up the now-populated values.
          this.table.updateColumnDefinition("level", {
            headerFilterParams: { values: this.filterLevels, clearable: true },
          });
          this.table.updateColumnDefinition("pid", {
            headerFilterParams: { values: this.filterPids, clearable: true },
          });
          await this.table.replaceData(events);
          this.updateOldestTs();
        }
        this.scrollToBottom(true);
      } catch (err) {
        this.error = err?.message || String(err);
        unilog(1122, `log pane load failed: ${err?.message || err}`);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
.logBtn {
  font-size: 13px;
  cursor: pointer;
  border-radius: 7px;
  padding: 4px 10px;
  border: 1px solid #bbb;
  background-color: whitesmoke;
}
.logInput {
  font-size: 13px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid #bbb;
  background-color: white;
}
.logSel {
  font-size: 12px;
  padding: 2px 2px;
  border-radius: 5px;
  border: 1px solid #bbb;
  background-color: white;
  cursor: pointer;
}
.logTable :deep(.tabulator) {
  font-size: 12px;
}
.logTable :deep(.tabulator-row) {
  user-select: none;
}
.logTable :deep(.tabulator-cell) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.logTable :deep(.tabulator-header-filter input) {
  font-size: 80%;
  height: 64%;
  padding: 0 3px;
  box-sizing: border-box;
}
</style>
