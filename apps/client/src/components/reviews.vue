<template lang="pug">
#reviews(@click.stop :style="{ height:'100%', width:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }")
  
  //- Header Section
  #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', display:'flex', flexDirection:'column', gap:'8px', borderBottom:'1px solid #ddd' }")
    
    //- Top Row: Show Title and Rotten Button
    div(style="width:100%; display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;")
      div(:style="{ fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginLeft:'10px', marginRight:'10px', flex:'1 1 auto', minWidth:0, whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word' }") {{ showName }}
      
      div(v-if="rottenUrl" style="margin-right:10px; flex:'0 0 auto';")
        a(:href="rottenUrl" target="_blank" style="text-decoration:none;")
          button(style="cursor:pointer; padding:6px 12px; border-radius:7px; background-color:#FA320A; color:white; font-weight:normal; border:1px solid black; font-size:14px;") {{ rottenLabel || 'Rotten' }}

      div(v-else-if="checkedRemotes" style="margin-right:10px; flex:'0 0 auto'; font-size:14px; color:#666;")
        | Show not found at Rotten Tomatoes.

    //- Second Row: Filter Radio Buttons
    div(style="width:100%; display:flex; align-items:center; gap:8px; margin-left:10px; flex-wrap:wrap;")
      button(
        v-for="btn in filterButtons" 
        :key="btn.label"
        @click="handleButtonClick(btn.label)"
        :style="getButtonStyle(selectedButton === btn.label)"
      ) {{ btn.label }}

      div(v-if="isLoading" style="font-size:14px; color:#aaa !important; margin-left:8px; font-weight: bold;") &lt;Loading&gt;

      div(v-if="stats && !simpleMode" style="font-size:14px; color:#555; margin-left:auto; margin-right:10px; white-space:nowrap;") {{ reviews.length }}/{{ stats.numChecked }} Eng: {{ stats.notEnglishCount }}, Review: {{ stats.noReviewCount }}, Text: {{ stats.smallTextCount }}

  //- Body: Two Scrolling Panes
  #body(style="flex:1 1 auto; min-height:0; display:flex; gap:10px; margin-top:10px;")
    
    div(v-if="!isLoading && stats && reviews.length === 0" style="width:100%; text-align:center; color:#666; margin-top:50px; font-size:16px;") No reviews found.

    template(v-else)
      //- Left Column: Descending Sort (High Scores)
      div(style="flex:1; display:flex; flexDirection:column; gap:10px; overflow-y:auto; overflow-x:hidden; height:100%;")
        div(v-for="(review, idx) in leftColumnReviews" :key="idx" :style="cardStyle" @click="openReviewsPage")
          //- Card Header
          div(style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:5px;")
            div(style="font-weight:bold; font-size:14px;")
              span {{ review.author }}
              span(v-if="review.publication" style="color:#666; font-weight:normal;") &nbsp;({{ review.publication }})
            
            div(style="font-size:14px; white-space:nowrap;")
              template(v-if="review.numStars !== -1")
                i(v-for="(starClass, idx) in getStarClasses(review.numStars)" :key="idx" :class="starClass" style="color:#FFA500; margin-left:2px; font-size:12px;")

          div(style="border-bottom:1px solid #ddd; width:100%; margin-bottom:5px;")
          
          //- Card Text
          div(:style="{fontSize:'15px', lineHeight:'1.4', cursor: 'pointer'}")
            span {{ review.text }}

          //- Full Review Link
          div(v-if="review.url" style="margin-top:8px;" @click.stop)
            a(:href="review.url" target="_blank")
              button(style="cursor:pointer; padding:4px 8px; border-radius:4px; border:1px solid #bbb; background-color:whitesmoke; font-size:12px;") Full Review

      //- Right Column: Ascending Sort (Low Scores)
      div(style="flex:1; display:flex; flexDirection:column; gap:10px; overflow-y:auto; overflow-x:hidden; height:100%;")
        div(v-for="(review, idx) in rightColumnReviews" :key="idx" :style="cardStyle" @click="openReviewsPage")
          //- Card Header
          div(style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:5px;")
            div(style="font-weight:bold; font-size:14px;")
              span {{ review.author }}
              span(v-if="review.publication" style="color:#666; font-weight:normal;") &nbsp;({{ review.publication }})
            
            div(style="font-size:14px; white-space:nowrap;")
              template(v-if="review.numStars !== -1")
                i(v-for="(starClass, idx) in getStarClasses(review.numStars)" :key="idx" :class="starClass" style="color:#FFA500; margin-left:2px; font-size:12px;")

          div(style="border-bottom:1px solid #ddd; width:100%; margin-bottom:5px;")
          
          //- Card Text
          div(:style="{fontSize:'15px', lineHeight:'1.4', cursor: 'pointer'}")
            span {{ review.text }}

          //- Full Review Link
          div(v-if="review.url" style="margin-top:8px;" @click.stop)
            a(:href="review.url" target="_blank")
              button(style="cursor:pointer; padding:4px 8px; border-radius:4px; border:1px solid #bbb; background-color:whitesmoke; font-size:12px;") Full Review

</template>

<script>
import evtBus from '../evtBus.js';
import * as srvr from '../srvr.js';

export default {
  name: "Reviews",
  
  props: {
    simpleMode: {
      type: Boolean,
      default: false
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      reviews: [],
      stats: null,
      showName: '',
      rottenUrl: '',
      rottenLabel: '',
      selectedButton: 'Critics',
      isLoading: false,
      checkedRemotes: false,
      filterButtons: [
        { label: 'Critics' },
        { label: 'Audience' }
      ]
    };
  },

  computed: {
    leftColumnReviews() {
      // Split list in 2 equal halves.
      // Put higher scores in left column and sort descending.
      if (!this.reviews.length) return [];

      const getVal = (r) => (r.numStars === -1 ? 2.5 : r.numStars);
      
      const all = [...this.reviews];
      // Sort all by score descending first to identify "higher scores"
      all.sort((a, b) => getVal(b) - getVal(a));
      
      const mid = Math.ceil(all.length / 2);
      const left = all.slice(0, mid);
      
      // Sort Descending
      left.sort((a, b) => getVal(b) - getVal(a));
      return left;
    },
    rightColumnReviews() {
      // Put lower scores in right column and sort ascending.
      if (!this.reviews.length) return [];

      const getVal = (r) => (r.numStars === -1 ? 2.5 : r.numStars);
      
      const all = [...this.reviews];
      all.sort((a, b) => getVal(b) - getVal(a));
      
      const mid = Math.ceil(all.length / 2);
      const right = all.slice(mid);
      
      // Sort Ascending
      right.sort((a, b) => getVal(a) - getVal(b));
      return right;
    },
    cardStyle() {
      return {
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '5px',
        padding: '10px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'pointer'
      };
    }
  },

  mounted() {
    // Listen for show changes
    evtBus.on('setUpSeries', (show) => {
      this.showName = show?.Name || '';
      this.reviews = [];
      this.stats = null;
      this.rottenUrl = '';
      this.rottenLabel = '';
      this.selectedButton = 'Critics';
      this.checkedRemotes = false;
    });

    // Listen for TVDB details to get existing Remotes (including Rotten button URL)
    evtBus.on('tvdbDataReady', (data) => {
      this.checkedRemotes = true;
      const tvdbData = data?.tvdbData;
      if (tvdbData && tvdbData.remotes) {
        const rottenRemote = tvdbData.remotes.find(r => r.name && r.name.toLowerCase().includes('rotten'));
        if (rottenRemote) {
          this.rottenLabel = rottenRemote.name; // Use the name from remote object which contains ratings
          this.rottenUrl = rottenRemote.url; // Assuming remote object has { name, url }
          // Load initial reviews if we have a URL
          if (this.rottenUrl) {
            this.loadReviews(this.rottenUrl, this.selectedButton);
          }
        }
      }
    });
    
    // Also listen for explicit "showReviews" if added later, but logic above should suffice for now.
  },

  methods: {
    getButtonStyle(isSelected) {
      return {
        fontSize: '13px',
        cursor: 'pointer',
        borderRadius: '5px',
        padding: '4px 12px',
        border: '1px solid #bbb',
        '--btn-bg': isSelected ? 'lightgray' : 'whitesmoke',
        color: 'black'
      };
    },

    handleButtonClick(label) {
      this.selectedButton = label;
      if (this.rottenUrl) {
        this.loadReviews(this.rottenUrl, this.selectedButton);
      }
    },

    async loadReviews(url, buttonName) {
      this.reviews = [];
      this.stats = null;
      this.isLoading = true;
      try {
        const data = await srvr.getReviews(url, buttonName);
        if (data) {
          if (data.reviews && Array.isArray(data.reviews)) {
            this.reviews = data.reviews;
          } else {
            this.reviews = [];
          }

          this.stats = {
            numChecked: data.numChecked,
            notEnglishCount: data.notEnglishCount,
            noReviewCount: data.noReviewCount,
            smallTextCount: data.smallTextCount
          };
        }
      } catch (err) {
        console.error("Failed to load reviews:", err);
      } finally {
        this.isLoading = false;
      }
    },
    
    getStarClasses(numStars) {
      // 0 to 5 stars
      const stars = [];
      const val = Number(numStars) || 0;
      
      for (let i = 1; i <= 5; i++) {
        if (val >= i) {
          stars.push('fa-solid fa-star');
        } else if (val >= i - 0.5) {
           stars.push('fa-solid fa-star-half-stroke');
        } else {
           stars.push('fa-regular fa-star');
        }
      }
      return stars;
    },
    
    openReviewsPage() {
      if (!this.rottenUrl) return;
      const base = this.rottenUrl.replace(/\/$/, '');
      const suffix = (this.selectedButton === 'Audience') ? 'all-audience' : 'all-critics';
      // Hardcode s01 for now as per server scraper logic
      const url = `${base}/s01/reviews/${suffix}`;
      window.open(url, '_blank');
    },
  },
};
</script>
