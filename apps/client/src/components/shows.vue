<template>
  <div
    id="shows"
    style="
      width: 100%;
      flex-grow: 1;
      padding-right: 5px;
      box-sizing: border-box;
      overflow: hidden;
      position: relative;
    "
  >
    <div
      v-if="shows.length === 0"
      style="
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        font-size: 18px;
        color: #666;
      "
    >
      No shows.
    </div>
    <RecycleScroller
      v-else
      ref="scroller"
      v-slot="{ item: show }"
      :items="shows"
      :item-size="simpleMode ? 40 : 30"
      key-field="name"
      :buffer="400"
      class="scroller"
      :item-class="'virtual-item'"
      style="overflow-y: scroll !important"
    >
      <div
        class="show-row"
        :style="{
          cursor: 'default',
          backgroundColor: hilite(show),
        }"
        :id="nameHash(show.name)"
      >
        <div
          v-if="!simpleMode"
          class="show-cell"
          style="width: 30px; flex-shrink: 0"
          @click="$emit('copy-name', show, $event)"
        >
          <font-awesome-icon
            class="cpbrd"
            icon="copy"
            style="color: #ccc"
          ></font-awesome-icon>
        </div>
        <div
          v-if="!simpleMode"
          class="show-cell"
          style="width: 30px; flex-shrink: 0"
        >
          <div
            v-show="show.inEmby !== false"
            @click="$emit('open-map', show)"
          >
            <font-awesome-icon
              icon="border-all"
              style="color: #ccc"
            ></font-awesome-icon>
          </div>
        </div>
        <div
          class="show-cell"
          @click="$emit('select-show', show, false)"
          :style="{
            width: sortColumnWidth,
            flexShrink: 0,
            fontSize: '14px',
            cursor: 'default',
            textAlign: 'center',
            paddingLeft: simpleMode ? '20px' : '0',
            display: sortColumnWidth === '0' ? 'none' : 'flex',
          }"
        >
          {{ getSortDisplayValue(show) }}
        </div>
        <div
          class="showLineText show-cell show-name-cell"
          :style="{
            padding: '5px',
            flexGrow: 1,
            minWidth: 0,
            backgroundColor:
              highlightName === show.name ? 'yellow' : 'transparent',
          }"
          @click="$emit('select-show', show, false, true)"
        >
          <div
            style="
              display: flex;
              justify-content: flex-start;
              width: 100%;
              overflow: hidden;
              flex-wrap: nowrap;
            "
          >
            <div
              :style="{
                padding: '2px',
                fontSize: '16px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flexShrink: 1,
                minWidth: 0,
              }"
              @click="$emit('select-show', show, false, true)"
            >
              {{ show.name }}
            </div>
            <div
              style="
                padding: 2px;
                flex-grow: 1;
                fontsize: 16px;
                font-weight: bold;
              "
              @click="$emit('select-show', show, false, true)"
            ></div>
            <div
              v-if="sortChoice === 'Creator' && getSortDisplayValue(show)"
              :style="{
                padding: '2px',
                fontSize: '14px',
                color: 'rgba(0,0,0,0.5)',
                marginRight: '15px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }"
            >
              {{ getSortDisplayValue(show) }}
            </div>
            <div
              v-if="show.waitStr?.length"
              :style="{
                padding: '2px',
                color: '#00f',
                fontSize: '16px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flexShrink: 0,
              }"
            >
              {{ show.waitStr }}
            </div>
          </div>
        </div>
        <div
          v-if="showConds"
          v-for="cond in visibleConds"
          :key="cond.name"
          class="show-cell cond-icon"
          style="width: 22px; flex-shrink: 0"
          @click="cond.click(show)"
        >
          <font-awesome-icon
            :icon="cond.icon"
            :style="{ color: condColor(show, cond) }"
          ></font-awesome-icon>
        </div>
        <div
          v-if="simpleMode && show.inEmby === false"
          class="show-cell"
          style="width: 22px; flex-shrink: 0"
        >
          <font-awesome-icon
            icon="trash"
            :style="{ color: '#a66' }"
          ></font-awesome-icon>
        </div>
      </div>
    </RecycleScroller>
  </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { RecycleScroller } from "vue3-virtual-scroller";
import "vue3-virtual-scroller/dist/vue3-virtual-scroller.css";

