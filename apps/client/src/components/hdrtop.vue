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
      <button
        v-if="simpleMode"
        @click="$emit('all-click')"
        style="
          height: 24px;
          padding: 0 8px;
          margin: 6px 5px 4px 10px;
          font-size: 13px;
          font-weight: bold;
          border: 1px solid #999;
          border-radius: 7px;
          background-color: #eee;
          cursor: pointer;
        "
      >
        All
      </button>
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
      </div>
      <input
        :value="filterStr"
        @input="handleFilterInput"
        @keydown="handleFilterKeyDown"
        @focus="$emit('filter-focus')"
        @blur="$emit('filter-blur')"
        placeholder="Filter..."
        style="
          width: 120px;
          margin: 5px 20px 5px 10px;
          padding: 5px;
          border: 1.5px solid black;
          background-color: #eee;
          box-sizing: border-box;
          font-size: 16px;
        "
      />
      <button
        @click="$emit('watch-click')"
        style="
          height: 30px;
          background-color: white;
          font-size: 13px;
          cursor: pointer;
          margin: 5px 5px 5px 0;
          width: 136px;
          flex-shrink: 0;
          white-space: nowrap;
          overflow: hidden;
          border-radius: 7px;
        "
      >
        {{ watchingName }}
      </button>
    </div>
    <div
      style="
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        margin-right: 15px;
      "
    >
      <span
        v-if="libraryProgressText && !simpleMode"
        @click="openEmbyLibraries"
        style="
          font-size: 13px;
          font-weight: bold;
          color: #000;
          white-space: nowrap;
          margin-right: 6px;
          cursor: pointer;
          text-decoration: underline;
        "
      >
        {{ libraryProgressText }}
      </span>
      <button
        v-if="!simpleMode"
        @click="$emit('library-click', $event)"
        style="
          height: 24px;
          background-color: white;
          font-size: 13px;
          cursor: pointer;
          border-radius: 7px;
          margin: 0 0 0 10px;
        "
      >
        Library
      </button>
      <button
        v-if="!simpleMode"
        @click="$emit('send-filters', $event)"
        style="
          height: 24px;
          background-color: white;
          font-size: 13px;
          cursor: pointer;
          border-radius: 7px;
          margin: 0 0 0 10px;
        "
      >
        Send
      </button>
      <button
        v-if="!simpleMode"
        @click="hasSharedFilters && $emit('custom-click')"
        style="
          height: 24px;
          background-color: white;
          font-size: 13px;
          cursor: pointer;
          border-radius: 7px;
          margin: 0 0 0 10px;
        "
        :style="!hasSharedFilters ? { opacity: '0.4' } : {}"
      >
        Custom
      </button>
      <button
        @click="$emit('actors-click')"
        :style="{
          height: '24px',
          backgroundColor: actorsListMode ? 'lightgray' : 'white',
          fontSize: '13px',
          cursor: 'pointer',
          borderRadius: '7px',
          margin: '0 0 0 10px',
        }"
      >
        Actors
      </button>
    </div>
  </div>
</template>

<script>
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
    filterStr: {
      type: String,
      default: "",
    },
    watchingName: {
      type: String,
      default: "---",
    },
    simpleMode: {
      type: Boolean,
      default: false,
    },
    libraryProgressText: {
      type: String,
      default: "",
    },
    statusMsg: {
      type: String,
      default: "",
    },
    isWideLandscape: {
      type: Boolean,
      default: false,
    },
    actorsListMode: {
      type: Boolean,
      default: false,
    },
    hasSharedFilters: {
      type: Boolean,
      default: false,
    },
  },

  emits: [
    "update:filterStr",
    "watch-click",
    "filter-input",
    "filter-focus",
    "filter-blur",
    "send-filters",
    "library-click",
    "all-click",
    "custom-click",
    "actors-click",
  ],

  methods: {
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

    openEmbyLibraries() {
      window.open(
        "https://hahnca.com:8920/web/index.html#!/librarysetup/libraries",
        "_blank",
      );
    },
  },
};
</script>
