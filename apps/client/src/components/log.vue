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
    @click.capture="onLogPaneCaptureWhileChannelsOpen"
    @change.capture="onLogPaneCaptureWhileChannelsOpen"
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
        <option value="refresh">Refresh</option>
        <option value="editor">Editor</option>
        <option value="goto">Go To Selection</option>
        <option value="copyIds">Copy Select Ids</option>
        <option value="clear">Clear Selections</option>
        <option value="selectSites">Select Sites</option>
        <option value="channels">Channels</option>
        <option value="setInfo">Set Info</option>
        <option value="setDebug">Set Debug</option>
        <option value="setWarn">Set Warn</option>
        <option value="setError">Set Error</option>
      </select>
      <button
        class="logBtn"
        @click="toggleGroupsPane"
      >
        Grp
      </button>
      <button
        class="logBtn"
        :disabled="selHistoryIdx <= 0"
        @click="selHistoryPrev"
      >
        Prv
      </button>
      <button
        class="logBtn"
        :disabled="selHistoryIdx >= selHistory.length - 1"
        @click="selHistoryNext"
      >
        Nxt
      </button>
      <span
        v-if="selectedCount"
        style="
          font-size: 16px;
          font-weight: bold;
          color: lightcoral;
          white-space: nowrap;
        "
        >Sel: {{ selectedCount }}</span
      >
      <span
        v-if="flashMsg"
        style="font-size: 14.4px; color: #c0392b; white-space: nowrap"
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
      v-show="!showChannelsPane"
      ref="tableEl"
      class="logTable"
      style="flex: 1; min-height: 0"
    ></div>

    <div
      v-if="showChannelsPane"
      class="channelsPane"
      style="flex: 1; min-height: 0; overflow: auto"
    >
      <pre style="font-size: 13px; margin: 0; white-space: pre-wrap">{{
        channelsDebugText
      }}</pre>
    </div>

    <Teleport to="body">
      <div
        v-show="showGroupsPane"
        class="groupsPane"
        :style="groupPaneStyle"
      >
        <div class="groupsCol groupsListCol">
          <div class="groupsTitle">Groups</div>
          <select
            v-model="selectedGroupIds"
            class="groupsList"
            multiple
          >
            <option
              v-for="g in groups"
              :key="g.group_id"
              :value="g.group_id"
            >
              {{ groupLabel(g) }}
            </option>
          </select>
        </div>

        <div class="groupsCol groupsCtrlCol">
          <label
            class="groupsRow"
            :class="{ groupsDisabled: !selectedGroupIds.length }"
          >
            <input
              type="checkbox"
              v-model="filterByGroups"
              :disabled="!selectedGroupIds.length"
              @change="applyGroupFilter"
            />
            Filter
            <button
              class="logBtn"
              style="margin-left: auto"
              @click="showGroupsPane = false"
            >
              X
            </button>
          </label>

          <button
            class="logBtn"
            @click="selectOrphans"
          >
            Orphans
          </button>

          <div class="groupsRow">
            <input
              v-model="newGroupName"
              class="logInput groupsInput"
              placeholder="new group name"
              @keyup.enter="addGroup"
            />
            <button
              class="logBtn"
              :disabled="!newGroupName.trim()"
              @click="addGroup"
            >
              Add Group
            </button>
          </div>

          <button
            class="logBtn"
            :disabled="!selectedGroupIds.length"
            @click="deleteGroupsAction"
          >
            Delete Selected
          </button>

          <div class="groupsRow">
            <button
              class="logBtn"
              :disabled="!selectedGroupIds.length || !selectedSiteCount"
              @click="assignGroups"
            >
              Assign
            </button>
            <button
              class="logBtn"
              :disabled="!selectedGroupIds.length || !selectedSiteCount"
              @click="removeGroups"
            >
              Remove
            </button>
          </div>

          <div class="groupsRow">
            <button
              class="logBtn"
              :disabled="!selectedGroupIds.length || !selectedSiteCount"
              @click="replaceGroups"
            >
              Replace
            </button>
            <button
              class="logBtn"
              :disabled="!selectedSiteCount"
              @click="selectEventGroups"
            >
              Sel
            </button>
          </div>

          <div class="groupsRow">
            <button
              class="logBtn"
              :disabled="!selectedGroupIds.length"
              @click="showGroupEvents"
            >
              Show
            </button>
            <button
              class="logBtn"
              :disabled="!selectedGroupIds.length"
              @click="unshowGroupEvents"
            >
              Hide
            </button>
          </div>

          <div class="groupsRow">
            <input
              v-model="setGroupName"
              class="logInput groupsInput"
              placeholder="name"
              @keyup.enter="applySetName"
            />
            <button
              class="logBtn"
              :disabled="
                selectedGroupIds.length !== 1 ||
                !setGroupName.trim() ||
                groupNameExists
              "
              @click="applySetName"
            >
              Set Name
            </button>
          </div>

          <div
            v-if="groupStats"
            class="groupsRow"
          >
            Sites: {{ groupStats.sites }}, Events: {{ groupStats.events }}
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { markRaw } from "vue";
import { TabulatorFull as Tabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator.min.css";
import evtBus from "../evtBus.js";
import * as srvr from "../srvr.js";
import { unilog, logHere } from "../log.js";
// renderVertical "basic" (see ensureTable) keeps every loaded row in the DOM,
// so the cost of rebuilding the table grows faster than linearly with this cap
// and it bounds how long a groups-pane Show/Hide takes. Measured reload times
// at this row count: 500 -> 0.4s, 1000 -> 0.8s, 2000 -> 2.8s, 5000 -> 20s.
const MAX_ROWS = 1000;
const PAGE = 500;
// Let the table drift this far past MAX_ROWS before trimming, then trim the
// whole overflow in one batched delete. Trimming a few rows on every 500ms
// live-append flush made each flush do several full Tabulator redraws of the
// (up to MAX_ROWS) table — the multi-second main-thread blocks seen while
// sitting in the log pane, self-sustained because those blocks log events
// that stream right back into this same table.
const TRIM_MARGIN = 250;

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
      selHistory: [[]],
      selHistoryIdx: 0,
      actionSel: "",
      flashMsg: "",
      flashTimer: null,
      appending: false,
      suppressHeaderClick: false,
      prunedWhileClosed: false,
      showGroupsPane: false,
      groups: [],
      selectedGroupIds: [],
      selectedSiteCount: 0,
      newGroupName: "",
      setGroupName: "",
      filterByGroups: false,
      groupFilterIds: new Set(),
      groupFilterFn: null,
      groupPaneStyle: {},
      groupStats: null,
      showChannelsPane: false,
      ignorePaneEvent: false,
      channelsDebug: [],
      channelsDebugHandle: null,
    };
  },
  computed: {
    channelsDebugText() {
      if (!Array.isArray(this.channelsDebug) || this.channelsDebug.length === 0)
        return "No channels.";
      const fmtTs = (ts) => {
        if (!ts) return "-";
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${hh}:${mm}:${ss}`;
      };
      return this.channelsDebug
        .map(
          (c) =>
            `${c.name.padEnd(18)} owner=${String(c.owner).padEnd(5)} subs=${String(c.subscribers).padStart(2)} peer=${c.peerOpen === null ? "-" : c.peerOpen ? "open" : "closed"} sub=${fmtTs(c.lastSubAt)} snap=${fmtTs(c.lastSnapshotAt)} delta=${fmtTs(c.lastDeltaAt)}`,
        )
        .join("\n");
    },
    // True when another group already uses the Set-name input value.
    groupNameExists() {
      const name = this.setGroupName.trim().toLowerCase();
      if (!name) return false;
      const selId = this.selectedGroupIds[0];
      return this.groups.some(
        (g) =>
          g.group_id !== selId && (g.description || "").toLowerCase() === name,
      );
    },
  },
  watch: {
    active(now) {
      if (now) this.activate();
      else this.deactivate();
    },
    selectedGroupIds() {
      if (!this.selectedGroupIds.length) this.filterByGroups = false;
      this.applyGroupFilter();
      this.refreshGroupStats();
    },
  },
  mounted() {
    evtBus.on("unilog-pruned", this.onUnilogPruned);
    if (this.active) this.activate();
  },
  beforeUnmount() {
    evtBus.off("unilog-pruned", this.onUnilogPruned);
    this.stopChannelsDebug();
    this.deactivate();
    if (this.table) {
      this.table.destroy();
      this.table = null;
    }
  },
  methods: {
    // Any click or dropdown change while the channels pane is open just
    // closes it — it must never also perform the click's/change's own action.
    onLogPaneCaptureWhileChannelsOpen(e) {
      if (!this.showChannelsPane) return;
      // Skip the trailing click of the dropdown pick that opened the pane.
      if (this.ignorePaneEvent) {
        this.ignorePaneEvent = false;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.closeChannelsPane();
    },
    openChannelsPane() {
      this.showGroupsPane = false;
      this.showChannelsPane = true;
      // Picking the option fires change (which lands here) and then click on
      // the same select; that click must not close the pane we just opened.
      this.ignorePaneEvent = true;
      setTimeout(() => {
        this.ignorePaneEvent = false;
      }, 0);
      this.startChannelsDebug();
    },
    closeChannelsPane() {
      this.showChannelsPane = false;
      this.stopChannelsDebug();
    },
    startChannelsDebug() {
      if (this.channelsDebugHandle) return;
      const apply = (payload) => {
        this.channelsDebug = Array.isArray(payload) ? payload : [];
      };
      this.channelsDebugHandle = srvr.openChannel("channelsDebug", {
        onSnapshot: apply,
        onDelta: apply,
      });
    },
    stopChannelsDebug() {
      this.channelsDebugHandle?.close();
      this.channelsDebugHandle = null;
    },
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
      // Groups pane is hidden whenever the log pane is opened.
      this.showGroupsPane = false;
      window.addEventListener("resize", this.positionGroupsPane);
    },
    deactivate() {
      if (this.subscribed) {
        evtBus.off("unilog-event", this.onUnilogEvent);
        evtBus.off("ws-reconnected", this.onWsReconnected);
        srvr.unilogUnsubscribe();
        this.subscribed = false;
      }
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      if (this.flashTimer) {
        clearTimeout(this.flashTimer);
        this.flashTimer = null;
      }
      // Groups pane is hidden whenever the log pane is closed; stop filtering.
      this.showGroupsPane = false;
      this.closeChannelsPane();
      window.removeEventListener("resize", this.positionGroupsPane);
      this.applyGroupFilter();
    },
    columns() {
      // "-" alone in a header filter box matches only blank values.
      const isBlank = (rowValue) =>
        rowValue == null || String(rowValue).trim() === "";
      const likeOrBlank = (headerValue, rowValue) => {
        const hv = String(headerValue ?? "").trim();
        if (hv === "") return true;
        if (hv === "-") return isBlank(rowValue);
        return String(rowValue ?? "")
          .toLowerCase()
          .includes(hv.toLowerCase());
      };
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
          width: 400,
          headerFilter: "input",
          headerFilterFunc: likeOrBlank,
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
          width: 139,
          headerFilter: "input",
          headerFilterFunc: likeOrBlank,
        },
        {
          title: "File",
          field: "src_file",
          width: 300,
          formatter: (cell) => `/root/apps/tv/${cell.getValue() || ""}`,
          headerFilter: "input",
          headerFilterFunc: likeOrBlank,
        },
        {
          title: "Line",
          field: "src_line",
          width: 45,
          hozAlign: "right",
          headerFilter: "input",
          headerFilterFunc: likeOrBlank,
        },
        {
          title: "Id",
          field: "id",
          width: 55,
          hozAlign: "right",
          headerFilter: "input",
          headerFilterFunc: (headerValue, rowValue) => {
            if (headerValue === "" || headerValue == null) return true;
            if (String(headerValue).trim() === "-") return isBlank(rowValue);
            return String(rowValue) === String(headerValue).trim();
          },
        },
        {
          title: "Log Id",
          field: "log_id",
          width: 55,
          hozAlign: "right",
          headerFilter: "input",
          headerFilterFunc: (headerValue, rowValue) => {
            if (headerValue === "" || headerValue == null) return true;
            if (String(headerValue).trim() === "-") return isBlank(rowValue);
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
      // markRaw: without it Vue's data() reactivity wraps the Tabulator
      // instance — and every row, cell and column reached through it — in
      // reactive Proxies, which made every rebuild ~6x slower (measured at
      // MAX_ROWS: 5.4s wrapped vs 0.8s raw).
      this.table = markRaw(
        new Tabulator(this.$refs.tableEl, {
          data: [],
          index: "id",
          layout: "fitData",
          height: "100%",
          // The log rows are fixed-height; using the basic renderer avoids the
          // virtual DOM's top-padding estimates that made upward scroll jump.
          renderVertical: "basic",
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
        }),
      );
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
      // Guard: skip loadOlder during initial data load and live appends, when
      // table mutations can briefly reset scrollTop to 0.
      const canScroll = this.holder.scrollHeight > this.holder.clientHeight + 1;
      if (
        canScroll &&
        this.holder.scrollTop < 80 &&
        !this.loading &&
        !this.appending
      )
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
        let val = String(cell.getValue() ?? "");
        // For File column, prepend full path.
        if (cell.getColumn().getField() === "src_file") {
          val = `/root/apps/tv/${val}`;
        }
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
      const gesture = e.shiftKey ? "shift" : e.ctrlKey ? "ctrl" : "plain";
      unilog(
        1618,
        `${gesture} click row ${row.getData().id}, anchor ${this.selAnchorId}, sel ${this.selIdsStr(this.selectedIds)}, hist idx ${this.selHistoryIdx} of sizes [${this.selHistory.map((a) => a.length).join(",")}]`,
      );
      unilog(1633, `at click, row ${row.getData().id} ${this.selectedIds.has(row.getData().id) ? "IS" : "is NOT"} selected in state, ${this.paintedVsState()}`);
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
    async updateOldestTs() {
      if (!this.table) return;
      try {
        const res = await srvr.getUnilogOldestTs();
        const ts = res.ts || "";
        // "2026/MM/DD HH:mm:ss" -> "MM/DD HH:mm"
        const label = ts.replace(/^\d{4}\//, "").replace(/:\d{2}$/, "");
        const el = this.$refs.tableEl?.querySelector(".tsClock");
        if (el) el.textContent = label;
      } catch (e) {
        unilog(1127, "updateOldestTs failed:", e);
      }
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
          const def = col.getDefinition();
          if (def.headerFilter) {
            e.preventDefault();
            e.stopPropagation();
            this.suppressHeaderClick = true;
            this.table.setHeaderFilterValue(col, "");
          }
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
    // Compact id-list rendering for the evnt-sel-bug debug logs.
    selIdsStr(ids) {
      const arr = [...ids];
      return `${arr.length}[${arr.slice(0, 8).join(",")}${arr.length > 8 ? ",..." : ""}]`;
    },
    // What is actually painted blue on screen vs what selectedIds says is
    // selected. A stale highlight makes ctrl-click toggle the opposite way
    // from what the user sees, so any mismatch here explains the bug.
    paintedVsState() {
      const painted = [];
      const onscreenSel = [];
      for (const r of this.table.getRows("active")) {
        const el = r.getElement();
        if (!el || !el.isConnected) continue;
        const id = r.getData().id;
        if (el.style.backgroundColor === "rgb(179, 212, 252)") painted.push(id);
        if (this.selectedIds.has(id)) onscreenSel.push(id);
      }
      const mismatch =
        painted.length !== onscreenSel.length ||
        painted.some((id) => !this.selectedIds.has(id));
      return `painted ${this.selIdsStr(painted)}, onscreen sel ${this.selIdsStr(onscreenSel)}, mismatch ${mismatch}`;
    },
    setSelection(newSet, { fromHistory = false } = {}) {
      // Caller name pins down any setSelection we did not expect after a click.
      const via =
        (new Error().stack || "").split("\n")[2]?.trim().split(" ")[1] || "?";
      unilog(
        1619,
        `setSelection via ${via} ${fromHistory ? "fromHistory" : "direct"}, new ${this.selIdsStr(newSet)}, old ${this.selIdsStr(this.selectedIds)}, hist idx ${this.selHistoryIdx} of ${this.selHistory.length}`,
      );
      const touched = new Set([...this.selectedIds, ...newSet]);
      this.selectedIds = newSet;
      this.selectedCount = newSet.size;
      this.selectedSiteCount = this.selectedSites().length;
      this.reformatRows(touched);
      if (!fromHistory) {
        this.selHistory = this.selHistory.slice(0, this.selHistoryIdx + 1);
        this.selHistory.push([...newSet]);
        this.selHistoryIdx = this.selHistory.length - 1;
      }
    },
    selHistoryPrev() {
      if (this.selHistoryIdx <= 0) return;
      this.selHistoryIdx--;
      this.applyHistorySelection();
    },
    selHistoryNext() {
      if (this.selHistoryIdx >= this.selHistory.length - 1) return;
      this.selHistoryIdx++;
      this.applyHistorySelection();
    },
    applyHistorySelection() {
      const newIds = this.selHistory[this.selHistoryIdx];
      const changed =
        newIds.length !== this.selectedIds.size ||
        newIds.some((id) => !this.selectedIds.has(id));
      unilog(
        1620,
        `history nav to idx ${this.selHistoryIdx} of ${this.selHistory.length}, restoring ${this.selIdsStr(newIds)}, changed ${changed}`,
      );
      // Re-anchor to the restored selection; a stale anchor left over from the
      // last manual click would make the next shift-click span the wrong range.
      this.selAnchorId = newIds.length ? newIds[0] : null;
      this.setSelection(new Set(newIds), { fromHistory: true });
      if (changed) this.gotoSelection();
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
      const next = new Set(this.selectedIds);
      for (const id of ids.slice(lo, hi + 1)) next.add(id);
      this.setSelection(next);
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
      unilog(1631, `flash shown: ${msg}`);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => {
        this.flashMsg = "";
        this.flashTimer = null;
      }, 625);
    },
    async onAction() {
      const act = this.actionSel;
      this.actionSel = ""; // reset selector back to "Actions"
      if (!act || !this.table) return;
      if (act === "refresh") await this.loadLogs();
      else if (act === "goto") this.gotoSelection();
      else if (act === "copyIds") await this.copySelectedIds();
      else if (act === "selectSites") this.selectSites();
      else if (act === "channels") this.openChannelsPane();
      else if (act === "clear") this.setSelection(new Set());
      else if (act === "editor") await this.openInEditor();
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
    async copySelectedIds() {
      const ids = this.table
        .getRows()
        .map((r) => r.getData())
        .filter((d) => this.selectedIds.has(d.id))
        .map((d) => d.id);
      if (!ids.length) {
        this.flash("no events");
        return;
      }
      await navigator.clipboard.writeText(ids.join(",")).catch(() => {});
      this.flash(`copied ${ids.length} id${ids.length > 1 ? "s" : ""}`);
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
    // Distinct group ids linked to the sites of the selected events.
    async selectedEventGroupIds() {
      const sites = this.selectedSites();
      if (!sites.length) {
        this.flash("no events");
        return null;
      }
      const res = await srvr.getUnilogGroupIdsForSites(sites.map((s) => s.id));
      const groupIds = res?.groupIds || [];
      if (!groupIds.length) {
        this.flash("no groups linked to selected events");
        return null;
      }
      return groupIds;
    },
    async showGroupEvents() {
      if (!this.selectedGroupIds.length) {
        this.flash("no groups selected");
        return;
      }
      try {
        const res = await srvr.showUnilogEvents(this.selectedGroupIds);
        if (res?.ok) {
          this.flash(`showed ${res.changed || 0} events`);
          await Promise.all([this.loadLogs(), this.loadGroups()]);
        } else {
          this.flash("failed to show events");
        }
      } catch (e) {
        console.error("[log.vue]", `showGroupEvents failed: ${e.message}`); // no-unilog
        this.flash("failed to show events");
      }
    },
    async unshowGroupEvents() {
      if (!this.selectedGroupIds.length) {
        this.flash("no groups selected");
        return;
      }
      try {
        const res = await srvr.unshowUnilogEvents(this.selectedGroupIds);
        if (res?.ok) {
          this.flash(`unshowed ${res.changed || 0} events`);
          await Promise.all([this.loadLogs(), this.loadGroups()]);
        } else {
          this.flash("failed to unshow events");
        }
      } catch (e) {
        console.error("[log.vue]", `unshowGroupEvents failed: ${e.message}`); // no-unilog
        this.flash("failed to unshow events");
      }
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
    async openInEditor() {
      // Get selected events
      const selected = this.table
        .getRows()
        .filter((r) => this.selectedIds.has(r.getData().id))
        .map((r) => r.getData());

      // Validate: exactly one event selected
      if (selected.length === 0) {
        this.flash("No event selected");
        return;
      }
      if (selected.length > 1) {
        this.flash("Only one event should be selected");
        return;
      }

      const event = selected[0];
      const { src_file, src_line, log_id } = event;

      // Validate: must have file and line
      if (!src_file || src_line == null) {
        this.flash("Event missing source location");
        return;
      }

      // Call Vite endpoint
      try {
        const res = await fetch("/__unilog/open-editor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            file: src_file,
            line: src_line,
            logId: log_id,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          this.flash(`Opened ${src_file}:${src_line}`);
        } else {
          this.flash(`Failed: ${data.error}`);
        }
      } catch (err) {
        this.flash(`Failed: ${err?.message || err}`);
      }
    },
    async loadOlder() {
      if (this.loadingOlder || this.exhausted || !this.table) return;
      if (this.oldestId == null) return;
      const existing = this.table.getData();
      const room = MAX_ROWS - existing.length;
      if (room <= 0) return;
      const savedScrollTop = this.holder?.scrollTop ?? 0;
      const rowH = this.pageRowHeight();
      this.loadingOlder = true;
      try {
        const pageLimit = Math.min(PAGE, room);
        const params = { limit: pageLimit, beforeId: this.oldestId };
        const res = await srvr.getUnilogEvents(params);
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
        if (this.holder) {
          this.holder.scrollTop = savedScrollTop + older.length * rowH;
        }
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
      // Go through Tabulator's own scrollToRow rather than setting
      // holder.scrollTop = holder.scrollHeight directly: scrollHeight only
      // reflects however much of the virtual DOM Tabulator has rendered so
      // far, so a raw scrollTop jump lands at the edge of the current render
      // window (~one screenful) instead of the true bottom — each click only
      // advanced a page at a time. scrollToRow is virtual-DOM aware and is
      // the same API already used correctly by scrollPageUp/scrollPageDown.
      // Position "top", not "bottom": scrollToRow's "bottom" alignment first
      // renders the last row into view (landing scrollTop at the true bottom,
      // since the bottom pad collapses to 0 for the final row) and then
      // subtracts a viewport back up, stranding us ~one screen short — and
      // since that spot is stable, repeat clicks did nothing. "top" sets
      // scrollTop past the end for the last row, which clamps to the true
      // bottom. This is the same position the working scrollPageDown uses.
      this.$nextTick(() => {
        if (!this.table) return;
        const rows = this.table.getRows();
        if (!rows.length) return;
        this.table.scrollToRow(rows[rows.length - 1], "top", true);
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
      this.filterByGroups = false;
      this.applyGroupFilter();
      // Clear all column header filters.
      if (this.table) {
        for (const col of this.table.getColumns()) {
          const def = col.getDefinition();
          if (def.headerFilter) {
            this.table.setHeaderFilterValue(col, "");
          }
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
        const params = { limit: PAGE, afterId: this.newestId };
        const res = await srvr.getUnilogEvents(params);
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
      // Always buffer incoming rows and batch-flush them to avoid blocking
      // JavaScript execution with individual DOM updates for every log event.
      this.pendingRows.push(row);
      this.scheduleFlush();
    },
    scheduleFlush() {
      if (this.flushTimer) return;
      // Use a short timeout to batch multiple log events together.
      // Don't flush while a header-filter dropdown is open (would close it).
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (
          !document.querySelector(".tabulator-edit-list") &&
          this.pendingRows.length
        ) {
          const buffered = this.pendingRows;
          this.pendingRows = [];
          this.appendRows(buffered);
        }
        // If dropdown is still open, reschedule to try again.
        if (this.pendingRows.length) {
          this.scheduleFlush();
        }
      }, 500);
    },
    async appendRows(rows) {
      if (!this.table || !rows.length) return;
      const stick = this.atBottom;
      const savedScrollTop = this.holder?.scrollTop ?? 0;
      this.appending = true;
      try {
        await this.table.addData(rows, false);
      } finally {
        this.appending = false;
      }
      if (stick) {
        // Trim only once the table has drifted TRIM_MARGIN past the cap, and
        // remove the whole overflow in a single deleteRow() so it costs one
        // redraw instead of one per row on every flush. getRows() is oldest
        // first (ascending display), so the slice off the front is the oldest.
        const all = this.table.getRows();
        if (all.length > MAX_ROWS + TRIM_MARGIN) {
          const doomed = all.slice(0, all.length - MAX_ROWS);
          await this.table.deleteRow(doomed.map((r) => r.getData().id));
        }
        this.scrollToBottom();
      } else if (this.holder) {
        this.holder.scrollTop = savedScrollTop;
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
        const params = { limit: PAGE };
        const res = await srvr.getUnilogEvents(params);
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
    // ---- Groups pane ------------------------------------------------------
    groupLabel(g) {
      return g.hide === 1 ? `${g.description} (h)` : g.description;
    },
    // Fixed-position overlay: right edge aligned to #list, vertically centered.
    positionGroupsPane() {
      const list = document.getElementById("list");
      if (!list) return;
      const rect = list.getBoundingClientRect();
      const width = Math.min(380, Math.max(260, rect.width - 16));
      const hdrTop = document.getElementById("hdrtop");
      const top = hdrTop ? hdrTop.getBoundingClientRect().top : 20;
      this.groupPaneStyle = {
        position: "fixed",
        right: `${Math.max(4, window.innerWidth - rect.right + 8)}px`,
        top: `${top}px`,
        transform: "translateY(0)",
        width: `${width}px`,
      };
    },
    toggleGroupsPane() {
      this.showGroupsPane = !this.showGroupsPane;
      if (this.showGroupsPane) {
        this.positionGroupsPane();
        this.loadGroups();
      }
      this.applyGroupFilter();
    },
    async loadGroups() {
      try {
        const res = await srvr.getUnilogGroups();
        this.groups = res?.groups || [];
        // Drop selections that no longer exist.
        const ids = new Set(this.groups.map((g) => g.group_id));
        this.selectedGroupIds = this.selectedGroupIds.filter((id) =>
          ids.has(id),
        );
      } catch (e) {
        console.error("[log.vue]", `loadGroups failed: ${e.message}`); // no-unilog
        this.flash("failed to load groups");
      }
    },
    selectedSiteIds() {
      return this.selectedSites().map((s) => s.id);
    },
    // Site/event totals shown when exactly one group is selected.
    async refreshGroupStats() {
      if (this.selectedGroupIds.length !== 1) {
        this.groupStats = null;
        return;
      }
      const gid = this.selectedGroupIds[0];
      try {
        const res = await srvr.getUnilogGroupStats(gid);
        // Selection may have changed while the request was in flight.
        if (
          this.selectedGroupIds.length === 1 &&
          this.selectedGroupIds[0] === gid
        )
          this.groupStats = res;
      } catch (e) {
        console.error("[log.vue]", `groupStats failed: ${e.message}`); // no-unilog
        this.groupStats = null;
      }
    },
    async selectOrphans() {
      try {
        const res = await srvr.getUnilogOrphanGroups();
        const orphan = new Set(res?.groupIds || []);
        this.selectedGroupIds = this.groups
          .map((g) => g.group_id)
          .filter((id) => orphan.has(id));
        this.flash(`selected ${this.selectedGroupIds.length} orphan groups`);
      } catch (e) {
        console.error("[log.vue]", `selectOrphans failed: ${e.message}`); // no-unilog
        this.flash("failed to find orphans");
      }
    },
    async addGroup() {
      const name = this.newGroupName.trim();
      if (!name) return;
      const siteIds = this.selectedSiteIds();
      try {
        const res = await srvr.createUnilogGroup(name, siteIds);
        if (res?.created === false) {
          this.flash("group exists");
          return;
        }
        this.newGroupName = "";
        await this.loadGroups();
        await this.refreshRowGroups(siteIds);
        this.flash(`added group (${res?.linked ?? 0} sites)`);
      } catch (e) {
        console.error("[log.vue]", `addGroup failed: ${e.message}`); // no-unilog
        this.flash("failed to add group");
      }
    },
    async assignGroups() {
      const siteIds = this.selectedSiteIds();
      if (!this.selectedGroupIds.length || !siteIds.length) return;
      try {
        const res = await srvr.assignUnilogGroups(
          this.selectedGroupIds,
          siteIds,
        );
        await this.refreshRowGroups(siteIds);
        await this.applyGroupFilter();
        this.refreshGroupStats();
        this.flash(`assigned ${res?.added ?? 0} links`);
      } catch (e) {
        console.error("[log.vue]", `assignGroups failed: ${e.message}`); // no-unilog
        this.flash("failed to assign");
      }
    },
    async removeGroups() {
      const siteIds = this.selectedSiteIds();
      if (!this.selectedGroupIds.length || !siteIds.length) return;
      try {
        const res = await srvr.removeUnilogGroups(
          this.selectedGroupIds,
          siteIds,
        );
        await this.refreshRowGroups(siteIds);
        await this.applyGroupFilter();
        this.refreshGroupStats();
        this.flash(`removed ${res?.removed ?? 0} links`);
      } catch (e) {
        console.error("[log.vue]", `removeGroups failed: ${e.message}`); // no-unilog
        this.flash("failed to remove");
      }
    },
    async replaceGroups() {
      const siteIds = this.selectedSiteIds();
      if (!this.selectedGroupIds.length || !siteIds.length) return;
      try {
        const res = await srvr.replaceUnilogGroups(
          this.selectedGroupIds,
          siteIds,
        );
        await this.refreshRowGroups(siteIds);
        await this.applyGroupFilter();
        this.refreshGroupStats();
        this.flash(`replaced: -${res?.removed ?? 0} +${res?.added ?? 0} links`);
      } catch (e) {
        console.error("[log.vue]", `replaceGroups failed: ${e.message}`); // no-unilog
        this.flash("failed to replace");
      }
    },
    // Select every group linked to the currently selected log events.
    async selectEventGroups() {
      this.selectedGroupIds = [];
      try {
        const groupIds = await this.selectedEventGroupIds();
        if (!groupIds) return;
        this.selectedGroupIds = groupIds;
        this.flash(`selected ${groupIds.length} groups`);
      } catch (e) {
        unilog(1621, `selectEventGroups failed: ${e.message}`);
        this.flash("failed to select groups");
      }
    },
    async deleteGroupsAction() {
      if (!this.selectedGroupIds.length) return;
      let siteCount = 0;
      try {
        const res = await srvr.getUnilogGroupSiteIds(this.selectedGroupIds);
        siteCount = (res?.logIds || []).length;
      } catch (e) {
        console.error("[log.vue]", `delete stats failed: ${e.message}`); // no-unilog
      }
      const x = this.selectedGroupIds.length;
      if (
        !window.confirm(
          `Is it ok to remove ${x} groups from ${siteCount} sites?`,
        )
      )
        return;
      const affected = this.selectedGroupIds.slice();
      try {
        const res = await srvr.deleteUnilogGroups(affected);
        this.selectedGroupIds = [];
        await this.loadGroups();
        // Refresh every loaded row (any could have lost a group).
        await this.refreshRowGroups(this.allLoadedSiteIds());
        await this.applyGroupFilter();
        this.flash(
          `deleted ${res?.groups ?? 0} groups from ${res?.sites ?? 0} sites`,
        );
      } catch (e) {
        console.error("[log.vue]", `deleteGroups failed: ${e.message}`); // no-unilog
        this.flash("failed to delete");
      }
    },
    async applySetName() {
      if (this.selectedGroupIds.length !== 1) return;
      const name = this.setGroupName.trim();
      if (!name || this.groupNameExists) return;
      const gid = this.selectedGroupIds[0];
      try {
        const res = await srvr.setUnilogGroupName(gid, name);
        if (res?.renamed === false) {
          this.flash("name exists");
          return;
        }
        this.setGroupName = "";
        await this.loadGroups();
        await this.refreshRowGroups(this.allLoadedSiteIds());
        this.flash("renamed group");
      } catch (e) {
        console.error("[log.vue]", `setGroupName failed: ${e.message}`); // no-unilog
        this.flash("failed to rename");
      }
    },
    // Distinct log_ids among all currently loaded rows.
    allLoadedSiteIds() {
      if (!this.table) return [];
      const seen = new Set();
      for (const r of this.table.getRows()) {
        const id = r.getData().log_id;
        if (id != null) seen.add(id);
      }
      return [...seen];
    },
    // Update the Groups column for the given sites after a mutation.
    async refreshRowGroups(logIds) {
      if (!this.table || !logIds.length) return;
      try {
        const map = await srvr.getUnilogGroupsForSites(logIds);
        for (const r of this.table.getRows()) {
          const d = r.getData();
          if (Object.prototype.hasOwnProperty.call(map, d.log_id)) {
            r.update({ groups: map[d.log_id] || "" });
          }
        }
      } catch (e) {
        console.error("[log.vue]", `refreshRowGroups failed: ${e.message}`); // no-unilog
      }
    },
    // Layered group filter (in addition to header/string filters). Active only
    // while the pane is open, Filter is checked, and groups are selected.
    async applyGroupFilter() {
      if (!this.table) return;
      const on =
        this.showGroupsPane &&
        this.filterByGroups &&
        this.selectedGroupIds.length > 0;
      if (!on) {
        if (this.groupFilterFn) {
          this.table.removeFilter(this.groupFilterFn);
          this.groupFilterFn = null;
        }
        return;
      }
      try {
        const res = await srvr.getUnilogGroupSiteIds(this.selectedGroupIds);
        this.groupFilterIds = new Set(res?.logIds || []);
      } catch (e) {
        console.error("[log.vue]", `group filter fetch failed: ${e.message}`); // no-unilog
        this.groupFilterIds = new Set();
      }
      if (!this.groupFilterFn) {
        this.groupFilterFn = (data) => this.groupFilterIds.has(data.log_id);
        this.table.addFilter(this.groupFilterFn);
      } else {
        this.table.refreshFilter();
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
.groupsPane {
  display: flex;
  gap: 10px;
  box-sizing: border-box;
  max-height: 95vh;
  padding: 10px;
  background: #fff;
  border: 1px solid #999;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 3000;
  font-size: 13px;
}
.channelsPane {
  box-sizing: border-box;
  padding: 8px 10px;
  background: #fff;
}
.groupsCol {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.groupsListCol {
  flex: 1;
  min-width: 0;
}
.groupsCtrlCol {
  flex: 0 0 auto;
  width: 120px;
}
.groupsTitle {
  font-weight: bold;
  text-align: center;
}
.groupsList {
  flex: 1;
  min-height: 372px;
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
}
.groupsRow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.groupsInput {
  width: 100%;
  box-sizing: border-box;
}
.groupsDisabled {
  color: #aaa;
}
.groupsPane .logBtn:disabled,
.groupsPane input:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
