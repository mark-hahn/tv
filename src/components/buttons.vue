<template lang="pug">
#buttons(style="display:flex; flex-direction:column; height:100%; overflow-y:auto; padding:5px; background-color:#ddd;")
  button(
    v-for="btn in filters"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    style="width:100%; padding:12px 8px; margin-bottom:8px; font-size:15px; font-weight:bold; border:1px solid #999; border-radius:5px; cursor:pointer; background-color:#eee; text-align:center;"
  ) {{ btn }}
  
  button(
    v-for="btn in genres"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    style="width:100%; padding:12px 8px; margin-bottom:8px; font-size:15px; font-weight:bold; border:1px solid #999; border-radius:5px; cursor:pointer; background-color:#eee; text-align:center;"
  ) {{ btn }}
  
  div(style="height:2px; background-color:#666; margin:10px 0;")
  
  button(
    v-for="btn in collections"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    style="width:100%; padding:12px 8px; margin-bottom:8px; font-size:15px; font-weight:bold; border:1px solid #999; border-radius:5px; cursor:pointer; background-color:#eee; text-align:center;"
  ) {{ btn }}
  
  div(style="height:2px; background-color:#666; margin:10px 0;")
  
  button(
    v-for="btn in sortOrders"
    :key="btn"
    :class="{ active: activeButtons[btn] }"
    @click="handleButtonClick(btn)"
    style="width:100%; padding:12px 8px; margin-bottom:8px; font-size:15px; font-weight:bold; border:1px solid #999; border-radius:5px; cursor:pointer; background-color:#eee; text-align:center;"
  ) {{ btn }}
</template>

<script>
export default {
  name: "Buttons",

  data() {
    return {
      activeButtons: {
        'Ready To Watch': false,
        'Drama': false,
        'Comedy': false,
        'To Try': false,
        'Continue': false,
        'Mark': false,
        'Linda': false,
        'Added Order': false,
        'Viewed Order': false,
        'Ratings Order': false
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
        'Ratings Order'
      ]
    };
  },

  methods: {
    handleButtonClick(label) {
      // Special handling for order buttons: if clicking an on button, turn all off
      if (this.sortOrders.includes(label) && this.activeButtons[label]) {
        // Turn off all order buttons
        this.sortOrders.forEach(btn => {
          this.activeButtons[btn] = false;
        });
        this.$emit('button-click', label, false);
        return;
      }
      
      // Special handling for collections: if clicking an on button, turn all off
      if (this.collections.includes(label) && this.activeButtons[label]) {
        // Turn off all collection buttons
        this.collections.forEach(btn => {
          this.activeButtons[btn] = false;
        });
        this.$emit('button-click', label, false);
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
      
      this.$emit('button-click', label, this.activeButtons[label]);
    }
  },

  emits: ['button-click']
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
