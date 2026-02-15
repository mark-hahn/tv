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
        @click="handleDebugClick"
        :style="{
          height: '29px',
          backgroundColor: debugFlash ? '#4CAF50' : 'white',
          fontsize: '15px',
          margin: '6px 0 4px 10px',
          transition: 'background-color 0.15s ease',
        }"
      >
        Debug
      </button>
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
    isWideLandscape: {
      type: Boolean,
      default: false,
    },
  },

  emits: [
    "update:filterStr",
    "watch-click",
    "filter-input",
    "send-filters",
    "debug-click",
  ],

  data() {
    return {
      debugFlash: false,
    };
  },

  methods: {
    handleDebugClick() {
      this.debugFlash = true;
      this.$emit("debug-click");
      setTimeout(() => {
        this.debugFlash = false;
      }, 300);
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
  },
};
</script>
