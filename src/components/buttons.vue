<template lang="pug">
#buttons(style="display:flex; flex-direction:column; height:100%; overflow-y:auto; padding:5px; background-color:#ddd;")
  button(
    v-for="btn in filters"
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
        'Show All': false,
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
        'Show All',
        'Ready To Watch',
        'Drama',
        'Comedy',
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
      // Toggle the clicked button
      this.activeButtons[label] = !this.activeButtons[label];
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
