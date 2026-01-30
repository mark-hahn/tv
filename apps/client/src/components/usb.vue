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
  name: "Usb",
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
        // Also if we have existing file selection but in a DIFFERENT parent, reset?
        // User requirements: "when files inside folder are selected do not allow any files outside of that folder ... to be selected"
        
        if (this.selectedName) {
            // Clearing top-level highlight because we are now selecting files
            this.selectedName = null;
        }

        if (this.selectionParentPath && this.selectionParentPath !== parentPath) {
           // We are in a different folder. 
           // If user tries to add to selection (ctrl/shift), we must block or reset.
           // Prompt says "do not allow". We'll treat it as a reset (switch context).
           this.selectedFiles.clear();
           this.selectionParentPath = null;
           // Fall through to treat as new selection
        }

        // Set the context if not set
        if (!this.selectionParentPath) {
            this.selectionParentPath = parentPath;
        }

        if (shiftKey && this.lastSelectedFile && this.selectionParentPath === parentPath) {
            // Handle range selection
            // We need to find the list of siblings to determine range.
            // This is tricky without reference to the parent's children array.
            // But we can traverse `this.tree` to find the parent node.
            const siblings = this.getSiblings(this.selectionParentPath);
            if (siblings) {
                const idx1 = siblings.findIndex(n => this.getPath(parentPath, n.name) === this.lastSelectedFile);
                const idx2 = siblings.findIndex(n => n.name === node.name);
                
                if (idx1 !== -1 && idx2 !== -1) {
                    const start = Math.min(idx1, idx2);
                    const end = Math.max(idx1, idx2);
                    const range = siblings.slice(start, end + 1);
                    
                    // Add all into selection
                    for (const s of range) {
                        if (s.type === 'file') {
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
        const parts = parentPath.split('/');
        // First part is top level
        let current = this.tree.find(n => n.name === parts[0]);
        if (!current) return [];
        
        for (let i = 1; i < parts.length; i++) {
            if (!current.children) return [];
            current = current.children.find(n => n.name === parts[i]);
            if (!current) return [];
        }
        return current.children || [];
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
      if (!this.selectedName && this.selectedFiles.size === 0) return;

      let files = [];
      let label = "";

      if (this.selectedName) {
        // Whole top-level folder selected
        const node = this.tree.find((n) => n.name === this.selectedName);
        if (!node) return;
        files = this.collectFiles(node, node.name);
        label = `'${node.name}'`;
      } else {
        // Individual files selected
        // We need to construct the file entries manually.
        // We know they are all in this.selectionParentPath
        // And we have the full paths in this.selectedFiles
        // We need the date/size info though, which is in the node objects.
        // So we should re-find them.
        const parentPath = this.selectionParentPath;
        const siblings = this.getSiblings(parentPath);
        
        files = [];
        for (const fileFullPath of this.selectedFiles) {
            const fileName = fileFullPath.split('/').pop();
            const node = siblings.find(n => n.name === fileName);
            if (node) {
                 // Reconstruct format expected by server/apps/down: YYYY-MM-DD-Path-Size
                 // But wait, the path should be full relative path from root?
                 // node.name is just filename. currentPath in collectFiles was accumulating.
                 // fullPath is exactly that accumulated path.
                 const date = node.date || new Date().toISOString().slice(0, 10);
                 const size = node.size || 0;
                 files.push(`${date}-${fileFullPath}-${size}`);
            }
        }
        label = `${files.length} selected files`;
      }

      if (files.length === 0) {
        alert("No files found to download.");
        return;
      }

      if (!confirm(`Force download ${label}?`))
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
        // Force download started - no alert needed.
      } catch (e) {
        alert("Error: " + e.message);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
