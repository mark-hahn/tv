<template lang="pug">

#filepane(:style="{ height:'100%', width:'100%', padding:'5px', margin:0, marginLeft:'16px', display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ position:'sticky', top:'0px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'5px', paddingLeft:'5px', paddingRight:'5px', paddingBottom:'5px', margin:0, display:'flex', gap:'8px', alignItems:'center' }")
    input(
      v-model="pathInput"
      @keydown.enter.stop.prevent="openFromInput"
      placeholder="Path"
      :style="{ flex:'1 1 auto', minWidth:'0px', fontSize:'13px', padding:'4px 6px', border:'1px solid #bbb', borderRadius:'7px', textAlign:'right' }"
    )
    button(
      @click.stop="openFromInput"
      :disabled="busy"
      style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:1px solid #bbb; background-color:whitesmoke;"
    ) Open

  div(v-if="error" style="text-align:left; color:#c00; margin-top:10px; font-size:14px; white-space:pre-line; padding:0 10px;")
    div Error: {{ error }}

  div(
    v-else
    ref="scroller"
    :style="{ flex:'1 1 auto', margin:'0px', padding:'10px', overflowY:'auto', overflowX:'auto', background:'#fff', fontFamily:'sans-serif', fontSize:'13px', fontWeight:'normal' }"
  )
    div(v-if="busy" style="color:#666; padding:10px;") Loading...

    TreeNodes(
      v-else-if="Array.isArray(tree)"
      :nodes="tree"
      :parentPath="rootPath"
      :depth="0"
      :expanded="expanded"
      @toggle-dir="toggleDir"
      @copy-file="copyFile"
    )

    div(v-else style="color:#666; padding:10px;") No data.

</template>

<script>
import { h } from 'vue';
import evtBus from '../evtBus.js';
import * as srvr from '../srvr.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const detectSep = (p) => {
  const s = String(p || '');
  // Prefer Windows-style if it's clearly Windows.
  if (s.includes('\\') && !s.includes('/')) return '\\';
  return '/';
};

const trimTrailingSeps = (p) => String(p || '').replace(/[\\/]+$/, '');
const trimLeadingSeps = (p) => String(p || '').replace(/^[\\/]+/, '');

const joinPath = (base, child) => {
  const b = String(base || '');
  const c = String(child || '');
  if (!b) return trimLeadingSeps(c);
  if (!c) return trimTrailingSeps(b);
  const sep = detectSep(b);
  return `${trimTrailingSeps(b)}${sep}${trimLeadingSeps(c)}`;
};

const nodeKey = (node, idx) => {
  if (typeof node === 'string') return `f:${node}:${idx}`;
  if (isObj(node)) {
    const ks = Object.keys(node);
    return `d:${ks.join('|')}:${idx}`;
  }
  return `n:${idx}`;
};

const dirEntry = (node) => {
  if (!isObj(node)) return null;
  const keys = Object.keys(node);
  if (keys.length !== 1) return null;
  const name = keys[0];
  const children = node[name];
  return { name, children: Array.isArray(children) ? children : [] };
};

