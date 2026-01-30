<template>
  <div
    id="local"
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
      <div style="font-weight: bold; margin-right: auto">Local files</div>

      <span
        v-if="loading"
        style="color: lightgray; margin-right: 10px; font-weight: bold"
        >&lt;Loading...&gt;</span
      >

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
        :selected-files="selectedFiles"
        @node-click="handleNodeClick"
      />
    </div>
  </div>
</template>

<script>
import UsbNode from "./usb-node.vue";
import { config } from "../config.js";

export default {
  name: "Local",
  components: { UsbNode },
  props: {
    active: Boolean,
  },
  data() {
    return {
      tree: [],
      selectedName: null, // For top-level folder selection
      selectedFiles: new Set(), // For file selection inside a folder
      selectionParentPath: null, // To enforce "same folder" rule
      lastSelectedFile: null, // For check-range logic
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
        const url = `${config.torrentsApiUrl}/api/local/files`;
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
    handleNodeClick({ node, depth, fullPath, ctrlKey, shiftKey }) {
      // 1. Top-level folder selection
      if (depth === 0) {
        // If clicking top-level folder, clear any file selection context
        this.selectedFiles.clear();
        this.selectionParentPath = null;
        this.selectedName = node.name;
        this.lastSelectedFile = null;
        return;
      }

      // 2. File selection
      if (node.type === "file") {
        const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"));

        // If switching folders, or if a top-level folder was previously selected, reset.
        if (this.selectedName) {
          // Clearing top-level highlight because we are now selecting files
          this.selectedName = null;
        }

        if (
          this.selectionParentPath &&
          this.selectionParentPath !== parentPath
        ) {
          // We are in a different folder.
          this.selectedFiles.clear();
          this.selectionParentPath = null;
          // Fall through to treat as new selection
        }

        // Set the context if not set
        if (!this.selectionParentPath) {
          this.selectionParentPath = parentPath;
        }

        if (
          shiftKey &&
          this.lastSelectedFile &&
          this.selectionParentPath === parentPath
        ) {
          // Handle range selection
          const siblings = this.getSiblings(this.selectionParentPath);
          if (siblings) {
            const idx1 = siblings.findIndex(
              (n) => this.getPath(parentPath, n.name) === this.lastSelectedFile,
            );
            const idx2 = siblings.findIndex((n) => n.name === node.name);

            if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2);
              const end = Math.max(idx1, idx2);
              const range = siblings.slice(start, end + 1);

              // Add all into selection
              for (const s of range) {
                if (s.type === "file") {
                  this.selectedFiles.add(this.getPath(parentPath, s.name));
                }
              }
            }
          }
        } else if (ctrlKey) {
          // Toggle
          if (this.selectedFiles.has(fullPath)) {
            this.selectedFiles.delete(fullPath);
            if (this.selectedFiles.size === 0) {
              this.selectionParentPath = null;
            }
          } else {
            this.selectedFiles.add(fullPath);
          }
          this.lastSelectedFile = fullPath;
        } else {
          // Single select
          this.selectedFiles.clear();
          this.selectedFiles.add(fullPath);
          this.selectionParentPath = parentPath;
          this.lastSelectedFile = fullPath;
        }
      }
    },
    getPath(parent, name) {
      return parent ? `${parent}/${name}` : name;
    },
    getSiblings(parentPath) {
      // Traverse tree to find the array of children for this path
      // parentPath e.g. "ShowName/Season 1"
      if (!parentPath) return []; // Should not happen for files inside folder
      const parts = parentPath.split("/");
      // First part is top level
      let current = this.tree.find((n) => n.name === parts[0]);
      if (!current) return [];

      for (let i = 1; i < parts.length; i++) {
        if (!current.children) return [];
        current = current.children.find((n) => n.name === parts[i]);
        if (!current) return [];
      }
      return current.children || [];
    },
  },
};
</script>
