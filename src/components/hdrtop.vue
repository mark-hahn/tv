<template lang="pug">
#hdrtop(style="width:100%; height:40px; display:flex; justify-content:space-start; background-color:#ccc;")
  div(style="display:flex; justify-content:space-between; margin-bottom:10px;")
    #nums(style="display:flex; justify-content:space-around; width:120px;")
      #count(style="display:inline-block; margin:4px 5px 4px 15px; width:75px;") 
        | {{showsLength + '/' + allShowsLength}}
      #prog(style="display:inline-block; margin:4px 10px 4px 5px; width:75px;") 
        | {{gapPercent+'%'}}

    #srch(style="border:1.5px solid black; width:132px; margin: 3px 10px 0 20px; padding-top:3px; padding-left:5px; background-color:#eee; height:31px;")
      input(:value="filterStr" 
            @input="handleFilterInput" 
            placeholder="Filter..."
            style="width:120px;")

  #webHist(style="border:1.5px solid black; margin: 2px 10px 0 10px; padding-top:3px; padding-left:5px; background-color:#eee; height:31px;")
    input(:value="webHistStr"
          @input="$emit('update:webHistStr', $event.target.value)"
          @keyup.enter="$emit('search-click', 'enter')" 
          placeholder="Search..." style="width:120px;")
    button(@click="$emit('search-click', 'hist')"
            style="display:inline-block'; font-size:15px; margin:2px 4px 0 0;backgroundColor:white") Hist
    button(@click="$emit('search-click', 'web')" 
            style="display:inline-block'; font-size:15px; margin:2px 4px 0 10px;backgroundColor:white") Web
  button(@click="$emit('watch-click')"
          style="height:29px; background-color:white; fontSize:15px; margin:6px 5px 4px 10px;") 
    | {{ watchingName }}

  #searchList(v-if="showingSrchList" style="background-color:#eee; padding:0px; border: 1px solid black; height:85%; position: fixed; display:flex; flex-direction:column; left: 253px; top: 88px; cursor:pointer; min-width:280px;") 
    div(@click="$emit('cancel-srch-list')"
         style="font-weight:bold; text-align:center; margin:10px; padding:10px; height:20px; background-color:white;")
      | Cancel
    div(style="overflow-y:scroll")
      div(v-if="showingSrchList && searchList === null")
        img(src="../../loading.gif"
            style="width:100px; height:100px; overflow-y:scroll; position:relative; top:20px; left:80px;")
      div(v-for="srchChoice in searchList"
          v-if="searchList !== null"
          @click="$emit('search-action', srchChoice)"
          style="margin:3px 10px; padding:10px; width:230px; background-color:white; text-align:center; border: 1px solid black; display:flex;")
        img(:src="srchChoice.image" 
            style="max-width:80px; max-height:120px;")
        #srchTxt(style="max-width:230px; display:flex; margin:5px; flex-direction:column;")
          #srchName(style="font-weight:bold; font-size:20px;")
            | {{srchChoice.name}}
          #srchDtl(style="font-size:18px; margin:10px 0 0 10px;")
            | {{srchChoice.searchDtlTxt}}
          #srchDel(v-if="srchChoice.deleted"
                  style="font-size:18px; margin:10px 0 0 10px; color:red")
            | Deleted
</template>

<script>
export default {
  name: "HdrTop",
  
  props: {
    showsLength: {
      type: Number,
      required: true
    },
    allShowsLength: {
      type: Number,
      required: true
    },
    gapPercent: {
      type: Number,
      default: 0
    },
    filterStr: {
      type: String,
      default: ''
    },
    webHistStr: {
      type: String,
      default: ''
    },
    watchingName: {
      type: String,
      default: '---'
    },
    showingSrchList: {
      type: Boolean,
      default: false
    },
    searchList: {
      type: Array,
      default: null
    }
  },

  emits: ['update:filterStr', 'update:webHistStr', 'search-click', 'watch-click', 'filter-input', 'cancel-srch-list', 'search-action'],

  methods: {
    handleFilterInput(event) {
      this.$emit('update:filterStr', event.target.value);
      this.$emit('filter-input');
    }
  }
};
</script>
