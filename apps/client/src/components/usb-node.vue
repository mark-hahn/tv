<template>
  <div class="usb-node">
    <div
      class="node-row"
      @click="toggle"
      :style="{
        paddingLeft: depth * 20 + 'px',
        cursor: node.type === 'folder' ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        backgroundColor: hover ? '#eee' : 'transparent',
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
  },
  data() {
    return {
      expanded: false,
      hover: false,
    };
  },
  methods: {
    toggle() {
      if (this.node.type === "folder") {
        this.expanded = !this.expanded;
      }
    },
  },
};
</script>
