<template lang="pug">
#hdrbottom(style="width:100%; background-color:#ccc; display:flex; justify-content:space-between; margin-top:5px; margin-bottom:5px; padding-right:5px; box-sizing:border-box;")
  #botlft(style="width:400px; overflow:hidden; display:flex; justify-content:space-between;")

    button(@click="$emit('top-click')" 
            style="margin-left:10px; margin-right:5px; fontSize:15px; margin:4px; background-color:white;") Top
    button(@click="$emit('prev-next-click', false)" 
            style="margin-left:10px; margin-right:5px; fontSize:15px; margin:4px; background-color:white;") Prev
    button(@click="$emit('prev-next-click', true)" 
            style="margin-left:10px; margin-right:5px; fontSize:15px; margin:4px; background-color:white;") Next
    #sortFltr(style="display:inline-block; display:flex; justify-content:space-between;")
      button(@click='$emit("sort-click")'
             :style="{width:'100px', fontSize:'15px', margin:'4px'}") 
        | {{selectedSort}}

      button(@click='$emit("filter-click")' 
             :style="{width:'100px', fontSize:'15px', margin:'4px'}")
        | {{selectedFilter}}
  button(@click="$emit('all-click')" 
          style="display:inline-block'; width:40px; font-size:15px; margin:4px 10px 4px 10px;backgroundColor:white") All
  #botrgt(:style="{ display:'flex', justifyContent:'flex-start', margin:'5px 0 0 0', width: (conds.length * 22) + 'px' }")
    #fltrs(v-for="cond in conds" :key="cond.name"
        @click="$emit('cond-fltr-click', cond, $event)"
        :style="{width:'22px', padding:'0', margin:'0', textAlign:'center', display:'inline-block', color:condFltrColor(cond)}")
      font-awesome-icon(:icon="cond.icon"
                        :style="{}")

  #sortpop(v-if="sortPopped" 
        style="width:200px; background-color:#eee; border: 1px solid black; position: fixed; display:flex; flex-direction:column; left: 144px; top: 75px;") 
    div(v-for="sortChoice in sortChoices"
        style="margin:3px 10px; padding:10px; background-color:white; text-align:center; border: 1px solid black; font-weight:bold; cursor:default;" @click="$emit('sort-action', sortChoice)") 
      | {{sortChoice}}           
  #fltrpop(v-if="fltrPopped" style="width:200px; background-color:#eee; padding:0px; border: 1px solid black; position: fixed; display:flex; flex-direction:column; left: 253px; top: 75px;") 
    div(v-for="fltrChoice in fltrChoices"
        style="margin:3px 10px; padding:10px; background-color:white; text-align:center; border: 1px solid black; font-weight:bold; cursor:default;" @click="$emit('fltr-action', fltrChoice)") 
      | {{fltrChoice}}
</template>

<script>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

export default {
  name: "HdrBot",
  components: { FontAwesomeIcon },
  
  props: {
    conds: {
      type: Array,
      required: true
    },
    sortPopped: {
      type: Boolean,
      default: false
    },
    fltrPopped: {
      type: Boolean,
      default: false
    },
    sortChoices: {
      type: Array,
      required: true
    },
    fltrChoices: {
      type: Array,
      required: true
    },
    selectedSort: {
      type: String,
      required: true
    },
    selectedFilter: {
      type: String,
      required: true
    }
  },

  emits: ['top-click', 'prev-next-click', 'sort-click', 'filter-click', 'all-click', 'cond-fltr-click', 'sort-action', 'fltr-action'],

  methods: {
    condFltrColor(cond) {
      switch (cond.filter) {
        case  0: return "gray";
        case -1: return "pink";
        case +1: return cond.color;
      }
    }
  }
};
</script>
