<template>
  <div
    v-if="node.type === 'separator'"
    style="height: 1px; background-color: #000; margin: 4px 0"
  ></div>
  <div
    v-else
    class="tree-node"
  >
    <div
      class="node-row"
      @click="handleClick($event)"
      :style="{
        paddingLeft: depth * 20 + 'px',
        cursor: 'pointer',
        backgroundColor: activeBg,
        paddingTop: '2px',
        paddingBottom: '2px',
        display: 'flex',
        alignItems: 'flex-start',
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
        :style="{
          fontWeight: node.type === 'folder' ? 'bold' : 'normal',
          whiteSpace: 'nowrap',
        }"
        >{{ wrapName(node.name) }}</span
      ><span
        v-if="node.held"
        style="white-space: nowrap"
        >{{ " (held)" }}</span
      ><span
        v-if="node.parseError"
        style="
          color: #b00;
          font-size: 11px;
          margin-left: 5px;
          font-weight: normal;
        "
        >({{ node.parseError }})</span
      >
    </div>
    <div v-if="expanded && node.children && node.children.length">
      <tree-node
        v-for="child in node.children"
        :key="child.name"
        :node="child"
        :depth="depth + 1"
        :path-prefix="fullPath"
        :copy-path="copyPath"
        :selected="false"
        :selected-files="selectedFiles"
        @node-click="$emit('node-click', $event)"
      ></tree-node>
    </div>
  </div>
</template>

<script>
import * as util from "../util.js";
import { unilog } from "../log.js";

export default {
  name: "TreeNode",
  props: {
    node: { type: Object, required: true },
    depth: { type: Number, default: 0 },
    selected: { type: Boolean, default: false },
    selectedFiles: { type: Object, default: () => new Set() },
    pathPrefix: { type: String, default: "" },
    // false: alt-copy just the node name; true: alt-copy the full relative path.
    copyPath: { type: Boolean, default: false },
  },
  emits: ["node-click"],
  data() {
    return {
      expanded: false,
      hover: false,
      highlighted: false,
    };
  },
  watch: {
    // "node.expanded" watcher removed as we use explicit expand() method
  },
  computed: {
    activeBg() {
      if (this.highlighted) return "#ffcccc";
      if (this.selected) return "lightyellow";
      if (
        (this.node.type === "file" || this.node.type === "folder") &&
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
    wrapName(name) {
      return util.wrapFileName(name);
    },
    expand() {
      this.expanded = true;
    },
    collapse() {
      this.expanded = false;
    },
    handleClick(event) {
      if (event.altKey) {
        const text = this.copyPath ? this.fullPath : this.node.name;
        navigator.clipboard
          .writeText(util.shellQuote(text))
          .catch((err) => unilog(1044, "Copy failed", err));
        this.highlighted = true;
        setTimeout(() => {
          this.highlighted = false;
        }, 300);
        return;
      }

      if (this.node.type === "folder") {
        if (!event.ctrlKey && !event.shiftKey) {
          this.expanded = !this.expanded;
          return;
        }
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
