<template lang="pug">
#shows(
  style="width:100%; flex-grow: 1; overflow-y:scroll; padding-right:5px; box-sizing:border-box;"
  @wheel.stop.prevent="handleScaledWheel"
)
  div(v-if="shows.length === 0" style="display:flex; justify-content:center; align-items:center; height:100%; font-size:18px; color:#666;") No shows.
  table(v-else style="width:100%; font-size:18px; border-collapse:collapse; border-spacing:0;")
    tbody
      tr(
        v-for="show in shows"
        :key="show.Id"
        :style="{ borderBottom:'1px solid #000', cursor:'default', lineHeight: simpleMode ? '1.6' : '1' }"
        :id="nameHash(show.Name)"
      )
        td(
          v-if="!simpleMode"
          style="width:30px; text-align:center;"
          @click="$emit('copy-name', show, $event)"
        )
          font-awesome-icon(id="cpbrd" icon="copy" style="color:#ccc")

        td(v-if="!simpleMode" style="width:30px; text-align:center;" )
          div(v-show="!show.Id.startsWith('noemby-')" @click="$emit('open-map', show)")
            font-awesome-icon(icon="border-all" style="color:#ccc")

        td(
          @click="$emit('select-show', show, false)"
          :style="{maxWidth:'110px', fontSize:'16px', backgroundColor: hilite(show), cursor:'default', textAlign:'center', paddingLeft: simpleMode ? '20px' : '0'}"
        )
          | {{ getSortDisplayValue(show) }}

        td(id="showLineText" :style="{display:'flex', padding:'5px', justifyContent:'space-between', backgroundColor: hilite(show)}")
          div(style="padding:2px; fontSize:16px; font-weight:bold;" @click="$emit('select-show', show, false, true)") {{show.Name}}
          div(style="padding:2px; flex-grow:1; fontSize:16px; font-weight:bold;" @click="$emit('select-show', show, false, true)" )
          div(
            v-if="show.Notes && String(show.Notes).length"
            :style="{ padding:'2px', fontSize:'14px', color:'rgba(0,0,0,0.5)', marginRight:'15px' }"
          ) {{ String(show.Notes) }}
          div(v-if="show.WaitStr?.length" style="padding:2px; color: #00f; fontSize:16px;")
            | {{show.WaitStr}}

        td(v-if="showConds" v-for="cond in conds" :key="cond.name" style="width:22px; padding:0; text-align:center;" @click="cond.click(show)")
          font-awesome-icon(:icon="cond.icon" :style="{color:condColor(show, cond)}")
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

export default {
  name: "Shows",
  components: { FontAwesomeIcon },
  
  props: {
    shows: {
      type: Array,
      required: true
    },
    conds: {
      type: Array,
      required: true
    },
    highlightName: {
      type: String,
      default: ''
    },
    getSortDisplayValue: {
      type: Function,
      required: true
    },
    allShowsLength: {
      type: Number,
      default: 0
    },
    showConds: {
      type: Boolean,
      default: true
    },
    simpleMode: {
      type: Boolean,
      default: false
    }
  },

  methods: {
    handleScaledWheel(event) {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = (event.deltaY || 0);
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    },

    hilite(show) {
      return (this.highlightName == show.Name) ? "yellow" : "white";
    },

    nameHash(name) {
      if(!name) {
        return null;
      }
      return (
        "name-" +
        name
          .toLowerCase()
          .replace(/^the\s/, "")
          .replace(/[^a-zA-Z0-9]*/g, "")
      );
    },

    condColor(show, cond) {
      if (cond.cond(show)) return cond.color;
      return "#ddd";
    }
  }
};
</script>

<style>
  #shows {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  #shows::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
</style>
