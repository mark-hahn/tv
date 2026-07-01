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
      <button
        class="logBtn"
        @click="scrollToBottom(true)"
      >
        ↓ Bottom
      </button>

      <select
        v-model="pickerSel.mo"
        class="logSel"
        @change="onPickerChange"
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
        @change="onPickerChange"
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
        @change="onPickerChange"
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

      <span style="font-size: 12px; color: #666">
        <span v-if="loading">loading…</span>
        <span
          v-else-if="error"
          style="color: #c00"
          >{{ error }}</span
        >
        <span v-else>{{ rowCount }} rows{{ atBottom ? " · live" : "" }}</span>
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
      loading: false,
      error: "",
      loadedOnce: false,
      subscribed: false,
      atBottom: true,
      oldestId: null,
      loadingOlder: false,
      exhausted: false,
      pickerSel: { mo: "", da: "", hr: "", mi: "" },
    };
  },
  watch: {
    active(now) {
      if (now) this.activate();
      else this.deactivate();
    },
  },
  mounted() {
    if (this.active) this.activate();
  },
  beforeUnmount() {
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
          srvr.unilogSubscribe();
          this.subscribed = true;
        }
        if (!this.loadedOnce) this.loadLogs();
      });
    },
    deactivate() {
      if (this.subscribed) {
        evtBus.off("unilog-event", this.onUnilogEvent);
        srvr.unilogUnsubscribe();
        this.subscribed = false;
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
          headerFilter: "input",
        },
        {
          title: "Proj",
          field: "pid",
          width: 71,
          hozAlign: "center",
          formatter: (cell) => (cell.getValue() || "").replace(/^tv-/, ""),
          headerFilter: "input",
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
          field: "id",
          width: 45,
          hozAlign: "right",
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
        columns: this.columns(),
        rowFormatter: (row) => {
          const data = row.getData();
          const el = row.getElement();
          if (data.level === "error") el.style.backgroundColor = "#ffe5e5";
          else if (data.level === "warn") el.style.backgroundColor = "#fff6d9";
          else el.style.backgroundColor = "";
          // native tooltip: full value on hover (cells are cropped to one line).
          for (const cell of row.getCells()) {
            cell
              .getElement()
              .setAttribute("title", String(cell.getValue() ?? ""));
          }
        },
      });
      this.table.on("cellClick", this.onCellClick);
      this.table.on("tableBuilt", () => {
        this.holder = this.$refs.tableEl.querySelector(
          ".tabulator-tableholder",
        );
        if (this.holder)
          this.holder.addEventListener("scroll", this.onScroll, {
            passive: true,
          });
      });
    },
    onScroll() {
      if (!this.holder) return;
      const gap =
        this.holder.scrollHeight -
        this.holder.scrollTop -
        this.holder.clientHeight;
      this.atBottom = gap < 24;
      if (this.holder.scrollTop < 80) this.loadOlder();
    },
    onCellClick(e, cell) {
      const def = cell.getColumn().getDefinition();
      if (!def.headerFilter) return;
      this.table.setHeaderFilterValue(
        cell.getColumn(),
        String(cell.getValue() ?? ""),
      );
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
        await this.table.addData(older, true);
        this.rowCount = this.table.getDataCount();
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
        if (this.holder) this.holder.scrollTop = this.holder.scrollHeight;
      });
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
    dumpWidths() {
      if (!this.table) return;
      const widths = this.table.getColumns().map((c) => ({
        field: c.getField(),
        width: Math.round(c.getWidth()),
      }));
      // eslint-disable-next-line no-console
      console.log("log column widths:", JSON.stringify(widths));
    },
    async onUnilogEvent(row) {
      if (!this.table || !row) return;
      const stick = this.atBottom;
      await this.table.addData([row], false);
      if (stick) {
        const rows = this.table.getRows();
        if (rows.length > MAX_ROWS) {
          for (let i = 0; i < rows.length - MAX_ROWS; i++) rows[i].delete();
        }
        this.scrollToBottom();
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
        this.oldestId = events.length ? events[0].id : null;
        this.exhausted = events.length < PAGE;
        this.loadedOnce = true;

        this.ensureTable();
        if (this.table) await this.table.replaceData(events);
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
