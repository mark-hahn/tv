<template>
  <div
    id="hdrtop"
    style="
      width: 100%;
      height: 40px;
      display: flex;
      justify-content: center;
      background-color: #ccc;
    "
  >
    <div style="flex: 1; display: flex; align-items: center">
      <div
        id="nums"
        v-if="!simpleMode"
        style="display: flex; justify-content: space-around; width: 120px"
      >
        <div
          id="count"
          style="display: inline-block; margin: 4px 5px 4px 15px; width: 75px"
        >
          {{ showsLength + "/" + allShowsLength }}
        </div>
        <div
          id="prog"
          style="display: inline-block; margin: 4px 10px 4px 5px; width: 75px"
        >
          {{ gapPercent + "%" }}
        </div>
      </div>
    </div>
    <div
      style="display: flex; justify-content: space-between; margin-bottom: 10px"
    >
      <input
        :value="filterStr"
        @input="handleFilterInput"
        @keydown="handleFilterKeyDown"
        placeholder="Filter..."
        style="
          width: 100px;
          height: 30px !important;
          margin: 5px 10px;
          padding: 5px;
          border: 1.5px solid black;
          background-color: #eee;
          box-sizing: border-box;
          font-size: 16px;
        "
      />
    </div>
    <div style="display: flex; align-items: center">
      <input
        :value="webHistStr"
        @input="handleWebHistInput"
        @keydown="handleWebHistKeyDown"
        @keyup.enter="$emit('search-click', 'web')"
        placeholder="Search..."
        style="
          width: 100px;
          height: 30px !important;
          margin: 5px 10px 5px 10px !important;
          padding: 5px;
          border: 1.5px solid black;
          background-color: #eee;
          box-sizing: border-box;
          font-size: 16px;
        "
      />
      <button
        v-if="!simpleMode"
        @click="$emit('search-click', 'hist')"
        style="display:inline-block'; font-size:15px; margin:2px 4px 0 0;backgroundColor:white"
      >
        Hist
      </button>
      <button
        @click="$emit('search-click', 'web')"
        style="display:inline-block'; font-size:15px; margin:2px 4px 0 10px;backgroundColor:white"
      >
        {{ simpleMode && !isWideLandscape ? "Search Web" : "Web" }}
      </button>
    </div>
    <button
      @click="$emit('watch-click')"
      style="
        height: 29px;
        background-color: white;
        fontsize: 15px;
        margin: 6px 5px 4px 10px;
      "
    >
      {{ watchingName }}
    </button>
    <div
      style="
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        margin-right: 15px;
      "
    >
      <button
        v-if="!simpleMode"
        @click="$emit('send-filters', $event)"
        style="
          height: 29px;
          background-color: white;
          fontsize: 15px;
          margin: 6px 0 4px 10px;
        "
      >
        Send
      </button>
    </div>
    <div
      id="searchList"
      v-if="showingSrchList"
      style="
        background-color: #eee;
        padding: 0px;
        border: 1px solid black;
        height: 85%;
        position: fixed;
        display: flex;
        flex-direction: column;
        left: 253px;
        top: 88px;
        cursor: pointer;
        min-width: 280px;
      "
    >
      <div
        @click="$emit('cancel-srch-list')"
        style="
          font-weight: bold;
          text-align: center;
          margin: 10px;
          padding: 10px;
          height: 20px;
          background-color: white;
        "
      >
        Cancel
      </div>
      <div style="overflow-y: scroll">
        <div v-if="showingSrchList &amp;&amp; searchList === null">
          <img
            src="../../loading.gif"
            style="
              width: 100px;
              height: 100px;
              overflow-y: scroll;
              position: relative;
              top: 20px;
              left: 80px;
            "
          />
        </div>
        <div
          v-for="srchChoice in searchList"
          v-if="searchList !== null"
          @click="onSearchChoiceClick($event, srchChoice)"
          style="
            margin: 3px 10px;
            padding: 10px;
            width: 230px;
            background-color: white;
            text-align: center;
            border: 1px solid black;
            display: flex;
          "
        >
          <img
            :src="srchChoice.image"
            style="max-width: 80px; max-height: 120px"
          />
          <div
            id="srchTxt"
            style="
              max-width: 230px;
              display: flex;
              margin: 5px;
              flex-direction: column;
            "
          >
            <div
              id="srchName"
              style="font-weight: bold; font-size: 20px"
            >
              {{ srchChoice.name }}
            </div>
            <div
              id="srchDtl"
              style="font-size: 18px; margin: 10px 0 0 10px"
            >
              {{ srchChoice.searchDtlTxt }}
            </div>
            <div
              id="srchDel"
              v-if="srchChoice.deleted"
              style="font-size: 18px; margin: 10px 0 0 10px; color: red"
            >
              Deleted
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { addSearchHistoryEntry, loadSearchHistory } from "../searchHistory.js";