export default {
  name: "Shows",
  components: { FontAwesomeIcon, RecycleScroller },

  data() {
    return {
      blankRowProbePending: false,
      blankRowProbeReason: "",
      lastBlankRowSignature: "",
      blankRowProbeRafId: 0,
      blankRowScrollEl: null,
    };
  },

  props: {
    shows: {
      type: Array,
      required: true,
    },
    conds: {
      type: Array,
      required: true,
    },
    highlightName: {
      type: String,
      default: "",
    },
    getSortDisplayValue: {
      type: Function,
      required: true,
    },
    allShowsLength: {
      type: Number,
      default: 0,
    },
    showConds: {
      type: Boolean,
      default: true,
    },
    simpleMode: {
      type: Boolean,
      default: false,
    },
    sortChoice: {
      type: String,
      default: "Viewed",
    },
    activeDownloadShowNames: {
      type: Array,
      default: () => [],
    },
  },

  computed: {
    sortColumnWidth() {
      const widths = {
        Alpha: "0",
        Viewed: "75px",
        Down: "75px",
        Added: "75px",
        Ratings: "25px",
        Size: "25px",
        "Safe start": "0",
        Ended: "75px",
        Length: "25px",
        Creator: "0",
      };
      return widths[this.sortChoice] || "75px";
    },

    activeDownloadShowNameSet() {
      return new Set(
        Array.isArray(this.activeDownloadShowNames)
          ? this.activeDownloadShowNames
          : [],
      );
    },

    visibleConds() {
      return this.conds.filter((c) => !c.hideIcon);
    },
  },

  watch: {
    shows() {
      this.queueBlankRowProbe("shows changed");
    },
    sortChoice() {
      this.queueBlankRowProbe("sort changed");
    },
    highlightName() {
      this.queueBlankRowProbe("highlight changed");
    },
  },

  mounted() {
    this.attachBlankRowScrollProbe();
    this.queueBlankRowProbe("mounted");
  },

  updated() {
    this.attachBlankRowScrollProbe();
    this.queueBlankRowProbe("updated");
  },

  beforeUnmount() {
    this.detachBlankRowScrollProbe();
    if (this.blankRowProbeRafId && typeof window !== "undefined")
      window.cancelAnimationFrame(this.blankRowProbeRafId);
  },

  methods: {
    scrollToShow(showName) {
      const index = this.shows.findIndex((s) => s.name === showName);
      if (index !== -1 && this.$refs.scroller) {
        const itemSize = this.simpleMode ? 40 : 30;
        const scrollerEl = this.$refs.scroller.$el;
        const viewportHeight = scrollerEl.clientHeight;
        const targetScroll =
          index * itemSize - viewportHeight / 2 + itemSize / 2;
        this.$refs.scroller.scrollToPosition(Math.max(0, targetScroll));
      }
    },

    hilite(show) {
      if (this.activeDownloadShowNameSet.has(show?.name)) return "#dff5df";
      if (!this.simpleMode && show.inEmby === false) return "#fee";
      return "white";
    },

    nameHash(name) {
      if (!name) {
        return null;
      }
      return (
        "name-" +
        name
          .toLowerCase()
          .replace(/^the\s/, "")
          .replace(/[^a-zA-Z0-9]*/g, "")
      );
    },

    condColor(show, cond) {
      if (cond.cond(show)) return cond.color;
      return "#ddd";
    },

    attachBlankRowScrollProbe() {
      const scrollEl = this.$refs.scroller?.$el || null;
      if (!scrollEl || this.blankRowScrollEl === scrollEl) return;
      this.detachBlankRowScrollProbe();
      scrollEl.addEventListener("scroll", this.onBlankRowScroll, {
        passive: true,
      });
      this.blankRowScrollEl = scrollEl;
    },

    detachBlankRowScrollProbe() {
      if (!this.blankRowScrollEl) return;
      this.blankRowScrollEl.removeEventListener(
        "scroll",
        this.onBlankRowScroll,
      );
      this.blankRowScrollEl = null;
    },

    onBlankRowScroll() {
      this.queueBlankRowProbe("scroll");
    },

    queueBlankRowProbe(reason) {
      this.blankRowProbeReason = reason;
      if (this.blankRowProbePending) return;
      this.blankRowProbePending = true;
      this.$nextTick(() => {
        const runProbe = () => {
          this.blankRowProbePending = false;
          this.probeBlankRows(this.blankRowProbeReason || reason);
        };
        if (typeof window !== "undefined" && window.requestAnimationFrame) {
          if (this.blankRowProbeRafId)
            window.cancelAnimationFrame(this.blankRowProbeRafId);
          this.blankRowProbeRafId = window.requestAnimationFrame(() => {
            this.blankRowProbeRafId = 0;
            runProbe();
          });
          return;
        }
        runProbe();
      });
    },

    collectDuplicateEntries(values) {
      const counts = new Map();
      for (const v of values) {
        if (!v) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return [...counts.entries()]
        .filter(([, c]) => c > 1)
        .map(([value, count]) => ({ value, count }));
    },

    probeBlankRows(trigger) {
      const shows = Array.isArray(this.shows) ? this.shows : [];

      const blankDataRows = shows
        .map((show, index) => ({
          index,
          id: String(show?.id || ""),
          tvdbId: String(show?.tvdbId || show?.TvdbId || ""),
          rawName: show?.name,
          rawAltName: show?.Name,
        }))
        .filter(
          (e) => String(e.rawName ?? e.rawAltName ?? "").trim().length === 0,
        );

      const duplicateIds = this.collectDuplicateEntries(
        shows.map((s) => String(s?.id || "").trim()),
      );
      const duplicateNames = this.collectDuplicateEntries(
        shows.map((s) => String(s?.name || "").trim()),
      );

      const visibleBlankRows = [];
      const scrollerEl = this.$refs.scroller?.$el;
      if (scrollerEl) {
        const views = scrollerEl.querySelectorAll(
          ".vue-recycle-scroller__item-view",
        );
        for (const [i, view] of [...views].entries()) {
          const rowEl = view.querySelector(".show-row");
          const nameText = String(
            view.querySelector(".show-name-cell")?.textContent || "",
          ).trim();
          const rect = view.getBoundingClientRect();
          if (!rowEl || (nameText.length === 0 && rect.height > 0)) {
            visibleBlankRows.push({
              viewIndex: i,
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              transform: view.style.transform || "",
              hasRow: !!rowEl,
              text: nameText,
              html: String(rowEl?.outerHTML || view.outerHTML).slice(0, 240),
            });
          }
        }
      }

      const shouldLog =
        blankDataRows.length > 0 ||
        duplicateIds.length > 0 ||
        duplicateNames.length > 0 ||
        visibleBlankRows.length > 0;

      if (!shouldLog) return;

      const summary = {
        trigger,
        shows: shows.length,
        blankDataRows: blankDataRows.length,
        duplicateIds: duplicateIds.length,
        duplicateNames: duplicateNames.length,
        visibleBlankRows: visibleBlankRows.length,
        sortChoice: this.sortChoice,
        simpleMode: this.simpleMode,
      };
      const sig = JSON.stringify(summary);
      if (sig === this.lastBlankRowSignature) return;
      this.lastBlankRowSignature = sig;
    },
  },
};
</script>

<style scoped>
#shows {
  position: relative;
  z-index: 1;
}

