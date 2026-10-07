<template>
  <div
    id="jev"
    style="
      height: 100%;
      width: 100%;
      padding: 5px;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
      overflow: hidden;
      box-sizing: border-box;
      background-color: #fafafa;
    "
  >
    <div
      class="pane-header-title"
      style="
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 10px;
      "
    >
      <div
        style="
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 10px;
          white-space: nowrap;
        "
      >
        <span>AI</span>
        <button
          @click="query(false)"
          :disabled="busy || !text.trim()"
          :style="btnStyle(busy || !text.trim())"
        >
          {{ busy ? "Asking..." : "Query" }}
        </button>
        <button
          @click="query(true)"
          :disabled="!canResume"
          :style="btnStyle(!canResume)"
          title="Ask Claude again in the same conversation, so it remembers the earlier questions and answers"
        >
          Resume
        </button>
        <select
          v-model="mode"
          style="font-family: sans-serif; font-size: 14px; cursor: pointer"
        >
          <option v-for="m in modes" :key="m" :value="m">{{ m }}</option>
        </select>
        <label
          title="In Lib and All Shows keep the shows above this confidence"
          :style="{
            fontFamily: 'sans-serif',
            fontSize: '14px',
            fontWeight: 'normal',
            opacity: llm ? 0.4 : 1,
          }"
        >
          <input
            type="number"
            min="10"
            max="99"
            step="5"
            :value="minPct"
            :disabled="llm"
            @change="pctChange"
            @keydown.stop="pctKey"
            style="width: 40px; font-size: 14px"
          />%
        </label>
        <select
          v-model="engine"
          title="Jev scores shows; Claude answers on the Max plan; Auto is Claude using Jev"
          style="font-family: sans-serif; font-size: 14px; cursor: pointer"
        >
          <option v-for="e in engines" :key="e" :value="e">{{ e }}</option>
        </select>
      </div>
      <span
        style="
          flex: 1;
          min-width: 0;
          text-align: center;
          font-family: sans-serif;
          font-size: 14px;
          font-weight: normal;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        "
        >{{ stats }}</span
      >
      <div
        style="
          flex: 0 0 auto;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        "
      >
        <button @click="close" :style="btnStyle(false)">Close</button>
      </div>
    </div>
    <div style="flex: 1 1 0; min-height: 0; display: flex; gap: 5px">
      <textarea
        v-model="text"
        @keydown.stop
        @keydown.ctrl.enter.prevent="!busy && text.trim() && query(false)"
        spellcheck="false"
        style="
          flex: 1 1 0;
          min-width: 0;
          resize: none;
          font-family: monospace;
          font-size: 14px;
          padding: 6px;
          box-sizing: border-box;
        "
      ></textarea>
      <!-- Ctrl-click switches a finished Claude answer between its text as
           markdown and the whole raw result. -->
      <div
        ref="results"
        @click.ctrl="answer && (showRaw = !showRaw)"
        style="
          flex: 2 1 0;
          min-width: 0;
          overflow: auto;
          padding: 6px;
          background-color: white;
          border: 1px solid #ccc;
        "
      >
        <div v-if="answer && !showRaw" class="jev-md" v-html="answerHtml"></div>
        <template v-else>
          <pre style="margin: 0; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere">{{ input }}</pre>
          <hr
            v-if="input"
            style="border: none; border-top: 2px solid black; margin: 8px 0"
          />
          <pre style="margin: 0; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere">{{ result }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { marked } from "marked";
import DOMPurify from "dompurify";
import * as srvr from "../srvr.js";
import evtBus from "../evtBus.js";

const TEXT_KEY = "jev.text";
const MODE_KEY = "jev.mode";
// What the query is asked about: nothing, the selected show, every library
// show, every show.
const MODES = ["Plain", "Show", "In Lib", "All Shows"];
// The modes that ask about many shows and filter the list by the answers.
const MULTI_MODES = ["In Lib", "All Shows"];
const MIN_PCT_KEY = "jev.minPct";
// $<this query's Jev cost>/<Jev's month so far>/<Claude's cost at API rates>,
// each "0" when that one wasn't used.
const costStr = (jev, jevMonth, claude) =>
  `$${jev ? jev.toFixed(4) : "0"}/${jevMonth.toFixed(2)}/${claude ? claude.toFixed(2) : "0"}`;

const ENGINE_KEY = "jev.engine";
// Who answers: Claude with Jev as one of its tools, Jev alone, Claude alone.
const ENGINES = ["Auto", "Jev", "Claude"];
// A many-show query filters the list to the shows above this confidence, in
// percent; the box allows whole numbers from 10 to 99.
const MIN_PCT_DEFAULT = 25;
// Sticky scrolling counts the results as scrolled to the end within this.
const STICKY_PX = 20;

export default {
  name: "Jev",
  props: {
    show: { type: Object, default: null },
  },
  data() {
    return {
      text: window.localStorage.getItem(TEXT_KEY) ?? "",
      mode: window.localStorage.getItem(MODE_KEY) ?? "Plain",
      minPct: Number(
        window.localStorage.getItem(MIN_PCT_KEY) ?? MIN_PCT_DEFAULT,
      ),
      engine: window.localStorage.getItem(ENGINE_KEY) ?? "Auto",
      engines: ENGINES,
      modes: MODES,
      busy: false,
      stats: "",
      input: "",
      result: "",
      // A finished Claude answer's text, shown as markdown unless showRaw.
      answer: "",
      showRaw: false,
      // The last Claude conversation, which Resume continues.
      sessionId: null,
    };
  },
  computed: {
    // Claude answers, alone or with Jev as a tool; the % box is Jev's alone.
    llm() {
      return this.engine !== "Jev";
    },
    canResume() {
      return !this.busy && !!this.prompt && this.llm && !!this.sessionId;
    },
    // What Resume asks: the editor's last block of text after a blank line,
    // so earlier prompts can stay above it to read and reuse. A fresh query
    // asks the whole editor.
    prompt() {
      return (
        this.text
          .split(/\n\s*\n/)
          .map((t) => t.trim())
          .filter(Boolean)
          .pop() ?? ""
      );
    },
    // Claude's text can quote show overviews, so the HTML is sanitized.
    answerHtml() {
      return DOMPurify.sanitize(marked.parse(this.answer));
    },
  },
  watch: {
    text(val) {
      window.localStorage.setItem(TEXT_KEY, val);
    },
    mode(val) {
      window.localStorage.setItem(MODE_KEY, val);
    },
    engine(val) {
      window.localStorage.setItem(ENGINE_KEY, val);
    },
    // Sticky scrolling: while the end of the results is in view it stays in
    // view as Claude's text arrives; scrolled up, they stay put. This runs
    // before the DOM update, so it measures where the reader was.
    result() {
      const el = this.$refs.results;
      if (!el) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_PX)
        this.$nextTick(() => {
          el.scrollTop = el.scrollHeight;
        });
    },
    // The finished answer is read from its start.
    answer(val) {
      if (val)
        this.$nextTick(() => {
          this.$refs.results.scrollTop = 0;
        });
    },
  },
  methods: {
    // Del in the box puts the default back.
    pctKey(e) {
      if (e.key !== "Delete") return;
      e.preventDefault();
      this.setPct(e.target, MIN_PCT_DEFAULT);
    },
    // A typed value is held to a whole number from 10 to 99; an empty box
    // goes back to the default.
    pctChange(e) {
      const v = e.target.value;
      const pct =
        v === ""
          ? MIN_PCT_DEFAULT
          : Math.min(99, Math.max(10, Math.round(Number(v))));
      this.setPct(e.target, pct);
    },
    // The box is set directly too: the value may not have changed, so a
    // re-render would leave what was typed showing.
    setPct(el, pct) {
      this.minPct = pct;
      el.value = pct;
      window.localStorage.setItem(MIN_PCT_KEY, String(pct));
    },
    btnStyle(disabled) {
      return {
        padding: "2px 10px",
        fontFamily: "sans-serif",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        border: "1px solid #999",
        borderRadius: "4px",
        backgroundColor: "whitesmoke",
      };
    },
    // resume continues the last Claude conversation; otherwise Claude starts
    // a new one, which Resume then continues.
    async query(resume) {
      this.busy = true;
      this.stats = "";
      this.input = "";
      this.result = "";
      this.answer = "";
      this.showRaw = false;
      const multi = MULTI_MODES.includes(this.mode);
      const params = {
        text: resume ? this.prompt : this.text.trim(),
        mode: this.mode,
        showName: this.show?.name,
        llm: this.llm,
        auto: this.engine === "Auto",
        ...(resume && { resume: this.sessionId }),
      };
      try {
        const start = performance.now();
        // Claude streams: the raw view fills in as the request, its text and
        // its tool calls arrive.
        const res = this.llm
          ? await srvr.jevQueryStream(params, (ev) => {
              if (ev.input) this.input = JSON.stringify(ev.input, null, 2);
              else if (ev.text) this.result += ev.text;
              else if (ev.tool)
                this.result += `\n[${ev.tool}] ${ev.args?.query ?? JSON.stringify(ev.args)}\n`;
            })
          : await srvr.jevQuery(params);
        const secs = (performance.now() - start) / 1000;
        const tokens = res.inputTokens;
        const tokStr =
          tokens >= 10000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
        // Claude: the answer as markdown; ctrl-click shows the raw result,
        // the answer then the SQL it ran and the usage.
        if (res.llm) {
          this.stats = `${tokStr} Tokens | ${costStr(res.jevCost, res.monthCost, res.apiCost)} | ${secs.toFixed(1)} Secs`;
          this.input = JSON.stringify(res.input, null, 2);
          const { answer, ...rest } = res.result;
          this.result = `${answer}\n\n${JSON.stringify(rest, null, 2)}`;
          this.answer = answer;
          this.sessionId = res.sessionId;
          // Claude picked shows with its select tool: filter the list to them.
          // They carry no confidence, so the AI sort keeps the list's order.
          if (res.result.selected)
            evtBus.emit(
              "filterByJev",
              res.result.selected.map((name) => ({ name, noul: null })),
            );
          return;
        }
        this.stats = `${tokStr} Tokens | ${costStr(res.cost, res.monthCost, 0)} | ${secs.toFixed(1)} Secs`;
        // A many-show query sends one request per show; only the first shows.
        this.input =
          JSON.stringify(res.input, null, 2) + (multi ? "\n... <snip> ..." : "");
        if (!multi) {
          const noul = res.result.answers.answer.noul;
          this.stats += ` | Confidence: ${noul.toFixed(2)}`;
          this.result = JSON.stringify(res.result, null, 2);
          return;
        }
        const matched = res.result.shows.filter(
          (s) => s.noul > this.minPct / 100,
        );
        this.result = JSON.stringify(
          { ...res.result, shows: matched },
          null,
          2,
        );
        evtBus.emit("filterByJev", matched);
      } catch (e) {
        // A server error arrives as {error}, a network one as an Error.
        this.result = `Error: ${e.error ?? e.message}`;
      } finally {
        this.busy = false;
      }
    },
    close() {
      evtBus.emit("showInfoPane");
    },
  },
};
</script>

