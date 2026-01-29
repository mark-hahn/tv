<template>
  <div class="usb-node">
    <div
      class="node-row"
      @click="handleClick"
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
  },
  emits: ["node-click"],
  data() {
    return {
      expanded: false,
      hover: false,
    };
  },
  computed: {
    activeBg() {
      if (this.selected) return "lightyellow";
      return this.hover ? "#eee" : "transparent";
    },
  },
  methods: {
    handleClick() {
      if (this.node.type === "folder") {
        this.expanded = !this.expanded;
      }
      this.$emit("node-click", { node: this.node, depth: this.depth });
    },
  },
};
</script>