.scroller {
  height: 100%;
  width: 100%;
  scrollbar-gutter: stable;
  scrollbar-width: auto;
  scrollbar-color: #888 #f1f1f1;
}

.scroller::-webkit-scrollbar {
  width: 16px;
}

.scroller::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.scroller::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 8px;
}

.scroller::-webkit-scrollbar-thumb:hover {
  background: #555;
}

.scroller :deep(.vue-recycle-scroller__item-wrapper) {
  position: relative;
  z-index: auto;
}

.scroller :deep(.vue-recycle-scroller__item-view) {
  margin: 0 !important;
  padding: 0 !important;
  display: flex !important;
  box-sizing: border-box !important;
  align-items: stretch !important;
}

.scroller :deep(.vue-recycle-scroller__item-view::after) {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background-color: #999;
  z-index: 1;
}

.scroller :deep(.virtual-item) {
  display: flex !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
}

.show-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  font-size: 18px;
  box-sizing: border-box;
  position: relative;
  z-index: auto;
  margin: 0;
  padding: 0;
  line-height: 1;
}

.show-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  text-align: center;
  position: relative;
  line-height: 1;
  min-height: 0;
}

.show-cell svg {
  display: block;
}

.show-name-cell {
  justify-content: flex-start;
  text-align: left;
}

.cond-icon {
  width: 22px;
  flex-shrink: 0;
  position: relative;
}
</style>
