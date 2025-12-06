<template lang="pug">
#hdrbottom(style="width:100%; background-color:#ccc; display:flex; justify-content:space-between; margin-top:5px; margin-bottom:5px;")
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
        | Sort

      button(@click='$emit("filter-click")' 
             :style="{width:'100px', fontSize:'15px', margin:'4px'}")
        | Filter
  button(@click="$emit('all-click')" 
          style="display:inline-block'; width:40px; font-size:15px; margin:4px 10px 4px 10px;backgroundColor:white") All
  #botrgt(style="display:flex; justify-content:space-between; margin: 5px 17px 0 0;")
    #fltrs(v-for="cond in conds" :key="cond.name"
        @click="$emit('cond-fltr-click', cond, $event)"
        :style="{width:'1.435em', textAlign:'center', display:'inline-block', color:condFltrColor(cond)}")
      font-awesome-icon(:icon="cond.icon"
                        :style="{}")
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
    }
  },

  emits: ['top-click', 'prev-next-click', 'sort-click', 'filter-click', 'all-click', 'cond-fltr-click'],

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
