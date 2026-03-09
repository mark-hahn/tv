<template>
  <div
    id="hdrbottom"
    style="
      width: 100%;
      background-color: #ccc;
      display: flex;
      justify-content: space-between;
      margin-top: 5px;
      margin-bottom: 5px;
      padding-right: 5px;
      box-sizing: border-box;
    "
  >
    <div
      id="botlft"
      style="width: 400px; overflow: hidden"
    >
      <button
        @click="$emit('top-click')"
        style="
          margin-left: 10px;
          margin-right: 5px;
          fontsize: 15px;
          margin: 4px;
          background-color: white;
        "
      >
        Top
      </button>
      <button
        @click="$emit('prev-next-click', false)"
        style="
          margin-left: 10px;
          margin-right: 5px;
          fontsize: 15px;
          margin: 4px;
          background-color: white;
        "
      >
        Prev
      </button>
      <button
        @click="$emit('prev-next-click', true)"
        style="
          margin-left: 10px;
          margin-right: 5px;
          fontsize: 15px;
          margin: 4px;
          background-color: white;
        "
      >
        Next
      </button>
      <div
        id="sortFltr"
        style="display: inline-flex; gap: 4px"
      >
        <button
          @click="$emit('sort-click')"
          :style="{
            fontSize: '15px',
            margin: '4px',
            whiteSpace: 'nowrap',
            width: '100px',
          }"
        >
          {{ selectedSortNbsp }}
        </button>
        <button
          @click="$emit('filter-click')"
          :style="{
            fontSize: '15px',
            margin: '4px',
            whiteSpace: 'nowrap',
            width: '100px',
          }"
        >
          {{ selectedFilterNbsp }}
        </button>
        <button
          @click="$emit('all-click')"
          :style="{
            fontSize: '15px',
            margin: '4px',
            whiteSpace: 'nowrap',
            backgroundColor: 'white',
          }"
        >
          All
        </button>
      </div>
    </div>
    <div
      id="botrgt"
      :style="{
        display: 'flex',
        justifyContent: 'flex-start',
        margin: '5px 0 0 0',
        width: conds.length * 22 + 'px',
      }"
    >
      <div
        v-for="cond in conds"
        :key="cond.name"
        @click="$emit('cond-fltr-click', cond, $event)"
        :style="{
          width: '22px',
          padding: '0',
          margin: '0',
          textAlign: 'center',
          display: 'inline-block',
          color: condFltrColor(cond),
        }"
      >
        <font-awesome-icon
          :icon="cond.icon"
          :style="{}"
        ></font-awesome-icon>
      </div>
    </div>
    <div
      id="sortpop"
      v-if="sortPopped"
      style="
        width: 200px;
        background-color: #eee;
        border: 1px solid black;
        position: fixed;
        display: flex;
        flex-direction: column;
        left: 144px;
        top: 75px;
        z-index: 10000;
      "
    >
      <div
        v-for="sortChoice in sortChoices"
        style="
          margin: 3px 10px;
          padding: 10px;
          background-color: white;
          text-align: center;
          border: 1px solid black;
          font-weight: bold;
          cursor: default;
        "
        @click="$emit('sort-action', sortChoice)"
      >
        {{ sortChoice }}
      </div>
    </div>
    <div
      id="fltrpop"
      v-if="fltrPopped"
      style="
        width: 200px;
        background-color: #eee;
        padding: 0px;
        border: 1px solid black;
        position: fixed;
        display: flex;
        flex-direction: column;
        left: 253px;
        top: 75px;
        z-index: 10000;
      "
    >
      <div
        v-for="fltrChoice in fltrChoices"
        style="
          margin: 3px 10px;
          padding: 10px;
          background-color: white;
          text-align: center;
          border: 1px solid black;
          font-weight: bold;
          cursor: default;
        "
        @click="$emit('fltr-action', fltrChoice)"
      >
        {{ fltrChoice }}
      </div>
    </div>
  </div>
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

export default {
  name: "HdrBot",
  components: { FontAwesomeIcon },

  props: {
    conds: {
      type: Array,
      required: true,
    },
    sortPopped: {
      type: Boolean,
      default: false,
    },
    fltrPopped: {
      type: Boolean,
      default: false,
    },
    sortChoices: {
      type: Array,
      required: true,
    },
    fltrChoices: {
      type: Array,
      required: true,
    },
    selectedSort: {
      type: String,
      required: true,
    },
    selectedFilter: {
      type: String,
      required: true,
    },
  },

  computed: {
    selectedSortNbsp() {
      return String(this.selectedSort || "").replace(/ /g, "\u00A0");
    },
    selectedFilterNbsp() {
      return String(this.selectedFilter || "").replace(/ /g, "\u00A0");
    },
  },

  emits: [
    "top-click",
    "prev-next-click",
    "sort-click",
    "filter-click",
    "all-click",
    "cond-fltr-click",
    "sort-action",
    "fltr-action",
  ],

  methods: {
    condFltrColor(cond) {
      switch (cond.filter) {
        case 0:
          return "gray";
        case -1:
          return "pink";
        case +1:
          return cond.color;
      }
    },
  },
};
</script>
