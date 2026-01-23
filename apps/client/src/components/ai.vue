<template lang="pug">
#aiPane(:style="{ width:'100%', height:'100%', display:'flex', flexDirection:'column', boxSizing:'border-box', padding:(simpleMode ? '8px' : '12px'), position:'relative' }")

  div(
    v-if="activeShow && activeShow.Name"
    :style="{ flex:'0 0 auto', fontWeight:'bold', fontSize:(simpleMode ? '18px' : '22px'), marginBottom:'8px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', paddingRight:'180px' }"
  )
    span {{ activeShow.Name }}{{ previewMode ? '\u00A0|\u00A0Preview Mode' : '' }}
  // Scroll container
  div(style="flex:1 1 auto; min-height:0; overflow:auto;")
    // Centered column
    div(style="max-width:560px; width:100%; margin:0 auto; padding:12px 44px; box-sizing:border-box;")
      div(
        v-if="!canRun"
        style="min-height:0; display:flex; align-items:center; justify-content:center; color:#bbb; font-size:20px; padding:24px 0;"
      ) Select a show to ask about.

      div(
        v-else-if="!resultText"
        style="min-height:0; display:flex; align-items:center; justify-content:center; color:#bbb; font-size:20px; padding:24px 0;"
      ) Loading ...

      // Result
      div(
        v-else
        style="overflow:auto; margin:0; padding:14px; background:#fafafa; border:none; border-radius:8px; font-size:17px; line-height:1.5;"
        v-html="renderedHtml"
      )
</template>

<script>
import evtBus from '../evtBus.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// NOTE: per user request, the prompt template and API key are imported into the client bundle.
// This exposes the key to anyone with access to the built client.
import promptTemplateRaw from '../../../api/prompt-show.md?raw';
import mistralKeyRaw from '../../../api/cookies/mistral-key.txt?raw';

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const MODEL = 'mistral-large-latest';
const RESULT_CACHE_PREFIX = 'tv.ai.result.v1:';

function normalizeKey(k) {
  return String(k || '').trim();
}

function normalizePrompt(p) {
  return String(p || '').trim();
}

