<template>
  <div class="usb-node">
    <div
      class="node-row"
      @click="handleClick($event)"
      :style="{
        paddingLeft: depth * 20 + 'px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        backgroundColor: activeBg,
        paddingTop: '2px',
        paddingBottom: '2px',
        display: 'flex',
        alignItems: 'center',
        userSelect: 'none',
      }"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
    >
      <div
        style="
          width: 16px;
          text-align: center;
          margin-right: 4px;
          display: inline-block;
        "
      >
        <span
          v-if="node.type === 'folder'"
          style="font-family: monospace; font-weight: bold"
        >
          {{ expanded ? "-" : "+" }}
        </span>
        <span
          v-else
          style="color: #aaa"
          >&bull;</span
        >
      </div>
      <span
        :style="{ fontWeight: node.type === 'folder' ? 'bold' : 'normal' }"
        >{{ node.name }}</span
      >
    </div>
    <div v-if="expanded && node.children && node.children.length">
      <usb-node
        v-for="child in node.children"
        :key="child.name"
        :node="child"
        :depth="depth + 1"
        :path-prefix="fullPath"
        :selected="false"
        :selected-files="selectedFiles"
        @node-click="$emit('node-click', $event)"
      ></usb-node>
    </div>
  </div>
</template>

<script>
export default {
  name: "UsbNode",
  props: {
    node: { type: Object, required: true },
    depth: { type: Number, default: 0 },
    selected: { type: Boolean, default: false },
    selectedFiles: { type: Object, default: () => new Set() },
    pathPrefix: { type: String, default: "" },
  },
  emits: ["node-click"],
  data() {
    return {
      expanded: false,
      hover: false,
      highlighted: false,
    };
  },
  computed: {
    activeBg() {
      if (this.highlighted) return "#ffcccc";
      if (this.selected) return "lightyellow";
      if (
        this.node.type === "file" &&
        this.selectedFiles &&
        this.selectedFiles.has(this.fullPath)
      ) {
        return "lightyellow";
      }
      return this.hover ? "#eee" : "transparent";
    },
    fullPath() {
      return this.pathPrefix
        ? `${this.pathPrefix}/${this.node.name}`
        : this.node.name;
    },
  },
  methods: {
    handleClick(event) {
      if (event.altKey) {
        navigator.clipboard
          .writeText(this.fullPath)
          .catch((err) => console.error("Copy failed", err));
        this.highlighted = true;
        setTimeout(() => {
          this.highlighted = false;
        }, 300);
        return;
      }

      if (this.node.type === "folder") {
        this.expanded = !this.expanded;
      }
      this.$emit("node-click", {
        node: this.node,
        depth: this.depth,
        fullPath: this.fullPath,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      });
    },
  },
};
</script>