<style>
/* Claude's answer as markdown, after claude2's .response.markdown. */
.jev-md {
  font: 14px/1.5 Aptos, "Segoe UI", sans-serif;
}
.jev-md > :first-child {
  margin-top: 0;
}
.jev-md h1,
.jev-md h2 {
  font-size: 16px;
  font-weight: 700;
  margin: 14px 0 6px;
  padding-bottom: 3px;
  border-bottom: 1px solid #ddd;
}
.jev-md h3,
.jev-md h4,
.jev-md h5,
.jev-md h6 {
  font-size: 14px;
  font-weight: 700;
  margin: 12px 0 5px;
}
.jev-md p {
  margin: 0 0 8px;
}
.jev-md ul,
.jev-md ol {
  margin: 0 0 8px;
  padding-left: 24px;
}
.jev-md li {
  margin: 2px 0;
}
.jev-md blockquote {
  margin: 0 0 8px;
  border-left: 3px solid #ddd;
  padding: 2px 10px;
}
.jev-md code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
  padding: 1px 4px;
}
.jev-md pre {
  background: #f2f1ec;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 8px 10px;
  overflow: auto;
}
.jev-md pre code {
  background: none;
  padding: 0;
}
.jev-md table {
  border-collapse: collapse;
  margin: 0 0 10px;
}
.jev-md th,
.jev-md td {
  border: 1px solid #ddd;
  padding: 4px 8px;
  text-align: left;
}
.jev-md th {
  background: rgba(0, 0, 0, 0.05);
}
</style>
