<template lang="pug">

#filepane(:style="{ height:'100%', width:'100%', padding:'5px', margin:0, marginLeft:'16px', display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ position:'sticky', top:'0px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'5px', paddingLeft:'5px', paddingRight:'5px', paddingBottom:'5px', margin:0, display:'flex', alignItems:'center' }")
    div(:style="{ flex:'1 1 auto', minWidth:'0px', fontWeight:'bold', fontSize:'18px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }") {{ showName }}

    button(
      @click.stop="collapseToggle"
      :disabled="busy || !Array.isArray(tree)"
      style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:2px solid #bbb; background-color:whitesmoke; margin-right:20px;"
    ) {{ expanded.size === 0 ? 'Expand' : 'Collapse' }}

    button(
      @click.stop="toggleVideosOnly"
      :disabled="busy || !Array.isArray(tree)"
      :style="{ backgroundColor: videosOnly ? '#ddd' : 'whitesmoke' }"
      style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:2px solid #bbb; margin-right:20px;"
    ) Videos

    button(
      @click.stop="copyPaneToClipboard"
      :disabled="busy || !Array.isArray(tree)"
      style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:2px solid #bbb; background-color:whitesmoke; margin-right:20px;"
    ) Copy

    button(
      @click.stop="refreshShows"
      style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:2px solid #bbb; background-color:whitesmoke; margin-right:20px;"
    ) Refresh

  div(v-if="error" style="text-align:left; color:#c00; margin-top:10px; font-size:14px; white-space:pre-line; padding:0 10px;")
    div Error: {{ error }}

  div(
    v-else
    ref="scroller"
    @click="clearSelections"
    :style="{ flex:'1 1 auto', margin:'0px', padding:'10px', overflowY:'auto', overflowX:'auto', background:'#fff', fontFamily:'sans-serif', fontSize:'13px', fontWeight:'normal', lineHeight:'1.56' }"
  )
    div(v-if="busy" style="color:#666; padding:10px;") Loading...

    TreeNodes(
      v-else-if="Array.isArray(tree)"
      :nodes="tree"
      :parentPath="rootPath"
      :depth="0"
      :expanded="expanded"
      :selectedFiles="selectedFiles"
      :videosOnly="videosOnly"
      @dir-click="onDirClick"
      @file-click="onFileClick"
      @clear-selections="clearSelections"
    )

    div(v-else style="color:#666; padding:10px;") No data.

</template>

<script>
import { h, nextTick } from 'vue';
import parseTorrentTitle from 'parse-torrent-title';
import evtBus from '../evtBus.js';
import * as srvr from '../srvr.js';

const BASE = '/mnt/media/tv';

const VIDEO_EXTS = new Set([
  'mkv', 'avi', 'mp4', 'm4v', 'mov', 'wmv', 'webm',
  'mpg', 'mpeg', 'ts', 'm2ts'
]);

const getExt = (name) => {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  if (i < 0) return '';
  return s.slice(i + 1).toLowerCase();
};

const isVideoFileName = (name) => VIDEO_EXTS.has(getExt(name));

