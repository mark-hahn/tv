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
        <span>Jev</span>
        <button
          @click="query"
          :disabled="busy || !text.trim()"
          :style="btnStyle(busy || !text.trim())"
        >
          {{ busy ? "Asking..." : "Query" }}
        </button>
        <select
          v-model="mode"
          style="font-family: sans-serif; font-size: 14px; cursor: pointer"
        >
          <option v-for="m in modes" :key="m" :value="m">{{ m }}</option>
        </select>
        <label
          title="In Lib and All Shows keep the shows above this confidence"
          style="font-family: sans-serif; font-size: 14px; font-weight: normal"
        >
          <input
            type="number"
            min="10"
            max="99"
            step="5"
            :value="minPct"
            @change="pctChange"
            @keydown.stop="pctKey"
            style="width: 60px; font-size: 14px"
          />%
        </label>
        <label
          title="Ask Claude, on the Max plan, instead of jev"
          style="
            font-family: sans-serif;
            font-size: 14px;
            font-weight: normal;
            cursor: pointer;
          "
        >
          <input type="checkbox" v-model="llm" />
          LLM
        </label>
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
        <button @click="clear" :style="btnStyle(false)">Clear</button>
        <button @click="close" :style="btnStyle(false)">Close</button>
      </div>
    </div>
    <div style="flex: 1 1 0; min-height: 0; display: flex; gap: 5px">
      <textarea
        v-model="text"
        @keydown.stop
        @keydown.ctrl.enter.prevent="!busy && text.trim() && query()"
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
      <div
        style="
          flex: 1 1 0;
          min-width: 0;
          overflow: auto;
          padding: 6px;
          background-color: white;
          border: 1px solid #ccc;
        "
      >
        <pre style="margin: 0; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere">{{ input }}</pre>
        <hr
          v-if="input"
          style="border: none; border-top: 2px solid black; margin: 8px 0"
        />
        <pre style="margin: 0; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere">{{ result }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
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
const LLM_KEY = "jev.llm";
// A many-show query filters the list to the shows above this confidence, in
// percent; the box allows whole numbers from 10 to 99.
const MIN_PCT_DEFAULT = 25;

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
      llm: window.localStorage.getItem(LLM_KEY) === "true",
      modes: MODES,
      busy: false,
      stats: "",
      input: "",
      result: "",
    };
  },
  watch: {
    text(val) {
      window.localStorage.setItem(TEXT_KEY, val);
    },
    mode(val) {
      window.localStorage.setItem(MODE_KEY, val);
    },
    llm(val) {
      window.localStorage.setItem(LLM_KEY, String(val));
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
    async query() {
      this.busy = true;
      this.stats = "";
      this.input = "";
      this.result = "";
      const multi = MULTI_MODES.includes(this.mode);
      try {
        const start = performance.now();
        const res = await srvr.jevQuery({
          text: this.text,
          mode: this.mode,
          showName: this.show?.name,
          llm: this.llm,
        });
        const secs = (performance.now() - start) / 1000;
        const tokens = res.inputTokens;
        const tokStr =
          tokens >= 10000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
        // Claude: the answer, then the SQL it ran and the usage.
        if (res.llm) {
          this.stats = `${tokStr} Tokens | Max plan ($${res.apiCost.toFixed(4)} at API rates) | ${secs.toFixed(1)} Secs`;
          this.input = JSON.stringify(res.input, null, 2);
          const { answer, ...rest } = res.result;
          this.result = `${answer}\n\n${JSON.stringify(rest, null, 2)}`;
          return;
        }
        // This query's cost, then the total so far this month.
        const costStr = `$${res.cost.toFixed(4)}/${res.monthCost.toFixed(2)}`;
        this.stats = `${tokStr} Tokens | ${costStr} | ${secs.toFixed(1)} Secs`;
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
    // The list goes back to its filter and sort from before the last query.
    clear() {
      evtBus.emit("clearJevFilter");
    },
    close() {
      evtBus.emit("showInfoPane");
    },
  },
};
</script>
