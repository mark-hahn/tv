<template>
  <div
    id="usb"
    :style="{
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: '#fafafa',
    }"
  >
    <!-- Header -->
    <div
      :style="{
        display: 'flex',
        alignItems: 'center',
        padding: '8px',
        borderBottom: '1px solid #ddd',
        flex: '0 0 auto',
      }"
    >
      <div style="font-weight: bold; margin-right: auto">USB Files</div>

      <span
        v-if="loading"
        style="color: lightgray; margin-right: 10px; font-weight: bold"
        >&lt;Loading...&gt;</span
      >

      <button
        @click="forceDown"
        :disabled="loading || !selectedName"
        style="
          cursor: pointer;
          border-radius: 7px;
          padding: 4px 10px;
          border: 1px solid #bbb;
          background-color: whitesmoke;
          margin-right: 8px;
        "
      >
        Force Down
      </button>

      <button
        @click="refresh"
        :disabled="loading"
        style="
          cursor: pointer;
          border-radius: 7px;
          padding: 4px 10px;
          border: 1px solid #bbb;
          background-color: whitesmoke;
        "
      >
        Refresh
      </button>
    </div>

    <!-- Tree -->
    <div
      :style="{
        flex: '1 1 auto',
        overflow: 'auto',
        padding: '0px 8px',
      }"
    >
      <div
        v-if="error"
        style="color: red; margin: 10px 0"
      >
        {{ error }}
      </div>
      <usb-node
        v-for="node in tree"
        :key="node.name"
        :node="node"
        :selected="selectedName === node.name"
        @node-click="handleNodeClick"
      />
    </div>
  </div>
</template>

<script>
import UsbNode from "./usb-node.vue";
import { config } from "../config.js";

export default {
  name: "Usb",
  components: { UsbNode },
  props: {
    active: Boolean,
  },
  data() {
    return {
      tree: [],
      selectedName: null,
      loading: false,
      error: null,
      hasLoaded: false,
    };
  },
  watch: {
    active(val) {
      if (val && !this.hasLoaded && !this.loading) {
        this.fetchFiles();
      }
    },
  },
  mounted() {
    if (this.active && !this.hasLoaded) {
      this.fetchFiles();
    }
  },
  methods: {
    async fetchFiles() {
      this.loading = true;
      this.error = null;
      try {
        const url = `${config.torrentsApiUrl}/api/usb/files`;
        const res = await fetch(url);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        this.tree = await res.json();
        this.hasLoaded = true;
      } catch (e) {
        this.error = e.message || "Failed to load files";
      } finally {
        this.loading = false;
      }
    },
    refresh() {
      this.fetchFiles();
    },
    handleNodeClick({ node, depth }) {
      if (depth === 0) {
        this.selectedName = node.name;
      }
    },
    collectFiles(node, currentPath) {
      if (node.type === "file") {
        // Format as YYYY-MM-DD-Path-Size
        // Ensure date exists, otherwise fallback to generic/current?
        // Apps/down expects a date, so let's default if missing (though it shouldn't be).
        const date = node.date || new Date().toISOString().slice(0, 10);
        const size = node.size || 0;
        return [`${date}-${currentPath}-${size}`];
      }
      if (node.children) {
        return node.children.flatMap((child) =>
          this.collectFiles(child, currentPath + "/" + child.name),
        );
      }
      return [];
    },
    async forceDown() {
      if (!this.selectedName) return;

      const node = this.tree.find((n) => n.name === this.selectedName);
      if (!node) return;

      const files = this.collectFiles(node, node.name);
      if (files.length === 0) {
        alert("No files found to download.");
        return;
      }

      if (!confirm(`Force download ${files.length} files from '${node.name}'?`))
        return;

      this.loading = true;
      try {
        const url = `${config.torrentsApiUrl}/api/tvproc/forceDown`;
        const res = await fetch(url, {
          method: "POST",
          body: JSON.stringify(files),
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const txt = await res.text();
          let msg = txt;
          try {
            msg = JSON.parse(txt).error || msg;
          } catch (e) {}
          throw new Error(msg);
        }
        alert("Force download started.");
      } catch (e) {
        alert("Error: " + e.message);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
