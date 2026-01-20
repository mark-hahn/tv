<template lang="pug">
#reviews(@click.stop :style="{ height:'100%', width:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }")
  
  //- Header Section
  #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', display:'flex', flexDirection:'column', gap:'8px', borderBottom:'1px solid #ddd' }")
    
    //- Top Row: Show Title and Rotten Button
    div(style="width:100%; display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;")
      div(:style="{ fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginLeft:'10px', marginRight:'10px', flex:'1 1 auto', minWidth:0, whiteSpace:'normal', overflowWrap:'anywhere', wordBreak:'break-word' }") {{ showName }}
      
      div(v-if="rottenUrl" style="margin-right:10px; flex:'0 0 auto';")
        a(:href="rottenUrl" target="_blank" style="text-decoration:none;")
          button(style="cursor:pointer; padding:6px 12px; border-radius:7px; background-color:#FA320A; color:white; font-weight:bold; border:1px solid black; font-size:14px;") {{ rottenLabel || 'Rotten' }}

    //- Second Row: Filter Radio Buttons
    div(style="width:100%; display:flex; align-items:center; gap:8px; margin-left:10px; flex-wrap:wrap;")
      button(
        v-for="btn in filterButtons" 
        :key="btn.label"
        @click="handleButtonClick(btn.label)"
        :style="getButtonStyle(selectedButton === btn.label)"
      ) {{ btn.label }}

  //- Body: Two Scrolling Panes
  #body(style="flex:1 1 auto; min-height:0; display:flex; gap:10px; margin-top:10px;")
    
    //- Left Column: Ascending Sort
    div(style="flex:1; display:flex; flexDirection:column; gap:10px; overflow-y:auto; overflow-x:hidden; height:100%;")
      div(v-for="review in sortedAscReviews" :key="review.reviewId" :style="cardStyle")
        //- Card Header
        div(style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:5px;")
          div(style="font-weight:bold; font-size:14px;")
            span {{ review.author }}
            span(v-if="review.publication" style="color:#666; font-weight:normal;") &nbsp;({{ review.publication }})
          
          div(style="font-size:14px; white-space:nowrap;")
             template(v-if="review.ratings") {{ review.ratings }}
             template(v-else)
               i(v-for="(starClass, idx) in getStarClasses(review.numStars)" :key="idx" :class="starClass" style="color:#FFA500; margin-left:2px; font-size:12px;")

        div(style="border-bottom:1px solid #ddd; width:100%; margin-bottom:5px;")
        
        //- Card Text
        div(@click="handleReviewClick(review)" :style="{fontSize:'13px', lineHeight:'1.4', cursor: review.more ? 'pointer' : 'default'}")
          span {{ review.text }}
          span(v-if="review.more" style="color:#0066cc;") ...

    //- Right Column: Descending Sort
    div(style="flex:1; display:flex; flexDirection:column; gap:10px; overflow-y:auto; overflow-x:hidden; height:100%;")
      div(v-for="review in sortedDescReviews" :key="review.reviewId" :style="cardStyle")
        //- Card Header
        div(style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:5px;")
          div(style="font-weight:bold; font-size:14px;")
            span {{ review.author }}
            span(v-if="review.publication" style="color:#666; font-weight:normal;") &nbsp;({{ review.publication }})
          
          div(style="font-size:14px; white-space:nowrap;")
             template(v-if="review.ratings") {{ review.ratings }}
             template(v-else)
               i(v-for="(starClass, idx) in getStarClasses(review.numStars)" :key="idx" :class="starClass" style="color:#FFA500; margin-left:2px; font-size:12px;")

        div(style="border-bottom:1px solid #ddd; width:100%; margin-bottom:5px;")
        
        //- Card Text
        div(@click="handleReviewClick(review)" :style="{fontSize:'13px', lineHeight:'1.4', cursor: review.more ? 'pointer' : 'default'}")
          span {{ review.text }}
          span(v-if="review.more" style="color:#0066cc;") ...

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
      showName: '',
      rottenUrl: '',
      rottenLabel: '',
      selectedButton: 'All Critics',
      filterButtons: [
        { label: 'All Critics' },
        { label: 'Top critics' },
        { label: 'All Audience' },
        { label: 'Verified Audience' }
      ]
    };
  },

  computed: {
    sortedAscReviews() {
      return [...this.reviews].sort((a, b) => a.sortIdx - b.sortIdx);
    },
    sortedDescReviews() {
      return [...this.reviews].sort((a, b) => b.sortIdx - a.sortIdx);
    },
    cardStyle() {
      return {
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '5px',
        padding: '10px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      };
    }
  },

  mounted() {
    // Listen for show changes
    evtBus.on('setUpSeries', (show) => {
      this.showName = show?.Name || '';
      this.reviews = [];
      this.rottenUrl = '';
      this.rottenLabel = '';
      this.selectedButton = 'All Critics';
    });

    // Listen for TVDB details to get existing Remotes (including Rotten button URL)
    evtBus.on('tvdbDataReady', (data) => {
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
      // Dummy implementation for now
      // const reviews = await srvr.getReviews(url, buttonName);
      
      // Generating dummy data
      this.reviews = [
        {
          reviewId: 1,
          sortIdx: 1,
          author: "John Doe",
          publication: "The Daily News",
          numStars: 4,
          ratings: "",
          text: "This is a great show! The acting is superb and the storyline is engaging.",
          more: false
        },
        {
          reviewId: 2,
          sortIdx: 2,
          author: "Jane Smith",
          publication: "Weekly TV Guide",
          numStars: 3,
          ratings: "",
          text: "A bit slow at times, but overall worth watching. I particularly liked the second episode.",
          more: true
        },
        {
          reviewId: 3,
          sortIdx: 3,
          author: "Bob Brown",
          publication: "Online Reviews",
          numStars: 2,
          ratings: "C+",
          text: "Not my cup of tea. Too much drama and not enough action.",
          more: false
        },
        {
          reviewId: 4,
          sortIdx: 4,
          author: "Alice Green",
          publication: "",
          numStars: 5,
          ratings: "",
          text: "An absolute masterpiece! Must watch for everyone.",
          more: false
        },
        {
          reviewId: 5,
          sortIdx: 5,
          author: "Charlie White",
          publication: "Entertainment Weekly",
          numStars: 3,
          ratings: "3/5",
          text: "Solid performance by the cast. The plot twists were predictable though.",
          more: true
        },
         {
          reviewId: 6,
          sortIdx: 6,
          author: "David Black",
          publication: "Movie Blog",
          numStars: 1,
          ratings: "",
          text: "Terrible. Do not waste your time.",
          more: false
        }
      ];
    },
    
    async handleReviewClick(review) {
      if (review.more) {
        // const remainingText = await srvr.getRemainingReview(review.reviewId);
        
        // Dummy implementation simulating valid return
        const remainingText = " It really picks up in the second half. The characters develop significantly and the plot twists are unexpected but satisfying. Highly recommended for fans of the genre.";
        
        review.text += remainingText;
        review.more = false;
      }
    },

    getStarClasses(numStars) {
      // numStars is 0 to 4 (representing 0 to 4 full stars visually in a 4-star row? 
      // Prompt says "row of 4 stars", "standard ratings display of 0 to 4 representing same numStars property"
      // Wait, 0 to 4 numStars.
      // 3 font awesome icons available: full, half, empty.
      
      // Assuming numStars is integer or half-integer.
      // Example: 3.5 stars. 3 Full, 1 Half, 0 Empty (if max is 4).
      
      const stars = [];
      const val = Number(numStars) || 0;
      
      for (let i = 1; i <= 4; i++) {
        if (val >= i) {
          stars.push('fa-solid fa-star');
        } else if (val >= i - 0.5) {
           stars.push('fa-solid fa-star-half-stroke');
        } else {
           stars.push('fa-regular fa-star');
        }
      }
      return stars;
    }
  }
};
</script>
