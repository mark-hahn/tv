<template lang="pug">
#shows(style="width:100%; flex-grow: 1; overflow-y:scroll;")
  table(style="width:100%; font-size:18px")
   tbody
    tr(v-for="show in shows" :key="show.Id" 
          style="outline:thin solid; cursor:default" 
         :id="nameHash(show.Name)")

      td(style="width:30px; text-align:center;"
        @click="$emit('copy-name', show, $event)")
        font-awesome-icon(id="cpbrd" icon="copy" 
                          style="color:#ccc")

      td(style="width:30px; text-align:center;" )
        div(v-show="!show.Id.startsWith('noemby-')" 
              @click="$emit('open-map', show)")
          font-awesome-icon(icon="border-all" style="color:#ccc")

      td(@click="$emit('select-show', show, false)"
         :style="{width:'80px', fontSize:'16px', backgroundColor: hilite(show), cursor:'default', textAlign:'center'}") 
        | {{ getSortDisplayValue(show) }}
        
      td(:style="{display:'flex', padding:'5px', justifyContent:'space-between', backgroundColor: hilite(show)}")

        div(style="padding:2px; fontSize:16px; font-weight:bold;" @click="$emit('select-show', show, false, true)") {{show.Name}} 

        div(style="padding:2px; flex-grow:1; fontSize:16px; font-weight:bold;" @click="$emit('select-show', show, false, true)" ) 

        div(v-if="show.WaitStr?.length" @click="$emit('wait-str-click', show)" style="padding:2px; color: #00f; fontSize:16px;") 
        | {{show.WaitStr}} 

      td(v-for="cond in conds" :key="cond.name" style="width:22px; text-align:center;" @click="cond.click(show)")
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
    }
  },

  methods: {
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
