<template lang="pug">
#buttons(:style="{ display:'flex', flexDirection:'column', padding: sizing.buttonContainerPadding || '5px', paddingBottom:'0', overflowY:'auto', height:'100%' }")
  button(
    @click="$emit('top-click')"
    :style="{ width:'100%', lineHeight: sizing.buttonHeight || '40px', padding:'0 8px', marginTop: sizing.buttonTopMargin || '10px', marginBottom: sizing.buttonMarginBottom || '8px', fontSize: sizing.buttonFontSize || '15px', fontWeight:'bold', border:'1px solid #999', borderRadius:'5px', cursor:'pointer', backgroundColor:'#eee', textAlign:'center' }"
  ) Top
  
  div(style="height:2px; background-color:#666; margin:10px 0;")
  
  button(
    v-for="btn in filters"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    :style="{ width:'100%', lineHeight: sizing.buttonHeight || '40px', padding:'0 8px', marginBottom: sizing.buttonMarginBottom || '8px', fontSize: sizing.buttonFontSize || '15px', fontWeight:'bold', border:'1px solid #999', borderRadius:'5px', cursor:'pointer', backgroundColor:'#eee', textAlign:'center' }"
  ) {{ btn }}
  
  button(
    v-for="btn in genres"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    :style="{ width:'100%', lineHeight: sizing.buttonHeight || '40px', padding:'0 8px', marginBottom: sizing.buttonMarginBottom || '8px', fontSize: sizing.buttonFontSize || '15px', fontWeight:'bold', border:'1px solid #999', borderRadius:'5px', cursor:'pointer', backgroundColor:'#eee', textAlign:'center' }"
  ) {{ btn }}
  
  div(style="height:2px; background-color:#666; margin:10px 0;")
  
  button(
    v-for="btn in collections"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    :style="{ width:'100%', lineHeight: sizing.buttonHeight || '40px', padding:'0 8px', marginBottom: sizing.buttonMarginBottom || '8px', fontSize: sizing.buttonFontSize || '15px', fontWeight:'bold', border:'1px solid #999', borderRadius:'5px', cursor:'pointer', backgroundColor:'#eee', textAlign:'center' }"
  ) {{ btn }}

  button(
    v-if="hasSharedFilters"
    :class="{ active: activeButtons['Custom'] }"
    @click="handleButtonClick('Custom')"
    :style="{ width:'100%', lineHeight: sizing.buttonHeight || '40px', padding:'0 8px', marginBottom: sizing.buttonMarginBottom || '8px', fontSize: sizing.buttonFontSize || '15px', fontWeight:'bold', border:'1px solid #999', borderRadius:'5px', cursor:'pointer', backgroundColor:'#eee', textAlign:'center' }"
  ) Custom
  
  div(style="height:2px; background-color:#666; margin:10px 0;")
  
  button(
    v-for="btn in sortOrders"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    :style="{ width:'100%', lineHeight: sizing.buttonHeight || '40px', padding:'0 8px', marginBottom:'10px', fontSize: sizing.buttonFontSize || '15px', fontWeight:'bold', border:'1px solid #999', borderRadius:'5px', cursor:'pointer', backgroundColor:'#eee', textAlign:'center' }"
  ) {{ btn }}
</template>

<script>
import * as srvr from '../srvr.js';