export default {
  name: 'Ai',

  props: {
    simpleMode: {
      type: Boolean,
      default: false,
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
    activeShow: {
      type: Object,
      default: null,
    },
  },

  data() {
    return {
      _active: false,
      busy: false,
      errMsg: '',
      resultText: '',

      previewMode: false,
      previewAddBusy: false,
      previewSrchChoice: null,
      _lastShowKey: null,
      _runToken: 0,
      _autoRunTimer: null,
    };
  },

  computed: {
    showName() {
      const s = this.activeShow;
      if (!s) return '';
      return String(s.Name || s.name || '').trim();
    },

    tvdbId() {
      const s = this.activeShow;
      if (!s) return '';
      const raw = s?.ProviderIds?.Tvdb ?? s?.TvdbId ?? s?.tvdbId ?? s?.tvdb_id ?? '';
      return String(raw || '').trim();
    },

    canRun() {
      return Boolean(this.showName);
    },

    apiKey() {
      return normalizeKey(mistralKeyRaw);
    },

    promptTemplate() {
      return normalizePrompt(promptTemplateRaw);
    },

    showKey() {
      const s = this.activeShow;
      return s?.Id || s?.Name || s?.name || null;
    },

    renderedHtml() {
      const src = String(this.resultText || '').trim();
      // AI output is untrusted; sanitize before injecting into DOM.
      const html = marked.parse(src, { breaks: true, gfm: true });
      return DOMPurify.sanitize(html);
    },
  },

  watch: {
    showKey() {
      // When the selected show changes, immediately clear old content.
      // The template will show the centered "Loading ..." placeholder.
      this.resultText = '';
      this.errMsg = '';
      // Always re-load when the selected show changes (but only if the AI tab is active).
      if (this._active) this._lastShowKey = null;
      this.scheduleAutoRun();
    },

    resultText() {
      this.persistCachedResult();
    },
  },

  mounted() {
    this._onPaneChanged = (pane) => {
      this._active = pane === 'ai';
      // Re-run on every AI tab click, even if it's the same show.
      // App emits paneChanged on each tab click.
      if (this._active) this._lastShowKey = null;
      this.scheduleAutoRun();
    };
    evtBus.on('paneChanged', this._onPaneChanged);

    evtBus.on('previewMode', this.onPreviewMode);
    evtBus.on('previewSrchChoice', this.onPreviewSrchChoice);
    evtBus.on('addPreviewShowDone', this.onAddPreviewShowDone);

    // If the component remounts (or the page reloads), restore cached content immediately.
    this.restoreCachedResult();

    // Load on mount only if the AI pane is actually visible.
    // (This component is mounted even when hidden due to v-show.)
    this.$nextTick(() => {
      try {
        const el = this.$el;
        if (!el) return;
        const cs = window.getComputedStyle(el);
        const visible = cs && cs.display !== 'none' && cs.visibility !== 'hidden';
        if (!visible) return;
        this._active = true;
        this._lastShowKey = null;
        this.scheduleAutoRun();
      } catch {
        // ignore
      }
    });
  },

  beforeUnmount() {
    if (this._onPaneChanged) evtBus.off('paneChanged', this._onPaneChanged);
    this._onPaneChanged = null;

    evtBus.off('previewMode', this.onPreviewMode);
    evtBus.off('previewSrchChoice', this.onPreviewSrchChoice);
    evtBus.off('addPreviewShowDone', this.onAddPreviewShowDone);

    if (this._autoRunTimer) clearTimeout(this._autoRunTimer);
    this._autoRunTimer = null;
  },

  methods: {

    onPreviewMode(active) {
      this.previewMode = !!active;
      if (!this.previewMode) {
        this.previewSrchChoice = null;
        this.previewAddBusy = false;
      }
    },

    onPreviewSrchChoice(srchChoice) {
      this.previewSrchChoice = srchChoice || null;
    },

    addShowFromPreview() {
      if (!this.previewSrchChoice) return;
      if (this.previewAddBusy) return;
      this.previewAddBusy = true;
      evtBus.emit('addPreviewShow', { srchChoice: this.previewSrchChoice, fromPreview: true });
    },

    onAddPreviewShowDone() {
      this.previewAddBusy = false;
    },

    exitPreview() {
      evtBus.emit('exitPreviewMode');
    },

    cacheKey() {
      const k = this.showKey;
      if (!k) return '';
      return RESULT_CACHE_PREFIX + String(k);
    },

    persistCachedResult() {
      try {
        const key = this.cacheKey();
        if (!key) return;
        const val = String(this.resultText || '');
        // Avoid storing huge blobs forever.
        const trimmed = val.length > 50000 ? val.slice(0, 50000) : val;
        window.sessionStorage.setItem(key, trimmed);
      } catch {
        // ignore
      }
    },

    restoreCachedResult() {
      try {
        const key = this.cacheKey();
        if (!key) return;
        const cached = window.sessionStorage.getItem(key);
        if (cached && !this.resultText) {
          this.resultText = cached;
        }
      } catch {
        // ignore
      }
    },

    scheduleAutoRun() {
      if (!this._active) return;
      if (!this.canRun) return;

      const key = this.showKey;
      if (!key) return;

      // Only auto-run when explicitly triggered (mount/show change/tab click)
      // AND the show differs from the last successful run.
      const shouldRun = this._lastShowKey !== key;
      if (!shouldRun) return;

      if (this._autoRunTimer) clearTimeout(this._autoRunTimer);
      this._autoRunTimer = setTimeout(() => {
        void this.runPrompt();
      }, 200);
    },

    buildPrompt() {
      const tmpl = this.promptTemplate;
      if (!tmpl) throw new Error('prompt template is empty');
      const show = this.showName;
      if (!show) throw new Error('no show selected');

      const tvdbId = this.tvdbId;
      return tmpl
        .split('<tvdb id>').join(tvdbId)
        .split('<show name>').join(show);
    },

    async runPrompt() {
      if (!this.canRun || this.busy) return;

      const apiKey = this.apiKey;
      if (!apiKey) {
        this.errMsg = 'Missing Mistral API key.';
        return;
      }

      const prompt = this.buildPrompt();
      const token = ++this._runToken;

      this.busy = true;
      this.errMsg = '';

      try {
        const res = await fetch(MISTRAL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        const contentType = String(res.headers.get('content-type') || '').toLowerCase();
        const isJson = contentType.includes('application/json');
        const payload = isJson ? await res.json() : await res.text();

        if (token !== this._runToken) return;

        if (!res.ok) {
          const msg = isJson
            ? (payload?.error?.message || payload?.message || JSON.stringify(payload))
            : String(payload || '').slice(0, 2000);
          throw new Error(`Mistral error: ${res.status} ${msg}`.trim());
        }

        const txt = payload?.choices?.[0]?.message?.content;
        this.resultText = (txt == null) ? '' : String(txt);
        this._lastShowKey = this.showKey;
      } catch (e) {
        if (token !== this._runToken) return;
        this.errMsg = e?.message ? String(e.message) : String(e);
      } finally {
        if (token === this._runToken) this.busy = false;
      }
    },
  },
};
</script>

<style scoped>
/* Lightweight markdown styling */
#aiPane :deep(h1),
#aiPane :deep(h2),
#aiPane :deep(h3) {
  margin: 10px 0 6px 0;
}

#aiPane :deep(p) {
  margin: 0 0 20px 0;
}

#aiPane :deep(ul),
#aiPane :deep(ol) {
  margin: 6px 0 6px 22px;
}

#aiPane :deep(pre) {
  background: #f2f2f2;
  padding: 10px;
  border-radius: 8px;
  overflow: auto;
  line-height: 1.4;
}

#aiPane :deep(code) {
  background: #f2f2f2;
  padding: 1px 4px;
  border-radius: 4px;
}
</style>