export default {
  name: "HdrTop",

  props: {
    showsLength: {
      type: Number,
      required: true,
    },
    allShowsLength: {
      type: Number,
      required: true,
    },
    gapPercent: {
      type: Number,
      default: 0,
    },
    filterStr: {
      type: String,
      default: "",
    },
    webHistStr: {
      type: String,
      default: "",
    },
    watchingName: {
      type: String,
      default: "---",
    },
    showingSrchList: {
      type: Boolean,
      default: false,
    },
    searchList: {
      type: Array,
      default: null,
    },
    simpleMode: {
      type: Boolean,
      default: false,
    },
    isWideLandscape: {
      type: Boolean,
      default: false,
    },
  },

  emits: [
    "update:filterStr",
    "update:webHistStr",
    "search-click",
    "watch-click",
    "filter-input",
    "cancel-srch-list",
    "search-action",
    "send-filters",
  ],

  data() {
    return {
      webHistNavIndex: -1,
      webHistTypedBeforeNav: null,
    };
  },

  methods: {
    onSearchChoiceClick(e, srchChoice) {
      this.$emit("search-action", {
        srchChoice,
        action: "preview",
      });
    },

    handleFilterInput(event) {
      this.$emit("update:filterStr", event.target.value);
      this.$emit("filter-input");
    },

    handleFilterKeyDown(event) {
      const isDown =
        event.code === "ArrowDown" ||
        event.key === "ArrowDown" ||
        event.keyCode === 40;
      if (!isDown) return;
      event.preventDefault();
      event.stopPropagation();
      this.$emit("update:filterStr", "");
      this.$emit("filter-input");
    },

    handleWebHistInput(event) {
      this.webHistNavIndex = -1;
      this.webHistTypedBeforeNav = null;
      if (this.showingSrchList) this.$emit("cancel-srch-list");
      this.$emit("update:webHistStr", event.target.value);
    },

    handleWebHistKeyDown(event) {
      const isUp =
        event.code === "ArrowUp" ||
        event.key === "ArrowUp" ||
        event.keyCode === 38;
      const isDown =
        event.code === "ArrowDown" ||
        event.key === "ArrowDown" ||
        event.keyCode === 40;
      if (!isUp && !isDown) return;

      event.preventDefault();
      event.stopPropagation();

      const typedNow = String(this.webHistStr ?? "");
      const typedNorm = typedNow.trim();
      const historyBefore = loadSearchHistory();
      const newestBefore = historyBefore[0] ?? "";
      const insertedNewTop = Boolean(typedNorm) && typedNorm !== newestBefore;

      if (isUp && this.webHistNavIndex < 0) {
        addSearchHistoryEntry(typedNow);
      }

      const history = loadSearchHistory();
      if (!history.length) return;

      if (this.webHistNavIndex < 0) {
        this.webHistTypedBeforeNav = this.webHistStr;
      }

      if (isUp) {
        if (this.webHistNavIndex < 0) {
          // If Up saved a freshly typed line, treat current input as bottom-of-history,
          // and show the previous history item instead of echoing the same text.
          const startIndex = insertedNewTop ? 1 : 0;
          this.webHistNavIndex = Math.min(startIndex, history.length - 1);
          if (this.showingSrchList) this.$emit("cancel-srch-list");
          this.$emit("update:webHistStr", history[this.webHistNavIndex]);
          return;
        }
        this.webHistNavIndex = Math.min(
          this.webHistNavIndex + 1,
          history.length - 1,
        );
        if (this.showingSrchList) this.$emit("cancel-srch-list");
        this.$emit("update:webHistStr", history[this.webHistNavIndex]);
        return;
      }

      // ArrowDown
      if (this.webHistNavIndex < 0) {
        // Not currently navigating history; Down should clear and stay cleared.
        this.webHistTypedBeforeNav = null;
        if (this.showingSrchList) this.$emit("cancel-srch-list");
        this.$emit("update:webHistStr", "");
        return;
      }

      if (this.webHistNavIndex === 0) {
        this.webHistNavIndex = -1;
        this.webHistTypedBeforeNav = null;
        if (this.showingSrchList) this.$emit("cancel-srch-list");
        this.$emit("update:webHistStr", "");
        return;
      }
      this.webHistNavIndex = this.webHistNavIndex - 1;
      if (this.showingSrchList) this.$emit("cancel-srch-list");
      this.$emit("update:webHistStr", history[this.webHistNavIndex]);
    },
  },
};
</script>