const TreeNodes = {
  name: 'TreeNodes',
  props: {
    nodes: { type: Array, required: true },
    parentPath: { type: String, required: true },
    depth: { type: Number, required: true },
    expanded: { type: Object, required: true }
  },
  emits: ['toggle-dir', 'copy-file'],
  methods: {
    nodeKey,
    isDir(node) {
      return !!dirEntry(node);
    },
    dirName(node) {
      return dirEntry(node)?.name || '';
    },
    dirChildren(node) {
      return dirEntry(node)?.children || [];
    },
    dirPath(node) {
      const name = this.dirName(node);
      return joinPath(this.parentPath, name);
    },
    isExpandedDir(node) {
      const p = this.dirPath(node);
      return this.expanded?.has?.(p);
    },
    indentStyle() {
      const px = Math.max(0, Number(this.depth) || 0) * 16;
      return { paddingLeft: `${px}px` };
    },
    onToggle(node) {
      const p = this.dirPath(node);
      this.$emit('toggle-dir', p);
    },
    onCopyFile(name) {
      const p = joinPath(this.parentPath, name);
      this.$emit('copy-file', p);
    }
  },
  render() {
    const nodes = Array.isArray(this.nodes) ? this.nodes : [];
    const children = nodes.map((node, idx) => {
      const key = this.nodeKey(node, idx);

      if (typeof node === 'string') {
        return h(
          'div',
          {
            key,
            title: 'Click to copy full path',
            onClick: (e) => {
              e?.stopPropagation?.();
              this.onCopyFile(node);
            },
            style: {
              ...this.indentStyle(),
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none'
            }
          },
          node
        );
      }

      if (this.isDir(node)) {
        const isOpen = this.isExpandedDir(node);
        const name = this.dirName(node);
        const dirPathVal = this.dirPath(node);

        const header = h(
          'div',
          {
            key: `${key}:h`,
            title: 'Click to expand/collapse',
            onClick: (e) => {
              e?.stopPropagation?.();
              this.onToggle(node);
            },
            style: {
              ...this.indentStyle(),
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              fontWeight: 'bold'
            }
          },
          `${isOpen ? '▾' : '▸'} ${name}`
        );

        const body = isOpen
          ? h(TreeNodes, {
              key: `${key}:c`,
              nodes: this.dirChildren(node),
              parentPath: dirPathVal,
              depth: (Number(this.depth) || 0) + 1,
              expanded: this.expanded,
              onToggleDir: (p) => this.$emit('toggle-dir', p),
              onCopyFile: (p) => this.$emit('copy-file', p)
            })
          : null;

        return h('div', { key }, [header, body]);
      }

      // Unknown node type; skip.
      return null;
    });

    return h('div', {}, children);
  }
};

export default {
  name: 'FilePane',
  components: { TreeNodes },

  props: {
    simpleMode: { type: Boolean, default: false },
    sizing: { type: Object, default: () => ({}) }
  },

  data() {
    return {
      pathInput: '',
      rootPath: '',
      tree: null,
      error: null,
      busy: false,
      expanded: new Set()
    };
  },

  mounted() {
    evtBus.on('setUpSeries', this.onSetUpSeries);
  },

  unmounted() {
    evtBus.off('setUpSeries', this.onSetUpSeries);
  },

  methods: {
    onSetUpSeries(show) {
      const p = String(show?.Path || '').trim();
      if (!p) return;
      this.pathInput = p;
      // Auto-load to keep in sync with show selection.
      void this.openPath(p);
    },

    async openFromInput() {
      const p = String(this.pathInput || '').trim();
      if (!p) return;
      await this.openPath(p);
    },

    async openPath(path) {
      this.error = null;
      this.busy = true;
      this.tree = null;
      this.expanded = new Set();
      this.rootPath = String(path || '').trim();
      try {
        const res = await srvr.getFile(this.rootPath);
        if (Array.isArray(res)) {
          this.tree = res;
        } else if (res && Array.isArray(res.children)) {
          this.tree = res.children;
        } else {
          this.tree = null;
          this.error = 'Unexpected response from getFile.';
        }
      } catch (e) {
        this.error = e?.message || String(e);
      } finally {
        this.busy = false;
      }
    },

    toggleDir(dirPath) {
      const p = String(dirPath || '').trim();
      if (!p) return;
      if (this.expanded.has(p)) this.expanded.delete(p);
      else this.expanded.add(p);
      // Force update since Set is not deeply reactive.
      this.expanded = new Set(this.expanded);
    },

    async copyFile(fullPath) {
      const p = String(fullPath || '').trim();
      if (!p) return;
      try {
        await navigator.clipboard.writeText(p);
      } catch (e) {
        this.error = `Clipboard copy failed: ${e?.message || String(e)}`;
      }
    }
  }
};
</script>
