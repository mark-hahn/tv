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
      style="width: 550px; overflow: hidden"
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
      <button
        @click="$emit('rev-click')"
        :style="{
          marginLeft: '10px',
          marginRight: '5px',
          fontSize: '15px',
          margin: '4px',
          backgroundColor: reversed ? 'lightblue' : 'white',
        }"
      >
        Rev
      </button>
      <div
        id="sortFltr"
        style="display: inline-flex; gap: 4px; align-items: center"
      >
        <select
          :value="selectedSort"
          @change="$emit('sort-action', $event.target.value)"
          :style="{
            fontSize: '15px',
            margin: '4px',
            padding: '2px 4px',
            cursor: 'pointer',
            backgroundColor: 'white',
          }"
        >
          <option
            v-for="sortChoice in sortChoices"
            :key="sortChoice"
            :value="sortChoice"
          >
            {{ displaySortChoice(sortChoice) }}
          </option>
        </select>
        <select
          :value="selectedFilter"
          @change="$emit('fltr-action', $event.target.value)"
          :style="{
            fontSize: '15px',
            margin: '4px',
            padding: '2px 4px',
            cursor: 'pointer',
            backgroundColor: 'white',
          }"
        >
          <option
            v-for="fltrChoice in fltrChoices"
            :key="fltrChoice"
            :value="fltrChoice"
          >
            {{ fltrChoice }}
          </option>
        </select>
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
        width: visibleConds.length * 22 + 'px',
      }"
    >
      <div
        v-for="cond in visibleConds"
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
    reversed: {
      type: Boolean,
      default: false,
    },
  },

  computed: {
    visibleConds() {
      return this.conds.filter((c) => !c.hideIcon);
    },
  },

  emits: [
    "top-click",
    "prev-next-click",
    "all-click",
    "cond-fltr-click",
    "sort-action",
    "fltr-action",
    "rev-click",
  ],

  methods: {
    displaySortChoice(sortChoice) {
      return sortChoice === "Viewed" ? "Watched" : String(sortChoice || "");
    },
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