const toNum = (v) => {
  if (v == null) return null;
  if (Array.isArray(v)) return toNum(v[0]);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const parseSeasonEpisode = (name) => {
  try {
    const s = String(name || '');
    const parsed = (typeof parseTorrentTitle === 'function')
      ? parseTorrentTitle(s)
      : (typeof parseTorrentTitle?.parse === 'function')
          ? parseTorrentTitle.parse(s)
          : null;
    const season = toNum(parsed?.season ?? parsed?.seasonNumber ?? parsed?.seasons);
    const episode = toNum(parsed?.episode ?? parsed?.episodeNumber ?? parsed?.episodes);
    return { season, episode };
  } catch (_) {
    return { season: null, episode: null };
  }
};

const filterNodesForVideos = (nodes, videosOnly) => {
  const arr = Array.isArray(nodes) ? nodes : [];
  if (!videosOnly) return arr;

  const out = [];
  for (const node of arr) {
    if (typeof node === 'string') {
      if (isVideoFileName(node)) out.push(node);
      continue;
    }
    const entry = dirEntry(node);
    if (!entry) continue;
    const kids = filterNodesForVideos(entry.children, true);
    if (kids.length > 0) out.push({ [entry.name]: kids });
  }
  return out;
};

const sortDirNodes = (nodes) => {
  const arr = Array.isArray(nodes) ? nodes.slice() : [];

  // Stable sort.
  const withIdx = arr.map((node, idx) => ({ node, idx }));
  withIdx.sort((a, b) => {
    const aNode = a.node;
    const bNode = b.node;

    const aDir = !!dirEntry(aNode);
    const bDir = !!dirEntry(bNode);
    if (aDir !== bDir) return aDir ? -1 : 1;

    // Directories: alpha by name.
    if (aDir && bDir) {
      const an = (dirEntry(aNode)?.name || '').toLowerCase();
      const bn = (dirEntry(bNode)?.name || '').toLowerCase();
      const c = an.localeCompare(bn);
      return c || (a.idx - b.idx);
    }

    // Files.
    const aName = String(aNode || '');
    const bName = String(bNode || '');
    const aVideo = isVideoFileName(aName);
    const bVideo = isVideoFileName(bName);
    if (aVideo !== bVideo) return aVideo ? -1 : 1;

    const aSe = parseSeasonEpisode(aName);
    const bSe = parseSeasonEpisode(bName);
    const aHas = aSe.season != null && aSe.episode != null;
    const bHas = bSe.season != null && bSe.episode != null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      if (aSe.season !== bSe.season) return aSe.season - bSe.season;
      if (aSe.episode !== bSe.episode) return aSe.episode - bSe.episode;
    }

    const c = aName.toLowerCase().localeCompare(bName.toLowerCase());
    return c || (a.idx - b.idx);
  });

  return withIdx.map((x) => x.node);
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const sanitizeRelPath = (input) => {
  let s = String(input || '').trim();
  if (!s) return '';
  // Normalize slashes.
  s = s.replace(/\\/g, '/');
    s = s.replace(/\/+/g, '/');

  // Strip base prefix if present.
  if (s === BASE) s = '';
  else if (s.startsWith(BASE + '/')) s = s.slice((BASE + '/').length);

  // Keep relative.
  s = s.replace(/^\/+/, '');

  // Collapse '.', '..' segments.
  const parts = s.split('/').filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
};

const joinRel = (baseRel, childName) => {
  const b = sanitizeRelPath(baseRel);
  const c = String(childName || '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!b) return sanitizeRelPath(c);
  if (!c) return b;
  return sanitizeRelPath(`${b}/${c}`);
};

const fullFromRel = (rel) => {
  const r = sanitizeRelPath(rel);
  return r ? `${BASE}/${r}` : BASE;
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
    expanded: { type: Object, required: true },
    selectedFiles: { type: Object, required: true },
    videosOnly: { type: Boolean, default: false }
  },
  emits: ['dir-click', 'file-click', 'clear-selections'],
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
    dirFileCount(node) {
      const kids = filterNodesForVideos(this.dirChildren(node), this.videosOnly);
      let n = 0;
      for (const child of kids) {
        if (typeof child === 'string') n++;
      }
      return n;
    },
    dirPath(node) {
      const name = this.dirName(node);
      return joinRel(this.parentPath, name);
    },
    isExpandedDir(node) {
      const p = this.dirPath(node);
      return this.expanded?.has?.(p);
    },
    indentStyle() {
      const spaces = Math.max(0, Number(this.depth) || 0) * 2;
      return { paddingLeft: `${spaces}ch` };
    },
    onDirNameClick(e, node) {
      e?.stopPropagation?.();
      const p = this.dirPath(node);
      this.$emit('dir-click', { path: p, alt: !!e?.altKey, ctrl: !!(e?.ctrlKey || e?.metaKey), shift: !!e?.shiftKey, area: 'name' });
    },
    onFileNameClick(e, name) {
      e?.stopPropagation?.();
      const p = joinRel(this.parentPath, name);
      this.$emit('file-click', { path: p, alt: !!e?.altKey, ctrl: !!(e?.ctrlKey || e?.metaKey), shift: !!e?.shiftKey, area: 'name' });
    }
  },
  render() {
    const nodes = sortDirNodes(filterNodesForVideos(this.nodes, this.videosOnly));
    const softWrap = (s) => String(s ?? '').replace(/([^A-Za-z0-9\s])/g, '$1\u200B');
    const children = nodes.map((node, idx) => {
      const key = this.nodeKey(node, idx);

      const rowStyleBase = {
        ...this.indentStyle(),
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0ch',
        userSelect: 'none'
      };

      const twistyStyle = {
        flex: '0 0 2ch',
        width: '2ch',
        textAlign: 'left'
      };

      const nameTextStyle = {
        flex: '1 1 auto',
        minWidth: '0px',
        display: 'block',
        whiteSpace: 'normal',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        // Hanging indent: wrapped lines start 4ch to the right.
        paddingLeft: '4ch',
        textIndent: '-4ch'
      };

      if (typeof node === 'string') {
        const filePath = joinRel(this.parentPath, node);
        const isSelected = !!this.selectedFiles?.has?.(filePath);
        return h(
          'div',
          {
            key,
            'data-type': 'file',
            'data-nodepath': filePath,
            style: {
              cursor: 'default',
              ...rowStyleBase,
              backgroundColor: isSelected ? 'yellow' : ''
            }
          },
          [
            h('span', { style: twistyStyle }, ''),
            h(
              'span',
              {
                'data-click': 'name',
                style: { ...nameTextStyle }
              },
              [
                h(
                  'span',
                  {
                    style: { cursor: 'pointer' },
                    onClick: (e) => this.onFileNameClick(e, node)
                  },
                  softWrap(node)
                )
              ]
            )
          ]
        );
      }

      if (this.isDir(node)) {
        const isOpen = this.isExpandedDir(node);
        const name = this.dirName(node);
        const dirPathVal = this.dirPath(node);
        const fileCount = this.dirFileCount(node);

        const header = h(
          'div',
          {
            key: `${key}:h`,
            title: 'Click to expand/collapse',
            onClick: (e) => {
              e?.stopPropagation?.();
              this.$emit('clear-selections');
            },
            style: {
              cursor: 'default',
              ...rowStyleBase,
              fontWeight: 'bold'
            },
            'data-type': 'dir',
            'data-nodepath': dirPathVal
          },
          [
            h(
              'span',
              {
                'data-click': 'name',
                style: { ...twistyStyle, cursor: 'pointer' },
                onClick: (e) => this.onDirNameClick(e, node)
              },
              isOpen ? '▾' : '▸'
            ),
            h(
              'span',
              {
                'data-click': 'name',
                style: { ...nameTextStyle, fontWeight: 'bold' }
              },
              [
                h(
                  'span',
                  {
                    style: { cursor: 'pointer', fontWeight: 'bold' },
                    onClick: (e) => this.onDirNameClick(e, node)
                  },
                  softWrap(name)
                ),
                h(
                  'span',
                  {
                    style: { fontWeight: 'normal' }
                  },
                  ` (${fileCount})`
                )
              ]
            )
          ]
        );

        const body = isOpen
          ? h(TreeNodes, {
              key: `${key}:c`,
              nodes: this.dirChildren(node),
              parentPath: dirPathVal,
              depth: (Number(this.depth) || 0) + 1,
              expanded: this.expanded,
              selectedFiles: this.selectedFiles,
              videosOnly: this.videosOnly,
              onDirClick: (payload) => this.$emit('dir-click', payload),
              onFileClick: (payload) => this.$emit('file-click', payload),
              onClearSelections: () => this.$emit('clear-selections')
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
      showName: '',
      rootPath: '',
      tree: null,
      error: null,
      busy: false,
      expanded: new Set(),
      videosOnly: false,
      selectedFiles: new Set(),
      selectionAnchor: null
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
      this.showName = String(show?.Name || '').trim();
      const rel = sanitizeRelPath(show?.Path);
      void this.openRel(rel);
    },

    clearSelections() {
      if (this.selectedFiles.size === 0 && !this.selectionAnchor) return;
      this.selectedFiles = new Set();
      this.selectionAnchor = null;
    },

    toggleVideosOnly() {
      this.videosOnly = !this.videosOnly;
      this.pruneSelectionsToVisible();
    },

    getVisibleFilePaths() {
      const out = [];
      const walk = (nodes, parentRel) => {
        const arr = filterNodesForVideos(nodes, this.videosOnly);
        for (const node of arr) {
          if (typeof node === 'string') {
            out.push(joinRel(parentRel, node));
            continue;
          }
          const entry = dirEntry(node);
          if (!entry) continue;
          const dPath = joinRel(parentRel, entry.name);
          if (this.expanded.has(dPath)) {
            walk(entry.children, dPath);
          }
        }
      };
      walk(this.tree, this.rootPath);
      return out;
    },

    pruneSelectionsToVisible() {
      if (this.selectedFiles.size === 0) return;
      const visible = new Set(this.getVisibleFilePaths());
      const next = new Set();
      for (const p of this.selectedFiles) {
        if (visible.has(p)) next.add(p);
      }
      this.selectedFiles = next;
      if (this.selectionAnchor && !visible.has(this.selectionAnchor)) {
        this.selectionAnchor = null;
      }
    },

    collapseToggle() {
      if (!Array.isArray(this.tree)) return;
      if (this.expanded.size > 0) this.closeAll();
      else this.openAll();
    },

    refreshShows() {
      evtBus.emit('library-refresh-complete', { showReloadDialog: true });
    },

    async copyPaneToClipboard() {
      if (!Array.isArray(this.tree)) return;

      const lines = [];
      const walk = (nodes, depth) => {
        const arr = sortDirNodes(filterNodesForVideos(nodes, this.videosOnly));
        for (const node of arr) {
          if (typeof node === 'string') {
            lines.push(`${'  '.repeat(depth)}${node}`);
            continue;
          }
          const entry = dirEntry(node);
          if (!entry) continue;
          const kids = filterNodesForVideos(entry.children, this.videosOnly);
          const fileCount = kids.filter((k) => typeof k === 'string').length;
          lines.push(`${'  '.repeat(depth)}${entry.name} (${fileCount})`);
          walk(entry.children, depth + 1);
        }
      };

      walk(this.tree, 0);

      try {
        await navigator.clipboard.writeText(lines.join('\n'));
      } catch (e) {
        this.error = e?.message || String(e);
      }
    },

    async openRel(relPath) {
      this.error = null;
      this.busy = true;
      this.tree = null;
      this.expanded = new Set();
      this.clearSelections();
      this.rootPath = sanitizeRelPath(relPath);
      try {
        // Always call getFile() with a full BASE-prefixed path.
        const res = await srvr.getFile(fullFromRel(this.rootPath));
        if (Array.isArray(res)) {
          this.tree = res;
        } else if (res && Array.isArray(res.children)) {
          this.tree = res.children;
        } else {
          this.tree = null;
          this.error = 'Unexpected response from getFile.';
        }
      } catch (e) {
        this.error = e?.err || e?.message || String(e);
      } finally {
        this.busy = false;
      }
    },

    async confirmAndDeletePaths(fullPaths) {
      const paths = Array.isArray(fullPaths) ? fullPaths.filter(Boolean) : [];
      if (paths.length === 0) return;

      const msg = (paths.length === 1)
        ? `Is it OK to delete ${paths[0]}.`
        : `Is it OK to delete ${paths.length} files.`;
      const ok = window.confirm(msg);
      if (!ok) return;

      let didDelete = false;
      try {
        for (const p of paths) {
          await srvr.deletePath(p);
          didDelete = true;
        }
      } catch (e) {
        this.error = e?.message || String(e);
      }

      await this.openRel(this.rootPath);

      if (didDelete) evtBus.emit('library-refresh-complete', { showReloadDialog: true });
    },

    async onDirClick(payload) {
      const rel = sanitizeRelPath(payload?.path);
      if (!rel) return;
      if (payload?.alt) {
        await this.confirmAndDeletePaths([fullFromRel(rel)]);
        return;
      }

      const wasOpen = this.expanded.has(rel);
      if (wasOpen) {
        this.expanded.delete(rel);
        this.expanded = new Set(this.expanded);
        this.pruneSelectionsToVisible();
        return;
      }

      this.expanded.add(rel);
      this.expanded = new Set(this.expanded);
      await nextTick();
      this.ensureExpandedDirVisible(rel);
    },

    async onFileClick(payload) {
      const rel = sanitizeRelPath(payload?.path);
      if (!rel) return;

      const isAlt = !!payload?.alt;
      const isCtrl = !!payload?.ctrl;
      const isShift = !!payload?.shift;
      const area = String(payload?.area || 'name');
      const isSelected = this.selectedFiles.has(rel);

      // Alt-click on a selected file name => delete confirmation for selection.
      if (isAlt && isSelected && area === 'name') {
        const sel = Array.from(this.selectedFiles);
        const full = sel.map(p => fullFromRel(p));
        await this.confirmAndDeletePaths(full);
        return;
      }

      // Alt-click on an unselected file name => delete just that file.
      if (isAlt && !isSelected && area === 'name') {
        await this.confirmAndDeletePaths([fullFromRel(rel)]);
        return;
      }

      const visible = this.getVisibleFilePaths();
      const idx = visible.indexOf(rel);
      const anchor = this.selectionAnchor && visible.includes(this.selectionAnchor)
        ? this.selectionAnchor
        : null;

      if (isShift && anchor && idx >= 0) {
        const dirOf = (p) => {
          const s = String(p || '');
          const i = s.lastIndexOf('/');
          return i >= 0 ? s.slice(0, i) : '';
        };

        // Shift-click only extends a range within the same directory as the
        // last-selected file. If there's no selection anchor in this directory,
        // do nothing and do not clear any existing selections.
        const targetDir = dirOf(rel);
        const anchorDir = dirOf(anchor);
        if (targetDir !== anchorDir) return;
        if (!this.selectedFiles.has(anchor)) return;

        const visibleInDir = visible.filter(p => dirOf(p) === targetDir);
        const aIdx = visibleInDir.indexOf(anchor);
        const tIdx = visibleInDir.indexOf(rel);
        if (aIdx < 0 || tIdx < 0) return;

        const lo = Math.min(aIdx, tIdx);
        const hi = Math.max(aIdx, tIdx);
        const range = visibleInDir.slice(lo, hi + 1);

        const next = new Set(this.selectedFiles);
        for (const p of range) next.add(p);
        this.selectedFiles = next;
        this.selectionAnchor = rel;
        return;
      }

      if (isCtrl) {
        const next = new Set(this.selectedFiles);
        if (next.has(rel)) next.delete(rel);
        else next.add(rel);
        this.selectedFiles = next;
        this.selectionAnchor = rel;
        return;
      }

      // Plain click selects only this file.
      this.selectedFiles = new Set([rel]);
      this.selectionAnchor = rel;
    },

    ensureExpandedDirVisible(dirRel) {
      const sc = this.$refs.scroller;
      if (!sc) return;
      const esc = (s) => (window?.CSS?.escape ? CSS.escape(String(s || '')) : String(s || '').replace(/"/g, '\\"'));

      const headerSel = `[data-type="dir"][data-nodepath="${esc(dirRel)}"]`;
      const headerEl = sc.querySelector(headerSel);
      if (!headerEl) return;

      const prefix = dirRel.endsWith('/') ? dirRel : `${dirRel}/`;
      const childSel = `[data-nodepath^="${esc(prefix)}"]`;
      const childEls = sc.querySelectorAll(childSel);
      if (!childEls || childEls.length === 0) return;
      const lastEl = childEls[childEls.length - 1];

      // Use client rects instead of offsetTop because offsetTop is relative to the
      // element's offsetParent (which may not be the scroll container).
      const scRect = sc.getBoundingClientRect();
      const headerRect = headerEl.getBoundingClientRect();
      const lastRect = lastEl.getBoundingClientRect();

      // How much we need to scroll DOWN so the last child becomes visible at the bottom.
      // Positive means it's below the viewport.
      const needDown = Math.max(0, lastRect.bottom - scRect.bottom);
      const desired = sc.scrollTop + needDown;

      // Constraint: after scrolling, the header must still be visible (not above top).
      // Scrolling down by delta moves the header up by delta.
      const headerTopNow = headerRect.top - scRect.top;
      const maxDeltaDown = Math.max(0, headerTopNow);
      const maxScrollForHeaderVisible = sc.scrollTop + maxDeltaDown;

      const nextScroll = Math.min(desired, maxScrollForHeaderVisible);
      if (Number.isFinite(nextScroll) && nextScroll !== sc.scrollTop) sc.scrollTop = nextScroll;
    },

    openAll() {
      if (!Array.isArray(this.tree)) return;
      const dirs = [];
      const walk = (nodes, parentRel) => {
        const arr = Array.isArray(nodes) ? nodes : [];
        for (const node of arr) {
          const entry = dirEntry(node);
          if (!entry) continue;
          const dPath = joinRel(parentRel, entry.name);
          dirs.push(dPath);
          walk(entry.children, dPath);
        }
      };
      walk(this.tree, this.rootPath);
      this.expanded = new Set(dirs);
    },

    closeAll() {
      this.expanded = new Set();
      this.pruneSelectionsToVisible();
    },

    // Sel button removed.
  }
};
</script>
