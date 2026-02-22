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
      key-field="Name"
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
        :id="nameHash(show.Name)"
      >
        <div
          v-if="!simpleMode"
          class="show-cell"
          style="width: 30px; flex-shrink: 0"
          @click="$emit('copy-name', show, $event)"
        >
          <font-awesome-icon
            id="cpbrd"
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
          id="showLineText"
          class="show-cell show-name-cell"
          :style="{
            padding: '5px',
            flexGrow: 1,
            minWidth: 0,
            backgroundColor:
              highlightName === show.Name ? 'yellow' : 'transparent',
          }"
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
              {{ show.Name }}
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
              v-if="show.Notes &amp;&amp; String(show.Notes).length"
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
              {{ String(show.Notes) }}
            </div>
            <div
              v-if="show.WaitStr?.length"
              :style="{
                padding: '2px',
                color: '#00f',
                fontSize: '16px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }"
            >
              {{ show.WaitStr }}
            </div>
          </div>
        </div>
        <div
          v-if="showConds"
          v-for="cond in conds"
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
  },

  computed: {
    sortColumnWidth() {
      const widths = {
        Alpha: "0",
        Viewed: "75px",
        Added: "75px",
        Ratings: "25px",
        Notes: "0",
        Size: "25px",
        Ended: "75px",
        Length: "25px",
      };
      return widths[this.sortChoice] || "75px";
    },
  },

  methods: {
    scrollToShow(showName) {
      const index = this.shows.findIndex((s) => s.Name === showName);
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
