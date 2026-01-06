<template lang="pug">
.subs-container(:style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #subs(
    ref="scroller"
    :style="{ height:'100%', width:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }"
    @wheel.stop.prevent="handleScaledWheel"
  )

    #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'10px', marginLeft:'0px', marginRight:'0px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
      div(style="display:flex; justify-content:space-between; align-items:center;")
        div(style="margin-left:20px;") {{ headerShowName }}
        div(style="display:flex; gap:8px; margin-left:auto;")
          //- Search button exists but intentionally not wired for now.
          button(style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Search

      div(style="height:1px; width:100%; background-color:#ddd; margin-top:6px;")

    #loading(v-if="loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Loading...

    #error(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
      div Error: {{ error }}

    #subs-list(v-if="!loading" style="padding:10px; font-size:14px; line-height:1.2;")
      div(v-if="items.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div Click on Search.
      div(v-for="(item, index) in items" :key="getItemCardKey(item, index)" @click="handleItemClick($event, item)" @click.stop :style="getCardStyle(item)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
        div(v-if="isClicked(item)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
        div(style="font-size:13px; font-weight:bold; color:#888; margin-bottom:4px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;") {{ item?.title || '' }}
        div(style="font-size:12px; color:#333;")
          strong {{ item?.line1 || '' }}
          span(v-if="item?.line2") | {{ item.line2 }}
</template>

<script>
export default {
  name: 'Subs',

  props: {
    simpleMode: {
      type: Boolean,
      default: false
    },
    activeShow: {
      type: Object,
      default: null
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      items: [],
      showName: '',
      loading: false,
      error: null,
      selectedItem: null,
      clickedItems: new Set()
    };
  },

  computed: {
    headerShowName() {
      return (
        this.showName ||
        this.activeShow?.Name ||
        ''
      );
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

    getItemCardKey(item, index) {
      return String(item?.key || item?.id || item?.title || index);
    },

    handleItemClick(_event, item) {
      this.selectedItem = item;
      this.clickedItems.add(item);
    },

    isClicked(item) {
      return this.clickedItems.has(item);
    },

    getCardStyle(item) {
      const isSelected = this.selectedItem === item;
      let bgColor = '#fff';
      if (isSelected) {
        bgColor = '#fffacd';
      }
      return {
        padding: '8px',
        background: bgColor,
        borderRadius: '5px',
        border: '1px solid #ddd',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative'
      };
    }
  }
};
</script>