export default {
  name: "Buttons",

  props: {
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      hasSharedFilters: false,
      activeButtons: {
        'Ready To Watch': false,
        'Drama': false,
        'Comedy': false,
        'To Try': false,
        'Continue': false,
        'Mark': false,
        'Linda': false,
        'Custom': false,
        'Added Order': false,
        'Viewed Order': false,
        'Ratings Order': false,
        'Notes Order': false
      },
      filters: [
        'Ready To Watch'
      ],
      genres: [
        'Drama',
        'Comedy'
      ],
      collections: [
        'To Try',
        'Continue',
        'Mark',
        'Linda'
      ],
      sortOrders: [
        'Added Order',
        'Viewed Order',
        'Ratings Order',
        'Notes Order'
      ]
    };
  },

  emits: ['button-click', 'top-click'],

  mounted() {
    void this.refreshHasSharedFilters();
    this.startSharedFiltersPolling();
  },

  beforeUnmount() {
    if (this._sharedFiltersPoll) {
      clearInterval(this._sharedFiltersPoll);
      this._sharedFiltersPoll = null;
    }
  },

  methods: {
    startSharedFiltersPolling() {
      // Poll tv-series-srvr sharedFilters so Custom button appears/disappears across computers.
      // When it changes, reset internal filters by emitting current button state
      // (with Custom turned off) so List recomputes from visible buttons.
      this._lastSharedFiltersRaw = '';

      if (this._sharedFiltersPoll) return;
      this._sharedFiltersPoll = setInterval(() => {
        void (async () => {
          let shared = null;
          try {
            shared = await srvr.getSharedFilters();
          } catch {
            shared = null;
          }

          const raw = shared ? JSON.stringify(shared) : '';
          if (raw === this._lastSharedFiltersRaw) return;
          this._lastSharedFiltersRaw = raw;

          await this.refreshHasSharedFilters(shared);
          this.activeButtons['Custom'] = false;
          this.$emit('button-click', this.activeButtons);
        })();
      }, 3000);
    },

    async refreshHasSharedFilters(sharedFiltersIn = undefined) {
      let shared = sharedFiltersIn;
      if (shared === undefined) {
        try {
          shared = await srvr.getSharedFilters();
        } catch {
          shared = null;
        }
      }

      const has = !!shared && typeof shared === 'object' && Object.keys(shared).length > 0;
      this.hasSharedFilters = has;
      if (!has) this.activeButtons['Custom'] = false;
    },

    handleButtonClick(label) {
      void this.refreshHasSharedFilters();

      // Custom: turn off highlights above it (filters/genres/collections), keep order buttons unchanged.
      if (label === 'Custom') {
        const nextVal = !this.activeButtons['Custom'];
        this.activeButtons['Custom'] = nextVal;

        if (nextVal) {
          // Clear highlights from all buttons above Custom
          [...this.filters, ...this.genres, ...this.collections].forEach((btn) => {
            this.activeButtons[btn] = false;
          });
        }
        this.$emit('button-click', this.activeButtons);
        return;
      }

      // Any non-order button click should clear Custom highlight.
      if (!this.sortOrders.includes(label)) {
        this.activeButtons['Custom'] = false;
      }

      // Special handling for order buttons: if clicking an on button, turn all off
      if (this.sortOrders.includes(label) && this.activeButtons[label]) {
        // Turn off all order buttons
        this.sortOrders.forEach(btn => {
          this.activeButtons[btn] = false;
        });
        // Emit all active button states
        this.$emit('button-click', this.activeButtons);
        return;
      }
      
      // Special handling for collections: if clicking an on button, turn all off
      if (this.collections.includes(label) && this.activeButtons[label]) {
        // Turn off all collection buttons
        this.collections.forEach(btn => {
          this.activeButtons[btn] = false;
        });
        // Emit all active button states
        this.$emit('button-click', this.activeButtons);
        return;
      }
      
      // Special handling for genres: if clicking an on button, turn all off
      if (this.genres.includes(label) && this.activeButtons[label]) {
        // Turn off all genre buttons
        this.genres.forEach(btn => {
          this.activeButtons[btn] = false;
        });
        this.$emit('button-click', label, false);
        return;
      }
      
      // Toggle the clicked button first (independent of any other toggle instructions)
      this.activeButtons[label] = !this.activeButtons[label];
      
      // Button interactions
      // genres:on:other genres:off (mutually exclusive)
      if (this.genres.includes(label) && this.activeButtons[label]) {
        // Turn off all other genre buttons
        this.genres.forEach(btn => {
          if (btn !== label) {
            this.activeButtons[btn] = false;
          }
        });
      }
      
      // collections:on:other collections:off (mutually exclusive)
      if (this.collections.includes(label) && this.activeButtons[label]) {
        // Turn off all other collection buttons
        this.collections.forEach(btn => {
          if (btn !== label) {
            this.activeButtons[btn] = false;
          }
        });
      }
      
      // order group:on:other order buttons:off
      if (this.sortOrders.includes(label) && this.activeButtons[label]) {
        // Turn off all other buttons in sortOrders group (excluding the clicked one)
        this.sortOrders.forEach(btn => {
          if (btn !== label) {
            this.activeButtons[btn] = false;
          }
        });
      }
      
      // Emit all active button states, not just the clicked one
      this.$emit('button-click', this.activeButtons);
    }
  },
};
</script>

<style scoped>
button.active {
  background-color: #4CAF50 !important;
  color: white;
}

button:hover {
  background-color: #ccc;
}

button.active:hover {
  background-color: #45a049 !important;
}
</style>
